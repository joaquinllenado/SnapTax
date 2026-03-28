import { HydraDBClient } from "@hydra_db/node";

import type { KimiImageExtraction } from "@/app/api/agents/kimi-agent";
import type { Transaction } from "@/app/api/transactions/route";
import { normalizeDateToMMDDYYYY } from "@/lib/date-normalization";
import type { ReceiptImageRecord } from "@/lib/receipt-image-store";

type PersistedReceiptRecord = {
  schema: "snap_tax_receipt_v1";
  id: string;
  messageGuid: string;
  chatId: string;
  summary: string;
  extraction: KimiImageExtraction;
  processedAt: string;
  image: {
    filename: string | null;
    mimeType: string;
    size: number;
    key: string;
    url: string;
    uploadedAt: string;
  } | null;
};

const DEFAULT_TENANT_ID = "snap-tax";
const MAX_PAGES = 20;
const PAGE_SIZE = 100;
const MESSAGE_GUID_CACHE_TTL_MS = 15_000;

let singletonClient: HydraDBClient | null = null;
let ensureTenantPromise: Promise<void> | null = null;
let cachedMessageGuids:
  | {
      expiresAtMs: number;
      values: Set<string>;
    }
  | null = null;

function getHydraConfig(): {
  apiKey: string;
  tenantId: string;
  subTenantId: string | undefined;
} | null {
  const apiKey = process.env.HYDRADB_API_KEY?.trim() ?? "";
  if (!apiKey) return null;

  return {
    apiKey,
    tenantId: process.env.HYDRADB_TENANT_ID?.trim() || DEFAULT_TENANT_ID,
    subTenantId: process.env.HYDRADB_SUB_TENANT_ID?.trim() || undefined,
  };
}

function getClient(): HydraDBClient | null {
  const cfg = getHydraConfig();
  if (!cfg) return null;

  if (!singletonClient) {
    singletonClient = new HydraDBClient({ token: cfg.apiKey, baseUrl: "https://api.hydradb.com" });
  }

  return singletonClient;
}

async function ensureTenant(): Promise<void> {
  const cfg = getHydraConfig();
  const client = getClient();
  if (!cfg || !client) return;

  if (!ensureTenantPromise) {
    ensureTenantPromise = (async () => {
      try {
        await client.tenant.create({ tenant_id: cfg.tenantId });
      } catch {
        // Tenant may already exist or creation may be managed out-of-band.
      }
    })();
  }

  await ensureTenantPromise;
}

function toTransaction(record: PersistedReceiptRecord): Transaction {
  const normalizedPurchaseDate = record.extraction.receipt.purchaseDate
    ? normalizeDateToMMDDYYYY(record.extraction.receipt.purchaseDate) ??
      record.extraction.receipt.purchaseDate
    : null;
  const normalizedReceipt = {
    ...record.extraction.receipt,
    purchaseDate: normalizedPurchaseDate ?? undefined,
  };

  return {
    id: record.id,
    merchantName: record.extraction.receipt.merchantName ?? null,
    total: record.extraction.receipt.total ?? null,
    purchaseDate: normalizedPurchaseDate,
    processedAt: record.processedAt,
    summary: record.summary,
    receipt: normalizedReceipt,
  };
}

function toReceiptImage(record: PersistedReceiptRecord): ReceiptImageRecord | null {
  if (!record.image) return null;
  return {
    id: `${record.id}:${record.image.key}`,
    messageGuid: record.messageGuid,
    chatId: record.chatId,
    filename: record.image.filename,
    mimeType: record.image.mimeType,
    size: record.image.size,
    key: record.image.key,
    url: record.image.url,
    uploadedAt: record.image.uploadedAt,
  };
}

function tryParseRecord(text: string): PersistedReceiptRecord | null {
  try {
    const parsed = JSON.parse(text) as Partial<PersistedReceiptRecord>;
    if (parsed?.schema !== "snap_tax_receipt_v1") return null;
    if (!parsed.id || !parsed.messageGuid || !parsed.chatId || !parsed.summary || !parsed.extraction || !parsed.processedAt) {
      return null;
    }
    return parsed as PersistedReceiptRecord;
  } catch {
    return null;
  }
}

async function listPersistedReceiptRecords(): Promise<PersistedReceiptRecord[]> {
  const cfg = getHydraConfig();
  const client = getClient();
  if (!cfg || !client) return [];

  await ensureTenant();

  const all: PersistedReceiptRecord[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await client.fetch.listData({
      tenant_id: cfg.tenantId,
      sub_tenant_id: cfg.subTenantId,
      kind: "memories",
      page,
      page_size: PAGE_SIZE,
    });

    if (!("user_memories" in response)) break;

    const userMemories = response.user_memories ?? [];
    for (const item of userMemories) {
      const parsed = tryParseRecord(item.memory_content);
      if (parsed) all.push(parsed);
    }

    if (!response.pagination?.has_next) break;
  }

  all.sort((a, b) => b.processedAt.localeCompare(a.processedAt));
  return all;
}

export async function persistProcessedReceipt(input: {
  messageGuid: string;
  chatId: string;
  summary: string;
  extraction: KimiImageExtraction;
  processedAt: string;
  image: {
    filename: string | null;
    mimeType: string;
    size: number;
    key: string;
    url: string;
    uploadedAt: string;
  } | null;
}): Promise<void> {
  const cfg = getHydraConfig();
  const client = getClient();
  if (!cfg || !client) return;

  await ensureTenant();

  const record: PersistedReceiptRecord = {
    schema: "snap_tax_receipt_v1",
    id: `receipt:${input.messageGuid}`,
    messageGuid: input.messageGuid,
    chatId: input.chatId,
    summary: input.summary,
    extraction: input.extraction,
    processedAt: input.processedAt,
    image: input.image,
  };

  const purchaseDate = input.extraction.receipt.purchaseDate ?? null;
  const titleDate =
    purchaseDate ??
    normalizeDateToMMDDYYYY(input.processedAt) ??
    input.processedAt.slice(0, 10);

  await client.upload.addMemory({
    tenant_id: cfg.tenantId,
    sub_tenant_id: cfg.subTenantId,
    upsert: true,
    memories: [
      {
        source_id: record.id,
        title: `Receipt ${titleDate}`,
        text: JSON.stringify(record),
        infer: false,
        tenant_metadata: JSON.stringify({
          app: "snap-tax",
          kind: "receipt_transaction",
          message_guid: input.messageGuid,
          chat_id: input.chatId,
          purchase_date: purchaseDate,
          processed_at: input.processedAt,
        }),
        document_metadata: JSON.stringify({
          merchant_name: input.extraction.receipt.merchantName ?? null,
          total: input.extraction.receipt.total ?? null,
          has_image: Boolean(input.image),
          mime_type: input.image?.mimeType ?? null,
        }),
      },
    ],
  });

  if (cachedMessageGuids) {
    cachedMessageGuids.values.add(input.messageGuid);
    cachedMessageGuids.expiresAtMs = Date.now() + MESSAGE_GUID_CACHE_TTL_MS;
  }
}

export async function listPersistedTransactions(): Promise<Transaction[]> {
  const records = await listPersistedReceiptRecords();
  return records.map(toTransaction);
}

export async function listPersistedReceiptImages(): Promise<ReceiptImageRecord[]> {
  const records = await listPersistedReceiptRecords();
  return records
    .map(toReceiptImage)
    .filter((value): value is ReceiptImageRecord => Boolean(value));
}

export async function listPersistedMessageGuids(): Promise<Set<string>> {
  if (cachedMessageGuids && cachedMessageGuids.expiresAtMs > Date.now()) {
    return new Set(cachedMessageGuids.values);
  }

  const records = await listPersistedReceiptRecords();
  const values = new Set(records.map((record) => record.messageGuid));
  cachedMessageGuids = {
    expiresAtMs: Date.now() + MESSAGE_GUID_CACHE_TTL_MS,
    values,
  };
  return new Set(values);
}

export async function hasPersistedMessageGuid(messageGuid: string): Promise<boolean> {
  if (!messageGuid.trim()) return false;
  const persistedGuids = await listPersistedMessageGuids();
  return persistedGuids.has(messageGuid.trim());
}

export function isHydraPersistenceEnabled(): boolean {
  return Boolean(getHydraConfig());
}

export async function askHydraReceiptQuestion(input: {
  question: string;
  maxChunks: number;
  mode: "fast" | "thinking";
  maxTokens: number;
  temperature: number;
}): Promise<{ answer: string; chunks: { id: string; sourceId: string; score: number | null }[] }> {
  const cfg = getHydraConfig();
  const client = getClient();
  if (!cfg || !client) {
    throw new Error("HydraDB is not configured.");
  }

  await ensureTenant();

  const question = input.question.trim();
  if (!question) {
    throw new Error("Question must be non-empty.");
  }

  const qna = await client.recall.qna({
    tenant_id: cfg.tenantId,
    sub_tenant_id: cfg.subTenantId,
    question,
    extra_context: [
      "You are answering a receipt/spending query for an end user.",
      "Return a concise final answer only.",
      "Do not include step-by-step reasoning, source walkthroughs, or phrases like 'from the given context'.",
      "Keep it under 4 short lines.",
      "If relevant, include one compact breakdown with totals.",
    ].join(" "),
    search_mode: "memories",
    mode: input.mode,
    max_chunks: input.maxChunks,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    alpha: 0.3,
  });

  const answer = qna.answer?.trim();
  if (!answer) {
    throw new Error("HydraDB did not return an answer.");
  }

  const chunks =
    qna.chunks?.map((chunk) => ({
      id: chunk.chunk_uuid,
      sourceId: chunk.source_id,
      score: chunk.relevancy_score ?? null,
    })) ?? [];

  return { answer, chunks };
}
