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
  // Verify the eight target helpers we test are defined.  If any are
  // missing, surface the original load error so a real bug isn't masked.
  // Commit-3 helpers added: _lspSnapshotState, _lspRestoreState,
  // _lspComputeSegmentsBbox, _lspApplyState.
  const required = ["_readAndValidateLSP", "_lspBeamToShort",
                    "_lspStatusLabel", "PatternSource",
                    "_lspSnapshotState", "_lspRestoreState",
                    "_lspComputeSegmentsBbox", "_lspApplyState"];
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
// Commit-3 tests: snapshot/apply/restore helpers
// ─────────────────────────────────────────────────────────────────────────

syncTest("_lspStatusLabel: appends '(custom path)' when customPath is true", () => {
  vm.runInContext(`
    globalThis._l1 = _lspStatusLabel({phase:"loaded", filename:"foo.lsp.json", customPath:true});
    globalThis._l2 = _lspStatusLabel({phase:"loaded", filename:"bar.lsp.json", customPath:false});
    globalThis._l3 = _lspStatusLabel({phase:"loaded", filename:"baz.lsp.json"});
  `, sandbox);
  assertEq(sandbox._l1, "Imported: foo.lsp.json (custom path)");
  assertEq(sandbox._l2, "Imported: bar.lsp.json");
  assertEq(sandbox._l3, "Imported: baz.lsp.json");
});

syncTest("_lspSnapshotState: captures all 32 fields verbatim", () => {
  vm.runInContext(`
    globalThis._g = {
      wlS:"532", wl:532, dS:"1.0", dia:1.0,
      tauS:"5", tau:5e-9, tauU:"ns",
      prfS:"100", prf:100000, prfU:"kHz",
      pwS:"0.5", pw:0.5, pwMode:"power",
      laserMode:"pulsed", epS:"5e-6",
      vS:"10", vel:10, velMode:"velocity",
      dwellS:"50", dwellN:50,
      srateS:"100", srateN:100,
      frateS:"30", frateN:30,
      pat:"raster", lLS:"10", lineL:10,
      scanHS:"5", scanHN:5,
      nLS:"100", nLines:100, blk:false
    };
    globalThis._snap = _lspSnapshotState(globalThis._g);
  `, sandbox);
  const snap = sandbox._snap;
  // Every field present
  const fields = ["wlS","wl","dS","dia","tauS","tau","tauU","prfS","prf","prfU",
    "pwS","pw","pwMode","laserMode","epS","vS","vel","velMode","dwellS","dwellN",
    "srateS","srateN","frateS","frateN","pat","lLS","lineL","scanHS","scanHN",
    "nLS","nLines","blk"];
  assertEq(fields.length, 32, "expected 32 named fields in the snapshot contract");
  assertEq(Object.keys(snap).length, 32, "snapshot has 32 fields");
  for (const f of fields) {
    assert(f in snap, "snapshot missing field: " + f);
  }
  // Values preserved exactly
  assertEq(snap.wl, 532);
  assertEq(snap.pat, "raster");
  assertEq(snap.nLines, 100);
  assertEq(snap.blk, false);
});

syncTest("_lspRestoreState: calls every setter with the snapshot value", () => {
  vm.runInContext(`
    var calls = {};
    function mkSetter(name) { return function(v){ calls[name] = v; }; }
    globalThis._restoreCalls = calls;
    globalThis._snap2 = {
      wlS:"1064", wl:1064, dS:"0.5", dia:0.5,
      tauS:"10", tau:10e-9, tauU:"ns",
      prfS:"50", prf:50000, prfU:"kHz",
      pwS:"0.2", pw:0.2, pwMode:"energy",
      laserMode:"cw", epS:"",
      vS:"5", vel:5, velMode:"dwell",
      dwellS:"100", dwellN:100,
      srateS:"50", srateN:50,
      frateS:"15", frateN:15,
      pat:"bidi", lLS:"20", lineL:20,
      scanHS:"10", scanHN:10,
      nLS:"50", nLines:50, blk:true
    };
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk"];
    for (var i = 0; i < setters.length; i++) S[setters[i]] = mkSetter(setters[i]);
    _lspRestoreState(globalThis._snap2, S);
  `, sandbox);
  const c = sandbox._restoreCalls;
  assertEq(c.setWlS, "1064");
  assertEq(c.setWl, 1064);
  assertEq(c.setPat, "bidi");
  assertEq(c.setBlk, true);
  assertEq(c.setLaserMode, "cw");
  // Verify all 32 setters were called (32 fields).  setDirty is NOT called
  // by _lspRestoreState — the caller is expected to invoke setDirty(true)
  // separately, per the function's contract.
  assertEq(Object.keys(c).length, 32, "32 setters called");
});

syncTest("_lspRestoreState: gracefully handles null snapshot", () => {
  vm.runInContext(`
    var calls = 0;
    function mkSetter() { return function(){ calls++; }; }
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) S[setters[i]] = mkSetter();
    _lspRestoreState(null, S);
    globalThis._nullRestoreCalls = calls;
  `, sandbox);
  assertEq(sandbox._nullRestoreCalls, 0, "no setters called for null snapshot");
});

syncTest("_lspComputeSegmentsBbox: includes both endpoints", () => {
  vm.runInContext(`
    // Two segments: one horizontal at y=0 from x=0 going +x, one vertical at x=10 going +y.
    // d_1e_mm = 1, so the segments are 1 unit long.
    // Segment 1: start (0,0), end (1, 0) → contributes [0..1] in x, 0 in y
    // Segment 2: start (10, 5), angle=PI/2, end (10, 6) → contributes 10 in x, [5..6] in y
    globalThis._bb1 = _lspComputeSegmentsBbox([
      {x_start_mm: 0, y_start_mm: 0, angle_rad: 0, v_mm_s: 100},
      {x_start_mm: 10, y_start_mm: 5, angle_rad: Math.PI/2, v_mm_s: 100}
    ], 1.0);
  `, sandbox);
  const b = sandbox._bb1;
  assert(Math.abs(b.xmin - 0) < 1e-9, "xmin = 0");
  assert(Math.abs(b.xmax - 10) < 1e-9, "xmax = 10");
  assert(Math.abs(b.ymin - 0) < 1e-9, "ymin = 0");
  assert(Math.abs(b.ymax - 6) < 1e-9, "ymax = 6 (endpoint of 2nd segment)");
});

syncTest("_lspComputeSegmentsBbox: returns null for empty input", () => {
  vm.runInContext(`
    globalThis._bb2 = _lspComputeSegmentsBbox([], 1.0);
    globalThis._bb3 = _lspComputeSegmentsBbox(null, 1.0);
  `, sandbox);
  assertEq(sandbox._bb2, null);
  assertEq(sandbox._bb3, null);
});

syncTest("_lspComputeSegmentsBbox: handles negative d_1e_mm defensively", () => {
  vm.runInContext(`
    // Negative or zero d_1e_mm should fall back to 1.0
    globalThis._bb4 = _lspComputeSegmentsBbox([
      {x_start_mm: 0, y_start_mm: 0, angle_rad: 0, v_mm_s: 100}
    ], -1.0);
  `, sandbox);
  const b = sandbox._bb4;
  // With fallback d=1, endpoint is at (1, 0)
  assert(Math.abs(b.xmax - 1) < 1e-9, "uses fallback d=1");
});

syncTest("_lspApplyState: preset path applies beam + scanParams + clears customSegsRef", () => {
  vm.runInContext(`
    var calls = {};
    function mkSetter(name) { return function(v){ calls[name] = v; }; }
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) S[setters[i]] = mkSetter(setters[i]);
    var customRef = { current: "previous-data" };  // should be cleared
    var result = _lspApplyState({
      beam: { d_1e_mm: 0.5, wl_nm: 1064, tau_s: 10e-9, prf_hz: 50000,
              pulse_energy_J: 1e-6, avg_power_W: 0.05, is_cw: false },
      scanParams: { v_scan_mm_s: 100, line_length_mm: 5, n_lines: 10,
                    hatch_mm: 0.1, pattern: "raster", blanking: true },
      engineSegments: null,
      totalTime_s: 1
    }, S, customRef);
    globalThis._presetResult = result;
    globalThis._presetCalls = calls;
    globalThis._presetCustomCurrent = customRef.current;
  `, sandbox);
  const r = sandbox._presetResult;
  const c = sandbox._presetCalls;
  assertEq(r.ok, true);
  assertEq(r.customPath, false);
  // Beam was applied
  assertEq(c.setWl, 1064);
  assertEq(c.setDia, 0.5);
  assertEq(c.setLaserMode, "pulsed");
  // Scan params were applied
  assertEq(c.setVel, 100);
  assertEq(c.setVelMode, "velocity");
  assertEq(c.setLineL, 5);
  assertEq(c.setPat, "raster");
  assertEq(c.setNLines, 10);
  assertEq(c.setBlk, true);
  // Custom ref cleared
  assertEq(sandbox._presetCustomCurrent, null);
});

syncTest("_lspApplyState: custom path applies beam + stores segments + sets derived display", () => {
  vm.runInContext(`
    var calls = {};
    function mkSetter(name) { return function(v){ calls[name] = v; }; }
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) S[setters[i]] = mkSetter(setters[i]);
    var customRef = { current: null };
    // Custom path: scanParams=null, engineSegments non-empty.
    var segs = [
      { x_start_mm: 0, y_start_mm: 0, angle_rad: 0, v_mm_s: 100 },
      { x_start_mm: 5, y_start_mm: 0, angle_rad: 0, v_mm_s: 100 },
      { x_start_mm: 0, y_start_mm: 3, angle_rad: 0, v_mm_s: 50 }  // different velocity
    ];
    var result = _lspApplyState({
      beam: { d_1e_mm: 1.0, wl_nm: 532, tau_s: 5e-9, prf_hz: 100000,
              pulse_energy_J: 1e-6, avg_power_W: 0.1, is_cw: false },
      scanParams: null,
      engineSegments: segs,
      totalTime_s: 2.5
    }, S, customRef);
    globalThis._customResult = result;
    globalThis._customCalls = calls;
    globalThis._customRefData = customRef.current;
  `, sandbox);
  const r = sandbox._customResult;
  const c = sandbox._customCalls;
  const data = sandbox._customRefData;
  assertEq(r.ok, true);
  assertEq(r.customPath, true);
  // Beam was applied
  assertEq(c.setWl, 532);
  assertEq(c.setDia, 1.0);
  // Custom segments stored in ref
  assert(data !== null, "customSegsRef.current was populated");
  assertEq(data.segments.length, 3);
  assertEq(data.totalTime_s, 2.5);
  assertEq(data.d_1e_mm, 1.0);
  // Mean velocity = (100 + 100 + 50) / 3 ≈ 83.33
  assert(Math.abs(data.meanVelocity_mm_s - 83.333333) < 1e-3, "mean velocity correct");
  // Bbox computed: xmin=0, xmax=6 (endpoint of seg 1 at x=6), ymin=0, ymax=3
  assert(data.bbox !== null);
  assertEq(data.bbox.xmin, 0);
  assertEq(data.bbox.xmax, 6);
  assertEq(data.bbox.ymin, 0);
  assertEq(data.bbox.ymax, 3);
  // Derived display values:
  // lineL = bbox width = 6
  // scanHN = bbox height = 3
  // nLines = 1, velMode = "velocity"
  assertEq(Number(c.setLineL), 6);
  assertEq(Number(c.setScanHN), 3);
  assertEq(c.setNLines, 1);
  assertEq(c.setVelMode, "velocity");
});

syncTest("_lspApplyState: rejects missing beam", () => {
  vm.runInContext(`
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) S[setters[i]] = function(){};
    globalThis._reject1 = _lspApplyState({ beam: null }, S, {current:null});
  `, sandbox);
  const r = sandbox._reject1;
  assertEq(r.ok, false);
  assert(r.errors && r.errors[0].code === "INVALID_BEAM");
});

syncTest("_lspApplyState: rejects zero average power", () => {
  vm.runInContext(`
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) S[setters[i]] = function(){};
    globalThis._reject2 = _lspApplyState({
      beam: { d_1e_mm: 0.5, wl_nm: 532, tau_s: 5e-9, prf_hz: 100000,
              pulse_energy_J: 0, avg_power_W: 0, is_cw: false },
      scanParams: { v_scan_mm_s: 100, line_length_mm: 5, n_lines: 1, pattern: "linear" }
    }, S, {current:null});
  `, sandbox);
  const r = sandbox._reject2;
  assertEq(r.ok, false);
  assert(r.errors[0].code === "INVALID_BEAM");
  assert(/avg_power_W|power/.test(r.errors[0].path) || /power/.test(r.errors[0].message));
});

syncTest("_lspApplyState: rejects empty engineSegments with INTERNAL_ERROR", () => {
  vm.runInContext(`
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) S[setters[i]] = function(){};
    globalThis._reject3 = _lspApplyState({
      beam: { d_1e_mm: 0.5, wl_nm: 532, tau_s: 5e-9, prf_hz: 100000,
              pulse_energy_J: 1e-6, avg_power_W: 0.1, is_cw: false },
      scanParams: null,
      engineSegments: []   // empty array → reject
    }, S, {current:null});
  `, sandbox);
  const r = sandbox._reject3;
  assertEq(r.ok, false);
  assertEq(r.errors[0].code, "INTERNAL_ERROR");
});

syncTest("_lspApplyState: rejects custom path with null customSegsRef", () => {
  vm.runInContext(`
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) S[setters[i]] = function(){};
    globalThis._reject4 = _lspApplyState({
      beam: { d_1e_mm: 0.5, wl_nm: 532, tau_s: 5e-9, prf_hz: 100000,
              pulse_energy_J: 1e-6, avg_power_W: 0.1, is_cw: false },
      scanParams: null,
      engineSegments: [
        { x_start_mm: 0, y_start_mm: 0, angle_rad: 0, v_mm_s: 100 }
      ]
    }, S, null);
  `, sandbox);
  const r = sandbox._reject4;
  assertEq(r.ok, false);
  assertEq(r.errors[0].code, "INTERNAL_ERROR");
  assert(/customSegsRef/.test(r.errors[0].message));
});

syncTest("_lspApplyState: ignores blanked segments in velocity mean", () => {
  vm.runInContext(`
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) S[setters[i]] = function(){};
    var customRef = { current: null };
    var result = _lspApplyState({
      beam: { d_1e_mm: 1.0, wl_nm: 532, tau_s: 5e-9, prf_hz: 100000,
              pulse_energy_J: 1e-6, avg_power_W: 0.1, is_cw: false },
      scanParams: null,
      engineSegments: [
        { x_start_mm: 0, y_start_mm: 0, angle_rad: 0, v_mm_s: 100 },
        { x_start_mm: 5, y_start_mm: 0, angle_rad: 0, v_mm_s: 999999, blanked: true },
        { x_start_mm: 0, y_start_mm: 3, angle_rad: 0, v_mm_s: 100 }
      ]
    }, S, customRef);
    globalThis._meanV = customRef.current.meanVelocity_mm_s;
    globalThis._hasBlanked = customRef.current.hasBlankedSegments;
  `, sandbox);
  assertEq(sandbox._meanV, 100, "mean ignores blanked segment");
  assertEq(sandbox._hasBlanked, true);
});

syncTest("_lspApplyState: rejection leaves state untouched (atomicity)", () => {
  // Critical: when validation fails (e.g., empty engineSegments), NO setter
  // should be called.  An earlier implementation applied beam params before
  // checking scanParams/engineSegments, leaving state half-applied on
  // rejection — the user could then click Calculate against the mixed
  // configuration.  This test guards against regression.
  vm.runInContext(`
    var setterCalls = [];
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) {
      (function(name){ S[name] = function(v){ setterCalls.push(name); }; })(setters[i]);
    }
    var customRef = { current: "untouched-sentinel" };
    // Valid beam, but no scanParams and empty engineSegments → branch (c) reject.
    globalThis._atomicReject = _lspApplyState({
      beam: { d_1e_mm: 0.5, wl_nm: 532, tau_s: 5e-9, prf_hz: 100000,
              pulse_energy_J: 1e-6, avg_power_W: 0.1, is_cw: false },
      scanParams: null,
      engineSegments: []
    }, S, customRef);
    globalThis._atomicCalls = setterCalls.slice();
    globalThis._atomicRefAfter = customRef.current;
  `, sandbox);
  assertEq(sandbox._atomicReject.ok, false);
  assertEq(sandbox._atomicCalls.length, 0,
    "no setter should be called on rejection; got: " + sandbox._atomicCalls.join(","));
  assertEq(sandbox._atomicRefAfter, "untouched-sentinel",
    "customSegsRef.current should be untouched on rejection");
});

syncTest("_lspApplyState: custom path translates segments to bbox origin", () => {
  // Segments at non-zero offsets (x=10..16, y=5..8) should be translated so
  // bbox starts at (0, 0).  This is essential for click-coord ↔ grid-coord
  // alignment in the downstream UI.
  vm.runInContext(`
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    var calls = {};
    for (var i = 0; i < setters.length; i++) {
      (function(name){ S[name] = function(v){ calls[name] = v; }; })(setters[i]);
    }
    var customRef = { current: null };
    var origSegs = [
      { x_start_mm: 10, y_start_mm: 5, angle_rad: 0, v_mm_s: 100 },
      { x_start_mm: 15, y_start_mm: 5, angle_rad: 0, v_mm_s: 100 },
      { x_start_mm: 10, y_start_mm: 8, angle_rad: 0, v_mm_s: 100 }
    ];
    globalThis._xlResult = _lspApplyState({
      beam: { d_1e_mm: 1.0, wl_nm: 532, tau_s: 5e-9, prf_hz: 100000,
              pulse_energy_J: 1e-6, avg_power_W: 0.1, is_cw: false },
      scanParams: null,
      engineSegments: origSegs
    }, S, customRef);
    globalThis._xlRef = customRef.current;
    globalThis._xlOrigPreserved = origSegs[0].x_start_mm;  // canonicalize-owned array not mutated
    globalThis._xlCalls = calls;
  `, sandbox);
  const r = sandbox._xlResult;
  const ref = sandbox._xlRef;
  assertEq(r.ok, true);
  assertEq(r.customPath, true);
  // Original offsets recorded
  assertEq(ref.orig_xmin_mm, 10);
  assertEq(ref.orig_ymin_mm, 5);
  // Translated bbox starts at origin
  assertEq(ref.bbox.xmin, 0);
  assertEq(ref.bbox.ymin, 0);
  // bbox width = (15+1) - 10 = 6; height = 8 - 5 = 3 (no endpoint at y=8+1 since angle=0)
  assertEq(ref.bbox.xmax, 6);
  assertEq(ref.bbox.ymax, 3);
  // Segments translated: first at (0, 0), second at (5, 0), third at (0, 3)
  assertEq(ref.segments[0].x_start_mm, 0);
  assertEq(ref.segments[0].y_start_mm, 0);
  assertEq(ref.segments[1].x_start_mm, 5);
  assertEq(ref.segments[1].y_start_mm, 0);
  assertEq(ref.segments[2].x_start_mm, 0);
  assertEq(ref.segments[2].y_start_mm, 3);
  // Original array NOT mutated (defensive copy)
  assertEq(sandbox._xlOrigPreserved, 10, "original engineSegments array must not be mutated");
  // Display values reflect translated bbox
  assertEq(Number(sandbox._xlCalls.setLineL), 6);
  assertEq(Number(sandbox._xlCalls.setScanHN), 3);
});

syncTest("_lspApplyState: rejection from missing beam also leaves state untouched", () => {
  // The pre-existing beam-validation branches already returned before
  // touching any setters; verify that holds after the atomicity refactor.
  vm.runInContext(`
    var setterCalls = [];
    var S = {};
    var setters = ["setWlS","setWl","setDS","setDia","setTauS","setTau","setTauU",
      "setPrfS","setPrf","setPrfU","setPwS","setPw","setPwMode","setLaserMode","setEpS",
      "setVS","setVel","setVelMode","setDwellS","setDwellN","setSrateS","setSrateN",
      "setFrateS","setFrateN","setPat","setLLS","setLineL","setScanHS","setScanHN",
      "setNLS","setNLines","setBlk","setDirty"];
    for (var i = 0; i < setters.length; i++) {
      (function(name){ S[name] = function(v){ setterCalls.push(name); }; })(setters[i]);
    }
    var customRef = { current: null };
    globalThis._beamReject = _lspApplyState({
      beam: null,  // missing beam → reject before any setter call
      scanParams: { pattern: "linear", v_scan_mm_s: 100, line_length_mm: 10 },
      engineSegments: []
    }, S, customRef);
    globalThis._beamRejectCalls = setterCalls.slice();
  `, sandbox);
  assertEq(sandbox._beamReject.ok, false);
  assertEq(sandbox._beamRejectCalls.length, 0,
    "missing-beam rejection must not call any setter");
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
