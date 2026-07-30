"""
Supplementary skin MPE parameters.

This module reads T_max, limiting apertures, large-area correction,
and UV de-rating values from the loaded standard's JSON data file.
Unit conversion functions are standard-independent (pure mathematics).

These values are defined in the "supplementary" section of the JSON.
When switching standards, the supplementary values travel with the
standard data — no code changes are needed.
"""

import math

import numpy as np

from . import engine as _engine

# =========================================================================
# T_max — Recommended Limiting Exposure Durations
# =========================================================================

def get_Tmax_skin(wavelength):
    """
    Recommended maximum anticipated exposure duration for skin.

    Reads from the "supplementary.t_max" section of the loaded standard.

    Parameters
    ----------
    wavelength : float
        Wavelength in nm or um. Values > 10 are treated as nm.

    Returns
    -------
    float
        Recommended T_max in seconds.
    """
    _engine._ensure_loaded()
    wl_nm = float(wavelength)
    if wl_nm <= 10.0:
        wl_nm = wl_nm * 1000.0

    supp = _engine._std.get("supplementary", {})
    t_max = supp.get("t_max", {})
    for region in t_max.get("regions", []):
        if region["wl_min_nm"] <= wl_nm < region["wl_max_nm"]:
            return float(region["t_max_s"])

    raise ValueError(
        f"Wavelength {wavelength} is outside the range defined in the "
        f"loaded standard's T_max table."
    )


# =========================================================================
# Limiting Apertures for Skin
# =========================================================================

def get_skin_limiting_aperture(wavelength):
    """
    Limiting aperture diameter for skin exposure.

    Reads from the "supplementary.limiting_apertures" section of the
    loaded standard.

    Parameters
    ----------
    wavelength : float
        Wavelength in nm or um. Values > 10 are treated as nm.

    Returns
    -------
    dict
        Dictionary with keys:
            'diameter_mm': Aperture diameter in mm.
            'area_cm2': Aperture area in cm^2.
    """
    _engine._ensure_loaded()
    wl_nm = float(wavelength)
    if wl_nm <= 10.0:
        wl_nm = wl_nm * 1000.0

    supp = _engine._std.get("supplementary", {})
    apertures = supp.get("limiting_apertures", {})
    for region in apertures.get("regions", []):
        if region["wl_min_nm"] <= wl_nm < region["wl_max_nm"]:
            d_mm = region["diameter_mm"]
            d_cm = d_mm / 10.0
            area_cm2 = np.pi * (d_cm / 2.0) ** 2
            return {
                'diameter_mm': d_mm,
                'area_cm2': area_cm2,
            }

    raise ValueError(
        f"Wavelength {wavelength} is outside the range defined in the "
        f"loaded standard's limiting aperture table."
    )


# =========================================================================
# Large Area Exposure Correction
# =========================================================================

def large_area_MPE_skin(beam_area_cm2, wl_nm=None, t_s=None):
    """
    MPE correction for large beam cross-sections.

    Reads thresholds and formulas from the "supplementary.large_area_correction"
    section of the loaded standard.

    Parameters
    ----------
    beam_area_cm2 : float
        Beam cross-sectional area in cm^2 (must be finite and positive).
    wl_nm : float, optional
        Wavelength in nm. If given, the correction only applies at or above the
        standard's ``wl_min_nm`` (1400 nm for ICNIRP 2013); below it, returns None.
    t_s : float, optional
        Exposure duration in seconds. If given, the correction only applies at or
        above the standard's ``t_min_s`` (10 s for ICNIRP 2013); below it, None.

    Returns
    -------
    float or None
        MPE irradiance in mW/cm^2, or None if the correction does not apply
        (below the area threshold, or outside the wavelength/duration range when
        those are supplied).

    Raises
    ------
    ValueError
        If ``beam_area_cm2`` is NaN, infinite, or not positive.
    """
    _engine._ensure_loaded()
    supp = _engine._std.get("supplementary", {})
    lac = supp.get("large_area_correction", {})
    if not lac:
        return None

    if not math.isfinite(beam_area_cm2) or beam_area_cm2 <= 0:
        raise ValueError(
            f"beam_area_cm2 must be a positive finite number, got {beam_area_cm2!r}"
        )

    # Applicability gates: the correction is defined only for λ ≥ wl_min and
    # t ≥ t_min. Enforced when the caller supplies those values.
    wl_min = lac.get("wl_min_nm")
    t_min = lac.get("t_min_s")
    if wl_nm is not None and wl_min is not None and wl_nm < wl_min:
        return None
    if t_s is not None and t_min is not None and t_s < t_min:
        return None

    try:
        threshold = float(lac["threshold_cm2"])
        cap_area = float(lac["cap_cm2"])
        cap_mW = float(lac["cap_mW_cm2"])
    except KeyError as exc:
        raise ValueError(
            "The loaded standard's large_area_correction block is missing the "
            f"required key {exc}; physics constants are not defaulted."
        ) from exc

    if beam_area_cm2 < threshold:
        return None
    elif beam_area_cm2 <= cap_area:
        return (cap_mW * cap_area) / beam_area_cm2
    else:
        return cap_mW


# =========================================================================
# UV Successive-Day De-rating
# =========================================================================

def uv_successive_day_derate(wavelength, H_mpe):
    """
    Apply the successive-day de-rating factor for UV exposures.

    Reads the de-rating factor and wavelength range from the
    "supplementary.uv_successive_day_derate" section of the loaded standard.

    Parameters
    ----------
    wavelength : float
        Wavelength in nm or um. Values > 10 are treated as nm.
    H_mpe : float
        The single-day MPE in J/cm^2 (or any consistent unit).

    Returns
    -------
    float
        De-rated MPE if wavelength is in the applicable range,
        otherwise returns H_mpe unchanged.

    Raises
    ------
    ValueError
        If the loaded standard does not define
        ``supplementary.uv_successive_day_derate`` (e.g. ANSI Z136), or defines
        it without the ``wl_min_nm`` / ``wl_max_nm`` / ``factor`` keys. The
        factor is never defaulted to an ICNIRP value.
    """
    _engine._ensure_loaded()
    wl_nm = float(wavelength)
    if wl_nm <= 10.0:
        wl_nm = wl_nm * 1000.0

    supp = _engine._std.get("supplementary", {})
    derate = supp.get("uv_successive_day_derate")
    if not derate:
        raise ValueError(
            "The loaded standard does not define a UV successive-day de-rating "
            "factor (supplementary.uv_successive_day_derate); it is not defaulted."
        )
    try:
        wl_min = float(derate["wl_min_nm"])
        wl_max = float(derate["wl_max_nm"])
        factor = float(derate["factor"])
    except KeyError as exc:
        raise ValueError(
            "The loaded standard's uv_successive_day_derate block is missing the "
            f"required key {exc}; physics constants are not defaulted."
        ) from exc

    if wl_min <= wl_nm < wl_max:
        return H_mpe / factor
    else:
        return H_mpe


# =========================================================================
# Unit Conversions (standard-independent — pure mathematics)
# =========================================================================

def radiant_exposure_convert(H_J_cm2, to_unit='mJ/cm2'):
    """
    Convert radiant exposure from J/cm^2 to other units.

    Parameters
    ----------
    H_J_cm2 : float or ndarray
        Radiant exposure in J/cm^2.
    to_unit : str
        Target unit. Options: 'mJ/cm2', 'J/m2', 'mJ/m2'.

    Returns
    -------
    float or ndarray
        Converted value.
    """
    H = np.asarray(H_J_cm2, dtype=float)
    if to_unit == 'mJ/cm2':
        return H * 1e3
    elif to_unit == 'J/m2':
        return H * 1e4
    elif to_unit == 'mJ/m2':
        return H * 1e7
    else:
        raise ValueError(f"Unknown unit '{to_unit}'. Use 'mJ/cm2', 'J/m2', or 'mJ/m2'.")


def irradiance_from_radiant_exposure(H_J_cm2, t):
    """
    Compute irradiance from radiant exposure and exposure duration.

    E = H / t

    Parameters
    ----------
    H_J_cm2 : float or ndarray
        Radiant exposure in J/cm^2.
    t : float
        Exposure duration in seconds. Must be > 0.

    Returns
    -------
    dict
        Dictionary with keys: 'W/cm2', 'mW/cm2', 'W/m2'.
    """
    if t <= 0:
        raise ValueError("Exposure duration must be > 0.")

    H = np.asarray(H_J_cm2, dtype=float)
    E_W_cm2 = H / t

    return {
        'W/cm2': E_W_cm2,
        'mW/cm2': E_W_cm2 * 1e3,
        'W/m2': E_W_cm2 * 1e4,
    }


def pulse_energy_from_radiant_exposure(H_J_cm2, beam_area_cm2):
    """
    Compute pulse energy from radiant exposure and beam area.

    Q = H * A

    Parameters
    ----------
    H_J_cm2 : float or ndarray
        Radiant exposure MPE in J/cm^2.
    beam_area_cm2 : float
        Beam area in cm^2.

    Returns
    -------
    dict
        Dictionary with keys: 'J', 'mJ', 'uJ'.
    """
    H = np.asarray(H_J_cm2, dtype=float)
    Q_J = H * beam_area_cm2

    return {
        'J': Q_J,
        'mJ': Q_J * 1e3,
        'uJ': Q_J * 1e6,
    }


def average_power_from_radiant_exposure(H_J_cm2, t, beam_area_cm2):
    """
    Compute average power from radiant exposure, duration, and beam area.

    P = H * A / t

    Parameters
    ----------
    H_J_cm2 : float or ndarray
        Radiant exposure MPE in J/cm^2.
    t : float
        Exposure duration in seconds. Must be > 0.
    beam_area_cm2 : float
        Beam area in cm^2.

    Returns
    -------
    dict
        Dictionary with keys: 'W', 'mW'.
    """
    if t <= 0:
        raise ValueError("Exposure duration must be > 0.")

    H = np.asarray(H_J_cm2, dtype=float)
    P_W = H * beam_area_cm2 / t

    return {
        'W': P_W,
        'mW': P_W * 1e3,
    }
