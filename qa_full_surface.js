const puppeteer = require("./node_modules/puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SITE = "https://shashwat1729.github.io/lyricspot/";
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + String(e).slice(0,120)));
  page.on("console", m => { if (m.type() === "error" && !m.text().includes("ERR_CONNECTION_REFUSED") && !m.text().includes("p.scdn.co")) errors.push("console: " + m.text().slice(0,120)); });

  // A. load + navbar + footer
  await page.goto(SITE, { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1500);
  check("A1 title", (await page.title()).includes("ContinueMySong"));
  const ghHref = await page.$eval("a[aria-label=\"GitHub repository\"]", el => el.href).catch(() => null);
  check("A2 github link", ghHref === "https://github.com/Shashwat1729/lyricspot", ghHref);
  const starHref = await page.$eval("a[aria-label=\"Star on GitHub\"]", el => el.href).catch(() => null);
  check("A3 star link", starHref && starHref.includes("stargazers"), starHref);
  const backendBtn = await page.$("button[aria-label=\"Backend settings\"]");
  check("A4 settings button", !!backendBtn);
  const footerSrc = await page.$eval("footer a[href*=\"github.com\"]", el => el.href).catch(() => null);
  check("A5 footer source link", !!footerSrc, footerSrc);
  const hero = await page.evaluate(() => document.body.innerText.includes("We'll find the song"));
  check("A6 hero renders", hero);

  // B. mode toggle
  async function clickBtn(text) {
    const btns = await page.$$("button");
    for (const b of btns) { const t = await b.evaluate(el => el.textContent); if (t && t.trim() === text) { await b.click(); return true; } }
    return false;
  }
  await clickBtn("Lyrics"); await sleep(400);
  check("B1 lyrics tab shows textarea", !!(await page.$("textarea")));
  await clickBtn("Voice"); await sleep(400);
  check("B2 voice tab shows mic", !!(await page.$("button[aria-label=\"Start recording\"]")));

  // C. lyrics flow (real browser search)
  await clickBtn("Lyrics"); await sleep(300);
  // C0: submit disabled when empty
  const disabledEmpty = await page.$eval("button[type=\"submit\"]", el => el.disabled).catch(() => null);
  check("C0 submit disabled when empty", disabledEmpty === true);
  // example button fills textarea
  const exBtns = await page.$$("button");
  let exClicked = false;
  for (const b of exBtns) { const t = await b.evaluate(el => el.textContent); if (t && t.includes("never gonna")) { await b.click(); exClicked = true; break; } }
  const taVal = await page.$eval("textarea", el => el.value).catch(() => "");
  check("C1 example fills textarea", exClicked && taVal.includes("never gonna"));
  // clear + type custom via Enter key
  await page.$eval("textarea", el => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
  const ta2 = await page.$("textarea");
  await ta2.type("hello from the other side", { delay: 8 });
  await page.keyboard.press("Enter");
  await sleep(11000);
  let txt = await page.evaluate(() => document.body.innerText);
  check("C2 enter-submits + real song", /Hello/i.test(txt) && /Adele/i.test(txt));
  check("C3 timestamp shown", /\d+:\d\d/.test(txt));
  check("C4 lyrics context shown", /YOU ARE HERE/i.test(txt));
  const spotHref = await page.evaluate(() => { const a = [...document.querySelectorAll("a")].find(x => x.textContent.includes("Spotify")); return a ? a.href : null; });
  check("C5 spotify link present", !!spotHref && spotHref.includes("spotify.com"), spotHref);
  // thumbs disabled offline with title
  const thumbsTitle = await page.evaluate(() => { const d = document.querySelector("div[title*=\"backend connection\"]"); return !!d; });
  check("C6 feedback disabled w/ tooltip offline", thumbsTitle);
  // try again resets
  await clickBtn("Try Again"); await sleep(600);
  check("C7 try-again resets", !!(await page.$("textarea")) || !!(await page.$("button[aria-label=\"Start recording\"]")));

  // D. settings modal full flow
  const sBtn = await page.$("button[aria-label=\"Backend settings\"]");
  await sBtn.click(); await sleep(400);
  check("D1 modal opens", !!(await page.$("#backend-url")));
  // invalid URL
  await page.$eval("#backend-url", el => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.type("#backend-url", "not-a-url");
  let dBtns = await page.$$("button");
  for (const b of dBtns) { const t = await b.evaluate(el => el.textContent); if (t && t.trim() === "Save") { await b.click(); break; } }
  await sleep(300);
  let dlgTxt = await page.evaluate(() => document.body.innerText);
  check("D2 invalid URL rejected", /valid URL/.test(dlgTxt));
  // test dead URL
  await page.$eval("#backend-url", el => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.type("#backend-url", "http://localhost:59999");
  dBtns = await page.$$("button");
  for (const b of dBtns) { const t = await b.evaluate(el => el.textContent); if (t && t.trim() === "Test") { await b.click(); break; } }
  await sleep(6500);
  dlgTxt = await page.evaluate(() => document.body.innerText);
  check("D3 test dead backend shows failure", /Cannot reach|Timed out/i.test(dlgTxt));
  // save dead URL persists, reset clears
  dBtns = await page.$$("button");
  for (const b of dBtns) { const t = await b.evaluate(el => el.textContent); if (t && t.trim() === "Save") { await b.click(); break; } }
  await sleep(300);
  let stored = await page.evaluate(() => localStorage.getItem("lyricspot.apiBase"));
  check("D4 save persists", stored === "http://localhost:59999", stored);
  dBtns = await page.$$("button");
  for (const b of dBtns) { const t = await b.evaluate(el => el.getAttribute("title") || ""); if (t.includes("Reset")) { await b.click(); break; } }
  await sleep(300);
  stored = await page.evaluate(() => localStorage.getItem("lyricspot.apiBase"));
  check("D5 reset clears", stored === null, String(stored));
  // escape closes
  await page.keyboard.press("Escape"); await sleep(300);
  check("D6 escape closes", !(await page.$("#backend-url")));

  // E. voice: short clip error + longer clip offline message
  await clickBtn("Voice"); await sleep(300);
  let mic = await page.$("button[aria-label=\"Start recording\"]");
  await mic.click(); await sleep(1200);
  // timer visible?
  const timerVisible = await page.evaluate(() => /0:0\d/.test(document.body.innerText));
  check("E1 recording timer runs", timerVisible);
  let sBtns = await page.$$("button");
  for (const b of sBtns) { const t = await b.evaluate(el => el.textContent); if (t && t.includes("Stop Recording")) { await b.click(); break; } }
  await sleep(800);
  let eTxt = await page.evaluate(() => document.body.innerText);
  check("E2 short clip error visible", /too short/i.test(eTxt));
  // dismiss via Try again in error card
  // longer clip -> backend unreachable error card (persists)
  mic = await page.$("button[aria-label=\"Start recording\"]");
  if (mic) {
    await mic.click(); await sleep(5000);
    sBtns = await page.$$("button");
    for (const b of sBtns) { const t = await b.evaluate(el => el.textContent); if (t && t.includes("Stop Recording")) { await b.click(); break; } }
    await sleep(4000);
    eTxt = await page.evaluate(() => document.body.innerText);
    check("E3 offline voice error persists", /isn.t reachable|Backend settings/i.test(eTxt));
  } else check("E3 offline voice error persists", false, "no mic btn");

  // F. mobile viewport, no horizontal overflow
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(SITE, { waitUntil: "networkidle0", timeout: 45000 });
  await sleep(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("F1 no horizontal overflow @390px", overflow <= 1, String(overflow));
  const mobileMic = await page.$("button[aria-label=\"Start recording\"]");
  check("F2 mic usable @390px", !!mobileMic);

  // G. static assets + demo page
  async function head200(url) {
    try { const r = await page.evaluate(async (u) => { const x = await fetch(u, { method: "HEAD" }); return x.status; }, url); return r === 200; }
    catch (e) { return false; }
  }
  check("G1 manifest 200", await head200("/lyricspot/manifest.json"));
  check("G2 favicon 200", await head200("/lyricspot/favicon.svg"));
  const demoOk = await page.evaluate(async () => { try { const r = await fetch("/lyricspot/demo/"); return r.status; } catch (e) { return -1; } });
  check("G3 demo page reachable", demoOk === 200, String(demoOk));

  console.log("ERRORS_COLLECTED: " + errors.length);
  errors.slice(0, 8).forEach(e => console.log("  " + e));
  console.log("RESULT pass=" + pass + " fail=" + fail);
  await browser.close();
  console.log("FULLQA_DONE");
})();