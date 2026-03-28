import { type Message } from "@photon-ai/imessage-kit";

import {
  isConfiguredReceiptMessage,
  isImageAttachment,
  processMessageReceipt,
} from "@/lib/receipt-processing";
import { getIMessageSDK } from "@/lib/imessage";

let watcherStarted = false;
let watcherStartPromise: Promise<void> | null = null;

function shouldProcessIncomingMessage(message: Message): boolean {
  if (message.isReaction) return false;
  if (!isConfiguredReceiptMessage(message)) return false;
  return message.attachments.some((att) => isImageAttachment(att));
}

export async function ensureReceiptWatcherStarted(): Promise<void> {
  if (watcherStarted) return;
  if (watcherStartPromise) return watcherStartPromise;

  watcherStartPromise = (async () => {
    const sdk = getIMessageSDK();

    await sdk.startWatching({
      onMessage: async (message) => {
        if (!shouldProcessIncomingMessage(message)) return;

        try {
          await processMessageReceipt({ sdk, message, reply: true });
        } catch (error) {
          console.error("[receipt-watcher] failed to process receipt:", error);
        }
      },
      onError: (error) => {
        console.error("[receipt-watcher] watcher error:", error);
      },
    });

    watcherStarted = true;
  })();

  try {
    await watcherStartPromise;
  } catch (error) {
    // Dev/HMR can re-run module init while SDK singleton already has a watcher.
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("watcher is already running")
    ) {
      watcherStarted = true;
      return;
    }

    watcherStartPromise = null;
    throw error;
  }
}
