"use client";

import { SlidersHorizontal } from "lucide-react";
import type { BackendState } from "./App";
import { Logo } from "./Logo";

export function engineSummary(backend: BackendState): { tone: "ok" | "warn" | "wait"; label: string } {
  if (backend.status === "checking") return { tone: "wait", label: "Checking engine…" };
  if (backend.ok) return { tone: "ok", label: backend.voice ? "Server engine · Whisper" : "Server engine" };
  return { tone: "warn", label: "Browser engine" };
}

const DOT: Record<string, string> = { ok: "bg-go", warn: "bg-amber", wait: "bg-dim animate-pulse" };

export function Header({ backend, onOpenSources, onHome, showNewSearch }: {
  backend: BackendState;
  onOpenSources: () => void;
  onHome: () => void;
  showNewSearch: boolean;
}) {
  const s = engineSummary(backend);
  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-8 sm:py-4">
        <button type="button" onClick={onHome} className="flex items-center gap-2.5 rounded-lg" aria-label="LyricSpot home">
          <Logo />
          <span className="font-display text-xl font-bold tracking-tight sm:text-[22px]">LyricSpot</span>
        </button>
        <nav className="flex items-center gap-2">
          {showNewSearch && (
            <button type="button" onClick={onHome} className="btn-light h-10 rounded-full px-4 text-sm">
              New search
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSources}
            className="btn-ghost hidden h-10 rounded-full bg-surface px-4 text-sm font-medium sm:inline-flex"
            aria-label={"Search sources: " + s.label}
          >
            <span className={"h-2 w-2 rounded-full " + DOT[s.tone]} aria-hidden="true" />
            {s.label}
          </button>
          <button
            type="button"
            onClick={onOpenSources}
            className="btn-ghost h-10 w-10 rounded-full bg-surface"
            aria-label="Search sources and API keys"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" />
          </button>
        </nav>
      </div>
    </header>
  );
}
