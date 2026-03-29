"""
ICNIRP 2013 Skin Maximum Permissible Exposure (MPE) calculations.

This module implements the piecewise skin MPE functions from the ICNIRP 2013
Guidelines on Limits of Exposure to Laser Radiation (Health Phys. 105(3):271-295).

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

from .correction_factors import CA_visible_NIR


# =========================================================================
# Ultraviolet (180-400 nm) — ICNIRP 2013, Table 5
# =========================================================================

def H_skin_ICNIRP_UV_thermal(wl_um: float, t: float) -> float:
    """
    Skin MPE thermal limit for UV.

    ICNIRP 2013, Table 5:
        180 to 315 nm, 1 ns to 10 s:  H = 5.6 t^0.25 kJ/m^2
            = 0.56 t^0.25 J/cm^2
        (listed as "Also not to exceed" for 180-315 nm)

        315 to 400 nm, 1 ns to 10 s:  H = 5.6 t^0.25 kJ/m^2
            = 0.56 t^0.25 J/cm^2

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
    if t < 1e-9 or t >= 10.0:
        return np.nan
    return 0.56 * (t ** 0.25)


def H_skin_ICNIRP_UV_photochemical(wl_um: float, t: float) -> float:
    """
    Skin MPE photochemical limit for UV (0.180-0.400 um).

    ICNIRP 2013, Table 5, UV photochemical limits.

    For 180-302 nm: H = 30 J/m^2 = 3e-3 J/cm^2 (constant, 1 ns to 30 ks).

    For 302-315 nm: Discrete 1-nm step values (1 ns to 30 ks):
        302-303 nm:  40 J/m^2   = 4.0e-3 J/cm^2
        303-304 nm:  60 J/m^2   = 6.0e-3 J/cm^2
        304-305 nm:  100 J/m^2  = 1.0e-2 J/cm^2
        305-306 nm:  160 J/m^2  = 1.6e-2 J/cm^2
        306-307 nm:  250 J/m^2  = 2.5e-2 J/cm^2
        307-308 nm:  400 J/m^2  = 4.0e-2 J/cm^2
        308-309 nm:  630 J/m^2  = 6.3e-2 J/cm^2
        309-310 nm:  1.0 kJ/m^2 = 1.0e-1 J/cm^2
        310-311 nm:  1.6 kJ/m^2 = 1.6e-1 J/cm^2
        311-312 nm:  2.5 kJ/m^2 = 2.5e-1 J/cm^2
        312-313 nm:  4.0 kJ/m^2 = 4.0e-1 J/cm^2
        313-315 nm:  6.3 kJ/m^2 = 6.3e-1 J/cm^2

    For 315-400 nm: H = 10 kJ/m^2 = 1.0 J/cm^2 (constant, 10 s to 30 ks).
        For t < 10 s, photochemical limit does not apply (thermal only).

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
    if 0.180 <= wl_um < 0.302:
        if t < 1e-9 or t >= 3e4:
            return np.nan
        return 3.0e-3

    elif 0.302 <= wl_um < 0.315:
        if t < 1e-9 or t >= 3e4:
            return np.nan

        # ICNIRP 2013 discrete 1-nm step values (Table 5)
        # Wavelength in nm for lookup
        wl_nm = wl_um * 1000.0

        if wl_nm < 303.0:
            return 4.0e-3
        elif wl_nm < 304.0:
            return 6.0e-3
        elif wl_nm < 305.0:
            return 1.0e-2
        elif wl_nm < 306.0:
            return 1.6e-2
        elif wl_nm < 307.0:
            return 2.5e-2
        elif wl_nm < 308.0:
            return 4.0e-2
        elif wl_nm < 309.0:
            return 6.3e-2
        elif wl_nm < 310.0:
            return 1.0e-1
        elif wl_nm < 311.0:
            return 1.6e-1
        elif wl_nm < 312.0:
            return 2.5e-1
        elif wl_nm < 313.0:
            return 4.0e-1
        else:
            # 313-315 nm
            return 6.3e-1

    elif 0.315 <= wl_um < 0.400:
        # Photochemical limit only defined for t >= 10 s.
        # For t < 10 s, return inf so thermal limit dominates.
        if t < 10.0:
            return np.inf
        elif t >= 3e4:
            return np.nan
        else:
            # ICNIRP 2013: H = 10 kJ/m^2 = 1.0 J/cm^2 (constant, 10 s to 30 ks)
            return 1.0

    else:
        return np.nan


def H_skin_ICNIRP_180_400(wl_um: float, t: float) -> float:
    """
    Skin MPE for UV (0.180-0.400 um) with dual-limit logic.

    ICNIRP 2013, Table 5 notes: For 180-315 nm, a thermal constraint
    ("Also not to exceed") of 0.56 t^0.25 applies for 1 ns to 10 s, in
    addition to the photochemical limits. The effective MPE is the lower
    of the two.

    For 315-400 nm, the thermal limit (0.56 t^0.25 for t < 10 s) and the
    photochemical limit (1.0 J/cm^2 for t >= 10 s) cover separate time
    ranges with no overlap.

    Parameters
    ----------
    wl_um : float
        Wavelength in micrometers (0.180 <= wl < 0.400).
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Skin MPE in J/cm^2 (the lower of thermal and photochemical limits).
    """
    H_thermal = H_skin_ICNIRP_UV_thermal(wl_um, t)
    H_photochem = H_skin_ICNIRP_UV_photochemical(wl_um, t)

    thermal_valid = np.isfinite(H_thermal)
    photochem_valid = np.isfinite(H_photochem)

    if thermal_valid and photochem_valid:
        return min(H_thermal, H_photochem)
    elif thermal_valid:
        return H_thermal
    elif photochem_valid:
        return H_photochem
    else:
        return np.nan


# =========================================================================
# Visible and Near Infrared (400-1400 nm) — ICNIRP 2013, Table 7
# =========================================================================

def H_skin_ICNIRP_400_1400(wl_um: float, t: float) -> float:
    """
    Skin MPE for 400-1400 nm.

    ICNIRP 2013, Table 7, Visible and short wavelength IRR:
        400 to 1400 nm, 1 ns  <= t < 100 ns:   H = 200 C_A J/m^2
            = 2 C_A * 10^-2 J/cm^2
        400 to 1400 nm, 100 ns <= t < 10 s:     H = 11 C_A t^0.25 kJ/m^2
            = 1.1 C_A t^0.25 J/cm^2
        400 to 1400 nm, 10 s   <= t < 30 ks:    E = 2.0 C_A kW/m^2
            = 0.2 C_A W/cm^2

    Parameters
    ----------
    wl_um : float
        Wavelength in micrometers (0.400 <= wl < 1.400).
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Skin MPE in J/cm^2.
    """
    CA = CA_visible_NIR(wl_um)

    if t < 1e-9 or t >= 3e4:
        return np.nan

    if t < 1e-7:
        # 1 ns <= t < 100 ns:  H = 2 C_A * 10^-2
        return 2.0 * CA * 1e-2
    elif t < 10.0:
        # 100 ns <= t < 10 s:  H = 1.1 C_A t^0.25
        return 1.1 * CA * (t ** 0.25)
    else:
        # 10 s <= t < 30 ks:  E = 0.2 C_A W/cm^2 -> H = E * t
        return 0.2 * CA * t


# =========================================================================
# Far Infrared: 1400-1500 nm — ICNIRP 2013, Table 5
# =========================================================================

def H_skin_ICNIRP_1400_1500(t: float) -> float:
    """
    Skin MPE for 1400-1500 nm.

    ICNIRP 2013, Table 5, Mid and long wavelength IRR:
        1400 to 1500 nm, 1 ns  <= t < 1 ms:    H = 1 kJ/m^2  = 0.1 J/cm^2
        1400 to 1500 nm, 1 ms  <= t < 10 s:     H = 5.6 t^0.25 kJ/m^2
            = 0.56 t^0.25 J/cm^2
        1400 to 1 mm,   10 s   <= t < 30 ks:    E = 1.0 kW/m^2
            = 0.1 W/cm^2

    Parameters
    ----------
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Skin MPE in J/cm^2.
    """
    if t < 1e-9 or t >= 3e4:
        return np.nan

    if t < 1e-3:
        return 0.1
    elif t < 10.0:
        return 0.56 * (t ** 0.25)
    else:
        return 0.1 * t


# =========================================================================
# Far Infrared: 1500-1800 nm — ICNIRP 2013, Table 5
# =========================================================================

def H_skin_ICNIRP_1500_1800(t: float) -> float:
    """
    Skin MPE for 1500-1800 nm.

    ICNIRP 2013, Table 5, Mid and long wavelength IRR:
        1500 to 1800 nm, 1 ns <= t < 10 s:     H = 10 kJ/m^2  = 1.0 J/cm^2
        1400 to 1 mm,   10 s  <= t < 30 ks:     E = 1.0 kW/m^2 = 0.1 W/cm^2

    Parameters
    ----------
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Skin MPE in J/cm^2.
    """
    if t < 1e-9 or t >= 3e4:
        return np.nan

    if t < 10.0:
        return 1.0
    else:
        return 0.1 * t


# =========================================================================
# Far Infrared: 1800-2600 nm — ICNIRP 2013, Table 5
# =========================================================================

def H_skin_ICNIRP_1800_2600(t: float) -> float:
    """
    Skin MPE for 1800-2600 nm.

    ICNIRP 2013, Table 5, Mid and long wavelength IRR:
        1800 to 2600 nm, 1 ns  <= t < 1 ms:    H = 1.0 kJ/m^2 = 0.1 J/cm^2
        1800 to 2600 nm, 1 ms  <= t < 10 s:     H = 5.6 t^0.25 kJ/m^2
            = 0.56 t^0.25 J/cm^2
        1400 to 1 mm,   10 s   <= t < 30 ks:    E = 1.0 kW/m^2 = 0.1 W/cm^2

    Parameters
    ----------
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Skin MPE in J/cm^2.
    """
    if t < 1e-9 or t >= 3e4:
        return np.nan

    if t < 1e-3:
        return 0.1
    elif t < 10.0:
        return 0.56 * (t ** 0.25)
    else:
        return 0.1 * t


# =========================================================================
# Far Infrared: 2600 nm - 1000 um — ICNIRP 2013, Table 5
# =========================================================================

def H_skin_ICNIRP_2600_1000um(t: float) -> float:
    """
    Skin MPE for 2600 nm - 1000 um.

    ICNIRP 2013, Table 5, Mid and long wavelength IRR:
        2600 nm to 1 mm, 1 ns   <= t < 100 ns:  H = 100 J/m^2  = 1e-2 J/cm^2
        2600 nm to 1 mm, 100 ns  <= t < 10 s:    H = 5.6 t^0.25 kJ/m^2
            = 0.56 t^0.25 J/cm^2
        1400 nm to 1 mm, 10 s    <= t < 30 ks:   E = 1.0 kW/m^2 = 0.1 W/cm^2

    Parameters
    ----------
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Skin MPE in J/cm^2.
    """
    if t < 1e-9 or t >= 3e4:
        return np.nan

    if t < 1e-7:
        return 1.0e-2
    elif t < 10.0:
        return 0.56 * (t ** 0.25)
    else:
        return 0.1 * t


# =========================================================================
# Wrapper: full ICNIRP skin MPE dispatcher
# =========================================================================

def H_skin_ICNIRP_MPE(wavelength, t):
    """
    Compute ICNIRP 2013 skin MPE for any wavelength and time.

    Dispatches to the appropriate band-specific function based on wavelength.
    Covers 180 nm to 1000 um (0.180 to 1000 um).

    Wavelength boundary convention: lambda_1 <= lambda < lambda_2

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

    Raises
    ------
    ValueError
        If wavelength is outside the 180 nm to 1000 um range.
    """
    wl = float(wavelength)
    if wl > 10.0:
        wl_um = wl / 1000.0
    else:
        wl_um = wl

    t = np.asarray(t, dtype=float)

    if 0.180 <= wl_um < 0.400:
        func = lambda ti: H_skin_ICNIRP_180_400(wl_um, ti)
    elif 0.400 <= wl_um < 1.400:
        func = lambda ti: H_skin_ICNIRP_400_1400(wl_um, ti)
    elif 1.400 <= wl_um < 1.500:
        func = H_skin_ICNIRP_1400_1500
    elif 1.500 <= wl_um < 1.800:
        func = H_skin_ICNIRP_1500_1800
    elif 1.800 <= wl_um < 2.600:
        func = H_skin_ICNIRP_1800_2600
    elif 2.600 <= wl_um <= 1000.0:
        func = H_skin_ICNIRP_2600_1000um
    else:
        raise ValueError(
            f"Wavelength {wavelength} is outside the 180 nm to 1000 um range "
            f"covered by ICNIRP 2013, Tables 5 and 7."
        )

    if t.ndim == 0:
        return float(func(float(t)))
    else:
        return np.array([func(ti) for ti in t])
