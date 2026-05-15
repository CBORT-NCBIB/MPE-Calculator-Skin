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
# (Note: the LSP validator's Stage 1 schema check requires Ajv 8 on the
# main thread; that integration is deferred to a follow-up commit when
# the import-flow UI is added.  Commit 1 only wires up the worker, which
# does not need Ajv.)
lsp_dir = os.path.join(web_dir, "lsp")
lsp_canonicalize_path = os.path.join(lsp_dir, "canonicalize.js")
lsp_worker_path = os.path.join(web_dir, "lsp.worker.js")

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
print(f"  LSP:     canonicalize.js ({len(lsp_canonicalize_js.splitlines())} lines), lsp.worker.js ({len(lsp_worker_js.splitlines())} lines)")
print(f"  Output:  index.html ({line_count} lines)")
print(f"  JSX mode: {mode_label}")
print(f"  Transforms: stripped imports, Tooltip→RTooltip, stripped export default")
