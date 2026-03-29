"""
Wavelength-dependent correction factors for laser skin MPE calculations.

Skin MPE uses only the C_A correction factor.

References
----------
ICNIRP 2013, Table 3: Correction factors (page 282).
"""

import numpy as np


def CA_visible_NIR(wl_um: float) -> float:
    """
    Wavelength correction factor C_A for 400-1400 nm.

    ICNIRP 2013, Table 3:
        400 nm <= lambda < 700 nm:    C_A = 1.0
        700 nm <= lambda < 1050 nm:   C_A = 10^(0.002*(lambda/1nm - 700))
            = 10^(2*(lambda_um - 0.700))
        1050 nm <= lambda <= 1400 nm: C_A = 5.0

    Parameters
    ----------
    wl_um : float
        Wavelength in micrometers.

    Returns
    -------
    float
        C_A correction factor.
    """
    if wl_um < 0.700:
        return 1.0
    elif wl_um < 1.050:
        return 10.0 ** (2.0 * (wl_um - 0.700))
    elif wl_um <= 1.400:
        return 5.0
    else:
        return 1.0
