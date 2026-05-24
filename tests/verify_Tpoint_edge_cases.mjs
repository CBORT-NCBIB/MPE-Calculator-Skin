#!/usr/bin/env node
/**
 * Edge-case tests for per-point T_point logic.
 * Each test checks a specific failure mode identified in the adversarial audit.
 */
import { createRequire } from "module";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const e = require(resolve(__dirname, "..", "web/engine.js"));

var passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.log("  FAIL: " + msg); }
}
function test(name, fn) {
  try { fn(); } catch (err) { failed++; console.log("  FAIL: " + name + " threw: " + err.message); }
}

var wl = 1060, d = 0.1, tau = 1e-8, prf = 100000;
var Ep = 1e-7, P = Ep * prf;

function getCell(grid, x_mm, y_mm) {
  var ix = Math.round((x_mm - grid.x_min_mm) / grid.dx_mm);
  var iy = Math.round((y_mm - grid.y_min_mm) / grid.dx_mm);
  ix = Math.max(0, Math.min(grid.nx - 1, ix));
  iy = Math.max(0, Math.min(grid.ny - 1, iy));
  var i = iy * grid.nx + ix;
  return {
    fvt: grid.first_visit_t[i], lvt: grid.last_visit_t[i],
    flu: grid.fluence[i], pc: grid.pulse_count[i],
    Tp: Math.max(grid.last_visit_t[i] - grid.first_visit_t[i], tau)
  };
}

// ─── Test 1: Linear separable T_point is dwell-order, not T_total ──
test("Linear separable: T_point << T_total", function() {
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 200, x0: 0, y0: 0, line_length_mm: 20,
    n_lines: 1, hatch_mm: d, pattern: "linear", blanking: false,
    is_cw: false, v_jump_mm_s: 1000
  };
  var grid = e.createFluenceGridFromParams(sp, 8);
  e.computeScanFluenceSeparable(grid, sp);
  var T_total = 20 / 200;
  var sf = e.evaluateScanSafety(grid,
    {wl_nm: wl, d_1e_mm: d, tau_s: tau, is_cw: false, pulse_energy_J: Ep, prf_hz: prf, avg_power_W: P},
    T_total, "gaussian", 0, {v_mm_s: 200, line_spacing_mm: 0, n_lines: 1});

  assert(sf.T_point_worst_s < T_total * 0.1,
    "T_point (" + sf.T_point_worst_s.toExponential(3) + ") should be << T_total (" + T_total + ")");
  assert(sf.rule2_max_ratio >= sf.rule2_max_ratio_Ttotal - 1e-12,
    "T_point ratio should be >= T_total ratio");
  console.log("  Linear: T_point=" + sf.T_point_worst_s.toExponential(3) +
    ", T_total=" + T_total + ", ratio_Tp/Tt=" +
    (sf.rule2_max_ratio / sf.rule2_max_ratio_Ttotal).toFixed(1) + "x");
});

// ─── Test 2: Raster close-spacing — center cell has multi-line T_point ──
test("Raster close-spacing: center cell T_point spans lines", function() {
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 200, x0: 0, y0: 0, line_length_mm: 5,
    n_lines: 10, hatch_mm: d, pattern: "raster", blanking: true,
    is_cw: false, v_jump_mm_s: 1000
  };
  var grid = e.createFluenceGridFromParams(sp, 8);
  e.computeScanFluenceSeparable(grid, sp);

  var lct = 5/200 + 5/1000 + d/1000;
  // Cell on line 5 (y=0.5) — gets contributions from lines 4,5,6
  var c = getCell(grid, 2.5, 0.5);
  assert(c.Tp > lct * 1.5, "Center cell T_point (" + c.Tp.toExponential(3) +
    ") should span ~2 line cycles (" + (2*lct).toFixed(4) + ")");
  assert(Math.abs(c.Tp - 2 * lct) < lct * 0.1, "Center cell T_point (" +
    c.Tp.toExponential(3) + ") should be ~2×line_cycle (" + (2*lct).toFixed(4) + ")");
  console.log("  Raster center: T_point=" + c.Tp.toExponential(3) + ", expected=" + (2*lct).toFixed(4));
});

// ─── Test 3: Raster widely spaced — T_point at center is dwell-order ──
test("Raster wide-spacing: on-line T_point ~ dwell", function() {
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 200, x0: 0, y0: 0, line_length_mm: 5,
    n_lines: 5, hatch_mm: d * 10, pattern: "raster", blanking: true,
    is_cw: false, v_jump_mm_s: 1000
  };
  var grid = e.createFluenceGridFromParams(sp, 8);
  e.computeScanFluenceSeparable(grid, sp);
  // Cell on line 2 (y=2.0) — only line 2 contributes (hatch >> beam)
  var c = getCell(grid, 2.5, 2.0);
  assert(c.Tp <= tau * 1.1, "On-line T_point (" + c.Tp.toExponential(3) +
    ") should be ~ tau (single line, fvt=lvt)");
  console.log("  Raster wide: T_point=" + c.Tp.toExponential(3) + ", tau=" + tau);
});

// ─── Test 4: CW linear — T_point = line_dur ──
test("CW linear: T_point = line_dur", function() {
  var sp = {
    d_1e_mm: d, prf_hz: 0, pulse_energy_J: 0, avg_power_W: P,
    v_scan_mm_s: 200, x0: 0, y0: 0, line_length_mm: 10,
    n_lines: 1, hatch_mm: d, pattern: "linear", blanking: false,
    is_cw: true, v_jump_mm_s: 1000
  };
  var grid = e.createFluenceGridFromParams(sp, 8);
  e.computeScanFluenceSeparable(grid, sp);
  var line_dur = 10 / 200;
  var sf = e.evaluateScanSafety(grid,
    {wl_nm: wl, d_1e_mm: d, tau_s: 0, is_cw: true, avg_power_W: P},
    line_dur, "gaussian", 200, {v_mm_s: 200, line_spacing_mm: 0, n_lines: 1});
  assert(Math.abs(sf.T_point_worst_s - line_dur) < 1e-6,
    "T_point (" + sf.T_point_worst_s.toExponential(3) + ") should be line_dur (" + line_dur + ")");
  console.log("  CW linear: T_point=" + sf.T_point_worst_s.toExponential(3) + ", line_dur=" + line_dur);
});

// ─── Test 5: CW raster — center cell T_point spans lines ──
test("CW raster close-spacing: center cell T_point > single line", function() {
  var sp = {
    d_1e_mm: d, prf_hz: 0, pulse_energy_J: 0, avg_power_W: P,
    v_scan_mm_s: 200, x0: 0, y0: 0, line_length_mm: 5,
    n_lines: 10, hatch_mm: d, pattern: "raster", blanking: true,
    is_cw: true, v_jump_mm_s: 1000
  };
  var grid = e.createFluenceGridFromParams(sp, 8);
  e.computeScanFluenceSeparable(grid, sp);
  var line_dur = 5 / 200;
  var c = getCell(grid, 2.5, 0.5);
  assert(c.Tp > line_dur * 2, "CW center T_point (" + c.Tp.toExponential(3) +
    ") should span multiple line cycles");
  console.log("  CW raster center: T_point=" + c.Tp.toExponential(3));
});

// ─── Test 6: Bidi close-spacing — center cell spans lines ──
test("Bidi close-spacing: center cell T_point spans lines", function() {
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 200, x0: 0, y0: 0, line_length_mm: 5,
    n_lines: 8, hatch_mm: d, pattern: "bidi", blanking: true,
    is_cw: false, v_jump_mm_s: 1000
  };
  var grid = e.createFluenceGridFromParams(sp, 8);
  e.computeScanFluenceSeparable(grid, sp);
  var c = getCell(grid, 2.5, 0.35);  // between lines 3 and 4
  assert(c.Tp > tau * 100, "Bidi center T_point (" + c.Tp.toExponential(3) + ") should be >> tau");
  console.log("  Bidi center: T_point=" + c.Tp.toExponential(3));
});

// ─── Test 7: Invariant: T_point ratio >= T_total ratio for all paths ──
test("Invariant: rule2_max_ratio >= rule2_max_ratio_Ttotal everywhere", function() {
  var configs = [
    {pat: "linear", nL: 1, h: d, cw: false},
    {pat: "raster", nL: 5, h: d, cw: false},
    {pat: "raster", nL: 5, h: d * 10, cw: false},
    {pat: "bidi", nL: 5, h: d, cw: false},
    {pat: "linear", nL: 1, h: d, cw: true},
    {pat: "raster", nL: 5, h: d, cw: true},
  ];
  for (var ci = 0; ci < configs.length; ci++) {
    var c = configs[ci];
    var sp = {
      d_1e_mm: d, prf_hz: c.cw ? 0 : prf, pulse_energy_J: c.cw ? 0 : Ep,
      avg_power_W: P, v_scan_mm_s: 200, x0: 0, y0: 0, line_length_mm: 5,
      n_lines: c.nL, hatch_mm: c.h, pattern: c.pat, blanking: true,
      is_cw: c.cw, v_jump_mm_s: 1000
    };
    var grid = e.createFluenceGridFromParams(sp, 4);
    e.computeScanFluenceSeparable(grid, sp);
    var line_dur = 5 / 200;
    var flyback = c.pat === "linear" ? 0 :
      (c.pat === "bidi" ? c.h / 1000 : (5 / 1000 + c.h / 1000));
    var T_total = c.nL * line_dur + (c.nL - 1) * flyback;
    var beam = {wl_nm: wl, d_1e_mm: d, tau_s: c.cw ? 0 : tau, is_cw: c.cw,
      pulse_energy_J: c.cw ? 0 : Ep, prf_hz: c.cw ? 0 : prf, avg_power_W: P};
    var sf = e.evaluateScanSafety(grid, beam, T_total, "gaussian",
      c.cw ? 200 : 0, {v_mm_s: 200, line_spacing_mm: c.h, n_lines: c.nL});
    assert(sf.rule2_max_ratio >= sf.rule2_max_ratio_Ttotal - 1e-12,
      c.pat + " " + (c.cw ? "CW" : "pulsed") + " nL=" + c.nL +
      ": Tp=" + sf.rule2_max_ratio.toFixed(8) + " Tt=" + sf.rule2_max_ratio_Ttotal.toFixed(8));
  }
});

// ─── Test 8: Orphan check ──
test("No significant orphan cells (fluence > 0 but no timing)", function() {
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 200, x0: 0, y0: 0, line_length_mm: 2,
    n_lines: 3, hatch_mm: d * 2, pattern: "raster", blanking: true,
    is_cw: false, v_jump_mm_s: 1000
  };
  var grid = e.createFluenceGridFromParams(sp, 8);
  e.computeScanFluenceSeparable(grid, sp);
  var n = grid.nx * grid.ny;
  var peakF = 0, maxOrphan = 0, orphans = 0;
  for (var i = 0; i < n; i++) {
    if (grid.fluence[i] > peakF) peakF = grid.fluence[i];
    if (grid.fluence[i] > 1e-10 && grid.first_visit_t[i] >= 1e29) {
      orphans++;
      if (grid.fluence[i] > maxOrphan) maxOrphan = grid.fluence[i];
    }
  }
  if (orphans > 0) {
    assert(maxOrphan < peakF * 0.001,
      orphans + " orphans; max=" + maxOrphan.toExponential(3) + " peak=" + peakF.toExponential(3));
  } else {
    assert(true, "No orphans");
  }
  console.log("  Orphans: " + orphans + (orphans > 0 ? " (max " + maxOrphan.toExponential(3) + ")" : ""));
});

// ─── Test 9: Legacy pulsed path — square with revisited corner ──
test("Legacy pulsed: square corner with time gap has larger T_point than mid-edge", function() {
  // Square (0,0)→(5,0)→(5,5)→(0,5)→(0,0). Corner (0,0) is hit at t≈0 and t≈0.1.
  var segs = [].concat(
    e.buildLinearScan(0, 0, 0, 5, 200, d),             // edge 1
    e.buildLinearScan(5, 0, Math.PI/2, 5, 200, d),     // edge 2
    e.buildLinearScan(5, 5, Math.PI, 5, 200, d),       // edge 3
    e.buildLinearScan(0, 5, -Math.PI/2, 5, 200, d)     // edge 4
  );
  var grid = e.createFluenceGrid(d, segs, 8);
  e.computeScanFluencePulsed(grid, d, prf, Ep, segs);

  var corner = getCell(grid, 0.0, 0.0);  // hit by edges 1 and 4
  var edge = getCell(grid, 2.5, 0.0);    // hit by edge 1 only

  assert(corner.Tp > edge.Tp * 10,
    "Gap-corner T_point (" + corner.Tp.toExponential(3) + ") should be >> edge T_point (" +
    edge.Tp.toExponential(3) + ")");
  assert(corner.Tp > 0.05, "Gap-corner T_point should be ~0.1 s (full perimeter traversal)");
  console.log("  Square: corner_Tp=" + corner.Tp.toExponential(3) +
    " edge_Tp=" + edge.Tp.toExponential(3));
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
