/**
 * tests/lsp/test_validate.mjs — Node-side test suite for web/lsp/validate.js
 *
 * Verifies:
 *   • Stage 1 (schema) violations are reported with code SCHEMA_VIOLATION and a
 *     humanized message.
 *   • Stage 2 (plausibility) violations are reported with the correct stable
 *     error code from LSPValidate.ERROR_CODES.
 *   • Warnings vs. errors: bounding-box violations and unit-conversion notes
 *     surface as warnings; missing pulse block, array-length mismatches, and
 *     over-cap counts surface as errors.
 *   • Degenerate inputs (null, undefined, arrays, primitives) return a clean
 *     INTERNAL_ERROR rather than throwing.
 *   • The validator is idempotent: validating the same document twice returns
 *     identical results.
 *
 * Run: node tests/lsp/test_validate.mjs
 */

import {createRequire} from "module";
import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// ─── Load Ajv 2020 from web/node_modules ────────────────────────────────────
const Ajv2020 = require(resolve(repoRoot, "web/node_modules/ajv/dist/2020.js")).default;

// ─── Load LSP_SCHEMA from web/lsp/schema.json ──────────────────────────────
const LSP_SCHEMA = JSON.parse(readFileSync(resolve(repoRoot, "web/lsp/schema.json"), "utf-8"));

// ─── Set up the validator's expected globals before requiring it ───────────
// The validate.js module attaches itself to globalThis and reads
// globalThis.LSP_SCHEMA and globalThis.Ajv2020 lazily on first validation.
globalThis.LSP_SCHEMA = LSP_SCHEMA;
globalThis.Ajv2020 = Ajv2020;

// Require the validator. It registers LSPValidate on globalThis and exports it.
const LSPValidate = require(resolve(repoRoot, "web/lsp/validate.js"));

// ─── Test harness ───────────────────────────────────────────────────────────

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

function hasError(result, code) {
  return result.errors.some((e) => e.code === code);
}

function hasWarning(result, code) {
  return result.warnings.some((w) => w.code === code);
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

// ─── A canonical minimal valid document used as a starting point ───────────

const MINIMAL = {
  lsp_version: "1.0.0",
  meta: {units: {length: "mm", time: "s", power: "W"}},
  laser: {wavelength_nm: 1310, beam_diameter_mm: 0.02, pulse_mode: "cw"},
  exposure: {tissue: "skin", exposure_duration_s: 10.0},
  pattern: {
    representation: "segments",
    authoritative: "segments",
    segments: [
      {
        id: 0, type: "line",
        p0: [0, 0], p1: [1, 0],
        velocity: {mode: "constant", value_mm_per_s: 50},
        power: {mode: "constant", value: 0.01}
      }
    ]
  }
};

// ─── Baseline ──────────────────────────────────────────────────────────────

test("minimal valid document validates with ok=true and no errors", () => {
  const r = LSPValidate.validate(MINIMAL);
  assert(r.ok, `expected ok=true, got errors: ${JSON.stringify(r.errors)}`);
  assertEq(r.errors.length, 0);
  assert(r.value === MINIMAL, "value should be the input doc on success");
});

test("validating the same document twice yields identical results", () => {
  const r1 = LSPValidate.validate(MINIMAL);
  const r2 = LSPValidate.validate(MINIMAL);
  assertEq(r1.ok, r2.ok);
  assertEq(r1.errors.length, r2.errors.length);
  assertEq(r1.warnings.length, r2.warnings.length);
});

// ─── Degenerate inputs ─────────────────────────────────────────────────────

test("null input returns INTERNAL_ERROR without throwing", () => {
  const r = LSPValidate.validate(null);
  assert(!r.ok);
  assert(hasError(r, "INTERNAL_ERROR"));
});

test("undefined input returns INTERNAL_ERROR without throwing", () => {
  const r = LSPValidate.validate(undefined);
  assert(!r.ok);
  assert(hasError(r, "INTERNAL_ERROR"));
});

test("array input returns INTERNAL_ERROR (rejected as non-object)", () => {
  const r = LSPValidate.validate([1, 2, 3]);
  assert(!r.ok);
  assert(hasError(r, "INTERNAL_ERROR"));
});

test("primitive input returns INTERNAL_ERROR", () => {
  const r = LSPValidate.validate("not a document");
  assert(!r.ok);
  assert(hasError(r, "INTERNAL_ERROR"));
});

// ─── Stage 1: schema-level violations ──────────────────────────────────────

test("missing lsp_version produces SCHEMA_VIOLATION", () => {
  const d = deepClone(MINIMAL); delete d.lsp_version;
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "SCHEMA_VIOLATION"));
});

test("lsp_version not SemVer produces SCHEMA_VIOLATION with humanized message", () => {
  const d = deepClone(MINIMAL); d.lsp_version = "1.0";
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  const err = r.errors.find((e) => e.code === "SCHEMA_VIOLATION");
  assert(err && /pattern/i.test(err.message), `expected pattern message, got "${err && err.message}"`);
});

test("wavelength below 180 nm produces SCHEMA_VIOLATION", () => {
  const d = deepClone(MINIMAL); d.laser.wavelength_nm = 100;
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "SCHEMA_VIOLATION"));
});

test("non-enum tissue produces SCHEMA_VIOLATION", () => {
  const d = deepClone(MINIMAL); d.exposure.tissue = "eye";
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "SCHEMA_VIOLATION"));
});

test("extra field on laser is rejected by additionalProperties", () => {
  const d = deepClone(MINIMAL); d.laser.color = "red";
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  const err = r.errors.find((e) => /Unexpected field/.test(e.message));
  assert(err, `expected an Unexpected field error, got ${JSON.stringify(r.errors)}`);
});

test("hybrid representation without both segments and samples fails Stage 1", () => {
  const d = deepClone(MINIMAL); d.pattern.representation = "hybrid";
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "SCHEMA_VIOLATION"));
});

// ─── Stage 2: pulsed laser must have pulse block ───────────────────────────

test("pulsed without pulse block produces PULSE_BLOCK_MISSING", () => {
  const d = deepClone(MINIMAL);
  d.laser.pulse_mode = "pulsed";
  // Note: with pulse=null the schema allows it (pulse is nullable), so Stage 1
  // passes and Stage 2 catches the inconsistency.
  d.laser.pulse = null;
  const r = LSPValidate.validate(d);
  assert(!r.ok, `expected failure but got ok=${r.ok}; errors: ${JSON.stringify(r.errors)}`);
  assert(hasError(r, "PULSE_BLOCK_MISSING"));
});

test("pulsed with pulse field absent produces PULSE_BLOCK_MISSING", () => {
  const d = deepClone(MINIMAL);
  d.laser.pulse_mode = "pulsed";
  // Do not set pulse at all
  const r = LSPValidate.validate(d);
  assert(!r.ok, `expected failure but got ok=${r.ok}; errors: ${JSON.stringify(r.errors)}`);
  assert(hasError(r, "PULSE_BLOCK_MISSING"));
});

test("pulsed with valid pulse block passes Stage 2", () => {
  const d = deepClone(MINIMAL);
  d.laser.pulse_mode = "pulsed";
  d.laser.pulse = {repetition_rate_hz: 100000, pulse_duration_s: 5e-9};
  const r = LSPValidate.validate(d);
  assert(r.ok, `expected ok but got errors: ${JSON.stringify(r.errors)}`);
});

// ─── Stage 2: duplicate segment IDs ────────────────────────────────────────

test("duplicate segment IDs produce DUPLICATE_SEGMENT_ID", () => {
  const d = deepClone(MINIMAL);
  d.pattern.segments = [
    {id: 7, type: "line", p0: [0, 0], p1: [1, 0],
     velocity: {mode: "constant", value_mm_per_s: 50},
     power: {mode: "constant", value: 0.01}},
    {id: 7, type: "line", p0: [1, 0], p1: [2, 0],
     velocity: {mode: "constant", value_mm_per_s: 50},
     power: {mode: "constant", value: 0.01}}
  ];
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "DUPLICATE_SEGMENT_ID"));
});

test("distinct segment IDs do not trigger DUPLICATE_SEGMENT_ID", () => {
  const d = deepClone(MINIMAL);
  d.pattern.segments = [
    {id: 0, type: "line", p0: [0, 0], p1: [1, 0],
     velocity: {mode: "constant", value_mm_per_s: 50},
     power: {mode: "constant", value: 0.01}},
    {id: 1, type: "line", p0: [1, 0], p1: [2, 0],
     velocity: {mode: "constant", value_mm_per_s: 50},
     power: {mode: "constant", value: 0.01}}
  ];
  const r = LSPValidate.validate(d);
  assert(r.ok);
});

// ─── Stage 2: authoritative=parameterized requires parameterized block ─────

test("authoritative=parameterized with no parameterized block produces AUTHORITATIVE_PARAMETERIZED_EMPTY", () => {
  const d = deepClone(MINIMAL);
  d.pattern.authoritative = "parameterized";
  // do not add parameterized block
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "AUTHORITATIVE_PARAMETERIZED_EMPTY"));
});

test("authoritative=parameterized with empty parameterized block produces AUTHORITATIVE_PARAMETERIZED_EMPTY", () => {
  const d = deepClone(MINIMAL);
  d.pattern.authoritative = "parameterized";
  d.pattern.parameterized = [];
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "AUTHORITATIVE_PARAMETERIZED_EMPTY"));
});

test("authoritative=parameterized with valid parameterized block passes", () => {
  const d = deepClone(MINIMAL);
  d.pattern.authoritative = "parameterized";
  d.pattern.parameterized = [{
    id: 0, shape: "linear",
    params: {line_length_mm: 1.0, scan_velocity_mm_s: 50, beam_diameter_mm: 0.5}
  }];
  const r = LSPValidate.validate(d);
  assert(r.ok);
});

// ─── Stage 2: empty loop block defaults ────────────────────────────────────

test("empty loop block does not crash the duration-ratio check", () => {
  const d = deepClone(MINIMAL);
  d.pattern.loop = {};
  const r = LSPValidate.validate(d);
  assert(r.ok, `empty loop should be valid: ${JSON.stringify(r.errors)}`);
});

test("loop with enabled=false and no other fields does not trigger duration warning", () => {
  const d = deepClone(MINIMAL);
  d.pattern.loop = {enabled: false};
  const r = LSPValidate.validate(d);
  assert(r.ok);
  assert(!hasWarning(r, "DURATION_RATIO_EXCEEDED"));
});

// ─── Stage 2: pulsed laser must have pulse block (legacy section removed) ──

// ─── Stage 2: unit conversion ──────────────────────────────────────────────

test("um length unit produces a warning but is otherwise valid", () => {
  const d = deepClone(MINIMAL);
  d.meta.units.length = "um";
  const r = LSPValidate.validate(d);
  assert(r.ok, `expected ok=true with a warning, got errors: ${JSON.stringify(r.errors)}`);
  assert(hasWarning(r, "UNIT_CONVERSION_UNSUPPORTED"));
});

test("rad length unit produces an error (Phase 1 limitation)", () => {
  const d = deepClone(MINIMAL);
  d.meta.units.length = "rad";
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "UNIT_CONVERSION_UNSUPPORTED"));
});

test("V length unit produces an error (Phase 1 limitation)", () => {
  const d = deepClone(MINIMAL);
  d.meta.units.length = "V";
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "UNIT_CONVERSION_UNSUPPORTED"));
});

test("normalized power unit produces an error (Phase 1 limitation)", () => {
  const d = deepClone(MINIMAL);
  d.meta.units.power = "normalized";
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "UNIT_CONVERSION_UNSUPPORTED"));
});

test("mW power unit produces a warning only", () => {
  const d = deepClone(MINIMAL);
  d.meta.units.power = "mW";
  const r = LSPValidate.validate(d);
  assert(r.ok, `expected ok=true with a warning, got errors: ${JSON.stringify(r.errors)}`);
  assert(hasWarning(r, "UNIT_CONVERSION_UNSUPPORTED"));
});

// ─── Stage 2: bounding box ─────────────────────────────────────────────────

test("segment outside extent_bbox produces a BBOX_VIOLATION warning", () => {
  const d = deepClone(MINIMAL);
  d.meta.extent_bbox = [[-0.5, -0.5], [0.5, 0.5]];
  d.pattern.segments = [{
    id: 0, type: "line",
    p0: [0, 0], p1: [10, 0],
    velocity: {mode: "constant", value_mm_per_s: 50},
    power: {mode: "constant", value: 0.01}
  }];
  const r = LSPValidate.validate(d);
  assert(r.ok, "bbox is a warning, not an error");
  assert(hasWarning(r, "BBOX_VIOLATION"));
});

test("segment inside extent_bbox does not warn", () => {
  const d = deepClone(MINIMAL);
  d.meta.extent_bbox = [[-1, -1], [1, 1]];
  const r = LSPValidate.validate(d);
  assert(r.ok);
  assert(!hasWarning(r, "BBOX_VIOLATION"));
});

test("samples-mode extent outside bbox warns once", () => {
  const d = deepClone(MINIMAL);
  d.meta.extent_bbox = [[-0.5, -0.5], [0.5, 0.5]];
  d.pattern = {
    representation: "samples",
    authoritative: "samples",
    samples: {sample_rate_hz: 1000, x: [0, 0.4, 5.0], y: [0, 0, 0]}
  };
  const r = LSPValidate.validate(d);
  assert(r.ok, `expected ok=true with a warning, got errors: ${JSON.stringify(r.errors)}`);
  assert(hasWarning(r, "BBOX_VIOLATION"));
});

// ─── Stage 2: samples consistency and caps ─────────────────────────────────

test("samples.y length mismatch with samples.x produces SAMPLES_ARRAY_LENGTH_MISMATCH", () => {
  const d = deepClone(MINIMAL);
  d.pattern = {
    representation: "samples",
    authoritative: "samples",
    samples: {sample_rate_hz: 1000, x: [0, 1, 2], y: [0, 0]}
  };
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "SAMPLES_ARRAY_LENGTH_MISMATCH"));
});

test("samples.power length mismatch produces SAMPLES_ARRAY_LENGTH_MISMATCH", () => {
  const d = deepClone(MINIMAL);
  d.pattern = {
    representation: "samples",
    authoritative: "samples",
    samples: {sample_rate_hz: 1000, x: [0, 1, 2], y: [0, 0, 0], power: [0.01, 0.01]}
  };
  const r = LSPValidate.validate(d);
  assert(!r.ok);
  assert(hasError(r, "SAMPLES_ARRAY_LENGTH_MISMATCH"));
});

test("samples over cap produces SAMPLES_OVER_CAP", () => {
  const d = deepClone(MINIMAL);
  // Build a small over-cap example using a custom cap
  d.pattern = {
    representation: "samples",
    authoritative: "samples",
    samples: {sample_rate_hz: 1000, x: [0, 1, 2, 3, 4], y: [0, 0, 0, 0, 0]}
  };
  const r = LSPValidate.validate(d, {maxSamples: 3});
  assert(!r.ok);
  assert(hasError(r, "SAMPLES_OVER_CAP"));
});

test("segments over cap produces SEGMENT_OVER_CAP", () => {
  const d = deepClone(MINIMAL);
  const r = LSPValidate.validate(d, {maxSegments: 0});
  assert(!r.ok);
  assert(hasError(r, "SEGMENT_OVER_CAP"));
});

// ─── Stage 2: degenerate segment detection ─────────────────────────────────

test("zero-length line segment produces SEGMENT_DEGENERATE warning", () => {
  const d = deepClone(MINIMAL);
  d.pattern.segments = [{
    id: 0, type: "line",
    p0: [1, 1], p1: [1, 1],
    velocity: {mode: "constant", value_mm_per_s: 50},
    power: {mode: "constant", value: 0.01}
  }];
  const r = LSPValidate.validate(d);
  assert(r.ok, "degenerate segments are warnings, not errors");
  assert(hasWarning(r, "SEGMENT_DEGENERATE"));
});

// ─── Stage 2: duration ratio cap ───────────────────────────────────────────

test("path duration much larger than exposure window produces DURATION_RATIO_EXCEEDED", () => {
  const d = deepClone(MINIMAL);
  // 1 mm at 0.001 mm/s = 1000 s; exposure_duration_s = 10 → ratio 100
  d.pattern.segments[0].velocity.value_mm_per_s = 0.001;
  d.exposure.exposure_duration_s = 1;
  const r = LSPValidate.validate(d);
  assert(hasWarning(r, "DURATION_RATIO_EXCEEDED"),
    `expected DURATION_RATIO_EXCEEDED warning; got warnings: ${JSON.stringify(r.warnings)}`);
});

test("normal path duration produces no DURATION_RATIO_EXCEEDED warning", () => {
  const r = LSPValidate.validate(MINIMAL);
  assert(r.ok);
  assert(!hasWarning(r, "DURATION_RATIO_EXCEEDED"));
});

test("looped pattern duration is accounted for in the ratio check", () => {
  const d = deepClone(MINIMAL);
  d.pattern.loop = {enabled: true, count: 1000, frame_gap_s: 1.0};
  d.exposure.exposure_duration_s = 1;
  const r = LSPValidate.validate(d);
  assert(hasWarning(r, "DURATION_RATIO_EXCEEDED"));
});

// ─── Stage 2: error-code stability ─────────────────────────────────────────

test("ERROR_CODES table is exposed and complete", () => {
  const codes = LSPValidate.ERROR_CODES;
  assert(codes && typeof codes === "object", "ERROR_CODES must be exposed");
  const expected = [
    "SCHEMA_VIOLATION", "AUTHORITATIVE_PARAMETERIZED_EMPTY",
    "BBOX_VIOLATION", "DURATION_RATIO_EXCEEDED", "DUPLICATE_SEGMENT_ID",
    "INTERNAL_ERROR", "NON_FINITE_NUMBER", "PULSE_BLOCK_MISSING",
    "SAMPLES_ARRAY_LENGTH_MISMATCH", "SAMPLES_OVER_CAP",
    "SEGMENT_DEGENERATE", "SEGMENT_OVER_CAP", "UNIT_CONVERSION_UNSUPPORTED",
    "UNKNOWN_LSP_VERSION"
  ];
  for (const code of expected) {
    assert(codes[code] === code, `ERROR_CODES.${code} should be the string "${code}"`);
  }
});

// ─── LSP schema version compatibility ──────────────────────────────────────

test("lsp_version 1.0.0 produces no version warning", () => {
  const d = deepClone(MINIMAL);
  d.lsp_version = "1.0.0";
  const r = LSPValidate.validate(d);
  assert(r.ok);
  assert(!hasWarning(r, "UNKNOWN_LSP_VERSION"),
    "1.0.0 should not warn");
});

test("lsp_version 1.5.3 produces no version warning", () => {
  const d = deepClone(MINIMAL);
  d.lsp_version = "1.5.3";
  const r = LSPValidate.validate(d);
  assert(r.ok);
  assert(!hasWarning(r, "UNKNOWN_LSP_VERSION"));
});

test("lsp_version 2.0.0 produces UNKNOWN_LSP_VERSION warning", () => {
  const d = deepClone(MINIMAL);
  d.lsp_version = "2.0.0";
  const r = LSPValidate.validate(d);
  assert(r.ok, "2.0.0 should still pass overall");
  assert(hasWarning(r, "UNKNOWN_LSP_VERSION"));
});

test("lsp_version 0.9.0 produces UNKNOWN_LSP_VERSION warning", () => {
  const d = deepClone(MINIMAL);
  d.lsp_version = "0.9.0";
  const r = LSPValidate.validate(d);
  assert(r.ok);
  assert(hasWarning(r, "UNKNOWN_LSP_VERSION"));
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\nLSP validator tests: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log(f);
process.exit(fail > 0 ? 1 : 0);
