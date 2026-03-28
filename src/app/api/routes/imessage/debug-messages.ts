import { attachmentExists } from "@photon-ai/imessage-kit";
import { NextRequest, NextResponse } from "next/server";

import { normalizeChatIdForMessageQuery } from "@/lib/imessage-chat-id";
import { getIMessageSDK, getSessionFromRequest } from "@/lib/imessage";

/**
 * GET /api/imessage/debug-messages?chatId=xxx&limit=10
 *
 * Debug endpoint — dumps raw message and attachment data for a chat so you can
 * see exactly what the SDK returns (isImage flags, mimeTypes, file existence).
 * Remove or gate behind an env flag before going to production.
 */
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId")?.trim() ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 50);

  if (!chatId) {
    return NextResponse.json(
      { error: 'Query param "chatId" is required.' },
      { status: 400 },
    );
  }

  try {
    const sdk = getIMessageSDK();
    const normalized = normalizeChatIdForMessageQuery(chatId);
    const baseQuery = { limit, excludeOwnMessages: false } as const;

    // Fetch WITHOUT hasAttachments filter first so we see all recent messages
    let { messages, total } = await sdk.getMessages({
      ...baseQuery,
      chatId: normalized.queryChatId,
    });

    if (messages.length === 0 && normalized.queryChatId !== chatId) {
      const senderFallback = await sdk.getMessages({
        ...baseQuery,
        sender: normalized.queryChatId,
      });
      messages = senderFallback.messages;
      total = senderFallback.total;
    }

    const sorted = [...messages].sort(
      (a, b) => b.date.getTime() - a.date.getTime(),
    );

    const debugMessages = await Promise.all(
      sorted.map(async (m) => {
        const attachments = await Promise.all(
          m.attachments.map(async (att) => {
            let exists = false;
            try {
              exists = await attachmentExists(att);
            } catch {
              exists = false;
            }
            return {
              id: att.id,
              filename: att.filename,
              mimeType: att.mimeType,
              path: att.path,
              size: att.size,
              isImage: att.isImage,
              createdAt: att.createdAt,
              fileExistsOnDisk: exists,
            };
          }),
        );

        return {
          guid: m.guid,
          date: m.date,
          sender: m.sender,
          isFromMe: m.isFromMe,
          text: m.text,
          attachmentCount: m.attachments.length,
          attachments,
        };
      }),
    );

    // Also run WITH hasAttachments: true to compare (use same sender-based fallback)
    let { messages: withAttFilter } = await sdk.getMessages({
      ...baseQuery,
      chatId: normalized.queryChatId,
      hasAttachments: true,
    });
    if (withAttFilter.length === 0 && normalized.queryChatId !== chatId) {
      const fallback = await sdk.getMessages({
        ...baseQuery,
        sender: normalized.queryChatId,
        hasAttachments: true,
      });
      withAttFilter = fallback.messages;
    }

    return NextResponse.json({
      chatId,
      normalizedChatId: normalized.queryChatId,
      totalMessagesInChat: total,
      queriedLimit: limit,
      messagesReturned: debugMessages.length,
      messagesWithAttachmentFilter: withAttFilter.length,
      messages: debugMessages,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch messages.",
        hint: "Check Full Disk Access for the app in System Settings → Privacy & Security → Full Disk Access.",
      },
      { status: 500 },
    );
  }
}
