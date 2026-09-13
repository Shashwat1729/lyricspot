const puppeteer = require("D:\\personal\\projects\\Music_cont\\node_modules\\puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(2000);
  async function toLyrics() {
    const btns = await page.$$("button");
    for (const b of btns) { const t = await b.evaluate(el => el.textContent); if (t && t.trim() === "Lyrics") { await b.click(); break; } }
    await sleep(400);
  }
  async function submit(text) {
    const ta = await page.$("textarea");
    if (ta) { await ta.click({ clickCount: 3 }); await ta.type(text, { delay: 10 }); }
    await sleep(200);
    const btns = await page.$$("button");
    for (const b of btns) { const t = await b.evaluate(el => el.textContent); if (t && t.trim() === "Find Song") { await b.click(); break; } }
  }
  const snap = async () => (await page.evaluate(() => document.body.innerText)).replace(/\n/g, " | ");

  // 1. UNKNOWN lyrics -> must show honest error, NO song card
  await toLyrics();
  await submit("yellow submarine sailing on the ocean blue");
  await sleep(9000);
  let txt = await snap();
  console.log("UNKNOWN_HAS_FAKE_SONG: " + /Demo Song|Your Artist/.test(txt));
  console.log("UNKNOWN_HONEST_ERROR: " + txt.includes("without a backend"));

  // 2. EXAMPLE lyrics -> demo result WITH Demo badge
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  await toLyrics();
  await submit("never gonna give you up");
  await sleep(9000);
  txt = await snap();
  console.log("EXAMPLE_SONG: " + txt.includes("Never Gonna Give You Up"));
  console.log("EXAMPLE_DEMO_BADGE: " + /Demo/.test(txt));

  // 3. Voice -> single error message check
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  let mic = null, btns = await page.$$("button");
  for (const b of btns) { const t = await b.evaluate(el => el.getAttribute("aria-label") || ""); if (t === "Start recording") { mic = b; break; } }
  await mic.click();
  await sleep(5500);
  btns = await page.$$("button");
  for (const b of btns) { const t = await b.evaluate(el => el.textContent); if (t && t.includes("Stop Recording")) { await b.click(); break; } }
  await sleep(4000);
  txt = await snap();
  const mentions = (txt.match(/Backend settings/g) || []).length;
  console.log("VOICE_BACKEND_MENTIONS: " + mentions);
  await browser.close();
  console.log("LIVE4_DONE");
}
main().catch(e => { console.error(e.message); process.exit(1); });
