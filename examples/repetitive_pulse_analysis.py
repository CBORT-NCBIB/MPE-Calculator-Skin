"""
Repetitive-pulse skin MPE analysis for laser system optimization.

In pulsed laser imaging, signal-to-noise ratio (SNR) improves with
averaging over multiple pulses: SNR ~ sqrt(N) * (H_pulse / H_ref).
However, the per-pulse MPE decreases as PRF increases (Rule 2 becomes
the binding constraint). This creates an optimal PRF that maximizes
the SNR achievable within the MPE limit.

This script demonstrates:
    1. How per-pulse skin MPE varies with PRF (Rules 1 and 2 crossover).
    2. The SNR optimization analysis for different exposure durations.
    3. How to find the maximum safe pulse energy at a given PRF.
"""

import numpy as np
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from laser_mpe import (
    skin_mpe,
    per_pulse_MPE,
    radiant_exposure_convert,
    get_skin_limiting_aperture,
)


def per_pulse_mpe_vs_prf():
    """Show how per-pulse skin MPE decreases with PRF."""
    print("=" * 70)
    print("  Per-pulse skin MPE vs PRF")
    print("=" * 70)

    wl = 800       # nm
    tau = 10e-9    # 10 ns
    T = 1.0        # 1 s exposure

    H_single = skin_mpe(wl, tau)
    H_total = skin_mpe(wl, T)

    prf_values = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
    f_array = np.array(prf_values, dtype=float)

    H_pulse, N = per_pulse_MPE(wl, tau, f_array, T)

    print(f"\n  Wavelength: {wl} nm, pulse: {tau*1e9:.0f} ns, "
          f"exposure: {T} s")
    print(f"  Single-pulse MPE:  {H_single*1e3:.4f} mJ/cm^2 (Rule 1)")
    print(f"  Total MPE for {T}s: {H_total*1e3:.4f} mJ/cm^2 (Rule 2 basis)")

    print(f"\n  {'PRF (Hz)':<12} {'N pulses':<12} {'MPE/pulse':<16} "
          f"{'Rule 1':<16} {'Rule 2':<16} {'Binding'}")
    print(f"  {'':>12} {'':>12} {'(mJ/cm2)':<16} "
          f"{'(mJ/cm2)':<16} {'(mJ/cm2)':<16}")
    print(f"  {'-'*84}")

    for i, prf in enumerate(prf_values):
        n = prf * T
        rule1 = H_single
        rule2 = H_total / n if n > 1 else H_single
        binding = "Rule 1" if rule1 <= rule2 else "Rule 2"
        print(f"  {prf:<12} {n:<12.0f} {H_pulse[i]*1e3:<16.4f} "
              f"{rule1*1e3:<16.4f} {rule2*1e3:<16.4f} {binding}")


def snr_optimization():
    """
    Find the PRF that maximizes PA-SNR within the skin MPE limit.

    SNR ~ sqrt(N) * H_pulse, normalized to SNR=1 at N=1.
    """
    print(f"\n{'=' * 70}")
    print(f"  SNR Optimization: finding the optimal PRF")
    print(f"{'=' * 70}")

    wl = 800
    tau = 10e-9
    H_single = skin_mpe(wl, tau)

    exposure_times = [0.01, 0.1, 1.0, 10.0]
    prf_array = np.logspace(0, 5, 500)

    print(f"\n  Wavelength: {wl} nm, pulse: {tau*1e9:.0f} ns")
    print(f"\n  {'Exposure (s)':<16} {'Optimal PRF':<16} {'N at optimal':<16} "
          f"{'Max SNR':<12} {'MPE/pulse'}")
    print(f"  {'-'*76}")

    for T in exposure_times:
        H_pulse, N = per_pulse_MPE(wl, tau, prf_array, T)

        # SNR = sqrt(N) * (H_pulse / H_single), normalized so SNR=1 at N=1
        SNR = np.sqrt(np.maximum(N, 1.0)) * (H_pulse / H_single)

        idx_max = np.argmax(SNR)
        f_opt = prf_array[idx_max]
        n_opt = f_opt * T
        snr_max = SNR[idx_max]
        h_opt = H_pulse[idx_max]

        print(f"  {T:<16.2f} {f_opt:<16.0f} {n_opt:<16.0f} "
              f"{snr_max:<12.2f} {h_opt*1e3:.4f} mJ/cm^2")

    print(f"\n  Interpretation: At longer exposure times, more pulses can be")
    print(f"  averaged, but each pulse must be weaker (Rule 2). The optimal")
    print(f"  PRF balances these two effects to maximize achievable SNR.")


def max_safe_energy():
    """
    Compute the maximum safe pulse energy for a given beam geometry and PRF.

    This is the practical question: "What's the strongest pulse I can use?"
    """
    print(f"\n{'=' * 70}")
    print(f"  Maximum safe pulse energy calculator")
    print(f"{'=' * 70}")

    configs = [
        {"name": "OR-PAM focused", "wl": 532, "beam_mm": 0.005,
         "prf": 100000, "T": 1.0},
        {"name": "AR-PAM", "wl": 532, "beam_mm": 2.0,
         "prf": 1000, "T": 1.0},
        {"name": "PACT Nd:YAG", "wl": 1064, "beam_mm": 10.0,
         "prf": 10, "T": 10.0},
        {"name": "PACT OPO", "wl": 800, "beam_mm": 8.0,
         "prf": 10, "T": 10.0},
    ]

    print(f"\n  {'System':<20} {'WL (nm)':<10} {'Beam (mm)':<12} "
          f"{'PRF (Hz)':<12} {'Max E (uJ)':<14} {'Max E (mJ)'}")
    print(f"  {'-'*78}")

    for c in configs:
        tau = 10e-9

        # Per-pulse MPE
        H_mpe, N = per_pulse_MPE(
            c['wl'], tau, np.array([float(c['prf'])]), c['T']
        )

        # Averaging area
        beam_area = np.pi * (c['beam_mm'] / 20.0)**2
        ap_area = get_skin_limiting_aperture(c['wl'])['area_cm2']
        avg_area = max(beam_area, ap_area)

        # Maximum safe energy = MPE * area
        max_E_J = H_mpe[0] * avg_area
        max_E_uJ = max_E_J * 1e6
        max_E_mJ = max_E_J * 1e3

        print(f"  {c['name']:<20} {c['wl']:<10} {c['beam_mm']:<12} "
              f"{c['prf']:<12} {max_E_uJ:<14.2f} {max_E_mJ:.4f}")


if __name__ == "__main__":
    per_pulse_mpe_vs_prf()
    snr_optimization()
    max_safe_energy()
