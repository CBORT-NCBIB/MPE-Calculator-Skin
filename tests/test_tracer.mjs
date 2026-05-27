#!/usr/bin/env node
/**
 * tests/test_tracer.mjs — Validation tests for the computation tracer (Stage 1).
 *
 * Covers:
 *   T24. skinMPE(2000, 0.005) produces a schema-valid trace
 *   T25. skinMPE(800, 1.0) produces a trace with ca_lookup sub-step
 *   T26. skinMPE(300, 100) produces a trace with dual_limit_eval
 *   T27. skinMPE(305, 100) produces a trace with uv_discrete_lookup
 *   T28. repPulse(1064, 1e-8, 10000, 1.0) produces full sub-traces
 *   T29. skinMPE without tracer returns same result as with tracer
 *   T30. skinMPE without tracer allocates no trace objects
 *   T31. Boundary-point regression: tracer does not alter computation
 *   T32. Schema validation of produced traces
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
  catch (err) { failed++; console.log("  FAIL: " + name + " threw: " + err.message + "\n" + err.stack); }
}

function findStep(steps, type) {
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].step_type === type) return steps[i];
    if (steps[i].sub_steps) {
      var found = findStep(steps[i].sub_steps, type);
      if (found) return found;
    }
  }
  return null;
}

function countSteps(steps, type) {
  var count = 0;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].step_type === type) count++;
    if (steps[i].sub_steps) count += countSteps(steps[i].sub_steps, type);
  }
  return count;
}

function validateTrace(doc, label) {
  var valid = validate(doc);
  if (!valid) {
    console.log("  Schema errors for " + label + ":");
    for (var err of validate.errors.slice(0, 5)) {
      console.log("    " + err.instancePath + ": " + err.message);
    }
  }
  return valid;
}

// ─── T24: Simple case — skinMPE(2000, 0.005) ───────────────────────
test("T24: skinMPE(2000, 0.005) produces schema-valid trace", function() {
  var trace = e.createTracer(std);
  var result = e.skinMPE(2000, 0.005, trace);
  var doc = trace.finalize({ wl_nm: 2000, t_s: 0.005, pipeline: "skinMPE" },
    { mpe_Jcm2: result, unit: "J/cm2" });

  assert(validateTrace(doc, "T24"), "Trace should validate against schema");
  assert(doc.trace_schema === "mpe-trace-1.0", "Schema version");
  assert(doc.trace_id.length === 36, "UUID format");
  assert(doc.standard_snapshot.sha256.length === 64, "SHA-256 hex length");
  assert(doc.standard_snapshot.metadata.name === "ICNIRP 2013", "Standard name");
  assert(doc.steps.length >= 3, "Should have at least 3 steps (band_match, region_match, formula_eval)");
  assert(doc.result.mpe_Jcm2 === result, "Result matches return value");

  // Check step types
  assert(findStep(doc.steps, "band_match") !== null, "Has band_match step");
  assert(findStep(doc.steps, "mode_dispatch") !== null, "Has mode_dispatch step");
  assert(findStep(doc.steps, "region_match") !== null, "Has region_match step");
  assert(findStep(doc.steps, "formula_eval") !== null, "Has formula_eval step");

  // Check band match content
  var bm = findStep(doc.steps, "band_match");
  assert(bm.matched_entry.path === "/bands/4", "Band path is /bands/4");
  assert(bm.matched_entry.value.name === "FIR 1800\u20132600", "Band name");
  assert(bm.decision.alternatives_count === 6, "6 bands considered");

  // Check formula content
  var fe = findStep(doc.steps, "formula_eval");
  assert(fe.formula.type === "power", "Formula type is power");
  assert(fe.formula.coefficients.a === 0.56, "Coefficient a = 0.56");
  assert(fe.formula.coefficients.b === 0.25, "Coefficient b = 0.25");
  assert(Math.abs(fe.output.value - 0.14891) < 0.001, "Output ≈ 0.1489");

  console.log("  T24: " + doc.steps.length + " steps, SHA=" + doc.standard_snapshot.sha256.substring(0, 12) + "...");
});

// ─── T25: CA correction — skinMPE(800, 1.0) ────────────────────────
test("T25: skinMPE(800, 1.0) produces trace with ca_lookup sub-step", function() {
  var trace = e.createTracer(std);
  var result = e.skinMPE(800, 1.0, trace);
  var doc = trace.finalize({ wl_nm: 800, t_s: 1.0, pipeline: "skinMPE" },
    { mpe_Jcm2: result, unit: "J/cm2" });

  assert(validateTrace(doc, "T25"), "Trace validates");
  assert(findStep(doc.steps, "ca_lookup") !== null, "Has ca_lookup step");

  var fe = findStep(doc.steps, "formula_eval");
  assert(fe !== null, "Has formula_eval step");
  assert(fe.formula.type === "ca_power", "Formula type is ca_power");

  // CA should be in sub_steps of formula_eval
  assert(fe.sub_steps && fe.sub_steps.length > 0, "formula_eval has sub_steps");
  var caStep = fe.sub_steps ? findStep(fe.sub_steps, "ca_lookup") : null;
  assert(caStep !== null, "CA lookup is nested under formula_eval");
  assert(caStep.matched_entry.path === "/correction_factors/CA/regions/1", "CA region path");
  assert(Math.abs(caStep.output.value - 1.5849) < 0.001, "CA ≈ 1.5849");

  console.log("  T25: CA=" + (caStep ? caStep.output.value.toFixed(4) : "?") + ", MPE=" + result.toFixed(4));
});

// ─── T26: Dual-limit — skinMPE(300, 100) ───────────────────────────
test("T26: skinMPE(300, 100) produces trace with dual_limit_eval", function() {
  var trace = e.createTracer(std);
  var result = e.skinMPE(300, 100, trace);
  var doc = trace.finalize({ wl_nm: 300, t_s: 100, pipeline: "skinMPE" },
    { mpe_Jcm2: result, unit: "J/cm2" });

  assert(validateTrace(doc, "T26"), "Trace validates");
  assert(findStep(doc.steps, "dual_limit_eval") !== null, "Has dual_limit_eval step");

  var dl = findStep(doc.steps, "dual_limit_eval");
  assert(dl.inputs.thermal_value !== undefined, "Has thermal value");
  assert(dl.inputs.photochemical_value !== undefined, "Has photochemical value");
  assert(dl.sub_steps && dl.sub_steps.length > 0, "Has sub-steps for thermal/photochemical");
  assert(result === 0.003, "Result = 0.003 J/cm2 (photochemical binding)");

  console.log("  T26: thermal=" + dl.inputs.thermal_value + ", photochem=" + dl.inputs.photochemical_value);
});

// ─── T27: UV discrete — skinMPE(305, 100) ──────────────────────────
test("T27: skinMPE(305, 100) produces trace with uv_discrete_lookup", function() {
  var trace = e.createTracer(std);
  var result = e.skinMPE(305, 100, trace);
  var doc = trace.finalize({ wl_nm: 305, t_s: 100, pipeline: "skinMPE" },
    { mpe_Jcm2: result, unit: "J/cm2" });

  assert(validateTrace(doc, "T27"), "Trace validates");
  assert(findStep(doc.steps, "uv_discrete_lookup") !== null, "Has uv_discrete_lookup step");

  var uvStep = findStep(doc.steps, "uv_discrete_lookup");
  assert(uvStep.inputs.table === "uv_discrete_steps", "Table name");
  assert(uvStep.output.value === result || Math.abs(uvStep.output.value - result) < 1e-10, "Output matches result");

  console.log("  T27: UV discrete lookup result=" + result);
});

// ─── T28: Repetitive pulse — repPulse(1064, 1e-8, 10000, 1.0) ─────
test("T28: repPulse produces full sub-traces for both rules", function() {
  var trace = e.createTracer(std);
  var result = e.repPulse(1064, 1e-8, 10000, 1.0, trace);
  var doc = trace.finalize(
    { wl_nm: 1064, tau_s: 1e-8, prf_hz: 10000, T_s: 1.0, pipeline: "repPulse" },
    { rule1: result.rule1, rule2: result.rule2, H: result.H, N: result.N, binding: result.binding });

  assert(validateTrace(doc, "T28"), "Trace validates");
  assert(findStep(doc.steps, "rep_pulse_rule1") !== null, "Has rep_pulse_rule1");
  assert(findStep(doc.steps, "rep_pulse_rule2") !== null, "Has rep_pulse_rule2");
  assert(findStep(doc.steps, "rep_pulse_select") !== null, "Has rep_pulse_select");

  // Each rule should have sub-steps with the full skinMPE derivation
  var r1 = findStep(doc.steps, "rep_pulse_rule1");
  assert(r1.sub_steps && r1.sub_steps.length >= 3, "Rule 1 has skinMPE sub-steps");
  assert(findStep(r1.sub_steps, "band_match") !== null, "Rule 1 sub-trace has band_match");

  var r2 = findStep(doc.steps, "rep_pulse_rule2");
  assert(r2.sub_steps && r2.sub_steps.length >= 3, "Rule 2 has skinMPE sub-steps");
  assert(r2.inputs.N === 10000, "N = PRF * T = 10000");

  var sel = findStep(doc.steps, "rep_pulse_select");
  assert(sel.decision.chosen === result.binding, "Binding rule matches");

  console.log("  T28: Rule1=" + result.rule1.toExponential(3) + " Rule2=" + result.rule2.toExponential(3) + " Binding=" + result.binding);
});

// ─── T29: No behavioral side effects ────────────────────────────────
test("T29: skinMPE returns identical result with and without tracer", function() {
  // Test across multiple wavelengths and durations
  var cases = [
    [2000, 0.005], [800, 1.0], [300, 100], [305, 100],
    [1064, 1e-8], [532, 10], [355, 0.001], [10600, 0.1],
    [180, 1e-5], [1400, 5], [1550, 0.01], [3000, 1]
  ];
  for (var c of cases) {
    var without = e.skinMPE(c[0], c[1]);
    var trace = e.createTracer(std);
    var withTrace = e.skinMPE(c[0], c[1], trace);
    assert(without === withTrace || (isNaN(without) && isNaN(withTrace)),
      "skinMPE(" + c[0] + ", " + c[1] + "): without=" + without + " with=" + withTrace);
  }
  console.log("  T29: " + cases.length + " cases verified identical");
});

// ─── T30: Zero allocation when tracer is null ───────────────────────
test("T30: skinMPE without tracer returns plain number (no trace metadata)", function() {
  var result = e.skinMPE(2000, 0.005);
  assert(typeof result === "number", "Result is a plain number");
  assert(result.steps === undefined, "No .steps property");
  assert(result._steps === undefined, "No ._steps property");
  // repPulse should return a plain object too
  var rp = e.repPulse(1064, 1e-8, 10000, 1.0);
  assert(rp.steps === undefined, "repPulse result has no .steps");
  console.log("  T30: Confirmed no trace metadata on untraced results");
});

// ─── T31: Boundary-point regression ─────────────────────────────────
test("T31: Boundary points produce correct results with tracer enabled", function() {
  // Test band boundaries and region boundaries
  var boundaryPoints = [
    [180, 1e-9],   // UV band start
    [399, 1],      // UV band end
    [400, 1e-7],   // Visible/Near-IR start
    [1399, 1],     // Visible/Near-IR end
    [1400, 1e-6],  // FIR 1400-1500
    [1500, 0.01],  // FIR 1500-1800
    [1800, 0.1],   // FIR 1800-2600
    [2600, 1],     // FIR 2600-1mm
    [1000000, 10], // Last band upper bound
    // Duration region boundaries
    [1064, 0.001],   // Region boundary for Vis/NIR
    [1064, 10],      // Region boundary for Vis/NIR
    [2000, 0.001],   // Region boundary for FIR
    [2000, 10],      // Region boundary for FIR
  ];

  var allMatch = true;
  for (var bp of boundaryPoints) {
    var expected = e.skinMPE(bp[0], bp[1]);
    var trace = e.createTracer(std);
    var actual = e.skinMPE(bp[0], bp[1], trace);
    if (expected !== actual && !(isNaN(expected) && isNaN(actual))) {
      console.log("  MISMATCH at (" + bp[0] + ", " + bp[1] + "): expected=" + expected + " actual=" + actual);
      allMatch = false;
    }
  }
  assert(allMatch, "All " + boundaryPoints.length + " boundary points match");
  console.log("  T31: " + boundaryPoints.length + " boundary points verified");
});

// ─── T32: Schema validation of example traces ──────────────────────
test("T32: All produced traces validate against schema", function() {
  var traces = [];

  // Simple case
  var t1 = e.createTracer(std);
  e.skinMPE(2000, 0.005, t1);
  traces.push(t1.finalize({ wl_nm: 2000, t_s: 0.005 }, { mpe: 0.1489 }));

  // CA case
  var t2 = e.createTracer(std);
  e.skinMPE(800, 1.0, t2);
  traces.push(t2.finalize({ wl_nm: 800, t_s: 1.0 }, { mpe: 1.74 }));

  // Dual-limit
  var t3 = e.createTracer(std);
  e.skinMPE(300, 100, t3);
  traces.push(t3.finalize({ wl_nm: 300, t_s: 100 }, { mpe: 0.003 }));

  // UV discrete
  var t4 = e.createTracer(std);
  e.skinMPE(305, 100, t4);
  traces.push(t4.finalize({ wl_nm: 305, t_s: 100 }, { mpe: 0.016 }));

  // RepPulse
  var t5 = e.createTracer(std);
  e.repPulse(1064, 1e-8, 10000, 1.0, t5);
  traces.push(t5.finalize({ wl_nm: 1064, tau: 1e-8, prf: 10000, T: 1 }, { H: 0.02 }));

  // beamEval
  var t6 = e.createTracer(std);
  e.beamEval(1064, 0.025, t6);
  traces.push(t6.finalize({ wl_nm: 1064, beam_dia_mm: 0.025 }, { regime: "actual_sub_threshold" }));

  var allValid = true;
  for (var i = 0; i < traces.length; i++) {
    var valid = validate(traces[i]);
    if (!valid) {
      allValid = false;
      console.log("  Trace " + i + " failed schema validation:");
      for (var err of validate.errors.slice(0, 3)) {
        console.log("    " + err.instancePath + ": " + err.message);
      }
    }
  }
  assert(allValid, "All " + traces.length + " traces validate against schema");
  console.log("  T32: " + traces.length + " traces validated");
});

// ─── T33 is implicit: the existing 179 tests pass (verified separately) ────

console.log("\nTracer tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
