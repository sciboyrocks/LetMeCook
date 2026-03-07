"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGithubStatus,
  getGithubProfile,
  startGithubLogin,
  disconnectGithub,
  getGdriveStatus,
  getGdriveAuthUrl,
  exchangeGdriveCode,
  getAIProviders,
  setAIProvider,
  getAIUsage,
  getFlag,
  setFlag,
  getGeminiCliStatus,
  getGeminiCliAuthUrl,
  submitGeminiCliAuthCode,
  getApiKeyStatus,
  setApiKey,
  clearApiKey,
  type AIProviderInfo,
  type ApiKeyStatus,
} from "@/lib/api";
import GithubDeviceLoginModal from "@/components/github-device-login-modal";

// ── Shared card shell ─────────────────────────────────────────────────────────
function ConnectionCard({
  icon,
  name,
  description,
  badge,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {name}
            </h2>
            {badge}
          </div>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            {description}
          </p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: connected ? "rgba(52,211,153,0.12)" : "rgba(148,163,184,0.1)",
        color: connected ? "#34d399" : "var(--text-muted)",
        border: `1px solid ${connected ? "rgba(52,211,153,0.25)" : "rgba(148,163,184,0.15)"}`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: connected ? "#34d399" : "var(--text-muted)" }}
      />
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function SkeletonBadge() {
  return (
    <span
      className="inline-block h-5 w-24 animate-pulse rounded-full"
      style={{ background: "rgba(148,163,184,0.15)" }}
    />
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className}`}
      style={{ background: "rgba(148,163,184,0.1)" }}
    />
  );
}

// ── GitHub card ───────────────────────────────────────────────────────────────
function GitHubConnection() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["github-status"],
    queryFn: async () => {
      const res = await getGithubStatus();
      return res.ok ? res.data : { configured: false, username: null as string | null };
    },
  });

  const connected = !!status?.configured && !!status?.username;

  const { data: profile } = useQuery({
    queryKey: ["github-profile"],
    queryFn: async () => {
      const res = await getGithubProfile();
      return res.ok ? res.data : null;
    },
    enabled: connected,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await startGithubLogin();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: async (data) => {
      setError(null);
      if (data.alreadyAuthenticated) {
        await queryClient.invalidateQueries({ queryKey: ["github-status"] });
        return;
      }
      if (!data.redirectUrl) { setError("Failed to start GitHub login flow"); return; }
      setLoginUrl(data.redirectUrl);
      setDeviceCode(data.userCode);
      setShowModal(true);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to start GitHub login"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["github-status"] }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await disconnectGithub();
      if (!res.ok) throw new Error(res.error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["github-status"] });
      queryClient.invalidateQueries({ queryKey: ["github-profile"] });
    },
  });

  // Poll while modal is open
  useEffect(() => {
    if (!showModal) return;
    if (connected) { setShowModal(false); setLoginUrl(null); setDeviceCode(null); return; }
    const t = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["github-status"] });
    }, 3000);
    return () => window.clearInterval(t);
  }, [showModal, connected, queryClient]);

  const handleCopyAndOpen = useCallback(async () => {
    if (!loginUrl || !deviceCode) return;
    try { await navigator.clipboard.writeText(deviceCode); } catch {}
    window.open(loginUrl, "_blank", "noopener,noreferrer");
  }, [loginUrl, deviceCode]);

  return (
    <>
      <ConnectionCard
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-primary)" }}>
            <path d="M12 2a10 10 0 00-3.162 19.49c.5.093.683-.217.683-.482 0-.237-.009-.866-.014-1.7-2.782.604-3.369-1.342-3.369-1.342-.455-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.607.069-.607 1.004.07 1.532 1.031 1.532 1.031.893 1.53 2.343 1.088 2.914.833.091-.647.35-1.089.636-1.339-2.22-.253-4.555-1.11-4.555-4.943 0-1.092.39-1.986 1.03-2.686-.103-.253-.447-1.272.098-2.651 0 0 .84-.269 2.75 1.026A9.57 9.57 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.295 2.748-1.026 2.748-1.026.546 1.379.202 2.398.1 2.651.64.7 1.028 1.594 1.028 2.686 0 3.842-2.339 4.687-4.566 4.935.359.309.678.92.678 1.855 0 1.338-.012 2.418-.012 2.747 0 .268.18.58.688.481A10 10 0 0012 2z" />
          </svg>
        }
        name="GitHub"
        description="Connect your GitHub account to enable clone, branch selection, pull and push from within the editor."
        badge={isLoading ? <SkeletonBadge /> : <StatusBadge connected={connected} />}
      >
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <SkeletonBlock className="h-12 w-12 !rounded-full" />
              <div className="flex flex-col gap-1.5">
                <SkeletonBlock className="h-4 w-28" />
                <SkeletonBlock className="h-3 w-20" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <SkeletonBlock className="h-12" />
              <SkeletonBlock className="h-12" />
              <SkeletonBlock className="h-12" />
            </div>
          </div>
        ) : !connected ? (
          <div className="flex flex-col gap-3">
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)", width: "fit-content" }}
            >
              {connectMutation.isPending ? "Starting…" : "Connect GitHub"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Profile row */}
            <div className="flex items-center gap-3">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="GitHub avatar" className="h-12 w-12 rounded-full border" style={{ borderColor: "var(--border-subtle)" }} />
              ) : (
                <div className="h-12 w-12 rounded-full border" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }} />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {profile?.name || status?.username}
                </p>
                <p className="truncate text-xs" style={{ color: "var(--text-secondary)" }}>
                  @{profile?.login || status?.username}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Repos", value: profile?.totalRepos ?? 0 },
                { label: "Followers", value: profile?.followers ?? 0 },
                { label: "Following", value: profile?.following ?? 0 },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border px-2 py-2" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</p>
                  <p className="mt-0.5 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Contribution graph */}
            {(profile?.login || status?.username) && (
              <div className="overflow-x-auto rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-base)" }}>
                {(() => {
                  const login = profile?.login || status?.username || "";
                  return (
                    <img
                      src={`https://github.com/users/${encodeURIComponent(login)}/contributions`}
                      alt="GitHub contributions"
                      className="block h-auto min-w-[640px] max-w-none"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (img.dataset.fallback === "1") return;
                        img.dataset.fallback = "1";
                        img.src = `https://ghchart.rshah.org/${encodeURIComponent(login)}`;
                      }}
                    />
                  );
                })()}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2">
              <a
                href={profile?.htmlUrl || `https://github.com/${status?.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                Open profile ↗
              </a>
              <button
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-400 transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {disconnectMutation.isPending ? "Logging out…" : "Disconnect"}
              </button>
            </div>
          </div>
        )}
      </ConnectionCard>

      <GithubDeviceLoginModal
        open={showModal}
        userCode={deviceCode}
        redirectUrl={loginUrl}
        isConnecting={!connected}
        error={error}
        onCopyAndOpen={handleCopyAndOpen}
        onClose={() => setShowModal(false)}
      />
    </>
  );
}

// ── Google Drive card ─────────────────────────────────────────────────────────
function GoogleDriveConnection() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"idle" | "awaiting-code">("idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["gdrive-status"],
    queryFn: async () => {
      const res = await getGdriveStatus();
      return res.ok ? res.data : null;
    },
  });

  const connected = !!status?.hasToken;

  const startAuthMutation = useMutation({
    mutationFn: async () => {
      const res = await getGdriveAuthUrl();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      setError(null);
      setAuthUrl(data.url);
      setStep("awaiting-code");
      window.open(data.url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to get auth URL"),
  });

  const exchangeMutation = useMutation({
    mutationFn: async () => {
      const res = await exchangeGdriveCode(code.trim());
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      setError(null);
      setSuccessMsg(data.message);
      setStep("idle");
      setCode("");
      setAuthUrl(null);
      queryClient.invalidateQueries({ queryKey: ["gdrive-status"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Exchange failed"),
  });

  const methodLabel: Record<string, string> = {
    oauth2: "OAuth2 (your account)",
    service_account: "Service account",
    none: "—",
  };

  return (
    <ConnectionCard
      icon={
        /* Google Drive logo colours */
        <svg className="h-5 w-5" viewBox="0 0 87.3 78" fill="none">
          <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H1.1c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
          <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.1 48.75c0 1.55.4 3.1 1.2 4.5h27.5z" fill="#00ac47"/>
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.2 57c.8-1.4 1.2-2.95 1.2-4.5H59.95l5.85 11.6z" fill="#ea4335"/>
          <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.1.45-4.5 1.2z" fill="#00832d"/>
          <path d="M59.95 52.5H27.4L13.65 76.3c1.35.8 2.9 1.2 4.5 1.2h50c1.6 0 3.1-.4 4.5-1.2z" fill="#2684fc"/>
          <path d="M73.4 26.5l-22.35-38.7c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.95 52.5h26.35c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
        </svg>
      }
      name="Google Drive"
      description="Automatically upload project backups to your Google Drive folder."
      badge={isLoading ? <SkeletonBadge /> : <StatusBadge connected={connected} />}
    >
      {isLoading ? (
        <div className="flex flex-col gap-3">
          <SkeletonBlock className="h-9 w-48" />
          <SkeletonBlock className="h-8 w-36" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {successMsg && (
            <p className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">{successMsg}</p>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          {!connected && step === "idle" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Uses OAuth2 so uploads go to <em>your</em> Google account (no service-account quota limits).
                You&apos;ll need <code className="rounded px-1" style={{ background: "var(--bg-card)" }}>GDRIVE_OAUTH_CLIENT_ID</code> and <code className="rounded px-1" style={{ background: "var(--bg-card)" }}>GDRIVE_OAUTH_CLIENT_SECRET</code> set in the API&apos;s <code className="rounded px-1" style={{ background: "var(--bg-card)" }}>.env</code> first.
              </p>
              <button
                onClick={() => startAuthMutation.mutate()}
                disabled={startAuthMutation.isPending}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)", width: "fit-content" }}
              >
                {startAuthMutation.isPending ? "Opening…" : "Connect Google Drive"}
              </button>
            </div>
          )}

          {step === "awaiting-code" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                A Google consent page has opened. After approving, paste the authorization code below.
              </p>
              {authUrl && (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline"
                  style={{ color: "#f97316" }}
                >
                  Re-open consent page ↗
                </a>
              )}
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste authorization code…"
                className="rounded-lg border px-3 py-2 text-xs outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
                style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--text-primary)" }}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exchangeMutation.mutate()}
                  disabled={!code.trim() || exchangeMutation.isPending}
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)" }}
                >
                  {exchangeMutation.isPending ? "Connecting…" : "Save & connect"}
                </button>
                <button
                  onClick={() => { setStep("idle"); setCode(""); setError(null); }}
                  className="rounded-lg border px-3 py-2 text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {connected && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Backups will upload automatically to folder <strong style={{ color: "var(--text-primary)" }}>{status?.folderName ?? status?.folderId}</strong>.
              To re-authenticate, click the button below.
            </p>
          )}

          {connected && step === "idle" && (
            <button
              onClick={() => startAuthMutation.mutate()}
              disabled={startAuthMutation.isPending}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)", width: "fit-content" }}
            >
              Re-authenticate
            </button>
          )}
        </div>
      )}
    </ConnectionCard>
  );
}

// ── AI Providers card ─────────────────────────────────────────────────────────
function AIConnection() {
  const queryClient = useQueryClient();
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [expandedKeyProvider, setExpandedKeyProvider] = useState<string | null>(null);
  const [geminiAuthUrl, setGeminiAuthUrl] = useState<string | null>(null);
  const [geminiAuthCode, setGeminiAuthCode] = useState("");

  const { data: aiFlag, isLoading: isFlagLoading } = useQuery({
    queryKey: ["flag", "ai"],
    queryFn: async () => {
      const res = await getFlag("ai");
      return res.ok ? res.data.enabled : false;
    },
  });

  const toggleFlagMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await setFlag("ai", enabled);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flag", "ai"] });
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
      queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
    },
  });

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ["ai-providers"],
    queryFn: async () => {
      const res = await getAIProviders();
      return res.ok ? res.data : ([] as AIProviderInfo[]);
    },
  });

  const { data: usage } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: async () => {
      const res = await getAIUsage();
      return res.ok ? res.data : null;
    },
  });

  // Gemini CLI status
  const { data: geminiStatus, isLoading: isGeminiLoading } = useQuery({
    queryKey: ["gemini-cli-status"],
    queryFn: async () => {
      const res = await getGeminiCliStatus();
      return res.ok ? res.data : null;
    },
  });

  const authMutation = useMutation({
    mutationFn: async () => {
      const res = await getGeminiCliAuthUrl();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.url) {
        setGeminiAuthUrl(data.url);
        setGeminiAuthCode("");
      }
    },
  });

  const submitCodeMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await submitGeminiCliAuthCode(code);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      setGeminiAuthUrl(null);
      setGeminiAuthCode("");
      queryClient.invalidateQueries({ queryKey: ["gemini-cli-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
    },
  });

  const switchMutation = useMutation({
    mutationFn: async (providerId: string) => {
      const res = await setAIProvider(providerId);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      setSwitchError(null);
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
    },
    onError: (err) =>
      setSwitchError(err instanceof Error ? err.message : "Failed to switch provider"),
  });

  // API key status for each API provider
  const API_KEY_PROVIDERS = ["gemini-api", "openai", "anthropic"];

  const keyStatusQueries = API_KEY_PROVIDERS.map((pid) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery({
      queryKey: ["api-key-status", pid],
      queryFn: async () => {
        const res = await getApiKeyStatus(pid);
        return res.ok ? res.data : null;
      },
    });
  });

  const keyStatuses: Record<string, ApiKeyStatus | null> = {};
  API_KEY_PROVIDERS.forEach((pid, i) => {
    keyStatuses[pid] = keyStatusQueries[i]?.data ?? null;
  });

  const saveKeyMutation = useMutation({
    mutationFn: async ({ providerId, apiKey }: { providerId: string; apiKey: string }) => {
      const res = await setApiKey(providerId, apiKey);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (_data, vars) => {
      setKeyInputs((prev) => ({ ...prev, [vars.providerId]: "" }));
      setExpandedKeyProvider(null);
      queryClient.invalidateQueries({ queryKey: ["api-key-status", vars.providerId] });
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
    },
  });

  const clearKeyMutation = useMutation({
    mutationFn: async (providerId: string) => {
      const res = await clearApiKey(providerId);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({ queryKey: ["api-key-status", providerId] });
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
    },
  });

  const activeProvider = providers.find((p) => p.active);

  return (
    <ConnectionCard
      icon={
        <span className="text-base font-bold" style={{ color: "#a855f7" }}>
          ✦
        </span>
      }
      name="AI Providers"
      description="Configure the AI backend for task planning, repo chat, commit messages, and session recaps."
      badge={
        isFlagLoading || isLoading ? (
          <SkeletonBadge />
        ) : (
        <div className="flex items-center gap-2">
          {/* Enable/disable toggle */}
          <button
            role="switch"
            aria-checked={!!aiFlag}
            onClick={() => toggleFlagMutation.mutate(!aiFlag)}
            disabled={toggleFlagMutation.isPending}
            className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50"
            style={{ background: aiFlag ? "#a855f7" : "rgba(148,163,184,0.2)" }}
            title={aiFlag ? "AI enabled — click to disable" : "AI disabled — click to enable"}
          >
            <span
              className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
              style={{ transform: aiFlag ? "translateX(18px)" : "translateX(3px)" }}
            />
          </button>
          <StatusBadge connected={!!aiFlag} />
          {activeProvider && aiFlag && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                background: "rgba(168,85,247,0.12)",
                color: "#a855f7",
                border: "1px solid rgba(168,85,247,0.25)",
              }}
            >
              {activeProvider.name}
            </span>
          )}
        </div>
        )
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <SkeletonBlock className="h-11 w-full" />
          <SkeletonBlock className="h-11 w-full" />
          <SkeletonBlock className="h-11 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {!aiFlag && (
            <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "rgba(168,85,247,0.2)", background: "rgba(168,85,247,0.05)", color: "var(--text-secondary)" }}>
              AI is disabled. Toggle the switch above to enable it.
            </p>
          )}
          {switchError && <p className="text-xs text-red-400">{switchError}</p>}

          {/* Gemini CLI setup card */}
          {aiFlag && (
            <div
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: "rgba(168,85,247,0.2)", background: "rgba(168,85,247,0.04)" }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Gemini CLI
                </span>
                {isGeminiLoading ? (
                  <SkeletonBadge />
                ) : geminiStatus?.installed ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.25)" }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#34d399" }} />
                    Installed {geminiStatus.version && `(${geminiStatus.version})`}
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: "rgba(248,113,113,0.12)", color: "#f87171", border: "1px solid rgba(248,113,113,0.25)" }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#f87171" }} />
                    Not installed
                  </span>
                )}
              </div>
              <p className="text-[11px] mb-2.5" style={{ color: "var(--text-muted)" }}>
                Gemini CLI lets you use Google&apos;s Gemini models locally. Install it, then sign in with your Google account.
              </p>
              <div className="flex flex-wrap gap-2">
                {!isGeminiLoading && geminiStatus?.installed && !geminiStatus?.authenticated && !geminiAuthUrl && (
                  <button
                    onClick={() => authMutation.mutate()}
                    disabled={authMutation.isPending}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ background: "#a855f7", color: "#fff" }}
                  >
                    {authMutation.isPending ? "Getting link…" : "Sign in to Gemini"}
                  </button>
                )}
                {!isGeminiLoading && geminiStatus?.installed && geminiStatus?.authenticated && (
                  <span
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium"
                    style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}
                  >
                    ✓ Signed in &amp; ready
                  </span>
                )}
              </div>

              {/* Auth code flow */}
              {geminiAuthUrl && (
                <div className="mt-3 flex flex-col gap-2 rounded-lg border px-3 py-2.5" style={{ borderColor: "rgba(168,85,247,0.2)", background: "rgba(168,85,247,0.04)" }}>
                  <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    1. Click the link below to sign in with Google:
                  </p>
                  <a
                    href={geminiAuthUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all rounded-lg px-3 py-1.5 text-[11px] font-medium text-purple-400 underline hover:text-purple-300"
                  >
                    Open Google Sign-in →
                  </a>
                  <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    2. After signing in, paste the authorization code below:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={geminiAuthCode}
                      onChange={(e) => setGeminiAuthCode(e.target.value)}
                      placeholder="Paste authorization code…"
                      className="flex-1 rounded-lg border px-3 py-1.5 text-[11px] outline-none transition-colors focus:border-purple-500"
                      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                    />
                    <button
                      onClick={() => {
                        const code = geminiAuthCode.trim();
                        if (code) submitCodeMutation.mutate(code);
                      }}
                      disabled={!geminiAuthCode.trim() || submitCodeMutation.isPending}
                      className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ background: "#a855f7" }}
                    >
                      {submitCodeMutation.isPending ? "Submitting…" : "Submit"}
                    </button>
                    <button
                      onClick={() => { setGeminiAuthUrl(null); setGeminiAuthCode(""); }}
                      className="rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-opacity hover:opacity-80"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                    >
                      Cancel
                    </button>
                  </div>
                  {submitCodeMutation.isError && (
                    <p className="text-[11px] text-red-400">
                      {submitCodeMutation.error instanceof Error ? submitCodeMutation.error.message : "Failed to submit code"}
                    </p>
                  )}
                  {submitCodeMutation.isSuccess && submitCodeMutation.data?.success && (
                    <p className="text-[11px]" style={{ color: "#34d399" }}>
                      ✓ Successfully authenticated!
                    </p>
                  )}
                </div>
              )}
              {authMutation.isError && (
                <p className="mt-2 text-[11px] text-red-400">
                  {authMutation.error instanceof Error ? authMutation.error.message : "Auth failed"}
                </p>
              )}
            </div>
          )}

          {/* Provider rows */}
          <div className="flex flex-col gap-2">
            {providers.map((provider) => {
              const avail = provider.availability;
              const dotColor = avail?.ok ? "#34d399" : avail ? "#f87171" : "#6b7280";
              const isApiProvider = API_KEY_PROVIDERS.includes(provider.id);
              const ks = keyStatuses[provider.id];
              const isExpanded = expandedKeyProvider === provider.id;
              return (
                <div
                  key={provider.id}
                  className="rounded-xl border"
                  style={{
                    borderColor: provider.active
                      ? "rgba(168,85,247,0.4)"
                      : "var(--border-subtle)",
                    background: provider.active
                      ? "rgba(168,85,247,0.06)"
                      : "var(--bg-card)",
                  }}
                >
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ background: dotColor }}
                      title={avail?.detail ?? "availability unknown"}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {provider.name}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {avail?.detail ?? (provider.type === "cli" ? "CLI tool" : "API key")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isApiProvider && (
                        <button
                          onClick={() => setExpandedKeyProvider(isExpanded ? null : provider.id)}
                          className="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80"
                          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                          title={ks?.hasKey ? "Manage API key" : "Set API key"}
                        >
                          {ks?.hasKey ? "🔑 Key set" : "🔑 Set key"}
                        </button>
                      )}
                      {provider.active ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7" }}
                        >
                          Active
                        </span>
                      ) : (
                        <button
                          onClick={() => switchMutation.mutate(provider.id)}
                          disabled={switchMutation.isPending}
                          className="rounded-lg border px-3 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                        >
                          {switchMutation.isPending ? "Switching…" : "Use this"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded API key section */}
                  {isApiProvider && isExpanded && (
                    <div
                      className="border-t px-3 py-2.5"
                      style={{ borderColor: provider.active ? "rgba(168,85,247,0.2)" : "var(--border-subtle)" }}
                    >
                      {ks?.hasKey ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <code
                              className="flex-1 rounded-lg px-3 py-1.5 text-[11px] font-mono"
                              style={{ background: "rgba(0,0,0,0.2)", color: "var(--text-secondary)" }}
                            >
                              {ks.maskedKey}
                            </code>
                            <button
                              onClick={() => clearKeyMutation.mutate(provider.id)}
                              disabled={clearKeyMutation.isPending}
                              className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-red-400 transition-opacity hover:bg-red-500/10 hover:opacity-80 disabled:opacity-40"
                            >
                              {clearKeyMutation.isPending ? "Clearing…" : "Clear"}
                            </button>
                          </div>
                          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                            Key is stored securely. Clear it to remove, or paste a new one below to replace.
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              value={keyInputs[provider.id] ?? ""}
                              onChange={(e) => setKeyInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                              placeholder="Paste new API key to replace…"
                              className="flex-1 rounded-lg border px-3 py-1.5 text-[11px] outline-none transition-colors focus:border-purple-500"
                              style={{
                                borderColor: "var(--border-subtle)",
                                background: "var(--bg-card)",
                                color: "var(--text-primary)",
                              }}
                            />
                            <button
                              onClick={() => {
                                const key = keyInputs[provider.id]?.trim();
                                if (key) saveKeyMutation.mutate({ providerId: provider.id, apiKey: key });
                              }}
                              disabled={!keyInputs[provider.id]?.trim() || saveKeyMutation.isPending}
                              className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                              style={{ background: "#a855f7" }}
                            >
                              {saveKeyMutation.isPending ? "Saving…" : "Replace"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            Paste your API key to enable this provider.
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              value={keyInputs[provider.id] ?? ""}
                              onChange={(e) => setKeyInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                              placeholder={`Enter ${provider.name} API key…`}
                              className="flex-1 rounded-lg border px-3 py-1.5 text-[11px] outline-none transition-colors focus:border-purple-500"
                              style={{
                                borderColor: "var(--border-subtle)",
                                background: "var(--bg-card)",
                                color: "var(--text-primary)",
                              }}
                            />
                            <button
                              onClick={() => {
                                const key = keyInputs[provider.id]?.trim();
                                if (key) saveKeyMutation.mutate({ providerId: provider.id, apiKey: key });
                              }}
                              disabled={!keyInputs[provider.id]?.trim() || saveKeyMutation.isPending}
                              className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                              style={{ background: "#a855f7" }}
                            >
                              {saveKeyMutation.isPending ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </div>
                      )}
                      {saveKeyMutation.isError && (
                        <p className="mt-2 text-[11px] text-red-400">
                          {saveKeyMutation.error instanceof Error ? saveKeyMutation.error.message : "Failed to save key"}
                        </p>
                      )}
                      {clearKeyMutation.isError && (
                        <p className="mt-2 text-[11px] text-red-400">
                          {clearKeyMutation.error instanceof Error ? clearKeyMutation.error.message : "Failed to clear key"}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Usage summary */}
          {usage && (
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Today", value: `${usage.today.calls} / ${usage.today.cap} calls` },
                {
                  label: "Avg latency",
                  value: usage.today.avgLatencyMs > 0 ? `${usage.today.avgLatencyMs}ms` : "—",
                },
                { label: "Errors today", value: String(usage.today.errors) },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-lg border px-3 py-1.5"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
                >
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {label}{" "}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ConnectionCard>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ConnectionsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Connections
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Manage third-party integrations used by LetMeCook.
        </p>
      </div>

      <GitHubConnection />
      <GoogleDriveConnection />
      <AIConnection />
    </div>
  );
}
