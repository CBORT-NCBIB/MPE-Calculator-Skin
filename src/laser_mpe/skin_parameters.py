"""
Supplementary skin MPE parameters.

NOTE: Unlike the core MPE calculations (which read values from the
standard JSON file), the parameters in this module are currently
hardcoded. If you switch to a different standard, review and update
these values as needed:

    - T_max: Recommended maximum anticipated exposure durations.
    - Limiting apertures for skin.
    - Large area exposure correction for lambda > 1.4 um.
    - UV successive-day de-rating for 0.280-0.400 um.
    - Unit conversions between J/cm^2, mJ/cm^2, W/cm^2, mW/cm^2.

Default values are from ICNIRP 2013.
"""

import numpy as np


# =========================================================================
# Table 4 — Recommended T_max (Limiting Exposure Durations)
# =========================================================================

def get_Tmax_skin(wavelength):
    """
    Recommended maximum anticipated exposure duration for skin.

    ICNIRP 2013, Table 4. For skin exposure, the "Diffuse" column
    values are used.

    Table 4 note: "For single pulse lasers (PRF < 1 Hz) use actual
    laser pulse duration."

    Parameters
    ----------
    wavelength : float
        Wavelength in nm or um. Values > 10 are treated as nm.

    Returns
    -------
    float
        Recommended T_max in seconds.

    Notes
    -----
    Table 4 values for skin (Diffuse column):
        UV    (0.18 to 0.4 um):   30,000 s
        Vis   (0.4  to 0.7 um):      600 s
        NIR   (0.7  to 1.4 um):      600 s
        FIR   (1.4 um to 1 mm):       10 s
    """
    wl = float(wavelength)
    if wl > 10.0:
        wl_um = wl / 1000.0
    else:
        wl_um = wl

    if 0.180 <= wl_um < 0.400:
        return 30000.0
    elif 0.400 <= wl_um < 0.700:
        return 600.0
    elif 0.700 <= wl_um < 1.400:
        return 600.0
    elif 1.400 <= wl_um <= 1000.0:
        return 10.0
    else:
        raise ValueError(
            f"Wavelength {wavelength} is outside the 180 nm to 1 mm range."
        )


# =========================================================================
# Table 8 — Limiting Apertures for Skin
# =========================================================================

def get_skin_limiting_aperture(wavelength):
    """
    Limiting aperture diameter for skin exposure.

    ICNIRP 2013, Table 8. The skin limiting aperture is the
    maximum circular area over which irradiance or radiant exposure
    shall be averaged for comparison with the MPE.

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

    Notes
    -----
    Table 8, Skin column:
        0.180 to 100 um:    3.5 mm  (area = 9.62e-2 cm^2)
        100 to 1000 um:    11.0 mm  (area = 9.50e-1 cm^2)

    The skin aperture is constant (not time-dependent) for all
    exposure durations.
    """
    wl = float(wavelength)
    if wl > 10.0:
        wl_um = wl / 1000.0
    else:
        wl_um = wl

    if 0.180 <= wl_um < 100.0:
        d_mm = 3.5
    elif 100.0 <= wl_um <= 1000.0:
        d_mm = 11.0
    else:
        raise ValueError(
            f"Wavelength {wavelength} is outside the 180 nm to 1 mm range."
        )

    # Area in cm^2: A = pi * (d/2)^2, with d in cm
    d_cm = d_mm / 10.0
    area_cm2 = np.pi * (d_cm / 2.0) ** 2

    return {
        'diameter_mm': d_mm,
        'area_cm2': area_cm2,
    }


# =========================================================================
# ICNIRP 2013, Table 7 note c — Large Area Exposures (lambda > 1.4 um)
# =========================================================================

def large_area_MPE_skin(beam_area_cm2):
    """
    MPE correction for large beam cross-sections (lambda > 1.4 um).

    ICNIRP 2013, ICNIRP 2013, Table 7 note c:
        "For beam cross-sectional areas between 100 cm^2 and 1000 cm^2,
        the MPE for exposure durations exceeding 10 s is 10,000/A_s mW/cm^2,
        where A_s is the area of the exposed skin in cm^2. For exposed skin
        areas exceeding 1000 cm^2, the MPE is 10 mW/cm^2."

    This correction applies ONLY to:
        - Wavelengths > 1.4 um
        - Exposure durations > 10 s
        - Beam areas > 100 cm^2

    Parameters
    ----------
    beam_area_cm2 : float
        Beam cross-sectional area in cm^2.

    Returns
    -------
    float or None
        MPE irradiance in mW/cm^2, or None if beam_area < 100 cm^2
        (standard Table 7 values apply instead).

    Notes
    -----
    For beam areas < 100 cm^2, this correction does not apply and the
    standard Table 7 MPE values should be used. The caller is responsible
    for checking wavelength > 1.4 um and exposure duration > 10 s.
    """
    if beam_area_cm2 < 100.0:
        return None  # Standard Table 7 values apply
    elif beam_area_cm2 <= 1000.0:
        return 10000.0 / beam_area_cm2  # mW/cm^2
    else:
        return 10.0  # mW/cm^2


# =========================================================================
# ICNIRP 2013 — UV Successive-Day De-rating
# =========================================================================

def uv_successive_day_derate(wavelength, H_mpe):
    """
    Apply the successive-day de-rating factor for UV exposures.

    ICNIRP 2013, ICNIRP 2013:
        "For the wavelength range of 0.280 to 0.400 um, the applicable MPE
        for any 24-hour period is reduced by a factor of 2.5 times, if
        exposures on succeeding days are expected to approach that MPE."

    Parameters
    ----------
    wavelength : float
        Wavelength in nm or um. Values > 10 are treated as nm.
    H_mpe : float
        The single-day MPE in J/cm^2 (or any consistent unit).

    Returns
    -------
    float
        De-rated MPE (H_mpe / 2.5) if wavelength is in 280-400 nm range,
        otherwise returns H_mpe unchanged.

    Notes
    -----
    This de-rating applies only to the photochemical MPE (the constant
    radiant exposure values), not to the thermal MPE (0.56*t^0.25).
    It applies only when exposures on successive days are expected to
    approach the MPE level. If the exposure is a one-time event, the
    de-rating is not necessary.
    """
    wl = float(wavelength)
    if wl > 10.0:
        wl_um = wl / 1000.0
    else:
        wl_um = wl

    if 0.280 <= wl_um < 0.400:
        return H_mpe / 2.5
    else:
        return H_mpe


# =========================================================================
# Unit Conversions
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
        Dictionary with keys:
            'W/cm2': Irradiance in W/cm^2.
            'mW/cm2': Irradiance in mW/cm^2.
            'W/m2': Irradiance in W/m^2.
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
        Dictionary with keys:
            'J': Pulse energy in Joules.
            'mJ': Pulse energy in millijoules.
            'uJ': Pulse energy in microjoules.
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
        Dictionary with keys:
            'W': Power in Watts.
            'mW': Power in milliwatts.
    """
    if t <= 0:
        raise ValueError("Exposure duration must be > 0.")

    H = np.asarray(H_J_cm2, dtype=float)
    P_W = H * beam_area_cm2 / t

    return {
        'W': P_W,
        'mW': P_W * 1e3,
    }
