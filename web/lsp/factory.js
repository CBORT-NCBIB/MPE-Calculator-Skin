/* ════════════════════════════════════════════════════════════════════════════
 * web/lsp/factory.js — LSP-JSON document factories for the three legacy presets
 *
 * Every legacy scan pattern (linear, raster, bidirectional raster) is exposed
 * as a constructor that produces a fully-formed, schema-valid LSP-JSON
 * document. Each document contains:
 *
 *   • A `parameterized` block holding the high-level shape + parameters,
 *     which is preserved across round-trips and is the source of truth when
 *     the canonicalization pipeline routes through the engine's native
 *     buildLinearScan / buildRasterScan / buildBidiRasterScan functions.
 *
 *   • A `segments` block holding the flat engine-native segment array, which
 *     is what any consumer that does not know the parameterized shape (an
 *     external visualizer, an alternate engine, etc.) should use.
 *
 * Both blocks describe the same physical pattern. The `authoritative` field
 * is set to "parameterized" so the canonicalization pipeline knows to prefer
 * the high-level shape on import.
 *
 * The factory is a pure JavaScript module with no dependencies. It works in
 * Node.js (for tests) and in the browser (for the calculator). The optional
 * `engine` parameter to each factory function lets callers inject the engine
 * module; if omitted, the factory falls back to the global MPEEngine if
 * available, and finally to a built-in equivalent implementation. This last
 * fallback makes the module fully self-contained, which matters for testing
 * the factory in isolation from the engine.
 *
 * Public API:
 *
 *   LSPFactory.linear({ ... })            → LSP-JSON document
 *   LSPFactory.raster({ ... })            → LSP-JSON document
 *   LSPFactory.bidiRaster({ ... })        → LSP-JSON document
 *   LSPFactory.fromParameterized(doc)     → flat segments, regenerated
 *   LSPFactory.PRESETS                    → list of supported preset shape names
 *
 * Constructor option objects (common to all three):
 *
 *   wavelength_nm        : number, required
 *   beam_diameter_mm     : number, required
 *   pulse_mode           : "cw" | "pulsed", required
 *   pulse_repetition_hz  : number, required when pulse_mode === "pulsed"
 *   pulse_duration_s     : number, required when pulse_mode === "pulsed"
 *   pulse_energy_j       : number, optional (when pulse_mode === "pulsed")
 *   average_power_w      : number, required for cw; optional for pulsed
 *   exposure_duration_s  : number, required
 *   tissue               : "skin" (default)
 *   meta                 : { name?, description?, author?, source_tool?, origin?, extent_bbox? }
 *
 * Linear-specific options:
 *   x0, y0               : numbers (mm), default 0
 *   angle_rad            : number, default 0
 *   line_length_mm       : number, required
 *   scan_velocity_mm_s   : number, required
 *
 * Raster and bidirectional raster options:
 *   x0, y0               : numbers (mm), default 0
 *   line_length_mm       : number, required
 *   n_lines              : integer ≥ 1, required
 *   hatch_mm             : number, optional (defaults to beam_diameter_mm)
 *   scan_velocity_mm_s   : number, required
 *   jump_velocity_mm_s   : number, optional (defaults to scan_velocity_mm_s)
 *   blanking             : boolean, default false (raster only; ignored elsewhere)
 *
 * The factory validates its inputs aggressively. Any invalid combination
 * throws a TypeError with a precise message rather than silently returning
 * a degenerate document.
 * ════════════════════════════════════════════════════════════════════════════
 */

(function (root) {
  "use strict";

  // ─── Constants ───────────────────────────────────────────────────────────

  var LSP_VERSION = "1.0.0";

  var PRESETS = {
    LINEAR: "linear",
    RASTER: "raster",
    BIDI_RASTER: "bidi_raster"
  };

  // ─── Engine resolution ───────────────────────────────────────────────────
  //
  // The factory prefers the real engine's scan builders for two reasons:
  // first, the engine is the authoritative source of segment geometry and
  // must remain so; second, any divergence between the factory's segments
  // and the engine's segments would break round-trip equivalence. The
  // resolution order is: explicit `engine` parameter, then global MPEEngine,
  // then a built-in fallback that re-implements the same arithmetic.

  function _resolveEngine(explicit) {
    if (explicit && typeof explicit.buildLinearScan === "function") return explicit;
    if (typeof root !== "undefined" && root.MPEEngine &&
        typeof root.MPEEngine.buildLinearScan === "function") return root.MPEEngine;
    return _FALLBACK_ENGINE;
  }

  // Built-in fallback implementation of the three scan builders. Bit-identical
  // to engine.js as of commit 0d23b34. Kept here so the factory remains
  // testable in isolation; if the real engine is loaded, it is used in
  // preference.
  var _FALLBACK_ENGINE = {
    buildLinearScan: function (x0, y0, angle_rad, total_length_mm, v_mm_s, d_1e_mm) {
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
    },

    buildRasterScan: function (x0, y0, line_length_mm, n_lines, hatch_mm,
                               scan_v_mm_s, jump_v_mm_s, d_1e_mm, blanking) {
      if (!isFinite(n_lines) || n_lines < 1) return [];
      if (!isFinite(hatch_mm) || hatch_mm <= 0) hatch_mm = d_1e_mm;
      if (!isFinite(scan_v_mm_s) || scan_v_mm_s <= 0) return [];
      if (!isFinite(jump_v_mm_s) || jump_v_mm_s <= 0) jump_v_mm_s = scan_v_mm_s;
      var segs = [];
      for (var j = 0; j < n_lines; j++) {
        var line_y = y0 + j * hatch_mm;
        var lineSegs = _FALLBACK_ENGINE.buildLinearScan(x0, line_y, 0, line_length_mm,
          scan_v_mm_s, d_1e_mm);
        for (var k = 0; k < lineSegs.length; k++) segs.push(lineSegs[k]);
        if (j < n_lines - 1) {
          var retSegs = _FALLBACK_ENGINE.buildLinearScan(x0 + line_length_mm, line_y, Math.PI,
            line_length_mm, jump_v_mm_s, d_1e_mm);
          for (var k2 = 0; k2 < retSegs.length; k2++) {
            var rs = retSegs[k2];
            if (blanking) rs.blanked = true;
            segs.push(rs);
          }
          var stepSegs = _FALLBACK_ENGINE.buildLinearScan(x0, line_y, Math.PI / 2,
            hatch_mm, jump_v_mm_s, d_1e_mm);
          for (var k3 = 0; k3 < stepSegs.length; k3++) {
            var ss = stepSegs[k3];
            if (blanking) ss.blanked = true;
            segs.push(ss);
          }
        }
      }
      return segs;
    },

    buildBidiRasterScan: function (x0, y0, line_length_mm, n_lines, hatch_mm,
                                   scan_v_mm_s, jump_v_mm_s, d_1e_mm, blanking) {
      if (!isFinite(n_lines) || n_lines < 1) return [];
      if (!isFinite(hatch_mm) || hatch_mm <= 0) hatch_mm = d_1e_mm;
      if (!isFinite(scan_v_mm_s) || scan_v_mm_s <= 0) return [];
      if (!isFinite(jump_v_mm_s) || jump_v_mm_s <= 0) jump_v_mm_s = scan_v_mm_s;
      var segs = [];
      for (var j = 0; j < n_lines; j++) {
        var line_y = y0 + j * hatch_mm;
        if (j % 2 === 0) {
          var lineSegs = _FALLBACK_ENGINE.buildLinearScan(x0, line_y, 0, line_length_mm,
            scan_v_mm_s, d_1e_mm);
          for (var k = 0; k < lineSegs.length; k++) segs.push(lineSegs[k]);
        } else {
          var lineSegs2 = _FALLBACK_ENGINE.buildLinearScan(x0 + line_length_mm, line_y, Math.PI,
            line_length_mm, scan_v_mm_s, d_1e_mm);
          for (var k2 = 0; k2 < lineSegs2.length; k2++) segs.push(lineSegs2[k2]);
        }
        if (j < n_lines - 1) {
          var jumpEnd_x = (j % 2 === 0) ? x0 + line_length_mm : x0;
          var jumpSegs = _FALLBACK_ENGINE.buildLinearScan(jumpEnd_x, line_y, Math.PI / 2,
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
  };

  // ─── Input validation helpers ────────────────────────────────────────────

  function _requirePositiveNumber(value, name) {
    if (typeof value !== "number" || !isFinite(value) || value <= 0) {
      throw new TypeError(name + " must be a positive finite number (was " + value + ")");
    }
  }

  function _requirePositiveInteger(value, name) {
    if (typeof value !== "number" || !isFinite(value) || value < 1 || Math.floor(value) !== value) {
      throw new TypeError(name + " must be a positive integer (was " + value + ")");
    }
  }

  function _requireFiniteNumber(value, name) {
    if (typeof value !== "number" || !isFinite(value)) {
      throw new TypeError(name + " must be a finite number (was " + value + ")");
    }
  }

  function _validateCommonOptions(opts, fnName) {
    if (!opts || typeof opts !== "object") {
      throw new TypeError(fnName + ": options must be an object");
    }
    _requirePositiveNumber(opts.wavelength_nm, fnName + ".wavelength_nm");
    if (opts.wavelength_nm < 180 || opts.wavelength_nm > 1e6) {
      throw new TypeError(fnName + ".wavelength_nm must lie in [180, 1e6] (was " + opts.wavelength_nm + ")");
    }
    _requirePositiveNumber(opts.beam_diameter_mm, fnName + ".beam_diameter_mm");
    if (opts.beam_diameter_mm > 1000) {
      throw new TypeError(fnName + ".beam_diameter_mm must not exceed 1000 mm (was " +
        opts.beam_diameter_mm + ")");
    }
    if (opts.pulse_mode !== "cw" && opts.pulse_mode !== "pulsed") {
      throw new TypeError(fnName + ".pulse_mode must be 'cw' or 'pulsed' (was " +
        JSON.stringify(opts.pulse_mode) + ")");
    }
    _requirePositiveNumber(opts.exposure_duration_s, fnName + ".exposure_duration_s");
    if (opts.exposure_duration_s > 86400) {
      throw new TypeError(fnName + ".exposure_duration_s must not exceed 86400 (was " +
        opts.exposure_duration_s + ")");
    }
    if (opts.pulse_mode === "pulsed") {
      _requirePositiveNumber(opts.pulse_repetition_hz, fnName + ".pulse_repetition_hz");
      _requirePositiveNumber(opts.pulse_duration_s, fnName + ".pulse_duration_s");
      // pulse_energy_j is optional but must be finite-and-positive when supplied.
      if (opts.pulse_energy_j !== undefined) {
        _requirePositiveNumber(opts.pulse_energy_j, fnName + ".pulse_energy_j");
      }
    }
    // average_power_w is required for cw, optional for pulsed (can be derived from energy × prf)
    if (opts.pulse_mode === "cw") {
      _requirePositiveNumber(opts.average_power_w, fnName + ".average_power_w");
    } else if (opts.average_power_w !== undefined) {
      _requirePositiveNumber(opts.average_power_w, fnName + ".average_power_w");
    }
    // aperture_mm is optional but must lie within the schema bounds when supplied.
    if (opts.aperture_mm !== undefined) {
      _requirePositiveNumber(opts.aperture_mm, fnName + ".aperture_mm");
      if (opts.aperture_mm > 100) {
        throw new TypeError(fnName + ".aperture_mm must not exceed 100 mm (was " +
          opts.aperture_mm + ")");
      }
    }
  }

  function _buildLaserBlock(opts) {
    var laser = {
      wavelength_nm: opts.wavelength_nm,
      beam_diameter_mm: opts.beam_diameter_mm,
      pulse_mode: opts.pulse_mode
    };
    if (opts.beam_diameter_definition) {
      laser.beam_diameter_definition = opts.beam_diameter_definition;
    }
    if (opts.pulse_mode === "pulsed") {
      var pulse = {
        repetition_rate_hz: opts.pulse_repetition_hz,
        pulse_duration_s: opts.pulse_duration_s
      };
      if (typeof opts.pulse_energy_j === "number" && isFinite(opts.pulse_energy_j) && opts.pulse_energy_j > 0) {
        pulse.pulse_energy_j = opts.pulse_energy_j;
      }
      laser.pulse = pulse;
    } else {
      laser.pulse = null;
    }
    return laser;
  }

  function _buildExposureBlock(opts) {
    var exp = {
      tissue: opts.tissue || "skin",
      exposure_duration_s: opts.exposure_duration_s
    };
    if (typeof opts.aperture_mm === "number" && isFinite(opts.aperture_mm) && opts.aperture_mm > 0) {
      exp.aperture_mm = opts.aperture_mm;
    }
    return exp;
  }

  function _buildMetaBlock(opts, defaultName) {
    var m = (opts.meta && typeof opts.meta === "object") ? opts.meta : {};
    var meta = {
      units: {length: "mm", time: "s", power: "W", wavelength: "nm"}
    };
    meta.name = (typeof m.name === "string" && m.name) ? m.name : defaultName;
    if (typeof m.description === "string") meta.description = m.description;
    if (typeof m.author === "string") meta.author = m.author;
    if (typeof m.source_tool === "string") {
      meta.source_tool = m.source_tool;
    } else {
      meta.source_tool = "MPE-Calculator-Skin LSPFactory " + LSP_VERSION;
    }
    meta.created = (typeof m.created === "string") ? m.created : new Date().toISOString();
    // Validate coordinate_frame against the schema enum so that a user typo is
    // rejected by the factory rather than producing a schema-invalid document.
    if (m.coordinate_frame !== undefined) {
      if (m.coordinate_frame !== "sample_plane" &&
          m.coordinate_frame !== "scanner_angle" &&
          m.coordinate_frame !== "galvo_voltage") {
        throw new TypeError("LSPFactory: meta.coordinate_frame must be 'sample_plane', " +
          "'scanner_angle', or 'galvo_voltage' (was " + JSON.stringify(m.coordinate_frame) + ")");
      }
      meta.coordinate_frame = m.coordinate_frame;
    } else {
      meta.coordinate_frame = "sample_plane";
    }
    if (Array.isArray(m.origin) && m.origin.length === 2) meta.origin = m.origin.slice();
    if (m.extent_bbox !== undefined) {
      // Validate the bbox shape: must be [[xmin, ymin], [xmax, ymax]] with
      // finite numeric coordinates. Reject malformed shapes here rather than
      // producing a schema-invalid document.
      if (!Array.isArray(m.extent_bbox) || m.extent_bbox.length !== 2 ||
          !Array.isArray(m.extent_bbox[0]) || m.extent_bbox[0].length !== 2 ||
          !Array.isArray(m.extent_bbox[1]) || m.extent_bbox[1].length !== 2) {
        throw new TypeError("LSPFactory: meta.extent_bbox must be [[xmin, ymin], [xmax, ymax]] " +
          "with two 2-element subarrays (was " + JSON.stringify(m.extent_bbox) + ")");
      }
      for (var bi = 0; bi < 2; bi++) {
        for (var bj = 0; bj < 2; bj++) {
          var bv = m.extent_bbox[bi][bj];
          if (typeof bv !== "number" || !isFinite(bv)) {
            throw new TypeError("LSPFactory: meta.extent_bbox component [" + bi + "][" + bj +
              "] must be a finite number (was " + JSON.stringify(bv) + ")");
          }
        }
      }
      meta.extent_bbox = JSON.parse(JSON.stringify(m.extent_bbox));
    }
    return meta;
  }

  // The factory must derive the avg_power_W the engine consumes from whatever
  // the user supplied. For cw, average_power_w is required; for pulsed, the
  // canonical value is the larger of (user-supplied average_power_w) and
  // (pulse_energy_j × prf). If neither is available we leave it undefined and
  // the canonicalization pipeline will produce zero fluence — but the factory
  // does not silently fabricate a value.
  function _deriveAveragePowerW(opts) {
    if (opts.pulse_mode === "cw") return opts.average_power_w;
    if (typeof opts.average_power_w === "number" && isFinite(opts.average_power_w) && opts.average_power_w > 0) {
      return opts.average_power_w;
    }
    if (typeof opts.pulse_energy_j === "number" && isFinite(opts.pulse_energy_j) && opts.pulse_energy_j > 0) {
      return opts.pulse_energy_j * opts.pulse_repetition_hz;
    }
    return undefined;
  }

  // The factory emits segment objects in the engine's four-field format
  // (x_start_mm, y_start_mm, angle_rad, v_mm_s, optional blanked). It maps
  // each engine segment to one LSP segment whose p0 is the engine start
  // coordinate and whose p1 is one beam diameter further along the angle.
  // This is identical to how the engine internally treats the segment array
  // for fluence computation; preserving it preserves the original mathematics.
  function _engineSegmentsToLSP(engineSegments, d_1e_mm, defaultPowerW) {
    var lsp = new Array(engineSegments.length);
    for (var i = 0; i < engineSegments.length; i++) {
      var s = engineSegments[i];
      var cos_a = Math.cos(s.angle_rad), sin_a = Math.sin(s.angle_rad);
      var seg = {
        id: i,
        type: "line",
        p0: [s.x_start_mm, s.y_start_mm],
        p1: [s.x_start_mm + d_1e_mm * cos_a, s.y_start_mm + d_1e_mm * sin_a],
        velocity: {mode: "constant", value_mm_per_s: s.v_mm_s}
      };
      if (typeof defaultPowerW === "number" && isFinite(defaultPowerW) && defaultPowerW > 0) {
        seg.power = {mode: "constant", value: defaultPowerW};
      } else {
        seg.power = {mode: "inherit"};
      }
      if (s.blanked === true) seg.blanked = true;
      lsp[i] = seg;
    }
    return lsp;
  }

  // Compute the actual bounding box of an emitted LSP segment list. Used to
  // populate meta.extent_bbox accurately, so that downstream validators do not
  // emit spurious BBOX_VIOLATION warnings caused by the engine's segment-
  // extension convention (each segment is one beam diameter long, which can
  // push the path slightly beyond the user's nominal line_length_mm when
  // line_length_mm is not an integer multiple of the beam diameter).
  function _computeSegmentBBox(lspSegments) {
    if (!Array.isArray(lspSegments) || lspSegments.length === 0) return null;
    var xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (var i = 0; i < lspSegments.length; i++) {
      var seg = lspSegments[i];
      if (Array.isArray(seg.p0)) {
        if (seg.p0[0] < xmin) xmin = seg.p0[0];
        if (seg.p0[0] > xmax) xmax = seg.p0[0];
        if (seg.p0[1] < ymin) ymin = seg.p0[1];
        if (seg.p0[1] > ymax) ymax = seg.p0[1];
      }
      if (Array.isArray(seg.p1)) {
        if (seg.p1[0] < xmin) xmin = seg.p1[0];
        if (seg.p1[0] > xmax) xmax = seg.p1[0];
        if (seg.p1[1] < ymin) ymin = seg.p1[1];
        if (seg.p1[1] > ymax) ymax = seg.p1[1];
      }
    }
    if (!isFinite(xmin) || !isFinite(xmax) || !isFinite(ymin) || !isFinite(ymax)) return null;
    return [[xmin, ymin], [xmax, ymax]];
  }

  // ─── Linear preset ───────────────────────────────────────────────────────

  function linear(opts, engineOverride) {
    _validateCommonOptions(opts, "LSPFactory.linear");
    _requirePositiveNumber(opts.line_length_mm, "LSPFactory.linear.line_length_mm");
    _requirePositiveNumber(opts.scan_velocity_mm_s, "LSPFactory.linear.scan_velocity_mm_s");
    var x0 = (typeof opts.x0 === "number") ? opts.x0 : 0;
    var y0 = (typeof opts.y0 === "number") ? opts.y0 : 0;
    var angle = (typeof opts.angle_rad === "number") ? opts.angle_rad : 0;
    _requireFiniteNumber(x0, "LSPFactory.linear.x0");
    _requireFiniteNumber(y0, "LSPFactory.linear.y0");
    _requireFiniteNumber(angle, "LSPFactory.linear.angle_rad");

    var eng = _resolveEngine(engineOverride);
    var engineSegments = eng.buildLinearScan(x0, y0, angle, opts.line_length_mm,
      opts.scan_velocity_mm_s, opts.beam_diameter_mm);

    var avgPower = _deriveAveragePowerW(opts);
    var segments = _engineSegmentsToLSP(engineSegments, opts.beam_diameter_mm, avgPower);

    // Compute bbox from actual segments unless the caller explicitly supplied one.
    var metaOpts = Object.assign({}, opts.meta || {});
    if (!metaOpts.extent_bbox) {
      var computed = _computeSegmentBBox(segments);
      if (computed) metaOpts.extent_bbox = computed;
    }

    var doc = {
      lsp_version: LSP_VERSION,
      meta: _buildMetaBlock({meta: metaOpts}, "Linear scan"),
      laser: _buildLaserBlock(opts),
      exposure: _buildExposureBlock(opts),
      pattern: {
        representation: "segments",
        authoritative: "parameterized",
        default_velocity_mm_s: opts.scan_velocity_mm_s,
        segments: segments,
        parameterized: [{
          id: 0,
          shape: PRESETS.LINEAR,
          params: {
            x0: x0,
            y0: y0,
            angle_rad: angle,
            line_length_mm: opts.line_length_mm,
            scan_velocity_mm_s: opts.scan_velocity_mm_s,
            beam_diameter_mm: opts.beam_diameter_mm,
            average_power_w: avgPower
          }
        }]
      }
    };
    if (typeof avgPower === "number" && isFinite(avgPower) && avgPower > 0) {
      doc.pattern.default_power_w = avgPower;
    }
    return doc;
  }

  // ─── Raster preset (unidirectional) ──────────────────────────────────────

  function raster(opts, engineOverride) {
    _validateCommonOptions(opts, "LSPFactory.raster");
    _requirePositiveNumber(opts.line_length_mm, "LSPFactory.raster.line_length_mm");
    _requirePositiveInteger(opts.n_lines, "LSPFactory.raster.n_lines");
    _requirePositiveNumber(opts.scan_velocity_mm_s, "LSPFactory.raster.scan_velocity_mm_s");
    var x0 = (typeof opts.x0 === "number") ? opts.x0 : 0;
    var y0 = (typeof opts.y0 === "number") ? opts.y0 : 0;
    _requireFiniteNumber(x0, "LSPFactory.raster.x0");
    _requireFiniteNumber(y0, "LSPFactory.raster.y0");
    var hatch = (typeof opts.hatch_mm === "number" && opts.hatch_mm > 0) ? opts.hatch_mm : opts.beam_diameter_mm;
    var jumpV = (typeof opts.jump_velocity_mm_s === "number" && opts.jump_velocity_mm_s > 0)
      ? opts.jump_velocity_mm_s : opts.scan_velocity_mm_s;
    var blanking = (opts.blanking === true);

    var eng = _resolveEngine(engineOverride);
    var engineSegments = eng.buildRasterScan(x0, y0, opts.line_length_mm, opts.n_lines, hatch,
      opts.scan_velocity_mm_s, jumpV, opts.beam_diameter_mm, blanking);

    var avgPower = _deriveAveragePowerW(opts);
    var segments = _engineSegmentsToLSP(engineSegments, opts.beam_diameter_mm, avgPower);

    var metaOpts = Object.assign({}, opts.meta || {});
    if (!metaOpts.extent_bbox) {
      var computed = _computeSegmentBBox(segments);
      if (computed) metaOpts.extent_bbox = computed;
    }
    var meta = _buildMetaBlock({meta: metaOpts}, "Raster scan");

    var doc = {
      lsp_version: LSP_VERSION,
      meta: meta,
      laser: _buildLaserBlock(opts),
      exposure: _buildExposureBlock(opts),
      pattern: {
        representation: "segments",
        authoritative: "parameterized",
        default_velocity_mm_s: opts.scan_velocity_mm_s,
        segments: segments,
        parameterized: [{
          id: 0,
          shape: PRESETS.RASTER,
          params: {
            x0: x0,
            y0: y0,
            line_length_mm: opts.line_length_mm,
            n_lines: opts.n_lines,
            hatch_mm: hatch,
            scan_velocity_mm_s: opts.scan_velocity_mm_s,
            jump_velocity_mm_s: jumpV,
            beam_diameter_mm: opts.beam_diameter_mm,
            blanking: blanking,
            average_power_w: avgPower
          }
        }]
      }
    };
    if (typeof avgPower === "number" && isFinite(avgPower) && avgPower > 0) {
      doc.pattern.default_power_w = avgPower;
    }
    return doc;
  }

  // ─── Bidirectional raster preset ─────────────────────────────────────────

  function bidiRaster(opts, engineOverride) {
    _validateCommonOptions(opts, "LSPFactory.bidiRaster");
    _requirePositiveNumber(opts.line_length_mm, "LSPFactory.bidiRaster.line_length_mm");
    _requirePositiveInteger(opts.n_lines, "LSPFactory.bidiRaster.n_lines");
    _requirePositiveNumber(opts.scan_velocity_mm_s, "LSPFactory.bidiRaster.scan_velocity_mm_s");
    var x0 = (typeof opts.x0 === "number") ? opts.x0 : 0;
    var y0 = (typeof opts.y0 === "number") ? opts.y0 : 0;
    _requireFiniteNumber(x0, "LSPFactory.bidiRaster.x0");
    _requireFiniteNumber(y0, "LSPFactory.bidiRaster.y0");
    var hatch = (typeof opts.hatch_mm === "number" && opts.hatch_mm > 0) ? opts.hatch_mm : opts.beam_diameter_mm;
    var jumpV = (typeof opts.jump_velocity_mm_s === "number" && opts.jump_velocity_mm_s > 0)
      ? opts.jump_velocity_mm_s : opts.scan_velocity_mm_s;
    var blanking = (opts.blanking === true);

    var eng = _resolveEngine(engineOverride);
    var engineSegments = eng.buildBidiRasterScan(x0, y0, opts.line_length_mm, opts.n_lines, hatch,
      opts.scan_velocity_mm_s, jumpV, opts.beam_diameter_mm, blanking);

    var avgPower = _deriveAveragePowerW(opts);
    var segments = _engineSegmentsToLSP(engineSegments, opts.beam_diameter_mm, avgPower);

    var metaOpts = Object.assign({}, opts.meta || {});
    if (!metaOpts.extent_bbox) {
      var computed = _computeSegmentBBox(segments);
      if (computed) metaOpts.extent_bbox = computed;
    }
    var meta = _buildMetaBlock({meta: metaOpts}, "Bidirectional raster scan");

    var doc = {
      lsp_version: LSP_VERSION,
      meta: meta,
      laser: _buildLaserBlock(opts),
      exposure: _buildExposureBlock(opts),
      pattern: {
        representation: "segments",
        authoritative: "parameterized",
        default_velocity_mm_s: opts.scan_velocity_mm_s,
        segments: segments,
        parameterized: [{
          id: 0,
          shape: PRESETS.BIDI_RASTER,
          params: {
            x0: x0,
            y0: y0,
            line_length_mm: opts.line_length_mm,
            n_lines: opts.n_lines,
            hatch_mm: hatch,
            scan_velocity_mm_s: opts.scan_velocity_mm_s,
            jump_velocity_mm_s: jumpV,
            beam_diameter_mm: opts.beam_diameter_mm,
            blanking: blanking,
            average_power_w: avgPower
          }
        }]
      }
    };
    if (typeof avgPower === "number" && isFinite(avgPower) && avgPower > 0) {
      doc.pattern.default_power_w = avgPower;
    }
    return doc;
  }

  // ─── Re-generation from a parameterized block ────────────────────────────
  //
  // Given an LSP document whose pattern.parameterized lists one preset shape,
  // call the corresponding factory to regenerate the segments block. This is
  // the round-trip operation used by the canonicalization pipeline when it
  // sees an authoritative="parameterized" import: rather than trusting the
  // possibly-stale segments block, it regenerates it from the parameters.

  function fromParameterized(doc, engineOverride) {
    if (!doc || !doc.pattern || !Array.isArray(doc.pattern.parameterized) ||
        doc.pattern.parameterized.length === 0) {
      throw new TypeError("LSPFactory.fromParameterized: doc.pattern.parameterized is empty");
    }
    if (doc.pattern.parameterized.length > 1) {
      throw new TypeError("LSPFactory.fromParameterized: multi-shape parameterized blocks are not supported in Phase 1");
    }
    var shape = doc.pattern.parameterized[0];
    var params = shape.params || {};

    // Re-merge the laser/exposure blocks back into the constructor option shape.
    var pulseMode = doc.laser.pulse_mode;
    var common = {
      wavelength_nm: doc.laser.wavelength_nm,
      beam_diameter_mm: doc.laser.beam_diameter_mm,
      beam_diameter_definition: doc.laser.beam_diameter_definition,
      pulse_mode: pulseMode,
      exposure_duration_s: doc.exposure.exposure_duration_s,
      tissue: doc.exposure.tissue,
      aperture_mm: doc.exposure.aperture_mm,
      meta: doc.meta || {}
    };
    if (pulseMode === "pulsed" && doc.laser.pulse) {
      common.pulse_repetition_hz = doc.laser.pulse.repetition_rate_hz;
      common.pulse_duration_s = doc.laser.pulse.pulse_duration_s;
      if (doc.laser.pulse.pulse_energy_j) {
        common.pulse_energy_j = doc.laser.pulse.pulse_energy_j;
      }
    }
    if (typeof params.average_power_w === "number" && isFinite(params.average_power_w)) {
      common.average_power_w = params.average_power_w;
    } else if (typeof doc.pattern.default_power_w === "number") {
      common.average_power_w = doc.pattern.default_power_w;
    }

    if (shape.shape === PRESETS.LINEAR) {
      return linear(Object.assign({}, common, {
        x0: params.x0, y0: params.y0,
        angle_rad: params.angle_rad,
        line_length_mm: params.line_length_mm,
        scan_velocity_mm_s: params.scan_velocity_mm_s
      }), engineOverride);
    }
    if (shape.shape === PRESETS.RASTER) {
      return raster(Object.assign({}, common, {
        x0: params.x0, y0: params.y0,
        line_length_mm: params.line_length_mm,
        n_lines: params.n_lines,
        hatch_mm: params.hatch_mm,
        scan_velocity_mm_s: params.scan_velocity_mm_s,
        jump_velocity_mm_s: params.jump_velocity_mm_s,
        blanking: params.blanking
      }), engineOverride);
    }
    if (shape.shape === PRESETS.BIDI_RASTER) {
      return bidiRaster(Object.assign({}, common, {
        x0: params.x0, y0: params.y0,
        line_length_mm: params.line_length_mm,
        n_lines: params.n_lines,
        hatch_mm: params.hatch_mm,
        scan_velocity_mm_s: params.scan_velocity_mm_s,
        jump_velocity_mm_s: params.jump_velocity_mm_s,
        blanking: params.blanking
      }), engineOverride);
    }
    throw new TypeError("LSPFactory.fromParameterized: unsupported shape '" + shape.shape + "'");
  }

  // ─── Module exports ──────────────────────────────────────────────────────

  var LSPFactory = {
    PRESETS: PRESETS,
    LSP_VERSION: LSP_VERSION,
    linear: linear,
    raster: raster,
    bidiRaster: bidiRaster,
    fromParameterized: fromParameterized,
    // Exposed for tests only:
    _FALLBACK_ENGINE: _FALLBACK_ENGINE,
    _engineSegmentsToLSP: _engineSegmentsToLSP
  };

  // BUILD_STRIP_START
  if (typeof module !== "undefined" && module.exports && typeof require === "function") {
    module.exports = LSPFactory;
  }
  // BUILD_STRIP_END

  if (typeof root !== "undefined") {
    root.LSPFactory = LSPFactory;
  }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
