const puppeteer = require("D:\\personal\\projects\\Music_cont\\node_modules\\puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on("pageerror", e => console.log("PAGEERROR: " + String(e).slice(0, 200)));
  page.on("console", m => { if (m.type() === "error") console.log("CONSOLE_ERR: " + m.text().slice(0, 200)); });
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(2000);
  console.log("LOADED: " + (await page.title()));

  // record ~5s then stop
  let mic = null;
  let btns = await page.$$("button");
  for (const b of btns) { const t = await b.evaluate(el => el.getAttribute("aria-label") || ""); if (t === "Start recording") { mic = b; break; } }
  if (!mic) { console.log("NO_MIC"); await browser.close(); return; }
  await mic.click();
  console.log("RECORDING...");
  await sleep(2000);
  await page.screenshot({ path: "D:\\personal\\projects\\Music_cont\\live_rec.png" });
  await sleep(3500);
  btns = await page.$$("button");
  for (const b of btns) { const t = await b.evaluate(el => el.textContent); if (t && t.includes("Stop Recording")) { await b.click(); break; } }
  console.log("STOPPED, waiting...");
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n/g, " | "));
    console.log("T+" + (i+1) + "s: " + txt.slice(0, 220));
  }
  await page.screenshot({ path: "D:\\personal\\projects\\Music_cont\\live_after.png" });
  await browser.close();
  console.log("LIVE_DONE");
}
main().catch(e => { console.error("DRIVER_ERR: " + e.message); process.exit(1); });
