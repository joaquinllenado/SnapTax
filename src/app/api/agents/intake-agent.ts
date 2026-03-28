import { z } from "zod";

import { createKimiChatModel } from "./kimi-agent";

const IntakeRouteSchema = z.enum(["receipt_extraction", "llm_reply"]);
const ReplyQueryKindSchema = z.enum([
  "spend_summary",
  "merchant_breakdown",
  "transaction_lookup",
  "receipt_field_lookup",
]);

const IntakeDecisionSchema = z.object({
  route: IntakeRouteSchema,
  reason: z.string().describe("Short explanation for why this route was selected."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score from 0 to 1."),
});

export type IntakeDecision = z.infer<typeof IntakeDecisionSchema>;
export type ReplyQueryKind = z.infer<typeof ReplyQueryKindSchema>;

const IntakeReplyToolInputSchema = z.object({
  chatId: z.string().trim().min(1).max(120).optional(),
  messageText: z.string().trim().min(3).max(400),
});

export type IntakeReplyToolInput = z.infer<typeof IntakeReplyToolInputSchema>;
export type IntakeReplyToolOutput = {
  accepted: boolean;
  rejectionReason: string | null;
  queryKind: ReplyQueryKind | null;
  normalizedQuestion: string | null;
  hydra: {
    question: string;
    mode: "fast";
    searchMode: "memories";
    maxChunks: number;
    maxTokens: number;
    temperature: number;
  } | null;
};

const DOMAIN_KEYWORDS = [
  "spend",
  "spent",
  "spending",
  "receipt",
  "receipts",
  "transaction",
  "transactions",
  "merchant",
  "purchase",
  "total",
  "tax",
  "tip",
  "budget",
  "expense",
  "expenses",
];

const BLOCKED_PATTERNS = [
  /```/,
  /<script/i,
  /\b(ignore|override|bypass|reveal)\b.{0,40}\b(system|prompt|instruction|policy|guardrail)s?\b/i,
  /\b(drop|delete|truncate|alter|insert|update)\b.{0,30}\b(table|database|db|schema|memory|tenant)\b/i,
  /\bSELECT\b.+\bFROM\b/i,
];

function classifyReplyKind(question: string): ReplyQueryKind {
  if (/\bmerchant|store|vendor\b/i.test(question)) return "merchant_breakdown";
  if (/\breceipt|subtotal|tax|tip|payment method|line item|item\b/i.test(question)) {
    return "receipt_field_lookup";
  }
  if (/\b(which|latest|last|find|show)\b.*\btransactions?\b/i.test(question)) {
    return "transaction_lookup";
  }
  return "spend_summary";
}

export function runIntakeReplyTool(input: IntakeReplyToolInput): IntakeReplyToolOutput {
  const parsed = IntakeReplyToolInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      accepted: false,
      rejectionReason: "invalid_input",
      queryKind: null,
      normalizedQuestion: null,
      hydra: null,
    };
  }

  const normalizedQuestion = parsed.data.messageText
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return {
      accepted: false,
      rejectionReason: "query_blocked_by_guardrails",
      queryKind: null,
      normalizedQuestion: null,
      hydra: null,
    };
  }

  if (!DOMAIN_KEYWORDS.some((keyword) => normalizedQuestion.toLowerCase().includes(keyword))) {
    return {
      accepted: false,
      rejectionReason: "query_outside_receipt_scope",
      queryKind: null,
      normalizedQuestion: null,
      hydra: null,
    };
  }

  const queryKind = classifyReplyKind(normalizedQuestion);

  return {
    accepted: true,
    rejectionReason: null,
    queryKind,
    normalizedQuestion,
    hydra: {
      question: normalizedQuestion,
      mode: "fast",
      searchMode: "memories",
      maxChunks: 6,
      maxTokens: 140,
      temperature: 0.1,
    },
  };
}

export function createIntakeRoutingAgent(modelOverride?: string) {
  return createKimiChatModel(modelOverride).withStructuredOutput(
    IntakeDecisionSchema,
    { name: "intake_routing_decision" },
  );
}

export function routeIMessageIntake(input: {
  hasImageAttachment: boolean;
  messageText?: string | null;
}): IntakeDecision {
  if (input.hasImageAttachment) {
    return {
      route: "receipt_extraction",
      reason:
        "Image attachment detected, so this message should follow receipt extraction.",
      confidence: 1,
    };
  }

  const text = input.messageText?.trim();
  if (text) {
    return {
      route: "llm_reply",
      reason: "No image attachment; treat this as a plaintext question/message.",
      confidence: 0.98,
    };
  }

  return {
    route: "llm_reply",
    reason: "No image attachment found; defaulting to text reply path.",
    confidence: 0.7,
  };
}
