/**
 * tests/lsp/test_ui_helpers.mjs
 *
 * Unit tests for the LSP UI integration helpers added in Sub-phase 1D
 * commit 2.  These helpers live inside web/calculator.jsx because that
 * file is where the rest of the React UI lives, but they are pure
 * functions (no React state, no DOM access) and can be tested in
 * isolation by loading the relevant slice of calculator.jsx into a
 * sandboxed vm context.
 *
 * Targets:
 *   _readAndValidateLSP — parse + Stage 1 + Stage 2 entry point
 *   _lspBeamToShort     — full-name to short-name beam translator
 *   _lspStatusLabel     — UI badge label from lspState
 *
 * The PatternSource React component itself is rendered through the
 * end-to-end bundle test in a later commit (commit 3).  For commit 2 we
 * smoke-test only that the component is defined and accepts the
 * documented props without throwing.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const BUNDLE_PATH = join(REPO_ROOT, "web/index.html");

let _passed = 0;
let _failed = 0;
const _failures = [];

function syncTest(name, fn) {
  try { fn(); _passed++; }
  catch (err) { _failed++; _failures.push({ name, message: err.message, stack: err.stack }); }
}

async function asyncTest(name, fn) {
  try { await fn(); _passed++; }
  catch (err) { _failed++; _failures.push({ name, message: err.message, stack: err.stack }); }
}

function assert(cond, message) {
  if (!cond) throw new Error("Assertion failed: " + (message || ""));
}
function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error("Expected " + JSON.stringify(expected) +
      " but got " + JSON.stringify(actual) +
      (message ? " (" + message + ")" : ""));
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Build a sandbox that has Ajv + LSP_SCHEMA + LSPValidate + the LSP UI
// helpers loaded, by extracting their <script> blocks from the bundle and
// executing them in a vm context.
//
// The helpers live inside the main React script block, which is JSX
// (precompiled to plain JS).  We need to be careful: that block runs
// ReactDOM.createRoot(...) at the end, which will fail in the sandbox
// because there's no DOM.  We strip the render call before executing.
// ─────────────────────────────────────────────────────────────────────────

const html = readFileSync(BUNDLE_PATH, "utf-8");

function findScriptBlockContaining(text, marker, includeBabel) {
  let pos = 0;
  while (true) {
    const idx = text.indexOf("<script", pos);
    if (idx < 0) return null;
    const endOpen = text.indexOf(">", idx);
    if (endOpen < 0) return null;
    const opening = text.slice(idx, endOpen + 1);
    if (/\bsrc=/.test(opening)) { pos = endOpen + 1; continue; }
    const isBabel = /type\s*=\s*["']text\/babel["']/i.test(opening);
    if (!includeBabel && isBabel) { pos = endOpen + 1; continue; }
    const close = text.indexOf("</script>", endOpen);
    if (close < 0) return null;
    const body = text.slice(endOpen + 1, close);
    if (body.includes(marker)) return body;
    pos = close + 9;
  }
}

function isRuntimeBabelBundle(text) {
  // Detect whether the bundle was built in runtime-Babel mode (JSX body
  // in <script type="text/babel">) or pre-compiled mode (plain JS body in
  // <script>).  The test cannot exec JSX in Node's vm; if the bundle is
  // in runtime-Babel mode, we skip with a clear notice.
  return findScriptBlockContaining(text, "function _readAndValidateLSP", true) !== null
      && findScriptBlockContaining(text, "function _readAndValidateLSP", false) === null;
}

function makeSandbox() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, Object, Array, Set, Map, WeakMap, WeakSet,
    Error, TypeError, RangeError, SyntaxError,
    Number, String, Boolean, Symbol, Promise,
    isFinite, isNaN, parseInt, parseFloat,
    RegExp, ArrayBuffer, Uint8Array, Int32Array, Float64Array,
    Reflect, Proxy
  };
  // Browser convention: `window` and `globalThis` alias the global object.
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // Minimal React shim that returns plain JS objects representing elements.
  // Enough to verify the PatternSource component runs without DOM access.
  sandbox.React = {
    createElement: function (type, props /* , ...children */) {
      var children = Array.prototype.slice.call(arguments, 2);
      return { type: type, props: props || {}, children: children };
    },
    useState: function (initial) {
      return [initial, function () { /* noop in shim */ }];
    },
    useRef: function (initial) {
      return { current: initial };
    },
    useEffect: function () { /* noop */ },
    useMemo: function (fn) { return fn(); }
  };
  // calculator.jsx aliases these from React above
  sandbox.useState = sandbox.React.useState;
  sandbox.useEffect = sandbox.React.useEffect;
  sandbox.useMemo = sandbox.React.useMemo;
  sandbox.useRef = sandbox.React.useRef;

  vm.createContext(sandbox);
  return sandbox;
}

function loadMainThreadLSP(sandbox) {
  // Load Ajv, schema, validator — same blocks the bundle test verifies.
  const ajv = findScriptBlockContaining(html, "globalThis.Ajv2020");
  const schema = findScriptBlockContaining(html, "var LSP_SCHEMA = ");
  const validate = findScriptBlockContaining(html, "root.LSPValidate = LSPValidate");
  if (!ajv || !schema || !validate) {
    throw new Error("could not find Ajv/schema/validate blocks in bundle");
  }
  vm.runInContext(ajv, sandbox, { filename: "ajv" });
  vm.runInContext(schema, sandbox, { filename: "schema" });
  vm.runInContext(validate, sandbox, { filename: "validate" });
}

function extractHelpersFromCalculator() {
  // The main React block has type="text/babel" only in the runtime-Babel
  // fallback build, or is a plain <script> in pre-compiled builds.  We
  // want pre-compiled (which CI now produces).  Find the block that
  // contains _readAndValidateLSP.
  // Look in both flavours: with and without text/babel.
  let body = findScriptBlockContaining(html, "function _readAndValidateLSP", false);
  if (!body) {
    body = findScriptBlockContaining(html, "_readAndValidateLSP", false);
  }
  if (!body) {
    throw new Error("could not find _readAndValidateLSP in any script block");
  }
  // Strip the ReactDOM.createRoot(...).render(...) call at the end so the
  // sandbox doesn't need a DOM.
  body = body.replace(/ReactDOM\.createRoot\([^)]*\)\.render\([^)]*\);?\s*$/m, "");
  // Strip the Recharts destructuring at the top — that requires Recharts
  // global which we don't set up in this test.  We don't need it for the
  // helpers we're testing.
  body = body.replace(/var\s+LineChart\s*=\s*Recharts[\s\S]+?;\s*\n/, "");
  body = body.replace(/var\s+useState\s*=\s*React\.useState[\s\S]+?;\s*\n/, "");
  return body;
}

function loadHelpers(sandbox) {
  const body = extractHelpersFromCalculator();
  // The bundle's main React block is large and may have top-level uses of
  // things we don't set up in the test sandbox (Recharts, DOM nodes via
  // ReactDOM.createRoot, etc.).  We strip the known-failing parts in
  // extractHelpersFromCalculator and tolerate any remaining downstream
  // errors — but ONLY after verifying our target helpers were defined
  // before the throw.  Without that check, a syntax error in the helpers
  // themselves would silently pass the test suite by being swallowed.
  let loadError = null;
  try {
    vm.runInContext(body, sandbox, { filename: "calculator-helpers" });
  } catch (e) {
    loadError = e;
  }
  // Verify the four target helpers we test are defined.  If any are
  // missing, surface the original load error so a real bug isn't masked.
  const required = ["_readAndValidateLSP", "_lspBeamToShort",
                    "_lspStatusLabel", "PatternSource"];
  const missing = [];
  for (const name of required) {
    vm.runInContext(`globalThis._t = typeof ${name};`, sandbox);
    if (sandbox._t === "undefined") missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error("Helpers not loaded into sandbox: " + missing.join(", ") +
      (loadError ? ".  Underlying load error: " + loadError.message : ""));
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

if (isRuntimeBabelBundle(html)) {
  console.log("LSP UI helper tests: SKIPPED (bundle is in runtime-Babel mode; " +
              "tests require pre-compiled JSX, which requires 'cd web && npm install' " +
              "before 'python3 web/build.py').  This is the normal developer-skip path; " +
              "CI always uses pre-compiled mode and runs these tests.");
  process.exit(0);
}

const sandbox = makeSandbox();
loadMainThreadLSP(sandbox);
loadHelpers(sandbox);

syncTest("_lspBeamToShort: translates full-name to short-name", () => {
  vm.runInContext(`
    globalThis._r = _lspBeamToShort({
      d_1e_mm: 0.5, wl_nm: 532, tau_s: 0, prf_hz: 0,
      pulse_energy_J: 0, avg_power_W: 0.1, is_cw: true
    });
  `, sandbox);
  const r = sandbox._r;
  assertEq(r.d, 0.5); assertEq(r.wl, 532); assertEq(r.tau, 0);
  assertEq(r.prf, 0); assertEq(r.Ep, 0); assertEq(r.P, 0.1);
  assertEq(r.cw, true);
});

syncTest("_lspBeamToShort: pulsed beam with energy", () => {
  vm.runInContext(`
    globalThis._r = _lspBeamToShort({
      d_1e_mm: 0.020, wl_nm: 1310, tau_s: 6.5e-6, prf_hz: 100000,
      pulse_energy_J: 1e-7, avg_power_W: 0.01, is_cw: false
    });
  `, sandbox);
  const r = sandbox._r;
  assertEq(r.d, 0.020); assertEq(r.wl, 1310); assertEq(r.tau, 6.5e-6);
  assertEq(r.prf, 100000); assertEq(r.Ep, 1e-7); assertEq(r.P, 0.01);
  assertEq(r.cw, false);
});

syncTest("_lspBeamToShort: null input returns null", () => {
  vm.runInContext(`globalThis._r = _lspBeamToShort(null);`, sandbox);
  assertEq(sandbox._r, null);
});

syncTest("_lspBeamToShort: undefined input returns null", () => {
  vm.runInContext(`globalThis._r = _lspBeamToShort(undefined);`, sandbox);
  assertEq(sandbox._r, null);
});

syncTest("_lspBeamToShort: non-object input returns null", () => {
  vm.runInContext(`globalThis._r = _lspBeamToShort("not a beam");`, sandbox);
  assertEq(sandbox._r, null);
});

syncTest("_lspStatusLabel: idle phase", () => {
  vm.runInContext(`globalThis._r = _lspStatusLabel({phase: "idle"});`, sandbox);
  assertEq(sandbox._r, "Preset: Built-in");
});

syncTest("_lspStatusLabel: null state", () => {
  vm.runInContext(`globalThis._r = _lspStatusLabel(null);`, sandbox);
  assertEq(sandbox._r, "Preset: Built-in");
});

syncTest("_lspStatusLabel: loading phase", () => {
  vm.runInContext(`globalThis._r = _lspStatusLabel({phase: "loading"});`, sandbox);
  assertEq(sandbox._r, "Loading\u2026");
});

syncTest("_lspStatusLabel: loaded phase with filename", () => {
  vm.runInContext(
    `globalThis._r = _lspStatusLabel({phase: "loaded", filename: "treatment.lsp.json"});`,
    sandbox);
  assertEq(sandbox._r, "Imported: treatment.lsp.json");
});

syncTest("_lspStatusLabel: error phase", () => {
  vm.runInContext(`globalThis._r = _lspStatusLabel({phase: "error"});`, sandbox);
  assertEq(sandbox._r, "Import failed");
});

await asyncTest("_readAndValidateLSP: rejects non-JSON text", async () => {
  vm.runInContext(`
    globalThis._readAndValidateLSP("not json at all").then(function(r){ globalThis._r = r; });
  `, sandbox);
  // Promise is microtask — wait one tick
  await new Promise(r => setImmediate(r));
  assertEq(sandbox._r.ok, false);
  assertEq(sandbox._r.errors[0].code, "INVALID_JSON");
});

await asyncTest("_readAndValidateLSP: accepts a valid CW linear document", async () => {
  vm.runInContext(`
    var goodDoc = JSON.stringify({
      lsp_version: "1.0.0",
      meta: { units: { length: "mm", time: "s", power: "W" } },
      laser: { wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw" },
      exposure: { tissue: "skin", exposure_duration_s: 1.0 },
      pattern: { representation: "segments", authoritative: "segments", default_power_w: 0.1,
        segments: [{ id: 0, type: "line", p0: [0, 0], p1: [5, 0],
          velocity: { mode: "constant", value_mm_per_s: 50 },
          power: { mode: "constant", value: 0.1 }}]}
    });
    globalThis._readAndValidateLSP(goodDoc).then(function(r){ globalThis._r = r; });
  `, sandbox);
  await new Promise(r => setImmediate(r));
  assertEq(sandbox._r.ok, true, "valid doc should pass: " + JSON.stringify(sandbox._r.errors));
  assert(typeof sandbox._r.doc === "object", "should return parsed doc");
  assert(Array.isArray(sandbox._r.warnings), "should return warnings array");
});

await asyncTest("_readAndValidateLSP: rejects doc missing required field", async () => {
  vm.runInContext(`
    globalThis._readAndValidateLSP('{"lsp_version": "1.0.0"}').then(function(r){ globalThis._r = r; });
  `, sandbox);
  await new Promise(r => setImmediate(r));
  assertEq(sandbox._r.ok, false);
  assert(sandbox._r.errors.length > 0, "expected errors array");
});

await asyncTest("_readAndValidateLSP: handles invalid input (non-File, non-string)", async () => {
  vm.runInContext(`
    globalThis._readAndValidateLSP(42).then(function(r){ globalThis._r = r; });
  `, sandbox);
  await new Promise(r => setImmediate(r));
  assertEq(sandbox._r.ok, false);
  assertEq(sandbox._r.errors[0].code, "INVALID_INPUT");
});

await asyncTest("_readAndValidateLSP: handles a File-like object with .text() method", async () => {
  vm.runInContext(`
    var goodDoc = JSON.stringify({
      lsp_version: "1.0.0",
      meta: { units: { length: "mm", time: "s", power: "W" } },
      laser: { wavelength_nm: 532, beam_diameter_mm: 0.5, pulse_mode: "cw" },
      exposure: { tissue: "skin", exposure_duration_s: 1.0 },
      pattern: { representation: "segments", authoritative: "segments", default_power_w: 0.1,
        segments: [{ id: 0, type: "line", p0: [0, 0], p1: [5, 0],
          velocity: { mode: "constant", value_mm_per_s: 50 },
          power: { mode: "constant", value: 0.1 }}]}
    });
    var fakeFile = { text: function(){ return Promise.resolve(goodDoc); } };
    globalThis._readAndValidateLSP(fakeFile).then(function(r){ globalThis._r = r; });
  `, sandbox);
  await new Promise(r => setImmediate(r));
  assertEq(sandbox._r.ok, true);
});

await asyncTest("_readAndValidateLSP: surfaces FileReader errors", async () => {
  vm.runInContext(`
    var brokenFile = { text: function(){ return Promise.reject(new Error("disk error")); } };
    globalThis._readAndValidateLSP(brokenFile).then(function(r){ globalThis._r = r; });
  `, sandbox);
  await new Promise(r => setImmediate(r));
  assertEq(sandbox._r.ok, false);
  assertEq(sandbox._r.errors[0].code, "FILE_READ_ERROR");
});

await asyncTest("_readAndValidateLSP: rejects files larger than 16 MB", async () => {
  vm.runInContext(`
    // A file-like object reporting size 20 MB.  text() should NEVER be called
    // since the size check fires first; we install a throwing stub to verify.
    var huge = {
      size: 20 * 1024 * 1024,
      text: function(){ throw new Error("text() should not have been called"); }
    };
    globalThis._readAndValidateLSP(huge).then(function(r){ globalThis._r = r; });
  `, sandbox);
  await new Promise(r => setImmediate(r));
  assertEq(sandbox._r.ok, false);
  assertEq(sandbox._r.errors[0].code, "PAYLOAD_TOO_LARGE");
});

await asyncTest("_readAndValidateLSP: allows files at the size boundary", async () => {
  vm.runInContext(`
    // A file-like object reporting size 8 MB (well under the 16 MB cap).
    // The size check should pass and text() should be called.
    var fineSize = {
      size: 8 * 1024 * 1024,
      text: function(){ return Promise.resolve('{"lsp_version": "1.0.0"}'); }
    };
    globalThis._readAndValidateLSP(fineSize).then(function(r){ globalThis._r = r; });
  `, sandbox);
  await new Promise(r => setImmediate(r));
  // We don't care if the document validates; we just need to confirm
  // the size check did not reject it.  Defensive against empty errors arrays.
  var firstCode = (sandbox._r.errors && sandbox._r.errors[0])
    ? sandbox._r.errors[0].code : null;
  assert(firstCode !== "PAYLOAD_TOO_LARGE",
    "8 MB file should pass the size gate (got code: " + firstCode + ")");
});

syncTest("PatternSource: renders without throwing on idle state", () => {
  vm.runInContext(`
    globalThis._el = PatternSource({
      T: {card:"#fff", bd:"#ccc", tx:"#000", tm:"#666", td:"#444", ac:"#06f", hov:"#eee"},
      lspState: {phase: "idle"},
      onImport: function(){}, onEject: function(){}
    });
  `, sandbox);
  const el = sandbox._el;
  assert(el && el.type === "div", "should return a div element");
});

syncTest("PatternSource: renders without throwing on loaded state", () => {
  vm.runInContext(`
    globalThis._el = PatternSource({
      T: {card:"#fff", bd:"#ccc", tx:"#000", tm:"#666", td:"#444", ac:"#06f", hov:"#eee"},
      lspState: {phase: "loaded", filename: "test.lsp.json", warnings: []},
      onImport: function(){}, onEject: function(){}
    });
  `, sandbox);
  assert(sandbox._el && sandbox._el.type === "div");
});

syncTest("PatternSource: renders without throwing on error state with errors", () => {
  vm.runInContext(`
    globalThis._el = PatternSource({
      T: {card:"#fff", bd:"#ccc", tx:"#000", tm:"#666", td:"#444", ac:"#06f", hov:"#eee"},
      lspState: {phase: "error", errors: [{code:"X", path:"/", message:"test"}], warnings: []},
      onImport: function(){}, onEject: function(){}
    });
  `, sandbox);
  assert(sandbox._el && sandbox._el.type === "div");
});

syncTest("PatternSource: renders without throwing on loading state", () => {
  vm.runInContext(`
    globalThis._el = PatternSource({
      T: {card:"#fff", bd:"#ccc", tx:"#000", tm:"#666", td:"#444", ac:"#06f", hov:"#eee"},
      lspState: {phase: "loading"},
      onImport: function(){}, onEject: function(){}
    });
  `, sandbox);
  assert(sandbox._el && sandbox._el.type === "div");
});

syncTest("PatternSource: handles null props gracefully", () => {
  vm.runInContext(`
    globalThis._el = PatternSource({
      T: {card:"#fff", bd:"#ccc", tx:"#000", tm:"#666", td:"#444", ac:"#06f", hov:"#eee"}
    });
  `, sandbox);
  assert(sandbox._el && sandbox._el.type === "div");
});

// ─────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────

// Wait for any deferred async tests to settle.
await new Promise(r => setTimeout(r, 50));

console.log("");
console.log("LSP UI helper tests: " + _passed + " passed, " + _failed + " failed");
if (_failed > 0) {
  for (const f of _failures) {
    console.log("FAIL: " + f.name);
    console.log("  " + f.message);
  }
  process.exit(1);
}
