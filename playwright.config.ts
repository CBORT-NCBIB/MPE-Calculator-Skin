/**
 * playwright.config.ts — Playwright runner configuration for MPE-Calculator-Skin
 *
 * Serves web/index.html via Python's built-in http.server so the e2e tests
 * exercise the same static-file deployment a user would see when opening
 * the file directly.  Using Python rather than a node-based static server
 * (e.g. `serve` or `http-server`) keeps the extra dependency count
 * minimal — Python is already required for the build.
 *
 * Tests live under tests/e2e/ and use the .spec.ts extension.  Chromium is
 * the only browser we target — Firefox/WebKit can be added later if cross-
 * browser coverage becomes valuable.
 *
 * The webServer is run from the repository root (the same cwd as this
 * config file); `--directory web` is therefore relative to the repo root.
 *
 * Port 4250 is used to avoid collisions with common dev-server defaults
 * (3000, 4173, 5173, 8000, 8080).
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

const PORT = 4250;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",

  // Each spec runs in its own browser context.  Parallel workers are safe
  // because the calculator is purely client-side (no shared backend state).
  fullyParallel: true,

  // Fail the build on CI if any test is .only(), to prevent accidental
  // landing of focus-mode tests that skip the rest of the suite.
  forbidOnly: IS_CI,

  // Retries: 2 on CI (covers flaky timing-sensitive race tests), 0 locally
  // (so local failures are loud and obvious during development).
  retries: IS_CI ? 2 : 0,

  // Workers: capped on CI to avoid overwhelming the runner; defaults
  // locally (one per logical CPU).
  workers: IS_CI ? 2 : undefined,

  // Reporters:
  //   list   — readable terminal output (always on)
  //   github — annotations in GitHub Actions output (CI only)
  //   html   — post-run report.  open: "never" everywhere to avoid
  //            spawning a browser window on developer machines
  //            (especially over SSH).  Run `npx playwright show-report`
  //            manually after failures.
  reporter: IS_CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    // Trace on first retry — captures network, screenshots, snapshots for
    // post-mortem debugging without bloating successful runs.
    trace: "on-first-retry",
    // Screenshot on failure aids visual-regression triage.
    screenshot: "only-on-failure",
    // Video on first retry — same rationale as trace.
    video: "on-first-retry",

    // Default action timeout — generous because the calculator does
    // genuine work (Worker computation can take a few hundred ms when
    // later specs click Calculate).
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Spin up Python's http.server before tests start.  Playwright polls
  // the URL until it responds, then runs the suite, then tears the
  // server down on completion.
  //
  // reuseExistingServer: locally we reuse an already-running server on
  // the same port (faster iteration).  On CI we always start fresh to
  // avoid masking webServer failures.
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory web`,
    url: `${BASE_URL}/index.html`,
    reuseExistingServer: !IS_CI,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
