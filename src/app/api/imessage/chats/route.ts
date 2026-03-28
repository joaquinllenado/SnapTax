import { NextRequest, NextResponse } from "next/server";

import { getIMessageSDK, getSessionFromRequest } from "@/lib/imessage";
import { RECEIPT_PHONE_NUMBER } from "@/lib/receipt-processing";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sdk = getIMessageSDK();
    const chats = await sdk.listChats({ sortBy: "recent", limit: 50 });
    const target =
      chats.find((chat) => chat.chatId.includes(RECEIPT_PHONE_NUMBER)) ?? null;

    const onlyReceiptChat = target
      ? [target]
      : [
          {
            chatId: RECEIPT_PHONE_NUMBER,
            displayName: RECEIPT_PHONE_NUMBER,
            isGroup: false,
            unreadCount: 0,
            lastMessageAt: null,
          },
        ];

    return NextResponse.json({
      chats: onlyReceiptChat.map((chat) => ({
        chatId: chat.chatId,
        displayName: chat.displayName,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        lastMessageAt: chat.lastMessageAt
          ? chat.lastMessageAt.toISOString()
          : null,
      })),
      configuredPhone: RECEIPT_PHONE_NUMBER,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list iMessage chats.";

    return NextResponse.json(
      {
        error: message,
        hint: "Ensure this app has Full Disk Access on macOS and iMessage is available.",
      },
      { status: 500 },
    );
  }
}
