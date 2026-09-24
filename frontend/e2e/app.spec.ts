import { expect, test } from "@playwright/test";
import { fakeSpeechScript, mockNetwork } from "./mocks";

test.describe("browser engine (no backend)", () => {
  test.beforeEach(async ({ context }) => {
    await mockNetwork(context);
  });

  test("typed lyric -> verified match, timestamp, Spotify player, share URL", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("button", { name: /Browser engine/ })).toBeVisible();
    await page.getByRole("tab", { name: "Type lyrics" }).click();
    await page.getByLabel("The line you remember").fill("is this the real life is this just fantasy");
    await page.getByRole("button", { name: "Find the song" }).click();

    const top = page.locator("article").first();
    await expect(top.getByRole("heading", { name: "Bohemian Rhapsody" })).toBeVisible();
    await expect(top.getByText("Queen", { exact: true })).toBeVisible();
    await expect(top.getByText(/Your line plays at 0:00/)).toBeVisible();
    await expect(top.getByText("Is this the real life? Is this just fantasy?")).toBeVisible();
    // Keyless Spotify resolution via iTunes -> song.link feeds the player.
    await expect(top.locator('iframe[src*="open.spotify.com/embed/track/4u7EnebtmKWzUH433cf5Qv"]')).toBeVisible();
    await expect(top.getByRole("link", { name: /Open in Spotify/ })).toHaveAttribute("href", /open\.spotify\.com\/track\/4u7EnebtmKWzUH433cf5Qv/);
    await expect(top.getByRole("link", { name: /YouTube/ })).toHaveAttribute("href", /youtube\.com\/watch/);
    await expect(page).toHaveURL(/\?q=is\+this\+the\+real\+life/);

    // Back returns to the composer.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Got one line stuck in your head?" })).toBeVisible();
  });

  test("shared ?q= link runs the search on load and lists other matches", async ({ page }) => {
    await page.goto("./?q=hello%20from%20the%20other%20side");
    const top = page.locator("article").first();
    await expect(top.getByRole("heading", { name: "Hello" })).toBeVisible();
    await expect(top.getByText(/Your line plays at 1:19/)).toBeVisible();
  });

  test("picking another result promotes it", async ({ page }) => {
    await page.goto("./?q=is%20this%20the%20real%20life");
    await expect(page.locator("article h2")).toHaveText("Bohemian Rhapsody");
    const other = page.locator("aside").getByRole("button", { name: /Real Life/ });
    await expect(other).toBeVisible();
    await other.click();
    await expect(page.locator("article h2")).toHaveText("Real Life");
  });

  test("no match shows an honest message with a way forward", async ({ page }) => {
    await page.goto("./");
    await page.getByRole("tab", { name: "Type lyrics" }).click();
    await page.getByLabel("The line you remember").fill("zzqx wvvq plorp");
    await page.keyboard.press("Enter");
    await expect(page.locator("main").getByRole("alert")).toContainText("No song matched");
    await expect(page.getByLabel("The line you remember")).toBeVisible();
  });

  test("cancel returns to the composer", async ({ page, context }) => {
    // Slow LRCLIB down so the search is still running when we cancel.
    await context.route(/lrclib\.net/, async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]", headers: { "access-control-allow-origin": "*" } });
    });
    await page.goto("./");
    await page.getByRole("tab", { name: "Type lyrics" }).click();
    await page.getByLabel("The line you remember").fill("is this the real life");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Looking for")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Got one line stuck in your head?" })).toBeVisible();
  });
});

test.describe("voice via browser speech recognition", () => {
  test("sung words are transcribed live and searched", async ({ page, context }) => {
    await mockNetwork(context);
    await context.addInitScript(fakeSpeechScript("hello from the other side"));
    await page.goto("./");
    await page.getByRole("button", { name: "Start listening" }).click();
    await expect(page.getByRole("tabpanel").getByText("hello from the other side")).toBeVisible();
    await page.getByRole("button", { name: "Stop and find song" }).click();
    await expect(page.locator("article h2")).toHaveText("Hello");
  });

  test("humming (no words) gets an honest explanation, not a wrong search", async ({ page, context }) => {
    await mockNetwork(context);
    await context.addInitScript(fakeSpeechScript(""));
    await page.goto("./");
    await page.getByRole("button", { name: "Start listening" }).click();
    await page.getByRole("button", { name: "Stop and find song" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("didn't catch any words");
    await expect(page.getByRole("button", { name: "Type it instead" })).toBeVisible();
  });
});

test.describe("with a backend", () => {
  test("typed search uses the server engine and its results", async ({ page, context }) => {
    await mockNetwork(context, {
      backend: {
        voice: false,
        results: [{
          song: "Bohemian Rhapsody", artist: "Queen", confidence: 91, timestamp: 0.5, timestamp_display: "0:00",
          lyrics_context: { before: [], matched: "Is this the real life? Is this just fantasy?", after: ["Caught in a landslide"] },
          spotify_url: "https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv", strategy: "musixmatch",
        }, {
          song: "is this the real life", artist: "", confidence: 30, timestamp: 0, spotify_url: "", strategy: "fallback_search",
        }],
      },
    });
    await page.goto("./");
    await expect(page.getByRole("button", { name: /Server engine/ })).toBeVisible();
    await page.getByRole("tab", { name: "Type lyrics" }).click();
    await page.getByLabel("The line you remember").fill("is this the real life");
    await page.keyboard.press("Enter");
    await expect(page.locator("article h2")).toHaveText("Bohemian Rhapsody");
    // The backend's echo "fallback_search" pseudo-result is never shown.
    await expect(page.locator("aside")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Yes, right song" })).toBeVisible();
  });

  test("recorded clip is uploaded; a hummed tune comes back as a melody match", async ({ page, context }) => {
    await mockNetwork(context, {
      backend: {
        voice: true, melody: true, input: "melody", transcript: "mm mm mm",
        results: [{
          song: "Yesterday", artist: "The Beatles", confidence: 82, timestamp: 12, timestamp_display: "0:12",
          timestamp_estimated: true, lyrics_context: null, spotify_url: "https://open.spotify.com/track/3BQHpFgAp4l80e1XslIjNI", strategy: "melody",
        }],
      },
    });
    await page.goto("./");
    await expect(page.getByText(/humming is matched by melody/)).toBeVisible();
    await page.getByRole("button", { name: "Start listening" }).click();
    await expect(page.getByText(/Listening · 0:0/)).toBeVisible();
    await page.waitForTimeout(3300);
    const upload = page.waitForRequest((r) => r.url().endsWith("/upload") && r.method() === "POST");
    await page.getByRole("button", { name: "Stop and find song" }).click();
    await upload;
    await expect(page.locator("article h2")).toHaveText("Yesterday");
    await expect(page.getByText("the melody you hummed")).toBeVisible();
    await expect(page.locator("article").getByText("Melody match")).toBeVisible();
  });

  test("sources panel reports the engine and validates the backend URL", async ({ page, context }) => {
    await mockNetwork(context);
    await page.goto("./");
    await page.getByRole("button", { name: "Search sources and API keys" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Browser engine", { exact: true })).toBeVisible();
    await dialog.getByLabel("Backend URL (optional)").fill("not a url");
    await dialog.getByRole("button", { name: "Save and test" }).click();
    await expect(dialog.getByText(/Enter a full URL/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
