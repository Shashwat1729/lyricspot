const puppeteer = require("./node_modules/puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  const result = await page.evaluate(async () => {
    const clean = "never gonna give you up never gonna let you down";
    try {
      const res = await fetch("https://lrclib.net/api/search?q=" + encodeURIComponent(clean));
      const data = await res.json();
      const out = { count: data.length, candidates: [] };
      for (const item of data.slice(0, 5)) {
        const synced = item.syncedLyrics || "";
        const hasSynced = !!synced;
        const sample = synced ? synced.slice(0,200) : (item.plainLyrics || "").slice(0,200);
        out.candidates.push({ track: item.trackName, artist: item.artistName, hasSynced, sample: sample.replace(/\n/g, " | ").slice(0,150) });
      }
      return out;
    } catch (e) {
      return { error: String(e).slice(0,300) };
    }
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();