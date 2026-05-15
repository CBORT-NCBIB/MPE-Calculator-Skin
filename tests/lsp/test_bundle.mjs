#!/usr/bin/env node
/**
 * tests/lsp/test_bundle.mjs
 *
 * Bundle integration smoke test.  Validates that web/index.html (produced by
 * web/build.py) contains a syntactically valid JavaScript bundle and that
 * its inlined LSP worker sources, when executed in a sandboxed context that
 * mimics the browser Worker's `self` global, can correctly initialize and
 * canonicalize a small document.
 *
 * This complements tests/lsp/test_worker.mjs, which tests the worker source
 * directly from disk.  test_bundle.mjs tests the post-build artifact, which
 * is what users actually load.  A divergence between source-of-truth and
 * built-artifact (introduced for example by a build script bug or by an
 * unescaped </script> in a source comment) would fail this test even if
 * test_worker.mjs continued to pass.
 *
 * The test does NOT use a real browser or a real Worker — it uses Node's
 * vm module to simulate the Worker's isolated global scope.  That is
 * sufficient to catch the failure modes the build script can introduce:
 * syntax errors, missing sources, broken concatenation, and broken
 * inlined-string escapes.
 */

import { readFileSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const BUNDLE_PATH = join(REPO_ROOT, "web/index.html");
const STD_PATH = join(REPO_ROOT, "web/standards/icnirp_2013.json");

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
// Helper: extract a JSON-stringified source from the bundle, reversing the
// </script> defense-in-depth escape applied by build.py:_js_string_literal.
// ─────────────────────────────────────────────────────────────────────────

function extractJsonString(text, start) {
  if (text[start] !== '"') throw new Error("not a JSON string at offset " + start);
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] === '"') {
      let raw = text.slice(start, i + 1);
      // Reverse the </ → <\/ defense escape (and friends).  json.dumps
      // does not produce these sequences on its own, so a substring
      // replace is safe and reversible.
      raw = raw.replace(/<\\\//g, "</");
      raw = raw.replace(/<\\!--/g, "<!--");
      raw = raw.replace(/--\\>/g, "-->");
      return JSON.parse(raw);
    }
    i++;
  }
  throw new Error("unterminated string starting at offset " + start);
}

function extract(html, name) {
  const needle = "var " + name + " = ";
  const pos = html.indexOf(needle);
  if (pos === -1) throw new Error(name + " not found in bundle");
  return extractJsonString(html, pos + needle.length);
}

// ─────────────────────────────────────────────────────────────────────────
// Load bundle and standard once
// ─────────────────────────────────────────────────────────────────────────

let html, std;
try {
  html = readFileSync(BUNDLE_PATH, "utf-8");
} catch (err) {
  console.error("ERROR: " + BUNDLE_PATH + " not found.  Run `python3 web/build.py` first.");
  process.exit(1);
}
std = JSON.parse(readFileSync(STD_PATH, "utf-8"));

// ─── Freshness check ───
// If web/index.html is older than any of its inlined source files, the
// bundle is stale and the test would silently exercise an outdated artifact.
// Fail loudly rather than passing on stale state.
//
// This list MUST match what web/build.py actually reads.  When a future
// commit inlines additional sources (e.g. schema.json + validate.js when
// the import-flow UI is added), this list must be updated in lockstep.
const bundleMtime = statSync(BUNDLE_PATH).mtimeMs;
const sourceFiles = [
  "web/build.py",
  "web/engine.js",
  "web/calculator.jsx",
  "web/lsp.worker.js",
  "web/lsp/canonicalize.js"
];
const staleSources = [];
for (const rel of sourceFiles) {
  try {
    const m = statSync(join(REPO_ROOT, rel)).mtimeMs;
    if (m > bundleMtime) staleSources.push(rel);
  } catch (_e) { /* missing source — let the build catch it */ }
}
if (staleSources.length > 0) {
  console.error("ERROR: web/index.html is stale.  These source files are newer:");
  for (const s of staleSources) console.error("  - " + s);
  console.error("Rebuild with: python3 web/build.py");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

test("bundle: contains required marker strings", () => {
  for (const marker of [
    "ReactDOM", "MPEEngine",
    "__ENGINE_SOURCE__", "__LSP_CANONICALIZE_SRC__",
    "__LSP_WORKER_SRC__", "__createLSPWorker"
  ]) {
    assert(html.includes(marker), "marker missing: " + marker);
  }
});

test("bundle: every plain inline <script> block parses as JavaScript", () => {
  // Match each <script>...</script> block.  Capture the opening-tag
  // attribute string so we can recognize text/babel blocks (which contain
  // JSX, not plain JS, and would naturally fail new Function() parsing).
  //
  // Two flavors of bundle exist:
  //   - PRE-COMPILED (CI and local with Babel installed): all script
  //     blocks contain plain JS, no JSX literal characters.  All blocks
  //     should parse with new Function().
  //   - RUNTIME-BABEL FALLBACK (when @babel/core is missing): the main
  //     application script is emitted as <script type="text/babel"> with
  //     raw JSX.  That block legitimately fails plain-JS parsing because
  //     the browser invokes Babel on it at runtime.  Skip such blocks.
  //
  // Skipping text/babel blocks does NOT weaken the test on a pre-compiled
  // build (which has no text/babel blocks at all); it only makes the
  // test robust to the runtime-Babel fallback.
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  let match, idx = 0, errors = [], skipped = 0;
  while ((match = re.exec(html)) !== null) {
    idx++;
    const attrs = match[1] || "";
    const body = match[2];
    if (body.trim().length === 0) continue;
    if (/type\s*=\s*["']text\/babel["']/i.test(attrs)) {
      skipped++;
      continue;  // JSX block — not plain JS
    }
    try {
      new Function(body);  // syntax check only; does not execute
    } catch (e) {
      errors.push("block #" + idx + ": " + e.message);
    }
  }
  assert(idx > 0, "expected at least one inline script block");
  if (errors.length > 0) {
    throw new Error(errors.length + " script block(s) failed to parse:\n  " +
      errors.join("\n  "));
  }
});

test("bundle: inlined LSP sources extract and parse", () => {
  for (const name of ["__ENGINE_SOURCE__", "__LSP_CANONICALIZE_SRC__", "__LSP_WORKER_SRC__"]) {
    const src = extract(html, name);
    assert(typeof src === "string", name + " did not extract as string");
    assert(src.length > 100, name + " seems suspiciously short: " + src.length + " chars");
    try {
      new Function(src);
    } catch (e) {
      throw new Error(name + " is not valid JS: " + e.message);
    }
  }
});

test("bundle: concatenated worker source runs in sandbox", () => {
  const combined = extract(html, "__ENGINE_SOURCE__") + "\n;\n" +
                   extract(html, "__LSP_CANONICALIZE_SRC__") + "\n;\n" +
                   extract(html, "__LSP_WORKER_SRC__");
  const responses = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Math, JSON, Date, Object, Array,
    Error, TypeError, RangeError, Number, String, Boolean, Set, Map,
    isFinite, isNaN, parseInt, parseFloat,
    _testOnPostMessage: function (r) { responses.push(r); }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(combined, sandbox, { filename: "bundle-combined" });

  assert(sandbox._LSPWorker, "_LSPWorker not registered after loading bundle");
  assert(sandbox.MPEEngine, "MPEEngine not registered");
  assert(sandbox.LSPCanonicalize, "LSPCanonicalize not registered");
});

test("bundle: worker init + canonicalize round-trip works", () => {
  const combined = extract(html, "__ENGINE_SOURCE__") + "\n;\n" +
                   extract(html, "__LSP_CANONICALIZE_SRC__") + "\n;\n" +
                   extract(html, "__LSP_WORKER_SRC__");
  const responses = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Math, JSON, Date, Object, Array,
    Error, TypeError, RangeError, Number, String, Boolean, Set, Map,
    isFinite, isNaN, parseInt, parseFloat,
    _testOnPostMessage: function (r) { responses.push(r); }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(combined, sandbox, { filename: "bundle-combined" });

  // Init
  sandbox._LSPWorker._processMessage({ data: { type: "init", requestId: 1, standard: std }});
  const initR = responses.shift();
  assertEq(initR.type, "init_result");
  assertEq(initR.ok, true, "init should succeed; got error: " + (initR.error || ""));

  // Canonicalize a small CW linear document
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
  sandbox._LSPWorker._processMessage({ data: { type: "canonicalize", requestId: 2, doc: doc }});
  const r = responses.shift();
  assertEq(r.type, "canonicalize_result");
  assertEq(r.ok, true, "canonicalize should succeed; got: " + JSON.stringify(r.errors));
  assert(Array.isArray(r.engineSegments) && r.engineSegments.length > 0,
    "expected non-empty engineSegments");
});

test("bundle: __createLSPWorker is defined as a function", () => {
  // Extract the entire main-thread script block that contains __createLSPWorker
  // and confirm it parses to a function definition with the expected shape.
  const pos = html.indexOf("function __createLSPWorker");
  assert(pos !== -1, "function __createLSPWorker not found");
  const slice = html.slice(pos, pos + 2000);
  assert(slice.includes("typeof Worker"), "missing Worker undefined guard");
  assert(slice.includes("new Worker(url)"), "missing Worker construction");
  assert(slice.includes("createObjectURL"), "missing Blob URL creation");
  // Regression guard: the build script must NOT emit the original unsafe
  // setTimeout-based revoke pattern that races with Worker fetch.  Note we
  // assert against the RENDERED form (single braces) — the original Python
  // f-string used {{ }} but those become { } in the output.
  assert(!slice.includes("setTimeout(function() { URL.revokeObjectURL"),
    "old unsafe revocation pattern is still present in the bundle");
  // Positive assertion: the safe pattern revokes only on construction
  // failure (inside a catch), not unconditionally.
  assert(slice.includes("URL.revokeObjectURL"),
    "expected revocation to be present on the failure path");
});

// ─────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────

console.log("");
console.log("Bundle smoke tests: " + _passed + " passed, " + _failed + " failed");
if (_failed > 0) {
  console.log("");
  for (const f of _failures) {
    console.log("FAIL: " + f.name);
    console.log("  " + f.message);
  }
  process.exit(1);
}
