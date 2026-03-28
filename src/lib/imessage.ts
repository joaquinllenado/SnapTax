import { IMessageSDK } from "@photon-ai/imessage-kit";
import { NextRequest } from "next/server";

import { getSessionByToken, SESSION_COOKIE_NAME } from "@/lib/auth";

let sdkInstance: IMessageSDK | null = null;

export function getIMessageSDK(): IMessageSDK {
  if (!sdkInstance) {
    sdkInstance = new IMessageSDK({
      debug: process.env.NODE_ENV !== "production",
      watcher: {
        // Allow self-sent messages (needed when testing by texting yourself)
        excludeOwnMessages: false,
      },
    });
  }

  return sdkInstance;
}

export function getSessionFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return getSessionByToken(token);
}
