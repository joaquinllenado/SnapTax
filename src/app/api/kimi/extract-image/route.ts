import { NextRequest, NextResponse } from "next/server";

import { extractImageDataWithKimi } from "@/app/api/agents/kimi-agent";

type Body = {
  imageData?: string;
  mimeType?: string;
  prompt?: string;
  model?: string;
};

function parseImageData(raw: string): { base64: string; mimeType: string } {
  const trimmed = raw.trim();
  const dataUrl = trimmed.match(/^data:(.+?);base64,(.+)$/);
  if (dataUrl) {
    return { mimeType: dataUrl[1], base64: dataUrl[2] };
  }

  return { mimeType: "image/jpeg", base64: trimmed };
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageData = body.imageData?.trim();
  if (!imageData) {
    return NextResponse.json(
      { error: 'Body must include non-empty "imageData" (base64 or data URL).' },
      { status: 400 },
    );
  }

  const parsed = parseImageData(imageData);
  const mimeType = body.mimeType?.trim() || parsed.mimeType;

  try {
    const extraction = await extractImageDataWithKimi({
      base64: parsed.base64,
      mimeType,
      userPrompt: body.prompt ?? null,
      modelOverride: body.model,
    });

    return NextResponse.json({ extraction });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extract image data.";

    return NextResponse.json(
      {
        error: message,
        hint: "Set KIMI_API_KEY (or GMI_API_KEY), optionally KIMI_BASE_URL and KIMI_MODEL (for example kimi-k2-5).",
      },
      { status: 500 },
    );
  }
}
