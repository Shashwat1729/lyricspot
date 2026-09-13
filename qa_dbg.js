const puppeteer = require("./node_modules/puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on("console", m => console.log("BROWSER_CONSOLE: " + m.text().slice(0,300)));
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  // Directly test browserIdentify via page evaluate
  const result = await page.evaluate(async () => {
    try {
      const { browserIdentify } = await import("./_next/static/chunks/app/page-*.js");
      return "import failed";
    } catch (e) {
      // Try direct fetch test
      try {
        const res = await fetch("https://lrclib.net/api/search?q=yellow%20submarine");
        const data = await res.json();
        return "LRCLIB direct: " + data.length + " results, first: " + (data[0]?.trackName || "none");
      } catch (e2) {
        return "LRCLIB fetch error: " + String(e2).slice(0,200);
      }
    }
  });
  console.log("DIRECT_TEST: " + result);
  await browser.close();
})();