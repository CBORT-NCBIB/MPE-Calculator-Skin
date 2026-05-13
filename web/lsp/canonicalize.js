/* ════════════════════════════════════════════════════════════════════════════
 * web/lsp/canonicalize.js — LSP-JSON to engine bridge
 *
 * Given a validated LSP-JSON document, produces the inputs that the existing
 * engine consumes: a `beam` object (BeamParams), an `engineSegments` array
 * (EngineSegment[]), and an optional `scanParams` object that triggers the
 * separable-Gaussian fast path inside computeScanFluence.
 *
 * Three routing modes:
 *
 *   1. PARAMETERIZED-LEGACY-PRESET. When the document's
 *      pattern.authoritative === "parameterized" and the parameterized shape
 *      is one of the three legacy presets (linear, raster, bidi_raster), the
 *      canonicalization pipeline uses the engine's native scan-builder
 *      directly and also constructs a scanParams object so the engine takes
 *      the separable fast path. This preserves the bit-identical numerical
 *      behavior of the current direct-from-UI path.
 *
 *   2. EXPLICIT-SEGMENTS. When the document is in segments form (or hybrid
 *      with authoritative=segments), each LSP segment is translated into one
 *      or more engine segments by chopping it into pieces of length
 *      beam_diameter_mm. The chopping mirrors how the engine internally
 *      builds segments for fluence superposition (one beam-diameter per
 *      segment).
 *
 *   3. SAMPLES. When the document is in samples form, each consecutive pair
 *      of samples becomes a tiny engine segment whose velocity is the chord
 *      length divided by the sample interval. This matches the chord-length
 *      approximation already used by the engine for non-separable inputs.
 *
 * The pipeline is pure (no side effects, no IO), Node.js compatible (for
 * tests), and browser compatible.
 *
 * Public API:
 *
 *   LSPCanonicalize.canonicalize(doc, options)
 *     → { ok, beam, engineSegments, scanParams, totalTime_s, errors }
 *
 *   doc      : validated LSP-JSON document (must have passed LSPValidate)
 *   options  :
 *     engine            : engine module (default: global MPEEngine if available)
 *     maxEngineSegments : segment cap (default 1_000_000)
 *
 *   Returns:
 *     ok              : boolean
 *     beam            : BeamParams ready for computeScanFluence
 *     engineSegments  : array of {x_start_mm, y_start_mm, angle_rad, v_mm_s, blanked?}
 *     scanParams      : null OR a ScanParams object triggering the fast path
 *     totalTime_s     : total integrated time across all segments (s)
 *     errors          : array of {code, path, message} on failure
 *
 * Error codes (in addition to those raised by validate.js):
 *
 *   ENGINE_NOT_LOADED         The engine module could not be resolved.
 *   UNSUPPORTED_SHAPE         A parameterized shape outside the legacy three.
 *   UNSUPPORTED_REPRESENTATION  Empty/null pattern body.
 *   SEGMENT_OVERFLOW          The translated engine-segment list exceeds the cap.
 *   ARC_NOT_SUPPORTED         An arc segment was found (deferred to Phase 2.5).
 *   UNIT_NOT_SUPPORTED        Units other than mm/W reached this stage.
 *
 * The canonicalization module never throws on bad input; every error is
 * returned in the structured errors array.
 * ════════════════════════════════════════════════════════════════════════════
 */

(function (root) {
  "use strict";

  // ─── Constants ───────────────────────────────────────────────────────────

  var DEFAULT_OPTIONS = {
    maxEngineSegments: 1000000
  };

  var ERROR_CODES = {
    ENGINE_NOT_LOADED: "ENGINE_NOT_LOADED",
    UNSUPPORTED_SHAPE: "UNSUPPORTED_SHAPE",
    UNSUPPORTED_REPRESENTATION: "UNSUPPORTED_REPRESENTATION",
    SEGMENT_OVERFLOW: "SEGMENT_OVERFLOW",
    ARC_NOT_SUPPORTED: "ARC_NOT_SUPPORTED",
    UNIT_NOT_SUPPORTED: "UNIT_NOT_SUPPORTED",
    DEGENERATE_GEOMETRY: "DEGENERATE_GEOMETRY",
    PER_SEGMENT_POWER_UNSUPPORTED: "PER_SEGMENT_POWER_UNSUPPORTED",
    AUTHORITATIVE_PARAMETERIZED_EMPTY: "AUTHORITATIVE_PARAMETERIZED_EMPTY",
    INTERNAL_ERROR: "INTERNAL_ERROR"
  };

  var LEGACY_PRESETS = {
    linear: "linear",
    raster: "raster",
    bidi_raster: "bidi"  // engine name is "bidi", LSP name is "bidi_raster"
  };

  // ─── Engine resolution ───────────────────────────────────────────────────

  function _resolveEngine(explicit) {
    if (explicit && typeof explicit.buildLinearScan === "function") return explicit;
    if (typeof root !== "undefined" && root.MPEEngine &&
        typeof root.MPEEngine.buildLinearScan === "function") return root.MPEEngine;
    return null;
  }

  // ─── Beam-block extraction ───────────────────────────────────────────────
  //
  // The engine's BeamParams object has these fields:
  //   d_1e_mm, wl_nm, tau_s, is_cw, prf_hz, pulse_energy_J, avg_power_W
  //
  // The LSP document carries the same information but in a different shape.
  // The translation is straightforward:
  //   d_1e_mm           = laser.beam_diameter_mm
  //   wl_nm             = laser.wavelength_nm
  //   is_cw             = (laser.pulse_mode === "cw")
  //   tau_s             = laser.pulse.pulse_duration_s (else 0 for cw)
  //   prf_hz            = laser.pulse.repetition_rate_hz (else 0 for cw)
  //   pulse_energy_J    = laser.pulse.pulse_energy_j if present, else
  //                       avg_power_W / prf_hz
  //   avg_power_W       = pattern.default_power_w if present, else
  //                       pulse_energy_J × prf_hz, else 0

  function _buildBeam(doc) {
    var laser = doc.laser;
    var pulse = laser.pulse || {};
    var is_cw = laser.pulse_mode === "cw";
    var tau_s = is_cw ? 0 : (pulse.pulse_duration_s || 0);
    var prf_hz = is_cw ? 0 : (pulse.repetition_rate_hz || 0);

    var avg_power_W = 0;
    if (typeof doc.pattern.default_power_w === "number" && isFinite(doc.pattern.default_power_w)) {
      avg_power_W = doc.pattern.default_power_w;
    }
    var pulse_energy_J = 0;
    if (!is_cw) {
      if (typeof pulse.pulse_energy_j === "number" && isFinite(pulse.pulse_energy_j) && pulse.pulse_energy_j > 0) {
        pulse_energy_J = pulse.pulse_energy_j;
        if (avg_power_W === 0 && prf_hz > 0) {
          avg_power_W = pulse_energy_J * prf_hz;
        }
      } else if (avg_power_W > 0 && prf_hz > 0) {
        pulse_energy_J = avg_power_W / prf_hz;
      }
    }

    return {
      d_1e_mm: laser.beam_diameter_mm,
      wl_nm: laser.wavelength_nm,
      tau_s: tau_s,
      is_cw: is_cw,
      prf_hz: prf_hz,
      pulse_energy_J: pulse_energy_J,
      avg_power_W: avg_power_W
    };
  }

  // ─── Mode 1: parameterized legacy preset ─────────────────────────────────

  function _validateParameterizedParams(shapeName, params, errors) {
    // Returns false if any required field is missing or invalid. All errors
    // are pushed to the errors array so the caller sees the full picture
    // rather than just the first failure. This catches every adversarial
    // input (negative lengths, zero velocities, non-integer line counts,
    // non-finite values) before any engine call would silently produce
    // a degenerate result.
    if (!params || typeof params !== "object") {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_SHAPE,
        path: "/pattern/parameterized/0/params",
        message: "Parameterized shape '" + shapeName + "' has no params object."
      });
      return false;
    }
    var ok = true;

    function requirePositiveNumber(value, name) {
      if (typeof value !== "number" || !isFinite(value) || value <= 0) {
        errors.push({
          code: ERROR_CODES.DEGENERATE_GEOMETRY,
          path: "/pattern/parameterized/0/params/" + name,
          message: "Parameterized shape '" + shapeName + "' requires " + name +
            " to be a positive finite number (was " +
            (value === undefined ? "missing" : String(value)) + ")"
        });
        ok = false;
      }
    }

    function requirePositiveInteger(value, name) {
      if (typeof value !== "number" || !isFinite(value) || value < 1 ||
          Math.floor(value) !== value) {
        errors.push({
          code: ERROR_CODES.DEGENERATE_GEOMETRY,
          path: "/pattern/parameterized/0/params/" + name,
          message: "Parameterized shape '" + shapeName + "' requires " + name +
            " to be a positive integer (was " +
            (value === undefined ? "missing" : String(value)) + ")"
        });
        ok = false;
      }
    }

    function requireFiniteNumberIfPresent(value, name) {
      if (value !== undefined && (typeof value !== "number" || !isFinite(value))) {
        errors.push({
          code: ERROR_CODES.DEGENERATE_GEOMETRY,
          path: "/pattern/parameterized/0/params/" + name,
          message: "Parameterized shape '" + shapeName + "' has non-finite " + name +
            " (was " + String(value) + ")"
        });
        ok = false;
      }
    }

    requirePositiveNumber(params.line_length_mm, "line_length_mm");
    requirePositiveNumber(params.scan_velocity_mm_s, "scan_velocity_mm_s");
    requireFiniteNumberIfPresent(params.x0, "x0");
    requireFiniteNumberIfPresent(params.y0, "y0");

    if (shapeName === "linear") {
      requireFiniteNumberIfPresent(params.angle_rad, "angle_rad");
    } else if (shapeName === "raster" || shapeName === "bidi_raster") {
      requirePositiveInteger(params.n_lines, "n_lines");
      // hatch_mm and jump_velocity_mm_s default to safe values when missing,
      // but must be finite-and-positive when explicitly supplied.
      if (params.hatch_mm !== undefined) requirePositiveNumber(params.hatch_mm, "hatch_mm");
      if (params.jump_velocity_mm_s !== undefined) {
        requirePositiveNumber(params.jump_velocity_mm_s, "jump_velocity_mm_s");
      }
    }
    return ok;
  }

  function _canonicalizeParameterized(doc, eng, beam, errors) {
    var shape = doc.pattern.parameterized[0];
    var shapeName = shape.shape;
    if (!Object.prototype.hasOwnProperty.call(LEGACY_PRESETS, shapeName)) {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_SHAPE,
        path: "/pattern/parameterized/0/shape",
        message: "Parameterized shape '" + shapeName + "' is not supported in Phase 1. " +
          "Supported: linear, raster, bidi_raster."
      });
      return null;
    }

    var params = shape.params;
    if (!_validateParameterizedParams(shapeName, params, errors)) {
      return null;
    }

    var engineSegments = [];
    var scanParams = null;
    var totalTime_s = 0;

    var x0 = (typeof params.x0 === "number") ? params.x0 : 0;
    var y0 = (typeof params.y0 === "number") ? params.y0 : 0;
    var d = beam.d_1e_mm;

    if (shapeName === "linear") {
      var angle = (typeof params.angle_rad === "number") ? params.angle_rad : 0;
      engineSegments = eng.buildLinearScan(x0, y0, angle, params.line_length_mm,
        params.scan_velocity_mm_s, d);
      // Linear separable scanParams require pattern="linear", n_lines=1, hatch=any
      scanParams = {
        d_1e_mm: d,
        x0: x0, y0: y0,
        line_length_mm: params.line_length_mm,
        n_lines: 1,
        hatch_mm: d,  // unused for linear but engine wants a positive value
        v_scan_mm_s: params.scan_velocity_mm_s,
        v_jump_mm_s: params.scan_velocity_mm_s,
        pattern: "linear",
        blanking: false,
        is_cw: beam.is_cw,
        prf_hz: beam.prf_hz,
        pulse_energy_J: beam.pulse_energy_J,
        avg_power_W: beam.avg_power_W
      };
      totalTime_s = params.line_length_mm / params.scan_velocity_mm_s;
      // Angle support: separable path assumes axis-aligned scan; if angle != 0
      // the segment-superposition path handles it. Drop scanParams when angle is nonzero.
      if (angle !== 0) scanParams = null;
    } else if (shapeName === "raster" || shapeName === "bidi_raster") {
      var nL = params.n_lines;
      var hatch = (typeof params.hatch_mm === "number" && params.hatch_mm > 0) ? params.hatch_mm : d;
      var jumpV = (typeof params.jump_velocity_mm_s === "number" && params.jump_velocity_mm_s > 0)
        ? params.jump_velocity_mm_s : params.scan_velocity_mm_s;
      var blanking = params.blanking === true;
      var builder = shapeName === "raster" ? eng.buildRasterScan : eng.buildBidiRasterScan;
      engineSegments = builder(x0, y0, params.line_length_mm, nL, hatch,
        params.scan_velocity_mm_s, jumpV, d, blanking);
      scanParams = {
        d_1e_mm: d,
        x0: x0, y0: y0,
        line_length_mm: params.line_length_mm,
        n_lines: nL,
        hatch_mm: hatch,
        v_scan_mm_s: params.scan_velocity_mm_s,
        v_jump_mm_s: jumpV,
        pattern: LEGACY_PRESETS[shapeName],  // "raster" or "bidi"
        blanking: blanking,
        is_cw: beam.is_cw,
        prf_hz: beam.prf_hz,
        pulse_energy_J: beam.pulse_energy_J,
        avg_power_W: beam.avg_power_W
      };
      // Total time: nL forward lines + (nL-1) flyback + (nL-1) step (raster)
      // or nL forward lines + (nL-1) vertical jump (bidi)
      var lineTime = params.line_length_mm / params.scan_velocity_mm_s;
      var jumpTime = (shapeName === "raster")
        ? (params.line_length_mm + hatch) / jumpV * (nL - 1)
        : hatch / jumpV * (nL - 1);
      totalTime_s = nL * lineTime + jumpTime;
    }

    return {
      engineSegments: engineSegments,
      scanParams: scanParams,
      totalTime_s: totalTime_s
    };
  }

  // ─── Mode 2: explicit segments ───────────────────────────────────────────
  //
  // Each LSP segment is translated into one or more engine segments. The
  // engine convention is one segment per beam diameter along the path. The
  // translation matches buildCustomScan in the engine:
  //
  //   For an LSP "line" or "move" from p0 to p1:
  //     n_eng = round(dist / d_1e_mm), at least 1
  //     each engine segment has length (dist / n_eng) along the line
  //
  //   For an LSP "dwell" at p0 with duration_s:
  //     Translate to a single zero-length engine segment with v_mm_s set so
  //     that the engine's per-segment time accounting (length / v) equals
  //     duration_s. We use a small synthetic length d_eps to avoid divide-by-
  //     zero in the engine's grid traversal, with v = d_eps / duration_s.
  //
  //   For an LSP "arc": deferred to Phase 2.5; emit an ARC_NOT_SUPPORTED error.

  function _translateLineSegment(seg, d_1e_mm, defaultVel, defaultPower, beam, errors, runningId) {
    var dx = seg.p1[0] - seg.p0[0];
    var dy = seg.p1[1] - seg.p0[1];
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-12) {
      // Degenerate line — skip silently
      return {segs: [], time_s: 0, count: 0};
    }
    var angle = Math.atan2(dy, dx);
    var velocity = _resolveVelocity(seg, defaultVel);
    if (!isFinite(velocity) || velocity <= 0) {
      errors.push({
        code: ERROR_CODES.DEGENERATE_GEOMETRY,
        path: "/pattern/segments/" + runningId,
        message: "Segment " + runningId + " has no resolvable positive velocity"
      });
      return {segs: [], time_s: 0, count: 0};
    }
    // Blanking: explicit blanked field wins. Otherwise, move segments are
    // blanked by default (non-emitting traversal, like G-code G0), and line
    // segments are unblanked by default. This matches the schema's documented
    // intent for the type discriminator.
    //
    // KNOWN ENGINE LIMITATION: As of engine.js commit 0d23b34, the legacy CW
    // fluence path (computeScanFluenceCW, invoked when scanParams=null) merges
    // blanked segments into sweeps without skipping them. The pulsed legacy
    // path correctly skips blanked segments. The separable-CW path computes
    // fluence analytically from scan parameters and does not consume the
    // blanked flag either. The practical effect on the LSP path is that CW
    // patterns with blanked segments may report a peak fluence higher than the
    // true physical value, making the safety verdict more conservative (not
    // less) than reality. Fixing this requires a one-line change in engine.js
    // (skip blanked segments in the CW merge loop) and is deferred to a
    // follow-up patch with its own test coverage.
    var blanked;
    if (seg.blanked === true) {
      blanked = true;
    } else if (seg.blanked === false) {
      blanked = false;
    } else {
      blanked = (seg.type === "move");
    }
    var n = Math.round(dist / d_1e_mm);
    if (n < 1) n = 1;
    var step = dist / n;
    var cos_a = Math.cos(angle), sin_a = Math.sin(angle);
    var segs = new Array(n);

    // For linear_ramp velocity, average velocity along the segment is
    // (v_start + v_end) / 2. We use the average velocity uniformly for now
    // (matching how buildCustomScan and other engine paths treat per-segment
    // velocity). A more accurate ramp treatment would assign per-engine-segment
    // velocities; this is a documented Phase-1 approximation.
    var v = velocity;
    if (seg.velocity && seg.velocity.mode === "linear_ramp") {
      v = (seg.velocity.v_start_mm_per_s + seg.velocity.v_end_mm_per_s) / 2;
    }

    for (var i = 0; i < n; i++) {
      var s = {
        x_start_mm: seg.p0[0] + i * step * cos_a,
        y_start_mm: seg.p0[1] + i * step * sin_a,
        angle_rad: angle,
        v_mm_s: v
      };
      if (blanked) s.blanked = true;
      segs[i] = s;
    }
    return {segs: segs, time_s: dist / v, count: n};
  }

  function _translateDwellSegment(seg, d_1e_mm, defaultPower, beam, errors, runningId) {
    var duration = seg.duration_s;
    if (!isFinite(duration) || duration <= 0) {
      errors.push({
        code: ERROR_CODES.DEGENERATE_GEOMETRY,
        path: "/pattern/segments/" + runningId,
        message: "Dwell segment " + runningId + " has non-positive duration"
      });
      return {segs: [], time_s: 0, count: 0};
    }
    // Synthetic engine segment: a single zero-angle stub at the dwell point
    // with v_mm_s set so the engine's time accounting equals duration. The
    // beam stays at the same point; the engine's segment-erf path will
    // accumulate the correct fluence based on time-at-point.
    var d_eps = d_1e_mm * 1e-6;  // tiny fraction of a beam diameter
    var v = d_eps / duration;
    var s = {
      x_start_mm: seg.p0[0],
      y_start_mm: seg.p0[1],
      angle_rad: 0,
      v_mm_s: v
    };
    if (seg.blanked === true) s.blanked = true;
    return {segs: [s], time_s: duration, count: 1};
  }

  function _resolveVelocity(seg, defaultVel) {
    if (!seg.velocity) return defaultVel;
    if (seg.velocity.mode === "constant") return seg.velocity.value_mm_per_s;
    if (seg.velocity.mode === "linear_ramp") {
      return (seg.velocity.v_start_mm_per_s + seg.velocity.v_end_mm_per_s) / 2;
    }
    if (seg.velocity.mode === "inherit") return defaultVel;
    return defaultVel;
  }

  function _canonicalizeSegments(doc, beam, options, errors) {
    var lspSegs = doc.pattern.segments;
    var d = beam.d_1e_mm;
    var defaultVel = doc.pattern.default_velocity_mm_s;
    var defaultPower = doc.pattern.default_power_w;

    // ── Phase 1 limitation: per-segment power overrides are not supported ──
    // The engine consumes power only through beam.avg_power_W (a single global
    // scalar per fluence computation). LSP segments may declare per-segment
    // power, but Phase 1 cannot honor them. To prevent silent misinterpretation,
    // we verify that every segment's effective power agrees with default_power_w
    // (within a small tolerance) before proceeding. If any segment disagrees,
    // we reject the document with a clear PER_SEGMENT_POWER_UNSUPPORTED error
    // listing the first offending segment.
    //
    // Factory-emitted documents always have segment power matching the default,
    // so this check is a guard against hand-crafted documents that would
    // otherwise produce a misleading safety verdict.
    var powerCheckFailed = false;
    for (var pi = 0; pi < lspSegs.length; pi++) {
      var pSeg = lspSegs[pi];
      if (!pSeg.power || pSeg.power.mode === "inherit") continue;
      var effectivePower;
      if (pSeg.power.mode === "constant") {
        effectivePower = pSeg.power.value;
      } else if (pSeg.power.mode === "linear_ramp") {
        // Phase 1 does not support power ramps either; treat any ramp as a
        // per-segment override unless start == end == defaultPower.
        if (pSeg.power.value_start !== pSeg.power.value_end) {
          errors.push({
            code: ERROR_CODES.PER_SEGMENT_POWER_UNSUPPORTED,
            path: "/pattern/segments/" + pi + "/power",
            message: "Segment " + pi + " specifies a linear_ramp power profile. " +
              "Phase 1 supports only a single per-document power (pattern.default_power_w); " +
              "linear_ramp will be supported in Phase 2."
          });
          powerCheckFailed = true;
          break;
        }
        effectivePower = pSeg.power.value_start;
      } else {
        continue;
      }
      // Tolerate floating-point round-off but reject any meaningful disagreement.
      // Threshold: relative 1e-9 OR absolute 1e-15.
      if (typeof defaultPower !== "number" || !isFinite(defaultPower)) {
        errors.push({
          code: ERROR_CODES.PER_SEGMENT_POWER_UNSUPPORTED,
          path: "/pattern/segments/" + pi + "/power",
          message: "Segment " + pi + " specifies power=" + effectivePower +
            " but pattern.default_power_w is missing. Phase 1 requires default_power_w " +
            "to be set when any segment declares an explicit power."
        });
        powerCheckFailed = true;
        break;
      }
      var absDiff = Math.abs(effectivePower - defaultPower);
      var relDiff = absDiff / Math.max(Math.abs(defaultPower), 1e-30);
      if (absDiff > 1e-15 && relDiff > 1e-9) {
        errors.push({
          code: ERROR_CODES.PER_SEGMENT_POWER_UNSUPPORTED,
          path: "/pattern/segments/" + pi + "/power",
          message: "Segment " + pi + " specifies power=" + effectivePower +
            " W, which disagrees with pattern.default_power_w=" + defaultPower +
            " W. Phase 1 supports only a single per-document power " +
            "(per-segment power overrides will be supported in Phase 2). " +
            "Either set every segment's power to match default_power_w or use " +
            "power: {mode: 'inherit'}."
        });
        powerCheckFailed = true;
        break;
      }
    }
    if (powerCheckFailed) return null;

    var allEngineSegs = [];
    var totalTime = 0;
    var totalCount = 0;

    for (var i = 0; i < lspSegs.length; i++) {
      var seg = lspSegs[i];
      var out;
      if (seg.type === "line" || seg.type === "move") {
        out = _translateLineSegment(seg, d, defaultVel, defaultPower, beam, errors, i);
      } else if (seg.type === "dwell") {
        out = _translateDwellSegment(seg, d, defaultPower, beam, errors, i);
      } else if (seg.type === "arc") {
        errors.push({
          code: ERROR_CODES.ARC_NOT_SUPPORTED,
          path: "/pattern/segments/" + i,
          message: "Arc segments are not supported in Phase 1. Convert to a polyline of line segments."
        });
        return null;
      } else {
        errors.push({
          code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
          path: "/pattern/segments/" + i,
          message: "Unknown segment type '" + seg.type + "'"
        });
        return null;
      }
      if (errors.length > 0) {
        // accumulated errors from this segment — abort
        return null;
      }
      totalTime += out.time_s;
      totalCount += out.count;
      if (totalCount > options.maxEngineSegments) {
        errors.push({
          code: ERROR_CODES.SEGMENT_OVERFLOW,
          path: "/pattern/segments",
          message: "Translated engine segment count (" + totalCount + ") exceeded cap of " +
            options.maxEngineSegments + ". Consider reducing pattern resolution."
        });
        return null;
      }
      for (var j = 0; j < out.segs.length; j++) allEngineSegs.push(out.segs[j]);
    }

    return {
      engineSegments: allEngineSegs,
      scanParams: null,
      totalTime_s: totalTime
    };
  }

  // ─── Mode 3: samples ─────────────────────────────────────────────────────
  //
  // Each consecutive pair of samples is treated as a chord traversed at
  // velocity = chord_length / dt. The engine's segment-superposition pipeline
  // requires that each segment have length equal to one beam diameter, so each
  // chord must be chopped into n_chop = round(chord_length / d_1e_mm) engine
  // segments (at least 1). This matches the chopping convention used by
  // _translateLineSegment in segments mode and by buildCustomScan in the
  // engine itself, and is essential for the engine's fluence accumulator to
  // attribute the correct dwell time to each grid cell.
  //
  // Up-front segment-count estimation: the worst case is that every sample
  // pair is a long chord. We pre-compute the total chord-length-based segment
  // count and bail out before allocation if it exceeds the cap.

  function _canonicalizeSamples(doc, beam, options, errors) {
    var s = doc.pattern.samples;
    // Defensive structural checks: a caller that skipped Stage 1 validation
    // could pass us a samples block with non-array x/y arrays. Detect this
    // and fail with a clear error rather than throwing on .length access.
    if (!s || typeof s !== "object") {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
        path: "/pattern/samples",
        message: "samples block is missing or not an object"
      });
      return null;
    }
    if (!Array.isArray(s.x) || !Array.isArray(s.y)) {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
        path: "/pattern/samples",
        message: "samples.x and samples.y must both be arrays"
      });
      return null;
    }
    if (s.x.length !== s.y.length) {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
        path: "/pattern/samples",
        message: "samples.x and samples.y must have the same length (got " +
          s.x.length + " and " + s.y.length + ")"
      });
      return null;
    }
    if (typeof s.sample_rate_hz !== "number" || !isFinite(s.sample_rate_hz) || s.sample_rate_hz <= 0) {
      errors.push({
        code: ERROR_CODES.DEGENERATE_GEOMETRY,
        path: "/pattern/samples/sample_rate_hz",
        message: "samples.sample_rate_hz must be a positive finite number (was " +
          s.sample_rate_hz + ")"
      });
      return null;
    }
    var n = s.x.length;
    if (n < 2) {
      errors.push({
        code: ERROR_CODES.DEGENERATE_GEOMETRY,
        path: "/pattern/samples",
        message: "Samples array must contain at least two samples to define a path"
      });
      return null;
    }

    // ── Phase 1 limitation: per-sample power overrides are not supported ──
    // Symmetric with the per-segment power consistency check in
    // _canonicalizeSegments. The engine consumes power only through
    // beam.avg_power_W, so any samples.power array whose values disagree with
    // pattern.default_power_w would be silently dropped, producing a
    // misleading safety verdict. We detect this case and reject the document
    // with a clear PER_SEGMENT_POWER_UNSUPPORTED error.
    var defaultPower = doc.pattern.default_power_w;
    if (Array.isArray(s.power) && s.power.length > 0) {
      for (var pi = 0; pi < s.power.length; pi++) {
        var pVal = s.power[pi];
        if (typeof pVal !== "number" || !isFinite(pVal)) continue;
        if (typeof defaultPower !== "number" || !isFinite(defaultPower)) {
          errors.push({
            code: ERROR_CODES.PER_SEGMENT_POWER_UNSUPPORTED,
            path: "/pattern/samples/power/" + pi,
            message: "Sample " + pi + " specifies power=" + pVal +
              " but pattern.default_power_w is missing. Phase 1 requires " +
              "default_power_w to be set when samples.power is supplied."
          });
          return null;
        }
        var absDiff = Math.abs(pVal - defaultPower);
        var relDiff = absDiff / Math.max(Math.abs(defaultPower), 1e-30);
        if (absDiff > 1e-15 && relDiff > 1e-9) {
          errors.push({
            code: ERROR_CODES.PER_SEGMENT_POWER_UNSUPPORTED,
            path: "/pattern/samples/power/" + pi,
            message: "Sample " + pi + " specifies power=" + pVal +
              " W, which disagrees with pattern.default_power_w=" + defaultPower +
              " W. Phase 1 supports only a single per-document power " +
              "(per-sample power overrides will be supported in Phase 2). " +
              "Set every entry of samples.power to default_power_w or remove " +
              "the samples.power array."
          });
          return null;
        }
      }
    }

    var dt = 1.0 / s.sample_rate_hz;
    var d = beam.d_1e_mm;
    var d_eps = d * 1e-6;

    // First pass: count engine segments that will be produced. Each non-degenerate
    // sample pair contributes round(dist / d) (≥1) engine segments; each
    // degenerate sample pair contributes 1 synthetic stub.
    var totalCount = 0;
    for (var i0 = 0; i0 < n - 1; i0++) {
      var dx0 = s.x[i0 + 1] - s.x[i0];
      var dy0 = s.y[i0 + 1] - s.y[i0];
      var dist0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      if (dist0 < 1e-12) {
        totalCount += 1;
      } else {
        var nc = Math.round(dist0 / d);
        if (nc < 1) nc = 1;
        totalCount += nc;
      }
      if (totalCount > options.maxEngineSegments) {
        errors.push({
          code: ERROR_CODES.SEGMENT_OVERFLOW,
          path: "/pattern/samples",
          message: "Translated engine-segment count (" + totalCount +
            "+) for sample-mode pattern exceeds cap of " + options.maxEngineSegments +
            ". Consider downsampling, increasing the beam diameter (if appropriate), " +
            "or raising the cap via options.maxEngineSegments."
        });
        return null;
      }
    }

    var engineSegs = new Array(totalCount);
    var writeIdx = 0;
    var totalTime = 0;

    for (var i = 0; i < n - 1; i++) {
      var dx = s.x[i + 1] - s.x[i];
      var dy = s.y[i + 1] - s.y[i];
      var dist = Math.sqrt(dx * dx + dy * dy);
      var blankedHere = Array.isArray(s.blanked) && s.blanked[i] === true;
      if (dist < 1e-12) {
        // Zero-length step. Encode as a synthetic dwell stub of duration dt.
        var v_eps = d_eps / dt;
        var es = {
          x_start_mm: s.x[i],
          y_start_mm: s.y[i],
          angle_rad: 0,
          v_mm_s: v_eps
        };
        if (blankedHere) es.blanked = true;
        engineSegs[writeIdx++] = es;
        totalTime += dt;
        continue;
      }
      // Non-degenerate chord. Velocity along the chord equals chord_length / dt;
      // this is the actual beam velocity over this sample interval. Chop into
      // beam-diameter engine segments so the engine accounts for dwell correctly.
      var velocity = dist / dt;
      var angle = Math.atan2(dy, dx);
      var nChop = Math.round(dist / d);
      if (nChop < 1) nChop = 1;
      var step = dist / nChop;
      var cos_a = Math.cos(angle), sin_a = Math.sin(angle);
      for (var k = 0; k < nChop; k++) {
        var seg = {
          x_start_mm: s.x[i] + k * step * cos_a,
          y_start_mm: s.y[i] + k * step * sin_a,
          angle_rad: angle,
          v_mm_s: velocity
        };
        if (blankedHere) seg.blanked = true;
        engineSegs[writeIdx++] = seg;
      }
      totalTime += dt;
    }

    // Trim if pre-count overshot due to any rounding. (Should never happen in
    // current code but kept as a defence-in-depth.)
    if (writeIdx < engineSegs.length) engineSegs.length = writeIdx;

    return {
      engineSegments: engineSegs,
      scanParams: null,
      totalTime_s: totalTime
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  function canonicalize(doc, options) {
    // Top-level try-catch ensures the function contract (never throws, always
    // returns a structured result object) is enforced even if any of the
    // internal routing helpers encounters an unexpected runtime exception.
    // This mirrors the validator's defense-in-depth around Stage 2.
    try {
      return _canonicalizeImpl(doc, options);
    } catch (err) {
      return {
        ok: false,
        beam: null,
        engineSegments: [],
        scanParams: null,
        totalTime_s: 0,
        errors: [{
          code: ERROR_CODES.INTERNAL_ERROR,
          path: "",
          message: "Canonicalization threw an unexpected exception: " +
            (err && err.message ? err.message : String(err))
        }]
      };
    }
  }

  function _canonicalizeImpl(doc, options) {
    options = options || {};
    var opts = {
      engine: options.engine,
      maxEngineSegments: (options.maxEngineSegments != null)
        ? options.maxEngineSegments : DEFAULT_OPTIONS.maxEngineSegments
    };

    var errors = [];

    if (doc == null || typeof doc !== "object") {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
        path: "",
        message: "doc is not an object"
      });
      return _emptyResult(errors);
    }
    // Arrays are objects in JavaScript but are not valid LSP documents.
    if (Array.isArray(doc)) {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
        path: "",
        message: "doc must be an object, not an array"
      });
      return _emptyResult(errors);
    }
    // Required top-level keys. Without these the canonicalization cannot
    // proceed safely; bail out with a clear error rather than letting
    // downstream code throw on undefined property access.
    if (!doc.laser || typeof doc.laser !== "object") {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
        path: "/laser",
        message: "doc.laser is missing or not an object"
      });
      return _emptyResult(errors);
    }
    if (!doc.exposure || typeof doc.exposure !== "object") {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
        path: "/exposure",
        message: "doc.exposure is missing or not an object"
      });
      return _emptyResult(errors);
    }
    if (!doc.pattern || typeof doc.pattern !== "object") {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
        path: "/pattern",
        message: "doc.pattern is missing or not an object"
      });
      return _emptyResult(errors);
    }

    var eng = _resolveEngine(opts.engine);
    if (!eng) {
      errors.push({
        code: ERROR_CODES.ENGINE_NOT_LOADED,
        path: "",
        message: "MPEEngine could not be resolved. Pass options.engine or load MPEEngine globally."
      });
      return _emptyResult(errors);
    }

    // Unit gate: this stage only supports mm/W. Stage-2 validation will have
    // already flagged this as an error for the user, but if the caller skips
    // the validator (e.g. internal test paths) we still fail safely here.
    if (doc.meta && doc.meta.units) {
      if (doc.meta.units.length !== "mm" && doc.meta.units.length !== "um") {
        errors.push({
          code: ERROR_CODES.UNIT_NOT_SUPPORTED,
          path: "/meta/units/length",
          message: "Phase 1 supports only mm (and um with conversion). Got '" + doc.meta.units.length + "'."
        });
        return _emptyResult(errors);
      }
      if (doc.meta.units.power !== "W" && doc.meta.units.power !== "mW") {
        errors.push({
          code: ERROR_CODES.UNIT_NOT_SUPPORTED,
          path: "/meta/units/power",
          message: "Phase 1 supports only W (and mW with conversion). Got '" + doc.meta.units.power + "'."
        });
        return _emptyResult(errors);
      }
    }

    // Apply unit conversions for um→mm and mW→W. The conversion is in-place
    // on a deep clone so the caller's document is not mutated.
    var working = _convertUnits(doc);

    var beam = _buildBeam(working);

    var routed = null;
    // If the document declares authoritative=parameterized but the parameterized
    // block is missing or empty, reject explicitly rather than silently falling
    // through to segments-mode or samples-mode routing. This mirrors the
    // validator's Stage 2 AUTHORITATIVE_PARAMETERIZED_EMPTY check, ensuring the
    // canonicalization pipeline does not produce a semantically different
    // result if validation was skipped.
    if (working.pattern.authoritative === "parameterized" &&
        (!Array.isArray(working.pattern.parameterized) ||
         working.pattern.parameterized.length === 0)) {
      errors.push({
        code: ERROR_CODES.AUTHORITATIVE_PARAMETERIZED_EMPTY,
        path: "/pattern/parameterized",
        message: "pattern.authoritative is 'parameterized' but pattern.parameterized is " +
          "missing or empty. Either supply a parameterized shape definition or change " +
          "pattern.authoritative to 'segments' or 'samples'."
      });
      return _emptyResult(errors);
    }

    if (working.pattern.authoritative === "parameterized" &&
        Array.isArray(working.pattern.parameterized) &&
        working.pattern.parameterized.length > 0) {
      routed = _canonicalizeParameterized(working, eng, beam, errors);
    } else if (working.pattern.representation === "segments" ||
               (working.pattern.representation === "hybrid" &&
                working.pattern.authoritative !== "samples")) {
      if (!Array.isArray(working.pattern.segments) || working.pattern.segments.length === 0) {
        errors.push({
          code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
          path: "/pattern/segments",
          message: "Segments array is empty"
        });
        return _emptyResult(errors);
      }
      routed = _canonicalizeSegments(working, beam, opts, errors);
    } else if (working.pattern.representation === "samples" ||
               (working.pattern.representation === "hybrid" &&
                working.pattern.authoritative === "samples")) {
      if (!working.pattern.samples) {
        errors.push({
          code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
          path: "/pattern/samples",
          message: "Samples block is missing"
        });
        return _emptyResult(errors);
      }
      routed = _canonicalizeSamples(working, beam, opts, errors);
    } else {
      errors.push({
        code: ERROR_CODES.UNSUPPORTED_REPRESENTATION,
        path: "/pattern",
        message: "Unknown pattern representation '" + working.pattern.representation + "'"
      });
      return _emptyResult(errors);
    }

    if (!routed || errors.length > 0) {
      return _emptyResult(errors);
    }

    return {
      ok: true,
      beam: beam,
      engineSegments: routed.engineSegments,
      scanParams: routed.scanParams,
      totalTime_s: routed.totalTime_s,
      errors: []
    };
  }

  function _emptyResult(errors) {
    return {
      ok: false,
      beam: null,
      engineSegments: [],
      scanParams: null,
      totalTime_s: 0,
      errors: errors
    };
  }

  function _convertUnits(doc) {
    var clone = JSON.parse(JSON.stringify(doc));
    if (!clone.meta || !clone.meta.units) return clone;
    var lengthScale = 1.0;
    if (clone.meta.units.length === "um") lengthScale = 1e-3;  // 1 um = 1e-3 mm
    var powerScale = 1.0;
    if (clone.meta.units.power === "mW") powerScale = 1e-3;    // 1 mW = 1e-3 W

    if (lengthScale !== 1.0) {
      clone.laser.beam_diameter_mm *= lengthScale;
      if (typeof clone.exposure.aperture_mm === "number") clone.exposure.aperture_mm *= lengthScale;
      _scaleLengths(clone.pattern, lengthScale);
      // Scale meta.extent_bbox and meta.origin, which are declared in the
      // document's length units. Forgetting these would leave them in the
      // original units while everything else is scaled, producing spurious
      // bbox warnings or missed real violations downstream.
      if (Array.isArray(clone.meta.extent_bbox) && clone.meta.extent_bbox.length === 2) {
        for (var bi = 0; bi < clone.meta.extent_bbox.length; bi++) {
          var corner = clone.meta.extent_bbox[bi];
          if (Array.isArray(corner)) {
            for (var bj = 0; bj < corner.length; bj++) {
              if (typeof corner[bj] === "number") corner[bj] *= lengthScale;
            }
          }
        }
      }
      if (Array.isArray(clone.meta.origin) && clone.meta.origin.length === 2) {
        clone.meta.origin[0] *= lengthScale;
        clone.meta.origin[1] *= lengthScale;
      }
      clone.meta.units.length = "mm";
    }
    if (powerScale !== 1.0) {
      _scalePower(clone.pattern, powerScale);
      if (clone.laser.pulse && typeof clone.laser.pulse.pulse_energy_j === "number") {
        clone.laser.pulse.pulse_energy_j *= powerScale;
      }
      clone.meta.units.power = "W";
    }
    return clone;
  }

  function _scaleLengths(pattern, scale) {
    if (typeof pattern.default_velocity_mm_s === "number") {
      pattern.default_velocity_mm_s *= scale;
    }
    if (Array.isArray(pattern.segments)) {
      for (var i = 0; i < pattern.segments.length; i++) {
        var s = pattern.segments[i];
        if (Array.isArray(s.p0)) { s.p0[0] *= scale; s.p0[1] *= scale; }
        if (Array.isArray(s.p1)) { s.p1[0] *= scale; s.p1[1] *= scale; }
        if (Array.isArray(s.center)) { s.center[0] *= scale; s.center[1] *= scale; }
        if (s.velocity) {
          if (s.velocity.mode === "constant" && typeof s.velocity.value_mm_per_s === "number") {
            s.velocity.value_mm_per_s *= scale;
          } else if (s.velocity.mode === "linear_ramp") {
            s.velocity.v_start_mm_per_s *= scale;
            s.velocity.v_end_mm_per_s *= scale;
          }
        }
      }
    }
    if (pattern.samples) {
      var sm = pattern.samples;
      if (Array.isArray(sm.x)) for (var j = 0; j < sm.x.length; j++) sm.x[j] *= scale;
      if (Array.isArray(sm.y)) for (var k = 0; k < sm.y.length; k++) sm.y[k] *= scale;
      if (Array.isArray(sm.z)) for (var l = 0; l < sm.z.length; l++) sm.z[l] *= scale;
    }
    if (Array.isArray(pattern.parameterized)) {
      for (var p = 0; p < pattern.parameterized.length; p++) {
        var prm = pattern.parameterized[p].params;
        var fields = ["x0", "y0", "line_length_mm", "hatch_mm",
                      "scan_velocity_mm_s", "jump_velocity_mm_s", "beam_diameter_mm"];
        for (var q = 0; q < fields.length; q++) {
          if (typeof prm[fields[q]] === "number") prm[fields[q]] *= scale;
        }
      }
    }
  }

  function _scalePower(pattern, scale) {
    if (typeof pattern.default_power_w === "number") pattern.default_power_w *= scale;
    if (Array.isArray(pattern.segments)) {
      for (var i = 0; i < pattern.segments.length; i++) {
        var s = pattern.segments[i];
        if (s.power) {
          if (s.power.mode === "constant" && typeof s.power.value === "number") {
            s.power.value *= scale;
          } else if (s.power.mode === "linear_ramp") {
            s.power.value_start *= scale;
            s.power.value_end *= scale;
          }
        }
      }
    }
    if (pattern.samples && Array.isArray(pattern.samples.power)) {
      for (var j = 0; j < pattern.samples.power.length; j++) {
        pattern.samples.power[j] *= scale;
      }
    }
    if (Array.isArray(pattern.parameterized)) {
      for (var p = 0; p < pattern.parameterized.length; p++) {
        if (typeof pattern.parameterized[p].params.average_power_w === "number") {
          pattern.parameterized[p].params.average_power_w *= scale;
        }
      }
    }
  }

  // ─── Module exports ──────────────────────────────────────────────────────

  var LSPCanonicalize = {
    canonicalize: canonicalize,
    ERROR_CODES: ERROR_CODES,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    // Exposed for tests:
    _buildBeam: _buildBeam,
    _convertUnits: _convertUnits
  };

  // BUILD_STRIP_START
  if (typeof module !== "undefined" && module.exports && typeof require === "function") {
    module.exports = LSPCanonicalize;
  }
  // BUILD_STRIP_END

  if (typeof root !== "undefined") {
    root.LSPCanonicalize = LSPCanonicalize;
  }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
