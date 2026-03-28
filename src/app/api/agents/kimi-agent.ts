import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

function getKimiEnv() {
  const apiKey = process.env.KIMI_API_KEY ?? process.env.GMI_API_KEY;
  if (!apiKey) {
    throw new Error("KIMI_API_KEY (or fallback GMI_API_KEY) is not set.");
  }

  const baseURL =
    process.env.KIMI_BASE_URL ??
    process.env.GMI_BASE_URL ??
    "https://api.gmi-serving.com/v1";

  const model = process.env.KIMI_MODEL ?? "moonshotai/Kimi-K2.5";

  return { apiKey, baseURL, model };
}

export function createKimiChatModel(modelOverride?: string) {
  const { apiKey, baseURL, model } = getKimiEnv();

  return new ChatOpenAI({
    model: modelOverride ?? model,
    apiKey,
    configuration: { baseURL },
  });
}

const ReceiptLineItemSchema = z.object({
  description: z.string().describe("Line item description."),
  quantity: z.string().optional().describe("Item quantity if visible."),
  unitPrice: z.string().optional().describe("Per-unit price if visible."),
  totalPrice: z.string().optional().describe("Line total if visible."),
});

const ReceiptDataSchema = z.object({
  merchantName: z.string().optional().describe("Merchant or store name."),
  merchantAddress: z
    .string()
    .optional()
    .describe("Merchant address if present."),
  receiptNumber: z
    .string()
    .optional()
    .describe("Receipt/check/invoice number if present."),
  purchaseDate: z
    .string()
    .optional()
    .describe(
      "Purchase/receipt date in MM/DD/YYYY when confidently possible; otherwise keep original text.",
    ),
  currency: z.string().optional().describe("Currency code or symbol."),
  subtotal: z.string().optional().describe("Subtotal amount."),
  tax: z.string().optional().describe("Tax amount."),
  tip: z.string().optional().describe("Tip amount."),
  total: z.string().optional().describe("Total amount paid."),
  paymentMethod: z
    .string()
    .optional()
    .describe("Payment method if visible (card/cash/etc)."),
  lineItems: z
    .array(ReceiptLineItemSchema)
    .default([])
    .describe("Line items found on the receipt."),
});

const ImageExtractionSchema = z.object({
  summary: z
    .string()
    .describe("Short summary of the receipt/document and notable outcomes."),
  extractedText: z
    .string()
    .describe("Raw OCR-style text seen in the image. Keep line breaks where useful."),
  fields: z
    .record(z.string(), z.string())
    .describe(
      "Flat key-value fields for backwards compatibility (amounts, dates, merchant, tax IDs, etc).",
    ),
  receipt: ReceiptDataSchema.describe(
    "Receipt-specific structured fields. Use best-effort extraction and leave missing values undefined.",
  ),
});

export type KimiImageExtraction = z.infer<typeof ImageExtractionSchema>;

export function createKimiImageExtractionAgent(modelOverride?: string) {
  return createKimiChatModel(modelOverride);
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (typeof block === "object" && block !== null && "text" in block) {
          return String((block as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return String(content ?? "").trim();
}

export async function extractImageDataWithKimi(input: {
  base64: string;
  mimeType: string;
  userPrompt?: string | null;
  modelOverride?: string;
}): Promise<KimiImageExtraction> {
  const model = createKimiImageExtractionAgent(input.modelOverride?.trim());

  const userPrompt = input.userPrompt?.trim();
  const prompt = userPrompt
    ? [
        "Extract structured receipt data from this image.",
        "User context:",
        userPrompt,
        "Return complete OCR text and precise structured fields. Normalize all date values to MM/DD/YYYY when confidently possible. If uncertain, omit fields instead of guessing.",
      ].join("\n")
    : [
        "Extract structured receipt data from this image.",
        "Return complete OCR text, key-value fields, and receipt-specific fields (merchant, date, subtotal, tax, tip, total, payment method, line items).",
        "Normalize date values to MM/DD/YYYY when confidently possible.",
        "Do not invent missing values.",
      ].join("\n");

  const schemaHint = `Return ONLY valid JSON matching this schema (no markdown, no code fences):
${JSON.stringify(z.toJSONSchema(ImageExtractionSchema), null, 2)}`;

  const result = await model.invoke([
    {
      role: "system",
      content:
        "You are a receipt extraction agent. Extract only information supported by the image. Never invent values. Prioritize merchant, date, subtotal, tax, total, payment method, and line items.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: `${prompt}\n\n${schemaHint}` },
        {
          type: "image_url",
          image_url: {
            url: `data:${input.mimeType};base64,${input.base64}`,
          },
        },
      ],
    },
  ]);

  const text = stringifyContent(result.content);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      throw new Error("Kimi returned non-JSON output for receipt extraction.");
    }
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  }

  return ImageExtractionSchema.parse(parsed) as KimiImageExtraction;
}
