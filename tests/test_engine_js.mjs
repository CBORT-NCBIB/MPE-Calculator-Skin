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

// ═══════ Summary ═══════
console.log(`\nEngine.js test results: ${pass} passed, ${fail} failed`);
if (errors.length > 0) {
  errors.forEach(e => console.log(e));
  process.exit(1);
}
