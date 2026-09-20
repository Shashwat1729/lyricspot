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
  googleKey: string;
  googleCx: string;
  geminiKey: string;
}

const STORAGE_KEY = "lyricspot.keys.v1";

const EMPTY: MusicKeys = { genius: "", musixmatch: "", spotifyId: "", spotifySecret: "", googleKey: "", googleCx: "", geminiKey: "" };

/**
 * Gemini model for query understanding. Rolling alias (never 404s on
 * retirement); verified against the live models list. Do NOT pin a dated
 * version (gemini-2.0-flash was retired and broke the call).
 */
export const GEMINI_MODEL = "gemini-flash-latest";

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
    return { genius: "", musixmatch: "", spotifyId: "", spotifySecret: "", googleKey: "", googleCx: "", geminiKey: "" };
  }
  const read = (v: string | undefined) => (v || "").trim();
  return {
    genius: read(process.env.NEXT_PUBLIC_GENIUS_TOKEN),
    musixmatch: read(process.env.NEXT_PUBLIC_MUSIXMATCH_KEY),
    spotifyId: read(process.env.NEXT_PUBLIC_SPOTIFY_ID),
    spotifySecret: read(process.env.NEXT_PUBLIC_SPOTIFY_SECRET),
    googleKey: read(process.env.NEXT_PUBLIC_GOOGLE_KEY),
    googleCx: read(process.env.NEXT_PUBLIC_GOOGLE_CX),
    geminiKey: read(process.env.NEXT_PUBLIC_GEMINI_KEY),
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
      googleKey: (parsed.googleKey || "").trim(),
      googleCx: (parsed.googleCx || "").trim(),
      geminiKey: (parsed.geminiKey || "").trim(),
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
    googleKey: stored.googleKey || fallback.googleKey,
    googleCx: stored.googleCx || fallback.googleCx,
    geminiKey: stored.geminiKey || fallback.geminiKey,
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
    googleKey: (keys.googleKey || "").trim(),
    googleCx: (keys.googleCx || "").trim(),
      geminiKey: (keys.geminiKey || "").trim(),
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
      && check.spotifySecret === clean.spotifySecret
      && check.googleKey === clean.googleKey
      && check.googleCx === clean.googleCx
      && check.geminiKey === clean.geminiKey;
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
  return !!(keys.genius || keys.musixmatch || (keys.spotifyId && keys.spotifySecret) || (keys.googleKey && keys.googleCx) || keys.geminiKey);
}

const AI_ASSIST_KEY = "lyricspot.aiAssist.v1";

/**
 * AI query-help master switch. ON (default) uses the saved Gemini key to
 * reformulate queries; OFF runs the pure regex/fuzzy/transliteration
 * path so anyone can prove the app works without AI. Stored per-device.
 */
export function getAiAssist(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(AI_ASSIST_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setAiAssist(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_ASSIST_KEY, on ? "1" : "0");
  } catch {
    // ignore
  }
}

/**
 * Test a Gemini key with a 2-word probe (same generateContent call shape
 * the engine uses). Burns one tiny request.
 */
export async function testGeminiKey(key: string): Promise<{ ok: boolean; detail: string }> {
  if (!key.trim()) {
    return { ok: false, detail: "Paste your key first: aistudio.google.com/apikey → Create API key." };
  }
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + encodeURIComponent(key.trim()), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with exactly: OK" }] }] }),
      signal: timeoutSignal(15000),
    });
    if (r.status === 400 || r.status === 403) {
      const j: any = await r.json().catch(() => null);
      const msg = j?.error?.message || "invalid key";
      return { ok: false, detail: "Gemini rejected the key (" + msg + ")." };
    }
    if (r.status === 429) return { ok: false, detail: "Gemini quota spent — retry later." };
    if (!r.ok) return { ok: false, detail: "Gemini request failed (HTTP " + r.status + ")." };
    return { ok: true, detail: "Gemini key works." };
  } catch {
    return { ok: false, detail: "Cannot reach generativelanguage.googleapis.com — check connection/ad-blocker." };
  }
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
// Shared in-flight request: popularity lookups run ~10-way parallel, and
// without this every one fires its own token POST (cache stampede that
// wastes quota and risks rate-limiting the token endpoint).
let spotifyTokenInflight: Promise<string | null> | null = null;

/** Client-credentials token for the visitor's own Spotify app. Cached in memory. */
export async function spotifyAppToken(id: string, secret: string): Promise<string | null> {
  if (!id.trim() || !secret.trim()) return null;
  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt) return spotifyTokenCache.token;
  if (spotifyTokenInflight) return spotifyTokenInflight;
  spotifyTokenInflight = (async () => {
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
    } finally {
      spotifyTokenInflight = null;
    }
  })();
  return spotifyTokenInflight;
}

/**
 * Test a Google Custom Search key + engine ID with a 1-result probe
 * (same call the engine makes; costs 1 of 100 free queries/day).
 */
export async function testGoogleKeys(key: string, cx: string): Promise<{ ok: boolean; detail: string }> {
  if (!key.trim() || !cx.trim()) {
    return { ok: false, detail: "Paste both the API key and the Search engine ID first (see README)." };
  }
  try {
    const r = await fetch("https://customsearch.googleapis.com/customsearch/v1?q=" + encodeURIComponent("hey jude") + "&num=1&key=" + encodeURIComponent(key.trim()) + "&cx=" + encodeURIComponent(cx.trim()), {
      signal: timeoutSignal(12000),
    });
    if (r.status === 400 || r.status === 403) {
      const j: any = await r.json().catch(() => null);
      const msg = j?.error?.message || "invalid key/engine id";
      return { ok: false, detail: "Google rejected the credentials (" + msg + ")." };
    }
    if (r.status === 429) return { ok: false, detail: "Google quota spent for today (100 free/day) — retry tomorrow." };
    if (!r.ok) return { ok: false, detail: "Google request failed (HTTP " + r.status + ")." };
    return { ok: true, detail: "Google keys work." };
  } catch {
    return { ok: false, detail: "Cannot reach customsearch.googleapis.com — check connection/ad-blocker." };
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
