"""
laser_mpe — Laser Maximum Permissible Exposure Calculator (Skin)

A Python package for computing laser skin MPE values per
ICNIRP 2013, with support for single-pulse, CW, and
repetitive-pulse exposure regimes.

Modules
-------
correction_factors : C_A wavelength correction factor
icnirp_skin : ICNIRP 2013 skin MPE (180 nm to 1000 um)
repetitive_pulse : Repetitive-pulse skin MPE (Rules 1 and 2)
skin_parameters : T_max, apertures, unit conversions for skin
"""

from .correction_factors import CA_visible_NIR

from .icnirp_skin import (
    H_skin_ICNIRP_MPE,
    H_skin_ICNIRP_180_400,
    H_skin_ICNIRP_400_1400,
    H_skin_ICNIRP_1400_1500,
    H_skin_ICNIRP_1500_1800,
    H_skin_ICNIRP_1800_2600,
    H_skin_ICNIRP_2600_1000um,
)

from .repetitive_pulse import per_pulse_MPE

from .skin_parameters import (
    get_Tmax_skin,
    get_skin_limiting_aperture,
    large_area_MPE_skin,
    uv_successive_day_derate,
    radiant_exposure_convert,
    irradiance_from_radiant_exposure,
    pulse_energy_from_radiant_exposure,
    average_power_from_radiant_exposure,
)

__version__ = "0.1.0"
