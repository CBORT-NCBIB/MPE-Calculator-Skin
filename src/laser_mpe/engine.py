"""
Generic data-driven laser skin MPE calculation engine.

This module reads all standard-specific values (wavelength bands,
duration boundaries, coefficients, correction factors) from a JSON
data file. No standard-specific numbers are hardcoded here.

The JSON schema is documented in web/standards/README.md.

To use a different standard:
    >>> from laser_mpe.engine import load_standard, skin_mpe
    >>> load_standard('path/to/ansi_z136_2022.json')
    >>> H = skin_mpe(532, 1e-8)  # Now uses ANSI values

Unit convention (all standards must use these units in JSON):
    Wavelength:  nm
    Duration:    s
    MPE output:  J/cm²
"""

import json
import math
import os
from importlib import resources as _resources
from pathlib import Path

import numpy as np

# ═══════════════════════════════════════════════════════════════
# Module-level state: the currently loaded standard
# ═══════════════════════════════════════════════════════════════
_std = None

_DEFAULT_STANDARD_FILE = "icnirp_2013.json"


def _default_standard_data():
    """Return the default standard (ICNIRP 2013) as a parsed dict.

    Loads from packaged data via importlib.resources so it works from an
    installed wheel as well as an editable/source checkout. Falls back to the
    repository's web/standards copy only if the packaged data is unavailable.
    """
    try:
        ref = _resources.files(__package__).joinpath("data", _DEFAULT_STANDARD_FILE)
        return json.loads(ref.read_text(encoding="utf-8"))
    except (FileNotFoundError, ModuleNotFoundError, AttributeError, TypeError):
        fallback = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "..", "web", "standards", _DEFAULT_STANDARD_FILE,
        )
        with open(fallback, "r") as f:
            return json.load(f)

# ═══════════════════════════════════════════════════════════════
# Schema validation
# ═══════════════════════════════════════════════════════════════
VALID_FORMULAS = frozenset([
    "constant", "power", "linear",
    "ca_constant", "ca_power", "ca_linear",
    "discrete", "power_offset"
])


def validate_standard(data):
    """Validate a standard data dict against the expected schema.

    Returns a list of error strings. Empty list means valid.
    """
    errors = []
    if not data:
        return ["No data provided"]
    if not data.get("standard", {}).get("name"):
        errors.append("Missing standard.name")
    cf = data.get("correction_factors", {})
    if not cf.get("CA"):
        errors.append("Missing correction_factors.CA")
    elif not cf["CA"].get("regions"):
        errors.append("CA: missing regions array")
    if not data.get("display_bands"):
        errors.append("Missing or empty display_bands")
    bands = data.get("bands", [])
    if not bands:
        errors.append("Missing or empty bands array")

    for bi, band in enumerate(bands):
        bname = band.get("name", f"Band {bi}")
        if band.get("wl_min_nm") is None or band.get("wl_max_nm") is None:
            errors.append(f"Band '{bname}': missing wl bounds")
        if not band.get("mode"):
            errors.append(f"Band '{bname}': missing mode")

        region_sets = []
        if band.get("mode") == "dual_limit":
            if not band.get("thermal", {}).get("regions"):
                errors.append(f"Band '{bname}': dual_limit but missing thermal.regions")
            else:
                region_sets.append(band["thermal"]["regions"])
            if not band.get("photochemical", {}).get("regions"):
                errors.append(f"Band '{bname}': dual_limit but missing photochemical.regions")
            else:
                region_sets.append(band["photochemical"]["regions"])
        else:
            regs = band.get("regions", [])
            if not regs:
                errors.append(f"Band '{bname}': missing regions array")
            else:
                region_sets.append(regs)

        for regs in region_sets:
            for ri, r in enumerate(regs):
                if r.get("t_min_s") is None or r.get("t_max_s") is None:
                    errors.append(f"Band '{bname}' region {ri}: missing t bounds")
                formula = r.get("formula")
                if not formula:
                    errors.append(f"Band '{bname}' region {ri}: missing formula")
                elif formula not in VALID_FORMULAS:
                    errors.append(f"Band '{bname}' region {ri}: unknown formula '{formula}'")
                if formula and formula != "discrete" and r.get("a") is None:
                    errors.append(f"Band '{bname}' region {ri}: formula '{formula}' requires 'a'")
                if formula in ("power", "ca_power", "power_offset") and r.get("b") is None:
                    errors.append(f"Band '{bname}' region {ri}: formula '{formula}' requires 'b'")
                if formula == "power_offset" and r.get("c") is None:
                    errors.append(f"Band '{bname}' region {ri}: formula 'power_offset' requires 'c'")
                if formula == "discrete":
                    lookup = r.get("lookup")
                    if not lookup:
                        errors.append(f"Band '{bname}' region {ri}: formula 'discrete' requires 'lookup'")
                    elif lookup not in data:
                        errors.append(
                            f"Band '{bname}' region {ri}: discrete lookup table "
                            f"'{lookup}' not found in the standard"
                        )

    return errors


# ═══════════════════════════════════════════════════════════════
# Loading
# ═══════════════════════════════════════════════════════════════

def load_standard(source=None):
    """Load a standard data file.

    Parameters
    ----------
    source : str or dict or None
        Path to a JSON file, or an already-parsed dict.
        If None, loads the default standard (ICNIRP 2013).

    Raises
    ------
    ValueError
        If the data fails schema validation.
    FileNotFoundError
        If the file path does not exist.
    """
    global _std

    if source is None:
        data = _default_standard_data()
    elif isinstance(source, dict):
        data = source
    elif isinstance(source, (str, Path)):
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"Standard file not found: {path}")
        with open(path, 'r') as f:
            data = json.load(f)
    else:
        raise TypeError(f"source must be a file path or dict, got {type(source)}")

    errors = validate_standard(data)
    if errors:
        raise ValueError(
            "Standard data validation failed:\n  " +
            "\n  ".join(errors)
        )

    _std = data


def get_standard():
    """Return the currently loaded standard's metadata dict."""
    _ensure_loaded()
    return _std["standard"]


def _ensure_loaded():
    """Load default standard if none is loaded yet."""
    global _std
    if _std is None:
        load_standard(None)


def _validate_wavelength(wl_nm):
    """Coerce to float; require a finite wavelength within the standard's range.

    Raises ValueError on NaN/inf or a value outside the loaded standard's
    ``wl_range_nm``. Used by the functions whose out-of-range behavior would
    otherwise be a plausible-but-wrong value rather than a safe NaN.
    """
    wl = float(wl_nm)
    if not math.isfinite(wl):
        raise ValueError(f"Wavelength must be a finite number, got {wl_nm!r}")
    lo, hi = _std["standard"]["wl_range_nm"]
    if wl < lo or wl > hi:
        raise ValueError(f"Wavelength {wl} nm is outside the standard's range [{lo}, {hi}] nm")
    return wl


# ═══════════════════════════════════════════════════════════════
# Correction factor C_A
# ═══════════════════════════════════════════════════════════════

def ca(wl_nm):
    """Compute C_A correction factor for the given wavelength.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nanometers.

    Returns
    -------
    float
        Correction factor (dimensionless).
    """
    _ensure_loaded()
    wl_nm = _validate_wavelength(wl_nm)
    ca_def = _std["correction_factors"]["CA"]
    regions = ca_def["regions"]

    for i, r in enumerate(regions):
        # Left-inclusive, right-exclusive, except inclusive upper on last region
        in_range = (wl_nm >= r["wl_min_nm"] and wl_nm < r["wl_max_nm"])
        if not in_range and i == len(regions) - 1 and wl_nm == r["wl_max_nm"]:
            in_range = True
        if not in_range:
            continue

        if r["type"] == "constant":
            return r["value"]
        if r["type"] == "power10":
            return 10.0 ** (r["coefficient"] * (wl_nm - r["offset_nm"]))

    return ca_def.get("default_outside_range", 1.0)


# ═══════════════════════════════════════════════════════════════
# UV discrete step lookup
# ═══════════════════════════════════════════════════════════════

def _uv_discrete_lookup(wl_nm, table_name=None):
    """Look up UV photochemical MPE from a discrete step table.

    Args:
        wl_nm: Wavelength in nm.
        table_name: Key in the standard dict for the lookup table.
                    Defaults to 'uv_discrete_steps'.
    """
    key = table_name or "uv_discrete_steps"
    ds = _std.get(key)
    if ds is None:
        return float('nan')
    for step in ds["steps"]:
        if wl_nm < step["wl_upper_nm"]:
            return step["H_J_cm2"]
    return ds["fallback_H_J_cm2"]


# ═══════════════════════════════════════════════════════════════
# Generic formula evaluator
# ═══════════════════════════════════════════════════════════════

def _eval_formula(region, wl_nm, t):
    """Evaluate a single formula region."""
    f = region["formula"]
    if f == "constant":
        return region["a"]
    if f == "power":
        return region["a"] * (t ** region["b"])
    if f == "linear":
        return region["a"] * t
    if f == "ca_constant":
        return region["a"] * ca(wl_nm)
    if f == "ca_power":
        return region["a"] * ca(wl_nm) * (t ** region["b"])
    if f == "ca_linear":
        return region["a"] * ca(wl_nm) * t
    if f == "discrete":
        return _uv_discrete_lookup(wl_nm, region.get("lookup"))
    if f == "power_offset":
        return region["a"] * (t ** region["b"]) + region["c"]
    return float('nan')


def _eval_regions(regions, wl_nm, t):
    """Evaluate a set of duration regions for a given wavelength and time.

    Returns NaN if t is outside all defined regions.
    """
    # Time regions are half-open [t_min, t_max), except that the standard's
    # maximum exposure duration (dur_range_s upper bound) is inclusive, mirroring
    # the inclusive upper edge of the outermost wavelength band.
    max_dur = None
    if _std is not None:
        try:
            max_dur = _std["standard"]["dur_range_s"][1]
        except (KeyError, TypeError, IndexError):
            max_dur = None

    for r in regions:
        # Wavelength sub-filtering (used by UV photochemical sub-bands)
        if "wl_min_nm" in r and "wl_max_nm" in r:
            if wl_nm < r["wl_min_nm"] or wl_nm >= r["wl_max_nm"]:
                continue

        in_time = r["t_min_s"] <= t < r["t_max_s"]
        if not in_time and max_dur is not None and t == r["t_max_s"] == max_dur:
            in_time = True
        if in_time:
            return _eval_formula(r, wl_nm, t)

        # Special handling: "not_applicable" below t_min means this limit
        # doesn't apply, so return infinity to let other limits dominate
        if t < r["t_min_s"] and r.get("below_t_min") == "not_applicable":
            if "wl_min_nm" in r and (wl_nm < r["wl_min_nm"] or wl_nm >= r["wl_max_nm"]):
                continue
            return float('inf')

    return float('nan')


def _eval_dual_limit(band, wl_nm, t):
    """Evaluate a dual-limit band (e.g., UV: min of thermal and photochemical)."""
    th = _eval_regions(band["thermal"]["regions"], wl_nm, t)
    pc = _eval_regions(band["photochemical"]["regions"], wl_nm, t)
    th_ok = math.isfinite(th)
    pc_ok = math.isfinite(pc)
    if th_ok and pc_ok:
        return min(th, pc)
    if th_ok:
        return th
    if pc_ok:
        return pc
    return float('nan')


# ═══════════════════════════════════════════════════════════════
# Main MPE function
# ═══════════════════════════════════════════════════════════════

def skin_mpe(wl_nm, t):
    """Compute skin MPE for any wavelength and duration.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nanometers.
    t : float
        Exposure duration in seconds.

    Returns
    -------
    float
        Radiant exposure MPE in J/cm².
        Returns NaN if outside valid range.
    """
    _ensure_loaded()
    bands = _std["bands"]
    wl_nm = float(wl_nm)
    t = float(t)

    for i, band in enumerate(bands):
        in_band = (wl_nm >= band["wl_min_nm"] and wl_nm < band["wl_max_nm"])
        # Inclusive upper bound on last band
        if not in_band and i == len(bands) - 1 and wl_nm == band["wl_max_nm"]:
            in_band = True
        if not in_band:
            continue

        if band["mode"] == "dual_limit":
            return _eval_dual_limit(band, wl_nm, t)
        return _eval_regions(band["regions"], wl_nm, t)

    return float('nan')


def skin_mpe_array(wl_nm, t_array):
    """Vectorized skin MPE over an array of durations.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nanometers.
    t_array : array-like
        Exposure durations in seconds.

    Returns
    -------
    ndarray
        MPE values in J/cm².
    """
    t_array = np.asarray(t_array, dtype=float)
    if t_array.ndim == 0:
        return float(skin_mpe(wl_nm, float(t_array)))
    return np.array([skin_mpe(wl_nm, float(ti)) for ti in t_array])


def band_name(wl_nm):
    """Return the display band name for a wavelength.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nanometers.

    Returns
    -------
    str
    """
    _ensure_loaded()
    wl_nm = _validate_wavelength(wl_nm)
    dbs = _std["display_bands"]
    for db in dbs:
        if wl_nm >= db["wl_start_nm"] and wl_nm < db["wl_end_nm"]:
            return db["name"]
    # inclusive upper edge of the outermost band
    if wl_nm == dbs[-1]["wl_end_nm"]:
        return dbs[-1]["name"]
    raise ValueError(f"Wavelength {wl_nm} nm has no display band in the loaded standard")


# ═══════════════════════════════════════════════════════════════
# Repetitive pulse (standard-independent logic)
# ═══════════════════════════════════════════════════════════════

def _time_breakpoints():
    """Sorted unique time-region boundaries across all bands of the standard."""
    bps = set()
    for band in _std["bands"]:
        if band.get("mode") == "dual_limit":
            region_sets = [band["thermal"]["regions"], band["photochemical"]["regions"]]
        else:
            region_sets = [band["regions"]]
        for regions in region_sets:
            for r in regions:
                bps.add(float(r["t_min_s"]))
                bps.add(float(r["t_max_s"]))
    return sorted(bps)


def _rule2_avg_irradiance_limit(wl_nm, T):
    """Binding average-power (Rule 2) limit over the exposure window up to T.

    Rule 2 treats the pulse train as continuous: a train at PRF f with per-pulse
    radiant exposure H is permitted iff the average irradiance f*H does not exceed
    MPE(T')/T' for every averaging window T' up to the total exposure T. The
    binding value is

        g_min = min over T' of MPE(T')/T'        (J/cm^2 per s = W/cm^2),

    and the per-pulse Rule-2 limit is then g_min / f.

    MPE(T')/T' is non-increasing within each analytic piece of MPE and can only
    step up at a region breakpoint (e.g. the t^0.25 -> linear transition at 10 s),
    so the minimum lies at a breakpoint approached from the left, or at T itself.
    Evaluating that finite candidate set is exact -- no sub-sampling. This replaces
    the previous endpoint-only estimate MPE(T)/(f*T), which for T > 10 s was up to
    ~2.24 % too permissive (visible/NIR) because it missed the 10 s breakpoint.
    """
    _ensure_loaded()
    T = float(T)
    candidates = [T]
    for b in _time_breakpoints():
        if 0.0 < b <= T:
            candidates.append(math.nextafter(b, 0.0))
    g = float('inf')
    for tprime in candidates:
        if tprime <= 0.0:
            continue
        mpe = skin_mpe(wl_nm, tprime)
        if math.isfinite(mpe):
            g = min(g, mpe / tprime)
    return g


def rep_pulse(wl_nm, tau, prf, T):
    """Per-pulse MPE for repetitive-pulse skin exposure.

    Applies Rule 1 (single-pulse limit) and Rule 2 (average-power
    limit) and returns the more restrictive.

    Parameters
    ----------
    wl_nm : float
        Wavelength in nm.
    tau : float
        Single pulse duration in seconds.
    prf : float or array-like
        Pulse repetition frequency in Hz.
    T : float
        Total exposure duration in seconds.

    Returns
    -------
    H_pulse : float or ndarray
        Per-pulse MPE in J/cm².
    N : float or ndarray
        Number of pulses.
    """
    H_single = skin_mpe(wl_nm, tau)
    g_min = _rule2_avg_irradiance_limit(wl_nm, T)

    prf = np.asarray(prf, dtype=float)
    N = prf * T

    with np.errstate(divide="ignore", invalid="ignore"):
        H_rule2 = g_min / prf
    H_pulse = np.where(N <= 1.0, H_single, np.minimum(H_single, H_rule2))

    return H_pulse, N
