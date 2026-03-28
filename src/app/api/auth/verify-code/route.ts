import { NextRequest, NextResponse } from "next/server";

import {
  getSessionMaxAgeSeconds,
  SESSION_COOKIE_NAME,
  verifyCodeAndCreateSession,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { requestId?: string; code?: string };
    const requestId = body.requestId ?? "";
    const code = body.code ?? "";

    const session = verifyCodeAndCreateSession(requestId, code);
    const response = NextResponse.json({
      success: true,
      phone: session.phone,
      expiresAt: session.expiresAt,
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: session.token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: getSessionMaxAgeSeconds(),
    });

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to verify code.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
