# Standard Data Files

This directory contains JSON data files defining laser skin MPE values for
different safety standards. The calculation engine (`engine.js` and
`src/laser_mpe/engine.py`) reads these files at runtime — **no code changes
are needed to switch standards**.

## Currently included

| File | Standard | Reference |
|------|----------|-----------|
| `icnirp_2013.json` | ICNIRP 2013 | Health Phys. 105(3):271–295 |

## Creating a new standard file

Copy `icnirp_2013.json` as a starting point and edit the values. The engine
supports six formula types, described below. All MPE values must be expressed
in **J/cm²**.

### Top-level structure

```json
{
  "standard": { ... },          // Metadata (name, reference, year)
  "correction_factors": { ... },// C_A or equivalent
  "uv_discrete_steps": { ... }, // Wavelength step-function lookup (if applicable)
  "display_bands": [ ... ],     // Band names for UI display
  "bands": [ ... ]              // MPE band definitions (the core data)
}
```

### Formula types

Each duration sub-region within a band declares a `formula` field:

| Type | Equation | JSON fields | Notes |
|------|----------|-------------|-------|
| `constant` | H = a | `a` | Fixed MPE regardless of duration |
| `power` | H = a × t^b | `a`, `b` | Power-law scaling with duration |
| `linear` | H = a × t | `a` | Irradiance limit (H = E × t) |
| `ca_constant` | H = a × C_A(λ) | `a` | Constant with correction factor |
| `ca_power` | H = a × C_A(λ) × t^b | `a`, `b` | Power law with correction factor |
| `ca_linear` | H = a × C_A(λ) × t | `a` | Irradiance with correction factor |
| `discrete` | Step-function lookup | `lookup` | References `uv_discrete_steps` |

### Band modes

Each band declares a `mode` field:

- `"single"` — One set of duration sub-regions. Standard mode for most bands.
- `"dual_limit"` — Two parallel limits (e.g., thermal and photochemical for UV).
  The effective MPE is the minimum of the two. Requires `thermal` and
  `photochemical` sub-objects, each containing their own `regions` array.

### Duration sub-region fields

Each region in a band's `regions` array:

| Field | Required | Description |
|-------|----------|-------------|
| `t_min_s` | Yes | Lower duration bound (inclusive) |
| `t_max_s` | Yes | Upper duration bound (exclusive) |
| `formula` | Yes | One of the formula types above |
| `a` | Depends | Coefficient (required for all except `discrete`) |
| `b` | Depends | Exponent (required for `power`, `ca_power`) |
| `wl_min_nm` | Optional | Wavelength sub-filter (for UV photochemical sub-bands) |
| `wl_max_nm` | Optional | Wavelength sub-filter upper bound |
| `below_t_min` | Optional | Set to `"not_applicable"` if this limit does not apply below t_min |
| `note` | Optional | Human-readable description |

### Correction factor C_A

The `correction_factors.CA.regions` array supports:

- `"constant"` — `{"type": "constant", "value": 1.0}`
- `"power10"` — `{"type": "power10", "coefficient": 0.002, "offset_nm": 700}`
  evaluates as `10^(coefficient × (λ_nm − offset_nm))`

### Switching the active standard

**JavaScript (Node.js):**
```javascript
var engine = require('./web/engine.js');
var ansi = require('./web/standards/ansi_z136_2022.json');
engine.loadStandard(ansi);
```

**Python:**
```python
from laser_mpe.engine import load_standard, skin_mpe
load_standard('web/standards/ansi_z136_2022.json')
H = skin_mpe(532, 1e-8)  # Now uses ANSI values
```

**Web (index.html):**
Edit `web/config.js` to point to the desired JSON file.

### Unit convention

All standards must express MPE values in the JSON using these units:

- Wavelengths: nanometers (nm)
- Durations: seconds (s)
- MPE: J/cm² (radiant exposure)
