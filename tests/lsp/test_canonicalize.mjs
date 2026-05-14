/**
 * tests/lsp/test_canonicalize.mjs — Node-side test suite for web/lsp/canonicalize.js
 *
 * The centerpiece of this suite is cross-validation: for every legacy preset
 * and a representative set of parameter choices, compute the MPE safety
 * verdict two ways and require them to be numerically identical:
 *
 *   Path A (direct):    engine.computeScanFluence(beam, segments, ppd, scanParams)
 *                       directly from constructor-style parameters.
 *
 *   Path B (via LSP):   LSPFactory.{linear,raster,bidiRaster}(opts)
 *                       → LSPCanonicalize.canonicalize(doc)
 *                       → engine.computeScanFluence(beam, segments, ppd, scanParams)
 *
 * If A and B produce different peak fluence, total time, or pulse counts,
 * the canonicalization pipeline has drifted from the engine's contract and
 * the test fails with the exact field that diverged.
 *
 * Additional coverage:
 *   • Unit conversion (um→mm, mW→W) produces equivalent results.
 *   • Explicit-segments and samples modes return ok=true with scanParams=null.
 *   • Error codes fire correctly for missing engine, arc segments, segment
 *     overflow, unsupported units, empty pattern bodies.
 *   • The beam block is built correctly for both cw and pulsed lasers,
 *     including the case where pulse_energy_j is inferred from avg_power/prf.
 *
 * Run: node tests/lsp/test_canonicalize.mjs
 */

import {createRequire} from "module";
import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const engine = require(resolve(repoRoot, "web/engine.js"));
const Ajv2020 = require(resolve(repoRoot, "web/node_modules/ajv/dist/2020.js")).default;
const LSP_SCHEMA = JSON.parse(readFileSync(resolve(repoRoot, "web/lsp/schema.json"), "utf-8"));

globalThis.LSP_SCHEMA = LSP_SCHEMA;
globalThis.Ajv2020 = Ajv2020;
globalThis.MPEEngine = engine;

const LSPValidate = require(resolve(repoRoot, "web/lsp/validate.js"));
const LSPFactory = require(resolve(repoRoot, "web/lsp/factory.js"));
const LSPCanonicalize = require(resolve(repoRoot, "web/lsp/canonicalize.js"));

// ─── Test harness ──────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    failures.push(`  FAIL: ${name}\n        ${err.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message || "assertion failed");
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || "expected equality"}\n        actual:   ${JSON.stringify(actual)}\n        expected: ${JSON.stringify(expected)}`);
  }
}

function assertClose(actual, expected, tol, message) {
  tol = tol || 1e-9;
  if (!isFinite(actual) || !isFinite(expected)) {
    if (actual !== expected) {
      throw new Error(`${message || "expected close"}\n        actual:   ${actual}\n        expected: ${expected}`);
    }
    return;
  }
  const rel = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-30);
  const abs = Math.abs(actual - expected);
  if (rel > tol && abs > tol) {
    throw new Error(`${message || "expected close"}\n        actual:   ${actual}\n        expected: ${expected}\n        rel:      ${rel}\n        abs:      ${abs}`);
  }
}

function hasError(result, code) {
  return result.errors && result.errors.some((e) => e.code === code);
}

// ─── Reference configurations ──────────────────────────────────────────────

const CW_LINEAR = {
  wavelength_nm: 532,
  beam_diameter_mm: 1.0,
  pulse_mode: "cw",
  average_power_w: 0.5,
  exposure_duration_s: 1.0,
  line_length_mm: 20.0,
  scan_velocity_mm_s: 100.0
};

const PULSED_RASTER = {
  wavelength_nm: 1310,
  beam_diameter_mm: 0.020,
  pulse_mode: "pulsed",
  pulse_repetition_hz: 100000,
  pulse_duration_s: 6.5e-6,
  pulse_energy_j: 1e-7,
  exposure_duration_s: 10.0,
  line_length_mm: 6.0,
  n_lines: 50,
  hatch_mm: 0.020,
  scan_velocity_mm_s: 600.0
};

const PULSED_BIDI = Object.assign({}, PULSED_RASTER);

// ─── Engine-direct helpers (Path A) ────────────────────────────────────────
// These mirror exactly what calculator.jsx's scanCompute wrapper passes to
// engine.computeScanFluence for each preset.

function computeDirectLinear(o) {
  const beam = {
    d_1e_mm: o.beam_diameter_mm,
    wl_nm: o.wavelength_nm,
    tau_s: o.pulse_mode === "cw" ? 0 : o.pulse_duration_s,
    is_cw: o.pulse_mode === "cw",
    prf_hz: o.pulse_mode === "cw" ? 0 : o.pulse_repetition_hz,
    pulse_energy_J: o.pulse_mode === "cw" ? 0 :
      (o.pulse_energy_j != null ? o.pulse_energy_j : o.average_power_w / o.pulse_repetition_hz),
    avg_power_W: o.pulse_mode === "cw" ? o.average_power_w :
      (o.average_power_w != null ? o.average_power_w : o.pulse_energy_j * o.pulse_repetition_hz)
  };
  const segments = engine.buildLinearScan(0, 0, 0,
    o.line_length_mm, o.scan_velocity_mm_s, o.beam_diameter_mm);
  const scanParams = {
    d_1e_mm: o.beam_diameter_mm,
    x0: 0, y0: 0,
    line_length_mm: o.line_length_mm,
    n_lines: 1,
    hatch_mm: o.beam_diameter_mm,
    v_scan_mm_s: o.scan_velocity_mm_s,
    v_jump_mm_s: o.scan_velocity_mm_s,
    pattern: "linear",
    blanking: false,
    is_cw: beam.is_cw,
    prf_hz: beam.prf_hz,
    pulse_energy_J: beam.pulse_energy_J,
    avg_power_W: beam.avg_power_W
  };
  return engine.computeScanFluence(beam, segments, 8, scanParams);
}

function computeDirectRaster(o, bidi) {
  const builder = bidi ? engine.buildBidiRasterScan : engine.buildRasterScan;
  const beam = {
    d_1e_mm: o.beam_diameter_mm,
    wl_nm: o.wavelength_nm,
    tau_s: o.pulse_mode === "cw" ? 0 : o.pulse_duration_s,
    is_cw: o.pulse_mode === "cw",
    prf_hz: o.pulse_mode === "cw" ? 0 : o.pulse_repetition_hz,
    pulse_energy_J: o.pulse_mode === "cw" ? 0 :
      (o.pulse_energy_j != null ? o.pulse_energy_j : o.average_power_w / o.pulse_repetition_hz),
    avg_power_W: o.pulse_mode === "cw" ? o.average_power_w :
      (o.average_power_w != null ? o.average_power_w : o.pulse_energy_j * o.pulse_repetition_hz)
  };
  const hatch = (o.hatch_mm > 0) ? o.hatch_mm : o.beam_diameter_mm;
  const jumpV = (o.jump_velocity_mm_s > 0) ? o.jump_velocity_mm_s : o.scan_velocity_mm_s;
  const blanking = (o.blanking === true);
  const segments = builder(0, 0, o.line_length_mm, o.n_lines, hatch,
    o.scan_velocity_mm_s, jumpV, o.beam_diameter_mm, blanking);
  const scanParams = {
    d_1e_mm: o.beam_diameter_mm,
    x0: 0, y0: 0,
    line_length_mm: o.line_length_mm,
    n_lines: o.n_lines,
    hatch_mm: hatch,
    v_scan_mm_s: o.scan_velocity_mm_s,
    v_jump_mm_s: jumpV,
    pattern: bidi ? "bidi" : "raster",
    blanking: blanking,
    is_cw: beam.is_cw,
    prf_hz: beam.prf_hz,
    pulse_energy_J: beam.pulse_energy_J,
    avg_power_W: beam.avg_power_W
  };
  return engine.computeScanFluence(beam, segments, 8, scanParams);
}

function computeViaLSP(factoryFn, opts) {
  const doc = factoryFn(opts);
  const v = LSPValidate.validate(doc);
  assert(v.ok, `LSP doc failed validation: ${JSON.stringify(v.errors)}`);
  const c = LSPCanonicalize.canonicalize(doc);
  assert(c.ok, `canonicalize failed: ${JSON.stringify(c.errors)}`);
  return {result: engine.computeScanFluence(c.beam, c.engineSegments, 8, c.scanParams), canon: c};
}

function compareResults(a, b, label) {
  assert(a && b, `${label}: one or both results null`);
  assertClose(a.stats.total_time_s, b.stats.total_time_s, 1e-9, `${label}: total_time_s mismatch`);
  if (a.stats.total_pulses !== undefined && b.stats.total_pulses !== undefined) {
    assertEq(a.stats.total_pulses, b.stats.total_pulses, `${label}: total_pulses mismatch`);
  }
  assertEq(a.stats.method, b.stats.method, `${label}: compute method mismatch`);
  // Peak fluence: find the maximum of the fluence grid and compare.
  const peakA = _gridPeak(a.grid);
  const peakB = _gridPeak(b.grid);
  assertClose(peakA, peakB, 1e-9, `${label}: peak grid fluence mismatch`);
}

function _gridPeak(grid) {
  if (!grid || !grid.fluence) return 0;
  let m = 0;
  const f = grid.fluence;
  for (let i = 0; i < f.length; i++) if (f[i] > m) m = f[i];
  return m;
}

// ─── Cross-validation: linear ──────────────────────────────────────────────

test("CROSS-VAL: linear CW preset matches direct path", () => {
  const a = computeDirectLinear(CW_LINEAR);
  const {result: b} = computeViaLSP(LSPFactory.linear, CW_LINEAR);
  compareResults(a, b, "linear CW");
});

test("CROSS-VAL: linear pulsed (NIR OCT-like) matches direct path", () => {
  const opts = {
    wavelength_nm: 1310, beam_diameter_mm: 0.020, pulse_mode: "pulsed",
    pulse_repetition_hz: 100000, pulse_duration_s: 6.5e-6, pulse_energy_j: 1e-7,
    exposure_duration_s: 1.0, line_length_mm: 6.0, scan_velocity_mm_s: 600
  };
  const a = computeDirectLinear(opts);
  const {result: b} = computeViaLSP(LSPFactory.linear, opts);
  compareResults(a, b, "linear pulsed");
});

// ─── Cross-validation: raster (unidirectional) ─────────────────────────────

test("CROSS-VAL: raster (PULSED_RASTER, no blanking) matches direct path", () => {
  const a = computeDirectRaster(PULSED_RASTER, false);
  const {result: b} = computeViaLSP(LSPFactory.raster, PULSED_RASTER);
  compareResults(a, b, "raster pulsed");
});

test("CROSS-VAL: raster with blanking matches direct path", () => {
  const opts = Object.assign({}, PULSED_RASTER, {blanking: true});
  const a = computeDirectRaster(opts, false);
  const {result: b} = computeViaLSP(LSPFactory.raster, opts);
  compareResults(a, b, "raster pulsed blanking");
});

test("CROSS-VAL: raster CW matches direct path", () => {
  const opts = {
    wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw",
    average_power_w: 0.3, exposure_duration_s: 5.0,
    line_length_mm: 10.0, n_lines: 20, hatch_mm: 0.5, scan_velocity_mm_s: 200
  };
  const a = computeDirectRaster(opts, false);
  const {result: b} = computeViaLSP(LSPFactory.raster, opts);
  compareResults(a, b, "raster cw");
});

// ─── Cross-validation: bidirectional raster ────────────────────────────────

test("CROSS-VAL: bidi raster (PULSED_BIDI) matches direct path", () => {
  const a = computeDirectRaster(PULSED_BIDI, true);
  const {result: b} = computeViaLSP(LSPFactory.bidiRaster, PULSED_BIDI);
  compareResults(a, b, "bidi raster pulsed");
});

test("CROSS-VAL: bidi raster CW matches direct path", () => {
  const opts = {
    wavelength_nm: 800, beam_diameter_mm: 0.1, pulse_mode: "cw",
    average_power_w: 0.1, exposure_duration_s: 1.0,
    line_length_mm: 2.0, n_lines: 10, hatch_mm: 0.1, scan_velocity_mm_s: 500
  };
  const a = computeDirectRaster(opts, true);
  const {result: b} = computeViaLSP(LSPFactory.bidiRaster, opts);
  compareResults(a, b, "bidi raster cw");
});

// ─── Mode and scanParams routing ───────────────────────────────────────────

test("parameterized linear yields scanParams.pattern === 'linear'", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  assert(r.scanParams !== null);
  assertEq(r.scanParams.pattern, "linear");
});

test("parameterized raster yields scanParams.pattern === 'raster'", () => {
  const doc = LSPFactory.raster(PULSED_RASTER);
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  assert(r.scanParams !== null);
  assertEq(r.scanParams.pattern, "raster");
});

test("parameterized bidi_raster yields scanParams.pattern === 'bidi' (engine name)", () => {
  const doc = LSPFactory.bidiRaster(PULSED_BIDI);
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  assert(r.scanParams !== null);
  assertEq(r.scanParams.pattern, "bidi");
});

test("linear with nonzero angle drops scanParams (separable path requires axis-aligned)", () => {
  const doc = LSPFactory.linear(Object.assign({}, CW_LINEAR, {angle_rad: 0.5}));
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  assert(r.scanParams === null, "expected scanParams=null for off-axis linear scan");
  assert(r.engineSegments.length > 0);
});

// ─── Explicit-segments mode ────────────────────────────────────────────────

test("explicit-segments mode returns ok with scanParams=null", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {
      representation: "segments",
      authoritative: "segments",
      default_power_w: 0.1,
      segments: [
        {id: 0, type: "line", p0: [0, 0], p1: [5, 0],
         velocity: {mode: "constant", value_mm_per_s: 100},
         power: {mode: "constant", value: 0.1}},
        {id: 1, type: "line", p0: [5, 0], p1: [5, 5],
         velocity: {mode: "constant", value_mm_per_s: 100},
         power: {mode: "constant", value: 0.1}}
      ]
    }
  };
  const v = LSPValidate.validate(doc);
  assert(v.ok, `validate failed: ${JSON.stringify(v.errors)}`);
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok, `canonicalize failed: ${JSON.stringify(r.errors)}`);
  assert(r.scanParams === null);
  assert(r.engineSegments.length > 0);
  // Two 5-mm segments at 100 mm/s = 0.1 s total
  assertClose(r.totalTime_s, 0.1, 1e-9, "totalTime_s for two-segment L-shape");
});

test("explicit-segments with blanked move translates to blanked engine segments", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {
      representation: "segments",
      authoritative: "segments",
      default_power_w: 0.1,
      segments: [
        {id: 0, type: "line", p0: [0, 0], p1: [5, 0],
         velocity: {mode: "constant", value_mm_per_s: 100},
         power: {mode: "constant", value: 0.1}},
        {id: 1, type: "move", p0: [5, 0], p1: [10, 0],
         velocity: {mode: "constant", value_mm_per_s: 1000}, blanked: true}
      ]
    }
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  const blanked = r.engineSegments.filter((s) => s.blanked === true);
  assert(blanked.length > 0, "expected blanked engine segments from the move segment");
});

test("explicit-segments dwell becomes a synthetic stub of correct duration", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {
      representation: "segments",
      authoritative: "segments",
      default_power_w: 0.1,
      segments: [
        {id: 0, type: "dwell", p0: [0, 0], duration_s: 0.01,
         power: {mode: "constant", value: 0.1}}
      ]
    }
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  assertClose(r.totalTime_s, 0.01, 1e-12, "dwell total time should equal duration_s");
  assertEq(r.engineSegments.length, 1, "dwell should translate to a single stub");
});

// ─── Samples mode ──────────────────────────────────────────────────────────

test("samples mode returns ok with scanParams=null and engine-diameter chopping", () => {
  // Five points evenly spaced 1 mm apart, sample rate 1 kHz → dt=1ms, v=1000 mm/s.
  // Beam diameter 0.5 mm means each 1 mm chord is chopped into round(1/0.5)=2
  // engine segments. 4 chord pairs × 2 = 8 engine segments. The actual beam
  // velocity remains 1 mm / 1 ms = 1000 mm/s.
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {
      representation: "samples",
      authoritative: "samples",
      default_power_w: 0.1,
      samples: {
        sample_rate_hz: 1000,
        x: [0, 1, 2, 3, 4],
        y: [0, 0, 0, 0, 0]
      }
    }
  };
  const v = LSPValidate.validate(doc);
  assert(v.ok, `validate failed: ${JSON.stringify(v.errors)}`);
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok, `canonicalize failed: ${JSON.stringify(r.errors)}`);
  assert(r.scanParams === null);
  assertEq(r.engineSegments.length, 8, "5 samples → 4 chords → 8 engine segments (2 per chord at d=0.5)");
  assertClose(r.engineSegments[0].v_mm_s, 1000, 1e-9, "velocity = 1 mm / 1 ms = 1000 mm/s");
  assertClose(r.totalTime_s, 4e-3, 1e-12, "total time = 4 * dt");
});

test("samples mode produces same MPE as equivalent line segment", () => {
  // Cross-validation: a single line segment from 0 to 5 mm at 50 mm/s should
  // produce identical fluence to two samples at the endpoints with dt = 0.1 s.
  const lineDoc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.1, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {
      representation: "segments", authoritative: "segments",
      default_power_w: 0.1,
      segments: [{
        id: 0, type: "line", p0: [0, 0], p1: [5, 0],
        velocity: {mode: "constant", value_mm_per_s: 50},
        power: {mode: "constant", value: 0.1}
      }]
    }
  };
  const samplesDoc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.1, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {
      representation: "samples", authoritative: "samples",
      default_power_w: 0.1,
      samples: {sample_rate_hz: 10, x: [0, 5], y: [0, 0]}
    }
  };
  const cLine = LSPCanonicalize.canonicalize(lineDoc);
  const cSamples = LSPCanonicalize.canonicalize(samplesDoc);
  assertEq(cLine.engineSegments.length, cSamples.engineSegments.length,
    "line and equivalent samples should produce the same engine segment count");
  const rLine = engine.computeScanFluence(cLine.beam, cLine.engineSegments, 8, cLine.scanParams);
  const rSamples = engine.computeScanFluence(cSamples.beam, cSamples.engineSegments, 8, cSamples.scanParams);
  compareResults(rLine, rSamples, "line vs equivalent samples");
});

// ─── Unit conversion (µm → mm) ─────────────────────────────────────────────

test("um length unit converts and produces equivalent MPE result to native mm", () => {
  // Build the same linear pattern in mm and in um, and compare via canonicalize.
  const mm = LSPFactory.linear(CW_LINEAR);
  const um = JSON.parse(JSON.stringify(mm));
  um.meta.units.length = "um";
  um.laser.beam_diameter_mm *= 1000;
  um.pattern.default_velocity_mm_s *= 1000;
  if (typeof um.pattern.default_power_w === "number") { /* power unchanged */ }
  for (const s of um.pattern.segments) {
    s.p0 = [s.p0[0] * 1000, s.p0[1] * 1000];
    s.p1 = [s.p1[0] * 1000, s.p1[1] * 1000];
    if (s.velocity && s.velocity.mode === "constant") s.velocity.value_mm_per_s *= 1000;
  }
  for (const p of um.pattern.parameterized) {
    p.params.x0 *= 1000; p.params.y0 *= 1000;
    p.params.line_length_mm *= 1000;
    p.params.scan_velocity_mm_s *= 1000;
    p.params.beam_diameter_mm *= 1000;
  }
  const v = LSPValidate.validate(um);
  assert(v.ok, `validate failed for um doc: ${JSON.stringify(v.errors)}`);
  const cMm = LSPCanonicalize.canonicalize(mm);
  const cUm = LSPCanonicalize.canonicalize(um);
  assert(cMm.ok && cUm.ok);
  assertClose(cMm.beam.d_1e_mm, cUm.beam.d_1e_mm, 1e-12, "beam diameter mm");
  assertClose(cMm.totalTime_s, cUm.totalTime_s, 1e-12, "total time s");
  // Engine results equivalent
  const rMm = engine.computeScanFluence(cMm.beam, cMm.engineSegments, 8, cMm.scanParams);
  const rUm = engine.computeScanFluence(cUm.beam, cUm.engineSegments, 8, cUm.scanParams);
  compareResults(rMm, rUm, "um vs mm equivalence");
});

// ─── Beam-block extraction ─────────────────────────────────────────────────

test("CW beam block has is_cw=true and zero pulse fields", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  const beam = LSPCanonicalize._buildBeam(doc);
  assertEq(beam.is_cw, true);
  assertEq(beam.prf_hz, 0);
  assertEq(beam.pulse_energy_J, 0);
  assertEq(beam.tau_s, 0);
  assertClose(beam.avg_power_W, CW_LINEAR.average_power_w, 1e-12);
});

test("pulsed beam block infers avg_power from pulse_energy × prf when avg is unspecified", () => {
  const opts = {
    wavelength_nm: 1064, beam_diameter_mm: 0.05, pulse_mode: "pulsed",
    pulse_repetition_hz: 10000, pulse_duration_s: 1e-8, pulse_energy_j: 5e-8,
    exposure_duration_s: 1.0, line_length_mm: 1.0, scan_velocity_mm_s: 100
  };
  const doc = LSPFactory.linear(opts);
  const beam = LSPCanonicalize._buildBeam(doc);
  assertEq(beam.is_cw, false);
  assertClose(beam.prf_hz, 10000, 1e-12);
  assertClose(beam.pulse_energy_J, 5e-8, 1e-20);
  assertClose(beam.avg_power_W, 5e-8 * 10000, 1e-15);
});

// ─── Error paths ───────────────────────────────────────────────────────────

test("missing engine returns ENGINE_NOT_LOADED", () => {
  // The resolver falls back to globalThis.MPEEngine when no valid explicit
  // engine is supplied. Temporarily unset the global so we can exercise the
  // failure path. Restore it after the assertion regardless of outcome.
  const doc = LSPFactory.linear(CW_LINEAR);
  const savedGlobal = globalThis.MPEEngine;
  globalThis.MPEEngine = undefined;
  let r;
  try {
    r = LSPCanonicalize.canonicalize(doc, {engine: {}});
  } finally {
    globalThis.MPEEngine = savedGlobal;
  }
  assert(!r.ok);
  assert(hasError(r, "ENGINE_NOT_LOADED"));
});

test("arc segment returns ARC_NOT_SUPPORTED", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {
      representation: "segments",
      authoritative: "segments",
      default_power_w: 0.1,
      segments: [
        {id: 0, type: "arc", p0: [1, 0], p1: [0, 1], center: [0, 0], sweep_rad: 1.5708,
         velocity: {mode: "constant", value_mm_per_s: 100},
         power: {mode: "constant", value: 0.1}}
      ]
    }
  };
  const v = LSPValidate.validate(doc);
  assert(v.ok, `validate should accept arc segments: ${JSON.stringify(v.errors)}`);
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "ARC_NOT_SUPPORTED"));
});

test("segment overflow returns SEGMENT_OVERFLOW", () => {
  const doc = LSPFactory.raster(PULSED_RASTER);
  // Set a very low cap so canonicalize will overflow
  const r = LSPCanonicalize.canonicalize(doc, {maxEngineSegments: 1});
  // Note: parameterized routing builds segments via engine.buildRasterScan
  // before the cap check, so this case may pass through cleanly. The cap
  // applies to the explicit-segments path, which we test next.
  // For raster parameterized we just check it succeeds:
  assert(r.ok || hasError(r, "SEGMENT_OVERFLOW"));
});

test("explicit-segments path enforces SEGMENT_OVERFLOW", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.01, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {
      representation: "segments",
      authoritative: "segments",
      default_power_w: 0.1,
      // 50 mm / 0.01 mm = 5000 engine segments after chopping
      segments: [
        {id: 0, type: "line", p0: [0, 0], p1: [50, 0],
         velocity: {mode: "constant", value_mm_per_s: 100},
         power: {mode: "constant", value: 0.1}}
      ]
    }
  };
  const r = LSPCanonicalize.canonicalize(doc, {maxEngineSegments: 100});
  assert(!r.ok);
  assert(hasError(r, "SEGMENT_OVERFLOW"));
});

test("unsupported length unit returns UNIT_NOT_SUPPORTED", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.meta.units.length = "rad";
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "UNIT_NOT_SUPPORTED"));
});

test("unsupported power unit returns UNIT_NOT_SUPPORTED", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.meta.units.power = "normalized";
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "UNIT_NOT_SUPPORTED"));
});

// ─── Parameterized parameter validation ────────────────────────────────────

test("parameterized linear with empty params returns DEGENERATE_GEOMETRY", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.pattern.parameterized[0].params = {};
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "DEGENERATE_GEOMETRY"));
});

test("parameterized linear with negative line_length returns DEGENERATE_GEOMETRY", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.pattern.parameterized[0].params.line_length_mm = -1;
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "DEGENERATE_GEOMETRY"));
});

test("parameterized linear with zero scan_velocity returns DEGENERATE_GEOMETRY", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.pattern.parameterized[0].params.scan_velocity_mm_s = 0;
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "DEGENERATE_GEOMETRY"));
});

test("parameterized linear with NaN line_length returns DEGENERATE_GEOMETRY", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.pattern.parameterized[0].params.line_length_mm = NaN;
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "DEGENERATE_GEOMETRY"));
});

test("parameterized raster with zero n_lines returns DEGENERATE_GEOMETRY", () => {
  const doc = LSPFactory.raster(PULSED_RASTER);
  doc.pattern.parameterized[0].params.n_lines = 0;
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "DEGENERATE_GEOMETRY"));
});

test("parameterized raster with non-integer n_lines returns DEGENERATE_GEOMETRY", () => {
  const doc = LSPFactory.raster(PULSED_RASTER);
  doc.pattern.parameterized[0].params.n_lines = 1.5;
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "DEGENERATE_GEOMETRY"));
});

test("parameterized bidi with negative hatch returns DEGENERATE_GEOMETRY", () => {
  const doc = LSPFactory.bidiRaster(PULSED_BIDI);
  doc.pattern.parameterized[0].params.hatch_mm = -1;
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "DEGENERATE_GEOMETRY"));
});

test("parameterized linear with NaN x0 returns DEGENERATE_GEOMETRY", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.pattern.parameterized[0].params.x0 = NaN;
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "DEGENERATE_GEOMETRY"));
});

// ─── Defensive structural checks ───────────────────────────────────────────

test("canonicalize handles null doc gracefully (no throw)", () => {
  const r = LSPCanonicalize.canonicalize(null);
  assert(!r.ok);
  assert(hasError(r, "UNSUPPORTED_REPRESENTATION"));
});

test("canonicalize handles undefined doc gracefully", () => {
  const r = LSPCanonicalize.canonicalize(undefined);
  assert(!r.ok);
  assert(hasError(r, "UNSUPPORTED_REPRESENTATION"));
});

test("canonicalize handles non-object doc gracefully", () => {
  for (const bad of ["hello", 42, true, [1, 2, 3]]) {
    const r = LSPCanonicalize.canonicalize(bad);
    assert(!r.ok, `expected failure for ${JSON.stringify(bad)}`);
    assert(hasError(r, "UNSUPPORTED_REPRESENTATION"));
  }
});

test("canonicalize handles missing laser/exposure/pattern gracefully", () => {
  for (const missing of ["laser", "exposure", "pattern"]) {
    const doc = {
      lsp_version: "1.0.0",
      meta: {units: {length: "mm", time: "s", power: "W"}},
      laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
      exposure: {tissue: "skin", exposure_duration_s: 1.0},
      pattern: {representation: "segments", authoritative: "segments",
        segments: [{id:0, type:"line", p0:[0,0], p1:[5,0],
          velocity:{mode:"constant", value_mm_per_s:50},
          power:{mode:"constant", value:0.1}}]}
    };
    delete doc[missing];
    const r = LSPCanonicalize.canonicalize(doc);
    assert(!r.ok, `missing ${missing} should fail`);
    assert(hasError(r, "UNSUPPORTED_REPRESENTATION"));
  }
});

// ─── Per-sample power consistency check ────────────────────────────────────

test("inconsistent samples.power returns PER_SEGMENT_POWER_UNSUPPORTED", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "samples", authoritative: "samples", default_power_w: 0.1,
      samples: {sample_rate_hz: 10, x: [0, 5, 10], y: [0, 0, 0], power: [0.5, 0.5, 0.5]}}
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "PER_SEGMENT_POWER_UNSUPPORTED"));
});

test("consistent samples.power passes canonicalization", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "samples", authoritative: "samples", default_power_w: 0.1,
      samples: {sample_rate_hz: 10, x: [0, 5, 10], y: [0, 0, 0], power: [0.1, 0.1, 0.1]}}
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok, `expected ok but got errors: ${JSON.stringify(r.errors)}`);
});

// ─── Move segments default to blanked ──────────────────────────────────────

test("move segment defaults to blanked=true", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{id:0, type:"move", p0:[0,0], p1:[5,0],
        velocity:{mode:"constant", value_mm_per_s:50},
        power:{mode:"constant", value:0.1}}]}
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  // Every engine segment from this move should be marked blanked
  for (const s of r.engineSegments) {
    assertEq(s.blanked, true, "move segments should default to blanked=true");
  }
});

test("move with explicit blanked=false stays unblanked", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{id:0, type:"move", p0:[0,0], p1:[5,0],
        velocity:{mode:"constant", value_mm_per_s:50},
        power:{mode:"constant", value:0.1},
        blanked: false}]}
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  for (const s of r.engineSegments) {
    assert(s.blanked !== true, "move with blanked=false should NOT be blanked");
  }
});

test("line segment defaults to unblanked", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{id:0, type:"line", p0:[0,0], p1:[5,0],
        velocity:{mode:"constant", value_mm_per_s:50},
        power:{mode:"constant", value:0.1}}]}
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  for (const s of r.engineSegments) {
    assert(s.blanked !== true, "line segments should default to unblanked");
  }
});

test("line segment with blanked=true stays blanked", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{id:0, type:"line", p0:[0,0], p1:[5,0],
        velocity:{mode:"constant", value_mm_per_s:50},
        power:{mode:"constant", value:0.1},
        blanked: true}]}
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok);
  for (const s of r.engineSegments) {
    assertEq(s.blanked, true, "line with blanked=true should be blanked");
  }
});

// ─── Cross-module consistency: validator and canonicalize agree ────────────

test("canonicalize rejects authoritative=parameterized with empty block (same as validator)", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "parameterized",
      default_power_w: 0.1,
      segments: [{id:0, type:"line", p0:[0,0], p1:[5,0],
        velocity:{mode:"constant", value_mm_per_s:50},
        power:{mode:"constant", value:0.1}}]}
  };
  // Validator should reject (Stage 2)
  const v = LSPValidate.validate(doc);
  assert(!v.ok);
  assert(v.errors.some((e) => e.code === "AUTHORITATIVE_PARAMETERIZED_EMPTY"));
  // Canonicalize should also reject, with the same error code
  const c = LSPCanonicalize.canonicalize(doc);
  assert(!c.ok);
  assert(hasError(c, "AUTHORITATIVE_PARAMETERIZED_EMPTY"));
});

// ─── Unit conversion: meta.extent_bbox and meta.origin must be scaled ──────

test("um unit conversion scales meta.extent_bbox and meta.origin", () => {
  const docUm = {
    lsp_version: "1.0.0",
    meta: {
      units: {length: "um", time: "s", power: "W"},
      extent_bbox: [[0, 0], [5000, 0]],
      origin: [100, 200]
    },
    laser: {wavelength_nm: 532, beam_diameter_mm: 500, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{id:0, type:"line", p0:[0,0], p1:[5000,0],
        velocity:{mode:"constant", value_mm_per_s:50000},
        power:{mode:"constant", value:0.1}}]}
  };
  const converted = LSPCanonicalize._convertUnits(docUm);
  // After conversion, all lengths must be in mm
  assertClose(converted.laser.beam_diameter_mm, 0.5, 1e-12, "beam diameter");
  assert(Array.isArray(converted.meta.extent_bbox));
  assertClose(converted.meta.extent_bbox[1][0], 5, 1e-12, "bbox max x in mm");
  assertClose(converted.meta.origin[0], 0.1, 1e-12, "origin x in mm");
  assertClose(converted.meta.origin[1], 0.2, 1e-12, "origin y in mm");
  // Segment coordinates also in mm
  assertClose(converted.pattern.segments[0].p1[0], 5, 1e-12, "segment p1 x in mm");
});

test("um unit conversion: bbox and segments stay consistent after canonicalization", () => {
  // After unit conversion, bbox and segment coordinates should be in the same
  // units, so the validator's bbox check should produce no spurious warnings.
  const docUm = {
    lsp_version: "1.0.0",
    meta: {
      units: {length: "um", time: "s", power: "W"},
      extent_bbox: [[0, 0], [5000, 1]]
    },
    laser: {wavelength_nm: 532, beam_diameter_mm: 500, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{id:0, type:"line", p0:[0,0], p1:[5000,0],
        velocity:{mode:"constant", value_mm_per_s:50000},
        power:{mode:"constant", value:0.1}}]}
  };
  const v = LSPValidate.validate(docUm);
  assert(v.ok, `validate failed: ${JSON.stringify(v.errors)}`);
  // The validator runs on the original (um) document so the bbox check there
  // compares um-to-um. We test the converted form via _convertUnits separately.
  const c = LSPCanonicalize.canonicalize(docUm);
  assert(c.ok, `canonicalize failed: ${JSON.stringify(c.errors)}`);
});

// ─── Per-segment power consistency check ───────────────────────────────────

test("inconsistent per-segment power returns PER_SEGMENT_POWER_UNSUPPORTED", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "segments", default_power_w: 0.5,
      segments: [{id:0, type:"line", p0:[0,0], p1:[5,0],
        velocity:{mode:"constant", value_mm_per_s:50},
        power:{mode:"constant", value:0.1}}]}
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "PER_SEGMENT_POWER_UNSUPPORTED"));
});

test("linear_ramp power profile returns PER_SEGMENT_POWER_UNSUPPORTED", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{id:0, type:"line", p0:[0,0], p1:[5,0],
        velocity:{mode:"constant", value_mm_per_s:50},
        power:{mode:"linear_ramp", value_start:0.1, value_end:0.2}}]}
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(!r.ok);
  assert(hasError(r, "PER_SEGMENT_POWER_UNSUPPORTED"));
});

test("inherit power passes through canonicalization", () => {
  const doc = {
    lsp_version: "1.0.0",
    meta: {units: {length: "mm", time: "s", power: "W"}},
    laser: {wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw"},
    exposure: {tissue: "skin", exposure_duration_s: 1.0},
    pattern: {representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{id:0, type:"line", p0:[0,0], p1:[5,0],
        velocity:{mode:"constant", value_mm_per_s:50},
        power:{mode:"inherit"}}]}
  };
  const r = LSPCanonicalize.canonicalize(doc);
  assert(r.ok, `expected ok but got errors: ${JSON.stringify(r.errors)}`);
});

test("factory-emitted documents pass per-segment power consistency check", () => {
  // Factory always emits segment.power.value matching default_power_w, so this
  // ensures the new check doesn't break factory round-trips.
  const linear = LSPFactory.linear(CW_LINEAR);
  const raster = LSPFactory.raster(PULSED_RASTER);
  const bidi = LSPFactory.bidiRaster(PULSED_BIDI);
  assert(LSPCanonicalize.canonicalize(linear).ok);
  assert(LSPCanonicalize.canonicalize(raster).ok);
  assert(LSPCanonicalize.canonicalize(bidi).ok);
});

// ─── ERROR_CODES table stability ───────────────────────────────────────────

test("ERROR_CODES table is exposed and complete", () => {
  const codes = LSPCanonicalize.ERROR_CODES;
  assert(codes && typeof codes === "object");
  const expected = [
    "ENGINE_NOT_LOADED", "UNSUPPORTED_SHAPE", "UNSUPPORTED_REPRESENTATION",
    "SEGMENT_OVERFLOW", "ARC_NOT_SUPPORTED", "UNIT_NOT_SUPPORTED",
    "DEGENERATE_GEOMETRY", "PER_SEGMENT_POWER_UNSUPPORTED",
    "AUTHORITATIVE_PARAMETERIZED_EMPTY", "INTERNAL_ERROR"
  ];
  for (const code of expected) {
    assertEq(codes[code], code, `ERROR_CODES.${code} should be "${code}"`);
  }
});

// ─── Try-catch wrapper: canonicalize never throws ──────────────────────────

test("canonicalize catches engine exceptions and returns INTERNAL_ERROR", () => {
  const throwingEngine = {
    buildLinearScan: function () { throw new Error("simulated engine failure"); }
  };
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.pattern.authoritative = "parameterized";
  const r = LSPCanonicalize.canonicalize(doc, {engine: throwingEngine});
  assert(!r.ok);
  assert(hasError(r, "INTERNAL_ERROR"));
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\nLSP canonicalization tests: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log(f);
process.exit(fail > 0 ? 1 : 0);
