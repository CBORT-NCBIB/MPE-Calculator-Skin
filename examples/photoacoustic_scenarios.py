"""
Photoacoustic imaging safety evaluations — real-world scenarios.

This script demonstrates how to use the Laser MPE Calculator to evaluate
whether common photoacoustic imaging systems are within the
maximum permissible exposure limits for skin.

Scenarios:
    1. OR-PAM (Optical-Resolution Photoacoustic Microscopy) at 532 nm
    2. AR-PAM (Acoustic-Resolution PAM) at 532 nm
    3. PACT (Photoacoustic Computed Tomography) with Nd:YAG at 1064 nm
    4. Tunable OPO system scanning 680-950 nm
    5. UV-PAM at 266 nm
    6. SWIR photoacoustic at 1700 nm

Each scenario walks through the full evaluation procedure:
    1. Define laser parameters.
    2. Determine the appropriate limiting aperture.
    3. Compute the radiant exposure at the limiting aperture.
    4. Look up the MPE for the exposure conditions.
    5. Compare and report the safety ratio.
"""

import numpy as np
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from laser_mpe import (
    skin_mpe,
    per_pulse_MPE,
    get_Tmax_skin,
    get_skin_limiting_aperture,
    radiant_exposure_convert,
    irradiance_from_radiant_exposure,
    pulse_energy_from_radiant_exposure,
)


def evaluate_skin_safety(name, wl_nm, pulse_energy_uJ, beam_diameter_mm,
                          tau_s, prf_Hz, T_exposure_s):
    """
    Full skin safety evaluation for a pulsed laser system.

    Parameters
    ----------
    name : str
        Name of the system for display.
    wl_nm : float
        Wavelength in nm.
    pulse_energy_uJ : float
        Pulse energy in microjoules.
    beam_diameter_mm : float
        Beam diameter (1/e^2) in mm at the tissue surface.
    tau_s : float
        Pulse duration in seconds.
    prf_Hz : float
        Pulse repetition frequency in Hz.
    T_exposure_s : float
        Total exposure duration in seconds.
    """
    print(f"\n{'=' * 70}")
    print(f"  {name}")
    print(f"{'=' * 70}")

    # --- System parameters ---
    print(f"\n  Laser parameters:")
    print(f"    Wavelength:       {wl_nm} nm")
    print(f"    Pulse energy:     {pulse_energy_uJ} uJ")
    print(f"    Beam diameter:    {beam_diameter_mm} mm")
    print(f"    Pulse duration:   {tau_s*1e9:.1f} ns")
    print(f"    PRF:              {prf_Hz:.0f} Hz")
    print(f"    Exposure time:    {T_exposure_s} s")

    # --- Compute beam area ---
    beam_radius_cm = (beam_diameter_mm / 2.0) / 10.0
    beam_area_cm2 = np.pi * beam_radius_cm**2

    # --- Get limiting aperture ---
    aperture = get_skin_limiting_aperture(wl_nm)
    aperture_area_cm2 = aperture['area_cm2']

    # The radiant exposure is averaged over the larger of beam area
    # and limiting aperture area
    averaging_area_cm2 = max(beam_area_cm2, aperture_area_cm2)

    print(f"\n  Aperture and area:")
    print(f"    Beam area:        {beam_area_cm2:.6f} cm^2")
    print(f"    Limiting aperture:{aperture['diameter_mm']} mm "
          f"({aperture_area_cm2:.6f} cm^2)")
    print(f"    Averaging area:   {averaging_area_cm2:.6f} cm^2")
    if beam_area_cm2 < aperture_area_cm2:
        print(f"    NOTE: Beam is smaller than limiting aperture.")
        print(f"          Energy is averaged over the aperture area.")

    # --- Actual radiant exposure per pulse ---
    pulse_energy_J = pulse_energy_uJ * 1e-6
    H_actual_per_pulse = pulse_energy_J / averaging_area_cm2

    # --- MPE per pulse (repetitive pulse) ---
    H_mpe_pulse, N = per_pulse_MPE(
        wl_nm, tau_s, np.array([prf_Hz]), T_exposure_s
    )
    H_mpe = H_mpe_pulse[0]
    n_pulses = N[0]

    # --- Single-pulse MPE for reference ---
    H_single = skin_mpe(wl_nm, tau_s)

    # --- T_max ---
    T_max = get_Tmax_skin(wl_nm)

    # --- Safety ratio ---
    ratio = H_actual_per_pulse / H_mpe

    print(f"\n  MPE evaluation:")
    print(f"    T_max (recommended): {T_max} s")
    print(f"    Number of pulses:    {n_pulses:.0f}")
    print(f"    Single-pulse MPE:    {H_single*1e3:.4f} mJ/cm^2")
    print(f"    Rep-pulse MPE:       {H_mpe*1e3:.4f} mJ/cm^2 per pulse")
    print(f"    Actual H per pulse:  {H_actual_per_pulse*1e3:.4f} mJ/cm^2")
    print(f"    Safety ratio:        {ratio:.4f} ({ratio*100:.1f}% of MPE)")

    if ratio <= 1.0:
        print(f"\n    RESULT: WITHIN MPE (safe)")
    else:
        print(f"\n    RESULT: EXCEEDS MPE by {(ratio-1)*100:.1f}%")
        # Compute maximum safe pulse energy
        max_energy_J = H_mpe * averaging_area_cm2
        print(f"    Maximum safe pulse energy: {max_energy_J*1e6:.2f} uJ")

    return ratio


def main():
    print("PHOTOACOUSTIC IMAGING — SKIN MPE SAFETY EVALUATIONS")
    print("Based on loaded standard")

    # ---------------------------------------------------------------
    # Scenario 1: OR-PAM at 532 nm
    # Typical: tightly focused beam, low pulse energy, high PRF
    # ---------------------------------------------------------------
    evaluate_skin_safety(
        name="Scenario 1: OR-PAM at 532 nm",
        wl_nm=532,
        pulse_energy_uJ=0.1,       # 100 nJ
        beam_diameter_mm=0.005,     # 5 um spot
        tau_s=5e-9,                 # 5 ns
        prf_Hz=100000,              # 100 kHz
        T_exposure_s=1.0,
    )

    # ---------------------------------------------------------------
    # Scenario 2: AR-PAM at 532 nm
    # Typical: broader beam, higher pulse energy, moderate PRF
    # ---------------------------------------------------------------
    evaluate_skin_safety(
        name="Scenario 2: AR-PAM at 532 nm",
        wl_nm=532,
        pulse_energy_uJ=100,       # 100 uJ
        beam_diameter_mm=2.0,       # 2 mm spot
        tau_s=10e-9,                # 10 ns
        prf_Hz=1000,                # 1 kHz
        T_exposure_s=1.0,
    )

    # ---------------------------------------------------------------
    # Scenario 3: PACT with Nd:YAG at 1064 nm
    # Typical: large beam illuminating tissue surface, low PRF
    # ---------------------------------------------------------------
    evaluate_skin_safety(
        name="Scenario 3: PACT with Nd:YAG at 1064 nm",
        wl_nm=1064,
        pulse_energy_uJ=5000,      # 5 mJ
        beam_diameter_mm=10.0,      # 10 mm illumination
        tau_s=10e-9,                # 10 ns
        prf_Hz=10,                  # 10 Hz
        T_exposure_s=10.0,
    )

    # ---------------------------------------------------------------
    # Scenario 4: Tunable OPO system (680-950 nm)
    # Evaluate MPE across the tuning range
    # ---------------------------------------------------------------
    print(f"\n{'=' * 70}")
    print(f"  Scenario 4: Tunable OPO system (680-950 nm)")
    print(f"{'=' * 70}")

    wavelengths = np.arange(680, 960, 20)
    tau = 10e-9
    prf = 10.0
    T = 10.0
    pulse_energy_uJ = 1000  # 1 mJ
    beam_diameter_mm = 5.0

    beam_area = np.pi * (beam_diameter_mm / 20.0)**2
    aperture_area = get_skin_limiting_aperture(700)['area_cm2']
    avg_area = max(beam_area, aperture_area)
    H_actual = (pulse_energy_uJ * 1e-6) / avg_area

    print(f"\n  Fixed parameters: {tau*1e9:.0f} ns, {prf:.0f} Hz, "
          f"{T:.0f} s, {pulse_energy_uJ} uJ, {beam_diameter_mm} mm beam")
    print(f"\n  {'Wavelength (nm)':<18} {'MPE/pulse (mJ/cm2)':<22} "
          f"{'Actual (mJ/cm2)':<18} {'Ratio':<10} {'Status'}")
    print(f"  {'-'*78}")

    for wl in wavelengths:
        H_mpe, N = per_pulse_MPE(wl, tau, np.array([prf]), T)
        ratio = H_actual / H_mpe[0]
        status = "OK" if ratio <= 1.0 else "EXCEEDS"
        print(f"  {wl:<18} {H_mpe[0]*1e3:<22.4f} {H_actual*1e3:<18.4f} "
              f"{ratio:<10.4f} {status}")

    # ---------------------------------------------------------------
    # Scenario 5: UV-PAM at 266 nm
    # UV has much more restrictive MPE limits
    # ---------------------------------------------------------------
    evaluate_skin_safety(
        name="Scenario 5: UV-PAM at 266 nm",
        wl_nm=266,
        pulse_energy_uJ=0.01,      # 10 nJ
        beam_diameter_mm=0.01,      # 10 um spot
        tau_s=5e-9,                 # 5 ns
        prf_Hz=10000,               # 10 kHz
        T_exposure_s=1.0,
    )

    # ---------------------------------------------------------------
    # Scenario 6: SWIR photoacoustic at 1700 nm
    # Lipid imaging in the SWIR window
    # ---------------------------------------------------------------
    evaluate_skin_safety(
        name="Scenario 6: SWIR PA at 1700 nm (lipid imaging)",
        wl_nm=1700,
        pulse_energy_uJ=500,       # 500 uJ
        beam_diameter_mm=3.0,       # 3 mm spot
        tau_s=10e-9,                # 10 ns
        prf_Hz=10,                  # 10 Hz
        T_exposure_s=10.0,
    )


if __name__ == "__main__":
    main()
