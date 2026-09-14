'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Loader2, X, Wand2 } from 'lucide-react';
import { identifyLyrics, ApiResponse } from '@/lib/api';
import { browserIdentify } from '@/lib/browserSearch';

interface TextInputProps {
  onResult: (data: ApiResponse) => void;
  onLoadingChange?: (loading: boolean, progress?: any) => void;
  onError?: (message: string | null) => void;
}

export default function TextInput({ onResult, onLoadingChange, onError }: TextInputProps) {
  const [lyrics, setLyrics] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const EXAMPLES = [
    'never gonna give you up never gonna let you down',
    'hello from the other side I must have called a thousand times',
    'is this the real life is this just fantasy',
  ];

  const handleSubmit = async (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    // Read from the live DOM node, not just closed-over state, so a rapid
    // type-then-Enter (before React flushes state) still submits.
    const liveValue = textareaRef.current?.value ?? '';
    const text = (liveValue || lyrics || '').trim();
    if (text.length < 5) { setError('Please enter at least a few words.'); return; }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    onLoadingChange?.(true, { stage: 'searching', message: 'Looking for your song...' });
    setError(null);
    // Clear any lifted parent error from a prior offline attempt so it
    // doesn't linger alongside the next result.
    onError?.(null);

    try {
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      let data: any = null;
      try { data = await identifyLyrics(text, controller.signal); } catch {}
      clearTimeout(timeoutId);

      if (!data || !data.success) {
        // Backend unreachable — fall back to in-browser search (LRCLIB + iTunes).
        try {
          const browser = await browserIdentify(text, (stage, message) =>
            onLoadingChange?.(true, { stage: stage as any, message })
          );
          const top = browser.results[0]?.confidence ?? 0;
          const second = browser.results[1]?.confidence ?? 0;
          const gap = top - second;
          data = {
            success: true,
            transcript: browser.transcript,
            results: browser.results as any,
            confidence_label: (top >= 70 && gap >= 10 ? 'high' : top >= 50 ? 'uncertain' : 'low') as 'high' | 'uncertain' | 'low',
            margin: gap,
          };
        } catch (browserErr: any) {
          const msg = browserErr?.message
            ? browserErr.message + ' Try different lyrics, or connect a backend for broader search.'
            : "Couldn't identify that. Try different lyrics.";
          if (onError) onError(msg);
          else setError(msg);
          return;
        }
      }

      if (!controller.signal.aborted) onResult(data);
    } catch (err: any) {
      if (controller.signal.aborted) return;
      setError(err?.message || 'Failed to identify song');
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setLoading(false);
    onLoadingChange?.(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="glass-premium rounded-2xl p-1">
          <textarea
            ref={textareaRef}
            value={lyrics}
            onChange={(e) => { setLyrics(e.target.value); setError(null); }}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const current = (e.target as HTMLTextAreaElement).value || '';
                if (current.trim().length >= 5 && !loading) handleSubmit(e);
              }
            }}
            placeholder='Type some lyrics here... e.g. "never gonna give you up"'
            className="w-full bg-transparent text-white placeholder-gray-500 p-4 rounded-2xl resize-none focus:outline-none min-h-[120px] text-base"
            disabled={loading}
          />
        </div>

        {!loading && !lyrics && (
          <div className="flex flex-wrap gap-2 justify-center">
            <span className="text-gray-500 text-xs">Try:</span>
            {EXAMPLES.map((ex, i) => (
              <button key={i} type="button" onClick={() => setLyrics(ex)}
                className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:border-green-500/50 hover:bg-green-500/5 transition-all">
                &ldquo;{ex.slice(0, 30)}...&rdquo;
              </button>
            ))}
          </div>
        )}

        {!loading && !lyrics && (
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-600">
            <Wand2 className="w-3 h-3" />
            <span>Live in-browser search — no backend needed</span>
          </div>
        )}

        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-sm text-center bg-red-500/10 rounded-lg py-2 px-3 border border-red-500/20">{error}</motion.p>
        )}

        <div className="flex gap-2">
          <motion.button type="submit" disabled={loading || (lyrics || '').trim().length < 5}
            whileTap={{ scale: 0.97 }}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl btn-premium disabled:bg-gray-700 disabled:shadow-none disabled:text-gray-500 text-black font-bold transition-all">
            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /><span>Identifying...</span></> : <><Search className="w-5 h-5" /><span>Find Song</span></>}
          </motion.button>
          {loading && (
            <motion.button type="button" onClick={handleCancel} whileTap={{ scale: 0.97 }}
              className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all">
              <X className="w-5 h-5" />
            </motion.button>
          )}
        </div>
      </form>
      <p className="text-center text-xs text-gray-500 mt-4">Tip: The more lyrics you type, the better the match. Try 1-2 lines.</p>
    </motion.div>
  );
}