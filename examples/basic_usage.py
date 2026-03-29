"""
Basic usage examples for the Laser MPE Calculator.

Demonstrates single-pulse, CW, and repetitive-pulse skin MPE calculations
using ICNIRP 2013 values.
"""

import numpy as np
from laser_mpe import (
    H_skin_ICNIRP_MPE,
    per_pulse_MPE,
    get_Tmax_skin,
    get_skin_limiting_aperture,
    radiant_exposure_convert,
    irradiance_from_radiant_exposure,
    pulse_energy_from_radiant_exposure,
)


def example_single_pulse():
    """Single-pulse skin MPE for common photoacoustic wavelengths."""
    print("=" * 60)
    print("Example 1: Single-pulse skin MPE")
    print("=" * 60)

    wavelengths = [532, 700, 800, 1064, 1550, 1900]
    tau = 10e-9  # 10 ns pulse

    print(f"\nPulse duration: {tau*1e9:.0f} ns\n")
    print(f"{'Wavelength (nm)':<18} {'H (J/cm²)':<14} {'H (mJ/cm²)':<14}")
    print("-" * 46)

    for wl in wavelengths:
        H = H_skin_ICNIRP_MPE(wl, tau)
        H_mJ = radiant_exposure_convert(H, 'mJ/cm2')
        print(f"{wl:<18} {H:<14.4f} {H_mJ:<14.2f}")


def example_repetitive_pulse():
    """Repetitive-pulse MPE for a typical photoacoustic system."""
    print("\n" + "=" * 60)
    print("Example 2: Repetitive-pulse skin MPE")
    print("=" * 60)

    wl = 800       # nm
    tau = 10e-9    # 10 ns pulse
    T = 1.0        # 1 s exposure window

    print(f"\nWavelength: {wl} nm")
    print(f"Pulse duration: {tau*1e9:.0f} ns")
    print(f"Exposure window: {T} s")

    # Sweep PRF from 1 Hz to 10 kHz
    prf_values = [1, 10, 100, 1000, 10000]
    f_array = np.array(prf_values, dtype=float)

    H_pulse, N = per_pulse_MPE(wl, tau, f_array, T)

    print(f"\n{'PRF (Hz)':<12} {'N pulses':<12} {'H/pulse (mJ/cm²)':<20}")
    print("-" * 44)
    for i, f in enumerate(prf_values):
        H_mJ = radiant_exposure_convert(H_pulse[i], 'mJ/cm2')
        print(f"{f:<12} {N[i]:<12.0f} {H_mJ:<20.4f}")


def example_practical_calculation():
    """Full practical calculation: is my laser within the MPE?"""
    print("\n" + "=" * 60)
    print("Example 3: Practical safety check")
    print("=" * 60)

    # Laser parameters
    wl = 800          # nm
    pulse_energy_uJ = 1.0   # µJ per pulse
    beam_diameter_mm = 1.0   # mm (1/e² diameter)
    tau = 10e-9       # 10 ns
    prf = 1000        # Hz
    T_exposure = 1.0  # s

    # Compute beam area
    beam_radius_cm = (beam_diameter_mm / 2) / 10  # convert to cm
    beam_area_cm2 = np.pi * beam_radius_cm**2

    # Get limiting aperture
    aperture = get_skin_limiting_aperture(wl)
    aperture_area = aperture['area_cm2']

    # Use the larger of beam area and limiting aperture for averaging
    averaging_area = max(beam_area_cm2, aperture_area)

    # Actual radiant exposure per pulse
    pulse_energy_J = pulse_energy_uJ * 1e-6
    H_actual = pulse_energy_J / averaging_area

    # MPE per pulse
    H_pulse, N = per_pulse_MPE(wl, tau, np.array([float(prf)]), T_exposure)
    H_mpe = H_pulse[0]

    # Safety ratio
    ratio = H_actual / H_mpe

    print(f"\nLaser parameters:")
    print(f"  Wavelength:     {wl} nm")
    print(f"  Pulse energy:   {pulse_energy_uJ} µJ")
    print(f"  Beam diameter:  {beam_diameter_mm} mm")
    print(f"  Beam area:      {beam_area_cm2:.4f} cm²")
    print(f"  Pulse duration: {tau*1e9:.0f} ns")
    print(f"  PRF:            {prf} Hz")
    print(f"  Exposure time:  {T_exposure} s")
    print(f"\nSkin limiting aperture: {aperture['diameter_mm']} mm "
          f"({aperture_area:.4f} cm²)")
    print(f"Averaging area:  {averaging_area:.4f} cm²")
    print(f"\nActual H/pulse:  {H_actual*1e3:.4f} mJ/cm²")
    print(f"MPE H/pulse:     {H_mpe*1e3:.4f} mJ/cm²")
    print(f"Ratio (actual/MPE): {ratio:.4f}")
    print(f"\nResult: {'WITHIN MPE' if ratio <= 1.0 else 'EXCEEDS MPE'}")


def example_tmax():
    """Recommended T_max values by wavelength band."""
    print("\n" + "=" * 60)
    print("Example 4: Recommended T_max values")
    print("=" * 60)

    bands = [
        ("UV", 355),
        ("Visible", 532),
        ("NIR", 800),
        ("NIR", 1064),
        ("FIR", 1550),
        ("FIR", 10600),
    ]

    print(f"\n{'Band':<10} {'Wavelength (nm)':<18} {'T_max (s)':<12}")
    print("-" * 40)
    for band, wl in bands:
        Tmax = get_Tmax_skin(wl)
        print(f"{band:<10} {wl:<18} {Tmax:<12.0f}")


if __name__ == "__main__":
    example_single_pulse()
    example_repetitive_pulse()
    example_practical_calculation()
    example_tmax()
