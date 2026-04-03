"""
ICNIRP 2013 Skin Maximum Permissible Exposure (MPE) calculations.

This module provides backward-compatible function signatures that
delegate to the generic data-driven engine (engine.py). All
standard-specific values are read from web/standards/icnirp_2013.json.

For skin, the ICNIRP guidelines specify:
    - UV (180-400 nm): values from Table 5 (with dual thermal/photochemical limits)
    - Visible/NIR (400-1400 nm): values from Table 7
    - FIR (1400 nm - 1 mm): values from Table 5

Boundary conventions:
    - Wavelength: "lambda_1 <= lambda < lambda_2" (left-inclusive, right-exclusive)
    - Exposure duration: "t_1 <= t < t_2" (left-inclusive, right-exclusive)

All functions return radiant exposure H_MPE in J/cm^2.

References
----------
ICNIRP 2013, Table 5: Laser exposure limits (pages 283-284).
ICNIRP 2013, Table 7: Laser radiation exposure limits for the skin (page 285).
ICNIRP 2013, Table 3: Correction factors (page 282).
"""

import numpy as np

from . import engine as _engine


# =========================================================================
# Ultraviolet (180-400 nm) — ICNIRP 2013, Table 5
# =========================================================================

def H_skin_ICNIRP_UV_thermal(wl_um: float, t: float) -> float:
    """Skin MPE thermal limit for UV.

    Parameters
    ----------
    wl_um : float
        Wavelength in micrometers (0.180 <= wl < 0.400).
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Thermal MPE in J/cm^2. Returns np.nan if outside valid range.
    """
    _engine._ensure_loaded()
    for band in _engine._std["bands"]:
        if band.get("mode") == "dual_limit" and band["wl_min_nm"] <= wl_um * 1000 < band["wl_max_nm"]:
            result = _engine._eval_regions(band["thermal"]["regions"], wl_um * 1000, t)
            if np.isfinite(result):
                return float(result)
            return np.nan
    return np.nan


def H_skin_ICNIRP_UV_photochemical(wl_um: float, t: float) -> float:
    """Skin MPE photochemical limit for UV (0.180-0.400 um).

    Parameters
    ----------
    wl_um : float
        Wavelength in micrometers (0.180 <= wl < 0.400).
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Photochemical MPE in J/cm^2. Returns np.nan if outside valid range,
        np.inf if photochemical limit does not apply at this wavelength/duration.
    """
    _engine._ensure_loaded()
    for band in _engine._std["bands"]:
        if band.get("mode") == "dual_limit" and band["wl_min_nm"] <= wl_um * 1000 < band["wl_max_nm"]:
            result = _engine._eval_regions(band["photochemical"]["regions"], wl_um * 1000, t)
            if result == float('inf'):
                return np.inf
            if np.isfinite(result):
                return float(result)
            return np.nan
    return np.nan


def H_skin_ICNIRP_180_400(wl_um: float, t: float) -> float:
    """Skin MPE for UV (0.180-0.400 um) with dual-limit logic."""
    return float(_engine.skin_mpe(wl_um * 1000, t))


# =========================================================================
# Visible and Near Infrared (400-1400 nm) — ICNIRP 2013, Table 7
# =========================================================================

def H_skin_ICNIRP_400_1400(wl_um: float, t: float) -> float:
    """Skin MPE for 400-1400 nm."""
    return float(_engine.skin_mpe(wl_um * 1000, t))


# =========================================================================
# Far Infrared bands — ICNIRP 2013, Table 5
# =========================================================================

def H_skin_ICNIRP_1400_1500(t: float) -> float:
    """Skin MPE for 1400-1500 nm."""
    return float(_engine.skin_mpe(1450, t))


def H_skin_ICNIRP_1500_1800(t: float) -> float:
    """Skin MPE for 1500-1800 nm."""
    return float(_engine.skin_mpe(1650, t))


def H_skin_ICNIRP_1800_2600(t: float) -> float:
    """Skin MPE for 1800-2600 nm."""
    return float(_engine.skin_mpe(2200, t))


def H_skin_ICNIRP_2600_1000um(t: float) -> float:
    """Skin MPE for 2600 nm - 1000 um."""
    return float(_engine.skin_mpe(5000, t))


# =========================================================================
# Main dispatcher
# =========================================================================

def H_skin_ICNIRP_MPE(wavelength, t):
    """Compute skin MPE for any wavelength and time.

    Parameters
    ----------
    wavelength : float
        Wavelength in nm or um. Values > 10 are treated as nm.
    t : float or array-like
        Exposure duration in seconds.

    Returns
    -------
    H : float or ndarray
        Radiant exposure MPE in J/cm^2.
    """
    wl = float(wavelength)
    wl_nm = wl if wl > 10.0 else wl * 1000.0

    _engine._ensure_loaded()
    wl_range = _engine._std["standard"]["wl_range_nm"]
    if wl_nm < wl_range[0] or wl_nm > wl_range[1]:
        raise ValueError(
            f"Wavelength {wavelength} is outside the {wl_range[0]} nm to "
            f"{wl_range[1]/1000} um range covered by {_engine._std['standard']['name']}."
        )

    t = np.asarray(t, dtype=float)
    if t.ndim == 0:
        return float(_engine.skin_mpe(wl_nm, float(t)))
    else:
        return np.array([_engine.skin_mpe(wl_nm, float(ti)) for ti in t])
