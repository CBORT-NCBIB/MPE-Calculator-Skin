#!/usr/bin/env node
/**
 * verify_Tpoint.mjs — Demonstrate per-point T_point vs T_total behavior.
 *
 * Runs the engine on three scenarios and prints the dual Rule 2 results:
 *   1. Preset raster (test1 fixture)
 *   2. Custom square (test2 fixture)
 *   3. Custom zigzag (test3 fixture)
 *
 * Expected: T_point < T_total for scenarios where the worst-case point
 * is only exposed during a fraction of the total scan. The T_point-based
 * Rule 2 ratio should be >= the T_total-based ratio (more conservative).
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const engine = require(resolve(repoRoot, "web/engine.js"));
const LSPCanonicalize = require(resolve(repoRoot, "web/lsp/canonicalize.js"));

// Canonicalize needs MPEEngine globally (for buildRasterScan etc.)
globalThis.MPEEngine = engine;

function runFixture(name, path) {
  const doc = JSON.parse(readFileSync(resolve(repoRoot, path), "utf-8"));

  // Canonicalize
  const result = LSPCanonicalize.canonicalize(doc);
  if (!result.ok) {
    console.log(`  ${name}: CANONICALIZE FAILED`, result.errors);
    return;
  }

  const beam = result.beam;
  const segments = result.engineSegments;
  const scanParams = result.scanParams;

  // Build engine-format beam
  const eb = {
    d_1e_mm: beam.d_1e_mm,
    wl_nm: beam.wl_nm,
    tau_s: beam.tau_s,
    prf_hz: beam.prf_hz,
    pulse_energy_J: beam.pulse_energy_J,
    avg_power_W: beam.avg_power_W,
    is_cw: beam.is_cw
  };

  // Compute fluence
  const cr = engine.computeScanFluence(eb, segments, 8, scanParams);
  if (!cr) {
    console.log(`  ${name}: computeScanFluence returned null`);
    return;
  }

  const grid = cr.grid;
  const stats = cr.stats;

  // Evaluate safety
  const T_total = stats.total_time_s;
  const sf = engine.evaluateScanSafety(
    grid, eb, T_total, "gaussian", 0,
    scanParams ? {
      v_mm_s: scanParams.v_scan_mm_s,
      line_spacing_mm: scanParams.hatch_mm || 0,
      n_lines: scanParams.n_lines || 1
    } : null
  );

  // Print results
  console.log(`\n── ${name} ──`);
  console.log(`  Segments: ${segments.length}, scanParams: ${scanParams ? scanParams.pattern : "null (custom)"}`);
  console.log(`  Grid: ${grid.nx}×${grid.ny}, method: ${stats.method || "legacy"}`);
  console.log(`  T_total:       ${T_total.toExponential(4)} s`);
  console.log(`  T_point_worst: ${sf.T_point_worst_s.toExponential(4)} s`);
  console.log(`  Ratio T_point/T_total: ${(sf.T_point_worst_s / T_total).toFixed(6)}`);
  console.log(`  MPE(T_total):  ${sf.mpe_T.toExponential(4)} J/cm²`);
  console.log(`  MPE(T_point):  ${sf.mpe_T_point.toExponential(4)} J/cm²`);
  console.log(`  Peak fluence:  ${sf.peak_fluence.toExponential(4)} J/cm²`);
  console.log(`  Rule 2 ratio (T_point):  ${sf.rule2_max_ratio.toFixed(6)}  ← binding`);
  console.log(`  Rule 2 ratio (T_total):  ${sf.rule2_max_ratio_Ttotal.toFixed(6)}  ← for comparison`);
  console.log(`  Rule 1 ratio:            ${sf.rule1_max_ratio.toFixed(6)}`);
  console.log(`  Binding rule: ${sf.binding_rule}`);
  console.log(`  Safe: ${sf.safe}`);
  console.log(`  Worst point: (${sf.worst_x_mm.toFixed(3)}, ${sf.worst_y_mm.toFixed(3)}) mm`);
}

console.log("═══════════════════════════════════════════════════════");
console.log("Per-point T_point vs T_total verification");
console.log("═══════════════════════════════════════════════════════");

runFixture("Preset raster (test1)", "tests/e2e/fixtures/test1-preset-raster.lsp.json");
runFixture("Custom square (test2)", "tests/e2e/fixtures/test2-custom-square-offset.lsp.json");
runFixture("Custom zigzag (test3)", "tests/e2e/fixtures/test3-2d-zigzag.lsp.json");

console.log("\n═══════════════════════════════════════════════════════");
console.log("Done.");
