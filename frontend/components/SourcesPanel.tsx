"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import type { BackendState } from "./App";
import { getApiBase, getApiBaseOverride, sanitizeApiBase, setApiBaseOverride } from "@/lib/api";
import {
  getMusicKeys,
  setMusicKeys,
  clearMusicKeys,
  storageWritable,
  getAiAssist,
  setAiAssist,
  testGeniusKey,
  testMusixmatchKey,
  testSpotifyKeys,
  testGoogleKeys,
  testGeminiKey,
  type MusicKeys,
} from "@/lib/musicKeys";

type TestResult = { ok: boolean; detail: string } | null;

interface Provider {
  id: string;
  name: string;
  gives: string;
  fields: { key: keyof MusicKeys; label: string; secret?: boolean }[];
  getUrl: string;
  getLabel: string;
  test: (k: MusicKeys) => Promise<{ ok: boolean; detail: string }>;
}

const PROVIDERS: Provider[] = [
  {
    id: "spotify",
    name: "Spotify",
    gives: "Exact tracks for the player, plus popularity ranking",
    fields: [
      { key: "spotifyId", label: "Client ID" },
      { key: "spotifySecret", label: "Client secret", secret: true },
    ],
    getUrl: "https://developer.spotify.com/dashboard",
    getLabel: "developer.spotify.com/dashboard",
    test: (k) => testSpotifyKeys(k.spotifyId, k.spotifySecret),
  },
  {
    id: "genius",
    name: "Genius",
    gives: "Official lyric search (more reliable than keyless)",
    fields: [{ key: "genius", label: "Client access token", secret: true }],
    getUrl: "https://genius.com/api-clients",
    getLabel: "genius.com/api-clients",
    test: (k) => testGeniusKey(k.genius),
  },
  {
    id: "musixmatch",
    name: "Musixmatch",
    gives: "Lyrics-to-song index with millions of tracks",
    fields: [{ key: "musixmatch", label: "API key", secret: true }],
    getUrl: "https://developer.musixmatch.com/",
    getLabel: "developer.musixmatch.com",
    test: (k) => testMusixmatchKey(k.musixmatch),
  },
  {
    id: "google",
    name: "Google search",
    gives: "Web-wide lyric pages (100 free searches a day)",
    fields: [
      { key: "googleKey", label: "API key", secret: true },
      { key: "googleCx", label: "Search engine ID" },
    ],
    getUrl: "https://programmablesearchengine.google.com/",
    getLabel: "programmablesearchengine.google.com",
    test: (k) => testGoogleKeys(k.googleKey, k.googleCx),
  },
  {
    id: "gemini",
    name: "Gemini",
    gives: "Fixes misspelled or romanized lines before searching",
    fields: [{ key: "geminiKey", label: "API key", secret: true }],
    getUrl: "https://aistudio.google.com/apikey",
    getLabel: "aistudio.google.com/apikey",
    test: (k) => testGeminiKey(k.geminiKey),
  },
];

function configured(p: Provider, k: MusicKeys): boolean {
  return p.fields.every((f) => !!k[f.key]);
}

export function SourcesPanel({ open, onClose, backend, onBackendChanged }: {
  open: boolean;
  onClose: () => void;
  backend: BackendState;
  onBackendChanged: () => Promise<unknown>;
}) {
  const [keys, setKeys] = useState<MusicKeys>(() => getMusicKeys());
  const [saved, setSaved] = useState<MusicKeys>(() => getMusicKeys());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [aiAssist, setAi] = useState(true);
  const [storageOk, setStorageOk] = useState(true);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const k = getMusicKeys();
    setKeys(k);
    setSaved(k);
    setTests({});
    setExpanded(null);
    setAi(getAiAssist());
    setStorageOk(storageWritable());
    setUrl(getApiBaseOverride() ?? "");
    setUrlError(null);
    setTimeout(() => closeRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const saveProvider = async (p: Provider) => {
    const next = { ...saved };
    for (const f of p.fields) next[f.key] = keys[f.key].trim();
    setMusicKeys(next);
    setSaved(getMusicKeys());
    setTesting(p.id);
    setTests((t) => ({ ...t, [p.id]: null }));
    try {
      const r = await p.test(next);
      setTests((t) => ({ ...t, [p.id]: r }));
      if (r.ok) setExpanded(null);
    } catch {
      setTests((t) => ({ ...t, [p.id]: { ok: false, detail: "The test failed unexpectedly." } }));
    }
    setTesting(null);
  };

  const removeProvider = (p: Provider) => {
    const next = { ...saved };
    for (const f of p.fields) next[f.key] = "";
    setMusicKeys(next);
    const now = getMusicKeys();
    setSaved(now);
    setKeys(now);
    setTests((t) => ({ ...t, [p.id]: null }));
  };

  const connectBackend = async () => {
    const raw = url.trim();
    if (raw && !sanitizeApiBase(raw)) {
      setUrlError("Enter a full URL like http://localhost:8000");
      return;
    }
    setUrlError(null);
    setApiBaseOverride(raw || null);
    setChecking(true);
    await onBackendChanged();
    setChecking(false);
  };

  const engineLine = backend.status === "checking"
    ? { tone: "bg-dim", title: "Checking…", detail: "" }
    : backend.ok
      ? { tone: "bg-go", title: "Server engine", detail: backend.detail }
      : { tone: "bg-amber", title: "Browser engine", detail: "Searching directly from your browser. " + (backend.detail || "") };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.button
            type="button"
            aria-label="Close sources panel"
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="sources-title"
            className="absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col border-l border-line bg-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.22 }}
          >
            <header className="flex items-center justify-between border-b border-well px-5 py-5 sm:px-7">
              <h2 id="sources-title" className="font-display text-2xl font-bold tracking-tight">Search sources</h2>
              <button ref={closeRef} type="button" onClick={onClose} className="btn-ghost h-11 w-11 rounded-full" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-5 py-6 sm:px-7">
              <section className="flex flex-col gap-2.5">
                <p className="eyebrow">Engine</p>
                <div className="flex flex-col gap-3.5 rounded-xl2 border border-line bg-raised p-4">
                  <div className="flex items-start gap-2.5">
                    <span className={"mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " + engineLine.tone} aria-hidden="true" />
                    <div className="flex-1">
                      <p className="font-semibold">{engineLine.title}</p>
                      {engineLine.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{engineLine.detail}</p>}
                    </div>
                  </div>
                  <label className="flex flex-col gap-1.5 text-[13px] text-muted">
                    Backend URL (optional)
                    <input
                      type="url"
                      inputMode="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder={getApiBase()}
                      className="h-11 rounded-xl border border-line bg-ink px-3.5 font-mono text-sm text-text placeholder:text-dim focus:border-faint focus:outline-none"
                    />
                  </label>
                  {urlError && <p className="text-[13px] text-alert-text">{urlError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={connectBackend} disabled={checking} className="btn-light h-10 rounded-full px-4 text-sm">
                      {checking && <Loader2 className="h-4 w-4 animate-spin" />}
                      {url.trim() ? "Save and test" : "Test connection"}
                    </button>
                    {getApiBaseOverride() && (
                      <button type="button" onClick={() => { setUrl(""); setApiBaseOverride(null); onBackendChanged(); }} className="btn-ghost h-10 rounded-full px-4 text-sm">
                        Use default
                      </button>
                    )}
                  </div>
                  <p className="text-[13px] leading-relaxed text-faint">
                    Run <code className="font-mono text-soft">backend/</code> yourself for Whisper voice transcription and more sources. Set <code className="font-mono text-soft">CORS_ORIGINS</code> to this site's address.
                  </p>
                </div>
              </section>

              <section className="flex flex-col gap-2.5">
                <p className="eyebrow">Always on, no key needed</p>
                <div className="flex flex-wrap gap-2">
                  {["LRCLIB lyrics", "Genius search", "iTunes catalog", "Deezer via lyrics.ovh", "Spotify link via song.link"].map((s) => (
                    <span key={s} className="flex h-8 items-center rounded-full border border-line bg-raised px-3 text-[13px]">{s}</span>
                  ))}
                </div>
              </section>

              <section className="flex flex-col gap-2.5">
                <p className="eyebrow">Optional free keys</p>
                <ul className="flex flex-col rounded-xl2 border border-line bg-raised">
                  {PROVIDERS.map((p, idx) => {
                    const on = configured(p, saved);
                    const isOpen = expanded === p.id;
                    const t = tests[p.id];
                    return (
                      <li key={p.id} className={idx < PROVIDERS.length - 1 ? "border-b border-line" : ""}>
                        <div className="flex items-center gap-3 px-4 py-3.5">
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="font-semibold">{p.name}</span>
                            <span className="text-[13px] text-muted">{p.gives}</span>
                          </div>
                          {on && !isOpen && (
                            <span className="flex h-[26px] items-center gap-1 rounded-full bg-go/[0.14] px-2.5 text-xs font-semibold text-go-text">
                              <Check className="h-3 w-3" strokeWidth={3} /> Added
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : p.id)}
                            aria-expanded={isOpen}
                            className="btn-ghost h-9 shrink-0 rounded-full px-3.5 text-[13px] text-text"
                          >
                            {isOpen ? "Close" : on ? "Edit" : "Add key"}
                          </button>
                        </div>
                        {isOpen && (
                          <div className="flex flex-col gap-3 px-4 pb-4">
                            {p.fields.map((f) => (
                              <label key={f.key} className="flex flex-col gap-1.5 text-[13px] text-muted">
                                {f.label}
                                <input
                                  type={f.secret ? "password" : "text"}
                                  autoComplete="off"
                                  spellCheck={false}
                                  value={keys[f.key]}
                                  onChange={(e) => setKeys((k) => ({ ...k, [f.key]: e.target.value }))}
                                  className="h-11 rounded-xl border border-line bg-ink px-3.5 font-mono text-sm text-text focus:border-faint focus:outline-none"
                                />
                              </label>
                            ))}
                            <p className="text-[13px] text-faint">
                              Free at{" "}
                              <a href={p.getUrl} target="_blank" rel="noreferrer" className="text-go-text underline decoration-go/40 underline-offset-4">{p.getLabel}</a>
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button type="button" onClick={() => saveProvider(p)} disabled={testing === p.id || !p.fields.every((f) => keys[f.key].trim())} className="btn-light h-10 rounded-full px-4 text-sm">
                                {testing === p.id && <Loader2 className="h-4 w-4 animate-spin" />}
                                Save and test
                              </button>
                              {on && (
                                <button type="button" onClick={() => removeProvider(p)} className="btn-ghost h-10 rounded-full px-4 text-sm">Remove</button>
                              )}
                            </div>
                          </div>
                        )}
                        {t && (
                          <p role="status" className={"px-4 pb-3.5 text-[13px] " + (t.ok ? "text-go-text" : "text-alert-text")}>{t.detail}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {configured(PROVIDERS[4], saved) && (
                  <label className="flex items-center justify-between gap-3 rounded-xl2 border border-line bg-raised px-4 py-3.5">
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold">Use Gemini query help</span>
                      <span className="text-[13px] text-muted">Off = pure lyric matching, no AI.</span>
                    </span>
                    <input type="checkbox" checked={aiAssist} onChange={(e) => { setAi(e.target.checked); setAiAssist(e.target.checked); }} className="h-5 w-5 accent-[#1ED760]" />
                  </label>
                )}
                <p className="text-[13px] leading-relaxed text-faint">
                  {storageOk
                    ? "Keys stay in this browser only and go straight to each provider."
                    : "This browser blocks site storage, so keys last until you close the tab."}
                </p>
                {Object.values(saved).some(Boolean) && (
                  <button type="button" onClick={() => { clearMusicKeys(); const k = getMusicKeys(); setSaved(k); setKeys(k); setTests({}); }} className="self-start text-[13px] text-faint underline underline-offset-4 hover:text-text">
                    Remove all keys
                  </button>
                )}
              </section>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
