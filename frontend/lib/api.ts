/**
 * API helper functions for ContinueMySong AI frontend.
 */

import axios from 'axios';

const API_BASE_OVERRIDE_KEY = 'lyricspot.apiBase';
const DEFAULT_API_BASE = 'http://localhost:8000';

/** Build-time default from env (baked into the static export). */
function envApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE).replace(/\/+$/, '');
}

function sanitizeApiBase(raw: string): string | null {
  const cleaned = (raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Effective backend base URL.
 * Priority: Settings override (localStorage) > build-time env > localhost.
 * Read dynamically (not a module const) so the Settings modal takes
 * effect immediately without a rebuild — essential on static hosts.
 */
export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    try {
      const override = window.localStorage.getItem(API_BASE_OVERRIDE_KEY);
      if (override) {
        const cleaned = sanitizeApiBase(override);
        if (cleaned) return cleaned;
      }
    } catch {
      // localStorage unavailable (private mode) — fall through to env default
    }
  }
  return envApiBase();
}

/** Persist a custom backend URL (or null to reset to default). Returns false if invalid. */
export function setApiBaseOverride(url: string | null): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (!url || !url.trim()) {
      window.localStorage.removeItem(API_BASE_OVERRIDE_KEY);
      return true;
    }
    const cleaned = sanitizeApiBase(url);
    if (!cleaned) return false;
    window.localStorage.setItem(API_BASE_OVERRIDE_KEY, cleaned);
    return true;
  } catch {
    return false;
  }
}

/** Currently stored override, or null when using the default. */
export function getApiBaseOverride(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(API_BASE_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

/** Whether requests go anywhere other than the build default. */
export function isCustomApiBase(): boolean {
  return getApiBaseOverride() !== null;
}

function isLocalHost(urlOrHost: string): boolean {
  return /(^|\.)localhost$|^127\.0\.0\.1$|^0\.0\.0\.0$|^\[::1\]$/.test(
    (urlOrHost || "").toLowerCase().replace(/^https?:\/\//, "").split(/[/:]/)[0]
  );
}

/**
 * Whether a backend call is even worth attempting. On a public deploy with
 * no custom server configured, the default localhost backend can never be
 * there — callers should go straight to browser search instead of burning
 * a doomed request (and logging a console error) first.
 */
export function shouldAttemptBackend(): boolean {
  if (typeof window === "undefined") return true;
  if (isCustomApiBase()) return true; // explicit user config: always honor
  const base = getApiBase();
  if (!isLocalHost(base)) return true; // baked remote host: try it
  return isLocalHost(window.location.hostname); // local page: local backend may exist
}

/** Quick backend reachability probe for the Settings "Test" button. */
export async function checkBackendHealth(timeoutMs = 5000): Promise<{ ok: boolean; detail: string }> {
  const base = getApiBase();
  // On a public deploy with no custom server configured, the default
  // localhost backend can never be there — fail quietly instead of logging
  // console errors on every page load. Explicit Test-button checks with a
  // saved localhost override still probe (the visitor may run one).
  if (typeof window !== "undefined" && !isCustomApiBase()
      && isLocalHost(base) && !isLocalHost(window.location.hostname)) {
    return { ok: false, detail: "No backend configured — static demo mode." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(base + '/health', { signal: controller.signal });
    if (!res.ok) return { ok: false, detail: 'Server responded with status ' + res.status };
    const data = await res.json().catch(() => ({}));
    const model = (data as { whisper_model?: string }).whisper_model;
    return { ok: true, detail: model ? 'Connected (Whisper model: ' + model + ')' : 'Connected' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, detail: 'Timed out — is the backend running at ' + base + '?' };
    }
    return { ok: false, detail: 'Cannot reach ' + base + '. Check the URL and CORS settings.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Single timestamp occurrence of the matched lyric (repeated choruses). */
export interface LyricOccurrence {
  timestamp: number;
  match_score: number;
  matched_line: string;
}

/** A same-song alternate version attached to a result (cover/live/remix). */
export interface CoverInfo {
  artist: string;
  confidence?: number;
  timestamp_display?: string | null;
  /** The lyric line this version matched (evidence it is the same song). */
  matched?: string;
}

/** Single song result from the backend */
export interface SongResult {
  song: string;
  artist: string;
  confidence: number;
  timestamp: number | null;
  timestamp_display: string | null;
  timestamp_estimated?: boolean;
  lyrics_context?: {
    before: string[];
    matched: string;
    after: string[];
  } | null;
  occurrences?: LyricOccurrence[];
  ambiguous?: boolean;
  spotify_url: string;
  album_art?: string;
  strategy: string;
  sources?: string[];
  /** Backend sends plain artist names; the browser engine sends rich details. */
  covers?: (string | CoverInfo)[];
}

/** API response from /upload or /identify */
export interface ApiResponse {
  success: boolean;
  transcript: string;
  error?: string;
  results: SongResult[];
  /** Backend confidence band: high = sure, uncertain = close call, low = weak. */
  confidence_label?: 'high' | 'uncertain' | 'low';
  /** Gap between top-1 and top-2 final confidence. */
  margin?: number;
  // Backward-compat flat fields (top result)
  song?: string;
  artist?: string;
  confidence?: number;
  timestamp?: number | null;
  spotify_url?: string;
}

/** SSE progress event */
export interface ProgressEvent {
  stage: 'searching' | 'found' | 'lyrics' | 'matching' | 'spotify' | 'candidate_ready' | 'complete' | 'error';
  message?: string;
  candidates_count?: number;
  candidates?: { song: string; artist: string }[];
  result?: SongResult;
  completed?: number;
  total?: number;
  results?: SongResult[];
  transcript?: string;
  success?: boolean;
}

/**
 * Upload audio file for processing.
 */
export async function uploadAudio(audioBlob: Blob, signal?: AbortSignal): Promise<ApiResponse> {
  const formData = new FormData();
  const mimeType = audioBlob.type || '';
  const ext = (mimeType === 'audio/mp4' || mimeType === 'video/mp4') ? 'mp4'
    : mimeType.startsWith('audio/ogg') ? 'ogg'
    : 'webm';
  formData.append('file', audioBlob, `recording.${ext}`);

  const response = await axios.post<ApiResponse>(
    `${getApiBase()}/upload`,
    formData,
    {
      timeout: 60000, // 60s for Whisper processing
      signal,
    }
  );

  return response.data;
}

/**
 * Identify song from typed lyrics text (non-streaming fallback).
 */
export async function identifyLyrics(lyrics: string, signal?: AbortSignal): Promise<ApiResponse> {
  const response = await axios.post<ApiResponse>(
    `${getApiBase()}/identify`,
    { lyrics },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
      signal,
    }
  );

  return response.data;
}

/**
 * Identify song from typed lyrics via SSE streaming.
 * Calls onProgress for each stage update.
 */
export async function identifyLyricsStream(
  lyrics: string,
  onProgress: (event: ProgressEvent) => void,
  signal?: AbortSignal
): Promise<ApiResponse | null> {
  // Combine user signal with a 60s timeout to prevent hanging forever
  // Use AbortSignal.any if available (Safari 17.4+), otherwise manual fallback
  let combinedSignal: AbortSignal;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 60000);
  let abortHandler: (() => void) | null = null;

  if (signal) {
    if (typeof AbortSignal.any === 'function') {
      combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    } else {
      // Fallback: propagate user abort to timeout controller
      abortHandler = () => timeoutController.abort();
      signal.addEventListener('abort', abortHandler);
      combinedSignal = timeoutController.signal;
    }
  } else {
    combinedSignal = timeoutController.signal;
  }

  let readerRef: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let streamDone = false;

  if (signal?.aborted) {
    clearTimeout(timeoutId);
    throw new DOMException('Aborted', 'AbortError');
  }

  try {
  const response = await fetch(`${getApiBase()}/identify/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lyrics }),
    signal: combinedSignal,
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  readerRef = reader;

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: ApiResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) { streamDone = true; break; }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event: ProgressEvent = JSON.parse(line.slice(6));
          onProgress(event);

          if (event.stage === 'complete' && event.results) {
            finalResult = {
              success: true,
              transcript: event.transcript || lyrics,
              results: event.results,
            };
          } else if (event.stage === 'error' && !finalResult) {
            // Server reported an error — propagate via onProgress but don't fail yet
            // (other candidates may still succeed)
          }
        } catch (e) {
          console.warn('SSE parse error:', e, line);
        }
      }
    }
  }

  return finalResult;
  } finally {
    clearTimeout(timeoutId);
    if (!streamDone) readerRef?.cancel().catch(() => {});
    if (abortHandler && signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

/**
 * Extract Spotify track ID from URL.
 */
export function extractSpotifyTrackId(url: string): string | null {
  const match = url.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Format seconds to mm:ss display.
 */
export function formatTimestamp(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get confidence color class.
 */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 85) return 'text-green-400';
  if (confidence >= 70) return 'text-yellow-400';
  if (confidence >= 50) return 'text-orange-400';
  return 'text-red-400';
}

/**
 * Get confidence ring color.
 */
export function getConfidenceRingColor(confidence: number): string {
  if (confidence >= 85) return '#1DB954';
  if (confidence >= 70) return '#EAB308';
  if (confidence >= 50) return '#F97316';
  return '#EF4444';
}

/**
 * Submit feedback (thumbs up/down) for a result.
 */
export async function submitFeedback(
  query: string,
  song: string,
  artist: string,
  action: 'up' | 'down'
): Promise<void> {
  await axios.post(`${getApiBase()}/feedback`, { query, song, artist, action });
}
