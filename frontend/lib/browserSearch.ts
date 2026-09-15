"use client";

// Browser-native identification: LRCLIB (lyrics) + iTunes (metadata/artwork).
// All calls are direct fetches — no backend required. Spotify URL is a
// search fallback (no Spotify API key needed in the browser).

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
  covers?: string[];
  isBrowser: true;
}

/** AbortSignal.timeout with fallback for older browsers. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
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
  if (/genius romanizations|you might also like|get tickets|ishq jalakar|karvaan/i.test(t)) return true;
  if (/^\s*[-–—\s]*$/.test(t)) return true;
  // "Arijit Singh & Armaan Khan - Gehra Hua (Romanized)" style header, not a lyric
  if (/ - .*\(romanized\)/i.test(t) && t.split(/\s+/).length <= 10) return true;
  return false;
}

/** Strip auto-generated channel suffixes ("Nirvana - Topic") from artist names. */
function cleanArtist(name: string): string {
  return (name || "")
    .replace(/\s*-\s*topic$/i, "")
    .replace(/\s*vevo$/i, "")
    .trim();
}

/**
 * Browser-friendly popularity via iTunes Search (LRCLIB has no popularity
 * signal, and Deezer is CORS-blocked from Pages). Returns 0..1. Never throws.
 * Uses track position in iTunes results as a proxy — top hit is most popular.
 */
async function itunesPopularity(track: string, artist: string): Promise<number> {
  try {
    const term = artist ? track + " " + artist : track;
    const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(term) + "&entity=song&limit=5", { signal: timeoutSignal(4000) });
    if (!r.ok) return 0;
    const j: any = await r.json();
    const list: any[] = j.results || [];
    for (const t of list) {
      const dt = (t.trackName || "").toLowerCase();
      if (dt && (track.toLowerCase().includes(dt) || dt.includes(track.toLowerCase()))) return 1 - (list.indexOf(t) / 5);
    }
    return 0;
  } catch {
    return 0;
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
 */
interface RankedCandidate {
  item: any;
  lines: { t: number; text: string }[];
  bestIdx: number;
  score: number;
  titleBonus: number;
  pop: number;
  final: number;
}

async function rerankByPopularity(
  transcript: string,
  candidates: { item: any; lines: { t: number; text: string }[]; bestIdx: number; score: number }[]
): Promise<RankedCandidate[]> {
  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const maxLyric = Math.max(...candidates.map(c => c.score), 0);
  const withPop: RankedCandidate[] = await Promise.all(candidates.map(async (c) => {
    const track = c.item.trackName || "";
    const artist = cleanArtist(c.item.artistName || "");
    const pop = await itunesPopularity(track, artist);
    const titleBonus = tokenScore(transcript.toLowerCase(), (track + " " + artist).toLowerCase());
    return { ...c, titleBonus, pop, final: 0 };
  }));
  const pops = withPop.map(c => c.pop);
  const spread = pops.length ? Math.max(...pops) - Math.min(...pops) : 0;
  const usePop = spread >= 0.2;

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

  for (const c of withPop) {
    c.final = wLyric * c.score + wPop * c.pop + wTitle * c.titleBonus;
  }
  withPop.sort((a, b) => b.final - a.final || b.score - a.score);
  return withPop;
}

function fmt(ts: number | null): string | null {
  if (ts == null || ts < 0) return null;
  const m = Math.floor(ts / 60);
  const s = Math.floor(ts % 60).toString().padStart(2, "0");
  return m + ":" + s;
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

function tokenScore(a: string, b: string): number {
  const cleanA = a.toLowerCase().split(/\s+/).filter(Boolean);
  const cleanB = b.toLowerCase().split(/\s+/).filter(Boolean);
  const ta = new Set(cleanA);
  const tb = new Set(cleanB);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach(w => { if (tb.has(w)) inter++; });
  // Full containment: treat as near-verbatim (BM25 would give high IDF here).
  if (inter === ta.size) return 0.92;
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
  // from content words (no stop words) so "yesterday troubles seemed"
  // finds Yesterday, etc. Scoring still uses the full transcript.
  const STOP = new Set(["a","an","the","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","must","can","this","that","these","those","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","all","any","both","each","few","more","most","other","some","such","no","nor","not","only","own","same","so","than","too","very","just","because","but","and","or","if","then","else","when","up","down","in","out","on","off","over","under","again","further","once","here","there","where","why","how","what","which","who","whom","there","is","no","it","its"]);
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
  // Fan out LRCLIB + iTunes in parallel (fail-soft each). iTunes is
  // title-based and often finds the famous original when LRCLIB returns
  // only covers for the same lyric phrase.
  const [lrclibSettled, itunesSettled] = await Promise.all([
    Promise.all(deduped.map(async (q) => {
      try {
        const r = await fetch("https://lrclib.net/api/search?q=" + encodeURIComponent(q), { signal: timeoutSignal(6000) });
        if (!r.ok) return [];
        const d: any[] = await r.json();
        return Array.isArray(d) ? d : [];
      } catch {
        return [];
      }
    })),
    // iTunes: only 2 most focused queries to stay well under rate limits.
    Promise.all(deduped.slice(0, 2).map(async (q) => {
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
  ]);
  const data: any[] = [];
  const seenTracks = new Set<string>();
  for (const list of [...lrclibSettled, ...itunesSettled]) {
    for (const item of list) {
      const key = ((item.trackName || "").toLowerCase()) + "|" + canonicalArtist(item.artistName || "");
      if (!seenTracks.has(key) && data.length < 20) { data.push(item); seenTracks.add(key); }
    }
  }
  if (!data.length) throw new Error("No matching songs found. Try different lyrics.");

  onProgress?.("lyrics", "Matching lyrics...");
  const scored: { item: any; lines: { t: number; text: string }[]; bestIdx: number; score: number }[] = [];
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
    scored.push({ item, lines, bestIdx: best.idx, score: best.score });
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
        const key = (c.item.trackName || "").toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
        if (!seen.has(key)) { seen.add(key); top.push(c); }
        if (top.length >= 5) break;
      }
      const results = await Promise.all(top.slice(0, 5).map(async (c) => {
        const trackName: string = c.item.trackName || "Unknown";
        const artistName: string = cleanArtist(c.item.artistName || "");
        let albumArt = c.item._itunesArt || "";
        if (!albumArt) {
          try {
            const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(trackName + " " + artistName) + "&entity=song&limit=1", { signal: timeoutSignal(3000) });
            if (r.ok) {
              const j: any = await r.json();
              if (j.results && j.results[0]) albumArt = (j.results[0].artworkUrl100 || "").replace("100x100", "300x300");
            }
          } catch {}
        }
        const spotifyUrl = "https://open.spotify.com/search/" + encodeURIComponent(trackName + " " + artistName);
        return {
          song: trackName,
          artist: artistName,
          confidence: Math.round(c.score * 100),
          timestamp: 5,
          timestamp_display: fmt(5),
          timestamp_estimated: true,
          lyrics_context: { before: [], matched: trackName, after: [] },
          occurrences: [{ timestamp: 5, match_score: Math.round(c.score * 100), matched_line: trackName }],
          ambiguous: false,
          spotify_url: spotifyUrl,
          album_art: albumArt,
          strategy: "lrclib-title",
          covers: [] as string[],
          isBrowser: true as const,
        };
      }));
      return { transcript: clean, results };
    }
    throw new Error("No close lyric matches. Try a longer or clearer phrase.");
  }

  // Popularity re-rank: lyric match alone can't tell the famous original
  // from an obscure cover with identical lyrics (e.g. Charlie Puth's
  // "Attention" vs covers literally titled after its hook). Deezer's free
  // search API exposes a per-track `rank` popularity score — no key needed.
  onProgress?.("candidate_ready", "Ranking by popularity...");
  const ranked = await rerankByPopularity(clean, scored.slice(0, 10));
  // Cover grouping: same title (normalized) by different artists counts as
  // one song. Keep the most popular/high-scoring version on top, stash
  // other artists as covers for the details view.
  function normalizeTitle(t: string): string {
    return (t || "").toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  }
  const grouped: typeof ranked = [];
  const seenTitles = new Set<string>();
  for (const c of ranked) {
    const key = normalizeTitle(c.item.trackName || "");
    if (!seenTitles.has(key)) {
      seenTitles.add(key);
      // Attach covers found under the same title
      const covers = ranked
        .filter(o => normalizeTitle(o.item.trackName || "") === key && o !== c)
        .slice(0, 4)
        .map(o => cleanArtist(o.item.artistName || ""));
      (c as any).covers = covers.filter(Boolean);
      grouped.push(c);
    }
    if (grouped.length >= 5) break;
  }
  const top = grouped.slice(0, 5);

  onProgress?.("candidate_ready", "Fetching artwork...");
  // Artwork for all top candidates in parallel (was sequential: 3 x 4s worst case).
  const arts: string[] = await Promise.all(top.map(async (c) => {
    const trackName: string = c.item.trackName || c.item.track || "Unknown";
    const artistName: string = cleanArtist(c.item.artistName || c.item.artist || "");
    try {
      const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(trackName + " " + artistName) + "&entity=song&limit=1", { signal: timeoutSignal(4000) });
      if (!r.ok) return "";
      const j: any = await r.json();
      return (j.results && j.results[0] && j.results[0].artworkUrl100
        ? String(j.results[0].artworkUrl100).replace("100x100", "300x300")
        : "");
    } catch {
      return "";
    }
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
      lyrics_context: { before, matched: c.lines[c.bestIdx].text, after },
      occurrences: occs,
      ambiguous: occs.length > 1,
      spotify_url: "https://open.spotify.com/search/" + encodeURIComponent(trackName + " " + artistName),
      album_art: arts[i] || "",
      strategy: "lrclib",
      covers: (c as any).covers || [],
      isBrowser: true,
    };
  });

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