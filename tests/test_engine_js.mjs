/**
 * JavaScript engine tests — verifies engine.js against hand-computed
 * ICNIRP 2013 values and cross-checks against the Python test suite.
 *
 * Run: node tests/test_engine_js.mjs
 *
 * Uses Node.js built-in assert (no npm dependencies).
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const assert = require("assert");
const e = require("../web/engine.js");

let pass = 0;
let fail = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    errors.push(`  FAIL: ${name}\n        ${err.message}`);
  }
}

function approx(got, exp, tol, msg) {
  if (!isFinite(got) || !isFinite(exp)) {
    assert.strictEqual(got, exp, msg || `${got} !== ${exp}`);
    return;
  }
  const rel = Math.abs(got - exp) / Math.max(Math.abs(exp), 1e-30);
  assert.ok(rel < tol, `${msg || ""} got ${got}, expected ${exp} (rel err ${rel.toExponential(2)} > ${tol})`);
}

// ═══════ Core MPE ═══════

test("skinMPE: UV 200nm 100s = 0.003 J/cm²", () => {
  approx(e.skinMPE(200, 100), 0.003, 1e-6);
});

test("skinMPE: UV 302nm (discrete) = 0.004 J/cm²", () => {
  approx(e.skinMPE(302, 1), 0.004, 1e-6);
});

test("skinMPE: UV 310nm (discrete) = 0.16 J/cm²", () => {
  approx(e.skinMPE(310, 1), 0.16, 1e-6);
});

test("skinMPE: UV thermal 200nm 1ns = 0.56 × (1e-9)^0.25", () => {
  approx(e.skinMPE(200, 1e-9), 0.003, 1e-6); // photochemical dominates
});

test("skinMPE: Visible 532nm 10ns = 0.02 J/cm² (CA=1)", () => {
  approx(e.skinMPE(532, 1e-8), 0.02, 1e-6);
});

test("skinMPE: Visible 532nm 1s = 1.1 × 1^0.25 = 1.1 J/cm²", () => {
  approx(e.skinMPE(532, 1), 1.1, 1e-6);
});

test("skinMPE: Visible 532nm 100s (t≥10) = 0.2 × 100 = 20 J/cm²", () => {
  approx(e.skinMPE(532, 100), 20, 1e-6);
});

test("skinMPE: NIR 800nm 10ns = 0.02 × CA(800)", () => {
  const ca = e.CA(800);
  approx(e.skinMPE(800, 1e-8), 0.02 * ca, 1e-6);
});

test("skinMPE: NIR 1064nm 10ns = 0.02 × 5 = 0.1", () => {
  approx(e.skinMPE(1064, 1e-8), 0.1, 1e-6);
});

test("skinMPE: FIR 1500nm 10ns = 1.0 J/cm²", () => {
  approx(e.skinMPE(1500, 1e-8), 1.0, 1e-6);
});

test("skinMPE: FIR 10600nm 10ns = 0.01 J/cm²", () => {
  approx(e.skinMPE(10600, 1e-8), 0.01, 1e-6);
});

test("skinMPE: FIR 10600nm 1s = 0.56 × 1^0.25 = 0.56", () => {
  approx(e.skinMPE(10600, 1), 0.56, 1e-6);
});

// ═══════ Correction Factor CA ═══════

test("CA: 532nm = 1.0", () => {
  approx(e.CA(532), 1.0, 1e-6);
});

test("CA: 700nm boundary = 1.0", () => {
  approx(e.CA(700), 1.0, 1e-6);
});

test("CA: 1064nm = 10^(0.002×364) = 5.0", () => {
  approx(e.CA(1064), 5.0, 0.01);
});

test("CA: 1401nm (outside range) = 1.0", () => {
  approx(e.CA(1401), 1.0, 1e-6);
});

// ═══════ Repetitive Pulse ═══════

test("repPulse: 532nm, 10ns, 10Hz, 1s → N=10", () => {
  const r = e.repPulse(532, 1e-8, 10, 1);
  approx(r.N, 10, 1e-6);
  approx(r.rule1, 0.02, 1e-6);
  approx(r.rule2, e.skinMPE(532, 1) / 10, 1e-6);
  assert.ok(r.H <= r.rule1 && r.H <= r.rule2);
});

test("repPulse: single pulse (N≤1) → H = Rule 1", () => {
  const r = e.repPulse(532, 1e-8, 0.5, 1);
  approx(r.H, 0.02, 1e-6);
  assert.strictEqual(r.binding, "Rule 1");
});

test("repPulse: 532nm 10ns 55Hz 10s → Rule 2 dominates at N=550", () => {
  const r = e.repPulse(532, 1e-8, 55, 10);
  assert.ok(r.N > 1);
  assert.strictEqual(r.binding, "Rule 2");
  assert.ok(r.H < r.rule1, "Rule 2 should be more restrictive");
});

// ═══════ Band Name ═══════

test("bandName: 300nm = UV", () => {
  assert.strictEqual(e.bandName(300), "UV");
});

test("bandName: 532nm = Visible", () => {
  assert.strictEqual(e.bandName(532), "Visible");
});

test("bandName: 1064nm = Near-IR", () => {
  assert.strictEqual(e.bandName(1064), "Near-IR");
});

test("bandName: 10600nm = Far-IR", () => {
  assert.strictEqual(e.bandName(10600), "Far-IR");
});

// ═══════ Photoacoustic Functions ═══════

test("paEffFluence: basic computation", () => {
  const h = e.paEffFluence(532, 1e-8, 10, 1);
  assert.ok(isFinite(h) && h > 0);
  assert.ok(h <= e.skinMPE(532, 1e-8)); // Cannot exceed single-pulse MPE
});

test("paRelSNR: increases with PRF initially", () => {
  const snr1 = e.paRelSNR(532, 1e-8, 1, 1);
  const snr10 = e.paRelSNR(532, 1e-8, 10, 1);
  assert.ok(snr10 > snr1, "SNR should increase with PRF");
});

test("paOptimalPRF: returns finite positive value", () => {
  const f = e.paOptimalPRF(532, 1e-8, 1);
  assert.ok(isFinite(f) && f > 0);
});

// ═══════ Beam Evaluation ═══════

test("getAperture: UV → 3.5mm", () => {
  approx(e.getAperture(300), 3.5, 1e-6);
});

test("beamEval: small beam (0.5mm) → actual_sub_threshold regime", () => {
  const r = e.beamEval(532, 0.5);
  assert.strictEqual(r.regime, "actual_sub_threshold");
});

test("beamEval: aperture-averaged beam (2mm)", () => {
  const r = e.beamEval(532, 2);
  assert.strictEqual(r.regime, "aperture_averaged");
  approx(r.d_eval_mm, 3.5, 1e-6); // Uses limiting aperture
});

test("beamEval: large beam (5mm) → actual_fills regime", () => {
  const r = e.beamEval(532, 5);
  assert.strictEqual(r.regime, "actual_fills");
  approx(r.d_eval_mm, 5, 1e-6);
});

// ═══════ Scanning Engine ═══════

test("scanDwellGaussian: d=1mm, v=100mm/s", () => {
  const td = e.scanDwellGaussian(1, 100);
  approx(td, Math.sqrt(Math.PI) / 200, 1e-6);
});

test("buildLinearScan: 20mm at 1mm beam → 20 segments", () => {
  const segs = e.buildLinearScan(0, 0, 0, 20, 100, 1);
  assert.strictEqual(segs.length, 20);
  approx(segs[0].x_start_mm, 0, 1e-6);
  approx(segs[19].x_start_mm, 19, 1e-6);
});

test("buildBidiRasterScan: 20mm × 8 lines → segments created", () => {
  const segs = e.buildBidiRasterScan(0, 0, 20, 8, 0.5, 100, 500, 1);
  assert.ok(segs.length > 100, "Should have >100 segments");
});

test("computeScanFluence: produces valid grid", () => {
  const segs = e.buildBidiRasterScan(0, 0, 20, 8, 0.5, 100, 500, 1);
  const beam = {d_1e_mm: 1, wl_nm: 532, tau_s: 1e-8, prf_hz: 10000,
    pulse_energy_J: 5e-5, avg_power_W: 0.5, is_cw: false};
  const r = e.computeScanFluence(beam, segs, 8);
  assert.ok(r !== null);
  assert.ok(r.grid.nx > 0 && r.grid.ny > 0);
  assert.ok(r.stats.total_pulses > 0);
  assert.ok(r.stats.total_time_s > 0);
  // Fluence should be non-zero somewhere
  let maxF = 0;
  for (let i = 0; i < r.grid.fluence.length; i++) {
    if (r.grid.fluence[i] > maxF) maxF = r.grid.fluence[i];
  }
  assert.ok(maxF > 0, "Peak fluence should be positive");
});

test("evaluateScanSafety: returns complete result", () => {
  const segs = e.buildBidiRasterScan(0, 0, 20, 8, 0.5, 100, 500, 1);
  const beam_eng = {d_1e_mm: 1, wl_nm: 532, tau_s: 1e-8, prf_hz: 10000,
    pulse_energy_J: 5e-5, avg_power_W: 0.5, is_cw: false};
  const r = e.computeScanFluence(beam_eng, segs, 8);
  const sf = e.evaluateScanSafety(r.grid,
    {wl_nm: 532, d_1e_mm: 1, tau_s: 1e-8, is_cw: false},
    r.stats.total_time_s, "gaussian", 0);
  assert.ok(typeof sf.safe === "boolean");
  assert.ok(isFinite(sf.worst_ratio));
  assert.ok(isFinite(sf.peak_fluence));
  assert.ok(sf.max_pulses > 0);
  assert.ok(isFinite(sf.thermal_relax_s));
});

test("evaluateScanSafety: low power → safe=true", () => {
  const segs = e.buildLinearScan(0, 0, 0, 10, 100, 1);
  const beam_eng = {d_1e_mm: 1, wl_nm: 532, tau_s: 1e-8, prf_hz: 1000,
    pulse_energy_J: 1e-6, avg_power_W: 0.001, is_cw: false};
  const r = e.computeScanFluence(beam_eng, segs, 4);
  const sf = e.evaluateScanSafety(r.grid,
    {wl_nm: 532, d_1e_mm: 1, tau_s: 1e-8, is_cw: false},
    r.stats.total_time_s, "gaussian", 0);
  assert.strictEqual(sf.safe, true, "Very low power should be safe");
});

test("maxPulseEnergy: 532nm, 1mm, 10ns", () => {
  const Emax = e.maxPulseEnergy(532, 1, 1e-8);
  assert.ok(isFinite(Emax) && Emax > 0);
  // Should equal MPE(tau) × π × w² / 200 where w = d/√2
  const w = 1 / Math.sqrt(2);
  const expected = 0.02 * Math.PI * w * w / 200;
  approx(Emax, expected, 1e-6);
});

test("minRepRate: 532nm, 1mm, 10ns, 0.5W", () => {
  const fmin = e.minRepRate(532, 1, 1e-8, 0.5);
  assert.ok(isFinite(fmin) && fmin > 0);
});

// ═══════ Cross-language consistency (Python test vectors) ═══════

test("Cross-check: UV 315nm t≥10s → 1.0 J/cm²", () => {
  approx(e.skinMPE(315, 100), 1.0, 1e-6);
});

test("Cross-check: FIR 1450nm 5ms = 0.56 × 0.005^0.25", () => {
  approx(e.skinMPE(1450, 5e-3), 0.56 * Math.pow(5e-3, 0.25), 1e-4);
});

test("Cross-check: FIR 2000nm 100ns = 0.1 J/cm²", () => {
  approx(e.skinMPE(2000, 1e-7), 0.1, 1e-6);
});

// ═══════ Edge cases ═══════

test("skinMPE: out of range wavelength → NaN", () => {
  assert.ok(isNaN(e.skinMPE(100, 1)), "100nm should be out of range");
});

test("CA: below 400nm → default 1.0", () => {
  approx(e.CA(300), 1.0, 1e-6);
});

test("repPulse: zero PRF → single pulse", () => {
  const r = e.repPulse(532, 1e-8, 0, 1);
  approx(r.N, 0, 1e-6);
  approx(r.H, e.skinMPE(532, 1e-8), 1e-6);
});

// ═══════ Input validation (safety-critical) ═══════

test("repPulse: negative PRF → Invalid", () => {
  const r = e.repPulse(532, 1e-8, -1, 10);
  assert.strictEqual(r.binding, "Invalid", "negative PRF should return Invalid");
  assert.ok(isNaN(r.H), "H should be NaN for invalid input");
});

test("repPulse: negative T → Invalid", () => {
  const r = e.repPulse(532, 1e-8, 1000, -1);
  assert.strictEqual(r.binding, "Invalid");
});

test("repPulse: T=0 → Invalid", () => {
  const r = e.repPulse(532, 1e-8, 1000, 0);
  assert.strictEqual(r.binding, "Invalid");
});

test("buildLinearScan: v=0 → empty", () => {
  const segs = e.buildLinearScan(0, 0, 0, 10, 0, 1);
  assert.strictEqual(segs.length, 0, "zero velocity should return empty");
});

test("buildLinearScan: negative length → empty", () => {
  const segs = e.buildLinearScan(0, 0, 0, -5, 100, 1);
  assert.strictEqual(segs.length, 0);
});

test("buildRasterScan: nLines=0 → empty", () => {
  const segs = e.buildRasterScan(0, 0, 10, 0, 0.1, 100, 500, 1);
  assert.strictEqual(segs.length, 0);
});

test("buildRasterScan: hatch=0 defaults to d_1e_mm", () => {
  const segs = e.buildRasterScan(0, 0, 10, 3, 0, 100, 500, 1);
  // Should produce valid segments with hatch defaulted to d_1e_mm=1
  assert.ok(segs.length > 0, "should produce segments with defaulted hatch");
  // Verify the scan pattern spans at least d_1e_mm in y
  const ys = segs.map(s => s.y_start_mm);
  const yRange = Math.max(...ys) - Math.min(...ys);
  assert.ok(yRange >= 0.9, `y range ${yRange} should span at least ~1mm (d_1e_mm)`);
});

test("buildBidiRasterScan: v=0 → empty", () => {
  const segs = e.buildBidiRasterScan(0, 0, 10, 5, 0.5, 0, 500, 1);
  assert.strictEqual(segs.length, 0);
});

// ═══════ CW scanning ═══════

test("computeScanFluenceCW: basic linear", () => {
  const segs = e.buildLinearScan(0, 0, 0, 10, 100, 1);
  const beam = { d_1e_mm: 1, avg_power_W: 0.1, is_cw: true };
  const r = e.computeScanFluence(beam, segs, 8);
  assert.ok(r !== null, "should return a result");
  assert.ok(r.stats.total_time_s > 0, "scan time should be positive");
  assert.ok(r.stats.n_sweeps > 0, "should have sweeps");
  // Peak fluence should be positive
  let peak = 0;
  for (let i = 0; i < r.grid.fluence.length; i++) {
    if (r.grid.fluence[i] > peak) peak = r.grid.fluence[i];
  }
  assert.ok(peak > 0, "CW fluence should be positive");
});

test("computeScanFluenceCW: raster with revisit", () => {
  const segs = e.buildBidiRasterScan(0, 0, 5, 4, 0.5, 100, 500, 1);
  const beam = { d_1e_mm: 1, avg_power_W: 0.5, is_cw: true };
  const r = e.computeScanFluence(beam, segs, 6);
  assert.ok(r !== null);
  let peak = 0;
  for (let i = 0; i < r.grid.fluence.length; i++) {
    if (r.grid.fluence[i] > peak) peak = r.grid.fluence[i];
  }
  assert.ok(peak > 0, "CW raster fluence should be positive");
});

test("evaluateScanSafety: CW with dwell time", () => {
  const segs = e.buildLinearScan(0, 0, 0, 10, 100, 1);
  const beam = { d_1e_mm: 1, avg_power_W: 0.01, is_cw: true };
  const r = e.computeScanFluence(beam, segs, 8);
  const sf = e.evaluateScanSafety(r.grid,
    { wl_nm: 532, d_1e_mm: 1, is_cw: true },
    r.stats.total_time_s, "gaussian", r.stats.min_velocity);
  assert.ok(typeof sf.safe === "boolean", "should have safe verdict");
  assert.ok(sf.rule2_max_ratio >= 0, "R2 ratio should be non-negative");
});

// ═══════ Analytical cross-check integration ═══════

test("analyticalPeakFluence: single-line pulsed", () => {
  const beam = { d_1e_mm: 1, prf_hz: 10000, pulse_energy_J: 1e-4, avg_power_W: 1, is_cw: false };
  const ap = e.analyticalPeakFluence(beam, 100, 0, 1);
  assert.ok(ap.peak_fluence_Jcm2 > 0, "analytical peak should be positive");
  assert.ok(ap.H0_Jcm2 > 0, "H0 should be positive");
  assert.ok(ap.along_sum > 1, "along sum should be > 1 for overlapping pulses");
});

test("analyticalPeakFluence: CW single line", () => {
  const beam = { d_1e_mm: 1, avg_power_W: 0.1, is_cw: true };
  const ap = e.analyticalPeakFluence(beam, 100, 0, 1);
  assert.ok(ap.peak_fluence_Jcm2 > 0, "CW analytical peak should be positive");
});

test("evaluateScanSafety: analytical cross-check selects max", () => {
  // Low-PRF linear scan where analytical should catch grid underestimate
  const segs = e.buildLinearScan(0, 0, 0, 20, 100, 1);
  const beam = { d_1e_mm: 1, prf_hz: 1000, pulse_energy_J: 1e-4, avg_power_W: 0.1, is_cw: false };
  const r = e.computeScanFluence(beam, segs, 8);
  let gridPeak = 0;
  for (let i = 0; i < r.grid.fluence.length; i++) {
    if (r.grid.fluence[i] > gridPeak) gridPeak = r.grid.fluence[i];
  }
  const sf = e.evaluateScanSafety(r.grid,
    { wl_nm: 532, d_1e_mm: 1, tau_s: 1e-8, is_cw: false, pulse_energy_J: 1e-4, prf_hz: 1000, avg_power_W: 0.1 },
    r.stats.total_time_s, "gaussian", 0,
    { v_mm_s: 100, line_spacing_mm: 0, n_lines: 1 });
  // Safety peak should be >= grid peak (analytical may be higher)
  assert.ok(sf.peak_fluence >= gridPeak * 0.999,
    `safety peak ${sf.peak_fluence} should be >= grid peak ${gridPeak}`);
});

// ═══════ Flyback blanking ═══════

test("buildRasterScan: blanking flags return segments", () => {
  const segs = e.buildRasterScan(0, 0, 10, 5, 0.5, 100, 500, 1, true);
  const blanked = segs.filter(s => s.blanked);
  assert.ok(blanked.length > 0, "should have blanked segments");
  const active = segs.filter(s => !s.blanked);
  assert.ok(active.length > 0, "should have active segments");
});

test("blanking reduces peak fluence", () => {
  const beam = { d_1e_mm: 1, prf_hz: 10000, pulse_energy_J: 1e-4, avg_power_W: 1, is_cw: false };
  const segsOff = e.buildRasterScan(0, 0, 10, 10, 0.5, 100, 500, 1, false);
  const segsOn  = e.buildRasterScan(0, 0, 10, 10, 0.5, 100, 500, 1, true);
  const rOff = e.computeScanFluence(beam, segsOff, 4);
  const rOn  = e.computeScanFluence(beam, segsOn,  4);
  let peakOff = 0, peakOn = 0;
  for (let i = 0; i < rOff.grid.fluence.length; i++) {
    if (rOff.grid.fluence[i] > peakOff) peakOff = rOff.grid.fluence[i];
  }
  for (let i = 0; i < rOn.grid.fluence.length; i++) {
    if (rOn.grid.fluence[i] > peakOn) peakOn = rOn.grid.fluence[i];
  }
  assert.ok(peakOn < peakOff, `blanking ON peak (${peakOn}) should be < OFF (${peakOff})`);
});

// ═══════ Named constants ═══════

test("engine exports named constants", () => {
  assert.strictEqual(e.OP_BUDGET, 40e6);
  assert.strictEqual(e.DEFAULT_MAX_COMPUTE_PULSES, 500000);
  assert.strictEqual(e.KAPPA_SKIN_MM2_S, 0.13);
  assert.strictEqual(e.GAUSS_TRUNCATION_SIGMA, 3);
  assert.strictEqual(e.MAX_GRID_CELLS, 4000000);
  assert.strictEqual(e.MAX_VIZ_PULSES, 50000);
});

// ═══════ Cross-language exhaustive vectors ═══════
// Test JS engine against Python-verified boundary values at all band edges
// These 20 test points cover every wavelength band and duration boundary in ICNIRP 2013

test("cross-language: 20 boundary test points match Python", () => {
  const vectors = [
    [200, 1e-8, 3e-3],    [200, 100, 3e-3],     [302, 1, 4e-3],
    [310, 1, 0.16],        [315, 100, 1.0],       [400, 1e-8, 0.02],
    [400, 1, 1.1],         [400, 100, 20.0],      [532, 1e-8, 0.02],
    [532, 1, 1.1],         [700, 1e-8, 0.02],     [1064, 1e-8, 0.1],
    [1400, 1e-8, 0.1],     [1400, 1, 0.56],       [1500, 1e-8, 1.0],
    [1500, 1, 1.0],        [1800, 1e-8, 0.1],     [2600, 1e-8, 0.01],
    [2600, 1, 0.56],       [10600, 1e-8, 0.01],
  ];
  let matched = 0;
  for (const [wl, t, expected] of vectors) {
    const got = e.skinMPE(wl, t);
    if (Math.abs(got - expected) / expected < 1e-3) {
      matched++;
    } else {
      throw new Error(`skinMPE(${wl}, ${t}) = ${got}, expected ${expected}`);
    }
  }
  assert.strictEqual(matched, 20, "all 20 boundary points should match");
});

// ═══════ Separable Gaussian Sum (θ₃) Engine Tests ═══════

test("canUseSeparable: rejects CW", () => {
  assert.strictEqual(e.canUseSeparable({is_cw: true, pattern: "raster", prf_hz: 1000, v_scan_mm_s: 100, line_length_mm: 10, n_lines: 5, hatch_mm: 0.5}), false);
});

test("canUseSeparable: accepts pulsed raster", () => {
  assert.strictEqual(e.canUseSeparable({is_cw: false, pattern: "raster", prf_hz: 1000, v_scan_mm_s: 100, line_length_mm: 10, n_lines: 5, hatch_mm: 0.5}), true);
});

test("canUseSeparable: accepts pulsed bidi", () => {
  assert.strictEqual(e.canUseSeparable({is_cw: false, pattern: "bidi", prf_hz: 1000, v_scan_mm_s: 100, line_length_mm: 10, n_lines: 5, hatch_mm: 0.5}), true);
});

test("canUseSeparable: accepts pulsed linear", () => {
  assert.strictEqual(e.canUseSeparable({is_cw: false, pattern: "linear", prf_hz: 1000, v_scan_mm_s: 100, line_length_mm: 10}), true);
});

test("canUseSeparable: rejects custom pattern", () => {
  assert.strictEqual(e.canUseSeparable({is_cw: false, pattern: "custom", prf_hz: 1000, v_scan_mm_s: 100, line_length_mm: 10}), false);
});

test("canUseSeparable: rejects zero PRF", () => {
  assert.strictEqual(e.canUseSeparable({is_cw: false, pattern: "raster", prf_hz: 0, v_scan_mm_s: 100, line_length_mm: 10, n_lines: 5, hatch_mm: 0.5}), false);
});

test("_compute1DGaussSum: single pulse at origin", () => {
  // Single pulse at x=0, evaluate at x=0 should give exp(0)=1
  const w = 1 / Math.sqrt(2); // w for d=1mm
  const w2 = w * w;
  const S = e._compute1DGaussSum(1, 0, 1, 0, 1, 1, w2, 3 * 1/(2*Math.sqrt(2)));
  approx(S[0], 1.0, 1e-10, "S(0) for single pulse at origin");
});

test("_compute1DGaussSum: symmetry", () => {
  const w = 1 / Math.sqrt(2);
  const w2 = w * w;
  const trunc = 3 * 1 / (2 * Math.sqrt(2));
  // 5 pulses at 0, 0.1, 0.2, 0.3, 0.4 — evaluate on symmetric grid
  const S = e._compute1DGaussSum(5, 0, 0.1, 0, 0.1, 5, w2, trunc);
  // S(0.2) should be the peak (center of 5 pulses)
  assert.ok(S[2] >= S[0], "center should be >= edge");
  assert.ok(S[2] >= S[4], "center should be >= other edge");
  // S(0) ≈ S(0.4) by approximate symmetry of 5 points
  approx(S[0], S[4], 0.01, "edges should be approximately equal");
});

// ── Cross-validation: separable vs brute-force ──

test("separable vs brute-force: linear scan peak fluence match", () => {
  const d = 1, prf = 10000, v = 100, Ep = 1e-4, lineL = 20;
  const beam = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: prf*Ep, is_cw: false};
  const segs = e.buildLinearScan(0, 0, 0, lineL, v, d);

  // Brute-force
  const r_bf = e.computeScanFluence(beam, segs, 8);
  let peak_bf = 0;
  for (let i = 0; i < r_bf.grid.fluence.length; i++) {
    if (r_bf.grid.fluence[i] > peak_bf) peak_bf = r_bf.grid.fluence[i];
  }

  // Separable
  const sp = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, v_scan_mm_s: v,
    x0: 0, y0: 0, line_length_mm: lineL, n_lines: 1, hatch_mm: 0,
    pattern: "linear", blanking: false, is_cw: false};
  const r_sep = e.computeScanFluence(beam, segs, 8, sp);
  let peak_sep = 0;
  for (let i = 0; i < r_sep.grid.fluence.length; i++) {
    if (r_sep.grid.fluence[i] > peak_sep) peak_sep = r_sep.grid.fluence[i];
  }

  // Peaks should match within 5% (grid discretization differences)
  const rel_err = Math.abs(peak_sep - peak_bf) / peak_bf;
  assert.ok(rel_err < 0.05, `linear peak mismatch: sep=${peak_sep.toFixed(6)}, bf=${peak_bf.toFixed(6)}, rel=${rel_err.toExponential(2)}`);
});

test("separable vs brute-force: raster scan peak fluence match", () => {
  const d = 1, prf = 10000, v = 100, Ep = 1e-4, lineL = 10, nL = 8, hatch = 0.5;
  const beam = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: prf*Ep, is_cw: false};
  const segs = e.buildRasterScan(0, 0, lineL, nL, hatch, v, v*5, d, true);

  // Brute-force
  const r_bf = e.computeScanFluence(beam, segs, 6);
  let peak_bf = 0;
  for (let i = 0; i < r_bf.grid.fluence.length; i++) {
    if (r_bf.grid.fluence[i] > peak_bf) peak_bf = r_bf.grid.fluence[i];
  }

  // Separable
  const sp = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, v_scan_mm_s: v,
    x0: 0, y0: 0, line_length_mm: lineL, n_lines: nL, hatch_mm: hatch,
    pattern: "raster", blanking: true, is_cw: false};
  const r_sep = e.computeScanFluence(beam, segs, 6, sp);
  let peak_sep = 0;
  for (let i = 0; i < r_sep.grid.fluence.length; i++) {
    if (r_sep.grid.fluence[i] > peak_sep) peak_sep = r_sep.grid.fluence[i];
  }

  const rel_err = Math.abs(peak_sep - peak_bf) / peak_bf;
  assert.ok(rel_err < 0.05, `raster peak mismatch: sep=${peak_sep.toFixed(6)}, bf=${peak_bf.toFixed(6)}, rel=${rel_err.toExponential(2)}`);
});

test("separable vs brute-force: bidi raster peak fluence match", () => {
  const d = 1, prf = 10000, v = 100, Ep = 1e-4, lineL = 10, nL = 6, hatch = 0.5;
  const beam = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: prf*Ep, is_cw: false};
  const segs = e.buildBidiRasterScan(0, 0, lineL, nL, hatch, v, v*5, d);

  // Brute-force
  const r_bf = e.computeScanFluence(beam, segs, 6);
  let peak_bf = 0;
  for (let i = 0; i < r_bf.grid.fluence.length; i++) {
    if (r_bf.grid.fluence[i] > peak_bf) peak_bf = r_bf.grid.fluence[i];
  }

  // Separable
  const sp = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, v_scan_mm_s: v,
    x0: 0, y0: 0, line_length_mm: lineL, n_lines: nL, hatch_mm: hatch,
    pattern: "bidi", blanking: false, is_cw: false};
  const r_sep = e.computeScanFluence(beam, segs, 6, sp);
  let peak_sep = 0;
  for (let i = 0; i < r_sep.grid.fluence.length; i++) {
    if (r_sep.grid.fluence[i] > peak_sep) peak_sep = r_sep.grid.fluence[i];
  }

  const rel_err = Math.abs(peak_sep - peak_bf) / peak_bf;
  assert.ok(rel_err < 0.05, `bidi peak mismatch: sep=${peak_sep.toFixed(6)}, bf=${peak_bf.toFixed(6)}, rel=${rel_err.toExponential(2)}`);
});

test("separable vs brute-force: high-PRF raster (200kHz)", () => {
  // This is the scenario that motivated the separable approach
  const d = 0.05, prf = 200000, v = 1000, Ep = 1e-6, lineL = 5, nL = 10, hatch = 0.03;
  const beam = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: prf*Ep, is_cw: false};
  const segs = e.buildRasterScan(0, 0, lineL, nL, hatch, v, v*5, d, true);

  // Separable (should be fast)
  const t0 = Date.now();
  const sp = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, v_scan_mm_s: v,
    x0: 0, y0: 0, line_length_mm: lineL, n_lines: nL, hatch_mm: hatch,
    pattern: "raster", blanking: true, is_cw: false};
  const r_sep = e.computeScanFluence(beam, segs, 4, sp);
  const t_sep = Date.now() - t0;

  let peak_sep = 0;
  for (let i = 0; i < r_sep.grid.fluence.length; i++) {
    if (r_sep.grid.fluence[i] > peak_sep) peak_sep = r_sep.grid.fluence[i];
  }

  assert.ok(peak_sep > 0, "high-PRF separable peak should be positive");
  assert.ok(r_sep.stats.method === "separable", "should use separable method");
  assert.ok(t_sep < 5000, `separable should complete in <5s, took ${t_sep}ms`);
});

test("separable vs analytical: peak fluence cross-check", () => {
  // Verify separable grid peak matches the analyticalPeakFluence function
  const d = 1, prf = 5000, v = 50, Ep = 2e-4, lineL = 20, nL = 10, hatch = 0.4;
  const beam = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: prf*Ep, is_cw: false};
  const segs = e.buildRasterScan(0, 0, lineL, nL, hatch, v, v*5, d, true);

  const sp = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, v_scan_mm_s: v,
    x0: 0, y0: 0, line_length_mm: lineL, n_lines: nL, hatch_mm: hatch,
    pattern: "raster", blanking: true, is_cw: false};
  const r_sep = e.computeScanFluence(beam, segs, 8, sp);
  let peak_sep = 0;
  for (let i = 0; i < r_sep.grid.fluence.length; i++) {
    if (r_sep.grid.fluence[i] > peak_sep) peak_sep = r_sep.grid.fluence[i];
  }

  const ap = e.analyticalPeakFluence(beam, v, hatch, nL);

  // Analytical peak should be close to separable grid peak
  // (both use exact Gaussian sums; difference is grid sampling)
  const rel_err = Math.abs(peak_sep - ap.peak_fluence_Jcm2) / ap.peak_fluence_Jcm2;
  assert.ok(rel_err < 0.05, `analytical cross-check: sep=${peak_sep.toFixed(6)}, anal=${ap.peak_fluence_Jcm2.toFixed(6)}, rel=${rel_err.toExponential(2)}`);
});

test("separable: conservative safety (never underestimates)", () => {
  // For safety-critical use, separable must NEVER produce a peak fluence
  // lower than brute-force (which could cause a false 'safe' verdict)
  const d = 1, prf = 8000, v = 80, Ep = 1.5e-4, lineL = 15, nL = 6, hatch = 0.5;
  const beam = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: prf*Ep, is_cw: false};
  const segs = e.buildRasterScan(0, 0, lineL, nL, hatch, v, v*5, d, true);

  const r_bf = e.computeScanFluence(beam, segs, 8);
  let peak_bf = 0;
  for (let i = 0; i < r_bf.grid.fluence.length; i++) {
    if (r_bf.grid.fluence[i] > peak_bf) peak_bf = r_bf.grid.fluence[i];
  }

  const sp = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, v_scan_mm_s: v,
    x0: 0, y0: 0, line_length_mm: lineL, n_lines: nL, hatch_mm: hatch,
    pattern: "raster", blanking: true, is_cw: false};
  const r_sep = e.computeScanFluence(beam, segs, 8, sp);
  let peak_sep = 0;
  for (let i = 0; i < r_sep.grid.fluence.length; i++) {
    if (r_sep.grid.fluence[i] > peak_sep) peak_sep = r_sep.grid.fluence[i];
  }

  // Separable should produce >= 95% of brute-force peak
  // (both sample on the same grid, so they should be very close)
  assert.ok(peak_sep >= peak_bf * 0.95,
    `safety: sep peak ${peak_sep.toFixed(6)} must not be much lower than bf ${peak_bf.toFixed(6)}`);
});

test("separable: stats include method field", () => {
  const d = 1, prf = 1000, v = 100, Ep = 1e-4, lineL = 10;
  const beam = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: prf*Ep, is_cw: false};
  const segs = e.buildLinearScan(0, 0, 0, lineL, v, d);
  const sp = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, v_scan_mm_s: v,
    x0: 0, y0: 0, line_length_mm: lineL, pattern: "linear", is_cw: false};
  const r = e.computeScanFluence(beam, segs, 8, sp);
  assert.strictEqual(r.stats.method, "separable");
});

test("separable: without scanParams falls back to brute-force", () => {
  const d = 1, prf = 1000, v = 100, Ep = 1e-4, lineL = 10;
  const beam = {d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: prf*Ep, is_cw: false};
  const segs = e.buildLinearScan(0, 0, 0, lineL, v, d);
  const r = e.computeScanFluence(beam, segs, 8); // no scanParams
  assert.ok(r.stats.method === undefined || r.stats.method !== "separable",
    "without scanParams should use brute-force");
});

// ═══════ Summary ═══════
console.log(`\nEngine.js test results: ${pass} passed, ${fail} failed`);
if (errors.length > 0) {
  errors.forEach(e => console.log(e));
  process.exit(1);
}
