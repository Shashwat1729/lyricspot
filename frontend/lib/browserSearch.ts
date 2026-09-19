"use client";

// Browser-native identification: LRCLIB (lyrics) + iTunes (metadata/artwork).
// All calls are direct fetches — no backend required. Spotify URL is a
// search fallback (no Spotify API key needed in the browser).
//
// Visitor-owned FREE API keys (Settings → API keys, stored in their own
// browser only) upgrade the engine where available: a Musixmatch key adds
// genuine lyrics -> song search, a Genius token upgrades discovery to the
// official API, and Spotify credentials upgrade the popularity signal.
// Everything works keyless too (LRCLIB + iTunes + keyless Genius discovery).

import { getMusicKeys, spotifyAppToken } from "./musicKeys";

export interface BrowserCandidate {
  song: string;
  artist: string;
  confidence: number;
  timestamp: number | null;
  timestamp_display: string | null;
  timestamp_estimated?: boolean;
  lyrics_context: { before: string[]; matched: string; after: string[] } | null;
  occurrences: { timestamp: number; match_score: number; matched_line: string }[];
  ambiguous: boolean;
  spotify_url: string;
  album_art: string;
  strategy: string;
  covers?: CoverInfo[];
  isBrowser: true;
}

/** AbortSignal.timeout with fallback for older browsers. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/**
 * Stop/function words for query focus and title-overlap (English + Hindi
 * particles — pure function words, never song-specific content).
 */
const STOP = new Set(["a","an","the","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","must","can","this","that","these","those","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","all","any","both","each","few","more","most","other","some","such","no","nor","not","only","own","same","so","than","too","very","just","because","but","and","or","if","then","else","when","up","down","in","out","on","off","over","under","again","further","once","here","there","where","why","how","what","which","who","whom","there","is","no","it","its",
  // Hindi/Urdu particles (se = by/from, ne = ergative, ka/ki/ke = of, ko = to, ...).
  "se","ne","ka","ki","ke","ko","mein","me","aur","hai","hain","na","jo","bhi","par","ye","yeh","woh","vo","toh","kya","kaise","nahi","nahin"]);

/**
 * Spelling variants for romanized-lyric retrieval (rahon/rahoon, ...).
 * Servers match metadata words exactly, but romanized Hindi spells long
 * vowels both ways (o/oo, a/aa, i/ee, u/uu). Toggling one vowel at a time
 * on the longest content word produces the alternate spellings a title
 * index may use. Capped at 2: extra variants only cost fail-soft fetches,
 * and scoring (never retrieval) decides. Purely linguistic, song-agnostic.
 */
export function spellingVariants(word: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([word.toLowerCase()]);
  const lower = word.toLowerCase();
  if (lower.length < 4) return out;
  for (let i = 0; i < lower.length && out.length < 2; i++) {
    const c = lower[i];
    if (!"aeiou".includes(c)) continue;
    if (lower[i + 1] === c) {
      // doubled -> single ("rahoon" -> "rahon")
      const v = lower.slice(0, i) + lower.slice(i + 1);
      if (!seen.has(v)) { seen.add(v); out.push(v); }
      i++; // skip the pair
    } else if (i === 0 || lower[i - 1] !== c) {
      // single -> doubled ("rahon" -> "rahoon")
      const v = lower.slice(0, i + 1) + c + lower.slice(i + 1);
      if (!seen.has(v)) { seen.add(v); out.push(v); }
    }
  }
  return out;
}

/** Canonical artist key: dedupes "The Beatles" / "Beatles, The" / comma/ampersand variants. */
function canonicalArtist(name: string): string {
  let n = (name || "").toLowerCase().replace(/\s*-\s*topic$/i, "").replace(/\s*vevo$/i, "").trim();
  if (n.endsWith(", the")) n = "the " + n.slice(0, -5);
  if (n.startsWith("the ")) n = n.slice(4);
  // "Shashwat, Arijit, Irshad" vs "Shashwat Arijit Irshad" -> same key
  n = n.replace(/[,&]/g, " ").replace(/\band\b/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  // Order-insensitive for multi-artist credits: sorted tokens
  const parts = n.split(" ").filter(Boolean).sort();
  return parts.join(" ");
}

/** True for boilerplate/header lines that LRCLIB sometimes includes. */
function isBoilerplate(text: string): boolean {
  const t = text.toLowerCase();
  if (t.length < 3) return true;
  // Site-chrome patterns only (Genius page headers/promos) — never lyric words.
  if (/genius romanizations|you might also like|get tickets/i.test(t)) return true;
  if (/^\s*[-–—\s]*$/.test(t)) return true;
  // "Arijit Singh & Armaan Khan - Gehra Hua (Romanized)" style header, not a lyric
  if (/ - .*\(romanized\)/i.test(t) && t.split(/\s+/).length <= 10) return true;
  return false;
}

/**
 * Lyric discovery via Genius search (matches song LYRICS, no key needed).
 * LRCLIB q-search is metadata-only (title/artist/album), so lyric queries
 * whose words aren't in the title can never enter the pool from LRCLIB
 * alone. Genius hits give (title, artist); we then pull their actual
 * lyrics from LRCLIB structured search and verify locally — lyric evidence
 * still makes the final call. Fully fail-soft: any failure returns [] and
 * the pipeline behaves exactly as before.
 */
async function geniusLyricCandidates(transcript: string): Promise<{ title: string; artist: string; rank: number; matched: number }[]> {
  try {
    // Official API with the visitor's token when saved, else the keyless
    // webpage endpoint (same lyric-matching index, may be CORS-blocked).
    // NOTE: the token goes in `access_token=` (not the Authorization
    // header) because header-auth triggers a CORS preflight that
    // api.genius.com rejects, while simple GETs are CORS-readable —
    // verified live in Chrome. Genius documents this fallback in
    // docs.genius.com ("if you must"). Read-only token; TLS in transit.
    const geniusKey = getMusicKeys().genius;
    const url = geniusKey
      ? "https://api.genius.com/search?q=" + encodeURIComponent(transcript) + "&per_page=8&access_token=" + encodeURIComponent(geniusKey)
      : "https://genius.com/api/search?q=" + encodeURIComponent(transcript) + "&per_page=8";
    const r = await fetch(url, { signal: timeoutSignal(7000) });
    if (!r.ok) return [];
    const j: any = await r.json();
    const hits: any[] = j?.response?.hits || [];
    const out: { title: string; artist: string; rank: number; matched: number }[] = [];
    const seen = new Set<string>();
    for (const h of hits) {
      if (h?.type && h.type !== "song") continue;
      const res = h?.result || {};
      // Instrumentals carry no lyrics to verify (same rule as LRCLIB below).
      if (res.instrumental === true) continue;
      const title = (res.title || "").trim();
      const artist = (res.primary_artist?.name || res.artist_names || "").trim();
      if (!title || title.length > 80) continue;
      const key = title.toLowerCase() + "|" + artist.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Rank = position in the provider's own relevance order. Recorded so
      // ranking can use it as a weak near-tie prior (never dominant).
      // matched = query words Genius found in the lyrics; gates fallback
      // evidence cards so thin matches don't surface as results.
      const matched = typeof h.matched_words === "number" ? h.matched_words : 0;
      out.push({ title, artist, rank: out.length, matched });
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Count verifiable lyric lines (synced parsed, else plain non-empty).
 * Single-line "lyrics" are almost always instrumental markers or
 * provider errors — never verifiable evidence.
 */
export function lyricLineCount(item: any): number {
  const synced: string = (item && item.syncedLyrics) || "";
  if (synced) return parseSynced(synced).length;
  const plain: string = (item && item.plainLyrics) || "";
  if (!plain) return 0;
  return plain.split("\n").map((t: string) => t.trim()).filter(Boolean).length;
}

/**
 * Lyric entries for a known (title, artist): LRCLIB structured search
 * first (synced + plain), falling back to lyrics.ovh plain text when
 * LRCLIB has nothing usable. Skips degenerate single-line entries even
 * when better copies exist further down the provider list — a 1-line
 * stub both fails verification AND blocks better entries via dedupe.
 * Plain-only entries get synthetic timestamps downstream (flagged
 * estimated), exactly like LRCLIB plain entries.
 */
async function fetchLyricEntries(title: string, artist: string): Promise<any[]> {
  try {
    const url = "https://lrclib.net/api/search?track_name=" + encodeURIComponent(title)
      + (artist ? "&artist_name=" + encodeURIComponent(artist) : "");
    const r = await fetch(url, { signal: timeoutSignal(5000) });
    if (r.ok) {
      const d: any = await r.json();
      if (Array.isArray(d) && d.length) {
        const usable = d.filter((e: any) => lyricLineCount(e) >= 2).slice(0, 2);
        if (usable.length) return usable;
      }
    }
  } catch {
    // fall through to lyrics.ovh
  }
  if (!artist) return [];
  try {
    const r = await fetch("https://api.lyrics.ovh/v1/" + encodeURIComponent(artist) + "/" + encodeURIComponent(title), { signal: timeoutSignal(5000) });
    if (!r.ok) return [];
    const j: any = await r.json().catch(() => null);
    const text = (j && j.lyrics ? String(j.lyrics) : "").trim();
    if (text.length < 30) return [];
    return [{ trackName: title, artistName: artist, plainLyrics: text, syncedLyrics: "", duration: 0, _ovh: true }];
  } catch {
    return [];
  }
}

/**
 * Lyric search via Musixmatch `track.search?q_lyrics=` using the visitor's
 * own FREE key (Settings → API keys) — the same provider the Python backend
 * uses. Fully fail-soft (keyless browsers simply skip it).
 */
async function musixmatchLyricCandidates(transcript: string): Promise<{ title: string; artist: string; rank: number }[]> {
  const key = getMusicKeys().musixmatch;
  if (!key) return [];
  try {
    const url = "https://api.musixmatch.com/ws/1.1/track.search?q_lyrics=" + encodeURIComponent(transcript)
      + "&page_size=8&page=1&s_track_rating=desc&apikey=" + encodeURIComponent(key);
    const r = await fetch(url, { signal: timeoutSignal(8000) });
    if (!r.ok) return [];
    const j: any = await r.json().catch(() => null);
    if (j?.message?.header?.status_code !== 200) return [];
    const list: any[] = j?.message?.body?.track_list || [];
    const out: { title: string; artist: string; rank: number }[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const t = item?.track || {};
      const title = String(t.track_name || "").trim();
      const artist = String(t.artist_name || "").trim();
      if (!title || title.length > 80) continue;
      const k = title.toLowerCase() + "|" + artist.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ title, artist, rank: out.length });
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}

export interface WebPair {
  title: string;
  artist: string;
}

function cleanupName(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s*\(romanized\)\s*/i, " ").replace(/\s+/g, " ").trim();
}

/**
 * Identify (title, artist) from one web-search result. Pure and strict:
 * returns null rather than guessing. Handles Genius/AZLyrics title
 * conventions ("Artist – Title Lyrics") plus a generic "A - B" split and
 * "Title by Artist" fallback. No song-specific rules.
 */
export function parseWebResult(link: string, title: string): WebPair | null {
  let host = "";
  try {
    host = new URL(link).hostname.toLowerCase();
  } catch {
    return null;
  }
  const text = (title || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 120) return null;
  const stripSite = (s: string) => s
    .replace(/\s*[|–—\-]\s*(genius lyrics|genius|azlyrics(\.com)?|lyrics\.com|shazam|youtube|spotify|deezer|apple music|musixmatch|lyrics?\s*(\.com)?)\s*$/i, "")
    .trim();
  const valid = (artist: string, song: string) => {
    const a = cleanupName(artist), t = cleanupName(song.replace(/\s*lyrics?\s*$/i, ""));
    if (!a || !t || a.length < 2 || t.length < 2) return null;
    if (a.length > 60 || t.length > 80) return null;
    if (a.toLowerCase() === t.toLowerCase()) return null;
    return { artist: a, title: t };
  };
  const core = stripSite(text);
  // "Artist – Title" (Genius/AZLyrics/YouTube convention).
  const dash = core.match(/^(.*?)\s*[–—\-]\s*(.+)$/);
  if (dash && dash[1] && dash[2]) {
    const parsed = valid(dash[1], dash[2]);
    if (parsed) return parsed;
  }
  // "Title by Artist".
  const by = core.match(/^(.*?)\s+by\s+(.+)$/i);
  if (by && by[1] && by[2]) {
    const parsed = valid(by[2], by[1]);
    if (parsed) return parsed;
  }
  // AZLyrics slug fallback: /lyrics/artist/title.html (best effort).
  if (host.includes("azlyrics.com")) {
    const m = link.match(/\/lyrics\/([a-z0-9]+)\/([a-z0-9]+)\.html/i);
    if (m) {
      const deslug = (s: string) => s.replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim();
      if (m[1].length >= 3 && m[2].length >= 3) return { artist: deslug(m[1]), title: deslug(m[2]) };
    }
  }
  return null;
}

/**
 * Web discovery via Google Custom Search (visitor's free key + engine id):
 * the closest thing to "just google the lyric" — matches full lyric pages
 * Genius/AZLyrics indexes miss or rank poorly. Pairs are verified against
 * LRCLIB/lyrics.ovh like every other source; the index never decides.
 * Fully fail-soft (keyless browsers simply skip it).
 */
async function webSearchCandidates(transcript: string): Promise<{ title: string; artist: string; rank: number }[]> {
  const keys = getMusicKeys();
  if (!keys.googleKey || !keys.googleCx) return [];
  try {
    const url = "https://customsearch.googleapis.com/customsearch/v1?q=" + encodeURIComponent(transcript)
      + "&num=8&key=" + encodeURIComponent(keys.googleKey) + "&cx=" + encodeURIComponent(keys.googleCx);
    const r = await fetch(url, { signal: timeoutSignal(8000) });
    if (!r.ok) return [];
    const j: any = await r.json().catch(() => null);
    const items: any[] = (j && j.items) || [];
    const out: { title: string; artist: string; rank: number }[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const parsed = parseWebResult(String(it.link || ""), String(it.title || ""));
      if (!parsed) continue;
      const k = parsed.title.toLowerCase() + "|" + parsed.artist.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...parsed, rank: out.length });
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Strip version/credit suffixes so alternate releases group as one song:
 * "Hey Jude (Remastered 2015)", "Hey Jude - Live", "Song (feat. A)".
 * Only structural music-industry terms are stripped — never song words.
 */
function stripVersion(t: string): string {
  let s = " " + (t || "").toLowerCase() + " ";
  const WORD = "(remaster\\w*|remix|live|acoustic|unplugged|demo|take\\s*\\d+|version|cover|karaoke|tribute|instrumental|anniversary|deluxe|expanded|reprise|slowed|reverb|sped\\s*up|nightcore|official(\\s+music)?(\\s+video)?|lyric(s)?(\\s+video)?|audio|bonus(\\s+track)?|single|session|rehearsal|outtake|alternate|alternative|mono|stereo|feat\\.?|ft\\.?|featuring)";
  // Parenthetical/bracket credits containing a version keyword.
  s = s.replace(new RegExp("[\\(\\[][^\\)\\]]*" + WORD + "\\b[^\\)\\]]*[\\)\\]]", "gi"), " ");
  // Trailing version suffixes, repeatedly (handles combos like "- Live (Remastered)").
  for (let i = 0; i < 3; i++) {
    const next = s.replace(new RegExp("[\\s\\-\u2013\u2014:;/|,\\(]+?" + WORD + "\\b[\\s\\-\u2013\u2014:;/|,\\)\\]\\d]*$", "i"), " ");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim();
}

function normalizeTitle(t: string): string {
  return stripVersion(t);
}

function titleContentWords(t: string): Set<string> {
  return new Set(
    normalizeTitle(t).split(/\s+/).filter(w => w && !STOP.has(w) && (w.length >= 2 || /\d/.test(w)))
  );
}

function sharesContentWord(a: Set<string>, b: Set<string>): boolean {
  let shared = false;
  a.forEach(w => { if (b.has(w)) shared = true; });
  return shared;
}

/**
 * Same-recording family: near-identical best lyric lines AND shared
 * title evidence. Groups covers/remixes/live takes whose titles differ
 * ("Hey Jude - Live at ...") while keeping apart different songs that
 * merely quote one line (medleys) or share a generic word like "hum".
 * Both conditions are bounded and song-agnostic.
 */
function sameLyricFamily(lineA: string, lineB: string, wordsA: Set<string>, wordsB: Set<string>): boolean {
  if (!lineA || !lineB || !wordsA.size || !wordsB.size) return false;
  if (tokenScore(lineA, lineB) < 0.82) return false;
  // Distinctive shared word (length >=4, not a particle) or Jaccard >=0.25
  let sharedLong = false;
  let inter = 0;
  wordsA.forEach(w => { if (wordsB.has(w)) { inter++; if (w.length >= 4) sharedLong = true; } });
  if (sharedLong) return true;
  const union = wordsA.size + wordsB.size - inter;
  return union > 0 && inter / union >= 0.25;
}

/** A same-song alternate version attached to a result. */
export interface CoverInfo {
  artist: string;
  confidence: number;
  timestamp_display: string | null;
  matched: string;
}

/** Strip auto-generated channel suffixes ("Nirvana - Topic") from artist names. */
function cleanArtist(name: string): string {
  return (name || "")
    .replace(/\s*-\s*topic$/i, "")
    .replace(/\s*vevo$/i, "")
    .trim();
}

/**
 * Popularity 0..1 with source tag. Prefers the visitor's own Spotify app
 * (exact popularity field, source='spotify') when Spotify keys are saved;
 * otherwise falls back to the keyless iTunes Search position proxy
 * (source='proxy'). Never throws. Source matters: tie logic trusts
 * Spotify decisively, proxy only when its spread is strong.
 */
async function trackPopularity(track: string, artist: string): Promise<{ value: number; source: 'spotify' | 'proxy' }> {
  const keys = getMusicKeys();
  if (keys.spotifyId && keys.spotifySecret) {
    try {
      const token = await spotifyAppToken(keys.spotifyId, keys.spotifySecret);
      if (token) {
        const q = "track:" + track + (artist ? " artist:" + artist : "");
        const r = await fetch("https://api.spotify.com/v1/search?q=" + encodeURIComponent(q) + "&type=track&limit=1", {
          headers: { Authorization: "Bearer " + token },
          signal: timeoutSignal(5000),
        });
        if (r.ok) {
          const j: any = await r.json();
          const items: any[] = j?.tracks?.items || [];
          if (items.length && typeof items[0].popularity === "number") {
            return { value: Math.max(0, Math.min(1, items[0].popularity / 100)), source: 'spotify' };
          }
          // On Spotify with keys but no track found: genuinely obscure —
          // report low instead of the inflated iTunes proxy 1.0. Proxy
          // and Spotify scales are not comparable (see Rule 5).
          return { value: 0.2, source: 'spotify' };
        }
      }
    } catch {
      // fall through to keyless proxy
    }
  }
  try {
    const term = artist ? track + " " + artist : track;
    const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(term) + "&entity=song&limit=5", { signal: timeoutSignal(4000) });
    if (!r.ok) return { value: 0, source: 'proxy' };
    const j: any = await r.json();
    const list: any[] = j.results || [];
    for (const t of list) {
      const dt = (t.trackName || "").toLowerCase();
      if (dt && (track.toLowerCase().includes(dt) || dt.includes(track.toLowerCase()))) return { value: 1 - (list.indexOf(t) / 5), source: 'proxy' };
    }
    return { value: 0, source: 'proxy' };
  } catch {
    return { value: 0, source: 'proxy' };
  }
}

/**
 * Dynamic rule-based re-ranking. Base weights are 0.65 lyric / 0.25
 * popularity / 0.10 title, but rules shift them per query:
 *
 * Rule 1 — Exact hook (containment 0.92): lyric is near-verbatim, so
 *          boost lyric to 0.80, cut popularity/title. Prevents a famous
 *          but lyrically weaker cover from outranking the true hook.
 * Rule 2 — Short query (<=3 words, e.g. "hey jude"): lyric is the only
 *          reliable signal; popularity is noisy, so dampen it.
 * Rule 3 — Long query (>=6 words): lyric is highly specific, keep it
 *          dominant.
 * Rule 4 — Flat popularity (spread < 0.2, all obscure): drop pop entirely,
 *          renormalize the remaining two.
 * Rule 5 — Lyric tie (all scores within 0.05 of the max, e.g. the same
 *          lyric attached to several entries): lyric evidence can't
 *          separate the tied cluster. Inside the cluster only:
 *          (a) if popularity spread there is decisive (>= 0.25 — real
 *          Spotify values, not proxy noise), the more popular original
 *          wins with boosted pop weight;
 *          (b) otherwise popularity ABSTAINS (proxies all read ~1.0 and
 *          can't compare across songs) and the provider's own relevance
 *          rank decides with a bounded prior (≤5 pts). Both act strictly
 *          inside the tie — outside it, base weights are untouched.
 */
interface ScoredEntry {
  item: any;
  lines: { t: number; text: string }[];
  bestIdx: number;
  score: number;
  estimated: boolean;
}

interface RankedCandidate {
  item: any;
  lines: { t: number; text: string }[];
  bestIdx: number;
  score: number;
  titleBonus: number;
  pop: number;
  popSource: 'spotify' | 'proxy';
  final: number;
  estimated: boolean;
}

async function rerankByPopularity(
  transcript: string,
  candidates: ScoredEntry[]
): Promise<RankedCandidate[]> {
  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const maxLyric = Math.max(...candidates.map(c => c.score), 0);
  const withPop: RankedCandidate[] = await Promise.all(candidates.map(async (c) => {
    const track = c.item.trackName || "";
    const artist = cleanArtist(c.item.artistName || "");
    const { value: pop, source: popSource } = await trackPopularity(track, artist);
    const titleBonus = tokenScore(transcript.toLowerCase(), (track + " " + artist).toLowerCase());
    return { ...c, titleBonus, pop, popSource, final: 0 };
  }));
  const pops = withPop.map(c => c.pop);
  const spread = pops.length ? Math.max(...pops) - Math.min(...pops) : 0;
  const hasSpotify = withPop.some(c => c.popSource === 'spotify');
  // Proxy noise: many entries return 1.0 as top of their own search, so
  // raw spread is often 0 even when real popularities differ. Trust
  // proxy only with a larger spread; Spotify is trusted at 0.15.
  const usePop = hasSpotify ? spread >= 0.15 : spread >= 0.30;

  // Dynamic weights
  let wLyric = 0.65, wPop = 0.25, wTitle = 0.10;
  if (maxLyric >= 0.92) {
    // Exact hook — lyric is decisive
    wLyric = 0.80; wPop = 0.12; wTitle = 0.08;
  } else if (wordCount <= 3) {
    // Short query — lyric is king, popularity is noisy
    wLyric = 0.75; wPop = 0.15; wTitle = 0.10;
  } else if (wordCount >= 6) {
    wLyric = 0.70; wPop = 0.18; wTitle = 0.12;
  }
  if (!usePop) {
    // Renormalize without popularity so obscure artists aren't punished
    const sum = wLyric + wTitle;
    wLyric /= sum; wTitle /= sum; wPop = 0;
  }
  // Rule 5 — lyric-tie cluster: members within 0.05 of the max lyric
  // score. Inside the cluster, popularity judges only when its own spread
  // is decisive; otherwise it abstains and retrieval rank decides.
  const maxScore = withPop.length ? Math.max(...withPop.map(c => c.score)) : 0;
  const inCluster = (c: RankedCandidate) => withPop.length > 1 && (maxScore - c.score) <= 0.05;
  const clusterMembers = withPop.filter(inCluster);
  const clusterPops = clusterMembers.map(c => c.pop);
  const clusterSpread = clusterPops.length > 1 ? Math.max(...clusterPops) - Math.min(...clusterPops) : 0;
  // Like-with-like only: proxy scales (1.0 = top of its own search) and
  // Spotify scales (0-1 global) are not comparable. A lone proxy 1.0 must
  // never outrank a Spotify 0.6 on popularity.
  const clusterAllSpotify = clusterMembers.length > 1 && clusterMembers.every(c => c.popSource === 'spotify');
  const popDecisive = usePop && clusterAllSpotify && clusterSpread >= 0.15;

  for (const c of withPop) {
    const rank = typeof c.item._retrievalRank === "number" ? c.item._retrievalRank : 8;
    let wL = wLyric, wP = wPop;
    let retrievalBonus = 0;
    if (inCluster(c)) {
      // Keep weights summing to 1: whatever pop gains, lyric yields.
      wP = popDecisive ? Math.max(wPop, 0.30) : Math.min(wPop, 0.05);
      wL = wLyric + (wPop - wP);
      retrievalBonus = 0.05 * (1 - Math.min(rank, 8) / 8);
    }
    c.final = wL * c.score + wP * c.pop + wTitle * c.titleBonus + retrievalBonus;
    // Derivative recordings (karaoke/tribute/compilations) copy lyrics
    // verbatim, so lyric evidence alone can't demote them — yet they must
    // never outrank a credible artist's own recording. Mirrors backend.
    const spamHay = ((c.item.trackName || "") + " " + (c.item.artistName || "")).toLowerCase();
    if (/lyrics?|karaoke|cover version|tribute|compilation|best of|reaction|mashup/.test(spamHay)) {
      c.final = Math.min(c.final, 0.40);
    }
  }
  withPop.sort((a, b) => b.final - a.final || b.score - a.score || b.pop - a.pop);
  return withPop;
}

function fmt(ts: number | null): string | null {
  if (ts == null || ts < 0) return null;
  const m = Math.floor(ts / 60);
  const s = Math.floor(ts % 60).toString().padStart(2, "0");
  return m + ":" + s;
}

/** iTunes artwork for one track (keyless). Empty string on any failure. */
async function fetchArtwork(trackName: string, artistName: string, knownArt = ""): Promise<string> {
  if (knownArt) return knownArt;
  try {
    const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(trackName + " " + artistName) + "&entity=song&limit=1", { signal: timeoutSignal(3000) });
    if (!r.ok) return "";
    const j: any = await r.json();
    const first = j.results && j.results[0];
    return first && first.artworkUrl100 ? String(first.artworkUrl100).replace("100x100", "300x300") : "";
  } catch {
    return "";
  }
}

function parseSynced(synced: string): { t: number; text: string }[] {
  const lines: { t: number; text: string }[] = [];
  for (const raw of synced.split("\n")) {
    const m = raw.match(/^\[(\d+):(\d+)\.(\d+)\]\s*(.*)$/);
    if (!m) continue;
    const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseInt(m[3], 10) / 100;
    const text = m[4].trim();
    if (text) lines.push({ t, text });
  }
  return lines;
}

function isDevanagari(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0) || 0;
    if (cp >= 0x0900 && cp <= 0x097f) return true;
  }
  return false;
}

// Devanagari -> Latin for cross-script lyric matching (romanized Hindi
// queries vs Devanagari synced lyrics). Syllable-based with standard Hindi
// schwa deletion (final + medial CaCV́→CCV́: सपने→sapne, not sapane) and
// anusvara→n (में→man), so machine output lands near how humans romanize.
// Not a full transliterator — residual gaps (u/a variation, aspirates) are
// covered by relaxed-vowel + fuzzy token credit in tokenScore.
function romanizeDevanagari(s: string): string {
  const CONS: Record<string, string> = {
    "\u0915": "k", "\u0916": "kh", "\u0917": "g", "\u0918": "gh", "\u0919": "ng",
    "\u091A": "ch", "\u091B": "chh", "\u091C": "j", "\u091D": "jh", "\u091E": "ny",
    "\u091F": "t", "\u0920": "th", "\u0921": "d", "\u0922": "dh", "\u0923": "n",
    "\u0924": "t", "\u0925": "th", "\u0926": "d", "\u0927": "dh", "\u0928": "n",
    "\u092A": "p", "\u092B": "ph", "\u092C": "b", "\u092D": "bh", "\u092E": "m",
    "\u092F": "y", "\u0930": "r", "\u0932": "l", "\u0935": "v",
    "\u0936": "sh", "\u0937": "sh", "\u0938": "s", "\u0939": "h",
  };
  const SIGN: Record<string, string> = {
    "\u093E": "aa", "\u093F": "i", "\u0940": "ii", "\u0941": "u", "\u0942": "uu",
    "\u0947": "e", "\u0948": "ai", "\u094B": "o", "\u094C": "au",
  };
  const IND: Record<string, string> = {
    "\u0905": "a", "\u0906": "aa", "\u0907": "i", "\u0908": "ii", "\u0909": "u", "\u090A": "uu",
    "\u090F": "e", "\u0910": "ai", "\u0913": "o", "\u0914": "au",
  };
  const HALANT = "\u094D", ANUSVARA = "\u0902", CHANDRA = "\u0901", NUKTA = "\u093C", VISARGA = "\u0903";
  const isConsBase = (base: string) => /^[bcdfghjklmnpqrstvwxyz]/.test(base);
  const words: string[] = [];
  for (const word of s.split(/\s+/)) {
    if (!word) continue;
    const syls: { base: string; vowel: string | null }[] = [];
    const chars = Array.from(word);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const nxt = chars[i + 1];
      if (CONS[ch] !== undefined) {
        if (nxt !== undefined && SIGN[nxt] !== undefined) {
          syls.push({ base: CONS[ch], vowel: SIGN[nxt] }); i++;
        } else if (nxt === HALANT) {
          syls.push({ base: CONS[ch], vowel: "" }); i++; // conjunct joins next
        } else if (nxt === ANUSVARA || nxt === CHANDRA) {
          syls.push({ base: CONS[ch], vowel: "a" }); syls.push({ base: "n", vowel: null }); i++;
        } else if (nxt === VISARGA) {
          syls.push({ base: CONS[ch], vowel: "a" }); i++;
        } else {
          syls.push({ base: CONS[ch], vowel: "a" }); // inherent, may delete
        }
      } else if (IND[ch] !== undefined) {
        syls.push({ base: "", vowel: IND[ch] });
      } else if (ch === HALANT || ch === NUKTA || ch === VISARGA) {
        continue;
      } else if (/[\u0900-\u097F]/.test(ch)) {
        // Leftover vowel sign without base (shouldn't happen) — separator.
        syls.push({ base: " ", vowel: null });
      } else {
        syls.push({ base: ch, vowel: null });
      }
    }
    const out: string[] = [];
    for (let k = 0; k < syls.length; k++) {
      const syl = syls[k];
      if (syl.vowel === "a") {
        // Standard Hindi schwa deletion: drop inherent 'a' word-finally,
        // or medially in a VC_CV window (left syllable has a vowel, right
        // is consonant + explicit vowel): सपने→sapne, रामपुर→rampur.
        // Word-initial and pre-inherent positions keep it: गली→gali.
        const isFinal = k === syls.length - 1;
        const prev = k > 0 ? syls[k - 1] : null;
        const prevHasVowel = prev !== null && prev.vowel !== null && prev.vowel !== "";
        const next = syls[k + 1];
        const beforeExplicit = next !== undefined && isConsBase(next.base)
          && next.vowel !== null && next.vowel !== "" && next.vowel !== "a";
        if (isFinal || (prevHasVowel && beforeExplicit)) {
          out.push(syl.base); // drop the vowel, keep the consonant
          continue;
        }
      }
      out.push(syl.base + (syl.vowel || ""));
    }
    words.push(out.join(""));
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

/** Vowel-collapsed equality for cross-script pairs (hum/ham, tum/tam). */
function relaxedVowelEq(a: string, b: string): boolean {
  const collapse = (s: string) => s.toLowerCase().replace(/[uo]/g, "a");
  return collapse(a) === collapse(b);
}

/** Normalized edit similarity 0..1 (Levenshtein over short tokens). */
function editSimilarity(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

function tokenScore(a: string, b: string, soft = false): number {
  const aIsDeva = isDevanagari(a);
  const bIsDeva = isDevanagari(b);
  if (aIsDeva !== bIsDeva) {
    // Cross-script: romanize the Devanagari side and retry with soft
    // token credit (transliteration + human-spelling variation).
    const ar = aIsDeva ? romanizeDevanagari(a) : a;
    const br = bIsDeva ? romanizeDevanagari(b) : b;
    return tokenScore(ar, br, true);
  }
  const cleanA = a.toLowerCase().split(/\s+/).filter(Boolean);
  const cleanB = b.toLowerCase().split(/\s+/).filter(Boolean);
  const ta = new Set(cleanA);
  const tb = new Set(cleanB);
  if (ta.size === 0 || tb.size === 0) return 0;
  // Per-token credit, one code path for both scripts. Exact always counts.
  // Relaxed vowels (hum/ham) apply cross-script only — same-script
  // a/u/o swaps are usually different words (man/men, cat/cut).
  // Edit-fuzzy covers transcription/romanization variants (rahoon/rahon,
  // night/light as mishearing): strict same-script (len>=5, sim>=0.80),
  // looser cross-script (len>=4, sim>=0.72). Each line token is spent at
  // most once; greedy best-match order is deterministic.
  let inter = 0;
  {
    const used = new Set<number>();
    ta.forEach(w => {
      let best = 0, bestJ = -1;
      cleanB.forEach((v, j) => {
        if (used.has(j)) return;
        let c = 0;
        if (v === w) c = 1;
        else if (soft && relaxedVowelEq(v, w)) c = 0.9;
        else {
          const sim = editSimilarity(v, w);
          const minLen = Math.min(v.length, w.length);
          if (soft ? (minLen >= 4 && sim >= 0.72) : (minLen >= 5 && sim >= 0.80)) c = sim;
        }
        if (c > best) { best = c; bestJ = j; }
      });
      if (bestJ >= 0 && best > 0) { used.add(bestJ); inter += best; }
    });
  }
  if (inter >= ta.size - 1e-9) {
    // Gated containment: single-word or stop-word-only queries must not
    // jump to 0.92 — they'd make every line containing that word look
    // like a verbatim hook. Require at least 2 content tokens or 3 total
    // before granting the near-verbatim floor; otherwise fall through to
    // the BM25-style scorer where length and distinctiveness matter.
    const contentCount = cleanA.filter(w => !STOP.has(w) && w.length >= 2).length;
    if (ta.size >= 3 || contentCount >= 2 || (ta.size === 2 && contentCount === 2)) return 0.92;
    if (ta.size === 1 && contentCount === 1 && cleanA[0].length >= 5) return 0.92;
  }
  // BM25-inspired: term saturation + length normalization.
  // Short exact lines like "hello" (1 word) should not outrank a focused
  // 6-word verse that contains the same rare word.
  const prec = inter / ta.size;
  const rec = inter / tb.size;
  const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
  // Length penalty: long lines that only partially match are less relevant
  // (BM25's b * |D|/avgdl term). Short query in long verse is okay via
  // containment above; this penalizes the remaining partial matches.
  const lenNorm = 1 - 0.08 * Math.max(0, cleanB.length - cleanA.length - 2);
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  const sub = bl.includes(al) || al.includes(bl) ? 0.12 : 0;
  return Math.min(1, Math.max(0, f1 * lenNorm + sub));
}

function bestLine(transcript: string, lines: { t: number; text: string }[]): { idx: number; score: number } | null {
  let best: { idx: number; score: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const s = tokenScore(transcript, lines[i].text);
    if (!best || s > best.score) best = { idx: i, score: s };
    // also try adjacent line pairs for stitched phrases
    if (i + 1 < lines.length) {
      const pair = lines[i].text + " " + lines[i + 1].text;
      const ps = tokenScore(transcript, pair);
      if (ps > (best?.score ?? 0)) best = { idx: i, score: ps };
    }
  }
  return best;
}

export async function browserIdentify(transcript: string, onProgress?: (stage: string, msg: string) => void): Promise<{ transcript: string; results: BrowserCandidate[] }> {
  const clean = transcript.trim();
  if (!clean) throw new Error("Empty transcript");

  // Stage ids must match LoadingOverlay's known stages so the progress
  // UI advances instead of stalling on unknown ids.
  onProgress?.("searching", "Searching lyrics...");
  // LRCLIB search is phrase-based — stop-word-heavy prefixes like
  // "yesterday all my" often return 0 or irrelevant hits. Build queries
  // from content words (no stop words, English + Hindi particles) so
  // "yesterday troubles seemed" finds Yesterday, etc. Scoring still uses
  // the full transcript.
  const allWords = clean.split(/\s+/);
  const contentWords = allWords.filter(w => !STOP.has(w));
  const queries: string[] = [];
  // Content-word queries first (most distinctive), then originals as fallback
  // (e.g. "yesterday troubles" -> 0 hits, but "yesterday all my" -> 20)
  if (contentWords.length >= 2) queries.push(contentWords.slice(0, 4).join(" "));
  if (contentWords.length >= 2) queries.push(contentWords.slice(0, 2).join(" "));
  queries.push(allWords.slice(0, 5).join(" "));
  queries.push(allWords.slice(0, 3).join(" "));
  queries.push(allWords.slice(0, 2).join(" "));
  const deduped = Array.from(new Set(queries.filter(Boolean)));
  // Spelling-variant queries: romanized titles use long vowels both ways,
  // so also ask for the alternate spellings of the longest content word
  // ("rahon ya na rahon" -> "rahoon ya na rahoon" finds the official
  // title). Bounded to 2 variants of the top query; scoring decides.
  const variantQueries: string[] = [];
  {
    const topWords = (deduped[0] || "").split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w.toLowerCase()));
    topWords.sort((a, b) => b.length - a.length);
    const seenQ = new Set(deduped.map(q => q.toLowerCase()));
    if (topWords.length) {
      for (const v of spellingVariants(topWords[0])) {
        const vq = deduped[0].split(/\s+/).map(w => w.toLowerCase() === topWords[0].toLowerCase() ? v : w).join(" ");
        if (vq && !seenQ.has(vq.toLowerCase())) { seenQ.add(vq.toLowerCase()); variantQueries.push(vq); }
        if (variantQueries.length >= 2) break;
      }
    }
  }
  // Fan out LRCLIB + iTunes in parallel (fail-soft each). iTunes is
  // title-based and often finds the famous original when LRCLIB returns
  // only covers for the same lyric phrase.
  const lrclibQueries = [...deduped, ...variantQueries].slice(0, 7);
  const itunesQueries = [...deduped.slice(0, 2), ...variantQueries].slice(0, 4);
  const [geniusPairs, musixPairs, webPairs, lrclibSettled, itunesSettled, ovhSettled] = await Promise.all([
    geniusLyricCandidates(clean),
    musixmatchLyricCandidates(clean),
    webSearchCandidates(clean),
    Promise.all(lrclibQueries.map(async (q) => {
      try {
        const r = await fetch("https://lrclib.net/api/search?q=" + encodeURIComponent(q), { signal: timeoutSignal(6000) });
        if (!r.ok) return [];
        const d: any[] = await r.json();
        return Array.isArray(d) ? d : [];
      } catch {
        return [];
      }
    })),
    // iTunes: focused queries + spelling variants, still a small burst.
    Promise.all(itunesQueries.map(async (q) => {
      try {
        const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(q) + "&entity=song&limit=4", { signal: timeoutSignal(5000) });
        if (!r.ok) return [];
        const j: any = await r.json();
        const list: any[] = j.results || [];
        // Normalize iTunes shape to LRCLIB shape for downstream scoring.
        return list.map((t: any) => ({
          trackName: t.trackName || "",
          artistName: t.artistName || "",
          plainLyrics: "",
          syncedLyrics: "",
          _itunesArt: (t.artworkUrl100 || "").replace("100x100", "300x300"),
          _itunesUrl: t.trackViewUrl || "",
        }));
      } catch {
        return [];
      }
    })),
    // lyrics.ovh suggest (Deezer index — different catalog than iTunes,
    // stronger for some regions). Metadata only; resolved to lyrics later.
    Promise.all(deduped.slice(0, 2).map(async (q) => {
      try {
        const r = await fetch("https://api.lyrics.ovh/suggest/" + encodeURIComponent(q), { signal: timeoutSignal(5000) });
        if (!r.ok) return [];
        const j: any = await r.json().catch(() => null);
        const list: any[] = (j && j.data) || [];
        return list.slice(0, 6).map((t: any) => ({
          trackName: t.title || "",
          artistName: (t.artist && t.artist.name) || "",
          plainLyrics: "",
          syncedLyrics: "",
        }));
      } catch {
        return [];
      }
    })),
  ]);
  // Resolve Genius (title, artist) pairs to LRCLIB lyric entries (fail-soft
  // each). These are lyric-motivated candidates, so they join the pool first.
  onProgress?.("searching", "Checking lyric matches...");
  const geniusEntries = await Promise.all(
    geniusPairs.slice(0, 8).map(async (p) => {
      const entries = await fetchLyricEntries(p.title, p.artist);
      for (const e of entries) { e._genius = true; e._retrievalRank = p.rank; }
      return entries;
    })
  );
  const musixEntries = await Promise.all(
    musixPairs.slice(0, 8).map(async (p) => {
      const entries = await fetchLyricEntries(p.title, p.artist);
      for (const e of entries) { e._musix = true; e._retrievalRank = p.rank; }
      return entries;
    })
  );
  const webEntries = await Promise.all(
    webPairs.slice(0, 8).map(async (p) => {
      const entries = await fetchLyricEntries(p.title, p.artist);
      for (const e of entries) { e._web = true; e._retrievalRank = p.rank; }
      return entries;
    })
  );
  const data: any[] = [];
  const seenTracks = new Set<string>();
  const trackKeyOf = (t: string, a: string) => ((t || "").toLowerCase()) + "|" + canonicalArtist(a || "");
  const pushList = (list: any[]) => {
    for (const item of list) {
      const key = trackKeyOf(item.trackName || "", item.artistName || "");
      if (seenTracks.has(key)) {
        // Upgrade path: a verifiable copy replaces a degenerate stub
        // (single-line provider error) under the same key — whichever
        // source arrives first must not block better lyrics.
        const at = data.findIndex(d => trackKeyOf(d.trackName || "", d.artistName || "") === key);
        if (at >= 0 && lyricLineCount(data[at]) < 2 && lyricLineCount(item) >= 2) {
          if (data[at]._itunesArt && !item._itunesArt) item._itunesArt = data[at]._itunesArt;
          data[at] = item;
        }
        continue;
      }
      if (data.length < 44) { data.push(item); seenTracks.add(key); }
    }
  };
  for (const entries of musixEntries) pushList(entries);
  for (const entries of geniusEntries) pushList(entries);
  for (const entries of webEntries) pushList(entries);
  for (const list of lrclibSettled) pushList(list);
  for (const list of itunesSettled) pushList(list);
  for (const list of ovhSettled) pushList(list);
  // Hard guarantee: if still thin, widen with a focused LRCLIB pass on
  // the full transcript (phrase q) before scoring — browser q parser is
  // strict and can miss when content-word queries are poor.
  if (data.length < 5) {
    try {
      const r = await fetch("https://lrclib.net/api/search?q=" + encodeURIComponent(clean), { signal: timeoutSignal(6000) });
      if (r.ok) {
        const d: any[] = await r.json();
        if (Array.isArray(d)) pushList(d);
      }
    } catch { /* ignore */ }
  }
  if (!data.length) throw new Error("No matching songs found. Try different lyrics.");

  onProgress?.("lyrics", "Matching lyrics...");
  const scored: ScoredEntry[] = [];
  const scorePool = () => {
    scored.length = 0;
    // Score every collected candidate, not just the first few — the famous
    // original often sits below covers in raw search order.
    for (const item of data) {
      if (item.instrumental === true) continue;
      const synced: string = item.syncedLyrics || "";
      const plain: string = item.plainLyrics || "";
      let lines = synced ? parseSynced(synced) : plain.split("\n").map((t: string, i: number) => ({ t: i * 3, text: t.trim() })).filter((l: any) => l.text);
      lines = lines.filter(l => !isBoilerplate(l.text));
      if (!lines.length) continue;
      const best = bestLine(clean, lines);
      if (!best) continue;
      // keep only reasonable matches (lowered from 0.35 — Nirvana etc. hover ~0.30)
      if (best.score < 0.25) continue;
      // Plain-lyric lines get synthetic timestamps (i*3) — flag as estimated.
      scored.push({ item, lines, bestIdx: best.idx, score: best.score, estimated: !synced });
    }
  };
  scorePool();
  // Deep resolve: when line-verified evidence is thin — few scored OR
  // best score weak (junk-filled pool, e.g. a title-trap at 0.69 hiding
  // the true song whose lyrics live elsewhere) — pull lyrics for the
  // metadata-only pool (iTunes/suggest titles) and re-score. Bounded
  // (8 pairs), parallel, fail-soft.
  const bestScored = scored.length ? Math.max(...scored.map(s => s.score)) : 0;
  if (scored.length < 5 || bestScored < 0.75) {
    onProgress?.("searching", "Digging deeper...");
    // Prioritize by title similarity to the query (retrieval prior only —
    // scoring still decides): sequential fill would starve later queries
    // (e.g. spelling variants) behind earlier junk. Skip tracks that
    // already carry lyrics in the pool — resolving them again is waste.
    const hasLyricsInPool = (t: string, a: string) => {
      const key = (t || "").toLowerCase() + "|" + canonicalArtist(a || "");
      return data.some(d => ((d.trackName || "").toLowerCase()) + "|" + canonicalArtist(d.artistName || "") === key
        && lyricLineCount(d) >= 2);
    };
    const metaSeen = new Set<string>();
    const meta: { title: string; artist: string; prior: number }[] = [];
    const considerMeta = (t: string, a: string) => {
      const key = (t || "").toLowerCase() + "|" + canonicalArtist(a || "");
      if (!t || metaSeen.has(key) || hasLyricsInPool(t, a)) return;
      metaSeen.add(key);
      meta.push({ title: t, artist: a, prior: tokenScore(clean, (t + " " + a).toLowerCase()) });
    };
    for (const list of [...itunesSettled, ...ovhSettled]) {
      for (const item of list) considerMeta(item.trackName || "", item.artistName || "");
    }
    meta.sort((x, y) => y.prior - x.prior);
    const metaTop = meta.slice(0, 6);
    if (metaTop.length) {
      const resolved = await Promise.all(metaTop.map(async (m) => {
        const entries = await fetchLyricEntries(m.title, m.artist);
        for (const e of entries) e._deep = true;
        return entries;
      }));
      let added = false;
      const flatResolved: any[] = [];
      for (const entries of resolved) for (const e of entries) flatResolved.push(e);
      for (const e of flatResolved) {
        const key = trackKeyOf(e.trackName || "", e.artistName || "");
        const at = data.findIndex(d => trackKeyOf(d.trackName || "", d.artistName || "") === key);
        if (at >= 0) {
          // Replace lyric-less OR degenerate stubs (single-line provider
          // errors block better copies via dedupe) with verifiable lyrics.
          if (lyricLineCount(data[at]) < 2) {
            if (data[at]._itunesArt && !e._itunesArt) e._itunesArt = data[at]._itunesArt;
            data[at] = e;
            added = true;
          }
        } else if (data.length < 44) {
          data.push(e);
          seenTracks.add(key);
          added = true;
        }
      }
      if (added) scorePool();
    }
  }
  // Title fallback: some tracks (e.g. "Smells Like Teen Spirit") never
  // repeat the title in the synced lyrics, so lyric-only scoring can miss
  // them even though LRCLIB found them by title.
  if (!scored.length) {
    const titleScored: { item: any; score: number }[] = [];
    for (const item of data) {
      const s = tokenScore(clean, (item.trackName || "") + " " + (item.artistName || ""));
      titleScored.push({ item, score: s });
    }
    titleScored.sort((a, b) => b.score - a.score);
    if (titleScored.length) {
      const seen = new Set<string>();
      const top: typeof titleScored = [];
      for (const c of titleScored) {
        const key = normalizeTitle(c.item.trackName || "");
        if (!seen.has(key)) { seen.add(key); top.push(c); }
        if (top.length >= 5) break;
      }
      const results = await Promise.all(top.slice(0, 5).map(async (c) => {
        const trackName: string = c.item.trackName || "Unknown";
        const artistName: string = cleanArtist(c.item.artistName || "");
        const albumArt = await fetchArtwork(trackName, artistName, c.item._itunesArt || "");
        const spotifyUrl = "https://open.spotify.com/search/" + encodeURIComponent(trackName + " " + artistName);
        // Honest title-only fallback: no lyric evidence was found, so there
        // is no matched line, no surrounding context, no timestamp, and no
        // occurrences. Confidence is capped below the "uncertain" band and
        // the UI hides the "You are HERE" box when lyrics_context is null.
        return {
          song: trackName,
          artist: artistName,
          confidence: Math.min(Math.round(c.score * 100), 49),
          timestamp: null,
          timestamp_display: null,
          timestamp_estimated: false,
          lyrics_context: null,
          occurrences: [],
          ambiguous: false,
          spotify_url: spotifyUrl,
          album_art: albumArt,
          strategy: "lrclib-title",
          covers: [] as CoverInfo[],
          isBrowser: true as const,
        };
      }));
      return { transcript: clean, results };
    }
    throw new Error("No close lyric matches. Try a longer or clearer phrase.");
  }

  // Popularity re-rank: lyric match alone can't tell the famous original
  // from an obscure cover with identical lyrics. iTunes Search position is
  // used as the popularity proxy (no key needed, CORS-open).
  onProgress?.("candidate_ready", "Ranking by popularity...");
  // Slice by LYRIC score, not raw search order — the true match often sits
  // below title-coincidences in provider order. 15 keeps recall for
  // Top-5 + Load More while bounded for perf.
  const ranked = await rerankByPopularity(clean, scored.sort((a, b) => b.score - a.score).slice(0, 15));
  // Cover grouping: same song (version-stripped title OR near-identical
  // best lyric + shared title word) counts as one song. Ranked order puts
  // the strongest version first, so it becomes the group head; the rest
  // are stashed with details (artist, confidence, timestamp, matched
  // lyric) for the expandable covers view.
  interface CoverGroup {
    key: string;
    head: (typeof ranked)[number];
    headLine: string;
    headWords: Set<string>;
    covers: CoverInfo[];
  }
  const groups: CoverGroup[] = [];
  for (const c of ranked) {
    const track: string = c.item.trackName || "";
    const key = normalizeTitle(track);
    const line = (c.lines[c.bestIdx] && c.lines[c.bestIdx].text) || "";
    const words = titleContentWords(track);
    let placed: CoverGroup | null = null;
    for (const g of groups) {
      if (g.key === key || sameLyricFamily(line, g.headLine, words, g.headWords)) {
        placed = g;
        break;
      }
    }
    if (!placed) {
      if (groups.length >= 12) break;
      placed = { key, head: c, headLine: line, headWords: words, covers: [] };
      groups.push(placed);
    } else if (placed.head !== c && placed.covers.length < 6) {
      const cLine = (c.lines[c.bestIdx] && c.lines[c.bestIdx].text) || "";
      const cTs = (c.lines[c.bestIdx] && c.lines[c.bestIdx].t) ?? null;
      const cArtist = cleanArtist(c.item.artistName || "");
      if (cArtist && !placed.covers.some(o => o.artist === cArtist)) {
        placed.covers.push({
          artist: cArtist,
          confidence: Math.round(c.final * 100),
          timestamp_display: fmt(cTs),
          matched: cLine,
        });
      }
    }
    // Up to 12 distinct songs: Top 5 initially, Load More pages the rest
    // (5 → 8 → 11 → 12). Never fabricate — stop when the pool is exhausted.
    if (groups.length >= 12) break;
  }
  const top = groups.map(g => g.head);

  onProgress?.("candidate_ready", "Fetching artwork...");
  // Artwork for all top candidates in parallel (was sequential: 3 x 4s worst case).
  const arts: string[] = await Promise.all(top.map(async (c) => {
    const trackName: string = c.item.trackName || c.item.track || "Unknown";
    const artistName: string = cleanArtist(c.item.artistName || c.item.artist || "");
    return fetchArtwork(trackName, artistName);
  }));

  const results: BrowserCandidate[] = top.map((c, i) => {
    const trackName: string = c.item.trackName || c.item.track || "Unknown";
    const artistName: string = cleanArtist(c.item.artistName || c.item.artist || "");
    const ts = c.lines[c.bestIdx].t;
    // occurrences (same line repeated)
    const occs = c.lines
      .filter(l => tokenScore(clean, l.text) > 0.5)
      .slice(0, 4)
      .map(l => ({ timestamp: l.t, match_score: Math.round(tokenScore(clean, l.text) * 100), matched_line: l.text }));

    // context
    const before = c.lines.slice(Math.max(0, c.bestIdx - 2), c.bestIdx).map(l => l.text);
    const after = c.lines.slice(c.bestIdx + 1, c.bestIdx + 3).map(l => l.text);

    return {
      song: trackName,
      artist: artistName,
      confidence: Math.round(c.final * 100),
      timestamp: ts,
      timestamp_display: fmt(ts),
      timestamp_estimated: c.estimated,
      lyrics_context: { before, matched: c.lines[c.bestIdx].text, after },
      occurrences: occs,
      ambiguous: occs.length > 1,
      spotify_url: "https://open.spotify.com/search/" + encodeURIComponent(trackName + " " + artistName),
      album_art: arts[i] || "",
      strategy: c.item._musix ? "musixmatch" : c.item._genius ? "genius" : c.item._web ? "web" : "lrclib",
      covers: (groups[i] && groups[i].covers) || [],
      isBrowser: true,
    };
  });

  // Lyric-index hits with no verifiable lines: Genius matched the lyric
  // text itself (lyrics may be missing, partial, or a different section in
  // LRCLIB), so the song must not vanish silently. Safety net, shown
  // honestly AFTER all line-verified results at low confidence with no
  // context/timestamp: at most the top 3 unmatched hits with substantial
  // word matches, never duplicating scored results.
  const scoredKeys = new Set(
    scored.map(s => ((s.item.trackName || "").toLowerCase()) + "|" + canonicalArtist(s.item.artistName || ""))
  );
  const musixBare = musixPairs.map(p => ({ ...p, matched: 99 }));
  const geniusBare = [...geniusPairs, ...musixBare]
    .filter(p => p.matched >= 3
      && !scoredKeys.has(p.title.toLowerCase() + "|" + canonicalArtist(p.artist)))
    .slice(0, 3);
  if (geniusBare.length) {
    onProgress?.("candidate_ready", "Fetching artwork...");
    const bareArts = await Promise.all(
      geniusBare.map(p => fetchArtwork(p.title, cleanArtist(p.artist)))
    );
    const bareCards: BrowserCandidate[] = geniusBare.map((p, k) => ({
      song: p.title || "Unknown",
      artist: cleanArtist(p.artist || ""),
      confidence: 50,
      timestamp: null,
      timestamp_display: null,
      timestamp_estimated: false,
      lyrics_context: null,
      occurrences: [],
      ambiguous: false,
      spotify_url: "https://open.spotify.com/search/" + encodeURIComponent((p.title || "") + " " + cleanArtist(p.artist || "")),
      album_art: bareArts[k] || "",
      strategy: "genius",
      covers: [],
      isBrowser: true,
    }));
    if (!results.length) return { transcript: clean, results: bareCards.slice(0, 5) };
    const room = Math.max(0, 12 - results.length);
    // Append after line-verified evidence: an unverified index guess must
    // never top songs with real matched lines, however weak.
    results.push(...bareCards.slice(0, room));
  }

  return { transcript: clean, results };
}

export function isSpeechRecognitionAvailable(): boolean {
  return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function startSpeechRecognition(
  onResult: (transcript: string) => void,
  onError: (msg: string) => void,
  lang = "en-US"
): (() => void) | null {
  const Ctor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) { onError("Speech recognition not supported in this browser. Try Chrome."); return null; }
  const rec = new Ctor();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = lang;
  rec.onresult = (e: any) => {
    const t = e.results?.[0]?.[0]?.transcript;
    if (t) onResult(t);
    else onError("Did not catch that. Try again, speaking clearly.");
  };
  rec.onerror = (e: any) => {
    const code = e.error || "unknown";
    // Surface the specific code — "Browser voice failed" with no detail
    // is unactionable. Known codes: not-allowed, no-speech, network,
    // service-not-allowed, audio-capture, aborted.
    if (code === "not-allowed" || code === "service-not-allowed") {
      onError("Microphone permission denied for voice recognition (" + code + "). Check the browser site settings.");
    } else if (code === "no-speech") {
      onError("No speech detected (no-speech). Sing or say the lyric clearly, closer to the mic.");
    } else if (code === "aborted") {
      onError("Voice recognition stopped. Try again.");
    } else {
      onError("Voice recognition failed (" + code + "). Try the Lyrics tab instead.");
    }
  };
  rec.start();
  return () => { try { rec.stop(); } catch {} };
}