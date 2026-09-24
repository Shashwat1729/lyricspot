import { test } from "@playwright/test";
import { fakeSpeechScript, mockNetwork } from "./mocks";

// Not a check: captures screenshots for docs when SCREENSHOT_DIR is set.
const dir = process.env.SCREENSHOT_DIR;
test.skip(!dir, "set SCREENSHOT_DIR to capture screenshots");

test("capture", async ({ browser }) => {
  for (const [name, vp] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
    const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    await mockNetwork(context);
    await context.addInitScript(fakeSpeechScript("is this the real life is this just"));
    const page = await context.newPage();
    await page.goto("./");
    await page.waitForTimeout(600);
    await page.screenshot({ path: dir + "/home-" + name + ".png", fullPage: true });
    await page.getByRole("button", { name: "Start listening" }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: dir + "/listening-" + name + ".png" });
    await page.getByRole("button", { name: "Stop and find song" }).click();
    await page.locator("article h2").waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: dir + "/results-" + name + ".png", fullPage: true });
    await page.getByRole("button", { name: "Search sources and API keys" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: dir + "/sources-" + name + ".png" });
    await context.close();
  }
});
