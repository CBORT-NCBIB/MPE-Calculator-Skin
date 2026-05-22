/**
 * tests/e2e/custom-import.spec.ts — Stage 3: custom-path LSP import (Test Group B)
 *
 * Exercises commit-2's custom-path import — the branch in _lspApplyState
 * that handles documents with pattern.representation="segments" and
 * pattern.authoritative="segments" (no parameterized preset).
 *
 * Two fixtures exercise this path:
 *
 * Fixture A: tests/e2e/fixtures/test2-custom-square-offset.lsp.json
 *   - 4-line outline of a 5×5 mm square positioned at world (10,5)..(15,10)
 *   - Exercises bug-#1 in commit 2: segments must be translated to bbox origin
 *     so the engine grid, viz, and click coords align (the raw segments at
 *     (10,5)..(15,10) become (0,0)..(5,5) after translation).
 *   - Expected post-import field values:
 *       #scan-sw  → "5.000"   (line-length, from translated bbox width)
 *       #scan-sh  → "5.000"   (height, from translated bbox height)
 *       #scan-nl  → "1"       (custom path always sets nLines=1)
 *
 * Fixture B: tests/e2e/fixtures/test3-2d-zigzag.lsp.json
 *   - 7 segments forming a zigzag path 4 mm wide × 3 mm tall
 *   - Exercises bug-#12 in commit 2: when the user's pre-import pat is
 *     "linear", the viz must use the actual scanHN (3mm) rather than the
 *     35% linear-strip aspect ratio.
 *   - Expected post-import field values:
 *       #scan-sw  → "4.000"   (line-length, from bbox width)
 *       #scan-sh  → "3.000"   (height, from bbox height)
 *       #scan-nl  → "1"       (custom path always sets nLines=1)
 *
 * Both fixtures cause _lspApplyState to take Branch (b) — engineSegments,
 * not scanParams.  In Branch (b):
 *   - The LSP status badge shows "Imported: <filename> (custom path)"
 *     because setLspState is called with customPath:true.
 *   - LLS/scanHS/VS are written with .toPrecision(4) (NOT String(...)),
 *     producing "5.000"/"5.000"/"200.0" for square, "4.000"/"3.000"/"200.0"
 *     for zigzag.
 *   - nLines is always 1.
 *   - pat is NOT changed — the user's pre-import pattern persists under
 *     the disabled UI so Eject correctly restores it.
 *
 * Why these specific assertions?  Stage 3 verifies the harder LSP import
 * path — the one that exercises segment translation, bbox computation, and
 * the engineSegments → customSegsRef storage.  Combined with Stage 2's
 * preset coverage, both branches of _lspApplyState are now under test.
 * Stage 4 will add error-path coverage with the malformed fixture.
 */

import { test, expect, Page } from "@playwright/test";
import { resolve } from "node:path";
import { gotoGeneralScanningTab, getLspFileInput } from "./helpers";

const FIXTURE_SQUARE_PATH = resolve(
  __dirname,
  "fixtures/test2-custom-square-offset.lsp.json"
);
const FIXTURE_ZIGZAG_PATH = resolve(
  __dirname,
  "fixtures/test3-2d-zigzag.lsp.json"
);

/**
 * Upload `fixturePath` via the hidden LSP file input and wait for the
 * "Imported: <filename> (custom path)" badge.
 *
 * Note the suffix: for custom-path fixtures, _lspStatusLabel appends
 * " (custom path)" to the badge text.  The regex is anchored at end ($)
 * so a missing or extra suffix causes a clear failure rather than
 * silent acceptance.
 */
async function importCustomFixture(
  page: Page,
  fixturePath: string,
  expectedFilenameRegex: RegExp
): Promise<void> {
  await getLspFileInput(page).setInputFiles(fixturePath);

  await expect(page.getByText(expectedFilenameRegex)).toBeVisible({
    timeout: 15_000,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Group A — test2: 5×5 mm square at offset (10,5)..(15,10)
// ─────────────────────────────────────────────────────────────────────
test.describe("Custom LSP import (square at offset)", () => {
  const BADGE_REGEX =
    /^Imported:\s*test2-custom-square-offset\.lsp\.json\s*\(custom path\)$/;

  test("status badge shows custom-path import", async ({ page }) => {
    await gotoGeneralScanningTab(page);
    await expect(
      page.getByText("Preset: Built-in", { exact: true })
    ).toBeVisible();
    await importCustomFixture(page, FIXTURE_SQUARE_PATH, BADGE_REGEX);
  });

  test("width field populates to 5.000", async ({ page }) => {
    // Custom path: setLLS(bboxW.toPrecision(4)) where bboxW comes from
    // the translated segment bbox (xmax - xmin = 5).  Note that the
    // bbox is computed from the engine segments AFTER subdivision and
    // beam-diameter padding, so there is minor floating-point overshoot
    // (~5.00000000000003) — toPrecision(4) rounds this to "5.000".
    await gotoGeneralScanningTab(page);
    await importCustomFixture(page, FIXTURE_SQUARE_PATH, BADGE_REGEX);
    await expect(page.locator("#scan-sw")).toHaveValue("5.000");
  });

  test("height field populates to 5.000", async ({ page }) => {
    await gotoGeneralScanningTab(page);
    await importCustomFixture(page, FIXTURE_SQUARE_PATH, BADGE_REGEX);
    await expect(page.locator("#scan-sh")).toHaveValue("5.000");
  });

  test("lines field is set to 1 for custom path", async ({ page }) => {
    // _lspApplyState branch (b) always calls setNLS("1") regardless of
    // the actual segment topology.  The lines concept is meaningful for
    // raster/bidi preset patterns but not for arbitrary segment paths.
    await gotoGeneralScanningTab(page);
    await importCustomFixture(page, FIXTURE_SQUARE_PATH, BADGE_REGEX);
    await expect(page.locator("#scan-nl")).toHaveValue("1");
  });

  test("eject restores pre-import state", async ({ page }) => {
    // Verifies the Eject button reverts a custom-path import the same
    // way it reverts a preset import.  We capture the pre-import value
    // of #scan-sw (the General Scanning default is "20") rather than
    // hardcoding it — that way the test stays correct even if the
    // default changes in a future commit.  After importing the square
    // fixture, #scan-sw should be "5.000"; after Eject it must return
    // to whatever was captured.
    await gotoGeneralScanningTab(page);
    const swBeforeImport = await page.locator("#scan-sw").inputValue();
    expect(swBeforeImport).not.toBe("5.000"); // sanity: defaults differ

    await importCustomFixture(page, FIXTURE_SQUARE_PATH, BADGE_REGEX);
    await expect(page.locator("#scan-sw")).toHaveValue("5.000");

    await page
      .getByRole("button", { name: "Eject", exact: true })
      .click();

    await expect(
      page.getByText("Preset: Built-in", { exact: true })
    ).toBeVisible();
    await expect(page.locator("#scan-sw")).toHaveValue(swBeforeImport);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Group B — test3: 4×3 mm zigzag
// ─────────────────────────────────────────────────────────────────────
test.describe("Custom LSP import (zigzag 4×3)", () => {
  const BADGE_REGEX =
    /^Imported:\s*test3-2d-zigzag\.lsp\.json\s*\(custom path\)$/;

  test("status badge shows custom-path import", async ({ page }) => {
    await gotoGeneralScanningTab(page);
    await importCustomFixture(page, FIXTURE_ZIGZAG_PATH, BADGE_REGEX);
  });

  test("width field populates to 4.000", async ({ page }) => {
    // Zigzag bbox width: original segments span x ∈ [0, 4].  After bbox
    // computation with beam-diameter padding and floating-point arithmetic
    // the value is ~4.000011 — toPrecision(4) rounds to "4.000".
    await gotoGeneralScanningTab(page);
    await importCustomFixture(page, FIXTURE_ZIGZAG_PATH, BADGE_REGEX);
    await expect(page.locator("#scan-sw")).toHaveValue("4.000");
  });

  test("height field populates to 3.000", async ({ page }) => {
    // Zigzag bbox height: original segments span y ∈ [0, 3].  This is
    // the canary for commit-2 bug #12 — when the user's pre-import pat
    // is "linear", the viz must use the actual bboxH (3.000) instead
    // of the 35% linear-strip aspect ratio.  A correct value here is
    // necessary (not sufficient) evidence that the bug stays fixed.
    await gotoGeneralScanningTab(page);
    await importCustomFixture(page, FIXTURE_ZIGZAG_PATH, BADGE_REGEX);
    await expect(page.locator("#scan-sh")).toHaveValue("3.000");
  });
});
