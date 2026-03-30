"""
Test suite for correction factors — the loaded standard.

Tests for: C_A (the only correction factor used by skin MPE).
All values verified against the loaded standard (page 76).
"""

import sys, os, math
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from laser_mpe.correction_factors import CA_visible_NIR

passed = 0
failed = 0
errors = []

def check(label, actual, expected, rtol=1e-9):
    global passed, failed, errors
    try:
        if abs(actual - expected) <= abs(expected) * rtol + 1e-15:
            passed += 1
        else:
            failed += 1
            errors.append(f"  {label}: expected {expected}, got {actual}")
    except Exception:
        failed += 1
        errors.append(f"  {label}: expected {expected}, got {actual}")

def section(title):
    print(f"\n{'─' * 65}")
    print(f"  {title}")
    print(f"{'─' * 65}")

# =================================================================
section("C_A (C_A correction factor)")
# =================================================================

check("CA(0.500)=1.0", CA_visible_NIR(0.500), 1.0)
check("CA(0.700)=1.0", CA_visible_NIR(0.700), 1.0)
check("CA(0.800)=10^0.2", CA_visible_NIR(0.800), 10.0**(2*0.1))
check("CA(1.050)=5.0", CA_visible_NIR(1.050), 5.0)
check("CA(1.064)=5.0", CA_visible_NIR(1.064), 5.0)

# =================================================================
# SUMMARY
# =================================================================
print(f"\n{'=' * 65}")
print(f"  RESULTS: {passed} passed, {failed} failed  (total: {passed+failed})")
print(f"{'=' * 65}")
if errors:
    print("\n  FAILURES:")
    for e in errors:
        print(e)
    sys.exit(1)
else:
    print("\n  ALL CHECKS PASSED.")
    sys.exit(0)
