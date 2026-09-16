'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SpotifyIframeWindow extends Window {
  onSpotifyIframeApiReady?: (IFrameAPI: any) => void;
  SpotifyIframeApi?: any;
}
declare const window: SpotifyIframeWindow;

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, Play, ThumbsUp, ThumbsDown, ExternalLink } from 'lucide-react';
import { SongResult, extractSpotifyTrackId, getConfidenceRingColor, submitFeedback, checkBackendHealth } from '@/lib/api';
import { Confetti } from './Confetti';

interface ResultCardProps {
  results: SongResult[];
  transcript: string;
  onTryAgain: () => void;
  confidenceLabel?: 'high' | 'uncertain' | 'low';
}

function ConfidenceRing({ confidence }: { confidence: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (confidence / 100) * circumference;
  const color = getConfidenceRingColor(confidence);
  return (
    <div className="relative w-12 h-12 flex-shrink-0">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
        <circle cx="25" cy="25" r={radius} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference}
          style={{ '--ring-offset': offset, animation: 'ring-fill 1.5s ease-out forwards' } as React.CSSProperties}
          className="confidence-ring" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-bold text-white">{confidence}%</span>
      </div>
    </div>
  );
}

let spotifyScriptLoading = false;
const spotifyPendingCallbacks: Array<(api: any) => void> = [];

function SpotifyEmbed({ trackId, timestamp }: { trackId: string; timestamp?: number | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<any>(null);
  const startAt = timestamp && timestamp > 0 ? Math.floor(timestamp) : 0;

  useEffect(() => {
    if (!document.getElementById("spotify-iframe-api") && !spotifyScriptLoading) {
      spotifyScriptLoading = true;
      const win = window;
      win.onSpotifyIframeApiReady = (api: any) => {
        win.SpotifyIframeApi = api;
        spotifyPendingCallbacks.forEach(cb => cb(api));
        spotifyPendingCallbacks.length = 0;
      };
      const script = document.createElement("script");
      script.id = "spotify-iframe-api";
      script.src = "https://open.spotify.com/embed/iframe-api/v1";
      script.async = true;
      script.onerror = () => {
        spotifyScriptLoading = false;
        spotifyPendingCallbacks.length = 0;
        script.remove();
      };
      document.body.appendChild(script);
      setTimeout(() => {
        if (spotifyScriptLoading && !win.SpotifyIframeApi) {
          spotifyScriptLoading = false;
          spotifyPendingCallbacks.length = 0;
        }
      }, 10000);
    }

    const initController = () => {
      if (!containerRef.current || !window.SpotifyIframeApi) return;
      try {
        containerRef.current.innerHTML = "";
        window.SpotifyIframeApi.createController(containerRef.current, {
          uri: "spotify:track:" + trackId,
          width: "100%",
          height: 152,
        }, (controller: any) => {
          controllerRef.current = controller;
          controller.loadUri("spotify:track:" + trackId, false, startAt);
          controller.addListener("ready", () => {
            if (startAt > 0) {
              try { controller.seek(startAt); controller.play(); } catch {}
            }
          });
        });
      } catch (e) {}
    };

    if (window.SpotifyIframeApi) initController();
    else spotifyPendingCallbacks.push(() => initController());

    return () => { controllerRef.current?.destroy?.(); };
  }, [trackId, startAt]);

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 152 }}
      className="mt-4 rounded-xl overflow-hidden border border-white/5 shadow-lg">
      <div ref={containerRef} />
    </motion.div>
  );
}

function AlbumArt({ song, isTop, albumArt }: { song: string; isTop: boolean; albumArt?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  if (albumArt && !error) {
    return (
      <div className="relative w-12 h-12 flex-shrink-0">
        {!loaded && <div className="absolute inset-0 rounded-xl shimmer" />}
        <img src={albumArt} alt={song} width={48} height={48}
          onLoad={() => setLoaded(true)} onError={() => setError(true)}
          className={"w-12 h-12 rounded-xl flex-shrink-0 object-cover transition-opacity duration-300 " +
            (loaded ? "opacity-100 " : "opacity-0 ") +
            (isTop ? "ring-2 ring-green-500/30" : "ring-1 ring-white/10")} />
      </div>
    );
  }
  const letter = (song || "?")[0].toUpperCase();
  return (
    <div className={"w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-lg font-bold " +
      (isTop ? "bg-green-500/15 text-green-400 border border-green-500/20" : "bg-white/[0.04] text-gray-400 border border-white/[0.06]")}>
      {letter}
    </div>
  );
}

function LyricsContext({ context }: { context: { before: string[]; matched: string; after: string[] } }) {
  return (
    <div className="mb-4 bg-black/40 rounded-xl p-4 border border-white/5">
      <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-medium">You are HERE</p>
      <div className="space-y-1 text-sm font-mono leading-relaxed">
        {context.before.map((line, i) => <p key={"b-" + i} className="text-gray-600">{line}</p>)}
        <motion.p initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="text-green-400 font-semibold lyrics-highlight py-1 px-2 -mx-2 rounded-lg">
          ▶ {context.matched}
        </motion.p>
        {context.after.map((line, i) => <p key={"a-" + i} className="text-gray-500">{line}</p>)}
      </div>
    </div>
  );
}

const PAGE_INITIAL = 5;
const PAGE_STEP = 3;

function dedupeResults(list: SongResult[]): SongResult[] {
  const seen = new Set<string>();
  const out: SongResult[] = [];
  for (const r of list || []) {
    if (!r || (!r.song && !r.artist)) continue;
    const key = ((r.song || '').toLowerCase().trim() + ' :: ' + (r.artist || '').toLowerCase().trim());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function resultKey(r: SongResult, index: number): string {
  const base = (r.song || '?') + ' :: ' + (r.artist || 'unknown');
  return base + ' :: ' + index;
}

export default function ResultCard({ results, transcript, onTryAgain, confidenceLabel }: ResultCardProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_INITIAL);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, "up" | "down">>({});
  const [showConfetti, setShowConfetti] = useState(false);
  // Feedback needs the backend; probe once so the buttons don't silently die.
  const [feedbackOnline, setFeedbackOnline] = useState<boolean | null>(null);

  // Stable ranked set for this search: dedupe defensively, never reorder here.
  const ranked = dedupeResults(results || []);
  // Fingerprint resets pagination only when a genuinely new search arrives.
  const fingerprint = (transcript || '') + '|' + ranked.map((r) => (r.song || '') + '::' + (r.artist || '')).join(';');

  useEffect(() => {
    let cancelled = false;
    checkBackendHealth(3000).then(
      (r) => { if (!cancelled) setFeedbackOnline(r.ok); },
      () => { if (!cancelled) setFeedbackOnline(false); }
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_INITIAL);
    setFeedbackGiven({});
    setShowConfetti(false);
  }, [fingerprint]);

  const visibleResults = ranked.slice(0, visibleCount);
  const hasMore = visibleCount < ranked.length;
  const remaining = ranked.length - visibleCount;
  const nextBatch = Math.min(PAGE_STEP, remaining);
  const topConfidence = ranked[0]?.confidence || 0;

  useEffect(() => {
    if (topConfidence >= 80) {
      const timer = setTimeout(() => setShowConfetti(true), 500);
      return () => clearTimeout(timer);
    }
  }, [topConfidence, fingerprint]);

  if (!ranked || ranked.length === 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
        className="w-full max-w-2xl mx-auto space-y-4 relative">
        <div className="glass-premium rounded-xl px-5 py-8 text-center">
          <p className="text-white text-sm font-medium">No matches found</p>
          <p className="text-gray-400 text-xs mt-1">Try singing a longer or more distinctive part of the song.</p>
          <button type="button" onClick={onTryAgain}
            className="mt-4 px-5 py-2.5 rounded-xl bg-white text-black text-sm font-bold hover:bg-gray-100 transition-all active:scale-[0.97]">
            Try again
          </button>
        </div>
      </motion.div>
    );
  }

  const formatTs = (sec: number | null) => {
    if (!sec || sec <= 0) return null;
    return Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
        className="w-full max-w-2xl mx-auto space-y-4 relative">
        <div className="relative overflow-hidden rounded-xl"><Confetti trigger={showConfetti} /></div>

        {confidenceLabel === "uncertain" && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="rounded-xl px-5 py-3.5 bg-yellow-500/[0.06] border border-yellow-500/20">
            <p className="text-yellow-200/90 text-sm font-medium">Close call — not 100% sure</p>
            <p className="text-gray-400 text-xs mt-0.5">These are the closest matches. Sing a little longer for a surer result.</p>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass-premium rounded-xl px-5 py-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">You sang</p>
          <p className="text-gray-300 text-sm italic">&ldquo;{transcript}&rdquo;</p>
        </motion.div>

        <div className="space-y-3">
          <AnimatePresence>
            <p className="text-center text-[11px] text-gray-500">
            Showing {visibleResults.length} of {ranked.length} ranked match{ranked.length === 1 ? '' : 'es'}
          </p>
          {visibleResults.map((result, index) => {
              const trackId = extractSpotifyTrackId(result.spotify_url);
              const ts = formatTs(result.timestamp);
              const spotifyDeepLink = trackId && ts
                ? "https://open.spotify.com/track/" + trackId + "?t=" + Math.floor(result.timestamp || 0)
                : result.spotify_url;
              const fbKey = resultKey(result, index);

              return (
                <motion.div key={fbKey}
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: 0.2 + index * 0.1 }}
                  className={"glass-premium rounded-xl p-5 transition-all duration-200 hover:border-white/10 hover:-translate-y-0.5 hover:shadow-lg " +
                    (index === 0 ? "border-green-500/20" : "")}>

                  <div className="flex items-center gap-3 mb-3">
                    <AlbumArt song={result.song} isTop={index === 0} albumArt={result.album_art} />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-bold text-xl leading-tight truncate">{result.song}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-gray-500 text-sm truncate">{result.artist || "Unknown Artist"}</p>
                        {ts && <span className="text-[11px] text-green-400/80 font-mono bg-green-500/[0.06] px-1.5 py-0.5 rounded">{ts}{result.timestamp_estimated ? "~" : ""}</span>}
                      </div>
                    </div>
                    <ConfidenceRing confidence={result.confidence} />
                    {index === 0 && result.confidence < 60 && (
                      <span className="text-[10px] text-yellow-500/80 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">Unsure</span>
                    )}
                    <div className="flex flex-col gap-1 ml-1" title={feedbackOnline === false ? "Feedback needs a backend connection" : undefined}>
                      <button onClick={() => {
                        if (feedbackGiven[fbKey] || feedbackOnline === false) return;
                        setFeedbackGiven(prev => ({ ...prev, [fbKey]: 'up' }));
                        submitFeedback(transcript, result.song, result.artist, 'up').catch(() => {});
                      }} disabled={!!feedbackGiven[fbKey] || feedbackOnline === false}
                        className={'p-1 rounded transition-all ' + (feedbackGiven[fbKey] === 'up' ? 'text-green-400 scale-110' : (feedbackGiven[fbKey] || feedbackOnline === false) ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-green-400 hover:scale-110')}>
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => {
                        if (feedbackGiven[fbKey] || feedbackOnline === false) return;
                        setFeedbackGiven(prev => ({ ...prev, [fbKey]: 'down' }));
                        submitFeedback(transcript, result.song, result.artist, 'down').catch(() => {});
                      }} disabled={!!feedbackGiven[fbKey] || feedbackOnline === false}
                        className={'p-1 rounded transition-all ' + (feedbackGiven[fbKey] === 'down' ? 'text-red-400 scale-110' : (feedbackGiven[fbKey] || feedbackOnline === false) ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-red-400 hover:scale-110')}>
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] text-gray-600 uppercase tracking-wider bg-white/[0.03] px-2 py-0.5 rounded-full">via {result.strategy}</span>
                  </div>

                  {result.lyrics_context && <LyricsContext context={result.lyrics_context} />}

                  {index === 0 && result.ambiguous && result.occurrences && result.occurrences.length > 1 && (
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-gray-500">Also heard at</span>
                      {result.occurrences.slice(0, 3).map((occ) => {
                        const occTs = Math.floor(occ.timestamp / 60) + ":" + String(Math.floor(occ.timestamp % 60)).padStart(2, "0");
                        const occLink = trackId
                          ? "https://open.spotify.com/track/" + trackId + "?t=" + Math.floor(occ.timestamp)
                          : spotifyDeepLink;
                        return (
                          <a key={occ.timestamp} href={occLink} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] font-mono text-green-400/90 bg-green-500/[0.06] hover:bg-green-500/[0.12] border border-green-500/15 px-2 py-0.5 rounded-full transition-colors">
                            {occTs}
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {result.covers && result.covers.length > 0 && (
                    <details className="mb-3 group/covers">
                      <summary className="list-none cursor-pointer text-[11px] text-green-400/90 hover:text-green-400 flex items-center gap-1">
                        <span className="group-open/covers:rotate-90 transition-transform inline-block">▸</span>
                        {result.covers.length} cover{result.covers.length === 1 ? "" : "s"} — view
                      </summary>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {result.covers.map((name) => (
                          <span key={name} className="text-[11px] bg-white/[0.06] border border-white/[0.08] text-gray-300 px-2 py-0.5 rounded-full">
                            {name}
                          </span>
                        ))}
                      </div>
                    </details>
                  )}

                  {trackId && index === 0 && <SpotifyEmbed trackId={trackId} timestamp={result.timestamp} />}

                  <div className="mt-4">
                    <a href={spotifyDeepLink} target="_blank" rel="noopener noreferrer"
                      className={"w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all active:scale-[0.97] " +
                        (index === 0 ? "btn-premium text-black" : "bg-white/[0.06] hover:bg-white/10 text-white border border-white/[0.06]")}>
                      <Play className="w-3.5 h-3.5" fill="currentColor" />
                      <span>{ts ? "Continue from " + ts + " on Spotify" : "Open on Spotify"}</span>
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {hasMore ? (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
            onClick={() => setVisibleCount((c) => Math.min(c + PAGE_STEP, ranked.length))}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-all">
            Load {nextBatch} more ({visibleResults.length} of {ranked.length} shown)
          </motion.button>
        ) : (
          ranked.length > PAGE_INITIAL && (
            <p className="text-center text-[11px] text-gray-600">
              You&apos;ve seen all {ranked.length} ranked results
            </p>
          )
        )}

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
          className="text-center text-[11px] text-gray-600 pt-2">
          Timestamp playback works best in Spotify desktop/mobile app
        </motion.p>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="flex gap-2 pt-2">
          <button type="button" onClick={onTryAgain}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-black text-sm font-bold hover:bg-gray-100 transition-all active:scale-[0.97]">
            <RotateCcw className="w-4 h-4" />
            <span>New search</span>
          </button>
          <button type="button" onClick={onTryAgain}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm font-medium hover:bg-white/10 transition-all">
            <span>Voice</span>
          </button>
        </motion.div>
      </motion.div>

      <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 }}
        onClick={onTryAgain}
        className="fixed bottom-6 right-6 z-40 hidden sm:flex items-center gap-2 px-5 py-3 rounded-full bg-[#111] border border-white/10 text-white text-sm font-medium shadow-xl hover:bg-[#1a1a1a] hover:border-white/20 transition-all active:scale-[0.97]">
        <RotateCcw className="w-4 h-4" />
        <span>Try Again</span>
      </motion.button>
    </>
  );
}
