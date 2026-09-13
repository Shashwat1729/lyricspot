const puppeteer = require("D:\\personal\\projects\\Music_cont\\node_modules\\puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  const out = await page.evaluate(async () => {
    const r = {};
    try {
      const res = await fetch("https://lrclib.net/api/search?q=never%20gonna%20give%20you%20up");
      r.lrclib_status = res.status;
      r.lrclib_cors = res.headers.get("access-control-allow-origin");
      const data = await res.json();
      r.lrclib_count = data.length;
      r.lrclib_first = data[0] ? { track: data[0].trackName, artist: data[0].artistName, hasSynced: !!data[0].syncedLyrics, syncedLen: (data[0].syncedLyrics || "").length } : null;
      r.lrclib_sample = data[0] && data[0].syncedLyrics ? data[0].syncedLyrics.slice(0, 120) : null;
    } catch (e) { r.lrclib_error = String(e).slice(0, 120); }
    try {
      const res2 = await fetch("https://itunes.apple.com/search?term=adele%20hello&entity=song&limit=2");
      r.itunes_status = res2.status;
      r.itunes_cors = res2.headers.get("access-control-allow-origin");
      const d2 = await res2.json();
      r.itunes_count = d2.resultCount;
      r.itunes_first = d2.results && d2.results[0] ? { track: d2.results[0].trackName, art: !!d2.results[0].artworkUrl100 } : null;
    } catch (e) { r.itunes_error = String(e).slice(0, 120); }
    r.speech_api = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    return r;
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
