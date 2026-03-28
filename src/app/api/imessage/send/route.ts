import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getIMessageSDK, getSessionFromRequest } from "@/lib/imessage";

type JsonBody = {
  to?: string;
  text?: string;
  /** Raw base64 (no data: prefix). */
  imageBase64?: string;
  imageMimeType?: string;
};

async function writeTempImage(
  base64: string,
  mimeType: string,
): Promise<string> {
  const ext =
    mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const filePath = path.join(
    os.tmpdir(),
    `snap-tax-imsg-${randomUUID()}.${ext}`,
  );
  await writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const tempFiles: string[] = [];

  let to = "";
  let text: string | undefined;
  const imagePaths: string[] = [];

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      to = String(form.get("to") ?? "").trim();
      const textRaw = String(form.get("text") ?? "").trim();
      text = textRaw.length > 0 ? textRaw : undefined;
      const file = form.get("image");
      if (file instanceof File && file.size > 0) {
        const buf = Buffer.from(await file.arrayBuffer());
        const safeName = file.name.replace(/[^\w.-]+/g, "_") || "upload";
        const filePath = path.join(
          os.tmpdir(),
          `snap-tax-imsg-${randomUUID()}-${safeName}`,
        );
        await writeFile(filePath, buf);
        tempFiles.push(filePath);
        imagePaths.push(filePath);
      }
    } else {
      const body = (await request.json()) as JsonBody;
      to = body.to?.trim() ?? "";
      const t = body.text?.trim() ?? "";
      text = t.length > 0 ? t : undefined;

      if (body.imageBase64?.trim()) {
        const mime = body.imageMimeType?.trim() || "image/jpeg";
        const p = await writeTempImage(body.imageBase64.trim(), mime);
        tempFiles.push(p);
        imagePaths.push(p);
      }
    }

    if (!to) {
      return NextResponse.json({ error: '"to" is required.' }, { status: 400 });
    }

    if (!text && imagePaths.length === 0) {
      return NextResponse.json(
        { error: "Provide message text and/or an image." },
        { status: 400 },
      );
    }

    const sdk = getIMessageSDK();

    let result: { sentAt: Date };
    if (imagePaths.length > 0) {
      result = await sdk.send(to, {
        text: text ?? " ",
        images: imagePaths,
      });
    } else {
      result = await sdk.send(to, text!);
    }

    return NextResponse.json({
      success: true,
      sentAt: result.sentAt,
      to,
      text: text ?? null,
      hadImage: imagePaths.length > 0,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send iMessage.";

    return NextResponse.json(
      {
        error: message,
        hint: "Ensure Messages is running, Full Disk Access is granted, and paths/attachments are valid.",
      },
      { status: 500 },
    );
  } finally {
    await Promise.all(
      tempFiles.map((p) => unlink(p).catch(() => undefined)),
    );
  }
}
