"use client";

import type { ReactNode } from "react";
import AppHeader from "@/components/app-header";
import QuestSidebar from "@/components/quest-sidebar";
import { SearchProvider } from "@/components/search-context";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <SearchProvider>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <AppHeader />
        <QuestSidebar />
        <main className="mx-auto max-w-7xl px-4 pt-24 pb-7 sm:px-6 lg:pl-60">
          {children}
        </main>
      </div>
    </SearchProvider>
  );
}
