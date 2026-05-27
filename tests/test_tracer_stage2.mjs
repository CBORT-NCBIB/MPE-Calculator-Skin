#!/usr/bin/env node
/**
 * tests/test_tracer_stage2.mjs — Stage 2 tracer tests for scanning and PA pipelines.
 *
 * Tests:
 *   S1.  computeScanFluence separable path produces scan_path_dispatch trace
 *   S2.  computeScanFluence legacy pulsed path produces scan_path_dispatch trace
 *   S3.  computeScanFluence legacy CW path produces scan_path_dispatch trace
 *   S4.  evaluateScanSafety pulsed produces full trace (grid_summary, rule1, rule2, verdict)
 *   S5.  evaluateScanSafety CW produces trace with dwell-based Rule 1
 *   S6.  evaluateScanSafety Rule 2 sub-trace contains full skinMPE derivation
 *   S7.  evaluateScanSafety without trace returns identical result
 *   S8.  paEffFluence produces pa_eff_fluence trace with sub-steps
 *   S9.  paRelSNR produces pa_rel_snr trace
 *   S10. paOptimalPRF produces pa_optimal_prf trace
 *   S11. PA functions without trace return identical results
 *   S12. All Stage 2 traces validate against schema
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const e = require(resolve(repoRoot, "web/engine.js"));
const Ajv2020 = require(resolve(repoRoot, "web/node_modules/ajv/dist/2020.js")).default;
const schema = JSON.parse(readFileSync(resolve(repoRoot, "web/trace/schema.json"), "utf-8"));
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);
const std = JSON.parse(readFileSync(resolve(repoRoot, "web/standards/icnirp_2013.json"), "utf-8"));

var passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.log("  FAIL: " + msg); }
}
function test(name, fn) {
  try { fn(); }
  catch (err) { failed++; console.log("  FAIL: " + name + " threw: " + err.message); }
}
function findStep(steps, type) {
  for (var s of steps) {
    if (s.step_type === type) return s;
    if (s.sub_steps) { var f = findStep(s.sub_steps, type); if (f) return f; }
  }
  return null;
}
function validateTrace(doc, label) {
  var valid = validate(doc);
  if (!valid) {
    console.log("  Schema errors for " + label + ":");
    for (var err of validate.errors.slice(0, 3))
      console.log("    " + err.instancePath + ": " + err.message);
  }
  return valid;
}

// Common beam/scan setup
var wl = 1064, d = 0.025, prf = 200000, tau = 1e-8;
var Ep = 5e-7, P = Ep * prf;

// ─── S1: Separable path dispatch ────────────────────────────────
test("S1: computeScanFluence separable produces scan_path_dispatch", function() {
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 4000, x0: 0, y0: 0, line_length_mm: 10,
    n_lines: 10, hatch_mm: 0.1, pattern: "raster", blanking: true,
    is_cw: false, v_jump_mm_s: 20000
  };
  var trace = e.createTracer(std);
  var cr = e.computeScanFluence(
    {d_1e_mm: d, wl_nm: wl, tau_s: tau, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P, is_cw: false},
    [], 4, sp, trace);
  assert(cr !== null, "computeScanFluence returned result");
  var step = findStep(trace.getSteps(), "scan_path_dispatch");
  assert(step !== null, "Has scan_path_dispatch step");
  assert(step.decision.chosen === "separable", "Path is separable: " + step.decision.chosen);
  console.log("  S1: path=" + step.decision.chosen);
});

// ─── S2: Legacy pulsed path dispatch ────────────────────────────
test("S2: computeScanFluence legacy pulsed produces scan_path_dispatch", function() {
  var segs = e.buildLinearScan(0, 0, 0, 5, 4000, d);
  var trace = e.createTracer(std);
  var cr = e.computeScanFluence(
    {d_1e_mm: d, wl_nm: wl, tau_s: tau, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P, is_cw: false},
    segs, 4, null, trace);
  assert(cr !== null, "computeScanFluence returned result");
  var step = findStep(trace.getSteps(), "scan_path_dispatch");
  assert(step !== null, "Has scan_path_dispatch step");
  assert(step.decision.chosen === "legacy-pulsed", "Path is legacy-pulsed: " + step.decision.chosen);
  console.log("  S2: path=" + step.decision.chosen + " segs=" + segs.length);
});

// ─── S3: Legacy CW path dispatch ───────────────────────────────
test("S3: computeScanFluence legacy CW produces scan_path_dispatch", function() {
  var segs = e.buildLinearScan(0, 0, 0, 5, 4000, d);
  var trace = e.createTracer(std);
  var cr = e.computeScanFluence(
    {d_1e_mm: d, wl_nm: wl, tau_s: 0, prf_hz: 0, pulse_energy_J: 0, avg_power_W: P, is_cw: true},
    segs, 4, null, trace);
  assert(cr !== null, "computeScanFluence returned result");
  var step = findStep(trace.getSteps(), "scan_path_dispatch");
  assert(step !== null, "Has scan_path_dispatch step");
  assert(step.decision.chosen === "legacy-cw", "Path is legacy-cw: " + step.decision.chosen);
  console.log("  S3: path=" + step.decision.chosen);
});

// ─── S4: evaluateScanSafety pulsed full trace ──────────────────
test("S4: evaluateScanSafety pulsed produces full trace", function() {
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 4000, x0: 0, y0: 0, line_length_mm: 10,
    n_lines: 10, hatch_mm: 0.1, pattern: "raster", blanking: true,
    is_cw: false, v_jump_mm_s: 20000
  };
  var grid = e.createFluenceGridFromParams(sp, 4);
  e.computeScanFluenceSeparable(grid, sp);
  var Tt = 10 * (10/4000) + 9 * (10/20000 + 0.1/20000);

  var trace = e.createTracer(std);
  var sf = e.evaluateScanSafety(grid,
    {wl_nm: wl, d_1e_mm: d, tau_s: tau, is_cw: false, pulse_energy_J: Ep, prf_hz: prf, avg_power_W: P},
    Tt, "gaussian", 0, {v_mm_s: 4000, line_spacing_mm: 0.1, n_lines: 10}, trace);

  var doc = trace.finalize(
    {wl_nm: wl, pipeline: "scanSafety"},
    {safe: sf.safe, binding_rule: sf.binding_rule});

  assert(validateTrace(doc, "S4"), "Trace validates");
  assert(findStep(doc.steps, "scan_grid_summary") !== null, "Has grid_summary");
  assert(findStep(doc.steps, "scan_rule1_eval") !== null, "Has rule1_eval");
  assert(findStep(doc.steps, "scan_rule2_eval") !== null, "Has rule2_eval");
  assert(findStep(doc.steps, "scan_verdict") !== null, "Has verdict");

  var verdict = findStep(doc.steps, "scan_verdict");
  assert(verdict.decision.chosen === (sf.safe ? "SAFE" : "UNSAFE"),
    "Verdict matches: " + verdict.decision.chosen);

  // Rule 2 should have skinMPE sub-steps
  var r2 = findStep(doc.steps, "scan_rule2_eval");
  assert(r2.sub_steps && r2.sub_steps.length > 0, "Rule 2 has skinMPE sub-steps");
  assert(findStep(r2.sub_steps, "band_match") !== null, "Rule 2 sub-trace has band_match");

  console.log("  S4: safe=" + sf.safe + " binding=" + sf.binding_rule +
    " R1=" + sf.rule1_max_ratio.toFixed(4) + " R2=" + sf.rule2_max_ratio.toFixed(4));
});

// ─── S5: evaluateScanSafety CW with dwell ──────────────────────
test("S5: evaluateScanSafety CW produces dwell-based Rule 1 trace", function() {
  var sp = {
    d_1e_mm: d, prf_hz: 0, pulse_energy_J: 0, avg_power_W: P,
    v_scan_mm_s: 4000, x0: 0, y0: 0, line_length_mm: 10,
    n_lines: 10, hatch_mm: 0.1, pattern: "raster", blanking: true,
    is_cw: true, v_jump_mm_s: 20000
  };
  var grid = e.createFluenceGridFromParams(sp, 4);
  e.computeScanFluenceSeparable(grid, sp);
  var Tt = 0.03;

  var trace = e.createTracer(std);
  var sf = e.evaluateScanSafety(grid,
    {wl_nm: wl, d_1e_mm: d, tau_s: 0, is_cw: true, avg_power_W: P},
    Tt, "gaussian", 4000, {v_mm_s: 4000, line_spacing_mm: 0.1, n_lines: 10}, trace);

  var r1 = findStep(trace.getSteps(), "scan_rule1_eval");
  assert(r1 !== null, "Has rule1_eval");
  assert(r1.inputs.is_cw === true, "Rule 1 records CW mode");
  assert(r1.inputs.dwell_mode === "gaussian", "Rule 1 records dwell mode");
  assert(r1.inputs.t_dwell_s > 0, "Rule 1 has dwell time: " + r1.inputs.t_dwell_s);
  // Should have skinMPE sub-steps
  assert(r1.sub_steps && r1.sub_steps.length > 0, "Rule 1 CW has skinMPE sub-steps");
  console.log("  S5: CW Rule 1 dwell=" + r1.inputs.t_dwell_s.toExponential(3) + "s");
});

// ─── S6: Rule 2 sub-trace has full derivation ──────────────────
test("S6: Rule 2 sub-trace contains band_match + region_match + formula_eval", function() {
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 4000, x0: 0, y0: 0, line_length_mm: 5,
    n_lines: 5, hatch_mm: 0.1, pattern: "raster", blanking: true,
    is_cw: false, v_jump_mm_s: 20000
  };
  var grid = e.createFluenceGridFromParams(sp, 4);
  e.computeScanFluenceSeparable(grid, sp);

  var trace = e.createTracer(std);
  e.evaluateScanSafety(grid,
    {wl_nm: wl, d_1e_mm: d, tau_s: tau, is_cw: false, pulse_energy_J: Ep, prf_hz: prf, avg_power_W: P},
    0.01, "gaussian", 0, {v_mm_s: 4000, line_spacing_mm: 0.1, n_lines: 5}, trace);

  var r2 = findStep(trace.getSteps(), "scan_rule2_eval");
  assert(r2 !== null, "Has rule2_eval");
  assert(r2.sub_steps && findStep(r2.sub_steps, "band_match") !== null, "R2 has band_match");
  assert(r2.sub_steps && findStep(r2.sub_steps, "region_match") !== null, "R2 has region_match");
  assert(r2.sub_steps && findStep(r2.sub_steps, "formula_eval") !== null, "R2 has formula_eval");
  console.log("  S6: Rule 2 sub-trace has " + r2.sub_steps.length + " steps");
});

// ─── S7: evaluateScanSafety without trace = identical result ───
test("S7: evaluateScanSafety returns identical result with/without trace", function() {
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 4000, x0: 0, y0: 0, line_length_mm: 10,
    n_lines: 10, hatch_mm: 0.1, pattern: "raster", blanking: true,
    is_cw: false, v_jump_mm_s: 20000
  };
  var grid = e.createFluenceGridFromParams(sp, 4);
  e.computeScanFluenceSeparable(grid, sp);
  var beam = {wl_nm: wl, d_1e_mm: d, tau_s: tau, is_cw: false, pulse_energy_J: Ep, prf_hz: prf, avg_power_W: P};
  var scanP = {v_mm_s: 4000, line_spacing_mm: 0.1, n_lines: 10};
  var Tt = 0.03;

  var sfNo = e.evaluateScanSafety(grid, beam, Tt, "gaussian", 0, scanP);
  var trace = e.createTracer(std);
  var sfYes = e.evaluateScanSafety(grid, beam, Tt, "gaussian", 0, scanP, trace);

  assert(sfNo.safe === sfYes.safe, "safe identical");
  assert(sfNo.rule1_max_ratio === sfYes.rule1_max_ratio, "R1 identical");
  assert(sfNo.rule2_max_ratio === sfYes.rule2_max_ratio, "R2 identical");
  assert(sfNo.worst_x_mm === sfYes.worst_x_mm, "worst_x identical");
  assert(sfNo.worst_y_mm === sfYes.worst_y_mm, "worst_y identical");
  assert(sfNo.T_point_worst_s === sfYes.T_point_worst_s, "T_point identical");
  console.log("  S7: All fields identical");
});

// ─── S8: paEffFluence trace ────────────────────────────────────
test("S8: paEffFluence produces pa_eff_fluence trace with sub-steps", function() {
  var trace = e.createTracer(std);
  var result = e.paEffFluence(1064, 1e-8, 10000, 1, trace);
  var doc = trace.finalize({pipeline: "paEffFluence"}, {phi_eff: result});

  assert(validateTrace(doc, "S8"), "Trace validates");
  var step = findStep(doc.steps, "pa_eff_fluence");
  assert(step !== null, "Has pa_eff_fluence step");
  assert(step.sub_steps && step.sub_steps.length > 0, "Has skinMPE sub-steps");
  assert(findStep(step.sub_steps, "band_match") !== null, "Sub-trace has band_match");
  assert(Math.abs(step.output.value - result) < 1e-12, "Output matches result");
  console.log("  S8: phi_eff=" + result.toExponential(4) + " binding=" + step.decision.chosen);
});

// ─── S9: paRelSNR trace ────────────────────────────────────────
test("S9: paRelSNR produces pa_rel_snr trace", function() {
  var trace = e.createTracer(std);
  var result = e.paRelSNR(1064, 1e-8, 10000, 1, trace);
  var doc = trace.finalize({pipeline: "paRelSNR"}, {snr: result});

  assert(validateTrace(doc, "S9"), "Trace validates");
  var step = findStep(doc.steps, "pa_rel_snr");
  assert(step !== null, "Has pa_rel_snr step");
  assert(Math.abs(step.output.value - result) < 1e-10, "Output matches");
  console.log("  S9: SNR=" + result.toFixed(4));
});

// ─── S10: paOptimalPRF trace ───────────────────────────────────
test("S10: paOptimalPRF produces pa_optimal_prf trace", function() {
  var trace = e.createTracer(std);
  var result = e.paOptimalPRF(1064, 1e-8, 1, trace);
  var doc = trace.finalize({pipeline: "paOptimalPRF"}, {prf_hz: result});

  assert(validateTrace(doc, "S10"), "Trace validates");
  var step = findStep(doc.steps, "pa_optimal_prf");
  assert(step !== null, "Has pa_optimal_prf step");
  assert(step.sub_steps && step.sub_steps.length > 0, "Has skinMPE sub-steps");
  assert(Math.abs(step.output.value - result) < 1, "Output matches");
  console.log("  S10: optimal_prf=" + result.toFixed(0) + " Hz");
});

// ─── S11: PA functions without trace = identical ───────────────
test("S11: PA functions return identical results with/without trace", function() {
  var cases = [
    [1064, 1e-8, 10000, 1],
    [532, 1e-9, 100000, 0.5],
    [800, 1e-7, 50000, 2],
  ];
  for (var c of cases) {
    var ef1 = e.paEffFluence(c[0], c[1], c[2], c[3]);
    var t1 = e.createTracer(std);
    var ef2 = e.paEffFluence(c[0], c[1], c[2], c[3], t1);
    assert(ef1 === ef2 || (isNaN(ef1) && isNaN(ef2)),
      "paEffFluence(" + c.join(",") + "): " + ef1 + " vs " + ef2);

    var snr1 = e.paRelSNR(c[0], c[1], c[2], c[3]);
    var t2 = e.createTracer(std);
    var snr2 = e.paRelSNR(c[0], c[1], c[2], c[3], t2);
    assert(snr1 === snr2 || (isNaN(snr1) && isNaN(snr2)),
      "paRelSNR: " + snr1 + " vs " + snr2);

    var opt1 = e.paOptimalPRF(c[0], c[1], c[3]);
    var t3 = e.createTracer(std);
    var opt2 = e.paOptimalPRF(c[0], c[1], c[3], t3);
    assert(opt1 === opt2 || (isNaN(opt1) && isNaN(opt2)),
      "paOptimalPRF: " + opt1 + " vs " + opt2);
  }
  console.log("  S11: " + cases.length + " PA parameter sets verified identical");
});

// ─── S12: All traces validate ──────────────────────────────────
test("S12: All Stage 2 traces validate against schema", function() {
  var traces = [];

  // Scanning trace
  var sp = {
    d_1e_mm: d, prf_hz: prf, pulse_energy_J: Ep, avg_power_W: P,
    v_scan_mm_s: 4000, x0: 0, y0: 0, line_length_mm: 5,
    n_lines: 5, hatch_mm: 0.1, pattern: "raster", blanking: true,
    is_cw: false, v_jump_mm_s: 20000
  };
  var grid = e.createFluenceGridFromParams(sp, 4);
  e.computeScanFluenceSeparable(grid, sp);
  var st = e.createTracer(std);
  e.evaluateScanSafety(grid,
    {wl_nm: wl, d_1e_mm: d, tau_s: tau, is_cw: false, pulse_energy_J: Ep, prf_hz: prf, avg_power_W: P},
    0.01, "gaussian", 0, {v_mm_s: 4000, line_spacing_mm: 0.1, n_lines: 5}, st);
  traces.push(st.finalize({pipeline: "scanSafety"}, {safe: true}));

  // PA traces
  var pt1 = e.createTracer(std);
  e.paEffFluence(1064, 1e-8, 10000, 1, pt1);
  traces.push(pt1.finalize({pipeline: "paEffFluence"}, {result: 0}));

  var pt2 = e.createTracer(std);
  e.paRelSNR(1064, 1e-8, 10000, 1, pt2);
  traces.push(pt2.finalize({pipeline: "paRelSNR"}, {result: 0}));

  var pt3 = e.createTracer(std);
  e.paOptimalPRF(1064, 1e-8, 1, pt3);
  traces.push(pt3.finalize({pipeline: "paOptimalPRF"}, {result: 0}));

  var allValid = true;
  for (var i = 0; i < traces.length; i++) {
    if (!validate(traces[i])) {
      allValid = false;
      console.log("  Trace " + i + " failed:");
      for (var err of validate.errors.slice(0, 3))
        console.log("    " + err.instancePath + ": " + err.message);
    }
  }
  assert(allValid, "All " + traces.length + " traces validate");
  console.log("  S12: " + traces.length + " traces validated");
});

console.log("\nStage 2 tracer tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
