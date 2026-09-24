import type { BrowserContext, Route } from "@playwright/test";

/** Synced lyrics fixture (LRC) for the mocked catalog. */
const BOHEMIAN = [
  "[00:00.50] Is this the real life? Is this just fantasy?",
  "[00:06.20] Caught in a landslide, no escape from reality",
  "[00:15.10] Open your eyes, look up to the skies and see",
  "[00:23.40] I'm just a poor boy, I need no sympathy",
  "[00:29.00] Because I'm easy come, easy go, little high, little low",
].join("\n");

const HELLO = [
  "[00:10.00] Hello, it's me",
  "[00:15.00] I was wondering if after all these years you'd like to meet",
  "[01:19.30] Hello from the other side",
  "[01:24.00] I must've called a thousand times",
].join("\n");

export const CATALOG = [
  { id: 1, trackName: "Bohemian Rhapsody", artistName: "Queen", albumName: "A Night at the Opera", duration: 354, instrumental: false, plainLyrics: BOHEMIAN.replace(/\[[^\]]+\]\s*/g, ""), syncedLyrics: BOHEMIAN, itunesId: 1440650711, spotifyId: "4u7EnebtmKWzUH433cf5Qv" },
  { id: 2, trackName: "Hello", artistName: "Adele", albumName: "25", duration: 295, instrumental: false, plainLyrics: HELLO.replace(/\[[^\]]+\]\s*/g, ""), syncedLyrics: HELLO, itunesId: 1051394215, spotifyId: "4sPmO7WMQUAf45kwMOtONw" },
  { id: 3, trackName: "Real Life", artistName: "Bon Jovi", albumName: "EDtv", duration: 240, instrumental: false, plainLyrics: "Tonight I'm living a real life\nNothing else feels the same", syncedLyrics: "[00:12.00] Tonight I'm living a real life\n[00:18.00] Nothing else feels the same", itunesId: 1000000003, spotifyId: "0000000000000000000003" },
];

function words(s: string): string[] {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

/** Crude metadata+lyric relevance for mocked search endpoints. */
function searchCatalog(q: string, lyricsToo: boolean) {
  const qw = words(q);
  return CATALOG.filter((t) => {
    const hay = words(t.trackName + " " + t.artistName + (lyricsToo ? " " + t.plainLyrics : ""));
    return qw.some((w) => w.length > 2 && hay.includes(w));
  });
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
}

export interface MockOptions {
  /** Pretend a backend runs at http://localhost:8000 with these capabilities. */
  backend?: { voice: boolean; melody?: boolean; results?: unknown[]; transcript?: string; input?: string };
}

export async function mockNetwork(context: BrowserContext, opts: MockOptions = {}) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, async (route) => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    const p = url.searchParams;

    if (host === "localhost" && url.port === "8000") {
      if (!opts.backend) return route.abort("connectionrefused");
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
      }
      if (url.pathname === "/health") return json(route, { status: "healthy", version: "2.0.0", voice: opts.backend.voice, melody: !!opts.backend.melody, whisper_model: opts.backend.voice ? "base" : null, spotify: false });
      if (url.pathname === "/identify" || url.pathname === "/upload") {
        const lyrics = url.pathname === "/identify" ? JSON.parse(route.request().postData() || "{}").lyrics : opts.backend.transcript;
        return json(route, { success: true, input: opts.backend.input || "lyrics", transcript: lyrics, confidence_label: "high", margin: 40, results: opts.backend.results || [] });
      }
      return json(route, { detail: "not found" }, 404);
    }

    if (host === "lrclib.net") {
      if (p.get("q")) return json(route, searchCatalog(p.get("q")!, false));
      if (p.get("track_name")) {
        const t = (p.get("track_name") || "").toLowerCase();
        return json(route, CATALOG.filter((c) => c.trackName.toLowerCase() === t));
      }
      return json(route, []);
    }
    if (host === "genius.com" || host === "api.genius.com") {
      const hits = searchCatalog(p.get("q") || "", true).map((t) => ({
        type: "song",
        result: { title: t.trackName, primary_artist: { name: t.artistName } },
        matched_words: 4,
      }));
      return json(route, { response: { hits } });
    }
    if (host === "itunes.apple.com") {
      const results = searchCatalog(p.get("term") || "", false).map((t) => ({
        trackId: t.itunesId,
        trackName: t.trackName,
        artistName: t.artistName,
        artworkUrl100: "",
        trackViewUrl: "https://music.apple.com/us/song/" + t.itunesId,
      }));
      return json(route, { resultCount: results.length, results });
    }
    if (host === "api.song.link") {
      const t = CATALOG.find((c) => String(c.itunesId) === p.get("id"));
      if (!t) return json(route, { statusCode: 404 }, 404);
      return json(route, {
        linksByPlatform: {
          spotify: { url: "https://open.spotify.com/track/" + t.spotifyId },
          youtube: { url: "https://www.youtube.com/watch?v=fJ9rUzIMcZQ" },
          appleMusic: { url: "https://music.apple.com/us/song/" + t.itunesId },
        },
      });
    }
    if (host === "api.lyrics.ovh") return json(route, { data: [] });
    if (host === "open.spotify.com" && url.pathname.startsWith("/embed/track/")) {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body style='margin:0;height:152px;background:#2a3a30;color:#fff;font:600 15px system-ui;display:flex;align-items:center;gap:14px;padding:0 20px;box-sizing:border-box'><div style='width:112px;height:112px;border-radius:8px;background:#1ED760;opacity:.35'></div><div>Spotify player<br><span style='font-weight:400;opacity:.7'>(mocked in tests)</span></div></body></html>" });
    }
    // Spotify iFrame API script, fonts, anything else: unavailable offline.
    return route.abort("blockedbyclient");
  });
}

/**
 * Fake Web Speech API: speaks `phrase` (or nothing, for humming) and ends
 * when the page calls stop().
 */
export function fakeSpeechScript(phrase: string) {
  return `
    (() => {
      class FakeRecognition {
        constructor() { this.lang = "en-US"; }
        start() {
          const phrase = ${JSON.stringify(phrase)};
          if (phrase) {
            setTimeout(() => {
              const alt = { transcript: phrase };
              const res = Object.assign([alt], { isFinal: true });
              this.onresult && this.onresult({ results: [res] });
            }, 150);
          }
        }
        stop() { setTimeout(() => this.onend && this.onend(), 30); }
        abort() { setTimeout(() => this.onend && this.onend(), 10); }
      }
      window.SpeechRecognition = FakeRecognition;
      window.webkitSpeechRecognition = FakeRecognition;
    })();
  `;
}
