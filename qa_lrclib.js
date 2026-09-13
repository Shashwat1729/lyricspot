const puppeteer = require("./node_modules/puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  const result = await page.evaluate(async () => {
    const out = {};
    try {
      const res = await fetch("https://lrclib.net/api/search?q=never%20gonna%20give%20you%20up");
      out.status = res.status;
      out.ok = res.ok;
      out.cors = res.headers.get("access-control-allow-origin");
      const data = await res.json();
      out.count = data.length;
      out.first = data[0] ? data[0].trackName + " - " + data[0].artistName : "none";
    } catch (e) {
      out.error = String(e).slice(0,300);
    }
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();