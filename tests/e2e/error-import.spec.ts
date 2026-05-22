/**
 * tests/e2e/error-import.spec.ts — Stage 4: malformed LSP error handling
 *
 * Exercises the negative path of the LSP import pipeline: a fixture that
 * fails schema validation should leave the calculator in a clean error
 * state with structured error information surfaced to the user, and
 * MUST NOT have applied any LSP-derived values to the form fields.
 *
 * Fixture: tests/e2e/fixtures/test4-malformed.lsp.json
 *   - laser.pulse_mode = "pulsed" but laser.pulse is missing the required
 *     pulse_duration_s field.
 *   - The validator produces 3 SCHEMA_VIOLATION errors:
 *       [SCHEMA_VIOLATION] /laser/pulse — Expected type null
 *       [SCHEMA_VIOLATION] /laser/pulse/pulse_duration_s — Missing required field: pulse_duration_s
 *       [SCHEMA_VIOLATION] /laser/pulse — must match exactly one schema in oneOf
 *     (The first and third are byproducts of the schema's oneOf branch;
 *     the second is the human-meaningful one.)
 *
 * After import, the calculator should:
 *   - Show status badge: "Import failed"
 *   - Show errors indicator: "3 errors ▾" (with the down-arrow because
 *     the panel is collapsed by default)
 *   - Expose the structured errors when the indicator is clicked.  Each
 *     row is "[CODE] /path — message".
 *   - Keep the Eject button visible (bug #10 canary; Eject is the user's
 *     recovery path out of error state).
 *   - Keep the Import button visible so the user can try a different
 *     file without ejecting first.
 *   - NOT apply any LSP-derived values — atomicity: the form fields
 *     must remain at their pre-import values, since a failed import
 *     should not leave the calculator in a half-applied state.
 *
 * On Eject from error state, the calculator should:
 *   - Return to "Preset: Built-in" badge.
 *   - Hide the errors indicator.
 *   - Keep the form fields exactly as they were before import (already
 *     the case from atomicity, but verified explicitly).
 *
 * Stage 4 completes coverage of all three branches of the import flow:
 *   • Stage 2: preset path (scanParams populated, customPath:false)
 *   • Stage 3: custom path (engineSegments populated, customPath:true)
 *   • Stage 4: error path (phase="error", errors[] populated)
 */

import { test, expect, Page } from "@playwright/test";
import { resolve } from "node:path";
import { gotoGeneralScanningTab, getLspFileInput } from "./helpers";

const FIXTURE_PATH = resolve(
  __dirname,
  "fixtures/test4-malformed.lsp.json"
);

/**
 * Upload the malformed fixture and wait for the error state to settle.
 *
 * Unlike the happy-path helpers in preset-import and custom-import, this
 * one waits for "Import failed" rather than "Imported: ...".  The
 * exact:true match prevents future regressions if "Import failed
 * (something)" gets added to _lspStatusLabel.
 */
async function importMalformedFixture(page: Page): Promise<void> {
  await getLspFileInput(page).setInputFiles(FIXTURE_PATH);

  await expect(
    page.getByText("Import failed", { exact: true })
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Malformed LSP import (error handling)", () => {
  test("status badge shows 'Import failed'", async ({ page }) => {
    await gotoGeneralScanningTab(page);
    await expect(
      page.getByText("Preset: Built-in", { exact: true })
    ).toBeVisible();
    await importMalformedFixture(page);
  });

  test("errors indicator appears with correct count", async ({ page }) => {
    // The malformed fixture produces 3 SCHEMA_VIOLATION errors from the
    // schema validator (one per oneOf branch that failed to match).
    // The indicator text format is "<N> error(s) <arrow>" where the
    // arrow is ▾ (collapsed, default) or ▴ (expanded).
    //
    // We use exact:true on the visible text so that adding more errors
    // OR changing the indicator format causes a clear failure.
    await gotoGeneralScanningTab(page);
    await importMalformedFixture(page);
    await expect(
      page.getByRole("button", { name: "3 errors ▾", exact: true })
    ).toBeVisible();
  });

  test("error panel surfaces structured error codes and paths", async ({ page }) => {
    // The errors panel is collapsed by default (showWarn=false).
    // Click the indicator to expand.  The panel renders each error as:
    //   [SCHEMA_VIOLATION] /path — message
    // We assert on the human-meaningful one: the missing pulse_duration_s
    // field.  The other two SCHEMA_VIOLATION rows are byproducts of the
    // schema's oneOf structure (Ajv reports each branch that failed).
    await gotoGeneralScanningTab(page);
    await importMalformedFixture(page);
    await page
      .getByRole("button", { name: "3 errors ▾", exact: true })
      .click();
    // Once expanded, the panel contains a row with the error code, path,
    // and message.  We check for each piece independently because they
    // are rendered in separate <span> elements within a single <div>.
    //
    // All three matchers use exact:true matching to prevent accidental
    // matches against an ancestor element whose textContent contains
    // the assertion string as a substring (e.g. the parent error-list
    // <div> whose textContent is the concatenation of all 3 error rows).
    // Playwright's exact-match trims surrounding whitespace, so the
    // trailing space rendered by `m.path + " — "` does not need to be
    // included in the assertion string.
    await expect(
      page.getByText("[SCHEMA_VIOLATION]", { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText("/laser/pulse/pulse_duration_s —", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Missing required field: pulse_duration_s", {
        exact: true,
      })
    ).toBeVisible();
  });

  test("Eject button remains visible in error state (bug #10 canary)", async ({ page }) => {
    // Bug #10 in commit-2 history: the Eject button must remain visible
    // when the calculator is in an error state, otherwise the user has
    // no way to dismiss the error and return to a clean state.  The JSX
    // conditional is `(loaded || hasError) ? <Eject/> : null`.
    await gotoGeneralScanningTab(page);
    await importMalformedFixture(page);
    await expect(
      page.getByRole("button", { name: "Eject", exact: true })
    ).toBeVisible();
  });

  test("Import button remains visible in error state", async ({ page }) => {
    // The Import button is hidden only in the "loaded" state.  In error,
    // idle, and loading states it remains visible so the user can try
    // a different file without explicitly ejecting first.  The JSX
    // conditional is `!loaded ? <Import/> : null`.
    await gotoGeneralScanningTab(page);
    await importMalformedFixture(page);
    await expect(
      page.getByRole("button", { name: "Import LSP…", exact: true })
    ).toBeVisible();
  });

  test("form fields are not mutated by a failed import (atomicity)", async ({ page }) => {
    // CRITICAL: a failed import must leave the calculator in exactly
    // the state it was in before the user clicked Import.  Otherwise,
    // a malformed file could leave the form with partially-applied
    // beam parameters and the user might click Calculate against an
    // unintended hybrid configuration.
    //
    // The malformed fixture has laser.wavelength_nm=1060 and
    // laser.beam_diameter_mm=0.025, both of which would CHANGE the
    // form fields if any portion of _lspApplyState had run.  We
    // capture the pre-import values, import the bad fixture, and
    // verify the fields are byte-identical to before.
    await gotoGeneralScanningTab(page);
    const wlBefore = await page.locator("#scan-wl").inputValue();
    const diaBefore = await page.locator("#scan-dia").inputValue();
    const swBefore = await page.locator("#scan-sw").inputValue();
    const shBefore = await page.locator("#scan-sh").inputValue();
    const nlBefore = await page.locator("#scan-nl").inputValue();

    // Sanity: pre-import defaults differ from the fixture values, so
    // a positive assertion below is meaningful.
    expect(wlBefore).not.toBe("1060");
    expect(diaBefore).not.toBe("0.025");

    await importMalformedFixture(page);

    // After the failed import, every field must equal what we captured.
    await expect(page.locator("#scan-wl")).toHaveValue(wlBefore);
    await expect(page.locator("#scan-dia")).toHaveValue(diaBefore);
    await expect(page.locator("#scan-sw")).toHaveValue(swBefore);
    await expect(page.locator("#scan-sh")).toHaveValue(shBefore);
    await expect(page.locator("#scan-nl")).toHaveValue(nlBefore);
  });

  test("Eject from error state restores 'Preset: Built-in'", async ({ page }) => {
    // Eject is the recovery path out of error state.  After clicking
    // it, the badge should revert to "Preset: Built-in" and the
    // errors indicator should disappear.  We don't assert on form
    // fields because the atomicity test above already proves they
    // were never mutated — they're still at their pre-import values.
    await gotoGeneralScanningTab(page);
    await importMalformedFixture(page);
    await expect(
      page.getByRole("button", { name: "3 errors ▾", exact: true })
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Eject", exact: true })
      .click();

    await expect(
      page.getByText("Preset: Built-in", { exact: true })
    ).toBeVisible();
    // After eject, hasMessages becomes false, so the indicator unmounts.
    await expect(
      page.getByRole("button", { name: /errors? ▾/ })
    ).toHaveCount(0);
  });
});
