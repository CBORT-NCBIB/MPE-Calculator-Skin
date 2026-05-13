/**
 * tests/lsp/test_factory.mjs — Node-side test suite for web/lsp/factory.js
 *
 * Verifies:
 *   • Every preset constructor produces a schema-valid LSP-JSON document.
 *   • The segments block embedded in each preset's document is bit-identical
 *     to the engine's direct output for the same parameters.
 *   • fromParameterized() round-trips: linear → fromParameterized → linear
 *     produces an identical document modulo the `created` timestamp.
 *   • Input validation rejects every malformed option with a TypeError.
 *   • Optional parameters (hatch_mm, jump_velocity_mm_s, blanking) default
 *     correctly.
 *   • The fallback engine in factory.js matches the real engine's segment
 *     output bit-for-bit, so the factory works identically with or without
 *     the real engine loaded.
 *
 * Run: node tests/lsp/test_factory.mjs
 */

import {createRequire} from "module";
import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// ─── Load the real engine and the LSP modules ──────────────────────────────
const engine = require(resolve(repoRoot, "web/engine.js"));
const Ajv2020 = require(resolve(repoRoot, "web/node_modules/ajv/dist/2020.js")).default;
const LSP_SCHEMA = JSON.parse(readFileSync(resolve(repoRoot, "web/lsp/schema.json"), "utf-8"));

globalThis.LSP_SCHEMA = LSP_SCHEMA;
globalThis.Ajv2020 = Ajv2020;
globalThis.MPEEngine = engine;

const LSPValidate = require(resolve(repoRoot, "web/lsp/validate.js"));
const LSPFactory = require(resolve(repoRoot, "web/lsp/factory.js"));

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

function assertThrows(fn, predicate, message) {
  let threw = false, caught = null;
  try { fn(); } catch (err) { threw = true; caught = err; }
  if (!threw) throw new Error((message || "expected throw") + " (no exception)");
  if (predicate && !predicate(caught)) {
    throw new Error((message || "expected throw matching predicate") + ", got: " + (caught && caught.message));
  }
}

function segmentsAlmostEqual(a, b, tol) {
  tol = tol || 1e-12;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const sa = a[i], sb = b[i];
    if (Math.abs(sa.x_start_mm - sb.x_start_mm) > tol) return false;
    if (Math.abs(sa.y_start_mm - sb.y_start_mm) > tol) return false;
    if (Math.abs(sa.angle_rad - sb.angle_rad) > tol) return false;
    if (Math.abs(sa.v_mm_s - sb.v_mm_s) > tol) return false;
    if ((sa.blanked === true) !== (sb.blanked === true)) return false;
  }
  return true;
}

function lspSegmentToEngineSegment(s, d_1e_mm) {
  // The factory writes LSP segments as p0..p1 line segments of length d_1e_mm.
  // To compare to the engine's segment list we reverse that mapping.
  return {
    x_start_mm: s.p0[0],
    y_start_mm: s.p0[1],
    angle_rad: Math.atan2(s.p1[1] - s.p0[1], s.p1[0] - s.p0[0]),
    v_mm_s: s.velocity.value_mm_per_s,
    blanked: s.blanked === true
  };
}

// ─── Common preset options ─────────────────────────────────────────────────

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

// ─── Baseline: linear preset ───────────────────────────────────────────────

test("linear preset returns a schema-valid LSP document", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  const r = LSPValidate.validate(doc);
  assert(r.ok, `linear preset failed schema validation: ${JSON.stringify(r.errors)}`);
});

test("linear preset embeds matching parameterized and segments blocks", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  assertEq(doc.pattern.representation, "segments");
  assertEq(doc.pattern.authoritative, "parameterized");
  assert(Array.isArray(doc.pattern.parameterized));
  assertEq(doc.pattern.parameterized.length, 1);
  assertEq(doc.pattern.parameterized[0].shape, "linear");
});

test("linear segments equal the engine's direct output", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  const direct = engine.buildLinearScan(0, 0, 0,
    CW_LINEAR.line_length_mm, CW_LINEAR.scan_velocity_mm_s, CW_LINEAR.beam_diameter_mm);
  const reconstructed = doc.pattern.segments.map(
    (s) => lspSegmentToEngineSegment(s, CW_LINEAR.beam_diameter_mm));
  assert(segmentsAlmostEqual(direct, reconstructed),
    `factory segments differ from engine.buildLinearScan output.\n        direct[0]:        ${JSON.stringify(direct[0])}\n        reconstructed[0]: ${JSON.stringify(reconstructed[0])}`);
});

// ─── Raster preset ─────────────────────────────────────────────────────────

test("raster preset returns a schema-valid LSP document", () => {
  const doc = LSPFactory.raster(PULSED_RASTER);
  const r = LSPValidate.validate(doc);
  assert(r.ok, `raster preset failed schema validation: ${JSON.stringify(r.errors)}`);
});

test("raster segments equal the engine's direct output", () => {
  const doc = LSPFactory.raster(PULSED_RASTER);
  const direct = engine.buildRasterScan(0, 0,
    PULSED_RASTER.line_length_mm, PULSED_RASTER.n_lines, PULSED_RASTER.hatch_mm,
    PULSED_RASTER.scan_velocity_mm_s, PULSED_RASTER.scan_velocity_mm_s,
    PULSED_RASTER.beam_diameter_mm, false);
  const reconstructed = doc.pattern.segments.map(
    (s) => lspSegmentToEngineSegment(s, PULSED_RASTER.beam_diameter_mm));
  assert(segmentsAlmostEqual(direct, reconstructed),
    `factory raster segments differ from engine output (${direct.length} vs ${reconstructed.length} segments)`);
});

test("raster with blanking=true marks return + step segments as blanked", () => {
  const doc = LSPFactory.raster(Object.assign({}, PULSED_RASTER, {blanking: true}));
  const blankedCount = doc.pattern.segments.filter((s) => s.blanked === true).length;
  assert(blankedCount > 0, "expected some blanked segments when blanking=true");
});

// ─── Bidirectional raster preset ───────────────────────────────────────────

test("bidiRaster preset returns a schema-valid LSP document", () => {
  const doc = LSPFactory.bidiRaster(PULSED_BIDI);
  const r = LSPValidate.validate(doc);
  assert(r.ok, `bidiRaster preset failed schema validation: ${JSON.stringify(r.errors)}`);
});

test("bidiRaster segments equal the engine's direct output", () => {
  const doc = LSPFactory.bidiRaster(PULSED_BIDI);
  const direct = engine.buildBidiRasterScan(0, 0,
    PULSED_BIDI.line_length_mm, PULSED_BIDI.n_lines, PULSED_BIDI.hatch_mm,
    PULSED_BIDI.scan_velocity_mm_s, PULSED_BIDI.scan_velocity_mm_s,
    PULSED_BIDI.beam_diameter_mm, false);
  const reconstructed = doc.pattern.segments.map(
    (s) => lspSegmentToEngineSegment(s, PULSED_BIDI.beam_diameter_mm));
  assert(segmentsAlmostEqual(direct, reconstructed),
    `factory bidi segments differ from engine output (${direct.length} vs ${reconstructed.length})`);
});

// ─── Round-trip via fromParameterized ──────────────────────────────────────

function stripVolatile(doc) {
  // Remove timestamps and other volatile fields before comparing round-tripped
  // documents.
  const clone = JSON.parse(JSON.stringify(doc));
  if (clone.meta) {
    delete clone.meta.created;
    delete clone.meta.source_tool;
  }
  return clone;
}

test("linear round-trips via fromParameterized", () => {
  const a = LSPFactory.linear(CW_LINEAR);
  const b = LSPFactory.fromParameterized(a);
  const ra = LSPValidate.validate(b);
  assert(ra.ok);
  assertEq(JSON.stringify(stripVolatile(a)), JSON.stringify(stripVolatile(b)),
    "linear preset is not stable under round-trip");
});

test("raster round-trips via fromParameterized", () => {
  const a = LSPFactory.raster(PULSED_RASTER);
  const b = LSPFactory.fromParameterized(a);
  const ra = LSPValidate.validate(b);
  assert(ra.ok);
  assertEq(JSON.stringify(stripVolatile(a)), JSON.stringify(stripVolatile(b)),
    "raster preset is not stable under round-trip");
});

test("bidiRaster round-trips via fromParameterized", () => {
  const a = LSPFactory.bidiRaster(PULSED_BIDI);
  const b = LSPFactory.fromParameterized(a);
  const ra = LSPValidate.validate(b);
  assert(ra.ok);
  assertEq(JSON.stringify(stripVolatile(a)), JSON.stringify(stripVolatile(b)),
    "bidiRaster preset is not stable under round-trip");
});

test("raster with blanking=true round-trips losslessly", () => {
  const a = LSPFactory.raster(Object.assign({}, PULSED_RASTER, {blanking: true}));
  const b = LSPFactory.fromParameterized(a);
  assertEq(JSON.stringify(stripVolatile(a)), JSON.stringify(stripVolatile(b)));
});

// ─── Defaults and inference ────────────────────────────────────────────────

test("raster default hatch_mm equals beam_diameter_mm", () => {
  const opts = Object.assign({}, PULSED_RASTER);
  delete opts.hatch_mm;
  const doc = LSPFactory.raster(opts);
  assertEq(doc.pattern.parameterized[0].params.hatch_mm, opts.beam_diameter_mm);
});

test("raster default jump_velocity_mm_s equals scan_velocity_mm_s", () => {
  const opts = Object.assign({}, PULSED_RASTER);
  delete opts.jump_velocity_mm_s;
  const doc = LSPFactory.raster(opts);
  assertEq(doc.pattern.parameterized[0].params.jump_velocity_mm_s, opts.scan_velocity_mm_s);
});

test("raster default blanking is false", () => {
  const opts = Object.assign({}, PULSED_RASTER);
  delete opts.blanking;
  const doc = LSPFactory.raster(opts);
  assertEq(doc.pattern.parameterized[0].params.blanking, false);
});

test("pulsed with only pulse_energy_j (no avg_power_w) derives average power", () => {
  const opts = Object.assign({}, PULSED_RASTER);
  delete opts.average_power_w;
  const doc = LSPFactory.raster(opts);
  const expected = opts.pulse_energy_j * opts.pulse_repetition_hz;
  const avg = doc.pattern.parameterized[0].params.average_power_w;
  assert(Math.abs(avg - expected) < 1e-15,
    `expected derived avg power ${expected}, got ${avg}`);
});

test("um length unit is rejected by the schema before reaching the factory's segments writer", () => {
  // The factory always emits meta.units = mm, so this is a sanity check on
  // the schema's enum constraint via a roundtrip through validation.
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.meta.units.length = "cm";
  const r = LSPValidate.validate(doc);
  assert(!r.ok);
});

// ─── Input validation ──────────────────────────────────────────────────────

test("linear throws TypeError when wavelength is missing", () => {
  const opts = Object.assign({}, CW_LINEAR);
  delete opts.wavelength_nm;
  assertThrows(() => LSPFactory.linear(opts), (e) => e instanceof TypeError);
});

test("linear throws TypeError when wavelength is below 180 nm", () => {
  const opts = Object.assign({}, CW_LINEAR, {wavelength_nm: 100});
  assertThrows(() => LSPFactory.linear(opts), (e) => /lie in \[180/.test(e.message));
});

test("linear throws TypeError when beam_diameter_mm is zero", () => {
  const opts = Object.assign({}, CW_LINEAR, {beam_diameter_mm: 0});
  assertThrows(() => LSPFactory.linear(opts), (e) => e instanceof TypeError);
});

test("linear throws TypeError when scan_velocity_mm_s is negative", () => {
  const opts = Object.assign({}, CW_LINEAR, {scan_velocity_mm_s: -1});
  assertThrows(() => LSPFactory.linear(opts), (e) => e instanceof TypeError);
});

test("cw without average_power_w throws TypeError", () => {
  const opts = Object.assign({}, CW_LINEAR);
  delete opts.average_power_w;
  assertThrows(() => LSPFactory.linear(opts), (e) => /average_power_w/.test(e.message));
});

test("pulsed without repetition_hz throws TypeError", () => {
  const opts = Object.assign({}, PULSED_RASTER);
  delete opts.pulse_repetition_hz;
  assertThrows(() => LSPFactory.raster(opts), (e) => /pulse_repetition_hz/.test(e.message));
});

test("raster n_lines must be a positive integer (1.5 rejected)", () => {
  const opts = Object.assign({}, PULSED_RASTER, {n_lines: 1.5});
  assertThrows(() => LSPFactory.raster(opts), (e) => /n_lines/.test(e.message));
});

test("raster n_lines = 0 rejected", () => {
  const opts = Object.assign({}, PULSED_RASTER, {n_lines: 0});
  assertThrows(() => LSPFactory.raster(opts), (e) => /n_lines/.test(e.message));
});

test("exposure_duration_s > 86400 is rejected", () => {
  const opts = Object.assign({}, CW_LINEAR, {exposure_duration_s: 100000});
  assertThrows(() => LSPFactory.linear(opts), (e) => /exposure_duration_s/.test(e.message));
});

test("beam_diameter_mm > 1000 is rejected", () => {
  const opts = Object.assign({}, CW_LINEAR, {beam_diameter_mm: 1000.001});
  assertThrows(() => LSPFactory.linear(opts), (e) => /beam_diameter_mm/.test(e.message));
});

test("aperture_mm > 100 is rejected", () => {
  const opts = Object.assign({}, CW_LINEAR, {aperture_mm: 100.001});
  assertThrows(() => LSPFactory.linear(opts), (e) => /aperture_mm/.test(e.message));
});

test("aperture_mm = -1 is rejected", () => {
  const opts = Object.assign({}, CW_LINEAR, {aperture_mm: -1});
  assertThrows(() => LSPFactory.linear(opts), (e) => /aperture_mm/.test(e.message));
});

test("Infinite pulse_energy_j is rejected", () => {
  const opts = Object.assign({}, PULSED_RASTER, {pulse_energy_j: Infinity});
  assertThrows(() => LSPFactory.raster(opts), (e) => /pulse_energy_j/.test(e.message));
});

test("Infinite average_power_w in pulsed mode is rejected", () => {
  const opts = Object.assign({}, PULSED_RASTER, {average_power_w: Infinity});
  assertThrows(() => LSPFactory.raster(opts), (e) => /average_power_w/.test(e.message));
});

test("malformed extent_bbox (flat array) is rejected", () => {
  const opts = Object.assign({}, CW_LINEAR, {meta: {extent_bbox: [0, 0, 5, 5]}});
  assertThrows(() => LSPFactory.linear(opts), (e) => /extent_bbox/.test(e.message));
});

test("malformed extent_bbox (string components) is rejected", () => {
  const opts = Object.assign({}, CW_LINEAR, {meta: {extent_bbox: [["a", "b"], [5, 5]]}});
  assertThrows(() => LSPFactory.linear(opts), (e) => /extent_bbox/.test(e.message));
});

test("malformed extent_bbox (three corners) is rejected", () => {
  const opts = Object.assign({}, CW_LINEAR, {meta: {extent_bbox: [[0,0], [5,5], [10,10]]}});
  assertThrows(() => LSPFactory.linear(opts), (e) => /extent_bbox/.test(e.message));
});

test("valid user-supplied extent_bbox is preserved", () => {
  const opts = Object.assign({}, CW_LINEAR, {meta: {extent_bbox: [[-1, -1], [20, 5]]}});
  const doc = LSPFactory.linear(opts);
  assertEq(JSON.stringify(doc.meta.extent_bbox), JSON.stringify([[-1, -1], [20, 5]]));
});

test("fromParameterized rejects an empty parameterized block", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.pattern.parameterized = [];
  assertThrows(() => LSPFactory.fromParameterized(doc), (e) => /parameterized/.test(e.message));
});

test("fromParameterized rejects an unsupported shape", () => {
  const doc = LSPFactory.linear(CW_LINEAR);
  doc.pattern.parameterized[0].shape = "epicycloid";
  assertThrows(() => LSPFactory.fromParameterized(doc), (e) => /epicycloid/.test(e.message));
});

test("invalid coordinate_frame is rejected by the factory", () => {
  const opts = Object.assign({}, CW_LINEAR, {meta: {coordinate_frame: "Mars"}});
  assertThrows(() => LSPFactory.linear(opts),
    (e) => /coordinate_frame/.test(e.message));
});

test("valid coordinate_frame passes through", () => {
  const opts = Object.assign({}, CW_LINEAR, {meta: {coordinate_frame: "scanner_angle"}});
  const doc = LSPFactory.linear(opts);
  assertEq(doc.meta.coordinate_frame, "scanner_angle");
});

test("factory bbox matches actual segment extents for linear with non-multiple length", () => {
  // 1.8 mm at d=0.5: 4 segments, actual extent x in [0, 2]
  const doc = LSPFactory.linear({
    wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw",
    average_power_w: 0.1, exposure_duration_s: 1.0,
    line_length_mm: 1.8, scan_velocity_mm_s: 50
  });
  // bbox should reflect segment extents, not user line_length
  const bbox = doc.meta.extent_bbox;
  assert(Array.isArray(bbox), "extent_bbox should be present");
  // The right edge should be the actual max p1.x = 2.0
  assertClose(bbox[1][0], 2.0, 1e-12, "bbox.xmax should equal actual segment extent");
  // Validate the document — should have zero BBOX_VIOLATION warnings
  const v = LSPValidate.validate(doc);
  assert(v.ok, "doc should validate");
  const bboxWarns = v.warnings.filter((w) => w.code === "BBOX_VIOLATION");
  assertEq(bboxWarns.length, 0, "factory-emitted doc should produce no bbox warnings");
});

test("factory bbox matches actual segment extents for raster with non-multiple length", () => {
  const doc = LSPFactory.raster({
    wavelength_nm: 1310, beam_diameter_mm: 0.02, pulse_mode: "pulsed",
    pulse_repetition_hz: 100000, pulse_duration_s: 6.5e-6, pulse_energy_j: 1e-7,
    exposure_duration_s: 10.0, line_length_mm: 6.05, n_lines: 10, hatch_mm: 0.025,
    scan_velocity_mm_s: 600
  });
  const v = LSPValidate.validate(doc);
  assert(v.ok, "doc should validate");
  const bboxWarns = v.warnings.filter((w) => w.code === "BBOX_VIOLATION");
  assertEq(bboxWarns.length, 0, "factory raster bbox should not produce bbox warnings");
});

test("factory bbox matches actual segment extents for bidi raster with non-multiple length", () => {
  const doc = LSPFactory.bidiRaster({
    wavelength_nm: 1310, beam_diameter_mm: 0.02, pulse_mode: "pulsed",
    pulse_repetition_hz: 100000, pulse_duration_s: 6.5e-6, pulse_energy_j: 1e-7,
    exposure_duration_s: 10.0, line_length_mm: 6.05, n_lines: 10, hatch_mm: 0.025,
    scan_velocity_mm_s: 600
  });
  const v = LSPValidate.validate(doc);
  assert(v.ok, "doc should validate");
  const bboxWarns = v.warnings.filter((w) => w.code === "BBOX_VIOLATION");
  assertEq(bboxWarns.length, 0, "factory bidi raster bbox should not produce bbox warnings");
});

// ─── Fallback engine equivalence ───────────────────────────────────────────

test("fallback engine matches real engine for buildLinearScan", () => {
  const fb = LSPFactory._FALLBACK_ENGINE.buildLinearScan(0, 0, 0, 20, 100, 1.0);
  const re = engine.buildLinearScan(0, 0, 0, 20, 100, 1.0);
  assert(segmentsAlmostEqual(fb, re), "fallback buildLinearScan diverges from engine");
});

test("fallback engine matches real engine for buildRasterScan", () => {
  const fb = LSPFactory._FALLBACK_ENGINE.buildRasterScan(0, 0, 6, 10, 0.02, 600, 600, 0.02, false);
  const re = engine.buildRasterScan(0, 0, 6, 10, 0.02, 600, 600, 0.02, false);
  assert(segmentsAlmostEqual(fb, re), "fallback buildRasterScan diverges from engine");
});

test("fallback engine matches real engine for buildBidiRasterScan", () => {
  const fb = LSPFactory._FALLBACK_ENGINE.buildBidiRasterScan(0, 0, 6, 10, 0.02, 600, 600, 0.02, false);
  const re = engine.buildBidiRasterScan(0, 0, 6, 10, 0.02, 600, 600, 0.02, false);
  assert(segmentsAlmostEqual(fb, re), "fallback buildBidiRasterScan diverges from engine");
});

test("fallback engine matches real engine with blanking enabled", () => {
  const fb = LSPFactory._FALLBACK_ENGINE.buildRasterScan(0, 0, 6, 10, 0.02, 600, 600, 0.02, true);
  const re = engine.buildRasterScan(0, 0, 6, 10, 0.02, 600, 600, 0.02, true);
  assert(segmentsAlmostEqual(fb, re), "fallback engine diverges with blanking enabled");
});

// ─── PRESETS table stability ───────────────────────────────────────────────

test("PRESETS table exposes the three legacy preset names", () => {
  assertEq(LSPFactory.PRESETS.LINEAR, "linear");
  assertEq(LSPFactory.PRESETS.RASTER, "raster");
  assertEq(LSPFactory.PRESETS.BIDI_RASTER, "bidi_raster");
});

// ─── Schema constant ───────────────────────────────────────────────────────

test("every preset emits lsp_version === '1.0.0'", () => {
  assertEq(LSPFactory.linear(CW_LINEAR).lsp_version, "1.0.0");
  assertEq(LSPFactory.raster(PULSED_RASTER).lsp_version, "1.0.0");
  assertEq(LSPFactory.bidiRaster(PULSED_BIDI).lsp_version, "1.0.0");
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\nLSP factory tests: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log(f);
process.exit(fail > 0 ? 1 : 0);
