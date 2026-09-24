"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Header } from "./Header";
import { Composer, type InputMode } from "./Composer";
import { SearchProgress } from "./SearchProgress";
import { Results } from "./Results";
import { SourcesPanel } from "./SourcesPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { checkBackendHealth, type BackendInfo } from "@/lib/api";
import {
  searchText,
  searchAudio,
  isAbort,
  SearchError,
  addRecent,
  getRecent,
  type Progress,
  type SearchResponse,
  type RecentSearch,
} from "@/lib/engine";

export type BackendState = { status: "checking" } | ({ status: "ready" } & BackendInfo);

type Phase =
  | { kind: "compose" }
  | { kind: "searching"; query: string | null; progress: Progress }
  | { kind: "results"; response: SearchResponse }
  | { kind: "error"; message: string; hint?: string; query: string | null };

function readQueryParam(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get("q");
    return q && q.trim() ? q.trim().slice(0, 300) : null;
  } catch {
    return null;
  }
}

function writeQueryParam(q: string | null, push: boolean) {
  try {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    if (url.href === window.location.href) return;
    if (push) window.history.pushState({ q }, "", url);
    else window.history.replaceState({ q }, "", url);
  } catch {
    // history unavailable (sandboxed iframes) — search still works
  }
}

export default function App() {
  const [backend, setBackend] = useState<BackendState>({ status: "checking" });
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [mode, setMode] = useState<InputMode>("voice");
  const [draft, setDraft] = useState("");
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const probeBackend = useCallback(async () => {
    setBackend({ status: "checking" });
    const info = await checkBackendHealth();
    setBackend({ status: "ready", ...info });
    return info;
  }, []);

  const useBackend = backend.status === "ready" && backend.ok;

  const finish = useCallback((response: SearchResponse, query: string, pushUrl: boolean) => {
    setPhase({ kind: "results", response });
    const top = response.matches[0];
    setRecent(addRecent({ query, song: top?.song, artist: top?.artist, at: Date.now() }));
    writeQueryParam(query, pushUrl);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const fail = useCallback((err: unknown, query: string | null) => {
    if (isAbort(err)) return;
    if (err instanceof SearchError) setPhase({ kind: "error", message: err.message, hint: err.hint, query });
    else setPhase({ kind: "error", message: "Something went wrong while searching.", hint: "Please try again.", query });
  }, []);

  const runText = useCallback(async (text: string, opts: { pushUrl?: boolean; backendOk?: boolean } = {}) => {
    const query = text.replace(/\s+/g, " ").trim();
    if (!query) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft(query);
    setPhase({ kind: "searching", query, progress: { stage: "searching", message: "Searching lyric databases…" } });
    try {
      const response = await searchText(query, {
        signal: controller.signal,
        useBackend: opts.backendOk ?? useBackend,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setPhase({ kind: "searching", query, progress });
        },
      });
      if (!controller.signal.aborted) finish(response, query, opts.pushUrl ?? true);
    } catch (err) {
      if (!controller.signal.aborted) fail(err, query);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [useBackend, finish, fail]);

  const runAudio = useCallback(async (blob: Blob) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "searching", query: null, progress: { stage: "transcribing", message: "Transcribing your singing…" } });
    try {
      const response = await searchAudio(blob, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setPhase({ kind: "searching", query: null, progress });
        },
      });
      if (!controller.signal.aborted) {
        setDraft(response.transcript);
        finish(response, response.transcript, true);
      }
    } catch (err) {
      if (!controller.signal.aborted) fail(err, null);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [finish, fail]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ kind: "compose" });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ kind: "compose" });
    writeQueryParam(null, true);
  }, []);

  const editQuery = useCallback((text: string) => {
    setDraft(text);
    setMode("text");
    setPhase({ kind: "compose" });
    writeQueryParam(null, true);
  }, []);

  // Boot: probe the backend, then run a shared ?q= search if present.
  useEffect(() => {
    setRecent(getRecent());
    let cancelled = false;
    (async () => {
      const info = await probeBackend();
      if (cancelled) return;
      const q = readQueryParam();
      if (q) {
        setMode("text");
        runText(q, { pushUrl: false, backendOk: info.ok });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back/forward: follow the ?q= in the URL.
  useEffect(() => {
    const onPop = () => {
      const q = readQueryParam();
      if (q) runText(q, { pushUrl: false });
      else {
        abortRef.current?.abort();
        setPhase({ kind: "compose" });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [runText]);

  const compact = phase.kind === "results";

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        backend={backend}
        onOpenSources={() => setSourcesOpen(true)}
        onHome={reset}
        showNewSearch={phase.kind !== "compose"}
      />
      <ErrorBoundary onReset={reset}>
        <main className={"mx-auto flex w-full flex-1 flex-col px-4 sm:px-8 " + (compact ? "max-w-6xl pb-16 pt-6 sm:pt-10" : "max-w-3xl items-center pb-16 pt-10 sm:pt-16")}>
          <AnimatePresence mode="wait" initial={false}>
            {phase.kind === "results" ? (
              <motion.div key="results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="w-full">
                <Results response={phase.response} backend={backend} onEdit={editQuery} onNewSearch={reset} onOpenSources={() => setSourcesOpen(true)} />
              </motion.div>
            ) : phase.kind === "searching" ? (
              <motion.div key="searching" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="w-full">
                <SearchProgress query={phase.query} progress={phase.progress} onCancel={cancel} />
              </motion.div>
            ) : (
              <motion.div key="compose" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="w-full">
                <Composer
                  mode={mode}
                  onModeChange={setMode}
                  draft={draft}
                  onDraftChange={setDraft}
                  backend={backend}
                  recent={recent}
                  onRecentCleared={() => setRecent([])}
                  onSearchText={(t) => runText(t)}
                  onSearchAudio={runAudio}
                  error={phase.kind === "error" ? { message: phase.message, hint: phase.hint } : null}
                  onDismissError={() => setPhase({ kind: "compose" })}
                  onOpenSources={() => setSourcesOpen(true)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </ErrorBoundary>
      <footer className="border-t border-line/60 px-4 py-6 text-center text-[13px] text-faint sm:px-8">
        Lyrics from LRCLIB, Genius and more · Nothing you sing is stored ·{" "}
        <a className="text-soft underline decoration-line underline-offset-4 hover:text-text" href="https://github.com/Shashwat1729/lyricspot" target="_blank" rel="noreferrer">Source on GitHub</a>
      </footer>
      <SourcesPanel open={sourcesOpen} onClose={() => setSourcesOpen(false)} backend={backend} onBackendChanged={probeBackend} />
    </div>
  );
}
