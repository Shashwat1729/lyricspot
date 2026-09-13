const puppeteer = require("./node_modules/puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  // Test yellow submarine direct via LRCLIB
  const result = await page.evaluate(async () => {
    const queries = ["yellow submarine sailing on the", "yellow submarine", "is this the real life is this"];
    const out = {};
    for (const q of queries) {
      try {
        const res = await fetch("https://lrclib.net/api/search?q=" + encodeURIComponent(q));
        const data = await res.json();
        out[q] = data.length + " results, first: " + (data[0]?.trackName || "none") + " - " + (data[0]?.artistName || "");
      } catch (e) { out[q] = "error: " + String(e).slice(0,100); }
    }
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();