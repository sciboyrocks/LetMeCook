"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { getQuickLinks, addQuickLink, deleteQuickLink, type QuickLink } from "../lib/api";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zm10-2a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z" />
      </svg>
    ),
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: "/quest",
    label: "Worker Logs",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    href: "/journal",
    label: "Journal",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    href: "/monitor",
    label: "Monitor",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-1.5M12 12.75l3-1.5m0 0l1.5-.75M12 12.75l-3-1.5m0 0l-1.5-.75" />
      </svg>
    ),
  },
  {
    href: "/connections",
    label: "Connections",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
      </svg>
    ),
  },
];

export default function QuestSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<number>(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>([]);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Load quick links from backend
  useEffect(() => {
    getQuickLinks().then((res) => {
      if (res.ok) setQuickLinks(res.data);
    });
  }, []);

  const handleAddLink = useCallback(async () => {
    const title = newTitle.trim();
    const rawUrl = newUrl.trim();
    if (!title || !rawUrl || saving) return;
    const url =
      rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
        ? rawUrl
        : `https://${rawUrl}`;
    let faviconUrl: string | undefined;
    try {
      const domain = new URL(url).hostname;
      faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
      // invalid URL — no favicon
    }
    setSaving(true);
    const res = await addQuickLink(title, url, faviconUrl);
    setSaving(false);
    if (res.ok) {
      setQuickLinks((prev) => [...prev, res.data]);
      setNewTitle("");
      setNewUrl("");
      setAddLinkOpen(false);
    }
  }, [newTitle, newUrl, saving]);

  const handleDeleteLink = useCallback(async (id: string) => {
    setQuickLinks((prev) => prev.filter((l) => l.id !== id));
    await deleteQuickLink(id);
  }, []);

  // Measure header height dynamically
  useEffect(() => {
    const header = document.querySelector("header");
    if (header) {
      const h = header.getBoundingClientRect().height;
      setHeaderHeight(h);
      headerRef.current = h;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        setHeaderHeight(h);
        headerRef.current = h;
      }
    });
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const isActive = useCallback(
    (href: string) => {
      if (href === "/dashboard")
        return pathname === "/dashboard" || pathname?.startsWith("/projects/");
      return pathname === href || pathname?.startsWith(href + "/");
    },
    [pathname]
  );

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Nav items */}
      <div className="px-3 pt-5 pb-3">
        <p
          className="mb-3 px-2 text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{ color: "var(--text-muted)", letterSpacing: "0.12em" }}
        >
          Menu
        </p>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ href, label, icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={[
                  "sidebar-nav-item group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
                  active ? "sidebar-nav-active" : "",
                ].join(" ")}
                style={{
                  color: active ? "#f97316" : "var(--text-secondary)",
                  background: active
                    ? "linear-gradient(90deg, rgba(249,115,22,0.08) 0%, rgba(249,115,22,0.03) 100%)"
                    : "transparent",
                  borderLeft: active ? "2px solid #f97316" : "2px solid transparent",
                }}
              >
                <span
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-all duration-200"
                  style={{
                    color: active ? "#f97316" : "var(--text-muted)",
                    background: active ? "rgba(249,115,22,0.12)" : "transparent",
                  }}
                >
                  {icon}
                </span>
                <span className="transition-colors duration-200">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Divider */}
      <div className="mx-4 my-1 h-px" style={{ background: "var(--border-subtle)" }} />

      {/* Quick links section */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: "var(--text-muted)", letterSpacing: "0.12em" }}
          >
            Quick Links
          </p>
          <button
            onClick={() => setAddLinkOpen(true)}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
            title="Add a quick link"
            aria-label="Add quick link"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {quickLinks.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-3" style={{ borderColor: "var(--border-subtle)" }}>
            <p className="mb-1 text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
              Your shortcuts live here
            </p>
            <p className="text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Hit <span className="font-bold">+</span> to add links to tools, dashboards, docs — anything you visit often.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {quickLinks.map((link) => (
              <div key={link.id} className="group flex items-center gap-1">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition-colors hover:bg-white/5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {link.faviconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={link.faviconUrl}
                      alt=""
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5 flex-shrink-0 rounded-sm object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                        const sibling = e.currentTarget.nextElementSibling as HTMLElement | null;
                        if (sibling) sibling.style.display = "block";
                      }}
                    />
                  ) : null}
                  <svg
                    className="h-3 w-3 flex-shrink-0 opacity-50"
                    style={{ display: link.faviconUrl ? "none" : "block" }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  <span className="truncate">{link.title}</span>
                </a>
                <button
                  onClick={() => handleDeleteLink(link.id)}
                  className="mr-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded opacity-0 transition-all group-hover:opacity-100 hover:bg-white/10"
                  style={{ color: "var(--text-muted)" }}
                  title="Remove link"
                  aria-label={`Remove ${link.title}`}
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-5 py-3" style={{ borderColor: "var(--border-subtle)" }}>
        <a
          href="https://samrudhraikote.me"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] transition-colors hover:text-orange-400"
          style={{ color: "var(--text-muted)" }}
        >
          Built by Samrudh ↗
        </a>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle button — floats below header on small screens */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 z-20 flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm transition-all duration-200 hover:border-orange-500/30 hover:shadow-orange-500/10 lg:hidden"
        style={{
          top: headerHeight ? headerHeight + 8 : 72,
          borderColor: "var(--border-subtle)",
          background: "var(--bg-elevated)",
          color: "var(--text-secondary)",
        }}
        aria-label="Open navigation"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 border-r shadow-2xl transition-transform duration-300 ease-out lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-elevated)",
        }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="LetMeCook"
              width={28}
              height={28}
              className="h-7 w-7 object-contain"
            />
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              LetMeCook
            </span>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1.5 transition-colors hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close navigation"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar — positioned below the sticky header */}
      <aside
        className="fixed bottom-0 left-0 z-10 hidden w-56 border-r lg:block"
        style={{
          top: headerHeight || 77,
          borderColor: "var(--border-subtle)",
          background: "var(--bg-base)",
        }}
      >
        {sidebarContent}
      </aside>

      {/* Sidebar hover styles */}
      <style jsx global>{`
        .sidebar-nav-item:not(.sidebar-nav-active):hover {
          background: var(--bg-card) !important;
          color: var(--text-primary) !important;
          border-left-color: var(--text-muted) !important;
        }
        .sidebar-nav-item:not(.sidebar-nav-active):hover span:first-child {
          color: var(--text-secondary) !important;
          background: var(--bg-card) !important;
        }
      `}</style>

      {/* Add Quick Link dialog */}
      {addLinkOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setAddLinkOpen(false); setNewTitle(""); setNewUrl(""); }}
          />
          <div
            className="relative w-full max-w-sm rounded-xl border p-6 shadow-2xl"
            style={{ background: "var(--bg-elevated)", borderColor: "var(--border-subtle)" }}
          >
            <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Add Quick Link
            </h2>
            <p className="mb-5 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Save any website as a shortcut in your sidebar — tools, dashboards, docs, or anything you visit frequently.
            </p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
                  Title
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. GitHub, Vercel, Linear"
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none transition focus:border-orange-500/60"
                  style={{
                    background: "var(--bg-base)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
                  URL
                </label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none transition focus:border-orange-500/60"
                  style={{
                    background: "var(--bg-base)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => { setAddLinkOpen(false); setNewTitle(""); setNewUrl(""); }}
                className="rounded-lg px-3 py-1.5 text-[12px] transition hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddLink}
                disabled={!newTitle.trim() || !newUrl.trim() || saving}
                className="rounded-lg bg-orange-500 px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Adding..." : "Add Link"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}