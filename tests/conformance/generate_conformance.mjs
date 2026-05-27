#!/usr/bin/env node
/**
 * generate_conformance.mjs — Builds the cross-language conformance corpus.
 *
 * Runs the JS engine on a comprehensive set of inputs and writes
 * the results as JSON. Both the JS and Python test harnesses read
 * this corpus and verify their outputs match.
 *
 * Coverage targets:
 *   - Every wavelength band (6 bands)
 *   - Every formula type (constant, power, linear, ca_*, discrete, power_offset)
 *   - Every CA region (constant, power10, default)
 *   - UV dual-limit (thermal binding, photochemical binding, both finite)
 *   - UV discrete lookup
 *   - Band boundaries (exact wavelength transitions)
 *   - Region boundaries (exact duration transitions)
 *   - Repetitive pulse (Rule 1 binding, Rule 2 binding, N<=1)
 *   - Edge cases (extreme wavelengths, extreme durations, out-of-range)
 */
import { createRequire } from "module";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const e = require(resolve(repoRoot, "web/engine.js"));
const std = require(resolve(repoRoot, "web/standards/icnirp_2013.json"));

var corpus = [];
var id = 0;
var seen = new Set();

function add(desc, fn, inputs, tolerance) {
  // Deduplicate: skip if we already have this exact function + inputs combination
  var sig = fn + ":" + JSON.stringify(inputs);
  if (seen.has(sig)) return;
  seen.add(sig);

  var result;
  if (fn === "skin_mpe") {
    result = e.skinMPE(inputs.wl_nm, inputs.t_s);
  } else if (fn === "ca") {
    result = e.CA(inputs.wl_nm);
  } else if (fn === "rep_pulse") {
    var rp = e.repPulse(inputs.wl_nm, inputs.tau_s, inputs.prf_hz, inputs.T_s);
    result = { rule1: rp.rule1, rule2: rp.rule2, H: rp.H, N: rp.N, binding: rp.binding };
  }
  corpus.push({
    id: "C" + String(id++).padStart(3, "0"),
    description: desc,
    function: fn,
    inputs: inputs,
    expected: result,
    tolerance: tolerance || 1e-9
  });
}

// ═══════════════════════════════════════════════════════════════
// C_A Correction Factor
// ═══════════════════════════════════════════════════════════════
add("CA: below 400nm (outside range)", "ca", {wl_nm: 300}, 0);
add("CA: 400nm (constant region start)", "ca", {wl_nm: 400}, 0);
add("CA: 500nm (constant region mid)", "ca", {wl_nm: 500}, 0);
add("CA: 699nm (constant region end)", "ca", {wl_nm: 699}, 0);
add("CA: 700nm (boundary constant/power10)", "ca", {wl_nm: 700}, 0);
add("CA: 700.001nm (just inside power10)", "ca", {wl_nm: 700.001});
add("CA: 800nm (power10 mid)", "ca", {wl_nm: 800});
add("CA: 1050nm (power10 boundary)", "ca", {wl_nm: 1050});
add("CA: 1050.001nm (just inside last CA region)", "ca", {wl_nm: 1050.001});
add("CA: 1200nm (last region)", "ca", {wl_nm: 1200});
add("CA: 1400nm (last region upper bound)", "ca", {wl_nm: 1400});
add("CA: 1500nm (outside range, above)", "ca", {wl_nm: 1500}, 0);
add("CA: 200nm (outside range, below)", "ca", {wl_nm: 200}, 0);

// ═══════════════════════════════════════════════════════════════
// Band 0: UV 180-400nm (dual_limit)
// ═══════════════════════════════════════════════════════════════
// Thermal regions
add("UV thermal: 250nm, 1ns", "skin_mpe", {wl_nm: 250, t_s: 1e-9});
add("UV thermal: 250nm, 1us", "skin_mpe", {wl_nm: 250, t_s: 1e-6});
add("UV thermal: 250nm, 1ms", "skin_mpe", {wl_nm: 250, t_s: 1e-3});
add("UV thermal: 250nm, 1s", "skin_mpe", {wl_nm: 250, t_s: 1});
add("UV thermal: 250nm, 100s", "skin_mpe", {wl_nm: 250, t_s: 100});
add("UV thermal: 250nm, 30000s", "skin_mpe", {wl_nm: 250, t_s: 30000});
// Photochemical binding cases
add("UV photochem: 300nm, 100s", "skin_mpe", {wl_nm: 300, t_s: 100});
add("UV photochem: 305nm, 100s (discrete)", "skin_mpe", {wl_nm: 305, t_s: 100});
add("UV photochem: 310nm, 100s", "skin_mpe", {wl_nm: 310, t_s: 100});
add("UV photochem: 315nm, 100s", "skin_mpe", {wl_nm: 315, t_s: 100});
// Photochemical not_applicable (t < 10s)
add("UV dual: 320nm, 1s (photochem N/A)", "skin_mpe", {wl_nm: 320, t_s: 1});
add("UV dual: 350nm, 0.1s", "skin_mpe", {wl_nm: 350, t_s: 0.1});
add("UV dual: 390nm, 0.001s", "skin_mpe", {wl_nm: 390, t_s: 0.001});
// UV boundary
add("UV boundary: 180nm, 1s", "skin_mpe", {wl_nm: 180, t_s: 1});
add("UV boundary: 399nm, 1s", "skin_mpe", {wl_nm: 399, t_s: 1});

// ═══════════════════════════════════════════════════════════════
// Band 1: Visible/Near-IR 400-1400nm (single, ca_*)
// ═══════════════════════════════════════════════════════════════
add("Vis/NIR: 400nm, 1ns (ca_constant)", "skin_mpe", {wl_nm: 400, t_s: 1e-9});
add("Vis/NIR: 532nm, 1ns", "skin_mpe", {wl_nm: 532, t_s: 1e-9});
add("Vis/NIR: 532nm, 100ns (ca_power)", "skin_mpe", {wl_nm: 532, t_s: 1e-7});
add("Vis/NIR: 532nm, 1us", "skin_mpe", {wl_nm: 532, t_s: 1e-6});
add("Vis/NIR: 532nm, 1ms", "skin_mpe", {wl_nm: 532, t_s: 1e-3});
add("Vis/NIR: 532nm, 1s", "skin_mpe", {wl_nm: 532, t_s: 1});
add("Vis/NIR: 532nm, 10s (ca_linear)", "skin_mpe", {wl_nm: 532, t_s: 10});
add("Vis/NIR: 532nm, 100s", "skin_mpe", {wl_nm: 532, t_s: 100});
// CA-corrected (800nm, CA > 1)
add("Vis/NIR: 800nm, 1ns (ca_constant, CA>1)", "skin_mpe", {wl_nm: 800, t_s: 1e-9});
add("Vis/NIR: 800nm, 1us (ca_power, CA>1)", "skin_mpe", {wl_nm: 800, t_s: 1e-6});
add("Vis/NIR: 800nm, 1s (ca_power, CA>1)", "skin_mpe", {wl_nm: 800, t_s: 1});
add("Vis/NIR: 800nm, 10s (ca_linear, CA>1)", "skin_mpe", {wl_nm: 800, t_s: 10});
// 1064nm (near-IR)
add("Vis/NIR: 1064nm, 1e-8s", "skin_mpe", {wl_nm: 1064, t_s: 1e-8});
add("Vis/NIR: 1064nm, 1s", "skin_mpe", {wl_nm: 1064, t_s: 1});
add("Vis/NIR: 1064nm, 100s", "skin_mpe", {wl_nm: 1064, t_s: 100});
// 1310nm
add("Vis/NIR: 1310nm, 0.005s", "skin_mpe", {wl_nm: 1310, t_s: 0.005});
add("Vis/NIR: 1310nm, 10s", "skin_mpe", {wl_nm: 1310, t_s: 10});

// ═══════════════════════════════════════════════════════════════
// Band 2: FIR 1400-1500nm
// ═══════════════════════════════════════════════════════════════
add("FIR 1400-1500: 1400nm, 1ns", "skin_mpe", {wl_nm: 1400, t_s: 1e-9});
add("FIR 1400-1500: 1450nm, 1us", "skin_mpe", {wl_nm: 1450, t_s: 1e-6});
add("FIR 1400-1500: 1450nm, 1ms", "skin_mpe", {wl_nm: 1450, t_s: 1e-3});
add("FIR 1400-1500: 1450nm, 1s", "skin_mpe", {wl_nm: 1450, t_s: 1});
add("FIR 1400-1500: 1450nm, 10s", "skin_mpe", {wl_nm: 1450, t_s: 10});

// ═══════════════════════════════════════════════════════════════
// Band 3: FIR 1500-1800nm
// ═══════════════════════════════════════════════════════════════
add("FIR 1500-1800: 1550nm, 1ns", "skin_mpe", {wl_nm: 1550, t_s: 1e-9});
add("FIR 1500-1800: 1550nm, 1us", "skin_mpe", {wl_nm: 1550, t_s: 1e-6});
add("FIR 1500-1800: 1550nm, 1ms", "skin_mpe", {wl_nm: 1550, t_s: 1e-3});
add("FIR 1500-1800: 1550nm, 1s", "skin_mpe", {wl_nm: 1550, t_s: 1});
add("FIR 1500-1800: 1550nm, 10s", "skin_mpe", {wl_nm: 1550, t_s: 10});

// ═══════════════════════════════════════════════════════════════
// Band 4: FIR 1800-2600nm
// ═══════════════════════════════════════════════════════════════
add("FIR 1800-2600: 2000nm, 1ns", "skin_mpe", {wl_nm: 2000, t_s: 1e-9});
add("FIR 1800-2600: 2000nm, 1us", "skin_mpe", {wl_nm: 2000, t_s: 1e-6});
add("FIR 1800-2600: 2000nm, 1ms", "skin_mpe", {wl_nm: 2000, t_s: 1e-3});
add("FIR 1800-2600: 2000nm, 0.005s", "skin_mpe", {wl_nm: 2000, t_s: 0.005});
add("FIR 1800-2600: 2000nm, 1s", "skin_mpe", {wl_nm: 2000, t_s: 1});
add("FIR 1800-2600: 2000nm, 10s", "skin_mpe", {wl_nm: 2000, t_s: 10});
add("FIR 1800-2600: 2000nm, 100s", "skin_mpe", {wl_nm: 2000, t_s: 100});

// ═══════════════════════════════════════════════════════════════
// Band 5: FIR 2600-1e6nm
// ═══════════════════════════════════════════════════════════════
add("FIR 2600+: 3000nm, 1ns", "skin_mpe", {wl_nm: 3000, t_s: 1e-9});
add("FIR 2600+: 3000nm, 1us", "skin_mpe", {wl_nm: 3000, t_s: 1e-6});
add("FIR 2600+: 3000nm, 1ms", "skin_mpe", {wl_nm: 3000, t_s: 1e-3});
add("FIR 2600+: 3000nm, 1s", "skin_mpe", {wl_nm: 3000, t_s: 1});
add("FIR 2600+: 3000nm, 10s", "skin_mpe", {wl_nm: 3000, t_s: 10});
add("FIR 2600+: 10600nm (CO2), 0.1s", "skin_mpe", {wl_nm: 10600, t_s: 0.1});
add("FIR 2600+: 100000nm, 1s", "skin_mpe", {wl_nm: 100000, t_s: 1});
add("FIR 2600+: 1000000nm (last band upper bound), 10s", "skin_mpe", {wl_nm: 1000000, t_s: 10});

// ═══════════════════════════════════════════════════════════════
// Band boundaries (exact wavelength transitions)
// ═══════════════════════════════════════════════════════════════
add("Boundary: 399nm → UV", "skin_mpe", {wl_nm: 399, t_s: 1});
add("Boundary: 400nm → Vis/NIR", "skin_mpe", {wl_nm: 400, t_s: 1});
add("Boundary: 1399nm → Vis/NIR", "skin_mpe", {wl_nm: 1399, t_s: 1});
add("Boundary: 1400nm → FIR 1400-1500", "skin_mpe", {wl_nm: 1400, t_s: 1});
add("Boundary: 1499nm → FIR 1400-1500", "skin_mpe", {wl_nm: 1499, t_s: 1});
add("Boundary: 1500nm → FIR 1500-1800", "skin_mpe", {wl_nm: 1500, t_s: 1});
add("Boundary: 1799nm → FIR 1500-1800", "skin_mpe", {wl_nm: 1799, t_s: 1});
add("Boundary: 1800nm → FIR 1800-2600", "skin_mpe", {wl_nm: 1800, t_s: 1});
add("Boundary: 2599nm → FIR 1800-2600", "skin_mpe", {wl_nm: 2599, t_s: 1});
add("Boundary: 2600nm → FIR 2600+", "skin_mpe", {wl_nm: 2600, t_s: 1});

// ═══════════════════════════════════════════════════════════════
// Duration region boundaries
// ═══════════════════════════════════════════════════════════════
add("Region boundary: 1064nm, t=1e-9 (region 0 start)", "skin_mpe", {wl_nm: 1064, t_s: 1e-9});
add("Region boundary: 1064nm, t=1e-7 (region 0/1 boundary)", "skin_mpe", {wl_nm: 1064, t_s: 1e-7});
add("Region boundary: 1064nm, t=10 (region 1/2 boundary)", "skin_mpe", {wl_nm: 1064, t_s: 10});
add("Region boundary: 2000nm, t=1e-9", "skin_mpe", {wl_nm: 2000, t_s: 1e-9});
add("Region boundary: 2000nm, t=1e-3 (region 0/1 boundary)", "skin_mpe", {wl_nm: 2000, t_s: 1e-3});
add("Region boundary: 2000nm, t=10 (region 1/2 boundary)", "skin_mpe", {wl_nm: 2000, t_s: 10});

// ═══════════════════════════════════════════════════════════════
// Repetitive pulse
// ═══════════════════════════════════════════════════════════════
// Rule 2 binding (high PRF)
add("RepPulse: 1064nm, 10ns, 100kHz, 1s (Rule 2 binding)", "rep_pulse",
  {wl_nm: 1064, tau_s: 1e-8, prf_hz: 100000, T_s: 1});
// Rule 1 binding (low PRF)
add("RepPulse: 1064nm, 10ns, 10Hz, 1s (Rule 1 binding)", "rep_pulse",
  {wl_nm: 1064, tau_s: 1e-8, prf_hz: 10, T_s: 1});
// N <= 1 (single pulse)
add("RepPulse: 1064nm, 10ns, 0.5Hz, 1s (N<1)", "rep_pulse",
  {wl_nm: 1064, tau_s: 1e-8, prf_hz: 0.5, T_s: 1});
// Visible wavelength
add("RepPulse: 532nm, 1ns, 10kHz, 0.5s", "rep_pulse",
  {wl_nm: 532, tau_s: 1e-9, prf_hz: 10000, T_s: 0.5});
// FIR wavelength
add("RepPulse: 2000nm, 10ns, 200kHz, 1s", "rep_pulse",
  {wl_nm: 2000, tau_s: 1e-8, prf_hz: 200000, T_s: 1});
// Short exposure
add("RepPulse: 1310nm, 10ns, 200kHz, 0.01s", "rep_pulse",
  {wl_nm: 1310, tau_s: 1e-8, prf_hz: 200000, T_s: 0.01});
// UV
add("RepPulse: 355nm, 10ns, 1kHz, 10s", "rep_pulse",
  {wl_nm: 355, tau_s: 1e-8, prf_hz: 1000, T_s: 10});

// ═══════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════
add("Edge: 179nm (below range)", "skin_mpe", {wl_nm: 179, t_s: 1});
add("Edge: 1000001nm (above range)", "skin_mpe", {wl_nm: 1000001, t_s: 1});
add("Edge: 532nm, t=1e-10 (below min duration)", "skin_mpe", {wl_nm: 532, t_s: 1e-10});
add("Edge: 532nm, t=31000s (above max duration)", "skin_mpe", {wl_nm: 532, t_s: 31000});

// Additional coverage: mid-band values for every region
add("Mid-band: 600nm, 50ns", "skin_mpe", {wl_nm: 600, t_s: 50e-9});
add("Mid-band: 900nm, 5s", "skin_mpe", {wl_nm: 900, t_s: 5});
add("Mid-band: 1100nm, 0.5s", "skin_mpe", {wl_nm: 1100, t_s: 0.5});
add("Mid-band: 1300nm, 5000s", "skin_mpe", {wl_nm: 1300, t_s: 5000});
add("Mid-band: 3500nm, 0.01s", "skin_mpe", {wl_nm: 3500, t_s: 0.01});
add("Mid-band: 50000nm, 100s", "skin_mpe", {wl_nm: 50000, t_s: 100});
add("Mid-band: 1064nm, 0.1s", "skin_mpe", {wl_nm: 1064, t_s: 0.1});
add("Mid-band: 2000nm, 0.05s", "skin_mpe", {wl_nm: 2000, t_s: 0.05});

// ═══════════════════════════════════════════════════════════════
// Write corpus
// ═══════════════════════════════════════════════════════════════
var output = {
  generated_by: "generate_conformance.mjs",
  generated_at: new Date().toISOString(),
  engine_version: "mpe-engine-js",
  standard: "icnirp_2013.json",
  tolerance_note: "Relative tolerance. Use 0 for exact match (integer or known-constant results).",
  count: corpus.length,
  cases: corpus
};

var json = JSON.stringify(output, null, 2);
writeFileSync(resolve(repoRoot, "tests/conformance/corpus.json"), json);
console.log("Generated " + corpus.length + " conformance cases");
console.log("Written to tests/conformance/corpus.json");

// Verify no NaN in expected values (except for edge cases)
var nanCount = 0;
for (var c of corpus) {
  if (c.function === "skin_mpe" && isNaN(c.expected)) nanCount++;
  if (c.function === "ca" && isNaN(c.expected)) { console.log("WARNING: NaN CA at " + c.id); }
  if (c.function === "rep_pulse" && isNaN(c.expected.H)) nanCount++;
}
console.log("NaN results: " + nanCount + " (expected for out-of-range edge cases)");
