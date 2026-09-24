import { defineConfig } from "@playwright/test";

// End-to-end tests against the real static build (npm run build -> out/).
// Every third-party API is mocked in e2e/mocks.ts, so the suite is
// deterministic and runs offline.
const PORT = 4173;
// E2E_PAGES=1 tests the GitHub Pages bundle (built with BASE_PATH=/lyricspot)
// served under /lyricspot/, exactly as github.io serves it.
const pages = !!process.env.E2E_PAGES;
const root = pages ? "e2e/.pages-root" : "out";
const base = "http://127.0.0.1:" + PORT + (pages ? "/lyricspot/" : "/");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: base,
    viewport: { width: 1280, height: 900 },
    // Fake mic so the MediaRecorder (Whisper upload) path runs headless.
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
    permissions: ["microphone"],
  },
  webServer: {
    command: (pages ? "mkdir -p e2e/.pages-root && ln -sfn ../../../docs e2e/.pages-root/lyricspot && " : "")
      + "python3 -m http.server " + PORT + " --bind 127.0.0.1 --directory " + root,
    url: base,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
