"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { login, getAuthStatus } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect to /setup if not yet set up, or /dashboard if already authed
  useEffect(() => {
    getAuthStatus().then((res) => {
      if (!res.ok) return;
      if (!res.data.setupComplete) router.replace("/setup");
      if (res.data.authenticated) router.replace("/dashboard");
    });
  }, [router]);

  const token = digits.join("");

  // Keep a ref so handleSubmit can always read the latest token without needing
  // it as a dependency (avoids the stale-closure race between two effects).
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const handleInput = (i: number, value: string) => {
    const v = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 5) inputRefs.current[i + 1]?.focus();
    if (!v && i > 0) inputRefs.current[i - 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(""));
      inputRefs.current[5]?.focus();
    }
  };

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = tokenRef.current;
    if (t.length !== 6) return;
    setError(null);
    setLoading(true);
    const res = await login(t);
    setLoading(false);
    if (res.ok) {
      router.replace("/dashboard");
    } else {
      setError(res.error.message);
      setDigits(Array(6).fill(""));
      inputRefs.current[0]?.focus();
    }
  }, [router]); // stable — token is read from ref inside

  // Auto-submit when all 6 digits are entered
  useEffect(() => {
    if (token.length === 6) handleSubmit();
  }, [token, handleSubmit]);

  return (
    <div className="animate-fade-in-up -translate-y-14 flex w-full flex-col items-center px-4">
      {/* Brand above card */}
      <div className="mb-8 text-center">
        <Image
          src="/logo.png"
          alt="LetMeCook logo"
          width={112}
          height={112}
          className="mx-auto -mb-2 h-[112px] w-[112px] object-contain drop-shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
          priority
        />
        <h1 className="text-3xl font-bold tracking-tight text-white">LetMeCook</h1>
        <p className="mt-2 text-sm text-neutral-500">Your personal dev workspace</p>
      </div>

      {/* Gradient-border card */}
      <div className="gb-card w-full max-w-sm">
        <div className="gb-inner noise px-8 py-9">
          <p className="mb-7 text-center text-xs font-medium uppercase tracking-[0.15em] text-neutral-500">
            Authenticator code
          </p>

          <form onSubmit={handleSubmit} className="space-y-7">
            {/* 6-digit input */}
            <div className="flex justify-center gap-2.5" onPaste={handlePaste}>
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
                    if (e.key === "Backspace" && !digits[i] && i > 0) {
                      inputRefs.current[i - 1]?.focus();
                    }
                  }}
                  className={`digit-input${d ? " filled" : ""} h-14 w-11 rounded-xl border border-neutral-700/80 bg-neutral-800/60 text-center text-xl font-mono font-bold text-white outline-none transition-all caret-transparent`}
                />
              ))}
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-800/60 bg-red-950/30 px-3.5 py-2.5">
                <svg className="h-3.5 w-3.5 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-center text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={token.length !== 6 || loading}
              className="group relative w-full overflow-hidden rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-35 active:scale-[0.98] focus:outline-none"
              style={{ background: "linear-gradient(135deg, #ea580c, #c2410c)" }}
            >
              {/* Shimmer sweep on hover */}
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Verifying Your Recipe…
                </span>
              ) : "Let's Cook"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
