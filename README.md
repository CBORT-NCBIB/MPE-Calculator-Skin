# Laser MPE Calculator for the Skin

**Laser Maximum Permissible Exposure (MPE) Calculator for Skin**

A Python package for computing laser skin MPE values with support for single-pulse, CW, and repetitive-pulse exposure regimes. Designed for researchers, laser safety officers, and engineers working in biophotonics (OCT, photoacoustic imaging, confocal microscopy), laser manufacturing, telecommunications, and any application requiring laser skin safety evaluation.

Associated with [OCT Research](https://octresearch.org/).

<p align="center">
  <img src="docs/images/skin_mpe_overview.png" alt="Skin MPE vs exposure duration" width="65%">
</p>

<p align="center"><em>Skin MPE vs. exposure duration for key laser wavelengths.</em></p>

---

## Features

- **Wavelength coverage:** 180 nm to 1000 µm (UV through far infrared)
- **Exposure durations:** 10⁻⁹ s to 3×10⁴ s (nanoseconds to hours)
- **Exposure modes:** Single-pulse, continuous-wave (CW), and repetitive-pulse
- **UV dual-limit logic:** Automatically selects the lower of photochemical and thermal limits (180–400 nm)
- **Cₐ correction factor:** Wavelength-dependent correction for 400–1400 nm
- **Repetitive-pulse rules:** Rule 1 (single-pulse limit) and Rule 2 (average power), 
- **Supporting calculations:** T_max lookup, limiting apertures, large area correction, UV successive-day de-rating
- **Unit conversions:** J/cm², mJ/cm², W/cm², mW/cm², pulse energy, average power
- **Verification:** Automated checks against hand-computed values from the standard

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

325 automated checks across 4 test suites, verified against hand-computed values from the standard:

```
Test Script                                 Checks
──────────────────────────────────────────────────
test_skin_mpe                              38
test_skin_parameters                       32
test_correction_factors                    5
verify_exhaustive                          254
──────────────────────────────────────────────────
TOTAL                                      329
```

```bash
python tests/test_skin_mpe.py
python tests/test_skin_parameters.py
python tests/test_correction_factors.py
python tests/verify_exhaustive.py
```

Full test outputs are available in [`tests/outputs/`](tests/outputs/).

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
│   ├── index.html               # Standalone interactive calculator
│   ├── calculator.jsx           # React component source
│   ├── engine.js                # JS calculation engine (Node.js)
│   ├── config.js                # Points to active standard file
│   ├── standards/               # JSON standard data files
│   │   ├── icnirp_2013.json     # Default standard data
│   │   └── README.md            # Schema documentation
│   └── README.md                # Web deployment guide
├── tests/
│   ├── outputs/                 # Full test output logs
│   └── *.py                     # 4 test suites (329 checks)
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

An interactive browser-based calculator is available in [`web/`](web/). Open `web/index.html` in any browser — no build step or server required. Features include single-pulse and repetitive-pulse calculations, safety comparison, multi-wavelength comparison with overlaid plots, dark/light theme, shareable URLs, and PDF export. See [`web/README.md`](web/README.md) for deployment options.

## Roadmap

- [x] Skin MPE (all bands, 180 nm–1000 µm)
- [x] UV dual-limit logic
- [x] Repetitive-pulse Rules 1 and 2
- [x] T_max, limiting apertures, large area correction, UV de-rating
- [x] Unit conversions
- [x] Four tests scripts
- [x] Interactive web calculator
- [ ] JOSS paper submission

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Citation

If you use this software, please cite it using [CITATION.cff](CITATION.cff).

## License

MIT (see [LICENSE](LICENSE))

## Disclaimer

This software is provided for **research and educational purposes only**. It is not a certified safety instrument and has not been endorsed or approved by any standards organization — including ICNIRP, ANSI, IEC, or any regulatory body. The output does not constitute professional safety advice and must not be used as the sole basis for any safety determination. All output should be independently verified against the full text of the applicable standard by a qualified Laser Safety Officer (LSO). By using this software, you assume all risk associated with the use of its output.
