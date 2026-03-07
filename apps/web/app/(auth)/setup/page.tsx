"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { setup, login, getAuthStatus } from "@/lib/api";

type Step = "loading" | "generating" | "qr" | "done";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    getAuthStatus().then((res) => {
      if (!res.ok) return;
      if (res.data.setupComplete) {
        router.replace("/login");
        return;
      }
      setStep("generating");
    });
  }, [router]);

  useEffect(() => {
    if (step !== "generating") return;
    setup().then((res) => {
      if (!res.ok) { setError(res.error.message); return; }
      setQrDataUrl(res.data.qrDataUrl);
      setSecret(res.data.secret);
      setStep("qr");
    });
  }, [step]);

  const token = digits.join("");

  const handleInput = (i: number, value: string) => {
    const v = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 5) inputRefs.current[i + 1]?.focus();
    if (!v && i > 0) inputRefs.current[i - 1]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (token.length !== 6) return;
    setError(null);
    setLoading(true);
    const res = await login(token);
    setLoading(false);
    if (res.ok) {
      setStep("done");
      setTimeout(() => router.replace("/dashboard"), 800);
    } else {
      setError("Invalid code — try again");
      setDigits(Array(6).fill(""));
      inputRefs.current[0]?.focus();
    }
  };

  if (step === "loading" || step === "generating") {
    return (
      <div className="flex flex-col items-center gap-3 text-neutral-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-orange-500" />
        <span className="text-sm">Setting up…</span>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="animate-fade-in-up flex flex-col items-center gap-3">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
          style={{ background: "linear-gradient(135deg, #064e3b 0%, #065f46 100%)", boxShadow: "0 0 32px rgba(16,185,129,0.35)" }}
        >
          ✓
        </div>
        <p className="text-sm font-semibold text-emerald-400">Setup complete. Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up mx-4 flex w-full max-w-md flex-col items-center gap-5">
      {/* Brand above card */}
      <div className="flex flex-col items-center gap-2">
        <Image
          src="/logo.png"
          alt="LetMeCook logo"
          width={64}
          height={64}
          className="h-16 w-16 object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.5)]"
          priority
        />
        <h1 className="text-xl font-bold tracking-tight" style={{ background: "linear-gradient(135deg, #fff 30%, #fdba74)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Setup LetMeCook
        </h1>
        <p className="text-xs text-neutral-500">One-time authenticator configuration</p>
      </div>

      <div className="gb-card w-full">
        <div className="gb-inner noise px-8 py-8">
          {/* QR code */}
          <div className="mb-5 flex justify-center">
            {qrDataUrl && (
              <div className="rounded-xl p-2.5" style={{ background: "#fff", boxShadow: "0 0 0 1px rgba(255,255,255,0.1), 0 8px 32px rgba(0,0,0,0.5)" }}>
                <Image src={qrDataUrl} alt="TOTP QR code" width={176} height={176} unoptimized />
              </div>
            )}
          </div>

          {/* Manual secret */}
          <div
            className="mb-6 rounded-lg px-4 py-3"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <p className="mb-1 text-xs text-neutral-500">Manual entry key</p>
            <code className="break-all font-mono text-xs text-neutral-300">{secret}</code>
          </div>

          {/* Verify */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-center text-xs text-neutral-500">
              Enter the 6-digit code from your authenticator to confirm
            </p>
            <div className="flex justify-center gap-2.5">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  autoFocus={i === 0}
                  onChange={(e) => handleInput(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !d && i > 0)
                      inputRefs.current[i - 1]?.focus();
                  }}
                  className={`digit-input h-14 w-11 rounded-xl border border-neutral-700/80 bg-neutral-800/60 text-center font-mono text-xl font-semibold text-white caret-transparent outline-none transition-all${d ? " filled" : ""}`}
                />
              ))}
            </div>

            {/* Progress dots */}
            <div className="flex justify-center gap-1.5">
              {digits.map((d, i) => (
                <span
                  key={i}
                  className="h-1 rounded-full transition-all duration-300"
                  style={{
                    width: d ? "16px" : "6px",
                    background: d ? "#f97316" : "rgba(255,255,255,0.12)",
                    boxShadow: d ? "0 0 6px #f97316aa" : "none",
                  }}
                />
              ))}
            </div>

            {error && (
              <div
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
                style={{ background: "rgba(127,29,29,0.15)", border: "1px solid rgba(127,29,29,0.5)" }}
              >
                <svg className="h-4 w-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={token.length !== 6 || loading}
              className="relative w-full overflow-hidden rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)", boxShadow: token.length === 6 && !loading ? "0 0 20px rgba(249,115,22,0.35)" : "none" }}
            >
              {!loading && (
                <span className="animate-shimmer pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              )}
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Verifying…
                </span>
              ) : "Complete setup →"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
