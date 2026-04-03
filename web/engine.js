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
// Auto-load default standard and export
// ═══════════════════════════════════════════════════════════════
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
    beamEval: beamEval
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
    beamEval: beamEval
  };
}
