"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Toaster, toast } from "sonner";
import { useTheme } from "@/components/ThemeProvider";

// ── Types ─────────────────────────────────────────────────────────────────────

type LineItem = {
  description: string;
  quantity?: string;
  unitPrice?: string;
  totalPrice?: string;
};

type ReceiptData = {
  merchantName?: string;
  merchantAddress?: string;
  receiptNumber?: string;
  purchaseDate?: string;
  currency?: string;
  subtotal?: string;
  tax?: string;
  tip?: string;
  total?: string;
  paymentMethod?: string;
  lineItems: LineItem[];
};

type Transaction = {
  id: string;
  merchantName: string | null;
  total: string | null;
  purchaseDate: string | null;
  processedAt: string;
  summary: string;
  receipt: ReceiptData;
};

type ProcessingStatus = {
  activeCount: number;
  lastProcessingStartedAt: string | null;
  lastProcessingFinishedAt: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val?: string | null) {
  return val?.trim() || "—";
}

function parseDollar(val?: string | null): number {
  if (!val) return 0;
  const n = parseFloat(val.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(amount);
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type Category = "food" | "travel" | "transport" | "shopping" | "health" | "other";

function getCategory(merchant?: string | null): Category {
  const m = (merchant ?? "").toLowerCase();
  if (/restaurant|cafe|coffee|burger|pizza|sushi|grill|diner|food|eat|bakery/.test(m)) return "food";
  if (/hotel|inn|motel|stay|resort|airline|flight|delta|united|southwest|airport/.test(m)) return "travel";
  if (/uber|lyft|taxi|ride|transit|gas|fuel|shell|chevron|exxon|bp/.test(m)) return "transport";
  if (/amazon|walmart|target|costco|store|market|shop/.test(m)) return "shopping";
  if (/pharmacy|cvs|walgreens|rite aid|med|health|clinic|doctor/.test(m)) return "health";
  return "other";
}

const CAT: Record<Category, { label: string; emoji: string; pill: string; darkPill: string; bar: string }> = {
  food:      { label: "Food & Dining", emoji: "🍽️", pill: "bg-orange-100 text-orange-700", darkPill: "dark:bg-orange-900/40 dark:text-orange-300", bar: "bg-orange-400" },
  travel:    { label: "Travel",        emoji: "✈️", pill: "bg-blue-100 text-blue-700",    darkPill: "dark:bg-blue-900/40 dark:text-blue-300",    bar: "bg-blue-400"   },
  transport: { label: "Transport",     emoji: "🚗", pill: "bg-yellow-100 text-yellow-700",darkPill: "dark:bg-yellow-900/40 dark:text-yellow-300", bar: "bg-yellow-400" },
  shopping:  { label: "Shopping",      emoji: "🛍️", pill: "bg-purple-100 text-purple-700",darkPill: "dark:bg-purple-900/40 dark:text-purple-300", bar: "bg-purple-400" },
  health:    { label: "Health",        emoji: "💊", pill: "bg-green-100 text-green-700",  darkPill: "dark:bg-green-900/40 dark:text-green-300",   bar: "bg-green-400"  },
  other:     { label: "Other",         emoji: "🧾", pill: "bg-zinc-100 text-zinc-600",    darkPill: "dark:bg-zinc-700 dark:text-zinc-300",        bar: "bg-zinc-400"   },
};

// ── Theme toggle ───────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
    >
      {theme === "dark" ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
        </svg>
      )}
    </button>
  );
}

// ── Processing badge ───────────────────────────────────────────────────────────

function ProcessingBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      Processing {count} receipt{count === 1 ? "" : "s"}…
    </div>
  );
}

// ── Receipt drawer ─────────────────────────────────────────────────────────────

function ReceiptDrawer({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const r = tx.receipt;
  const meta = CAT[getCategory(tx.merchantName)];
  const hasLineItems = r.lineItems && r.lineItems.length > 0;

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="flex-1 bg-black/20 dark:bg-black/50 backdrop-blur-sm" />
      <div
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 px-6 py-4 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg ${meta.pill} ${meta.darkPill}`}>
              {meta.emoji}
            </span>
            <div>
              <p className="font-semibold leading-tight text-zinc-900 dark:text-zinc-100">{tx.merchantName ?? "Unknown merchant"}</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{meta.label}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 dark:text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 p-6">
          {/* Key fields */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Total",   value: tx.total ?? "—",       big: true },
              { label: "Tax",     value: fmt(r.tax),             big: true },
              { label: "Date",    value: fmt(tx.purchaseDate),   big: false },
              { label: "Payment", value: fmt(r.paymentMethod),   big: false },
            ].map((f) => (
              <div key={f.label} className="rounded-xl bg-zinc-50 dark:bg-zinc-800 p-3">
                <p className="mb-1 text-xs text-zinc-400 dark:text-zinc-500">{f.label}</p>
                <p className={`font-bold text-zinc-900 dark:text-zinc-100 ${f.big ? "text-xl" : "text-sm"}`}>{f.value}</p>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Summary</p>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{tx.summary}</p>
          </div>

          {/* Line items */}
          {hasLineItems && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Line Items</p>
              <div className="overflow-hidden rounded-xl border border-zinc-100 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-800">
                    <tr className="text-left text-xs font-medium text-zinc-400 dark:text-zinc-500">
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {r.lineItems.map((item, i) => (
                      <tr key={i} className="text-zinc-700 dark:text-zinc-300">
                        <td className="px-3 py-2">{item.description}</td>
                        <td className="px-3 py-2 text-right text-zinc-400 dark:text-zinc-500">{fmt(item.quantity)}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmt(item.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Totals */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Breakdown</p>
            <div className="space-y-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800 p-4 text-sm">
              {r.subtotal && (
                <div className="flex justify-between text-zinc-500 dark:text-zinc-400"><span>Subtotal</span><span>{r.subtotal}</span></div>
              )}
              {r.tax && (
                <div className="flex justify-between text-zinc-500 dark:text-zinc-400"><span>Tax</span><span>{r.tax}</span></div>
              )}
              {r.tip && (
                <div className="flex justify-between text-zinc-500 dark:text-zinc-400"><span>Tip</span><span>{r.tip}</span></div>
              )}
              <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold text-zinc-900 dark:text-zinc-100">
                <span>Total</span><span>{fmt(r.total)}</span>
              </div>
            </div>
          </div>

          {/* Meta */}
          <div className="space-y-1 rounded-xl bg-zinc-50 dark:bg-zinc-800 p-3 text-xs text-zinc-400 dark:text-zinc-500">
            {r.merchantAddress && <p>📍 {r.merchantAddress}</p>}
            {r.receiptNumber && <p># Receipt {r.receiptNumber}</p>}
            <p>🕒 Logged {relativeTime(tx.processedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const router = useRouter();

  const [sessionPhone, setSessionPhone] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [replyWithAnalysis, setReplyWithAnalysis] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [query, setQuery] = useState("");
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryAnswer, setQueryAnswer] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [receiptsOpen, setReceiptsOpen] = useState(true);
  const [showAllReceipts, setShowAllReceipts] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    activeCount: 0,
    lastProcessingStartedAt: null,
    lastProcessingFinishedAt: null,
  });

  const loadTransactions = useCallback(async (silent = true) => {
    try {
      const res = await fetch("/api/transactions", { cache: "no-store" });
      const json = (await res.json()) as { transactions: Transaction[] };
      const sorted = (json.transactions ?? []).sort((a, b) => {
        const da = a.purchaseDate ? new Date(a.purchaseDate).getTime() : new Date(a.processedAt).getTime();
        const db = b.purchaseDate ? new Date(b.purchaseDate).getTime() : new Date(b.processedAt).getTime();
        return db - da;
      });
      setTransactions(sorted);
    } catch {
      if (!silent) toast.error("Failed to load transactions.");
    } finally {
      setInitialLoad(false);
    }
  }, []);

  const loadProcessingStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/processing-status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as ProcessingStatus;
      setProcessingStatus({
        activeCount: Number.isFinite(json.activeCount) ? Math.max(0, json.activeCount) : 0,
        lastProcessingStartedAt: json.lastProcessingStartedAt ?? null,
        lastProcessingFinishedAt: json.lastProcessingFinishedAt ?? null,
      });
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { authenticated: boolean; phone?: string }) => {
        if (!json.authenticated) router.replace("/login");
        else {
          setSessionPhone(json.phone ?? null);
          void loadTransactions(false);
          void loadProcessingStatus();
        }
      })
      .catch(() => router.replace("/login"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadTransactions();
      void loadProcessingStatus();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loadTransactions, loadProcessingStatus]);

  const analyzeLatestImage = async () => {
    setLoading(true);
    const toastId = toast.loading("Processing receipt…", { position: "top-center" });
    try {
      const res = await fetch("/api/imessage/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: replyWithAnalysis }),
      });
      const json = (await res.json()) as {
        error?: string;
        replied?: boolean;
        configuredPhone?: string;
        uploadWarning?: string | null;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to analyze image.");
      toast.success(
        json.replied
          ? `Receipt processed · Confirmation sent to ${json.configuredPhone ?? "your phone"}`
          : "Receipt processed successfully",
        { id: toastId, position: "top-center", duration: 4000 }
      );
      if (json.uploadWarning) toast.warning(`Upload warning: ${json.uploadWarning}`, { position: "top-center" });
      void loadTransactions();
      void loadProcessingStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unexpected error.", { id: toastId, position: "top-center" });
      void loadProcessingStatus();
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  const askQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setQueryLoading(true);
    setQueryAnswer(null);
    setQueryError(null);
    try {
      const res = await fetch("/api/imessage/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageText: q, hasImageAttachment: false }),
      });
      const json = (await res.json()) as {
        answer?: string;
        error?: string;
        guardrails?: { accepted: boolean; reason?: string };
        route?: string;
        hint?: string;
      };
      if (!res.ok) {
        if (json.guardrails?.accepted === false) {
          setQueryError("This question was outside the scope of your receipt data. Try asking about spending, totals, or specific merchants.");
        } else if (res.status === 503) {
          setQueryError(json.hint ?? json.error ?? "Query service unavailable.");
        } else {
          setQueryError(json.error ?? "Something went wrong.");
        }
      } else {
        setQueryAnswer(json.answer ?? "No answer returned.");
      }
    } catch {
      setQueryError("Network error. Please try again.");
    } finally {
      setQueryLoading(false);
    }
  };

  // ── Derived stats ──────────────────────────────────────────────────────────

  const totalSpend = transactions.reduce((acc, tx) => acc + parseDollar(tx.total), 0);
  const totalTax   = transactions.reduce((acc, tx) => acc + parseDollar(tx.receipt.tax), 0);
  const avgTx      = transactions.length > 0 ? totalSpend / transactions.length : 0;

  const now = new Date();
  const monthlySpend = transactions
    .filter((tx) => {
      const d = tx.purchaseDate ? new Date(tx.purchaseDate) : new Date(tx.processedAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((acc, tx) => acc + parseDollar(tx.total), 0);

  const categoryTotals = transactions.reduce<Record<Category, number>>((acc, tx) => {
    const cat = getCategory(tx.merchantName);
    acc[cat] = (acc[cat] ?? 0) + parseDollar(tx.total);
    return acc;
  }, {} as Record<Category, number>);

  const topCategories = (Object.entries(categoryTotals) as [Category, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentCount = transactions.filter((tx) => {
    const d = tx.purchaseDate ? new Date(tx.purchaseDate) : new Date(tx.processedAt);
    return d.getTime() > thirtyDaysAgo;
  }).length;

  const filtered = transactions.filter((tx) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (tx.merchantName ?? "").toLowerCase().includes(q) ||
      (tx.purchaseDate ?? "").includes(q) ||
      (tx.total ?? "").includes(q) ||
      tx.summary.toLowerCase().includes(q)
    );
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Toaster richColors closeButton theme="system" />
      {selectedTx && <ReceiptDrawer tx={selectedTx} onClose={() => setSelectedTx(null)} />}

      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">

        {/* Nav */}
        <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-[200px] overflow-hidden sm:h-14 sm:w-[250px]">
                <Image
                  src="/snaptax-dashboard-logo.png"
                  alt="SnapTax dashboard logo"
                  width={470}
                  height={92}
                  className="h-full w-full origin-left scale-[1.18] object-cover object-left dark:invert"
                  priority
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ProcessingBadge count={processingStatus.activeCount} />
              {sessionPhone && <span className="hidden text-xs text-zinc-400 dark:text-zinc-500 sm:block">{sessionPhone}</span>}
              <ThemeToggle />
              <button
                type="button"
                onClick={logout}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-6 py-8">

          {/* ══ LEFT: main ══════════════════════════════════════════════════ */}
          <div className="flex min-w-0 flex-1 flex-col gap-6">

            {/* Page title */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Dashboard</h1>
                <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                  {transactions.length} receipt{transactions.length === 1 ? "" : "s"} logged
                  {sessionPhone ? ` · ${sessionPhone}` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => void analyzeLatestImage()}
                className="flex items-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-white dark:text-zinc-900 shadow-sm transition-colors hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50"
              >
                <span>⚡</span>
                {loading ? "Processing…" : "Re-process receipt"}
              </button>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Total logged",  value: formatCurrency(totalSpend),                                        sub: `${transactions.length} receipts`,  icon: "💰" },
                { label: "This month",    value: formatCurrency(monthlySpend),                                      sub: now.toLocaleString("default", { month: "long", year: "numeric" }), icon: "📅" },
                { label: "Total tax",     value: formatCurrency(totalTax),                                          sub: "deductible estimate",               icon: "🏛️" },
                { label: "Avg receipt",   value: transactions.length > 0 ? formatCurrency(avgTx) : "—",            sub: "per transaction",                    icon: "📊" },
              ].map((c) => (
                <div key={c.label} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-widest text-zinc-400 dark:text-zinc-500">{c.label}</p>
                    <span>{c.icon}</span>
                  </div>
                  <p className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{c.value}</p>
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{c.sub}</p>
                </div>
              ))}
            </div>

            {/* Category chips */}
            {topCategories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {topCategories.map(([cat, amt]) => {
                  const m = CAT[cat];
                  const pct = totalSpend > 0 ? Math.round((amt / totalSpend) * 100) : 0;
                  return (
                    <div key={cat} className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-medium shadow-sm">
                      <span>{m.emoji}</span>
                      <span className="text-zinc-600 dark:text-zinc-400">{m.label}</span>
                      <span className="text-zinc-400 dark:text-zinc-500">{pct}%</span>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">{formatCurrency(amt)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Ask panel ─────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
              <div className="border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Ask about your receipts</p>
                <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">Query your spending data in plain English</p>
              </div>
              <form onSubmit={(e) => void askQuery(e)} className="flex items-center gap-3 px-5 py-4">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="How much did I spend on food last month?"
                  className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
                />
                <button
                  type="submit"
                  disabled={queryLoading || !query.trim()}
                  className="shrink-0 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-white dark:text-zinc-900 transition-colors hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40"
                >
                  {queryLoading ? "Thinking…" : "Ask"}
                </button>
              </form>

              {/* Answer */}
              {queryAnswer && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-base">🤖</span>
                    <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{queryAnswer}</p>
                  </div>
                </div>
              )}

              {/* Error */}
              {queryError && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-base">⚠️</span>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{queryError}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Receipts table */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">

              {/* Table toolbar */}
              <div className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setReceiptsOpen((o) => !o)}
                  className="flex flex-1 items-center gap-2 text-left"
                  aria-expanded={receiptsOpen}
                >
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recent Receipts</h2>
                  <svg
                    xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className={`text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${receiptsOpen ? "rotate-0" : "-rotate-90"}`}
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
                <div className="relative">
                  <input
                    type="search"
                    placeholder="Search…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-44 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 py-1.5 pl-7 pr-3 text-xs text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
                  />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 dark:text-zinc-500">🔍</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadTransactions(false)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Refresh
                </button>
              </div>

              {/* Collapsible body */}
              {receiptsOpen && (
                <>
                  {/* Column headers */}
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_16px] gap-4 border-b border-zinc-100 dark:border-zinc-800 px-5 py-2.5 text-xs font-medium uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                    <span>Merchant</span>
                    <span>Date</span>
                    <span>Category</span>
                    <span className="text-right">Amount</span>
                    <span />
                  </div>

                  {/* Rows */}
                  {initialLoad ? (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_16px] gap-4 px-5 py-4">
                          <div className="h-4 w-32 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                          <div className="h-4 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                          <div className="h-4 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                          <div className="ml-auto h-4 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                          <div className="h-4 w-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                        </div>
                      ))}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <p className="mb-2 text-2xl">🧾</p>
                      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                        {search ? "No receipts match your search." : "No receipts logged yet."}
                      </p>
                      {!search && (
                        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Send a receipt image to your number to get started.</p>
                      )}
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {(showAllReceipts ? filtered : filtered.slice(0, 5)).map((tx) => {
                        const cat = getCategory(tx.merchantName);
                        const m = CAT[cat];
                        return (
                          <button
                            key={tx.id}
                            type="button"
                            onClick={() => setSelectedTx(tx)}
                            className="grid w-full grid-cols-[2fr_1fr_1fr_1fr_16px] items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm ${m.pill} ${m.darkPill}`}>
                                {m.emoji}
                              </span>
                              <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {tx.merchantName ?? "Unknown merchant"}
                              </span>
                            </div>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">{tx.purchaseDate ?? "—"}</span>
                            <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${m.pill} ${m.darkPill}`}>
                              {m.label}
                            </span>
                            <span className="text-right text-sm font-semibold text-zinc-900 dark:text-zinc-100">{tx.total ?? "—"}</span>
                            <span className="text-xs text-zinc-300 dark:text-zinc-600">›</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Footer */}
                  {!initialLoad && filtered.length > 0 && (
                    <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 px-5 py-3">
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {search
                          ? `${filtered.length} of ${transactions.length} receipts`
                          : `${transactions.length} total · ${recentCount} in the last 30 days`}
                      </span>
                      {filtered.length > 5 && (
                        <button
                          type="button"
                          onClick={() => setShowAllReceipts((v) => !v)}
                          className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                        >
                          {showAllReceipts ? "Show less" : `Show all ${filtered.length}`}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* iMessage config strip */}
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-3.5 shadow-sm">
              <p className="min-w-0 flex-1 text-xs text-zinc-400 dark:text-zinc-500">
                Auto-processed every 5 s · manually trigger re-processing above
              </p>
              <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={replyWithAnalysis}
                  onChange={(e) => setReplyWithAnalysis(e.target.checked)}
                  className="rounded accent-zinc-900 dark:accent-zinc-100"
                />
                Reply via iMessage
              </label>
            </div>
          </div>

          {/* ══ RIGHT: sidebar ══════════════════════════════════════════════ */}
          <aside className="hidden w-72 shrink-0 flex-col gap-5 lg:flex">

            {/* Spend summary */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Spend Summary</p>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{now.getFullYear()}</span>
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">Total logged</p>
              <p className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{formatCurrency(totalSpend)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 p-3">
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">Tax</p>
                  <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{formatCurrency(totalTax)}</p>
                </div>
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 p-3">
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">This month</p>
                  <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{formatCurrency(monthlySpend)}</p>
                </div>
              </div>
            </div>

            {/* Category breakdown */}
            {topCategories.length > 0 && (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
                <p className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">By Category</p>
                <div className="space-y-3">
                  {topCategories.map(([cat, amt]) => {
                    const m = CAT[cat];
                    const pct = totalSpend > 0 ? (amt / totalSpend) * 100 : 0;
                    return (
                      <div key={cat}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                            <span>{m.emoji}</span> {m.label}
                          </span>
                          <span className="text-zinc-500 dark:text-zinc-400">{formatCurrency(amt)}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${m.bar}`}
                            style={{ width: `${pct.toFixed(1)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex gap-3 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                  <div className="flex-1 text-center">
                    <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{transactions.length}</p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">Receipts</p>
                  </div>
                  <div className="flex-1 text-center">
                    <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{recentCount}</p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">Last 30 days</p>
                  </div>
                  <div className="flex-1 text-center">
                    <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{topCategories.length}</p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">Categories</p>
                  </div>
                </div>
              </div>
            )}

            {/* Processing status */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Processing</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-xl bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Status</span>
                  <span className={`text-xs font-semibold ${processingStatus.activeCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {processingStatus.activeCount > 0 ? `${processingStatus.activeCount} running` : "Idle"}
                  </span>
                </div>
                {processingStatus.lastProcessingFinishedAt && (
                  <div className="flex items-center justify-between rounded-xl bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Last completed</span>
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {relativeTime(processingStatus.lastProcessingFinishedAt)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-xl bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Auto-refresh</span>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">every 5 s</span>
                </div>
              </div>
            </div>

          </aside>
        </div>
      </div>
    </>
  );
}
