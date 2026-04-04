"""
laser_mpe — Laser Maximum Permissible Exposure Calculator (Skin)

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
from .correction_factors import CA_visible_NIR as CA_visible_NIR
from .engine import (
    band_name as band_name,
)
from .engine import (
    ca as ca,
)
from .engine import (
    get_standard as get_standard,
)
from .engine import (
    load_standard as load_standard,
)
from .engine import (
    rep_pulse as rep_pulse,
)
from .engine import (
    skin_mpe as skin_mpe,
)
from .engine import (
    skin_mpe_array as skin_mpe_array,
)
from .engine import (
    validate_standard as validate_standard,
)
from .legacy import (
    H_skin_ICNIRP_180_400 as H_skin_ICNIRP_180_400,
)
from .legacy import (
    H_skin_ICNIRP_400_1400 as H_skin_ICNIRP_400_1400,
)

# ── Legacy API (backward-compatible, delegates to engine) ──
# These function names contain "ICNIRP" for historical reasons.
# They work with whatever standard is currently loaded.
from .legacy import (
    H_skin_ICNIRP_1400_1500 as H_skin_ICNIRP_1400_1500,
)
from .legacy import (
    H_skin_ICNIRP_1500_1800 as H_skin_ICNIRP_1500_1800,
)
from .legacy import (
    H_skin_ICNIRP_1800_2600 as H_skin_ICNIRP_1800_2600,
)
from .legacy import (
    H_skin_ICNIRP_2600_1000um as H_skin_ICNIRP_2600_1000um,
)
from .legacy import (
    H_skin_ICNIRP_MPE as H_skin_ICNIRP_MPE,
)
from .repetitive_pulse import per_pulse_MPE as per_pulse_MPE
from .skin_parameters import (
    average_power_from_radiant_exposure as average_power_from_radiant_exposure,
)
from .skin_parameters import (
    get_skin_limiting_aperture as get_skin_limiting_aperture,
)
from .skin_parameters import (
    get_Tmax_skin as get_Tmax_skin,
)
from .skin_parameters import (
    irradiance_from_radiant_exposure as irradiance_from_radiant_exposure,
)
from .skin_parameters import (
    large_area_MPE_skin as large_area_MPE_skin,
)
from .skin_parameters import (
    pulse_energy_from_radiant_exposure as pulse_energy_from_radiant_exposure,
)
from .skin_parameters import (
    radiant_exposure_convert as radiant_exposure_convert,
)
from .skin_parameters import (
    uv_successive_day_derate as uv_successive_day_derate,
)

__version__ = "3.0.0"
