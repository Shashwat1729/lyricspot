/**
 * Backend client for LyricSpot.
 *
 * The backend is optional: the static site runs the whole search in the
 * browser (lib/browserSearch.ts). When a backend is reachable it is used
 * for Whisper voice transcription and its wider server-side search.
 */

const API_BASE_OVERRIDE_KEY = "lyricspot.apiBase";
const DEFAULT_API_BASE = "http://localhost:8000";

/** Build-time default from env (baked into the static export). */
function envApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE).replace(/\/+$/, "");
}

export function sanitizeApiBase(raw: string): string | null {
  const cleaned = (raw || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Effective backend base URL.
 * Priority: saved override (localStorage) > build-time env > localhost.
 * Read on every call so a change in the Sources panel applies at once.
 */
export function getApiBase(): string {
  const override = getApiBaseOverride();
  if (override) {
    const cleaned = sanitizeApiBase(override);
    if (cleaned) return cleaned;
  }
  return envApiBase();
}

/** Persist a custom backend URL (null/empty resets). Returns false if invalid. */
export function setApiBaseOverride(url: string | null): boolean {
  if (typeof window === "undefined") return false;
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

export function getApiBaseOverride(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(API_BASE_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

function isLocalHost(urlOrHost: string): boolean {
  const rest = (urlOrHost || "").toLowerCase().replace(/^https?:\/\//, "");
  const host = rest.startsWith("[") ? rest.slice(0, rest.indexOf("]") + 1) : rest.split(/[/:]/)[0];
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1"
    || host === "0.0.0.0" || host === "[::1]";
}

/**
 * Whether a backend call is worth attempting. On a public deploy with no
 * custom server configured, the default localhost backend cannot exist,
 * so skip the doomed request (and its console error) entirely.
 */
export function shouldAttemptBackend(): boolean {
  if (typeof window === "undefined") return false;
  if (getApiBaseOverride()) return true;
  const base = getApiBase();
  if (!isLocalHost(base)) return true;
  return isLocalHost(window.location.hostname);
}

/** What a reachable backend can do (from GET /health). */
export interface BackendInfo {
  ok: boolean;
  voice: boolean;
  /** Hummed clips can be matched by melody (ACRCloud configured). */
  melody: boolean;
  spotify: boolean;
  whisperModel: string | null;
  detail: string;
}

const OFFLINE: BackendInfo = { ok: false, voice: false, melody: false, spotify: false, whisperModel: null, detail: "" };

/** Probe GET /health. Never throws. */
export async function checkBackendHealth(timeoutMs = 4000, force = false): Promise<BackendInfo> {
  if (!force && !shouldAttemptBackend()) {
    return { ...OFFLINE, detail: "No backend configured — searching in your browser." };
  }
  const base = getApiBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(base + "/health", { signal: controller.signal });
    if (!res.ok) return { ...OFFLINE, detail: "Backend answered HTTP " + res.status + "." };
    const data: any = await res.json().catch(() => ({}));
    // Older backends did not report capabilities: assume voice when a
    // Whisper model is named.
    const voice = typeof data.voice === "boolean" ? data.voice : !!data.whisper_model;
    const model = data.whisper_model || null;
    return {
      ok: true,
      voice,
      melody: !!data.melody,
      spotify: !!data.spotify,
      whisperModel: model,
      detail: voice ? "Connected · Whisper " + (model || "ready") : "Connected · text search only (no Whisper)",
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ...OFFLINE, detail: "Timed out reaching " + base + "." };
    }
    return { ...OFFLINE, detail: "Cannot reach " + base + " (is it running? CORS allowed?)." };
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

/** A same-song alternate version (cover/live/remix). */
export interface CoverInfo {
  artist: string;
  confidence?: number;
  timestamp_display?: string | null;
  matched?: string;
}

/** Raw song result as sent by the backend or the browser engine. */
export interface SongResult {
  song: string;
  artist: string;
  confidence: number;
  timestamp: number | null;
  timestamp_display: string | null;
  timestamp_estimated?: boolean;
  lyrics_context?: { before: string[]; matched: string; after: string[] } | null;
  occurrences?: LyricOccurrence[];
  ambiguous?: boolean;
  spotify_url: string;
  album_art?: string;
  strategy: string;
  sources?: string[];
  /** Backend sends plain artist names; the browser engine sends details. */
  covers?: (string | CoverInfo)[];
}

/** Response shape of POST /upload and POST /identify. */
export interface ApiResponse {
  success: boolean;
  transcript: string;
  error?: string;
  results: SongResult[];
  confidence_label?: "high" | "uncertain" | "low";
  margin?: number;
  /** What the backend matched on: typed lyrics, sung words, or melody. */
  input?: "lyrics" | "voice" | "melody";
}

export class BackendError extends Error {
  /** true when the server could not be reached at all (vs. answered with an error). */
  unreachable: boolean;
  status: number;
  constructor(message: string, unreachable: boolean, status = 0) {
    super(message);
    this.name = "BackendError";
    this.unreachable = unreachable;
    this.status = status;
  }
}

function mergeSignals(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); },
    timedOut: () => timedOut,
  };
}

async function postJson(path: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number): Promise<ApiResponse> {
  const merged = mergeSignals(signal, timeoutMs);
  let res: Response;
  try {
    res = await fetch(getApiBase() + path, { ...init, signal: merged.signal });
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (merged.timedOut()) throw new BackendError("The server took too long to answer.", false);
    throw new BackendError("Cannot reach the backend at " + getApiBase() + ".", true);
  } finally {
    merged.cleanup();
  }
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (data && (data.detail || data.error)) || "Server error (HTTP " + res.status + ").";
    throw new BackendError(String(detail), false, res.status);
  }
  if (!data || !Array.isArray(data.results)) throw new BackendError("Unexpected response from the backend.", false, res.status);
  return data as ApiResponse;
}

/** Upload a voice clip for Whisper transcription + identification. */
export function uploadAudio(audioBlob: Blob, signal?: AbortSignal): Promise<ApiResponse> {
  const formData = new FormData();
  const mime = audioBlob.type || "";
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
  formData.append("file", audioBlob, "recording." + ext);
  // Whisper on CPU plus lyric verification can take a while on first run.
  return postJson("/upload", { method: "POST", body: formData }, signal, 90000);
}

/** Identify a song from typed lyrics. */
export function identifyLyrics(lyrics: string, signal?: AbortSignal): Promise<ApiResponse> {
  return postJson("/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lyrics }),
  }, signal, 50000);
}

/** Thumbs up/down on a result (backend only; fail-soft). */
export async function submitFeedback(query: string, song: string, artist: string, action: "up" | "down"): Promise<boolean> {
  try {
    const res = await fetch(getApiBase() + "/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, song, artist, action }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Spotify track id from an open.spotify.com track URL. */
export function extractSpotifyTrackId(url: string | null | undefined): string | null {
  const match = (url || "").match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]{10,})/);
  return match ? match[1] : null;
}

/** Seconds to m:ss. */
export function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ":" + secs.toString().padStart(2, "0");
}
