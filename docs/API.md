# API Reference for Skin MPE

Reference for the `laser_mpe` skin MPE package.

---

## Core MPE Function

### `skin_mpe(wl_nm, t)`

Compute the skin MPE for any wavelength and exposure duration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `wl_nm` | float | Wavelength in nanometers |
| `t` | float | Exposure duration in seconds |
| **Returns** | float | Radiant exposure MPE in **J/cm²** |

**Wavelength range:** 180 nm to 1,000,000 nm (1 mm)
**Duration range:** 10⁻⁹ s to 3×10⁴ s
**Returns NaN** if outside valid range.

```python
from laser_mpe import skin_mpe

H = skin_mpe(532, 10e-9)       # 0.02 J/cm² (20 mJ/cm²)
H = skin_mpe(1064, 10e-9)      # 0.10 J/cm² (100 mJ/cm²)
H = skin_mpe(800, 1e-6)        # 800 nm, 1 µs pulse
```

For array inputs over multiple durations, use `skin_mpe_array(wl_nm, t_array)`.

---

## Repetitive-Pulse Function

### `per_pulse_MPE(wl_nm, tau, f_array, T)`

Per-pulse skin MPE using Rules 1 and 2 (Rule 3 excluded for skin).

| Parameter | Type | Description |
|-----------|------|-------------|
| `wl_nm` | float | Wavelength in nm |
| `tau` | float | Single pulse duration in seconds |
| `f_array` | float or array | Pulse repetition frequency in Hz |
| `T` | float | Total exposure duration in seconds |
| **Returns** | tuple | `(H_pulse, N)` — per-pulse MPE in J/cm² and pulse count |

```python
import numpy as np
from laser_mpe import per_pulse_MPE

f = np.array([10, 100, 1000, 10000], dtype=float)
H_pulse, N = per_pulse_MPE(800, 10e-9, f, T=1.0)
```

---

## Correction Factor

### `ca(wl_nm)`

Wavelength correction factor C_A. Takes wavelength in **nanometers**.

| Wavelength Range | Formula |
|-----------------|---------|
| 400–700 nm | C_A = 1.0 |
| 700–1050 nm | C_A = 10^(0.002 × (λ_nm − 700)) |
| 1050–1400 nm | C_A = 5.0 |
| Outside range | C_A = 1.0 (default) |

```python
from laser_mpe import ca

ca(532)     # 1.0
ca(800)     # 1.585
ca(1064)    # 5.0
```

The legacy function `CA_visible_NIR(wl_um)` takes wavelength in micrometers and is available for backward compatibility.

---

## Skin Parameters

### `get_Tmax_skin(wavelength)`

Recommended maximum exposure duration for skin. Values are read from the loaded standard's JSON data file.

| Band | T_max (default, ICNIRP 2013) |
|------|------|
| UV (180–400 nm) | 30,000 s |
| Visible (400–700 nm) | 600 s |
| NIR (700–1400 nm) | 600 s |
| FIR (1400 nm–1 mm) | 10 s |

---

### `get_skin_limiting_aperture(wavelength)`

Limiting aperture for skin MPE averaging.

Returns a dict: `{'diameter_mm': float, 'area_cm2': float}`

| Wavelength | Diameter (default, ICNIRP 2013) |
|-----------|----------|
| 180 nm–100 µm | 3.5 mm |
| 100–1000 µm | 11.0 mm |

---

### `large_area_MPE_skin(beam_area_cm2)`

Large area correction for λ > 1.4 µm, t > 10 s.

Returns MPE in mW/cm², or `None` if beam area < threshold.

---

### `uv_successive_day_derate(wavelength, H_mpe)`

Apply the successive-day de-rating factor for UV exposures.

---

## Standard Management

### `load_standard(source)`

Load a different standard data file. `source` can be a file path (str/Path) or an already-parsed dict. Pass `None` to reload the default standard.

### `get_standard()`

Return the currently loaded standard's metadata dict.

### `validate_standard(data)`

Validate a standard data dict against the expected schema. Returns a list of error strings (empty = valid).

---

## Unit Conversions

| Function | Description |
|----------|-------------|
| `radiant_exposure_convert(H, to_unit)` | Convert J/cm² to `'mJ/cm2'`, `'J/m2'`, `'mJ/m2'` |
| `irradiance_from_radiant_exposure(H, t)` | Returns dict with `'W/cm2'`, `'mW/cm2'`, `'W/m2'` |
| `pulse_energy_from_radiant_exposure(H, area)` | Returns dict with `'J'`, `'mJ'`, `'uJ'` |
| `average_power_from_radiant_exposure(H, t, area)` | Returns dict with `'W'`, `'mW'` |

---

## Legacy Functions

For backward compatibility, the following ICNIRP-named functions are available in `laser_mpe.legacy`. They delegate to the generic engine and work with whatever standard is loaded:

`H_skin_ICNIRP_MPE`, `H_skin_ICNIRP_180_400`, `H_skin_ICNIRP_400_1400`, `H_skin_ICNIRP_1400_1500`, `H_skin_ICNIRP_1500_1800`, `H_skin_ICNIRP_1800_2600`, `H_skin_ICNIRP_2600_1000um`.

These functions take wavelength in **micrometers** (not nm). The primary API function `skin_mpe(wl_nm, t)` takes nanometers.
