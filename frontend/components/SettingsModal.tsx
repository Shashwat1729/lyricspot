'use client';

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, X, Check, RotateCcw, Loader2, Server } from "lucide-react";
import {
  getApiBase,
  getApiBaseOverride,
  setApiBaseOverride,
  checkBackendHealth,
} from "@/lib/api";

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(() => getApiBaseOverride() ?? "");
  const [status, setStatus] = useState<{ ok: boolean; detail: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openModal = () => {
    setUrl(getApiBaseOverride() ?? "");
    setStatus(null);
    setError(null);
    setSaved(false);
    setOpen(true);
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus(null);
    // Temporarily apply the typed URL so Test checks what you typed.
    const previous = getApiBaseOverride();
    if (!setApiBaseOverride(url)) {
      setError("That doesn't look like a valid URL. Use http(s)://host:port");
      setTesting(false);
      return;
    }
    const result = await checkBackendHealth();
    // Restore previous saved value; Test must not silently persist.
    setApiBaseOverride(previous);
    setStatus(result);
    setTesting(false);
  };

  const handleSave = () => {
    if (!setApiBaseOverride(url)) {
      setError("That doesn't look like a valid URL. Use http(s)://host:port");
      return;
    }
    setError(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setApiBaseOverride(null);
    setUrl("");
    setError(null);
    setStatus(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label="Backend settings"
        title="Backend settings"
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20 transition-all"
      >
        <Settings className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Backend</span>
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
              className="w-full max-w-md glass-premium rounded-2xl p-6"
              role="dialog"
              aria-label="Backend settings"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-white font-semibold">
                  <Server className="w-4 h-4 text-green-400" />
                  Backend connection
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

              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                Voice identification runs on the Python backend. Point the app at
                wherever yours is running — e.g. a laptop on your network.
                The Lyrics tab works without any backend.
              </p>

              <label htmlFor="backend-url" className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
                Backend URL
              </label>
              <input
                id="backend-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null); setSaved(false); }}
                placeholder={getApiBase()}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-colors"
              />

              {error && (
                <p className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              {status && (
                <p className={"mt-2 text-xs rounded-lg px-3 py-2 border " + (status.ok
                  ? "text-green-400 bg-green-500/10 border-green-500/20"
                  : "text-red-400 bg-red-500/10 border-red-500/20")}>
                  {status.ok ? <Check className="w-3 h-3 inline mr-1 -mt-0.5" /> : null}
                  {status.detail}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/10 text-white border border-white/[0.08] transition-all disabled:opacity-50"
                >
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Test
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold btn-premium text-black transition-all"
                >
                  {saved ? <Check className="w-4 h-4" /> : null}
                  {saved ? "Saved" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  title="Reset to default"
                  className="flex items-center justify-center px-3.5 py-2.5 rounded-xl text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-all"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

              <p className="mt-3 text-[11px] text-gray-600 leading-relaxed">
                Saved on this device only. If the backend runs on another machine,
                allow CORS for this site via the backend CORS_ORIGINS setting.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}