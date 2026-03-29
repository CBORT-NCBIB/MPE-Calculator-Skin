# API Reference — Skin MPE

Complete reference for the `laser_mpe` skin MPE package.

---

## Core MPE Function

### `H_skin_ICNIRP_MPE(wavelength, t)`

Compute the ICNIRP 2013 skin MPE for any wavelength and exposure duration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `wavelength` | float | Wavelength in nm (if >10) or µm (if ≤10) |
| `t` | float or array | Exposure duration in seconds |
| **Returns** | float or ndarray | Radiant exposure MPE in **J/cm²** |

**Wavelength range:** 180 nm to 1000 µm
**Duration range:** 10⁻⁹ s to 3×10⁴ s
**Reference:** Table 7

```python
from laser_mpe import H_skin_ICNIRP_MPE

H = H_skin_ICNIRP_MPE(532, 10e-9)       # 0.02 J/cm² (20 mJ/cm²)
H = H_skin_ICNIRP_MPE(1064, 10e-9)      # 0.10 J/cm² (100 mJ/cm²)
H = H_skin_ICNIRP_MPE(0.800, 1e-6)      # µm input also works
```

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

### `CA_visible_NIR(wl_um)`

Wavelength correction factor C_A for 400–1400 nm (Table 3).

| Wavelength Range | Formula |
|-----------------|---------|
| 0.400–0.700 µm | C_A = 1.0 |
| 0.700–1.050 µm | C_A = 10^(2(λ-0.700)) |
| 1.050–1.400 µm | C_A = 5.0 |

**Note:** Takes wavelength in **micrometers** (not nm).

```python
from laser_mpe import CA_visible_NIR

CA_visible_NIR(0.532)    # 1.0
CA_visible_NIR(0.800)    # 1.585
CA_visible_NIR(1.064)    # 5.0
```

---

## Skin Parameters

### `get_Tmax_skin(wavelength)`

Recommended maximum exposure duration for skin (Table 4, Diffuse column).

| Band | T_max |
|------|-------|
| UV (180–400 nm) | 30,000 s |
| Visible (400–700 nm) | 600 s |
| NIR (700–1400 nm) | 600 s |
| FIR (1400 nm–1 mm) | 10 s |

---

### `get_skin_limiting_aperture(wavelength)`

Limiting aperture for skin MPE averaging (Table 8, Skin column).

Returns a dict: `{'diameter_mm': float, 'area_cm2': float}`

| Wavelength | Diameter |
|-----------|----------|
| 180 nm–100 µm | 3.5 mm |
| 100–1000 µm | 11.0 mm |

---

### `large_area_MPE_skin(beam_area_cm2)`

Large area correction for λ > 1.4 µm, t > 10 s (ICNIRP 2013, Table 7 note c).

Returns MPE in mW/cm², or `None` if beam area < 100 cm².

---

### `uv_successive_day_derate(wavelength, H_mpe)`

Apply the 2.5× de-rating for UV (280–400 nm) on successive days (ICNIRP 2013).

---

## Unit Conversions

| Function | Description |
|----------|-------------|
| `radiant_exposure_convert(H, to_unit)` | Convert J/cm² to `'mJ/cm2'`, `'J/m2'`, `'mJ/m2'` |
| `irradiance_from_radiant_exposure(H, t)` | Returns dict with `'W/cm2'`, `'mW/cm2'`, `'W/m2'` |
| `pulse_energy_from_radiant_exposure(H, area)` | Returns dict with `'J'`, `'mJ'`, `'uJ'` |
| `average_power_from_radiant_exposure(H, t, area)` | Returns dict with `'W'`, `'mW'` |

---

## Band-Specific Functions

For advanced use, individual band functions are also exported:

`H_skin_ICNIRP_180_400`, `H_skin_ICNIRP_400_1400`, `H_skin_ICNIRP_1400_1500`, `H_skin_ICNIRP_1500_1800`, `H_skin_ICNIRP_1800_2600`, `H_skin_ICNIRP_2600_1000um`

**Note:** Band-specific functions take wavelength in **micrometers**. The wrapper `H_skin_ICNIRP_MPE` accepts either nm or µm.
