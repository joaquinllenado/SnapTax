import { NextRequest, NextResponse } from "next/server";

import { getIMessageSDK, getSessionFromRequest } from "@/lib/imessage";
import {
  findLatestReceiptImageMessage,
  processMessageReceipt,
} from "@/lib/receipt-processing";
import { normalizeChatIdForMessageQuery } from "@/lib/imessage-chat-id";
import { ensureReceiptWatcherStarted } from "@/lib/receipt-watcher";

type Body = {
  chatId?: string;
  messageGuid?: string;
  /** If true, send iMessage confirmations when processing starts and completes. */
  reply?: boolean;
};

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const chatId = body.chatId?.trim();
  const configuredPhone = session.phone;
  if (chatId) {
    const requested = normalizeChatIdForMessageQuery(chatId).queryChatId;
    const configured = normalizeChatIdForMessageQuery(configuredPhone).queryChatId;
    if (requested !== configured) {
      return NextResponse.json(
        {
          error: `Receipt processing is scoped to your signed-in phone (${configuredPhone}).`,
          configuredPhone,
        },
        { status: 400 },
      );
    }
  }

  try {
    try {
      await ensureReceiptWatcherStarted();
    } catch (watcherError) {
      console.warn(
        "[analyze-image] watcher startup failed; continuing with manual processing:",
        watcherError,
      );
    }

    const sdk = getIMessageSDK();
    let target = await findLatestReceiptImageMessage(sdk, configuredPhone);

    if (body.messageGuid?.trim()) {
      const normalized = normalizeChatIdForMessageQuery(configuredPhone);
      const { messages } = await sdk.getMessages({
        limit: 100,
        chatId: normalized.queryChatId,
        excludeOwnMessages: false,
      });
      target = messages.find((m) => m.guid === body.messageGuid?.trim()) ?? null;
    }

    if (!target) {
      return NextResponse.json(
        {
          error: "No new unprocessed image attachment found for your configured phone number.",
          configuredPhone,
        },
        { status: 404 },
      );
    }

    const result = await processMessageReceipt({
      sdk,
      message: target,
      reply: Boolean(body.reply),
    });

    if (result.status === "ignored") {
      return NextResponse.json(
        {
          error: "Latest receipt image was already processed.",
          reason: result.reason,
          configuredPhone,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      analysis: result.analysis,
      extraction: result.extraction,
      messageGuid: result.messageGuid,
      replied: result.replied,
      imageUrl: result.imageUrl,
      uploadWarning: result.uploadError,
      configuredPhone,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to analyze image.";

    return NextResponse.json(
      {
        error: message,
        hint: "Set KIMI_API_KEY (or GMI_API_KEY), optionally KIMI_BASE_URL and KIMI_MODEL (for example kimi-k2-5).",
      },
      { status: 500 },
    );
  }
}
