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
  isBrowser: true;
}

/** AbortSignal.timeout with fallback for older browsers. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** Strip auto-generated channel suffixes ("Nirvana - Topic") from artist names. */
function cleanArtist(name: string): string {
  return (name || "")
    .replace(/\s*-\s*topic$/i, "")
    .replace(/\s*vevo$/i, "")
    .trim();
}

/**
 * Query Deezer's free search for a track's popularity rank.
 * Returns 0..1 (log-normalized) or 0 when unavailable. Never throws.
 */
async function deezerPopularity(track: string, artist: string): Promise<number> {
  try {
    const q = 'track:"' + track + '" artist:"' + artist + '"';
    const r = await fetch("https://api.deezer.com/search?q=" + encodeURIComponent(q) + "&limit=3", { signal: timeoutSignal(4000) });
    if (!r.ok) return 0;
    const j: any = await r.json();
    const list: any[] = j.data || [];
    for (const t of list) {
      const dt = (t.title || "").toLowerCase();
      if (dt && (track.toLowerCase().includes(dt) || dt.includes(track.toLowerCase()))) {
        const rank = Number(t.rank) || 0;
        if (rank > 0) return Math.min(1, Math.log10(rank + 1) / 6);
        return 0;
      }
    }
    // Fallback: best rank among returned tracks, heavily discounted.
    let best = 0;
    for (const t of list) best = Math.max(best, Number(t.rank) || 0);
    return best > 0 ? Math.min(1, Math.log10(best + 1) / 6) * 0.5 : 0;
  } catch {
    return 0;
  }
}

/**
 * Re-rank lyric candidates by evidence, not just lyric overlap:
 *   final = 0.65 * lyricMatch + 0.25 * popularity + 0.10 * titleBonus
 * Popularity (Deezer rank) separates famous originals from obscure covers.
 */
async function rerankByPopularity(
  transcript: string,
  candidates: { item: any; lines: { t: number; text: string }[]; bestIdx: number; score: number }[]
): Promise<{ item: any; lines: { t: number; text: string }[]; bestIdx: number; score: number; final: number }[]> {
  const contentWords = transcript.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const withPop = await Promise.all(candidates.map(async (c) => {
    const track = c.item.trackName || "";
    const artist = cleanArtist(c.item.artistName || "");
    const pop = await deezerPopularity(track, artist);
    const titleBonus = tokenScore(contentWords.join(" "), track.toLowerCase());
    const final = 0.65 * c.score + 0.25 * pop + 0.10 * titleBonus;
    return { ...c, final };
  }));
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
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach(w => { if (tb.has(w)) inter++; });
  const prec = inter / ta.size;
  const rec = inter / tb.size;
  const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
  // substring bonus
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  const sub = bl.includes(al) || al.includes(bl) ? 0.15 : 0;
  return Math.min(1, f1 + sub);
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
  let data: any[] = [];
  let seenTracks = new Set<string>();
  for (const q of deduped) {
    try {
      const r = await fetch("https://lrclib.net/api/search?q=" + encodeURIComponent(q), { signal: timeoutSignal(6000) });
      if (!r.ok) continue;
      const d: any[] = await r.json();
      for (const item of d) {
        const key = (item.trackName || "") + "|" + (item.artistName || "");
        if (!seenTracks.has(key) && data.length < 12) { data.push(item); seenTracks.add(key); }
      }
      if (data.length >= 8) break;
    } catch {}
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
    const lines = synced ? parseSynced(synced) : plain.split("\n").map((t: string, i: number) => ({ t: i * 3, text: t.trim() })).filter((l: any) => l.text);
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
    let bestTitle: { item: any; score: number } | null = null;
    for (const item of data.slice(0, 5)) {
      const s = tokenScore(clean, (item.trackName || "") + " " + (item.artistName || ""));
      if (!bestTitle || s > bestTitle.score) bestTitle = { item, score: s };
    }
    if (bestTitle && bestTitle.score >= 0.35) {
      const item = bestTitle.item;
      const trackName: string = item.trackName || "Unknown";
      const artistName: string = item.artistName || "";
      let albumArt = "";
      let spotifyUrl = "https://open.spotify.com/search/" + encodeURIComponent(trackName + " " + artistName);
      try {
        const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(trackName + " " + artistName) + "&entity=song&limit=1", { signal: timeoutSignal(4000) });
        if (r.ok) {
          const j: any = await r.json();
          if (j.results && j.results[0]) albumArt = (j.results[0].artworkUrl100 || "").replace("100x100", "300x300");
        }
      } catch {}
      return {
        transcript: clean,
        results: [{
          song: trackName,
          artist: artistName,
          confidence: Math.round(bestTitle.score * 100),
          timestamp: 5,
          timestamp_display: fmt(5),
          timestamp_estimated: true,
          lyrics_context: { before: [], matched: trackName, after: [] },
          occurrences: [{ timestamp: 5, match_score: Math.round(bestTitle.score * 100), matched_line: trackName }],
          ambiguous: false,
          spotify_url: spotifyUrl,
          album_art: albumArt,
          strategy: "lrclib-title",
          isBrowser: true as const,
        }],
      };
    }
    throw new Error("No close lyric matches. Try a longer or clearer phrase.");
  }

  // Popularity re-rank: lyric match alone can't tell the famous original
  // from an obscure cover with identical lyrics (e.g. Charlie Puth's
  // "Attention" vs covers literally titled after its hook). Deezer's free
  // search API exposes a per-track `rank` popularity score — no key needed.
  onProgress?.("candidate_ready", "Ranking by popularity...");
  const ranked = await rerankByPopularity(clean, scored.slice(0, 6));
  const top = ranked.slice(0, 3);

  onProgress?.("candidate_ready", "Fetching artwork...");
  const results: BrowserCandidate[] = [];
  for (const c of top) {
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

    // artwork + spotify via iTunes (best-effort, no hard failure)
    let albumArt = "";
    let spotifyUrl = "https://open.spotify.com/search/" + encodeURIComponent(trackName + " " + artistName);
    try {
      const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(trackName + " " + artistName) + "&entity=song&limit=1", { signal: timeoutSignal(4000) });
      if (r.ok) {
        const j: any = await r.json();
        if (j.results && j.results[0]) {
          albumArt = (j.results[0].artworkUrl100 || "").replace("100x100", "300x300");
          // iTunes gives us a real track, but keep Spotify as search so browser always has a link
        }
      }
    } catch {}

    results.push({
      song: trackName,
      artist: artistName,
      confidence: Math.round(c.final * 100),
      timestamp: ts,
      timestamp_display: fmt(ts),
      lyrics_context: { before, matched: c.lines[c.bestIdx].text, after },
      occurrences: occs,
      ambiguous: occs.length > 1,
      spotify_url: spotifyUrl,
      album_art: albumArt,
      strategy: "lrclib",
      isBrowser: true,
    });
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