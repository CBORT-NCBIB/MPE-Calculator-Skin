/* ════════════════════════════════════════════════════════════════════════════
 * web/lsp/validate.js — LSP-JSON document validator
 *
 * Two-stage validation pipeline:
 *
 *   Stage 1: Structural validation against the JSON Schema (Ajv compiled at
 *            load time). Catches type errors, missing required fields, enum
 *            violations, out-of-range numbers, and the if/then conditionals
 *            that enforce representation ↔ payload correspondence.
 *
 *   Stage 2: Physical-plausibility validation in plain JavaScript. Catches
 *            issues that JSON Schema cannot express: array-length mismatches
 *            between samples.x and samples.y; segment endpoints outside the
 *            declared bounding box; total integrated path duration that
 *            exceeds the exposure window by an unreasonable factor; sample
 *            counts above the per-document hard cap; non-finite numbers that
 *            slipped through (JSON cannot represent NaN/Infinity directly,
 *            but a generator may emit them as null or a string).
 *
 * The module is browser-only. It assumes Ajv 8 has been loaded as a global
 * (via <script src="https://unpkg.com/ajv@8/dist/ajv.bundle.min.js">) and
 * that the schema document has been loaded as a global LSP_SCHEMA object by
 * the build script.
 *
 * Public API:
 *
 *   LSPValidate.validate(doc, options) → {ok, value, errors, warnings}
 *
 *     doc      : object — already parsed JSON
 *     options  : {
 *       maxSamples       : number (default 5_000_000)
 *       maxSegments      : number (default 1_000_000)
 *       boundingBoxSlack : number (default 0.05)   — fractional slack on extent_bbox
 *       durationRatioCap : number (default 100.0)  — total path time may exceed
 *                                                    exposure_duration_s by at most
 *                                                    this factor (allowing loops)
 *     }
 *
 *     returns:
 *       ok       : boolean
 *       value    : the input doc (unchanged) if ok, else null
 *       errors   : array of {code, path, message} structured errors
 *       warnings : array of {code, path, message} structured warnings
 *
 * All errors and warnings include a stable code string so the UI can map them
 * to localized or context-specific messages without parsing the message text.
 *
 * The validator never throws. Any internal exception becomes an error with
 * code "INTERNAL_ERROR" so the UI can fail gracefully.
 * ════════════════════════════════════════════════════════════════════════════
 */

(function (root) {
  "use strict";

  // ─── Constants ───────────────────────────────────────────────────────────

  var DEFAULT_OPTIONS = {
    maxSamples: 5000000,
    maxSegments: 1000000,
    boundingBoxSlack: 0.05,
    durationRatioCap: 100.0
  };

  // Stable error codes. Every error and warning the validator can produce is
  // listed here; the UI may map these to localized strings. Keep this table
  // alphabetised within each section.
  var ERROR_CODES = {
    // Stage 1 (schema)
    SCHEMA_VIOLATION: "SCHEMA_VIOLATION",
    // Stage 2 (physical plausibility)
    AUTHORITATIVE_PARAMETERIZED_EMPTY: "AUTHORITATIVE_PARAMETERIZED_EMPTY",
    BBOX_VIOLATION: "BBOX_VIOLATION",
    DURATION_RATIO_EXCEEDED: "DURATION_RATIO_EXCEEDED",
    DUPLICATE_SEGMENT_ID: "DUPLICATE_SEGMENT_ID",
    INTERNAL_ERROR: "INTERNAL_ERROR",
    NON_FINITE_NUMBER: "NON_FINITE_NUMBER",
    PULSE_BLOCK_MISSING: "PULSE_BLOCK_MISSING",
    SAMPLES_ARRAY_LENGTH_MISMATCH: "SAMPLES_ARRAY_LENGTH_MISMATCH",
    SAMPLES_OVER_CAP: "SAMPLES_OVER_CAP",
    SEGMENT_DEGENERATE: "SEGMENT_DEGENERATE",
    SEGMENT_OVER_CAP: "SEGMENT_OVER_CAP",
    UNIT_CONVERSION_UNSUPPORTED: "UNIT_CONVERSION_UNSUPPORTED",
    UNKNOWN_LSP_VERSION: "UNKNOWN_LSP_VERSION"
  };

  // ─── Schema-compilation singleton ────────────────────────────────────────
  //
  // Ajv compilation is moderately expensive. We compile once on first call
  // and reuse the compiled validator for every subsequent document.

  var _compiledValidator = null;
  var _compileError = null;

  function _compile(schema, ajv) {
    try {
      _compiledValidator = ajv.compile(schema);
      _compileError = null;
    } catch (err) {
      _compiledValidator = null;
      _compileError = err && err.message ? err.message : String(err);
    }
  }

  function _ensureCompiled() {
    if (_compiledValidator) return null;
    if (_compileError) return _compileError;
    if (typeof root.LSP_SCHEMA === "undefined") {
      return "LSP_SCHEMA global is not loaded";
    }
    // Two paths: Ajv loaded via the standard UMD bundle exposes `Ajv` as a
    // constructor on `window`; the ESM build exposes it as `Ajv2020`. We try
    // both and bail out cleanly if neither is present.
    var AjvCtor = root.Ajv2020 || root.Ajv;
    if (typeof AjvCtor !== "function") {
      return "Ajv library is not loaded";
    }
    var ajv;
    try {
      ajv = new AjvCtor({allErrors: true, strict: false});
    } catch (err) {
      return "Ajv instantiation failed: " + (err.message || err);
    }
    _compile(root.LSP_SCHEMA, ajv);
    return _compileError;
  }

  // ─── Stage 1: schema validation ──────────────────────────────────────────

  function _runSchemaValidation(doc) {
    var compileErr = _ensureCompiled();
    if (compileErr) {
      return [{
        code: ERROR_CODES.INTERNAL_ERROR,
        path: "",
        message: "Validator initialization failed: " + compileErr
      }];
    }
    var ok = _compiledValidator(doc);
    if (ok) return [];
    var errs = _compiledValidator.errors || [];
    var out = new Array(errs.length);
    for (var i = 0; i < errs.length; i++) {
      var e = errs[i];
      var path = (e.instancePath || "") +
        (e.params && e.params.missingProperty ? "/" + e.params.missingProperty : "");
      out[i] = {
        code: ERROR_CODES.SCHEMA_VIOLATION,
        path: path,
        message: _humanizeAjvError(e)
      };
    }
    return out;
  }

  function _humanizeAjvError(e) {
    var msg = e.message || "value is invalid";
    if (e.keyword === "required") {
      return "Missing required field: " + e.params.missingProperty;
    }
    if (e.keyword === "enum") {
      return "Value must be one of " + JSON.stringify(e.params.allowedValues) + " (was " +
        JSON.stringify(e.data) + ")";
    }
    if (e.keyword === "additionalProperties") {
      return "Unexpected field: " + e.params.additionalProperty;
    }
    if (e.keyword === "type") {
      return "Expected type " + e.params.type;
    }
    if (e.keyword === "minimum" || e.keyword === "exclusiveMinimum" ||
        e.keyword === "maximum" || e.keyword === "exclusiveMaximum") {
      return "Numeric bound violated: " + msg;
    }
    if (e.keyword === "pattern") {
      return "String does not match required pattern (" + e.params.pattern + ")";
    }
    return msg;
  }

  // ─── Stage 2: physical-plausibility validation ──────────────────────────

  function _runPlausibilityValidation(doc, options) {
    var errors = [];
    var warnings = [];

    // ── 2.0 LSP schema version compatibility ──
    // The validator was authored against schema version 1.0.0 and is
    // forward-compatible with 1.x.x minor or patch versions per SemVer policy.
    // Documents declaring 0.x.x or 2.x.x or higher are accepted (the schema
    // matches), but a warning is emitted so the user knows the validator may
    // not understand fields specific to that version.
    if (doc && typeof doc.lsp_version === "string") {
      var versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(doc.lsp_version);
      if (versionMatch) {
        var majorVersion = parseInt(versionMatch[1], 10);
        if (majorVersion !== 1) {
          warnings.push({
            code: ERROR_CODES.UNKNOWN_LSP_VERSION,
            path: "/lsp_version",
            message: "Document declares lsp_version " + doc.lsp_version +
              ", but this validator was authored against the 1.x.x schema. " +
              "Validation may not catch issues specific to other major versions."
          });
        }
      }
    }

    // ── 2.1 Pulsed-mode laser consistency ──
    // The schema accepts `pulse: null` and accepts the absence of the `pulse`
    // field entirely. Both are invalid for a pulsed laser. We require an
    // actual pulse object with both required fields populated.
    if (doc.laser && doc.laser.pulse_mode === "pulsed") {
      var p = doc.laser.pulse;
      if (!p || typeof p !== "object" ||
          !_isFiniteNumber(p.repetition_rate_hz) || p.repetition_rate_hz <= 0 ||
          !_isFiniteNumber(p.pulse_duration_s) || p.pulse_duration_s <= 0) {
        errors.push({
          code: ERROR_CODES.PULSE_BLOCK_MISSING,
          path: "/laser/pulse",
          message: "pulse_mode is 'pulsed' but the laser.pulse block is missing, null, or " +
            "lacks the required repetition_rate_hz and pulse_duration_s fields."
        });
      }
    }

    // ── 2.2 Unit conversion support ──
    // Phase 1 supports only length=mm and power=W internally. Other units are
    // accepted by the schema but we warn aggressively so the user knows the
    // pipeline will convert on import.
    if (doc.meta && doc.meta.units) {
      var u = doc.meta.units;
      if (u.length !== "mm") {
        warnings.push({
          code: ERROR_CODES.UNIT_CONVERSION_UNSUPPORTED,
          path: "/meta/units/length",
          message: "Length unit is " + u.length + "; will be converted to mm on import. " +
            "Phase 1 supports mm natively. um conversion is supported; rad and V require calibration."
        });
        if (u.length === "rad" || u.length === "V") {
          errors.push({
            code: ERROR_CODES.UNIT_CONVERSION_UNSUPPORTED,
            path: "/meta/units/length",
            message: "Length unit " + u.length + " requires a calibration block (not yet supported in Phase 1)."
          });
        }
      }
      if (u.power !== "W") {
        warnings.push({
          code: ERROR_CODES.UNIT_CONVERSION_UNSUPPORTED,
          path: "/meta/units/power",
          message: "Power unit is " + u.power + "; will be converted to W on import. " +
            "Phase 1 supports W natively. mW conversion is supported; normalized and percent require an explicit max-power reference."
        });
        if (u.power === "normalized" || u.power === "percent") {
          errors.push({
            code: ERROR_CODES.UNIT_CONVERSION_UNSUPPORTED,
            path: "/meta/units/power",
            message: "Power unit " + u.power + " requires a max-power reference (not yet supported in Phase 1)."
          });
        }
      }
    }

    // ── 2.3 Segment count cap ──
    if (doc.pattern && Array.isArray(doc.pattern.segments)) {
      if (doc.pattern.segments.length > options.maxSegments) {
        errors.push({
          code: ERROR_CODES.SEGMENT_OVER_CAP,
          path: "/pattern/segments",
          message: "Segment count " + doc.pattern.segments.length +
            " exceeds the per-document cap of " + options.maxSegments
        });
      }
    }

    // ── 2.3a Duplicate segment IDs ──
    // The schema enforces id ≥ 0 and integer-typed; uniqueness is enforced here.
    // Duplicate ids would confuse any downstream editor or visualizer that
    // identifies segments by id, so we surface this as a hard error.
    if (doc.pattern && Array.isArray(doc.pattern.segments) && doc.pattern.segments.length > 1) {
      var seenIds = Object.create(null);
      for (var di = 0; di < doc.pattern.segments.length; di++) {
        var dseg = doc.pattern.segments[di];
        if (dseg && typeof dseg.id === "number") {
          if (seenIds[dseg.id] !== undefined) {
            errors.push({
              code: ERROR_CODES.DUPLICATE_SEGMENT_ID,
              path: "/pattern/segments/" + di + "/id",
              message: "Segment id " + dseg.id + " is duplicated (first seen at index " +
                seenIds[dseg.id] + ", duplicated at index " + di + ")"
            });
          } else {
            seenIds[dseg.id] = di;
          }
        }
      }
    }

    // ── 2.3b Authoritative=parameterized requires a non-empty parameterized block ──
    // If the user declares the parameterized form authoritative but does not
    // provide a parameterized block, the canonicalization pipeline will silently
    // fall back to segments-mode routing, which may surprise the user. Surface
    // this as a hard error.
    if (doc.pattern && doc.pattern.authoritative === "parameterized") {
      if (!Array.isArray(doc.pattern.parameterized) || doc.pattern.parameterized.length === 0) {
        errors.push({
          code: ERROR_CODES.AUTHORITATIVE_PARAMETERIZED_EMPTY,
          path: "/pattern/parameterized",
          message: "pattern.authoritative is 'parameterized' but pattern.parameterized is " +
            "missing or empty. Either supply a parameterized shape definition or change " +
            "pattern.authoritative to 'segments' or 'samples'."
        });
      }
    }

    // ── 2.4 Sample-array consistency and cap ──
    if (doc.pattern && doc.pattern.samples) {
      var s = doc.pattern.samples;
      if (Array.isArray(s.x) && Array.isArray(s.y)) {
        var n = s.x.length;
        if (s.y.length !== n) {
          errors.push({
            code: ERROR_CODES.SAMPLES_ARRAY_LENGTH_MISMATCH,
            path: "/pattern/samples/y",
            message: "samples.y has " + s.y.length + " elements but samples.x has " + n
          });
        }
        if (Array.isArray(s.z) && s.z.length !== n) {
          errors.push({
            code: ERROR_CODES.SAMPLES_ARRAY_LENGTH_MISMATCH,
            path: "/pattern/samples/z",
            message: "samples.z has " + s.z.length + " elements but samples.x has " + n
          });
        }
        if (Array.isArray(s.power) && s.power.length !== n) {
          errors.push({
            code: ERROR_CODES.SAMPLES_ARRAY_LENGTH_MISMATCH,
            path: "/pattern/samples/power",
            message: "samples.power has " + s.power.length + " elements but samples.x has " + n
          });
        }
        if (Array.isArray(s.blanked) && s.blanked.length !== n) {
          errors.push({
            code: ERROR_CODES.SAMPLES_ARRAY_LENGTH_MISMATCH,
            path: "/pattern/samples/blanked",
            message: "samples.blanked has " + s.blanked.length + " elements but samples.x has " + n
          });
        }
        if (n > options.maxSamples) {
          errors.push({
            code: ERROR_CODES.SAMPLES_OVER_CAP,
            path: "/pattern/samples",
            message: "Sample count " + n + " exceeds the per-document cap of " + options.maxSamples
          });
        }
      }
    }

    // ── 2.5 Finite-number sweep of coordinate and amplitude fields ──
    _checkFiniteNumbers(doc, errors);

    // ── 2.6 Bounding-box check ──
    if (doc.meta && doc.meta.extent_bbox && doc.pattern) {
      _checkBoundingBox(doc, options.boundingBoxSlack, errors, warnings);
    }

    // ── 2.7 Total-duration ratio check ──
    if (doc.exposure && doc.pattern && Array.isArray(doc.pattern.segments)) {
      _checkDurationRatio(doc, options.durationRatioCap, warnings);
    }

    // ── 2.8 Degenerate segment check ──
    if (doc.pattern && Array.isArray(doc.pattern.segments)) {
      _checkDegenerateSegments(doc.pattern.segments, warnings);
    }

    return {errors: errors, warnings: warnings};
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _isFiniteNumber(x) {
    return typeof x === "number" && isFinite(x);
  }

  function _checkFiniteNumbers(doc, errors) {
    // Walk segment and sample coordinate fields; emit one error per non-finite
    // value. This catches the case where a generator emitted "NaN" as a string
    // or null, which the schema's type:number constraint will already have
    // caught — but if the generator emitted a number that happens to be NaN
    // or ±Infinity, JSON.parse will not produce one (JSON has no NaN literal),
    // so this check is a defence in depth.
    var segs = doc.pattern && doc.pattern.segments;
    if (Array.isArray(segs)) {
      for (var i = 0; i < segs.length; i++) {
        var seg = segs[i];
        _checkCoordPair(seg.p0, "/pattern/segments/" + i + "/p0", errors);
        if (seg.p1) _checkCoordPair(seg.p1, "/pattern/segments/" + i + "/p1", errors);
        if (seg.center) _checkCoordPair(seg.center, "/pattern/segments/" + i + "/center", errors);
        if (seg.sweep_rad !== undefined && !_isFiniteNumber(seg.sweep_rad)) {
          errors.push({
            code: ERROR_CODES.NON_FINITE_NUMBER,
            path: "/pattern/segments/" + i + "/sweep_rad",
            message: "sweep_rad is not a finite number"
          });
        }
        if (seg.duration_s !== undefined && !_isFiniteNumber(seg.duration_s)) {
          errors.push({
            code: ERROR_CODES.NON_FINITE_NUMBER,
            path: "/pattern/segments/" + i + "/duration_s",
            message: "duration_s is not a finite number"
          });
        }
      }
    }
    var samp = doc.pattern && doc.pattern.samples;
    if (samp && Array.isArray(samp.x)) {
      for (var k = 0; k < samp.x.length; k++) {
        if (!_isFiniteNumber(samp.x[k])) {
          errors.push({
            code: ERROR_CODES.NON_FINITE_NUMBER,
            path: "/pattern/samples/x/" + k,
            message: "x[" + k + "] is not a finite number"
          });
          break; // one error per array is enough
        }
      }
    }
    if (samp && Array.isArray(samp.y)) {
      for (var m = 0; m < samp.y.length; m++) {
        if (!_isFiniteNumber(samp.y[m])) {
          errors.push({
            code: ERROR_CODES.NON_FINITE_NUMBER,
            path: "/pattern/samples/y/" + m,
            message: "y[" + m + "] is not a finite number"
          });
          break;
        }
      }
    }
  }

  function _checkCoordPair(pair, path, errors) {
    if (!Array.isArray(pair)) return;
    for (var i = 0; i < pair.length; i++) {
      if (!_isFiniteNumber(pair[i])) {
        errors.push({
          code: ERROR_CODES.NON_FINITE_NUMBER,
          path: path + "/" + i,
          message: "coordinate component is not a finite number"
        });
      }
    }
  }

  function _checkBoundingBox(doc, slack, errors, warnings) {
    var bbox = doc.meta.extent_bbox;
    if (!Array.isArray(bbox) || bbox.length !== 2 ||
        !Array.isArray(bbox[0]) || !Array.isArray(bbox[1])) return;
    var xmin = bbox[0][0], ymin = bbox[0][1];
    var xmax = bbox[1][0], ymax = bbox[1][1];
    if (!_isFiniteNumber(xmin) || !_isFiniteNumber(ymin) ||
        !_isFiniteNumber(xmax) || !_isFiniteNumber(ymax)) return;
    var width = xmax - xmin, height = ymax - ymin;
    var slackX = slack * width, slackY = slack * height;
    var minSlack = Math.max(slackX, 1e-9);
    var minSlackY = Math.max(slackY, 1e-9);

    // Aggregate count of out-of-bbox points across the entire pattern, with the
    // first violating coordinate captured for the warning message. Firing once
    // per segment would produce excessive noise on large patterns.
    var oobCount = 0;
    var firstOobPath = "";
    var firstOobCoord = null;

    function check(pt, path) {
      if (!Array.isArray(pt) || pt.length < 2) return;
      var px = pt[0], py = pt[1];
      if (px < xmin - minSlack || px > xmax + minSlack ||
          py < ymin - minSlackY || py > ymax + minSlackY) {
        if (oobCount === 0) {
          firstOobPath = path;
          firstOobCoord = [px, py];
        }
        oobCount++;
      }
    }

    var segs = doc.pattern && doc.pattern.segments;
    if (Array.isArray(segs)) {
      for (var i = 0; i < segs.length; i++) {
        var seg = segs[i];
        check(seg.p0, "/pattern/segments/" + i + "/p0");
        if (seg.p1) check(seg.p1, "/pattern/segments/" + i + "/p1");
      }
    }

    if (oobCount > 0) {
      warnings.push({
        code: ERROR_CODES.BBOX_VIOLATION,
        path: firstOobPath,
        message: oobCount === 1
          ? "Coordinate (" + firstOobCoord[0] + ", " + firstOobCoord[1] +
            ") falls outside declared extent_bbox"
          : oobCount + " coordinates fall outside declared extent_bbox " +
            "(first at " + firstOobPath + ": [" + firstOobCoord[0] + ", " + firstOobCoord[1] + "])"
      });
    }

    var samp = doc.pattern && doc.pattern.samples;
    if (samp && Array.isArray(samp.x) && Array.isArray(samp.y)) {
      // Sample-by-sample check is too noisy; instead, find the array extents
      // and compare those once.
      var sxmin = Infinity, sxmax = -Infinity, symin = Infinity, symax = -Infinity;
      for (var j = 0; j < samp.x.length; j++) {
        var x = samp.x[j], y = samp.y[j];
        if (_isFiniteNumber(x)) { if (x < sxmin) sxmin = x; if (x > sxmax) sxmax = x; }
        if (_isFiniteNumber(y)) { if (y < symin) symin = y; if (y > symax) symax = y; }
      }
      if (sxmin < xmin - minSlack || sxmax > xmax + minSlack ||
          symin < ymin - minSlackY || symax > ymax + minSlackY) {
        warnings.push({
          code: ERROR_CODES.BBOX_VIOLATION,
          path: "/pattern/samples",
          message: "Sample-array extent (x: [" + sxmin + ", " + sxmax + "], " +
            "y: [" + symin + ", " + symax + "]) exceeds declared extent_bbox"
        });
      }
    }
  }

  function _segmentDuration(seg, defaultVel) {
    if (seg.type === "dwell") {
      return _isFiniteNumber(seg.duration_s) ? seg.duration_s : 0;
    }
    if (seg.type === "line" || seg.type === "move") {
      if (!Array.isArray(seg.p0) || !Array.isArray(seg.p1)) return 0;
      var dx = seg.p1[0] - seg.p0[0], dy = seg.p1[1] - seg.p0[1];
      var len = Math.sqrt(dx * dx + dy * dy);
      var v = _resolveVelocity(seg, defaultVel);
      if (!_isFiniteNumber(v) || v <= 0) return 0;
      // For linear_ramp, average velocity = (v_start + v_end)/2; len/v_avg
      if (seg.velocity && seg.velocity.mode === "linear_ramp") {
        var v0 = seg.velocity.v_start_mm_per_s;
        var v1 = seg.velocity.v_end_mm_per_s;
        var vavg = (v0 + v1) / 2;
        if (_isFiniteNumber(vavg) && vavg > 0) return len / vavg;
      }
      return len / v;
    }
    if (seg.type === "arc") {
      if (!Array.isArray(seg.p0) || !Array.isArray(seg.center) ||
          !_isFiniteNumber(seg.sweep_rad)) return 0;
      var rx = seg.p0[0] - seg.center[0], ry = seg.p0[1] - seg.center[1];
      var r = Math.sqrt(rx * rx + ry * ry);
      var arclen = r * Math.abs(seg.sweep_rad);
      var vv = _resolveVelocity(seg, defaultVel);
      if (!_isFiniteNumber(vv) || vv <= 0) return 0;
      return arclen / vv;
    }
    return 0;
  }

  function _resolveVelocity(seg, defaultVel) {
    if (!seg.velocity) return defaultVel;
    if (seg.velocity.mode === "constant") return seg.velocity.value_mm_per_s;
    if (seg.velocity.mode === "linear_ramp") {
      var v0 = seg.velocity.v_start_mm_per_s;
      var v1 = seg.velocity.v_end_mm_per_s;
      if (_isFiniteNumber(v0) && _isFiniteNumber(v1)) return (v0 + v1) / 2;
    }
    if (seg.velocity.mode === "inherit") return defaultVel;
    return defaultVel;
  }

  function _checkDurationRatio(doc, cap, warnings) {
    var T_window = doc.exposure.exposure_duration_s;
    var defaultVel = doc.pattern.default_velocity_mm_s;
    var segs = doc.pattern.segments;
    if (!Array.isArray(segs)) return;
    var total = 0;
    for (var i = 0; i < segs.length; i++) {
      total += _segmentDuration(segs[i], defaultVel);
    }
    // Apply loop defaults explicitly since Ajv does not fill in schema-level
    // defaults unless configured with {useDefaults: true}, and we deliberately
    // run Ajv without that option to preserve documents byte-for-byte across
    // validation. The defaults match those declared in the schema.
    if (doc.pattern.loop && doc.pattern.loop.enabled === true) {
      var c = (typeof doc.pattern.loop.count === "number" && doc.pattern.loop.count >= 1)
        ? doc.pattern.loop.count : 1;
      var gap = (typeof doc.pattern.loop.frame_gap_s === "number" && doc.pattern.loop.frame_gap_s >= 0)
        ? doc.pattern.loop.frame_gap_s : 0;
      if (c > 1) {
        total = total * c + gap * (c - 1);
      }
    }
    if (total > T_window * cap) {
      warnings.push({
        code: ERROR_CODES.DURATION_RATIO_EXCEEDED,
        path: "/pattern",
        message: "Total path duration (" + total.toFixed(3) + " s) exceeds exposure window (" +
          T_window + " s) by more than " + cap + "× — this may indicate a unit error or a misconfigured pattern"
      });
    }
  }

  function _checkDegenerateSegments(segs, warnings) {
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if ((seg.type === "line" || seg.type === "move") &&
          Array.isArray(seg.p0) && Array.isArray(seg.p1)) {
        var dx = seg.p1[0] - seg.p0[0], dy = seg.p1[1] - seg.p0[1];
        if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
          warnings.push({
            code: ERROR_CODES.SEGMENT_DEGENERATE,
            path: "/pattern/segments/" + i,
            message: "Segment has zero length (p0 == p1)"
          });
        }
      }
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  function validate(doc, options) {
    options = options || {};
    var opts = {
      maxSamples: options.maxSamples != null ? options.maxSamples : DEFAULT_OPTIONS.maxSamples,
      maxSegments: options.maxSegments != null ? options.maxSegments : DEFAULT_OPTIONS.maxSegments,
      boundingBoxSlack: options.boundingBoxSlack != null ? options.boundingBoxSlack : DEFAULT_OPTIONS.boundingBoxSlack,
      durationRatioCap: options.durationRatioCap != null ? options.durationRatioCap : DEFAULT_OPTIONS.durationRatioCap
    };

    if (doc == null || typeof doc !== "object" || Array.isArray(doc)) {
      return {
        ok: false,
        value: null,
        errors: [{
          code: ERROR_CODES.INTERNAL_ERROR,
          path: "",
          message: "Input is not a JSON object"
        }],
        warnings: []
      };
    }

    var stage1 = _runSchemaValidation(doc);
    if (stage1.length > 0) {
      return {ok: false, value: null, errors: stage1, warnings: []};
    }

    var stage2;
    try {
      stage2 = _runPlausibilityValidation(doc, opts);
    } catch (err) {
      return {
        ok: false,
        value: null,
        errors: [{
          code: ERROR_CODES.INTERNAL_ERROR,
          path: "",
          message: "Plausibility check threw: " + (err.message || err)
        }],
        warnings: []
      };
    }

    return {
      ok: stage2.errors.length === 0,
      value: stage2.errors.length === 0 ? doc : null,
      errors: stage2.errors,
      warnings: stage2.warnings
    };
  }

  // ─── Module exports ──────────────────────────────────────────────────────

  var LSPValidate = {
    validate: validate,
    ERROR_CODES: ERROR_CODES,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    // Exposed for testing: lets a test harness inject a pre-compiled validator.
    _setCompiledValidator: function (fn) { _compiledValidator = fn; _compileError = null; },
    _resetCompiled: function () { _compiledValidator = null; _compileError = null; }
  };

  // BUILD_STRIP_START
  if (typeof module !== "undefined" && module.exports && typeof require === "function") {
    module.exports = LSPValidate;
  }
  // BUILD_STRIP_END

  if (typeof root !== "undefined") {
    root.LSPValidate = LSPValidate;
  }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
