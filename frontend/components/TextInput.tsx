'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Loader2, X } from 'lucide-react';
import { identifyLyricsStream, identifyLyrics, ApiResponse, ProgressEvent } from '@/lib/api';

interface TextInputProps {
  onResult: (data: ApiResponse) => void;
  onLoadingChange?: (loading: boolean, progress?: ProgressEvent | null) => void;
}

export default function TextInput({ onResult, onLoadingChange }: TextInputProps) {
  const [lyrics, setLyrics] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const EXAMPLES = [
    "never gonna give you up never gonna let you down",
    "hello from the other side I must have called a thousand times",
    "is this the real life is this just fantasy",
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (lyrics.trim().length < 5) {
      setError('Please enter at least a few words of lyrics.');
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setLoading(true);
    onLoadingChange?.(true, null);
    setError(null);
    

    try {
      // Try SSE streaming first
      let latestProgress: ProgressEvent | null = null;
      const data = await identifyLyricsStream(
        lyrics.trim(),
        (event) => {
          // Merge candidate info across events
          if (event.candidates) {
            latestProgress = { ...event };
          }
          const merged = latestProgress?.candidates && !event.candidates
            ? { ...event, candidates: latestProgress.candidates }
            : event;
           onLoadingChange?.(true, merged);
        },
        abortController.signal
      );
      if (abortController.signal.aborted) return;
      if (data) {
        onResult(data);
      } else {
        // Fallback to non-streaming
        const fallback = await identifyLyrics(lyrics.trim(), abortController.signal);
        if (!abortController.signal.aborted) onResult(fallback);
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted) return;
      // SSE failed (connection drop, timeout, etc.) — graceful degradation to non-streaming.
      // Note: if SSE partially processed server-side before failing, this causes a duplicate
      // backend request. Acceptable tradeoff for reliability — the alternative is showing
      // an error to the user when the non-streaming endpoint may still work.
      try {
        const fallback = await identifyLyrics(lyrics.trim(), abortController.signal);
        if (!abortController.signal.aborted) onResult(fallback);
      } catch (fallbackErr: unknown) {
        if (abortController.signal.aborted) return;
        const message = fallbackErr instanceof Error ? fallbackErr.message : 'Failed to identify song';
        setError(message);
      }
    } finally {
      setLoading(false);
      onLoadingChange?.(false, null);
      
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    onLoadingChange?.(false, null);
    
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg mx-auto"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="glass-premium rounded-2xl p-1">
            <textarea
              value={lyrics}
              onChange={(e) => { setLyrics(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (lyrics.trim().length >= 5 && !loading) {
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }
              }}
              placeholder="Type some lyrics here... e.g. &quot;never gonna give you up never gonna let you down&quot;"
              className="w-full bg-transparent text-white placeholder-gray-500 p-4 rounded-2xl resize-none focus:outline-none min-h-[120px] text-base"
              disabled={loading}
            />
          </div>

          {!loading && !lyrics && (
            <div className="flex flex-wrap gap-2 justify-center">
              <span className="text-gray-500 text-xs">Try:</span>
              {EXAMPLES.map((ex, i) => (
                <motion.button
                  key={i}
                  type="button"
                  onClick={() => setLyrics(ex)}
                  whileTap={{ scale: 0.97 }}
                  className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:border-green-500/50 hover:bg-green-500/5 transition-all"
                >
                  &ldquo;{ex.slice(0, 30)}...&rdquo;
                </motion.button>
              ))}
            </div>
          )}

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-400 text-sm text-center bg-red-500/10 rounded-lg py-2 px-3 border border-red-500/20"
            >
              {error}
            </motion.p>
          )}

          <div className="flex gap-2">
            <motion.button
              type="submit"
              disabled={loading || lyrics.trim().length < 5}
              whileTap={{ scale: 0.97 }}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl btn-premium disabled:bg-gray-700 disabled:shadow-none disabled:text-gray-500 text-black font-bold transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Identifying...</span>
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  <span>Find Song</span>
                </>
              )}
            </motion.button>

            {loading && (
              <motion.button
                type="button"
                onClick={handleCancel}
                whileTap={{ scale: 0.97 }}
                className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all"
              >
                <X className="w-5 h-5" />
              </motion.button>
            )}
          </div>
        </form>

        <p className="text-center text-xs text-gray-500 mt-4">
          Tip: The more lyrics you type, the better the match. Try 1-2 lines.
        </p>
      </motion.div>
    </>
  );
}
