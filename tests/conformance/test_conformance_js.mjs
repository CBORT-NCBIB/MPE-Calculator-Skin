#!/usr/bin/env node
/**
 * tests/conformance/test_conformance_js.mjs
 *
 * Reads the shared conformance corpus and verifies the JS engine
 * produces matching results for every case.
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const e = require(resolve(repoRoot, "web/engine.js"));
const corpus = JSON.parse(readFileSync(resolve(__dirname, "corpus.json"), "utf-8"));

var passed = 0, failed = 0;

function close(a, b, rtol) {
  if (isNaN(a) && isNaN(b)) return true;
  if (!isFinite(a) && !isFinite(b)) return a === b; // both +Inf or both -Inf
  if (rtol === 0) return a === b;
  if (b === 0) return Math.abs(a) < 1e-15;
  return Math.abs((a - b) / b) < rtol;
}

for (var c of corpus.cases) {
  var inp = c.inputs;
  var exp = c.expected;
  var tol = c.tolerance;
  var ok = true;
  var detail = "";

  if (c.function === "skin_mpe") {
    var actual = e.skinMPE(inp.wl_nm, inp.t_s);
    var expected_val = (exp === null) ? NaN : exp;
    ok = close(actual, expected_val, tol);
    detail = "expected=" + expected_val + " actual=" + actual;
  } else if (c.function === "ca") {
    var actual_ca = e.CA(inp.wl_nm);
    var expected_ca = (exp === null) ? NaN : exp;
    ok = close(actual_ca, expected_ca, tol);
    detail = "expected=" + expected_ca + " actual=" + actual_ca;
  } else if (c.function === "rep_pulse") {
    var rp = e.repPulse(inp.wl_nm, inp.tau_s, inp.prf_hz, inp.T_s);
    var eR1 = (exp.rule1 === null) ? NaN : exp.rule1;
    var eR2 = (exp.rule2 === null) ? NaN : exp.rule2;
    var eH  = (exp.H === null) ? NaN : exp.H;
    var eN  = (exp.N === null) ? NaN : exp.N;
    ok = close(rp.rule1, eR1, tol) &&
         close(rp.rule2, eR2, tol) &&
         close(rp.H, eH, tol) &&
         close(rp.N, eN, tol) &&
         rp.binding === exp.binding;
    if (!ok) {
      detail = "H: expected=" + eH + " actual=" + rp.H +
        " | binding: expected=" + exp.binding + " actual=" + rp.binding;
    }
  }

  if (ok) {
    passed++;
  } else {
    failed++;
    console.log("  FAIL " + c.id + ": " + c.description);
    console.log("    " + detail);
  }
}

console.log("JS conformance: " + passed + " passed, " + failed + " failed (of " + corpus.cases.length + " cases)");
if (failed > 0) process.exit(1);
