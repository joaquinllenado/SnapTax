import { NextRequest, NextResponse } from "next/server";

import { listPersistedReceiptImages } from "@/lib/hydradb-receipts";
import { getSessionFromRequest } from "@/lib/imessage";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const images = await listPersistedReceiptImages();
    return NextResponse.json({ images });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load receipt images from HydraDB.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
