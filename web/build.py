#!/usr/bin/env python3
"""
Build script: generates web/index.html from calculator.jsx + engine.js + standards JSON.

Transformations:
  1. Strip ESM import lines (React/Recharts loaded via CDN globals)
  2. Rename Tooltip → RTooltip (avoids HTML collision)
  3. Strip 'export default' from App function
  4. Pre-compile JSX → JS via Babel (eliminates ~800KB runtime Babel dependency)
  5. Inject engine.js as a separate <script> block
  6. Inject standard data JSON and initialize the engine

Prerequisites:
  npm install  (from web/ directory — installs @babel/core, @babel/preset-react)

Run:
  python3 web/build.py
"""

import json
import os
import subprocess
import sys

# ── Locate files ──
script_dir = os.path.dirname(os.path.abspath(__file__))
if os.path.basename(script_dir) == "web":
    web_dir = script_dir
elif os.path.isdir(os.path.join(script_dir, "web")):
    web_dir = os.path.join(script_dir, "web")
else:
    print("Error: Cannot find web/ directory. Run from repo root or web/.")
    sys.exit(1)

jsx_path = os.path.join(web_dir, "calculator.jsx")
engine_path = os.path.join(web_dir, "engine.js")
out_path = os.path.join(web_dir, "index.html")

# ── LSP foundation paths ──
# These are inlined into the bundle so the LSP Web Worker can run offline.
# Stage 1 (Ajv schema) and Stage 2 (plausibility) validation run on the
# main thread, so validate.js and a self-contained Ajv 8 bundle are also
# inlined into the main-thread script blocks.
lsp_dir = os.path.join(web_dir, "lsp")
lsp_canonicalize_path = os.path.join(lsp_dir, "canonicalize.js")
lsp_worker_path = os.path.join(web_dir, "lsp.worker.js")
lsp_validate_path = os.path.join(lsp_dir, "validate.js")
lsp_schema_path = os.path.join(lsp_dir, "schema.json")
# Ajv bundling: esbuild reads build_ajv_entry.js and produces a self-
# contained IIFE bundle of Ajv 2020.  See build_ajv_entry.js for the
# rationale and command this script invokes.
ajv_entry_path = os.path.join(web_dir, "build_ajv_entry.js")

# Read standard path from config.js (allows switching standards without editing build.py)
config_path = os.path.join(web_dir, "config.js")
std_rel_path = "./standards/icnirp_2013.json"  # fallback if config.js missing
if os.path.exists(config_path):
    import re
    with open(config_path, "r") as f:
        config_text = f.read()
    m = re.search(r'STANDARD_PATH\s*=\s*["\']([^"\']+)["\']', config_text)
    if m:
        std_rel_path = m.group(1)
json_path = os.path.join(web_dir, std_rel_path.lstrip("./"))
std_filename = os.path.basename(json_path)

def _read_required(path, description):
    """Read a required source file with a clear error message on failure.

    The default Python FileNotFoundError traceback is opaque to non-developers
    debugging a partial checkout or a misconfigured environment.  This helper
    catches that case and exits with a message that names exactly which file
    is missing and where it should live.
    """
    try:
        with open(path, "r") as f:
            return f.read()
    except FileNotFoundError:
        print(f"Error: Required source file is missing: {path}", file=sys.stderr)
        print(f"  Description: {description}", file=sys.stderr)
        print(f"  Recovery: ensure your checkout is complete (git status; git pull), "
              f"then re-run web/build.py.", file=sys.stderr)
        sys.exit(2)


# ── Read sources ──
jsx = _read_required(jsx_path, "main React component (web/calculator.jsx)")
std_json = _read_required(json_path, f"ICNIRP standard JSON (web/{std_rel_path})").strip()
engine_js = _read_required(engine_path, "calculation engine (web/engine.js)")

# Read LSP module sources for inlining into the Worker context
lsp_canonicalize_js = _read_required(
    lsp_canonicalize_path,
    "LSP canonicalization module (web/lsp/canonicalize.js)")
lsp_worker_js = _read_required(
    lsp_worker_path,
    "LSP worker shell (web/lsp.worker.js)")

# Read main-thread LSP validator + schema for inlining into the page's
# main-thread script blocks.  Stage 1 uses Ajv against the schema; Stage 2
# is pure JS plausibility checks.
lsp_validate_js = _read_required(
    lsp_validate_path,
    "LSP validator (web/lsp/validate.js)")
lsp_schema_json = _read_required(
    lsp_schema_path,
    "LSP schema (web/lsp/schema.json)").strip()


def _assert_no_script_close(content, source_label):
    """Defensive check: a literal '</script>' (or any case variant) inside an
    inlined source would prematurely close the wrapping <script> block in the
    generated HTML, breaking the page.  This catches accidental inclusions
    early.  The Ajv bundle bypasses this check because esbuild generates it
    deterministically and never produces script-close sequences."""
    import re
    if re.search(r"</\s*script\s*>", content, re.IGNORECASE):
        print(f"ERROR: {source_label} contains a '</script>' sequence which would "
              f"break the HTML output.  This must be removed before building.",
              file=sys.stderr)
        sys.exit(4)


_assert_no_script_close(lsp_schema_json, "web/lsp/schema.json")
_assert_no_script_close(lsp_validate_js, "web/lsp/validate.js")


def _bundle_ajv(entry_path, web_dir):
    """Invoke esbuild to produce a self-contained Ajv 8 IIFE bundle.

    Why a separate bundling step?  Ajv 8 is a CommonJS package that imports
    its rest-of-package at runtime via require().  It does not ship a
    self-contained UMD or IIFE bundle.  We use esbuild (declared in
    web/package.json devDependencies) to walk the require graph from
    build_ajv_entry.js and produce a single ~125 KB minified IIFE that
    exposes globalThis.Ajv2020.

    Why esbuild rather than rollup or webpack?  esbuild is the fastest
    bundler in the ecosystem (Ajv bundles in ~40 ms), has zero config in
    this mode, and produces output that is byte-stable across runs.

    If esbuild is missing (e.g. npm install was skipped), we fail with a
    clear error rather than silently degrading to a runtime-load fallback.
    Silent degradation would mean shipping a calculator that depends on
    network access for safety-critical schema validation — exactly the
    failure mode the bundling approach exists to avoid.
    """
    import tempfile
    tmpdir = tempfile.mkdtemp(prefix="ajv-bundle-")
    out_path = os.path.join(tmpdir, "ajv-bundle.js")
    try:
        result = subprocess.run(
            ["npx", "--no-install", "esbuild",
             entry_path,
             "--bundle", "--minify",
             "--format=iife",
             "--target=es2019",
             f"--outfile={out_path}"],
            capture_output=True,
            cwd=web_dir,
            timeout=60
        )
        if result.returncode != 0:
            print("Error: esbuild failed to bundle Ajv.", file=sys.stderr)
            print(f"  stderr: {result.stderr.decode('utf-8', 'replace')[:500]}", file=sys.stderr)
            print(f"  stdout: {result.stdout.decode('utf-8', 'replace')[:500]}", file=sys.stderr)
            print("  Recovery: run 'cd web && npm install' to install esbuild "
                  "and ajv, then re-run web/build.py.", file=sys.stderr)
            sys.exit(3)
        with open(out_path, "r") as f:
            return f.read()
    except FileNotFoundError:
        print("Error: 'npx' is not on PATH.  Node.js is required to build the bundle.",
              file=sys.stderr)
        print("  Recovery: install Node.js 18+ from https://nodejs.org/, then "
              "run 'cd web && npm install'.", file=sys.stderr)
        sys.exit(3)
    except subprocess.TimeoutExpired:
        print("Error: esbuild timed out after 60 s while bundling Ajv.",
              file=sys.stderr)
        print("  This is highly abnormal — the bundle is ~125 KB and normally "
              "takes <500 ms.", file=sys.stderr)
        print("  Recovery: check that 'npx esbuild --version' works; if it hangs, "
              "delete web/node_modules and re-run 'cd web && npm install'.",
              file=sys.stderr)
        sys.exit(3)
    finally:
        # Clean up the temp file but ignore errors (file may not exist if
        # esbuild failed before writing).
        try:
            os.remove(out_path)
            os.rmdir(tmpdir)
        except OSError:
            pass


print("Bundling Ajv via esbuild...")
ajv_bundle_js = _bundle_ajv(ajv_entry_path, web_dir)
print(f"  Ajv bundle: {len(ajv_bundle_js):,} bytes")


def _strip_node_block(source):
    """Strip lines between BUILD_STRIP_START and BUILD_STRIP_END markers.

    The same convention is used in engine.js and all LSP modules to gate
    Node-specific code (require, module.exports) that must not appear in the
    browser/worker build.  After stripping, only the unconditional browser-side
    self.* assignments remain.

    Marker recognition: a line is treated as a marker only if it is a
    pure-comment line that contains nothing except the marker token (after
    stripping whitespace and the `//` prefix).  This prevents documentation
    comments like `// build.py strips the Node.js block (BUILD_STRIP_START →
    BUILD_STRIP_END)` from accidentally triggering the strip.
    """
    import re
    start_re = re.compile(r'^\s*//\s*BUILD_STRIP_START\s*$')
    end_re = re.compile(r'^\s*//\s*BUILD_STRIP_END\s*$')
    out_lines = []
    stripping = False
    for line in source.split("\n"):
        if start_re.match(line):
            stripping = True
            continue
        if end_re.match(line):
            stripping = False
            continue
        if not stripping:
            out_lines.append(line)
    return "\n".join(out_lines)


def _js_string_literal(source):
    """Encode a source string as a JavaScript string literal safe to embed
    inside an HTML <script> tag.

    JSON encoding produces a valid JS string literal for any string, but the
    HTML parser closes a <script> tag whenever it sees the case-insensitive
    sequence "</script" followed by certain terminator characters.  If the
    source contains that sequence (for example, a comment documenting a
    <script> tag), the bundle silently breaks: the parser ends the script,
    treats the rest of the source as text, then the closing </script> tag
    leaves the page in an inconsistent state.

    Defense in depth: split the dangerous sequence "</" into "<" + "/" at
    the JS-string level so the rendered HTML never contains </script
    inside a string literal.  The runtime string value is identical because
    "<" + "/" === "</" in JavaScript.

    We apply the same treatment to "<!--" and "-->" which can confuse the
    HTML comment parser inside legacy parsers.
    """
    encoded = json.dumps(source)
    # Replace within the JSON-encoded form (between the surrounding quotes).
    # The JSON encoder never emits these sequences itself, so a substring
    # replace is safe and reversible.
    encoded = encoded.replace("</", "<\\/")
    encoded = encoded.replace("<!--", "<\\!--")
    encoded = encoded.replace("-->", "--\\>")
    return encoded


lsp_canonicalize_js_browser = _strip_node_block(lsp_canonicalize_js)
lsp_worker_js_browser = _strip_node_block(lsp_worker_js)
lsp_validate_js_browser = _strip_node_block(lsp_validate_js)
engine_js_browser = _strip_node_block(engine_js)

# ── Transform JSX for browser embedding ──
lines = jsx.split("\n")
out_lines = []
for line in lines:
    if line.startswith("import ") and (" from " in line):
        continue
    line = line.replace("export default function App()", "function App()")
    out_lines.append(line)

jsx_body = "\n".join(out_lines)
jsx_body = jsx_body.replace("<Tooltip ", "<RTooltip ")
jsx_body = jsx_body.replace("</Tooltip>", "</RTooltip>")

# ── Pre-compile JSX → JS via Babel ──
# Tries @babel/core (npm install). Falls back to runtime Babel if unavailable.
babel_script = r"""
var babel;
try { babel = require('@babel/core'); } catch(e) {
  try { babel = require('./node_modules/@babel/core'); } catch(e2) {
    process.stderr.write('BABEL_NOT_FOUND');
    process.exit(1);
  }
}
var presetPath;
try { presetPath = require.resolve('@babel/preset-react'); } catch(e) {
  try { presetPath = require.resolve('./node_modules/@babel/preset-react'); } catch(e2) {
    process.stderr.write('PRESET_NOT_FOUND');
    process.exit(1);
  }
}
var code = require('fs').readFileSync(0, 'utf8');
try {
  var result = babel.transformSync(code, {
    presets: [presetPath],
    filename: 'calculator.jsx'
  });
  process.stdout.write(result.code);
} catch(e) {
  process.stderr.write('BABEL_ERROR: ' + e.message);
  process.exit(2);
}
"""

use_precompiled = False
try:
    result = subprocess.run(
        ["node", "-e", babel_script],
        input=jsx_body.encode("utf-8"),
        capture_output=True,
        cwd=web_dir,
        timeout=30
    )
    if result.returncode == 0:
        jsx_body = result.stdout.decode("utf-8")
        use_precompiled = True
    else:
        err = result.stderr.decode("utf-8", errors="replace")
        if "BABEL_NOT_FOUND" in err or "PRESET_NOT_FOUND" in err:
            print("  ⚠ Babel not installed — using runtime transpilation.")
            print("    To pre-compile: cd web && npm install")
        else:
            print(f"  ⚠ Babel error: {err[:200]}")
            print("    Falling back to runtime transpilation.")
except FileNotFoundError:
    print("  ⚠ Node.js not found — using runtime Babel for JSX transpilation.")
except subprocess.TimeoutExpired:
    print("  ⚠ Babel timed out — using runtime transpilation.")

# ── Recharts destructuring (needed for both precompiled and runtime) ──
recharts_destructure = ("var useState=React.useState,useMemo=React.useMemo,"
    "useEffect=React.useEffect,useRef=React.useRef;\n"
    "var LineChart=Recharts.LineChart,Line=Recharts.Line,XAxis=Recharts.XAxis,"
    "YAxis=Recharts.YAxis,CartesianGrid=Recharts.CartesianGrid,"
    "RTooltip=Recharts.Tooltip,ReferenceDot=Recharts.ReferenceDot,"
    "ResponsiveContainer=Recharts.ResponsiveContainer,"
    "ReferenceLine=Recharts.ReferenceLine,Legend=Recharts.Legend,"
    "Label=Recharts.Label;\n")

# ── Determine script type ──
if use_precompiled:
    script_type = ""  # plain <script>
    babel_cdn = ""
    mode_label = "pre-compiled"
else:
    script_type = ' type="text/babel"'
    babel_cdn = ('<script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js" '
                 'onerror="se(\'Babel\')()"></script>\n')
    mode_label = "runtime Babel"

# ── Build the HTML ──
html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Laser Skin MPE Calculator</title>
  <style>
    *{{margin:0;padding:0;box-sizing:border-box}}
    html{{font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}}
    body{{font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      color:#0E1116;line-height:1.45}}
    input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{{
      -webkit-appearance:none;margin:0}}
    input[type=number]{{-moz-appearance:textfield}}
    *:focus{{outline:none}}
    *:focus-visible{{outline:2px solid #1D4ED8;outline-offset:2px}}
    input:focus-visible,select:focus-visible{{outline:none;border-color:#1D4ED8 !important;
      box-shadow:0 0 0 3px rgba(29,78,216,0.15) !important}}
    ::selection{{background:rgba(29,78,216,0.18);color:inherit}}
    ::-webkit-scrollbar{{width:6px;height:6px}}
    ::-webkit-scrollbar-track{{background:transparent}}
    ::-webkit-scrollbar-thumb{{background:rgba(0,0,0,0.15);border-radius:3px}}
    ::-webkit-scrollbar-thumb:hover{{background:rgba(0,0,0,0.25)}}
    select{{cursor:pointer}}
    button{{transition:background 120ms cubic-bezier(0.16,1,0.3,1),
      border-color 120ms cubic-bezier(0.16,1,0.3,1),
      color 120ms cubic-bezier(0.16,1,0.3,1)}}
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap">
</head>
<body>
<div id="root"></div>
<div id="le" style="text-align:center;padding:20px;color:#c00;font-size:14px"></div>

<script>var le=[];function se(n){{return function(){{le.push(n);document.getElementById('le').textContent='Failed to load: '+le.join(', ')+'.';}}}}</script>
<script src="https://unpkg.com/react@18.2.0/umd/react.production.min.js" onerror="se('React')()"></script>
<script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js" onerror="se('ReactDOM')()"></script>
<script src="https://unpkg.com/prop-types@15.8.1/prop-types.min.js" onerror="se('PropTypes')()"></script>
<script src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js" onerror="se('Recharts')()"></script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js" onerror="se('echarts')()"></script>
{babel_cdn}
<script>
// Calculation engine (from engine.js — single source of truth for all MPE logic)
// Node.js exports stripped for browser embedding; see BUILD_STRIP markers in engine.js
{engine_js_browser}
</script>

<script>
// Standard data (injected from {std_rel_path} via config.js)
var __STD_DATA__ = {std_json};
// Initialize the engine with the standard data
if (typeof MPEEngine !== "undefined") MPEEngine.loadStandard(__STD_DATA__);
</script>

<script>
// Ajv 8 (JSON Schema 2020-12 validator) bundled via esbuild.  Exposes
// globalThis.Ajv2020.  See web/build_ajv_entry.js for the bundling
// rationale.  Bundled here rather than CDN-loaded so the calculator
// works fully offline — schema validation is safety-critical and must
// not silently degrade when the network is unreachable.
{ajv_bundle_js}
</script>

<script>
// LSP-JSON schema (web/lsp/schema.json) inlined for main-thread Stage 1
// validation.  The validator (loaded immediately below) reads this from
// the global via window.LSP_SCHEMA — see web/lsp/validate.js for the
// resolution order.
var LSP_SCHEMA = {lsp_schema_json};
</script>

<script>
// LSP main-thread validator (web/lsp/validate.js).  Stage 1 = Ajv schema
// check using LSP_SCHEMA and the bundled Ajv2020.  Stage 2 = pure-JS
// plausibility checks (finite numbers, bbox sanity, segment count caps,
// per-segment power consistency, etc).  Exposes window.LSPValidate.
{lsp_validate_js_browser}
</script>

<script>
// Engine source for Web Worker (scanning computation runs off main thread)
// Uses the FULL engine.js (including Node.js exports) since Worker scope is isolated
var __ENGINE_SOURCE__ = {_js_string_literal(engine_js)};
</script>

<script>
// LSP worker sources (Sub-phase 1D): the LSP canonicalization pipeline runs
// off the main thread inside its own Web Worker.  The three sources below are
// concatenated and turned into a Blob URL by __createLSPWorker() when the
// main thread first imports an LSP document.
//
// Order matters: engine first (LSPCanonicalize calls into it), then
// canonicalize.js (exports self.LSPCanonicalize), then the worker shell
// (defines self.onmessage, etc.).
var __LSP_CANONICALIZE_SRC__ = {_js_string_literal(lsp_canonicalize_js_browser)};
var __LSP_WORKER_SRC__ = {_js_string_literal(lsp_worker_js_browser)};

// Factory function exposed to React code.  Returns a freshly-constructed
// Web Worker instance, or null if Workers are unsupported.  The caller is
// responsible for sending the init message before any canonicalize messages.
//
// Blob URL lifetime: we intentionally do NOT revoke the URL after the
// Worker is constructed.  The HTML spec is unambiguous that an existing
// Worker constructed from a blob URL keeps working after the URL is
// revoked, but some browser versions have had subtle timing bugs in that
// area.  The memory cost of one ~3 MB Blob URL kept alive for the
// lifetime of the page is negligible, and the URL is garbage-collected
// automatically on page unload.  The safer-by-default choice is to not
// revoke until/unless we have a reason to.
function __createLSPWorker() {{
  if (typeof Worker === "undefined") return null;
  if (typeof Blob === "undefined" || typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function") return null;
  if (typeof __ENGINE_SOURCE__ === "undefined" ||
      typeof __LSP_CANONICALIZE_SRC__ === "undefined" ||
      typeof __LSP_WORKER_SRC__ === "undefined") {{
    return null;  // build script did not inline the required sources
  }}
  var combined = [
    __ENGINE_SOURCE__,
    __LSP_CANONICALIZE_SRC__,
    __LSP_WORKER_SRC__
  ].join("\\n;\\n");
  var blob = new Blob([combined], {{type: "application/javascript"}});
  var url = URL.createObjectURL(blob);
  try {{
    return new Worker(url);
  }} catch (e) {{
    // Construction failed (CSP block, unsupported MIME, etc).  Revoke the
    // URL since no Worker is keeping it alive.
    try {{ URL.revokeObjectURL(url); }} catch (_) {{}}
    return null;
  }}
}}
</script>

<script{script_type}>

{recharts_destructure}
{jsx_body}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
</script>

<noscript>
  <div style="text-align:center;padding:40px;font-size:16px;color:#333">
    This calculator requires JavaScript to be enabled.
  </div>
</noscript>
</body>
</html>'''

with open(out_path, "w") as f:
    f.write(html)

line_count = html.count("\n") + 1
print(f"Built {out_path}")
print(f"  Sources: calculator.jsx ({len(lines)} lines), engine.js ({len(engine_js.splitlines())} lines), {std_filename}")
print(f"  LSP:     canonicalize.js ({len(lsp_canonicalize_js.splitlines())} lines), "
      f"lsp.worker.js ({len(lsp_worker_js.splitlines())} lines), "
      f"validate.js ({len(lsp_validate_js.splitlines())} lines), "
      f"schema.json ({len(lsp_schema_json):,} bytes)")
print(f"  Ajv:     {len(ajv_bundle_js):,} bytes (bundled via esbuild)")
print(f"  Output:  index.html ({line_count} lines)")
print(f"  JSX mode: {mode_label}")
print(f"  Transforms: stripped imports, Tooltip→RTooltip, stripped export default")
