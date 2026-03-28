import { NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/imessage";
import { ensureReceiptWatcherStarted } from "@/lib/receipt-watcher";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    await ensureReceiptWatcherStarted();
  } catch (error) {
    console.warn("[auth/session] watcher startup failed:", error);
  }

  return NextResponse.json({
    authenticated: true,
    phone: session.phone,
    expiresAt: session.expiresAt,
  });
}
