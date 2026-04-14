"""
Generic data-driven laser skin MPE calculation engine.

This module reads all standard-specific values (wavelength bands,
duration boundaries, coefficients, correction factors) from a JSON
data file. No standard-specific numbers are hardcoded here.

The JSON schema is documented in web/standards/README.md.

To use a different standard:
    >>> from laser_mpe.engine import load_standard, skin_mpe
    >>> load_standard('path/to/ansi_z136_2022.json')
    >>> H = skin_mpe(532, 1e-8)  # Now uses ANSI values

Unit convention (all standards must use these units in JSON):
    Wavelength:  nm
    Duration:    s
    MPE output:  J/cm²
"""

import json
import math
import os
from pathlib import Path

import numpy as np

# ═══════════════════════════════════════════════════════════════
# Module-level state: the currently loaded standard
# ═══════════════════════════════════════════════════════════════
_std = None

# Default standard file location (relative to this module)
_DEFAULT_STANDARD = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', '..', 'web', 'standards', 'icnirp_2013.json'
)

# ═══════════════════════════════════════════════════════════════
# Schema validation
# ═══════════════════════════════════════════════════════════════
VALID_FORMULAS = frozenset([
    "constant", "power", "linear",
    "ca_constant", "ca_power", "ca_linear",
    "discrete", "power_offset"
])


def validate_standard(data):
    """Validate a standard data dict against the expected schema.

    Returns a list of error strings. Empty list means valid.
    """
    errors = []
    if not data:
        return ["No data provided"]
    if not data.get("standard", {}).get("name"):
        errors.append("Missing standard.name")
    cf = data.get("correction_factors", {})
    if not cf.get("CA"):
        errors.append("Missing correction_factors.CA")
    elif not cf["CA"].get("regions"):
        errors.append("CA: missing regions array")
    if not data.get("display_bands"):
        errors.append("Missing or empty display_bands")
    bands = data.get("bands", [])
    if not bands:
        errors.append("Missing or empty bands array")

    for bi, band in enumerate(bands):
        bname = band.get("name", f"Band {bi}")
        if band.get("wl_min_nm") is None or band.get("wl_max_nm") is None:
            errors.append(f"Band '{bname}': missing wl bounds")
        if not band.get("mode"):
            errors.append(f"Band '{bname}': missing mode")

        region_sets = []
        if band.get("mode") == "dual_limit":
            if not band.get("thermal", {}).get("regions"):
                errors.append(f"Band '{bname}': dual_limit but missing thermal.regions")
            else:
                region_sets.append(band["thermal"]["regions"])
            if not band.get("photochemical", {}).get("regions"):
                errors.append(f"Band '{bname}': dual_limit but missing photochemical.regions")
            else:
                region_sets.append(band["photochemical"]["regions"])
        else:
            regs = band.get("regions", [])
            if not regs:
                errors.append(f"Band '{bname}': missing regions array")
            else:
                region_sets.append(regs)

        for regs in region_sets:
            for ri, r in enumerate(regs):
                if r.get("t_min_s") is None or r.get("t_max_s") is None:
                    errors.append(f"Band '{bname}' region {ri}: missing t bounds")
                formula = r.get("formula")
                if not formula:
                    errors.append(f"Band '{bname}' region {ri}: missing formula")
                elif formula not in VALID_FORMULAS:
                    errors.append(f"Band '{bname}' region {ri}: unknown formula '{formula}'")
                if formula and formula != "discrete" and r.get("a") is None:
                    errors.append(f"Band '{bname}' region {ri}: formula '{formula}' requires 'a'")
                if formula in ("power", "ca_power") and r.get("b") is None:
                    errors.append(f"Band '{bname}' region {ri}: formula '{formula}' requires 'b'")

    return errors


# ═══════════════════════════════════════════════════════════════
# Loading
# ═══════════════════════════════════════════════════════════════

def load_standard(source=None):
    """Load a standard data file.

    Parameters
    ----------
    source : str or dict or None
        Path to a JSON file, or an already-parsed dict.
        If None, loads the default standard (ICNIRP 2013).

    Raises
    ------
    ValueError
        If the data fails schema validation.
    FileNotFoundError
        If the file path does not exist.
    """
    global _std

    if source is None:
        source = _DEFAULT_STANDARD

    if isinstance(source, dict):
        data = source
    elif isinstance(source, (str, Path)):
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"Standard file not found: {path}")
        with open(path, 'r') as f:
            data = json.load(f)
    else:
        raise TypeError(f"source must be a file path or dict, got {type(source)}")

    errors = validate_standard(data)
    if errors:
        raise ValueError(
            "Standard data validation failed:\n  " +
            "\n  ".join(errors)
        )

    _std = data


def get_standard():
    """Return the currently loaded standard's metadata dict."""
    _ensure_loaded()
    return _std["standard"]


def _ensure_loaded():
    """Load default standard if none is loaded yet."""
    global _std
    if _std is None:
        load_standard(None)


# ═══════════════════════════════════════════════════════════════
# Correction factor C_A
# ═══════════════════════════════════════════════════════════════

def ca(wl_nm):
    """Compute C_A correction factor for the given wavelength.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nanometers.

    Returns
    -------
    float
        Correction factor (dimensionless).
    """
    _ensure_loaded()
    ca_def = _std["correction_factors"]["CA"]
    regions = ca_def["regions"]

    for i, r in enumerate(regions):
        # Left-inclusive, right-exclusive, except inclusive upper on last region
        in_range = (wl_nm >= r["wl_min_nm"] and wl_nm < r["wl_max_nm"])
        if not in_range and i == len(regions) - 1 and wl_nm == r["wl_max_nm"]:
            in_range = True
        if not in_range:
            continue

        if r["type"] == "constant":
            return r["value"]
        if r["type"] == "power10":
            return 10.0 ** (r["coefficient"] * (wl_nm - r["offset_nm"]))

    return ca_def.get("default_outside_range", 1.0)


# ═══════════════════════════════════════════════════════════════
# UV discrete step lookup
# ═══════════════════════════════════════════════════════════════

def _uv_discrete_lookup(wl_nm, table_name=None):
    """Look up UV photochemical MPE from a discrete step table.

    Args:
        wl_nm: Wavelength in nm.
        table_name: Key in the standard dict for the lookup table.
                    Defaults to 'uv_discrete_steps'.
    """
    key = table_name or "uv_discrete_steps"
    ds = _std.get(key)
    if ds is None:
        return float('nan')
    for step in ds["steps"]:
        if wl_nm < step["wl_upper_nm"]:
            return step["H_J_cm2"]
    return ds["fallback_H_J_cm2"]


# ═══════════════════════════════════════════════════════════════
# Generic formula evaluator
# ═══════════════════════════════════════════════════════════════

def _eval_formula(region, wl_nm, t):
    """Evaluate a single formula region."""
    f = region["formula"]
    if f == "constant":
        return region["a"]
    if f == "power":
        return region["a"] * (t ** region["b"])
    if f == "linear":
        return region["a"] * t
    if f == "ca_constant":
        return region["a"] * ca(wl_nm)
    if f == "ca_power":
        return region["a"] * ca(wl_nm) * (t ** region["b"])
    if f == "ca_linear":
        return region["a"] * ca(wl_nm) * t
    if f == "discrete":
        return _uv_discrete_lookup(wl_nm, region.get("lookup"))
    if f == "power_offset":
        return region["a"] * (t ** region["b"]) + region["c"]
    return float('nan')


def _eval_regions(regions, wl_nm, t):
    """Evaluate a set of duration regions for a given wavelength and time.

    Returns NaN if t is outside all defined regions.
    """
    for r in regions:
        # Wavelength sub-filtering (used by UV photochemical sub-bands)
        if "wl_min_nm" in r and "wl_max_nm" in r:
            if wl_nm < r["wl_min_nm"] or wl_nm >= r["wl_max_nm"]:
                continue

        if r["t_min_s"] <= t < r["t_max_s"]:
            return _eval_formula(r, wl_nm, t)

        # Special handling: "not_applicable" below t_min means this limit
        # doesn't apply, so return infinity to let other limits dominate
        if t < r["t_min_s"] and r.get("below_t_min") == "not_applicable":
            if "wl_min_nm" in r and (wl_nm < r["wl_min_nm"] or wl_nm >= r["wl_max_nm"]):
                continue
            return float('inf')

    return float('nan')


def _eval_dual_limit(band, wl_nm, t):
    """Evaluate a dual-limit band (e.g., UV: min of thermal and photochemical)."""
    th = _eval_regions(band["thermal"]["regions"], wl_nm, t)
    pc = _eval_regions(band["photochemical"]["regions"], wl_nm, t)
    th_ok = math.isfinite(th)
    pc_ok = math.isfinite(pc)
    if th_ok and pc_ok:
        return min(th, pc)
    if th_ok:
        return th
    if pc_ok:
        return pc
    return float('nan')


# ═══════════════════════════════════════════════════════════════
# Main MPE function
# ═══════════════════════════════════════════════════════════════

def skin_mpe(wl_nm, t):
    """Compute skin MPE for any wavelength and duration.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nanometers.
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Radiant exposure MPE in J/cm².
        Returns NaN if outside valid range.
    """
    _ensure_loaded()
    bands = _std["bands"]
    wl_nm = float(wl_nm)
    t = float(t)

    for i, band in enumerate(bands):
        in_band = (wl_nm >= band["wl_min_nm"] and wl_nm < band["wl_max_nm"])
        # Inclusive upper bound on last band
        if not in_band and i == len(bands) - 1 and wl_nm == band["wl_max_nm"]:
            in_band = True
        if not in_band:
            continue

        if band["mode"] == "dual_limit":
            return _eval_dual_limit(band, wl_nm, t)
        return _eval_regions(band["regions"], wl_nm, t)

    return float('nan')


def skin_mpe_array(wl_nm, t_array):
    """Vectorized skin MPE over an array of durations.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nanometers.
    t_array : array-like
        Exposure durations in seconds.

    Returns
    -------
    ndarray
        MPE values in J/cm².
    """
    t_array = np.asarray(t_array, dtype=float)
    if t_array.ndim == 0:
        return float(skin_mpe(wl_nm, float(t_array)))
    return np.array([skin_mpe(wl_nm, float(ti)) for ti in t_array])


def band_name(wl_nm):
    """Return the display band name for a wavelength.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nanometers.

    Returns
    -------
    str
    """
    _ensure_loaded()
    for db in _std["display_bands"]:
        if wl_nm >= db["wl_start_nm"] and wl_nm < db["wl_end_nm"]:
            return db["name"]
    return _std["display_bands"][-1]["name"]


# ═══════════════════════════════════════════════════════════════
# Repetitive pulse (standard-independent logic)
# ═══════════════════════════════════════════════════════════════

def rep_pulse(wl_nm, tau, prf, T):
    """Per-pulse MPE for repetitive-pulse skin exposure.

    Applies Rule 1 (single-pulse limit) and Rule 2 (average-power
    limit) and returns the more restrictive.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nm.
    tau : float
        Single pulse duration in seconds.
    prf : float or array-like
        Pulse repetition frequency in Hz.
    T : float
        Total exposure duration in seconds.

    Returns
    -------
    H_pulse : float or ndarray
        Per-pulse MPE in J/cm².
    N : float or ndarray
        Number of pulses.
    """
    H_single = skin_mpe(wl_nm, tau)
    H_total = skin_mpe(wl_nm, T)

    prf = np.asarray(prf, dtype=float)
    N = prf * T

    H_avg = H_total / np.maximum(N, 1.0)
    H_pulse = np.where(N <= 1.0, H_single, np.minimum(H_single, H_avg))

    return H_pulse, N

# ═══════════════════════════════════════════════════════════════
# Large-area skin exposure correction
# ═══════════════════════════════════════════════════════════════


def large_area_irradiance_limit(wl_nm, t_s, area_cm2):
    """Compute the large-area irradiance limit in W/cm².

    Reads all parameters from the loaded standard's JSON.
    Returns infinity if the correction does not apply.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nm.
    t_s : float
        Exposure duration in seconds.
    area_cm2 : float
        Beam cross-sectional area in cm².

    Returns
    -------
    float
        Irradiance limit in W/cm², or inf if not applicable.
    """
    _ensure_loaded()
    lac = _std.get("supplementary", {}).get("large_area_correction")
    if lac is None:
        return float('inf')
    if "wl_min_nm" in lac and wl_nm < lac["wl_min_nm"]:
        return float('inf')
    if "t_min_s" in lac and t_s < lac["t_min_s"]:
        return float('inf')
    if not (area_cm2 > 0 and math.isfinite(area_cm2)):
        return float('inf')
    if area_cm2 < lac["threshold_cm2"]:
        return float('inf')
    if area_cm2 >= lac["cap_cm2"]:
        return lac["cap_mW_cm2"] / 1000.0
    coeff = lac.get("coefficient_mW_cm2_x_cm2",
                    lac["cap_mW_cm2"] * lac["cap_cm2"])
    return (coeff / area_cm2) / 1000.0


def skin_mpe_area(wl_nm, t, area_cm2):
    """Skin MPE with large-area correction applied.

    Returns min(standard_MPE, large_area_limit × t).

    Parameters
    ----------
    wl_nm : float
        Wavelength in nm.
    t : float
        Exposure duration in seconds.
    area_cm2 : float
        Beam cross-sectional area in cm².

    Returns
    -------
    float
        MPE in J/cm².
    """
    H_standard = skin_mpe(wl_nm, t)
    if not (area_cm2 > 0 and math.isfinite(area_cm2)):
        return H_standard
    E_limit = large_area_irradiance_limit(wl_nm, t, area_cm2)
    if not math.isfinite(E_limit):
        return H_standard
    H_area = E_limit * t
    return min(H_standard, H_area)


def rep_pulse_area(wl_nm, tau, prf, T, area_cm2):
    """Per-pulse MPE for repetitive-pulse skin exposure with large-area correction.

    Rule 1: single-pulse MPE (no area correction, tau < t_min_s).
    Rule 2: cumulative MPE for time T (area-corrected when T >= t_min_s).

    Parameters
    ----------
    wl_nm : float
        Wavelength in nm.
    tau : float
        Single pulse duration in seconds.
    prf : float or array-like
        Pulse repetition frequency in Hz.
    T : float
        Total exposure duration in seconds.
    area_cm2 : float
        Beam cross-sectional area in cm².

    Returns
    -------
    H_pulse : float or ndarray
        Per-pulse MPE in J/cm².
    N : float or ndarray
        Number of pulses.
    """
    H_single = skin_mpe(wl_nm, tau)
    H_total = skin_mpe_area(wl_nm, T, area_cm2)

    prf = np.asarray(prf, dtype=float)
    N = prf * T

    H_avg = H_total / np.maximum(N, 1.0)
    H_pulse = np.where(N <= 1.0, H_single, np.minimum(H_single, H_avg))

    return H_pulse, N
