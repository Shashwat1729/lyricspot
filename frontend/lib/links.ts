/**
 * Streaming links for a matched song.
 *
 * The timestamp feature needs a real Spotify *track id* (the embed player
 * seeks to the matched line; a search URL cannot). Resolution order:
 *   1. Track URL the backend already sent.
 *   2. The visitor's own Spotify app keys (exact Web API search).
 *   3. Keyless: iTunes track id -> song.link (Odesli) cross-platform lookup,
 *      which also yields YouTube and Apple Music links.
 * Everything is fail-soft and cached per song for the session.
 */

import { extractSpotifyTrackId } from "./api";
import { getMusicKeys, spotifyAppToken } from "./musicKeys";

export interface StreamingLinks {
  spotifyTrackId: string | null;
  spotifyUrl: string;
  youtubeUrl: string;
  appleUrl: string | null;
  /** Which path produced the Spotify track id (for honest UI copy). */
  via: "backend" | "spotify" | "songlink" | "none";
}

const CACHE_KEY = "lyricspot.links.v1";
const memory = new Map<string, StreamingLinks>();

function cacheKey(song: string, artist: string): string {
  return (song + "|" + artist).toLowerCase().trim();
}

function readSession(key: string): StreamingLinks | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, StreamingLinks>;
    return all[key] || null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: StreamingLinks): void {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, StreamingLinks>) : {};
    all[key] = value;
    const keys = Object.keys(all);
    // Bounded: keep the 60 most recent entries.
    for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete all[k];
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // storage blocked — memory cache still applies
  }
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export function spotifySearchUrl(song: string, artist: string): string {
  return "https://open.spotify.com/search/" + encodeURIComponent((song + " " + artist).trim());
}

export function youtubeSearchUrl(song: string, artist: string): string {
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent((song + " " + artist).trim());
}

const NON_WORD = new RegExp("[^\\p{L}\\p{N} ]", "gu");

/** Loose same-song check used to accept a catalog hit for (song, artist). */
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\s*[\(\[].*?[\)\]]\s*/g, " ")
    .replace(/\s+-\s+.*$/, "")
    .replace(NON_WORD, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameSong(aTitle: string, aArtist: string, bTitle: string, bArtist: string): boolean {
  const ta = norm(aTitle), tb = norm(bTitle);
  if (!ta || !tb) return false;
  const titleOk = ta === tb || ta.startsWith(tb) || tb.startsWith(ta);
  if (!titleOk) return false;
  const aa = norm(aArtist), ab = norm(bArtist);
  if (!aa || !ab) return true;
  return aa.includes(ab) || ab.includes(aa) || aa.split(" ").some((w) => w.length > 2 && ab.includes(w));
}

async function viaSpotifyKeys(song: string, artist: string): Promise<string | null> {
  const keys = getMusicKeys();
  if (!keys.spotifyId || !keys.spotifySecret) return null;
  const token = await spotifyAppToken(keys.spotifyId, keys.spotifySecret);
  if (!token) return null;
  try {
    const q = "track:" + song + (artist ? " artist:" + artist : "");
    const r = await fetch("https://api.spotify.com/v1/search?type=track&limit=5&q=" + encodeURIComponent(q), {
      headers: { Authorization: "Bearer " + token },
      signal: timeoutSignal(6000),
    });
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => null);
    const items: any[] = j?.tracks?.items || [];
    const hit = items.find((t) => sameSong(t.name || "", (t.artists || []).map((a: any) => a.name).join(" "), song, artist)) || null;
    return hit ? String(hit.id) : null;
  } catch {
    return null;
  }
}

async function itunesTrack(song: string, artist: string): Promise<{ id: number; url: string } | null> {
  try {
    const term = (song + " " + artist).trim();
    const r = await fetch("https://itunes.apple.com/search?entity=song&limit=5&term=" + encodeURIComponent(term), { signal: timeoutSignal(5000) });
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => null);
    const list: any[] = j?.results || [];
    const hit = list.find((t) => sameSong(t.trackName || "", t.artistName || "", song, artist));
    return hit ? { id: Number(hit.trackId), url: String(hit.trackViewUrl || "") } : null;
  } catch {
    return null;
  }
}

async function viaSongLink(itunesId: number): Promise<{ spotifyId: string | null; youtube: string | null; apple: string | null }> {
  try {
    const r = await fetch(
      "https://api.song.link/v1-alpha.1/links?platform=itunes&type=song&id=" + itunesId,
      { signal: timeoutSignal(7000) }
    );
    if (!r.ok) return { spotifyId: null, youtube: null, apple: null };
    const j: any = await r.json().catch(() => null);
    const byPlatform = j?.linksByPlatform || {};
    const spotifyUrl: string = byPlatform.spotify?.url || "";
    return {
      spotifyId: extractSpotifyTrackId(spotifyUrl),
      youtube: byPlatform.youtube?.url || byPlatform.youtubeMusic?.url || null,
      apple: byPlatform.appleMusic?.url || byPlatform.itunes?.url || null,
    };
  } catch {
    return { spotifyId: null, youtube: null, apple: null };
  }
}

const inflight = new Map<string, Promise<StreamingLinks>>();

/** Resolve streaming links for one song. Never throws. */
export function resolveLinks(song: string, artist: string, knownSpotifyUrl?: string): Promise<StreamingLinks> {
  const key = cacheKey(song, artist);
  const fallback: StreamingLinks = {
    spotifyTrackId: null,
    spotifyUrl: spotifySearchUrl(song, artist),
    youtubeUrl: youtubeSearchUrl(song, artist),
    appleUrl: null,
    via: "none",
  };
  const known = extractSpotifyTrackId(knownSpotifyUrl);
  if (known) {
    return Promise.resolve({ ...fallback, spotifyTrackId: known, spotifyUrl: "https://open.spotify.com/track/" + known, via: "backend" });
  }
  const cached = memory.get(key) || (typeof window !== "undefined" ? readSession(key) : null);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running) return running;

  const job = (async () => {
    const out: StreamingLinks = { ...fallback };
    const fromKeys = await viaSpotifyKeys(song, artist);
    if (fromKeys) {
      out.spotifyTrackId = fromKeys;
      out.via = "spotify";
    }
    const it = await itunesTrack(song, artist);
    if (it) {
      out.appleUrl = it.url || null;
      if (!out.spotifyTrackId || out.youtubeUrl === fallback.youtubeUrl) {
        const sl = await viaSongLink(it.id);
        if (!out.spotifyTrackId && sl.spotifyId) {
          out.spotifyTrackId = sl.spotifyId;
          out.via = "songlink";
        }
        if (sl.youtube) out.youtubeUrl = sl.youtube;
        if (sl.apple) out.appleUrl = sl.apple;
      }
    }
    if (out.spotifyTrackId) out.spotifyUrl = "https://open.spotify.com/track/" + out.spotifyTrackId;
    memory.set(key, out);
    if (typeof window !== "undefined") writeSession(key, out);
    return out;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Spotify web link that starts at `seconds` where supported. */
export function spotifyLinkAt(trackId: string, seconds: number | null): string {
  const base = "https://open.spotify.com/track/" + trackId;
  if (seconds == null || seconds <= 0) return base;
  const s = Math.floor(seconds);
  return base + "#" + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
