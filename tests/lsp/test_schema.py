#!/usr/bin/env python3
"""Exhaustive validation of web/lsp/schema.json against a corpus of test documents.

This script is a Python-side check that the schema enforces every constraint
documented in the design document. It runs the schema against approximately
40 hand-crafted documents (both valid and intentionally malformed) and reports
any discrepancy between expected and actual validation outcome.

It is not the runtime validator that ships in the browser. The browser-side
validator uses Ajv and lives in web/lsp/validate.js. This script exists to
verify the schema itself is correct independently of any JavaScript code.
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "web" / "lsp" / "schema.json"

# ─────────────────────────────────────────────────────────────────────────────
# A canonical minimal valid document used as a starting point for many tests
# ─────────────────────────────────────────────────────────────────────────────

MINIMAL_VALID = {
    "lsp_version": "1.0.0",
    "meta": {
        "units": {"length": "mm", "time": "s", "power": "W"}
    },
    "laser": {
        "wavelength_nm": 1310,
        "beam_diameter_mm": 0.02,
        "pulse_mode": "cw"
    },
    "exposure": {
        "tissue": "skin",
        "exposure_duration_s": 10.0
    },
    "pattern": {
        "representation": "segments",
        "authoritative": "segments",
        "segments": [
            {
                "id": 0,
                "type": "line",
                "p0": [0.0, 0.0],
                "p1": [1.0, 0.0],
                "velocity": {"mode": "constant", "value_mm_per_s": 50.0},
                "power": {"mode": "constant", "value": 0.01}
            }
        ]
    }
}


def deep_copy(obj):
    return json.loads(json.dumps(obj))


def make_test(name, mutator, should_be_valid):
    """Create a test case by applying a mutator to the minimal valid document."""
    doc = deep_copy(MINIMAL_VALID)
    mutator(doc)
    return (name, doc, should_be_valid)


def remove_path(doc, path):
    """Remove a key at a dot-separated path inside doc."""
    parts = path.split(".")
    cursor = doc
    for p in parts[:-1]:
        cursor = cursor[p]
    cursor.pop(parts[-1], None)


def set_path(doc, path, value):
    """Set a key at a dot-separated path inside doc."""
    parts = path.split(".")
    cursor = doc
    for p in parts[:-1]:
        cursor = cursor[p]
    cursor[parts[-1]] = value


# ─────────────────────────────────────────────────────────────────────────────
# Test corpus
# ─────────────────────────────────────────────────────────────────────────────

TESTS = []

# ── Baseline valid documents ─────────────────────────────────────────────────

TESTS.append(("minimal valid segments document", deep_copy(MINIMAL_VALID), True))

TESTS.append(make_test(
    "pulsed laser with explicit pulse block",
    lambda d: set_path(d, "laser", {
        "wavelength_nm": 800,
        "beam_diameter_mm": 0.05,
        "pulse_mode": "pulsed",
        "pulse": {"repetition_rate_hz": 100000, "pulse_duration_s": 5e-9}
    }),
    True
))

TESTS.append(make_test(
    "samples representation with all arrays",
    lambda d: set_path(d, "pattern", {
        "representation": "samples",
        "authoritative": "samples",
        "samples": {
            "sample_rate_hz": 1e6,
            "x": [0.0, 0.1, 0.2, 0.3],
            "y": [0.0, 0.0, 0.0, 0.0],
            "power": [0.01, 0.01, 0.01, 0.01],
            "blanked": [False, False, False, True]
        }
    }),
    True
))

TESTS.append(make_test(
    "hybrid representation with segments and samples",
    lambda d: (
        set_path(d, "pattern.representation", "hybrid"),
        set_path(d, "pattern.samples", {
            "sample_rate_hz": 1e6,
            "x": [0.0, 0.5, 1.0],
            "y": [0.0, 0.0, 0.0]
        })
    ),
    True
))

TESTS.append(make_test(
    "dwell segment",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "dwell", "p0": [0.0, 0.0], "duration_s": 0.001,
         "power": {"mode": "constant", "value": 0.01}}
    ]),
    True
))

TESTS.append(make_test(
    "move (blanked transit) segment",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "move", "p0": [0.0, 0.0], "p1": [1.0, 0.0],
         "velocity": {"mode": "constant", "value_mm_per_s": 1000.0},
         "blanked": True}
    ]),
    True
))

TESTS.append(make_test(
    "arc segment with center and sweep",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "arc", "p0": [1.0, 0.0], "p1": [0.0, 1.0],
         "center": [0.0, 0.0], "sweep_rad": 1.5708,
         "velocity": {"mode": "constant", "value_mm_per_s": 50.0},
         "power": {"mode": "constant", "value": 0.01}}
    ]),
    True
))

TESTS.append(make_test(
    "linear ramp velocity and power",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "line", "p0": [0.0, 0.0], "p1": [1.0, 0.0],
         "velocity": {"mode": "linear_ramp", "v_start_mm_per_s": 10.0, "v_end_mm_per_s": 50.0},
         "power": {"mode": "linear_ramp", "value_start": 0.0, "value_end": 0.01}}
    ]),
    True
))

TESTS.append(make_test(
    "inherit velocity with pattern default",
    lambda d: (
        set_path(d, "pattern.default_velocity_mm_s", 100.0),
        set_path(d, "pattern.segments", [
            {"id": 0, "type": "line", "p0": [0.0, 0.0], "p1": [1.0, 0.0],
             "velocity": {"mode": "inherit"},
             "power": {"mode": "constant", "value": 0.01}}
        ])
    ),
    True
))

TESTS.append(make_test(
    "looped pattern",
    lambda d: set_path(d, "pattern.loop", {"enabled": True, "count": 5, "frame_gap_s": 0.1}),
    True
))

TESTS.append(make_test(
    "all optional meta fields present",
    lambda d: set_path(d, "meta", {
        "name": "Test pattern",
        "description": "A pattern used in unit tests.",
        "created": "2026-05-13T14:00:00Z",
        "author": "Isaac Gallegos",
        "source_tool": "LSP test harness 1.0",
        "coordinate_frame": "sample_plane",
        "units": {"length": "mm", "time": "s", "power": "W", "wavelength": "nm"},
        "origin": [0.0, 0.0],
        "extent_bbox": [[-1.0, -1.0], [1.0, 1.0]]
    }),
    True
))

TESTS.append(make_test(
    "validation hints supplied",
    lambda d: set_path(d, "validation_hints", {
        "max_velocity_mm_per_s": 1000.0,
        "max_power_w": 1.0,
        "expected_total_duration_s": 10.0
    }),
    True
))

TESTS.append(make_test(
    "parameterized shape preserved alongside segments",
    lambda d: set_path(d, "pattern.parameterized", [
        {"id": 0, "shape": "spiral", "params": {"center": [0, 0], "r0": 0, "r1": 1.0, "pitch_mm": 0.01}}
    ]),
    True
))

# ── Invalid: missing required top-level fields ───────────────────────────────

for field in ["lsp_version", "meta", "laser", "exposure", "pattern"]:
    TESTS.append(make_test(
        f"missing required field {field}",
        lambda d, f=field: d.pop(f),
        False
    ))

# ── Invalid: malformed lsp_version ───────────────────────────────────────────

for bad in ["1.0", "v1.0.0", "1.0.0-beta", "", "abc"]:
    TESTS.append(make_test(
        f"lsp_version not SemVer: {bad!r}",
        lambda d, b=bad: set_path(d, "lsp_version", b),
        False
    ))

# ── Invalid: missing required nested fields ──────────────────────────────────

TESTS.append(make_test(
    "meta missing units",
    lambda d: remove_path(d, "meta.units"),
    False
))

TESTS.append(make_test(
    "units missing length",
    lambda d: remove_path(d, "meta.units.length"),
    False
))

TESTS.append(make_test(
    "units missing time",
    lambda d: remove_path(d, "meta.units.time"),
    False
))

TESTS.append(make_test(
    "units missing power",
    lambda d: remove_path(d, "meta.units.power"),
    False
))

TESTS.append(make_test(
    "laser missing wavelength_nm",
    lambda d: remove_path(d, "laser.wavelength_nm"),
    False
))

TESTS.append(make_test(
    "laser missing beam_diameter_mm",
    lambda d: remove_path(d, "laser.beam_diameter_mm"),
    False
))

TESTS.append(make_test(
    "laser missing pulse_mode",
    lambda d: remove_path(d, "laser.pulse_mode"),
    False
))

TESTS.append(make_test(
    "exposure missing tissue",
    lambda d: remove_path(d, "exposure.tissue"),
    False
))

TESTS.append(make_test(
    "exposure missing exposure_duration_s",
    lambda d: remove_path(d, "exposure.exposure_duration_s"),
    False
))

# ── Invalid: bad enums ───────────────────────────────────────────────────────

TESTS.append(make_test(
    "units.length not in enum",
    lambda d: set_path(d, "meta.units.length", "cm"),
    False
))

TESTS.append(make_test(
    "laser.pulse_mode not in enum",
    lambda d: set_path(d, "laser.pulse_mode", "burst"),
    False
))

TESTS.append(make_test(
    "exposure.tissue not in enum",
    lambda d: set_path(d, "exposure.tissue", "eye"),
    False
))

TESTS.append(make_test(
    "pattern.representation not in enum",
    lambda d: set_path(d, "pattern.representation", "waveform"),
    False
))

TESTS.append(make_test(
    "segment.type not in enum",
    lambda d: (
        set_path(d, "pattern.segments", [
            {"id": 0, "type": "curve", "p0": [0, 0], "p1": [1, 0]}
        ])
    ),
    False
))

# ── Invalid: out-of-range numeric values ─────────────────────────────────────

TESTS.append(make_test(
    "wavelength_nm below 180",
    lambda d: set_path(d, "laser.wavelength_nm", 100),
    False
))

TESTS.append(make_test(
    "wavelength_nm above 1e6",
    lambda d: set_path(d, "laser.wavelength_nm", 1e7),
    False
))

TESTS.append(make_test(
    "beam_diameter_mm not positive",
    lambda d: set_path(d, "laser.beam_diameter_mm", 0),
    False
))

TESTS.append(make_test(
    "exposure_duration_s not positive",
    lambda d: set_path(d, "exposure.exposure_duration_s", 0),
    False
))

TESTS.append(make_test(
    "exposure_duration_s above 24h",
    lambda d: set_path(d, "exposure.exposure_duration_s", 86401),
    False
))

TESTS.append(make_test(
    "velocity.value_mm_per_s not positive",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "line", "p0": [0, 0], "p1": [1, 0],
         "velocity": {"mode": "constant", "value_mm_per_s": 0},
         "power": {"mode": "constant", "value": 0.01}}
    ]),
    False
))

TESTS.append(make_test(
    "power.value negative",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "line", "p0": [0, 0], "p1": [1, 0],
         "velocity": {"mode": "constant", "value_mm_per_s": 50},
         "power": {"mode": "constant", "value": -0.01}}
    ]),
    False
))

# ── Invalid: structural violations of representation ↔ payload rule ──────────

TESTS.append(make_test(
    "representation=segments but segments null",
    lambda d: set_path(d, "pattern.segments", None),
    False
))

TESTS.append(make_test(
    "representation=samples but samples missing",
    lambda d: (
        set_path(d, "pattern.representation", "samples"),
        set_path(d, "pattern.authoritative", "samples"),
        remove_path(d, "pattern.segments")
    ),
    False
))

TESTS.append(make_test(
    "hybrid but only segments present",
    lambda d: set_path(d, "pattern.representation", "hybrid"),
    False
))

# ── Invalid: bad segment geometry ────────────────────────────────────────────

TESTS.append(make_test(
    "line segment missing p1",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "line", "p0": [0, 0],
         "velocity": {"mode": "constant", "value_mm_per_s": 50},
         "power": {"mode": "constant", "value": 0.01}}
    ]),
    False
))

TESTS.append(make_test(
    "arc segment missing center",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "arc", "p0": [1, 0], "p1": [0, 1], "sweep_rad": 1.5708,
         "velocity": {"mode": "constant", "value_mm_per_s": 50},
         "power": {"mode": "constant", "value": 0.01}}
    ]),
    False
))

TESTS.append(make_test(
    "dwell segment missing duration_s",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "dwell", "p0": [0, 0],
         "power": {"mode": "constant", "value": 0.01}}
    ]),
    False
))

TESTS.append(make_test(
    "p0 has only one coordinate",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "line", "p0": [0], "p1": [1, 0],
         "velocity": {"mode": "constant", "value_mm_per_s": 50},
         "power": {"mode": "constant", "value": 0.01}}
    ]),
    False
))

# ── Invalid: samples without required arrays ─────────────────────────────────

TESTS.append(make_test(
    "samples missing y array",
    lambda d: set_path(d, "pattern", {
        "representation": "samples",
        "authoritative": "samples",
        "samples": {"sample_rate_hz": 1e6, "x": [0, 1]}
    }),
    False
))

TESTS.append(make_test(
    "samples sample_rate_hz not positive",
    lambda d: set_path(d, "pattern", {
        "representation": "samples",
        "authoritative": "samples",
        "samples": {"sample_rate_hz": 0, "x": [0, 1], "y": [0, 0]}
    }),
    False
))

# ── Invalid: additionalProperties false constraints ──────────────────────────

TESTS.append(make_test(
    "extra property in laser",
    lambda d: set_path(d, "laser.unexpected_field", 42),
    False
))

TESTS.append(make_test(
    "extra property in segment",
    lambda d: set_path(d, "pattern.segments", [
        {"id": 0, "type": "line", "p0": [0, 0], "p1": [1, 0],
         "velocity": {"mode": "constant", "value_mm_per_s": 50},
         "power": {"mode": "constant", "value": 0.01},
         "color": "red"}
    ]),
    False
))


# ─────────────────────────────────────────────────────────────────────────────
# pytest discovery
#
# The test corpus above is structured as (name, document, should_be_valid)
# tuples in the TESTS list. To make these visible to pytest's collection
# mechanism (which runs in CI), we provide a parametrized test function that
# wraps the corpus. The standalone main() runner below remains functional for
# direct invocation via `python3 tests/lsp/test_schema.py`, preserving the
# legacy contract.
# ─────────────────────────────────────────────────────────────────────────────

try:
    import pytest

    _VALIDATOR = Draft202012Validator(json.loads(SCHEMA_PATH.read_text()))

    @pytest.mark.parametrize(
        ("name", "doc", "should_be_valid"),
        TESTS,
        ids=[name for name, _, _ in TESTS],
    )
    def test_schema_case(name, doc, should_be_valid):
        """Parametrized wrapper exposing the test corpus to pytest."""
        errors = list(_VALIDATOR.iter_errors(doc))
        is_valid = len(errors) == 0
        if should_be_valid and not is_valid:
            first = errors[0].message if errors else ""
            raise AssertionError(
                f"Case '{name}' expected to validate cleanly; got "
                f"{len(errors)} error(s); first: {first}"
            )
        if not should_be_valid and is_valid:
            raise AssertionError(
                f"Case '{name}' expected to fail validation, but the document "
                f"validated cleanly"
            )

except ImportError:
    # pytest is not installed; the standalone main() below still works.
    pass


# ─────────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────────

def main():
    schema = json.loads(SCHEMA_PATH.read_text())
    validator = Draft202012Validator(schema)

    pass_count = 0
    fail_count = 0
    failures = []

    for name, doc, should_be_valid in TESTS:
        errors = list(validator.iter_errors(doc))
        is_valid = len(errors) == 0
        if is_valid == should_be_valid:
            pass_count += 1
        else:
            fail_count += 1
            if should_be_valid:
                failures.append(
                    f"  FAIL: {name}\n         expected valid, got "
                    f"{len(errors)} error(s); first: {errors[0].message}"
                )
            else:
                failures.append(
                    f"  FAIL: {name}\n         expected invalid, but document validated cleanly"
                )

    print(f"Schema validation tests: {pass_count} passed, {fail_count} failed (of {len(TESTS)})")
    for f in failures:
        print(f)
    sys.exit(0 if fail_count == 0 else 1)


if __name__ == "__main__":
    main()
