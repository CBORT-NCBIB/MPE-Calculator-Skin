/**
 * tests/e2e/smoke.spec.ts — Stage 1 framework verification
 *
 * Three trivial smoke tests confirm Playwright is correctly wired up
 * in the developer's environment and on CI:
 *
 *   1. Page loads and React mounts (verified by checking that the
 *      root div has children, plus the document title matches).
 *   2. A known UI anchor (the Scanning Protocols tab) is visible —
 *      this is a stronger signal that React rendered the actual UI.
 *   3. The page loads without console errors or uncaught exceptions
 *      that would indicate the bundle is broken.
 *
 * If any spec fails, the problem is almost certainly environmental:
 *   - Python http.server failed to start (port conflict?)
 *   - Chromium browser not installed (run `npm run test:e2e:install`)
 *   - web/index.html not built (run `python3 web/build.py`)
 *
 * Real bug coverage lives in subsequent specs added in Stage 2 onward.
 */

import { test, expect } from "@playwright/test";

/**
 * Console messages that are environmental noise, not real defects.
 *
 * - favicon 404: the calculator HTML does not declare a favicon link,
 *   so browsers auto-request /favicon.ico and Chromium logs the 404
 *   as a console error.  This is benign and unrelated to the bundle.
 *
 * Filter additions should be conservative — every entry here is a
 * known-benign message that, if it ever surfaced as a real defect,
 * would be caught by a more targeted test elsewhere.
 */
const BENIGN_CONSOLE_PATTERNS: RegExp[] = [
  /favicon\.ico/i,
  /Failed to load resource.*favicon/i,
];

function isBenign(message: string): boolean {
  return BENIGN_CONSOLE_PATTERNS.some((rx) => rx.test(message));
}

test.describe("Framework smoke", () => {
  test("page loads and React mounts", async ({ page }) => {
    await page.goto("/index.html");

    // The document title is hardcoded in HTML; this confirms the file
    // was served successfully but does not prove React mounted.
    await expect(page).toHaveTitle(/Laser Skin MPE Calculator/);

    // The #root div is empty until React mounts.  Once mounted, it
    // contains the tab bar and panel contents.  childElementCount > 0
    // is a robust mount indicator that does not depend on any specific
    // UI element.  Auto-retry handles the React-mount race naturally.
    await expect
      .poll(() => page.locator("#root").evaluate((el) => el.childElementCount), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
  });

  test("Scanning Protocols tab is rendered", async ({ page }) => {
    await page.goto("/index.html");
    // Stable selector: the tab button has id="tab-scan" assigned in
    // calculator.jsx.  Using the ID rather than role/name keeps the
    // smoke test independent of accessibility-tree details (the tabs
    // use role="tab", not role="button") and rebranding (the label
    // could change from "Scanning Protocols" to something else).
    await expect(page.locator("#tab-scan")).toBeVisible();
  });

  test("no console errors during initial load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/index.html");
    await page.waitForLoadState("load");
    // Wait for React to finish its initial render and any synchronous
    // post-mount effects.  We use the appearance of #tab-scan as the
    // settle signal — once it is visible, the component tree has run
    // through useState initialization and useEffect callbacks.  This
    // gives effect-thrown errors a chance to surface in the listener.
    await expect(page.locator("#tab-scan")).toBeVisible();

    const significant = errors.filter((msg) => !isBenign(msg));
    expect(
      significant,
      `Unexpected console errors during load:\n${significant.join("\n")}`
    ).toHaveLength(0);
  });
});
