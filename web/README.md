# Laser Skin MPE Calculator Web Interface

Interactive browser-based calculator for skin Maximum Permissible Exposure.

## Files

- **`index.html`** : Standalone single-file application. Open directly in any browser. Loads React and Recharts from CDN.
- **`calculator.jsx`** : React component source. Use this if integrating into an existing React project or build system.
- **`engine.js`** : Standalone JavaScript calculation engine (Node.js compatible). An independent implementation that reads the same standard data files as the Python engine; the two are cross-checked for equivalence by the conformance corpus in `tests/conformance/`.
- **`standards/`** : JSON data files defining standard-specific MPE values. See `standards/README.md` for the schema.

## Quick Start

Open `index.html` in a browser.

## Development

If you edit `calculator.jsx`, rebuild `index.html` by running:

```bash
cd web
python3 build.py
```

This pre-compiles `calculator.jsx` to a plain `<script>` block inside `index.html`, applying the changes needed for browser embedding (stripping ESM imports, renaming Tooltip to avoid browser conflicts, inlining the standard JSON data). The build requires Node.js with Babel and esbuild (installed via `npm install` in this directory) in addition to Python 3.

## Features

- Single-pulse and CW skin MPE calculation (180 nm to 1 mm)
- Repetitive-pulse mode (Rules 1 and 2)
- Beam safety evaluation (collapsible): limiting aperture, evaluation regime, max permissible pulse energy per Table 8 and Table 7 note b
- Safety comparison (enter your fluence or pulse energy + beam diameter, get pass/fail verdict)
- Multi-wavelength comparison table and overlaid plots
- Per-wavelength unit dropdowns (mJ/cm², J/cm², J/m², mJ/m² for fluence; W/cm², mW/cm², W/m² for irradiance)
- Interactive charts (MPE vs. wavelength, MPE vs. duration) with selectable plot units
- Photoacoustic SNR Optimizer tab (Francis et al., 2026): multi-band fluence vs. PRF, SNR vs. PRF, optimal PRF table
- Scientific notation with Unicode superscripts on plot axes and large values
- SVG and CSV export for all plots
- HTML report export
- Dark/light theme toggle

## Deployment Options

**Standalone page:** Upload `index.html` to any web server or hosting platform. The application code is inlined in the single file, but React, Recharts, and echarts load from CDNs, so the page needs internet access on first load.

**Embed in existing site:** Add a link to the hosted `index.html`, or use an `<iframe>`:
```html
<iframe src="path/to/index.html" width="100%" height="900" frameborder="0"></iframe>
```

**React project integration:** Import `calculator.jsx` into your React application. Requires `react` and `recharts`.

## Standard

All calculations use values from the loaded standard data file (default: ICNIRP 2013). See `standards/README.md` for how to switch standards. The JavaScript and Python engines are cross-checked for equivalence against a shared conformance corpus (`tests/conformance/`).
