"""
Test suite for laser_mpe package — ICNIRP 2013 only.

All test values are verified against ICNIRP 2013, ICNIRP Tables 5 and 7.
The boundary convention is: t_1 <= t < t_2 (left-inclusive, right-exclusive).

Test organization:
    - TestCorrectionFactors: C_A from Table 3
    - TestUVBand: UV 180-400 nm from ICNIRP Tables 5 and 7 (dual limits)
    - TestICNIRP_*: Each wavelength band from ICNIRP Tables 5 and 7
    - TestBoundaryConvention: Exact boundary values verify left-inclusive/right-exclusive
    - TestUltraShortReturnsNan: Confirms t < 1e-9 returns nan (ICNIRP range starts at 1e-9)
    - TestRepetitivePulse: Rules 1 and 2 per ICNIRP 2013
    - TestEdgeCases: Out-of-range, nm/um equivalence, array input
"""

import sys
import os
import numpy as np
import numpy.testing as npt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from laser_mpe import (
    CA_visible_NIR,
    H_skin_ICNIRP_MPE,
    H_skin_ICNIRP_180_400,
    H_skin_ICNIRP_400_1400,
    H_skin_ICNIRP_1400_1500,
    H_skin_ICNIRP_1500_1800,
    H_skin_ICNIRP_1800_2600,
    H_skin_ICNIRP_2600_1000um,
    per_pulse_MPE,
)


def assert_close(actual, expected, rtol=1e-9, label=""):
    """Assert two values are close, with descriptive label on failure."""
    if np.isnan(expected):
        assert np.isnan(actual), f"{label}: expected nan, got {actual}"
    else:
        npt.assert_allclose(
            actual, expected, rtol=rtol,
            err_msg=f"{label}: expected {expected}, got {actual}"
        )


# =====================================================================
# C_A Correction Factor — ICNIRP 2013 Table 3
# =====================================================================

class TestCorrectionFactors:
    """Verified against ICNIRP 2013, Table 3."""

    def test_CA_below_700nm(self):
        for wl in [0.400, 0.500, 0.600, 0.699]:
            assert_close(CA_visible_NIR(wl), 1.0, label=f"CA at {wl}")

    def test_CA_at_700nm(self):
        # 10^(2*(0.700-0.700)) = 1.0
        assert_close(CA_visible_NIR(0.700), 1.0)

    def test_CA_exponential(self):
        for wl, expected in [
            (0.750, 10.0 ** (2 * 0.050)),
            (0.800, 10.0 ** (2 * 0.100)),
            (0.900, 10.0 ** (2 * 0.200)),
            (1.000, 10.0 ** (2 * 0.300)),
        ]:
            assert_close(CA_visible_NIR(wl), expected, label=f"CA at {wl}")

    def test_CA_above_1050nm(self):
        for wl in [1.050, 1.064, 1.200, 1.400]:
            assert_close(CA_visible_NIR(wl), 5.0, label=f"CA at {wl}")


# =====================================================================
# UV Band (180-400 nm) — ICNIRP 2013 ICNIRP Tables 5 and 7
# =====================================================================

class TestUVBand:
    """Verified against ICNIRP 2013, ICNIRP Tables 5 and 7 (Ultraviolet)."""

    def test_thermal(self):
        """0.180-0.400 um, 1e-9 <= t < 10: H = 0.56 * t^0.25"""
        from laser_mpe.icnirp_skin import H_skin_ICNIRP_UV_thermal
        for wl, t in [(0.250, 1e-9), (0.300, 1e-6), (0.350, 1.0), (0.200, 9.99)]:
            assert_close(
                H_skin_ICNIRP_UV_thermal(wl, t), 0.56 * (t ** 0.25),
                label=f"UV thermal {wl}um, t={t}"
            )

    def test_thermal_out_of_range(self):
        from laser_mpe.icnirp_skin import H_skin_ICNIRP_UV_thermal
        assert np.isnan(H_skin_ICNIRP_UV_thermal(0.300, 0.5e-9))   # below 1e-9
        assert np.isnan(H_skin_ICNIRP_UV_thermal(0.300, 10.0))     # at upper boundary (exclusive)

    def test_photochem_180_302(self):
        """H = 3e-3 J/cm^2 (constant)"""
        from laser_mpe.icnirp_skin import H_skin_ICNIRP_UV_photochemical
        for wl in [0.180, 0.250, 0.301]:
            for t in [1e-9, 1.0, 1000.0]:
                assert_close(
                    H_skin_ICNIRP_UV_photochemical(wl, t), 3.0e-3,
                    label=f"UV photochem {wl}um, t={t}"
                )

    def test_photochem_302_315(self):
        """ICNIRP 2013 discrete 1-nm step values for 302-315 nm"""
        from laser_mpe.icnirp_skin import H_skin_ICNIRP_UV_photochemical
        # Spot-check key wavelengths against Table 5
        assert_close(
            H_skin_ICNIRP_UV_photochemical(0.302, 1.0), 4.0e-3,
            label="UV photochem 302nm"
        )
        assert_close(
            H_skin_ICNIRP_UV_photochemical(0.305, 1.0), 1.6e-2,
            label="UV photochem 305nm"
        )
        assert_close(
            H_skin_ICNIRP_UV_photochemical(0.310, 1.0), 1.6e-1,
            label="UV photochem 310nm"
        )
        assert_close(
            H_skin_ICNIRP_UV_photochemical(0.313, 1.0), 6.3e-1,
            label="UV photochem 313nm"
        )

    def test_photochem_315_400(self):
        """ICNIRP 2013: H = 1.0 J/cm^2 constant for 10 s to 30 ks"""
        from laser_mpe.icnirp_skin import H_skin_ICNIRP_UV_photochemical
        assert_close(H_skin_ICNIRP_UV_photochemical(0.350, 100.0), 1.0)
        # ICNIRP 2013: H = 1.0 J/cm^2 constant for the entire 10 s to 30 ks range
        assert_close(H_skin_ICNIRP_UV_photochemical(0.350, 5000.0), 1.0)

    def test_dual_limit_chooses_lower(self):
        """At 250nm, t=1s: thermal=0.56, photochem=3e-3 -> min is 3e-3"""
        assert_close(H_skin_ICNIRP_180_400(0.250, 1.0), 3.0e-3)

    def test_wrapper_dispatches_uv(self):
        assert_close(H_skin_ICNIRP_MPE(250, 1.0), 3.0e-3)


# =====================================================================
# 400-1400 nm — ICNIRP 2013 ICNIRP Tables 5 and 7
# =====================================================================

class TestICNIRP_400_1400:
    """Verified against ICNIRP 2013, ICNIRP Tables 5 and 7."""

    def test_row1_1ns_to_100ns(self):
        """1e-9 <= t < 1e-7: H = 2 C_A * 1e-2"""
        # 500 nm: CA=1 -> H=0.02
        assert_close(H_skin_ICNIRP_400_1400(0.500, 5e-9), 0.02, label="500nm 5ns")
        # 1064 nm: CA=5 -> H=0.10
        assert_close(H_skin_ICNIRP_400_1400(1.064, 5e-9), 0.10, label="1064nm 5ns")

    def test_row2_100ns_to_10s(self):
        """1e-7 <= t < 10: H = 1.1 C_A * t^0.25"""
        # 500nm, t=1s: 1.1*1.0*1.0 = 1.1
        assert_close(H_skin_ICNIRP_400_1400(0.500, 1.0), 1.1, label="500nm 1s")
        # 800nm, t=0.01s
        CA_800 = 10.0 ** (2 * (0.800 - 0.700))
        expected = 1.1 * CA_800 * (0.01 ** 0.25)
        assert_close(H_skin_ICNIRP_400_1400(0.800, 0.01), expected, label="800nm 10ms")

    def test_row3_10s_to_30000s(self):
        """10 <= t < 3e4: E = 0.2 C_A W/cm^2 -> H = 0.2*CA*t"""
        # 500nm, t=100s: 0.2*1.0*100 = 20.0
        assert_close(H_skin_ICNIRP_400_1400(0.500, 100.0), 20.0, label="500nm 100s")
        # 1064nm, t=30s: 0.2*5.0*30 = 30.0
        assert_close(H_skin_ICNIRP_400_1400(1.064, 30.0), 30.0, label="1064nm 30s")


# =====================================================================
# 1400-1500 nm — ICNIRP 2013 ICNIRP Tables 5 and 7
# =====================================================================

class TestICNIRP_1400_1500:
    """Verified against ICNIRP 2013, Tables 5 and 7."""

    def test_row1_1ns_to_1ms(self):
        """1e-9 <= t < 1e-3: H = 0.1 J/cm^2"""
        assert_close(H_skin_ICNIRP_1400_1500(5e-9), 0.1, label="1400-1500 5ns")
        assert_close(H_skin_ICNIRP_1400_1500(1e-5), 0.1, label="1400-1500 10us")

    def test_row2_1ms_to_10s(self):
        """1e-3 <= t < 10: H = 0.56 * t^0.25"""
        for t in [2e-3, 0.01, 0.1, 1.0, 5.0]:
            expected = 0.56 * (t ** 0.25)
            assert_close(H_skin_ICNIRP_1400_1500(t), expected, label=f"1400-1500 t={t}")

    def test_row3_10s_to_30000s(self):
        """10 <= t < 3e4: E = 0.1 W/cm^2 -> H = 0.1*t"""
        assert_close(H_skin_ICNIRP_1400_1500(100.0), 10.0, label="1400-1500 100s")
        assert_close(H_skin_ICNIRP_1400_1500(10.0), 1.0, label="1400-1500 10s")


# =====================================================================
# 1500-1800 nm — ICNIRP 2013 ICNIRP Tables 5 and 7
# =====================================================================

class TestICNIRP_1500_1800:
    """Verified against ICNIRP 2013, ICNIRP Tables 5 and 7."""

    def test_row1_1ns_to_10s(self):
        """1e-9 <= t < 10: H = 1.0 J/cm^2"""
        for t in [1e-9, 1e-6, 1e-3, 1.0, 9.99]:
            assert_close(H_skin_ICNIRP_1500_1800(t), 1.0, label=f"1500-1800 t={t}")

    def test_row2_10s_to_30000s(self):
        """10 <= t < 3e4: E = 0.1 W/cm^2"""
        assert_close(H_skin_ICNIRP_1500_1800(10.0), 1.0, label="1500-1800 10s")
        assert_close(H_skin_ICNIRP_1500_1800(100.0), 10.0, label="1500-1800 100s")


# =====================================================================
# 1800-2600 nm — ICNIRP 2013 ICNIRP Tables 5 and 7
# =====================================================================

class TestICNIRP_1800_2600:
    """Verified against ICNIRP 2013, ICNIRP Tables 5 and 7."""

    def test_row1_1ns_to_1ms(self):
        """1e-9 <= t < 1e-3: H = 0.1 J/cm^2"""
        for t in [1e-9, 1e-7, 1e-5]:
            assert_close(H_skin_ICNIRP_1800_2600(t), 0.1, label=f"1800-2600 t={t}")

    def test_row2_1ms_to_10s(self):
        """1e-3 <= t < 10: H = 0.56 * t^0.25"""
        for t in [1e-3, 0.01, 1.0, 9.99]:
            expected = 0.56 * (t ** 0.25)
            assert_close(H_skin_ICNIRP_1800_2600(t), expected, label=f"1800-2600 t={t}")

    def test_row3_10s_to_30000s(self):
        """10 <= t < 3e4: E = 0.1 W/cm^2"""
        assert_close(H_skin_ICNIRP_1800_2600(100.0), 10.0, label="1800-2600 100s")


# =====================================================================
# 2600 nm - 1000 um — ICNIRP 2013 ICNIRP Tables 5 and 7
# =====================================================================

class TestICNIRP_2600_1000um:
    """Verified against ICNIRP 2013, ICNIRP Tables 5 and 7."""

    def test_row1_1ns_to_100ns(self):
        """1e-9 <= t < 1e-7: H = 1e-2 J/cm^2"""
        for t in [1e-9, 1e-8, 5e-8]:
            assert_close(H_skin_ICNIRP_2600_1000um(t), 1.0e-2, label=f"2600+ t={t}")

    def test_row2_100ns_to_10s(self):
        """1e-7 <= t < 10: H = 0.56 * t^0.25"""
        for t in [1e-7, 1e-4, 1.0, 9.99]:
            expected = 0.56 * (t ** 0.25)
            assert_close(H_skin_ICNIRP_2600_1000um(t), expected, label=f"2600+ t={t}")

    def test_row3_10s_to_30000s(self):
        """10 <= t < 3e4: E = 0.1 W/cm^2"""
        assert_close(H_skin_ICNIRP_2600_1000um(100.0), 10.0, label="2600+ 100s")


# =====================================================================
# Boundary Convention: t_1 <= t < t_2 (left-inclusive, right-exclusive)
# =====================================================================

class TestBoundaryConvention:
    """
    Verify the ICNIRP convention: t_1 <= t < t_2.
    At the boundary value itself, we should be in the NEXT interval.
    """

    def test_400_1400_boundary_at_1e7(self):
        """At t=1e-7 exactly: should be in row 2 (1.1*CA*t^0.25), not row 1."""
        CA = 1.0  # 500 nm
        t = 1e-7
        expected_row2 = 1.1 * CA * (t ** 0.25)
        expected_row1 = 2.0 * CA * 1e-2
        result = H_skin_ICNIRP_400_1400(0.500, t)
        assert_close(result, expected_row2, label="400-1400 boundary at 1e-7")
        assert result != expected_row1, "Should NOT be in row 1"

    def test_400_1400_boundary_at_10(self):
        """At t=10 exactly: should be in row 3 (irradiance), not row 2."""
        CA = 1.0
        t = 10.0
        expected_row3 = 0.2 * CA * t  # = 2.0
        expected_row2 = 1.1 * CA * (t ** 0.25)
        result = H_skin_ICNIRP_400_1400(0.500, t)
        assert_close(result, expected_row3, label="400-1400 boundary at 10")

    def test_1400_1500_boundary_at_1e3(self):
        """At t=1e-3 exactly: should be in row 2 (0.56*t^0.25), not row 1."""
        t = 1e-3
        expected_row2 = 0.56 * (t ** 0.25)
        expected_row1 = 0.1
        result = H_skin_ICNIRP_1400_1500(t)
        assert_close(result, expected_row2, label="1400-1500 boundary at 1e-3")

    def test_1800_2600_boundary_at_1e3(self):
        """At t=1e-3 exactly: should be in row 2 (0.56*t^0.25), not row 1."""
        t = 1e-3
        expected_row2 = 0.56 * (t ** 0.25)
        result = H_skin_ICNIRP_1800_2600(t)
        assert_close(result, expected_row2, label="1800-2600 boundary at 1e-3")

    def test_2600_boundary_at_1e7(self):
        """At t=1e-7 exactly: should be in row 2 (0.56*t^0.25), not row 1."""
        t = 1e-7
        expected_row2 = 0.56 * (t ** 0.25)
        expected_row1 = 1.0e-2
        result = H_skin_ICNIRP_2600_1000um(t)
        assert_close(result, expected_row2, label="2600+ boundary at 1e-7")

    def test_lower_bound_inclusive(self):
        """t=1e-9 exactly should be valid (not nan) for all bands."""
        assert not np.isnan(H_skin_ICNIRP_400_1400(0.500, 1e-9))
        assert not np.isnan(H_skin_ICNIRP_1400_1500(1e-9))
        assert not np.isnan(H_skin_ICNIRP_1500_1800(1e-9))
        assert not np.isnan(H_skin_ICNIRP_1800_2600(1e-9))
        assert not np.isnan(H_skin_ICNIRP_2600_1000um(1e-9))

    def test_upper_bound_exclusive(self):
        """t=3e4 exactly should return nan (upper bound is exclusive)."""
        assert np.isnan(H_skin_ICNIRP_400_1400(0.500, 3e4))
        assert np.isnan(H_skin_ICNIRP_1400_1500(3e4))
        assert np.isnan(H_skin_ICNIRP_1500_1800(3e4))
        assert np.isnan(H_skin_ICNIRP_1800_2600(3e4))
        assert np.isnan(H_skin_ICNIRP_2600_1000um(3e4))


# =====================================================================
# Ultra-short pulses (t < 1e-9) return nan per ICNIRP 2013
# =====================================================================

class TestUltraShortReturnsNan:
    """ICNIRP 2013 Tables 5 and 7 start at 10^-9 s. All shorter durations return nan."""

    def test_all_bands_return_nan_for_sub_ns(self):
        for t in [1e-13, 1e-12, 1e-11, 1e-10, 5e-10]:
            assert np.isnan(H_skin_ICNIRP_400_1400(0.500, t)), f"400-1400 at t={t}"
            assert np.isnan(H_skin_ICNIRP_1400_1500(t)), f"1400-1500 at t={t}"
            assert np.isnan(H_skin_ICNIRP_1500_1800(t)), f"1500-1800 at t={t}"
            assert np.isnan(H_skin_ICNIRP_1800_2600(t)), f"1800-2600 at t={t}"
            assert np.isnan(H_skin_ICNIRP_2600_1000um(t)), f"2600+ at t={t}"


# =====================================================================
# Repetitive-pulse logic — ICNIRP 2013 repetitive-pulse rules
# =====================================================================

class TestRepetitivePulse:
    """Rules 1 and 2 per ICNIRP 2013, ICNIRP 2013 repetitive-pulse rules."""

    def test_single_pulse_returns_rule1(self):
        """N <= 1: only Rule 1 applies."""
        H_pulse, N = per_pulse_MPE(800, 10e-9, np.array([1.0]), 0.1)
        H_single = H_skin_ICNIRP_MPE(800, 10e-9)
        assert_close(N[0], 0.1)
        assert_close(H_pulse[0], H_single, label="Rule 1 for N<1")

    def test_high_prf_limited_by_rule2(self):
        """At high PRF, Rule 2 (average) is more restrictive."""
        H_pulse, N = per_pulse_MPE(800, 10e-9, np.array([10000.0]), 1.0)
        H_single = H_skin_ICNIRP_MPE(800, 10e-9)
        H_total = H_skin_ICNIRP_MPE(800, 1.0)
        H_rule2 = H_total / 10000.0
        assert H_rule2 < H_single
        assert_close(H_pulse[0], H_rule2, label="Rule 2 at high PRF")

    def test_min_of_rules(self):
        """Per-pulse MPE = min(Rule 1, Rule 2) for N > 1."""
        f_arr = np.logspace(0, 4, 50)
        H_pulse, N = per_pulse_MPE(800, 10e-9, f_arr, 1.0)
        H_single = H_skin_ICNIRP_MPE(800, 10e-9)
        H_total = H_skin_ICNIRP_MPE(800, 1.0)
        for i, f in enumerate(f_arr):
            n = f * 1.0
            if n > 1:
                expected = min(H_single, H_total / n)
                assert_close(H_pulse[i], expected, rtol=1e-6, label=f"min at f={f:.0f}")


# =====================================================================
# Edge cases
# =====================================================================

class TestEdgeCases:
    """Out-of-range inputs, nm/um equivalence, array inputs."""

    def test_wavelength_out_of_range(self):
        try:
            H_skin_ICNIRP_MPE(100, 1.0)  # 100 nm
            assert False, "Should have raised ValueError"
        except ValueError:
            pass

    def test_nm_um_equivalence(self):
        assert_close(
            H_skin_ICNIRP_MPE(800, 1e-8),
            H_skin_ICNIRP_MPE(0.800, 1e-8),
            label="nm vs um"
        )

    def test_array_input(self):
        H = H_skin_ICNIRP_MPE(800, np.array([1e-8, 1e-6, 1e-3, 1.0]))
        assert H.shape == (4,)
        assert np.all(np.isfinite(H))


# =====================================================================
# Run all tests
# =====================================================================

def run_all_tests():
    test_classes = [
        TestCorrectionFactors,
        TestUVBand,
        TestICNIRP_400_1400,
        TestICNIRP_1400_1500,
        TestICNIRP_1500_1800,
        TestICNIRP_1800_2600,
        TestICNIRP_2600_1000um,
        TestBoundaryConvention,
        TestUltraShortReturnsNan,
        TestRepetitivePulse,
        TestEdgeCases,
    ]

    total_passed = 0
    total_failed = 0
    failures = []

    for cls in test_classes:
        instance = cls()
        methods = [m for m in dir(instance) if m.startswith('test_')]
        doc = (cls.__doc__ or "").strip().split('\n')[0]
        print(f"\n{'─' * 65}")
        print(f"  {cls.__name__}")
        if doc:
            print(f"  {doc}")
        print(f"{'─' * 65}")

        for method_name in methods:
            method = getattr(instance, method_name)
            try:
                method()
                print(f"  ✅ {method_name}")
                total_passed += 1
            except Exception as e:
                print(f"  ❌ {method_name}: {e}")
                total_failed += 1
                failures.append((cls.__name__, method_name, str(e)))

    print(f"\n{'=' * 65}")
    print(f"  RESULTS: {total_passed} passed, {total_failed} failed")
    print(f"{'=' * 65}")

    if failures:
        print("\nFAILURES:")
        for cls_name, method, err in failures:
            print(f"  {cls_name}.{method}: {err}")

    return total_failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
