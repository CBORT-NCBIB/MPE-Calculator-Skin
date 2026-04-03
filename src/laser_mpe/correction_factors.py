"""
Wavelength-dependent correction factors for laser skin MPE calculations.

Delegates to the generic data-driven engine. The C_A values are read
from the loaded standard's JSON data file.
"""

from .engine import ca as _ca_generic


def CA_visible_NIR(wl_um: float) -> float:
    """Wavelength correction factor C_A.

    Parameters
    ----------
    wl_um : float
        Wavelength in micrometers.

    Returns
    -------
    float
        C_A correction factor.
    """
    return _ca_generic(wl_um * 1000.0)
