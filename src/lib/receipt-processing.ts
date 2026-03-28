import { attachmentExists, readAttachment, type Attachment, type IMessageSDK, type Message } from "@photon-ai/imessage-kit";
import os from "os";

import { extractImageDataWithKimi, type KimiImageExtraction } from "@/app/api/agents/kimi-agent";
import { normalizeDateToMMDDYYYY } from "@/lib/date-normalization";
import {
  hasPersistedMessageGuid,
  listPersistedMessageGuids,
  persistProcessedReceipt,
} from "@/lib/hydradb-receipts";
import { normalizeChatIdForMessageQuery } from "@/lib/imessage-chat-id";
import { uploadReceiptImageToR2 } from "@/lib/r2-upload";

const PROCESSED_RETENTION_MS = 24 * 60 * 60 * 1000;

type DedupeEntry = {
  key: string;
  at: number;
};

const processed = new Map<string, DedupeEntry>();
const inFlight = new Set<string>();
let lastProcessingStartedAt: string | null = null;
let lastProcessingFinishedAt: string | null = null;

function cleanupDedupe(): void {
  const cutoff = Date.now() - PROCESSED_RETENTION_MS;
  for (const [key, entry] of processed) {
    if (entry.at < cutoff) processed.delete(key);
  }
}

function toComparable(raw: string): string {
  return raw.replace(/^\+/, "").trim();
}

function isTargetChatId(chatId: string, configuredPhone: string): boolean {
  const normalized = normalizeChatIdForMessageQuery(chatId).queryChatId;
  return toComparable(normalized) === toComparable(configuredPhone);
}

export function isConfiguredReceiptMessage(
  message: Message,
  configuredPhone: string,
): boolean {
  return (
    toComparable(message.sender) === toComparable(configuredPhone) ||
    isTargetChatId(message.chatId, configuredPhone)
  );
}

/** Returns true for attachments that look like images, including HEIC/HEIF. */
export function isImageAttachment(
  att: Pick<Attachment, "isImage" | "mimeType" | "filename">,
): boolean {
  if (att.isImage) return true;

  const mime = (att.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return true;

  const ext = (att.filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  return ["heic", "heif", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"].includes(ext);
}

/** Best-effort mimeType resolution for attachments with missing mimeType values. */
export function resolveMimeType(
  att: Pick<Attachment, "mimeType" | "filename">,
): string {
  if (att.mimeType && att.mimeType !== "application/octet-stream") {
    return att.mimeType;
  }

  const ext = (att.filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    heic: "image/heic",
    heif: "image/heif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };

  return map[ext] ?? "image/jpeg";
}

function imageFingerprint(message: Message, attachment: Attachment): string {
  const dateMs = attachment.createdAt instanceof Date ? attachment.createdAt.getTime() : 0;
  return [
    "image",
    toComparable(message.chatId),
    attachment.filename,
    attachment.size,
    dateMs,
    attachment.path,
  ].join("|");
}

function dedupeKeys(message: Message, imageAttachment: Attachment): string[] {
  return [`msg:${message.guid}`, imageFingerprint(message, imageAttachment)];
}

function reserveForProcessing(keys: string[]): boolean {
  cleanupDedupe();

  for (const key of keys) {
    if (inFlight.has(key) || processed.has(key)) return false;
  }

  for (const key of keys) {
    inFlight.add(key);
  }
  lastProcessingStartedAt = new Date().toISOString();

  return true;
}

function markProcessed(keys: string[]): void {
  const now = Date.now();
  lastProcessingFinishedAt = new Date(now).toISOString();

  for (const key of keys) {
    inFlight.delete(key);
    processed.set(key, { key, at: now });
  }
}

function releaseReservation(keys: string[]): void {
  if (keys.length > 0) {
    lastProcessingFinishedAt = new Date().toISOString();
  }
  for (const key of keys) inFlight.delete(key);
}

function clearProcessedDedupe(keys: string[]): void {
  for (const key of keys) {
    processed.delete(key);
  }
}

export function getReceiptProcessingSnapshot(): {
  activeCount: number;
  lastProcessingStartedAt: string | null;
  lastProcessingFinishedAt: string | null;
} {
  return {
    activeCount: inFlight.size,
    lastProcessingStartedAt,
    lastProcessingFinishedAt,
  };
}

function formatLoggedConfirmation(extraction: KimiImageExtraction): string {
  const merchant = extraction.receipt.merchantName?.trim() || "merchant";
  const rawDate = extraction.receipt.purchaseDate?.trim();
  if (!rawDate) return `Logged ${merchant} transaction.`;
  return `Logged ${merchant} transaction from ${rawDate}.`;
}

function normalizeExtractionDates(extraction: KimiImageExtraction): KimiImageExtraction {
  const normalizedPurchaseDate = extraction.receipt.purchaseDate
    ? normalizeDateToMMDDYYYY(extraction.receipt.purchaseDate) ?? extraction.receipt.purchaseDate.trim()
    : undefined;

  const normalizedFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(extraction.fields)) {
    const lowerKey = key.toLowerCase();
    const shouldTryNormalize =
      lowerKey.includes("date") ||
      lowerKey.includes("day") ||
      lowerKey.includes("issued") ||
      lowerKey.includes("purchase") ||
      /\b\d{4}\b/.test(value) ||
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(
        value,
      );
    const normalized = shouldTryNormalize
      ? normalizeDateToMMDDYYYY(value)
      : null;
    normalizedFields[key] = normalized ?? value;
  }

  return {
    ...extraction,
    fields: normalizedFields,
    receipt: {
      ...extraction.receipt,
      purchaseDate: normalizedPurchaseDate,
    },
  };
}

async function getImageAttachment(message: Message): Promise<Attachment | null> {
  const imageAtt = message.attachments.find((a) => isImageAttachment(a));
  if (!imageAtt) return null;

  if (imageAtt.path?.startsWith("~/")) {
    (imageAtt as { path: string }).path = os.homedir() + imageAtt.path.slice(1);
  }

  const exists = await attachmentExists(imageAtt);
  return exists ? imageAtt : null;
}

export async function processMessageReceipt(input: {
  sdk: IMessageSDK;
  message: Message;
  reply: boolean;
}): Promise<
  | {
      status: "processed";
      analysis: string;
      extraction: KimiImageExtraction;
      messageGuid: string;
      replied: boolean;
      imageUrl: string | null;
      uploadError: string | null;
    }
  | { status: "ignored"; reason: string }
> {
  const imageAtt = await getImageAttachment(input.message);
  if (!imageAtt) {
    return { status: "ignored", reason: "no_image_attachment" };
  }

  const keys = dedupeKeys(input.message, imageAtt);
  if (await hasPersistedMessageGuid(input.message.guid).catch(() => false)) {
    return { status: "ignored", reason: "already_persisted" };
  }
  // If persistence was wiped (e.g. demo reset), allow the same message/image to be reprocessed.
  clearProcessedDedupe(keys);
  if (!reserveForProcessing(keys)) {
    return { status: "ignored", reason: "duplicate_image" };
  }

  try {
    if (input.reply) {
      input.sdk
        .send(input.message.chatId, "Got it. Logging the receipt now.")
        .catch((error) => {
          console.warn("[receipt-processing] failed to send processing confirmation:", error);
        });
    }

    const buffer = await readAttachment(imageAtt);
    const mimeType = resolveMimeType(imageAtt);
    let imageUrl: string | null = null;
    let imageForStorage: {
      filename: string | null;
      mimeType: string;
      size: number;
      key: string;
      url: string;
      uploadedAt: string;
    } | null = null;
    let uploadError: string | null = null;

    try {
      const uploaded = await uploadReceiptImageToR2({
        buffer,
        mimeType,
        messageGuid: input.message.guid,
        filename: imageAtt.filename ?? null,
      });

      if (uploaded) {
        imageUrl = uploaded.url;
        imageForStorage = {
          filename: imageAtt.filename ?? null,
          mimeType,
          size: imageAtt.size,
          key: uploaded.key,
          url: uploaded.url,
          uploadedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      uploadError = error instanceof Error ? error.message : "Image upload failed.";
      console.error("[receipt-processing] R2 upload failed:", error);
    }

    const rawExtraction = await extractImageDataWithKimi({
      base64: buffer.toString("base64"),
      mimeType,
      userPrompt: input.message.text,
    });
    const extraction = normalizeExtractionDates(rawExtraction);

    const analysis = [
      extraction.summary,
      "",
      "Extracted text:",
      extraction.extractedText,
      "",
      "Fields:",
      JSON.stringify(extraction.fields, null, 2),
      "",
      "Receipt:",
      JSON.stringify(extraction.receipt, null, 2),
    ].join("\n");

    const processedAt = new Date().toISOString();
    await persistProcessedReceipt({
      messageGuid: input.message.guid,
      chatId: input.message.chatId,
      summary: extraction.summary,
      extraction,
      processedAt,
      image: imageForStorage,
    });

    markProcessed(keys);

    if (input.reply) {
      await input.sdk.send(
        input.message.chatId,
        formatLoggedConfirmation(extraction),
      );
    }

    return {
      status: "processed",
      analysis,
      extraction,
      messageGuid: input.message.guid,
      replied: input.reply,
      imageUrl,
      uploadError,
    };
  } catch (error) {
    releaseReservation(keys);
    throw error;
  }
}

export async function findLatestReceiptImageMessage(
  sdk: IMessageSDK,
  configuredPhone: string,
): Promise<Message | null> {
  const normalized = normalizeChatIdForMessageQuery(configuredPhone);
  const baseQuery = { limit: 100, excludeOwnMessages: false } as const;

  const primary = await sdk.getMessages({
    ...baseQuery,
    chatId: normalized.queryChatId,
  });

  let messages = primary.messages;
  if (normalized.queryChatId !== configuredPhone) {
    const senderFallback = await sdk.getMessages({
      ...baseQuery,
      sender: normalized.queryChatId,
    });
    const byGuid = new Map<string, Message>();
    for (const msg of primary.messages) byGuid.set(msg.guid, msg);
    for (const msg of senderFallback.messages) byGuid.set(msg.guid, msg);
    messages = [...byGuid.values()];
  }

  const persistedGuids = await listPersistedMessageGuids().catch(() => new Set<string>());
  const sorted = [...messages].sort((a, b) => b.date.getTime() - a.date.getTime());

  const nextUnprocessed = sorted.find((m) => {
    if (!m.attachments.some((a) => isImageAttachment(a))) return false;
    if (persistedGuids.has(m.guid)) return false;
    if (inFlight.has(`msg:${m.guid}`)) return false;
    return true;
  });
  return nextUnprocessed ?? null;
}
