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
  lyrics_context: { before: string[]; matched: string; after: string[] } | null;
  occurrences: { timestamp: number; match_score: number; matched_line: string }[];
  ambiguous: boolean;
  spotify_url: string;
  album_art: string;
  strategy: string;
  isBrowser: true;
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

  onProgress?.("searching", "Searching lyrics...");
  // LRCLIB search is phrase-based — long queries often return 0. Use a
  // focused 5-word prefix for the search, but score against the full
  // transcript so longer input still improves match quality.
  const searchQuery = clean.split(/\s+/).slice(0, 5).join(" ");
  const res = await fetch("https://lrclib.net/api/search?q=" + encodeURIComponent(searchQuery), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("Lyrics search failed (" + res.status + ")");
  const data: any[] = await res.json();
  if (!data.length) throw new Error("No matching songs found. Try different lyrics.");

  onProgress?.("matching", "Matching lyrics...");
  const scored: { item: any; lines: { t: number; text: string }[]; bestIdx: number; score: number }[] = [];
  for (const item of data.slice(0, 8)) {
    const synced: string = item.syncedLyrics || "";
    const plain: string = item.plainLyrics || "";
    const lines = synced ? parseSynced(synced) : plain.split("\n").map((t: string, i: number) => ({ t: i * 3, text: t.trim() })).filter((l: any) => l.text);
    if (!lines.length) continue;
    const best = bestLine(clean, lines);
    if (!best) continue;
    // keep only reasonable matches
    if (best.score < 0.35) continue;
    scored.push({ item, lines, bestIdx: best.idx, score: best.score });
  }
  if (!scored.length) throw new Error("No close lyric matches. Try a longer or clearer phrase.");

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);

  onProgress?.("artwork", "Fetching artwork...");
  const results: BrowserCandidate[] = [];
  for (const c of top) {
    const trackName: string = c.item.trackName || c.item.track || "Unknown";
    const artistName: string = c.item.artistName || c.item.artist || "";
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
      const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(trackName + " " + artistName) + "&entity=song&limit=1", { signal: AbortSignal.timeout(4000) });
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
      confidence: Math.round(c.score * 100),
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
    else onError("Did not catch that. Try again.");
  };
  rec.onerror = (e: any) => onError(e.error === "not-allowed" ? "Microphone permission denied." : e.error === "no-speech" ? "No speech detected. Try again." : "Speech error: " + (e.error || "unknown"));
  rec.start();
  return () => { try { rec.stop(); } catch {} };
}