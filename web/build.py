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

# ── Read sources ──
with open(jsx_path, "r") as f:
    jsx = f.read()
with open(json_path, "r") as f:
    std_json = f.read().strip()
with open(engine_path, "r") as f:
    engine_js = f.read()

# ── Strip Node.js export block from engine for browser embedding ──
# Lines between BUILD_STRIP_START and BUILD_STRIP_END contain the Node.js
# require() + module.exports block which must NOT appear in browser code.
# After stripping, only the unconditional { window.MPEEngine = {...}; } block remains.
engine_browser = []
stripping = False
for line in engine_js.split("\n"):
    if "BUILD_STRIP_START" in line:
        stripping = True
        continue
    if "BUILD_STRIP_END" in line:
        stripping = False
        continue
    if not stripping:
        engine_browser.append(line)
engine_js_browser = "\n".join(engine_browser)

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
    body{{font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}}
    input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{{
      -webkit-appearance:none;margin:0}}
    input[type=number]{{-moz-appearance:textfield}}
    ::-webkit-scrollbar{{width:6px;height:6px}}
    ::-webkit-scrollbar-track{{background:transparent}}
    ::-webkit-scrollbar-thumb{{background:#bbb;border-radius:3px}}
    ::-webkit-scrollbar-thumb:hover{{background:#888}}
    select{{cursor:pointer}}
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
var __ENGINE_SOURCE__ = {json.dumps(engine_js)};
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
print(f"  Output:  index.html ({line_count} lines)")
print(f"  JSX mode: {mode_label}")
print(f"  Transforms: stripped imports, Tooltip→RTooltip, stripped export default")
