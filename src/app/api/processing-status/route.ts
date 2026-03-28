import { NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/imessage";
import { getReceiptProcessingSnapshot } from "@/lib/receipt-processing";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(getReceiptProcessingSnapshot());
}
