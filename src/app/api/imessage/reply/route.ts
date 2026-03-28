import { NextRequest, NextResponse } from "next/server";

import { answerReceiptQueryWithHydra } from "@/app/api/agents/query-answer-agent";
import { routeIMessageIntake, runIntakeReplyTool } from "@/app/api/agents/intake-agent";
import { getIMessageSDK, getSessionFromRequest } from "@/lib/imessage";

type Body = {
  chatId?: string;
  messageText?: string;
  hasImageAttachment?: boolean;
  delivery?: "dashboard" | "imessage";
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

  const intakeDecision = routeIMessageIntake({
    hasImageAttachment: Boolean(body.hasImageAttachment),
    messageText: body.messageText ?? null,
  });
  const delivery = body.delivery ?? "dashboard";

  if (intakeDecision.route !== "llm_reply") {
    return NextResponse.json(
      {
        error: "Message should be processed by receipt extraction route.",
        route: intakeDecision.route,
        reason: intakeDecision.reason,
      },
      { status: 400 },
    );
  }

  const toolResult = runIntakeReplyTool({
    chatId: body.chatId?.trim(),
    messageText: body.messageText ?? "",
  });

  if (!toolResult.accepted) {
    return NextResponse.json(
      {
        error: "Query rejected by intake guardrails.",
        route: "llm_reply",
        guardrails: {
          accepted: false,
          reason: toolResult.rejectionReason,
        },
      },
      { status: 400 },
    );
  }

  try {
    const reply = await answerReceiptQueryWithHydra(toolResult);

    if (reply.status === "rejected") {
      return NextResponse.json(
        {
          error: "Query rejected by intake guardrails.",
          route: "llm_reply",
          guardrails: {
            accepted: false,
            reason: reply.reason,
          },
        },
        { status: 400 },
      );
    }

    if (reply.status === "unavailable") {
      return NextResponse.json(
        {
          error: "Reply service unavailable.",
          route: "llm_reply",
          reason: reply.reason,
          hint: "Set HYDRADB_API_KEY and HYDRADB_TENANT_ID to enable text replies.",
        },
        { status: 503 },
      );
    }

    if (delivery === "imessage") {
      const chatId = body.chatId?.trim();
      if (!chatId) {
        return NextResponse.json(
          {
            error: '"chatId" is required when delivery is "imessage".',
          },
          { status: 400 },
        );
      }

      const sdk = getIMessageSDK();
      const sent = await sdk.send(chatId, reply.answer);

      return NextResponse.json({
        route: "llm_reply",
        delivered: {
          channel: "imessage",
          chatId,
          sentAt: sent.sentAt,
        },
        query: {
          kind: reply.queryKind,
          normalizedQuestion: reply.normalizedQuestion,
        },
        sources: {
          count: reply.sourceCount,
        },
        guardrails: {
          accepted: true,
        },
      });
    }

    return NextResponse.json({
      route: "llm_reply",
      delivered: {
        channel: "dashboard",
      },
      answer: reply.answer,
      query: {
        kind: reply.queryKind,
        normalizedQuestion: reply.normalizedQuestion,
      },
      sources: {
        count: reply.sourceCount,
      },
      guardrails: {
        accepted: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate reply.";
    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
