import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/imessage";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

function getR2BaseUrl(): string | null {
  const raw = process.env.R2_BUCKET_URL?.trim();
  if (!raw) return null;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isHeicMime(mimeType: string | null): boolean {
  if (!mimeType) return false;
  const mime = mimeType.toLowerCase();
  return mime.includes("heic") || mime.includes("heif");
}

async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inputPath = join(tmpdir(), `${id}.heic`);
  const outputPath = join(tmpdir(), `${id}.jpg`);

  await fs.writeFile(inputPath, buffer);

  try {
    await execFileAsync("/usr/bin/sips", ["-s", "format", "jpeg", inputPath, "--out", outputPath]);
    return await fs.readFile(outputPath);
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key")?.trim() || "";
  const mimeType = request.nextUrl.searchParams.get("mimeType")?.trim() || null;

  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const baseUrl = getR2BaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ error: "R2_BUCKET_URL is not configured" }, { status: 500 });
  }

  const objectUrl = `${baseUrl}/${encodeKeyPath(key)}`;

  if (!isHeicMime(mimeType)) {
    return NextResponse.redirect(objectUrl);
  }

  const upstream = await fetch(objectUrl, { cache: "no-store" });
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Failed to fetch source image (${upstream.status})`, details: body || null },
      { status: 502 },
    );
  }

  const sourceBuffer = Buffer.from(await upstream.arrayBuffer());

  try {
    const jpeg = await convertHeicToJpeg(sourceBuffer);
    return new NextResponse(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.redirect(objectUrl);
  }
}
