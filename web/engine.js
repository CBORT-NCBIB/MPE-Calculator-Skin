/**
 * Data-Driven Laser Skin MPE Calculation Engine
 * ===============================================
 * This engine reads all standard-specific values from a JSON data file.
 * No standard-specific numbers are hardcoded here.
 *
 * TO USE A DIFFERENT STANDARD:
 *   1. Copy web/standards/icnirp_2013.json to a new file.
 *   2. Edit values to match your standard's tables.
 *   3. Call loadStandard(yourData) or change web/config.js.
 *   See web/standards/README.md for schema documentation.
 *
 * UNIT CONVENTION (all standards must use these units in JSON):
 *   Wavelength:  nm     Duration:  s     MPE output:  J/cm²
 */

var _std = null;
var _validationErrors = [];

// ═══════════════════════════════════════════════════════════════
// Schema validation — run on load to catch malformed data files
// ═══════════════════════════════════════════════════════════════
var VALID_FORMULAS = ["constant","power","linear","ca_constant","ca_power","ca_linear","discrete"];

function _validateStandard(data) {
  var errors = [];
  if (!data) { errors.push("No data provided"); return errors; }
  if (!data.standard || !data.standard.name) errors.push("Missing standard.name");
  if (!data.correction_factors || !data.correction_factors.CA) errors.push("Missing correction_factors.CA");
  if (!data.display_bands || !data.display_bands.length) errors.push("Missing or empty display_bands");
  if (!data.bands || !data.bands.length) errors.push("Missing or empty bands array");

  if (data.correction_factors && data.correction_factors.CA) {
    var ca = data.correction_factors.CA;
    if (!ca.regions || !ca.regions.length) errors.push("CA: missing regions array");
    if (ca.regions) {
      for (var ci = 0; ci < ca.regions.length; ci++) {
        var cr = ca.regions[ci];
        if (cr.wl_min_nm === undefined || cr.wl_max_nm === undefined) errors.push("CA region " + ci + ": missing wl bounds");
        if (cr.type !== "constant" && cr.type !== "power10") errors.push("CA region " + ci + ": unsupported type '" + cr.type + "'");
      }
    }
  }

  if (data.bands) {
    for (var bi = 0; bi < data.bands.length; bi++) {
      var band = data.bands[bi];
      if (!band.name) errors.push("Band " + bi + ": missing name");
      if (band.wl_min_nm === undefined || band.wl_max_nm === undefined) errors.push("Band '" + band.name + "': missing wl bounds");
      if (!band.mode) errors.push("Band '" + band.name + "': missing mode");

      var regionSets = [];
      if (band.mode === "dual_limit") {
        if (!band.thermal || !band.thermal.regions) errors.push("Band '" + band.name + "': dual_limit mode but missing thermal.regions");
        if (!band.photochemical || !band.photochemical.regions) errors.push("Band '" + band.name + "': dual_limit mode but missing photochemical.regions");
        if (band.thermal) regionSets.push(band.thermal.regions);
        if (band.photochemical) regionSets.push(band.photochemical.regions);
      } else {
        if (!band.regions || !band.regions.length) errors.push("Band '" + band.name + "': missing regions array");
        if (band.regions) regionSets.push(band.regions);
      }

      for (var rsi = 0; rsi < regionSets.length; rsi++) {
        var regs = regionSets[rsi];
        if (!regs) continue;
        for (var ri = 0; ri < regs.length; ri++) {
          var r = regs[ri];
          if (r.t_min_s === undefined || r.t_max_s === undefined) errors.push("Band '" + band.name + "' region " + ri + ": missing t bounds");
          if (!r.formula) errors.push("Band '" + band.name + "' region " + ri + ": missing formula");
          else if (VALID_FORMULAS.indexOf(r.formula) === -1) errors.push("Band '" + band.name + "' region " + ri + ": unknown formula '" + r.formula + "'");
          if (r.formula && r.formula !== "discrete" && r.a === undefined) errors.push("Band '" + band.name + "' region " + ri + ": formula '" + r.formula + "' requires 'a'");
          if (r.formula && (r.formula === "power" || r.formula === "ca_power") && r.b === undefined) errors.push("Band '" + band.name + "' region " + ri + ": formula '" + r.formula + "' requires 'b'");
        }
      }
    }
  }
  return errors;
}

function loadStandard(data) {
  _validationErrors = _validateStandard(data);
  if (_validationErrors.length > 0) {
    if (typeof console !== "undefined") {
      console.error("Standard data validation errors:");
      for (var i = 0; i < _validationErrors.length; i++) console.error("  - " + _validationErrors[i]);
    }
  }
  _std = data;
}

function getStandard() {
  if (!_std) throw new Error("No standard loaded. Call loadStandard() first.");
  return _std.standard;
}

function getValidationErrors() { return _validationErrors; }

// ═══════════════════════════════════════════════════════════════
// Correction factor C_A — evaluated from JSON data
// ═══════════════════════════════════════════════════════════════
function CA(wl_nm) {
  if (!_std) return 1;
  var def = _std.correction_factors.CA;
  var regions = def.regions;
  for (var i = 0; i < regions.length; i++) {
    var r = regions[i];
    if (wl_nm >= r.wl_min_nm && wl_nm < r.wl_max_nm) {
      if (r.type === "constant") return r.value;
      if (r.type === "power10") {
        return Math.pow(10, r.coefficient * (wl_nm - r.offset_nm));
      }
    }
    // Handle inclusive upper bound for last region
    if (i === regions.length - 1 && wl_nm === r.wl_max_nm) {
      if (r.type === "constant") return r.value;
      if (r.type === "power10") {
        return Math.pow(10, r.coefficient * (wl_nm - r.offset_nm));
      }
    }
  }
  return def.default_outside_range || 1;
}

// ═══════════════════════════════════════════════════════════════
// UV discrete step lookup — evaluated from JSON data
// ═══════════════════════════════════════════════════════════════
function uvDiscreteLookup(wl_nm) {
  if (!_std || !_std.uv_discrete_steps) return NaN;
  var ds = _std.uv_discrete_steps;
  var steps = ds.steps;
  for (var i = 0; i < steps.length; i++) {
    if (wl_nm < steps[i].wl_upper_nm) return steps[i].H_J_cm2;
  }
  return ds.fallback_H_J_cm2;
}

// ═══════════════════════════════════════════════════════════════
// Generic formula evaluator
// ═══════════════════════════════════════════════════════════════
function evalFormula(region, wl_nm, t) {
  var f = region.formula;
  if (f === "constant")     return region.a;
  if (f === "power")        return region.a * Math.pow(t, region.b);
  if (f === "linear")       return region.a * t;
  if (f === "ca_constant")  return region.a * CA(wl_nm);
  if (f === "ca_power")     return region.a * CA(wl_nm) * Math.pow(t, region.b);
  if (f === "ca_linear")    return region.a * CA(wl_nm) * t;
  if (f === "discrete")     return uvDiscreteLookup(wl_nm);
  return NaN;
}

// ═══════════════════════════════════════════════════════════════
// Evaluate a single set of duration regions for a given t
// Returns NaN if t is outside all defined regions.
// ═══════════════════════════════════════════════════════════════
function evalRegions(regions, wl_nm, t) {
  for (var i = 0; i < regions.length; i++) {
    var r = regions[i];
    // Check wavelength sub-filtering (used by UV photochemical)
    if (r.wl_min_nm !== undefined && r.wl_max_nm !== undefined) {
      if (wl_nm < r.wl_min_nm || wl_nm >= r.wl_max_nm) continue;
    }
    if (t >= r.t_min_s && t < r.t_max_s) {
      return evalFormula(r, wl_nm, t);
    }
    // Below t_min: check for special handling
    if (t < r.t_min_s && r.below_t_min === "not_applicable") {
      // Only match if wavelength is in range (for sub-filtered regions)
      if (r.wl_min_nm !== undefined && (wl_nm < r.wl_min_nm || wl_nm >= r.wl_max_nm)) continue;
      return Infinity;
    }
  }
  return NaN;
}

// ═══════════════════════════════════════════════════════════════
// Dual-limit band evaluation (e.g., UV: min of thermal and
// photochemical). Returns the most restrictive finite value.
// ═══════════════════════════════════════════════════════════════
function evalDualLimit(band, wl_nm, t) {
  var th = evalRegions(band.thermal.regions, wl_nm, t);
  var pc = evalRegions(band.photochemical.regions, wl_nm, t);
  var a = isFinite(th), b = isFinite(pc);
  if (a && b) return Math.min(th, pc);
  if (a) return th;
  if (b) return pc;
  return NaN;
}

// ═══════════════════════════════════════════════════════════════
// Main dispatcher: skin MPE for any wavelength and duration
// ═══════════════════════════════════════════════════════════════
function skinMPE(wl_nm, t) {
  if (!_std) return NaN;
  var bands = _std.bands;
  for (var i = 0; i < bands.length; i++) {
    var band = bands[i];
    var inBand = (wl_nm >= band.wl_min_nm && wl_nm < band.wl_max_nm);
    // Handle inclusive upper bound for the last band
    if (!inBand && i === bands.length - 1 && wl_nm === band.wl_max_nm) {
      inBand = true;
    }
    if (!inBand) continue;

    if (band.mode === "dual_limit") {
      return evalDualLimit(band, wl_nm, t);
    }
    // Single-mode band: just evaluate the duration regions
    return evalRegions(band.regions, wl_nm, t);
  }
  return NaN;
}

// ═══════════════════════════════════════════════════════════════
// Repetitive pulse: Rules 1 and 2 (skin only, no Rule 3)
// This logic is standard-independent.
// ═══════════════════════════════════════════════════════════════
function repPulse(wl_nm, tau, prf, T) {
  if (!isFinite(prf) || prf < 0 || !isFinite(T) || T <= 0) {
    return { rule1: NaN, rule2: NaN, H: NaN, N: 0, binding: "Invalid" };
  }
  var rule1 = skinMPE(wl_nm, tau);
  var htotal = skinMPE(wl_nm, T);
  var N = prf * T;
  if (N <= 1) {
    return { rule1: rule1, rule2: rule1, H: rule1, N: N, binding: "Rule 1" };
  }
  var rule2 = htotal / N;
  var H = Math.min(rule1, rule2);
  var binding = rule1 <= rule2 ? "Rule 1" : "Rule 2";
  return { rule1: rule1, rule2: rule2, H: H, N: N, binding: binding };
}

// ═══════════════════════════════════════════════════════════════
// Band classification — reads from the loaded standard
// ═══════════════════════════════════════════════════════════════
function bandName(wl_nm) {
  if (!_std) return "";
  var db = _std.display_bands;
  for (var i = 0; i < db.length; i++) {
    if (wl_nm >= db[i].wl_start_nm && wl_nm < db[i].wl_end_nm) {
      return db[i].name;
    }
  }
  return db[db.length - 1].name;
}

// ═══════════════════════════════════════════════════════════════
// Standard metadata (for UI display)
// ═══════════════════════════════════════════════════════════════
function getSTANDARD() {
  if (!_std) return { name: "", reference: "", tables: "" };
  return {
    name: _std.standard.name,
    reference: _std.standard.reference,
    tables: _std.standard.tables_used,
    wlRange: _std.standard.wl_range_nm,
    durRange: _std.standard.dur_range_s,
    bands: _std.display_bands.map(function(b) {
      return { name: b.name, start: b.wl_start_nm, end: b.wl_end_nm };
    })
  };
}

// ═══════════════════════════════════════════════════════════════
// Photoacoustic SNR Optimizer
// Based on: Francis et al., JPhys Photonics (2026), Eqs. 5–12
// These functions are standard-independent — they call skinMPE()
// which uses whatever standard is currently loaded.
// ═══════════════════════════════════════════════════════════════

function paEffFluence(wl_nm, tau, f, T) {
  var rule1 = skinMPE(wl_nm, tau);
  var hT = skinMPE(wl_nm, T);
  if (!isFinite(rule1) || !isFinite(hT)) return NaN;
  var N = f * T;
  if (N < 1) N = 1;
  var rule2 = hT / N;
  return Math.min(rule1, rule2);
}

function paRelSNR(wl_nm, tau, f, T) {
  var phi_single = skinMPE(wl_nm, tau);
  if (!isFinite(phi_single) || phi_single <= 0) return NaN;
  var phi_eff = paEffFluence(wl_nm, tau, f, T);
  if (!isFinite(phi_eff) || phi_eff <= 0) return NaN;
  var N = f * T;
  if (N < 1) N = 1;
  return (phi_eff * Math.sqrt(N)) / phi_single;
}

function paOptimalPRF(wl_nm, tau, T) {
  var h_single = skinMPE(wl_nm, tau);
  var h_total = skinMPE(wl_nm, T);
  if (!isFinite(h_single) || !isFinite(h_total) || h_single <= 0 || T <= 0) return NaN;
  return h_total / (h_single * T);
}

// ═══════════════════════════════════════════════════════════════
// Beam geometry & limiting aperture (ICNIRP 2013 Table 8, Table 7 note b, p. 288)
//
// The limiting aperture defines the area over which radiant exposure is
// averaged for comparison with the MPE. For skin:
//   λ < 100 µm:  3.5 mm  (Table 8)
//   λ ≥ 100 µm:  11 mm   (Table 8)
//
// Evaluation rules (Table 7 note b, p. 288):
//   d < 1 mm:        Use ACTUAL radiant exposure (no aperture averaging)
//   1 mm ≤ d < d_ap: Average over the limiting aperture
//   d ≥ d_ap:        Beam fills/overfills aperture, use actual beam area
// ═══════════════════════════════════════════════════════════════
function getAperture(wl_nm) {
  if (!_std || !_std.supplementary || !_std.supplementary.limiting_apertures) {
    return wl_nm < 100000 ? 3.5 : 11.0;
  }
  var regs = _std.supplementary.limiting_apertures.regions;
  for (var i = 0; i < regs.length; i++) {
    if (wl_nm >= regs[i].wl_min_nm && wl_nm < regs[i].wl_max_nm)
      return regs[i].diameter_mm;
  }
  return regs[regs.length - 1].diameter_mm;
}

function beamEval(wl_nm, beam_dia_mm) {
  var d_ap = getAperture(wl_nm);
  if (!isFinite(beam_dia_mm) || beam_dia_mm <= 0) {
    return { d_eval_mm: 0, area_cm2: 0, regime: "invalid", aperture_mm: d_ap };
  }
  var d = beam_dia_mm;
  var d_eval, regime;

  // Read small-beam threshold from standard (default 1.0 mm if not specified)
  var ap = _std && _std.supplementary && _std.supplementary.limiting_apertures;
  var threshold = (ap && ap.small_beam_threshold_mm) || 1.0;

  if (d < threshold) {
    d_eval = d;
    regime = "actual_sub_threshold";
  } else if (d < d_ap) {
    d_eval = d_ap;
    regime = "aperture_averaged";
  } else {
    d_eval = d;
    regime = "actual_fills";
  }

  var r_cm = d_eval / 20; // mm → cm radius
  var area_cm2 = Math.PI * r_cm * r_cm;
  return { d_eval_mm: d_eval, area_cm2: area_cm2, regime: regime, aperture_mm: d_ap, threshold_mm: threshold };
}

// ═══════════════════════════════════════════════════════════════
// Scanning Beam MPE Engine
// ═══════════════════════════════════════════════════════════════
//
// Physical constants and computational limits
// ═══════════════════════════════════════════════════════════════

/** Gaussian truncation radius in units of σ. Energy beyond 3σ is <0.4% of total. */
var GAUSS_TRUNCATION_SIGMA = 3;

/** Skin thermal diffusivity κ (mm²/s). Middle of published range 0.10–0.15.
 *  Ref: Welch & van Gemert, "Optical-Thermal Response of Laser-Irradiated Tissue" */
var KAPPA_SKIN_MM2_S = 0.13;

/** Maximum grid cells before auto-scaling (limits memory to ~64 MB for 4 Float32 arrays). */
var MAX_GRID_CELLS = 4000000;

/** Default max effective pulses for subsampling. Keeps compute time <1s on modern hardware. */
var DEFAULT_MAX_COMPUTE_PULSES = 500000;

/** Operation budget: if estimated grid operations exceed this, auto-reduce ppd. */
var OP_BUDGET = 40e6;

/** Maximum pulse positions stored for visualization (Plotly performance). */
var MAX_VIZ_PULSES = 50000;

// ═══════════════════════════════════════════════════════════════
// Scanning engine implementation
// ═══════════════════════════════════════════════════════════════
//
// Computes cumulative fluence on a discretized skin surface from
// a scanning Gaussian beam. Supports CW (analytical path-segment
// integration) and pulsed (exact pulse positioning) beams.
//
// Physical model:
//   - Skin is flat in the xy-plane, beam propagates along z.
//   - Beam has Gaussian TEM₀₀ profile, 1/e diameter convention.
//   - All exposures within window T are fully cumulative.
//   - Rule 3 (N^-1/4) does NOT apply to skin.
//
// Key relationships:
//   d_1e = beam 1/e diameter (user input)
//   σ = d_1e / (2√2)           Gaussian standard deviation
//   w = d_1e / √2              1/e² radius
//   E₀ = 2P / (πw²)           Peak on-axis irradiance
//   H₀_pulse = 2Ep / (πw²)    Peak single-pulse fluence
// ═══════════════════════════════════════════════════════════════

// ── Dwell time ──────────────────────────────────────────────────

/**
 * Exact Gaussian dwell time: the equivalent flat-top duration that
 * delivers the same peak fluence as the Gaussian time-integral.
 * t_dwell = d_1e * sqrt(π) / (2v) ≈ 0.8862 * d_1e / v
 */
function scanDwellGaussian(d_1e_mm, v_mm_s) {
  return d_1e_mm * Math.sqrt(Math.PI) / (2 * v_mm_s);
}

/**
 * Geometric edge-to-edge dwell time: the time for the beam to
 * translate exactly one 1/e diameter.
 * t_dwell = d_1e / v
 * ~13% larger than the Gaussian result (conservative).
 */
function scanDwellGeometric(d_1e_mm, v_mm_s) {
  return d_1e_mm / v_mm_s;
}

// ── Error function approximation ────────────────────────────────

/**
 * Error function erf(x) via Abramowitz & Stegun 7.1.26.
 * Maximum error < 1.5×10⁻⁷.
 */
function _erf(x) {
  var a1 =  0.254829592;
  var a2 = -0.284496736;
  var a3 =  1.421413741;
  var a4 = -1.453152027;
  var a5 =  1.061405429;
  var p  =  0.3275911;
  var sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  var t = 1.0 / (1.0 + p * x);
  var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

// ── Precomputed Gaussian lookup table ───────────────────────────

var _gaussTable = null;
var _GAUSS_N = 1024;
var _GAUSS_MAX = 9.0; // exp(-9) ≈ 1.2e-4, negligible

function _initGaussTable() {
  if (_gaussTable) return;
  _gaussTable = new Float64Array(_GAUSS_N);
  for (var i = 0; i < _GAUSS_N; i++) {
    _gaussTable[i] = Math.exp(-i * _GAUSS_MAX / (_GAUSS_N - 1));
  }
}

/**
 * Fast lookup for exp(-u) where u = 2r²/w².
 * Returns 0 for u ≥ _GAUSS_MAX.
 */
function _gaussLookup(u) {
  if (u >= _GAUSS_MAX) return 0;
  if (u <= 0) return 1;
  var idx = u * (_GAUSS_N - 1) / _GAUSS_MAX;
  var i = idx | 0; // floor
  var frac = idx - i;
  return _gaussTable[i] * (1 - frac) + _gaussTable[i + 1] * frac;
}

// ── Grid creation ───────────────────────────────────────────────

/** Maximum segments before builders refuse (prevents OOM for micro-beams) */
var MAX_SEGMENTS = 500000;

/**
 * Create a fluence grid directly from scan parameters, without
 * requiring a segment array. Used by the separable fast path to
 * avoid the O(line_length/beam_diameter × n_lines) segment allocation
 * that crashes the browser for micro-scale beams.
 *
 * @param {Object} sp - Scan parameters:
 *   {d_1e_mm, x0, y0, line_length_mm, n_lines, hatch_mm, pattern}
 * @param {number} ppd - Points per diameter (default 8, min 2, max 32)
 * @returns {Object} FluenceGrid
 */
function createFluenceGridFromParams(sp, ppd) {
  if (!ppd || ppd < 2) ppd = 2;
  if (ppd > 32) ppd = 32;
  var d = sp.d_1e_mm;
  var dx = d / ppd;
  var margin = 3 * d;
  var x0 = sp.x0 || 0, y0 = sp.y0 || 0;
  var nLines = sp.n_lines || 1;
  var hatch = sp.hatch_mm || 0;

  // Bounding box from scan geometry (no segments needed)
  var xmin = x0 - margin;
  var xmax = x0 + sp.line_length_mm + margin;
  var ymin = y0 - margin;
  var ymax = y0 + (nLines - 1) * hatch + margin;

  var nx = Math.ceil((xmax - xmin) / dx) + 1;
  var ny = Math.ceil((ymax - ymin) / dx) + 1;

  // Safety cap
  if (nx * ny > MAX_GRID_CELLS) {
    var scale = Math.sqrt(MAX_GRID_CELLS / (nx * ny));
    nx = Math.floor(nx * scale);
    ny = Math.floor(ny * scale);
    dx = (xmax - xmin) / (nx - 1);
  }

  return {
    nx: nx,
    ny: ny,
    dx_mm: dx,
    x_min_mm: xmin,
    y_min_mm: ymin,
    fluence: new Float32Array(nx * ny),
    pulse_count: new Float32Array(nx * ny),
    peak_pulse_H: new Float32Array(nx * ny),
    last_visit_t: (function() {
      var a = new Float32Array(nx * ny);
      for (var i = 0; i < a.length; i++) a[i] = -1e30;
      return a;
    })(),
    min_revisit_s: (function() {
      var a = new Float32Array(nx * ny);
      for (var i = 0; i < a.length; i++) a[i] = 1e30;
      return a;
    })()
  };
}

/**
 * Create a fluence grid covering the scan path bounding box plus
 * a margin of 3 × beam diameter on each side.
 *
 * @param {number} d_1e_mm - Beam 1/e diameter in mm
 * @param {Array} segments - ScanSegment[]
 * @param {number} ppd - Points per diameter (default 8, min 4, max 32)
 * @returns {Object} FluenceGrid
 */
function createFluenceGrid(d_1e_mm, segments, ppd) {
  if (!ppd || ppd < 2) ppd = 2;
  if (ppd > 32) ppd = 32;
  var dx = d_1e_mm / ppd;
  var margin = 3 * d_1e_mm;

  // Find bounding box of all segment start points and end points
  var xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (var i = 0; i < segments.length; i++) {
    var s = segments[i];
    var xe = s.x_start_mm + d_1e_mm * Math.cos(s.angle_rad);
    var ye = s.y_start_mm + d_1e_mm * Math.sin(s.angle_rad);
    if (s.x_start_mm < xmin) xmin = s.x_start_mm;
    if (s.x_start_mm > xmax) xmax = s.x_start_mm;
    if (s.y_start_mm < ymin) ymin = s.y_start_mm;
    if (s.y_start_mm > ymax) ymax = s.y_start_mm;
    if (xe < xmin) xmin = xe;
    if (xe > xmax) xmax = xe;
    if (ye < ymin) ymin = ye;
    if (ye > ymax) ymax = ye;
  }

  xmin -= margin; xmax += margin;
  ymin -= margin; ymax += margin;

  var nx = Math.ceil((xmax - xmin) / dx) + 1;
  var ny = Math.ceil((ymax - ymin) / dx) + 1;

  // Safety cap: limit grid to 4M points (16 MB per array)
  if (nx * ny > MAX_GRID_CELLS) {
    var scale = Math.sqrt(MAX_GRID_CELLS / (nx * ny));
    nx = Math.floor(nx * scale);
    ny = Math.floor(ny * scale);
    dx = (xmax - xmin) / (nx - 1);
  }

  return {
    nx: nx,
    ny: ny,
    dx_mm: dx,
    x_min_mm: xmin,
    y_min_mm: ymin,
    fluence: new Float32Array(nx * ny),       // cumulative J/cm²
    pulse_count: new Float32Array(nx * ny),   // cumulative pulse count
    peak_pulse_H: new Float32Array(nx * ny),  // max single-pulse J/cm²
    last_visit_t: (function() {               // time of last visit (s)
      var a = new Float32Array(nx * ny);
      for (var i = 0; i < a.length; i++) a[i] = -1e30;
      return a;
    })(),
    min_revisit_s: (function() {              // min interval between visits (s)
      var a = new Float32Array(nx * ny);
      for (var i = 0; i < a.length; i++) a[i] = 1e30;
      return a;
    })()
  };
}

// ── Pulsed beam: exact pulse positioning ────────────────────────

/**
 * Compute cumulative fluence from a pulsed scanning beam using
 * exact pulse positioning. Each pulse is placed at its precise
 * (x, y) along the scan path, and its Gaussian footprint is
 * deposited onto the grid.
 *
 * Modifies grid.fluence, grid.pulse_count, grid.peak_pulse_H in place.
 *
 * @param {Object} grid - FluenceGrid
 * @param {number} d_1e_mm - Beam 1/e diameter
 * @param {number} prf_hz - Pulse repetition frequency
 * @param {number} pulse_energy_J - Energy per pulse
 * @param {Array} segments - ScanSegment[]
 * @returns {Object} { total_pulses, total_time_s }
 */
function computeScanFluencePulsed(grid, d_1e_mm, prf_hz, pulse_energy_J, segments, max_compute_pulses) {
  _initGaussTable();

  var w = d_1e_mm / Math.sqrt(2);          // 1/e² radius in mm
  var sigma = d_1e_mm / (2 * Math.sqrt(2)); // σ in mm
  var w2 = w * w;
  var H0_mm2 = 2 * pulse_energy_J / (Math.PI * w2); // peak fluence J/mm²
  var H0_cm2 = H0_mm2 * 100;               // peak fluence J/cm²

  var trunc_mm = GAUSS_TRUNCATION_SIGMA * sigma;
  var trunc2 = trunc_mm * trunc_mm;
  var trunc_grid = Math.ceil(trunc_mm / grid.dx_mm);

  var nx = grid.nx, ny = grid.ny;
  var dx = grid.dx_mm;
  var xmin = grid.x_min_mm, ymin = grid.y_min_mm;
  var flu = grid.fluence, pc = grid.pulse_count, ppH = grid.peak_pulse_H;
  var lvt = grid.last_visit_t, mrv = grid.min_revisit_s;

  var t_elapsed = 0;
  var total_pulses = 0;

  // ── Pulse subsampling for high-PRF scenarios ──
  // Estimate total pulse count across all segments
  var est_total = 0;
  for (var ei = 0; ei < segments.length; ei++) {
    var ed = d_1e_mm / segments[ei].v_mm_s;
    est_total += Math.max(0, Math.floor(ed * prf_hz));
  }
  // Compute stride: sample every Nth pulse, multiply contribution by N
  // Spatial error per stride: stride/prf * v. For stride=50, 200kHz, 100mm/s → 0.025mm (<<1mm beam)
  var mcp = max_compute_pulses || DEFAULT_MAX_COMPUTE_PULSES;
  var stride = 1;
  if (est_total > mcp && mcp > 0) {
    stride = Math.ceil(est_total / mcp);
  }
  var H_scale = H0_cm2 * stride; // pre-multiply for subsampled pulses

  // Revisit threshold: max dwell time across all segments.
  // This ensures transitions between scan lines and jumps within a single
  // raster cycle are NOT misclassified as revisits. Only genuine multi-cycle
  // revisits (gap >> max dwell) are detected.
  var revisit_threshold = 0;
  for (var ri = 0; ri < segments.length; ri++) {
    var rd = d_1e_mm / segments[ri].v_mm_s;
    if (rd > revisit_threshold) revisit_threshold = rd;
  }
  // Use 2× max dwell to add margin for edge cases at segment boundaries
  revisit_threshold *= 2;

  for (var si = 0; si < segments.length; si++) {
    var seg = segments[si];
    var seg_dur = d_1e_mm / seg.v_mm_s;
    var t_seg_start = t_elapsed;
    var t_seg_end = t_elapsed + seg_dur;

    // Blanked segments: advance time but deposit no fluence (flyback blanking)
    if (seg.blanked) {
      var seg_blanked_pulses = Math.max(0,
        Math.floor(t_seg_end * prf_hz) - Math.ceil(t_seg_start * prf_hz) + 1);
      total_pulses += seg_blanked_pulses; // count as emitted but blanked
      t_elapsed = t_seg_end;
      continue;
    }

    var cos_a = Math.cos(seg.angle_rad);
    var sin_a = Math.sin(seg.angle_rad);

    // Find pulse indices that fire within this segment's time window
    var k_first = Math.ceil(t_seg_start * prf_hz);
    var k_last_f = t_seg_end * prf_hz;
    // Exclude pulses exactly at the segment boundary (belong to next)
    var k_last = (k_last_f === Math.floor(k_last_f)) ?
      Math.floor(k_last_f) - 1 : Math.floor(k_last_f);

    // Align k_first to stride boundary within this segment
    if (stride > 1 && k_first % stride !== 0) {
      k_first += stride - (k_first % stride);
    }

    var seg_actual_pulses = Math.max(0, k_last - Math.ceil(t_seg_start * prf_hz) + 1);
    total_pulses += seg_actual_pulses;

    for (var k = k_first; k <= k_last; k += stride) {
      var t_k = k / prf_hz;
      var frac = (t_k - t_seg_start) / seg_dur;

      // Exact pulse position
      var px = seg.x_start_mm + frac * d_1e_mm * cos_a;
      var py = seg.y_start_mm + frac * d_1e_mm * sin_a;

      // Grid indices of pulse center
      var cix = Math.round((px - xmin) / dx);
      var ciy = Math.round((py - ymin) / dx);

      // Iterate over nearby grid points within truncation radius
      var ixMin = cix - trunc_grid; if (ixMin < 0) ixMin = 0;
      var ixMax = cix + trunc_grid; if (ixMax >= nx) ixMax = nx - 1;
      var iyMin = ciy - trunc_grid; if (iyMin < 0) iyMin = 0;
      var iyMax = ciy + trunc_grid; if (iyMax >= ny) iyMax = ny - 1;

      for (var iy = iyMin; iy <= iyMax; iy++) {
        var gy = ymin + iy * dx;
        var dy2 = (gy - py) * (gy - py);
        if (dy2 > trunc2) continue; // early row skip

        for (var ix = ixMin; ix <= ixMax; ix++) {
          var gx = xmin + ix * dx;
          var dx2 = (gx - px) * (gx - px);
          var r2 = dx2 + dy2;
          if (r2 > trunc2) continue;

          var two_r2_over_w2 = 2 * r2 / w2;
          var Hp = H_scale * _gaussLookup(two_r2_over_w2);

          var idx = iy * nx + ix;
          flu[idx] += Hp;
          pc[idx] += stride;
          if (H0_cm2 * _gaussLookup(two_r2_over_w2) > ppH[idx])
            ppH[idx] = H0_cm2 * _gaussLookup(two_r2_over_w2);

          // Revisit tracking: if gap since last visit > threshold, it's a new visit
          var gap = t_k - lvt[idx];
          if (gap > revisit_threshold && lvt[idx] > -1e29) {
            if (gap < mrv[idx]) mrv[idx] = gap;
          }
          lvt[idx] = t_k;
        }
      }
    }
    t_elapsed = t_seg_end;
  }

  return { total_pulses: total_pulses, total_time_s: t_elapsed, stride: stride };
}

// ── CW beam: analytical path-segment integration ────────────────

/**
 * Compute cumulative fluence from a CW scanning beam using the
 * analytical Gaussian integral formula with error functions.
 * Consecutive segments with the same angle and velocity are merged
 * into single sweeps for efficiency.
 *
 * Formula per sweep from (x1,y1) to (x2,y2):
 *   F(px,py) = P/(2π σ v) × exp(-d_perp²/(2σ²))
 *              × ½[erf((L - t_par)/(σ√2)) - erf((-t_par)/(σ√2))]
 *
 * Modifies grid.fluence in place.
 *
 * @param {Object} grid - FluenceGrid
 * @param {number} d_1e_mm - Beam 1/e diameter
 * @param {number} avg_power_W - Average power
 * @param {Array} segments - ScanSegment[]
 * @returns {Object} { n_sweeps, total_time_s }
 */
function computeScanFluenceCW(grid, d_1e_mm, avg_power_W, segments) {
  var sigma = d_1e_mm / (2 * Math.sqrt(2));
  var s2 = sigma * Math.sqrt(2);
  var sigma2 = sigma * sigma;
  var trunc_perp = GAUSS_TRUNCATION_SIGMA * sigma;
  var trunc_perp2 = trunc_perp * trunc_perp;

  var nx = grid.nx, ny = grid.ny;
  var dx = grid.dx_mm;
  var xmin = grid.x_min_mm, ymin = grid.y_min_mm;
  var flu = grid.fluence;
  var ppH = grid.peak_pulse_H; // reused for peak single-sweep fluence in CW
  var lvt = grid.last_visit_t, mrv = grid.min_revisit_s;

  // Merge consecutive segments with same angle, velocity, AND position continuity
  var sweeps = [];
  var si = 0;
  while (si < segments.length) {
    var s0 = segments[si];
    var a = s0.angle_rad, v = s0.v_mm_s;
    var cos_a = Math.cos(a), sin_a = Math.sin(a);
    var n_merged = 1;
    while (si + n_merged < segments.length &&
           segments[si + n_merged].angle_rad === a &&
           segments[si + n_merged].v_mm_s === v) {
      // Check position continuity: expected end of current chain
      var exp_x = s0.x_start_mm + n_merged * d_1e_mm * cos_a;
      var exp_y = s0.y_start_mm + n_merged * d_1e_mm * sin_a;
      var nxt = segments[si + n_merged];
      var dx_gap = nxt.x_start_mm - exp_x;
      var dy_gap = nxt.y_start_mm - exp_y;
      if (dx_gap * dx_gap + dy_gap * dy_gap > d_1e_mm * d_1e_mm * 0.01) break;
      n_merged++;
    }
    var L = n_merged * d_1e_mm;
    sweeps.push({
      x1: s0.x_start_mm, y1: s0.y_start_mm,
      x2: s0.x_start_mm + L * cos_a,
      y2: s0.y_start_mm + L * sin_a,
      ux: cos_a, uy: sin_a, L: L, v: v
    });
    si += n_merged;
  }

  var total_time = 0;
  var min_velocity = Infinity;
  var coeff_base = avg_power_W / (sigma * Math.sqrt(2 * Math.PI));

  // Revisit threshold for CW: max sweep time across all sweeps
  var cw_revisit_threshold = 0;
  for (var rti = 0; rti < sweeps.length; rti++) {
    var rt = sweeps[rti].L / sweeps[rti].v;
    if (rt > cw_revisit_threshold) cw_revisit_threshold = rt;
  }
  cw_revisit_threshold *= 2; // margin for edge cases

  for (var wi = 0; wi < sweeps.length; wi++) {
    var sw = sweeps[wi];
    var coeff = coeff_base / sw.v * 100; // J/cm²
    if (sw.v < min_velocity) min_velocity = sw.v;
    var sweep_t0 = total_time; // time when this sweep begins

    // Bounding box of this sweep ± 3σ
    var sxmin = Math.min(sw.x1, sw.x2) - trunc_perp;
    var sxmax = Math.max(sw.x1, sw.x2) + trunc_perp;
    var symin = Math.min(sw.y1, sw.y2) - trunc_perp;
    var symax = Math.max(sw.y1, sw.y2) + trunc_perp;

    var ixMin = Math.max(0, Math.floor((sxmin - xmin) / dx));
    var ixMax = Math.min(nx - 1, Math.ceil((sxmax - xmin) / dx));
    var iyMin = Math.max(0, Math.floor((symin - ymin) / dx));
    var iyMax = Math.min(ny - 1, Math.ceil((symax - ymin) / dx));

    for (var iy = iyMin; iy <= iyMax; iy++) {
      var gy = ymin + iy * dx;
      for (var ix = ixMin; ix <= ixMax; ix++) {
        var gx = xmin + ix * dx;
        var qx = gx - sw.x1;
        var qy = gy - sw.y1;
        var t_par = qx * sw.ux + qy * sw.uy;
        if (t_par < -trunc_perp || t_par > sw.L + trunc_perp) continue;
        var d_perp = qx * sw.uy - qy * sw.ux;
        var d_perp2 = d_perp * d_perp;
        if (d_perp2 > trunc_perp2) continue;
        var env = Math.exp(-d_perp2 / (2 * sigma2));
        var erf_end = _erf((sw.L - t_par) / s2);
        var erf_start = _erf(-t_par / s2);
        var F = coeff * env * 0.5 * (erf_end - erf_start);
        if (F > 0) {
          var idx = iy * nx + ix;
          flu[idx] += F;
          if (F > ppH[idx]) ppH[idx] = F;
          // Revisit tracking: visit time = sweep start + clamped t_par / v
          var t_clamped = t_par < 0 ? 0 : (t_par > sw.L ? sw.L : t_par);
          var t_visit = sweep_t0 + t_clamped / sw.v;
          var gap = t_visit - lvt[idx];
          if (gap > cw_revisit_threshold && lvt[idx] > -1e29) {
            if (gap < mrv[idx]) mrv[idx] = gap;
          }
          lvt[idx] = t_visit;
        }
      }
    }
    total_time += sw.L / sw.v;
  }

  return { n_sweeps: sweeps.length, total_time_s: total_time, min_velocity: min_velocity };
}

// ── Separable 1D Gaussian sum (θ₃-based) fluence computation ───────
//
// Mathematical basis:
//   For a circular Gaussian beam on a uniform rectangular pulse grid,
//   the 2D accumulated fluence factorizes into a product of two
//   independent 1D sums (Peter et al. 2019, Opt. Express 27(5), 6012,
//   Eq. 2.8; Zhu 2020, Math. Found. Comput. 3(3), 157–163):
//
//     F(x,y) = H₀ × S_x(x) × S_y(y)
//
//   where S_x and S_y are 1D Gaussian sums over the pulse positions
//   along and across the scan direction respectively. This identity
//   is equivalent to expressing each 1D sum as a Jacobi θ₃ function
//   (for infinite grids), but we evaluate the finite sums directly
//   since the Gaussian tail decay ensures rapid convergence.
//
// Complexity: O(G_x×M + G_y×L + G_x×G_y)
//   vs brute-force O(N_pulses × footprint_cells)
//
// Validity: uniform rectangular pulse grid, constant energy per pulse,
//   circular Gaussian beam. Handles unidirectional raster, bidirectional
//   raster, and linear scans. Falls back to brute-force for custom paths.
// ═══════════════════════════════════════════════════════════════

/**
 * Detect whether a set of scan parameters can use the separable approach.
 *
 * @param {Object} sp - Scan parameters from the caller
 * @returns {boolean} true if the separable method is applicable
 */
function canUseSeparable(sp) {
  if (!sp) return false;
  // Must be pulsed (CW uses its own analytical integration)
  if (sp.is_cw) return false;
  // Must have valid PRF and velocity
  if (!isFinite(sp.prf_hz) || sp.prf_hz <= 0) return false;
  if (!isFinite(sp.v_scan_mm_s) || sp.v_scan_mm_s <= 0) return false;
  // Must be a recognized uniform pattern
  if (sp.pattern !== "linear" && sp.pattern !== "raster" && sp.pattern !== "bidi") return false;
  // Must have valid geometry
  if (!isFinite(sp.line_length_mm) || sp.line_length_mm <= 0) return false;
  if (sp.pattern !== "linear") {
    if (!isFinite(sp.n_lines) || sp.n_lines < 1) return false;
    if (!isFinite(sp.hatch_mm) || sp.hatch_mm <= 0) return false;
  }
  return true;
}

/**
 * Compute the 1D Gaussian sum at each grid position along one axis.
 *
 * For positions p_0, p_0+Δp, p_0+2Δp, ..., p_0+(N-1)Δp:
 *   S(x) = Σ_{k=0}^{N-1} exp(-2·(x - p_k)²/w²)
 *
 * Only terms within GAUSS_TRUNCATION_SIGMA × σ are summed (the rest
 * contribute < 0.4% of total and are safely negligible).
 *
 * @param {number} n_grid - Number of grid points along this axis
 * @param {number} grid_min - Coordinate of first grid point (mm)
 * @param {number} grid_dx - Grid spacing (mm)
 * @param {number} p0 - First pulse position along this axis (mm)
 * @param {number} dp - Pulse spacing along this axis (mm)
 * @param {number} n_pulses - Number of pulse positions
 * @param {number} w2 - Beam 1/e² radius squared (mm²)
 * @param {number} trunc_mm - Truncation radius (mm)
 * @returns {Float64Array} S[i] for i = 0..n_grid-1
 */
function _compute1DGaussSum(n_grid, grid_min, grid_dx, p0, dp, n_pulses, w2, trunc_mm) {
  var S = new Float64Array(n_grid);
  var two_over_w2 = 2.0 / w2;

  if (dp <= 0 || n_pulses <= 0) return S;

  for (var gi = 0; gi < n_grid; gi++) {
    var gx = grid_min + gi * grid_dx;
    var sum = 0.0;

    // Find range of pulse indices within truncation radius of gx
    // gx - p0 - k*dp = distance; |distance| <= trunc_mm
    // k >= (gx - p0 - trunc_mm) / dp  and  k <= (gx - p0 + trunc_mm) / dp
    var center_k = (gx - p0) / dp;
    var k_range = trunc_mm / dp;
    var k_min = Math.ceil(center_k - k_range);
    var k_max = Math.floor(center_k + k_range);
    if (k_min < 0) k_min = 0;
    if (k_max >= n_pulses) k_max = n_pulses - 1;

    for (var k = k_min; k <= k_max; k++) {
      var dx_k = gx - (p0 + k * dp);
      sum += Math.exp(-two_over_w2 * dx_k * dx_k);
    }
    S[gi] = sum;
  }
  return S;
}

/**
 * Compute cumulative fluence from a pulsed scanning beam using the
 * separable 1D Gaussian sum factorization.
 *
 * For a uniform raster scan, the 2D fluence at each grid point equals:
 *   F(x,y) = H₀ × S_x(x) × S_y(y)           [unidirectional]
 *   F(x,y) = H₀ × [S_x_e(x)·S_y_e(y) + S_x_o(x)·S_y_o(y)]  [bidirectional]
 *
 * where S_x is the along-scan 1D Gaussian sum and S_y is the cross-scan sum.
 *
 * Modifies grid.fluence, grid.pulse_count, grid.peak_pulse_H in place.
 *
 * @param {Object} grid - FluenceGrid (from createFluenceGrid)
 * @param {Object} sp - Scan parameters:
 *   {d_1e_mm, prf_hz, pulse_energy_J, v_scan_mm_s,
 *    x0, y0, line_length_mm, n_lines, hatch_mm,
 *    pattern, blanking}
 * @returns {Object} { total_pulses, total_time_s, stride: 1, method: "separable" }
 */
function computeScanFluenceSeparable(grid, sp) {
  var d = sp.d_1e_mm;
  var w = d / Math.sqrt(2);          // 1/e² radius (mm)
  var sigma = d / (2 * Math.sqrt(2)); // σ (mm)
  var w2 = w * w;
  var H0_mm2 = 2 * sp.pulse_energy_J / (Math.PI * w2);
  var H0_cm2 = H0_mm2 * 100;

  var trunc_mm = GAUSS_TRUNCATION_SIGMA * sigma;
  var pulse_spacing = sp.v_scan_mm_s / sp.prf_hz; // Δx (mm)
  var line_dur = sp.line_length_mm / sp.v_scan_mm_s; // seconds per scan line
  var n_pulses_per_line = Math.max(1, Math.floor(line_dur * sp.prf_hz));

  var nx = grid.nx, ny = grid.ny;
  var dx = grid.dx_mm;
  var xmin = grid.x_min_mm, ymin = grid.y_min_mm;
  var flu = grid.fluence, pc = grid.pulse_count, ppH = grid.peak_pulse_H;
  var lvt = grid.last_visit_t, mrv = grid.min_revisit_s;

  var n_lines = sp.n_lines || 1;
  var hatch = sp.hatch_mm || 0;
  var x0 = sp.x0 || 0;
  var y0 = sp.y0 || 0;

  // ── Linear scan: 1D sum only ──
  if (sp.pattern === "linear") {
    var Sx = _compute1DGaussSum(nx, xmin, dx, x0, pulse_spacing, n_pulses_per_line, w2, trunc_mm);
    var Sy = _compute1DGaussSum(ny, ymin, dx, y0, 1e30, 1, w2, trunc_mm);

    for (var iy = 0; iy < ny; iy++) {
      for (var ix = 0; ix < nx; ix++) {
        var idx = iy * nx + ix;
        flu[idx] = H0_cm2 * Sx[ix] * Sy[iy];
      }
    }
    // Pulse count: at each point, count how many pulses are within truncation radius
    for (var iy2 = 0; iy2 < ny; iy2++) {
      var gy = ymin + iy2 * dx;
      var dy_line = gy - y0;
      if (dy_line * dy_line > trunc_mm * trunc_mm) continue;
      for (var ix2 = 0; ix2 < nx; ix2++) {
        var gx = xmin + ix2 * dx;
        var k_center = (gx - x0) / pulse_spacing;
        var k_r = trunc_mm / pulse_spacing;
        var k_lo = Math.max(0, Math.ceil(k_center - k_r));
        var k_hi = Math.min(n_pulses_per_line - 1, Math.floor(k_center + k_r));
        if (k_hi >= k_lo) pc[iy2 * nx + ix2] = k_hi - k_lo + 1;
      }
    }
    // Peak single-pulse fluence at each grid point (from nearest pulse)
    for (var iy3 = 0; iy3 < ny; iy3++) {
      var gy3 = ymin + iy3 * dx;
      var dy3 = gy3 - y0;
      var dy3_exp = Math.exp(-2 * dy3 * dy3 / w2);
      for (var ix3 = 0; ix3 < nx; ix3++) {
        ppH[iy3 * nx + ix3] = H0_cm2 * dy3_exp;
      }
    }

    return {
      total_pulses: n_pulses_per_line,
      total_time_s: line_dur,
      stride: 1,
      method: "separable"
    };
  }

  // ── Unidirectional raster ──
  if (sp.pattern === "raster") {
    // All scan lines go left-to-right with same pulse x-positions
    var Sx_r = _compute1DGaussSum(nx, xmin, dx, x0, pulse_spacing, n_pulses_per_line, w2, trunc_mm);
    var Sy_r = _compute1DGaussSum(ny, ymin, dx, y0, hatch, n_lines, w2, trunc_mm);

    for (var iy_r = 0; iy_r < ny; iy_r++) {
      var sy_val = Sy_r[iy_r];
      if (sy_val < 1e-15) continue; // skip rows with no contribution
      for (var ix_r = 0; ix_r < nx; ix_r++) {
        flu[iy_r * nx + ix_r] = H0_cm2 * Sx_r[ix_r] * sy_val;
      }
    }

    // Pulse count per grid cell: product of along-line count and cross-line count
    for (var iy_rpc = 0; iy_rpc < ny; iy_rpc++) {
      var gy_rpc = ymin + iy_rpc * dx;
      // Count lines within truncation radius
      var m_center = (gy_rpc - y0) / hatch;
      var m_r = trunc_mm / hatch;
      var m_lo = Math.max(0, Math.ceil(m_center - m_r));
      var m_hi = Math.min(n_lines - 1, Math.floor(m_center + m_r));
      var n_contributing_lines = Math.max(0, m_hi - m_lo + 1);

      for (var ix_rpc = 0; ix_rpc < nx; ix_rpc++) {
        var gx_rpc = xmin + ix_rpc * dx;
        var k_c = (gx_rpc - x0) / pulse_spacing;
        var k_rng = trunc_mm / pulse_spacing;
        var k_lo_r = Math.max(0, Math.ceil(k_c - k_rng));
        var k_hi_r = Math.min(n_pulses_per_line - 1, Math.floor(k_c + k_rng));
        var n_contributing_pulses = Math.max(0, k_hi_r - k_lo_r + 1);
        pc[iy_rpc * nx + ix_rpc] = n_contributing_pulses * n_contributing_lines;
      }
    }

    // Peak single-pulse fluence: H₀ × exp(-2·dy²/w²) where dy = distance to nearest line
    for (var iy_rp = 0; iy_rp < ny; iy_rp++) {
      var gy_rp = ymin + iy_rp * dx;
      // Find nearest scan line
      var nearest_m = Math.round((gy_rp - y0) / hatch);
      if (nearest_m < 0) nearest_m = 0;
      if (nearest_m >= n_lines) nearest_m = n_lines - 1;
      var dy_rp = gy_rp - (y0 + nearest_m * hatch);
      var cross_atten = Math.exp(-2 * dy_rp * dy_rp / w2);
      for (var ix_rp = 0; ix_rp < nx; ix_rp++) {
        ppH[iy_rp * nx + ix_rp] = H0_cm2 * cross_atten;
      }
    }

    // Revisit tracking: time between consecutive scan line passes
    // For a raster, the revisit interval at a point is approximately
    // the time to scan one line + flyback time
    if (!sp.blanking) {
      // Without blanking, return pulses also contribute (handled by brute-force fallback)
      // This path should only be reached WITH blanking for raster scans
    }
    var jump_v = sp.v_scan_mm_s * 5; // assumed jump velocity
    var flyback_time = sp.line_length_mm / jump_v + hatch / jump_v;
    var line_cycle_time = line_dur + flyback_time;

    for (var iy_rv = 0; iy_rv < ny; iy_rv++) {
      var gy_rv = ymin + iy_rv * dx;
      var m_near = Math.round((gy_rv - y0) / hatch);
      if (m_near < 0 || m_near >= n_lines) continue;
      var dy_rv = gy_rv - (y0 + m_near * hatch);
      if (dy_rv * dy_rv > trunc_mm * trunc_mm) continue;
      for (var ix_rv = 0; ix_rv < nx; ix_rv++) {
        // For a single-pass raster, no true revisits (each line visits once)
        // Revisit only occurs if there are multiple passes
        // Mark last visit time based on nearest line
        lvt[iy_rv * nx + ix_rv] = m_near * line_cycle_time;
      }
    }

    // Total time: n_lines scan lines + (n_lines - 1) flybacks
    var total_time_raster = n_lines * line_dur + (n_lines - 1) * flyback_time;
    var total_pulses_active = n_lines * n_pulses_per_line;

    return {
      total_pulses: total_pulses_active,
      total_time_s: total_time_raster,
      stride: 1,
      method: "separable"
    };
  }

  // ── Bidirectional raster: two interleaved sub-grids ──
  if (sp.pattern === "bidi") {
    // Even lines (0, 2, 4, ...): scan left-to-right, pulse x = x0 + k·Δx
    // Odd lines (1, 3, 5, ...): scan right-to-left, pulse x = x0 + L - k·Δx
    var n_even = Math.ceil(n_lines / 2);
    var n_odd = Math.floor(n_lines / 2);

    // Even lines: x positions from x0
    var Sx_even = _compute1DGaussSum(nx, xmin, dx, x0, pulse_spacing, n_pulses_per_line, w2, trunc_mm);
    // Odd lines: x positions from x0 + line_length, spacing negative
    // Since exp(-2(x - (x0+L-k*dp))²/w²) = exp(-2(x - x0 - L + k*dp)²/w²),
    // this is equivalent to positions starting at x0+L-0, x0+L-dp, ...
    // i.e., p0_odd = x0 + sp.line_length_mm - (n_pulses_per_line - 1) * pulse_spacing
    // and spacing = pulse_spacing (positive), for n_pulses_per_line terms.
    // OR equivalently: positions {x0+L, x0+L-dp, ..., x0+L-(N-1)dp}
    // which reversed is {x0+L-(N-1)dp, ..., x0+L-dp, x0+L}
    // Since the sum is order-independent, we can use p0 = x0+L-(N-1)*dp, dp=pulse_spacing
    var p0_odd = x0 + sp.line_length_mm - (n_pulses_per_line - 1) * pulse_spacing;
    var Sx_odd = _compute1DGaussSum(nx, xmin, dx, p0_odd, pulse_spacing, n_pulses_per_line, w2, trunc_mm);

    // Y sums: even lines at y0, y0+2h, y0+4h, ...
    //          odd lines at y0+h, y0+3h, y0+5h, ...
    var Sy_even = _compute1DGaussSum(ny, ymin, dx, y0, 2 * hatch, n_even, w2, trunc_mm);
    var Sy_odd;
    if (n_odd > 0) {
      Sy_odd = _compute1DGaussSum(ny, ymin, dx, y0 + hatch, 2 * hatch, n_odd, w2, trunc_mm);
    } else {
      Sy_odd = new Float64Array(ny); // all zeros
    }

    // Accumulate: F(x,y) = H₀ × [Sx_even(x)·Sy_even(y) + Sx_odd(x)·Sy_odd(y)]
    for (var iy_b = 0; iy_b < ny; iy_b++) {
      var sy_e = Sy_even[iy_b];
      var sy_o = Sy_odd[iy_b];
      if (sy_e < 1e-15 && sy_o < 1e-15) continue;
      for (var ix_b = 0; ix_b < nx; ix_b++) {
        flu[iy_b * nx + ix_b] = H0_cm2 * (Sx_even[ix_b] * sy_e + Sx_odd[ix_b] * sy_o);
      }
    }

    // Pulse count: sum of contributions from even and odd lines
    for (var iy_bpc = 0; iy_bpc < ny; iy_bpc++) {
      var gy_bpc = ymin + iy_bpc * dx;
      // Count even lines within truncation
      var m_c_e = (gy_bpc - y0) / (2 * hatch);
      var m_r_e = trunc_mm / (2 * hatch);
      var m_lo_e = Math.max(0, Math.ceil(m_c_e - m_r_e));
      var m_hi_e = Math.min(n_even - 1, Math.floor(m_c_e + m_r_e));
      var n_contrib_even = Math.max(0, m_hi_e - m_lo_e + 1);
      // Count odd lines within truncation
      var m_c_o = (gy_bpc - y0 - hatch) / (2 * hatch);
      var m_r_o = trunc_mm / (2 * hatch);
      var m_lo_o = Math.max(0, Math.ceil(m_c_o - m_r_o));
      var m_hi_o = Math.min(n_odd - 1, Math.floor(m_c_o + m_r_o));
      var n_contrib_odd = Math.max(0, m_hi_o - m_lo_o + 1);

      var total_lines = n_contrib_even + n_contrib_odd;
      for (var ix_bpc = 0; ix_bpc < nx; ix_bpc++) {
        var gx_bpc = xmin + ix_bpc * dx;
        // Along-line pulse count (same for both even/odd since same spacing)
        var k_c_b = (gx_bpc - x0) / pulse_spacing;
        var k_rng_b = trunc_mm / pulse_spacing;
        var k_lo_b = Math.max(0, Math.ceil(k_c_b - k_rng_b));
        var k_hi_b = Math.min(n_pulses_per_line - 1, Math.floor(k_c_b + k_rng_b));
        var n_cp = Math.max(0, k_hi_b - k_lo_b + 1);
        pc[iy_bpc * nx + ix_bpc] = n_cp * total_lines;
      }
    }

    // Peak single-pulse fluence (from nearest line, same as raster)
    for (var iy_bp = 0; iy_bp < ny; iy_bp++) {
      var gy_bp = ymin + iy_bp * dx;
      var nearest_line = Math.round((gy_bp - y0) / hatch);
      if (nearest_line < 0) nearest_line = 0;
      if (nearest_line >= n_lines) nearest_line = n_lines - 1;
      var dy_bp = gy_bp - (y0 + nearest_line * hatch);
      var cross_att = Math.exp(-2 * dy_bp * dy_bp / w2);
      for (var ix_bp = 0; ix_bp < nx; ix_bp++) {
        ppH[iy_bp * nx + ix_bp] = H0_cm2 * cross_att;
      }
    }

    // Revisit tracking for bidi
    var jump_v_b = sp.v_scan_mm_s * 5;
    var jump_time_b = hatch / jump_v_b;
    for (var iy_brv = 0; iy_brv < ny; iy_brv++) {
      var gy_brv = ymin + iy_brv * dx;
      var m_near_b = Math.round((gy_brv - y0) / hatch);
      if (m_near_b < 0 || m_near_b >= n_lines) continue;
      var dy_brv = gy_brv - (y0 + m_near_b * hatch);
      if (dy_brv * dy_brv > trunc_mm * trunc_mm) continue;
      for (var ix_brv = 0; ix_brv < nx; ix_brv++) {
        lvt[iy_brv * nx + ix_brv] = m_near_b * (line_dur + jump_time_b);
      }
    }

    var total_time_bidi = n_lines * line_dur + (n_lines - 1) * jump_time_b;
    return {
      total_pulses: n_lines * n_pulses_per_line,
      total_time_s: total_time_bidi,
      stride: 1,
      method: "separable"
    };
  }

  // Should not reach here if canUseSeparable was checked
  return { total_pulses: 0, total_time_s: 0, stride: 1, method: "separable_fallthrough" };
}

// ── Unified fluence computation ─────────────────────────────────

/**
 * Compute fluence grid from a scan path. Dispatches to CW, separable
 * pulsed (for uniform raster/linear scans), or brute-force pulsed.
 *
 * @param {Object} beam - { d_1e_mm, is_cw, prf_hz, pulse_energy_J, avg_power_W }
 * @param {Array} segments - ScanSegment[]
 * @param {number} ppd - Points per diameter (default 8)
 * @param {Object} [scanParams] - Optional scan parameters for separable fast path
 * @returns {Object} { grid, stats }
 */
function computeScanFluence(beam, segments, ppd, scanParams) {
  if (!scanParams && (!segments || segments.length === 0)) return null;
  ppd = ppd || 8;

  // ── Separable fast path: bypass segment-based grid creation entirely ──
  // This avoids the O(line_length/beam_diameter × n_lines) segment array
  // that can crash the browser for micro-scale beams over large areas.
  if (scanParams && canUseSeparable(scanParams)) {
    var grid = createFluenceGridFromParams(scanParams, ppd);
    var stats = computeScanFluenceSeparable(grid, scanParams);
    return { grid: grid, stats: stats };
  }

  // ── Standard path: requires pre-built segment array ──
  if (!segments || segments.length === 0) return null;
  var grid2 = createFluenceGrid(beam.d_1e_mm, segments, ppd);
  var stats2;
  if (beam.is_cw) {
    stats2 = computeScanFluenceCW(grid2, beam.d_1e_mm, beam.avg_power_W, segments);
    stats2.total_pulses = 0;
  } else {
    stats2 = computeScanFluencePulsed(grid2, beam.d_1e_mm, beam.prf_hz,
      beam.pulse_energy_J, segments);
  }
  return { grid: grid2, stats: stats2 };
}

// ── Safety evaluation ───────────────────────────────────────────

/**
 * Evaluate scan safety against the loaded standard's MPE.
 *
 * Rule 1: peak single-pulse fluence ≤ MPE(τ)         [pulsed]
 *         OR peak single-sweep fluence ≤ MPE(t_dwell) [CW]
 * Rule 2: cumulative fluence ≤ MPE(T)                [both]
 *
 * @param {Object} grid - FluenceGrid (already computed)
 * @param {Object} beam - BeamParams
 * @param {number} T_s - Total exposure window in seconds
 * @param {string} dwell_mode - "gaussian" or "geometric" (for CW Rule 1)
 * @param {number} min_velocity - Minimum scan velocity in mm/s (for CW Rule 1)
 * @returns {Object} ScanSafetyResult
 */

// ── Analytical peak fluence (exact, no grid approximation) ──────
/**
 * Compute the exact peak cumulative fluence at the most-exposed point
 * using analytical Gaussian overlap summation. This is independent of
 * grid resolution and subsampling — it sums the exact Gaussian contribution
 * from every pulse (along-line) and every scan line (cross-line) that falls
 * within 3σ of the evaluation point.
 *
 * For skin safety evaluation, this serves as the authoritative fluence
 * value. The grid computation is retained for visualization only.
 *
 * Physics: For a Gaussian beam with 1/e diameter d, the peak single-pulse
 * fluence at beam center is H₀ = 2E/(πw²) where w = d/√2 is the 1/e² radius.
 * Adjacent pulses at spacing Δx = v/f contribute H₀·exp(-2Δx²/w²).
 * Adjacent scan lines at spacing Δy contribute exp(-2Δy²/w²) attenuation.
 *
 * The total peak fluence sums these contributions analytically:
 *   H_peak = H₀ × Σ_k exp(-2(kΔx)²/w²) × Σ_m exp(-2(mΔy)²/w²)
 *
 * For a CW beam, the along-line sum is replaced by the analytical integral:
 *   H_line = P × √(2/π) / (w₀ × v) [J/mm²]
 *
 * @param {Object} beam - {d_1e_mm, prf_hz, pulse_energy_J, avg_power_W, is_cw}
 * @param {number} v_mm_s - Scan velocity in mm/s
 * @param {number} line_spacing_mm - Hatch spacing (0 for single line)
 * @param {number} n_lines - Number of scan lines (1 for linear)
 * @returns {Object} {peak_fluence_Jcm2, along_sum, cross_sum, H0_Jcm2}
 */
function analyticalPeakFluence(beam, v_mm_s, line_spacing_mm, n_lines) {
  var d = beam.d_1e_mm;
  var w = d / Math.sqrt(2);        // 1/e² radius (mm)
  var sigma = d / (2 * Math.sqrt(2)); // σ (mm)
  var w2 = w * w;

  if (beam.is_cw) {
    // CW: analytical line integral H = P × √(2/π) / (w × v) [J/mm²] → ×100 for J/cm²
    var H_line = beam.avg_power_W * Math.sqrt(2 / Math.PI) / (w * v_mm_s) * 100;

    // Cross-line sum (same for CW and pulsed)
    var cross_sum_cw = 1;
    if (line_spacing_mm > 0 && n_lines > 1) {
      for (var mc = 1; mc <= n_lines; mc++) {
        var yc = mc * line_spacing_mm;
        var cc = Math.exp(-2 * yc * yc / w2);
        if (cc < 1e-12) break;
        cross_sum_cw += 2 * cc;
      }
    }
    return {
      peak_fluence_Jcm2: H_line * cross_sum_cw,
      along_sum: NaN, // CW uses integral, not sum
      cross_sum: cross_sum_cw,
      H0_Jcm2: NaN
    };
  }

  // Pulsed: exact Gaussian overlap sum
  var H0_mm2 = 2 * beam.pulse_energy_J / (Math.PI * w2);
  var H0_Jcm2 = H0_mm2 * 100;

  // Along-line sum: Σ exp(-2(kΔx)²/w²) for k = -M..M
  var pulse_spacing = v_mm_s / beam.prf_hz; // mm between consecutive pulses
  var M_along = Math.ceil(3 * sigma / pulse_spacing);
  // Cap to prevent infinite loops for extreme cases (e.g., very slow scan)
  if (M_along > 100000) M_along = 100000;
  var along_sum = 0;
  for (var k = -M_along; k <= M_along; k++) {
    var x = k * pulse_spacing;
    along_sum += Math.exp(-2 * x * x / w2);
  }

  // Cross-line sum: Σ exp(-2(mΔy)²/w²) for m = -L..L
  var cross_sum = 1; // self contribution (m=0)
  if (line_spacing_mm > 0 && n_lines > 1) {
    for (var m = 1; m <= n_lines; m++) {
      var y = m * line_spacing_mm;
      var contrib = Math.exp(-2 * y * y / w2);
      if (contrib < 1e-12) break; // negligible contribution
      cross_sum += 2 * contrib; // symmetric ±m
    }
  }

  return {
    peak_fluence_Jcm2: H0_Jcm2 * along_sum * cross_sum,
    along_sum: along_sum,
    cross_sum: cross_sum,
    H0_Jcm2: H0_Jcm2
  };
}

function evaluateScanSafety(grid, beam, T_s, dwell_mode, min_velocity, scan_params) {
  var mpe_T = skinMPE(beam.wl_nm, T_s);
  var mpe_tau, rule1_limit;

  if (beam.is_cw) {
    if (isFinite(min_velocity) && min_velocity > 0) {
      var t_dwell = (dwell_mode === "geometric") ?
        scanDwellGeometric(beam.d_1e_mm, min_velocity) :
        scanDwellGaussian(beam.d_1e_mm, min_velocity);
      mpe_tau = skinMPE(beam.wl_nm, t_dwell);
      rule1_limit = mpe_tau;
    } else {
      mpe_tau = NaN;
      rule1_limit = Infinity;
    }
  } else {
    mpe_tau = skinMPE(beam.wl_nm, beam.tau_s);
    rule1_limit = mpe_tau;
  }

  var n = grid.nx * grid.ny;
  var worstR1 = 0, worstR2 = 0;
  var worstIdx = 0, worstVal = 0;
  var peakF = 0, maxPulses = 0;

  for (var i = 0; i < n; i++) {
    if (grid.fluence[i] > peakF) peakF = grid.fluence[i];
    if (grid.pulse_count[i] > maxPulses) maxPulses = grid.pulse_count[i];

    var r1 = isFinite(rule1_limit) && rule1_limit > 0 ?
      (grid.peak_pulse_H[i] / rule1_limit) : 0;
    var r2 = isFinite(mpe_T) ? (grid.fluence[i] / mpe_T) : 0;

    if (r1 > worstR1) worstR1 = r1;
    if (r2 > worstR2) worstR2 = r2;

    var worst = r1 > r2 ? r1 : r2;
    if (worst > worstVal) {
      worstVal = worst;
      worstIdx = i;
    }
  }

  // ── Analytical cross-check (exact, no grid approximation) ──
  // If scan_params are provided, compute the analytical peak fluence
  // and use max(grid_peak, analytical_peak) for conservative safety.
  // This guarantees that grid aliasing or subsampling never causes
  // an underestimate of the true peak fluence.
  var analyticalPeak = NaN;
  var analyticalUsed = false;
  if (scan_params && scan_params.v_mm_s > 0) {
    var ap = analyticalPeakFluence(
      beam, scan_params.v_mm_s,
      scan_params.line_spacing_mm || 0,
      scan_params.n_lines || 1
    );
    analyticalPeak = ap.peak_fluence_Jcm2;

    // Use the more conservative (higher) of grid and analytical peaks
    if (isFinite(analyticalPeak) && analyticalPeak > peakF) {
      peakF = analyticalPeak;
      analyticalUsed = true;
      // Recompute Rule 2 ratio with analytical peak
      if (isFinite(mpe_T) && mpe_T > 0) {
        var analyticalR2 = analyticalPeak / mpe_T;
        if (analyticalR2 > worstR2) worstR2 = analyticalR2;
        if (analyticalR2 > worstVal) worstVal = analyticalR2;
      }
    }
  }

  // Rule 1 analytical cross-check: exact peak single-pulse fluence
  // (independent of grid — uses beam physics directly)
  if (!beam.is_cw && beam.pulse_energy_J > 0) {
    var w_r1 = beam.d_1e_mm / Math.sqrt(2);
    var H0_exact = 2 * beam.pulse_energy_J / (Math.PI * w_r1 * w_r1) * 100;
    var r1_exact = isFinite(rule1_limit) && rule1_limit > 0 ? H0_exact / rule1_limit : 0;
    if (r1_exact > worstR1) {
      worstR1 = r1_exact;
      if (r1_exact > worstVal) worstVal = r1_exact;
    }
  }

  var worstIx = worstIdx % grid.nx;
  var worstIy = (worstIdx - worstIx) / grid.nx;

  // Revisit timing statistics
  var globalMinRevisit = 1e30;
  var revisitPoints = 0;
  for (var ri = 0; ri < n; ri++) {
    if (grid.min_revisit_s[ri] < 1e29) {
      revisitPoints++;
      if (grid.min_revisit_s[ri] < globalMinRevisit)
        globalMinRevisit = grid.min_revisit_s[ri];
    }
  }
  if (globalMinRevisit >= 1e29) globalMinRevisit = Infinity;

  var kappa_skin = KAPPA_SKIN_MM2_S;
  var thermal_relax_s = (beam.d_1e_mm * beam.d_1e_mm) / (4 * kappa_skin);

  return {
    safe: worstR1 <= 1.0 && worstR2 <= 1.0,
    worst_ratio: worstVal,
    worst_x_mm: grid.x_min_mm + worstIx * grid.dx_mm,
    worst_y_mm: grid.y_min_mm + worstIy * grid.dx_mm,
    binding_rule: worstR1 >= worstR2 ? "Rule 1" : "Rule 2",
    safety_margin: 1.0 - worstVal,
    mpe_tau: mpe_tau,
    mpe_T: mpe_T,
    peak_fluence: peakF,
    peak_pulse_H_max: grid.peak_pulse_H[worstIdx],
    max_pulses: maxPulses,
    rule1_max_ratio: worstR1,
    rule2_max_ratio: worstR2,
    min_revisit_s: globalMinRevisit,
    revisit_points: revisitPoints,
    thermal_relax_s: thermal_relax_s,
    revisit_adequate: globalMinRevisit >= thermal_relax_s,
    analytical_peak: analyticalPeak,
    analytical_used: analyticalUsed
  };
}

// ── Minimum safe velocity (bisection search) ────────────────────

/**
 * Find the minimum scan velocity that keeps all points within MPE.
 *
 * Uses bisection: at each candidate velocity, rebuilds the scan path,
 * computes the fluence grid, and evaluates safety.
 *
 * @param {Object} beam - BeamParams (wl_nm, d_1e_mm, tau_s, prf_hz, avg_power_W, is_cw)
 * @param {string} pattern - "linear", "bidi", or "raster"
 * @param {Object} patParams - Pattern parameters (line_length_mm, n_lines, hatch_mm, etc.)
 * @param {number} T_s - Total exposure window in seconds (0 = use scan time)
 * @param {number} ppd - Points per diameter
 * @param {string} dwell_mode - "gaussian" or "geometric"
 * @returns {Object} { v_min, safe_at_vmin, iterations }
 */
function minSafeVelocity(beam, pattern, patParams, T_s, ppd, dwell_mode) {
  ppd = ppd || 8;
  dwell_mode = dwell_mode || "gaussian";

  function testVelocity(v) {
    var segs;
    var d = beam.d_1e_mm || beam.d;
    var jv = v * 5; // jump velocity = 5× scan velocity
    if (pattern === "linear") {
      segs = buildLinearScan(0, 0, 0, patParams.line_length_mm, v, d);
    } else if (pattern === "bidi") {
      segs = buildBidiRasterScan(0, 0, patParams.line_length_mm,
        patParams.n_lines, patParams.hatch_mm, v, jv, d);
    } else {
      segs = buildRasterScan(0, 0, patParams.line_length_mm,
        patParams.n_lines, patParams.hatch_mm, v, jv, d);
    }
    if (!segs || segs.length === 0) return { safe: true };

    var grid = createFluenceGrid(d, segs, ppd);
    var stats;
    if (beam.is_cw) {
      stats = computeScanFluenceCW(grid, d, beam.avg_power_W || beam.P, segs);
    } else {
      var Ep = beam.pulse_energy_J || beam.Ep ||
        (beam.avg_power_W || beam.P) / (beam.prf_hz || beam.prf);
      stats = computeScanFluencePulsed(grid, d, beam.prf_hz || beam.prf, Ep, segs);
    }
    var T = T_s > 0 ? T_s : stats.total_time_s;
    var mv = beam.is_cw ? (stats.min_velocity || v) : 0;
    return evaluateScanSafety(grid, beam.is_cw ?
      { wl_nm: beam.wl_nm || beam.wl, d_1e_mm: d, is_cw: true } :
      { wl_nm: beam.wl_nm || beam.wl, d_1e_mm: d, tau_s: beam.tau_s || beam.tau, is_cw: false },
      T, dwell_mode, mv);
  }

  var vLow = 0.01, vHigh = 1e6;
  var iterations = 0;

  // First check: is the problem solvable at all?
  var highTest = testVelocity(vHigh);
  if (!highTest.safe) {
    return { v_min: Infinity, safe_at_vmin: false, iterations: 0 };
  }

  // Bisect
  while ((vHigh - vLow) / vLow > 0.001 && iterations < 50) {
    var vMid = (vLow + vHigh) / 2;
    var result = testVelocity(vMid);
    if (result.safe) vHigh = vMid;
    else vLow = vMid;
    iterations++;
  }

  return { v_min: vHigh, safe_at_vmin: true, iterations: iterations };
}

// ── Closed-form inverse functions ───────────────────────────────

/**
 * Maximum permissible pulse energy from Rule 1 alone.
 * Independent of scan geometry — depends only on beam diameter,
 * wavelength, and pulse duration.
 *
 * Physics: H_pulse = 2·Ep/(π·w²) [J/mm²] × 100 [→ J/cm²]
 *          H_pulse ≤ MPE(τ)
 *          Ep ≤ MPE(τ) × π·w² / 200
 *
 * @param {number} wl_nm - Wavelength in nm
 * @param {number} d_1e_mm - 1/e beam diameter in mm
 * @param {number} tau_s - Pulse duration in seconds
 * @returns {number} Maximum pulse energy in joules
 */
function maxPulseEnergy(wl_nm, d_1e_mm, tau_s) {
  var w = d_1e_mm / Math.sqrt(2); // 1/e² radius in mm
  var mpe_tau = skinMPE(wl_nm, tau_s);
  return mpe_tau * Math.PI * w * w / 200;
}

/**
 * Minimum repetition rate from Rule 1 at a given average power.
 * Below this PRF, individual pulse energy exceeds the single-pulse MPE.
 *
 * Physics: Ep = P/PRF, H_pulse = 2P/(PRF·π·w²) × 100
 *          H_pulse ≤ MPE(τ)
 *          PRF ≥ 200·P / (π·w²·MPE(τ))
 *
 * Note: Rule 2 (cumulative) is PRF-independent at fixed power because
 * N_pulses × H_pulse = (PRF·t_dwell) × 2P/(PRF·π·w²) × 100
 *                     = 2P·t_dwell/(π·w²) × 100
 * The PRF cancels, so only Rule 1 constrains the minimum PRF.
 *
 * @param {number} wl_nm - Wavelength in nm
 * @param {number} d_1e_mm - 1/e beam diameter in mm
 * @param {number} tau_s - Pulse duration in seconds
 * @param {number} avg_power_W - Average power in watts
 * @returns {number} Minimum repetition rate in Hz
 */
function minRepRate(wl_nm, d_1e_mm, tau_s, avg_power_W) {
  var w = d_1e_mm / Math.sqrt(2);
  var mpe_tau = skinMPE(wl_nm, tau_s);
  if (mpe_tau <= 0) return Infinity;
  return 200 * avg_power_W / (Math.PI * w * w * mpe_tau);
}

// ── Scan path builders ──────────────────────────────────────────

/**
 * Build a linear (straight-line) scan path.
 * @returns {Array} ScanSegment[]
 */
function buildLinearScan(x0, y0, angle_rad, total_length_mm, v_mm_s, d_1e_mm) {
  if (!isFinite(v_mm_s) || v_mm_s <= 0) return [];
  if (!isFinite(d_1e_mm) || d_1e_mm <= 0) return [];
  if (!isFinite(total_length_mm) || total_length_mm <= 0) return [];
  var n = Math.round(total_length_mm / d_1e_mm);
  if (n < 1) n = 1;
  var cos_a = Math.cos(angle_rad), sin_a = Math.sin(angle_rad);
  var segs = [];
  for (var i = 0; i < n; i++) {
    segs.push({
      x_start_mm: x0 + i * d_1e_mm * cos_a,
      y_start_mm: y0 + i * d_1e_mm * sin_a,
      angle_rad: angle_rad,
      v_mm_s: v_mm_s
    });
  }
  return segs;
}

/**
 * Build a bidirectional raster scan path.
 * Alternating scan directions, connected by perpendicular jumps.
 * @returns {Array} ScanSegment[]
 */
function buildBidiRasterScan(x0, y0, line_length_mm, n_lines, hatch_mm,
                             scan_v_mm_s, jump_v_mm_s, d_1e_mm, blanking) {
  if (!isFinite(n_lines) || n_lines < 1) return [];
  if (!isFinite(hatch_mm) || hatch_mm <= 0) hatch_mm = d_1e_mm; // default to 1 beam width
  if (!isFinite(scan_v_mm_s) || scan_v_mm_s <= 0) return [];
  if (!isFinite(jump_v_mm_s) || jump_v_mm_s <= 0) jump_v_mm_s = scan_v_mm_s;
  var segs = [];
  for (var j = 0; j < n_lines; j++) {
    var line_y = y0 + j * hatch_mm;
    if (j % 2 === 0) {
      // Left to right
      var lineSegs = buildLinearScan(x0, line_y, 0, line_length_mm,
        scan_v_mm_s, d_1e_mm);
      for (var k = 0; k < lineSegs.length; k++) segs.push(lineSegs[k]);
    } else {
      // Right to left
      var lineSegs2 = buildLinearScan(x0 + line_length_mm, line_y, Math.PI,
        line_length_mm, scan_v_mm_s, d_1e_mm);
      for (var k2 = 0; k2 < lineSegs2.length; k2++) segs.push(lineSegs2[k2]);
    }
    // Jump to next line (if not last)
    if (j < n_lines - 1) {
      var jumpEnd_x = (j % 2 === 0) ? x0 + line_length_mm : x0;
      var jumpSegs = buildLinearScan(jumpEnd_x, line_y, Math.PI / 2,
        hatch_mm, jump_v_mm_s, d_1e_mm);
      for (var k3 = 0; k3 < jumpSegs.length; k3++) {
        var js = jumpSegs[k3];
        if (blanking) js.blanked = true;
        segs.push(js);
      }
    }
  }
  return segs;
}

/**
 * Build a unidirectional raster scan path.
 * All lines scan in the same direction; beam returns before each new line.
 * @returns {Array} ScanSegment[]
 */
function buildRasterScan(x0, y0, line_length_mm, n_lines, hatch_mm,
                         scan_v_mm_s, jump_v_mm_s, d_1e_mm, blanking) {
  if (!isFinite(n_lines) || n_lines < 1) return [];
  if (!isFinite(hatch_mm) || hatch_mm <= 0) hatch_mm = d_1e_mm;
  if (!isFinite(scan_v_mm_s) || scan_v_mm_s <= 0) return [];
  if (!isFinite(jump_v_mm_s) || jump_v_mm_s <= 0) jump_v_mm_s = scan_v_mm_s;
  var segs = [];
  for (var j = 0; j < n_lines; j++) {
    var line_y = y0 + j * hatch_mm;
    // Scan left to right
    var lineSegs = buildLinearScan(x0, line_y, 0, line_length_mm,
      scan_v_mm_s, d_1e_mm);
    for (var k = 0; k < lineSegs.length; k++) segs.push(lineSegs[k]);

    if (j < n_lines - 1) {
      // Return right to left (fast jump)
      var retSegs = buildLinearScan(x0 + line_length_mm, line_y, Math.PI,
        line_length_mm, jump_v_mm_s, d_1e_mm);
      for (var k2 = 0; k2 < retSegs.length; k2++) {
        var rs = retSegs[k2];
        if (blanking) rs.blanked = true;
        segs.push(rs);
      }
      // Step down to next line
      var stepSegs = buildLinearScan(x0, line_y, Math.PI / 2,
        hatch_mm, jump_v_mm_s, d_1e_mm);
      for (var k3 = 0; k3 < stepSegs.length; k3++) {
        var ss = stepSegs[k3];
        if (blanking) ss.blanked = true;
        segs.push(ss);
      }
    }
  }
  return segs;
}

/**
 * Build a scan path from a list of waypoints.
 * Each waypoint: { x_mm, y_mm, v_mm_s }
 * The path between consecutive waypoints is decomposed into
 * beam-diameter segments.
 * @returns {Array} ScanSegment[]
 */
function buildCustomScan(waypoints, d_1e_mm) {
  var segs = [];
  for (var i = 0; i < waypoints.length - 1; i++) {
    var wp0 = waypoints[i], wp1 = waypoints[i + 1];
    var dxx = wp1.x_mm - wp0.x_mm;
    var dyy = wp1.y_mm - wp0.y_mm;
    var dist = Math.sqrt(dxx * dxx + dyy * dyy);
    if (dist < 1e-12) continue;
    var angle = Math.atan2(dyy, dxx);
    var v = wp0.v_mm_s;

    var n_seg = Math.round(dist / d_1e_mm);
    if (n_seg < 1) n_seg = 1;
    var actual_len = dist / n_seg;
    var cos_a = Math.cos(angle), sin_a = Math.sin(angle);

    for (var k = 0; k < n_seg; k++) {
      segs.push({
        x_start_mm: wp0.x_mm + k * actual_len * cos_a,
        y_start_mm: wp0.y_mm + k * actual_len * sin_a,
        angle_rad: angle,
        v_mm_s: v
      });
    }
  }
  return segs;
}

// ── Inverse functions ───────────────────────────────────────────

/**
 * Maximum permissible average power for a given scan path.
 * Fluence scales linearly with power, so one unit-power computation
 * gives the answer directly.
 *
 * @returns {number} P_max in watts
 */
function maxPermissiblePower(beam, segments, T_s, ppd) {
  // Compute fluence with unit power
  var unitBeam = {
    d_1e_mm: beam.d_1e_mm,
    wl_nm: beam.wl_nm,
    tau_s: beam.tau_s,
    is_cw: beam.is_cw,
    prf_hz: beam.prf_hz,
    pulse_energy_J: beam.is_cw ? 0 : 1.0 / beam.prf_hz, // unit avg power
    avg_power_W: 1.0
  };

  var result = computeScanFluence(unitBeam, segments, ppd);
  if (!result) return 0;

  var mpe_T = skinMPE(beam.wl_nm, T_s);

  // Find peak fluence at unit power
  var grid = result.grid;
  var peakF = 0;
  for (var i = 0; i < grid.nx * grid.ny; i++) {
    if (grid.fluence[i] > peakF) peakF = grid.fluence[i];
  }

  // Rule 2: peakF * P ≤ mpe_T → P ≤ mpe_T / peakF
  var P_max_r2 = peakF > 0 ? mpe_T / peakF : Infinity;

  // Rule 1 (pulsed): peak single-pulse fluence = 2Ep/(πw²)×100
  // Ep = P/PRF, so H_pulse = 2P/(PRF×πw²)×100
  // H_pulse ≤ MPE(τ) → P ≤ MPE(τ) × PRF × πw² / (2×100)
  var P_max_r1 = Infinity;
  if (!beam.is_cw && beam.prf_hz > 0) {
    var w = beam.d_1e_mm / Math.sqrt(2);
    var mpe_tau = skinMPE(beam.wl_nm, beam.tau_s);
    P_max_r1 = mpe_tau * beam.prf_hz * Math.PI * w * w / (2 * 100);
  }

  return Math.min(P_max_r1, P_max_r2);
}

// ── End scanning engine ─────────────────────────────────────────
// ── Environment detection and exports ───────────────────────────
// Node.js: load JSON and export module. Browser: set window.MPEEngine.
// build.py strips the Node.js block (BUILD_STRIP_START → BUILD_STRIP_END)
// so the browser build only contains the window.MPEEngine assignment.

// BUILD_STRIP_START
if (typeof module !== "undefined" && module.exports && typeof require === "function") {
  try {
    var defaultStd = require("./standards/icnirp_2013.json");
    loadStandard(defaultStd);
  } catch(_e) { /* JSON not found — caller must use loadStandard() */ }
  module.exports = {
    // Constants
    GAUSS_TRUNCATION_SIGMA: GAUSS_TRUNCATION_SIGMA,
    KAPPA_SKIN_MM2_S: KAPPA_SKIN_MM2_S,
    MAX_GRID_CELLS: MAX_GRID_CELLS,
    DEFAULT_MAX_COMPUTE_PULSES: DEFAULT_MAX_COMPUTE_PULSES,
    OP_BUDGET: OP_BUDGET,
    MAX_VIZ_PULSES: MAX_VIZ_PULSES,
    loadStandard: loadStandard,
    getStandard: getStandard,
    getValidationErrors: getValidationErrors,
    CA: CA,
    skinMPE: skinMPE,
    repPulse: repPulse,
    bandName: bandName,
    STANDARD: getSTANDARD(),
    paEffFluence: paEffFluence,
    paRelSNR: paRelSNR,
    paOptimalPRF: paOptimalPRF,
    getAperture: getAperture,
    beamEval: beamEval,
    // Scanning engine (separable θ₃ approach)
    canUseSeparable: canUseSeparable,
    _compute1DGaussSum: _compute1DGaussSum,
    computeScanFluenceSeparable: computeScanFluenceSeparable,
    // Scanning engine (brute-force and CW)
    scanDwellGaussian: scanDwellGaussian,
    scanDwellGeometric: scanDwellGeometric,
    createFluenceGrid: createFluenceGrid,
    createFluenceGridFromParams: createFluenceGridFromParams,
    MAX_SEGMENTS: MAX_SEGMENTS,
    computeScanFluencePulsed: computeScanFluencePulsed,
    computeScanFluenceCW: computeScanFluenceCW,
    computeScanFluence: computeScanFluence,
    analyticalPeakFluence: analyticalPeakFluence,
    evaluateScanSafety: evaluateScanSafety,
    buildLinearScan: buildLinearScan,
    buildBidiRasterScan: buildBidiRasterScan,
    buildRasterScan: buildRasterScan,
    buildCustomScan: buildCustomScan,
    maxPermissiblePower: maxPermissiblePower,
    minSafeVelocity: minSafeVelocity,
    maxPulseEnergy: maxPulseEnergy,
    minRepRate: minRepRate
  };
} else
// BUILD_STRIP_END
{
  // Browser: standard data must be set via loadStandard()
  // (the HTML build script will call this with inlined JSON)
  window.MPEEngine = {
    // Constants
    GAUSS_TRUNCATION_SIGMA: GAUSS_TRUNCATION_SIGMA,
    KAPPA_SKIN_MM2_S: KAPPA_SKIN_MM2_S,
    MAX_GRID_CELLS: MAX_GRID_CELLS,
    DEFAULT_MAX_COMPUTE_PULSES: DEFAULT_MAX_COMPUTE_PULSES,
    OP_BUDGET: OP_BUDGET,
    MAX_VIZ_PULSES: MAX_VIZ_PULSES,
    loadStandard: loadStandard,
    getStandard: getStandard,
    CA: CA,
    skinMPE: skinMPE,
    repPulse: repPulse,
    bandName: bandName,
    get STANDARD() { return getSTANDARD(); },
    paEffFluence: paEffFluence,
    paRelSNR: paRelSNR,
    paOptimalPRF: paOptimalPRF,
    getAperture: getAperture,
    beamEval: beamEval,
    // Scanning engine (separable θ₃ approach)
    canUseSeparable: canUseSeparable,
    computeScanFluenceSeparable: computeScanFluenceSeparable,
    // Scanning engine (brute-force and CW)
    scanDwellGaussian: scanDwellGaussian,
    scanDwellGeometric: scanDwellGeometric,
    createFluenceGrid: createFluenceGrid,
    createFluenceGridFromParams: createFluenceGridFromParams,
    MAX_SEGMENTS: MAX_SEGMENTS,
    computeScanFluencePulsed: computeScanFluencePulsed,
    computeScanFluenceCW: computeScanFluenceCW,
    computeScanFluence: computeScanFluence,
    analyticalPeakFluence: analyticalPeakFluence,
    evaluateScanSafety: evaluateScanSafety,
    buildLinearScan: buildLinearScan,
    buildBidiRasterScan: buildBidiRasterScan,
    buildRasterScan: buildRasterScan,
    buildCustomScan: buildCustomScan,
    maxPermissiblePower: maxPermissiblePower,
    minSafeVelocity: minSafeVelocity,
    maxPulseEnergy: maxPulseEnergy,
    minRepRate: minRepRate
  };
}
