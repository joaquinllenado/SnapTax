import { NextRequest, NextResponse } from "next/server";

import { createVerificationRequest } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { phone?: string };
    const phone = body.phone ?? "";

    const verification = createVerificationRequest(phone);

    return NextResponse.json({
      requestId: verification.requestId,
      phone: verification.phone,
      fluxNumber: verification.fluxNumber,
      code: verification.code,
      expiresAt: verification.expiresAt,
      instructions: `Send code "${verification.code}" to ${verification.fluxNumber} via iMessage.`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to request verification code.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
