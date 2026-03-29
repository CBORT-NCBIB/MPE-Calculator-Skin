/**
 * ICNIRP 2013 Skin MPE Calculation Engine
 * =========================================
 * Health Phys. 105(3):271-295, Tables 3, 5, 7
 *
 * TO ADAPT FOR OTHER STANDARDS:
 * ---------------------------------------------------------------
 * 1. Modify the piecewise functions below to match your standard's tables.
 * 2. The UI (calculator.jsx / index.html) imports from this file and will
 *    automatically reflect your changes.
 * 3. The function signatures and return types must stay the same:
 *    - All MPE functions return radiant exposure H in J/cm².
 *    - bandName() returns a human-readable string.
 *    - CA() returns the dimensionless correction factor.
 *
 * UNIT CONVENTION:
 *   Wavelength inputs: nanometers (nm)
 *   Duration inputs:   seconds (s)
 *   MPE outputs:       J/cm²  (radiant exposure)
 *   Irradiance:        computed by caller as MPE / duration
 *
 * Python equivalent: src/laser_mpe/icnirp_skin.py
 */

// ═══════════════════════════════════════════════════════════════
// Table 3: Correction factor C_A (visible and near-infrared)
// Python equivalent: correction_factors.py → CA_visible_NIR()
// ═══════════════════════════════════════════════════════════════
function CA(wl_nm) {
  var wu = wl_nm / 1000;
  if (wu < 0.7) return 1;
  if (wu < 1.05) return Math.pow(10, 2 * (wu - 0.7));
  if (wu <= 1.4) return 5;
  return 1;
}

// ═══════════════════════════════════════════════════════════════
// Table 5: UV thermal limit (180-400 nm)
// "Also not to exceed": 5.6 t^0.25 kJ/m² = 0.56 t^0.25 J/cm²
// ═══════════════════════════════════════════════════════════════
function uvThermal(t) {
  if (t < 1e-9 || t >= 10) return NaN;
  return 0.56 * Math.pow(t, 0.25);
}

// ═══════════════════════════════════════════════════════════════
// Table 5: UV photochemical limit (180-400 nm)
// 180-302 nm: 30 J/m² = 3e-3 J/cm²
// 302-315 nm: discrete 1-nm steps
// 315-400 nm: 10 kJ/m² = 1.0 J/cm² (t >= 10 s)
// ═══════════════════════════════════════════════════════════════
function uvPhotochem(wl_nm, t) {
  var wu = wl_nm / 1000;
  if (wu >= 0.18 && wu < 0.302) {
    if (t < 1e-9 || t >= 3e4) return NaN;
    return 3e-3;
  }
  if (wu >= 0.302 && wu < 0.315) {
    if (t < 1e-9 || t >= 3e4) return NaN;
    var nm = wl_nm;
    // ICNIRP 2013 Table 5 discrete steps (J/m² → J/cm²)
    var steps = [
      [303, 4e-3],   // 40 J/m²
      [304, 6e-3],   // 60 J/m²
      [305, 1e-2],   // 100 J/m²
      [306, 1.6e-2], // 160 J/m²
      [307, 2.5e-2], // 250 J/m²
      [308, 4e-2],   // 400 J/m²
      [309, 6.3e-2], // 630 J/m²
      [310, 1e-1],   // 1.0 kJ/m²
      [311, 1.6e-1], // 1.6 kJ/m²
      [312, 2.5e-1], // 2.5 kJ/m²
      [313, 4e-1]    // 4.0 kJ/m²
    ];
    for (var i = 0; i < steps.length; i++) {
      if (nm < steps[i][0]) return steps[i][1];
    }
    return 6.3e-1; // 313-315 nm: 6.3 kJ/m²
  }
  if (wu >= 0.315 && wu < 0.4) {
    if (t < 10) return Infinity; // photochem not defined below 10 s
    if (t >= 3e4) return NaN;
    return 1.0; // 10 kJ/m²
  }
  return NaN;
}

// ═══════════════════════════════════════════════════════════════
// UV combined: min(thermal, photochemical)
// ═══════════════════════════════════════════════════════════════
function uvSkin(wl_nm, t) {
  var th = uvThermal(t);
  var pc = uvPhotochem(wl_nm, t);
  var a = isFinite(th), b = isFinite(pc);
  if (a && b) return Math.min(th, pc);
  if (a) return th;
  if (b) return pc;
  return NaN;
}

// ═══════════════════════════════════════════════════════════════
// Table 7: Visible/NIR skin (400-1400 nm)
//   1 ns  - 100 ns:  200 C_A J/m²       = 0.02 C_A J/cm²
//   100 ns - 10 s:   11 C_A t^0.25 kJ/m² = 1.1 C_A t^0.25 J/cm²
//   10 s  - 30 ks:   2.0 C_A kW/m²      = 0.2 C_A W/cm² → H = 0.2 C_A t
// ═══════════════════════════════════════════════════════════════
function visSkin(wl_nm, t) {
  var ca = CA(wl_nm);
  if (t < 1e-9 || t >= 3e4) return NaN;
  if (t < 1e-7) return 2 * ca * 0.01;
  if (t < 10) return 1.1 * ca * Math.pow(t, 0.25);
  return 0.2 * ca * t;
}

// ═══════════════════════════════════════════════════════════════
// Table 5: FIR sub-bands (1400 nm – 1 mm)
// ═══════════════════════════════════════════════════════════════

// 1400-1500 nm
function fir1400(t) {
  if (t < 1e-9 || t >= 3e4) return NaN;
  if (t < 1e-3) return 0.1;           // 1 kJ/m²
  if (t < 10) return 0.56 * Math.pow(t, 0.25); // 5.6 t^0.25 kJ/m²
  return 0.1 * t;                      // 1.0 kW/m²
}

// 1500-1800 nm
function fir1500(t) {
  if (t < 1e-9 || t >= 3e4) return NaN;
  if (t < 10) return 1.0;             // 10 kJ/m²
  return 0.1 * t;                      // 1.0 kW/m²
}

// 1800-2600 nm
function fir1800(t) {
  if (t < 1e-9 || t >= 3e4) return NaN;
  if (t < 1e-3) return 0.1;           // 1.0 kJ/m²
  if (t < 10) return 0.56 * Math.pow(t, 0.25); // 5.6 t^0.25 kJ/m²
  return 0.1 * t;                      // 1.0 kW/m²
}

// 2600 nm - 1 mm
function fir2600(t) {
  if (t < 1e-9 || t >= 3e4) return NaN;
  if (t < 1e-7) return 0.01;          // 100 J/m²
  if (t < 10) return 0.56 * Math.pow(t, 0.25); // 5.6 t^0.25 kJ/m²
  return 0.1 * t;                      // 1.0 kW/m²
}

// ═══════════════════════════════════════════════════════════════
// Main dispatcher: skin MPE for any wavelength
// Python equivalent: icnirp_skin.py → H_skin_ICNIRP_MPE()
// ═══════════════════════════════════════════════════════════════
function skinMPE(wl_nm, t) {
  var w = wl_nm / 1000; // convert to µm
  if (w >= 0.18 && w < 0.4)  return uvSkin(wl_nm, t);
  if (w >= 0.4  && w < 1.4)  return visSkin(wl_nm, t);
  if (w >= 1.4  && w < 1.5)  return fir1400(t);
  if (w >= 1.5  && w < 1.8)  return fir1500(t);
  if (w >= 1.8  && w < 2.6)  return fir1800(t);
  if (w >= 2.6  && w <= 1e6) return fir2600(t);
  return NaN;
}

// ═══════════════════════════════════════════════════════════════
// Repetitive pulse: Rules 1 and 2 (skin only, no Rule 3)
// Python equivalent: repetitive_pulse.py → per_pulse_MPE()
//
// Returns: { rule1: H_single, rule2: H_total/N, H: min(rule1,rule2),
//            N: pulse_count, binding: "Rule 1"|"Rule 2" }
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
// Band classification
// ═══════════════════════════════════════════════════════════════
function bandName(wl_nm) {
  if (wl_nm < 400) return "Ultraviolet";
  if (wl_nm < 700) return "Visible";
  if (wl_nm < 1400) return "Near IR";
  return "Far IR";
}

// ═══════════════════════════════════════════════════════════════
// Standard metadata (for UI display)
// ═══════════════════════════════════════════════════════════════
var STANDARD = {
  name: "ICNIRP 2013",
  reference: "Health Phys. 105(3):271\u2013295",
  tables: "Tables 3, 5, 7",
  wlRange: [180, 1000000], // nm
  durRange: [1e-9, 30000], // s
  bands: [
    { name: "UV",  start: 180,  end: 400,  color: "#a78bfa" },
    { name: "VIS", start: 400,  end: 700,  color: "#4ade80" },
    { name: "NIR", start: 700,  end: 1400, color: "#f87171" },
    { name: "FIR", start: 1400, end: 1000000, color: "#94a3b8" }
  ]
};

// ═══════════════════════════════════════════════════════════════
// Photoacoustic SNR Optimizer
// Based on: Francis et al., "Optimization of light source
// parameters for photoacoustic imaging," JPhys Photonics (2026)
//
// These functions compute safety-constrained SNR for
// photoacoustic systems operating at the ICNIRP skin MPE limit.
// ═══════════════════════════════════════════════════════════════

/**
 * Effective per-pulse fluence limit (Eq. 9 of Francis et al.)
 *
 * @param {number} wl_nm  - Wavelength in nm
 * @param {number} tau    - Pulse duration in seconds
 * @param {number} f      - Pulse repetition frequency in Hz
 * @param {number} T      - Total exposure time in seconds
 * @returns {number} Per-pulse fluence limit in J/cm²
 */
function paEffFluence(wl_nm, tau, f, T) {
  var rule1 = skinMPE(wl_nm, tau);  // Single-pulse limit
  var hT = skinMPE(wl_nm, T);      // Total exposure limit
  if (!isFinite(rule1) || !isFinite(hT)) return NaN;
  var N = f * T;
  if (N < 1) N = 1;
  var rule2 = hT / N;              // Average-power limit per pulse
  return Math.min(rule1, rule2);
}

/**
 * Relative SNR for N averaged pulses at the MPE limit (Eq. 10)
 * Normalized so SNR = 1 when N = 1 (single pulse).
 *
 * SNR_N = Φ_eff(f,T) · √(fT) / Φ_single
 *
 * @param {number} wl_nm  - Wavelength in nm
 * @param {number} tau    - Pulse duration in seconds
 * @param {number} f      - Pulse repetition frequency in Hz
 * @param {number} T      - Total exposure time in seconds
 * @returns {number} Relative SNR (dimensionless, 1 = single pulse)
 */
function paRelSNR(wl_nm, tau, f, T) {
  var phi_single = skinMPE(wl_nm, tau);
  if (!isFinite(phi_single) || phi_single <= 0) return NaN;
  var phi_eff = paEffFluence(wl_nm, tau, f, T);
  if (!isFinite(phi_eff) || phi_eff <= 0) return NaN;
  var N = f * T;
  if (N < 1) N = 1;
  return (phi_eff * Math.sqrt(N)) / phi_single;
}

/**
 * Optimal PRF — the repetition frequency where Rule 1 = Rule 2,
 * yielding maximum SNR for a given exposure time.
 *
 * f_opt = H_MPE(λ, T) / (H_MPE(λ, τ) · T)
 *
 * @param {number} wl_nm  - Wavelength in nm
 * @param {number} tau    - Pulse duration in seconds
 * @param {number} T      - Total exposure time in seconds
 * @returns {number} Optimal PRF in Hz
 */
function paOptimalPRF(wl_nm, tau, T) {
  var h_single = skinMPE(wl_nm, tau);
  var h_total = skinMPE(wl_nm, T);
  if (!isFinite(h_single) || !isFinite(h_total) || h_single <= 0 || T <= 0) return NaN;
  return h_total / (h_single * T);
}

// ═══════════════════════════════════════════════════════════════
// Exports (both ES module and global)
// ═══════════════════════════════════════════════════════════════
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CA: CA, skinMPE: skinMPE, repPulse: repPulse, bandName: bandName, STANDARD: STANDARD, paEffFluence: paEffFluence, paRelSNR: paRelSNR, paOptimalPRF: paOptimalPRF };
} else if (typeof window !== "undefined") {
  window.MPEEngine = { CA: CA, skinMPE: skinMPE, repPulse: repPulse, bandName: bandName, STANDARD: STANDARD, paEffFluence: paEffFluence, paRelSNR: paRelSNR, paOptimalPRF: paOptimalPRF };
}
