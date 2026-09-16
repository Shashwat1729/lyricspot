'use client';

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { KeyRound, X, Check, RotateCcw, Loader2, Server } from "lucide-react";
import {
  getApiBase,
  getApiBaseOverride,
  setApiBaseOverride,
  checkBackendHealth,
} from "@/lib/api";
import {
  getMusicKeys,
  setMusicKeys,
  clearMusicKeys,
  testGeniusKey,
  testMusixmatchKey,
  testSpotifyKeys,
  type MusicKeys,
} from "@/lib/musicKeys";

type KeyStatus = { ok: boolean; detail: string } | null;

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<MusicKeys>({ genius: "", musixmatch: "", spotifyId: "", spotifySecret: "" });
  const [status, setStatus] = useState<Record<string, KeyStatus>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Advanced: self-hosted backend URL (unchanged legacy behavior).
  const [url, setUrl] = useState(() => getApiBaseOverride() ?? "");
  const [backendStatus, setBackendStatus] = useState<KeyStatus>(null);
  const [backendTesting, setBackendTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openModal = () => {
    setKeys(getMusicKeys());
    setStatus({});
    setError(null);
    setSaved(false);
    setUrl(getApiBaseOverride() ?? "");
    setBackendStatus(null);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  const runTest = async (which: string, fn: () => Promise<KeyStatus>) => {
    setTesting(which);
    setStatus((s) => ({ ...s, [which]: null }));
    try {
      const result = await fn();
      setStatus((s) => ({ ...s, [which]: result }));
    } catch {
      setStatus((s) => ({ ...s, [which]: { ok: false, detail: "Test failed unexpectedly." } }));
    }
    setTesting(null);
  };

  const handleSave = () => {
    setMusicKeys(keys);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    clearMusicKeys();
    setKeys({ genius: "", musixmatch: "", spotifyId: "", spotifySecret: "" });
    setStatus({});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleBackendTest = async () => {
    setBackendTesting(true);
    setBackendStatus(null);
    const previous = getApiBaseOverride();
    if (!setApiBaseOverride(url)) {
      setError("That doesn't look like a valid URL. Use http(s)://host:port");
      setBackendTesting(false);
      return;
    }
    const result = await checkBackendHealth();
    setApiBaseOverride(previous);
    setBackendStatus(result);
    setBackendTesting(false);
  };

  const renderKeyRow = (
    id: string,
    label: string,
    hint: string,
    value: string,
    onChange: (v: string) => void,
    onTest: () => void,
  ) => (
    <div className="mb-3">
      <label htmlFor={"key-" + id} className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={"key-" + id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => { onChange(e.target.value); setSaved(false); }}
          placeholder="Paste key here (optional)"
          className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-colors"
        />
        <button
          type="button"
          onClick={onTest}
          disabled={testing !== null}
          className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/10 text-white border border-white/[0.08] transition-all disabled:opacity-50"
        >
          {testing === id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Test
        </button>
      </div>
      <p className="mt-1 text-[11px] text-gray-600 leading-relaxed">{hint}</p>
      {status[id] && (
        <p className={"mt-1.5 text-xs rounded-lg px-3 py-2 border " + (status[id]?.ok
          ? "text-green-400 bg-green-500/10 border-green-500/20"
          : "text-red-400 bg-red-500/10 border-red-500/20")}>
          {status[id]?.ok ? <Check className="w-3 h-3 inline mr-1 -mt-0.5" /> : null}
          {status[id]?.detail}
        </p>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label="API keys settings"
        title="API keys settings"
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20 transition-all"
      >
        <KeyRound className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">API keys</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md glass-premium rounded-2xl p-6 max-h-[85vh] overflow-y-auto"
              role="dialog"
              aria-label="API keys settings"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-white font-semibold">
                  <KeyRound className="w-4 h-4 text-green-400" />
                  Music API keys
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close settings"
                  className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                All keys are <span className="text-gray-300">free</span> and optional.
                The app works without any key (LRCLIB + iTunes lyric search);
                keys unlock better lyric coverage and popularity ranking.
                Saved on this device only — never uploaded anywhere.
              </p>

              {renderKeyRow(
                "musixmatch",
                "Musixmatch key — lyric search",
                "Free at developer.musixmatch.com (2000 calls/day). Adds genuine lyrics → song search.",
                keys.musixmatch,
                (v) => setKeys((k) => ({ ...k, musixmatch: v })),
                () => runTest("musixmatch", () => testMusixmatchKey(keys.musixmatch || getMusicKeys().musixmatch)),
              )}

              {renderKeyRow(
                "genius",
                "Genius token — discovery upgrade",
                "Free at genius.com/api-clients → Generate Access Token. Upgrades lyric discovery to the official API.",
                keys.genius,
                (v) => setKeys((k) => ({ ...k, genius: v })),
                () => runTest("genius", () => testGeniusKey(keys.genius || getMusicKeys().genius)),
              )}

              <div className="mb-3">
                <span className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
                  Spotify — popularity ranking
                </span>
                <div className="flex flex-col gap-2">
                  <input
                    id="key-spotify-id"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={keys.spotifyId}
                    onChange={(e) => setKeys((k) => ({ ...k, spotifyId: e.target.value }))}
                    placeholder="Client ID (optional)"
                    aria-label="Spotify client ID"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-colors"
                  />
                  <div className="flex gap-2">
                    <input
                      id="key-spotify-secret"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={keys.spotifySecret}
                      onChange={(e) => setKeys((k) => ({ ...k, spotifySecret: e.target.value }))}
                      placeholder="Client Secret (optional)"
                      aria-label="Spotify client secret"
                      className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => runTest("spotify", () => {
                        const k = getMusicKeys();
                        return testSpotifyKeys(keys.spotifyId || k.spotifyId, keys.spotifySecret || k.spotifySecret);
                      })}
                      disabled={testing !== null}
                      className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/10 text-white border border-white/[0.08] transition-all disabled:opacity-50"
                    >
                      {testing === "spotify" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Test
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-gray-600 leading-relaxed">
                  Free at developer.spotify.com/dashboard. Lets famous originals outrank obscure covers.
                </p>
                {status["spotify"] && (
                  <p className={"mt-1.5 text-xs rounded-lg px-3 py-2 border " + (status["spotify"]?.ok
                    ? "text-green-400 bg-green-500/10 border-green-500/20"
                    : "text-red-400 bg-red-500/10 border-red-500/20")}>
                    {status["spotify"]?.ok ? <Check className="w-3 h-3 inline mr-1 -mt-0.5" /> : null}
                    {status["spotify"]?.detail}
                  </p>
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold btn-premium text-black transition-all"
                >
                  {saved ? <Check className="w-4 h-4" /> : null}
                  {saved ? "Saved" : "Save keys"}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  title="Clear all keys"
                  className="flex items-center justify-center px-3.5 py-2.5 rounded-xl text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-all"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

              {error && (
                <p className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <details className="mt-4 text-xs text-gray-500">
                <summary className="cursor-pointer flex items-center gap-1.5 hover:text-gray-300">
                  <Server className="w-3.5 h-3.5" />
                  Advanced: self-hosted server URL
                </summary>
                <p className="mt-2 leading-relaxed">
                  Only needed if you run the Python backend yourself (voice
                  transcription + full provider set). The Lyrics tab works
                  without any server.
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    id="backend-url"
                    type="url"
                    inputMode="url"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setError(null); }}
                    placeholder={getApiBase()}
                    className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!setApiBaseOverride(url)) {
                        setError("That doesn't look like a valid URL. Use http(s)://host:port");
                        return;
                      }
                      setError(null);
                    }}
                    className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/10 text-white border border-white/[0.08] transition-all"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={handleBackendTest}
                    disabled={backendTesting}
                    className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/10 text-white border border-white/[0.08] transition-all disabled:opacity-50"
                  >
                    {backendTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Test"}
                  </button>
                  <button
                    type="button"
                    title="Reset server URL to default"
                    onClick={() => { setApiBaseOverride(null); setUrl(""); setBackendStatus(null); }}
                    className="shrink-0 px-3 py-2.5 rounded-xl text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-all"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
                {backendStatus && (
                  <p className={"mt-2 text-xs rounded-lg px-3 py-2 border " + (backendStatus.ok
                    ? "text-green-400 bg-green-500/10 border-green-500/20"
                    : "text-red-400 bg-red-500/10 border-red-500/20")}>
                    {backendStatus.detail}
                  </p>
                )}
              </details>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
