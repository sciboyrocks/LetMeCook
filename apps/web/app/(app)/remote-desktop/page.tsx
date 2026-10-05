"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRemoteDesktopConnections,
  createRemoteDesktopConnection,
  updateRemoteDesktopConnection,
  deleteRemoteDesktopConnection,
  getRemoteDesktopToken,
  testRemoteDesktopConnection,
  type RemoteDesktopConnection,
  type RemoteDesktopPerformanceMode,
  type RemoteDesktopTestResult,
} from "@/lib/api";
import type RFB from "@novnc/novnc";

type PerformanceMode = RemoteDesktopPerformanceMode;
// Speed first: low JPEG quality and stronger zlib send fewer bytes per update. The viewport
// cap only reduces pixels on hosts that accept remote resizing (see hostIgnoresResize).
const PERFORMANCE_PRESETS = {
  fast: { quality: 1, compression: 6, width: 1280, height: 800 },
  balanced: { quality: 5, compression: 4, width: 1920, height: 1080 },
  quality: { quality: 8, compression: 2, width: undefined, height: undefined },
};

// Unexpected drops retry with backoff; noVNC reports server-side closes as clean, so any
// disconnect the user did not ask for counts.
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const RESIZE_CHECK_MS = 2000;

// ── Color Options ────────────────────────────────────────────────────────────
const COLOR_PRESETS = [
  { label: "Orange", hex: "#f97316" },
  { label: "Blue", hex: "#3b82f6" },
  { label: "Emerald", hex: "#10b981" },
  { label: "Purple", hex: "#a855f7" },
  { label: "Rose", hex: "#f43f5e" },
  { label: "Cyan", hex: "#06b6d4" },
  { label: "Amber", hex: "#f59e0b" },
];

// ── RFB Keysym constants ─────────────────────────────────────────────────────
const KEY_SUPER_L = 0xffeb; // Command key on Mac / Windows key
const KEY_ALT_L = 0xffe9;   // Option / Alt key
const KEY_CTRL_L = 0xffe3;  // Control key
const KEY_ESC = 0xff1b;
const KEY_TAB = 0xff09;
const KEY_SPACE = 0x0020;

// ── Form State ───────────────────────────────────────────────────────────────
interface ConnectionFormState {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  clearPassword?: boolean;
  color: string;
  viewOnly: boolean;
  quality: number;
  compression: number;
  scaleMode: "fit" | "original" | "stretch";
  performanceMode: PerformanceMode;
  showDotCursor: boolean;
}

const DEFAULT_FORM: ConnectionFormState = {
  name: "",
  host: "",
  port: 5900,
  username: "",
  password: "",
  color: "#f97316",
  viewOnly: false,
  quality: 2,
  compression: 1,
  scaleMode: "fit",
  performanceMode: "fast",
  showDotCursor: true,
};

export default function RemoteDesktopPage() {
  const queryClient = useQueryClient();

  // Search & List state
  const [searchQuery, setSearchQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [guideModalOpen, setGuideModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<RemoteDesktopConnection | null>(null);
  const [form, setForm] = useState<ConnectionFormState>(DEFAULT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Active Session state
  const [activeConnection, setActiveConnection] = useState<RemoteDesktopConnection | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "disconnected" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [desktopName, setDesktopName] = useState<string>("");
  const [promptPasswordOpen, setPromptPasswordOpen] = useState(false);
  const [promptPasswordValue, setPromptPasswordValue] = useState("");
  const [promptUsernameValue, setPromptUsernameValue] = useState("");
  const [promptRequiresUsername, setPromptRequiresUsername] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scaleMode, setScaleMode] = useState<"fit" | "original">("fit");
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>("fast");
  const [hostIgnoresResize, setHostIgnoresResize] = useState(false);
  const [clipboardText, setClipboardText] = useState("");
  const [clipboardModalOpen, setClipboardModalOpen] = useState(false);
  const [shortcutsMenuOpen, setShortcutsMenuOpen] = useState(false);

  // Testing probe state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, RemoteDesktopTestResult>>({});
  const [modalTestResult, setModalTestResult] = useState<RemoteDesktopTestResult | null>(null);
  const [testingModal, setTestingModal] = useState(false);

  // RFB Ref
  const rfbRef = useRef<RFB | null>(null);
  const connectionAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const performanceModeRef = useRef<PerformanceMode>("fast");
  const vncContainerRef = useRef<HTMLDivElement | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);

  // Fetch connections
  const { data: connections = [], isLoading } = useQuery({
    queryKey: ["remote-desktop-connections"],
    queryFn: async () => {
      const res = await getRemoteDesktopConnections();
      return res.ok ? res.data : [];
    },
  });

  // Save Mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingConnection) {
        const res = await updateRemoteDesktopConnection(editingConnection.id, {
          name: form.name,
          host: form.host,
          port: form.port,
          username: form.username,
          password: form.password ? form.password : undefined,
          clearPassword: form.clearPassword,
          color: form.color,
          viewOnly: form.viewOnly,
          quality: form.quality,
          compression: form.compression,
          scaleMode: form.scaleMode,
          performanceMode: form.performanceMode,
          showDotCursor: form.showDotCursor,
        });
        if (!res.ok) throw new Error(res.error.message);
        return res.data;
      } else {
        const res = await createRemoteDesktopConnection({
          name: form.name,
          host: form.host,
          port: form.port,
          username: form.username,
          password: form.password || undefined,
          color: form.color,
          viewOnly: form.viewOnly,
          quality: form.quality,
          compression: form.compression,
          scaleMode: form.scaleMode,
          performanceMode: form.performanceMode,
          showDotCursor: form.showDotCursor,
        });
        if (!res.ok) throw new Error(res.error.message);
        return res.data;
      }
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditingConnection(null);
      setForm(DEFAULT_FORM);
      setFormError(null);
      setModalTestResult(null);
      await queryClient.invalidateQueries({ queryKey: ["remote-desktop-connections"] });
    },
    onError: (err: any) => {
      setFormError(err.message || "Failed to save connection");
    },
  });

  // Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await deleteRemoteDesktopConnection(id);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["remote-desktop-connections"] });
      if (activeConnection && !connections.some((c) => c.id === activeConnection.id)) {
        disconnectSession();
      }
    },
  });

  // Filtered connections
  const filteredConnections = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return connections;
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        String(c.port).includes(q)
    );
  }, [connections, searchQuery]);

  // Handle open add modal
  const handleOpenAdd = () => {
    setEditingConnection(null);
    setForm(DEFAULT_FORM);
    setFormError(null);
    setModalTestResult(null);
    setShowPassword(false);
    setShowAdvanced(false);
    setModalOpen(true);
  };

  // Handle open edit modal
  const handleOpenEdit = (c: RemoteDesktopConnection) => {
    setEditingConnection(c);
    setForm({
      name: c.name,
      host: c.host,
      port: c.port,
      username: c.username || "",
      password: "",
      clearPassword: false,
      color: c.color || "#f97316",
      viewOnly: c.viewOnly,
      quality: c.quality,
      compression: c.compression,
      scaleMode: c.scaleMode,
      performanceMode: c.performanceMode ?? "fast",
      showDotCursor: c.showDotCursor,
    });
    setFormError(null);
    setModalTestResult(null);
    setShowPassword(false);
    setShowAdvanced(false);
    setModalOpen(true);
  };

  // Handle Duplicate
  const handleDuplicate = async (c: RemoteDesktopConnection) => {
    try {
      await createRemoteDesktopConnection({
        name: `${c.name} (Copy)`,
        host: c.host,
        port: c.port,
        username: c.username,
        color: c.color,
        viewOnly: c.viewOnly,
        quality: c.quality,
        compression: c.compression,
        scaleMode: c.scaleMode,
        performanceMode: c.performanceMode,
        showDotCursor: c.showDotCursor,
      });
      await queryClient.invalidateQueries({ queryKey: ["remote-desktop-connections"] });
    } catch (err) {
      console.error("Duplicate failed", err);
    }
  };

  // Test Connection
  const runTest = async (host: string, port: number, connectionId?: string) => {
    if (connectionId) setTestingId(connectionId);
    else setTestingModal(true);

    try {
      const res = await testRemoteDesktopConnection(host, port);
      if (res.ok) {
        if (connectionId) {
          setTestResults((prev) => ({ ...prev, [connectionId]: res.data }));
        } else {
          setModalTestResult(res.data);
        }
      } else {
        const fallback: RemoteDesktopTestResult = {
          reachable: false,
          latencyMs: 0,
          error: res.error.message,
        };
        if (connectionId) {
          setTestResults((prev) => ({ ...prev, [connectionId]: fallback }));
        } else {
          setModalTestResult(fallback);
        }
      }
    } catch (err: any) {
      const fallback: RemoteDesktopTestResult = {
        reachable: false,
        latencyMs: 0,
        error: err.message || "Failed to reach server",
      };
      if (connectionId) {
        setTestResults((prev) => ({ ...prev, [connectionId]: fallback }));
      } else {
        setModalTestResult(fallback);
      }
    } finally {
      if (connectionId) setTestingId(null);
      else setTestingModal(false);
    }
  };

  // Disconnect active RFB session
  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  };

  const disconnectSession = useCallback(() => {
    connectionAttemptRef.current += 1;
    clearReconnectTimer();
    if (rfbRef.current) {
      try {
        rfbRef.current.disconnect();
      } catch {}
      rfbRef.current = null;
    }
    setConnectionStatus("idle");
    setStatusMessage("");
    setActiveConnection(null);
    setDesktopName("");
    setPromptPasswordOpen(false);
    setPromptPasswordValue("");
    setPromptUsernameValue("");
    setPromptRequiresUsername(false);
  }, []);

  // Connect to connection
  // Hosts that ignore SetDesktopSize (e.g. macOS Screen Sharing) keep their native size. A
  // viewport cap then only shrinks the picture without sending fewer pixels, so it is dropped.
  const checkHostResize = (rfb: RFB) => {
    setTimeout(() => {
      if (rfbRef.current !== rfb || !rfb.resizeSession || rfb.viewOnly) return;
      const container = vncContainerRef.current;
      const canvas = container?.querySelector("canvas");
      if (!container || !canvas) return;
      if (canvas.width > container.clientWidth + 16 || canvas.height > container.clientHeight + 16) {
        setHostIgnoresResize(true);
      }
    }, RESIZE_CHECK_MS);
  };

  const connectToConnection = async (conn: RemoteDesktopConnection, retry = 0) => {
    const attempt = ++connectionAttemptRef.current;
    const isCurrent = () => connectionAttemptRef.current === attempt;
    clearReconnectTimer();
    const startMode: PerformanceMode = conn.performanceMode ?? "fast";
    if (rfbRef.current) {
      try {
        rfbRef.current.disconnect();
      } catch {}
      rfbRef.current = null;
    }

    setActiveConnection(conn);
    setPerformanceMode(startMode);
    performanceModeRef.current = startMode;
    if (retry === 0) setHostIgnoresResize(false);
    setPromptPasswordOpen(false);
    setDesktopName("");
    setConnectionStatus("connecting");
    if (retry === 0) setStatusMessage(`Requesting connection ticket for ${conn.name}...`);

    const scheduleReconnect = (failedRetries: number) => {
      if (failedRetries >= RECONNECT_DELAYS_MS.length) return false;
      const next = failedRetries + 1;
      setConnectionStatus("connecting");
      setStatusMessage(`Connection lost. Reconnecting (${next}/${RECONNECT_DELAYS_MS.length})...`);
      reconnectTimerRef.current = setTimeout(() => {
        if (!isCurrent()) return;
        connectToConnection({ ...conn, performanceMode: performanceModeRef.current }, next);
      }, RECONNECT_DELAYS_MS[failedRetries]);
      return true;
    };
    setIsViewOnly(conn.viewOnly);
    setScaleMode(conn.scaleMode === "original" ? "original" : "fit");

    try {
      const tokenRes = await getRemoteDesktopToken(conn.id);
      if (!isCurrent()) return;
      if (!tokenRes.ok) {
        throw new Error(tokenRes.error.message || "Could not retrieve connection token");
      }

      const { token, connection: fullConn } = tokenRes.data;
      // Keep decrypted credentials scoped to this attempt, out of page state.
      setActiveConnection({ ...conn, quality: fullConn.quality, compression: fullConn.compression });
      const savedPassword = fullConn.password || undefined;
      const savedUsername = fullConn.username || undefined;

      const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
      const wsProto = isHttps ? "wss:" : "ws:";
      let wsUrl: string;

      if (typeof window !== "undefined" && window.location.port === "3001") {
        wsUrl = `${wsProto}//${window.location.hostname}:3000/api/vnc/ws?token=${encodeURIComponent(token)}`;
      } else {
        wsUrl = `${wsProto}//${window.location.host}/api/vnc/ws?token=${encodeURIComponent(token)}`;
      }

      if (retry === 0) setStatusMessage(`Connecting to ${conn.host}:${conn.port}...`);

      const RFBClass = (await import("@novnc/novnc")).default;

      // Wait for the session container to mount and apply the viewport limits.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!isCurrent() || !vncContainerRef.current) return;

      while (vncContainerRef.current.firstChild) {
        vncContainerRef.current.removeChild(vncContainerRef.current.firstChild);
      }

      const creds: { username?: string; password?: string } = {};
      if (savedUsername) creds.username = savedUsername;
      if (savedPassword) creds.password = savedPassword;

      const rfb = new RFBClass(vncContainerRef.current, wsUrl, {
        credentials: Object.keys(creds).length ? creds : undefined,
        shared: true,
        wsProtocols: ["binary"],
      });

      rfbRef.current = rfb;
      rfb.viewOnly = conn.viewOnly;
      rfb.scaleViewport = conn.scaleMode !== "original";
      const startSettings = startMode === "custom" ? fullConn : PERFORMANCE_PRESETS[startMode];
      rfb.qualityLevel = startSettings.quality;
      rfb.compressionLevel = startSettings.compression;
      rfb.showDotCursor = conn.showDotCursor;
      // This is a request; hosts without ExtendedDesktopSize keep their native resolution.
      rfb.resizeSession = conn.scaleMode !== "original";

      let wasConnected = false;
      let retries = retry;
      let authFailed = false;

      rfb.addEventListener("connect", () => {
        if (!isCurrent()) return;
        wasConnected = true;
        retries = 0;
        checkHostResize(rfb);
        setConnectionStatus("connected");
        setStatusMessage("Connected to remote desktop");
        setPromptPasswordOpen(false);

        requestAnimationFrame(() => {
          if (!isCurrent() || rfbRef.current !== rfb) return;
          const canvas = vncContainerRef.current?.querySelector("canvas");
          if (canvas) {
            canvas.tabIndex = 0;
            canvas.style.cursor = "default";
            canvas.focus();
          }
          rfb.focus();
        });
      });

      rfb.addEventListener("disconnect", () => {
        if (!isCurrent()) return;
        if (!authFailed && (wasConnected || retries > 0) && scheduleReconnect(retries)) return;
        setConnectionStatus("disconnected");
        setStatusMessage(
          wasConnected || retries > 0
            ? "Disconnected from remote host"
            : `Could not connect to ${conn.host}:${conn.port}`
        );
      });

      rfb.addEventListener("desktopname", (e: any) => {
        if (!isCurrent()) return;
        if (e.detail?.name) setDesktopName(e.detail.name);
      });

      rfb.addEventListener("credentialsrequired", (e: any) => {
        if (!isCurrent()) return;
        const types: string[] = e.detail?.types || ["password"];
        const needsUsername = types.includes("username");

        // If we already have credentials that satisfy the requirement, automatically send them
        if (savedPassword && (!needsUsername || savedUsername)) {
          try {
            rfb.sendCredentials({
              username: savedUsername,
              password: savedPassword,
            });
            return;
          } catch (err) {
            console.error("Auto-send credentials error:", err);
          }
        }

        setConnectionStatus("connecting");
        setPromptRequiresUsername(needsUsername);
        setPromptUsernameValue(savedUsername || "");
        setStatusMessage(
          needsUsername
            ? "macOS credentials required (Username and Password)"
            : "VNC Password required"
        );
        setPromptPasswordOpen(true);
      });

      rfb.addEventListener("securityfailure", (e: any) => {
        if (!isCurrent()) return;
        authFailed = true;
        setConnectionStatus("error");
        setStatusMessage(e.detail?.reason || "Authentication failed. Incorrect password.");
        setPromptPasswordOpen(true);
      });
    } catch (err: any) {
      if (!isCurrent()) return;
      if (retry > 0 && scheduleReconnect(retry)) return;
      setConnectionStatus("error");
      setStatusMessage(err.message || "Failed to initialize VNC connection");
    }
  };

  const handleSendPassword = () => {
    if (!rfbRef.current) return;
    try {
      const creds: { username?: string; password?: string } = {
        password: promptPasswordValue,
      };
      if (promptRequiresUsername || promptUsernameValue) {
        creds.username = promptUsernameValue || activeConnection?.username || undefined;
      }
      rfbRef.current.sendCredentials(creds);
      setPromptPasswordOpen(false);
      setStatusMessage("Authenticating...");
    } catch (err) {
      console.error("sendCredentials error", err);
    }
  };

  const toggleScaleMode = () => {
    if (!rfbRef.current) return;
    const nextMode = scaleMode === "fit" ? "original" : "fit";
    setScaleMode(nextMode);
    rfbRef.current.scaleViewport = nextMode === "fit";
    rfbRef.current.resizeSession = nextMode === "fit";
    if (nextMode === "fit") checkHostResize(rfbRef.current);
  };

  const toggleViewOnly = () => {
    if (!rfbRef.current) return;
    const next = !isViewOnly;
    setIsViewOnly(next);
    rfbRef.current.viewOnly = next;
    if (!next) checkHostResize(rfbRef.current);
  };

  const changePerformanceMode = (mode: PerformanceMode) => {
    setPerformanceMode(mode);
    performanceModeRef.current = mode;
    if (activeConnection && activeConnection.performanceMode !== mode) {
      setActiveConnection({ ...activeConnection, performanceMode: mode });
      // Remember the choice so the next session starts in the same mode.
      updateRemoteDesktopConnection(activeConnection.id, { performanceMode: mode })
        .then(() => queryClient.invalidateQueries({ queryKey: ["remote-desktop-connections"] }))
        .catch(() => {});
    }
    if (!rfbRef.current) return;
    const settings = mode === "custom" ? activeConnection : PERFORMANCE_PRESETS[mode];
    if (!settings) return;
    rfbRef.current.compressionLevel = settings.compression;
    rfbRef.current.qualityLevel = settings.quality;
  };

  const sendKey = (keysym: number, code?: string) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.sendKey(keysym, code, true);
    setTimeout(() => {
      if (rfbRef.current === rfb) rfb.sendKey(keysym, code, false);
    }, 50);
  };

  const sendKeyCombo = (keys: { keysym: number; code?: string }[]) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    for (const k of keys) {
      rfb.sendKey(k.keysym, k.code, true);
    }
    setTimeout(() => {
      if (rfbRef.current !== rfb) return;
      for (const k of [...keys].reverse()) {
        rfb.sendKey(k.keysym, k.code, false);
      }
    }, 100);
  };

  const toggleFullscreen = () => {
    if (!fullscreenContainerRef.current) return;
    if (!document.fullscreenElement) {
      fullscreenContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    return () => {
      connectionAttemptRef.current += 1;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch {}
      }
    };
  }, []);

  const viewportCap =
    scaleMode === "fit" && !isViewOnly && !hostIgnoresResize && performanceMode !== "custom"
      ? PERFORMANCE_PRESETS[performanceMode]
      : undefined;

  const handlePasteClipboard = () => {
    if (!rfbRef.current || !clipboardText) return;
    rfbRef.current.clipboardPasteFrom(clipboardText);
    setClipboardModalOpen(false);
    setClipboardText("");
  };

  return (
    <div className="space-y-6">
      {!activeConnection && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl border text-orange-400"
                style={{
                  borderColor: "var(--border-subtle)",
                  background: "rgba(249,115,22,0.1)",
                }}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
                  Remote Desktop
                </h1>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Connect to your Mac or remote machines via VNC directly from your browser
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setGuideModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all hover:bg-neutral-800/20"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
              }}
            >
              <svg className="h-4 w-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a2.25 2.25 0 10-4.5 0 2.25 2.25 0 004.5 0zm0 0h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Mac Setup Guide</span>
            </button>

            <button
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-95"
              style={{
                background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
                boxShadow: "0 4px 12px rgba(249,115,22,0.3)",
              }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span>Add Connection</span>
            </button>
          </div>
        </div>
      )}

      {activeConnection && (
        <div
          ref={fullscreenContainerRef}
          className={`flex flex-col rounded-2xl border overflow-hidden transition-all ${
            isFullscreen ? "fixed inset-0 z-50 rounded-none border-0" : ""
          }`}
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--bg-elevated)",
            height: isFullscreen ? "100vh" : "calc(100vh - 8rem)",
          }}
        >
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs"
            style={{
              borderColor: "var(--border-subtle)",
              background: "var(--bg-card)",
            }}
          >
            <div className="flex items-center gap-3">
              <button
                onClick={disconnectSession}
                className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-all hover:bg-neutral-800/30"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
                title="Disconnect & Return to Connections"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                <span>Leave</span>
              </button>

              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: activeConnection.color || "#f97316" }}
                />
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {activeConnection.name}
                </span>
                <span className="rounded-md border px-1.5 py-0.5 text-[10px] font-mono text-neutral-400" style={{ borderColor: "var(--border-subtle)" }}>
                  {activeConnection.host}:{activeConnection.port}
                </span>
                {desktopName && (
                  <span className="hidden text-[11px] text-neutral-400 sm:inline">
                    ({desktopName})
                  </span>
                )}
              </div>

              <div
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                  connectionStatus === "connected"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : connectionStatus === "connecting"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    connectionStatus === "connected"
                      ? "bg-emerald-400"
                      : connectionStatus === "connecting"
                      ? "bg-amber-400 animate-ping"
                      : "bg-rose-400"
                  }`}
                />
                <span>{connectionStatus}</span>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-1.5">
              <button
                onClick={() => sendKey(KEY_SUPER_L, "MetaLeft")}
                className="rounded-lg border px-2 py-1 font-mono text-xs transition-all hover:bg-neutral-800/40"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                title="Send Command (⌘) Key"
              >
                ⌘ Cmd
              </button>

              <button
                onClick={() => sendKey(KEY_ALT_L, "AltLeft")}
                className="rounded-lg border px-2 py-1 font-mono text-xs transition-all hover:bg-neutral-800/40"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                title="Send Option (⌥) Key"
              >
                ⌥ Option
              </button>

              <button
                onClick={() => sendKey(KEY_CTRL_L, "ControlLeft")}
                className="rounded-lg border px-2 py-1 font-mono text-xs transition-all hover:bg-neutral-800/40"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                title="Send Control (⌃) Key"
              >
                ⌃ Control
              </button>

              <button
                onClick={() => sendKey(KEY_ESC, "Escape")}
                className="rounded-lg border px-2 py-1 font-mono text-xs transition-all hover:bg-neutral-800/40"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                title="Send Escape"
              >
                Esc
              </button>

              <button
                onClick={() => sendKey(KEY_TAB, "Tab")}
                className="rounded-lg border px-2 py-1 font-mono text-xs transition-all hover:bg-neutral-800/40"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                title="Send Tab"
              >
                Tab
              </button>

              <div className="relative">
                <button
                  onClick={() => setShortcutsMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-all hover:bg-neutral-800/40"
                  style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                >
                  <span>Mac Shortcuts</span>
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {shortcutsMenuOpen && (
                  <div
                    className="absolute right-0 mt-1 w-56 rounded-xl border p-1 shadow-2xl z-50 text-xs backdrop-blur-md"
                    style={{
                      borderColor: "var(--border-subtle)",
                      background: "var(--bg-elevated)",
                    }}
                  >
                    <div className="px-2 py-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                      Mac Key Combos
                    </div>
                    <button
                      onClick={() => {
                        sendKeyCombo([
                          { keysym: KEY_SUPER_L, code: "MetaLeft" },
                          { keysym: KEY_SPACE, code: "Space" },
                        ]);
                        setShortcutsMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-neutral-800/30"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span>Spotlight Search</span>
                      <kbd className="font-mono text-[10px] opacity-70">⌘ Space</kbd>
                    </button>
                    <button
                      onClick={() => {
                        sendKeyCombo([
                          { keysym: KEY_SUPER_L, code: "MetaLeft" },
                          { keysym: KEY_TAB, code: "Tab" },
                        ]);
                        setShortcutsMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-neutral-800/30"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span>App Switcher</span>
                      <kbd className="font-mono text-[10px] opacity-70">⌘ Tab</kbd>
                    </button>
                    <button
                      onClick={() => {
                        sendKeyCombo([
                          { keysym: KEY_SUPER_L, code: "MetaLeft" },
                          { keysym: 0x0063, code: "KeyC" },
                        ]);
                        setShortcutsMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-neutral-800/30"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span>Copy</span>
                      <kbd className="font-mono text-[10px] opacity-70">⌘ C</kbd>
                    </button>
                    <button
                      onClick={() => {
                        sendKeyCombo([
                          { keysym: KEY_SUPER_L, code: "MetaLeft" },
                          { keysym: 0x0076, code: "KeyV" },
                        ]);
                        setShortcutsMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-neutral-800/30"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span>Paste</span>
                      <kbd className="font-mono text-[10px] opacity-70">⌘ V</kbd>
                    </button>
                    <button
                      onClick={() => {
                        sendKeyCombo([
                          { keysym: KEY_SUPER_L, code: "MetaLeft" },
                          { keysym: 0x0077, code: "KeyW" },
                        ]);
                        setShortcutsMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-neutral-800/30"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span>Close Window</span>
                      <kbd className="font-mono text-[10px] opacity-70">⌘ W</kbd>
                    </button>
                    <button
                      onClick={() => {
                        sendKeyCombo([
                          { keysym: KEY_SUPER_L, code: "MetaLeft" },
                          { keysym: 0x0071, code: "KeyQ" },
                        ]);
                        setShortcutsMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-neutral-800/30 text-rose-400"
                    >
                      <span>Quit Application</span>
                      <kbd className="font-mono text-[10px] opacity-70">⌘ Q</kbd>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setClipboardModalOpen(true)}
                className="rounded-lg border p-1.5 transition-all hover:bg-neutral-800/30"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                title="Send text to remote clipboard"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
              </button>

              {/* Performance Mode Switcher */}
              <div
                className="flex items-center rounded-lg border p-0.5 text-xs"
                style={{ borderColor: "var(--border-subtle)", background: "rgba(255,255,255,0.03)" }}
              >
                <button
                  onClick={() => changePerformanceMode("fast")}
                  className={`rounded px-2 py-0.5 font-medium transition-all ${
                    performanceMode === "fast"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                  title="Prioritize speed: lowest image quality, strong compression, desktop up to 1280 × 800 on hosts that support resizing"
                >
                  ⚡ Fast
                </button>
                <button
                  onClick={() => changePerformanceMode("balanced")}
                  className={`rounded px-2 py-0.5 font-medium transition-all ${
                    performanceMode === "balanced"
                      ? "bg-blue-500/20 text-blue-300 border border-blue-500/40 font-semibold"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                  title="Medium image quality, desktop up to 1920 × 1080 on hosts that support resizing"
                >
                  🚀 Balanced
                </button>
                <button
                  onClick={() => changePerformanceMode("quality")}
                  className={`rounded px-2 py-0.5 font-medium transition-all ${
                    performanceMode === "quality"
                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                  title="High Quality (Maximum color precision and detail)"
                >
                  💎 Crisp
                </button>
                <button
                  onClick={() => changePerformanceMode("custom")}
                  className={`rounded px-2 py-0.5 font-medium transition-all ${
                    performanceMode === "custom" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-neutral-200"
                  }`}
                  title="Use this connection's saved quality and compression settings"
                >
                  Custom
                </button>
              </div>

              <button
                onClick={toggleScaleMode}
                className={`rounded-lg border px-2 py-1 text-xs transition-all ${
                  scaleMode === "fit" ? "bg-orange-500/10 text-orange-400 border-orange-500/30" : "hover:bg-neutral-800/30"
                }`}
                style={{
                  borderColor: scaleMode === "fit" ? undefined : "var(--border-subtle)",
                  color: scaleMode === "fit" ? undefined : "var(--text-secondary)",
                }}
                title={scaleMode === "fit" ? "Fit to Screen" : "Original 1:1 Scale"}
              >
                {scaleMode === "fit" ? "Fit Screen" : "1:1 Scale"}
              </button>

              <button
                onClick={toggleViewOnly}
                className={`rounded-lg border px-2 py-1 text-xs transition-all ${
                  isViewOnly ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "hover:bg-neutral-800/30"
                }`}
                style={{
                  borderColor: isViewOnly ? undefined : "var(--border-subtle)",
                  color: isViewOnly ? undefined : "var(--text-secondary)",
                }}
                title={isViewOnly ? "View-only (Inputs disabled)" : "Interactive Mode"}
              >
                {isViewOnly ? "View Only" : "Interactive"}
              </button>

              <button
                onClick={() => {
                  const canvas = vncContainerRef.current?.querySelector("canvas");
                  if (canvas) {
                    canvas.tabIndex = 0;
                    canvas.style.cursor = "default";
                    canvas.focus();
                  }
                  rfbRef.current?.focus();
                }}
                className="rounded-lg border px-2 py-1 text-xs transition-all hover:bg-neutral-800/30 text-neutral-300"
                style={{ borderColor: "var(--border-subtle)" }}
                title="Click to focus keyboard & mouse for input"
              >
                ⌨️ Focus
              </button>

              <button
                onClick={toggleFullscreen}
                className="rounded-lg border p-1.5 transition-all hover:bg-neutral-800/30"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
              >
                {isFullscreen ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => connectToConnection(activeConnection)}
                className="rounded-lg border p-1.5 transition-all hover:bg-neutral-800/30 text-neutral-400 hover:text-white"
                style={{ borderColor: "var(--border-subtle)" }}
                title="Reconnect"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>

              <button
                onClick={disconnectSession}
                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400 transition-all hover:bg-rose-500/20"
                title="Disconnect session"
              >
                Disconnect
              </button>
            </div>
          </div>

          {connectionStatus === "connected" && (
            <div
              className="flex items-center justify-between border-b px-3 py-1.5 text-[11px]"
              style={{ borderColor: "var(--border-subtle)", background: "rgba(249, 115, 22, 0.04)" }}
            >
              <div className="flex items-center gap-2 text-neutral-300">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-semibold text-emerald-400">Connected</span>
                <span className="text-neutral-500">•</span>
                <span className="text-neutral-400">
                  Tip: On your Mac, ensure the menu bar Screen Sharing icon is set to <strong>Control Screen</strong> (not Observe). For native full control, set your macOS Username in connection settings.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const canvas = vncContainerRef.current?.querySelector("canvas");
                    if (canvas) {
                      canvas.tabIndex = 0;
                      canvas.focus();
                    }
                    rfbRef.current?.focus();
                  }}
                  className="text-[10px] text-orange-400 hover:underline"
                >
                  Click here if typing loses focus
                </button>
              </div>
            </div>
          )}

          <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center">
            <div
              ref={vncContainerRef}
              tabIndex={0}
              onClick={() => {
                const canvas = vncContainerRef.current?.querySelector("canvas");
                if (canvas) {
                  canvas.tabIndex = 0;
                  canvas.focus();
                }
                rfbRef.current?.focus();
              }}
              onMouseDown={() => {
                const canvas = vncContainerRef.current?.querySelector("canvas");
                if (canvas) {
                  canvas.tabIndex = 0;
                  canvas.focus();
                }
                rfbRef.current?.focus();
              }}
              className="w-full h-full flex items-center justify-center overflow-hidden cursor-default outline-none"
              style={{
                background: "#111",
                maxWidth: viewportCap?.width,
                maxHeight: viewportCap?.height,
              }}
            />

            {connectionStatus === "connecting" && !promptPasswordOpen && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-center">
                <div className="relative mb-4 flex h-14 w-14 items-center justify-center">
                  <div className="absolute inset-0 animate-ping rounded-full bg-orange-500/20" />
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                </div>
                <h3 className="text-base font-semibold text-white">Connecting to {activeConnection.name}</h3>
                <p className="mt-1 text-xs text-neutral-400 font-mono">{activeConnection.host}:{activeConnection.port}</p>
                <p className="mt-2 text-xs text-orange-400">{statusMessage || "Negotiating RFB protocol..."}</p>
              </div>
            )}

            {promptPasswordOpen && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
                <div
                  className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl"
                  style={{
                    borderColor: "var(--border-subtle)",
                    background: "var(--bg-card)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-2.25 0h13.5A1.5 1.5 0 0120.25 12v7.5A1.5 1.5 0 0118.75 21h-13.5A1.5 1.5 0 013.75 19.5V12a1.5 1.5 0 011.5-1.5z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {promptRequiresUsername ? "Credentials Required" : "Password Required"}
                      </h3>
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {promptRequiresUsername
                          ? `Enter macOS login credentials for ${activeConnection.name}`
                          : `Enter VNC password for ${activeConnection.name}`}
                      </p>
                    </div>
                  </div>

                  {statusMessage && (
                    <p className="mt-3 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                      {statusMessage}
                    </p>
                  )}

                  <div className="mt-4 space-y-3">
                    {promptRequiresUsername && (
                      <div>
                        <label className="block text-[11px] font-medium mb-1 text-neutral-400">
                          macOS Username
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. samrudh"
                          value={promptUsernameValue}
                          onChange={(e) => setPromptUsernameValue(e.target.value)}
                          className="w-full rounded-xl border px-3 py-2 text-xs outline-none focus:border-orange-500"
                          style={{
                            borderColor: "var(--input-border)",
                            background: "var(--input-bg)",
                            color: "var(--text-primary)",
                          }}
                        />
                      </div>
                    )}

                    <div>
                      {promptRequiresUsername && (
                        <label className="block text-[11px] font-medium mb-1 text-neutral-400">
                          Password
                        </label>
                      )}
                      <input
                        type="password"
                        autoFocus={!promptRequiresUsername || Boolean(promptUsernameValue)}
                        placeholder={promptRequiresUsername ? "macOS login password..." : "Enter VNC password..."}
                        value={promptPasswordValue}
                        onChange={(e) => setPromptPasswordValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSendPassword();
                        }}
                        className="w-full rounded-xl border px-3 py-2 text-xs outline-none focus:border-orange-500"
                        style={{
                          borderColor: "var(--input-border)",
                          background: "var(--input-bg)",
                          color: "var(--text-primary)",
                        }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      onClick={disconnectSession}
                      className="rounded-xl border px-3 py-1.5 text-xs font-medium"
                      style={{
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSendPassword}
                      className="rounded-xl bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-orange-600"
                    >
                      Authenticate
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(connectionStatus === "disconnected" || connectionStatus === "error") && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm p-6 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-white">Connection Closed</h3>
                <p className="mt-1 text-xs text-neutral-400 max-w-sm">
                  {statusMessage || "The remote VNC session has ended."}
                </p>

                <div className="mt-5 flex items-center gap-2">
                  <button
                    onClick={() => connectToConnection(activeConnection)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-orange-600"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    <span>Reconnect</span>
                  </button>

                  <button
                    onClick={disconnectSession}
                    className="rounded-xl border px-3 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    Back to Connections
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!activeConnection && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative max-w-sm flex-1">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search connections…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border py-1.5 pl-9 pr-4 text-xs outline-none focus:border-orange-500"
                style={{
                  borderColor: "var(--input-border)",
                  background: "var(--input-bg)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {connections.length} {connections.length === 1 ? "connection" : "connections"} configured
            </div>
          </div>

          {connections.length === 0 && !isLoading && (
            <div
              className="rounded-2xl border p-12 text-center"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--bg-elevated)",
              }}
            >
              <div
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border text-orange-400"
                style={{
                  borderColor: "var(--border-subtle)",
                  background: "rgba(249,115,22,0.1)",
                }}
              >
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
                </svg>
              </div>

              <h2 className="mt-4 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                No remote desktop connections yet
              </h2>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Add your Mac or remote computer to control it securely from this dashboard. Multiple machines can be added and switched between instantly.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={handleOpenAdd}
                  className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-orange-600 transition-all active:scale-95"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span>Add Your First Connection</span>
                </button>

                <button
                  onClick={() => setGuideModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition-all hover:bg-neutral-800/20"
                  style={{
                    borderColor: "var(--border-subtle)",
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <svg className="h-4 w-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>How to enable VNC on macOS</span>
                </button>
              </div>
            </div>
          )}

          {filteredConnections.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredConnections.map((conn) => {
                const testResult = testResults[conn.id];
                const isTesting = testingId === conn.id;

                return (
                  <div
                    key={conn.id}
                    className="group relative flex flex-col justify-between rounded-2xl border p-5 transition-all hover:border-orange-500/40 hover:shadow-lg"
                    style={{
                      borderColor: "var(--border-subtle)",
                      background: "var(--bg-elevated)",
                    }}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                            style={{
                              borderColor: `${conn.color || "#f97316"}33`,
                              background: `${conn.color || "#f97316"}18`,
                              color: conn.color || "#f97316",
                            }}
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                              {conn.name}
                            </h3>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400 font-mono">
                              <span>{conn.host}:{conn.port}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleOpenEdit(conn)}
                            className="rounded-lg p-1.5 text-neutral-400 transition-all hover:bg-neutral-800/30 hover:text-white"
                            title="Edit connection"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                          </button>

                          <button
                            onClick={() => handleDuplicate(conn)}
                            className="rounded-lg p-1.5 text-neutral-400 transition-all hover:bg-neutral-800/30 hover:text-white"
                            title="Duplicate connection"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v2.25A2.25 2.25 0 0113.5 21.75h-9a2.25 2.25 0 01-2.25-2.25v-9a2.25 2.25 0 012.25-2.25h2.25m3 3h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9a2.25 2.25 0 012.25-2.25z" />
                            </svg>
                          </button>

                          <button
                            onClick={() => {
                              if (confirm(`Delete connection "${conn.name}"?`)) {
                                deleteMutation.mutate(conn.id);
                              }
                            }}
                            className="rounded-lg p-1.5 text-neutral-400 transition-all hover:bg-rose-500/10 hover:text-rose-400"
                            title="Delete connection"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {conn.hasPassword ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 border bg-neutral-800/40 text-neutral-300"
                            style={{ borderColor: "var(--border-subtle)" }}
                          >
                            <svg className="h-3 w-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-2.25 0h13.5A1.5 1.5 0 0120.25 12v7.5A1.5 1.5 0 0118.75 21h-13.5A1.5 1.5 0 013.75 19.5V12a1.5 1.5 0 011.5-1.5z" />
                            </svg>
                            <span>Saved Pass</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 border text-neutral-500"
                            style={{ borderColor: "var(--border-subtle)" }}
                          >
                            <span>No Password</span>
                          </span>
                        )}

                        {conn.viewOnly && (
                          <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-amber-400">
                            View Only
                          </span>
                        )}

                        <span
                          className="rounded-md border px-2 py-0.5 text-neutral-400"
                          style={{ borderColor: "var(--border-subtle)" }}
                        >
                          Q{conn.quality} · C{conn.compression}
                        </span>

                        <span
                          className="rounded-md border px-2 py-0.5 text-neutral-400 capitalize"
                          style={{ borderColor: "var(--border-subtle)" }}
                        >
                          {conn.scaleMode}
                        </span>
                      </div>

                      {testResult && (
                        <div
                          className={`mt-3 rounded-xl border p-2 text-xs flex items-center justify-between ${
                            testResult.reachable
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                              : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span className={`h-2 w-2 rounded-full ${testResult.reachable ? "bg-emerald-400" : "bg-rose-400"}`} />
                            <span className="truncate">{testResult.reachable ? testResult.banner || "VNC Port Open" : testResult.error || "Unreachable"}</span>
                          </div>
                          <span className="text-[10px] font-mono shrink-0 ml-2">{testResult.latencyMs}ms</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex items-center gap-2 pt-3 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                      <button
                        onClick={() => runTest(conn.host, conn.port, conn.id)}
                        disabled={isTesting}
                        className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all hover:bg-neutral-800/30 disabled:opacity-50"
                        style={{
                          borderColor: "var(--border-subtle)",
                          color: "var(--text-secondary)",
                        }}
                        title="Probe VNC port"
                      >
                        {isTesting ? (
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-orange-400 border-t-transparent" />
                        ) : (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                          </svg>
                        )}
                        <span>{isTesting ? "Testing..." : "Test"}</span>
                      </button>

                      <button
                        onClick={() => connectToConnection(conn)}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white shadow-md transition-all hover:brightness-110 active:scale-[0.98]"
                        style={{
                          background: `linear-gradient(135deg, ${conn.color || "#f97316"} 0%, #ea580c 100%)`,
                          boxShadow: `0 4px 12px ${conn.color || "#f97316"}44`,
                        }}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                        </svg>
                        <span>Connect</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div
            className="w-full max-w-lg rounded-2xl border p-6 shadow-2xl my-8"
            style={{
              borderColor: "var(--border-subtle)",
              background: "var(--bg-elevated)",
            }}
          >
            <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl border"
                  style={{
                    borderColor: `${form.color}44`,
                    background: `${form.color}22`,
                    color: form.color,
                  }}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                    {editingConnection ? "Edit Remote Connection" : "Add Remote Desktop"}
                  </h2>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Configure VNC host address and connection properties
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-neutral-400 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400">
                {formError}
              </div>
            )}

            <div className="mt-5 space-y-4 text-xs">
              <div>
                <label className="block font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                  Connection Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. My MacBook Air, Studio Mac"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-xl border px-3 py-2 outline-none focus:border-orange-500"
                  style={{
                    borderColor: "var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    Host / IP Address <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 100.81.46.106 or 192.168.0.x"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    className="w-full rounded-xl border px-3 py-2 font-mono outline-none focus:border-orange-500"
                    style={{
                      borderColor: "var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    Port
                  </label>
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 5900 })}
                    className="w-full rounded-xl border px-3 py-2 font-mono outline-none focus:border-orange-500"
                    style={{
                      borderColor: "var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium" style={{ color: "var(--text-secondary)" }}>
                    VNC Password {editingConnection?.hasPassword && "(Already Saved)"}
                  </label>
                  {editingConnection?.hasPassword && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, clearPassword: !form.clearPassword, password: "" })}
                      className="text-[11px] text-rose-400 hover:underline"
                    >
                      {form.clearPassword ? "Keep existing password" : "Clear saved password"}
                    </button>
                  )}
                </div>
                {!form.clearPassword && (
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder={editingConnection?.hasPassword ? "Leave blank to keep existing password" : "Optional password..."}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full rounded-xl border px-3 py-2 pr-10 outline-none focus:border-orange-500"
                      style={{
                        borderColor: "var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                    >
                      {showPassword ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
                <p className="mt-1 text-[11px] text-neutral-400">
                  Passwords are encrypted with AES-256-GCM in the secure database.
                </p>
              </div>

              <div>
                <label className="block font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  Accent Color
                </label>
                <div className="flex items-center gap-2">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setForm({ ...form, color: c.hex })}
                      className={`h-7 w-7 rounded-full border-2 transition-all ${
                        form.color === c.hex ? "scale-110 border-white shadow" : "border-transparent opacity-80 hover:opacity-100"
                      }`}
                      style={{ background: c.hex }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <div
                className="rounded-xl border p-3"
                style={{
                  borderColor: "rgba(249,115,22,0.2)",
                  background: "rgba(249,115,22,0.06)",
                }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-sm">💡</span>
                  <div className="text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    <strong className="text-orange-400">Mac Screen Sharing Tip:</strong> In macOS System Settings → Sharing → Screen Sharing → (i) → Computer Settings, enable <em>"VNC viewers may control screen with password"</em>.
                  </div>
                </div>
              </div>

              <div className="border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex w-full items-center justify-between text-xs font-semibold py-1 text-neutral-300 hover:text-white"
                >
                  <span>Advanced Performance & Display</span>
                  <svg
                    className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {showAdvanced && (
                  <div className="mt-3 space-y-3 pt-2">
                    <div>
                      <label className="block font-medium mb-1 text-neutral-400">Starting Performance Mode</label>
                      <select
                        value={form.performanceMode}
                        onChange={(e) => setForm({ ...form, performanceMode: e.target.value as PerformanceMode })}
                        className="w-full rounded-xl border px-3 py-1.5 outline-none text-xs"
                        style={{
                          borderColor: "var(--input-border)",
                          background: "var(--input-bg)",
                          color: "var(--text-primary)",
                        }}
                      >
                        <option value="fast">⚡ Fast (Recommended)</option>
                        <option value="balanced">🚀 Balanced</option>
                        <option value="quality">💎 Crisp</option>
                        <option value="custom">Custom (quality and compression below)</option>
                      </select>
                      <p className="text-[10px] text-neutral-500 mt-0.5">
                        Changing the mode during a session also updates this setting.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block font-medium text-neutral-400">
                            Custom Quality: <span className="font-mono text-white">{form.quality}</span>
                          </label>
                          <span className="text-[10px] text-neutral-500">{form.quality <= 4 ? "⚡ Fast" : form.quality <= 7 ? "🚀 Balanced" : "💎 High"}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="9"
                          value={form.quality}
                          onChange={(e) => setForm({ ...form, quality: Number(e.target.value) })}
                          className="w-full accent-orange-500"
                        />
                        <p className="text-[10px] text-neutral-500 mt-0.5">Lower values reduce image detail and bandwidth</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block font-medium text-neutral-400">
                            Custom Compression: <span className="font-mono text-white">{form.compression}</span>
                          </label>
                          <span className="text-[10px] font-medium text-amber-400">{form.compression === 0 ? "Off" : form.compression <= 2 ? "Light" : "High"}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="9"
                          value={form.compression}
                          onChange={(e) => setForm({ ...form, compression: Number(e.target.value) })}
                          className="w-full accent-orange-500"
                        />
                        <p className="text-[10px] text-neutral-500 mt-0.5">Higher levels send less data but use more host CPU</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium mb-1 text-neutral-400">Scale Mode</label>
                        <select
                          value={form.scaleMode}
                          onChange={(e) => setForm({ ...form, scaleMode: e.target.value as any })}
                          className="w-full rounded-xl border px-3 py-1.5 outline-none text-xs"
                          style={{
                            borderColor: "var(--input-border)",
                            background: "var(--input-bg)",
                            color: "var(--text-primary)",
                          }}
                        >
                          <option value="fit">Fit to Window (Recommended)</option>
                          <option value="original">Original (1:1 Resolution)</option>
                        </select>
                      </div>

                      <div className="flex flex-col justify-center space-y-2 pt-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={form.viewOnly}
                            onChange={(e) => setForm({ ...form, viewOnly: e.target.checked })}
                            className="rounded accent-orange-500"
                          />
                          <span className="text-neutral-300">View-only mode</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={form.showDotCursor}
                            onChange={(e) => setForm({ ...form, showDotCursor: e.target.checked })}
                            className="rounded accent-orange-500"
                          />
                          <span className="text-neutral-300">Show dot cursor</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {modalTestResult && (
                <div
                  className={`rounded-xl border p-2.5 text-xs flex items-center justify-between ${
                    modalTestResult.reachable
                      ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                      : "bg-rose-500/10 border-rose-500/25 text-rose-400"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className={`h-2 w-2 rounded-full ${modalTestResult.reachable ? "bg-emerald-400" : "bg-rose-400"}`} />
                    <span className="truncate">
                      {modalTestResult.reachable ? modalTestResult.banner || "Port open & responsive" : modalTestResult.error || "Connection failed"}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] ml-2 shrink-0">{modalTestResult.latencyMs}ms</span>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
              <button
                type="button"
                onClick={() => runTest(form.host, form.port)}
                disabled={testingModal || !form.host.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all hover:bg-neutral-800/30 disabled:opacity-50"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                {testingModal ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-orange-400 border-t-transparent" />
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                  </svg>
                )}
                <span>{testingModal ? "Testing..." : "Test Connection"}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border px-3.5 py-2 text-xs font-medium"
                  style={{
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-secondary)",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !form.name.trim() || !form.host.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-orange-600 disabled:opacity-50"
                >
                  {saveMutation.isPending && (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  )}
                  <span>{editingConnection ? "Save Changes" : "Create Connection"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {guideModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div
            className="w-full max-w-lg rounded-2xl border p-6 shadow-2xl my-8"
            style={{
              borderColor: "var(--border-subtle)",
              background: "var(--bg-elevated)",
            }}
          >
            <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a2.25 2.25 0 10-4.5 0 2.25 2.25 0 004.5 0zm0 0h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                    How to Enable VNC on macOS
                  </h2>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    3-minute setup to enable browser remote control of your Mac
                  </p>
                </div>
              </div>
              <button
                onClick={() => setGuideModalOpen(false)}
                className="rounded-lg p-1.5 text-neutral-400 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-5 space-y-4 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              <div className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-400 font-bold text-xs">
                  1
                </span>
                <div>
                  <strong className="text-white">Open Sharing Settings:</strong> On your Mac, go to <strong>System Settings</strong> → <strong>General</strong> → <strong>Sharing</strong>.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-400 font-bold text-xs">
                  2
                </span>
                <div>
                  <strong className="text-white">Enable Screen Sharing:</strong> Turn ON the toggle next to <strong>Screen Sharing</strong> (or Remote Management).
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-400 font-bold text-xs">
                  3
                </span>
                <div>
                  <strong className="text-white">Set VNC Password:</strong> Click the <strong>(i)</strong> Info icon next to Screen Sharing, then click <strong>Computer Settings...</strong>. Check <em>"VNC viewers may control screen with password"</em> and choose a password.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-400 font-bold text-xs">
                  4
                </span>
                <div>
                  <strong className="text-white">Get Mac&apos;s IP Address:</strong> Use your local Wi-Fi IP (e.g. <code>192.168.x.x</code>) or your private <strong>Tailscale IP</strong> (e.g. <code>100.81.46.106</code>) if accessing remotely!
                </div>
              </div>

              <div
                className="mt-4 rounded-xl border p-3.5"
                style={{
                  borderColor: "rgba(16,185,129,0.25)",
                  background: "rgba(16,185,129,0.08)",
                }}
              >
                <div className="flex items-center gap-2 font-semibold text-emerald-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Ready to Connect</span>
                </div>
                <p className="mt-1 text-[11px] text-neutral-300">
                  Click <strong>Add Connection</strong> in LetMeCook, enter your Mac&apos;s IP address and the VNC password you set, and click <strong>Connect</strong>!
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
              <button
                onClick={() => setGuideModalOpen(false)}
                className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-orange-600"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {clipboardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-2xl"
            style={{
              borderColor: "var(--border-subtle)",
              background: "var(--bg-card)",
            }}
          >
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border-subtle)" }}>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Paste to Remote Clipboard
              </h3>
              <button onClick={() => setClipboardModalOpen(false)} className="text-neutral-400 hover:text-white">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-3">
              <p className="text-xs text-neutral-400 mb-2">
                Type or paste text below to send it to the Mac clipboard:
              </p>
              <textarea
                autoFocus
                rows={4}
                value={clipboardText}
                onChange={(e) => setClipboardText(e.target.value)}
                placeholder="Paste text here..."
                className="w-full rounded-xl border p-2.5 text-xs outline-none focus:border-orange-500 font-mono"
                style={{
                  borderColor: "var(--input-border)",
                  background: "var(--input-bg)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setClipboardModalOpen(false)}
                className="rounded-xl border px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-white"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                Cancel
              </button>
              <button
                onClick={handlePasteClipboard}
                disabled={!clipboardText.trim()}
                className="rounded-xl bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-orange-600 disabled:opacity-50"
              >
                Send to Mac
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
