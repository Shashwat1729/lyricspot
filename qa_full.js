const puppeteer = require("./node_modules/puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on("console", m => { if (m.type() === "error" || m.text().includes("browserIdentify") || m.text().includes("LRCLIB")) console.log("BROWSER: " + m.text().slice(0,400)); });
  page.on("pageerror", e => console.log("PAGEERR: " + String(e).slice(0,300)));
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  async function toLyrics() {
    const btns = await page.$$("button");
    for (const b of btns) { const t = await b.evaluate(el => el.textContent); if (t && t.trim() === "Lyrics") { await b.click(); break; } }
    await sleep(400);
  }
  async function submit(text) {
    const ta = await page.$("textarea");
    if (ta) { await ta.click({ clickCount: 3 }); await ta.type(text, { delay: 8 }); }
    await sleep(200);
    const btns = await page.$$("button");
    for (const b of btns) { const t = await b.evaluate(el => el.textContent); if (t && t.trim() === "Find Song") { await b.click(); break; } }
  }
  // Known case
  await toLyrics();
  await submit("never gonna give you up never gonna let you down");
  await sleep(12000);
  let txt = await page.evaluate(() => document.body.innerText);
  console.log("=== KNOWN FULL TEXT (first 2500 chars) ===");
  console.log(txt.slice(0, 2500).replace(/\n/g, " | "));
  console.log("=== KNOWN HTML SNIPPET ===");
  const html = await page.content();
  const idx = html.indexOf("Never Gonna");
  if (idx > -1) console.log(html.slice(idx-200, idx+800).replace(/\n/g, " "));
  else console.log("Never Gonna not in HTML");

  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  await toLyrics();
  await submit("yellow submarine sailing on the ocean blue");
  await sleep(12000);
  txt = await page.evaluate(() => document.body.innerText);
  console.log("\n=== UNKNOWN FULL TEXT (first 2500 chars) ===");
  console.log(txt.slice(0, 2500).replace(/\n/g, " | "));
  await browser.close();
  console.log("FULL_DONE");
})();