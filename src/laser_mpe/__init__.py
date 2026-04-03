"""
laser_mpe : Laser Maximum Permissible Exposure Calculator (Skin)

A Python package for computing laser skin MPE values. The engine
reads all standard-specific values from a JSON data file, making
it compatible with any laser safety standard (ICNIRP, ANSI Z136.1,
IEC 60825-1, etc.).

Default standard: ICNIRP 2013 (web/standards/icnirp_2013.json).

To switch standards:

    >>> from laser_mpe import load_standard
    >>> load_standard('path/to/ansi_z136_2022.json')
    >>> # All functions now use the new standard's values

Primary API (standard-agnostic):
    skin_mpe(wl_nm, t)      — MPE for any wavelength/duration
    ca(wl_nm)               — Correction factor C_A
    band_name(wl_nm)        — Display band name
    rep_pulse(wl_nm, ...)   — Repetitive-pulse MPE
    load_standard(source)   — Load a different standard
    get_standard()          — Current standard metadata
"""

# ── Primary API (standard-agnostic) ──
from .engine import (
    load_standard,
    get_standard,
    validate_standard,
    skin_mpe,
    skin_mpe_array,
    ca,
    band_name,
    rep_pulse,
)

from .correction_factors import CA_visible_NIR
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

# ── Legacy API (backward-compatible, delegates to engine) ──
# These function names contain "ICNIRP" for historical reasons.
# They work with whatever standard is currently loaded.
from .legacy import (
    H_skin_ICNIRP_MPE,
    H_skin_ICNIRP_180_400,
    H_skin_ICNIRP_400_1400,
    H_skin_ICNIRP_1400_1500,
    H_skin_ICNIRP_1500_1800,
    H_skin_ICNIRP_1800_2600,
    H_skin_ICNIRP_2600_1000um,
)

__version__ = "3.0.0"
