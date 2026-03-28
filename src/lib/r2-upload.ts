import { createHash, createHmac, randomUUID } from "node:crypto";

function getR2BaseUrl(): string | null {
  const raw = process.env.R2_BUCKET_URL?.trim();
  if (!raw) return null;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function getS3ApiUrl(): string | null {
  const raw = process.env.S3_API_URL?.trim();
  if (!raw) return null;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function buildUploadUrl(s3ApiUrl: string | null, key: string): string | null {
  if (!s3ApiUrl) return null;
  if (s3ApiUrl.includes("{key}")) {
    return s3ApiUrl.replaceAll("{key}", encodeURIComponent(key));
  }
  return `${s3ApiUrl}/${encodeKeyPath(key)}`;
}

function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function canonicalUriFromUrl(url: URL): string {
  const segments = url.pathname.split("/").map((segment) => {
    try {
      return encodeURIComponent(decodeURIComponent(segment));
    } catch {
      return encodeURIComponent(segment);
    }
  });
  return segments.join("/") || "/";
}

function canonicalQueryString(url: URL): string {
  const pairs = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([aKey, aVal], [bKey, bVal]) => {
      if (aKey === bKey) return aVal.localeCompare(bVal);
      return aKey.localeCompare(bKey);
    });
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function signR2Request(input: {
  url: string;
  method: string;
  contentType: string;
  body: Buffer;
}): Record<string, string> | null {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? process.env.AWS_ACCESS_KEY_ID?.trim() ?? null;
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY?.trim() ?? process.env.AWS_SECRET_ACCESS_KEY?.trim() ?? null;
  if (!accessKeyId || !secretAccessKey) return null;

  const region = process.env.R2_REGION?.trim() || process.env.AWS_REGION?.trim() || "auto";
  const service = "s3";
  const parsed = new URL(input.url);
  const host = parsed.host;
  const canonicalUri = canonicalUriFromUrl(parsed);
  const canonicalQuery = canonicalQueryString(parsed);
  const payloadHash = sha256Hex(input.body);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const sessionToken = process.env.R2_SESSION_TOKEN?.trim() ?? process.env.AWS_SESSION_TOKEN?.trim() ?? null;

  const canonicalHeaders = [
    `content-type:${input.contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    ...(sessionToken ? [`x-amz-security-token:${sessionToken}`] : []),
  ].join("\n");

  const signedHeaders = ["content-type", "host", "x-amz-content-sha256", "x-amz-date"]
    .concat(sessionToken ? ["x-amz-security-token"] : [])
    .join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const cause = error.cause as { code?: string } | undefined;
  const code = cause?.code ?? "";
  if (["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes("fetch failed") || message.includes("network");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extensionForMimeType(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";
  if (mime.includes("bmp")) return "bmp";
  if (mime.includes("tiff")) return "tiff";
  return "jpg";
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

export async function uploadReceiptImageToR2(input: {
  buffer: Buffer;
  mimeType: string;
  messageGuid: string;
  filename: string | null;
}): Promise<{ key: string; url: string } | null> {
  const s3ApiUrl = getS3ApiUrl();
  const baseUrl = getR2BaseUrl();
  const directUploadUrl = buildUploadUrl(s3ApiUrl, "");
  if (!baseUrl && !directUploadUrl) return null;

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const ext = extensionForMimeType(input.mimeType);
  const safeName = input.filename ? sanitizeFilename(input.filename) : null;
  const suffix = safeName ? `-${safeName}` : `.${ext}`;
  const key = `receipts/${yyyy}/${mm}/${dd}/${Date.now()}-${input.messageGuid}-${randomUUID()}${suffix}`;
  const uploadUrl = buildUploadUrl(s3ApiUrl, key) ?? `${baseUrl}/${key}`;

  const token =
    process.env.S3_API_TOKEN?.trim() ??
    process.env.R2_API_TOKEN?.trim() ??
    null;
  const headers: Record<string, string> = {
    "Content-Type": input.mimeType,
  };
  const signedHeaders = signR2Request({
    url: uploadUrl,
    method: "PUT",
    contentType: input.mimeType,
    body: input.buffer,
  });
  if (signedHeaders) {
    Object.assign(headers, signedHeaders);
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (s3ApiUrl?.includes(".r2.cloudflarestorage.com")) {
    throw new Error(
      "R2 upload credentials missing. Set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY).",
    );
  }

  const maxAttempts = 4;
  let lastNetworkError: unknown = null;
  let res: Response | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      res = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body: new Uint8Array(input.buffer),
      });
    } catch (error) {
      lastNetworkError = error;
      if (!isRetryableNetworkError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(250 * 2 ** (attempt - 1));
      continue;
    }

    if (res.ok) break;

    if (isRetryableStatus(res.status) && attempt < maxAttempts) {
      await sleep(250 * 2 ** (attempt - 1));
      continue;
    }

    break;
  }

  if (!res) {
    throw lastNetworkError instanceof Error ? lastNetworkError : new Error("R2 upload failed: network error.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`R2 upload failed (${res.status}): ${body || "unknown error"}`);
  }

  let resolvedPublicUrl: string | null = null;
  try {
    const parsed = (await res.clone().json()) as { url?: string; publicUrl?: string };
    resolvedPublicUrl = parsed.publicUrl ?? parsed.url ?? null;
  } catch {
    resolvedPublicUrl = null;
  }

  const url = resolvedPublicUrl ?? (baseUrl ? `${baseUrl}/${key}` : uploadUrl);
  return { key, url };
}
