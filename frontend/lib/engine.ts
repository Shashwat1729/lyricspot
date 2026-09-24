/**
 * Search orchestrator: one entry point for the UI, whatever runs the search.
 *
 * - Backend reachable  -> server pipeline (wider sources, Whisper for voice).
 * - Otherwise / on backend failure -> browser engine (lib/browserSearch.ts).
 *
 * Both produce the same normalized SearchResponse so the UI never branches
 * on where results came from (beyond an honest "searched in your browser").
 */

import {
  identifyLyrics,
  uploadAudio,
  BackendError,
  shouldAttemptBackend,
  type ApiResponse,
  type SongResult,
  type CoverInfo,
} from "./api";
import { browserIdentify } from "./browserSearch";

export type Stage = "transcribing" | "searching" | "verifying" | "ranking";

export interface Progress {
  stage: Stage;
  message: string;
}

export interface Match {
  id: string;
  song: string;
  artist: string;
  /** 0..100 ranking confidence. */
  confidence: number;
  timestamp: number | null;
  timestampDisplay: string | null;
  timestampEstimated: boolean;
  context: { before: string[]; matched: string; after: string[] } | null;
  occurrences: { timestamp: number; matchScore: number; line: string }[];
  spotifyUrl: string;
  albumArt: string;
  source: string;
  covers: CoverInfo[];
}

export type ConfidenceLabel = "high" | "uncertain" | "low";

export interface SearchResponse {
  transcript: string;
  matches: Match[];
  label: ConfidenceLabel;
  engine: "backend" | "browser";
  /** "melody" when a hummed clip was matched by tune instead of words. */
  matchedBy: "lyrics" | "melody";
  /** Honest note shown above results (e.g. backend fell back to browser). */
  notice?: string;
}

export class SearchError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "SearchError";
    this.hint = hint;
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function fmt(ts: number | null): string | null {
  if (ts == null || !isFinite(ts) || ts < 0) return null;
  return Math.floor(ts / 60) + ":" + String(Math.floor(ts % 60)).padStart(2, "0");
}

/** Band from absolute top score and the gap to #2 (same rule both engines). */
export function labelFor(matches: Match[]): ConfidenceLabel {
  const top = matches[0]?.confidence ?? 0;
  const second = matches[1]?.confidence ?? 0;
  if (top >= 70 && top - second >= 10) return "high";
  if (top >= 50) return "uncertain";
  return "low";
}

function normalizeCovers(covers: SongResult["covers"]): CoverInfo[] {
  return (covers || [])
    .map((c) => (typeof c === "string" ? { artist: c } : c))
    .filter((c): c is CoverInfo => !!c && !!c.artist);
}

export function normalizeResults(results: SongResult[]): Match[] {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const r of results || []) {
    if (!r || !r.song) continue;
    // The backend's "fallback_search" entry is the query echoed back as a
    // song name, not a match — never show it as one.
    if (r.strategy === "fallback_search") continue;
    const key = (r.song + "|" + (r.artist || "")).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    // Backend uses 0 for "no timestamp"; only trust a timestamp that comes
    // with lyric evidence or an explicit positive value.
    const hasTs = r.timestamp != null && (r.timestamp > 0 || !!r.lyrics_context);
    const ts = hasTs ? Number(r.timestamp) : null;
    out.push({
      id: key,
      song: r.song,
      artist: r.artist || "",
      confidence: Math.max(0, Math.min(100, Math.round(Number(r.confidence) || 0))),
      timestamp: ts,
      timestampDisplay: ts != null ? r.timestamp_display || fmt(ts) : null,
      timestampEstimated: !!r.timestamp_estimated,
      context: r.lyrics_context && r.lyrics_context.matched ? r.lyrics_context : null,
      occurrences: (r.occurrences || [])
        .filter((o) => o && typeof o.timestamp === "number")
        .map((o) => ({ timestamp: o.timestamp, matchScore: o.match_score, line: o.matched_line })),
      spotifyUrl: r.spotify_url || "",
      albumArt: r.album_art || "",
      source: r.strategy || "search",
      covers: normalizeCovers(r.covers),
    });
  }
  return out;
}

function fromApi(data: ApiResponse, engine: "backend" | "browser", notice?: string): SearchResponse {
  const matches = normalizeResults(data.results);
  const label = data.confidence_label || labelFor(matches);
  return { transcript: data.transcript, matches, label, engine, notice, matchedBy: data.input === "melody" ? "melody" : "lyrics" };
}

async function runBrowser(text: string, onProgress: (p: Progress) => void, signal: AbortSignal, notice?: string): Promise<SearchResponse> {
  const stageMap: Record<string, Stage> = { searching: "searching", lyrics: "verifying", candidate_ready: "ranking" };
  try {
    const res = await browserIdentify(
      text,
      (stage, message) => onProgress({ stage: stageMap[stage] || "searching", message }),
      signal
    );
    const matches = normalizeResults(res.results as unknown as SongResult[]);
    return { transcript: res.transcript, matches, label: labelFor(matches), engine: "browser", notice, matchedBy: "lyrics" };
  } catch (err) {
    if (isAbort(err)) throw err;
    const msg = err instanceof Error ? err.message : "Search failed.";
    throw new SearchError(
      /no (close|matching)/i.test(msg) ? "No song matched that line." : msg,
      "Try a longer or more distinctive line, check the spelling, or add free keys under Sources for more lyric databases."
    );
  }
}

/** Identify a song from typed (or browser-transcribed) lyrics. */
export async function searchText(
  text: string,
  opts: { signal: AbortSignal; onProgress: (p: Progress) => void; useBackend: boolean }
): Promise<SearchResponse> {
  const query = text.replace(/\s+/g, " ").trim();
  if (query.length < 3) throw new SearchError("That's too short to search.", "Type at least a few words of the lyric.");
  opts.onProgress({ stage: "searching", message: "Searching lyric databases…" });

  let notice: string | undefined;
  if (opts.useBackend && shouldAttemptBackend()) {
    try {
      const data = await identifyLyrics(query, opts.signal);
      if (data.success) {
        const res = fromApi(data, "backend");
        if (res.matches.length) return res;
      }
      if (!data.success && data.error && /no lyrics|too short/i.test(data.error)) {
        throw new SearchError(data.error);
      }
      notice = "The backend found nothing, so we also searched from your browser.";
    } catch (err) {
      if (isAbort(err) || err instanceof SearchError) throw err;
      notice = err instanceof BackendError && err.unreachable
        ? "The backend is unreachable, so this search ran in your browser."
        : "The backend had a problem, so this search ran in your browser.";
    }
  }
  return runBrowser(query, opts.onProgress, opts.signal, notice);
}

/** Identify a song from a recorded clip via the backend's Whisper. */
export async function searchAudio(
  blob: Blob,
  opts: { signal: AbortSignal; onProgress: (p: Progress) => void }
): Promise<SearchResponse> {
  opts.onProgress({ stage: "transcribing", message: "Transcribing your singing…" });
  let data: ApiResponse;
  try {
    data = await uploadAudio(blob, opts.signal);
  } catch (err) {
    if (isAbort(err)) throw err;
    if (err instanceof BackendError) {
      throw new SearchError(
        err.unreachable ? "Lost connection to the backend." : err.message,
        "Switch to Type lyrics and enter the line you sang."
      );
    }
    throw new SearchError("Voice search failed.", "Try again, or type the lyric instead.");
  }
  if (!data.success) {
    throw new SearchError(
      data.error || "Couldn't make out any lyrics.",
      data.transcript ? "We heard “" + data.transcript + "”. Sing a longer, clearer line or type it." : "Sing a clear line for 5–10 seconds, or type it instead."
    );
  }
  const res = fromApi(data, "backend");
  if (!res.matches.length) {
    throw new SearchError("No song matched what we heard.", data.transcript ? "We heard “" + data.transcript + "”. Try typing the line instead." : undefined);
  }
  return res;
}

// ---- Recent searches (per-device convenience) ----

export interface RecentSearch {
  query: string;
  song?: string;
  artist?: string;
  at: number;
}

const RECENT_KEY = "lyricspot.recent.v1";

export function getRecent(): RecentSearch[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as RecentSearch[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.query === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function addRecent(entry: RecentSearch): RecentSearch[] {
  const next = [entry, ...getRecent().filter((r) => r.query.toLowerCase() !== entry.query.toLowerCase())].slice(0, 6);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage blocked
  }
  return next;
}

export function clearRecent(): void {
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    // storage blocked
  }
}
