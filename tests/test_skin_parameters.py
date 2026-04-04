"""
Test suite for skin_parameters module.

All values verified against the loaded standard (default: ICNIRP 2013):
    - Table 4 (T_max)
    - Table 8 (Limiting apertures for skin)
    - Large area exposures (Table 7 note c)
    - UV successive-day de-rating
    - Unit conversions (arithmetic correctness)
"""

import os
import sys

import numpy as np
import numpy.testing as npt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from laser_mpe import (
    average_power_from_radiant_exposure,
    get_skin_limiting_aperture,
    get_Tmax_skin,
    irradiance_from_radiant_exposure,
    large_area_MPE_skin,
    pulse_energy_from_radiant_exposure,
    radiant_exposure_convert,
    uv_successive_day_derate,
)


def assert_close(actual, expected, rtol=1e-9, label=""):
    npt.assert_allclose(
        actual, expected, rtol=rtol,
        err_msg=f"{label}: expected {expected}, got {actual}"
    )


# =====================================================================
# Table 4 — T_max
# =====================================================================

class TestTmax:
    """Verified against the standard (Table 4 column)."""

    def test_uv(self):
        """UV 0.18-0.4 um: T_max = 30,000 s"""
        assert_close(get_Tmax_skin(200), 30000.0, label="Tmax UV 200nm")
        assert_close(get_Tmax_skin(355), 30000.0, label="Tmax UV 355nm")

    def test_visible(self):
        """Visible 0.4-0.7 um: T_max = 600 s"""
        assert_close(get_Tmax_skin(532), 600.0, label="Tmax Vis 532nm")
        assert_close(get_Tmax_skin(633), 600.0, label="Tmax Vis 633nm")

    def test_nir(self):
        """NIR 0.7-1.4 um: T_max = 600 s"""
        assert_close(get_Tmax_skin(800), 600.0, label="Tmax NIR 800nm")
        assert_close(get_Tmax_skin(1064), 600.0, label="Tmax NIR 1064nm")

    def test_fir(self):
        """FIR 1.4 um-1 mm: T_max = 10 s"""
        assert_close(get_Tmax_skin(1550), 10.0, label="Tmax FIR 1550nm")
        assert_close(get_Tmax_skin(10600), 10.0, label="Tmax FIR 10.6um")

    def test_boundary_400nm(self):
        """400 nm is in the Visible band, not UV."""
        assert_close(get_Tmax_skin(400), 600.0, label="Tmax boundary 400nm")

    def test_boundary_700nm(self):
        """700 nm is in the NIR band."""
        assert_close(get_Tmax_skin(700), 600.0, label="Tmax boundary 700nm")

    def test_boundary_1400nm(self):
        """1400 nm is in the FIR band."""
        assert_close(get_Tmax_skin(1400), 10.0, label="Tmax boundary 1400nm")

    def test_accepts_um_input(self):
        """Wavelength < 10 treated as um."""
        assert_close(get_Tmax_skin(0.532), 600.0, label="Tmax 0.532um")

    def test_out_of_range_raises(self):
        try:
            get_Tmax_skin(100)  # 100 nm, below range
            assert False, "Should have raised ValueError"
        except ValueError:
            pass


# =====================================================================
# Table 8 — Limiting Apertures for Skin
# =====================================================================

class TestLimitingAperture:
    """Verified against the standard (Table 8 (Skin column)."""

    def test_uv_aperture(self):
        """UV: 3.5 mm"""
        result = get_skin_limiting_aperture(300)
        assert_close(result['diameter_mm'], 3.5, label="UV aperture")

    def test_vis_nir_aperture(self):
        """Vis/NIR: 3.5 mm"""
        result = get_skin_limiting_aperture(800)
        assert_close(result['diameter_mm'], 3.5, label="Vis/NIR aperture")

    def test_fir_below_100um_aperture(self):
        """FIR below 100 um: 3.5 mm"""
        result = get_skin_limiting_aperture(10600)  # 10.6 um
        assert_close(result['diameter_mm'], 3.5, label="FIR <100um aperture")

    def test_fir_above_100um_aperture(self):
        """FIR 100-1000 um: 11.0 mm"""
        result = get_skin_limiting_aperture(0.3)  # 0.3 um? no, need 300 um
        # 300 um = 0.300 mm. In our convention, 300 um < 10 so treated as um.
        result = get_skin_limiting_aperture(300.0)  # 300 nm since > 10
        assert_close(result['diameter_mm'], 3.5, label="300nm aperture")
        # For 300 um, need to pass as um (< 10)... but 300 > 10.
        # Let's test with explicit um: 150 um
        # Actually 150 > 10 so treated as nm (0.15 um). We need wavelengths
        # > 100 um. In nm that would be > 100000 nm.
        result = get_skin_limiting_aperture(300000)  # 300,000 nm = 300 um
        assert_close(result['diameter_mm'], 11.0, label="300um aperture")

    def test_area_calculation(self):
        """Area = pi * (d/2)^2 with d in cm."""
        result = get_skin_limiting_aperture(800)
        d_cm = 3.5 / 10.0
        expected_area = np.pi * (d_cm / 2.0) ** 2
        assert_close(result['area_cm2'], expected_area, label="3.5mm area")

    def test_area_11mm(self):
        """Area for 11 mm aperture."""
        result = get_skin_limiting_aperture(300000)  # 300 um
        d_cm = 11.0 / 10.0
        expected_area = np.pi * (d_cm / 2.0) ** 2
        assert_close(result['area_cm2'], expected_area, label="11mm area")


# =====================================================================
# Large Area Exposures — Large Area Exposures
# =====================================================================

class TestLargeArea:
    """Verified against the standard (Table 7 note c."""

    def test_small_beam_returns_none(self):
        """Beam < 100 cm^2: standard Table 7 values apply."""
        assert large_area_MPE_skin(50.0) is None
        assert large_area_MPE_skin(99.9) is None

    def test_100_to_1000_cm2(self):
        """100-1000 cm^2: MPE = 10,000 / A_s mW/cm^2."""
        assert_close(large_area_MPE_skin(100.0), 100.0, label="100 cm2")
        assert_close(large_area_MPE_skin(200.0), 50.0, label="200 cm2")
        assert_close(large_area_MPE_skin(500.0), 20.0, label="500 cm2")
        assert_close(large_area_MPE_skin(1000.0), 10.0, label="1000 cm2")

    def test_above_1000_cm2(self):
        """> 1000 cm^2: MPE = 10 mW/cm^2."""
        assert_close(large_area_MPE_skin(1001.0), 10.0, label="1001 cm2")
        assert_close(large_area_MPE_skin(5000.0), 10.0, label="5000 cm2")


# =====================================================================
# UV Successive-Day De-rating
# =====================================================================

class TestUVDerate:
    """Verified against the standard."""

    def test_derate_280_400(self):
        """280-400 nm: MPE reduced by factor of 2.5."""
        H = 1.0
        assert_close(uv_successive_day_derate(300, H), 1.0 / 2.5, label="300nm derate")
        assert_close(uv_successive_day_derate(355, H), 1.0 / 2.5, label="355nm derate")
        assert_close(uv_successive_day_derate(399, H), 1.0 / 2.5, label="399nm derate")

    def test_no_derate_below_280(self):
        """Below 280 nm: no de-rating."""
        H = 1.0
        assert_close(uv_successive_day_derate(250, H), 1.0, label="250nm no derate")
        assert_close(uv_successive_day_derate(200, H), 1.0, label="200nm no derate")

    def test_no_derate_above_400(self):
        """Above 400 nm: no de-rating."""
        H = 1.0
        assert_close(uv_successive_day_derate(532, H), 1.0, label="532nm no derate")
        assert_close(uv_successive_day_derate(1064, H), 1.0, label="1064nm no derate")

    def test_boundary_280nm(self):
        """280 nm is the start of de-rating range (inclusive)."""
        H = 1.0
        assert_close(uv_successive_day_derate(280, H), 1.0 / 2.5, label="280nm boundary")

    def test_boundary_400nm(self):
        """400 nm is outside the de-rating range (exclusive)."""
        H = 1.0
        assert_close(uv_successive_day_derate(400, H), 1.0, label="400nm boundary")

    def test_preserves_value(self):
        """De-rated value is exactly H/2.5."""
        assert_close(uv_successive_day_derate(355, 3e-3), 3e-3 / 2.5, label="3e-3 derate")


# =====================================================================
# Unit Conversions
# =====================================================================

class TestUnitConversions:
    """Arithmetic correctness of unit conversions."""

    def test_radiant_exposure_to_mJ(self):
        assert_close(radiant_exposure_convert(0.02, 'mJ/cm2'), 20.0, label="J->mJ")

    def test_radiant_exposure_to_Jm2(self):
        assert_close(radiant_exposure_convert(0.02, 'J/m2'), 200.0, label="J/cm2->J/m2")

    def test_radiant_exposure_to_mJm2(self):
        assert_close(radiant_exposure_convert(0.02, 'mJ/m2'), 200000.0, label="J/cm2->mJ/m2")

    def test_irradiance(self):
        """E = H/t."""
        result = irradiance_from_radiant_exposure(1.0, 10.0)
        assert_close(result['W/cm2'], 0.1, label="irradiance W/cm2")
        assert_close(result['mW/cm2'], 100.0, label="irradiance mW/cm2")
        assert_close(result['W/m2'], 1000.0, label="irradiance W/m2")

    def test_pulse_energy(self):
        """Q = H * A."""
        # 3.5 mm aperture: area = pi*(0.175)^2 = 0.09621 cm^2
        area = np.pi * (0.175) ** 2
        result = pulse_energy_from_radiant_exposure(0.02, area)
        expected_J = 0.02 * area
        assert_close(result['J'], expected_J, label="pulse energy J")
        assert_close(result['mJ'], expected_J * 1e3, label="pulse energy mJ")

    def test_average_power(self):
        """P = H * A / t."""
        area = 0.1  # cm^2
        result = average_power_from_radiant_exposure(2.0, 10.0, area)
        assert_close(result['W'], 2.0 * 0.1 / 10.0, label="avg power W")
        assert_close(result['mW'], 2.0 * 0.1 / 10.0 * 1e3, label="avg power mW")

    def test_irradiance_zero_time_raises(self):
        try:
            irradiance_from_radiant_exposure(1.0, 0.0)
            assert False, "Should have raised ValueError"
        except ValueError:
            pass

    def test_array_input(self):
        """Conversions handle array input."""
        H_arr = np.array([0.01, 0.02, 0.1])
        result = radiant_exposure_convert(H_arr, 'mJ/cm2')
        expected = np.array([10.0, 20.0, 100.0])
        npt.assert_allclose(result, expected, err_msg="array conversion")


# =====================================================================
# Run all tests
# =====================================================================

def run_all_tests():
    test_classes = [
        TestTmax,
        TestLimitingAperture,
        TestLargeArea,
        TestUVDerate,
        TestUnitConversions,
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
