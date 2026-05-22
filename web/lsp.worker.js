/**
 * web/lsp.worker.js
 *
 * Web Worker that owns the canonicalization step of the LSP-JSON pipeline.
 *
 * ─── Why a worker? ─────────────────────────────────────────────────────────
 * Canonicalization (LSPCanonicalize.canonicalize) iterates through every
 * segment in an LSP document and chops each into beam-diameter pieces.  On
 * realistic clinical patterns this can produce tens of thousands of engine
 * segments and take 50-500 ms.  Running that on the main thread would freeze
 * the UI long enough for the user to notice.  This worker isolates the cost.
 *
 * ─── What runs where? ──────────────────────────────────────────────────────
 * Stage 1 (schema validation, requires Ajv) and Stage 2 (plausibility checks,
 * pure JavaScript) BOTH run on the main thread before the document is posted
 * here.  Validation is fast (under 10 ms on documents up to 10,000 segments)
 * and keeping it on the main thread avoids loading Ajv into the worker
 * context, which would require a JS bundler for offline operation.  This
 * worker assumes the document it receives has already passed full validation;
 * if validation is somehow skipped, canonicalization will still reject
 * malformed input via its own defensive structural checks, so safety is
 * preserved at the cost of less specific error messages.
 *
 * ─── Message protocol ─────────────────────────────────────────────────────
 *
 * Inbound: { type: "init", requestId, standard }
 *   - requestId : number; echoed in response
 *   - standard  : parsed JSON object of the ICNIRP standard table
 *
 * Outbound: { type: "init_result", requestId, ok, error?, errorCode?, errors? }
 *   - ok        : boolean; true on success
 *   On failure (ok === false), all three of the following are populated with
 *   the same diagnostic information in different shapes for client convenience:
 *   - error     : string; human-readable diagnostic message (equals errors[0].message)
 *   - errorCode : string; machine-readable code (equals errors[0].code).  One of:
 *                 "ENGINE_NOT_LOADED" (build script did not inline a required
 *                 source), "PROTOCOL_ERROR" (init message missing 'standard'),
 *                 "INTERNAL_ERROR" (loadStandard threw).
 *   - errors    : array of {code, path, message} — same shape as
 *                 canonicalize_result.errors, so client code can route both
 *                 response types through one error-handling path if desired.
 *
 * Inbound: { type: "canonicalize", requestId, doc, options? }
 *   - requestId : number; echoed in response
 *   - doc       : a validated LSP-JSON document (NOTE: the standard is not
 *                 sent here — it was loaded once during init)
 *   - options   : optional { maxEngineSegments?: number }
 *
 * Outbound: { type: "canonicalize_result", requestId, ok, ... }
 *   If ok === true:
 *     beam           : engine-format beam object (full-name fields)
 *     engineSegments : array of engine-native segments
 *     scanParams     : separable scan params, or null if not applicable
 *     totalTime_s    : total integrated time across all segments
 *     warnings       : array of {code, path, message}
 *   If ok === false:
 *     errors         : array of {code, path, message}
 *
 * Outbound: { type: "error", requestId, ok: false, errors }
 *   - Sent ONLY when the worker receives a protocol violation (malformed
 *     message envelope, unknown message type, etc).  Distinct from the
 *     handler-specific "init_result" / "canonicalize_result" types so the
 *     caller can route the response by type.
 *
 * Outbound error codes:
 *   PROTOCOL_ERROR          — malformed envelope (no .data, non-object,
 *                             missing required field, unknown type)
 *   WORKER_NOT_INITIALIZED  — canonicalize sent before init succeeded
 *   INTERNAL_ERROR          — unexpected exception (canonicalize threw,
 *                             returned non-object, returned null, etc)
 *   ENGINE_NOT_LOADED       — init invoked but self.MPEEngine missing
 *                             (build script did not inline engine source)
 *   PAYLOAD_TOO_LARGE       — canonicalize doc exceeded the byte-size cap
 *                             (defense in depth against runaway memory use)
 *   Plus all error codes from LSPCanonicalize.ERROR_CODES (UNSUPPORTED_SHAPE,
 *   SEGMENT_OVERFLOW, ARC_NOT_SUPPORTED, etc).
 *
 * If LSPCanonicalize.canonicalize throws (which its contract says it never
 * does, but defense in depth) the worker catches the throw and returns
 * ok=false with INTERNAL_ERROR.  If postMessage itself fails (structured
 * clone failure on the result payload) we attempt one fallback response
 * containing only safe primitives before giving up.
 *
 * ─── Source assembly ──────────────────────────────────────────────────────
 *
 * This file is the third script loaded into the Worker context, after the
 * engine and the canonicalize module.  The build script (web/build.py)
 * concatenates the following sources in order via __createLSPWorker():
 *   1. __ENGINE_SOURCE__       — provides self.MPEEngine
 *   2. __LSP_CANONICALIZE_SRC__ — provides self.LSPCanonicalize
 *   3. __LSP_WORKER_SRC__      — this file; registers a message handler
 *                                via self.addEventListener('message', ...)
 *                                (falls back to self.onmessage if needed)
 *
 * Future commits in Sub-phase 1D may add __LSP_VALIDATE_SOURCE__ to enable
 * worker-side validation, but commit 1 keeps validation on the main thread.
 *
 * In Node-side unit tests, the test harness loads these sources into a
 * vm-sandboxed context that mimics the worker's `self` global, then drives
 * _processMessage directly without involving a real Worker.
 */

(function () {
  "use strict";

  // ─── Configuration ───
  // Defense-in-depth payload-size cap.  A malicious or buggy main thread
  // could post a document large enough to exhaust the worker's memory; the
  // worker checks the serialized size and rejects oversized documents with
  // a structured PAYLOAD_TOO_LARGE error rather than attempting to process
  // them.  10 MB is far above realistic clinical use (a 100k-segment
  // document with all metadata is typically under 5 MB) and far below
  // anything that could threaten the worker's memory budget.
  var MAX_DOC_BYTES = 10 * 1024 * 1024;

  // ─── State: populated by the init message ───
  var _initialized = false;
  var _initError = null;

  /**
   * Process an inbound message.  Designed so that a Node-side test harness can
   * call _processMessage({data: msg}) directly without involving a real worker.
   */
  function _processMessage(event) {
    var msg = event && event.data ? event.data : null;
    if (!msg || typeof msg !== "object") {
      _respond({
        type: "error",
        requestId: -1,
        ok: false,
        errors: [{
          code: "PROTOCOL_ERROR",
          path: "",
          message: "Worker received message with no .data field or non-object payload"
        }]
      });
      return;
    }
    var requestId = (typeof msg.requestId === "number") ? msg.requestId : -1;

    try {
      if (msg.type === "init") {
        _handleInit(msg, requestId);
      } else if (msg.type === "canonicalize") {
        _handleCanonicalize(msg, requestId);
      } else {
        _respond({
          type: "error",
          requestId: requestId,
          ok: false,
          errors: [{
            code: "PROTOCOL_ERROR",
            path: "/type",
            message: "Unknown message type: " +
              (typeof msg.type === "string" ? msg.type : String(msg.type))
          }]
        });
      }
    } catch (err) {
      // Last-resort catch.  _handleCanonicalize and _handleInit each catch
      // their own exceptions, so reaching this branch indicates a bug.
      _respond({
        type: "error",
        requestId: requestId,
        ok: false,
        errors: [{
          code: "INTERNAL_ERROR",
          path: "",
          message: "Unhandled exception in worker: " +
            (err && err.message ? err.message : String(err))
        }]
      });
    }
  }

  function _handleInit(msg, requestId) {
    try {
      if (typeof self.MPEEngine === "undefined") {
        _respond(_makeInitError(requestId, "ENGINE_NOT_LOADED",
          "MPEEngine is not loaded in the worker context. " +
          "Did the build script inline __ENGINE_SOURCE__?"));
        return;
      }
      if (typeof self.LSPCanonicalize === "undefined") {
        _respond(_makeInitError(requestId, "ENGINE_NOT_LOADED",
          "LSPCanonicalize is not loaded in the worker context. " +
          "Did the build script inline __LSP_CANONICALIZE_SRC__?"));
        return;
      }
      if (!msg.standard || typeof msg.standard !== "object") {
        _respond(_makeInitError(requestId, "PROTOCOL_ERROR",
          "init message must include a parsed 'standard' object"));
        return;
      }
      self.MPEEngine.loadStandard(msg.standard);
      _initialized = true;
      _initError = null;
      _respond({type: "init_result", requestId: requestId, ok: true});
    } catch (err) {
      _respond(_makeInitError(requestId, "INTERNAL_ERROR",
        err && err.message ? err.message : String(err)));
    }
  }

  /**
   * Build a consistent init failure response.  Uses the same errors-array
   * shape as canonicalize_result for a uniform client-side parsing contract,
   * while ALSO retaining the legacy top-level error/errorCode fields so
   * existing main-thread code that reads response.error keeps working.
   */
  function _makeInitError(requestId, code, message) {
    _initError = code;
    return {
      type: "init_result",
      requestId: requestId,
      ok: false,
      error: message,         // legacy field — same as errors[0].message
      errorCode: code,        // legacy field — same as errors[0].code
      errors: [{code: code, path: "", message: message}]
    };
  }

  function _handleCanonicalize(msg, requestId) {
    if (!_initialized) {
      _respond({
        type: "canonicalize_result",
        requestId: requestId,
        ok: false,
        errors: [{
          code: "WORKER_NOT_INITIALIZED",
          path: "",
          message: "Worker received canonicalize message before init. " +
            "Main thread must send {type:'init', standard:...} first."
        }]
      });
      return;
    }
    if (!msg.doc || typeof msg.doc !== "object" || Array.isArray(msg.doc)) {
      _respond({
        type: "canonicalize_result",
        requestId: requestId,
        ok: false,
        errors: [{
          code: "PROTOCOL_ERROR",
          path: "/doc",
          message: "canonicalize message must include a non-array 'doc' object"
        }]
      });
      return;
    }

    // Defense-in-depth payload-size check.  The estimator walks the
    // document structure without materializing a serialized copy, so an
    // adversarial 50 MB document is rejected without first allocating
    // another 50 MB of stringified form.  See _estimateDocSize.
    var estimatedBytes = _estimateDocSize(msg.doc);
    if (estimatedBytes > MAX_DOC_BYTES) {
      _respond({
        type: "canonicalize_result",
        requestId: requestId,
        ok: false,
        errors: [{
          code: "PAYLOAD_TOO_LARGE",
          path: "",
          message: "Document estimated at " + estimatedBytes + " bytes exceeds the " +
            MAX_DOC_BYTES + "-byte worker cap.  Reduce pattern resolution or split " +
            "the document into smaller pieces."
        }]
      });
      return;
    }

    var options = (msg.options && typeof msg.options === "object") ? msg.options : {};

    // LSPCanonicalize.canonicalize is contracted to never throw (it has its
    // own top-level try-catch), but we wrap defensively anyway.
    var result;
    try {
      result = self.LSPCanonicalize.canonicalize(msg.doc, options);
    } catch (err) {
      _respond({
        type: "canonicalize_result",
        requestId: requestId,
        ok: false,
        errors: [{
          code: "INTERNAL_ERROR",
          path: "",
          message: "LSPCanonicalize.canonicalize unexpectedly threw: " +
            (err && err.message ? err.message : String(err))
        }]
      });
      return;
    }

    if (!result || typeof result !== "object") {
      _respond({
        type: "canonicalize_result",
        requestId: requestId,
        ok: false,
        errors: [{
          code: "INTERNAL_ERROR",
          path: "",
          message: "LSPCanonicalize.canonicalize returned a non-object: " +
            String(result)
        }]
      });
      return;
    }

    if (!result.ok) {
      _respond({
        type: "canonicalize_result",
        requestId: requestId,
        ok: false,
        errors: result.errors || [{
          code: "INTERNAL_ERROR",
          path: "",
          message: "Canonicalization failed but returned no errors array"
        }]
      });
      return;
    }

    // Success.  Build the response payload, taking care to send only
    // structured-cloneable values (no functions, no DOM refs).
    _respond({
      type: "canonicalize_result",
      requestId: requestId,
      ok: true,
      beam: result.beam,
      engineSegments: result.engineSegments,
      scanParams: result.scanParams,
      totalTime_s: result.totalTime_s,
      warnings: result.warnings || []
    });
  }

  /**
   * Estimate document byte size without allocating a serialized copy.
   *
   * The schema allows additionalProperties:true on the top-level document
   * and on the meta block, so adversarial input could include an arbitrarily
   * large field (e.g. meta.adversarial_payload = "<10 MB string>").  A
   * defense-in-depth size guard that materializes the document via
   * JSON.stringify would itself allocate 2x the document size and could
   * OOM the worker before its own check fires.  Instead we walk the
   * structure and accumulate an in-memory-size estimate without
   * materializing anything.
   *
   * The walk uses iterative depth-first traversal with an explicit stack
   * (no recursion — recursive walks blow the call stack on pathological
   * inputs).  The walk short-circuits as soon as the running estimate
   * exceeds the cap; in the worst case (cap-sized document) the walk
   * touches every node once, but normal documents touch only a few
   * hundred nodes regardless of segment count because the segments are
   * counted structurally before the walk begins.
   *
   * In-memory-size estimates (UTF-16 strings, 8-byte numbers, etc.) are
   * the dominant cost in V8/SpiderMonkey/JavaScriptCore.  The estimate
   * is conservative — it always reports >= the actual structured-clone
   * size — so any value that passes the cap is genuinely small enough
   * to process.
   */
  function _estimateDocSize(doc) {
    // Structural fast path: the bulk of realistic documents is the
    // segments array or the samples arrays.  Estimate those by length
    // alone, then walk the rest of the structure for everything else.
    var structuralBytes = 1024;  // base allocation for top-level keys
    var skipPaths = null;  // set of object identities to skip during walk
    if (doc && typeof doc === "object" && doc.pattern &&
        typeof doc.pattern === "object") {
      if (Array.isArray(doc.pattern.segments)) {
        structuralBytes += doc.pattern.segments.length * 256;
      }
      if (doc.pattern.samples && typeof doc.pattern.samples === "object") {
        var s = doc.pattern.samples;
        if (Array.isArray(s.x)) structuralBytes += s.x.length * 16;
        if (Array.isArray(s.y)) structuralBytes += s.y.length * 16;
        if (Array.isArray(s.power)) structuralBytes += s.power.length * 16;
        if (Array.isArray(s.blanked)) structuralBytes += s.blanked.length * 4;
      }
    }
    if (structuralBytes > MAX_DOC_BYTES) {
      return structuralBytes;
    }

    // Walk the rest of the document with an explicit stack.  Skip the
    // pattern.segments and pattern.samples arrays (already counted) by
    // tracking their object identities.  Use Set for O(1) lookup; falling
    // back to a Map-of-WeakRef would be more memory-efficient but Set is
    // sufficient given the early-exit at the cap.
    var skipSet = (typeof Set !== "undefined") ? new Set() : null;
    var skipList = skipSet ? null : [];
    function _markSkip(o) { if (skipSet) skipSet.add(o); else skipList.push(o); }
    function _isSkipped(o) {
      if (skipSet) return skipSet.has(o);
      for (var i = 0; i < skipList.length; i++) if (skipList[i] === o) return true;
      return false;
    }
    if (doc && doc.pattern && typeof doc.pattern === "object") {
      if (Array.isArray(doc.pattern.segments)) _markSkip(doc.pattern.segments);
      if (doc.pattern.samples && typeof doc.pattern.samples === "object") {
        _markSkip(doc.pattern.samples);
      }
    }

    // Cycle detection: stop the walk if we revisit an object.  Without
    // this, a circular reference (which can occur if a buggy caller posts
    // a doc with a cycle) would loop forever.  In practice structured
    // clone strips cycles, but the same code runs in tests where cycles
    // are possible.
    var visitedSet = (typeof Set !== "undefined") ? new Set() : null;
    var visitedList = visitedSet ? null : [];
    function _markVisited(o) { if (visitedSet) visitedSet.add(o); else visitedList.push(o); }
    function _isVisited(o) {
      if (visitedSet) return visitedSet.has(o);
      for (var j = 0; j < visitedList.length; j++) if (visitedList[j] === o) return true;
      return false;
    }

    var stack = [doc];
    var walkedBytes = 0;
    while (stack.length > 0) {
      var node = stack.pop();
      if (node === null || node === undefined) continue;
      var t = typeof node;
      if (t === "string") {
        // UTF-16 strings: ~2 bytes per code unit.  Add a small constant
        // for object-header overhead.
        walkedBytes += 16 + node.length * 2;
      } else if (t === "number") {
        walkedBytes += 8;
      } else if (t === "boolean") {
        walkedBytes += 4;
      } else if (t === "bigint") {
        // BigInts can be arbitrarily large; structured-clone supports them
        // and a malicious doc could include a multi-megabyte BigInt under
        // a meta field.  We charge by the string representation length to
        // bound the attack.
        walkedBytes += 16 + String(node).length * 2;
      } else if (t === "object") {
        if (_isSkipped(node)) continue;
        if (_isVisited(node)) continue;
        _markVisited(node);
        if (Array.isArray(node)) {
          walkedBytes += 16 + node.length * 8;  // array overhead + pointer per slot
          for (var ai = 0; ai < node.length; ai++) {
            stack.push(node[ai]);
          }
        } else {
          walkedBytes += 32;  // object overhead
          for (var ok in node) {
            if (!Object.prototype.hasOwnProperty.call(node, ok)) continue;
            walkedBytes += 16 + ok.length * 2;  // key string
            stack.push(node[ok]);
          }
        }
      } else {
        // symbol, function, undefined — structured clone strips these for
        // function/symbol, undefined survives as undefined.  We charge a
        // small fixed cost so unexpected types do not bypass the budget.
        walkedBytes += 16;
      }
      // Early exit: if walked alone already exceeds the cap, no need to
      // continue.  This bounds the walk cost on adversarial inputs.
      if (structuralBytes + walkedBytes > MAX_DOC_BYTES) {
        return structuralBytes + walkedBytes;
      }
    }
    return structuralBytes + walkedBytes;
  }

  /**
   * Post a message back to the main thread.  Uses postMessage when running
   * in a real Worker context; falls back to a registered callback in Node
   * tests.  Wraps postMessage in a try/catch so that a structured-clone
   * failure on the result payload does not crash the worker; in that case
   * we attempt one fallback response carrying only safe primitive fields.
   */
  function _respond(payload) {
    try {
      if (typeof self.postMessage === "function") {
        self.postMessage(payload);
      } else if (typeof self._testOnPostMessage === "function") {
        self._testOnPostMessage(payload);
      }
      // Otherwise, the response is silently dropped.  This should not happen
      // in any supported environment; if it does, the test harness will
      // catch the missing response by timing out.
    } catch (err) {
      // Structured-clone failure is the most likely cause.  Build a minimal
      // safe payload (no engineSegments, no beam) and try once more.
      var fallback = {
        type: payload && payload.type ? payload.type : "error",
        requestId: (payload && typeof payload.requestId === "number") ? payload.requestId : -1,
        ok: false,
        errors: [{
          code: "INTERNAL_ERROR",
          path: "",
          message: "Worker postMessage failed (likely structured-clone error): " +
            (err && err.message ? err.message : String(err))
        }]
      };
      try {
        if (typeof self.postMessage === "function") {
          self.postMessage(fallback);
        } else if (typeof self._testOnPostMessage === "function") {
          self._testOnPostMessage(fallback);
        }
      } catch (_e) {
        // Give up — there is nothing more the worker can do.  In a real
        // browser the main thread will detect the missing response by
        // its own timeout.
      }
    }
  }

  // ─── Wire onmessage in the real worker context ───
  // In a real Worker, self.onmessage is the standard event handler.  In the
  // Node test harness, _processMessage is called directly via the test glue.
  if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
    self.addEventListener("message", _processMessage);
  } else if (typeof self !== "undefined") {
    self.onmessage = _processMessage;
  }

  // ─── Expose for unit testing ───
  // Tests need to drive _processMessage directly and inspect responses.
  if (typeof self !== "undefined") {
    self._LSPWorker = {
      _processMessage: _processMessage,
      _isInitialized: function () { return _initialized; },
      _getInitError: function () { return _initError; }
    };
  }

  // BUILD_STRIP_START
  // Node-side export so unit tests can require() this file.  Stripped at
  // build time; in browser/worker the file is loaded by Blob URL.
  if (typeof module !== "undefined" && module.exports && typeof require === "function") {
    module.exports = {
      _processMessage: _processMessage,
      _isInitialized: function () { return _initialized; },
      _getInitError: function () { return _initError; }
    };
  }
  // BUILD_STRIP_END

})();
