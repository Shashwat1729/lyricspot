/**
 * Visitor-owned music API keys for ContinueMySong AI (static-site mode).
 *
 * The public demo has no backend, so the browser calls music APIs directly.
 * Keys are typed into Settings and stored ONLY in this browser's
 * localStorage — they are never baked into the build, never committed,
 * and never sent anywhere except the API provider itself.
 *
 * - Genius: upgrades lyric discovery from the scraped webpage endpoint to
 *   the official api.genius.com search (GET /search?q=, Bearer token —
 *   see https://docs.genius.com). This is the documented "Apps Without
 *   Users" flow: a client access token from the API-client page covers
 *   read-only /search with no scopes. Free token at
 *   https://genius.com/api-clients ("Generate Access Token").
 * - Musixmatch: `track.search?q_lyrics=` is a genuine lyrics -> song index
 *   (14M+ songs, same provider the Python backend uses). Free key at
 *   https://developer.musixmatch.com/ (free tier: 2000 calls/day).
 * - Spotify: client id + secret enable the popularity signal and artwork
 *   via the official Web API. Get them at
 *   https://developer.spotify.com/dashboard
 */

"use client";

export interface MusicKeys {
  genius: string;
  musixmatch: string;
  spotifyId: string;
  spotifySecret: string;
}

const STORAGE_KEY = "lyricspot.keys.v1";

const EMPTY: MusicKeys = { genius: "", musixmatch: "", spotifyId: "", spotifySecret: "" };

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/**
 * Build-time defaults for LOCAL testing only (frontend/.env.local,
 * gitignored). Production Pages builds are made with that file moved aside,
 * so these are empty there and Settings/localStorage is the only source.
 * Saved keys in localStorage always win over these defaults.
 */
function envDefaults(): MusicKeys {
  // NOTE: each key MUST be read via a literal `process.env.NEXT_PUBLIC_*`
  // expression so Next.js inlines the value into the client bundle at build
  // time. Dynamic member access (env[name]) is NOT inlined and always reads
  // empty in the browser.
  if (typeof process === "undefined" || !process.env) {
    return { genius: "", musixmatch: "", spotifyId: "", spotifySecret: "" };
  }
  const read = (v: string | undefined) => (v || "").trim();
  return {
    genius: read(process.env.NEXT_PUBLIC_GENIUS_TOKEN),
    musixmatch: read(process.env.NEXT_PUBLIC_MUSIXMATCH_KEY),
    spotifyId: read(process.env.NEXT_PUBLIC_SPOTIFY_ID),
    spotifySecret: read(process.env.NEXT_PUBLIC_SPOTIFY_SECRET),
  };
}

/** In-memory copy: keys keep working for the session even if the browser
 *  blocks site storage (private mode, "clear on exit", quotas). */
let memoryCache: MusicKeys | null = null;

/** True when localStorage round-trips (write + read-back + delete). */
export function storageWritable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const probe = "__lyricspot_probe__";
    window.localStorage.setItem(probe, "1");
    const ok = window.localStorage.getItem(probe) === "1";
    window.localStorage.removeItem(probe);
    return ok;
  } catch {
    return false;
  }
}

function readStored(): MusicKeys | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MusicKeys>;
    return {
      genius: (parsed.genius || "").trim(),
      musixmatch: (parsed.musixmatch || "").trim(),
      spotifyId: (parsed.spotifyId || "").trim(),
      spotifySecret: (parsed.spotifySecret || "").trim(),
    };
  } catch {
    return null;
  }
}

export function getMusicKeys(): MusicKeys {
  const fallback = envDefaults();
  const stored = memoryCache || readStored();
  if (!stored) return { ...fallback };
  return {
    genius: stored.genius || fallback.genius,
    musixmatch: stored.musixmatch || fallback.musixmatch,
    spotifyId: stored.spotifyId || fallback.spotifyId,
    spotifySecret: stored.spotifySecret || fallback.spotifySecret,
  };
}

/**
 * Persist keys. Returns true only after read-back verification, so the UI
 * can show "Saved" honestly instead of assuming the write stuck.
 */
export function setMusicKeys(keys: MusicKeys): boolean {
  const clean: MusicKeys = {
    genius: (keys.genius || "").trim(),
    musixmatch: (keys.musixmatch || "").trim(),
    spotifyId: (keys.spotifyId || "").trim(),
    spotifySecret: (keys.spotifySecret || "").trim(),
  };
  memoryCache = { ...clean };
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    const check = readStored();
    return !!check
      && check.genius === clean.genius
      && check.musixmatch === clean.musixmatch
      && check.spotifyId === clean.spotifyId
      && check.spotifySecret === clean.spotifySecret;
  } catch {
    return false;
  }
}

export function clearMusicKeys(): void {
  memoryCache = { ...EMPTY };
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasAnyKey(keys: MusicKeys): boolean {
  return !!(keys.genius || keys.musixmatch || (keys.spotifyId && keys.spotifySecret));
}

/** Test a Musixmatch key with a tiny lyric search (same call the engine makes). */
export async function testMusixmatchKey(key: string): Promise<{ ok: boolean; detail: string }> {
  if (!key.trim()) {
    return { ok: false, detail: "Paste your key first: developer.musixmatch.com → My Apps → your app." };
  }
  try {
    const r = await fetch(
      "https://api.musixmatch.com/ws/1.1/track.search?q_lyrics=" + encodeURIComponent("yesterday") + "&page_size=1&page=1&apikey=" + encodeURIComponent(key.trim()),
      { signal: timeoutSignal(12000) }
    );
    if (!r.ok) return { ok: false, detail: "Musixmatch request failed (HTTP " + r.status + ")." };
    const j: any = await r.json().catch(() => null);
    const code = j?.message?.header?.status_code;
    if (code === 401 || code === 403) return { ok: false, detail: "Musixmatch rejected the key (unauthorized)." };
    if (code !== 200) return { ok: false, detail: "Musixmatch error (status " + code + ")." };
    return { ok: true, detail: "Musixmatch key works." };
  } catch {
    return { ok: false, detail: "Cannot reach api.musixmatch.com — it may block browsers (key still usable via backend)." };
  }
}

/**
 * Test a Genius token against the official search API, using the same
 * `access_token=` mechanism as the engine (header auth fails CORS
 * preflight from browsers; query-param auth is CORS-readable).
 */
export async function testGeniusKey(token: string): Promise<{ ok: boolean; detail: string }> {
  if (!token.trim()) {
    return { ok: false, detail: "Paste your token first: genius.com/api-clients → your app → Generate Access Token." };
  }
  try {
    const r = await fetch("https://api.genius.com/search?q=" + encodeURIComponent("hey jude") + "&access_token=" + encodeURIComponent(token.trim()), {
      signal: timeoutSignal(12000),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, detail: "Genius rejected the token (unauthorized) — regenerate it on the API-client page." };
    if (!r.ok) return { ok: false, detail: "Genius request failed (HTTP " + r.status + ")." };
    const j: any = await r.json().catch(() => null);
    const n = j?.response?.hits?.length ?? 0;
    return { ok: true, detail: "Genius key works (" + n + " hits on probe)." };
  } catch {
    return { ok: false, detail: "Cannot reach api.genius.com — check connection/ad-blocker (key still usable via backend)." };
  }
}

let spotifyTokenCache: { token: string; expiresAt: number } | null = null;

/** Client-credentials token for the visitor's own Spotify app. Cached in memory. */
export async function spotifyAppToken(id: string, secret: string): Promise<string | null> {
  if (!id.trim() || !secret.trim()) return null;
  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt) return spotifyTokenCache.token;
  try {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(id.trim() + ":" + secret.trim()),
      },
      body: "grant_type=client_credentials",
      signal: timeoutSignal(10000),
    });
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => null);
    if (!j?.access_token) return null;
    spotifyTokenCache = {
      token: j.access_token,
      expiresAt: Date.now() + Math.max(60, (j.expires_in || 3600) - 120) * 1000,
    };
    return spotifyTokenCache.token;
  } catch {
    return null;
  }
}

/** Test Spotify id+secret by fetching an app token. */
export async function testSpotifyKeys(id: string, secret: string): Promise<{ ok: boolean; detail: string }> {
  if (!id.trim() || !secret.trim()) {
    return { ok: false, detail: "Paste both Client ID and Client Secret first (developer.spotify.com/dashboard)." };
  }
  spotifyTokenCache = null;
  const token = await spotifyAppToken(id, secret);
  if (!token) return { ok: false, detail: "Spotify rejected the credentials or is unreachable." };
  return { ok: true, detail: "Spotify credentials work." };
}
