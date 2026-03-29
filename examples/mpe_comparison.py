"""
Skin MPE comparison plots — across wavelengths and exposure durations.

This script generates data tables showing how the skin MPE varies with
wavelength and exposure duration. Useful for understanding the safety
landscape for laser system design.

If matplotlib is installed, generates plots. Otherwise, prints tables.
"""

import numpy as np
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from laser_mpe import (
    H_skin_ICNIRP_MPE,
    radiant_exposure_convert,
)


def mpe_vs_wavelength():
    """
    Skin MPE across the full wavelength range for a typical 10 ns pulse.
    """
    print("=" * 60)
    print("  Skin MPE vs Wavelength (single 10 ns pulse)")
    print("=" * 60)

    tau = 10e-9  # 10 ns
    wavelengths = [
        266, 355, 400, 450, 500, 532, 600, 633, 700,
        750, 800, 850, 900, 950, 1000, 1064,
        1100, 1200, 1300, 1400, 1550, 1700, 1900, 2100, 3000
    ]

    print(f"\n  {'Wavelength':<12} {'Skin MPE':<16} {'Band'}")
    print(f"  {'(nm)':<12} {'(mJ/cm2)':<16}")
    print(f"  {'-'*44}")

    for wl in wavelengths:
        H_skin = H_skin_ICNIRP_MPE(wl, tau)
        H_skin_mJ = radiant_exposure_convert(H_skin, 'mJ/cm2')

        if np.isnan(H_skin):
            print(f"  {wl:<12} {'nan':<16}")
            continue

        if wl < 400:
            band = "UV"
        elif wl < 700:
            band = "Visible"
        elif wl < 1050:
            band = "NIR (CA varies)"
        elif wl < 1400:
            band = "NIR (CA=5)"
        else:
            band = "FIR"

        print(f"  {wl:<12} {H_skin_mJ:<16.4f} {band}")


def mpe_vs_duration():
    """
    Show how skin MPE varies with exposure duration for key wavelengths.
    """
    print(f"\n{'=' * 60}")
    print(f"  Skin MPE vs Exposure Duration")
    print(f"{'=' * 60}")

    wavelengths = [532, 800, 1064, 1550]
    durations = [1e-9, 10e-9, 100e-9, 1e-6, 10e-6, 100e-6,
                 1e-3, 10e-3, 100e-3, 1.0, 10.0]

    header = f"  {'Duration':<14}"
    for wl in wavelengths:
        header += f"{wl} nm{'':>8}"
    print(f"\n{header}")
    print(f"  {'-'*62}")

    for t in durations:
        if t < 1e-6:
            t_str = f"{t*1e9:.0f} ns"
        elif t < 1e-3:
            t_str = f"{t*1e6:.0f} us"
        elif t < 1:
            t_str = f"{t*1e3:.0f} ms"
        else:
            t_str = f"{t:.1f} s"

        row = f"  {t_str:<14}"
        for wl in wavelengths:
            H = H_skin_ICNIRP_MPE(wl, t)
            if np.isnan(H):
                row += f"{'nan':<15}"
            else:
                H_mJ = radiant_exposure_convert(H, 'mJ/cm2')
                row += f"{H_mJ:<15.4f}"
        print(row)

    print(f"\n  Units: mJ/cm^2")


def try_plot():
    """Generate plots if matplotlib is available."""
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print(f"\n  [matplotlib not installed — skipping plots]")
        return

    tau = 10e-9
    wavelengths = np.arange(180, 3001, 5)
    H_skin = np.array([H_skin_ICNIRP_MPE(float(wl), tau) for wl in wavelengths])

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 8))

    # Plot 1: Skin MPE vs wavelength
    mask = np.isfinite(H_skin)
    ax1.semilogy(wavelengths[mask], H_skin[mask] * 1e3, 'b-', lw=2)
    ax1.set_xlabel('Wavelength (nm)')
    ax1.set_ylabel('Skin MPE (mJ/cm²)')
    ax1.set_title(f'Skin MPE vs Wavelength (τ = {tau*1e9:.0f} ns)')
    ax1.grid(True, which='both', ls='--', alpha=0.4)
    ax1.set_xlim(180, 3000)

    # Plot 2: Skin MPE vs exposure duration
    t_vals = np.logspace(-9, 1, 200)
    for wl, color, label in [(532, 'g', '532 nm'), (800, 'b', '800 nm'),
                              (1064, 'r', '1064 nm'), (1550, 'purple', '1550 nm')]:
        H = np.array([H_skin_ICNIRP_MPE(wl, t) for t in t_vals])
        ax2.loglog(t_vals, H * 1e3, color=color, lw=2, label=label)

    ax2.set_xlabel('Exposure Duration (s)')
    ax2.set_ylabel('Skin MPE (mJ/cm²)')
    ax2.set_title('Skin MPE vs Exposure Duration')
    ax2.legend()
    ax2.grid(True, which='both', ls='--', alpha=0.4)

    plt.tight_layout()
    plt.savefig('skin_mpe_comparison.png', dpi=150)
    print(f"\n  Plot saved to skin_mpe_comparison.png")
    plt.show()


if __name__ == "__main__":
    mpe_vs_wavelength()
    mpe_vs_duration()
    try_plot()
