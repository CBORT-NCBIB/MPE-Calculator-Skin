# Laser MPE Calculator for the Skin

**Laser Maximum Permissible Exposure (MPE) Calculator for Skin**

A Python package for computing laser skin MPE values with support for single-pulse, CW, and repetitive-pulse exposure regimes. Designed for researchers, laser safety officers, and engineers working in biophotonics (OCT, photoacoustic imaging, confocal microscopy), laser manufacturing, telecommunications, and any application requiring laser skin safety evaluation.

<p align="center">
  <img src="docs/images/skin_mpe_overview.png" alt="Skin MPE vs exposure duration" width="65%">
</p>

<p align="center"><em>Skin MPE vs. exposure duration for key laser wavelengths.</em></p>

---

### Authors

Isaac T. Gallegos¹\*, Brett E. Bouma¹², David Veysset¹  

### Affiliations

1. Wellman Center for Photomedicine, Harvard Medical School, Massachusetts General Hospital, Boston, MA 02114, USA  
2. Institute for Medical Engineering and Science, Massachusetts Institute of Technology, Cambridge, MA 02139, USA  

\* Corresponding author


## Features

- **Wavelength coverage:** 180 nm to 1000 µm (UV through far infrared)
- **Exposure durations:** 10⁻⁹ s to 3×10⁴ s (nanoseconds to hours)
- **Exposure modes:** Single-pulse, continuous-wave (CW), and repetitive-pulse
- **UV dual-limit logic:** Automatically selects the lower of photochemical and thermal limits (180–400 nm)
- **Cₐ correction factor:** Wavelength-dependent correction for 400–1400 nm
- **Repetitive-pulse rules:** Rule 1 (single-pulse limit) and Rule 2 (average power), 
- **Supporting calculations:** T_max lookup, limiting apertures, large area correction, UV successive-day de-rating
- **Unit conversions:** J/cm², mJ/cm², W/cm², mW/cm², pulse energy, average power
- **Verified:** Verification scripts to compare to the ICNIRP standard

## Web Calculator

An interactive browser-based calculator is available by opening `web/index.html` locally. No Python installation, server, or build step is required.
The web calculator has three tabs:

### MPE Calculator Tab
Compute single-pulse and repetitive-pulse skin MPE for any wavelength and duration. Supports multiple simultaneous laser configurations with per-wavelength unit selection. Includes interactive plots of MPE vs. wavelength and MPE vs. duration, beam geometry evaluation with limiting aperture logic, and CSV/SVG export.

### Scanning Protocols Tab
Evaluate laser safety for scanning beam systems (OCT, photoacoustic imaging, confocal microscopy, laser processing). Supports linear, unidirectional raster, and bidirectional raster scan patterns with configurable parameters including:

- **Beam parameters:** wavelength, diameter, pulse duration, PRF, average power
- **Scan pattern:** velocity, line length, number of lines, hatch spacing
- **Flyback blanking:** option to blank laser during galvo return (typical for OCT)
- **Safety evaluation:** Rule 1 (single-pulse) and Rule 2 (cumulative) per ICNIRP 2013, with analytical Gaussian cross-check ensuring grid approximations never cause unsafe underestimates
- **Visualization:** cumulative fluence heatmap, pulse timing diagram, fluence cross-section
- **Derived limits:** maximum permissible power and minimum safe scan velocity

Handles high-PRF systems (100–400 kHz) via pulse subsampling with conservative analytical bounds.

### Photoacoustic SNR Optimizer Tab
Optimize pulse repetition frequency for photoacoustic imaging based on the Francis et al. framework. Computes effective per-pulse fluence, relative SNR, and optimal PRF across multiple wavelength/pulse-duration configurations simultaneously.

## Standards Compliance

All values are verified against the loaded standard (default: ICNIRP 2013).

| Component | Description |
|---|---|
| Skin MPE | All wavelength bands (UV, Visible, Near-IR, Far-IR) |
| Correction factor Cₐ | Wavelength-dependent correction for 400–1400 nm |
| T_max | Recommended maximum exposure durations |
| Limiting apertures | Skin aperture diameters by wavelength |
| Repetitive pulse | Rules 1 and 2 (Rule 3 excluded for skin) |
| Large area correction | Beam area > 100 cm² for λ > 1.4 µm, t > 10 s |
| UV de-rating | Successive-day de-rating for 280–400 nm |

Boundary conventions follow the standard exactly: `t₁ ≤ t < t₂` and `λ₁ ≤ λ < λ₂`.


## Installation

### For users (install as a Python library)

This package can be installed and imported like any Python library. Clone the repository and install it in editable mode:

```bash
git clone https://github.com/itgall/MPE-Calculator-Skin.git
cd MPE-Calculator-Skin
pip install -e .
```

Once installed, you can import `laser_mpe` from any Python script or notebook on your system. See the [Quick Start](#quick-start) section below for usage examples, and [`docs/API.md`](docs/API.md) for the complete API reference.

### For contributors (development setup)

If you want to modify the code, add features, fix bugs, or add support for a new standard, see [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines. The development install includes test dependencies:

```bash
git clone https://github.com/itgall/MPE-Calculator-Skin.git
cd MPE-Calculator-Skin
pip install -e ".[test]"
```

### For the web calculator only (no Python required)

To use the interactive browser-based calculator without installing Python, download or clone the repository and open `web/index.html` in any browser. No build step, server, or installation is required. See [`web/README.md`](web/README.md) for details.

### Requirements

- Python ≥ 3.9
- NumPy ≥ 1.21

## Quick Start

The `laser_mpe` package is a Python library that you import and call from your own scripts, notebooks, or applications. After installation (see above), all functions are available via `import laser_mpe`. For a complete list of every function, parameter, and return type, see the [API Reference](docs/API.md).

### Single-pulse skin MPE

```python
from laser_mpe import skin_mpe

# MPE at 532 nm, 10 ns pulse duration
H = skin_mpe(532, 10e-9)
print(f"MPE = {H*1e3:.2f} mJ/cm²")  # 20.00 mJ/cm²

# MPE at 1064 nm, 10 ns pulse (CA = 5.0)
H = skin_mpe(1064, 10e-9)
print(f"MPE = {H*1e3:.2f} mJ/cm²")  # 100.00 mJ/cm²
```

### Repetitive-pulse skin MPE

```python
import numpy as np
from laser_mpe import per_pulse_MPE

# Per-pulse MPE at 800 nm, 10 ns pulses, 1 s exposure, varying PRF
H_pulse, N = per_pulse_MPE(
    wl_nm=800,
    tau=10e-9,
    f_array=np.logspace(0, 4, 100),  # 1 Hz to 10 kHz
    T=1.0,
    
)
```

### Supporting calculations

```python
from laser_mpe import (
    get_Tmax_skin,
    get_skin_limiting_aperture,
    irradiance_from_radiant_exposure,
    radiant_exposure_convert,
)

# Recommended maximum exposure duration
Tmax = get_Tmax_skin(800)  # 600 s for NIR

# Limiting aperture for skin
ap = get_skin_limiting_aperture(800)
print(f"Aperture: {ap['diameter_mm']} mm, Area: {ap['area_cm2']:.4f} cm²")

# Convert units
H = 0.02  # J/cm²
print(f"{radiant_exposure_convert(H, 'mJ/cm2')} mJ/cm²")
```

## Testing

### Python tests (71 checks)

```bash
pytest tests/ -v
```

### JavaScript engine tests (62 checks)

```bash
node tests/test_engine_js.mjs
```

Covers: core MPE computation, correction factors, repetitive-pulse rules, band classification, photoacoustic functions, beam geometry, scanning engine (pulsed + CW), analytical cross-check, flyback blanking, input validation edge cases, and cross-language equivalence (20 boundary points verified against Python).

### CI

GitHub Actions runs all tests automatically on every push:
- Python tests across Python 3.9–3.12
- Python linting (ruff)
- JavaScript engine tests (Node.js 20)
- Build verification (index.html generation + content check)

Python test outputs are available in [`tests/outputs/`](tests/outputs/).

## Package Structure

```
MPE-Calculator-Skin/
├── src/laser_mpe/
│   ├── __init__.py              # Public API
│   ├── engine.py                # Core data-driven MPE engine
│   ├── correction_factors.py    # Cₐ correction factor
│   ├── legacy.py              # Backward-compatible ICNIRP function names
│   ├── repetitive_pulse.py     # Rules 1 and 2
│   └── skin_parameters.py      # T_max, apertures, conversions
├── web/
│   ├── index.html               # Built interactive calculator (generated)
│   ├── calculator.jsx           # React component source (3 tabs)
│   ├── engine.js                # JS calculation engine (single source of truth)
│   ├── build.py                 # Build script (JSX pre-compilation + bundling)
│   ├── compute-sri.js           # SRI hash computation for CDN scripts
│   ├── standards/               # JSON standard data files
│   │   ├── icnirp_2013.json     # Default standard data
│   │   └── README.md            # Schema documentation
│   └── README.md                # Web deployment guide
├── tests/
│   ├── outputs/                 # Full test output logs
│   ├── test_engine_js.mjs       # JavaScript engine tests (62 checks)
│   └── *.py                     # 4 Python test suites (71 checks)
├── examples/
│   ├── README.md                # What each example does
│   ├── outputs/                 # Expected output for cross-checking
│   └── *.py                     # 4 example scripts
├── docs/
│   ├── API.md                   # Complete API reference
│   └── images/                  # Figures
├── LICENSE                      # MIT
├── README.md
├── CONTRIBUTING.md
├── CITATION.cff
└── pyproject.toml
```

## Web Calculator

An interactive browser-based calculator is available in [`web/`](web/). Open `web/index.html` in any browser. Features include single-pulse and repetitive-pulse calculations, safety comparison, multi-wavelength comparison with overlaid plots, dark/light theme, shareable URLs, and PDF export. See [`web/README.md`](web/README.md) for deployment options.

## Project Outline

- [x] Skin MPE (all bands, 180 nm–1000 µm)
- [x] UV dual-limit logic
- [x] Repetitive-pulse Rules 1 and 2
- [x] T_max, limiting apertures, large area correction, UV de-rating
- [x] Unit conversions
- [x] Test scripts
- [x] Interactive web calculator
- [ ] JOSS paper submission

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Citation

If you use this software, please cite it using [CITATION.cff](CITATION.cff).

## License

MIT (see [LICENSE](LICENSE))

## Disclaimer

This software is provided for **research and educational purposes only**. It is not a certified safety instrument and has not been endorsed or approved by any standards organization, including ICNIRP, ANSI, IEC, or any regulatory body. The output does not constitute professional safety advice and must not be used as the sole basis for any safety determination. All output should be independently verified against the full text of the applicable standard by a qualified Laser Safety Officer (LSO). By using this software, you assume all risk associated with the use of its output.

## References

This GitHub repository implements the ICNIRP 2013 standards using the following reference:

"ICNIRP GUIDELINES ON LIMITS OF EXPOSURE TO LASER RADIATION  OF WAVELENGTHS BETWEEN 180 nm AND 1,000 um", International Commission on Non-Ionizing Radiation Protection, 2013
