/**
 * tests/lsp/test_worker.mjs
 *
 * Unit tests for web/lsp.worker.js.
 *
 * The worker is designed to run in a Web Worker context where `self` is the
 * worker's global scope.  In Node we simulate that environment by:
 *   1. Creating a sandbox object that mimics `self`
 *   2. Loading the engine into that sandbox (engine sets self.MPEEngine)
 *   3. Loading LSPCanonicalize into that sandbox (sets self.LSPCanonicalize)
 *   4. Loading lsp.worker.js into that sandbox via vm.runInContext
 *   5. Driving worker._processMessage with synthetic messages
 *   6. Collecting responses via self._testOnPostMessage
 *
 * This is faithful to how the worker behaves in the browser: every message
 * the test sends would also be a valid postMessage from the main thread, and
 * every response collected would also be a valid postMessage from the worker.
 *
 * The tests fall into five groups:
 *   A. Initialization protocol
 *   B. Canonicalize protocol
 *   C. Numerical equivalence (worker result must match direct canonicalization)
 *   D. Defensive behavior (malformed input, missing fields, etc.)
 *   E. Structural defenses added during adversarial audit (payload size cap,
 *      adversarial meta payload, circular references, deep nesting,
 *      postMessage failure fallback, real message-handler registration)
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;
const _failures = [];

function test(name, fn) {
  try {
    fn();
    _passed++;
  } catch (err) {
    _failed++;
    _failures.push({ name, message: err.message, stack: err.stack });
  }
}

function assert(cond, message) {
  if (!cond) {
    throw new Error("Assertion failed: " + (message || "(no message)"));
  }
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      "Expected " + JSON.stringify(expected) +
      " but got " + JSON.stringify(actual) +
      (message ? " (" + message + ")" : "")
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox factory: builds a fake worker context
// ─────────────────────────────────────────────────────────────────────────────

function makeWorkerSandbox() {
  const responses = [];
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Math: Math,
    JSON: JSON,
    Date: Date,
    Object: Object,
    Array: Array,
    Error: Error,
    TypeError: TypeError,
    RangeError: RangeError,
    Number: Number,
    String: String,
    Boolean: Boolean,
    Set: Set,
    Map: Map,
    isFinite: isFinite,
    isNaN: isNaN,
    parseInt: parseInt,
    parseFloat: parseFloat,
    // Test-only message capture
    _testOnPostMessage: function (msg) { responses.push(msg); }
  };
  // self is the worker's global; in our sandbox it must point at the sandbox
  // itself so the worker's `self.MPEEngine = ...` assignments are visible.
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);

  function loadScript(relPath) {
    const src = readFileSync(join(REPO_ROOT, relPath), "utf-8");
    vm.runInContext(src, sandbox, { filename: relPath });
  }

  // Load in the order the build script will inline them:
  //   1. engine.js
  //   2. canonicalize.js
  //   3. lsp.worker.js
  loadScript("web/engine.js");
  loadScript("web/lsp/canonicalize.js");
  loadScript("web/lsp.worker.js");

  return {
    sandbox: sandbox,
    responses: responses,
    send: function (msg) {
      sandbox._LSPWorker._processMessage({ data: msg });
    },
    nextResponse: function () {
      return responses.shift();
    },
    allResponses: function () { return responses.slice(); }
  };
}

// Load the standard once for all tests
const ICNIRP = JSON.parse(
  readFileSync(join(REPO_ROOT, "web/standards/icnirp_2013.json"), "utf-8")
);

// Direct access to LSPCanonicalize in Node for cross-checking worker output.
// We need Ajv loaded in the global so validate.js can pick it up; but for
// canonicalize-only tests we do not need validation.
const path = require("path");
const Ajv = require(join(REPO_ROOT, "web/node_modules/ajv/dist/2020.js")).default;
globalThis.Ajv2020 = Ajv;
globalThis.LSP_SCHEMA = JSON.parse(
  readFileSync(join(REPO_ROOT, "web/lsp/schema.json"), "utf-8")
);
const engineNode = require(join(REPO_ROOT, "web/engine.js"));
globalThis.MPEEngine = engineNode;
const LSPCanonicalizeNode = require(join(REPO_ROOT, "web/lsp/canonicalize.js"));
const LSPFactoryNode = require(join(REPO_ROOT, "web/lsp/factory.js"));

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a known-good LSP document
// ─────────────────────────────────────────────────────────────────────────────

function buildCwLinearDoc() {
  return LSPFactoryNode.linear({
    wavelength_nm: 532,
    beam_diameter_mm: 0.5,
    pulse_mode: "cw",
    average_power_w: 0.1,
    exposure_duration_s: 1.0,
    line_length_mm: 5,
    scan_velocity_mm_s: 50
  });
}

function buildPulsedRasterDoc() {
  return LSPFactoryNode.raster({
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
    scan_velocity_mm_s: 600
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A: Initialization protocol
// ─────────────────────────────────────────────────────────────────────────────

test("A1: init message returns ok=true and sets _initialized", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 1, standard: ICNIRP });
  const r = w.nextResponse();
  assert(r, "no response received");
  assertEq(r.type, "init_result");
  assertEq(r.requestId, 1);
  assertEq(r.ok, true);
  assertEq(w.sandbox._LSPWorker._isInitialized(), true);
});

test("A2: init with missing standard returns ok=false", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 2 });
  const r = w.nextResponse();
  assert(r, "no response");
  assertEq(r.ok, false);
  assert(/standard/.test(r.error || ""), "error should mention 'standard'");
  assertEq(w.sandbox._LSPWorker._isInitialized(), false);
});

test("A3: init with non-object standard returns ok=false", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 3, standard: "not-an-object" });
  const r = w.nextResponse();
  assertEq(r.ok, false);
});

test("A4: init can be retried after failure", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 4 });
  let r = w.nextResponse();
  assertEq(r.ok, false);
  w.send({ type: "init", requestId: 5, standard: ICNIRP });
  r = w.nextResponse();
  assertEq(r.ok, true);
  assertEq(w.sandbox._LSPWorker._isInitialized(), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B: Canonicalize protocol
// ─────────────────────────────────────────────────────────────────────────────

test("B1: canonicalize before init returns WORKER_NOT_INITIALIZED", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "canonicalize", requestId: 10, doc: buildCwLinearDoc() });
  const r = w.nextResponse();
  assertEq(r.type, "canonicalize_result");
  assertEq(r.ok, false);
  assert(r.errors && r.errors[0].code === "WORKER_NOT_INITIALIZED",
    "expected WORKER_NOT_INITIALIZED, got " + JSON.stringify(r.errors));
});

test("B2: canonicalize with missing doc returns PROTOCOL_ERROR", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 20, standard: ICNIRP });
  w.nextResponse();
  w.send({ type: "canonicalize", requestId: 21 });
  const r = w.nextResponse();
  assertEq(r.ok, false);
  assert(r.errors && r.errors[0].code === "PROTOCOL_ERROR");
});

test("B3: canonicalize with valid CW linear doc returns engine segments", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 30, standard: ICNIRP });
  w.nextResponse();
  w.send({ type: "canonicalize", requestId: 31, doc: buildCwLinearDoc() });
  const r = w.nextResponse();
  assertEq(r.type, "canonicalize_result");
  assertEq(r.ok, true);
  assert(Array.isArray(r.engineSegments), "engineSegments must be an array");
  assert(r.engineSegments.length > 0, "engineSegments must be non-empty");
  assert(r.beam && typeof r.beam === "object", "beam must be an object");
  assert(typeof r.totalTime_s === "number" && r.totalTime_s > 0,
    "totalTime_s must be positive");
});

test("B4: canonicalize with valid pulsed raster doc returns scanParams", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 40, standard: ICNIRP });
  w.nextResponse();
  w.send({ type: "canonicalize", requestId: 41, doc: buildPulsedRasterDoc() });
  const r = w.nextResponse();
  assertEq(r.ok, true);
  // Parameterized raster preset should route through the fast separable path,
  // which means scanParams must be non-null.
  assert(r.scanParams !== null,
    "expected scanParams to be set for parameterized raster, got " +
    JSON.stringify(r.scanParams));
});

test("B5: canonicalize with malformed doc returns structured errors", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 50, standard: ICNIRP });
  w.nextResponse();
  w.send({ type: "canonicalize", requestId: 51, doc: {} });
  const r = w.nextResponse();
  assertEq(r.ok, false);
  assert(Array.isArray(r.errors) && r.errors.length > 0,
    "errors array must be non-empty");
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C: Numerical equivalence to direct canonicalization
//
// The single most important property of the worker is that it produces
// numerically identical output to a direct canonicalize() call on the same
// document.  Any drift here would be a real-world safety regression.
// ─────────────────────────────────────────────────────────────────────────────

function hashEngineSegments(segs) {
  // Stable serialization for equality comparison; floating-point fields are
  // compared bit-for-bit since the worker should produce identical numbers.
  return JSON.stringify(segs.map(s => ({
    x: s.x_start_mm,
    y: s.y_start_mm,
    a: s.angle_rad,
    v: s.v_mm_s,
    b: s.blanked || false
  })));
}

/**
 * Recursive deep-equal that compares NaN to NaN as equal and Infinity to
 * Infinity as equal (unlike JSON.stringify which converts both to null).
 */
function deepEqual(a, b, path) {
  path = path || "";
  if (a === b) return null;
  if (typeof a !== typeof b) return path + ": type mismatch (" + typeof a + " vs " + typeof b + ")";
  if (typeof a === "number") {
    if (isNaN(a) && isNaN(b)) return null;
    return path + ": numeric mismatch (" + a + " vs " + b + ")";
  }
  if (a === null || b === null) return path + ": null mismatch (" + a + " vs " + b + ")";
  if (typeof a !== "object") return path + ": value mismatch (" + a + " vs " + b + ")";
  if (Array.isArray(a) !== Array.isArray(b)) return path + ": array vs non-array";
  if (Array.isArray(a)) {
    if (a.length !== b.length) return path + ": array length mismatch (" + a.length + " vs " + b.length + ")";
    for (let i = 0; i < a.length; i++) {
      const err = deepEqual(a[i], b[i], path + "[" + i + "]");
      if (err) return err;
    }
    return null;
  }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return path + ": key count mismatch";
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return path + ": key mismatch (" + aKeys[i] + " vs " + bKeys[i] + ")";
  }
  for (const k of aKeys) {
    const err = deepEqual(a[k], b[k], path + "." + k);
    if (err) return err;
  }
  return null;
}

function assertDeepEqual(actual, expected, label) {
  const diff = deepEqual(actual, expected, "");
  if (diff !== null) {
    throw new Error("deepEqual mismatch" + (label ? " (" + label + ")" : "") + ": " + diff);
  }
}

test("C1: worker output matches direct canonicalize for CW linear", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 60, standard: ICNIRP });
  w.nextResponse();
  const doc = buildCwLinearDoc();
  w.send({ type: "canonicalize", requestId: 61, doc: doc });
  const r = w.nextResponse();
  const direct = LSPCanonicalizeNode.canonicalize(doc);
  assertEq(r.ok, direct.ok);
  assertEq(r.engineSegments.length, direct.engineSegments.length);
  assertDeepEqual(r.engineSegments, direct.engineSegments, "engineSegments");
  assertEq(r.totalTime_s, direct.totalTime_s);
  assertDeepEqual(r.beam, direct.beam, "beam (CW)");
});

test("C2: worker output matches direct canonicalize for pulsed raster", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 70, standard: ICNIRP });
  w.nextResponse();
  const doc = buildPulsedRasterDoc();
  w.send({ type: "canonicalize", requestId: 71, doc: doc });
  const r = w.nextResponse();
  const direct = LSPCanonicalizeNode.canonicalize(doc);
  assertEq(r.ok, direct.ok);
  assertDeepEqual(r.engineSegments, direct.engineSegments, "engineSegments");
  assertDeepEqual(r.scanParams, direct.scanParams, "scanParams");
  assertDeepEqual(r.beam, direct.beam, "beam (pulsed)");
});

test("C3: worker output matches direct canonicalize for pulsed bidi", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 80, standard: ICNIRP });
  w.nextResponse();
  const doc = LSPFactoryNode.bidiRaster({
    wavelength_nm: 1310, beam_diameter_mm: 0.020, pulse_mode: "pulsed",
    pulse_repetition_hz: 100000, pulse_duration_s: 6.5e-6, pulse_energy_j: 1e-7,
    exposure_duration_s: 10.0, line_length_mm: 6.0, n_lines: 50, hatch_mm: 0.020,
    scan_velocity_mm_s: 600
  });
  w.send({ type: "canonicalize", requestId: 81, doc: doc });
  const r = w.nextResponse();
  const direct = LSPCanonicalizeNode.canonicalize(doc);
  assertEq(r.ok, true);
  assertEq(direct.ok, true);
  assertDeepEqual(r.engineSegments, direct.engineSegments, "engineSegments (bidi)");
  assertDeepEqual(r.scanParams, direct.scanParams, "scanParams (bidi)");
  assertDeepEqual(r.beam, direct.beam, "beam (bidi)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Group D: Defensive behavior
// ─────────────────────────────────────────────────────────────────────────────

test("D1: unknown message type returns PROTOCOL_ERROR", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 90, standard: ICNIRP });
  w.nextResponse();
  w.send({ type: "do_a_backflip", requestId: 91 });
  const r = w.nextResponse();
  assertEq(r.ok, false);
  assert(r.errors && r.errors[0].code === "PROTOCOL_ERROR");
});

test("D2: message with no .data field is handled gracefully", () => {
  const w = makeWorkerSandbox();
  w.sandbox._LSPWorker._processMessage({});
  const r = w.nextResponse();
  assert(r, "should still respond even with no .data");
  assertEq(r.ok, false);
});

test("D3: message with non-object data is handled gracefully", () => {
  const w = makeWorkerSandbox();
  w.sandbox._LSPWorker._processMessage({ data: "hello" });
  const r = w.nextResponse();
  assertEq(r.ok, false);
});

test("D4: canonicalize with null doc is handled gracefully", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 100, standard: ICNIRP });
  w.nextResponse();
  w.send({ type: "canonicalize", requestId: 101, doc: null });
  const r = w.nextResponse();
  assertEq(r.ok, false);
});

test("D5: requestId is correctly echoed in every response", () => {
  const w = makeWorkerSandbox();
  for (let id = 110; id < 115; id++) {
    w.send({ type: "init", requestId: id, standard: ICNIRP });
    const r = w.nextResponse();
    assertEq(r.requestId, id, "requestId for init " + id);
  }
});

test("D6: worker survives a canonicalize failure and handles next message", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 120, standard: ICNIRP });
  w.nextResponse();
  // Send a malformed doc, get an error
  w.send({ type: "canonicalize", requestId: 121, doc: {} });
  const r1 = w.nextResponse();
  assertEq(r1.ok, false);
  // Then send a valid doc — worker should still work
  w.send({ type: "canonicalize", requestId: 122, doc: buildCwLinearDoc() });
  const r2 = w.nextResponse();
  assertEq(r2.ok, true);
});

test("D7: messages without requestId default to -1", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", standard: ICNIRP });
  const r = w.nextResponse();
  assertEq(r.requestId, -1);
});

// ─── Group E: Structural defenses (added during adversarial audit) ──────

test("E1: array-typed doc is rejected with PROTOCOL_ERROR", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 200, standard: ICNIRP });
  w.nextResponse();
  w.send({ type: "canonicalize", requestId: 201, doc: [1, 2, 3] });
  const r = w.nextResponse();
  assertEq(r.ok, false);
  assert(r.errors && r.errors[0].code === "PROTOCOL_ERROR",
    "expected PROTOCOL_ERROR for array doc");
});

test("E2: oversized document returns PAYLOAD_TOO_LARGE", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 210, standard: ICNIRP });
  w.nextResponse();
  // Build a synthetic doc with many segments to exceed the 10 MB cap.
  // 50000 segments × 256 bytes each = ~12.8 MB estimated size.
  const segments = [];
  for (let i = 0; i < 50000; i++) {
    segments.push({
      id: i, type: "line", p0: [i, 0], p1: [i + 1, 0],
      velocity: { mode: "constant", value_mm_per_s: 50 },
      power: { mode: "constant", value: 0.1 }
    });
  }
  const doc = {
    lsp_version: "1.0.0",
    meta: { units: { length: "mm", time: "s", power: "W" } },
    laser: { wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw" },
    exposure: { tissue: "skin", exposure_duration_s: 1.0 },
    pattern: { representation: "segments", authoritative: "segments",
               default_power_w: 0.1, segments: segments }
  };
  w.send({ type: "canonicalize", requestId: 211, doc: doc });
  const r = w.nextResponse();
  assertEq(r.ok, false);
  assert(r.errors && r.errors[0].code === "PAYLOAD_TOO_LARGE",
    "expected PAYLOAD_TOO_LARGE, got " + (r.errors ? r.errors[0].code : "no errors"));
});

test("E3: doc just below the size cap is processed normally", () => {
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 220, standard: ICNIRP });
  w.nextResponse();
  // 1000 segments is ~250 KB estimated — well below the 10 MB cap.
  const segments = [];
  for (let i = 0; i < 1000; i++) {
    segments.push({
      id: i, type: "line",
      p0: [i * 0.001, 0], p1: [(i + 1) * 0.001, 0],
      velocity: { mode: "constant", value_mm_per_s: 50 },
      power: { mode: "constant", value: 0.1 }
    });
  }
  const doc = {
    lsp_version: "1.0.0",
    meta: { units: { length: "mm", time: "s", power: "W" } },
    laser: { wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw" },
    exposure: { tissue: "skin", exposure_duration_s: 1.0 },
    pattern: { representation: "segments", authoritative: "segments",
               default_power_w: 0.1, segments: segments }
  };
  w.send({ type: "canonicalize", requestId: 221, doc: doc });
  const r = w.nextResponse();
  assertEq(r.ok, true, "below-cap doc should succeed: " +
    (r.errors ? JSON.stringify(r.errors) : "(no errors field)"));
});

test("E4: init when MPEEngine is missing returns ENGINE_NOT_LOADED", () => {
  // Build a partial sandbox where MPEEngine is deleted before the worker is
  // loaded.  This simulates a misconfigured build script that forgot to
  // inline __ENGINE_SOURCE__.
  const responses = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Math, JSON, Date, Object, Array,
    Error, TypeError, RangeError, Number, String, Boolean,
    Set, Map,
    isFinite, isNaN, parseInt, parseFloat,
    _testOnPostMessage: (msg) => responses.push(msg)
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // Intentionally do NOT load engine.js.  Load only canonicalize.js (which
  // exposes self.LSPCanonicalize) and the worker.  Canonicalize is loaded
  // first so we can confirm the worker's check finds MPEEngine missing,
  // not LSPCanonicalize.
  const canonSrc = readFileSync(join(REPO_ROOT, "web/lsp/canonicalize.js"), "utf-8");
  vm.runInContext(canonSrc, sandbox);
  const workerSrc = readFileSync(join(REPO_ROOT, "web/lsp.worker.js"), "utf-8");
  vm.runInContext(workerSrc, sandbox);

  sandbox._LSPWorker._processMessage({ data: { type: "init", requestId: 230, standard: ICNIRP }});
  const r = responses.shift();
  assertEq(r.type, "init_result");
  assertEq(r.ok, false);
  assertEq(r.errorCode, "ENGINE_NOT_LOADED");
});

test("E5: init when LSPCanonicalize is missing returns ENGINE_NOT_LOADED", () => {
  // Similar to E4 but with the engine present and LSPCanonicalize missing.
  const responses = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Math, JSON, Date, Object, Array,
    Error, TypeError, RangeError, Number, String, Boolean,
    Set, Map,
    isFinite, isNaN, parseInt, parseFloat,
    _testOnPostMessage: (msg) => responses.push(msg)
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/engine.js"), "utf-8"), sandbox);
  // Skip canonicalize.
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/lsp.worker.js"), "utf-8"), sandbox);

  sandbox._LSPWorker._processMessage({ data: { type: "init", requestId: 240, standard: ICNIRP }});
  const r = responses.shift();
  assertEq(r.type, "init_result");
  assertEq(r.ok, false);
  assertEq(r.errorCode, "ENGINE_NOT_LOADED");
});

test("E6: postMessage failure triggers fallback response", () => {
  // Create a sandbox whose postMessage throws on the first call (simulating a
  // structured-clone failure on the result payload), and verify the worker
  // sends a fallback INTERNAL_ERROR response on the second call.
  const responses = [];
  let postCallCount = 0;
  const sandbox = {
    console, setTimeout, clearTimeout, Math, JSON, Date, Object, Array,
    Error, TypeError, RangeError, Number, String, Boolean,
    Set, Map,
    isFinite, isNaN, parseInt, parseFloat
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  // Define postMessage as a function that throws on the first call.
  sandbox.postMessage = function (msg) {
    postCallCount++;
    if (postCallCount === 1) throw new Error("simulated structured-clone failure");
    responses.push(msg);
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/engine.js"), "utf-8"), sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/lsp/canonicalize.js"), "utf-8"), sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/lsp.worker.js"), "utf-8"), sandbox);

  // Init will succeed because we send a simple message.
  sandbox._LSPWorker._processMessage({ data: { type: "init", requestId: 250, standard: ICNIRP }});
  // The init's postMessage was call #1, which threw.  The fallback was call
  // #2, which succeeded.  So responses contains one fallback response.
  assertEq(responses.length, 1, "expected one fallback response after first failure");
  assertEq(responses[0].ok, false);
  assert(responses[0].errors && responses[0].errors[0].code === "INTERNAL_ERROR",
    "expected INTERNAL_ERROR in fallback response");
  assert(/structured-clone/.test(responses[0].errors[0].message),
    "expected fallback message to mention structured-clone");
});

test("E7: adversarial meta payload triggers PAYLOAD_TOO_LARGE", () => {
  // The schema allows additionalProperties:true on meta.  An adversary could
  // include a 20 MB string under meta.adversarial to bypass the structural
  // segment-count check.  The walking estimator must catch this without
  // allocating its own multi-MB copy of the doc.
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 300, standard: ICNIRP });
  w.nextResponse();
  // Build a 12 MB string (each char ~2 bytes in UTF-16 = 24 MB in-memory).
  // The walking estimator should reject this far below MAX_DOC_BYTES.
  const bigString = "x".repeat(12 * 1024 * 1024);
  const doc = {
    lsp_version: "1.0.0",
    meta: { units: { length: "mm", time: "s", power: "W" }, adversarial: bigString },
    laser: { wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw" },
    exposure: { tissue: "skin", exposure_duration_s: 1.0 },
    pattern: { representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{ id: 0, type: "line", p0: [0, 0], p1: [5, 0],
        velocity: { mode: "constant", value_mm_per_s: 50 },
        power: { mode: "constant", value: 0.1 }}]}
  };
  w.send({ type: "canonicalize", requestId: 301, doc: doc });
  const r = w.nextResponse();
  assertEq(r.ok, false);
  assert(r.errors && r.errors[0].code === "PAYLOAD_TOO_LARGE",
    "expected PAYLOAD_TOO_LARGE for huge meta string, got " +
    (r.errors ? r.errors[0].code : "no errors"));
});

test("E8: doc with circular reference does not loop forever", () => {
  // Cycle detection in the walking estimator must stop the walk before it
  // exhausts the stack or hangs.  Structured-clone strips cycles, but the
  // test harness can construct them directly.
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 310, standard: ICNIRP });
  w.nextResponse();
  const doc = {
    lsp_version: "1.0.0",
    meta: { units: { length: "mm", time: "s", power: "W" } },
    laser: { wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw" },
    exposure: { tissue: "skin", exposure_duration_s: 1.0 },
    pattern: { representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{ id: 0, type: "line", p0: [0, 0], p1: [5, 0],
        velocity: { mode: "constant", value_mm_per_s: 50 },
        power: { mode: "constant", value: 0.1 }}]}
  };
  // Introduce a cycle: doc.meta.self = doc.meta
  doc.meta.self = doc.meta;
  // Bound the test by setting a real-time timeout via setImmediate fallback.
  // If the estimator hangs, the test runner will fail by timing out.
  const startMs = Date.now();
  w.send({ type: "canonicalize", requestId: 311, doc: doc });
  const r = w.nextResponse();
  const elapsedMs = Date.now() - startMs;
  assert(elapsedMs < 2000, "circular-ref canonicalize took too long: " + elapsedMs + " ms");
  // Either the document is processed normally (the cycle is small) or
  // rejected — either is acceptable as long as we did not hang.
  assert(typeof r.ok === "boolean", "expected boolean ok field");
});

test("E9: doc with deeply nested meta does not blow the JS stack", () => {
  // Iterative walk (explicit stack) instead of recursive walk.  A 10,000-deep
  // nested object would blow Node's default 10,000-frame call stack with a
  // recursive estimator; the iterative walk must handle it without throwing.
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 320, standard: ICNIRP });
  w.nextResponse();
  // Build a 5000-level nested object.  Each level is ~24 bytes object header
  // in the estimator's accounting, so total walked bytes ~= 120 KB, well
  // below the 10 MB cap.
  let nested = {};
  let cur = nested;
  for (let i = 0; i < 5000; i++) {
    cur.child = {};
    cur = cur.child;
  }
  const doc = {
    lsp_version: "1.0.0",
    meta: { units: { length: "mm", time: "s", power: "W" }, deep: nested },
    laser: { wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw" },
    exposure: { tissue: "skin", exposure_duration_s: 1.0 },
    pattern: { representation: "segments", authoritative: "segments", default_power_w: 0.1,
      segments: [{ id: 0, type: "line", p0: [0, 0], p1: [5, 0],
        velocity: { mode: "constant", value_mm_per_s: 50 },
        power: { mode: "constant", value: 0.1 }}]}
  };
  w.send({ type: "canonicalize", requestId: 321, doc: doc });
  const r = w.nextResponse();
  // Worker should NOT crash with a stack overflow.  Result may succeed (deep
  // nesting under cap) or fail with a canonicalization error — either is fine,
  // we only care that no exception escaped the worker.
  assert(typeof r.ok === "boolean", "expected boolean ok field");
});

test("E10: worker registers a real message handler via addEventListener", () => {
  // The previous tests drive _processMessage directly.  This test verifies
  // that the worker correctly wires its handler through self.addEventListener
  // (or falls back to self.onmessage) in environments that support it.  A
  // typo in the wiring code would otherwise only surface in production.
  const responses = [];
  let registeredHandler = null;
  const sandbox = {
    console, setTimeout, clearTimeout, Math, JSON, Date, Object, Array,
    Error, TypeError, RangeError, Number, String, Boolean,
    Set, Map,
    isFinite, isNaN, parseInt, parseFloat,
    _testOnPostMessage: function (r) { responses.push(r); }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  // Simulate the real Worker's addEventListener API by capturing the handler.
  sandbox.addEventListener = function (eventName, handler) {
    if (eventName === "message") registeredHandler = handler;
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/engine.js"), "utf-8"), sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/lsp/canonicalize.js"), "utf-8"), sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/lsp.worker.js"), "utf-8"), sandbox);

  assert(typeof registeredHandler === "function",
    "expected the worker to register a 'message' event listener");

  // Drive an init message through the registered handler and confirm it
  // behaves identically to a direct _processMessage call.
  registeredHandler({ data: { type: "init", requestId: 999, standard: ICNIRP }});
  assertEq(responses.length, 1, "expected one response from real handler");
  assertEq(responses[0].type, "init_result");
  assertEq(responses[0].ok, true);
});

test("E11: worker falls back to self.onmessage when addEventListener absent", () => {
  // Same idea as E10 but for environments where addEventListener does not
  // exist (legacy or test contexts).  The worker should write to self.onmessage.
  const sandbox = {
    console, setTimeout, clearTimeout, Math, JSON, Date, Object, Array,
    Error, TypeError, RangeError, Number, String, Boolean,
    Set, Map,
    isFinite, isNaN, parseInt, parseFloat,
    _testOnPostMessage: function (r) { /* not used here */ }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  // Intentionally do NOT define addEventListener.
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/engine.js"), "utf-8"), sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/lsp/canonicalize.js"), "utf-8"), sandbox);
  vm.runInContext(readFileSync(join(REPO_ROOT, "web/lsp.worker.js"), "utf-8"), sandbox);

  assert(typeof sandbox.onmessage === "function",
    "expected the worker to set self.onmessage as a fallback");
});

test("E12: init_result error shape is unified with canonicalize_result", () => {
  // The init_result failure shape includes legacy {error, errorCode} top-level
  // fields AND a new errors:[{code,path,message}] array.  The array form
  // matches canonicalize_result.errors so a single client-side error handler
  // can route both response types.  This test locks in the contract.
  const w = makeWorkerSandbox();
  w.send({ type: "init", requestId: 400 });  // missing standard
  const r = w.nextResponse();
  assertEq(r.type, "init_result");
  assertEq(r.ok, false);
  // Legacy fields:
  assert(typeof r.error === "string", "expected r.error to be a string");
  assertEq(r.errorCode, "PROTOCOL_ERROR");
  // Unified errors array:
  assert(Array.isArray(r.errors), "expected r.errors to be an array");
  assertEq(r.errors.length, 1);
  assertEq(r.errors[0].code, "PROTOCOL_ERROR");
  assertEq(r.errors[0].message, r.error,
    "errors[0].message should match the legacy r.error string");
  assert(typeof r.errors[0].path === "string", "errors[0].path must be a string");
});

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("LSP worker tests: " + _passed + " passed, " + _failed + " failed");
if (_failed > 0) {
  console.log("");
  for (const f of _failures) {
    console.log("FAIL: " + f.name);
    console.log("  " + f.message);
  }
  process.exit(1);
}
