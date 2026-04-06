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
json_path = os.path.join(web_dir, "standards", "icnirp_2013.json")
engine_path = os.path.join(web_dir, "engine.js")
out_path = os.path.join(web_dir, "index.html")

# ── Read sources ──
with open(jsx_path, "r") as f:
    jsx = f.read()
with open(json_path, "r") as f:
    std_json = f.read().strip()
with open(engine_path, "r") as f:
    engine_js = f.read()

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
    body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,sans-serif;
      -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}}
    input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{{
      -webkit-appearance:none;margin:0}}
    input[type=number]{{-moz-appearance:textfield}}
    ::-webkit-scrollbar{{width:6px;height:6px}}
    ::-webkit-scrollbar-track{{background:transparent}}
    ::-webkit-scrollbar-thumb{{background:#bbb;border-radius:3px}}
    ::-webkit-scrollbar-thumb:hover{{background:#888}}
    select{{cursor:pointer}}
    .plotly .modebar{{opacity:0.4;transition:opacity .2s}}
    .plotly:hover .modebar{{opacity:1}}
  </style>
</head>
<body>
<div id="root"></div>
<div id="le" style="text-align:center;padding:20px;color:#c00;font-size:14px"></div>

<script>var le=[];function se(n){{return function(){{le.push(n);document.getElementById('le').textContent='Failed to load: '+le.join(', ')+'.';}}}}</script>
<script src="https://unpkg.com/react@18.2.0/umd/react.production.min.js" crossorigin="anonymous" onerror="se('React')()"></script>
<script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js" crossorigin="anonymous" onerror="se('ReactDOM')()"></script>
<script src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js" crossorigin="anonymous" onerror="se('Recharts')()"></script>
<script src="https://cdn.plot.ly/plotly-basic-2.35.2.min.js" crossorigin="anonymous" onerror="se('Plotly')()"></script>
{babel_cdn}
<script>
// Calculation engine (from engine.js — single source of truth for all MPE logic)
{engine_js}
</script>

<script>
// Standard data (injected from ./standards/icnirp_2013.json)
var __STD_DATA__ = {std_json};
// Initialize the engine with the standard data
if (typeof MPEEngine !== "undefined") MPEEngine.loadStandard(__STD_DATA__);
</script>

<script>
// Engine source for Web Worker (scanning computation runs off main thread)
var __ENGINE_SOURCE__ = {json.dumps(engine_js)};
</script>

<script{script_type}>

{recharts_destructure}
{jsx_body}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
</script>

<noscript>
  <div style="text-align:center;padding:40px;font-size:16px;color:#333;max-width:600px;margin:0 auto;line-height:1.6">
    <h2>Laser Skin MPE Calculator</h2>
    <p>This interactive calculator requires JavaScript to run.</p>
    <p>Alternatively, you can use the <a href="https://github.com/itgall/MPE-Calculator-Skin">Python package</a>:
       <code style="display:block;margin:10px auto;padding:8px;background:#f5f5f5;border-radius:4px">pip install laser-mpe-skin</code></p>
  </div>
</noscript>
</body>
</html>'''

with open(out_path, "w") as f:
    f.write(html)

line_count = html.count("\n") + 1
print(f"Built {out_path}")
print(f"  Sources: calculator.jsx ({len(lines)} lines), engine.js ({len(engine_js.splitlines())} lines), icnirp_2013.json")
print(f"  Output:  index.html ({line_count} lines)")
print(f"  JSX mode: {mode_label}")
print(f"  Transforms: stripped imports, Tooltip→RTooltip, stripped export default")
