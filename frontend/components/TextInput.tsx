'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Loader2, X, Wand2 } from 'lucide-react';
import { identifyLyrics, ApiResponse } from '@/lib/api';

interface TextInputProps {
  onResult: (data: ApiResponse) => void;
  onLoadingChange?: (loading: boolean, progress?: any) => void;
}

const DEMO_RESPONSES: Record<string, any> = {
  rick: {
    song: 'Never Gonna Give You Up', artist: 'Rick Astley', confidence: 97, timestamp: 42,
    timestamp_display: '0:42', spotify_url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    album_art: 'https://i.scdn.co/image/ab67616d0000b27360dd2b0021baddd668124b21', strategy: 'youtube',
    lyrics_context: { before: ["We're no strangers to love", "You know the rules"], matched: 'Never gonna give you up', after: ['Never gonna let you down', 'Never gonna run around'] }
  },
  adele: {
    song: 'Hello', artist: 'Adele', confidence: 94, timestamp: 44,
    timestamp_display: '0:44', spotify_url: 'https://open.spotify.com/track/4aebBr4JAihzJQR0CiIZJv',
    album_art: 'https://i.scdn.co/image/ab67616d0000b273e691d92a8f3a1f1225ede162', strategy: 'genius',
    lyrics_context: { before: ['I was wondering if after all these years', "You'd like to meet"], matched: 'Hello from the other side', after: ["I must've called a thousand times", 'To tell you I am sorry'] }
  },
  queen: {
    song: 'Bohemian Rhapsody', artist: 'Queen', confidence: 91, timestamp: 64,
    timestamp_display: '1:04', spotify_url: 'https://open.spotify.com/track/3z8h0TUjRe9ihi8hSAMGJC',
    album_art: 'https://i.scdn.co/image/ab67616d0000b273e8b066f70b2067a7e5ed9c36', strategy: 'itunes',
    lyrics_context: { before: ['Mama, just killed a man', 'Put a gun against his head'], matched: 'Is this the real life? Is this just fantasy?', after: ['Caught in a landslide', 'No escape from reality'] }
  }
};

/**
 * Demo library: only these well-known phrases have canned responses.
 * Anything else with no backend gets an honest "can't do that offline"
 * message instead of a fabricated song card.
 */
function findDemoMatch(input: string): any | null {
  const lower = input.toLowerCase();
  for (const key of Object.keys(DEMO_RESPONSES)) {
    const item = DEMO_RESPONSES[key];
    const matchedLine: string = item.lyrics_context.matched.toLowerCase();
    if (lower.includes(matchedLine.slice(0, 20))) {
      const demo = JSON.parse(JSON.stringify(item));
      demo.isDemo = true;
      return demo;
    }
  }
  return null;
}

export default function TextInput({ onResult, onLoadingChange }: TextInputProps) {
  const [lyrics, setLyrics] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const EXAMPLES = [
    'never gonna give you up never gonna let you down',
    'hello from the other side I must have called a thousand times',
    'is this the real life is this just fantasy',
  ];

  const handleSubmit = async (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const text = (lyrics || '').trim();
    if (text.length < 5) { setError('Please enter at least a few words.'); return; }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    onLoadingChange?.(true, { stage: 'searching', message: 'Looking for your song...' });
    setError(null);

    try {
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      let data: any = null;
      try { data = await identifyLyrics(text, controller.signal); } catch {}
      clearTimeout(timeoutId);

      if (!data || !data.success) {
        // Backend unreachable — fall back to the offline demo library.
        const demo = findDemoMatch(text);
        if (!demo) {
          setError("Couldn't identify that without a backend. Connect one in Backend settings (top right), or try one of the examples above.");
          return;
        }
        onLoadingChange?.(true, { stage: 'found', message: 'Checking demo library...' });
        await new Promise(r => setTimeout(r, 700));
        onLoadingChange?.(true, { stage: 'candidate_ready', message: 'Demo match ready' });
        await new Promise(r => setTimeout(r, 400));
        data = { success: true, transcript: text, results: [demo], confidence_label: 'high' as const };
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
            value={lyrics}
            onChange={(e) => { setLyrics(e.target.value); setError(null); }}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if ((lyrics || '').trim().length >= 5 && !loading) handleSubmit(e);
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
            <span>No backend? Try an example — full search needs one</span>
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