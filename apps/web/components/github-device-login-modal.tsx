"use client";

interface Props {
  open: boolean;
  userCode: string | null;
  redirectUrl: string | null;
  isConnecting: boolean;
  error: string | null;
  onClose: () => void;
  onCopyAndOpen: () => void;
}

export default function GithubDeviceLoginModal({
  open,
  userCode,
  redirectUrl,
  isConnecting,
  error,
  onClose,
  onCopyAndOpen,
}: Props) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md rounded-2xl border p-5 shadow-2xl"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Complete GitHub login"
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Complete GitHub login
          </h2>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Use this code and continue on GitHub.
          </p>

          <div className="mt-4 rounded-xl border px-3 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--input-bg)" }}>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Device code</div>
            <div className="mt-1 text-lg font-semibold tracking-[0.12em]" style={{ color: "var(--text-primary)" }}>
              {userCode ?? "Waiting for code..."}
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCopyAndOpen}
              disabled={!userCode || !redirectUrl}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              Copy code and open
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isConnecting}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)" }}
            >
              {isConnecting ? "Waiting..." : "Done"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
