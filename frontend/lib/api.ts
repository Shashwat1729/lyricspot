/**
 * API helper functions for ContinueMySong AI frontend.
 */

import axios from 'axios';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

/** Single timestamp occurrence of the matched lyric (repeated choruses). */
export interface LyricOccurrence {
  timestamp: number;
  match_score: number;
  matched_line: string;
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
    `${API_BASE}/upload`,
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
    `${API_BASE}/identify`,
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
  const response = await fetch(`${API_BASE}/identify/stream`, {
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
  await axios.post(`${API_BASE}/feedback`, { query, song, artist, action });
}
