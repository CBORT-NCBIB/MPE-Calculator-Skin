#!/usr/bin/env python3
"""
Build script: generates web/index.html from calculator.jsx + standards JSON.

Transformations applied to calculator.jsx for browser embedding:
  1. Strip ESM import lines (React/Recharts loaded via CDN globals)
  2. Rename Tooltip → RTooltip (avoids HTML <tooltip> collision in some browsers)
  3. Strip 'export default' from App function
  4. Add ReactDOM.createRoot() bootstrap at the end

Run from the repository root or web/ directory:
  python3 build.py
"""

import json
import os
import sys

# Find the web/ directory
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
out_path = os.path.join(web_dir, "index.html")

# Read sources
with open(jsx_path, "r") as f:
    jsx = f.read()
with open(json_path, "r") as f:
    std_json = f.read().strip()

# Transform JSX for browser embedding
lines = jsx.split("\n")
out_lines = []
for line in lines:
    # Strip ESM imports
    if line.startswith("import ") and (" from " in line):
        continue
    # Strip 'export default'
    line = line.replace("export default function App()", "function App()")
    out_lines.append(line)

jsx_body = "\n".join(out_lines)

# Rename Tooltip → RTooltip (Recharts component)
# Only rename the JSX tag usage, not the string "Tooltip" in labels/text
jsx_body = jsx_body.replace("<Tooltip ", "<RTooltip ")
jsx_body = jsx_body.replace("</Tooltip>", "</RTooltip>")

# Build the HTML
html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Laser Skin MPE Calculator</title>
  <style>
    *{{margin:0;padding:0;box-sizing:border-box}}
    body{{font-family:system-ui,sans-serif}}
    #root{{min-height:100vh}}
    .ls{{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;color:#525960;font-family:monospace;font-size:14px;gap:12px}}
    .ls .err{{color:#D55E00;font-size:12px;max-width:600px;text-align:center;line-height:1.5}}
  </style>
</head>
<body>
<div id="root"><div class="ls"><div id="lt">Loading calculator...</div><div id="le" class="err"></div></div></div>

<script>var le=[];function se(n){{return function(){{le.push(n);document.getElementById('le').textContent='Failed to load: '+le.join(', ')+'.';}}}}</script>
<script src="https://unpkg.com/react@18.2.0/umd/react.production.min.js" onerror="se('React')()"></script>
<script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js" onerror="se('ReactDOM')()"></script>
<script src="https://unpkg.com/prop-types@15.8.1/prop-types.min.js" onerror="se('PropTypes')()"></script>
<script src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js" onerror="se('Recharts')()"></script>
<script src="https://cdn.plot.ly/plotly-basic-2.35.2.min.js" onerror="se('Plotly')()"></script>
<script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js" onerror="se('Babel')()"></script>

<script>
// Standard data (injected from ./standards/icnirp_2013.json)
var __STD_DATA__ = {std_json};
</script>

<script type="text/babel">

var useState=React.useState,useMemo=React.useMemo,useEffect=React.useEffect,useRef=React.useRef;
var LineChart=Recharts.LineChart,Line=Recharts.Line,XAxis=Recharts.XAxis,YAxis=Recharts.YAxis,CartesianGrid=Recharts.CartesianGrid,RTooltip=Recharts.Tooltip,ReferenceDot=Recharts.ReferenceDot,ResponsiveContainer=Recharts.ResponsiveContainer,ReferenceLine=Recharts.ReferenceLine,Legend=Recharts.Legend,Label=Recharts.Label;

{jsx_body}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
</script>
</body>
</html>'''

with open(out_path, "w") as f:
    f.write(html)

line_count = html.count("\n") + 1
print(f"Built {out_path}")
print(f"  Sources: calculator.jsx ({len(lines)} lines), icnirp_2013.json")
print(f"  Output:  index.html ({line_count} lines)")
print(f"  Transforms: stripped imports, Tooltip→RTooltip, stripped export default")
