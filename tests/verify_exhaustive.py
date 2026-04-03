"""
EXHAUSTIVE VERIFICATION SCRIPT

Hand-computes every expected value from standard tables 5 and 7
formulas and compares against the code output. This is a line-by-line
audit of every function in the package.

Organization:
    Part 1: C_A correction factor (Table 3)
    Part 2: UV band (standard tables 5 and 7, 180-400 nm) : thermal, photochemical, dual limit
    Part 3: 400-1400 nm (standard tables 5 and 7)
    Part 4: 1400-1500 nm (standard tables 5 and 7)
    Part 5: 1500-1800 nm (standard tables 5 and 7)
    Part 6: 1800-2600 nm (standard tables 5 and 7)
    Part 7: 2600-1000 um (standard tables 5 and 7)
    Part 8: Wrapper dispatch at wavelength boundaries
    Part 9: Repetitive pulse (standard repetitive-pulse rules)
    Part 10: T_max (Table 4)
    Part 11: Limiting apertures (Table 8)
    Part 12: Large area (standard table note c)
    Part 13: UV de-rating (standard UV de-rating)
    Part 14: Unit conversions
    Part 15: Edge cases and error handling
"""

import sys, os, math
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from laser_mpe import *
from laser_mpe.legacy import (
    H_skin_ICNIRP_UV_thermal,
    H_skin_ICNIRP_UV_photochemical,
    H_skin_ICNIRP_180_400,
)

passed = 0
failed = 0
errors = []

def check(label, actual, expected, rtol=1e-9):
    global passed, failed, errors
    if expected is None:
        # Expect None
        if actual is None:
            passed += 1
            return
        else:
            failed += 1
            errors.append(f"  {label}: expected None, got {actual}")
            return
    if isinstance(expected, str) and expected == 'nan':
        if np.isnan(actual):
            passed += 1
        else:
            failed += 1
            errors.append(f"  {label}: expected nan, got {actual}")
        return
    if isinstance(expected, str) and expected == 'inf':
        if np.isinf(actual) and actual > 0:
            passed += 1
        else:
            failed += 1
            errors.append(f"  {label}: expected inf, got {actual}")
        return
    try:
        np.testing.assert_allclose(actual, expected, rtol=rtol)
        passed += 1
    except AssertionError:
        failed += 1
        errors.append(f"  {label}: expected {expected}, got {actual}")
    except Exception as e:
        # Handle typo in AssertionError -> AssertionError
        if abs(actual - expected) <= abs(expected) * rtol + 1e-15:
            passed += 1
        else:
            failed += 1
            errors.append(f"  {label}: expected {expected}, got {actual} (diff={abs(actual-expected):.2e})")

def section(title):
    print(f"\n{'─' * 70}")
    print(f"  {title}")
    print(f"{'─' * 70}")

# =================================================================
section("Part 1: C_A correction factor (Table 3)")
# =================================================================
# Table 3: CA = 1.0 for 0.400-0.700, 10^(2*(wl-0.700)) for 0.700-1.050, 5.0 for 1.050-1.400

check("CA(0.400)=1.0", CA_visible_NIR(0.400), 1.0)
check("CA(0.500)=1.0", CA_visible_NIR(0.500), 1.0)
check("CA(0.699)=1.0", CA_visible_NIR(0.699), 1.0)
check("CA(0.700)=10^0=1.0", CA_visible_NIR(0.700), 10.0**(2*(0.700-0.700)))
check("CA(0.750)=10^0.1", CA_visible_NIR(0.750), 10.0**(2*0.050))
check("CA(0.800)=10^0.2", CA_visible_NIR(0.800), 10.0**(2*0.100))
check("CA(0.850)=10^0.3", CA_visible_NIR(0.850), 10.0**(2*0.150))
check("CA(0.900)=10^0.4", CA_visible_NIR(0.900), 10.0**(2*0.200))
check("CA(1.000)=10^0.6", CA_visible_NIR(1.000), 10.0**(2*0.300))
check("CA(1.049)=10^0.698", CA_visible_NIR(1.049), 10.0**(2*0.349))
check("CA(1.050)=5.0", CA_visible_NIR(1.050), 5.0)
check("CA(1.064)=5.0", CA_visible_NIR(1.064), 5.0)
check("CA(1.200)=5.0", CA_visible_NIR(1.200), 5.0)
check("CA(1.400)=5.0", CA_visible_NIR(1.400), 5.0)
# Outside range
check("CA(1.500)=1.0(default)", CA_visible_NIR(1.500), 1.0)

# =================================================================
section("Part 2: UV band (180-400 nm)")
# =================================================================

# --- Thermal: H = 0.56 * t^0.25, valid for 1e-9 <= t < 10 ---
for t, label in [(1e-9, "1ns"), (1e-8, "10ns"), (1e-6, "1us"), (1e-3, "1ms"),
                  (0.1, "100ms"), (1.0, "1s"), (5.0, "5s"), (9.999, "~10s")]:
    expected = 0.56 * (t ** 0.25)
    check(f"UV_thermal(0.250, {label})={expected:.6e}", H_skin_ICNIRP_UV_thermal(0.250, t), expected)

# Thermal out of range
check("UV_thermal(0.250, t=0.5e-9)=nan", H_skin_ICNIRP_UV_thermal(0.250, 0.5e-9), 'nan')
check("UV_thermal(0.250, t=10.0)=nan", H_skin_ICNIRP_UV_thermal(0.250, 10.0), 'nan')
check("UV_thermal(0.250, t=100)=nan", H_skin_ICNIRP_UV_thermal(0.250, 100.0), 'nan')

# --- Photochemical: 0.180-0.302: H = 3e-3 ---
for wl in [0.180, 0.200, 0.250, 0.280, 0.301]:
    for t in [1e-9, 1e-3, 1.0, 100.0, 1000.0, 29999.0]:
        check(f"UV_photochem({wl}, {t})=3e-3", H_skin_ICNIRP_UV_photochemical(wl, t), 3e-3)
check("UV_photochem(0.200, 3e4)=nan", H_skin_ICNIRP_UV_photochemical(0.200, 3e4), 'nan')
check("UV_photochem(0.200, 0.5e-9)=nan", H_skin_ICNIRP_UV_photochemical(0.200, 0.5e-9), 'nan')

# --- Photochemical: 0.302-0.315: standard discrete 1-nm step values ---
# Table 5 step values (in J/cm^2):
uv_steps = {
    0.302: 4.0e-3,  # 302-303 nm
    0.305: 1.6e-2,  # 305-306 nm
    0.308: 6.3e-2,  # 308-309 nm
    0.310: 1.6e-1,  # 310-311 nm
    0.314: 6.3e-1,  # 313-315 nm (314 falls in 313-315 bin)
}
for wl, expected in uv_steps.items():
    check(f"UV_photochem({wl}, 1s)={expected:.6e}", H_skin_ICNIRP_UV_photochemical(wl, 1.0), expected)
    check(f"UV_photochem({wl}, 100s)={expected:.6e}", H_skin_ICNIRP_UV_photochemical(wl, 100.0), expected)

# --- Photochemical: 0.315-0.400 ---
# t < 10: returns inf (thermal dominates)
check("UV_photochem(0.350, 1s)=inf", H_skin_ICNIRP_UV_photochemical(0.350, 1.0), 'inf')
check("UV_photochem(0.350, 9.9s)=inf", H_skin_ICNIRP_UV_photochemical(0.350, 9.9), 'inf')
# 10 <= t < 1e3: H = 1.0
check("UV_photochem(0.350, 10s)=1.0", H_skin_ICNIRP_UV_photochemical(0.350, 10.0), 1.0)
check("UV_photochem(0.350, 500s)=1.0", H_skin_ICNIRP_UV_photochemical(0.350, 500.0), 1.0)
check("UV_photochem(0.350, 999s)=1.0", H_skin_ICNIRP_UV_photochemical(0.350, 999.0), 1.0)
# 1e3 <= t < 3e4: Standard keeps H = 1.0 constant (entire 10s to 30ks range)
check("UV_photochem(0.350, 1000s)=1.0", H_skin_ICNIRP_UV_photochemical(0.350, 1000.0), 1.0)
check("UV_photochem(0.350, 5000s)=1.0", H_skin_ICNIRP_UV_photochemical(0.350, 5000.0), 1.0)
check("UV_photochem(0.350, 29999s)=1.0", H_skin_ICNIRP_UV_photochemical(0.350, 29999.0), 1.0)
check("UV_photochem(0.350, 3e4)=nan", H_skin_ICNIRP_UV_photochemical(0.350, 3e4), 'nan')

# --- Dual limit logic ---
# At 0.250 um, t=1s: thermal=0.56*1^0.25=0.56, photochem=3e-3 -> min=3e-3
check("UV_dual(0.250, 1s)=3e-3", H_skin_ICNIRP_180_400(0.250, 1.0), 3e-3)
# At 0.250 um, t=1e-9: thermal=0.56*(1e-9)^0.25=9.96e-3, photochem=3e-3 -> min=3e-3
thermal_1ns = 0.56 * (1e-9 ** 0.25)
check(f"UV thermal at 1ns = {thermal_1ns:.4e}", thermal_1ns > 3e-3, True)
check("UV_dual(0.250, 1e-9)=3e-3", H_skin_ICNIRP_180_400(0.250, 1e-9), 3e-3)

# At 0.350 um, t=1s: thermal=0.56*1^0.25=0.56, photochem=inf -> min=0.56
check("UV_dual(0.350, 1s)=0.56", H_skin_ICNIRP_180_400(0.350, 1.0), 0.56)
# At 0.350 um, t=10s: thermal=nan, photochem=1.0 -> 1.0
check("UV_dual(0.350, 10s)=1.0", H_skin_ICNIRP_180_400(0.350, 10.0), 1.0)
# At 0.350 um, t=0.5e-9: thermal=nan, photochem=inf -> should be nan
# THIS IS A POTENTIAL BUG: inf is not nan, so the code may return inf
result = H_skin_ICNIRP_180_400(0.350, 0.5e-9)
check("UV_dual(0.350, 0.5ns)=nan(should be)", result, 'nan')

# At 0.200 um, t=50s: thermal=nan(t>=10), photochem=3e-3 -> 3e-3
check("UV_dual(0.200, 50s)=3e-3", H_skin_ICNIRP_180_400(0.200, 50.0), 3e-3)

# =================================================================
section("Part 3: 400-1400 nm (standard tables 5 and 7)")
# =================================================================

# Row 1: 1e-9 <= t < 1e-7: H = 2 CA * 1e-2
for wl_um, wl_nm, CA in [(0.500, 500, 1.0), (0.700, 700, 1.0),
                           (0.800, 800, 10.0**(2*0.1)),
                           (1.064, 1064, 5.0)]:
    expected = 2.0 * CA * 1e-2
    for t in [1e-9, 5e-9, 1e-8, 5e-8]:
        check(f"400-1400({wl_nm}nm, {t:.0e})={expected:.4e}",
              H_skin_ICNIRP_400_1400(wl_um, t), expected)

# Row 2: 1e-7 <= t < 10: H = 1.1 CA * t^0.25
for wl_um, wl_nm, CA in [(0.500, 500, 1.0), (0.800, 800, 10.0**(2*0.1)),
                           (1.064, 1064, 5.0)]:
    for t in [1e-7, 1e-6, 1e-4, 1e-2, 0.1, 1.0, 5.0, 9.999]:
        expected = 1.1 * CA * (t ** 0.25)
        check(f"400-1400({wl_nm}nm, {t:.0e})={expected:.4e}",
              H_skin_ICNIRP_400_1400(wl_um, t), expected)

# Row 3: 10 <= t < 3e4: E = 0.2 CA -> H = 0.2 CA * t
for wl_um, wl_nm, CA in [(0.500, 500, 1.0), (1.064, 1064, 5.0)]:
    for t in [10.0, 100.0, 1000.0, 29999.0]:
        expected = 0.2 * CA * t
        check(f"400-1400({wl_nm}nm, {t:.0e})={expected:.4e}",
              H_skin_ICNIRP_400_1400(wl_um, t), expected)

# Out of range
check("400-1400(500nm, 0.5e-9)=nan", H_skin_ICNIRP_400_1400(0.500, 0.5e-9), 'nan')
check("400-1400(500nm, 3e4)=nan", H_skin_ICNIRP_400_1400(0.500, 3e4), 'nan')

# =================================================================
section("Part 4: 1400-1500 nm (standard tables 5 and 7)")
# =================================================================

# Row 1: 1e-9 <= t < 1e-3: H = 0.1
for t in [1e-9, 5e-9, 1e-7, 1e-5, 9.99e-4]:
    check(f"1400-1500({t:.0e})=0.1", H_skin_ICNIRP_1400_1500(t), 0.1)

# Row 2: 1e-3 <= t < 10: H = 0.56 * t^0.25
for t in [1e-3, 5e-3, 0.01, 0.1, 1.0, 5.0, 9.999]:
    expected = 0.56 * (t ** 0.25)
    check(f"1400-1500({t:.4f})={expected:.6f}", H_skin_ICNIRP_1400_1500(t), expected)

# Row 3: 10 <= t < 3e4: E = 0.1 -> H = 0.1 * t
for t in [10.0, 100.0, 1000.0, 29999.0]:
    check(f"1400-1500({t:.0f})={0.1*t:.1f}", H_skin_ICNIRP_1400_1500(t), 0.1 * t)

check("1400-1500(0.5e-9)=nan", H_skin_ICNIRP_1400_1500(0.5e-9), 'nan')
check("1400-1500(3e4)=nan", H_skin_ICNIRP_1400_1500(3e4), 'nan')

# =================================================================
section("Part 5: 1500-1800 nm (standard tables 5 and 7)")
# =================================================================

# Row 1: 1e-9 <= t < 10: H = 1.0
for t in [1e-9, 1e-7, 1e-3, 1.0, 9.999]:
    check(f"1500-1800({t:.0e})=1.0", H_skin_ICNIRP_1500_1800(t), 1.0)

# Row 2: 10 <= t < 3e4: E = 0.1 -> H = 0.1 * t
for t in [10.0, 100.0, 1000.0]:
    check(f"1500-1800({t:.0f})={0.1*t:.1f}", H_skin_ICNIRP_1500_1800(t), 0.1 * t)

check("1500-1800(0.5e-9)=nan", H_skin_ICNIRP_1500_1800(0.5e-9), 'nan')
check("1500-1800(3e4)=nan", H_skin_ICNIRP_1500_1800(3e4), 'nan')

# =================================================================
section("Part 6: 1800-2600 nm (standard tables 5 and 7)")
# =================================================================

# Row 1: 1e-9 <= t < 1e-3: H = 0.1
for t in [1e-9, 1e-7, 1e-5, 9.99e-4]:
    check(f"1800-2600({t:.0e})=0.1", H_skin_ICNIRP_1800_2600(t), 0.1)

# Row 2: 1e-3 <= t < 10: H = 0.56 * t^0.25
for t in [1e-3, 0.01, 0.1, 1.0, 9.999]:
    expected = 0.56 * (t ** 0.25)
    check(f"1800-2600({t})={expected:.6f}", H_skin_ICNIRP_1800_2600(t), expected)

# Row 3: 10 <= t < 3e4: E = 0.1 -> H = 0.1 * t
for t in [10.0, 100.0]:
    check(f"1800-2600({t:.0f})={0.1*t:.1f}", H_skin_ICNIRP_1800_2600(t), 0.1 * t)

check("1800-2600(0.5e-9)=nan", H_skin_ICNIRP_1800_2600(0.5e-9), 'nan')
check("1800-2600(3e4)=nan", H_skin_ICNIRP_1800_2600(3e4), 'nan')

# =================================================================
section("Part 7: 2600-1000 um (standard tables 5 and 7)")
# =================================================================

# Row 1: 1e-9 <= t < 1e-7: H = 1e-2
for t in [1e-9, 1e-8, 5e-8]:
    check(f"2600+({t:.0e})=1e-2", H_skin_ICNIRP_2600_1000um(t), 1e-2)

# Row 2: 1e-7 <= t < 10: H = 0.56 * t^0.25
for t in [1e-7, 1e-5, 0.1, 1.0, 9.999]:
    expected = 0.56 * (t ** 0.25)
    check(f"2600+({t})={expected:.6e}", H_skin_ICNIRP_2600_1000um(t), expected)

# Row 3: 10 <= t < 3e4: E = 0.1 -> H = 0.1 * t
for t in [10.0, 100.0]:
    check(f"2600+({t:.0f})={0.1*t:.1f}", H_skin_ICNIRP_2600_1000um(t), 0.1 * t)

check("2600+(0.5e-9)=nan", H_skin_ICNIRP_2600_1000um(0.5e-9), 'nan')
check("2600+(3e4)=nan", H_skin_ICNIRP_2600_1000um(3e4), 'nan')

# =================================================================
section("Part 8: Wrapper dispatch at wavelength boundaries")
# =================================================================

# Test boundary wavelengths dispatch correctly
# 400 nm should go to 400-1400 band (not UV)
check("wrapper(400nm, 5e-9)=0.02", H_skin_ICNIRP_MPE(400, 5e-9), 2.0 * 1.0 * 1e-2)
# 399 nm should go to UV band
check("wrapper(399nm, 1s): UV", H_skin_ICNIRP_MPE(399, 1.0), H_skin_ICNIRP_180_400(0.399, 1.0))
# 1400 nm should go to 1400-1500 band
check("wrapper(1400nm, 5e-9)=0.1", H_skin_ICNIRP_MPE(1400, 5e-9), 0.1)
# 1500 nm should go to 1500-1800 band
check("wrapper(1500nm, 1s)=1.0", H_skin_ICNIRP_MPE(1500, 1.0), 1.0)
# 1800 nm should go to 1800-2600 band
check("wrapper(1800nm, 5e-5)=0.1", H_skin_ICNIRP_MPE(1800, 5e-5), 0.1)
# 2600 nm should go to 2600+ band
check("wrapper(2600nm, 5e-9)=1e-2", H_skin_ICNIRP_MPE(2600, 5e-9), 1e-2)
# nm vs um equivalence
check("wrapper nm==um", H_skin_ICNIRP_MPE(800, 1e-6), H_skin_ICNIRP_MPE(0.800, 1e-6))

# =================================================================
section("Part 9: Repetitive pulse (standard repetitive-pulse rules)")
# =================================================================

wl, tau, T = 800.0, 10e-9, 1.0
H_single = H_skin_ICNIRP_MPE(wl, tau)
H_total = H_skin_ICNIRP_MPE(wl, T)

# N < 1: only Rule 1
H_p, N = per_pulse_MPE(wl, tau, np.array([0.5]), T)
check("rep_pulse N=0.5 -> Rule1", H_p[0], H_single)

# N = 1: only Rule 1
H_p, N = per_pulse_MPE(wl, tau, np.array([1.0]), T)
check("rep_pulse N=1 -> Rule1", H_p[0], H_single)

# N = 10: min(Rule1, Rule2)
H_p, N = per_pulse_MPE(wl, tau, np.array([10.0]), T)
rule2 = H_total / 10.0
expected = min(H_single, rule2)
check(f"rep_pulse N=10 -> min(R1={H_single:.4e}, R2={rule2:.4e})", H_p[0], expected)

# N = 10000: Rule 2 dominates
H_p, N = per_pulse_MPE(wl, tau, np.array([10000.0]), T)
rule2 = H_total / 10000.0
check(f"rep_pulse N=10000 -> R2={rule2:.4e}", H_p[0], rule2)
check("rep_pulse N=10000: R2 < R1", rule2 < H_single, True)

# =================================================================
section("Part 10: T_max (Table 4)")
# =================================================================

check("Tmax(200nm)=30000", get_Tmax_skin(200), 30000.0)
check("Tmax(355nm)=30000", get_Tmax_skin(355), 30000.0)
check("Tmax(399nm)=30000", get_Tmax_skin(399), 30000.0)
check("Tmax(400nm)=600", get_Tmax_skin(400), 600.0)
check("Tmax(532nm)=600", get_Tmax_skin(532), 600.0)
check("Tmax(699nm)=600", get_Tmax_skin(699), 600.0)
check("Tmax(700nm)=600", get_Tmax_skin(700), 600.0)
check("Tmax(800nm)=600", get_Tmax_skin(800), 600.0)
check("Tmax(1064nm)=600", get_Tmax_skin(1064), 600.0)
check("Tmax(1399nm)=600", get_Tmax_skin(1399), 600.0)
check("Tmax(1400nm)=10", get_Tmax_skin(1400), 10.0)
check("Tmax(1550nm)=10", get_Tmax_skin(1550), 10.0)
check("Tmax(10600nm)=10", get_Tmax_skin(10600), 10.0)

# =================================================================
section("Part 11: Limiting apertures (Table 8)")
# =================================================================

# All wavelengths 180nm-100um: 3.5mm
for wl in [200, 532, 800, 1064, 1550, 10600]:
    r = get_skin_limiting_aperture(wl)
    check(f"aperture({wl}nm)=3.5mm", r['diameter_mm'], 3.5)

# 100-1000 um: 11.0mm (need to express as nm: 100um = 100000nm)
r = get_skin_limiting_aperture(200000)  # 200 um
check("aperture(200um)=11.0mm", r['diameter_mm'], 11.0)

# Area checks
r35 = get_skin_limiting_aperture(800)
expected_area = math.pi * (0.35/2)**2  # d=3.5mm=0.35cm
check("aperture 3.5mm area", r35['area_cm2'], expected_area)

r11 = get_skin_limiting_aperture(200000)
expected_area = math.pi * (1.1/2)**2  # d=11mm=1.1cm
check("aperture 11mm area", r11['area_cm2'], expected_area)

# =================================================================
section("Part 12: Large area (standard table note c)")
# =================================================================

check("large_area(50)=None", large_area_MPE_skin(50), None)
check("large_area(99)=None", large_area_MPE_skin(99), None)
check("large_area(100)=100", large_area_MPE_skin(100), 10000.0/100.0)
check("large_area(200)=50", large_area_MPE_skin(200), 10000.0/200.0)
check("large_area(500)=20", large_area_MPE_skin(500), 10000.0/500.0)
check("large_area(1000)=10", large_area_MPE_skin(1000), 10000.0/1000.0)
check("large_area(1001)=10", large_area_MPE_skin(1001), 10.0)
check("large_area(5000)=10", large_area_MPE_skin(5000), 10.0)

# =================================================================
section("Part 13: UV de-rating (standard UV de-rating)")
# =================================================================

check("derate(250nm,1.0)=1.0", uv_successive_day_derate(250, 1.0), 1.0)  # no derate
check("derate(279nm,1.0)=1.0", uv_successive_day_derate(279, 1.0), 1.0)  # no derate
check("derate(280nm,1.0)=0.4", uv_successive_day_derate(280, 1.0), 1.0/2.5)  # derate
check("derate(300nm,3e-3)=1.2e-3", uv_successive_day_derate(300, 3e-3), 3e-3/2.5)
check("derate(355nm,1.0)=0.4", uv_successive_day_derate(355, 1.0), 1.0/2.5)
check("derate(399nm,1.0)=0.4", uv_successive_day_derate(399, 1.0), 1.0/2.5)
check("derate(400nm,1.0)=1.0", uv_successive_day_derate(400, 1.0), 1.0)  # no derate
check("derate(532nm,1.0)=1.0", uv_successive_day_derate(532, 1.0), 1.0)  # no derate

# =================================================================
section("Part 14: Unit conversions")
# =================================================================

check("0.02 J/cm2 -> 20 mJ/cm2", radiant_exposure_convert(0.02, 'mJ/cm2'), 20.0)
check("0.02 J/cm2 -> 200 J/m2", radiant_exposure_convert(0.02, 'J/m2'), 200.0)
check("0.02 J/cm2 -> 2e5 mJ/m2", radiant_exposure_convert(0.02, 'mJ/m2'), 200000.0)

r = irradiance_from_radiant_exposure(2.0, 10.0)
check("E=2.0/10=0.2 W/cm2", r['W/cm2'], 0.2)
check("E=200 mW/cm2", r['mW/cm2'], 200.0)
check("E=2000 W/m2", r['W/m2'], 2000.0)

r = pulse_energy_from_radiant_exposure(0.02, 0.0962)
check("Q=0.02*0.0962 J", r['J'], 0.02 * 0.0962)
check("Q in mJ", r['mJ'], 0.02 * 0.0962 * 1e3)
check("Q in uJ", r['uJ'], 0.02 * 0.0962 * 1e6)

r = average_power_from_radiant_exposure(2.0, 10.0, 0.1)
check("P=2*0.1/10=0.02 W", r['W'], 0.02)
check("P=20 mW", r['mW'], 20.0)

# =================================================================
section("Part 15: Edge cases and error handling")
# =================================================================

# ValueError for out-of-range wavelength
try:
    H_skin_ICNIRP_MPE(100, 1.0)
    check("100nm raises", False, True)
except ValueError:
    check("100nm raises ValueError", True, True)

try:
    get_Tmax_skin(100)
    check("Tmax(100nm) raises", False, True)
except ValueError:
    check("Tmax(100nm) raises ValueError", True, True)

try:
    irradiance_from_radiant_exposure(1.0, 0.0)
    check("irradiance t=0 raises", False, True)
except ValueError:
    check("irradiance t=0 raises ValueError", True, True)

# Array input
H_arr = H_skin_ICNIRP_MPE(800, np.array([1e-9, 1e-6, 1.0]))
check("array len=3", len(H_arr), 3)
check("array[0]=0.02", H_arr[0], 2.0 * CA_visible_NIR(0.800) * 1e-2, rtol=1e-6)
check("array all finite", np.all(np.isfinite(H_arr)), True)

# =================================================================
# Pytest entry point
# =================================================================

def test_verify_exhaustive():
    """All exhaustive verification checks must pass."""
    assert failed == 0, f"{failed} checks failed:\n" + "\n".join(errors)


# =================================================================
# Standalone runner
# =================================================================

if __name__ == "__main__":
    print(f"\n{'=' * 70}")
    print(f"  FINAL RESULTS: {passed} passed, {failed} failed  (total: {passed+failed})")
    print(f"{'=' * 70}")
    if errors:
        print("\n  FAILURES:")
        for e in errors:
            print(e)
        sys.exit(1)
    else:
        print("\n  ALL CHECKS PASSED.")
        sys.exit(0)
