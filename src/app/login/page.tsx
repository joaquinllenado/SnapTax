"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type RequestCodeResponse = {
  requestId: string;
  phone: string;
  fluxNumber: string;
  code: string;
  expiresAt: number;
  instructions: string;
};

export default function LoginPage() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [requestId, setRequestId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verification, setVerification] = useState<RequestCodeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");

  // If already authenticated, go straight to transactions
  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { authenticated: boolean }) => {
        if (json.authenticated) router.replace("/transactions");
      })
      .catch(() => undefined);
  }, [router]);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = (await res.json()) as RequestCodeResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to request code.");

      setVerification(json);
      setRequestId(json.requestId);
      setStep("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, code: verificationCode }),
      });
      const json = (await res.json()) as { error?: string; phone?: string };
      if (!res.ok) throw new Error(json.error ?? "Verification failed.");

      router.replace("/transactions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <Image
            src="/snaptax-app-logo.png"
            alt="Snap Tax logo"
            width={64}
            height={64}
            className="mx-auto mb-3 h-16 w-16 dark:invert"
            priority
          />
          <h1 className="text-2xl font-bold text-zinc-900">Snap Tax</h1>
          <p className="mt-1 text-sm text-zinc-500">Sign in with your phone number</p>
        </div>

        {step === "request" ? (
          <form onSubmit={requestCode} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
              Phone number
              <input
                type="tel"
                placeholder="+15551234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                required
              />
            </label>
            <button
              type="submit"
              disabled={loading || !phone.trim()}
              className="rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Sending…" : "Send verification code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="flex flex-col gap-4">
            {verification && (
              <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                <p className="font-semibold">{verification.instructions}</p>
                <p className="mt-1">
                  Demo code:{" "}
                  <span className="font-mono font-bold">{verification.code}</span>
                </p>
              </div>
            )}
            <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
              Verification code
              <input
                type="text"
                placeholder="Enter code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                required
              />
            </label>
            <button
              type="submit"
              disabled={loading || !verificationCode.trim()}
              className="rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {loading ? "Verifying…" : "Verify & sign in"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("request"); setError(""); }}
              className="text-xs text-zinc-500 hover:text-zinc-700 underline"
            >
              ← Use a different number
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
