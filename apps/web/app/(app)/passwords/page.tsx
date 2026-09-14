"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPasswordEntry,
  deletePasswordEntry,
  getPasswords,
  type PasswordEntry,
  updatePasswordEntry,
} from "@/lib/api";

type FormState = {
  title: string;
  username: string;
  website: string;
  password: string;
  totpSecret: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  username: "",
  website: "",
  password: "",
  totpSecret: "",
  notes: "",
};

function getWebsiteHostname(website: string): string | null {
  const value = website.trim();
  if (!value) return null;

  try {
    const normalized = value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

function getWebsiteFaviconUrl(website: string): string | null {
  const hostname = getWebsiteHostname(website);
  if (!hostname) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
}

export default function PasswordsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PasswordEntry | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["passwords"],
    queryFn: async () => {
      const res = await getPasswords();
      return res.ok ? res.data : [];
    },
    refetchInterval: 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        const res = await updatePasswordEntry(editing.id, {
          title: form.title,
          username: form.username,
          website: form.website,
          notes: form.notes,
          password: form.password,
          totpSecret: form.totpSecret,
        });
        if (!res.ok) throw new Error(res.error.message);
        return res;
      }

      const res = await createPasswordEntry({
        title: form.title,
        username: form.username,
        website: form.website,
        notes: form.notes,
        password: form.password,
        totpSecret: form.totpSecret,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res;
    },
    onSuccess: async () => {
      setEditorOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["passwords"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to save entry"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await deletePasswordEntry(id);
      if (!res.ok) throw new Error(res.error.message);
      return res;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["passwords"] });
    },
  });

  const clearSecretMutation = useMutation({
    mutationFn: async ({ id, field }: { id: string; field: "password" | "totp" }) => {
      const res = await updatePasswordEntry(id, {
        ...(field === "password" ? { clearPassword: true } : { clearTotp: true }),
      });
      if (!res.ok) throw new Error(res.error.message);
      return res;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["passwords"] });
    },
  });

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((entry) => {
      return (
        entry.title.toLowerCase().includes(term) ||
        entry.username.toLowerCase().includes(term) ||
        entry.website.toLowerCase().includes(term) ||
        entry.notes.toLowerCase().includes(term)
      );
    });
  }, [entries, query]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setEditorOpen(true);
  }

  function openEdit(entry: PasswordEntry) {
    setEditing(entry);
    setForm({
      title: entry.title,
      username: entry.username,
      website: entry.website,
      password: entry.password,
      totpSecret: "",
      notes: entry.notes,
    });
    setError(null);
    setEditorOpen(true);
  }

  async function copy(text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // no-op
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Password Manager</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Store credentials and view TOTP codes from one place.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="ml-auto rounded-lg px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)" }}
        >
          Add Entry
        </button>
      </div>

      <div className="rounded-xl border p-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, username, website or notes"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
        />
      </div>

      {isLoading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading vault…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No password entries yet.</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Create one and optionally attach a TOTP secret.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((entry) => {
            const visible = !!visiblePasswords[entry.id];
            const faviconUrl = getWebsiteFaviconUrl(entry.website);
            const hostname = getWebsiteHostname(entry.website);
            return (
              <div
                key={entry.id}
                className="rounded-xl border p-4"
                style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
              >
                <div className="flex items-start gap-2">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
                    style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}
                    title={hostname ?? "Website"}
                  >
                    {faviconUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={faviconUrl}
                          alt=""
                          width={18}
                          height={18}
                          className="h-[18px] w-[18px] rounded-sm object-contain"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                            const sibling = e.currentTarget.nextElementSibling as HTMLElement | null;
                            if (sibling) sibling.style.display = "block";
                          }}
                        />
                        <svg
                          className="h-4 w-4"
                          style={{ color: "var(--text-muted)", display: "none" }}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.8}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                          />
                        </svg>
                      </>
                    ) : (
                      <svg
                        className="h-4 w-4"
                        style={{ color: "var(--text-muted)" }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.8}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {entry.title}
                    </h2>
                    <p className="truncate text-xs" style={{ color: "var(--text-secondary)" }}>
                      {entry.username || "No username"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(entry)}
                      className="rounded-md border px-2 py-1 text-[11px] font-medium"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete ${entry.title}?`)) deleteMutation.mutate(entry.id);
                      }}
                      className="rounded-md border border-red-500/30 px-2 py-1 text-[11px] font-medium text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-2 text-xs">
                  <div className="rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}>
                    <div className="mb-1 flex items-center justify-between">
                      <span style={{ color: "var(--text-muted)" }}>Password</span>
                      <div className="flex items-center gap-1">
                        {entry.password ? (
                          <>
                            <button
                              onClick={() => copy(entry.password)}
                              title="Copy password"
                              className="flex h-5 w-5 items-center justify-center rounded"
                              style={{ color: "var(--text-secondary)", background: "rgba(148,163,184,0.12)" }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            </button>
                            <button
                              onClick={() =>
                                setVisiblePasswords((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))
                              }
                              title={visible ? "Hide password" : "Show password"}
                              className="flex h-5 w-5 items-center justify-center rounded"
                              style={{ color: "var(--text-secondary)", background: "rgba(148,163,184,0.12)" }}
                            >
                              {visible ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                              )}
                            </button>
                            <button
                              onClick={() => clearSecretMutation.mutate({ id: entry.id, field: "password" })}
                              title="Clear password"
                              className="flex h-5 w-5 items-center justify-center rounded text-red-500"
                              style={{ background: "rgba(248,113,113,0.15)" }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>Empty</span>
                        )}
                      </div>
                    </div>
                    <p className="break-all font-mono" style={{ color: "var(--text-primary)" }}>
                      {entry.password ? (visible ? entry.password : "•".repeat(Math.min(entry.password.length, 18))) : "No password saved"}
                    </p>
                  </div>

                  <div className="rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}>
                    <div className="mb-1 flex items-center justify-between">
                      <span style={{ color: "var(--text-muted)" }}>Authenticator (TOTP)</span>
                      <div className="flex items-center gap-1">
                        {entry.totp ? (
                          <>
                            <button
                              onClick={() => copy(entry.totp?.code ?? "")}
                              title="Copy TOTP code"
                              className="flex h-5 w-5 items-center justify-center rounded"
                              style={{ color: "var(--text-secondary)", background: "rgba(148,163,184,0.12)" }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            </button>
                            <button
                              onClick={() => clearSecretMutation.mutate({ id: entry.id, field: "totp" })}
                              title="Clear TOTP secret"
                              className="flex h-5 w-5 items-center justify-center rounded text-red-500"
                              style={{ background: "rgba(248,113,113,0.15)" }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>Empty</span>
                        )}
                      </div>
                    </div>
                    {entry.totp ? (
                      <div className="flex items-center gap-3">
                        <p className="font-mono text-lg font-semibold tracking-wider" style={{ color: "var(--text-primary)" }}>
                          {entry.totp.code}
                        </p>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ color: "#f59e0b", background: "rgba(245,158,11,0.15)" }}
                        >
                          {entry.totp.expiresIn}s
                        </span>
                      </div>
                    ) : (
                      <p style={{ color: "var(--text-muted)" }}>No TOTP secret saved</p>
                    )}
                  </div>

                  {entry.notes && (
                    <p className="rounded-lg border p-2 text-[11px] leading-relaxed" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                      {entry.notes}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editorOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                {editing ? "Edit Entry" : "New Entry"}
              </h3>
              <button
                onClick={() => {
                  setEditorOpen(false);
                  setError(null);
                }}
                className="rounded px-2 py-1 text-xs"
                style={{ color: "var(--text-muted)", background: "rgba(148,163,184,0.12)" }}
              >
                Close
              </button>
            </div>

            <div className="grid gap-3">
              <Field label="Title *">
                <input
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username / Email">
                  <input
                    value={form.username}
                    onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
                  />
                </Field>
                <Field label="Website">
                  <input
                    value={form.website}
                    onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
                  />
                </Field>
              </div>

              <Field label="Password">
                <input
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
                />
              </Field>

              <Field label="TOTP Secret or otpauth:// URL">
                <input
                  value={form.totpSecret}
                  onChange={(e) => setForm((prev) => ({ ...prev, totpSecret: e.target.value }))}
                  placeholder="JBSWY3DPEHPK3PXP or otpauth://..."
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
                />
              </Field>

              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
                />
              </Field>
            </div>

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditorOpen(false);
                  setError(null);
                }}
                className="rounded-lg border px-3 py-2 text-xs font-medium"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !form.title.trim()}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)" }}
              >
                {saveMutation.isPending ? "Saving..." : editing ? "Save Changes" : "Create Entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
