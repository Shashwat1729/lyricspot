const puppeteer = require("D:\\personal\\projects\\Music_cont\\node_modules\\puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on("pageerror", e => console.log("PAGEERROR: " + String(e).slice(0, 150)));
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(2000);
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
  const snap = async () => (await page.evaluate(() => document.body.innerText)).replace(/\n/g, " | ");
  const cases = [
    ["yellow submarine sailing on the ocean blue", "REAL_UNKNOWN"],
    ["never gonna give you up never gonna let you down", "REAL_KNOWN"],
    ["is this the real life is this just fantasy", "REAL_BOHEMIAN"]
  ];
  for (const [lyrics, tag] of cases) {
    await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
    await sleep(1500);
    await toLyrics();
    await submit(lyrics);
    await sleep(12000);
    const txt = await snap();
    const fake = /Demo Song|Your Artist/.test(txt);
    const hasSong = /Hello|Adele|Rick Astley|Queen|Bohemian|Yellow Submarine|Beatles/i.test(txt);
    const hasTs = /\d+:\d\d/.test(txt);
    const hasErr = /No matching songs|No close lyric|Try different|Couldn.t/i.test(txt);
    console.log(tag + " fake=" + fake + " song=" + hasSong + " ts=" + hasTs + " honestErr=" + hasErr);
  }
  await browser.close();
  console.log("LOOP1_DONE");
}
main().catch(e => { console.error(e.message); process.exit(1); });
