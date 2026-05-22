/**
 * tests/e2e/preset-import.spec.ts — Stage 2: preset LSP import (Test Group A)
 *
 * Exercises commit-2's preset-import path: a parameterized raster scan
 * with pattern.parameterized[0].shape = "raster".
 *
 * Fixture: tests/e2e/fixtures/test1-preset-raster.lsp.json
 *   laser.wavelength_nm        = 1060
 *   laser.beam_diameter_mm     = 0.025
 *   laser.pulse.repetition_rate_hz = 100000
 *   laser.pulse.pulse_duration_s   = 1e-08
 *   pattern.parameterized[0].shape          = "raster"
 *   pattern.parameterized[0].params.line_length_mm = 2
 *   pattern.parameterized[0].params.n_lines        = 5
 *   pattern.parameterized[0].params.hatch_mm       = 0.25
 *   pattern.parameterized[0].params.scan_velocity_mm_s = 200
 *
 * After import, the General Scanning sub-tab should show:
 *   #scan-wl  → "1060"
 *   #scan-dia → "0.025"
 *   #scan-sw  → "2"        (Width)
 *   #scan-sh  → "1"        (Height = hatch_mm * (n_lines - 1) = 0.25 * 4)
 *   #scan-nl  → "5"        (Lines)
 *
 * The Import workflow itself is verified by:
 *   - Status badge text changes from "Preset: Built-in" to
 *     "Imported: test1-preset-raster.lsp.json".
 *   - Eject restores the pre-import state (badge reverts to "Preset: Built-in"
 *     and fields revert to their pre-import values).
 *
 * Why these specific assertions?  Stage 2 verifies that the data-load chain
 * — file read → JSON parse → schema validate → worker canonicalize → React
 * setters — works end-to-end for the simplest LSP shape (preset, no custom
 * segments).  Stage 3 will add custom-path coverage.
 */

import { test, expect, Page } from "@playwright/test";
import { resolve } from "node:path";
import { gotoGeneralScanningTab, getLspFileInput } from "./helpers";

const FIXTURE_PATH = resolve(__dirname, "fixtures/test1-preset-raster.lsp.json");

/**
 * Upload the preset-raster fixture via the hidden file input and wait for
 * the import flow to complete (status badge says "Imported: <filename>").
 *
 * Uses setInputFiles directly on the hidden input rather than clicking the
 * visible "Import LSP…" button — this bypasses the OS file picker dialog,
 * which Playwright cannot interact with in headless mode.
 */
async function importPresetRaster(page: Page): Promise<void> {
  await getLspFileInput(page).setInputFiles(FIXTURE_PATH);

  // Wait for the loaded state — the status badge text changes from
  // "Preset: Built-in" / "Loading…" to "Imported: <filename>".  The badge
  // is a <div> whose text content is _lspStatusLabel(lspState).
  //
  // The regex is anchored at end ($) so we catch unexpected suffixes:
  // for a preset import, customPath:false, so the badge text should be
  // exactly "Imported: test1-preset-raster.lsp.json".  If a future bug
  // made the canonicalize pipeline emit customPath:true for a preset,
  // the rendered badge would be "...lsp.json (custom path)" and the
  // regex would fail to match — exposing the bug rather than silently
  // accepting it.
  await expect(
    page.getByText(/^Imported:\s*test1-preset-raster\.lsp\.json$/)
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Preset LSP import (raster)", () => {
  test("status badge updates to Imported after upload", async ({ page }) => {
    await gotoGeneralScanningTab(page);

    // Sanity: before import, badge says "Preset: Built-in".
    await expect(
      page.getByText("Preset: Built-in", { exact: true })
    ).toBeVisible();

    await importPresetRaster(page);
    // importPresetRaster already asserts the post-import badge text;
    // this test exists to document the happy-path entry point.
  });

  test("wavelength field populates to 1060", async ({ page }) => {
    await gotoGeneralScanningTab(page);
    await importPresetRaster(page);
    await expect(page.locator("#scan-wl")).toHaveValue("1060");
  });

  test("beam diameter field populates to 0.025", async ({ page }) => {
    await gotoGeneralScanningTab(page);
    await importPresetRaster(page);
    await expect(page.locator("#scan-dia")).toHaveValue("0.025");
  });

  test("scan width (line length) field populates to 2", async ({ page }) => {
    await gotoGeneralScanningTab(page);
    await importPresetRaster(page);
    await expect(page.locator("#scan-sw")).toHaveValue("2");
  });

  test("scan height field populates to 1", async ({ page }) => {
    // Height = hatch_mm * (n_lines - 1) = 0.25 * 4 = 1.
    // This field only renders when pat !== "linear", so its presence and
    // value together prove the raster pattern was correctly applied.
    await gotoGeneralScanningTab(page);
    await importPresetRaster(page);
    await expect(page.locator("#scan-sh")).toHaveValue("1");
  });

  test("lines field populates to 5", async ({ page }) => {
    // The #scan-nl input only renders when pat !== "linear" (linear scans
    // have no concept of "lines").  Its presence with value "5" confirms
    // both the n_lines value and the non-linear pattern.
    await gotoGeneralScanningTab(page);
    await importPresetRaster(page);
    await expect(page.locator("#scan-nl")).toHaveValue("5");
  });

  test("eject restores pre-import state", async ({ page }) => {
    // Verifies the Eject button reverts the calculator to its pre-import
    // state.  This is the recovery path users take after importing the
    // wrong LSP, and is also the only way to clear an "Import failed"
    // status.  The General Scanning default wavelength is "532" nm; the
    // fixture imports 1060 nm — so the post-import value clearly differs
    // from the pre-import value and we can assert Eject restored it.
    await gotoGeneralScanningTab(page);
    const wlBeforeImport = await page.locator("#scan-wl").inputValue();
    expect(wlBeforeImport).not.toBe("1060"); // sanity: defaults differ

    await importPresetRaster(page);
    await expect(page.locator("#scan-wl")).toHaveValue("1060");

    // Click Eject — the button text is exactly "Eject", and it only
    // appears when an LSP is loaded (so there is exactly one match on
    // the page).  Use exact:true to prevent future regressions if a
    // "Reject" or "Ejected" button is added elsewhere.
    await page.getByRole("button", { name: "Eject", exact: true }).click();

    // Badge should revert.
    await expect(
      page.getByText("Preset: Built-in", { exact: true })
    ).toBeVisible();
    // Wavelength should revert to the value captured before import.
    await expect(page.locator("#scan-wl")).toHaveValue(wlBeforeImport);
  });
});
