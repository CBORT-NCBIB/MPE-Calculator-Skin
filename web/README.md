# Laser Skin MPE Calculator — Web Interface

Interactive browser-based calculator for ICNIRP 2013 skin Maximum Permissible Exposure.

## Files

- **`index.html`** — Standalone single-file application. Open directly in any browser — no build step, no server required. Loads React and Recharts from CDN.
- **`calculator.jsx`** — React component source. Use this if integrating into an existing React project or build system.

## Quick Start

Open `index.html` in a browser. That's it.

## Features

- Single-pulse and CW skin MPE calculation (180 nm to 1 mm)
- Repetitive-pulse mode (Rules 1 and 2)
- Safety comparison (enter your fluence, get pass/fail verdict)
- Multi-wavelength comparison table and overlaid plots
- Interactive charts (MPE vs wavelength, MPE vs duration)
- Dark/light theme toggle
- Shareable URLs (all parameters encoded in the URL hash)
- PDF export for lab reports

## Deployment Options

**Standalone page:** Upload `index.html` to any web server or hosting platform. It is completely self-contained.

**Embed in existing site:** Add a link to the hosted `index.html`, or use an `<iframe>`:
```html
<iframe src="path/to/index.html" width="100%" height="900" frameborder="0"></iframe>
```

**React project integration:** Import `calculator.jsx` into your React application. Requires `react`, `recharts`, and the Google Fonts loaded in your HTML head.

## Standard

All calculations implement ICNIRP 2013 (Health Phys. 105(3):271–295), Tables 3, 5, and 7. The JavaScript calculation engine has been verified against the Python reference implementation with 240 automated checks covering every wavelength band, boundary condition, and edge case.
