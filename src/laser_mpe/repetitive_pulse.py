"""
Repetitive-pulse MPE calculations for skin exposure.

Skin:
    Rule 1: Single-pulse MPE limit.
    Rule 2: Average power / total dose limit (H_total(T) / N).
    Rule 3: Does NOT apply to skin exposure.
    Effective per-pulse MPE = min(Rule 1, Rule 2) for N > 1.

This module uses the generic data-driven engine. The repetitive-pulse
logic is standard-independent.
"""

from . import engine as _engine


def per_pulse_MPE(wl_nm, tau, f_array, T):
    """
    Per-pulse SKIN MPE for repetitive-pulse exposure.

    Applies Rule 1 and Rule 2 only (Rule 3 does not apply to skin).

    Parameters
    ----------
    wl_nm : float
        Wavelength in nm.
    tau : float
        Single pulse duration in seconds.
    f_array : float or array-like
        Pulse repetition frequency (Hz).
    T : float
        Total exposure duration in seconds.

    Returns
    -------
    H_pulse : ndarray
        Per-pulse MPE in J/cm^2.
    N : ndarray
        Number of pulses (f * T).
    """
    return _engine.rep_pulse(wl_nm, tau, f_array, T)
