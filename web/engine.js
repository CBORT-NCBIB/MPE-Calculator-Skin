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
  if (!ppd || ppd < 4) ppd = 4;
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
  if (nx * ny > 4000000) {
    var scale = Math.sqrt(4000000 / (nx * ny));
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

  var trunc_mm = 3 * sigma;
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
  var mcp = max_compute_pulses || 500000;
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
  var trunc_perp = 3 * sigma;
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
          if (gap > 0 && lvt[idx] > -1e29) {
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

// ── Unified fluence computation ─────────────────────────────────

/**
 * Compute fluence grid from a scan path. Dispatches to CW or pulsed.
 *
 * @param {Object} beam - { d_1e_mm, is_cw, prf_hz, pulse_energy_J, avg_power_W }
 * @param {Array} segments - ScanSegment[]
 * @param {number} ppd - Points per diameter (default 8)
 * @returns {Object} { grid, stats }
 */
function computeScanFluence(beam, segments, ppd) {
  if (!segments || segments.length === 0) return null;
  ppd = ppd || 8;
  var grid = createFluenceGrid(beam.d_1e_mm, segments, ppd);
  var stats;
  if (beam.is_cw) {
    stats = computeScanFluenceCW(grid, beam.d_1e_mm, beam.avg_power_W, segments);
    stats.total_pulses = 0;
  } else {
    stats = computeScanFluencePulsed(grid, beam.d_1e_mm, beam.prf_hz,
      beam.pulse_energy_J, segments);
  }
  return { grid: grid, stats: stats };
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
function evaluateScanSafety(grid, beam, T_s, dwell_mode, min_velocity) {
  var mpe_T = skinMPE(beam.wl_nm, T_s);
  var mpe_tau, rule1_limit;

  if (beam.is_cw) {
    // CW Rule 1: single-sweep fluence ≤ MPE(t_dwell)
    // t_dwell uses the minimum velocity (most conservative = slowest sweep)
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

  var worstIx = worstIdx % grid.nx;
  var worstIy = (worstIdx - worstIx) / grid.nx;

  // Revisit timing statistics
  var globalMinRevisit = 1e30;
  var revisitPoints = 0;
  for (var ri = 0; ri < n; ri++) {
    if (grid.min_revisit_s[ri] < 1e29) { // point was revisited at least once
      revisitPoints++;
      if (grid.min_revisit_s[ri] < globalMinRevisit)
        globalMinRevisit = grid.min_revisit_s[ri];
    }
  }
  if (globalMinRevisit >= 1e29) globalMinRevisit = Infinity;

  // Thermal relaxation time: τ_r ≈ d²/(4κ), κ ≈ 0.13 mm²/s (skin)
  var kappa_skin = 0.13; // mm²/s (middle of 0.1–0.15 range)
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
    revisit_adequate: globalMinRevisit >= thermal_relax_s
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
                             scan_v_mm_s, jump_v_mm_s, d_1e_mm) {
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
      for (var k3 = 0; k3 < jumpSegs.length; k3++) segs.push(jumpSegs[k3]);
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
                         scan_v_mm_s, jump_v_mm_s, d_1e_mm) {
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
      for (var k2 = 0; k2 < retSegs.length; k2++) segs.push(retSegs[k2]);
      // Step down to next line
      var stepSegs = buildLinearScan(x0, line_y, Math.PI / 2,
        hatch_mm, jump_v_mm_s, d_1e_mm);
      for (var k3 = 0; k3 < stepSegs.length; k3++) segs.push(stepSegs[k3]);
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
if (typeof module !== "undefined" && module.exports) {
  // Node.js: load JSON from file
  var defaultStd = require("./standards/icnirp_2013.json");
  loadStandard(defaultStd);
  module.exports = {
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
    // Scanning engine
    scanDwellGaussian: scanDwellGaussian,
    scanDwellGeometric: scanDwellGeometric,
    createFluenceGrid: createFluenceGrid,
    computeScanFluencePulsed: computeScanFluencePulsed,
    computeScanFluenceCW: computeScanFluenceCW,
    computeScanFluence: computeScanFluence,
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
} else if (typeof window !== "undefined") {
  // Browser: standard data must be set via loadStandard()
  // (the HTML build script will call this with inlined JSON)
  window.MPEEngine = {
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
    // Scanning engine
    scanDwellGaussian: scanDwellGaussian,
    scanDwellGeometric: scanDwellGeometric,
    createFluenceGrid: createFluenceGrid,
    computeScanFluencePulsed: computeScanFluencePulsed,
    computeScanFluenceCW: computeScanFluenceCW,
    computeScanFluence: computeScanFluence,
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
