/**
 * tests/e2e/helpers.ts — shared helpers for e2e specs
 *
 * Functions extracted here are used by more than one spec.  Spec-specific
 * helpers (e.g. importPresetRaster, importMalformedFixture) stay in their
 * respective spec files because their signatures and assertions differ.
 *
 * Excluded from Playwright's test discovery because the testMatch pattern
 * in playwright.config.ts only collects files ending in `.spec.ts` — this
 * file ends in `.ts`, not `.spec.ts`, so it is treated purely as a module
 * imported by the specs.
 */

import { expect, Locator, Page } from "@playwright/test";

/**
 * Navigate to the Scanning Protocols → General Scanning sub-tab and wait
 * for the page to settle.  This is where the LSP import card and the
 * wavelength/diameter/width fields live.
 *
 * The sub-tab defaults to "general" on first mount, so this only needs
 * to click the top-level "Scanning Protocols" tab.  The visibility check
 * on #scan-wl confirms we landed on the right sub-tab.
 */
export async function gotoGeneralScanningTab(page: Page): Promise<void> {
  await page.goto("/index.html");
  await page.locator("#tab-scan").click();
  // Confirm we landed: #scan-wl only exists on the General Scanning sub-tab.
  await expect(page.locator("#scan-wl")).toBeVisible();
}

/**
 * Locate the hidden file input that accepts LSP-JSON files.
 *
 * The PatternSource component renders ONE hidden file input with
 * accept=".json,.lsp.json,application/json".  We match it by the
 * ".lsp.json" substring in the accept attribute — this distinguishes
 * it from the App-level "Load standard" input (accept=".json,
 * application/json", no .lsp.json), which lives in the header bar.
 *
 * Returns a Locator (not a resolved ElementHandle) so the caller can
 * chain setInputFiles or other operations against Playwright's
 * auto-retry pipeline.
 */
export function getLspFileInput(page: Page): Locator {
  return page.locator('input[type="file"][accept*=".lsp.json"]');
}
