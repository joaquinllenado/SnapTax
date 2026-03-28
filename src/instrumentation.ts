export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { ensureReceiptWatcherStarted } = await import("@/lib/receipt-watcher");
    await ensureReceiptWatcherStarted();
  } catch (error) {
    console.error("[instrumentation] failed to start receipt watcher:", error);
  }
}
