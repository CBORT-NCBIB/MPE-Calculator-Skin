#!/usr/bin/env python3
"""
tests/conformance/test_conformance_py.py

Reads the shared conformance corpus and verifies the Python engine
produces matching results for every case.

Usage:
    python tests/conformance/test_conformance_py.py
"""

import json
import math
import os
import sys

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from laser_mpe.engine import skin_mpe, ca, load_standard
from laser_mpe.repetitive_pulse import per_pulse_MPE

# Load corpus
corpus_path = os.path.join(os.path.dirname(__file__), 'corpus.json')
with open(corpus_path, 'r') as f:
    corpus = json.load(f)

# Ensure the standard is loaded
std_path = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'standards', 'icnirp_2013.json')
load_standard(std_path)

passed = 0
failed = 0


def close(a, b, rtol):
    """Check if two values are close within relative tolerance."""
    if math.isnan(a) and math.isnan(b):
        return True
    if not math.isfinite(a) and not math.isfinite(b):
        return a == b  # both +inf or both -inf
    if rtol == 0:
        return a == b
    if b == 0:
        return abs(a) < 1e-15
    return abs((a - b) / b) < rtol


for c in corpus['cases']:
    inp = c['inputs']
    exp = c['expected']
    tol = c['tolerance']
    ok = True
    detail = ""

    if c['function'] == 'skin_mpe':
        actual = skin_mpe(inp['wl_nm'], inp['t_s'])
        # Handle NaN comparison
        if isinstance(exp, float) and math.isnan(exp):
            ok = math.isnan(actual)
        elif exp is None:
            ok = math.isnan(actual)
        else:
            ok = close(actual, exp, tol)
        detail = f"expected={exp} actual={actual}"

    elif c['function'] == 'ca':
        actual = ca(inp['wl_nm'])
        ok = close(actual, exp, tol)
        detail = f"expected={exp} actual={actual}"

    elif c['function'] == 'rep_pulse':
        # Python per_pulse_MPE returns (H_pulse, N) for scalar inputs
        H_pulse, N = per_pulse_MPE(
            inp['wl_nm'], inp['tau_s'], inp['prf_hz'], inp['T_s']
        )
        H_pulse = float(H_pulse)
        N = float(N)

        # Determine binding rule
        H_single = skin_mpe(inp['wl_nm'], inp['tau_s'])
        H_total = skin_mpe(inp['wl_nm'], inp['T_s'])
        N_val = inp['prf_hz'] * inp['T_s']
        if N_val <= 1:
            rule1 = H_single
            rule2 = H_single
            binding = "Rule 1"
        else:
            rule1 = H_single
            rule2 = H_total / N_val
            binding = "Rule 1" if rule1 <= rule2 else "Rule 2"

        exp_H = exp['H']
        exp_binding = exp['binding']

        ok_H = close(H_pulse, exp_H, tol)
        ok_r1 = close(rule1, exp['rule1'], tol)
        ok_r2 = close(rule2, exp['rule2'], tol)
        ok_N = close(N, exp['N'], tol)
        ok_binding = (binding == exp_binding)

        ok = ok_H and ok_r1 and ok_r2 and ok_N and ok_binding
        if not ok:
            detail = (
                f"H: expected={exp_H} actual={H_pulse} "
                f"| r1: expected={exp['rule1']} actual={rule1} "
                f"| r2: expected={exp['rule2']} actual={rule2} "
                f"| N: expected={exp['N']} actual={N} "
                f"| binding: expected={exp_binding} actual={binding}"
            )

    if ok:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL {c['id']}: {c['description']}")
        print(f"    {detail}")

print(f"Python conformance: {passed} passed, {failed} failed (of {len(corpus['cases'])} cases)")
if failed > 0:
    sys.exit(1)
