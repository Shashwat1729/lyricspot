setTimeout(() => {
  const { execSync } = require("child_process");
  const code = `
const puppeteer = require("./node_modules/puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
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
  const snap = async () => (await page.evaluate(() => document.body.innerText)).replace(/\\n/g, " | ");
  await toLyrics();
  await submit("never gonna give you up never gonna let you down");
  await sleep(12000);
  let txt = await snap();
  console.log("KNOWN song=" + /Never Gonna/i.test(txt) + " ts=" + /\\d+:\\d\\d/.test(txt));
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  await toLyrics();
  await submit("yellow submarine sailing on the ocean blue");
  await sleep(12000);
  txt = await snap();
  console.log("YELLOW song=" + /Yellow Submarine/i.test(txt) + " ts=" + /\\d+:\\d\\d/.test(txt));
  await page.goto("https://shashwat1729.github.io/lyricspot/", { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  await toLyrics();
  await submit("is this the real life is this just fantasy");
  await sleep(12000);
  txt = await snap();
  console.log("BOHEMIAN song=" + /Bohemian|Queen/i.test(txt) + " ts=" + /\\d+:\\d\\d/.test(txt));
  await browser.close();
  console.log("FINAL_LOOP_DONE");
})();
`;
  require("fs").writeFileSync("D:\\personal\\projects\\Music_cont\\qa_final.js", code, "utf8");
  execSync("node D:\\personal\\projects\\Music_cont\\qa_final.js", { stdio: "inherit" });
}, 90000);
console.log("waiting 90s for Pages 0933604...");
