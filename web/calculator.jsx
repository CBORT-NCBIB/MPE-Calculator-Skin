import { useState, useMemo, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot, ResponsiveContainer, ReferenceLine, Legend, Label } from "recharts";

/* ═══════ ENGINE BRIDGE ═══════ */
/*
 * Architecture: All calculation logic lives in engine.js (loaded separately).
 * This bridge provides short-name aliases that the UI code uses.
 * NO calculation code is duplicated here.
 *
 * Field name translation:
 *   Bridge (short)  →  Engine (full)
 *   g.flu           →  grid.fluence
 *   g.xn            →  grid.x_min_mm
 *   g.ppH           →  grid.peak_pulse_H
 *   sf.wr           →  worst_ratio
 *   sf.br           →  binding_rule
 *   st.tt           →  total_time_s
 *
 * Safety evaluation path:
 *   1. Grid computation (with pulse subsampling for high-PRF)
 *   2. Analytical peak fluence cross-check (exact, no grid approximation)
 *   3. Safety verdict uses max(grid_peak, analytical_peak)
 *   4. Rule 1 uses exact analytical H₀ = 2E/(πw²)
 *
 * CW scanning: The engine supports CW scanning (is_cw flag), but the Scanning
 * Protocols tab currently requires pulsed parameters (PRF + tau). CW scanning
 * evaluation is not yet exposed in the web interface. For CW analysis, use the
 * Python package: from laser_mpe import skin_mpe
 */
var _E = (typeof MPEEngine !== "undefined") ? MPEEngine : null;
if (!_E) { throw new Error("MPEEngine not loaded. Ensure engine.js is included before calculator.jsx."); }

/* Standard metadata (for display only — all calculations go through _E) */
var _std = (typeof __STD_DATA__ !== "undefined") ? __STD_DATA__ : {};

/* Core MPE functions */
var skinMPE = _E.skinMPE;
var CA = _E.CA;
var isInCARange = _E.isInCARange;
var isIrrPrimary = _E.isIrrPrimary;
var getLargeAreaCorrection = _E.getLargeAreaCorrection;
var largeAreaIrradianceLimit = _E.largeAreaIrradianceLimit;
var skinMPE_area = _E.skinMPE_area;
function rpCalc(wl,tau,prf,T){
  var r=_E.repPulse(wl,tau,prf,T);
  return{r1:r.rule1,r2:r.rule2,H:r.H,N:r.N,bd:r.binding};
}
function rpCalcArea(wl,tau,prf,T,area_cm2){
  var r=_E.repPulse_area(wl,tau,prf,T,area_cm2);
  return{r1:r.rule1,r2:r.rule2,H:r.H,N:r.N,bd:r.binding};
}
/** Check if a (wl, dur) pair falls in the large-area correction range.
 *  Reads applicability conditions from the loaded standard JSON. */
function isInLargeAreaRange(wl,dur){
  var lac=getLargeAreaCorrection(wl,dur);
  return lac!==null;
}
function bnd(wl){ return _E.bandName(wl); }

/* Scanning engine — adapters translate engine.js field names to short UI names */
var scanDwellGaussian = _E.scanDwellGaussian;
var scanDwellGeometric = _E.scanDwellGeometric;

function scanCompute(beam,segs,ppd,sepP){
  if(!sepP&&(!segs||!segs.length))return null;
  var eb={d_1e_mm:beam.d,wl_nm:beam.wl,tau_s:beam.tau,prf_hz:beam.prf,
    pulse_energy_J:beam.Ep,avg_power_W:beam.P,is_cw:beam.cw};
  var r=_E.computeScanFluence(eb,segs||[],ppd||8,sepP||null);
  if(!r)return null;
  var eg=r.grid,s=r.stats;
  var g={nx:eg.nx,ny:eg.ny,dx:eg.dx_mm,xn:eg.x_min_mm,yn:eg.y_min_mm,
    flu:eg.fluence,pc:eg.pulse_count,ppH:eg.peak_pulse_H,lvt:eg.last_visit_t,mrv:eg.min_revisit_s};
  var st={tt:s.total_time_s,tp:s.total_pulses||0,method:s.method};
  if(s.min_velocity!==undefined)st.mv=s.min_velocity;
  return{g:g,st:st};
}

function scanSafety(g,beam,T,dwMode,minV,scanP){
  var eg={nx:g.nx,ny:g.ny,dx_mm:g.dx,x_min_mm:g.xn,y_min_mm:g.yn,
    fluence:g.flu,pulse_count:g.pc,peak_pulse_H:g.ppH,last_visit_t:g.lvt,min_revisit_s:g.mrv};
  var eb={wl_nm:beam.wl,d_1e_mm:beam.d,tau_s:beam.tau,is_cw:beam.cw,
    pulse_energy_J:beam.Ep,prf_hz:beam.prf,avg_power_W:beam.P};
  var r=_E.evaluateScanSafety(eg,eb,T,dwMode,minV,scanP);
  return{safe:r.safe,wr:r.worst_ratio,wx:r.worst_x_mm,wy:r.worst_y_mm,
    br:r.binding_rule,sm:r.safety_margin,mt:r.mpe_tau,mT:r.mpe_T,
    pF:r.peak_fluence,ppM:r.peak_pulse_H_max,mP:r.max_pulses,
    r1m:r.rule1_max_ratio,r2m:r.rule2_max_ratio,
    minRv:r.min_revisit_s,rvPts:r.revisit_points,tauR:r.thermal_relax_s,rvOk:r.revisit_adequate,
    anPeak:r.analytical_peak,anUsed:r.analytical_used};
}

/* Scan builders — add short-name aliases so rendering code (s.x, s.y, s.a, s.v) still works */
function _addShortNames(segs){
  for(var i=0;i<segs.length;i++){var s=segs[i];s.x=s.x_start_mm;s.y=s.y_start_mm;s.a=s.angle_rad;s.v=s.v_mm_s;}
  return segs;
}
function scanBuildLinear(x0,y0,a,L,v,d){return _addShortNames(_E.buildLinearScan(x0,y0,a,L,v,d));}
function scanBuildBidi(x0,y0,lL,nL,h,sv,jv,d,bl){return _addShortNames(_E.buildBidiRasterScan(x0,y0,lL,nL,h,sv,jv,d,bl));}
function scanBuildRaster(x0,y0,lL,nL,h,sv,jv,d,bl){return _addShortNames(_E.buildRasterScan(x0,y0,lL,nL,h,sv,jv,d,bl));}
var scanMaxPulseEnergy = _E.maxPulseEnergy;
var scanMinRepRate = _E.minRepRate;

/* ═══════════════════════════════════════════════════════════════════════════
   LSP-JSON IMPORT FLOW (Sub-phase 1D)

   The LSP foundation lives in web/lsp/ (schema.json, validate.js, factory.js,
   canonicalize.js).  validate.js + schema.json are inlined into the page by
   build.py and run on the main thread.  canonicalize.js runs inside a Web
   Worker constructed by __createLSPWorker() (see build.py).

   The translation between LSP and the existing scan-content components is:

     1. User picks a .lsp.json file in the PatternSource card.
     2. PatternSource component emits onImport(file).
     3. Parent calls _readAndValidateLSP(file) → parsed doc OR {error, warnings}.
     4. Parent posts {type:"canonicalize", doc} to its LSP worker.
     5. Worker replies with {beam, engineSegments, scanParams, totalTime_s}.
     6. Parent translates beam (full-name → short-name) via _lspBeamToShort,
        then mirrors LSP-derived values into the existing React state so the
        downstream scanCompute pipeline runs unchanged.
     7. The disabled state on the inputs is driven by lspState.phase==='loaded'.
   ─────────────────────────────────────────────────────────────────────────── */

/** Parse and validate a File (or string) as LSP-JSON on the main thread.
 *
 *  Returns a Promise resolving to:
 *    {ok: true,  doc, warnings}     — Stage 1 and Stage 2 both passed
 *    {ok: false, errors, warnings}  — Stage 1 or Stage 2 reported errors
 *
 *  Never throws: every failure path returns a structured result.
 *
 *  Stage 1 = Ajv schema validation against window.LSP_SCHEMA.
 *  Stage 2 = plausibility checks (finite numbers, bbox sanity, segment caps,
 *  per-segment power consistency, etc).  Both run inside LSPValidate.validate.
 *
 *  When LSPValidate or its dependencies (Ajv, LSP_SCHEMA) are missing — e.g.
 *  in environments where the build script did not inline them — we return a
 *  clear error rather than a cryptic ReferenceError.
 */
function _readAndValidateLSP(fileOrString){
  return new Promise(function(resolve){
    function _validate(text){
      var doc;
      try { doc = JSON.parse(text); }
      catch (parseErr) {
        resolve({ok:false, errors:[{
          code:"INVALID_JSON", path:"",
          message:"File is not valid JSON: "+(parseErr&&parseErr.message?parseErr.message:String(parseErr))
        }], warnings:[]});
        return;
      }
      if (typeof window.LSPValidate==="undefined" ||
          typeof window.LSPValidate.validate!=="function") {
        resolve({ok:false, errors:[{
          code:"VALIDATOR_NOT_LOADED", path:"",
          message:"LSP validator is not loaded. This is a build configuration issue; please report it."
        }], warnings:[]});
        return;
      }
      var result;
      try { result = window.LSPValidate.validate(doc); }
      catch (validErr) {
        resolve({ok:false, errors:[{
          code:"INTERNAL_ERROR", path:"",
          message:"Validator threw an unexpected exception: "+
            (validErr&&validErr.message?validErr.message:String(validErr))
        }], warnings:[]});
        return;
      }
      if (!result || typeof result!=="object") {
        resolve({ok:false, errors:[{
          code:"INTERNAL_ERROR", path:"",
          message:"Validator returned a non-object result"
        }], warnings:[]});
        return;
      }
      if (!result.ok) {
        resolve({ok:false, errors:result.errors||[], warnings:result.warnings||[]});
        return;
      }
      resolve({ok:true, doc:doc, warnings:result.warnings||[]});
    }
    if (typeof fileOrString==="string") {
      _validate(fileOrString);
      return;
    }
    if (!fileOrString || typeof fileOrString.text!=="function") {
      resolve({ok:false, errors:[{
        code:"INVALID_INPUT", path:"",
        message:"Input is not a File or string"
      }], warnings:[]});
      return;
    }
    // Defensive size check: the worker's PAYLOAD_TOO_LARGE cap is 10 MB, and
    // reading a multi-hundred-MB file into a JS string then JSON.parsing it
    // can OOM the tab before the worker ever sees the document.  Reject
    // oversized files early.  16 MB cap matches 10 MB document plus ~60%
    // headroom for whitespace and Unicode expansion.
    if (typeof fileOrString.size === "number" && fileOrString.size > 16 * 1024 * 1024) {
      resolve({ok:false, errors:[{
        code:"PAYLOAD_TOO_LARGE", path:"",
        message:"File exceeds 16 MB limit ("+(fileOrString.size/1024/1024).toFixed(1)+" MB). "+
          "The calculator accepts LSP documents up to 10 MB; pathologically large files are rejected "+
          "before reading to prevent browser OOM."
      }], warnings:[]});
      return;
    }
    fileOrString.text().then(_validate, function(readErr){
      resolve({ok:false, errors:[{
        code:"FILE_READ_ERROR", path:"",
        message:"Failed to read file: "+(readErr&&readErr.message?readErr.message:String(readErr))
      }], warnings:[]});
    });
  });
}

/** Translate the canonicalize beam (full-name fields) to the short-name shape
 *  the existing scanCompute() wrapper consumes.
 *
 *  Engine canonical form               scanCompute short form
 *  ─────────────────────────────────   ────────────────────────
 *  d_1e_mm                             d
 *  wl_nm                               wl
 *  tau_s                               tau
 *  prf_hz                              prf
 *  pulse_energy_J                      Ep
 *  avg_power_W                         P
 *  is_cw                               cw
 *
 *  Returns null on invalid input (caller treats as error).
 */
function _lspBeamToShort(b){
  if (!b || typeof b!=="object") return null;
  return {
    d:   b.d_1e_mm,
    wl:  b.wl_nm,
    tau: b.tau_s,
    prf: b.prf_hz,
    Ep:  b.pulse_energy_J,
    P:   b.avg_power_W,
    cw:  !!b.is_cw
  };
}

/** Compute a display label for the Pattern Source card status badge.
 *  Pure function; returned string is shown verbatim. */
function _lspStatusLabel(lspState){
  if (!lspState || lspState.phase==="idle") return "Preset: Built-in";
  if (lspState.phase==="loading") return "Loading…";
  if (lspState.phase==="loaded") {
    var suffix = lspState.customPath ? " (custom path)" : "";
    return "Imported: "+(lspState.filename||"(unknown)")+suffix;
  }
  if (lspState.phase==="error") return "Import failed";
  return "Preset: Built-in";
}

/* ───────────────────────────────────────────────────────────────────────────
   LSP state plumbing (Sub-phase 1D commit 3)

   The three scan-content components (General, OCT, PA) all manage the same
   set of LSP-relevant state variables: 15 beam fields plus 16 scan/geometry
   fields = 31 fields total.  Each component has additional component-specific
   state (OCT's bw/nBM/nA/preset/advOpen, PA's modality/pactA/pactE/pactT etc)
   that is NOT affected by LSP import and is therefore not part of the
   snapshot/restore.

   To avoid duplicating ~100 lines of identical state-shuffling code in each
   component, the snapshot/apply/restore logic lives at module level and takes
   getter/setter dicts as parameters.  Each component passes its own
   useState[0] values (getters) and useState[1] callbacks (setters).

   The custom-path branch (engineSegments instead of scanParams) is handled
   here too: when canonicalize emits a non-empty engineSegments array with
   scanParams=null, we store the segments in a ref provided by the caller
   and derive sensible display values (bbox-derived lineL/scanHN, mean
   velocity) so the rest of the calculator UI continues to render coherently.
   The actual computation in each component's calculate() reads from this
   ref when present and bypasses the preset-pattern segment-building path.
   ───────────────────────────────────────────────────────────────────────── */

/** Snapshot the LSP-relevant state values into a plain object.
 *  G is a dict of getter values (not callbacks).  All 31 fields are
 *  captured so Eject can perform a complete restore even if the user
 *  was mid-edit when they imported. */
function _lspSnapshotState(G){
  return {
    wlS:G.wlS, wl:G.wl, dS:G.dS, dia:G.dia,
    tauS:G.tauS, tau:G.tau, tauU:G.tauU,
    prfS:G.prfS, prf:G.prf, prfU:G.prfU,
    pwS:G.pwS, pw:G.pw, pwMode:G.pwMode,
    laserMode:G.laserMode, epS:G.epS,
    vS:G.vS, vel:G.vel, velMode:G.velMode,
    dwellS:G.dwellS, dwellN:G.dwellN,
    srateS:G.srateS, srateN:G.srateN,
    frateS:G.frateS, frateN:G.frateN,
    pat:G.pat, lLS:G.lLS, lineL:G.lineL,
    scanHS:G.scanHS, scanHN:G.scanHN,
    nLS:G.nLS, nLines:G.nLines, blk:G.blk
  };
}

/** Restore from a snapshot.  S is a dict of setter callbacks.  Caller is
 *  responsible for also calling setDirty(true) and setLspState(idle). */
function _lspRestoreState(prev, S){
  if (!prev) return;
  S.setWlS(prev.wlS); S.setWl(prev.wl);
  S.setDS(prev.dS); S.setDia(prev.dia);
  S.setTauS(prev.tauS); S.setTau(prev.tau); S.setTauU(prev.tauU);
  S.setPrfS(prev.prfS); S.setPrf(prev.prf); S.setPrfU(prev.prfU);
  S.setPwS(prev.pwS); S.setPw(prev.pw); S.setPwMode(prev.pwMode);
  S.setLaserMode(prev.laserMode); S.setEpS(prev.epS);
  S.setVS(prev.vS); S.setVel(prev.vel); S.setVelMode(prev.velMode);
  S.setDwellS(prev.dwellS); S.setDwellN(prev.dwellN);
  S.setSrateS(prev.srateS); S.setSrateN(prev.srateN);
  S.setFrateS(prev.frateS); S.setFrateN(prev.frateN);
  S.setPat(prev.pat);
  S.setLLS(prev.lLS); S.setLineL(prev.lineL);
  S.setScanHS(prev.scanHS); S.setScanHN(prev.scanHN);
  S.setNLS(prev.nLS); S.setNLines(prev.nLines);
  S.setBlk(prev.blk);
}

/** Compute the bounding box of a set of engine segments in the canonical
 *  {x_start_mm, y_start_mm, angle_rad, v_mm_s} format.  Each segment has
 *  implicit length = d_1e_mm so the end point at (x + d*cos(a), y + d*sin(a))
 *  must also be included in the bbox calculation.  Returns
 *  {xmin, xmax, ymin, ymax} or null for an empty/invalid input. */
function _lspComputeSegmentsBbox(segments, d_1e_mm){
  if (!segments || segments.length === 0) return null;
  if (!isFinite(d_1e_mm) || d_1e_mm <= 0) d_1e_mm = 1;
  var xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (var i = 0; i < segments.length; i++) {
    var s = segments[i];
    if (!s) continue;
    var x1 = s.x_start_mm, y1 = s.y_start_mm;
    if (!isFinite(x1) || !isFinite(y1)) continue;
    var x2 = x1 + d_1e_mm * Math.cos(s.angle_rad||0);
    var y2 = y1 + d_1e_mm * Math.sin(s.angle_rad||0);
    if (x1 < xmin) xmin = x1; if (x1 > xmax) xmax = x1;
    if (x2 < xmin) xmin = x2; if (x2 > xmax) xmax = x2;
    if (y1 < ymin) ymin = y1; if (y1 > ymax) ymax = y1;
    if (y2 < ymin) ymin = y2; if (y2 > ymax) ymax = y2;
  }
  if (!isFinite(xmin) || !isFinite(xmax)) return null;
  return {xmin:xmin, xmax:xmax, ymin:ymin, ymax:ymax};
}

/** Apply a canonicalize result to component state.
 *
 *  Three cases:
 *    (a) result.scanParams is set → preset path (linear/raster/bidi):
 *        apply beam + scan params + geometry; clear customSegsRef.
 *    (b) result.scanParams is null AND result.engineSegments is non-empty
 *        → custom path: apply beam only; store engineSegments + derived
 *        bbox/velocity in customSegsRef; set derived display values for
 *        lineL/scanHN/nLines/vel from the bbox.
 *    (c) result.scanParams is null AND engineSegments is empty/missing
 *        → reject with INTERNAL_ERROR (canonicalize would not normally
 *        emit such a result).
 *
 *  S = dict of state setters: { setWlS, setWl, ..., setDirty }.
 *  customSegsRef = useRef object that holds { segments, bbox, totalTime_s,
 *                  meanVelocity_mm_s } when a custom-path LSP is loaded,
 *                  or null otherwise.  May be passed as null if the caller
 *                  does not yet support custom paths.
 *
 *  Returns:
 *    { ok: true,  customPath: false } — preset applied
 *    { ok: true,  customPath: true  } — custom applied
 *    { ok: false, errors: [{code, path, message}] } — validation failure
 */
function _lspApplyState(result, S, customSegsRef){
  var beam = _lspBeamToShort(result.beam);
  if (!beam) {
    return { ok:false, errors:[{
      code:"INVALID_BEAM", path:"/beam",
      message:"Canonicalize result is missing the beam object" }] };
  }
  // Defensive validation: canonicalize.js may produce avg_power_W = 0 if
  // the LSP omits both pattern.default_power_w and a usable
  // (pulse_energy_j, PRF) pair.  Without a positive power, downstream
  // Calculate would compute bogus zero-flux results, so we reject here.
  if (!isFinite(beam.P) || beam.P <= 0) {
    return { ok:false, errors:[{ code:"INVALID_BEAM", path:"/beam/avg_power_W",
      message:"LSP has no usable average power (need default_power_w or "+
              "pulse_energy_j + prf)" }] };
  }
  if (!isFinite(beam.wl) || beam.wl <= 0) {
    return { ok:false, errors:[{ code:"INVALID_BEAM", path:"/beam/wl_nm",
      message:"Wavelength is invalid or missing" }] };
  }
  if (!isFinite(beam.d) || beam.d <= 0) {
    return { ok:false, errors:[{ code:"INVALID_BEAM", path:"/beam/d_1e_mm",
      message:"Beam diameter is invalid or missing" }] };
  }
  if (!beam.cw) {
    if (!isFinite(beam.tau) || beam.tau <= 0) {
      return { ok:false, errors:[{ code:"INVALID_BEAM", path:"/beam/tau_s",
        message:"Pulse duration is invalid for a pulsed beam" }] };
    }
    if (!isFinite(beam.prf) || beam.prf <= 0) {
      return { ok:false, errors:[{ code:"INVALID_BEAM", path:"/beam/prf_hz",
        message:"PRF is invalid for a pulsed beam" }] };
    }
  }

  // ═══ ATOMICITY: validate AND pre-compute branch-specific data BEFORE
  //     any setter calls, so a rejection leaves state untouched.  An earlier
  //     iteration applied beam params first and then validated scan/segments;
  //     that left state half-applied (LSP beam + pre-LSP scan) on rejection
  //     of branch (c).  The user could then click Calculate and get results
  //     for an unintended hybrid configuration.                             ═══
  var sp = result.scanParams;
  var customPrep = null;  // populated if branch (b) selected

  if (sp) {
    // Branch (a): preset pattern — no extra precomputation needed.
    // Validation of sp.pattern values is canonicalize's job.
  } else if (result.engineSegments && result.engineSegments.length > 0) {
    // Branch (b): pre-compute everything that could fail.
    if (!customSegsRef) {
      return { ok:false, errors:[{ code:"INTERNAL_ERROR", path:"",
        message:"Custom-path LSP requires a customSegsRef to store engine "+
                "segments, but the caller passed null" }] };
    }
    var bbox = _lspComputeSegmentsBbox(result.engineSegments, beam.d);
    if (!bbox) {
      return { ok:false, errors:[{ code:"INTERNAL_ERROR",
        path:"/engineSegments",
        message:"Could not compute a bounding box from the engine segments "+
                "(all segment coordinates were non-finite)" }] };
    }
    // Mean velocity over non-blanked segments (display approximation only;
    // the calculate() path uses per-segment v_mm_s from the LSP).
    var velSum = 0, velCount = 0;
    var anyBlanked = false;
    for (var i = 0; i < result.engineSegments.length; i++) {
      var seg = result.engineSegments[i];
      if (seg && seg.blanked) { anyBlanked = true; continue; }
      if (seg && isFinite(seg.v_mm_s) && seg.v_mm_s > 0) {
        velSum += seg.v_mm_s; velCount++;
      }
    }
    var meanVel = velCount > 0 ? (velSum / velCount) : 1;
    // Translate segments to bbox origin so the engine grid, viz rectangle,
    // click-to-scan handler, and worst-case overlay all share an origin-
    // anchored coordinate frame.  Original offsets preserved for callers
    // that may want absolute coordinates.
    var origXmin = bbox.xmin;
    var origYmin = bbox.ymin;
    var translatedSegs = new Array(result.engineSegments.length);
    for (var ti = 0; ti < result.engineSegments.length; ti++) {
      var ts = result.engineSegments[ti];
      // Defensive copy: don't mutate the canonicalize-owned array.
      translatedSegs[ti] = {
        x_start_mm: ts.x_start_mm - origXmin,
        y_start_mm: ts.y_start_mm - origYmin,
        angle_rad: ts.angle_rad,
        v_mm_s: ts.v_mm_s
      };
      if (ts.blanked) translatedSegs[ti].blanked = true;
    }
    var translatedBbox = {
      xmin: 0, ymin: 0,
      xmax: bbox.xmax - origXmin,
      ymax: bbox.ymax - origYmin
    };
    var bboxW = translatedBbox.xmax;
    var bboxH = translatedBbox.ymax;
    // Numerical floor for degenerate paths.
    if (bboxW < 1e-6) bboxW = beam.d || 1e-3;
    if (bboxH < 1e-6) bboxH = beam.d || 1e-3;
    customPrep = {
      translatedSegs: translatedSegs,
      translatedBbox: translatedBbox,
      origXmin: origXmin, origYmin: origYmin,
      meanVel: meanVel, anyBlanked: anyBlanked,
      bboxW: bboxW, bboxH: bboxH
    };
  } else {
    // Branch (c): neither scanParams nor engineSegments — reject.
    return { ok:false, errors:[{
      code:"INTERNAL_ERROR", path:"",
      message:"Canonicalize succeeded but produced neither scanParams nor a "+
              "non-empty engineSegments array; nothing to apply" }] };
  }

  // ═══ Past this point: all validation has passed; apply all state changes.
  //     React batches setState calls inside a single event handler / promise
  //     callback, so the order below doesn't matter for the rendered output —
  //     all setters fire and a single re-render observes the new state.   ═══

  // ─── Apply beam parameters (identical for preset and custom paths) ───
  S.setWlS(String(beam.wl)); S.setWl(beam.wl);
  S.setDS(String(beam.d)); S.setDia(beam.d);
  S.setLaserMode(beam.cw ? "cw" : "pulsed");
  if (!beam.cw) {
    S.setTauS(String(beam.tau*1e9)); S.setTau(beam.tau); S.setTauU("ns");
    S.setPrfS(String(beam.prf/1000)); S.setPrf(beam.prf); S.setPrfU("kHz");
  }
  S.setPwS(beam.P.toPrecision(4)); S.setPw(beam.P); S.setPwMode("power");

  // ─── Branch (a): preset pattern (linear / raster / bidi) ───
  if (sp) {
    if (customSegsRef) customSegsRef.current = null;
    S.setVS(String(sp.v_scan_mm_s)); S.setVel(sp.v_scan_mm_s);
    S.setVelMode("velocity");
    S.setLLS(String(sp.line_length_mm)); S.setLineL(sp.line_length_mm);
    if (sp.pattern==="linear") S.setPat("linear");
    else if (sp.pattern==="raster") S.setPat("raster");
    else if (sp.pattern==="bidi") S.setPat("bidi");
    // Always set nLines and scanHN for state consistency, even for linear
    // (where these are not displayed but still tracked).
    var nL = (sp.n_lines && sp.n_lines >= 1) ? sp.n_lines : 1;
    S.setNLS(String(nL)); S.setNLines(nL);
    if (nL > 1 && typeof sp.hatch_mm === "number") {
      var sh = sp.hatch_mm * (nL - 1);
      S.setScanHS(String(sh)); S.setScanHN(sh);
    }
    if (typeof sp.blanking==="boolean") S.setBlk(sp.blanking);
    S.setDirty(true);
    return { ok:true, customPath:false };
  }

  // ─── Branch (b): custom path via engineSegments ───
  // customPrep was populated above with all the data needed.
  customSegsRef.current = {
    segments: customPrep.translatedSegs,
    bbox: customPrep.translatedBbox,
    orig_xmin_mm: customPrep.origXmin,
    orig_ymin_mm: customPrep.origYmin,
    totalTime_s: result.totalTime_s,
    meanVelocity_mm_s: customPrep.meanVel,
    hasBlankedSegments: customPrep.anyBlanked,
    d_1e_mm: beam.d
  };
  S.setLLS(customPrep.bboxW.toPrecision(4)); S.setLineL(customPrep.bboxW);
  S.setScanHS(customPrep.bboxH.toPrecision(4)); S.setScanHN(customPrep.bboxH);
  S.setNLS("1"); S.setNLines(1);
  S.setVS(customPrep.meanVel.toPrecision(4)); S.setVel(customPrep.meanVel);
  S.setVelMode("velocity");
  // Leave pat and blk unchanged — the user's pre-import values remain in
  // place under the disabled UI, so Eject correctly restores them.
  S.setDirty(true);
  return { ok:true, customPath:true };
}

/** PatternSource — dumb React component for the LSP import card.
 *
 *  Renders as a full-width row that fits above Region 1 of a scan-content
 *  component.  Has three zones: status badge (left), Import/Eject buttons
 *  (middle), warnings indicator (right) which expands into a panel on click.
 *
 *  Props:
 *    T         — theme object
 *    lspState  — current LSP state owned by parent ({phase, filename, ...})
 *    onImport  — (file: File) => void; parent handles parsing + validation
 *    onEject   — () => void; parent restores pre-LSP state
 *
 *  This component does NOT own any LSP state; it only renders and emits
 *  events.  All validation and worker coordination happens in the parent.
 *  This separation makes the component trivially testable.
 */
function PatternSource(props){
  var T = props.T;
  var lspState = props.lspState || {phase:"idle"};
  var onImport = props.onImport;
  var onEject = props.onEject;

  var _showWarn = useState(false);
  var showWarn = _showWarn[0], setShowWarn = _showWarn[1];
  var fileRef = useRef(null);

  var phase = lspState.phase || "idle";
  var loaded = phase==="loaded";
  var loading = phase==="loading";
  var hasError = phase==="error";

  // Combine errors + warnings for the indicator count.  Errors take priority
  // (red dot), then warnings (yellow dot), then none (no dot).
  var errors = lspState.errors || [];
  var warnings = lspState.warnings || [];
  var hasMessages = errors.length > 0 || warnings.length > 0;

  var statusBg = loaded
    ? "rgba(16,185,129,0.08)"     // green tint for "Imported"
    : (hasError ? "rgba(220,38,38,0.08)" : "rgba(15,23,42,0.04)");
  var statusColor = loaded ? "#047857" : (hasError ? "#b91c1c" : T.tm);

  function handleFileChange(e){
    var f = e.target.files && e.target.files[0];
    if (f && onImport) onImport(f);
    // Reset so the same file can be re-imported after eject
    e.target.value = "";
  }
  function handleImportClick(){
    if (fileRef.current) fileRef.current.click();
  }

  return React.createElement("div", {
    style:{
      background:T.card, border:"1px solid "+T.bd, borderRadius:6,
      padding:"10px 14px", marginBottom:12,
      fontFamily:"'IBM Plex Sans', system-ui, sans-serif"
    }
  },
    React.createElement("div", {style:{display:"flex", alignItems:"center", gap:12}},
      // Status badge
      React.createElement("div", {
        style:{
          flex:"0 0 auto", padding:"4px 10px", borderRadius:4,
          background:statusBg, color:statusColor,
          fontSize:11, fontWeight:600, letterSpacing:"0.02em",
          fontFamily:"'IBM Plex Mono', monospace",
          maxWidth:340, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"
        },
        title:_lspStatusLabel(lspState)
      }, _lspStatusLabel(lspState)),

      // Spacer
      React.createElement("div", {style:{flex:"1 1 auto"}}),

      // Import button (hidden when LSP is loaded; shown in idle / loading /
      // error so the user can always try another file)
      !loaded ? React.createElement("button", {
        onClick:handleImportClick, disabled:loading,
        style:{
          padding:"5px 12px", fontSize:12, fontWeight:500,
          background:loading?T.hov:T.ac, color:loading?T.tm:"#ffffff",
          border:"1px solid "+(loading?T.bd:T.ac), borderRadius:4,
          cursor:loading?"default":"pointer",
          opacity:loading?0.6:1
        }
      }, loading?"Loading…":"Import LSP…") : null,

      // Eject button (shown when loaded OR when in error — in error state,
      // a prior successful LSP may still have its customSegsRef alive, so
      // Eject is the user's recovery path to a clean pre-LSP state.  Eject
      // also dismisses the error message by transitioning to idle.)
      (loaded || hasError) ? React.createElement("button", {
        onClick:onEject,
        style:{
          padding:"5px 12px", fontSize:12, fontWeight:500,
          background:"transparent", color:T.tx,
          border:"1px solid "+T.bd, borderRadius:4, cursor:"pointer"
        }
      }, "Eject") : null,

      // Warnings indicator
      hasMessages ? React.createElement("button", {
        onClick:function(){setShowWarn(!showWarn);},
        style:{
          padding:"4px 10px", fontSize:11, fontWeight:600,
          background:errors.length>0?"rgba(220,38,38,0.08)":"rgba(217,119,6,0.08)",
          color:errors.length>0?"#b91c1c":"#92400e",
          border:"1px solid "+(errors.length>0?"#fca5a5":"#fcd34d"),
          borderRadius:4, cursor:"pointer", fontFamily:"'IBM Plex Mono', monospace"
        },
        title:(errors.length>0?"Errors":"Warnings")+" — click to "+(showWarn?"hide":"view")
      },
        (errors.length>0?errors.length+" error"+(errors.length>1?"s":"")
          : warnings.length+" warning"+(warnings.length>1?"s":""))
        + (showWarn?" ▴":" ▾")
      ) : null,

      // Hidden file input
      React.createElement("input", {
        ref:fileRef, type:"file", accept:".json,.lsp.json,application/json",
        style:{display:"none"}, onChange:handleFileChange
      })
    ),

    // Expandable warnings/errors panel
    showWarn && hasMessages ? React.createElement("div", {
      style:{
        marginTop:10, padding:"8px 12px",
        background:errors.length>0?"#fef2f2":"#fffbeb",
        border:"1px solid "+(errors.length>0?"#fca5a5":"#fcd34d"),
        borderRadius:4, fontSize:12, fontFamily:"'IBM Plex Mono', monospace",
        maxHeight:240, overflowY:"auto"
      }
    },
      errors.concat(warnings).map(function(m,i){
        return React.createElement("div", {key:i, style:{marginBottom:i<errors.length+warnings.length-1?6:0, lineHeight:1.45}},
          React.createElement("span", {style:{fontWeight:600, color:i<errors.length?"#b91c1c":"#92400e"}},
            "["+m.code+"] "),
          m.path ? React.createElement("span", {style:{color:"#6b7280", fontSize:11}}, m.path+" — ") : null,
          React.createElement("span", null, m.message||"(no message)")
        );
      })
    ) : null
  );
}


function si(v,u){if(!isFinite(v))return"\u2014";var a=Math.abs(v);if(a===0)return"0 "+u;if(a>=1e6)return numFmt(v,4)+" "+u;if(a>=1e3)return(v/1e3).toPrecision(4)+" k"+u;if(a>=.1)return v.toPrecision(4)+" "+u;if(a>=1e-3)return(v*1e3).toPrecision(4)+" m"+u;if(a>=1e-6)return(v*1e6).toPrecision(4)+" \u00b5"+u;if(a>=1e-9)return(v*1e9).toPrecision(4)+" n"+u;return numFmt(v,4)+" "+u;}

/* ═══════ SCIENTIFIC NOTATION ═══════ */
var SUPS={"-":"\u207b","0":"\u2070","1":"\u00b9","2":"\u00b2","3":"\u00b3","4":"\u2074","5":"\u2075","6":"\u2076","7":"\u2077","8":"\u2078","9":"\u2079"};
function supStr(n){var s=String(n),r="";for(var i=0;i<s.length;i++){r+=SUPS[s[i]]||s[i];}return r;}
function numFmt(v,p){if(!isFinite(v))return"\u2014";if(v===0)return"0";var a=Math.abs(v),pr=p||4;if(a>=0.01&&a<1e4)return v.toPrecision(pr);var exp=Math.floor(Math.log10(a));var man=v/Math.pow(10,exp);return man.toFixed(pr-1)+"\u00d710"+supStr(exp);}
function logTick(v){if(v==null||!isFinite(v)||v<=0)return"";var lg=Math.log10(v);if(Math.abs(lg-Math.round(lg))<0.01){var exp=Math.round(lg);return"10"+supStr(exp);}var exp2=Math.floor(lg);var man=v/Math.pow(10,exp2);return man.toPrecision(2)+"\u00d710"+supStr(exp2);}
function ft(t){if(t===undefined||t===null||isNaN(t))return"\u2014";if(t<1e-9)return(t*1e12).toPrecision(3)+" ps";if(t<1e-6)return(t*1e9).toPrecision(3)+" ns";if(t<1e-3)return(t*1e6).toPrecision(3)+" \u00b5s";if(t<1)return(t*1e3).toPrecision(3)+" ms";return t.toPrecision(3)+" s";}
var STD_NAME="",STD_REF="",STD_TABLES="";
var WL_PLOT_MIN=180,WL_PLOT_MAX=3000;
var WLTICKS=[200,400,700,1000,1400,2000,3000];
var WL_SAMPLE_SPANS=[[180,400,3],[400,700,4],[700,1400,8],[1400,3000,15]];

/** Recompute all module-level standard-derived variables from current _std.
 *  Called at load time and when a user uploads a new standard JSON. */
function _recomputeStdVars(){
  if(!_std||!_std.standard)return;
  STD_NAME=_std.standard.name||"";
  STD_REF=_std.standard.reference||"";
  STD_TABLES=_std.standard.tables_used||"";
  // Plot domain
  WL_PLOT_MIN=(_std.standard.wl_range_nm)?_std.standard.wl_range_nm[0]:180;
  WL_PLOT_MAX=(function(){
    if(!_std.display_bands)return 3000;
    var maxBound=0;
    for(var i=0;i<_std.display_bands.length;i++){
      var e2=_std.display_bands[i].wl_end_nm;
      if(e2<10000&&e2>maxBound)maxBound=e2;
    }
    if(maxBound<=0)maxBound=_std.standard.wl_range_nm?_std.standard.wl_range_nm[1]:3000;
    return Math.min(Math.max(maxBound*2,3000),_std.standard.wl_range_nm?_std.standard.wl_range_nm[1]:3000);
  })();
  // Wavelength ticks
  WLTICKS=(function(){
    if(!_std.display_bands)return[200,400,700,1000,1400,2000,3000];
    var tks={};tks[WL_PLOT_MIN]=1;
    for(var i=0;i<_std.display_bands.length;i++){
      var bs=_std.display_bands[i].wl_start_nm,be2=_std.display_bands[i].wl_end_nm;
      if(bs<=WL_PLOT_MAX)tks[bs]=1;if(be2<=WL_PLOT_MAX)tks[be2]=1;
    }
    var rt=[200,500,1000,2000,3000,5000,10000];
    for(var j=0;j<rt.length;j++){if(rt[j]>=WL_PLOT_MIN&&rt[j]<=WL_PLOT_MAX)tks[rt[j]]=1;}
    return Object.keys(tks).map(Number).sort(function(a,b){return a-b;});
  })();
  // Sampling spans
  WL_SAMPLE_SPANS=(function(){
    if(!_std.display_bands)return[[180,400,3],[400,700,4],[700,1400,8],[1400,3000,15]];
    var spans=[];
    for(var i=0;i<_std.display_bands.length;i++){
      var b=_std.display_bands[i];
      var lo=b.wl_start_nm,hi=Math.min(b.wl_end_nm,WL_PLOT_MAX);
      if(lo>=hi)continue;
      var step=Math.max(1,Math.round((hi-lo)/100));
      spans.push([lo,hi,step]);
    }
    return spans;
  })();
}
_recomputeStdVars(); // initial computation from build-time standard
var FLUENCE_UNITS=[
  {id:"mJ/cm\u00b2", label:"mJ/cm\u00b2", mult:1e3},
  {id:"J/cm\u00b2",  label:"J/cm\u00b2",  mult:1},
  {id:"J/m\u00b2",   label:"J/m\u00b2",   mult:1e4},
  {id:"mJ/m\u00b2",  label:"mJ/m\u00b2",  mult:1e7}
];
var IRRAD_UNITS=[
  {id:"W/cm\u00b2",  label:"W/cm\u00b2",  mult:1},
  {id:"mW/cm\u00b2", label:"mW/cm\u00b2", mult:1e3},
  {id:"W/m\u00b2",   label:"W/m\u00b2",   mult:1e4}
];
var BEAM_DIA_UNITS=[
  {id:"mm",  label:"mm",  toMM:1},
  {id:"\u00b5m", label:"\u00b5m", toMM:0.001},
  {id:"cm",  label:"cm",  toMM:10},
  {id:"m",   label:"m",   toMM:1000}
];
var AREA_UNITS=[
  {id:"cm\u00b2",  label:"cm\u00b2",  fromCM2:1},
  {id:"mm\u00b2",  label:"mm\u00b2",  fromCM2:100},
  {id:"m\u00b2",   label:"m\u00b2",   fromCM2:1e-4}
];
var ENERGY_UNITS=[
  {id:"J",   label:"J",   fromJ:1},
  {id:"mJ",  label:"mJ",  fromJ:1e3},
  {id:"\u00b5J", label:"\u00b5J", fromJ:1e6},
  {id:"nJ",  label:"nJ",  fromJ:1e9}
];
var WL_UNITS=[
  {id:"nm",  label:"nm",  toNM:1},
  {id:"\u00b5m", label:"\u00b5m", toNM:1e3}
];
var DUR_UNITS=[
  {id:"s",   label:"s",   toS:1},
  {id:"ms",  label:"ms",  toS:1e-3},
  {id:"\u00b5s", label:"\u00b5s", toS:1e-6},
  {id:"ns",  label:"ns",  toS:1e-9},
  {id:"ps",  label:"ps",  toS:1e-12}
];
var FREQ_UNITS=[
  {id:"Hz",  label:"Hz",  toHz:1},
  {id:"kHz", label:"kHz", toHz:1e3},
  {id:"MHz", label:"MHz", toHz:1e6}
];
function convF(v,uid){if(!isFinite(v))return"\u2014";for(var i=0;i<FLUENCE_UNITS.length;i++){if(FLUENCE_UNITS[i].id===uid)return numFmt(v*FLUENCE_UNITS[i].mult,4)+" "+uid;}return si(v,"J/cm\u00b2");}
function convE(v,uid){if(!isFinite(v))return"\u2014";for(var i=0;i<IRRAD_UNITS.length;i++){if(IRRAD_UNITS[i].id===uid)return numFmt(v*IRRAD_UNITS[i].mult,4)+" "+uid;}return si(v,"W/cm\u00b2");}
/* Bare-number versions for table cells (unit goes in header only) */
function convFN(v,uid){if(!isFinite(v))return"\u2014";for(var i=0;i<FLUENCE_UNITS.length;i++){if(FLUENCE_UNITS[i].id===uid)return numFmt(v*FLUENCE_UNITS[i].mult,4);}return numFmt(v,4);}
function convEN(v,uid){if(!isFinite(v))return"\u2014";for(var i=0;i<IRRAD_UNITS.length;i++){if(IRRAD_UNITS[i].id===uid)return numFmt(v*IRRAD_UNITS[i].mult,4);}return numFmt(v,4);}
function durInUnit(t,uid){if(!isFinite(t))return"\u2014";for(var i=0;i<DUR_UNITS.length;i++){if(DUR_UNITS[i].id===uid)return numFmt(t/DUR_UNITS[i].toS,4);}return numFmt(t,4);}
function fluMult(uid){for(var i=0;i<FLUENCE_UNITS.length;i++){if(FLUENCE_UNITS[i].id===uid)return FLUENCE_UNITS[i].mult;}return 1e3;}

/* PA & beam geometry — delegated to engine.js */
var paEffFluence = _E.paEffFluence;
var paRelSNR = _E.paRelSNR;
function paOptPRF(wl,tau,T){ return _E.paOptimalPRF(wl,tau,T); }
var getAperture = _E.getAperture;
var beamEval = _E.beamEval;

var WC=["#1C4E80","#009E73","#CC79A7","#D55E00","#56B4E9","#E69F00","#B8860B","#000000"];
var DTICKS=[1e-9,1e-7,1e-5,1e-3,.1,10,1000];
function dtf(v){if(v>=1e3)return(v/1e3)+"ks";if(v>=1)return v+"s";if(v>=1e-3)return(v*1e3)+"ms";if(v>=1e-6)return(v*1e6)+"\u00b5s";return(v*1e9)+"ns";}

var TH={
  light:{bg:"#F5F7FA",card:"#FFFFFF",bgI:"#FAFBFC",bd:"rgba(15,23,42,0.08)",bl:"rgba(15,23,42,0.14)",tx:"#0E1116",tm:"#4B5563",td:"#6B7280",ac:"#1D4ED8",a2:"#3B82F6",ok:"#027A48",no:"#B42318",gr:"#E8EAED",tp:"#FFFFFF",hov:"rgba(15,23,42,0.04)"},
  dark:{bg:"#0B0F14",card:"#14181F",bgI:"#1A1F27",bd:"rgba(255,255,255,0.08)",bl:"rgba(255,255,255,0.14)",tx:"#E5E7EB",tm:"#9CA3AF",td:"#8B949E",ac:"#58A6FF",a2:"#79B8FF",ok:"#4DB6AC",no:"#F85149",gr:"#1A1F27",tp:"#14181F",hov:"rgba(255,255,255,0.04)"}
};

var uid=1;
function mkL(wl){return{id:uid++,wl:wl,wlStr:String(wl),wlU:"nm",ds:"10",dur:1e-8,dU:"ns",rp:false,prf:10,prfStr:"10",prfU:"Hz",tT:1,tTStr:"1",tTU:"s",show:true,fU:"mJ/cm\u00b2",eU:"W/cm\u00b2"};}
function pDur(s){var v=parseFloat(s);return(isFinite(v)&&v>0)?v:null;}
function uMult(arr,uid2){for(var i=0;i<arr.length;i++){if(arr[i].id===uid2)return arr[i];}return arr[0];}
function computeR(L,area_cm2){var h=skinMPE(L.wl,L.dur);var h_area=(area_cm2>0)?skinMPE_area(L.wl,L.dur,area_cm2):h;var rp=L.rp?rpCalc(L.wl,L.dur,L.prf,L.tT):null;var rp_area=(L.rp&&area_cm2>0)?rpCalcArea(L.wl,L.dur,L.prf,L.tT,area_cm2):rp;var effH=rp_area?rp_area.H:h_area;var irr=isFinite(effH)&&L.dur>0?effH/L.dur:NaN;var lacApplied=(area_cm2>0&&h_area<h)||(rp_area&&rp&&rp_area.H<rp.H);return{wl:L.wl,dur:L.dur,h:h,h_area:h_area,rp:rp_area||rp,effH:effH,irr:irr,ca:CA(L.wl),band:bnd(L.wl),rule:rp_area?rp_area.bd:(rp?rp.bd:"Rule 1"),lacApplied:!!lacApplied,inLacRange:isInLargeAreaRange(L.wl,L.dur)||(L.rp&&isInLargeAreaRange(L.wl,L.tT))};}

function dlSVG(ref,fn,sm){try{var svg=ref.current.querySelector("svg");if(!svg)return;var c=svg.cloneNode(true);c.setAttribute("xmlns","http://www.w3.org/2000/svg");c.setAttribute("xmlns:xlink","http://www.w3.org/1999/xlink");var u="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(new XMLSerializer().serializeToString(c));var a=document.createElement("a");a.href=u;a.download=fn;a.style.display="none";ref.current.appendChild(a);a.click();ref.current.removeChild(a);sm("Downloaded!");setTimeout(function(){sm("")},2e3);}catch(e){sm("Failed");}}
function dlCSV(d,cols,fn,sm){try{var lines=[cols.join(",")];for(var i=0;i<d.length;i++){var row=[];for(var j=0;j<cols.length;j++){var v=d[i][cols[j]];row.push(v===undefined||v===null?"":String(v));}lines.push(row.join(","));}var u="data:text/csv;charset=utf-8,"+encodeURIComponent(lines.join("\n"));var a=document.createElement("a");a.href=u;a.download=fn;a.style.display="none";var root=document.getElementById("root");root.appendChild(a);a.click();root.removeChild(a);sm("CSV downloaded!");setTimeout(function(){sm("")},2e3);}catch(e){sm("Failed");}}

/* ═══════ SHARED STYLES ═══════ */
function mkBt(on,c,T){return{padding:"6px 14px",fontSize:11,fontWeight:600,border:"1px solid "+(on?c:T.bd),cursor:"pointer",background:on?c:"transparent",color:on?"#fff":T.tm,borderRadius:4};}

/* ═══════ MPE TAB ═══════ */
function MPETab(p){
  var T=p.T,theme=p.theme,msg=p.msg,setMsg=p.setMsg;
  var _ls=useState([mkL(532)]),lasers=_ls[0],setLasers=_ls[1];
  var _fl=useState(""),fl=_fl[0],setFl=_fl[1];
  var _ch=useState("wl"),cht=_ch[0],setCht=_ch[1];
  var _nw=useState(""),nw=_nw[0],setNw=_nw[1];
  var _cv=useState(0),cv=_cv[0],setCv=_cv[1];
  var _dr=useState(false),dirty=_dr[0],setDirty=_dr[1];
  var _bd=useState("5"),bdStr=_bd[0],setBdStr=_bd[1];
  var _bn=useState(5),beamDia=_bn[0],setBeamDia=_bn[1];
  var _bdu=useState("mm"),bdUnit=_bdu[0],setBdUnit=_bdu[1];
  var _pe=useState(""),peStr=_pe[0],setPeStr=_pe[1];
  var _peu=useState("\u00b5J"),peUnit=_peu[0],setPeUnit=_peu[1];
  var _flu=useState("mJ/cm\u00b2"),flUnit=_flu[0],setFlUnit=_flu[1];
  var _eau=useState("\u00b5J"),eDispUnit=_eau[0],setEDispUnit=_eau[1];
  var _aau=useState("mm\u00b2"),aDispUnit=_aau[0],setADispUnit=_aau[1];
  var _mfu=useState("mJ/cm\u00b2"),mpeDispUnit=_mfu[0],setMpeDispUnit=_mfu[1];
  var _bopen=useState(false),beamOpen=_bopen[0],setBeamOpen=_bopen[1];
  useEffect(function(){if(needsBeamDia)setBeamOpen(true);},[needsBeamDia]);
  var _bdr=useState(false),beamDirty=_bdr[0],setBeamDirty=_bdr[1];
  var _bsel=useState(null),beamSel=_bsel[0],setBeamSel=_bsel[1]; /* null = all selected */
  var _sdU=useState("ns"),sumDurU=_sdU[0],setSumDurU=_sdU[1];
  var _sfU=useState("mJ/cm\u00b2"),sumFluU=_sfU[0],setSumFluU=_sfU[1];
  var _seU=useState("W/cm\u00b2"),sumIrrU=_seU[0],setSumIrrU=_seU[1];
  function isBeamSel(id){return beamSel===null||beamSel.indexOf(id)>=0;}
  function togBeamSel(id){
    if(beamSel===null){/* all selected → deselect one */
      setBeamSel(lasers.map(function(L){return L.id}).filter(function(lid){return lid!==id}));
    } else {
      var idx=beamSel.indexOf(id);
      if(idx>=0){var n=beamSel.slice();n.splice(idx,1);setBeamSel(n);}
      else{var added=beamSel.concat([id]);setBeamSel(added.length===lasers.length?null:added);}
    }
  }  var wRef=useRef(null),dRef=useRef(null);
  var lb={display:"block",fontSize:11,fontWeight:500,color:T.tm,marginBottom:3,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"};
  var ipFull={width:"100%",padding:"6px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",fontVariantNumeric:"tabular-nums",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};
  var thS={padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:600,letterSpacing:"0.04em"};
  var tdSt={padding:"7px 10px",fontSize:12,fontFamily:"'IBM Plex Mono', monospace"};
  var hSel={fontSize:9,padding:"2px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer",fontWeight:600,outline:"none"};

  function calc(){setCv(function(c){return c+1;});setDirty(false);setBeamDirty(false);}
  function beamCalc(){setBeamDirty(false);}
  useEffect(function(){calc();},[]);
  function upL(id,k,v){setLasers(lasers.map(function(L){if(L.id!==id)return L;var n={id:L.id,wl:L.wl,wlStr:L.wlStr,wlU:L.wlU,ds:L.ds,dur:L.dur,dU:L.dU,rp:L.rp,prf:L.prf,prfStr:L.prfStr,prfU:L.prfU,tT:L.tT,tTStr:L.tTStr,tTU:L.tTU,show:L.show,fU:L.fU,eU:L.eU};n[k]=v;if(k==="wlStr"){var wv=Number(v)*uMult(WL_UNITS,n.wlU).toNM;if(isFinite(wv)&&wv>=180&&wv<=1e6)n.wl=wv;}if(k==="wlU"){var cWl=parseFloat(n.wlStr);if(isFinite(cWl)){var nmVal=cWl*uMult(WL_UNITS,L.wlU).toNM;n.wlStr=(nmVal/uMult(WL_UNITS,v).toNM).toPrecision(6).replace(/\.?0+$/,"");}n.wlU=v;}if(k==="ds"){var d=pDur(v);if(d)n.dur=d*uMult(DUR_UNITS,n.dU).toS;}if(k==="dU"){var cD=parseFloat(n.ds);if(isFinite(cD)&&cD>0){var sVal=cD*uMult(DUR_UNITS,L.dU).toS;n.ds=(sVal/uMult(DUR_UNITS,v).toS).toPrecision(4).replace(/\.?0+$/,"");}n.dU=v;var d2=parseFloat(n.ds);if(d2>0)n.dur=d2*uMult(DUR_UNITS,v).toS;}if(k==="prfStr"){n.prfStr=v;var pp=Number(v)*uMult(FREQ_UNITS,n.prfU).toHz;if(isFinite(pp)&&pp>0)n.prf=pp;}if(k==="prfU"){var cP=parseFloat(n.prfStr);if(isFinite(cP)&&cP>0){var hzVal=cP*uMult(FREQ_UNITS,L.prfU).toHz;n.prfStr=(hzVal/uMult(FREQ_UNITS,v).toHz).toPrecision(4).replace(/\.?0+$/,"");}n.prfU=v;var p2=parseFloat(n.prfStr);if(p2>0)n.prf=p2*uMult(FREQ_UNITS,v).toHz;}if(k==="tTStr"){n.tTStr=v;var tt=Number(v)*uMult(DUR_UNITS,n.tTU).toS;if(isFinite(tt)&&tt>0)n.tT=tt;}if(k==="tTU"){var cT=parseFloat(n.tTStr);if(isFinite(cT)&&cT>0){var sVal2=cT*uMult(DUR_UNITS,L.tTU).toS;n.tTStr=(sVal2/uMult(DUR_UNITS,v).toS).toPrecision(4).replace(/\.?0+$/,"");}n.tTU=v;var t2=parseFloat(n.tTStr);if(t2>0)n.tT=t2*uMult(DUR_UNITS,v).toS;}return n;}));setDirty(true);}
  function addL(){var v=parseInt(nw,10);if(!isNaN(v)&&v>=180&&v<=1e6){setLasers(lasers.concat([mkL(v)]));setNw("");setDirty(true);}}
  function rmL(id){if(lasers.length<=1)return;setLasers(lasers.filter(function(L){return L.id!==id}));setDirty(true);}
  function toggleShow(id){setLasers(lasers.map(function(L){if(L.id!==id)return L;var n={id:L.id,wl:L.wl,wlStr:L.wlStr,ds:L.ds,dur:L.dur,rp:L.rp,prf:L.prf,prfStr:L.prfStr,tT:L.tT,tTStr:L.tTStr,show:!L.show,fU:L.fU,eU:L.eU};return n;}));}
  var _pfu=useState("mJ/cm\u00b2"),plotFU=_pfu[0],setPlotFU=_pfu[1];
  var beamArea_cm2=useMemo(function(){if(!isFinite(beamDia)||beamDia<=0)return 0;var r_cm=beamDia/20;return Math.PI*r_cm*r_cm;},[beamDia]);
  var needsBeamDia=useMemo(function(){for(var i=0;i<lasers.length;i++){if(isInLargeAreaRange(lasers[i].wl,lasers[i].dur))return true;if(lasers[i].rp&&isInLargeAreaRange(lasers[i].wl,lasers[i].tT))return true;}return false;},[cv,lasers]);
  var results=useMemo(function(){var area=(needsBeamDia&&beamArea_cm2>0)?beamArea_cm2:0;return lasers.map(function(L){return computeR(L,area);});},[cv,lasers,needsBeamDia,beamArea_cm2]);
  var plotLasers=lasers.filter(function(L){return L.show});
  var pfm=fluMult(plotFU);
  var wld=useMemo(function(){var durs=[];plotLasers.forEach(function(L){if(durs.indexOf(L.dur)===-1)durs.push(L.dur);});var sp=WL_SAMPLE_SPANS;var pp=[];for(var si2=0;si2<sp.length;si2++)for(var w=sp[si2][0];w<=sp[si2][1];w+=sp[si2][2]){var row={wl:w},any=false;for(var di=0;di<durs.length;di++){var h=skinMPE(w,durs[di]);if(isFinite(h)&&h>0){row["d"+di]=h*pfm;any=true;}}if(any)pp.push(row);}return{d:pp,durs:durs};},[cv,plotLasers,pfm]);
  var drd=useMemo(function(){var ws=[];plotLasers.forEach(function(L){if(ws.indexOf(L.wl)===-1)ws.push(L.wl);});var a=[];for(var e=-9;e<=4.5;e+=.05){var t=Math.pow(10,e),r={t:t},any=false;for(var j=0;j<ws.length;j++){var h=skinMPE(ws[j],t);if(isFinite(h)&&h>0){r["w"+ws[j]]=h*pfm;any=true;}}if(any)a.push(r);}return{d:a,ws:ws};},[cv,plotLasers,pfm]);

  function doExport(){try{var ths2="background:#f1f5f9;padding:8px 12px;text-align:left;border-bottom:2px solid #d4d4d4;font-size:11px";var tds2="padding:6px 12px;border-bottom:1px solid #e5e5e5;font-size:13px";var rows="";for(var i=0;i<results.length;i++){var r=results[i],L=lasers[i];rows+='<tr><td style="'+tds2+'">'+r.wl+'</td><td style="'+tds2+'">'+durInUnit(r.dur,sumDurU)+'</td><td style="'+tds2+'">'+r.band+'</td><td style="'+tds2+'">'+(isInCARange(r.wl)?r.ca.toFixed(3):"\u2014")+'</td><td style="'+tds2+';font-weight:700">'+convFN(r.effH,sumFluU)+'</td><td style="'+tds2+'">'+convEN(r.irr,sumIrrU)+'</td><td style="'+tds2+'">'+(L.rp?L.prf:"\u2014")+'</td><td style="'+tds2+'">'+(r.rp?Math.round(r.rp.N):"1")+'</td><td style="'+tds2+'">'+r.rule+'</td></tr>';}var html='<!DOCTYPE html><html><head><title>MPE Report</title><style>body{font-family:Helvetica,sans-serif;max-width:960px;margin:40px auto;color:#171717;line-height:1.5;padding:0 20px}table{border-collapse:collapse;width:100%;margin:16px 0}th{'+ths2+'}h1{font-size:22px}h2{font-size:14px;color:#525252;margin:24px 0 8px}</style></head><body><h1>Laser Skin MPE Report</h1><p style="color:#737373;font-size:12px">'+STD_NAME+' \u2014 '+new Date().toLocaleString()+'</p><h2>Results</h2><table><thead><tr><th style="'+ths2+'">Wavelength (nm)</th><th style="'+ths2+'">Duration ('+sumDurU+')</th><th style="'+ths2+'">Band</th><th style="'+ths2+'">C<sub>A</sub></th><th style="'+ths2+'">Fluence, H ('+sumFluU+')</th><th style="'+ths2+'">Irradiance, E ('+sumIrrU+')</th><th style="'+ths2+'">Repetition Rate (Hz)</th><th style="'+ths2+'">Pulses</th><th style="'+ths2+'">Rule</th></tr></thead><tbody>'+rows+'</tbody></table><p style="margin-top:32px;font-size:11px;color:#a3a3a3;border-top:1px solid #e5e5e5;padding-top:12px">'+STD_NAME+' \u2014 For research and educational purposes only. Not a certified safety instrument. Skin MPE only \u2014 ocular limits not evaluated. Verify all values against the applicable standard with a qualified Laser Safety Officer.</p></body></html>';var u="data:text/html;charset=utf-8,"+encodeURIComponent(html);var a=document.createElement("a");a.href=u;a.download="mpe-report.html";a.style.display="none";var root=document.getElementById("root");root.appendChild(a);a.click();root.removeChild(a);setMsg("Report downloaded!");setTimeout(function(){setMsg("")},2e3);}catch(e){setMsg("Export failed");}}

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* ═══ Region 1: Exposure Parameters ═══ */}
      <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Exposure Parameters</div>
      {lasers.map(function(L,idx){var r=results[idx];var col=WC[idx%WC.length];return (
        <div key={L.id} style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 14px",borderBottom:"1px solid "+T.bd,background:T.bg}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:10,height:10,borderRadius:4,background:col,flexShrink:0}}/><span style={{fontSize:13,fontWeight:500}}>{L.wl} nm</span><span style={{fontSize:11,color:T.td}}>{r.band}</span>{isInCARange(r.wl)?<span style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>C{"\u2090"} = {r.ca.toFixed(3)}</span>:null}</div>
            {lasers.length>1?<button onClick={function(){rmL(L.id)}} style={{background:"none",border:"none",color:T.td,cursor:"pointer",fontSize:15}}>{"\u00d7"}</button>:null}
          </div>
          <div style={{padding:"12px 14px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div><label style={lb}>Wavelength</label><div style={{display:"flex",gap:4}}><input type="text" value={L.wlStr} onChange={function(e){upL(L.id,"wlStr",e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/><select value={L.wlU} onChange={function(e){upL(L.id,"wlU",e.target.value)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{WL_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div><div style={{fontSize:9,color:T.td,marginTop:3,fontFamily:"'IBM Plex Mono', monospace"}}>{(function(){if(!_std||!_std.display_bands)return bnd(L.wl);for(var bi=0;bi<_std.display_bands.length;bi++){var b=_std.display_bands[bi];if(L.wl>=b.wl_start_nm&&L.wl<b.wl_end_nm)return b.name+" "+b.wl_start_nm+"\u2013"+(b.wl_end_nm>=100000?"":b.wl_end_nm+" nm");if(bi===_std.display_bands.length-1&&L.wl>=b.wl_start_nm)return b.name+" "+b.wl_start_nm+"+ nm";}return bnd(L.wl);})()}</div></div>
              <div><label style={lb}>Pulse Duration</label><div style={{display:"flex",gap:4}}><input type="text" value={L.ds} onChange={function(e){upL(L.id,"ds",e.target.value)}} placeholder="e.g. 10" style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/><select value={L.dU} onChange={function(e){upL(L.id,"dU",e.target.value)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div><div style={{fontSize:9,color:T.td,marginTop:3,fontFamily:"'IBM Plex Mono', monospace"}}>= {ft(L.dur)}</div></div>
            </div>
            <div style={{marginTop:10,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:T.tm}} onClick={function(){upL(L.id,"rp",!L.rp)}}><div style={{width:34,height:18,borderRadius:6,background:L.rp?T.a2:"#a3a3a3",position:"relative",flexShrink:0,transition:"background 0.15s"}}><div style={{width:14,height:14,borderRadius:6,background:"#fff",position:"absolute",top:2,left:L.rp?18:2,transition:"left 0.15s"}}/></div>Repetitive Pulse</label>
              {L.rp?<div style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap"}}><div><label style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Repetition Rate</label><div style={{display:"flex",gap:3}}><input type="text" value={L.prfStr} onChange={function(e){upL(L.id,"prfStr",e.target.value)}} style={{width:70,padding:"4px 8px",fontSize:12,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><select value={L.prfU} onChange={function(e){upL(L.id,"prfU",e.target.value)}} style={{fontSize:10,padding:"2px 4px",background:T.card,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,outline:"none",cursor:"pointer"}}>{FREQ_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div></div><div><label style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Exposure Time</label><div style={{display:"flex",gap:3}}><input type="text" value={L.tTStr} onChange={function(e){upL(L.id,"tTStr",e.target.value)}} style={{width:70,padding:"4px 8px",fontSize:12,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><select value={L.tTU} onChange={function(e){upL(L.id,"tTU",e.target.value)}} style={{fontSize:10,padding:"2px 4px",background:T.card,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,outline:"none",cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div></div></div>:null}
            </div>
            {r?<div style={{marginTop:12,paddingTop:10,borderTop:"1px solid "+T.bd}}>
              {/* Task 7: Section 1 — MPE (total exposure limit) */}
              {(function(){
                // Task 6: determine if irradiance is the primary standard quantity
                // Irradiance-primary check: reads from supplementary.irradiance_primary in the standard JSON
                var evalDur=L.rp?L.tT:L.dur;
                var irrPrimary=isIrrPrimary(r.wl,evalDur);
                var totalH=L.rp?skinMPE(r.wl,L.tT):r.h;
                var totalE=isFinite(totalH)&&evalDur>0?totalH/evalDur:NaN;
                var durLabel=L.rp?"T = "+ft(L.tT):"\u03c4 = "+ft(L.dur);
                return <div style={{marginBottom:L.rp?12:0}}>
                  <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.ac,marginBottom:8}}>{L.rp?"MPE (total exposure at "+durLabel+")":"MPE"}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"+(L.rp?"":" 1fr"),gap:12}}>
                    <div style={{padding:irrPrimary?"6px 0":"6px 0 6px 0",borderLeft:!irrPrimary?"3px solid "+T.ac:"none",paddingLeft:!irrPrimary?8:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                        <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Fluence (H)</div>
                        <select value={L.fU} onChange={function(e){upL(L.id,"fU",e.target.value)}} style={{fontSize:9,padding:"1px 4px",background:T.card,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,outline:"none",cursor:"pointer"}}>
                          {FLUENCE_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}
                        </select>
                      </div>
                      <div style={{fontSize:15,fontWeight:600,letterSpacing:"-0.005em",fontFamily:"'IBM Plex Mono', monospace",color:!irrPrimary?T.ac:T.tm}}>{convF(totalH,L.fU)}</div>
                      <div style={{fontSize:9,color:!irrPrimary?T.a2:T.td,marginTop:1}}>{!irrPrimary?STD_NAME+" table value":"= E \u00d7 "+durLabel}</div>
                    </div>
                    <div style={{borderLeft:irrPrimary?"3px solid "+T.ac:"none",paddingLeft:irrPrimary?8:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                        <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Irradiance (E)</div>
                        <select value={L.eU} onChange={function(e){upL(L.id,"eU",e.target.value)}} style={{fontSize:9,padding:"1px 4px",background:T.card,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,outline:"none",cursor:"pointer"}}>
                          {IRRAD_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}
                        </select>
                      </div>
                      <div style={{fontSize:15,fontWeight:600,letterSpacing:"-0.005em",fontFamily:"'IBM Plex Mono', monospace",color:irrPrimary?T.ac:T.tm}}>{convE(totalE,L.eU)}</div>
                      <div style={{fontSize:9,color:irrPrimary?T.a2:T.td,marginTop:1}}>{irrPrimary?STD_NAME+" table value":"E = H / "+durLabel}</div>
                    </div>
                    {!L.rp?<div><div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Mode</div><div style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:T.tm}}>Single pulse</div><div style={{fontSize:9,color:T.td,marginTop:1}}>{durLabel}</div></div>:null}
                  </div>
                </div>;
              })()}
              {/* Task 7: Section 2 — Per-Pulse MPE (only for repetitive pulses) */}
              {r.rp?<div style={{paddingTop:10,borderTop:"1px solid "+T.bd}}>
                <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.ac,marginBottom:8}}>Per-Pulse MPE</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                      <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Fluence (H)</div>
                    </div>
                    <div style={{fontSize:15,fontWeight:600,letterSpacing:"-0.005em",fontFamily:"'IBM Plex Mono', monospace",color:T.ac}}>{convF(r.effH,L.fU)}</div>
                    {r.lacApplied?<div style={{fontSize:8,color:"#e65100",fontWeight:600,marginTop:1}}>{"\u26a0"} Large-area corrected</div>:null}
                    {r.inLacRange&&!r.lacApplied?<div style={{fontSize:8,color:"#e65100",marginTop:1}}>Enter beam diameter below</div>:null}
                    <div style={{fontSize:9,color:T.a2,marginTop:1}}>Governing per-pulse limit</div>
                  </div>
                  <div>
                    <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Irradiance (E)</div>
                    <div style={{fontSize:15,fontWeight:600,letterSpacing:"-0.005em",fontFamily:"'IBM Plex Mono', monospace",color:T.tm}}>{convE(r.irr,L.eU)}</div>
                    <div style={{fontSize:9,color:T.td,marginTop:1}}>E = H / {"\u03c4"}</div>
                  </div>
                  <div><div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Governing Rule</div><div style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:T.ac}}>{r.rule}</div><div style={{fontSize:9,color:T.td,marginTop:1}}>{Math.round(r.rp.N)+" pulses in "+ft(L.tT)}</div></div>
                </div>
                {/* Task 5: Rule comparison with correct labels; Task 8: show correct values */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
                  <div style={{padding:"8px 12px",borderRadius:4,opacity:r.rp.bd==="Rule 1"?1:0.35,background:r.rp.bd==="Rule 1"?T.ac+"12":"transparent",border:"1px solid "+(r.rp.bd==="Rule 1"?T.ac:T.bd)}}>
                    <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Rule 1 MPE (single pulse limit)</div>
                    <div style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:r.rp.bd==="Rule 1"?T.ac:T.td,marginTop:2}}>{convF(r.rp.r1,L.fU)}</div>
                    <div style={{fontSize:8,color:T.td,marginTop:2}}>MPE({"\u03c4"} = {ft(L.dur)})</div>
                  </div>
                  <div style={{padding:"8px 12px",borderRadius:4,opacity:r.rp.bd==="Rule 2"?1:0.35,background:r.rp.bd==="Rule 2"?T.ac+"12":"transparent",border:"1px solid "+(r.rp.bd==="Rule 2"?T.ac:T.bd)}}>
                    <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Rule 2 (average)</div>
                    <div style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:r.rp.bd==="Rule 2"?T.ac:T.td,marginTop:2}}>{convF(r.rp.r2,L.fU)}</div>
                    <div style={{fontSize:8,color:T.td,marginTop:2}}>MPE(T = {ft(L.tT)}) / N = {convF(skinMPE(r.wl,L.tT),L.fU)} / {Math.round(r.rp.N)}</div>
                  </div>
                </div>
              </div>:null}
              {L.dur<1e-9?<div style={{marginTop:8,fontSize:11,color:T.no,fontWeight:600}}>Duration below 1 ns {"\u2014"} {STD_NAME+" does not define"} skin MPE for this regime (p. 287)</div>:null}
            </div>:null}
          </div>
        </div>
      );})}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}><input type="number" placeholder="Wavelength (nm)" value={nw} onChange={function(e){setNw(e.target.value)}} onKeyDown={function(e){if(e.key==="Enter"){e.preventDefault();addL();}}} style={{width:160,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><button onClick={addL} style={mkBt(true,T.a2,T)}>+ Add Wavelength</button></div>
        <div style={{display:"flex",alignItems:"center",gap:10}}><button onClick={calc} style={{padding:"8px 24px",fontSize:13,fontWeight:700,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>{dirty?"Calculate":"Calculated \u2713"}</button>{dirty?<span style={{fontSize:11,color:T.ac,fontWeight:500}}>Click to update</span>:null}</div>
      </div>
      {/* ═══════ BEAM SAFETY EVALUATION (collapsible) ═══════ */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
        {needsBeamDia?<div style={{padding:"10px 14px",marginBottom:0,borderRadius:"6px 6px 0 0",background:"#fff3e0",border:"1px solid #ffe0b2",fontSize:11,color:"#e65100",lineHeight:1.7}}>
          <strong>{"\u26a0"} Large-area correction required ({STD_NAME}):</strong> One or more wavelength/duration combinations fall within the range where the {STD_NAME} large-area skin correction applies. <strong>Beam diameter input is required</strong> below to compute the correct MPE. The effective MPE may be reduced for large beam cross-sections.
        </div>:null}
        <button onClick={function(){if(needsBeamDia){setBeamOpen(true);}else{setBeamOpen(!beamOpen);}}} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"transparent",border:"none",cursor:needsBeamDia?"default":"pointer",color:T.tm,textAlign:"left"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:600,color:(beamOpen||needsBeamDia)?T.ac:T.tm}}>{(beamOpen||needsBeamDia)?"\u25BC":"\u25B6"}</span>
            <span style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:beamOpen?T.ac:T.tm}}>Beam Safety Evaluation</span>
            {!beamOpen?<span style={{fontSize:10,color:T.td,fontWeight:400}}>{"\u2014"} Evaluate max permissible pulse energy for a specific beam diameter</span>:null}
            {!beamOpen?<span style={{fontSize:9,fontFamily:"'IBM Plex Mono', monospace",color:T.tm,background:T.bgI,padding:"2px 8px",borderRadius:6,border:"1px solid "+T.bd}}>Limiting aperture: {getAperture(lasers[0]?lasers[0].wl:532).toFixed(1)} mm (skin, {STD_NAME} Table 8)</span>:null}
          </div>
        </button>
        {(beamOpen||needsBeamDia)?(
          <div style={{padding:"0 14px 14px"}}>
            {/* Convention warning — reads from standard JSON */}
            {(function(){
              var ap=_std.supplementary&&_std.supplementary.limiting_apertures;
              var defn=(ap&&ap.beam_diameter_definition)||"For Gaussian beams, beam diameter is the 1/e diameter (37% of peak irradiance).";
              var dRef=(ap&&ap.beam_diameter_reference)||"";
              return (
                <div style={{padding:"8px 12px",marginBottom:12,borderRadius:4,background:T.card,border:"1px solid "+T.bd,fontSize:10,color:T.tm,lineHeight:1.7}}>
                  <strong style={{color:T.tx}}>Beam diameter convention ({STD_NAME}{dRef?", "+dRef:""}):</strong>{" "}
                  {defn}{" "}
                  The 1/e diameter is <strong style={{color:T.no}}>{"\u221a"}2 {"\u2248"} 1.41{"\u00d7"} smaller</strong> than the 1/e{"\u00b2"} diameter commonly reported in laser datasheets.{" "}
                  If your spec sheet gives the 1/e{"\u00b2"} diameter, divide by 1.414 before entering here.{" "}
                  For top-hat/uniform beams, enter the physical beam diameter.
                </div>
              );
            })()}
            {/* Inputs with unit dropdowns */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={lb}>Beam Diameter</label>
                <div style={{display:"flex",gap:4}}>
                  <input type="text" value={bdStr} onChange={function(e){setBdStr(e.target.value);var v=parseFloat(e.target.value);if(isFinite(v)&&v>0){var toMM=1;for(var i=0;i<BEAM_DIA_UNITS.length;i++){if(BEAM_DIA_UNITS[i].id===bdUnit)toMM=BEAM_DIA_UNITS[i].toMM;}setBeamDia(v*toMM);}setBeamDirty(true);}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/>
                  <select value={bdUnit} onChange={function(e){var oldMM=1,newMM=1;for(var i=0;i<BEAM_DIA_UNITS.length;i++){if(BEAM_DIA_UNITS[i].id===bdUnit)oldMM=BEAM_DIA_UNITS[i].toMM;if(BEAM_DIA_UNITS[i].id===e.target.value)newMM=BEAM_DIA_UNITS[i].toMM;}var cur=parseFloat(bdStr);if(isFinite(cur)){var mm=cur*oldMM;setBdStr((mm/newMM).toPrecision(4));}setBdUnit(e.target.value);setBeamDirty(true);}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{BEAM_DIA_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
                </div>
              </div>
              <div>
                <label style={lb}>Pulse Energy (optional)</label>
                <div style={{display:"flex",gap:4}}>
                  <input type="text" placeholder="e.g. 500" value={peStr} onChange={function(e){setPeStr(e.target.value);setBeamDirty(true);}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/>
                  <select value={peUnit} onChange={function(e){setPeUnit(e.target.value);setBeamDirty(true);}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{ENERGY_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
                </div>
              </div>
              <div>
                <label style={lb}>Or Direct Fluence</label>
                <div style={{display:"flex",gap:4}}>
                  <input type="text" placeholder="Your fluence" value={fl} step="any" onChange={function(e){setFl(e.target.value);setBeamDirty(true);}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/>
                  <select value={flUnit} onChange={function(e){setFlUnit(e.target.value);setBeamDirty(true);}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{FLUENCE_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
                </div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <button onClick={beamCalc} style={{padding:"8px 24px",fontSize:13,fontWeight:700,background:beamDirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>{beamDirty?"Calculate":"Calculated \u2713"}</button>
              {beamDirty?<span style={{fontSize:11,color:T.ac,fontWeight:500}}>Click to update beam evaluation</span>:null}
            </div>
            {/* Wavelength selection */}
            <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Evaluate</span>
              {lasers.map(function(L,i){var col=WC[i%WC.length];var sel=isBeamSel(L.id);return(
                <label key={L.id} style={{display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",color:sel?col:T.td,opacity:sel?1:0.4}}>
                  <input type="checkbox" checked={sel} onChange={function(){togBeamSel(L.id)}} style={{accentColor:col,width:12,height:12}}/>
                  {L.wl} nm
                </label>
              );})}
            </div>
            {/* Multi-wavelength results table */}
            {(function(){
              /* Shared computations */
              var peVal=parseFloat(peStr);
              var peToJ=1;for(var pi=0;pi<ENERGY_UNITS.length;pi++){if(ENERGY_UNITS[pi].id===peUnit)peToJ=1/ENERGY_UNITS[pi].fromJ;}
              var E_user_J=(isFinite(peVal)&&peVal>0)?peVal*peToJ:null;
              var flRaw=fl?parseFloat(fl):null;
              var flToJcm2=1;for(var fi=0;fi<FLUENCE_UNITS.length;fi++){if(FLUENCE_UNITS[fi].id===flUnit)flToJcm2=1/FLUENCE_UNITS[fi].mult;}
              var flv2=(flRaw!==null&&isFinite(flRaw))?flRaw*flToJcm2:null;
              var eMult=1;for(var ei=0;ei<ENERGY_UNITS.length;ei++){if(ENERGY_UNITS[ei].id===eDispUnit)eMult=ENERGY_UNITS[ei].fromJ;}
              var aMult=1;for(var ai=0;ai<AREA_UNITS.length;ai++){if(AREA_UNITS[ai].id===aDispUnit)aMult=AREA_UNITS[ai].fromCM2;}
              var fMult=1;for(var fmi=0;fmi<FLUENCE_UNITS.length;fmi++){if(FLUENCE_UNITS[fmi].id===mpeDispUnit)fMult=FLUENCE_UNITS[fmi].mult;}
              function fmtE(v){if(!isFinite(v))return"\u2014";return numFmt(v*eMult,4);}
              function fmtA(v){if(!isFinite(v))return"\u2014";return numFmt(v*aMult,4);}
              function fmtH(v){if(!isFinite(v))return"\u2014";return numFmt(v*fMult,4);}
              var hasInput=E_user_J!==null||flv2!==null;

              /* Build rows for selected wavelengths */
              var selRows=[];
              var firstNote=null;
              for(var ri=0;ri<lasers.length;ri++){
                var L=lasers[ri];if(!isBeamSel(L.id))continue;
                var r=results[ri];if(!r||!isFinite(r.effH))continue;
                var bev=beamEval(r.wl,beamDia);
                if(bev.regime==="invalid"){selRows.push({L:L,r:r,bev:bev,invalid:true,idx:ri});continue;}
                var mpe=r.effH;
                var E_max=mpe*bev.area_cm2;
                var H_from_beam=E_user_J!==null?E_user_J/bev.area_cm2:null;
                var H_eval=(H_from_beam!==null)?H_from_beam:(flv2!==null?flv2:null);
                var ratio=H_eval!==null?H_eval/mpe:null;
                var safe=ratio!==null?ratio<=1:null;
                if(!firstNote)firstNote=bev.note;
                selRows.push({L:L,r:r,bev:bev,invalid:false,idx:ri,mpe:mpe,E_max:E_max,H_eval:H_eval,ratio:ratio,safe:safe});
              }
              if(selRows.length===0)return(<div style={{fontSize:11,color:T.td,padding:"8px 0"}}>Select at least one wavelength to evaluate.</div>);
              if(selRows[0].invalid)return(<div style={{fontSize:11,color:T.td,padding:"8px 0"}}>Enter a valid beam diameter to see evaluation results.</div>);

              var bthS={padding:"6px 8px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.tx,fontSize:8,fontWeight:600,letterSpacing:"0.04em",whiteSpace:"nowrap"};
              var btdS={padding:"6px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",borderBottom:"1px solid "+T.bd,color:T.tx};

              return(
                <div style={{opacity:(dirty||beamDirty)?0.6:1,transition:"opacity 0.2s"}}>
                  {/* Task 4: Large area correction warning */}
                  {(function(){
                    var warns=[];
                    for(var wi2=0;wi2<selRows.length;wi2++){
                      var wr=selRows[wi2];if(wr.invalid)continue;
                      var lac=getLargeAreaCorrection(wr.r.wl,wr.r.dur);
                      if(lac){
                        var A_beam_cm2=wr.bev.area_cm2;
                        if(A_beam_cm2>=lac.threshold_cm2){
                          var irr_limit_mW;
                          if(A_beam_cm2>=lac.cap_cm2)irr_limit_mW=lac.cap_mW_cm2;
                          else irr_limit_mW=lac.threshold_cm2*lac.cap_mW_cm2/A_beam_cm2;
                          warns.push({wl:wr.r.wl, A_cm2:A_beam_cm2, limit_mW_cm2:irr_limit_mW});
                        }
                      }
                    }
                    if(warns.length===0)return null;
                    var lacInfo=_std&&_std.supplementary&&_std.supplementary.large_area_correction;
                    return <div style={{padding:"10px 12px",marginBottom:12,borderRadius:4,background:"#fff3e0",border:"1px solid #ffe0b2",fontSize:10,color:"#e65100",lineHeight:1.7}}>
                      <strong>{"\u26a0"} Large-area correction ({STD_NAME}):</strong>{" "}
                      {lacInfo?lacInfo.description:"For large beam cross-sections, the skin exposure limit is reduced."}
                      {warns.map(function(w,wi3){
                        return <div key={wi3} style={{marginTop:4,fontFamily:"'IBM Plex Mono', monospace"}}>
                          {w.wl} nm: beam area = {numFmt(w.A_cm2,3)} cm{"\u00b2"} {"\u2192"} limit = {numFmt(w.limit_mW_cm2,4)} mW/cm{"\u00b2"}
                        </div>;
                      })}
                    </div>;
                  })()}
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>
                        <th style={bthS}>{"\u03bb"} (nm)</th>
                        <th style={bthS}>Duration <select value={sumDurU} onChange={function(e){setSumDurU(e.target.value)}} style={hSel}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></th>
                        <th style={bthS}>Band</th>
                        <th style={bthS}>Limiting Aperture (mm)</th>
                        <th style={bthS}>Regime</th>
                        <th style={bthS}>Eval Diameter (mm)</th>
                        <th style={bthS}>Eval Area <select value={aDispUnit} onChange={function(e){setADispUnit(e.target.value)}} style={hSel}>{AREA_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></th>
                        <th style={bthS}>Fluence, H <select value={mpeDispUnit} onChange={function(e){setMpeDispUnit(e.target.value)}} style={hSel}>{FLUENCE_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></th>
                        <th style={bthS}>Max Energy <select value={eDispUnit} onChange={function(e){setEDispUnit(e.target.value)}} style={hSel}>{ENERGY_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></th>
                        {hasInput?<th style={bthS}>Safety</th>:null}
                      </tr></thead>
                      <tbody>{selRows.map(function(row){
                        if(row.invalid)return null;
                        var col=WC[row.idx%WC.length];
                        var regC=row.bev.regime==="actual"?T.no:row.bev.regime==="aperture"?T.a2:T.ok;
                        var thr=row.bev.threshold_mm||1;
                        var regLbl=row.bev.regime==="actual"?"Actual beam (d < "+thr+" mm)":row.bev.regime==="aperture"?"Aperture-averaged":"Beam fills aperture";
                        return(<tr key={row.L.id}>
                          <td style={{padding:"6px 8px",fontWeight:700,fontSize:12,fontFamily:"'IBM Plex Mono', monospace",color:col,borderBottom:"1px solid "+T.bd}}>{row.r.wl}</td>
                          <td style={btdS}>{durInUnit(row.r.dur,sumDurU)}</td>
                          <td style={{padding:"6px 8px",fontSize:11,color:T.tx,borderBottom:"1px solid "+T.bd}}>{row.r.band}</td>
                          <td style={btdS}>{row.bev.aperture_mm.toFixed(1)}</td>
                          <td style={{padding:"6px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:600,color:regC,borderBottom:"1px solid "+T.bd}}>{regLbl}</td>
                          <td style={{padding:"6px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:700,color:T.tx,borderBottom:"1px solid "+T.bd}}>{row.bev.d_eval_mm.toFixed(3)}</td>
                          <td style={btdS}>{fmtA(row.bev.area_cm2)}</td>
                          <td style={{padding:"6px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:700,borderBottom:"1px solid "+T.bd,color:T.tx}}>{fmtH(row.mpe)}</td>
                          <td style={{padding:"6px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:700,color:T.ac,borderBottom:"1px solid "+T.bd}}>{fmtE(row.E_max)}</td>
                          {hasInput?<td style={{padding:"6px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:700,color:row.safe===null?T.td:row.safe?T.ok:T.no,borderBottom:"1px solid "+T.bd}}>{row.ratio!==null?(row.safe?"\u2713 ":"! ")+row.ratio.toPrecision(3)+"\u00d7":"\u2014"}</td>:null}
                        </tr>);
                      })}</tbody>
                    </table>
                  </div>
                  {/* Regime explanation from first selected wavelength */}
                  {firstNote?(
                    <div style={{fontSize:10,color:T.td,lineHeight:1.6,padding:"8px 10px",marginTop:10,background:T.bgI,borderRadius:4,border:"1px solid "+T.bd}}>
                      <strong style={{color:T.tm}}>{STD_NAME}:</strong>{" "}{firstNote}
                    </div>
                  ):null}
                </div>
              );
            })()}
          </div>
        ):null}
      </div>
      </div>

      {/* ═══ Region 2: MPE Results ═══ */}
      <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>MPE Results</div>
      {/* Summary table */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"14px",opacity:dirty?0.6:1,transition:"opacity 0.2s"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:T.tm}}>Summary{dirty?" (stale)":""}</div><button onClick={doExport} style={mkBt(false,T.ac,T)}>Export Report</button></div>
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>
          <th style={thS}>{"\u03bb"} (nm)</th>
          <th style={thS}>Duration <select value={sumDurU} onChange={function(e){setSumDurU(e.target.value)}} style={hSel}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></th>
          <th style={thS}>Band</th>
          <th style={thS}>C{"\u2090"}</th>
          <th style={thS}>Fluence, H <select value={sumFluU} onChange={function(e){setSumFluU(e.target.value)}} style={hSel}>{FLUENCE_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></th>
          <th style={thS}>Irradiance, E <select value={sumIrrU} onChange={function(e){setSumIrrU(e.target.value)}} style={hSel}>{IRRAD_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></th>
          <th style={thS}>Repetition Rate (Hz)</th>
          <th style={thS}>Pulses</th>
          <th style={thS}>Rule</th>
        </tr></thead><tbody>{results.map(function(r,i){var L=lasers[i];return (<tr key={L.id} style={{borderBottom:"1px solid "+T.bd}}>
          <td style={{padding:"7px 10px",color:WC[i%WC.length],fontWeight:700,fontSize:12,fontFamily:"'IBM Plex Mono', monospace"}}>{r.wl}</td>
          <td style={tdSt}>{durInUnit(r.dur,sumDurU)}</td>
          <td style={{padding:"7px 10px",fontSize:12,color:T.tm}}>{r.band}</td>
          <td style={tdSt}>{isInCARange(r.wl)?r.ca.toFixed(3):"\u2014"}</td>
          <td style={{padding:"7px 10px",fontSize:12,fontFamily:"'IBM Plex Mono', monospace",fontWeight:700}}>{convFN(r.effH,sumFluU)}{r.lacApplied?<span style={{fontSize:8,color:"#e65100",marginLeft:4}} title="Large-area correction applied">{"\u26a0"}</span>:null}{r.inLacRange&&!r.lacApplied?<span style={{fontSize:8,color:"#e65100",marginLeft:4}} title="Enter beam diameter for area correction">{"\u2731"}</span>:null}</td>
          <td style={tdSt}>{convEN(r.irr,sumIrrU)}</td>
          <td style={tdSt}>{L.rp?L.prf:"\u2014"}</td>
          <td style={tdSt}>{r.rp?Math.round(r.rp.N):"1"}</td>
          <td style={tdSt}>{r.rule}</td>
        </tr>);})}</tbody></table></div>
      </div>
      {/* Charts */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div><div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:T.tm,marginBottom:6}}>Per-Pulse MPE Plot</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{lasers.map(function(L,i){var col=WC[i%WC.length];return (<label key={L.id} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",color:L.show?col:T.td,opacity:L.show?1:0.4}}><input type="checkbox" checked={L.show} onChange={function(){toggleShow(L.id)}} style={{accentColor:col,width:13,height:13}}/>{L.wl} nm</label>);})}</div></div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <select value={plotFU} onChange={function(e){setPlotFU(e.target.value)}} style={{fontSize:10,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{FLUENCE_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
            <div style={{display:"flex"}}><button onClick={function(){setCht("wl")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(cht==="wl"?T.ac:T.bd),cursor:"pointer",background:cht==="wl"?T.ac:"transparent",color:cht==="wl"?"#fff":T.tm,borderRadius:"4px 0 0 4px"}}>MPE vs. Wavelength</button><button onClick={function(){setCht("t")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(cht==="t"?T.ac:T.bd),cursor:"pointer",background:cht==="t"?T.ac:"transparent",color:cht==="t"?"#fff":T.tm,borderRadius:"0 4px 4px 0"}}>MPE vs. Duration</button></div><button onClick={function(){dlSVG(cht==="wl"?wRef:dRef,cht==="wl"?"mpe_vs_wavelength.svg":"mpe_vs_duration.svg",setMsg)}} style={mkBt(false,T.ac,T)}>{"\u2913"} Download SVG</button><button onClick={function(){if(cht==="wl"){var hdr=["wavelength_nm"];for(var di=0;di<wld.durs.length;di++)hdr.push("mpe_"+plotFU.replace(/[/\u00b2]/g,"")+"_t"+ft(wld.durs[di]).replace(/ /g,""));var nd=wld.d.map(function(row){var o={wavelength_nm:row.wl};for(var di2=0;di2<wld.durs.length;di2++){o[hdr[di2+1]]=row["d"+di2];}return o;});dlCSV(nd,hdr,"mpe_vs_wavelength.csv",setMsg);}else{var hdr2=["duration_s"];drd.ws.forEach(function(w){hdr2.push("mpe_"+plotFU.replace(/[/\u00b2]/g,"")+"_"+w+"nm");});var nd2=drd.d.map(function(row){var o2={duration_s:row.t};drd.ws.forEach(function(w){o2["mpe_"+plotFU.replace(/[/\u00b2]/g,"")+"_"+w+"nm"]=row["w"+w];});return o2;});dlCSV(nd2,hdr2,"mpe_vs_duration.csv",setMsg);}}} style={mkBt(false,T.a2,T)}>{"\u2913"} Download CSV</button></div>
        </div>
        {cht==="wl"?(<div ref={wRef}><div style={{fontSize:11,color:T.tm,marginBottom:4}}>Per-Pulse Skin MPE ({plotFU}) vs. Wavelength (nm){wld.durs.length===1?" \u2014 t = "+ft(wld.durs[0]):""}</div><ResponsiveContainer width="100%" height={320}><LineChart data={wld.d} margin={{top:8,right:16,bottom:4,left:8}}><CartesianGrid strokeDasharray="3 3" stroke={T.gr}/><XAxis dataKey="wl" type="number" domain={[WL_PLOT_MIN,WL_PLOT_MAX]} ticks={WLTICKS} tick={{fill:T.td,fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}} stroke={T.bd} label={{value:"Wavelength (nm)",position:"insideBottom",offset:-2,style:{fontSize:10,fill:T.td}}}/><YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tickFormatter={logTick} tick={{fill:T.td,fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}} stroke={T.bd} width={65} label={{value:"Fluence, H ("+plotFU+")",angle:-90,position:"insideLeft",offset:0,style:{fontSize:10,fill:T.td,textAnchor:"middle"}}}/><Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:12,fontFamily:"'IBM Plex Mono', monospace",color:T.tx}} labelFormatter={function(v){return v!=null?v+" nm":""}} formatter={function(v,n){if(v==null)return["",""];var idx2=parseInt(String(n).replace("d",""),10);var label=wld.durs[idx2]!==undefined?"t="+ft(wld.durs[idx2]):"MPE";return [numFmt(Number(v),4)+" "+plotFU,label]}}/>{wld.durs.map(function(d,di){var ci=0;for(var j=0;j<plotLasers.length;j++){if(plotLasers[j].dur===d){ci=lasers.indexOf(plotLasers[j]);break;}}return <Line key={"wlc"+di} dataKey={"d"+di} stroke={WC[ci%WC.length]} strokeWidth={2} dot={false} name={"t="+ft(d)} connectNulls={true} isAnimationActive={false}/>;})}{wld.durs.length>1?<Legend wrapperStyle={{fontSize:11,fontFamily:"'IBM Plex Mono', monospace"}}/>:null}{_std.display_bands?_std.display_bands.map(function(b,bi){return bi<_std.display_bands.length-1?<ReferenceLine key={"bl"+bi} x={b.wl_end_nm} stroke={T.bl} strokeDasharray="4 4"/>:null;}):null}{plotLasers.map(function(L){var i=lasers.indexOf(L);var h=skinMPE(L.wl,L.dur);if(!isFinite(h)||h<=0)return null;return <ReferenceDot key={"wd"+L.id} x={L.wl} y={h*pfm} r={5} fill={WC[i%WC.length]} stroke={T.bg} strokeWidth={2}/>;})}</LineChart></ResponsiveContainer></div>):(<div ref={dRef}><div style={{fontSize:11,color:T.tm,marginBottom:4}}>Per-Pulse Skin MPE ({plotFU}) vs. Duration</div><ResponsiveContainer width="100%" height={320}><LineChart data={drd.d} margin={{top:8,right:16,bottom:4,left:8}}><CartesianGrid strokeDasharray="3 3" stroke={T.gr}/><XAxis dataKey="t" type="number" scale="log" domain={[1e-9,3e4]} ticks={DTICKS} tickFormatter={dtf} tick={{fill:T.td,fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}} stroke={T.bd}/><YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tickFormatter={logTick} tick={{fill:T.td,fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}} stroke={T.bd} width={65} label={{value:"Fluence, H ("+plotFU+")",angle:-90,position:"insideLeft",offset:0,style:{fontSize:10,fill:T.td,textAnchor:"middle"}}}/><Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:12,fontFamily:"'IBM Plex Mono', monospace",color:T.tx}} labelFormatter={function(v){return v!=null?ft(Number(v)):""}} formatter={function(v,n){if(v==null)return["",""];return [numFmt(Number(v),4)+" "+plotFU,String(n).replace("w","")+" nm"]}}/>{drd.ws.map(function(w,wi){var ci=0;for(var j=0;j<lasers.length;j++){if(lasers[j].wl===w&&lasers[j].show){ci=j;break;}}return <Line key={"ln"+w} dataKey={"w"+w} stroke={WC[ci%WC.length]} strokeWidth={2} dot={false} name={w+" nm"} connectNulls={true} isAnimationActive={false}/>;})}{drd.ws.length>1?<Legend wrapperStyle={{fontSize:11,fontFamily:"'IBM Plex Mono', monospace"}}/>:null}{plotLasers.map(function(L){var i=lasers.indexOf(L);var h=skinMPE(L.wl,L.dur);if(!isFinite(h)||h<=0)return null;return <ReferenceDot key={"dd"+L.id} x={L.dur} y={h*pfm} r={5} fill={WC[i%WC.length]} stroke={T.bg} strokeWidth={2}/>;})}</LineChart></ResponsiveContainer></div>)}
      </div>
      </div>

      {/* ═══ Region 3: Safety Notice ═══ */}
      <div style={{padding:"8px 12px",borderRadius:4,border:"1px solid "+T.bd,borderLeft:"3px solid #B45309",fontSize:9,color:T.td,lineHeight:1.6,background:T.bgI}}>
        <strong style={{color:T.tm}}>{"⚠"} Notice:</strong>{" "}
        This tool evaluates skin MPE per {STD_NAME}. It assumes Gaussian beam, uniform pulse energy, and ideal positioning.{" "}
        <strong style={{color:T.no}}>Research and educational use only.</strong>{" "}Displayed values are exposure limits, not laser classifications. Classification under IEC 60825-1 / ANSI Z136.1 requires additional analysis. Verify all values against the applicable standard.
      </div>
    </div>
  );
}

/* ═══════ PA TAB ═══════ */
/* Wavelength bands for multi-band fluence chart (cf. Francis et al. Fig. 2a) */
var paUid=1;
function mkPA(wl,tau,T){return{id:paUid++,wl:wl,wlStr:String(wl),wlU:"nm",tau:tau,tauStr:String(tau*1e9),tauU:"ns",T:T,TStr:String(T),TU:"s",show:true,inTable:true};}

function PATab(p){
  var T=p.T,theme=p.theme,msg=p.msg,setMsg=p.setMsg;

  var _entries=useState([mkPA(532,5e-9,1),mkPA(800,5e-9,1),mkPA(1064,5e-9,1)]);
  var entries=_entries[0],setEntries=_entries[1];
  var _nwl=useState(""),nwl=_nwl[0],setNwl=_nwl[1];
  var _paCht=useState("snr"),paCht=_paCht[0],setPaCht=_paCht[1];
  var _cv=useState(0),cv=_cv[0],setCv=_cv[1];
  var _dr=useState(false),dirty=_dr[0],setDirty=_dr[1];
  var flRef=useRef(null),snrRef=useRef(null);

  var lb={display:"block",fontSize:11,fontWeight:500,color:T.tm,marginBottom:3,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"};
  var secH={fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:T.td,marginBottom:8,paddingBottom:4,borderBottom:"1px solid "+T.bd,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"};
  var thS={padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.tx,fontSize:9,fontWeight:600,letterSpacing:"0.04em",whiteSpace:"nowrap"};
  var tdSt={padding:"7px 10px",fontSize:12,fontFamily:"'IBM Plex Mono', monospace",borderBottom:"1px solid "+T.bd};
  var hSel={fontSize:9,padding:"2px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer",fontWeight:600,outline:"none"};
  var ipSm={padding:"4px 8px",fontSize:12,fontFamily:"'IBM Plex Mono', monospace",fontVariantNumeric:"tabular-nums",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};

  function upE(id,key,val){setEntries(function(es){return es.map(function(e){
    if(e.id!==id)return e;var ne=Object.assign({},e);ne[key]=val;
    if(key==="wlStr"){var v=Number(val);if(isFinite(v)&&v>0){var m=1;for(var i=0;i<WL_UNITS.length;i++){if(WL_UNITS[i].id===ne.wlU)m=WL_UNITS[i].toNM;}ne.wl=v*m;}}
    if(key==="wlU"){var old=1,nw2=1;for(var i2=0;i2<WL_UNITS.length;i2++){if(WL_UNITS[i2].id===e.wlU)old=WL_UNITS[i2].toNM;if(WL_UNITS[i2].id===val)nw2=WL_UNITS[i2].toNM;}var cv2=parseFloat(e.wlStr);if(isFinite(cv2))ne.wlStr=(cv2*old/nw2).toPrecision(4);}
    if(key==="tauStr"){var v2=Number(val);if(isFinite(v2)&&v2>0){var m2=1;for(var i3=0;i3<DUR_UNITS.length;i3++){if(DUR_UNITS[i3].id===ne.tauU)m2=DUR_UNITS[i3].toS;}ne.tau=v2*m2;}}
    if(key==="tauU"){var old2=1,nw3=1;for(var i4=0;i4<DUR_UNITS.length;i4++){if(DUR_UNITS[i4].id===e.tauU)old2=DUR_UNITS[i4].toS;if(DUR_UNITS[i4].id===val)nw3=DUR_UNITS[i4].toS;}var cv3=parseFloat(e.tauStr);if(isFinite(cv3))ne.tauStr=(cv3*old2/nw3).toPrecision(4);ne.tau=ne.tau;}
    if(key==="TStr"){var v3=Number(val);if(isFinite(v3)&&v3>0){var m3=1;for(var i5=0;i5<DUR_UNITS.length;i5++){if(DUR_UNITS[i5].id===ne.TU)m3=DUR_UNITS[i5].toS;}ne.T=v3*m3;}}
    if(key==="TU"){var old3=1,nw4=1;for(var i6=0;i6<DUR_UNITS.length;i6++){if(DUR_UNITS[i6].id===e.TU)old3=DUR_UNITS[i6].toS;if(DUR_UNITS[i6].id===val)nw4=DUR_UNITS[i6].toS;}var cv4=parseFloat(e.TStr);if(isFinite(cv4))ne.TStr=(cv4*old3/nw4).toPrecision(4);ne.T=ne.T;}
    return ne;
  });});setDirty(true);}

  function addEntry(){var w=parseFloat(nwl)||800;setEntries(function(es){return es.concat([mkPA(w,5e-9,1)]);});setNwl("");setDirty(true);}
  function rmEntry(id){setEntries(function(es){return es.filter(function(e){return e.id!==id;});});setDirty(true);}
  function togShow(id){setEntries(function(es){return es.map(function(e){return e.id===id?Object.assign({},e,{show:!e.show}):e;});});}
  function togTable(id){setEntries(function(es){return es.map(function(e){return e.id===id?Object.assign({},e,{inTable:!e.inTable}):e;});});}
  function calc(){setCv(function(c){return c+1;});setDirty(false);}
  useEffect(function(){calc();},[]);

  var showEntries=entries.filter(function(e){return e.show;});

  /* PRF sample points */
  var prfPts=useMemo(function(){var pts=[];for(var le=0;le<=5.5;le+=0.04)pts.push(Math.pow(10,le));return pts;},[]);
  var PRFTICKS=[1,10,100,1e3,1e4,1e5];
  function prfFmt(v){if(v>=1e3)return(v/1e3)+"k";return String(v);}

  /* Fluence vs PRF: one curve per entry */
  var fluenceData=useMemo(function(){
    return prfPts.map(function(f){
      var row={f:f};
      for(var i=0;i<showEntries.length;i++){
        var e=showEntries[i];
        var eff=paEffFluence(e.wl,e.tau,f,e.T);
        if(isFinite(eff)&&eff>0)row["w"+i]=eff*1e3;
      }
      return row;
    });
  },[cv,showEntries,prfPts]);

  /* Crossover markers */
  var flCross=useMemo(function(){
    return showEntries.map(function(e,i){
      var fc=paOptPRF(e.wl,e.tau,e.T);
      var Hs=skinMPE(e.wl,e.tau);
      return{idx:i,f:fc,H:isFinite(Hs)?Hs*1e3:NaN};
    });
  },[cv,showEntries]);

  /* SNR vs PRF: one curve per entry */
  var snrData=useMemo(function(){
    return prfPts.map(function(f){
      var row={f:f};
      for(var i=0;i<showEntries.length;i++){
        var snr=paRelSNR(showEntries[i].wl,showEntries[i].tau,f,showEntries[i].T);
        if(isFinite(snr)&&snr>0)row["s"+i]=snr;
      }
      return row;
    });
  },[cv,showEntries,prfPts]);

  /* Optimal PRF for each entry (for table and markers) */
  var optData=useMemo(function(){
    return showEntries.map(function(e,i){
      var fopt=paOptPRF(e.wl,e.tau,e.T);
      var snrOpt=isFinite(fopt)?paRelSNR(e.wl,e.tau,fopt,e.T):NaN;
      var Nopt=isFinite(fopt)?fopt*e.T:NaN;
      var HatOpt=isFinite(fopt)?paEffFluence(e.wl,e.tau,fopt,e.T):NaN;
      return{e:e,fopt:fopt,snrOpt:snrOpt,Nopt:Nopt,HatOpt:HatOpt,idx:i};
    });
  },[cv,showEntries]);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* ═══ Region 1: Optimization Parameters ═══ */}
      <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Optimization Parameters</div>
      {/* ── Wavelength entries ── */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={secH}>Photoacoustic System Parameters</div>
        {entries.map(function(e,ei){var col=WC[ei%WC.length];return (
          <div key={e.id} style={{borderBottom:"1px solid "+T.bd,paddingBottom:10,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:10,height:10,borderRadius:4,background:col}}/>
                <span style={{fontSize:12,fontWeight:700,fontFamily:"'IBM Plex Mono', monospace",color:col}}>{e.wl} nm</span>
                <span style={{fontSize:9,color:T.td}}>{bnd(e.wl)} {"\u00b7"} C{"\u2090"} = {CA(e.wl).toFixed(3)}</span>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {entries.length>1?<button onClick={function(){rmEntry(e.id)}} style={{background:"none",border:"none",color:T.td,cursor:"pointer",fontSize:15}}>{"\u00d7"}</button>:null}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div><label style={lb}>Wavelength</label><div style={{display:"flex",gap:3}}>
                <input type="text" value={e.wlStr} onChange={function(ev){upE(e.id,"wlStr",ev.target.value)}} style={Object.assign({},ipSm,{flex:1})}/>
                <select value={e.wlU} onChange={function(ev){upE(e.id,"wlU",ev.target.value)}} style={{fontSize:10,padding:"3px 4px",background:T.card,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,cursor:"pointer"}}>{WL_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
              </div></div>
              <div><label style={lb}>Pulse Duration</label><div style={{display:"flex",gap:3}}>
                <input type="text" value={e.tauStr} onChange={function(ev){upE(e.id,"tauStr",ev.target.value)}} style={Object.assign({},ipSm,{flex:1})}/>
                <select value={e.tauU} onChange={function(ev){upE(e.id,"tauU",ev.target.value)}} style={{fontSize:10,padding:"3px 4px",background:T.card,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
              </div><div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>= {ft(e.tau)}</div></div>
              <div><label style={lb}>Exposure Time</label><div style={{display:"flex",gap:3}}>
                <input type="text" value={e.TStr} onChange={function(ev){upE(e.id,"TStr",ev.target.value)}} style={Object.assign({},ipSm,{flex:1})}/>
                <select value={e.TU} onChange={function(ev){upE(e.id,"TU",ev.target.value)}} style={{fontSize:10,padding:"3px 4px",background:T.card,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
              </div><div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>= {ft(e.T)}</div></div>
            </div>
          </div>
        );})}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="number" placeholder="Wavelength (nm)" value={nwl} onChange={function(ev){setNwl(ev.target.value)}} onKeyDown={function(ev){if(ev.key==="Enter"){ev.preventDefault();addEntry();}}} style={{width:150,padding:"6px 10px",fontSize:12,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
            <button onClick={addEntry} style={mkBt(true,T.a2,T)}>+ Add Wavelength</button>
          </div>
          <button onClick={calc} style={{padding:"8px 24px",fontSize:13,fontWeight:700,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>{dirty?"Calculate":"Calculated \u2713"}</button>
        </div>
      </div>
      </div>

      {/* ═══ Region 2: Optimization Results ═══ */}
      <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Optimization Results</div>
      {/* ── Optimal PRF Summary Table ── */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14,opacity:dirty?0.6:1,transition:"opacity 0.2s"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={secH}>Optimal Repetition Rate Summary</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Include:</span>
            {entries.map(function(e,ei){var col=WC[ei%WC.length];return(
              <label key={e.id} style={{display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",color:e.inTable?col:T.td,opacity:e.inTable?1:0.4}}>
                <input type="checkbox" checked={e.inTable} onChange={function(){togTable(e.id)}} style={{accentColor:col,width:12,height:12}}/>{e.wl} nm
              </label>
            );})}
          </div>
        </div>
        {(function(){var tE=entries.filter(function(e){return e.inTable;});return(
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>
          <th style={thS}>{"\u03bb"} (nm)</th>
          <th style={thS}>Pulse Duration</th>
          <th style={thS}>Exposure Time</th>
          <th style={thS}>Optimal PRF (Hz)</th>
          <th style={thS}>N at Optimal</th>
          <th style={thS}>Peak Relative SNR</th>
          <th style={thS}>Single-Pulse MPE (mJ/cm{"\u00b2"})</th>
          <th style={thS}>Per-Pulse at Optimal (mJ/cm{"\u00b2"})</th>
        </tr></thead>
        <tbody>{tE.map(function(e2){var ei=entries.indexOf(e2);var col=WC[ei%WC.length];
          var fopt=paOptPRF(e2.wl,e2.tau,e2.T);var snrOpt=isFinite(fopt)?paRelSNR(e2.wl,e2.tau,fopt,e2.T):NaN;
          var Nopt=isFinite(fopt)?fopt*e2.T:NaN;var HatOpt=isFinite(fopt)?paEffFluence(e2.wl,e2.tau,fopt,e2.T):NaN;
          return (<tr key={e2.id} style={{borderBottom:"1px solid "+T.bd}}>
          <td style={{padding:"7px 10px",fontSize:12,fontFamily:"'IBM Plex Mono', monospace",fontWeight:700,color:col,borderBottom:"1px solid "+T.bd}}>{e2.wl}</td>
          <td style={tdSt}>{ft(e2.tau)}</td>
          <td style={tdSt}>{ft(e2.T)}</td>
          <td style={tdSt}>{isFinite(fopt)?numFmt(fopt,4):"\u2014"}</td>
          <td style={tdSt}>{isFinite(Nopt)?numFmt(Nopt,4):"\u2014"}</td>
          <td style={{padding:"7px 10px",fontSize:12,fontFamily:"'IBM Plex Mono', monospace",fontWeight:700,borderBottom:"1px solid "+T.bd}}>{isFinite(snrOpt)?snrOpt.toFixed(2)+"\u00d7":"\u2014"}</td>
          <td style={tdSt}>{numFmt(skinMPE(e2.wl,e2.tau)*1e3,4)}</td>
          <td style={tdSt}>{isFinite(HatOpt)?numFmt(HatOpt*1e3,4):"\u2014"}</td>
        </tr>);})}</tbody></table></div>);})()}
      </div>

      {/* ── Charts ── */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:8}}>
          <div style={secH}>Safety-Constrained Analysis</div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{display:"flex"}}>
              <button onClick={function(){setPaCht("snr")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(paCht==="snr"?T.ac:T.bd),cursor:"pointer",background:paCht==="snr"?T.ac:"transparent",color:paCht==="snr"?"#fff":T.tm,borderRadius:"4px 0 0 4px"}}>Relative SNR vs. PRF</button>
              <button onClick={function(){setPaCht("fl")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(paCht==="fl"?T.ac:T.bd),cursor:"pointer",background:paCht==="fl"?T.ac:"transparent",color:paCht==="fl"?"#fff":T.tm,borderRadius:"0 4px 4px 0"}}>Per-Pulse Fluence vs. PRF</button>
            </div>
            <button onClick={function(){dlSVG(paCht==="fl"?flRef:snrRef,paCht==="fl"?"fluence_vs_prf.svg":"snr_vs_prf.svg",setMsg)}} style={mkBt(false,T.ac,T)}>{"\u2913"} SVG</button>
            <button onClick={function(){
              if(paCht==="fl"){
                var hdr=["repetition_rate_Hz"];showEntries.forEach(function(e){hdr.push(e.wl+"nm_mJ_cm2");});
                dlCSV(fluenceData.map(function(r){var o={repetition_rate_Hz:r.f};showEntries.forEach(function(e,i){o[e.wl+"nm_mJ_cm2"]=r["w"+i];});return o;}),hdr,"fluence_vs_prf.csv",setMsg);
              } else {
                var hdr2=["repetition_rate_Hz"];showEntries.forEach(function(e){hdr2.push(e.wl+"nm_T"+e.T+"s_snr");});
                dlCSV(snrData.map(function(r){var o={repetition_rate_Hz:r.f};showEntries.forEach(function(e,i){o[e.wl+"nm_T"+e.T+"s_snr"]=r["s"+i];});return o;}),hdr2,"snr_vs_prf.csv",setMsg);
              }
            }} style={mkBt(false,T.a2,T)}>{"\u2913"} CSV</button>
          </div>
        </div>
        {/* Plot wavelength selector */}
        <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Plot:</span>
          {entries.map(function(e,ei){var col=WC[ei%WC.length];return(
            <label key={e.id} style={{display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",color:e.show?col:T.td,opacity:e.show?1:0.4}}>
              <input type="checkbox" checked={e.show} onChange={function(){togShow(e.id)}} style={{accentColor:col,width:12,height:12}}/>{e.wl} nm
            </label>
          );})}
        </div>

        {paCht==="fl"?(
          <div ref={flRef}>
            <div style={{fontSize:11,color:T.tm,marginBottom:4}}>
              Per-Pulse Fluence Limit (mJ/cm{"\u00b2"}) vs. Repetition Rate
              <span style={{fontSize:9,color:T.td,marginLeft:8}}>Dots mark Rule 1/Rule 2 crossover (optimal PRF)</span>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={fluenceData} margin={{top:8,right:16,bottom:32,left:12}}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.gr}/>
                <XAxis dataKey="f" type="number" scale="log" domain={[1,3e5]} ticks={PRFTICKS} tickFormatter={prfFmt} tick={{fill:T.td,fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}} stroke={T.bd}>
                  <Label value="Pulse Repetition Frequency (Hz)" position="insideBottom" offset={-18} style={{fontSize:10,fill:T.td}}/>
                </XAxis>
                <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tickFormatter={logTick} tick={{fill:T.td,fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}} stroke={T.bd} width={65}>
                  <Label value={"Per-Pulse Fluence Limit (mJ/cm\u00b2)"} angle={-90} position="insideLeft" offset={0} style={{fontSize:10,fill:T.td,textAnchor:"middle"}}/>
                </YAxis>
                <Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:11,fontFamily:"'IBM Plex Mono', monospace",color:T.tx}} labelFormatter={function(v){return v!=null?numFmt(Number(v),3)+" Hz":""}} formatter={function(v,n){if(v==null)return["",""];var wi=parseInt(String(n).replace("w",""),10);var en=showEntries[wi];return[numFmt(Number(v),4)+" mJ/cm\u00b2",en?en.wl+" nm":""]}}/>
                {showEntries.map(function(e,i){
                  return <Line key={"fl"+e.id} dataKey={"w"+i} stroke={WC[entries.indexOf(e)%WC.length]} strokeWidth={2} dot={false} name={e.wl+" nm"} connectNulls={true} isAnimationActive={false}/>;
                })}
                {showEntries.length>1?<Legend verticalAlign="top" wrapperStyle={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",paddingBottom:4}}/>:null}
                {flCross.map(function(cr){
                  if(!isFinite(cr.f)||!isFinite(cr.H)||cr.f<1||cr.f>3e5)return null;
                  return <ReferenceDot key={"fc"+cr.idx} x={cr.f} y={cr.H} r={5} fill={WC[entries.indexOf(showEntries[cr.idx])%WC.length]} stroke={T.card} strokeWidth={1.5}/>;
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ):(
          <div ref={snrRef}>
            <div style={{fontSize:11,color:T.tm,marginBottom:4}}>
              Relative SNR vs. Repetition Rate
              <span style={{fontSize:9,color:T.td,marginLeft:8}}>Dots mark optimal PRF (f*) for each wavelength</span>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={snrData} margin={{top:8,right:16,bottom:32,left:12}}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.gr}/>
                <XAxis dataKey="f" type="number" scale="log" domain={[1,3e5]} ticks={PRFTICKS} tickFormatter={prfFmt} tick={{fill:T.td,fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}} stroke={T.bd}>
                  <Label value="Pulse Repetition Frequency (Hz)" position="insideBottom" offset={-18} style={{fontSize:10,fill:T.td}}/>
                </XAxis>
                <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tickFormatter={logTick} tick={{fill:T.td,fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}} stroke={T.bd} width={65}>
                  <Label value={"Relative SNR (\u221aN \u00d7 H / H\u2080)"} angle={-90} position="insideLeft" offset={0} style={{fontSize:10,fill:T.td,textAnchor:"middle"}}/>
                </YAxis>
                <Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:11,fontFamily:"'IBM Plex Mono', monospace",color:T.tx}} labelFormatter={function(v){return v!=null?numFmt(Number(v),3)+" Hz":""}} formatter={function(v,n){if(v==null)return["",""];var si2=parseInt(String(n).replace("s",""),10);var en=showEntries[si2];return[Number(v).toFixed(3)+"\u00d7",en?en.wl+" nm, T="+ft(en.T):""]}}/>
                {showEntries.map(function(e,i){return <Line key={"snr"+e.id} dataKey={"s"+i} stroke={WC[entries.indexOf(e)%WC.length]} strokeWidth={2} dot={false} name={e.wl+" nm (T="+ft(e.T)+")"} connectNulls={true} isAnimationActive={false}/>;})
                }
                {showEntries.length>1?<Legend verticalAlign="top" wrapperStyle={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",paddingBottom:4}}/>:null}
                <ReferenceLine y={1} stroke={T.bl} strokeDasharray="4 4" label={{value:"N=1",position:"right",style:{fontSize:9,fill:T.td}}}/>
                {optData.map(function(o){if(!isFinite(o.fopt)||!isFinite(o.snrOpt)||o.snrOpt<=0)return null;return <ReferenceDot key={"opt"+o.idx} x={o.fopt} y={o.snrOpt} r={6} fill={WC[entries.indexOf(showEntries[o.idx])%WC.length]} stroke={T.card} strokeWidth={2}/>;})
                }
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Reference citation ── */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"12px 14px",fontSize:11,color:T.td,lineHeight:1.6}}>
        <strong>Reference:</strong> Francis et al., {"\u201c"}Optimization of light source parameters for photoacoustic imaging: trade-offs, technologies, and clinical considerations,{"\u201d"} <em>JPhys Photonics</em> (2026). SNR analysis based on Equations 5{"\u2013"}12.
      </div>
      </div>

      {/* ═══ Region 3: Safety Notice ═══ */}
      <div style={{padding:"8px 12px",borderRadius:4,border:"1px solid "+T.bd,borderLeft:"3px solid #B45309",fontSize:9,color:T.td,lineHeight:1.6,background:T.bgI}}>
        <strong style={{color:T.tm}}>{"\u26a0"} Notice:</strong>{" "}
        This tool evaluates skin MPE per {STD_NAME}. Optimization is constrained by MPE safety limits.{" "}
        <strong style={{color:T.no}}>Research and educational use only.</strong>{" "}Displayed values are recommendations, not classifications. Verify all values against the applicable standard.
      </div>
    </div>
  );
}

/* ═══════ SCAN TAB ═══════ */
function GeneralScanContent(p){
  var T=p.T,theme=p.theme,msg=p.msg,setMsg=p.setMsg;
  var _wl=useState("532"),wlS=_wl[0],setWlS=_wl[1]; var _wn=useState(532),wl=_wn[0],setWl=_wn[1];
  var _d=useState("1"),dS=_d[0],setDS=_d[1]; var _dn=useState(1),dia=_dn[0],setDia=_dn[1];
  var _tau=useState("10"),tauS=_tau[0],setTauS=_tau[1]; var _tn=useState(1e-8),tau=_tn[0],setTau=_tn[1];
  var _tU=useState("ns"),tauU=_tU[0],setTauU=_tU[1];
  var _prf=useState("10"),prfS=_prf[0],setPrfS=_prf[1]; var _pn=useState(10000),prf=_pn[0],setPrf=_pn[1];
  var _pfU=useState("kHz"),prfU=_pfU[0],setPrfU=_pfU[1];
  var _pw=useState("0.5"),pwS=_pw[0],setPwS=_pw[1]; var _pwn=useState(0.5),pw=_pwn[0],setPw=_pwn[1];
  var _pwMode=useState("power"),pwMode=_pwMode[0],setPwMode=_pwMode[1]; /* "power" or "energy" */
  var _lcm=useState("pulsed"),laserMode=_lcm[0],setLaserMode=_lcm[1]; /* "pulsed" | "cw" */
  var _epS=useState(""),epS=_epS[0],setEpS=_epS[1];
  var _vs=useState("100"),vS=_vs[0],setVS=_vs[1]; var _vn=useState(100),vel=_vn[0],setVel=_vn[1];
  var _vMode=useState("velocity"),velMode=_vMode[0],setVelMode=_vMode[1]; /* "velocity"|"dwell"|"scanrate"|"framerate" */
  var _dw=useState("10"),dwellS=_dw[0],setDwellS=_dw[1]; var _dwN=useState(10),dwellN=_dwN[0],setDwellN=_dwN[1]; /* µs per spot */
  var _sr=useState("5"),srateS=_sr[0],setSrateS=_sr[1]; var _srN=useState(5),srateN=_srN[0],setSrateN=_srN[1]; /* lines/s */
  var _fr=useState("1"),frateS=_fr[0],setFrateS=_fr[1]; var _frN=useState(1),frateN=_frN[0],setFrateN=_frN[1]; /* fps */
  var _pat=useState("raster"),pat=_pat[0],setPat=_pat[1];
  var _lL=useState("20"),lLS=_lL[0],setLLS=_lL[1]; var _lLn=useState(20),lineL=_lLn[0],setLineL=_lLn[1]; /* scan width = line length */
  var _sH=useState("10"),scanHS=_sH[0],setScanHS=_sH[1]; var _sHn=useState(10),scanHN=_sHn[0],setScanHN=_sHn[1]; /* scan area height (raster) */
  var _nL=useState("8"),nLS=_nL[0],setNLS=_nL[1]; var _nLn=useState(8),nLines=_nLn[0],setNLines=_nLn[1]; /* scan line count */
  var _htn=useState(10/7),hatch=_htn[0],setHatch=_htn[1]; /* derived: scanHN/(nLines-1); never directly entered */

  var _ppd=useState(8),ppd=_ppd[0],setPpd=_ppd[1];
  var _dwm=useState("gaussian"),dwm=_dwm[0],setDwm=_dwm[1];
  var _blk=useState(false),blk=_blk[0],setBlk=_blk[1];
  var _res=useState(null),res=_res[0],setRes=_res[1];
  var _cmp=useState(false),cmp=_cmp[0],setCmp=_cmp[1];
  var _dirty=useState(true),dirty=_dirty[0],setDirty=_dirty[1];

  /* Scan visualization feature toggles */
  var _svGrid=useState(true),svGrid=_svGrid[0],setSvGrid=_svGrid[1];
  var _svBeam=useState(true),svBeam=_svBeam[0],setSvBeam=_svBeam[1];
  var _svFlyback=useState(true),svFlyback=_svFlyback[0],setSvFlyback=_svFlyback[1];
  var _svAnts=useState(false),svAnts=_svAnts[0],setSvAnts=_svAnts[1];
  var _antOff=useState(0),antOff=_antOff[0],setAntOff=_antOff[1];
  useEffect(function(){
    if(!svAnts)return;
    var f;var tick=function(){setAntOff(function(p){return(p+0.5)%20;});f=requestAnimationFrame(tick);};
    f=requestAnimationFrame(tick);
    return function(){cancelAnimationFrame(f);};
  },[svAnts]);

  var lb={display:"block",fontSize:11,fontWeight:500,color:T.tm,marginBottom:3,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"};
  var ip={width:"100%",padding:"6px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",fontVariantNumeric:"tabular-nums",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};
  var secH={fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:T.td,marginBottom:8,paddingBottom:4,borderBottom:"1px solid "+T.bd,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"};
  var thS={padding:"5px 8px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700};
  var tdS={padding:"5px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace"};

  function upN(setS,setN,s){setS(s);var v=Number(s);if(isFinite(v))setN(v);setDirty(true);}
  function upTau(s){setTauS(s);var v=Number(s);if(isFinite(v)&&v>0){var m=1;for(var i=0;i<DUR_UNITS.length;i++){if(DUR_UNITS[i].id===tauU)m=DUR_UNITS[i].toS;}setTau(v*m);}setDirty(true);}
  function upPrf(s){setPrfS(s);var v=Number(s);if(isFinite(v)&&v>0){var m=1;for(var i=0;i<FREQ_UNITS.length;i++){if(FREQ_UNITS[i].id===prfU)m=FREQ_UNITS[i].toHz;}setPrf(v*m);}setDirty(true);}
  /* Power/energy toggle helpers */
  function upPw(s){setPwS(s);var v=Number(s);if(isFinite(v)&&v>0){setPw(v);if(prf>0)setEpS((v/prf).toExponential(4));}setDirty(true);}
  function upEp(s){setEpS(s);var v=Number(s);if(isFinite(v)&&v>0&&prf>0){var P=v*prf;setPw(P);setPwS(P.toPrecision(4));}setDirty(true);}
  /* When PRF changes and mode is energy, recompute power */
  useEffect(function(){if(pwMode==="energy"&&prf>0){var v=Number(epS);if(isFinite(v)&&v>0){setPw(v*prf);setPwS((v*prf).toPrecision(4));}}},[prf,pwMode,epS]);
  /* When PRF changes and mode is power, update displayed Ep */
  useEffect(function(){if(pwMode==="power"&&prf>0&&pw>0){setEpS((pw/prf).toExponential(4));}},[prf,pw,pwMode]);
  /* Keep hatch in sync with scan height and scan line count */
  useEffect(function(){
    if((pat==="raster"||pat==="bidi")&&scanHN>0&&nLines>=1)setHatch(nLines>1?scanHN/(nLines-1):scanHN);
  },[pat,scanHN,nLines]);
  /* Keep vel in sync for all derived velocity input modes */
  useEffect(function(){
    var v=0;
    if(velMode==="dwell"&&dwellN>0&&dia>0) v=dia/(dwellN*1e-6);
    else if(velMode==="scanrate"&&srateN>0&&lineL>0) v=srateN*lineL;
    else if(velMode==="framerate"&&frateN>0&&lineL>0) v=lineL*(pat==="linear"?1:nLines)*frateN;
    if(v>0&&isFinite(v)){setVel(v);setVS(v.toPrecision(4));}
  },[velMode,dwellN,srateN,frateN,lineL,nLines,dia,pat]);

  /* Selected point for timing diagram (null = worst-case) */
  var _selPt=useState(null),selPt=_selPt[0],setSelPt=_selPt[1];
  var _svHov=useState(null),svHov=_svHov[0],setSvHov=_svHov[1];
  var _selXS=useState(""),selXS=_selXS[0],setSelXS=_selXS[1];
  var _selYS=useState(""),selYS=_selYS[0],setSelYS=_selYS[1];
  var svRef=useRef(null);

  var _perfNote=useState(""),perfNote=_perfNote[0],setPerfNote=_perfNote[1];
  var _workerRef=useRef(null);

  /* ── LSP-JSON import state (Sub-phase 1D commit 2) ─────────────────────
     phase:  "idle" | "loading" | "loaded" | "error"
     When phase==="loaded", the existing scan-configuration inputs are
     disabled and display the LSP-derived values.  Eject restores the
     pre-import state.  The LSP worker is created lazily on first import. */
  var _lspState=useState({phase:"idle"}),lspState=_lspState[0],setLspState=_lspState[1];
  var _lspWorkerRef=useRef(null);
  var _lspInitRef=useRef(null);
  var _lspPreImportState=useRef(null);
  var _lspReqIdRef=useRef(0);  // monotonic request ID counter (prevents Math.random collisions)
  /* Holds the engine-format segments for a custom-path LSP (Sub-phase 1D
     commit 3).  Non-null only while phase==="loaded" AND the LSP used a
     segment-array authoritative path (canonicalize emitted scanParams=null
     with non-empty engineSegments).  Shape: {segments, bbox, totalTime_s,
     meanVelocity_mm_s, hasBlankedSegments, d_1e_mm}.                      */
  var _lspCustomSegsRef=useRef(null);

  /* Lazy worker creation + init.  Returns a Promise that resolves when the
     worker has accepted the standard.  Three structural defenses:
     (1) On init rejection we CLEAR _lspInitRef so the next import retries,
         rather than permanently caching the rejected promise.
     (2) We attach an 'error' event listener on the worker so script-load
         failures (CSP block, malformed bundle, etc) reject the promise
         rather than hanging forever.
     (3) We add a 10s init timeout as a last-resort defense; in practice
         init takes 50-200 ms in modern browsers.                          */
  function _getLspWorkerInited(){
    if (_lspInitRef.current) return _lspInitRef.current;
    if (typeof __createLSPWorker!=="function") return null;
    var w = __createLSPWorker();
    if (!w) return null;
    _lspWorkerRef.current = w;

    // Compute stdData OUTSIDE the Promise executor.  If _E.getStandard()
    // throws here, we can clean up the worker reference cleanly before
    // returning a rejected Promise; throwing inside the executor would
    // leak the worker ref because the catch path runs in a context where
    // we've already assigned _lspWorkerRef.current = w.
    var stdData;
    try {
      stdData = (typeof __STD_DATA__!=="undefined") ? __STD_DATA__ :
                (_E && _E.getStandard ? {standard:_E.getStandard()} : null);
    } catch (stdErr) {
      try { w.terminate(); } catch (_) {}
      _lspWorkerRef.current = null;
      _lspInitRef.current = null;
      return Promise.reject(new Error("Failed to obtain standard data: " +
        (stdErr && stdErr.message ? stdErr.message : String(stdErr))));
    }

    var p = new Promise(function(resolve, reject){
      var initReq = (++_lspReqIdRef.current);
      var settled = false;
      function settle(ok, err){
        if (settled) return; settled = true;
        try { w.removeEventListener("message", onInit); } catch (_) {}
        try { w.removeEventListener("error", onError); } catch (_) {}
        if (timeoutId) clearTimeout(timeoutId);
        if (ok) resolve();
        else {
          // Terminate the failed worker to free its thread/memory; clear
          // both refs so the next import retries with a fresh worker.
          try { w.terminate(); } catch (_) {}
          if (_lspWorkerRef.current === w) _lspWorkerRef.current = null;
          _lspInitRef.current = null;
          reject(err);
        }
      }
      function onInit(ev){
        if (!ev||!ev.data) return;
        if (ev.data.requestId!==initReq) return;
        // Accept both init_result and error (worker's top-level catch).
        // Without this, a worker exception during init would silently
        // hang us for the full 10 s timeout.
        if (ev.data.type==="init_result") {
          if (ev.data.ok) settle(true);
          else settle(false, new Error(ev.data.error||"LSP worker init failed"));
        } else if (ev.data.type==="error") {
          var firstErr = ev.data.errors && ev.data.errors[0];
          settle(false, new Error(
            (firstErr && firstErr.message) ? firstErr.message :
            "Worker emitted an error response during init"));
        }
        // Other response types: ignore.
      }
      function onError(ev){
        // Worker script-load failure or uncaught exception inside the worker.
        var msg = (ev && ev.message) ? ev.message :
                  (ev && ev.filename) ? ("error in "+ev.filename) :
                  "Worker reported an error before init completed";
        settle(false, new Error(msg));
      }
      var timeoutId = setTimeout(function(){
        settle(false, new Error("LSP worker init timed out after 10 s"));
      }, 10000);
      w.addEventListener("message", onInit);
      w.addEventListener("error", onError);
      try {
        w.postMessage({type:"init", requestId:initReq, standard:stdData});
      } catch (postErr) {
        settle(false, postErr);
      }
    });
    _lspInitRef.current = p;
    return p;
  }

  /* Send a canonicalize message and wait for the matching response.  Three
     structural defenses against M2 (handler leak): we ALWAYS remove the
     listener via a settle() helper, even on timeout; we time out after 30s
     (canonicalization on the largest realistic doc completes in 1-2 s); and
     errors during postMessage are caught synchronously.                  */
  function _canonicalizeViaWorker(doc){
    return new Promise(function(resolve, reject){
      var initP = _getLspWorkerInited();
      if (!initP){
        reject(new Error("LSP worker is not available in this environment"));
        return;
      }
      initP.then(function(){
        var w = _lspWorkerRef.current;
        if (!w){
          reject(new Error("LSP worker reference was cleared during init"));
          return;
        }
        var req = (++_lspReqIdRef.current);
        var settled = false;
        function settle(ok, val){
          if (settled) return; settled = true;
          try { w.removeEventListener("message", onMsg); } catch (_) {}
          try { w.removeEventListener("error", onError); } catch (_) {}
          if (timeoutId) clearTimeout(timeoutId);
          if (ok) resolve(val); else reject(val);
        }
        function onMsg(ev){
          if (!ev||!ev.data) return;
          if (ev.data.requestId!==req) return;
          // Accept both canonicalize_result (normal path) and error (worker's
          // top-level catch).  Both have matching requestId; both indicate
          // the worker is done with this request.  Without accepting "error"
          // here, an internal worker exception would cause us to wait the
          // full 30 s timeout when we already have the error in hand.
          if (ev.data.type==="canonicalize_result") {
            settle(true, ev.data);
          } else if (ev.data.type==="error") {
            // Worker emitted a top-level error response.  Surface it as a
            // structured canonicalize-style failure so the caller's existing
            // error-handling path works uniformly.
            settle(true, {
              type: "canonicalize_result",
              requestId: req,
              ok: false,
              errors: (ev.data.errors && ev.data.errors.length) ? ev.data.errors : [{
                code: "INTERNAL_ERROR", path: "",
                message: "Worker emitted an error response without details"
              }],
              warnings: []
            });
          }
          // Other response types: ignore (defensive — unknown protocol extension).
        }
        function onError(ev){
          var msg = (ev && ev.message) ? ev.message :
                    "Worker reported an error during canonicalization";
          settle(false, new Error(msg));
        }
        var timeoutId = setTimeout(function(){
          settle(false, new Error("LSP canonicalization timed out after 30 s"));
        }, 30000);
        w.addEventListener("message", onMsg);
        w.addEventListener("error", onError);
        try {
          w.postMessage({type:"canonicalize", requestId:req, doc:doc});
        } catch (postErr) {
          settle(false, postErr);
        }
      }, function(initErr){ reject(initErr); });
    });
  }

  /* Build the dicts of getters/setters used by the module-level LSP helpers.
     These dicts are recreated on every render — the helpers do not retain
     them between calls, so the per-render cost is just object allocation. */
  function _lspGetters(){
    return {
      wlS:wlS, wl:wl, dS:dS, dia:dia,
      tauS:tauS, tau:tau, tauU:tauU,
      prfS:prfS, prf:prf, prfU:prfU,
      pwS:pwS, pw:pw, pwMode:pwMode,
      laserMode:laserMode, epS:epS,
      vS:vS, vel:vel, velMode:velMode,
      dwellS:dwellS, dwellN:dwellN,
      srateS:srateS, srateN:srateN,
      frateS:frateS, frateN:frateN,
      pat:pat, lLS:lLS, lineL:lineL,
      scanHS:scanHS, scanHN:scanHN,
      nLS:nLS, nLines:nLines, blk:blk
    };
  }
  function _lspSetters(){
    return {
      setWlS:setWlS, setWl:setWl, setDS:setDS, setDia:setDia,
      setTauS:setTauS, setTau:setTau, setTauU:setTauU,
      setPrfS:setPrfS, setPrf:setPrf, setPrfU:setPrfU,
      setPwS:setPwS, setPw:setPw, setPwMode:setPwMode,
      setLaserMode:setLaserMode, setEpS:setEpS,
      setVS:setVS, setVel:setVel, setVelMode:setVelMode,
      setDwellS:setDwellS, setDwellN:setDwellN,
      setSrateS:setSrateS, setSrateN:setSrateN,
      setFrateS:setFrateS, setFrateN:setFrateN,
      setPat:setPat, setLLS:setLLS, setLineL:setLineL,
      setScanHS:setScanHS, setScanHN:setScanHN,
      setNLS:setNLS, setNLines:setNLines, setBlk:setBlk,
      setDirty:setDirty
    };
  }

  /* M32 fix: terminate the LSP worker on unmount so tab switching doesn't
     leak workers.  The dependency array is empty so this effect's cleanup
     runs only at unmount.  Reading _lspWorkerRef.current at unmount is
     correct — refs are mutable through the component's lifetime and the
     ref captures the latest worker. */
  useEffect(function(){
    return function(){
      var w = _lspWorkerRef.current;
      if (w) { try { w.terminate(); } catch (_) {} }
      _lspWorkerRef.current = null;
      _lspInitRef.current = null;
      // Clearing the custom-segs ref on unmount makes the setTimeout race
      // guard inside calculate() short-circuit if the user switched tabs
      // (which unmounts this component) during the 60 ms dispatch window.
      _lspCustomSegsRef.current = null;
    };
  }, []);

  function _handleLspImport(file){
    setLspState({phase:"loading", filename:file && file.name});
    _readAndValidateLSP(file).then(function(r){
      if (!r.ok) {
        setLspState({phase:"error", filename:file && file.name,
          errors:r.errors||[], warnings:r.warnings||[]});
        return;
      }
      _canonicalizeViaWorker(r.doc).then(function(cr){
        if (!cr.ok) {
          setLspState({phase:"error", filename:file && file.name,
            errors:cr.errors||[], warnings:(r.warnings||[]).concat(cr.warnings||[])});
          return;
        }
        // Snapshot pre-import state ONLY if we're entering loaded from idle
        // or error.  If we were already loaded (user re-importing without
        // ejecting), the existing snapshot still holds the true pre-LSP
        // state — keep it so Eject restores to manual values, not to the
        // previous LSP.
        if (lspState.phase==="idle" || lspState.phase==="error") {
          _lspPreImportState.current = _lspSnapshotState(_lspGetters());
        }
        // _lspApplyState handles both preset and custom-segment paths.  It
        // populates _lspCustomSegsRef.current when the LSP uses a custom
        // path (scanParams=null + engineSegments present), or clears it
        // for preset paths.
        var applyResult = _lspApplyState(cr, _lspSetters(), _lspCustomSegsRef);
        if (!applyResult.ok) {
          setLspState({phase:"error", filename:file && file.name,
            errors:applyResult.errors||[{code:"INTERNAL_ERROR", path:"",
              message:"Failed to apply LSP-derived values"}],
            warnings:(r.warnings||[]).concat(cr.warnings||[])});
          return;
        }
        setLspState({phase:"loaded", filename:file && file.name, doc:r.doc,
          customPath:applyResult.customPath,
          beam:cr.beam, engineSegments:cr.engineSegments, scanParams:cr.scanParams,
          totalTime_s:cr.totalTime_s, warnings:(r.warnings||[]).concat(cr.warnings||[])});
      }, function(workerErr){
        // Differentiate error codes based on the actual failure mode.
        // The Promise rejector inside _getLspWorkerInited / _canonicalizeViaWorker
        // throws Error objects with specific messages.  We pattern-match the
        // message to assign the right code so users see a meaningful error.
        // Patterns are deliberately broad: any timeout → WORKER_TIMEOUT;
        // any init-related failure → WORKER_INIT_FAILED; everything else
        // (including post-init worker exceptions and structured-clone errors)
        // falls through to WORKER_UNAVAILABLE.
        var errMsg = String(workerErr && workerErr.message || workerErr);
        var code = "WORKER_UNAVAILABLE";
        if (/timed out/i.test(errMsg)) {
          code = "WORKER_TIMEOUT";
        } else if (/\binit\b|standard data/i.test(errMsg)) {
          // Matches: "init failed", "init result", "during init",
          // "before init completed", "Failed to obtain standard data"
          code = "WORKER_INIT_FAILED";
        }
        setLspState({phase:"error", filename:file && file.name,
          errors:[{code:code, path:"", message:errMsg}],
          warnings:r.warnings||[]});
      });
    });
  }

  function _handleLspEject(){
    _lspRestoreState(_lspPreImportState.current, _lspSetters());
    setDirty(true);
    _lspPreImportState.current = null;
    _lspCustomSegsRef.current = null;
    setLspState({phase:"idle"});
  }
  var lspLoaded = lspState.phase==="loaded";
  /* During the "loading" phase the worker is canonicalizing the LSP and the
     state values are about to be overwritten by _lspApplyState. Disabling
     the fieldset during loading prevents the user from making edits that
     would be silently clobbered when the canonicalization resolves.        */
  var lspLocked = lspLoaded || lspState.phase==="loading";

  /* ── Web Worker: runs scanning computation off the main thread ── */
  function getWorker(){
    if(_workerRef.current)return _workerRef.current;
    if(typeof __ENGINE_SOURCE__==="undefined")return null;
    var workerCode=__ENGINE_SOURCE__+"\n"+[
      "self.onmessage=function(e){",
      "  var p=e.data;",
      "  MPEEngine.loadStandard(p.std);",
      "  var E=MPEEngine;",
      "  var isCW=p.prf===0&&p.tau===0;",
      "  var Ep=p.prf>0?p.pw/p.prf:0;",
      "  var beam={d_1e_mm:p.dia,wl_nm:p.wl,tau_s:p.tau,prf_hz:p.prf,",
      "    pulse_energy_J:Ep,avg_power_W:p.pw,is_cw:isCW};",
      "  /* Segment-superposition framework: create scan params for all patterns */",
      "  var sepP={d_1e_mm:p.dia,prf_hz:p.prf||0,pulse_energy_J:Ep,avg_power_W:p.pw,v_scan_mm_s:p.vel,",
      "     x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "     pattern:p.pat,blanking:p.blk,is_cw:isCW,v_jump_mm_s:p.vel*5};",
      "  /* Only build segments if separable path not available */",
      "  function bldSegs(pat,x0,y0,lL,nL,h,sv,jv,d,bl){",
      "    if(pat==='linear')return E.buildLinearScan(x0,y0,0,lL,sv,d);",
      "    return E.buildRasterScan(x0,y0,lL,nL,h,sv,jv,d,bl);}",
      "  var segs=sepP?[]:bldSegs(p.pat,0,0,p.lineL,p.nLines,p.hatch,p.vel,p.vel*5,p.dia,p.blk);",
      "  var cr=E.computeScanFluence(beam,segs,p.effPpd,sepP);",
      "  if(!cr){self.postMessage({error:'Computation returned null'});return;}",
      "  var eg=cr.grid,s=cr.stats;",
      "  var minV=isCW?(s.min_velocity||p.vel):0;",
      "  var sfBeam={wl_nm:p.wl,d_1e_mm:p.dia,tau_s:p.tau,is_cw:isCW,pulse_energy_J:Ep,prf_hz:p.prf,avg_power_W:p.pw};",
      "  var sf=E.evaluateScanSafety(eg,sfBeam,s.total_time_s,p.dwm,minV,{v_mm_s:p.vel,line_spacing_mm:p.hatch||0,n_lines:p.nLines||1});",
      "  /* Max permissible power */",
      "  var unitBeam={d_1e_mm:p.dia,wl_nm:p.wl,tau_s:p.tau,prf_hz:p.prf,",
      "    pulse_energy_J:p.prf>0?1/p.prf:0,avg_power_W:1,is_cw:isCW};",
      "  var unitSepP={d_1e_mm:p.dia,prf_hz:p.prf||0,pulse_energy_J:p.prf>0?1/p.prf:0,avg_power_W:1,v_scan_mm_s:p.vel,",
      "     x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "     pattern:p.pat,blanking:p.blk,is_cw:isCW,v_jump_mm_s:p.vel*5};",
      "  var ucr=E.computeScanFluence(unitBeam,sepP?[]:segs,p.auxPpd,unitSepP);",
      "  var maxP=Infinity;",
      "  if(ucr){var upF=0;for(var i=0;i<ucr.grid.fluence.length;i++)if(ucr.grid.fluence[i]>upF)upF=ucr.grid.fluence[i];",
      "    var mpeT=E.skinMPE(p.wl,ucr.stats.total_time_s||s.total_time_s);",
      "    if(upF>0)maxP=mpeT/upF;",
      "    if(!isCW&&p.prf>0){var w2=p.dia/Math.sqrt(2);var maxPr1=E.skinMPE(p.wl,p.tau)*p.prf*Math.PI*w2*w2/(2*100);",
      "      if(maxPr1<maxP)maxP=maxPr1;}}",
      "  /* Min safe velocity bisection */",
      "  var minVel=0;",
      "  function testV(tv){",
      "    var tSepP={d_1e_mm:p.dia,prf_hz:p.prf||0,pulse_energy_J:Ep,avg_power_W:p.pw,v_scan_mm_s:tv,",
      "       x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "       pattern:p.pat,blanking:p.blk,is_cw:isCW,v_jump_mm_s:tv*5};",
      "    var ts2=tSepP?[]:bldSegs(p.pat,0,0,p.lineL,p.nLines,p.hatch,tv,tv*5,p.dia,p.blk);",
      "    var tb={d_1e_mm:p.dia,wl_nm:p.wl,tau_s:p.tau,prf_hz:p.prf,pulse_energy_J:Ep,avg_power_W:p.pw,is_cw:isCW};",
      "    var tcr=E.computeScanFluence(tb,ts2,p.auxPpd,tSepP);",
      "    if(!tcr)return true;",
      "    var tmv=isCW?(tcr.stats.min_velocity||tv):0;",
      "    var tsf=E.evaluateScanSafety(tcr.grid,sfBeam,tcr.stats.total_time_s,p.dwm,tmv,{v_mm_s:tv,line_spacing_mm:p.hatch||0,n_lines:p.nLines||1});",
      "    return tsf.safe;}",
      "  if(testV(1e6)){var vLo=0.01,vHi=1e6;",
      "    for(var bi=0;bi<p.maxBisect&&(vHi-vLo)/vLo>0.01;bi++){var vMid=(vLo+vHi)/2;if(testV(vMid))vHi=vMid;else vLo=vMid;}",
      "    minVel=vHi;}else{minVel=Infinity;}",
      "  /* Pulse positions for visualization (generated from scan params, not segments) */",
      "  var pulseArr=[];",
      "  if(!isCW&&p.prf>0){",
      "    var maxSP=5000;",
      "    var ps_mm=p.vel/p.prf;",
      "    var nPulsesLine=Math.max(1,Math.floor((p.lineL/p.vel)*p.prf));",
      "    var totalEst=nPulsesLine*(p.nLines||1);",
      "    var pStride=Math.max(1,Math.ceil(totalEst/maxSP));",
      "    var nL=p.nLines||1,hh=p.hatch||0,tAcc=0;",
      "    for(var li=0;li<nL&&pulseArr.length<maxSP;li++){",
      "      var ly=li*hh;",
      "      var scanDir=1; /* raster scans are unidirectional */",
      "      var xStart=scanDir===1?0:p.lineL;",
      "      for(var ki=0;ki<nPulsesLine&&pulseArr.length<maxSP;ki+=pStride){",
      "        var px=xStart+scanDir*ki*ps_mm;",
      "        pulseArr.push({t:tAcc+ki/p.prf,x:px,y:ly,si:li});",
      "      }",
      "      tAcc+=p.lineL/p.vel;",
      "      if(li<nL-1)tAcc+=hh/(p.vel*5);",
      "    }",
      "    if(pulseArr.length>=maxSP)p.notes.push('Showing '+maxSP+' of ~'+Math.round(totalEst)+' pulses');",
      "  }",
      "  /* Coarse segment array for scan path visualization only */",
      "  var vizSegs=[];",
      "  var MAX_VIZ_SEGS=5000;",
      "  var nL2=p.nLines||1;",
      "  var ptsPerLine=Math.ceil(p.lineL/p.dia);",
      "  /* Budget: distribute MAX_VIZ_SEGS across lines, skip lines if too many */",
      "  var lineStride=Math.max(1,Math.ceil(nL2*Math.min(ptsPerLine,200)/MAX_VIZ_SEGS));",
      "  var vizStep=Math.max(1,Math.ceil(ptsPerLine/Math.min(200,Math.floor(MAX_VIZ_SEGS/Math.ceil(nL2/lineStride)))));",
      "  for(var vli=0;vli<nL2&&vizSegs.length<MAX_VIZ_SEGS;vli+=lineStride){",
      "    var vly=vli*(p.hatch||0);",
      "    var vDir=1; /* raster is unidirectional */",
      "    var vx0=vDir===1?0:p.lineL;",
      "    var nVizPts=Math.ceil(ptsPerLine/vizStep);",
      "    for(var vsi=0;vsi<=nVizPts&&vizSegs.length<MAX_VIZ_SEGS;vsi++){",
      "      vizSegs.push({x:vx0+vDir*vsi*vizStep*p.dia,y:vly,a:vDir===1?0:Math.PI,v:p.vel});",
      "    }",
      "  }",
      "  /* Transfer TypedArrays for zero-copy performance */",
      "  var result={",
      "    g:{nx:eg.nx,ny:eg.ny,dx:eg.dx_mm,xn:eg.x_min_mm,yn:eg.y_min_mm},",
      "    flu:eg.fluence,pc:eg.pulse_count,ppH:eg.peak_pulse_H,lvt:eg.last_visit_t,mrv:eg.min_revisit_s,",
      "    st:{tt:s.total_time_s,tp:s.total_pulses||0,mv:s.min_velocity,stride:s.stride||1},",
      "    sf:{safe:sf.safe,wr:sf.worst_ratio,wx:sf.worst_x_mm,wy:sf.worst_y_mm,",
      "      br:sf.binding_rule,sm:sf.safety_margin,mt:sf.mpe_tau,mT:sf.mpe_T,",
      "      pF:sf.peak_fluence,ppM:sf.peak_pulse_H_max,mP:sf.max_pulses,",
      "      r1m:sf.rule1_max_ratio,r2m:sf.rule2_max_ratio,",
      "      minRv:sf.min_revisit_s,rvPts:sf.revisit_points,tauR:sf.thermal_relax_s,rvOk:sf.revisit_adequate,",
      "      anPeak:sf.analytical_peak,anUsed:sf.analytical_used},",
      "    maxP:maxP,minVel:minVel,pulseArr:pulseArr,segs:vizSegs,notes:p.notes};",
      "  self.postMessage(result,[eg.fluence.buffer,eg.pulse_count.buffer,eg.peak_pulse_H.buffer,eg.last_visit_t.buffer,eg.min_revisit_s.buffer]);",
      "};"
    ].join("\n");
    try{
      var blob=new Blob([workerCode],{type:"application/javascript"});
      _workerRef.current=new Worker(URL.createObjectURL(blob));
    }catch(err){
      if(typeof console!=="undefined")console.warn("Web Worker creation failed:",err);
      _workerRef.current=null;
    }
    return _workerRef.current;
  }

  var SCAN_WORKER_TIMEOUT_MS = 60000; // 60-second safety timeout
  var _workerTimeout = useRef(null);

  // Clean up Worker and timeout when ScanTab unmounts (e.g., standard change via key={stdVer})
  useEffect(function(){
    return function(){
      if(_workerRef.current){_workerRef.current.terminate();_workerRef.current=null;}
      if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
    };
  },[]);

  function calculate(){
    // ── Input validation (safety-critical) ──
    if(!isFinite(wl)||wl<180||wl>1e6){alert("Wavelength must be 180–1,000,000 nm");return;}
    if(!isFinite(dia)||dia<=0){alert("Beam diameter must be > 0");return;}
    if(!isFinite(pw)||pw<=0){alert(pwMode==="energy"?"Pulse energy must be > 0 (and PRF must be > 0 to compute average power)":"Average power must be > 0");return;}
    if(laserMode==="pulsed"){
      if(!isFinite(prf)||prf<0){alert("Repetition rate must be ≥ 0");return;}
      if(!isFinite(tau)||tau<=0){alert("Pulse duration must be > 0");return;}
    }
    // Scan area
    if(!isFinite(lineL)||lineL<=0){alert(pat!=="linear"?"Scan width must be > 0":"Scan length must be > 0");return;}
    if(pat!=="linear"){
      if(!isFinite(scanHN)||scanHN<=0){alert("Scan height must be > 0");return;}
      if(!isFinite(nLines)||nLines<1){alert("Number of scan lines must be ≥ 1");return;}
    }
    // Effective scan parameters (nLines and hatch are kept in sync via useEffect)
    var effNLines=pat!=="linear"?Math.max(1,nLines):1;
    var effHatch=pat!=="linear"&&nLines>1?scanHN/(nLines-1):scanHN;
    // Effective scan velocity from selected input mode
    var effVel;
    if(velMode==="velocity"){
      if(!isFinite(vel)||vel<=0){alert("Scan velocity must be > 0");return;}
      effVel=vel;
    }else if(velMode==="dwell"){
      if(!isFinite(dwellN)||dwellN<=0){alert("Dwell time must be > 0");return;}
      effVel=dia/(dwellN*1e-6);
      if(!isFinite(effVel)||effVel<=0){alert("Invalid dwell time — check beam diameter");return;}
    }else if(velMode==="scanrate"){
      if(!isFinite(srateN)||srateN<=0){alert("Line scan rate must be > 0");return;}
      effVel=srateN*lineL;
      if(!isFinite(effVel)||effVel<=0){alert("Invalid line scan rate or scan width");return;}
    }else{
      if(!isFinite(frateN)||frateN<=0){alert("Frame rate must be > 0");return;}
      effVel=lineL*(pat==="linear"?1:nLines)*frateN;
      if(!isFinite(effVel)||effVel<=0){alert("Invalid frame rate or scan parameters");return;}
    }
    setCmp(true);setDirty(false);setPerfNote("");

    // ── Custom-path LSP: bypass parametric segment-building and use the
    //    LSP's engine segments directly via main-thread computation.
    //    Skipping the Worker keeps the implementation simple — the Worker's
    //    code template builds its own segments from pat/lineL/nLines, which
    //    is wrong for custom paths.  Custom-path LSPs typically have <50000
    //    segments (canonicalize.js caps at maxEngineSegments), well within
    //    main-thread performance.  See web/lsp/canonicalize.js mode 2/3.
    if (_lspCustomSegsRef.current) {
      var _customData = _lspCustomSegsRef.current;
      var _customNotes = [];
      if (_customData.hasBlankedSegments) {
        _customNotes.push("Custom path includes blanked (flyback) segments; these advance time but deposit no fluence");
      }
      _customNotes.push("Custom-path LSP: " + _customData.segments.length +
        " engine segments, main-thread computation");
      // Abandon any in-flight Worker from a previous (non-custom) Calculate.
      // We TERMINATE rather than just detach handlers, because the worker may
      // have a message queued or in-flight whose result would otherwise be
      // received by the next preset Calculate's reassigned onmessage handler
      // (the worker queues messages and processes them in order, posting
      // replies to whatever main-thread handler is currently installed).
      // The next preset Calculate creates a fresh worker via getWorker(),
      // costing ~50 ms one time per "custom → preset" transition.
      if (_workerRef.current) {
        try { _workerRef.current.terminate(); } catch (_) {}
        _workerRef.current = null;
      }
      if (_workerTimeout.current) {
        clearTimeout(_workerTimeout.current);
        _workerTimeout.current = null;
      }
      setTimeout(function(){
        // Race-condition guard: the user may have clicked Eject during the
        // 60 ms timeout (the Calculate button sits outside the lspLocked
        // fieldset and so is enabled even while LSP is loaded).  If the ref
        // has been cleared or replaced, abort: the post-Eject state no
        // longer matches the captured custom segments, and proceeding would
        // mix data from two different scan configurations.
        if (_lspCustomSegsRef.current !== _customData) {
          setCmp(false);
          return;
        }
        calculateMainThread(_customData.segments, 8, 3, 0, _customNotes);
      }, 60);
      return;
    }

    // ── Performance estimation ──
    // For separable-eligible scans, compute estimates from params directly
    // (avoids OOM from segment construction for micro-beams)
    var calcPrf=laserMode==="cw"?0:prf;
    var calcTau=laserMode==="cw"?0:tau;
    var isCWEst=laserMode==="cw";
    var canSep=((!isCWEst&&calcPrf>0)||(isCWEst&&pw>0))&&(pat==="linear"||pat==="raster"||pat==="bidi");
    var segsEst=canSep?[]:null;
    var estTime,estPulses;
    if(canSep){
      var lineDurEst=lineL/effVel;
      var nLEst=pat==="linear"?1:effNLines;
      var jumpVEst=effVel*5;
      var hatchEst=pat==="linear"?0:(effHatch||dia);
      var flybackEst=pat==="linear"?0:(pat==="bidi"?(hatchEst/jumpVEst):(lineL/jumpVEst+hatchEst/jumpVEst));
      estTime=nLEst*lineDurEst+(nLEst-1)*flybackEst;
      estPulses=calcPrf*nLEst*lineDurEst;
    }else{
      /* Non-separable (CW): guard against huge nLines — use analytical estimation if >10000 lines */
      if(effNLines>10000){
        var lineDurEst2=lineL/effVel;
        var jumpVEst2=effVel*5;
        var hatchEst2=pat==="linear"?0:(effHatch||dia);
        var flybackEst2=pat==="linear"?0:(pat==="bidi"?(hatchEst2/jumpVEst2):(lineL/jumpVEst2+hatchEst2/jumpVEst2));
        estTime=effNLines*lineDurEst2+(effNLines-1)*flybackEst2;
        estPulses=0; /* CW — no discrete pulses */
        segsEst=[];
      }else{
        if(pat==="linear") segsEst=scanBuildLinear(0,0,0,lineL,effVel,dia);
        else segsEst=scanBuildRaster(0,0,lineL,effNLines,effHatch,effVel,effVel*5,dia,blk);
        estTime=0;for(var ei=0;ei<segsEst.length;ei++)estTime+=dia/segsEst[ei].v;
        estPulses=calcPrf*estTime;
      }
    }
    var sigma=dia/(2*Math.sqrt(2)),estDx=dia/ppd;
    var trunc=Math.ceil(3*sigma/estDx);
    var estOps=canSep?0:estPulses*Math.PI*trunc*trunc; // separable path doesn't scale with ops
    var effPpd=ppd,notes=[];
    if(!canSep&&estOps>_E.OP_BUDGET&&ppd>3){
      for(effPpd=ppd-1;effPpd>=3;effPpd--){
        var dx2=dia/effPpd,tr2=Math.ceil(3*sigma/dx2);
        if(estPulses*Math.PI*tr2*tr2<_E.OP_BUDGET)break;
      }
      effPpd=Math.max(3,effPpd);
      notes.push("Grid auto-reduced to "+effPpd+" pts/dia for "+Math.round(estPulses/1000)+"k pulses");
    }
    /* separable engine note removed — implementation detail not shown to user */
    else if(estPulses>_E.DEFAULT_MAX_COMPUTE_PULSES){
      var estStride=Math.ceil(estPulses/_E.DEFAULT_MAX_COMPUTE_PULSES);
      notes.push("Pulse subsampling active (stride="+estStride+"): computing 1 in every "+estStride+" pulses for "+Math.round(estPulses/1000)+"k total");
    }
    var auxPpd=Math.min(effPpd,3);
    var maxBisect=canSep?3:(estPulses>100000?6:estPulses>10000?8:15);

    // ── Try Web Worker (off main thread) ──
    var worker=getWorker();
    if(worker){
      var params={std:_std,wl:wl,dia:dia,tau:calcTau,prf:calcPrf,pw:pw,
        pat:pat,lineL:lineL,nLines:effNLines,hatch:effHatch,vel:effVel,dwm:dwm,blk:blk,
        effPpd:effPpd,auxPpd:auxPpd,maxBisect:maxBisect,notes:notes,estPulses:estPulses};
      // Safety timeout: kill Worker if it takes too long
      if(_workerTimeout.current)clearTimeout(_workerTimeout.current);
      _workerTimeout.current=setTimeout(function(){
        if(_workerRef.current){_workerRef.current.terminate();_workerRef.current=null;}
        setPerfNote("Computation timed out after 60 seconds. Try reducing line count, increasing hatch spacing, or lowering PRF.");
        setCmp(false);
      },SCAN_WORKER_TIMEOUT_MS);
      worker.onmessage=function(ev){
        if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
        var r=ev.data;
        if(r.error){if(typeof console!=="undefined")console.error("Worker error:",r.error);setCmp(false);return;}
        /* Reconstruct grid with transferred TypedArrays */
        var g={nx:r.g.nx,ny:r.g.ny,dx:r.g.dx,xn:r.g.xn,yn:r.g.yn,
          flu:r.flu,pc:r.pc,ppH:r.ppH,lvt:r.lvt,mrv:r.mrv};
        var isCW2=laserMode==="cw";
        var beam2={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:calcPrf>0?pw/calcPrf:0,P:pw,cw:isCW2};
        if(r.notes&&r.notes.length>0)setPerfNote(r.notes.join(". ")+".");
        setRes({g:g,st:r.st,sf:r.sf,segs:r.segs,beam:beam2,maxP:r.maxP,minV:r.minVel,
          pulses:r.pulseArr,effPpd:effPpd,effNLines:effNLines,effHatch:effHatch,effVel:effVel});
        setCmp(false);
      };
      worker.onerror=function(err){
        if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
        if(typeof console!=="undefined")console.error("Worker error:",err);
        /* Fall back to main-thread computation */
        calculateMainThread(segsEst,effPpd,auxPpd,maxBisect,notes);
      };
      worker.postMessage(params);
      return;
    }

    // ── Fallback: main-thread computation ──
    setTimeout(function(){calculateMainThread(segsEst,effPpd,auxPpd,maxBisect,notes);},60);
  }

  function calculateMainThread(segs,effPpd,auxPpd,maxBisect,notes){
    try{
      var calcPrf=laserMode==="cw"?0:prf;
      var calcTau=laserMode==="cw"?0:tau;
      var Ep=calcPrf>0?pw/calcPrf:0;
      var isCW=laserMode==="cw";
      var beam={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:Ep,P:pw,cw:isCW};

      // Derive effective scan params (same logic as calculate())
      var effNLines=pat!=="linear"?Math.max(1,nLines):1;
      var effHatch=pat!=="linear"&&nLines>1?scanHN/(nLines-1):scanHN;
      var effVel=velMode==="dwell"?dia/(dwellN*1e-6):velMode==="scanrate"?srateN*lineL:velMode==="framerate"?lineL*(pat==="linear"?1:nLines)*frateN:vel;

      // Build separable params if applicable (same logic as Worker).
      // For custom-path LSPs, force canSep=false so we use the segment-array
      // path with the LSP's actual engine segments rather than building from
      // pat/lineL/nLines (which would describe a rectangular raster).
      var _isLspCustom = !!_lspCustomSegsRef.current;
      var canSep=!_isLspCustom && ((!isCW&&calcPrf>0)||(isCW&&pw>0))&&(pat==="linear"||pat==="raster"||pat==="bidi");
      function mkSepP(vv,ep,optP){
        if(!canSep)return null;
        return{d_1e_mm:dia,prf_hz:calcPrf,pulse_energy_J:ep||Ep,avg_power_W:optP!==undefined?optP:pw,v_scan_mm_s:vv,
          x0:0,y0:0,line_length_mm:lineL,n_lines:pat==="linear"?1:effNLines,
          hatch_mm:pat==="linear"?0:effHatch,pattern:pat,blanking:blk,is_cw:isCW,v_jump_mm_s:vv*5};
      }

      var cr=scanCompute(beam,canSep?[]:segs,effPpd,mkSepP(effVel));
      if(cr){
        var minV=isCW?(cr.st.mv||effVel):0;
        var sf=scanSafety(cr.g,beam,cr.st.tt,dwm,minV,{v_mm_s:effVel,line_spacing_mm:pat==="linear"?0:effHatch,n_lines:pat==="linear"?1:effNLines});
        var unitBeam={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:calcPrf>0?1/calcPrf:0,P:1,cw:isCW};
        var unitCr=scanCompute(unitBeam,canSep?[]:segs,auxPpd,mkSepP(effVel,calcPrf>0?1/calcPrf:0,1));
        var maxP=Infinity;
        if(unitCr){
          var upF=0;for(var ui=0;ui<unitCr.g.nx*unitCr.g.ny;ui++)if(unitCr.g.flu[ui]>upF)upF=unitCr.g.flu[ui];
          var mpeT=skinMPE(wl,unitCr.st.tt||cr.st.tt);
          if(upF>0)maxP=mpeT/upF;
          if(!isCW&&calcPrf>0){var w22=dia/Math.sqrt(2);var maxPr1=skinMPE(wl,calcTau)*calcPrf*Math.PI*w22*w22/(2*100);
            if(maxPr1<maxP)maxP=maxPr1;}
        }
        // Custom-path: no single velocity to scale uniformly (per-segment
        // velocities), so the "minimum safe velocity" question doesn't apply.
        // Use Infinity so display shows "—" rather than misleading "0 mm/s".
        var minVel=_isLspCustom?Infinity:0;
        if(!canSep&&effNLines<=10000&&!_isLspCustom){
          // Only run bisection on the main thread for brute-force paths
          // (separable scans use the Worker; if it fails, skip bisection to prevent UI freeze).
          // Custom-path LSPs are also skipped: each segment has its own velocity
          // (per-segment v_mm_s from the LSP), so a single "minimum safe velocity"
          // value isn't meaningful — scaling all segments uniformly to find a safe
          // velocity would silently misrepresent the user's intended scan pattern.
          function testV(tv){
            var ts;
            if(pat==="linear")ts=scanBuildLinear(0,0,0,lineL,tv,dia);
            else ts=scanBuildRaster(0,0,lineL,effNLines,effHatch,tv,tv*5,dia,blk);
            var tb={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:Ep,P:pw,cw:isCW};
            var tcr2=scanCompute(tb,ts,auxPpd);
            if(!tcr2)return true;
            var tmv=isCW?(tcr2.st.mv||tv):0;
            var tsf2=scanSafety(tcr2.g,tb,tcr2.st.tt,dwm,tmv,{v_mm_s:tv,line_spacing_mm:pat==="linear"?0:effHatch,n_lines:pat==="linear"?1:effNLines});
            return tsf2.safe;
          }
          if(testV(1e6)){var vLo=0.01,vHi=1e6;
            for(var bi=0;bi<maxBisect&&(vHi-vLo)/vLo>0.01;bi++){var vMid=(vLo+vHi)/2;if(testV(vMid))vHi=vMid;else vLo=vMid;}
            minVel=vHi;}else{minVel=Infinity;}
        }

        // Generate pulse positions and viz segments.
        // For preset patterns: derive from pat/lineL/nLines/hatch (parametric).
        // For custom-path LSPs: derive from the LSP's actual engine segments
        // (sub-sampled for performance) so the visualization shows the real
        // scan trajectory rather than a fictitious raster.
        var pulseArr=[];
        var vizSegs2=[];
        var MAX_VIZ2=5000;
        if (_isLspCustom) {
          // Custom path: stride-sample the LSP segments for viz.  Each segment
          // already has {x_start_mm, y_start_mm, angle_rad, v_mm_s} so we add
          // short-name aliases (x, y, a, v) inline to match the renderer's
          // expectations without mutating the LSP-owned array.
          var _customSegs = _lspCustomSegsRef.current.segments;
          var _cStride = Math.max(1, Math.ceil(_customSegs.length / MAX_VIZ2));
          for (var _ci = 0; _ci < _customSegs.length && vizSegs2.length < MAX_VIZ2; _ci += _cStride) {
            var _cs = _customSegs[_ci];
            if (_cs && !_cs.blanked) {
              vizSegs2.push({
                x: _cs.x_start_mm, y: _cs.y_start_mm,
                a: _cs.angle_rad, v: _cs.v_mm_s
              });
            }
          }
          // Pulse positions: for custom paths we don't generate a per-pulse
          // array (the timing diagram assumes a regular raster lattice).  The
          // worst-case point overlay still works because it reads from the
          // grid, not the pulse array.
        } else if(!isCW&&calcPrf>0){
          var maxSP2=5000,ps_mm2=effVel/calcPrf;
          var nPL2=Math.max(1,Math.floor((lineL/effVel)*calcPrf));
          var nLV=pat==="linear"?1:effNLines;
          var totalEst2=nPL2*nLV;
          var pStride2=Math.max(1,Math.ceil(totalEst2/maxSP2));
          var tAcc2=0;
          for(var li2=0;li2<nLV&&pulseArr.length<maxSP2;li2++){
            var ly2=li2*(pat==="linear"?0:effHatch);
            for(var ki2=0;ki2<nPL2&&pulseArr.length<maxSP2;ki2+=pStride2){
              pulseArr.push({t:tAcc2+ki2/calcPrf,x:ki2*ps_mm2,y:ly2,si:li2});
            }
            tAcc2+=lineL/effVel;if(li2<nLV-1)tAcc2+=(pat==="linear"?0:effHatch)/(effVel*5);
          }
        }
        // Capped viz segments (parametric path; custom path filled above)
        if (!_isLspCustom) {
          var nLV2=pat==="linear"?1:effNLines;
          var ppl2=Math.ceil(lineL/dia);
          var lStr2=Math.max(1,Math.ceil(nLV2*Math.min(ppl2,200)/MAX_VIZ2));
          var vStp2=Math.max(1,Math.ceil(ppl2/Math.min(200,Math.floor(MAX_VIZ2/Math.ceil(nLV2/lStr2)))));
          for(var vl2=0;vl2<nLV2&&vizSegs2.length<MAX_VIZ2;vl2+=lStr2){
            var vly2=vl2*(pat==="linear"?0:effHatch);
            var nVP2=Math.ceil(ppl2/vStp2);
            for(var vs2=0;vs2<=nVP2&&vizSegs2.length<MAX_VIZ2;vs2++){
              vizSegs2.push({x:vs2*vStp2*dia,y:vly2,a:0,v:effVel});
            }
          }
        }

        if(notes.length>0)setPerfNote(notes.join(". ")+".");
        setRes({g:cr.g,st:cr.st,sf:sf,segs:vizSegs2,beam:beam,maxP:maxP,minV:minVel,
          pulses:pulseArr,effPpd:effPpd,effNLines:effNLines,effHatch:effHatch,effVel:effVel});
      }
    }catch(err){if(typeof console!=="undefined")console.error("Calculation error:",err);}
    setCmp(false);
  }

  /* ── ECharts theme config (Paul Tol High-Contrast) ── */
  var ec=useMemo(function(){
    var dk=theme==="dark";
    return {
      bg:dk?"#14171A":"#FAFAFA",
      panel:dk?"#1E1E1E":"#FFFFFF",
      grid:dk?"#2E2E2E":"#E8E8E8",
      spine:dk?"#AAAAAA":"#444444",
      tick:dk?"#9CA3AF":"#555555",
      title:dk?"#E0E0E0":"#222222",
      stem:dk?"#6CB3FF":"#004488",
      stemShaft:dk?"rgba(187,187,187,0.55)":"rgba(136,136,136,0.55)",
      cumLine:dk?"#EE99AA":"#BB5566",
      mpe:dk?"#DDAA33":"#DDAA33",
      sub:dk?"#888888":"#777777",
      navBg:dk?"#252525":"#F0F0F0",
      navWin:dk?"rgba(108,179,255,0.12)":"rgba(0,68,136,0.08)",
      navBorder:dk?"rgba(108,179,255,0.4)":"rgba(0,68,136,0.35)"
    };
  },[theme]);

  var ptTimRef=useRef(null);
  var _chartRef=useRef(null);

  /* Reset selPt when new results arrive */
  useEffect(function(){setSelPt(null);},[res]);

  /* ── Dispose ECharts instance on unmount ── */
  useEffect(function(){
    return function(){
      if(_chartRef.current){_chartRef.current.dispose();_chartRef.current=null;}
    };
  },[]);

  /* ── Point Timing Diagram: pulse arrivals + cumulative fluence at a point ── */
  useEffect(function(){
    if(!res||!ptTimRef.current||typeof echarts==="undefined")return;
    if(prf<=0||pw<=0)return;
    /* Custom-path LSPs don't form a regular raster, so the parametric pulse
       arrival math below (which iterates over lines and pulse spacings)
       doesn't apply.  The JSX renders a placeholder card instead.          */
    if(_lspCustomSegsRef.current)return;

    var w=dia/Math.sqrt(2),sigma=dia/(2*Math.sqrt(2)),w2=w*w;
    var Ep=pw/prf;
    var H0=2*Ep/(Math.PI*w2)*100; // J/cm\u00b2
    var ps=vel/prf; // pulse spacing mm
    var trunc=3*sigma;
    var trunc2=trunc*trunc;
    var nPL=Math.max(1,Math.floor((lineL/vel)*prf));
    var lineDur=lineL/vel;
    var nL=pat==="linear"?1:(res.effNLines||1);
    var hh=pat==="linear"?0:(res.effHatch||hatch);
    var jumpV=vel*5;
    var flybackTime=(pat==="linear"||nL<=1)?0:(lineL/jumpV+hh/jumpV);

    // Determine observation point
    var obsX,obsY;
    if(selPt){obsX=selPt.x;obsY=selPt.y;}
    else{
      var g=res.g,maxF=0,maxIdx=0;
      for(var gi=0;gi<g.nx*g.ny;gi++){if(g.flu[gi]>maxF){maxF=g.flu[gi];maxIdx=gi;}}
      var giy=Math.floor(maxIdx/g.nx),gix=maxIdx-giy*g.nx;
      obsX=g.xn+gix*g.dx;obsY=g.yn+giy*g.dx;
    }

    // Collect pulse contributions at the observation point
    var events=[];
    var tLineStart=0;
    for(var li=0;li<nL;li++){
      var yLine=li*hh;
      var dy=obsY-yLine;
      var dy2=dy*dy;
      if(dy2>trunc2){tLineStart+=lineDur+(li<nL-1?flybackTime:0);continue;}
      var crossAtt=Math.exp(-2*dy2/w2);
      var scanDir=1;
      var xStart=scanDir===1?0:lineL;
      var kCenter=(obsX-xStart)/(scanDir*ps);
      var kRange=trunc/ps;
      var kMin=Math.max(0,Math.ceil(kCenter-kRange));
      var kMax=Math.min(nPL-1,Math.floor(kCenter+kRange));
      for(var k=kMin;k<=kMax;k++){
        var xPulse=xStart+scanDir*k*ps;
        var dx=obsX-xPulse;
        var dx2=dx*dx;
        if(dx2>trunc2)continue;
        var alongAtt=Math.exp(-2*dx2/w2);
        var Hdep=H0*alongAtt*crossAtt;
        if(Hdep<H0*1e-6)continue;
        var tPulse=tLineStart+k/prf;
        events.push({t:tPulse,H:Hdep});
      }
      tLineStart+=lineDur+(li<nL-1?flybackTime:0);
    }

    events.sort(function(a,b){return a.t-b.t;});
    var totalTime=res.st.tt;
    var mpeVal=skinMPE(wl,totalTime);

    // Build cumulative step data and impulse data
    var cumData=[];
    var impulseData=[];
    var cumH=0;
    cumData.push([0,0]);
    for(var ei=0;ei<events.length;ei++){
      var ev=events[ei];
      cumData.push([ev.t,cumH]);
      cumH+=ev.H;
      cumData.push([ev.t,cumH]);
      impulseData.push([ev.t,ev.H]);
    }
    cumData.push([totalTime,cumH]);

    // Scale time for readability
    var tScale=1,tUnit="s";
    if(totalTime<0.01){tScale=1e6;tUnit="\u00b5s";}
    else if(totalTime<10){tScale=1e3;tUnit="ms";}

    var cumScaled=cumData.map(function(p){return [p[0]*tScale,p[1]];});
    var impulseScaled=impulseData.map(function(p){return [p[0]*tScale,p[1]];});

    var safetyRatio=cumH/mpeVal;

    // ── ECharts rendering ──
    if(_chartRef.current){_chartRef.current.dispose();_chartRef.current=null;}
    var chart=echarts.init(ptTimRef.current,null,{renderer:"canvas"});
    _chartRef.current=chart;

    var fontFamily="'IBM Plex Sans', system-ui, -apple-system, sans-serif";

    var option={
      backgroundColor:"transparent",
      animation:false,
      textStyle:{fontFamily:fontFamily},

      /* Panel labels: (a) and (b) per COMSOL/Optica convention */
      title:[
        {text:"(a) Per-pulse fluence",left:68,top:4,
         textStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:600,color:ec.title}},
        {text:"(b) Cumulative fluence",left:68,top:"39%",
         textStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:600,color:ec.title}}
      ],

      /* Two stacked grids with room for panel labels and legends */
      grid:[
        {left:68,right:20,top:24,height:"22%"},
        {left:68,right:20,top:"48%",height:"38%"}
      ],

      xAxis:[
        {type:"value",gridIndex:0,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{show:false},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         min:0,max:totalTime*tScale},
        {type:"value",gridIndex:1,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{show:true,fontFamily:fontFamily,fontSize:10,color:ec.tick,
           formatter:function(v){return v%1===0?String(v):v.toFixed(1);}},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         name:"Time ("+tUnit+")",nameLocation:"middle",nameGap:28,
         nameTextStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:500,color:ec.title},
         min:0,max:totalTime*tScale}
      ],

      yAxis:[
        {type:"value",gridIndex:0,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{fontFamily:fontFamily,fontSize:10,color:ec.tick,
           formatter:function(v){return v<0.001&&v>0?v.toExponential(1):numFmt(v,2);}},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         name:"Fluence (J/cm\u00b2)",nameLocation:"middle",nameGap:52,
         nameTextStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:500,color:ec.title},
         min:0},
        {type:"value",gridIndex:1,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{fontFamily:fontFamily,fontSize:10,color:ec.tick,
           formatter:function(v){return v<0.001&&v>0?v.toExponential(1):numFmt(v,3);}},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         name:"Fluence (J/cm\u00b2)",nameLocation:"middle",nameGap:52,
         nameTextStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:500,color:ec.title},
         min:0}
      ],

      toolbox:{show:false},

      /* Per-panel legends — each panel gets its own legend inside the plot area (COMSOL/MATLAB convention) */
      legend:[
        {data:["Per-pulse fluence"],
         top:24,right:28,orient:"vertical",
         itemWidth:20,itemHeight:3,
         icon:"roundRect",
         textStyle:{fontFamily:fontFamily,fontSize:10,color:ec.tick},
         backgroundColor:"rgba(255,255,255,0.88)",
         borderColor:ec.grid,borderWidth:1,
         padding:[4,8]},
        {data:["Cumulative fluence","MPE limit"],
         top:"48%",right:28,orient:"vertical",
         itemWidth:20,itemHeight:3,itemGap:8,
         textStyle:{fontFamily:fontFamily,fontSize:10,color:ec.tick},
         backgroundColor:"rgba(255,255,255,0.88)",
         borderColor:ec.grid,borderWidth:1,
         padding:[4,8]}
      ],

      /* Linked axis pointers across panels — COMSOL/MATLAB synchronized cursor convention */
      axisPointer:{link:[{xAxisIndex:"all"}]},

      tooltip:{
        trigger:"axis",
        axisPointer:{type:"line",lineStyle:{color:ec.spine,width:1,type:"dashed"}},
        textStyle:{fontFamily:fontFamily,fontSize:11},
        formatter:function(params){
          if(!params||!params.length)return "";
          var t=params[0].value[0];
          var out=["<b>t = "+numFmt(t,4)+" "+tUnit+"</b>"];
          for(var pi=0;pi<params.length;pi++){
            var p=params[pi];
            if(p.seriesName==="MPE limit")continue;
            out.push(p.marker+" "+p.seriesName+": "+numFmt(p.value[1],4)+" J/cm\u00b2");
          }
          return out.join("<br>");
        }
      },

      series:[
        {name:"Per-pulse fluence",type:"bar",xAxisIndex:0,yAxisIndex:0,
         data:impulseScaled,
         barWidth:Math.max(1,Math.min(3,400/Math.max(1,impulseScaled.length))),
         itemStyle:{color:ec.stem},
         emphasis:{itemStyle:{color:ec.stem}},
         large:true,largeThreshold:500},

        {name:"Cumulative fluence",type:"line",xAxisIndex:1,yAxisIndex:1,
         data:cumScaled,
         step:false,
         lineStyle:{color:ec.cumLine,width:2,type:"solid"},
         areaStyle:{color:ec.cumLine,opacity:0.04},
         symbol:"none",
         emphasis:{disabled:true}},

        {name:"MPE limit",type:"line",xAxisIndex:1,yAxisIndex:1,
         data:[[0,mpeVal],[totalTime*tScale,mpeVal]],
         lineStyle:{color:ec.mpe,width:1.5,type:"dashed"},
         symbol:"none",
         emphasis:{disabled:true},
         /* Mark the MPE value with a label on the line */
         markPoint:{
           symbol:"rect",symbolSize:[1,1],
           label:{show:true,position:"insideRight",
             formatter:function(){return "MPE = "+numFmt(mpeVal,4)+" J/cm\u00b2";},
             fontFamily:fontFamily,fontSize:9,fontWeight:600,color:ec.mpe,
             backgroundColor:"rgba(255,255,255,0.88)",
             borderColor:ec.mpe,borderWidth:0.5,borderRadius:4,
             padding:[2,6]},
           data:[{coord:[totalTime*tScale*0.02,mpeVal]}]
         }}
      ]
    };

    chart.setOption(option);

    var onResize=function(){chart.resize();};
    window.addEventListener("resize",onResize);

    return function(){
      window.removeEventListener("resize",onResize);
    };
  },[res,ec,dia,wl,pw,prf,vel,lineL,pat,hatch,scanHN,selPt]);

  /* ── Scan pattern visualization: pre-computed values ──────────── */
  /* Engineering notation for dimension labels */
  function svFmtDim(val){
    if(!isFinite(val)||val===0)return "0 mm";
    var av=Math.abs(val);
    if(av>=1e6)return (val/1e6).toPrecision(4)+" km";
    if(av>=1e3)return (val/1e3).toPrecision(4)+" m";
    if(av>=0.1)return +val.toPrecision(4)+" mm";
    if(av>=1e-4)return (val*1e3).toPrecision(4)+" \u00b5m";
    if(av>=1e-7)return (val*1e6).toPrecision(4)+" nm";
    return val.toExponential(2)+" mm";
  }
  /* Scan pattern visualization: pre-computed values */
  var _isLt=theme==="light";
  var vc={
    mark:_isLt?"#334155":"#94A3B8", jump:_isLt?"#94A3B8":"#64748B",
    dimAct:_isLt?"#64748B":"#94A3B8", dimDer:_isLt?"#94A3B8":"#64748B",
    canvas:_isLt?"#FAFBFC":"#1A1F27", canvasBd:_isLt?"rgba(15,23,42,0.08)":"rgba(255,255,255,0.08)",
    gridMin:_isLt?"#E8ECF0":"#252D38", gridMaj:_isLt?"#E0E4EA":"#2A3340",
    area:_isLt?"none":"none",
    areaBd:_isLt?"#CBD5E1":"#475569",
    lbl:_isLt?"#475569":"#94A3B8", legTx:_isLt?"#475569":"#94A3B8",
    lbl2:_isLt?"#334155":"#CBD5E1",
    corr:_isLt?0.04:0.06,
    hc:_isLt?"#64748B":"#94A3B8",
    axX:"#94A3B8", axY:"#94A3B8"
  };
  var svBtnBg=_isLt?"#F1F5F9":"#1E293B";
  var svBtnBd=_isLt?"#CBD5E1":"#475569";
  var svIc=_isLt?"#64748B":"#94A3B8";
  /* Fixed canvas — wider left padding for hatch callout */
  var svW_c=460,svH_c=260;
  var svPd_t=24,svPd_r=44,svPd_b=36,svPd_l=80;
  var svPlW=svW_c-svPd_l-svPd_r, svPlH=svH_c-svPd_t-svPd_b;
  /* Independent x/y scaling */
  var svPatW=Math.max(lineL,0.001);
  // For custom-path LSPs, ALWAYS use the actual bbox height — regardless of
  // the user's pre-import `pat` value (which is preserved under the disabled
  // UI and may still be "linear" even though the imported path is 2D).  The
  // parametric-pattern branch keeps its existing logic: "linear" gets a 35%
  // aspect ratio (since scanHN is irrelevant for a single-line scan), other
  // patterns use scanHN.
  var svPatH=_lspCustomSegsRef.current
    ? Math.max(scanHN||1,0.001)
    : (pat==="linear"?Math.max(svPatW*0.35,Math.max(dia,0.001)*4):Math.max(scanHN||1,0.001));
  var svScX=(svPlW*0.85)/svPatW;
  var svScY=(svPlH*0.85)/svPatH;
  var svOx=svPd_l+(svPlW-svPatW*svScX)/2;
  var svOy=svPd_t+(svPlH-svPatH*svScY)/2;
  var svRW=svPatW*svScX, svRH=svPatH*svScY;
  var svBSc=Math.min(svScX,svScY);
  var svBeamR=Math.max((dia/Math.sqrt(2))*svBSc,1.5);
  svBeamR=Math.min(svBeamR,Math.min(svRW,svRH)/2);
  /* Fix 1: beam suppression when beam >> scan area */
  var svBeamOwl=dia>Math.max(lineL,scanHN||0)*2;
  var svRenderBeam=svBeam&&!svBeamOwl;
  /* Fix 2: line decimation */
  var svHtVis=(nLines>1&&scanHN>0)?scanHN/(nLines-1):0;
  var svLinePx=svHtVis*svScY;
  var svTooMany=pat!=="linear"&&nLines>1&&svLinePx<4;
  var svDecIndices=null;
  if(svTooMany){
    var svMaxShow=12;
    var sdSet={};sdSet[0]=true;sdSet[nLines-1]=true;
    for(var sdi=1;sdi<svMaxShow-1;sdi++){sdSet[Math.round(sdi*(nLines-1)/(svMaxShow-1))]=true;}
    svDecIndices=[];for(var sdk in sdSet){if(sdSet.hasOwnProperty(sdk))svDecIndices.push(Number(sdk));}
    svDecIndices.sort(function(a,b){return a-b;});
  }
  var svDecCount=svDecIndices?svDecIndices.length:0;
  var svMarks=[],svJumps=[];
  /* Custom-path LSP: replace the parametric raster lines with the actual
     LSP segments, polyline-style.  For SHORT paths (≤800 segments) every
     segment renders as its own short line, giving a continuous path.  For
     LONG paths we stride-sample and connect consecutive sampled positions
     so the viz remains a continuous polyline (rather than sparse dots).
     Blanked segments end the current polyline so flybacks render as gaps.
     Segments were already translated to bbox origin in _lspApplyState, so
     the same svOx/svOy/svScX/svScY mapping as parametric paths applies.   */
  if (_lspCustomSegsRef.current) {
    var _customSegs_sv = _lspCustomSegsRef.current.segments;
    var _customD_sv = _lspCustomSegsRef.current.d_1e_mm || dia || 0.001;
    var _svMaxCustom = 800;  // cap polyline points so SVG stays responsive
    var _svCustomStride = Math.max(1, Math.ceil(_customSegs_sv.length / _svMaxCustom));
    // Helper: find the next non-blanked segment at or after index `from`,
    // stepping by `stride`.  Returns null if none.
    function _svNextVisible(arr, from, stride) {
      for (var j = from; j < arr.length; j += stride) {
        if (arr[j] && !arr[j].blanked) return { seg: arr[j], idx: j };
      }
      return null;
    }
    if (_svCustomStride === 1) {
      // Short path: render every segment as its own beam-diameter-long line.
      for (var _svci0 = 0; _svci0 < _customSegs_sv.length; _svci0++) {
        var _csg0 = _customSegs_sv[_svci0];
        if (!_csg0 || _csg0.blanked) continue;
        var _csx10 = _csg0.x_start_mm, _csy10 = _csg0.y_start_mm;
        var _csx20 = _csx10 + _customD_sv * Math.cos(_csg0.angle_rad || 0);
        var _csy20 = _csy10 + _customD_sv * Math.sin(_csg0.angle_rad || 0);
        svMarks.push({
          x1: svOx + _csx10 * svScX, y1: svOy + _csy10 * svScY,
          x2: svOx + _csx20 * svScX, y2: svOy + _csy20 * svScY,
          idx: _svci0
        });
      }
    } else {
      // Long path: connect consecutive sampled positions as a polyline.
      // A blanked segment between samples breaks the line (renders as a gap).
      var _curAnchor = _svNextVisible(_customSegs_sv, 0, _svCustomStride);
      while (_curAnchor) {
        var _nextAnchor = _svNextVisible(_customSegs_sv, _curAnchor.idx + _svCustomStride, _svCustomStride);
        if (_nextAnchor) {
          // Detect a blanked-segment break in the interval (_curAnchor.idx, _nextAnchor.idx).
          var _hasBreak = false;
          for (var _bi = _curAnchor.idx + 1; _bi < _nextAnchor.idx; _bi++) {
            if (_customSegs_sv[_bi] && _customSegs_sv[_bi].blanked) { _hasBreak = true; break; }
          }
          if (!_hasBreak) {
            svMarks.push({
              x1: svOx + _curAnchor.seg.x_start_mm * svScX,
              y1: svOy + _curAnchor.seg.y_start_mm * svScY,
              x2: svOx + _nextAnchor.seg.x_start_mm * svScX,
              y2: svOy + _nextAnchor.seg.y_start_mm * svScY,
              idx: _curAnchor.idx
            });
          }
          // else: skip this mark; break in scan path renders as a gap.
          _curAnchor = _nextAnchor;
        } else {
          // Final anchor — render a beam-diameter-long stub to mark the end.
          var _endX = _curAnchor.seg.x_start_mm + _customD_sv * Math.cos(_curAnchor.seg.angle_rad || 0);
          var _endY = _curAnchor.seg.y_start_mm + _customD_sv * Math.sin(_curAnchor.seg.angle_rad || 0);
          svMarks.push({
            x1: svOx + _curAnchor.seg.x_start_mm * svScX,
            y1: svOy + _curAnchor.seg.y_start_mm * svScY,
            x2: svOx + _endX * svScX,
            y2: svOy + _endY * svScY,
            idx: _curAnchor.idx
          });
          _curAnchor = null;
        }
      }
    }
  } else if(pat==="linear"){
    svMarks.push({x1:svOx,y1:svOy+svRH/2,x2:svOx+svRW,y2:svOy+svRH/2,idx:0});
  }else if(svTooMany){
    /* Decimated: iterate only over the small set of indices (never over all nLines) */
    for(var svdi=0;svdi<svDecIndices.length;svdi++){
      var svIdx=svDecIndices[svdi];
      var svLy=svOy+svIdx*svHtVis*svScY;
      var svLtr=pat==="bidi"?(svIdx%2===0):true;
      svMarks.push({x1:svLtr?svOx:svOx+svRW,y1:svLy,x2:svLtr?svOx+svRW:svOx,y2:svLy,idx:svIdx});
    }
    for(var svmi=0;svmi<svMarks.length-1;svmi++){
      var svCur=svMarks[svmi],svNxt=svMarks[svmi+1];
      var svCurLtr=pat==="bidi"?(svCur.idx%2===0):true;
      var svCurEx=svCurLtr?svOx+svRW:svOx;
      if(pat==="bidi")svJumps.push({x1:svCurEx,y1:svCur.y1,x2:svCurEx,y2:svNxt.y1});
      else svJumps.push({x1:svOx+svRW,y1:svCur.y1,x2:svOx,y2:svNxt.y1});
    }
  }else{
    var svNVis=Math.min(nLines,200);
    for(var svi=0;svi<svNVis;svi++){
      var svLy2=svOy+svi*svHtVis*svScY;
      var svLtr2=pat==="bidi"?(svi%2===0):true;
      svMarks.push({x1:svLtr2?svOx:svOx+svRW,y1:svLy2,x2:svLtr2?svOx+svRW:svOx,y2:svLy2,idx:svi});
    }
    for(var svmi2=0;svmi2<svMarks.length-1;svmi2++){
      var svCur2=svMarks[svmi2],svNxt2=svMarks[svmi2+1];
      var svCurLtr2=pat==="bidi"?(svCur2.idx%2===0):true;
      var svCurEx2=svCurLtr2?svOx+svRW:svOx;
      if(pat==="bidi")svJumps.push({x1:svCurEx2,y1:svCur2.y1,x2:svCurEx2,y2:svNxt2.y1});
      else svJumps.push({x1:svOx+svRW,y1:svCur2.y1,x2:svOx,y2:svNxt2.y1});
    }
  }
  /* Hatch callout geometry — left margin */
  var svShowHC=pat!=="linear"&&nLines>1&&svHtVis>0;
  var svHcY1=svOy,svHcY2=svOy+svHtVis*svScY;
  var svHcGap=svHcY2-svHcY1;
  var svHcBX=svOx-12;
  var svHcInline=svHcGap>=8;
  var svHcInset=svHcGap<8;
  var svHcLabel=svFmtDim(svHtVis);
  /* Formatted dimension labels */
  var svWLabel=svFmtDim(lineL);
  var svHLabel=svFmtDim(scanHN);
  var svGridMinP="",svGridMajP="";
  if(svGrid){
    for(var sgx=0;sgx<=svW_c;sgx+=10){if(sgx%50===0)svGridMajP+="M"+sgx+",0V"+svH_c+" ";else svGridMinP+="M"+sgx+",0V"+svH_c+" ";}
    for(var sgy=0;sgy<=svH_c;sgy+=10){if(sgy%50===0)svGridMajP+="M0,"+sgy+"H"+svW_c+" ";else svGridMinP+="M0,"+sgy+"H"+svW_c+" ";}
  }
  /* SVG click → scan coordinate conversion */
  function svClickToScan(e){
    if(!svRef.current)return null;
    var rect=svRef.current.getBoundingClientRect();
    var sx=(e.clientX-rect.left)/rect.width*svW_c;
    var sy=(e.clientY-rect.top)/rect.height*svH_c;
    var scanX=(sx-svOx)/svScX;
    var scanY=(sy-svOy)/svScY;
    if(scanX<0||scanX>lineL||scanY<0||scanY>(scanHN||0))return null;
    return{x:Math.max(0,Math.min(lineL,scanX)),y:Math.max(0,Math.min(scanHN||0,scanY))};
  }
  function svHandleClick(e){
    var pt=svClickToScan(e);
    if(pt){setSelPt(pt);setSelXS(pt.x.toFixed(3));setSelYS(pt.y.toFixed(3));}
  }
  function svHandleMove(e){setSvHov(svClickToScan(e));}
  function svHandleLeave(){setSvHov(null);}
  function svCoordGo(){
    var x=parseFloat(selXS),y=parseFloat(selYS);
    if(isFinite(x)&&isFinite(y)&&x>=0&&x<=lineL&&y>=0&&y<=(scanHN||0)){
      setSelPt({x:x,y:y});
    }
  }
  /* Convert scan point to SVG pixel coordinates */
  function svPtToSvg(pt){return pt?{sx:svOx+pt.x*svScX,sy:svOy+pt.y*svScY}:null;}
  var svSelS=svPtToSvg(selPt);
  var svHovS=svPtToSvg(svHov);
  /* Tooltip positioning — avoid clipping edges */
  var svTipW=96,svTipH=18;
  function svTipPos(sx,sy){
    var tx=sx+12,ty=sy-22;
    if(tx+svTipW>svW_c-4)tx=sx-svTipW-12;
    if(ty<4)ty=sy+12;
    if(ty+svTipH>svH_c-4)ty=svH_c-svTipH-4;
    return{tx:tx,ty:ty};
  }

  return (<div style={{display:"flex",flexDirection:"column",gap:16}}>
    {/* ═══ Pattern Source (Sub-phase 1D commit 2) ═══ */}
    {/* LSP-JSON import card. When loaded, the controls below become read-only
        and display the LSP-derived values; Eject restores the previous state. */}
    <PatternSource T={T} lspState={lspState}
      onImport={_handleLspImport} onEject={_handleLspEject} />

    {/* ═══ Region 1: Configuration ═══ */}
    <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Scan Configuration</div>
    {/* ── Inputs: 2-column layout ──
        fieldset with disabled={lspLoaded} natively propagates the disabled
        state to every <input>, <select>, <button>, and <textarea> inside.
        Borders/padding/margin/min-width:0 reset so the fieldset is
        layout-transparent. CSS opacity is conditional so the user sees
        the state change clearly. */}
    <fieldset disabled={lspLocked} style={{
      border:"none",padding:0,margin:0,minWidth:0,
      display:"grid",gridTemplateColumns:"0.43fr 1fr",gap:12,alignItems:"start",
      opacity:lspLocked?0.55:1,
      pointerEvents:lspLocked?"none":"auto"
    }}>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={secH}>Beam Parameters</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div><label htmlFor="scan-wl" style={lb}>Wavelength (nm)</label><input id="scan-wl" type="text" value={wlS} onChange={function(e){upN(setWlS,setWl,e.target.value)}} style={ip}/></div>
          <div><label htmlFor="scan-dia" style={lb}>Beam 1/e² Diameter (mm)</label><input id="scan-dia" type="text" value={dS} onChange={function(e){upN(setDS,setDia,e.target.value)}} style={ip}/></div>
          <div>
            <label style={lb}>Laser Mode</label>
            <div style={{display:"inline-flex",background:T.hov||"rgba(15,23,42,0.04)",borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
              {[["pulsed","Pulsed"],["cw","CW"]].map(function(m){
                return <button key={m[0]} onClick={function(){
                  setLaserMode(m[0]);
                  if(m[0]==="cw")setPwMode("power");
                  setDirty(true);
                }} style={{flex:1,padding:"4px 10px",fontSize:12,fontWeight:laserMode===m[0]?500:400,
                  background:laserMode===m[0]?T.card:"transparent",
                  color:laserMode===m[0]?T.tx:T.tm,
                  border:"none",
                  borderBottom:laserMode===m[0]?"2px solid "+T.ac:"2px solid transparent",
                  cursor:"pointer"}}>{m[1]}</button>;
              })}
            </div>
          </div>
          {laserMode==="pulsed"?<div>
            <label style={lb}>Pulse Duration</label>
            <div style={{display:"flex",gap:4}}>
              <input type="text" value={tauS} onChange={function(e){upTau(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
              <select value={tauU} onChange={function(e){setTauU(e.target.value);upTau(tauS)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
            </div>
          </div>:null}
          {laserMode==="pulsed"?<div>
            <label style={lb}>Repetition Rate</label>
            <div style={{display:"flex",gap:4}}>
              <input type="text" value={prfS} onChange={function(e){upPrf(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
              <select value={prfU} onChange={function(e){setPrfU(e.target.value);upPrf(prfS)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{FREQ_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
            </div>
          </div>:null}
          <div>
            <label style={lb}>Power Input</label>
            <select value={pwMode} onChange={function(e){
              var m=e.target.value;setPwMode(m);setDirty(true);
              if(m==="energy"&&prf>0&&pw>0)setEpS((pw/prf).toExponential(4));
            }} disabled={laserMode==="cw"} style={{width:"100%",marginBottom:6,fontSize:11,padding:"5px 8px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:laserMode==="cw"?"default":"pointer",opacity:laserMode==="cw"?0.6:1,boxSizing:"border-box"}}>
              <option value="power">Average Power (W)</option>
              <option value="energy">Pulse Energy (J)</option>
            </select>
            {pwMode==="power"?
              <div>
                <input id="scan-pw" type="text" value={pwS} onChange={function(e){upPw(e.target.value)}} style={ip}/>
                {laserMode==="pulsed"&&prf>0&&pw>0?<div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>{"Ep = "+(pw/prf).toExponential(3)+" J"}</div>:null}
              </div>
            :
              <div>
                <input type="text" value={epS} onChange={function(e){upEp(e.target.value)}} placeholder="e.g. 50e-6" style={ip}/>
                {prf>0&&pw>0?<div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>{"P_avg = "+pw.toPrecision(3)+" W"}</div>:null}
              </div>
            }
          </div>
        </div>

          {/* Divider */}
          <div style={{borderTop:"1px solid "+T.bd,margin:"4px 0"}}/>
          {/* Dwell time + flyback (merged from Settings) */}
          <div>
            <label style={lb}>Dwell Time Definition</label>
            <div style={{display:"inline-flex",background:T.hov||"rgba(15,23,42,0.04)",borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
              {[["gaussian","Gaussian"],["geometric","Geometric"]].map(function(dm){
                return <button key={dm[0]} onClick={function(){setDwm(dm[0])}} style={{flex:1,padding:"4px 10px",fontSize:11,fontWeight:dwm===dm[0]?500:400,background:dwm===dm[0]?T.card:"transparent",color:dwm===dm[0]?T.tx:T.tm,border:"none",borderBottom:dwm===dm[0]?"2px solid "+T.ac:"2px solid transparent",cursor:"pointer"}}>{dm[1]}</button>;
              })}
            </div>
          </div>
          {pat!=="linear"?<div>
            <label style={{...lb,marginBottom:6}}>Galvo Flyback Blanking</label>
            <label style={{display:"flex",alignItems:"flex-start",gap:6,cursor:"pointer",fontSize:11,color:T.tx}}>
              <input type="checkbox" checked={blk} onChange={function(){setBlk(!blk);setDirty(true);}} style={{accentColor:T.ac,width:14,height:14,marginTop:2}}/>
              <span style={{lineHeight:1.3}}>{blk?"Laser blanked during flyback/jumps":"Laser fires during flyback (conservative)"}</span>
            </label>
            <div style={{fontSize:8,color:T.td,marginTop:2,marginLeft:20}}>OCT/confocal systems typically blank during galvo return</div>
          </div>:null}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden",padding:14}}>
        {/* Header: title + toggle toolbar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={secH}>Scan Pattern</div>
          <div style={{display:"flex",gap:2}}>
            <button onClick={function(){setSvGrid(!svGrid);}} title="Grid" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svGrid?svBtnBg:"transparent",border:svGrid?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svGrid?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.4" strokeLinecap="round"><line x1="5" y1="1" x2="5" y2="15"/><line x1="11" y1="1" x2="11" y2="15"/><line x1="1" y1="5" x2="15" y2="5"/><line x1="1" y1="11" x2="15" y2="11"/></svg></button>
            <button onClick={function(){setSvBeam(!svBeam);}} title="Beam spot" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svBeam?svBtnBg:"transparent",border:svBeam?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svBeam?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.3"><circle cx="8" cy="8" r="5" strokeDasharray="2.5 2"/><circle cx="8" cy="8" r="1.5" fill={svIc} stroke="none"/></svg></button>
            <button onClick={function(){setSvFlyback(!svFlyback);}} title="Flyback paths" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svFlyback?svBtnBg:"transparent",border:svFlyback?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svFlyback?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.3" strokeLinecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="12" x2="14" y2="12"/><path d="M14,4 C16,4 16,12 14,12" strokeDasharray="2 2" opacity="0.6"/></svg></button>
            <button onClick={function(){setSvAnts(!svAnts);}} title="Scan animation" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svAnts?svBtnBg:"transparent",border:svAnts?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svAnts?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="8" x2="12" y2="8" strokeDasharray="2.5 3"/><polygon points="11,5.5 15,8 11,10.5" fill={svIc} stroke="none" opacity="0.5"/></svg></button>
          </div>
        </div>
        {/* Pattern selector */}
        <div style={{display:"inline-flex",background:T.hov||"rgba(15,23,42,0.04)",borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden",marginBottom:8}}>
          {[["linear","Linear"],["raster","Raster"],["bidi","Bidirectional"]].map(function(pt){
            return <button key={pt[0]} onClick={function(){setPat(pt[0]);setDirty(true);}} style={{flex:1,padding:"5px 10px",fontSize:12,fontWeight:pat===pt[0]?500:400,background:pat===pt[0]?T.card:"transparent",color:pat===pt[0]?T.tx:T.tm,border:"none",borderBottom:pat===pt[0]?"2px solid "+T.ac:"2px solid transparent",borderRight:pt[0]!=="bidi"?"1px solid "+T.bd:"none",cursor:"pointer"}}>{pt[1]}</button>;
          })}
        </div>
        {/* SVG Visualization — all fixes */}
        <div style={{borderRadius:4,overflow:"hidden",border:"1px solid "+vc.canvasBd,marginBottom:10}}>
          <svg ref={svRef} viewBox={"0 0 "+svW_c+" "+svH_c} style={{width:"100%",height:"auto",display:"block",background:vc.canvas,cursor:pat!=="linear"?"crosshair":"default"}} xmlns="http://www.w3.org/2000/svg" shapeRendering="geometricPrecision" onClick={pat!=="linear"?svHandleClick:null} onMouseMove={pat!=="linear"?svHandleMove:null} onMouseLeave={pat!=="linear"?svHandleLeave:null}>
            <defs>
              <clipPath id="sv-clip"><rect x={svOx-2} y={svOy-2} width={svRW+4} height={svRH+4}/></clipPath>
              <marker id="sv-arr" markerWidth="8" markerHeight="5" refX="7.5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,2.5 L0,5 z" fill={vc.dimAct}/></marker>
              <marker id="sv-arr2" markerWidth="8" markerHeight="5" refX="0.5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M8,0 L0,2.5 L8,5 z" fill={vc.dimAct}/></marker>
              <marker id="sv-hc1" markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0.5 L4,2 L0,3.5 z" fill={vc.hc}/></marker>
              <marker id="sv-hc2" markerWidth="4" markerHeight="4" refX="0.5" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M4,0.5 L0,2 L4,3.5 z" fill={vc.hc}/></marker>
            </defs>
            {svGrid?<g><path d={svGridMinP} fill="none" stroke={vc.gridMin} strokeWidth="0.5" opacity="0.5"/><path d={svGridMajP} fill="none" stroke={vc.gridMaj} strokeWidth="0.5" opacity="0.6"/></g>:null}
            {svGrid?<g>
              <line x1={svOx-14} y1={svOy+svRH} x2={svOx+22} y2={svOy+svRH} stroke={vc.axX} strokeWidth="0.8" opacity="0.4"/>
              <line x1={svOx} y1={svOy+svRH+14} x2={svOx} y2={svOy+svRH-22} stroke={vc.axY} strokeWidth="0.8" opacity="0.4"/>
              <text x={svOx+24} y={svOy+svRH+3} fill={vc.axX} fontSize="7.5" fontFamily="'IBM Plex Mono', monospace" opacity="0.4" fontWeight="400">x</text>
              <text x={svOx+3} y={svOy+svRH-24} fill={vc.axY} fontSize="7.5" fontFamily="'IBM Plex Mono', monospace" opacity="0.4" fontWeight="400">y</text>
              <circle cx={svOx} cy={svOy+svRH} r="1.8" fill="none" stroke={vc.lbl} strokeWidth="0.6"/>
            </g>:null}
            <rect x={svOx} y={svOy} width={svRW} height={svRH} fill="none" stroke={vc.areaBd} strokeWidth="0.75"/>
            {svRenderBeam?<g clipPath="url(#sv-clip)">{svMarks.map(function(s,i){var dx=s.x2-s.x1,dy=s.y2-s.y1,len=Math.sqrt(dx*dx+dy*dy),ang=Math.atan2(dy,dx)*180/Math.PI;return <rect key={"c"+i} x={-len/2} y={-svBeamR} width={len} height={svBeamR*2} rx={svBeamR} transform={"translate("+((s.x1+s.x2)/2)+","+((s.y1+s.y2)/2)+") rotate("+ang+")"} fill={vc.mark} opacity={vc.corr}/>;})}</g>:null}
            {svFlyback?svJumps.map(function(s,i){var vert=Math.abs(s.x1-s.x2)<1;var d=vert?"M"+s.x1+","+s.y1+"L"+s.x2+","+s.y2:"M"+s.x1+","+s.y1+"C"+(s.x1+(s.x2>s.x1?25:-25))+","+s.y1+" "+(s.x2+(s.x1>s.x2?25:-25))+","+s.y2+" "+s.x2+","+s.y2;return <path key={"j"+i} d={d} fill="none" stroke={vc.jump} strokeWidth="0.6" strokeDasharray="4,2" opacity="0.5"/>;}):null}
            {svMarks.map(function(s,i){var dx=s.x2-s.x1,dy=s.y2-s.y1,mx=(s.x1+s.x2)/2,my=(s.y1+s.y2)/2,ang=Math.atan2(dy,dx)*180/Math.PI;return <g key={"m"+i}><line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={vc.mark} strokeWidth="1.0"/>{svAnts?<line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={vc.canvas} strokeWidth="1.0" strokeDasharray="3,7" strokeDashoffset={-antOff} opacity="0.45"/>:null}<polygon points="0,-2.5 5,0 0,2.5" fill={vc.mark} opacity="0.65" transform={"translate("+mx+","+my+") rotate("+ang+")"}/><circle cx={s.x1} cy={s.y1} r="1.4" fill={vc.mark} opacity="0.35"/></g>;})}
            {svRenderBeam&&svMarks.length>0?<g><circle cx={svMarks[0].x1} cy={svMarks[0].y1} r={svBeamR} fill="none" stroke={vc.mark} strokeWidth="0.75" strokeDasharray="2.5,2" opacity="0.3"/></g>:null}
            {/* Inline hatch callout — bracket in left margin */}
            {svShowHC&&svHcInline?<g>
              <line x1={svHcBX-5} y1={svHcY1} x2={svOx-4} y2={svHcY1} stroke={vc.hc} strokeWidth="0.4"/>
              <line x1={svHcBX-5} y1={svHcY2} x2={svOx-4} y2={svHcY2} stroke={vc.hc} strokeWidth="0.4"/>
              <line x1={svHcBX} y1={svHcY1} x2={svHcBX} y2={svHcY2} stroke={vc.hc} strokeWidth="0.5" markerStart="url(#sv-hc2)" markerEnd="url(#sv-hc1)"/>
              <text x={svHcBX-8} y={(svHcY1+svHcY2)/2-1} textAnchor="end" dominantBaseline="middle" fill={vc.hc} fontSize="9" fontFamily="'IBM Plex Mono', monospace" fontWeight="500">{"Δh"}</text>
              <text x={svHcBX-8} y={(svHcY1+svHcY2)/2+10} textAnchor="end" dominantBaseline="middle" fill={vc.hc} fontSize="8.5" fontFamily="'IBM Plex Mono', monospace" fontWeight="500">{svHcLabel}</text>
            </g>:null}
            {/* Inset hatch callout — for sub-pixel spacing */}
            {svShowHC&&svHcInset?<g>
              <rect x="3" y={svPd_t-2} width={svPd_l-8} height="62" rx="3" fill={_isLt?"white":"#2A2A30"} stroke={vc.hc} strokeWidth="0.8"/>
              <text x={(svPd_l-5)/2+3} y={svPd_t+11} textAnchor="middle" fill={vc.hc} fontSize="9" fontFamily="'IBM Plex Sans', system-ui, sans-serif" fontWeight="700" letterSpacing="0.04em">LINE SPACING</text>
              <line x1="10" y1={svPd_t+24} x2={svPd_l-22} y2={svPd_t+24} stroke={vc.mark} strokeWidth="1.0"/>
              <line x1="10" y1={svPd_t+44} x2={svPd_l-22} y2={svPd_t+44} stroke={vc.mark} strokeWidth="1.0"/>
              <line x1={svPd_l-16} y1={svPd_t+24} x2={svPd_l-16} y2={svPd_t+44} stroke={vc.hc} strokeWidth="0.5" markerStart="url(#sv-hc2)" markerEnd="url(#sv-hc1)"/>
              <line x1={svPd_l-20} y1={svPd_t+24} x2={svPd_l-12} y2={svPd_t+24} stroke={vc.hc} strokeWidth="0.7"/>
              <line x1={svPd_l-20} y1={svPd_t+44} x2={svPd_l-12} y2={svPd_t+44} stroke={vc.hc} strokeWidth="0.7"/>
              <text x={(svPd_l-5)/2+3} y={svPd_t+57} textAnchor="middle" fill={vc.hc} fontSize="10.5" fontFamily="'IBM Plex Mono', monospace" fontWeight="700">{svHcLabel}</text>
            </g>:null}
            {/* Width dimension */}
            <g><line x1={svOx} y1={svOy+svRH+3} x2={svOx} y2={svOy+svRH+24} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx+svRW} y1={svOy+svRH+3} x2={svOx+svRW} y2={svOy+svRH+24} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx} y1={svOy+svRH+18} x2={svOx+svRW} y2={svOy+svRH+18} stroke={vc.dimAct} strokeWidth="0.4" markerStart="url(#sv-arr2)" markerEnd="url(#sv-arr)"/><text x={svOx+svRW/2} y={svOy+svRH+32} textAnchor="middle" fill={vc.dimAct} fontSize="10" fontFamily="'IBM Plex Mono', monospace" fontWeight="600">{svWLabel}</text></g>
            {/* Height dimension */}
            {pat!=="linear"?<g><line x1={svOx+svRW+3} y1={svOy} x2={svOx+svRW+24} y2={svOy} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx+svRW+3} y1={svOy+svRH} x2={svOx+svRW+24} y2={svOy+svRH} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx+svRW+18} y1={svOy} x2={svOx+svRW+18} y2={svOy+svRH} stroke={vc.dimAct} strokeWidth="0.4" markerStart="url(#sv-arr2)" markerEnd="url(#sv-arr)"/><text x={svOx+svRW+28} y={svOy+svRH/2} dominantBaseline="middle" fill={vc.dimAct} fontSize="10" fontFamily="'IBM Plex Mono', monospace" fontWeight="600">{svHLabel}</text></g>:null}
            {/* Pattern label — above scan area */}
            <text x={svPd_l} y="16" fill={vc.lbl} fontSize="9.5" fontWeight="600" fontFamily="'IBM Plex Sans', system-ui, sans-serif" letterSpacing="0.08em">{pat==="linear"?"LINEAR":pat==="bidi"?"BIDIRECTIONAL RASTER":"UNIDIRECTIONAL RASTER"}</text>
            {pat!=="linear"?<text x={svW_c-8} y="16" textAnchor="end" fill={vc.lbl} fontSize="9" fontFamily="'IBM Plex Mono', monospace">{nLines+" lines"}</text>:null}
            {/* Decimation notice — below width dim */}
            {svTooMany?<text x={svOx+svRW/2} y={svOy+svRH+42} textAnchor="middle" fill={vc.lbl2} fontSize="9" fontFamily="'IBM Plex Mono', monospace" fontStyle="italic">{"showing "+svDecCount+" of "+nLines.toLocaleString()+" lines"}</text>:null}
            {/* Beam suppression notice — above scan area */}
            {svBeamOwl&&svBeam?<text x={svOx+svRW/2} y={svOy-8} textAnchor="middle" fill={vc.lbl2} fontSize="9" fontFamily="'IBM Plex Mono', monospace">{"beam ("+svFmtDim(dia)+") \u226B scan area"}</text>:null}
            {/* Legend — bottom right, outside scan area */}
            <g transform={"translate("+(svW_c-8)+","+(svH_c-16)+")"}><line x1="-58" y1="0" x2="-44" y2="0" stroke={vc.mark} strokeWidth="1.0"/><text x="-41" y="0.5" dominantBaseline="middle" fill={vc.legTx} fontSize="8" fontFamily="'IBM Plex Mono', monospace">mark</text>{svFlyback?<g><line x1="-58" y1="-14" x2="-44" y2="-14" stroke={vc.jump} strokeWidth="0.8" strokeDasharray="3,2"/><text x="-41" y="-13.5" dominantBaseline="middle" fill={vc.legTx} fontSize="8" fontFamily="'IBM Plex Mono', monospace">flyback</text></g>:null}</g>
            {/* Hover crosshairs — neutral grey, colorblind safe */}
            {svHovS&&!selPt&&pat!=="linear"?<g opacity="0.4">
              <line x1={svHovS.sx} y1={svOy} x2={svHovS.sx} y2={svOy+svRH} stroke={vc.lbl} strokeWidth="0.7" strokeDasharray="3,3"/>
              <line x1={svOx} y1={svHovS.sy} x2={svOx+svRW} y2={svHovS.sy} stroke={vc.lbl} strokeWidth="0.7" strokeDasharray="3,3"/>
              <circle cx={svHovS.sx} cy={svHovS.sy} r="4" fill="none" stroke={vc.lbl} strokeWidth="1"/>
            </g>:null}
            {/* Selected point marker — circle+cross for shape redundancy */}
            {svSelS&&pat!=="linear"?<g>
              <line x1={svSelS.sx} y1={svOy} x2={svSelS.sx} y2={svOy+svRH} stroke={T.no} strokeWidth="0.8" strokeDasharray="5,3" opacity="0.5"/>
              <line x1={svOx} y1={svSelS.sy} x2={svOx+svRW} y2={svSelS.sy} stroke={T.no} strokeWidth="0.8" strokeDasharray="5,3" opacity="0.5"/>
              <circle cx={svSelS.sx} cy={svSelS.sy} r="6" fill="none" stroke={T.no} strokeWidth="1.5"/>
              <line x1={svSelS.sx-3} y1={svSelS.sy} x2={svSelS.sx+3} y2={svSelS.sy} stroke={T.no} strokeWidth="1.5"/>
              <line x1={svSelS.sx} y1={svSelS.sy-3} x2={svSelS.sx} y2={svSelS.sy+3} stroke={T.no} strokeWidth="1.5"/>
            </g>:null}
            {/* Hover coordinate tooltip — dynamically positioned to avoid edge clipping */}
            {svHov&&svHovS&&!selPt&&pat!=="linear"?(function(){var tp=svTipPos(svHovS.sx,svHovS.sy);return <g>
              <rect x={tp.tx} y={tp.ty} width={svTipW} height={svTipH} rx="2" fill="rgba(31,41,51,0.88)"/>
              <text x={tp.tx+6} y={tp.ty+13} fill="#E6EDF3" fontSize="10" fontFamily={"'IBM Plex Mono', monospace"}>{"("+svHov.x.toFixed(2)+", "+svHov.y.toFixed(2)+")"}</text>
            </g>;})():null}
            {/* Click instruction hint — below dimensions, clear of geometry */}
            {!selPt&&pat!=="linear"?<text x={svOx+svRW/2} y={svH_c-4} textAnchor="middle" fill={vc.lbl} fontSize="8.5" fontFamily={"'IBM Plex Sans', system-ui, sans-serif"} fontWeight="400" opacity="0.5">Click anywhere in scan area to select observation point</text>:null}
          </svg>
        </div>
        {/* Coordinate input bar */}
        {pat!=="linear"?<div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:11,color:T.tm,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>Observation:</span>
            {selPt?<span style={{fontFamily:"'IBM Plex Mono', monospace",fontSize:12,color:T.tx,fontWeight:500,fontVariantNumeric:"tabular-nums"}}>{"("+selPt.x.toFixed(3)+", "+selPt.y.toFixed(3)+") mm"}</span>
              :<span style={{fontSize:11,color:T.td,fontStyle:"italic",fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>click scan area or enter coordinates</span>}
            {selPt?<button onClick={function(){setSelPt(null);setSelXS("");setSelYS("");}} style={{fontSize:10,padding:"2px 8px",background:"transparent",border:"1px solid "+T.bd,borderRadius:4,cursor:"pointer",color:T.ac,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>Reset to worst-case</button>:null}
          </div>
          <div style={{borderLeft:"1px solid "+T.bd,height:18}}/>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:10,color:T.td}}>x</span>
            <input type="text" value={selXS} onChange={function(e){setSelXS(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")svCoordGo();}} placeholder="0.000" style={{width:66,fontFamily:"'IBM Plex Mono', monospace",fontSize:11,height:24,padding:"0 6px",border:"1px solid "+T.bd,borderRadius:4,textAlign:"right",color:T.tx,outline:"none",background:T.card,fontVariantNumeric:"tabular-nums",boxSizing:"border-box"}}/>
            <span style={{fontSize:10,color:T.td}}>y</span>
            <input type="text" value={selYS} onChange={function(e){setSelYS(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")svCoordGo();}} placeholder="0.000" style={{width:66,fontFamily:"'IBM Plex Mono', monospace",fontSize:11,height:24,padding:"0 6px",border:"1px solid "+T.bd,borderRadius:4,textAlign:"right",color:T.tx,outline:"none",background:T.card,fontVariantNumeric:"tabular-nums",boxSizing:"border-box"}}/>
            <span style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>mm</span>
            <button onClick={svCoordGo} style={{height:24,padding:"0 10px",fontSize:10,fontWeight:500,background:T.ac,color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>Go</button>
          </div>
        </div>:null}
        {/* Inputs — compact row */}
        <div style={{display:"grid",gridTemplateColumns:pat==="linear"?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:8}}>
          <div><label htmlFor="scan-sw" style={lb}>{pat==="linear"?"Scan Length (mm)":"Width (mm)"}</label><input id="scan-sw" type="text" value={lLS} onChange={function(e){upN(setLLS,setLineL,e.target.value);}} style={ip}/></div>
          {pat!=="linear"?<div><label htmlFor="scan-sh" style={lb}>Height (mm)</label><input id="scan-sh" type="text" value={scanHS} onChange={function(e){upN(setScanHS,setScanHN,e.target.value);}} style={ip}/></div>:null}
          {pat!=="linear"?<div><label htmlFor="scan-nl" style={lb}>Lines</label><input id="scan-nl" type="text" value={nLS} onChange={function(e){setNLS(e.target.value);var v=Math.max(1,Math.round(Number(e.target.value)));if(isFinite(v))setNLines(v);setDirty(true);}} style={ip}/></div>:null}
          <div>
            <label style={lb}>Scan Speed</label>
            <select value={velMode} onChange={function(e){setVelMode(e.target.value);setDirty(true);}} style={{width:"100%",marginBottom:4,fontSize:10,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer",boxSizing:"border-box"}}><option value="velocity">Velocity (mm/s)</option><option value="dwell">Dwell (\u00b5s)</option><option value="scanrate">Line rate (Hz)</option><option value="framerate">Frame rate (fps)</option></select>
            {velMode==="velocity"?<input type="text" value={vS} onChange={function(e){upN(setVS,setVel,e.target.value);}} style={ip}/>:velMode==="dwell"?<input type="text" value={dwellS} onChange={function(e){upN(setDwellS,setDwellN,e.target.value);}} style={ip}/>:velMode==="scanrate"?<input type="text" value={srateS} onChange={function(e){upN(setSrateS,setSrateN,e.target.value);}} style={ip}/>:<input type="text" value={frateS} onChange={function(e){upN(setFrateS,setFrateN,e.target.value);}} style={ip}/>}
          </div>
        </div>
        {/* Derived readouts — single line below */}
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:4}}>
          {pat!=="linear"&&nLines>1&&scanHN>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"Line spacing: "+(scanHN/(nLines-1)).toFixed(4)+" mm"}</div>:null}
          {velMode==="dwell"&&dwellN>0&&dia>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(dia/(dwellN*1e-6)).toFixed(2)+" mm/s"}</div>:null}
          {velMode==="scanrate"&&srateN>0&&lineL>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(srateN*lineL).toFixed(2)+" mm/s"}</div>:null}
          {velMode==="framerate"&&frateN>0&&lineL>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(lineL*(pat==="linear"?1:nLines)*frateN).toFixed(2)+" mm/s"}</div>:null}
        </div>
      </div>

      </div>
    </fieldset>
    <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
      <button onClick={calculate} style={{height:36,padding:"0 24px",fontSize:13,fontWeight:500,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:4,cursor:"pointer",letterSpacing:"-0.005em"}}>{cmp?"Computing...":dirty?"Calculate":"Calculated \u2713"}</button>
    </div>
    </div>

    {/* ── Performance Note ── */}
    {perfNote?<div style={{padding:"8px 12px",borderRadius:4,background:"#fff3e0",border:"1px solid #ffe0b2",fontSize:10,color:"#e65100",fontFamily:"'IBM Plex Mono', monospace",lineHeight:1.6}}>
      {"\u26a1"} {perfNote}
    </div>:null}

    {/* ═══ Region 2: Results ═══ */}
    <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Scan Safety Results</div>
    {/* ── Safety Results ── */}
    {res?<div style={{background:T.card,borderRadius:4,border:"1px solid "+T.bd,padding:14}}>
      {/* Verdict bar + rules in single row */}
      <div style={{display:"flex",gap:12,alignItems:"stretch",marginBottom:12}}>
        <div role="alert" aria-live="polite" style={{background:res.sf.safe?"#E8F5F0":"#fbe9e7",borderRadius:4,padding:"10px 16px",display:"flex",alignItems:"center",gap:10,minWidth:160}}>
          <div><div style={{fontSize:8,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:res.sf.safe?"#00796B":"#bf360c",marginBottom:1}}>Safety Verdict</div><div style={{fontSize:18,fontWeight:700,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.safe?"#00796B":"#bf360c"}}>{res.sf.safe?"PASS":"FAIL"}</div></div>
          <div><div style={{fontSize:9,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.safe?"#00897B":"#d84315"}}>margin: {res.sf.safe?"+":""}{(res.sf.sm*100).toFixed(1)}%</div>
          <div style={{fontSize:9,color:res.sf.safe?"#26a69a":"#e64a19"}}>binding: {res.sf.br}</div></div>
        </div>
        <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,border:"1px solid "+T.bd,borderRadius:4}}>
          <div style={{padding:"8px 12px",borderRight:"1px solid "+T.bd}}>
            <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Rule 1 — Single Pulse</div>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r1m>1?T.no:T.ok}}>{numFmt(res.sf.ppM,4)}</span>
              <span style={{fontSize:9,color:T.td}}>J/cm{"²"}</span>
              <span style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r1m>1?T.no:T.ok,marginLeft:"auto"}}>{res.sf.r1m.toFixed(3)}{"×"}</span>
            </div>
            <div style={{fontSize:8,color:T.td,marginTop:1}}>MPE({"τ"}) = {numFmt(res.sf.mt,4)} J/cm{"²"}</div>
          </div>
          <div style={{padding:"8px 12px"}}>
            <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Rule 2 — Cumulative</div>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r2m>1?T.no:T.ok}}>{numFmt(res.sf.pF,4)}</span>
              <span style={{fontSize:9,color:T.td}}>J/cm{"²"}</span>
              <span style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r2m>1?T.no:T.ok,marginLeft:"auto"}}>{res.sf.r2m.toFixed(3)}{"×"}</span>
            </div>
            <div style={{fontSize:8,color:T.td,marginTop:1}}>MPE(T={numFmt(res.st.tt,3)}s) = {numFmt(res.sf.mT,4)} J/cm{"²"}</div>
          </div>
        </div>
      </div>
      {/* ── Worst-case stationary advisory (galvo-stall fault mode) ── */}
      {(function(){
        var T_st=res.st.tt;
        if(!isFinite(T_st)||T_st<=0)return null;
        var w_cm=(dia/2)/10;
        var denom=Math.PI*w_cm*w_cm;
        if(denom<=0)return null;
        var sRatio,sSafe,sBind,sH,sMPE;
        if(laserMode==="cw"){
          var I_peak=2*pw/denom;
          sH=I_peak*T_st;
          sMPE=skinMPE(wl,T_st);
          sRatio=sH/sMPE;sSafe=sRatio<1;sBind="CW (T="+numFmt(T_st,3)+" s)";
        }else if(prf>0){
          var H_pp=2*(pw/prf)/denom;
          var N_st=prf*T_st;
          var H_total=H_pp*N_st;
          var mpe1=skinMPE(wl,tau);
          var mpeT2=skinMPE(wl,T_st);
          var r1s=H_pp/mpe1;
          var r2s=N_st>1?(H_total/mpeT2):r1s;
          if(r1s>=r2s){sRatio=r1s;sBind="Rule 1 (single pulse)";sH=H_pp;sMPE=mpe1;}
          else{sRatio=r2s;sBind="Rule 2 (cumulative)";sH=H_total;sMPE=mpeT2;}
          sSafe=sRatio<1;
        }else return null;
        var bg=sSafe?"#E8F5F0":"#fff3e0";
        var bd=sSafe?"#C4E5DF":"#ffe0b2";
        var col=sSafe?"#00796B":"#e65100";
        var note=sSafe?"tissue safe under galvo-stall fault":"fault-mode exceeds MPE \u2014 stall interlock recommended";
        return <div style={{marginTop:10,padding:"6px 10px",background:bg,borderRadius:4,border:"1px solid "+bd,fontSize:10,color:col,fontFamily:"'IBM Plex Mono', monospace"}}>
          {(sSafe?"\u2713":"\u26a0")+" Advisory \u2014 worst-case stationary: H = "+numFmt(sH,4)+" J/cm\u00b2 ("+sRatio.toFixed(3)+"\u00d7 MPE), binding "+sBind+" \u2014 "+note}
        </div>;
      })()}
      {/* Compact summary table — single table, essential info only */}
      <div style={secH}>Scan Summary</div>
      <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{[
        ["Scan pattern",pat==="linear"?"Linear":pat==="bidi"?"Bidirectional raster":"Unidirectional raster","Scan velocity",vel+" mm/s"],
        ["Scan time",numFmt(res.st.tt,4)+" s","Grid",res.g.nx+"×"+res.g.ny+" ("+ppd+" pts/dia)"],
        ["Peak fluence",numFmt(res.sf.pF,4)+" J/cm²"+(res.sf.anUsed?" (analytical)":""),"Max pulses at point",String(res.sf.mP)],
        ["Pulse energy",numFmt(pw/prf,4)+" J","Dwell time ("+dwm+")",numFmt(dwm==="gaussian"?scanDwellGaussian(dia,vel):scanDwellGeometric(dia,vel),4)+" s"],
        ["τᵣ (thermal)",numFmt(res.sf.tauR,4)+" s","Flyback blanking",pat==="linear"?"N/A":(blk?"Yes":"No (conservative)")],
      ].map(function(row,i){return <tr key={i} style={{borderBottom:"1px solid "+T.bgI}}>
        <td style={{padding:"3px 8px",fontSize:10,color:T.tm,width:"18%"}}>{row[0]}</td>
        <td style={{padding:"3px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:500,width:"32%"}}>{row[1]}</td>
        <td style={{padding:"3px 8px",fontSize:10,color:T.tm,width:"18%"}}>{row[2]}</td>
        <td style={{padding:"3px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:500,width:"32%"}}>{row[3]}</td>
      </tr>;})}</tbody></table>
      {/* Thermal relaxation — inline if available */}
      {isFinite(res.sf.minRv)?<div style={{marginTop:10,padding:"6px 10px",background:res.sf.rvOk?"#E8F5F0":"#fff3e0",borderRadius:4,border:"1px solid "+(res.sf.rvOk?"#C4E5DF":"#ffe0b2"),fontSize:10,color:res.sf.rvOk?"#00796B":"#e65100",fontFamily:"'IBM Plex Mono', monospace"}}>
        {res.sf.rvOk?"✓":"⚠"}{" Thermal: τᵣ = "+numFmt(res.sf.tauR,3)+" s, min revisit = "+numFmt(res.sf.minRv,3)+" s ("+((res.sf.minRv/res.sf.tauR)).toFixed(2)+"× τᵣ) — "+(res.sf.rvOk?"tissue cools between passes":"thermal accumulation likely")}
      </div>:null}
      {/* Permissible limits — compact inline */}
      {(function(){
        var maxEp=scanMaxPulseEnergy(wl,dia,tau);
        var minPRF=scanMinRepRate(wl,dia,tau,pw);
        return <div style={{marginTop:10}}>
          <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:4}}>Permissible Ranges</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
            {[
              ["Max Ep",numFmt(maxEp,3)+" J",pw/prf<=maxEp*1.001],
              ["Min PRF",numFmt(minPRF,3)+" Hz",prf>=minPRF*0.999],
              ["Max power",numFmt(res.maxP||0,3)+" W",pw<=(res.maxP||Infinity)*1.001],
              ["Min velocity",isFinite(res.minV)?numFmt(res.minV,3)+" mm/s":"—",isFinite(res.minV)?vel>=res.minV*0.999:true]
            ].map(function(it,i){
              return <div key={i} style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}}>
                <span style={{color:T.td,fontSize:9}}>{it[0]}: </span>
                <span style={{fontWeight:600,color:it[2]?T.ok:T.no}}>{it[1]}</span>
              </div>;
            })}
          </div>
        </div>;
      })()}
    </div>:null}

    {/* ── Point Timing Visualization ── */}
    <div style={{background:T.card,borderRadius:4,border:"1px solid "+T.bd,padding:14}}>
      <div style={secH}>Point Timing Diagram</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>
          {selPt?"Observing ("+selPt.x.toFixed(3)+", "+selPt.y.toFixed(3)+") mm":"Showing worst-case point"}
          {selPt?" \u2014 select a different point in the scan pattern above or enter coordinates.":"."}
        </div>
        {res?<div style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Mono', monospace",fontVariantNumeric:"tabular-nums"}}>Grid: {res.g.nx}{"\u00d7"}{res.g.ny} {"\u00b7"} Pulses: {(res.pulses && res.pulses.length>0)?res.pulses.length:(res.st.tp||0)}</div>:null}
      </div>
      {lspState.customPath?<div style={{height:300,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12,fontFamily:"'IBM Plex Sans', system-ui, sans-serif",padding:"0 24px",textAlign:"center"}}><div style={{fontSize:13,fontWeight:600,color:T.tm,marginBottom:6}}>Per-point timing not available for custom-path LSPs</div><div style={{maxWidth:480,lineHeight:1.5}}>The point-timing diagram assumes a regular raster scan; this LSP defines an arbitrary segment path. Use the safety verdict and peak fluence above for the worst-case point — these are computed correctly from the actual segments.</div></div>
        :res&&prf>0?<div>
        <div ref={ptTimRef} style={{width:"100%",height:420,borderRadius:4}}/>
      </div>
        :<div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>{res?"CW mode \u2014 no discrete pulses":"Click Calculate to generate timing diagram"}</div>}
    </div>
    </div>

    {/* ═══ Region 3: Safety Notice ═══ */}
    {/* Safety disclaimer — compact */}
    <div style={{fontSize:9,color:T.td,lineHeight:1.6,padding:"8px 0"}}>
      <strong style={{color:T.tm}}>{"⚠"} Notice:</strong>{" "}
      This tool evaluates skin MPE per {STD_NAME} using Rules 1 and 2. It assumes Gaussian beam, uniform Ep, and ideal positioning.{" "}
      <strong style={{color:T.no}}>Research and educational use only.</strong>{" "}Verify all values against the applicable standard.
    </div>
  </div>);
}

/* ═══════ OCT SCANNING ═══════ */
function OCTScanContent(p){
  var T=p.T,theme=p.theme,msg=p.msg,setMsg=p.setMsg;
  var _wl=useState("1310"),wlS=_wl[0],setWlS=_wl[1]; var _wn=useState(1310),wl=_wn[0],setWl=_wn[1];
  var _d=useState("0.020"),dS=_d[0],setDS=_d[1]; var _dn=useState(0.020),dia=_dn[0],setDia=_dn[1];
  var _tau=useState("6.5"),tauS=_tau[0],setTauS=_tau[1]; var _tn=useState(6.5e-6),tau=_tn[0],setTau=_tn[1];
  var _tU=useState("us"),tauU=_tU[0],setTauU=_tU[1];
  var _prf=useState("100"),prfS=_prf[0],setPrfS=_prf[1]; var _pn=useState(100000),prf=_pn[0],setPrf=_pn[1];
  var _pfU=useState("kHz"),prfU=_pfU[0],setPrfU=_pfU[1];
  var _pw=useState("0.010"),pwS=_pw[0],setPwS=_pw[1]; var _pwn=useState(0.010),pw=_pwn[0],setPw=_pwn[1];
  var _pwMode=useState("power"),pwMode=_pwMode[0],setPwMode=_pwMode[1]; /* "power" or "energy" */
  var _lcm=useState("pulsed"),laserMode=_lcm[0],setLaserMode=_lcm[1]; /* "pulsed" | "cw" */
  var _epS=useState(""),epS=_epS[0],setEpS=_epS[1];
  var _vs=useState("100"),vS=_vs[0],setVS=_vs[1]; var _vn=useState(100),vel=_vn[0],setVel=_vn[1];
  var _vMode=useState("ascans"),velMode=_vMode[0],setVelMode=_vMode[1]; /* "ascans"|"velocity"|"dwell"|"scanrate"|"framerate" */
  var _dw=useState("10"),dwellS=_dw[0],setDwellS=_dw[1]; var _dwN=useState(10),dwellN=_dwN[0],setDwellN=_dwN[1]; /* µs per spot */
  var _sr=useState("5"),srateS=_sr[0],setSrateS=_sr[1]; var _srN=useState(5),srateN=_srN[0],setSrateN=_srN[1]; /* lines/s */
  var _fr=useState("1"),frateS=_fr[0],setFrateS=_fr[1]; var _frN=useState(1),frateN=_frN[0],setFrateN=_frN[1]; /* fps */
  var _pat=useState("raster"),pat=_pat[0],setPat=_pat[1];
  var _lL=useState("6"),lLS=_lL[0],setLLS=_lL[1]; var _lLn=useState(6),lineL=_lLn[0],setLineL=_lLn[1]; /* scan width = B-scan length */
  var _sH=useState("6"),scanHS=_sH[0],setScanHS=_sH[1]; var _sHn=useState(6),scanHN=_sHn[0],setScanHN=_sHn[1]; /* slow-axis range */
  var _nL=useState("500"),nLS=_nL[0],setNLS=_nL[1]; var _nLn=useState(500),nLines=_nLn[0],setNLines=_nLn[1]; /* B-scans per volume */
  var _htn=useState(6/499),hatch=_htn[0],setHatch=_htn[1]; /* derived: scanHN/(nLines-1) */
  /* ── OCT-specific state ── */
  var _bw=useState("100"),bwS=_bw[0],setBwS=_bw[1]; var _bwn=useState(100),bw=_bwn[0],setBw=_bwn[1]; /* spectral FWHM bandwidth (nm) */
  var _dc=useState("1.0"),dcS=_dc[0],setDcS=_dc[1]; var _dcn=useState(1.0),dc=_dcn[0],setDc=_dcn[1]; /* sweep duty cycle (1.0 = continuous) */
  var _nBM=useState("1"),nBMS=_nBM[0],setNBMS=_nBM[1]; var _nBMn=useState(1),nBM=_nBMn[0],setNBM=_nBMn[1]; /* BM-scan repetitions per location */
  var _nA=useState("500"),nAS=_nA[0],setNAS=_nA[1]; var _nAn=useState(500),nA=_nAn[0],setNA=_nAn[1]; /* A-scans per B-scan */
  var _preset=useState("ss-skin"),preset=_preset[0],setPreset=_preset[1]; /* "sd-840" | "ss-1060" | "ss-skin" */
  var _advOpen=useState(false),advOpen=_advOpen[0],setAdvOpen=_advOpen[1];

  var _ppd=useState(8),ppd=_ppd[0],setPpd=_ppd[1];
  var _dwm=useState("gaussian"),dwm=_dwm[0],setDwm=_dwm[1];
  var _blk=useState(false),blk=_blk[0],setBlk=_blk[1];
  var _res=useState(null),res=_res[0],setRes=_res[1];
  var _cmp=useState(false),cmp=_cmp[0],setCmp=_cmp[1];
  var _dirty=useState(true),dirty=_dirty[0],setDirty=_dirty[1];

  /* Scan visualization feature toggles */
  var _svGrid=useState(true),svGrid=_svGrid[0],setSvGrid=_svGrid[1];
  var _svBeam=useState(true),svBeam=_svBeam[0],setSvBeam=_svBeam[1];
  var _svFlyback=useState(true),svFlyback=_svFlyback[0],setSvFlyback=_svFlyback[1];
  var _svAnts=useState(false),svAnts=_svAnts[0],setSvAnts=_svAnts[1];
  var _antOff=useState(0),antOff=_antOff[0],setAntOff=_antOff[1];
  useEffect(function(){
    if(!svAnts)return;
    var f;var tick=function(){setAntOff(function(p){return(p+0.5)%20;});f=requestAnimationFrame(tick);};
    f=requestAnimationFrame(tick);
    return function(){cancelAnimationFrame(f);};
  },[svAnts]);

  var lb={display:"block",fontSize:11,fontWeight:500,color:T.tm,marginBottom:3,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"};
  var ip={width:"100%",padding:"6px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",fontVariantNumeric:"tabular-nums",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};
  var secH={fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:T.td,marginBottom:8,paddingBottom:4,borderBottom:"1px solid "+T.bd,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"};
  var thS={padding:"5px 8px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700};
  var tdS={padding:"5px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace"};

  function upN(setS,setN,s){setS(s);var v=Number(s);if(isFinite(v))setN(v);setDirty(true);}
  function upTau(s){setTauS(s);var v=Number(s);if(isFinite(v)&&v>0){var m=1;for(var i=0;i<DUR_UNITS.length;i++){if(DUR_UNITS[i].id===tauU)m=DUR_UNITS[i].toS;}setTau(v*m);}setDirty(true);}
  function upPrf(s){setPrfS(s);var v=Number(s);if(isFinite(v)&&v>0){var m=1;for(var i=0;i<FREQ_UNITS.length;i++){if(FREQ_UNITS[i].id===prfU)m=FREQ_UNITS[i].toHz;}setPrf(v*m);}setDirty(true);}
  /* Power/energy toggle helpers */
  function upPw(s){setPwS(s);var v=Number(s);if(isFinite(v)&&v>0){setPw(v);if(prf>0)setEpS((v/prf).toExponential(4));}setDirty(true);}
  function upEp(s){setEpS(s);var v=Number(s);if(isFinite(v)&&v>0&&prf>0){var P=v*prf;setPw(P);setPwS(P.toPrecision(4));}setDirty(true);}
  /* When PRF changes and mode is energy, recompute power */
  useEffect(function(){if(pwMode==="energy"&&prf>0){var v=Number(epS);if(isFinite(v)&&v>0){setPw(v*prf);setPwS((v*prf).toPrecision(4));}}},[prf,pwMode,epS]);
  /* When PRF changes and mode is power, update displayed Ep */
  useEffect(function(){if(pwMode==="power"&&prf>0&&pw>0){setEpS((pw/prf).toExponential(4));}},[prf,pw,pwMode]);
  /* Keep hatch in sync with scan height and scan line count */
  useEffect(function(){
    if((pat==="raster"||pat==="bidi")&&scanHN>0&&nLines>=1)setHatch(nLines>1?scanHN/(nLines-1):scanHN);
  },[pat,scanHN,nLines]);
  /* Keep vel in sync for all derived velocity input modes */
  useEffect(function(){
    var v=0;
    if(velMode==="ascans"&&nA>0&&lineL>0&&prf>0) v=lineL*prf/nA;
    else if(velMode==="dwell"&&dwellN>0&&dia>0) v=dia/(dwellN*1e-6);
    else if(velMode==="scanrate"&&srateN>0&&lineL>0) v=srateN*lineL;
    else if(velMode==="framerate"&&frateN>0&&lineL>0) v=lineL*(pat==="linear"?1:nLines)*frateN;
    if(v>0&&isFinite(v)){setVel(v);setVS(v.toPrecision(4));}
  },[velMode,nA,prf,dwellN,srateN,frateN,lineL,nLines,dia,pat]);

  /* Selected point for timing diagram (null = worst-case) */
  var _selPt=useState(null),selPt=_selPt[0],setSelPt=_selPt[1];
  var _svHov=useState(null),svHov=_svHov[0],setSvHov=_svHov[1];
  var _selXS=useState(""),selXS=_selXS[0],setSelXS=_selXS[1];
  var _selYS=useState(""),selYS=_selYS[0],setSelYS=_selYS[1];
  var svRef=useRef(null);

  var _perfNote=useState(""),perfNote=_perfNote[0],setPerfNote=_perfNote[1];
  var _workerRef=useRef(null);

  /* ── LSP-JSON import state (Sub-phase 1D commit 2) ─────────────────────
     phase:  "idle" | "loading" | "loaded" | "error"
     When phase==="loaded", the existing scan-configuration inputs are
     disabled and display the LSP-derived values.  Eject restores the
     pre-import state.  The LSP worker is created lazily on first import. */
  var _lspState=useState({phase:"idle"}),lspState=_lspState[0],setLspState=_lspState[1];
  var _lspWorkerRef=useRef(null);
  var _lspInitRef=useRef(null);
  var _lspPreImportState=useRef(null);
  var _lspReqIdRef=useRef(0);  // monotonic request ID counter (prevents Math.random collisions)
  /* Holds the engine-format segments for a custom-path LSP (Sub-phase 1D
     commit 3).  Non-null only while phase==="loaded" AND the LSP used a
     segment-array authoritative path (canonicalize emitted scanParams=null
     with non-empty engineSegments).  Shape: {segments, bbox, totalTime_s,
     meanVelocity_mm_s, hasBlankedSegments, d_1e_mm}.                      */
  var _lspCustomSegsRef=useRef(null);

  /* Lazy worker creation + init.  Returns a Promise that resolves when the
     worker has accepted the standard.  Three structural defenses:
     (1) On init rejection we CLEAR _lspInitRef so the next import retries,
         rather than permanently caching the rejected promise.
     (2) We attach an 'error' event listener on the worker so script-load
         failures (CSP block, malformed bundle, etc) reject the promise
         rather than hanging forever.
     (3) We add a 10s init timeout as a last-resort defense; in practice
         init takes 50-200 ms in modern browsers.                          */
  function _getLspWorkerInited(){
    if (_lspInitRef.current) return _lspInitRef.current;
    if (typeof __createLSPWorker!=="function") return null;
    var w = __createLSPWorker();
    if (!w) return null;
    _lspWorkerRef.current = w;

    // Compute stdData OUTSIDE the Promise executor.  If _E.getStandard()
    // throws here, we can clean up the worker reference cleanly before
    // returning a rejected Promise; throwing inside the executor would
    // leak the worker ref because the catch path runs in a context where
    // we've already assigned _lspWorkerRef.current = w.
    var stdData;
    try {
      stdData = (typeof __STD_DATA__!=="undefined") ? __STD_DATA__ :
                (_E && _E.getStandard ? {standard:_E.getStandard()} : null);
    } catch (stdErr) {
      try { w.terminate(); } catch (_) {}
      _lspWorkerRef.current = null;
      _lspInitRef.current = null;
      return Promise.reject(new Error("Failed to obtain standard data: " +
        (stdErr && stdErr.message ? stdErr.message : String(stdErr))));
    }

    var p = new Promise(function(resolve, reject){
      var initReq = (++_lspReqIdRef.current);
      var settled = false;
      function settle(ok, err){
        if (settled) return; settled = true;
        try { w.removeEventListener("message", onInit); } catch (_) {}
        try { w.removeEventListener("error", onError); } catch (_) {}
        if (timeoutId) clearTimeout(timeoutId);
        if (ok) resolve();
        else {
          // Terminate the failed worker to free its thread/memory; clear
          // both refs so the next import retries with a fresh worker.
          try { w.terminate(); } catch (_) {}
          if (_lspWorkerRef.current === w) _lspWorkerRef.current = null;
          _lspInitRef.current = null;
          reject(err);
        }
      }
      function onInit(ev){
        if (!ev||!ev.data) return;
        if (ev.data.requestId!==initReq) return;
        // Accept both init_result and error (worker's top-level catch).
        // Without this, a worker exception during init would silently
        // hang us for the full 10 s timeout.
        if (ev.data.type==="init_result") {
          if (ev.data.ok) settle(true);
          else settle(false, new Error(ev.data.error||"LSP worker init failed"));
        } else if (ev.data.type==="error") {
          var firstErr = ev.data.errors && ev.data.errors[0];
          settle(false, new Error(
            (firstErr && firstErr.message) ? firstErr.message :
            "Worker emitted an error response during init"));
        }
        // Other response types: ignore.
      }
      function onError(ev){
        // Worker script-load failure or uncaught exception inside the worker.
        var msg = (ev && ev.message) ? ev.message :
                  (ev && ev.filename) ? ("error in "+ev.filename) :
                  "Worker reported an error before init completed";
        settle(false, new Error(msg));
      }
      var timeoutId = setTimeout(function(){
        settle(false, new Error("LSP worker init timed out after 10 s"));
      }, 10000);
      w.addEventListener("message", onInit);
      w.addEventListener("error", onError);
      try {
        w.postMessage({type:"init", requestId:initReq, standard:stdData});
      } catch (postErr) {
        settle(false, postErr);
      }
    });
    _lspInitRef.current = p;
    return p;
  }

  /* Send a canonicalize message and wait for the matching response.  Three
     structural defenses against M2 (handler leak): we ALWAYS remove the
     listener via a settle() helper, even on timeout; we time out after 30s
     (canonicalization on the largest realistic doc completes in 1-2 s); and
     errors during postMessage are caught synchronously.                  */
  function _canonicalizeViaWorker(doc){
    return new Promise(function(resolve, reject){
      var initP = _getLspWorkerInited();
      if (!initP){
        reject(new Error("LSP worker is not available in this environment"));
        return;
      }
      initP.then(function(){
        var w = _lspWorkerRef.current;
        if (!w){
          reject(new Error("LSP worker reference was cleared during init"));
          return;
        }
        var req = (++_lspReqIdRef.current);
        var settled = false;
        function settle(ok, val){
          if (settled) return; settled = true;
          try { w.removeEventListener("message", onMsg); } catch (_) {}
          try { w.removeEventListener("error", onError); } catch (_) {}
          if (timeoutId) clearTimeout(timeoutId);
          if (ok) resolve(val); else reject(val);
        }
        function onMsg(ev){
          if (!ev||!ev.data) return;
          if (ev.data.requestId!==req) return;
          // Accept both canonicalize_result (normal path) and error (worker's
          // top-level catch).  Both have matching requestId; both indicate
          // the worker is done with this request.  Without accepting "error"
          // here, an internal worker exception would cause us to wait the
          // full 30 s timeout when we already have the error in hand.
          if (ev.data.type==="canonicalize_result") {
            settle(true, ev.data);
          } else if (ev.data.type==="error") {
            // Worker emitted a top-level error response.  Surface it as a
            // structured canonicalize-style failure so the caller's existing
            // error-handling path works uniformly.
            settle(true, {
              type: "canonicalize_result",
              requestId: req,
              ok: false,
              errors: (ev.data.errors && ev.data.errors.length) ? ev.data.errors : [{
                code: "INTERNAL_ERROR", path: "",
                message: "Worker emitted an error response without details"
              }],
              warnings: []
            });
          }
          // Other response types: ignore (defensive — unknown protocol extension).
        }
        function onError(ev){
          var msg = (ev && ev.message) ? ev.message :
                    "Worker reported an error during canonicalization";
          settle(false, new Error(msg));
        }
        var timeoutId = setTimeout(function(){
          settle(false, new Error("LSP canonicalization timed out after 30 s"));
        }, 30000);
        w.addEventListener("message", onMsg);
        w.addEventListener("error", onError);
        try {
          w.postMessage({type:"canonicalize", requestId:req, doc:doc});
        } catch (postErr) {
          settle(false, postErr);
        }
      }, function(initErr){ reject(initErr); });
    });
  }

  /* Build the dicts of getters/setters used by the module-level LSP helpers.
     These dicts are recreated on every render — the helpers do not retain
     them between calls, so the per-render cost is just object allocation. */
  function _lspGetters(){
    return {
      wlS:wlS, wl:wl, dS:dS, dia:dia,
      tauS:tauS, tau:tau, tauU:tauU,
      prfS:prfS, prf:prf, prfU:prfU,
      pwS:pwS, pw:pw, pwMode:pwMode,
      laserMode:laserMode, epS:epS,
      vS:vS, vel:vel, velMode:velMode,
      dwellS:dwellS, dwellN:dwellN,
      srateS:srateS, srateN:srateN,
      frateS:frateS, frateN:frateN,
      pat:pat, lLS:lLS, lineL:lineL,
      scanHS:scanHS, scanHN:scanHN,
      nLS:nLS, nLines:nLines, blk:blk
    };
  }
  function _lspSetters(){
    return {
      setWlS:setWlS, setWl:setWl, setDS:setDS, setDia:setDia,
      setTauS:setTauS, setTau:setTau, setTauU:setTauU,
      setPrfS:setPrfS, setPrf:setPrf, setPrfU:setPrfU,
      setPwS:setPwS, setPw:setPw, setPwMode:setPwMode,
      setLaserMode:setLaserMode, setEpS:setEpS,
      setVS:setVS, setVel:setVel, setVelMode:setVelMode,
      setDwellS:setDwellS, setDwellN:setDwellN,
      setSrateS:setSrateS, setSrateN:setSrateN,
      setFrateS:setFrateS, setFrateN:setFrateN,
      setPat:setPat, setLLS:setLLS, setLineL:setLineL,
      setScanHS:setScanHS, setScanHN:setScanHN,
      setNLS:setNLS, setNLines:setNLines, setBlk:setBlk,
      setDirty:setDirty
    };
  }

  /* M32 fix: terminate the LSP worker on unmount so tab switching doesn't
     leak workers.  The dependency array is empty so this effect's cleanup
     runs only at unmount.  Reading _lspWorkerRef.current at unmount is
     correct — refs are mutable through the component's lifetime and the
     ref captures the latest worker. */
  useEffect(function(){
    return function(){
      var w = _lspWorkerRef.current;
      if (w) { try { w.terminate(); } catch (_) {} }
      _lspWorkerRef.current = null;
      _lspInitRef.current = null;
      // Clearing the custom-segs ref on unmount makes the setTimeout race
      // guard inside calculate() short-circuit if the user switched tabs
      // (which unmounts this component) during the 60 ms dispatch window.
      _lspCustomSegsRef.current = null;
    };
  }, []);

  function _handleLspImport(file){
    setLspState({phase:"loading", filename:file && file.name});
    _readAndValidateLSP(file).then(function(r){
      if (!r.ok) {
        setLspState({phase:"error", filename:file && file.name,
          errors:r.errors||[], warnings:r.warnings||[]});
        return;
      }
      _canonicalizeViaWorker(r.doc).then(function(cr){
        if (!cr.ok) {
          setLspState({phase:"error", filename:file && file.name,
            errors:cr.errors||[], warnings:(r.warnings||[]).concat(cr.warnings||[])});
          return;
        }
        // Snapshot pre-import state ONLY if we're entering loaded from idle
        // or error.  If we were already loaded (user re-importing without
        // ejecting), the existing snapshot still holds the true pre-LSP
        // state — keep it so Eject restores to manual values, not to the
        // previous LSP.
        if (lspState.phase==="idle" || lspState.phase==="error") {
          _lspPreImportState.current = _lspSnapshotState(_lspGetters());
        }
        // _lspApplyState handles both preset and custom-segment paths.  It
        // populates _lspCustomSegsRef.current when the LSP uses a custom
        // path (scanParams=null + engineSegments present), or clears it
        // for preset paths.
        var applyResult = _lspApplyState(cr, _lspSetters(), _lspCustomSegsRef);
        if (!applyResult.ok) {
          setLspState({phase:"error", filename:file && file.name,
            errors:applyResult.errors||[{code:"INTERNAL_ERROR", path:"",
              message:"Failed to apply LSP-derived values"}],
            warnings:(r.warnings||[]).concat(cr.warnings||[])});
          return;
        }
        setLspState({phase:"loaded", filename:file && file.name, doc:r.doc,
          customPath:applyResult.customPath,
          beam:cr.beam, engineSegments:cr.engineSegments, scanParams:cr.scanParams,
          totalTime_s:cr.totalTime_s, warnings:(r.warnings||[]).concat(cr.warnings||[])});
      }, function(workerErr){
        // Differentiate error codes based on the actual failure mode.
        // The Promise rejector inside _getLspWorkerInited / _canonicalizeViaWorker
        // throws Error objects with specific messages.  We pattern-match the
        // message to assign the right code so users see a meaningful error.
        // Patterns are deliberately broad: any timeout → WORKER_TIMEOUT;
        // any init-related failure → WORKER_INIT_FAILED; everything else
        // (including post-init worker exceptions and structured-clone errors)
        // falls through to WORKER_UNAVAILABLE.
        var errMsg = String(workerErr && workerErr.message || workerErr);
        var code = "WORKER_UNAVAILABLE";
        if (/timed out/i.test(errMsg)) {
          code = "WORKER_TIMEOUT";
        } else if (/\binit\b|standard data/i.test(errMsg)) {
          // Matches: "init failed", "init result", "during init",
          // "before init completed", "Failed to obtain standard data"
          code = "WORKER_INIT_FAILED";
        }
        setLspState({phase:"error", filename:file && file.name,
          errors:[{code:code, path:"", message:errMsg}],
          warnings:r.warnings||[]});
      });
    });
  }

  function _handleLspEject(){
    _lspRestoreState(_lspPreImportState.current, _lspSetters());
    setDirty(true);
    _lspPreImportState.current = null;
    _lspCustomSegsRef.current = null;
    setLspState({phase:"idle"});
  }
  var lspLoaded = lspState.phase==="loaded";
  /* During the "loading" phase the worker is canonicalizing the LSP and the
     state values are about to be overwritten by _lspApplyState. Disabling
     the fieldset during loading prevents the user from making edits that
     would be silently clobbered when the canonicalization resolves.        */
  var lspLocked = lspLoaded || lspState.phase==="loading";

  /* ── Web Worker: runs scanning computation off the main thread ── */
  function getWorker(){
    if(_workerRef.current)return _workerRef.current;
    if(typeof __ENGINE_SOURCE__==="undefined")return null;
    var workerCode=__ENGINE_SOURCE__+"\n"+[
      "self.onmessage=function(e){",
      "  var p=e.data;",
      "  MPEEngine.loadStandard(p.std);",
      "  var E=MPEEngine;",
      "  var isCW=p.prf===0&&p.tau===0;",
      "  var Ep=p.prf>0?p.pw/p.prf:0;",
      "  var beam={d_1e_mm:p.dia,wl_nm:p.wl,tau_s:p.tau,prf_hz:p.prf,",
      "    pulse_energy_J:Ep,avg_power_W:p.pw,is_cw:isCW};",
      "  /* Segment-superposition framework: create scan params for all patterns */",
      "  var sepP={d_1e_mm:p.dia,prf_hz:p.prf||0,pulse_energy_J:Ep,avg_power_W:p.pw,v_scan_mm_s:p.vel,",
      "     x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "     pattern:p.pat,blanking:p.blk,is_cw:isCW,v_jump_mm_s:p.vel*5};",
      "  /* Only build segments if separable path not available */",
      "  function bldSegs(pat,x0,y0,lL,nL,h,sv,jv,d,bl){",
      "    if(pat==='linear')return E.buildLinearScan(x0,y0,0,lL,sv,d);",
      "    return E.buildRasterScan(x0,y0,lL,nL,h,sv,jv,d,bl);}",
      "  var segs=sepP?[]:bldSegs(p.pat,0,0,p.lineL,p.nLines,p.hatch,p.vel,p.vel*5,p.dia,p.blk);",
      "  var cr=E.computeScanFluence(beam,segs,p.effPpd,sepP);",
      "  if(!cr){self.postMessage({error:'Computation returned null'});return;}",
      "  var eg=cr.grid,s=cr.stats;",
      "  var minV=isCW?(s.min_velocity||p.vel):0;",
      "  var sfBeam={wl_nm:p.wl,d_1e_mm:p.dia,tau_s:p.tau,is_cw:isCW,pulse_energy_J:Ep,prf_hz:p.prf,avg_power_W:p.pw};",
      "  var sf=E.evaluateScanSafety(eg,sfBeam,s.total_time_s,p.dwm,minV,{v_mm_s:p.vel,line_spacing_mm:p.hatch||0,n_lines:p.nLines||1});",
      "  /* Max permissible power */",
      "  var unitBeam={d_1e_mm:p.dia,wl_nm:p.wl,tau_s:p.tau,prf_hz:p.prf,",
      "    pulse_energy_J:p.prf>0?1/p.prf:0,avg_power_W:1,is_cw:isCW};",
      "  var unitSepP={d_1e_mm:p.dia,prf_hz:p.prf||0,pulse_energy_J:p.prf>0?1/p.prf:0,avg_power_W:1,v_scan_mm_s:p.vel,",
      "     x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "     pattern:p.pat,blanking:p.blk,is_cw:isCW,v_jump_mm_s:p.vel*5};",
      "  var ucr=E.computeScanFluence(unitBeam,sepP?[]:segs,p.auxPpd,unitSepP);",
      "  var maxP=Infinity;",
      "  if(ucr){var upF=0;for(var i=0;i<ucr.grid.fluence.length;i++)if(ucr.grid.fluence[i]>upF)upF=ucr.grid.fluence[i];",
      "    var mpeT=E.skinMPE(p.wl,ucr.stats.total_time_s||s.total_time_s);",
      "    if(upF>0)maxP=mpeT/upF;",
      "    if(!isCW&&p.prf>0){var w2=p.dia/Math.sqrt(2);var maxPr1=E.skinMPE(p.wl,p.tau)*p.prf*Math.PI*w2*w2/(2*100);",
      "      if(maxPr1<maxP)maxP=maxPr1;}}",
      "  /* Min safe velocity bisection */",
      "  var minVel=0;",
      "  function testV(tv){",
      "    var tSepP={d_1e_mm:p.dia,prf_hz:p.prf||0,pulse_energy_J:Ep,avg_power_W:p.pw,v_scan_mm_s:tv,",
      "       x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "       pattern:p.pat,blanking:p.blk,is_cw:isCW,v_jump_mm_s:tv*5};",
      "    var ts2=tSepP?[]:bldSegs(p.pat,0,0,p.lineL,p.nLines,p.hatch,tv,tv*5,p.dia,p.blk);",
      "    var tb={d_1e_mm:p.dia,wl_nm:p.wl,tau_s:p.tau,prf_hz:p.prf,pulse_energy_J:Ep,avg_power_W:p.pw,is_cw:isCW};",
      "    var tcr=E.computeScanFluence(tb,ts2,p.auxPpd,tSepP);",
      "    if(!tcr)return true;",
      "    var tmv=isCW?(tcr.stats.min_velocity||tv):0;",
      "    var tsf=E.evaluateScanSafety(tcr.grid,sfBeam,tcr.stats.total_time_s,p.dwm,tmv,{v_mm_s:tv,line_spacing_mm:p.hatch||0,n_lines:p.nLines||1});",
      "    return tsf.safe;}",
      "  if(testV(1e6)){var vLo=0.01,vHi=1e6;",
      "    for(var bi=0;bi<p.maxBisect&&(vHi-vLo)/vLo>0.01;bi++){var vMid=(vLo+vHi)/2;if(testV(vMid))vHi=vMid;else vLo=vMid;}",
      "    minVel=vHi;}else{minVel=Infinity;}",
      "  /* Pulse positions for visualization (generated from scan params, not segments) */",
      "  var pulseArr=[];",
      "  if(!isCW&&p.prf>0){",
      "    var maxSP=5000;",
      "    var ps_mm=p.vel/p.prf;",
      "    var nPulsesLine=Math.max(1,Math.floor((p.lineL/p.vel)*p.prf));",
      "    var totalEst=nPulsesLine*(p.nLines||1);",
      "    var pStride=Math.max(1,Math.ceil(totalEst/maxSP));",
      "    var nL=p.nLines||1,hh=p.hatch||0,tAcc=0;",
      "    for(var li=0;li<nL&&pulseArr.length<maxSP;li++){",
      "      var ly=li*hh;",
      "      var scanDir=1; /* raster scans are unidirectional */",
      "      var xStart=scanDir===1?0:p.lineL;",
      "      for(var ki=0;ki<nPulsesLine&&pulseArr.length<maxSP;ki+=pStride){",
      "        var px=xStart+scanDir*ki*ps_mm;",
      "        pulseArr.push({t:tAcc+ki/p.prf,x:px,y:ly,si:li});",
      "      }",
      "      tAcc+=p.lineL/p.vel;",
      "      if(li<nL-1)tAcc+=hh/(p.vel*5);",
      "    }",
      "    if(pulseArr.length>=maxSP)p.notes.push('Showing '+maxSP+' of ~'+Math.round(totalEst)+' pulses');",
      "  }",
      "  /* Coarse segment array for scan path visualization only */",
      "  var vizSegs=[];",
      "  var MAX_VIZ_SEGS=5000;",
      "  var nL2=p.nLines||1;",
      "  var ptsPerLine=Math.ceil(p.lineL/p.dia);",
      "  /* Budget: distribute MAX_VIZ_SEGS across lines, skip lines if too many */",
      "  var lineStride=Math.max(1,Math.ceil(nL2*Math.min(ptsPerLine,200)/MAX_VIZ_SEGS));",
      "  var vizStep=Math.max(1,Math.ceil(ptsPerLine/Math.min(200,Math.floor(MAX_VIZ_SEGS/Math.ceil(nL2/lineStride)))));",
      "  for(var vli=0;vli<nL2&&vizSegs.length<MAX_VIZ_SEGS;vli+=lineStride){",
      "    var vly=vli*(p.hatch||0);",
      "    var vDir=1; /* raster is unidirectional */",
      "    var vx0=vDir===1?0:p.lineL;",
      "    var nVizPts=Math.ceil(ptsPerLine/vizStep);",
      "    for(var vsi=0;vsi<=nVizPts&&vizSegs.length<MAX_VIZ_SEGS;vsi++){",
      "      vizSegs.push({x:vx0+vDir*vsi*vizStep*p.dia,y:vly,a:vDir===1?0:Math.PI,v:p.vel});",
      "    }",
      "  }",
      "  /* Transfer TypedArrays for zero-copy performance */",
      "  var result={",
      "    g:{nx:eg.nx,ny:eg.ny,dx:eg.dx_mm,xn:eg.x_min_mm,yn:eg.y_min_mm},",
      "    flu:eg.fluence,pc:eg.pulse_count,ppH:eg.peak_pulse_H,lvt:eg.last_visit_t,mrv:eg.min_revisit_s,",
      "    st:{tt:s.total_time_s,tp:s.total_pulses||0,mv:s.min_velocity,stride:s.stride||1},",
      "    sf:{safe:sf.safe,wr:sf.worst_ratio,wx:sf.worst_x_mm,wy:sf.worst_y_mm,",
      "      br:sf.binding_rule,sm:sf.safety_margin,mt:sf.mpe_tau,mT:sf.mpe_T,",
      "      pF:sf.peak_fluence,ppM:sf.peak_pulse_H_max,mP:sf.max_pulses,",
      "      r1m:sf.rule1_max_ratio,r2m:sf.rule2_max_ratio,",
      "      minRv:sf.min_revisit_s,rvPts:sf.revisit_points,tauR:sf.thermal_relax_s,rvOk:sf.revisit_adequate,",
      "      anPeak:sf.analytical_peak,anUsed:sf.analytical_used},",
      "    maxP:maxP,minVel:minVel,pulseArr:pulseArr,segs:vizSegs,notes:p.notes};",
      "  self.postMessage(result,[eg.fluence.buffer,eg.pulse_count.buffer,eg.peak_pulse_H.buffer,eg.last_visit_t.buffer,eg.min_revisit_s.buffer]);",
      "};"
    ].join("\n");
    try{
      var blob=new Blob([workerCode],{type:"application/javascript"});
      _workerRef.current=new Worker(URL.createObjectURL(blob));
    }catch(err){
      if(typeof console!=="undefined")console.warn("Web Worker creation failed:",err);
      _workerRef.current=null;
    }
    return _workerRef.current;
  }

  var SCAN_WORKER_TIMEOUT_MS = 60000; // 60-second safety timeout
  var _workerTimeout = useRef(null);

  // Clean up Worker and timeout when ScanTab unmounts (e.g., standard change via key={stdVer})
  useEffect(function(){
    return function(){
      if(_workerRef.current){_workerRef.current.terminate();_workerRef.current=null;}
      if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
    };
  },[]);

  function calculate(){
    // ── Input validation (safety-critical) ──
    if(!isFinite(wl)||wl<180||wl>1e6){alert("Wavelength must be 180–1,000,000 nm");return;}
    if(!isFinite(dia)||dia<=0){alert("Beam diameter must be > 0");return;}
    if(!isFinite(pw)||pw<=0){alert(pwMode==="energy"?"Pulse energy must be > 0 (and PRF must be > 0 to compute average power)":"Average power must be > 0");return;}
    if(laserMode==="pulsed"){
      if(!isFinite(prf)||prf<0){alert("Repetition rate must be ≥ 0");return;}
      if(!isFinite(tau)||tau<=0){alert("Pulse duration must be > 0");return;}
    }
    // Scan area
    if(!isFinite(lineL)||lineL<=0){alert(pat!=="linear"?"Scan width must be > 0":"Scan length must be > 0");return;}
    if(pat!=="linear"){
      if(!isFinite(scanHN)||scanHN<=0){alert("Scan height must be > 0");return;}
      if(!isFinite(nLines)||nLines<1){alert("Number of scan lines must be ≥ 1");return;}
    }
    // Effective scan parameters (nLines and hatch are kept in sync via useEffect)
    var effNLines=pat!=="linear"?Math.max(1,nLines):1;
    var effHatch=pat!=="linear"&&nLines>1?scanHN/(nLines-1):scanHN;
    // Effective scan velocity from selected input mode
    var effVel;
    if(velMode==="ascans"){
      if(!isFinite(nA)||nA<=0){alert("A-scans per B-scan must be > 0");return;}
      if(prf<=0||lineL<=0){alert("A-scan rate and B-scan width must be > 0");return;}
      effVel=lineL*prf/nA;
      if(!isFinite(effVel)||effVel<=0){alert("Invalid A-scan rate or B-scan width");return;}
    }else if(velMode==="velocity"){
      if(!isFinite(vel)||vel<=0){alert("Scan velocity must be > 0");return;}
      effVel=vel;
    }else if(velMode==="dwell"){
      if(!isFinite(dwellN)||dwellN<=0){alert("Dwell time must be > 0");return;}
      effVel=dia/(dwellN*1e-6);
      if(!isFinite(effVel)||effVel<=0){alert("Invalid dwell time — check beam diameter");return;}
    }else if(velMode==="scanrate"){
      if(!isFinite(srateN)||srateN<=0){alert("Line scan rate must be > 0");return;}
      effVel=srateN*lineL;
      if(!isFinite(effVel)||effVel<=0){alert("Invalid line scan rate or scan width");return;}
    }else{
      if(!isFinite(frateN)||frateN<=0){alert("Frame rate must be > 0");return;}
      effVel=lineL*(pat==="linear"?1:nLines)*frateN;
      if(!isFinite(effVel)||effVel<=0){alert("Invalid frame rate or scan parameters");return;}
    }
    setCmp(true);setDirty(false);setPerfNote("");

    // ── Custom-path LSP: bypass parametric segment-building and use the
    //    LSP's engine segments directly via main-thread computation.
    //    Skipping the Worker keeps the implementation simple — the Worker's
    //    code template builds its own segments from pat/lineL/nLines, which
    //    is wrong for custom paths.  Custom-path LSPs typically have <50000
    //    segments (canonicalize.js caps at maxEngineSegments), well within
    //    main-thread performance.  See web/lsp/canonicalize.js mode 2/3.
    if (_lspCustomSegsRef.current) {
      var _customData = _lspCustomSegsRef.current;
      var _customNotes = [];
      if (_customData.hasBlankedSegments) {
        _customNotes.push("Custom path includes blanked (flyback) segments; these advance time but deposit no fluence");
      }
      _customNotes.push("Custom-path LSP: " + _customData.segments.length +
        " engine segments, main-thread computation");
      // Abandon any in-flight Worker from a previous (non-custom) Calculate.
      // We TERMINATE rather than just detach handlers, because the worker may
      // have a message queued or in-flight whose result would otherwise be
      // received by the next preset Calculate's reassigned onmessage handler
      // (the worker queues messages and processes them in order, posting
      // replies to whatever main-thread handler is currently installed).
      // The next preset Calculate creates a fresh worker via getWorker(),
      // costing ~50 ms one time per "custom → preset" transition.
      if (_workerRef.current) {
        try { _workerRef.current.terminate(); } catch (_) {}
        _workerRef.current = null;
      }
      if (_workerTimeout.current) {
        clearTimeout(_workerTimeout.current);
        _workerTimeout.current = null;
      }
      setTimeout(function(){
        // Race-condition guard: the user may have clicked Eject during the
        // 60 ms timeout (the Calculate button sits outside the lspLocked
        // fieldset and so is enabled even while LSP is loaded).  If the ref
        // has been cleared or replaced, abort: the post-Eject state no
        // longer matches the captured custom segments, and proceeding would
        // mix data from two different scan configurations.
        if (_lspCustomSegsRef.current !== _customData) {
          setCmp(false);
          return;
        }
        calculateMainThread(_customData.segments, 8, 3, 0, _customNotes);
      }, 60);
      return;
    }

    // ── Performance estimation ──
    // For separable-eligible scans, compute estimates from params directly
    // (avoids OOM from segment construction for micro-beams)
    var calcPrf=laserMode==="cw"?0:prf;
    var calcTau=laserMode==="cw"?0:tau;
    var isCWEst=laserMode==="cw";
    /* OCT: effective avg power = entered avg power × sweep duty cycle (default dc=1.0).
       Duty cycle is ignored in CW mode because CW lasers emit continuously. */
    var dcEff=isCWEst?1.0:(isFinite(dc)&&dc>0&&dc<=1?dc:1.0);
    var pwEff=pw*dcEff;
    var canSep=((!isCWEst&&calcPrf>0)||(isCWEst&&pwEff>0))&&(pat==="linear"||pat==="raster"||pat==="bidi");
    var segsEst=canSep?[]:null;
    var estTime,estPulses;
    if(canSep){
      var lineDurEst=lineL/effVel;
      var nLEst=pat==="linear"?1:effNLines;
      var jumpVEst=effVel*5;
      var hatchEst=pat==="linear"?0:(effHatch||dia);
      var flybackEst=pat==="linear"?0:(pat==="bidi"?(hatchEst/jumpVEst):(lineL/jumpVEst+hatchEst/jumpVEst));
      estTime=nLEst*lineDurEst+(nLEst-1)*flybackEst;
      estPulses=calcPrf*nLEst*lineDurEst;
    }else{
      /* Non-separable (CW): guard against huge nLines — use analytical estimation if >10000 lines */
      if(effNLines>10000){
        var lineDurEst2=lineL/effVel;
        var jumpVEst2=effVel*5;
        var hatchEst2=pat==="linear"?0:(effHatch||dia);
        var flybackEst2=pat==="linear"?0:(pat==="bidi"?(hatchEst2/jumpVEst2):(lineL/jumpVEst2+hatchEst2/jumpVEst2));
        estTime=effNLines*lineDurEst2+(effNLines-1)*flybackEst2;
        estPulses=0; /* CW — no discrete pulses */
        segsEst=[];
      }else{
        if(pat==="linear") segsEst=scanBuildLinear(0,0,0,lineL,effVel,dia);
        else segsEst=scanBuildRaster(0,0,lineL,effNLines,effHatch,effVel,effVel*5,dia,blk);
        estTime=0;for(var ei=0;ei<segsEst.length;ei++)estTime+=dia/segsEst[ei].v;
        estPulses=calcPrf*estTime;
      }
    }
    var sigma=dia/(2*Math.sqrt(2)),estDx=dia/ppd;
    var trunc=Math.ceil(3*sigma/estDx);
    var estOps=canSep?0:estPulses*Math.PI*trunc*trunc; // separable path doesn't scale with ops
    var effPpd=ppd,notes=[];
    if(!canSep&&estOps>_E.OP_BUDGET&&ppd>3){
      for(effPpd=ppd-1;effPpd>=3;effPpd--){
        var dx2=dia/effPpd,tr2=Math.ceil(3*sigma/dx2);
        if(estPulses*Math.PI*tr2*tr2<_E.OP_BUDGET)break;
      }
      effPpd=Math.max(3,effPpd);
      notes.push("Grid auto-reduced to "+effPpd+" pts/dia for "+Math.round(estPulses/1000)+"k pulses");
    }
    /* separable engine note removed — implementation detail not shown to user */
    else if(estPulses>_E.DEFAULT_MAX_COMPUTE_PULSES){
      var estStride=Math.ceil(estPulses/_E.DEFAULT_MAX_COMPUTE_PULSES);
      notes.push("Pulse subsampling active (stride="+estStride+"): computing 1 in every "+estStride+" pulses for "+Math.round(estPulses/1000)+"k total");
    }
    var auxPpd=Math.min(effPpd,3);
    var maxBisect=canSep?3:(estPulses>100000?6:estPulses>10000?8:15);

    // ── Try Web Worker (off main thread) ──
    var worker=getWorker();
    if(worker){
      var params={std:_std,wl:wl,dia:dia,tau:calcTau,prf:calcPrf,pw:pwEff,
        pat:pat,lineL:lineL,nLines:effNLines,hatch:effHatch,vel:effVel,dwm:dwm,blk:blk,
        effPpd:effPpd,auxPpd:auxPpd,maxBisect:maxBisect,notes:notes,estPulses:estPulses};
      // Safety timeout: kill Worker if it takes too long
      if(_workerTimeout.current)clearTimeout(_workerTimeout.current);
      _workerTimeout.current=setTimeout(function(){
        if(_workerRef.current){_workerRef.current.terminate();_workerRef.current=null;}
        setPerfNote("Computation timed out after 60 seconds. Try reducing line count, increasing hatch spacing, or lowering PRF.");
        setCmp(false);
      },SCAN_WORKER_TIMEOUT_MS);
      worker.onmessage=function(ev){
        if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
        var r=ev.data;
        if(r.error){if(typeof console!=="undefined")console.error("Worker error:",r.error);setCmp(false);return;}
        /* Reconstruct grid with transferred TypedArrays */
        var g={nx:r.g.nx,ny:r.g.ny,dx:r.g.dx,xn:r.g.xn,yn:r.g.yn,
          flu:r.flu,pc:r.pc,ppH:r.ppH,lvt:r.lvt,mrv:r.mrv};
        var isCW2=laserMode==="cw";
        var dcEff2=isCW2?1.0:(isFinite(dc)&&dc>0&&dc<=1?dc:1.0);
        var pwEff2=pw*dcEff2;
        var beam2={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:calcPrf>0?pwEff2/calcPrf:0,P:pwEff2,cw:isCW2};
        if(r.notes&&r.notes.length>0)setPerfNote(r.notes.join(". ")+".");
        /* OCT: scale cumulative quantities by BM-scan repetitions
           — peak fluence and pulse count scale linearly with N_BM,
             but the cumulative MPE must be recomputed at the new total exposure time
             because skinMPE(wl,t) has a t-dependent regime structure
             (e.g., t^0.25 in 100ns–10s, plateau above 10s). */
        var nBMm=Math.max(1,Math.round(nBM));
        var sfAdj=r.sf;
        var stAdj=Object.assign({},r.st,{tt:r.st.tt*nBMm});
        if(nBMm>1){
          var T_total_oct=r.st.tt*nBMm;
          var newMPE_T_oct=skinMPE(wl,T_total_oct);
          var newPF_oct=r.sf.pF*nBMm;
          sfAdj=Object.assign({},r.sf);
          sfAdj.pF=newPF_oct;
          sfAdj.mT=newMPE_T_oct;
          sfAdj.r2m=isFinite(newMPE_T_oct)&&newMPE_T_oct>0?(newPF_oct/newMPE_T_oct):Infinity;
          sfAdj.mP=r.sf.mP*nBMm;
          sfAdj.safe=Math.max(sfAdj.r1m,sfAdj.r2m)<=1;
          sfAdj.sm=1-Math.max(sfAdj.r1m,sfAdj.r2m);
          sfAdj.br=sfAdj.r1m>=sfAdj.r2m?"Rule 1":"Rule 2";
        }
        setRes({g:g,st:stAdj,sf:sfAdj,segs:r.segs,beam:beam2,maxP:r.maxP,minV:r.minVel,
          pulses:r.pulseArr,effPpd:effPpd,effNLines:effNLines,effHatch:effHatch,effVel:effVel,nBM:nBMm});
        setCmp(false);
      };
      worker.onerror=function(err){
        if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
        if(typeof console!=="undefined")console.error("Worker error:",err);
        /* Fall back to main-thread computation */
        calculateMainThread(segsEst,effPpd,auxPpd,maxBisect,notes);
      };
      worker.postMessage(params);
      return;
    }

    // ── Fallback: main-thread computation ──
    setTimeout(function(){calculateMainThread(segsEst,effPpd,auxPpd,maxBisect,notes);},60);
  }

  function calculateMainThread(segs,effPpd,auxPpd,maxBisect,notes){
    try{
      var calcPrf=laserMode==="cw"?0:prf;
      var calcTau=laserMode==="cw"?0:tau;
      var isCW=laserMode==="cw";
      /* OCT: effective avg power = entered avg power × sweep duty cycle.
         Duty cycle is ignored in CW mode (CW lasers emit continuously). */
      var dcEff=isCW?1.0:(isFinite(dc)&&dc>0&&dc<=1?dc:1.0);
      var pwEff=pw*dcEff;
      var Ep=calcPrf>0?pwEff/calcPrf:0;
      var beam={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:Ep,P:pwEff,cw:isCW};

      // Derive effective scan params (same logic as calculate())
      var effNLines=pat!=="linear"?Math.max(1,nLines):1;
      var effHatch=pat!=="linear"&&nLines>1?scanHN/(nLines-1):scanHN;
      var effVel=velMode==="dwell"?dia/(dwellN*1e-6):velMode==="scanrate"?srateN*lineL:velMode==="framerate"?lineL*(pat==="linear"?1:nLines)*frateN:vel;

      // Build separable params if applicable (same logic as Worker).
      // For custom-path LSPs, force canSep=false so we use the segment-array
      // path with the LSP's actual engine segments rather than building from
      // pat/lineL/nLines (which would describe a rectangular raster).
      var _isLspCustom = !!_lspCustomSegsRef.current;
      var canSep=!_isLspCustom && ((!isCW&&calcPrf>0)||(isCW&&pw>0))&&(pat==="linear"||pat==="raster"||pat==="bidi");
      function mkSepP(vv,ep,optP){
        if(!canSep)return null;
        return{d_1e_mm:dia,prf_hz:calcPrf,pulse_energy_J:ep||Ep,avg_power_W:optP!==undefined?optP:pw,v_scan_mm_s:vv,
          x0:0,y0:0,line_length_mm:lineL,n_lines:pat==="linear"?1:effNLines,
          hatch_mm:pat==="linear"?0:effHatch,pattern:pat,blanking:blk,is_cw:isCW,v_jump_mm_s:vv*5};
      }

      var cr=scanCompute(beam,canSep?[]:segs,effPpd,mkSepP(effVel));
      if(cr){
        var minV=isCW?(cr.st.mv||effVel):0;
        var sf=scanSafety(cr.g,beam,cr.st.tt,dwm,minV,{v_mm_s:effVel,line_spacing_mm:pat==="linear"?0:effHatch,n_lines:pat==="linear"?1:effNLines});
        var unitBeam={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:calcPrf>0?1/calcPrf:0,P:1,cw:isCW};
        var unitCr=scanCompute(unitBeam,canSep?[]:segs,auxPpd,mkSepP(effVel,calcPrf>0?1/calcPrf:0,1));
        var maxP=Infinity;
        if(unitCr){
          var upF=0;for(var ui=0;ui<unitCr.g.nx*unitCr.g.ny;ui++)if(unitCr.g.flu[ui]>upF)upF=unitCr.g.flu[ui];
          var mpeT=skinMPE(wl,unitCr.st.tt||cr.st.tt);
          if(upF>0)maxP=mpeT/upF;
          if(!isCW&&calcPrf>0){var w22=dia/Math.sqrt(2);var maxPr1=skinMPE(wl,calcTau)*calcPrf*Math.PI*w22*w22/(2*100);
            if(maxPr1<maxP)maxP=maxPr1;}
        }
        // Custom-path: no single velocity to scale uniformly (per-segment
        // velocities), so the "minimum safe velocity" question doesn't apply.
        // Use Infinity so display shows "—" rather than misleading "0 mm/s".
        var minVel=_isLspCustom?Infinity:0;
        if(!canSep&&effNLines<=10000&&!_isLspCustom){
          // Only run bisection on the main thread for brute-force paths
          // (separable scans use the Worker; if it fails, skip bisection to prevent UI freeze).
          // Custom-path LSPs are also skipped: each segment has its own velocity
          // (per-segment v_mm_s from the LSP), so a single "minimum safe velocity"
          // value isn't meaningful — scaling all segments uniformly to find a safe
          // velocity would silently misrepresent the user's intended scan pattern.
          function testV(tv){
            var ts;
            if(pat==="linear")ts=scanBuildLinear(0,0,0,lineL,tv,dia);
            else ts=scanBuildRaster(0,0,lineL,effNLines,effHatch,tv,tv*5,dia,blk);
            var tb={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:Ep,P:pwEff,cw:isCW};
            var tcr2=scanCompute(tb,ts,auxPpd);
            if(!tcr2)return true;
            var tmv=isCW?(tcr2.st.mv||tv):0;
            var tsf2=scanSafety(tcr2.g,tb,tcr2.st.tt,dwm,tmv,{v_mm_s:tv,line_spacing_mm:pat==="linear"?0:effHatch,n_lines:pat==="linear"?1:effNLines});
            return tsf2.safe;
          }
          if(testV(1e6)){var vLo=0.01,vHi=1e6;
            for(var bi=0;bi<maxBisect&&(vHi-vLo)/vLo>0.01;bi++){var vMid=(vLo+vHi)/2;if(testV(vMid))vHi=vMid;else vLo=vMid;}
            minVel=vHi;}else{minVel=Infinity;}
        }

        // Generate pulse positions and viz segments.
        // For preset patterns: derive from pat/lineL/nLines/hatch (parametric).
        // For custom-path LSPs: derive from the LSP's actual engine segments
        // (sub-sampled for performance) so the visualization shows the real
        // scan trajectory rather than a fictitious raster.
        var pulseArr=[];
        var vizSegs2=[];
        var MAX_VIZ2=5000;
        if (_isLspCustom) {
          // Custom path: stride-sample the LSP segments for viz.  Each segment
          // already has {x_start_mm, y_start_mm, angle_rad, v_mm_s} so we add
          // short-name aliases (x, y, a, v) inline to match the renderer's
          // expectations without mutating the LSP-owned array.
          var _customSegs = _lspCustomSegsRef.current.segments;
          var _cStride = Math.max(1, Math.ceil(_customSegs.length / MAX_VIZ2));
          for (var _ci = 0; _ci < _customSegs.length && vizSegs2.length < MAX_VIZ2; _ci += _cStride) {
            var _cs = _customSegs[_ci];
            if (_cs && !_cs.blanked) {
              vizSegs2.push({
                x: _cs.x_start_mm, y: _cs.y_start_mm,
                a: _cs.angle_rad, v: _cs.v_mm_s
              });
            }
          }
          // Pulse positions: for custom paths we don't generate a per-pulse
          // array (the timing diagram assumes a regular raster lattice).  The
          // worst-case point overlay still works because it reads from the
          // grid, not the pulse array.
        } else if(!isCW&&calcPrf>0){
          var maxSP2=5000,ps_mm2=effVel/calcPrf;
          var nPL2=Math.max(1,Math.floor((lineL/effVel)*calcPrf));
          var nLV=pat==="linear"?1:effNLines;
          var totalEst2=nPL2*nLV;
          var pStride2=Math.max(1,Math.ceil(totalEst2/maxSP2));
          var tAcc2=0;
          for(var li2=0;li2<nLV&&pulseArr.length<maxSP2;li2++){
            var ly2=li2*(pat==="linear"?0:effHatch);
            for(var ki2=0;ki2<nPL2&&pulseArr.length<maxSP2;ki2+=pStride2){
              pulseArr.push({t:tAcc2+ki2/calcPrf,x:ki2*ps_mm2,y:ly2,si:li2});
            }
            tAcc2+=lineL/effVel;if(li2<nLV-1)tAcc2+=(pat==="linear"?0:effHatch)/(effVel*5);
          }
        }
        // Capped viz segments (parametric path; custom path filled above)
        if (!_isLspCustom) {
          var nLV2=pat==="linear"?1:effNLines;
          var ppl2=Math.ceil(lineL/dia);
          var lStr2=Math.max(1,Math.ceil(nLV2*Math.min(ppl2,200)/MAX_VIZ2));
          var vStp2=Math.max(1,Math.ceil(ppl2/Math.min(200,Math.floor(MAX_VIZ2/Math.ceil(nLV2/lStr2)))));
          for(var vl2=0;vl2<nLV2&&vizSegs2.length<MAX_VIZ2;vl2+=lStr2){
            var vly2=vl2*(pat==="linear"?0:effHatch);
            var nVP2=Math.ceil(ppl2/vStp2);
            for(var vs2=0;vs2<=nVP2&&vizSegs2.length<MAX_VIZ2;vs2++){
              vizSegs2.push({x:vs2*vStp2*dia,y:vly2,a:0,v:effVel});
            }
          }
        }

        if(notes.length>0)setPerfNote(notes.join(". ")+".");
        /* OCT: scale cumulative quantities by BM-scan repetitions
           (see worker-callback variant for the MPE-recomputation rationale) */
        var nBMm2=Math.max(1,Math.round(nBM));
        var sfMt=sf;
        var stMt=Object.assign({},cr.st,{tt:cr.st.tt*nBMm2});
        if(nBMm2>1){
          var T_total_oct2=cr.st.tt*nBMm2;
          var newMPE_T_oct2=skinMPE(wl,T_total_oct2);
          var newPF_oct2=sf.pF*nBMm2;
          sfMt=Object.assign({},sf);
          sfMt.pF=newPF_oct2;
          sfMt.mT=newMPE_T_oct2;
          sfMt.r2m=isFinite(newMPE_T_oct2)&&newMPE_T_oct2>0?(newPF_oct2/newMPE_T_oct2):Infinity;
          sfMt.mP=sf.mP*nBMm2;
          sfMt.safe=Math.max(sfMt.r1m,sfMt.r2m)<=1;
          sfMt.sm=1-Math.max(sfMt.r1m,sfMt.r2m);
          sfMt.br=sfMt.r1m>=sfMt.r2m?"Rule 1":"Rule 2";
        }
        setRes({g:cr.g,st:stMt,sf:sfMt,segs:vizSegs2,beam:beam,maxP:maxP,minV:minVel,
          pulses:pulseArr,effPpd:effPpd,effNLines:effNLines,effHatch:effHatch,effVel:effVel,nBM:nBMm2});
      }
    }catch(err){if(typeof console!=="undefined")console.error("Calculation error:",err);}
    setCmp(false);
  }

  /* ── ECharts theme config (Paul Tol High-Contrast) ── */
  var ec=useMemo(function(){
    var dk=theme==="dark";
    return {
      bg:dk?"#14171A":"#FAFAFA",
      panel:dk?"#1E1E1E":"#FFFFFF",
      grid:dk?"#2E2E2E":"#E8E8E8",
      spine:dk?"#AAAAAA":"#444444",
      tick:dk?"#9CA3AF":"#555555",
      title:dk?"#E0E0E0":"#222222",
      stem:dk?"#6CB3FF":"#004488",
      stemShaft:dk?"rgba(187,187,187,0.55)":"rgba(136,136,136,0.55)",
      cumLine:dk?"#EE99AA":"#BB5566",
      mpe:dk?"#DDAA33":"#DDAA33",
      sub:dk?"#888888":"#777777",
      navBg:dk?"#252525":"#F0F0F0",
      navWin:dk?"rgba(108,179,255,0.12)":"rgba(0,68,136,0.08)",
      navBorder:dk?"rgba(108,179,255,0.4)":"rgba(0,68,136,0.35)"
    };
  },[theme]);

  var ptTimRef=useRef(null);
  var _chartRef=useRef(null);

  /* Reset selPt when new results arrive */
  useEffect(function(){setSelPt(null);},[res]);

  /* ── Dispose ECharts instance on unmount ── */
  useEffect(function(){
    return function(){
      if(_chartRef.current){_chartRef.current.dispose();_chartRef.current=null;}
    };
  },[]);

  /* ── Point Timing Diagram: pulse arrivals + cumulative fluence at a point ── */
  useEffect(function(){
    if(!res||!ptTimRef.current||typeof echarts==="undefined")return;
    if(prf<=0||pw<=0)return;
    /* Custom-path LSPs don't form a regular raster, so the parametric pulse
       arrival math below (which iterates over lines and pulse spacings)
       doesn't apply.  The JSX renders a placeholder card instead.          */
    if(_lspCustomSegsRef.current)return;

    var w=dia/Math.sqrt(2),sigma=dia/(2*Math.sqrt(2)),w2=w*w;
    /* OCT: per-sweep energy uses duty-cycle-corrected average power.
       In CW mode the timing diagram should not appear (no discrete pulses), but
       defensively short-circuit dcSafe to 1.0 if somehow reached. */
    var dcSafe=(laserMode==="cw")?1.0:(isFinite(dc)&&dc>0&&dc<=1?dc:1.0);
    var Ep=(pw*dcSafe)/prf;
    var H0=2*Ep/(Math.PI*w2)*100; // J/cm\u00b2
    var ps=vel/prf; // pulse spacing mm
    var trunc=3*sigma;
    var trunc2=trunc*trunc;
    var nPL=Math.max(1,Math.floor((lineL/vel)*prf));
    var lineDur=lineL/vel;
    var nL=pat==="linear"?1:(res.effNLines||1);
    var hh=pat==="linear"?0:(res.effHatch||hatch);
    var jumpV=vel*5;
    var flybackTime=(pat==="linear"||nL<=1)?0:(lineL/jumpV+hh/jumpV);

    // Determine observation point
    var obsX,obsY;
    if(selPt){obsX=selPt.x;obsY=selPt.y;}
    else{
      var g=res.g,maxF=0,maxIdx=0;
      for(var gi=0;gi<g.nx*g.ny;gi++){if(g.flu[gi]>maxF){maxF=g.flu[gi];maxIdx=gi;}}
      var giy=Math.floor(maxIdx/g.nx),gix=maxIdx-giy*g.nx;
      obsX=g.xn+gix*g.dx;obsY=g.yn+giy*g.dx;
    }

    // Collect pulse contributions at the observation point
    var events=[];
    var tLineStart=0;
    for(var li=0;li<nL;li++){
      var yLine=li*hh;
      var dy=obsY-yLine;
      var dy2=dy*dy;
      if(dy2>trunc2){tLineStart+=lineDur+(li<nL-1?flybackTime:0);continue;}
      var crossAtt=Math.exp(-2*dy2/w2);
      var scanDir=1;
      var xStart=scanDir===1?0:lineL;
      var kCenter=(obsX-xStart)/(scanDir*ps);
      var kRange=trunc/ps;
      var kMin=Math.max(0,Math.ceil(kCenter-kRange));
      var kMax=Math.min(nPL-1,Math.floor(kCenter+kRange));
      for(var k=kMin;k<=kMax;k++){
        var xPulse=xStart+scanDir*k*ps;
        var dx=obsX-xPulse;
        var dx2=dx*dx;
        if(dx2>trunc2)continue;
        var alongAtt=Math.exp(-2*dx2/w2);
        var Hdep=H0*alongAtt*crossAtt;
        if(Hdep<H0*1e-6)continue;
        var tPulse=tLineStart+k/prf;
        events.push({t:tPulse,H:Hdep});
      }
      tLineStart+=lineDur+(li<nL-1?flybackTime:0);
    }

    events.sort(function(a,b){return a.t-b.t;});
    var totalTime=res.st.tt;
    var mpeVal=skinMPE(wl,totalTime);

    // Build cumulative step data and impulse data
    var cumData=[];
    var impulseData=[];
    var cumH=0;
    cumData.push([0,0]);
    for(var ei=0;ei<events.length;ei++){
      var ev=events[ei];
      cumData.push([ev.t,cumH]);
      cumH+=ev.H;
      cumData.push([ev.t,cumH]);
      impulseData.push([ev.t,ev.H]);
    }
    cumData.push([totalTime,cumH]);

    // Scale time for readability
    var tScale=1,tUnit="s";
    if(totalTime<0.01){tScale=1e6;tUnit="\u00b5s";}
    else if(totalTime<10){tScale=1e3;tUnit="ms";}

    var cumScaled=cumData.map(function(p){return [p[0]*tScale,p[1]];});
    var impulseScaled=impulseData.map(function(p){return [p[0]*tScale,p[1]];});

    var safetyRatio=cumH/mpeVal;

    // ── ECharts rendering ──
    if(_chartRef.current){_chartRef.current.dispose();_chartRef.current=null;}
    var chart=echarts.init(ptTimRef.current,null,{renderer:"canvas"});
    _chartRef.current=chart;

    var fontFamily="'IBM Plex Sans', system-ui, -apple-system, sans-serif";

    var option={
      backgroundColor:"transparent",
      animation:false,
      textStyle:{fontFamily:fontFamily},

      /* Panel labels: (a) and (b) per COMSOL/Optica convention */
      title:[
        {text:"(a) Per-pulse fluence",left:68,top:4,
         textStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:600,color:ec.title}},
        {text:"(b) Cumulative fluence",left:68,top:"39%",
         textStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:600,color:ec.title}}
      ],

      /* Two stacked grids with room for panel labels and legends */
      grid:[
        {left:68,right:20,top:24,height:"22%"},
        {left:68,right:20,top:"48%",height:"38%"}
      ],

      xAxis:[
        {type:"value",gridIndex:0,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{show:false},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         min:0,max:totalTime*tScale},
        {type:"value",gridIndex:1,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{show:true,fontFamily:fontFamily,fontSize:10,color:ec.tick,
           formatter:function(v){return v%1===0?String(v):v.toFixed(1);}},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         name:"Time ("+tUnit+")",nameLocation:"middle",nameGap:28,
         nameTextStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:500,color:ec.title},
         min:0,max:totalTime*tScale}
      ],

      yAxis:[
        {type:"value",gridIndex:0,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{fontFamily:fontFamily,fontSize:10,color:ec.tick,
           formatter:function(v){return v<0.001&&v>0?v.toExponential(1):numFmt(v,2);}},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         name:"Fluence (J/cm\u00b2)",nameLocation:"middle",nameGap:52,
         nameTextStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:500,color:ec.title},
         min:0},
        {type:"value",gridIndex:1,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{fontFamily:fontFamily,fontSize:10,color:ec.tick,
           formatter:function(v){return v<0.001&&v>0?v.toExponential(1):numFmt(v,3);}},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         name:"Fluence (J/cm\u00b2)",nameLocation:"middle",nameGap:52,
         nameTextStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:500,color:ec.title},
         min:0}
      ],

      toolbox:{show:false},

      /* Per-panel legends — each panel gets its own legend inside the plot area (COMSOL/MATLAB convention) */
      legend:[
        {data:["Per-pulse fluence"],
         top:24,right:28,orient:"vertical",
         itemWidth:20,itemHeight:3,
         icon:"roundRect",
         textStyle:{fontFamily:fontFamily,fontSize:10,color:ec.tick},
         backgroundColor:"rgba(255,255,255,0.88)",
         borderColor:ec.grid,borderWidth:1,
         padding:[4,8]},
        {data:["Cumulative fluence","MPE limit"],
         top:"48%",right:28,orient:"vertical",
         itemWidth:20,itemHeight:3,itemGap:8,
         textStyle:{fontFamily:fontFamily,fontSize:10,color:ec.tick},
         backgroundColor:"rgba(255,255,255,0.88)",
         borderColor:ec.grid,borderWidth:1,
         padding:[4,8]}
      ],

      /* Linked axis pointers across panels — COMSOL/MATLAB synchronized cursor convention */
      axisPointer:{link:[{xAxisIndex:"all"}]},

      tooltip:{
        trigger:"axis",
        axisPointer:{type:"line",lineStyle:{color:ec.spine,width:1,type:"dashed"}},
        textStyle:{fontFamily:fontFamily,fontSize:11},
        formatter:function(params){
          if(!params||!params.length)return "";
          var t=params[0].value[0];
          var out=["<b>t = "+numFmt(t,4)+" "+tUnit+"</b>"];
          for(var pi=0;pi<params.length;pi++){
            var p=params[pi];
            if(p.seriesName==="MPE limit")continue;
            out.push(p.marker+" "+p.seriesName+": "+numFmt(p.value[1],4)+" J/cm\u00b2");
          }
          return out.join("<br>");
        }
      },

      series:[
        {name:"Per-pulse fluence",type:"bar",xAxisIndex:0,yAxisIndex:0,
         data:impulseScaled,
         barWidth:Math.max(1,Math.min(3,400/Math.max(1,impulseScaled.length))),
         itemStyle:{color:ec.stem},
         emphasis:{itemStyle:{color:ec.stem}},
         large:true,largeThreshold:500},

        {name:"Cumulative fluence",type:"line",xAxisIndex:1,yAxisIndex:1,
         data:cumScaled,
         step:false,
         lineStyle:{color:ec.cumLine,width:2,type:"solid"},
         areaStyle:{color:ec.cumLine,opacity:0.04},
         symbol:"none",
         emphasis:{disabled:true}},

        {name:"MPE limit",type:"line",xAxisIndex:1,yAxisIndex:1,
         data:[[0,mpeVal],[totalTime*tScale,mpeVal]],
         lineStyle:{color:ec.mpe,width:1.5,type:"dashed"},
         symbol:"none",
         emphasis:{disabled:true},
         /* Mark the MPE value with a label on the line */
         markPoint:{
           symbol:"rect",symbolSize:[1,1],
           label:{show:true,position:"insideRight",
             formatter:function(){return "MPE = "+numFmt(mpeVal,4)+" J/cm\u00b2";},
             fontFamily:fontFamily,fontSize:9,fontWeight:600,color:ec.mpe,
             backgroundColor:"rgba(255,255,255,0.88)",
             borderColor:ec.mpe,borderWidth:0.5,borderRadius:4,
             padding:[2,6]},
           data:[{coord:[totalTime*tScale*0.02,mpeVal]}]
         }}
      ]
    };

    chart.setOption(option);

    var onResize=function(){chart.resize();};
    window.addEventListener("resize",onResize);

    return function(){
      window.removeEventListener("resize",onResize);
    };
  },[res,ec,dia,wl,pw,dc,prf,vel,lineL,pat,hatch,scanHN,selPt]);

  /* ── Scan pattern visualization: pre-computed values ──────────── */
  /* Engineering notation for dimension labels */
  function svFmtDim(val){
    if(!isFinite(val)||val===0)return "0 mm";
    var av=Math.abs(val);
    if(av>=1e6)return (val/1e6).toPrecision(4)+" km";
    if(av>=1e3)return (val/1e3).toPrecision(4)+" m";
    if(av>=0.1)return +val.toPrecision(4)+" mm";
    if(av>=1e-4)return (val*1e3).toPrecision(4)+" \u00b5m";
    if(av>=1e-7)return (val*1e6).toPrecision(4)+" nm";
    return val.toExponential(2)+" mm";
  }
  /* Scan pattern visualization: pre-computed values */
  var _isLt=theme==="light";
  var vc={
    mark:_isLt?"#334155":"#94A3B8", jump:_isLt?"#94A3B8":"#64748B",
    dimAct:_isLt?"#64748B":"#94A3B8", dimDer:_isLt?"#94A3B8":"#64748B",
    canvas:_isLt?"#FAFBFC":"#1A1F27", canvasBd:_isLt?"rgba(15,23,42,0.08)":"rgba(255,255,255,0.08)",
    gridMin:_isLt?"#E8ECF0":"#252D38", gridMaj:_isLt?"#E0E4EA":"#2A3340",
    area:_isLt?"none":"none",
    areaBd:_isLt?"#CBD5E1":"#475569",
    lbl:_isLt?"#475569":"#94A3B8", legTx:_isLt?"#475569":"#94A3B8",
    lbl2:_isLt?"#334155":"#CBD5E1",
    corr:_isLt?0.04:0.06,
    hc:_isLt?"#64748B":"#94A3B8",
    axX:"#94A3B8", axY:"#94A3B8"
  };
  var svBtnBg=_isLt?"#F1F5F9":"#1E293B";
  var svBtnBd=_isLt?"#CBD5E1":"#475569";
  var svIc=_isLt?"#64748B":"#94A3B8";
  /* Fixed canvas — wider left padding for hatch callout */
  var svW_c=460,svH_c=260;
  var svPd_t=24,svPd_r=44,svPd_b=36,svPd_l=80;
  var svPlW=svW_c-svPd_l-svPd_r, svPlH=svH_c-svPd_t-svPd_b;
  /* Independent x/y scaling */
  var svPatW=Math.max(lineL,0.001);
  // For custom-path LSPs, ALWAYS use the actual bbox height — regardless of
  // the user's pre-import `pat` value (which is preserved under the disabled
  // UI and may still be "linear" even though the imported path is 2D).  The
  // parametric-pattern branch keeps its existing logic: "linear" gets a 35%
  // aspect ratio (since scanHN is irrelevant for a single-line scan), other
  // patterns use scanHN.
  var svPatH=_lspCustomSegsRef.current
    ? Math.max(scanHN||1,0.001)
    : (pat==="linear"?Math.max(svPatW*0.35,Math.max(dia,0.001)*4):Math.max(scanHN||1,0.001));
  var svScX=(svPlW*0.85)/svPatW;
  var svScY=(svPlH*0.85)/svPatH;
  var svOx=svPd_l+(svPlW-svPatW*svScX)/2;
  var svOy=svPd_t+(svPlH-svPatH*svScY)/2;
  var svRW=svPatW*svScX, svRH=svPatH*svScY;
  var svBSc=Math.min(svScX,svScY);
  var svBeamR=Math.max((dia/Math.sqrt(2))*svBSc,1.5);
  svBeamR=Math.min(svBeamR,Math.min(svRW,svRH)/2);
  /* Fix 1: beam suppression when beam >> scan area */
  var svBeamOwl=dia>Math.max(lineL,scanHN||0)*2;
  var svRenderBeam=svBeam&&!svBeamOwl;
  /* Fix 2: line decimation */
  var svHtVis=(nLines>1&&scanHN>0)?scanHN/(nLines-1):0;
  var svLinePx=svHtVis*svScY;
  var svTooMany=pat!=="linear"&&nLines>1&&svLinePx<4;
  var svDecIndices=null;
  if(svTooMany){
    var svMaxShow=12;
    var sdSet={};sdSet[0]=true;sdSet[nLines-1]=true;
    for(var sdi=1;sdi<svMaxShow-1;sdi++){sdSet[Math.round(sdi*(nLines-1)/(svMaxShow-1))]=true;}
    svDecIndices=[];for(var sdk in sdSet){if(sdSet.hasOwnProperty(sdk))svDecIndices.push(Number(sdk));}
    svDecIndices.sort(function(a,b){return a-b;});
  }
  var svDecCount=svDecIndices?svDecIndices.length:0;
  var svMarks=[],svJumps=[];
  /* Custom-path LSP: replace the parametric raster lines with the actual
     LSP segments, polyline-style.  For SHORT paths (≤800 segments) every
     segment renders as its own short line, giving a continuous path.  For
     LONG paths we stride-sample and connect consecutive sampled positions
     so the viz remains a continuous polyline (rather than sparse dots).
     Blanked segments end the current polyline so flybacks render as gaps.
     Segments were already translated to bbox origin in _lspApplyState, so
     the same svOx/svOy/svScX/svScY mapping as parametric paths applies.   */
  if (_lspCustomSegsRef.current) {
    var _customSegs_sv = _lspCustomSegsRef.current.segments;
    var _customD_sv = _lspCustomSegsRef.current.d_1e_mm || dia || 0.001;
    var _svMaxCustom = 800;  // cap polyline points so SVG stays responsive
    var _svCustomStride = Math.max(1, Math.ceil(_customSegs_sv.length / _svMaxCustom));
    // Helper: find the next non-blanked segment at or after index `from`,
    // stepping by `stride`.  Returns null if none.
    function _svNextVisible(arr, from, stride) {
      for (var j = from; j < arr.length; j += stride) {
        if (arr[j] && !arr[j].blanked) return { seg: arr[j], idx: j };
      }
      return null;
    }
    if (_svCustomStride === 1) {
      // Short path: render every segment as its own beam-diameter-long line.
      for (var _svci0 = 0; _svci0 < _customSegs_sv.length; _svci0++) {
        var _csg0 = _customSegs_sv[_svci0];
        if (!_csg0 || _csg0.blanked) continue;
        var _csx10 = _csg0.x_start_mm, _csy10 = _csg0.y_start_mm;
        var _csx20 = _csx10 + _customD_sv * Math.cos(_csg0.angle_rad || 0);
        var _csy20 = _csy10 + _customD_sv * Math.sin(_csg0.angle_rad || 0);
        svMarks.push({
          x1: svOx + _csx10 * svScX, y1: svOy + _csy10 * svScY,
          x2: svOx + _csx20 * svScX, y2: svOy + _csy20 * svScY,
          idx: _svci0
        });
      }
    } else {
      // Long path: connect consecutive sampled positions as a polyline.
      // A blanked segment between samples breaks the line (renders as a gap).
      var _curAnchor = _svNextVisible(_customSegs_sv, 0, _svCustomStride);
      while (_curAnchor) {
        var _nextAnchor = _svNextVisible(_customSegs_sv, _curAnchor.idx + _svCustomStride, _svCustomStride);
        if (_nextAnchor) {
          // Detect a blanked-segment break in the interval (_curAnchor.idx, _nextAnchor.idx).
          var _hasBreak = false;
          for (var _bi = _curAnchor.idx + 1; _bi < _nextAnchor.idx; _bi++) {
            if (_customSegs_sv[_bi] && _customSegs_sv[_bi].blanked) { _hasBreak = true; break; }
          }
          if (!_hasBreak) {
            svMarks.push({
              x1: svOx + _curAnchor.seg.x_start_mm * svScX,
              y1: svOy + _curAnchor.seg.y_start_mm * svScY,
              x2: svOx + _nextAnchor.seg.x_start_mm * svScX,
              y2: svOy + _nextAnchor.seg.y_start_mm * svScY,
              idx: _curAnchor.idx
            });
          }
          // else: skip this mark; break in scan path renders as a gap.
          _curAnchor = _nextAnchor;
        } else {
          // Final anchor — render a beam-diameter-long stub to mark the end.
          var _endX = _curAnchor.seg.x_start_mm + _customD_sv * Math.cos(_curAnchor.seg.angle_rad || 0);
          var _endY = _curAnchor.seg.y_start_mm + _customD_sv * Math.sin(_curAnchor.seg.angle_rad || 0);
          svMarks.push({
            x1: svOx + _curAnchor.seg.x_start_mm * svScX,
            y1: svOy + _curAnchor.seg.y_start_mm * svScY,
            x2: svOx + _endX * svScX,
            y2: svOy + _endY * svScY,
            idx: _curAnchor.idx
          });
          _curAnchor = null;
        }
      }
    }
  } else if(pat==="linear"){
    svMarks.push({x1:svOx,y1:svOy+svRH/2,x2:svOx+svRW,y2:svOy+svRH/2,idx:0});
  }else if(svTooMany){
    /* Decimated: iterate only over the small set of indices (never over all nLines) */
    for(var svdi=0;svdi<svDecIndices.length;svdi++){
      var svIdx=svDecIndices[svdi];
      var svLy=svOy+svIdx*svHtVis*svScY;
      var svLtr=pat==="bidi"?(svIdx%2===0):true;
      svMarks.push({x1:svLtr?svOx:svOx+svRW,y1:svLy,x2:svLtr?svOx+svRW:svOx,y2:svLy,idx:svIdx});
    }
    for(var svmi=0;svmi<svMarks.length-1;svmi++){
      var svCur=svMarks[svmi],svNxt=svMarks[svmi+1];
      var svCurLtr=pat==="bidi"?(svCur.idx%2===0):true;
      var svCurEx=svCurLtr?svOx+svRW:svOx;
      if(pat==="bidi")svJumps.push({x1:svCurEx,y1:svCur.y1,x2:svCurEx,y2:svNxt.y1});
      else svJumps.push({x1:svOx+svRW,y1:svCur.y1,x2:svOx,y2:svNxt.y1});
    }
  }else{
    var svNVis=Math.min(nLines,200);
    for(var svi=0;svi<svNVis;svi++){
      var svLy2=svOy+svi*svHtVis*svScY;
      var svLtr2=pat==="bidi"?(svi%2===0):true;
      svMarks.push({x1:svLtr2?svOx:svOx+svRW,y1:svLy2,x2:svLtr2?svOx+svRW:svOx,y2:svLy2,idx:svi});
    }
    for(var svmi2=0;svmi2<svMarks.length-1;svmi2++){
      var svCur2=svMarks[svmi2],svNxt2=svMarks[svmi2+1];
      var svCurLtr2=pat==="bidi"?(svCur2.idx%2===0):true;
      var svCurEx2=svCurLtr2?svOx+svRW:svOx;
      if(pat==="bidi")svJumps.push({x1:svCurEx2,y1:svCur2.y1,x2:svCurEx2,y2:svNxt2.y1});
      else svJumps.push({x1:svOx+svRW,y1:svCur2.y1,x2:svOx,y2:svNxt2.y1});
    }
  }
  /* Hatch callout geometry — left margin */
  var svShowHC=pat!=="linear"&&nLines>1&&svHtVis>0;
  var svHcY1=svOy,svHcY2=svOy+svHtVis*svScY;
  var svHcGap=svHcY2-svHcY1;
  var svHcBX=svOx-12;
  var svHcInline=svHcGap>=8;
  var svHcInset=svHcGap<8;
  var svHcLabel=svFmtDim(svHtVis);
  /* Formatted dimension labels */
  var svWLabel=svFmtDim(lineL);
  var svHLabel=svFmtDim(scanHN);
  var svGridMinP="",svGridMajP="";
  if(svGrid){
    for(var sgx=0;sgx<=svW_c;sgx+=10){if(sgx%50===0)svGridMajP+="M"+sgx+",0V"+svH_c+" ";else svGridMinP+="M"+sgx+",0V"+svH_c+" ";}
    for(var sgy=0;sgy<=svH_c;sgy+=10){if(sgy%50===0)svGridMajP+="M0,"+sgy+"H"+svW_c+" ";else svGridMinP+="M0,"+sgy+"H"+svW_c+" ";}
  }
  /* SVG click → scan coordinate conversion */
  function svClickToScan(e){
    if(!svRef.current)return null;
    var rect=svRef.current.getBoundingClientRect();
    var sx=(e.clientX-rect.left)/rect.width*svW_c;
    var sy=(e.clientY-rect.top)/rect.height*svH_c;
    var scanX=(sx-svOx)/svScX;
    var scanY=(sy-svOy)/svScY;
    if(scanX<0||scanX>lineL||scanY<0||scanY>(scanHN||0))return null;
    return{x:Math.max(0,Math.min(lineL,scanX)),y:Math.max(0,Math.min(scanHN||0,scanY))};
  }
  function svHandleClick(e){
    var pt=svClickToScan(e);
    if(pt){setSelPt(pt);setSelXS(pt.x.toFixed(3));setSelYS(pt.y.toFixed(3));}
  }
  function svHandleMove(e){setSvHov(svClickToScan(e));}
  function svHandleLeave(){setSvHov(null);}
  function svCoordGo(){
    var x=parseFloat(selXS),y=parseFloat(selYS);
    if(isFinite(x)&&isFinite(y)&&x>=0&&x<=lineL&&y>=0&&y<=(scanHN||0)){
      setSelPt({x:x,y:y});
    }
  }
  /* Convert scan point to SVG pixel coordinates */
  function svPtToSvg(pt){return pt?{sx:svOx+pt.x*svScX,sy:svOy+pt.y*svScY}:null;}
  var svSelS=svPtToSvg(selPt);
  var svHovS=svPtToSvg(svHov);
  /* Tooltip positioning — avoid clipping edges */
  var svTipW=96,svTipH=18;
  function svTipPos(sx,sy){
    var tx=sx+12,ty=sy-22;
    if(tx+svTipW>svW_c-4)tx=sx-svTipW-12;
    if(ty<4)ty=sy+12;
    if(ty+svTipH>svH_c-4)ty=svH_c-svTipH-4;
    return{tx:tx,ty:ty};
  }

  return (<div style={{display:"flex",flexDirection:"column",gap:16}}>
    {/* ═══ Pattern Source (Sub-phase 1D commit 3) ═══ */}
    {/* LSP-JSON import card. When loaded, the controls below become read-only
        and display the LSP-derived values; Eject restores the previous state. */}
    <PatternSource T={T} lspState={lspState}
      onImport={_handleLspImport} onEject={_handleLspEject} />

    {/* ═══ Region 1: Configuration ═══ */}
    <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Scan Configuration</div>
    {/* ── Inputs: 2-column layout ──
        fieldset with disabled={lspLocked} natively propagates the disabled
        state to every <input>, <select>, <button>, and <textarea> inside.
        Borders/padding/margin/min-width:0 reset so the fieldset is
        layout-transparent. CSS opacity is conditional so the user sees
        the state change clearly. */}
    <fieldset disabled={lspLocked} style={{
      border:"none",padding:0,margin:0,minWidth:0,
      display:"grid",gridTemplateColumns:"0.43fr 1fr",gap:12,alignItems:"start",
      opacity:lspLocked?0.55:1,
      pointerEvents:lspLocked?"none":"auto"
    }}>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={secH}>OCT Source</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div>
            <label style={lb}>Preset</label>
            <select value={preset} onChange={function(e){
              var v=e.target.value; setPreset(v);
              /* "custom" is a passive label triggered by manual field edits;
                 selecting it from the dropdown should preserve current state, not reset. */
              if(v==="custom"){ setDirty(true); return; }
              if(v==="sd-840"){
                setWlS("840");setWl(840);setBwS("50");setBw(50);
                setTauS("11");setTau(11e-6);setTauU("us");
                setPrfS("70");setPrf(70000);setPrfU("kHz");
                setPwS("0.0018");setPw(0.0018);
                setDS("0.025");setDia(0.025);
                setDcS("1.0");setDc(1.0);
              } else if(v==="ss-1060"){
                setWlS("1060");setWl(1060);setBwS("100");setBw(100);
                setTauS("5");setTau(5e-6);setTauU("us");
                setPrfS("100");setPrf(100000);setPrfU("kHz");
                setPwS("0.0035");setPw(0.0035);
                setDS("0.020");setDia(0.020);
                setDcS("1.0");setDc(1.0);
              } else if(v==="ss-skin"){
                setWlS("1310");setWl(1310);setBwS("100");setBw(100);
                setTauS("6.5");setTau(6.5e-6);setTauU("us");
                setPrfS("100");setPrf(100000);setPrfU("kHz");
                setPwS("0.010");setPw(0.010);
                setDS("0.020");setDia(0.020);
                setDcS("1.0");setDc(1.0);
              }
              setDirty(true);
            }} style={{...ip,cursor:"pointer"}}>
              <option value="ss-skin">SS-OCT 1310 nm — skin / IV-OCT</option>
              <option value="ss-1060">SS-OCT 1060 nm — deep tissue</option>
              <option value="sd-840">SD-OCT 840 nm — surface</option>
              <option value="custom">Custom — user-edited</option>
            </select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            <div><label htmlFor="scan-wl" style={lb}>Center Wavelength (nm)</label><input id="scan-wl" type="text" value={wlS} onChange={function(e){upN(setWlS,setWl,e.target.value);setPreset("custom");}} style={ip}/></div>
            <div><label htmlFor="scan-bw" style={lb}>FWHM Bandwidth (nm)</label><input id="scan-bw" type="text" value={bwS} onChange={function(e){upN(setBwS,setBw,e.target.value);setPreset("custom");}} style={ip}/></div>
          </div>
          <div><label htmlFor="scan-dia" style={lb}>Beam 1/e² at Sample (mm)</label><input id="scan-dia" type="text" value={dS} onChange={function(e){upN(setDS,setDia,e.target.value);setPreset("custom");}} style={ip}/></div>
          <div>
            <label style={lb}>Laser Mode</label>
            <div style={{display:"inline-flex",background:T.hov||"rgba(15,23,42,0.04)",borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
              {[["pulsed","Pulsed"],["cw","CW"]].map(function(m){
                return <button key={m[0]} onClick={function(){
                  setLaserMode(m[0]);
                  if(m[0]==="cw")setPwMode("power");
                  setDirty(true);
                }} style={{flex:1,padding:"4px 10px",fontSize:12,fontWeight:laserMode===m[0]?500:400,
                  background:laserMode===m[0]?T.card:"transparent",
                  color:laserMode===m[0]?T.tx:T.tm,
                  border:"none",
                  borderBottom:laserMode===m[0]?"2px solid "+T.ac:"2px solid transparent",
                  cursor:"pointer"}}>{m[1]}</button>;
              })}
            </div>
          </div>
          {laserMode==="pulsed"?<div>
            <label style={lb}>Sweep Duration</label>
            <div style={{display:"flex",gap:4}}>
              <input type="text" value={tauS} onChange={function(e){upTau(e.target.value);setPreset("custom");}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
              <select value={tauU} onChange={function(e){setTauU(e.target.value);upTau(tauS)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
            </div>
          </div>:null}
          {laserMode==="pulsed"?<div>
            <label style={lb}>A-scan Rate</label>
            <div style={{display:"flex",gap:4}}>
              <input type="text" value={prfS} onChange={function(e){upPrf(e.target.value);setPreset("custom");}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
              <select value={prfU} onChange={function(e){setPrfU(e.target.value);upPrf(prfS)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{FREQ_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
            </div>
          </div>:null}
          <div>
            <label style={lb}>Power Input</label>
            <select value={pwMode} onChange={function(e){
              var m=e.target.value;setPwMode(m);setDirty(true);
              if(m==="energy"&&prf>0&&pw>0)setEpS((pw/prf).toExponential(4));
            }} disabled={laserMode==="cw"} style={{width:"100%",marginBottom:6,fontSize:11,padding:"5px 8px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:laserMode==="cw"?"default":"pointer",opacity:laserMode==="cw"?0.6:1,boxSizing:"border-box"}}>
              <option value="power">Sample-arm Power (W)</option>
              <option value="energy">Energy / Sweep (J)</option>
            </select>
            {pwMode==="power"?
              <div>
                <input id="scan-pw" type="text" value={pwS} onChange={function(e){upPw(e.target.value);setPreset("custom");}} style={ip}/>
                {laserMode==="pulsed"&&prf>0&&pw>0?(function(){
                  /* clamp dc for display: invalid or CW values display as 1.0 */
                  var dcD=(laserMode==="cw"||!isFinite(dc)||dc<=0||dc>1)?1.0:dc;
                  return <div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>{"Ep = "+((pw*dcD)/prf).toExponential(3)+" J/sweep"+(dcD<1?" (dc-corrected)":"")}</div>;
                })():null}
              </div>
            :
              <div>
                <input type="text" value={epS} onChange={function(e){upEp(e.target.value);setPreset("custom");}} placeholder="e.g. 50e-6" style={ip}/>
                {prf>0&&pw>0?<div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>{"P_avg = "+pw.toPrecision(3)+" W"}</div>:null}
              </div>
            }
          </div>
          <div>
            <label htmlFor="scan-dc" style={lb}>Sweep Duty Cycle (0-1)</label>
            <input id="scan-dc" type="text" value={dcS} onChange={function(e){upN(setDcS,setDc,e.target.value);setPreset("custom");}} style={ip}/>
            {(function(){
              /* clamp dc for display: invalid values display as 1.0; CW mode shows special note */
              var dcD=(laserMode==="cw"||!isFinite(dc)||dc<=0||dc>1)?1.0:dc;
              var note=laserMode==="cw"?"CW mode: duty cycle ignored (laser is continuous)":(dcD<1?"Effective avg power: "+(pw*dcD*1000).toPrecision(3)+" mW":"Time-averaged power as entered");
              return <div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>{note}</div>;
            })()}
          </div>
        </div>

          {/* Divider */}
          <div style={{borderTop:"1px solid "+T.bd,margin:"4px 0"}}/>
          {/* Dwell time + flyback (merged from Settings) */}
          <div>
            <label style={lb}>Dwell Time Definition</label>
            <div style={{display:"inline-flex",background:T.hov||"rgba(15,23,42,0.04)",borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
              {[["gaussian","Gaussian"],["geometric","Geometric"]].map(function(dm){
                return <button key={dm[0]} onClick={function(){setDwm(dm[0])}} style={{flex:1,padding:"4px 10px",fontSize:11,fontWeight:dwm===dm[0]?500:400,background:dwm===dm[0]?T.card:"transparent",color:dwm===dm[0]?T.tx:T.tm,border:"none",borderBottom:dwm===dm[0]?"2px solid "+T.ac:"2px solid transparent",cursor:"pointer"}}>{dm[1]}</button>;
              })}
            </div>
          </div>
          {pat!=="linear"?<div>
            <label style={{...lb,marginBottom:6}}>Galvo Flyback Blanking</label>
            <label style={{display:"flex",alignItems:"flex-start",gap:6,cursor:"pointer",fontSize:11,color:T.tx}}>
              <input type="checkbox" checked={blk} onChange={function(){setBlk(!blk);setDirty(true);}} style={{accentColor:T.ac,width:14,height:14,marginTop:2}}/>
              <span style={{lineHeight:1.3}}>{blk?"Laser blanked during flyback/jumps":"Laser fires during flyback (conservative)"}</span>
            </label>
            <div style={{fontSize:8,color:T.td,marginTop:2,marginLeft:20}}>OCT systems typically blank during galvo return</div>
          </div>:null}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden",padding:14}}>
        {/* Header: title + toggle toolbar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={secH}>Scan Pattern</div>
          <div style={{display:"flex",gap:2}}>
            <button onClick={function(){setSvGrid(!svGrid);}} title="Grid" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svGrid?svBtnBg:"transparent",border:svGrid?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svGrid?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.4" strokeLinecap="round"><line x1="5" y1="1" x2="5" y2="15"/><line x1="11" y1="1" x2="11" y2="15"/><line x1="1" y1="5" x2="15" y2="5"/><line x1="1" y1="11" x2="15" y2="11"/></svg></button>
            <button onClick={function(){setSvBeam(!svBeam);}} title="Beam spot" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svBeam?svBtnBg:"transparent",border:svBeam?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svBeam?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.3"><circle cx="8" cy="8" r="5" strokeDasharray="2.5 2"/><circle cx="8" cy="8" r="1.5" fill={svIc} stroke="none"/></svg></button>
            <button onClick={function(){setSvFlyback(!svFlyback);}} title="Flyback paths" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svFlyback?svBtnBg:"transparent",border:svFlyback?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svFlyback?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.3" strokeLinecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="12" x2="14" y2="12"/><path d="M14,4 C16,4 16,12 14,12" strokeDasharray="2 2" opacity="0.6"/></svg></button>
            <button onClick={function(){setSvAnts(!svAnts);}} title="Scan animation" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svAnts?svBtnBg:"transparent",border:svAnts?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svAnts?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="8" x2="12" y2="8" strokeDasharray="2.5 3"/><polygon points="11,5.5 15,8 11,10.5" fill={svIc} stroke="none" opacity="0.5"/></svg></button>
          </div>
        </div>
        {/* Pattern selector */}
        <div style={{display:"inline-flex",background:T.hov||"rgba(15,23,42,0.04)",borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden",marginBottom:8}}>
          {[["linear","Linear"],["raster","Raster"],["bidi","Bidirectional"]].map(function(pt){
            return <button key={pt[0]} onClick={function(){setPat(pt[0]);setDirty(true);}} style={{flex:1,padding:"5px 10px",fontSize:12,fontWeight:pat===pt[0]?500:400,background:pat===pt[0]?T.card:"transparent",color:pat===pt[0]?T.tx:T.tm,border:"none",borderBottom:pat===pt[0]?"2px solid "+T.ac:"2px solid transparent",borderRight:pt[0]!=="bidi"?"1px solid "+T.bd:"none",cursor:"pointer"}}>{pt[1]}</button>;
          })}
        </div>
        {/* SVG Visualization — all fixes */}
        <div style={{borderRadius:4,overflow:"hidden",border:"1px solid "+vc.canvasBd,marginBottom:10}}>
          <svg ref={svRef} viewBox={"0 0 "+svW_c+" "+svH_c} style={{width:"100%",height:"auto",display:"block",background:vc.canvas,cursor:pat!=="linear"?"crosshair":"default"}} xmlns="http://www.w3.org/2000/svg" shapeRendering="geometricPrecision" onClick={pat!=="linear"?svHandleClick:null} onMouseMove={pat!=="linear"?svHandleMove:null} onMouseLeave={pat!=="linear"?svHandleLeave:null}>
            <defs>
              <clipPath id="sv-clip"><rect x={svOx-2} y={svOy-2} width={svRW+4} height={svRH+4}/></clipPath>
              <marker id="sv-arr" markerWidth="8" markerHeight="5" refX="7.5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,2.5 L0,5 z" fill={vc.dimAct}/></marker>
              <marker id="sv-arr2" markerWidth="8" markerHeight="5" refX="0.5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M8,0 L0,2.5 L8,5 z" fill={vc.dimAct}/></marker>
              <marker id="sv-hc1" markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0.5 L4,2 L0,3.5 z" fill={vc.hc}/></marker>
              <marker id="sv-hc2" markerWidth="4" markerHeight="4" refX="0.5" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M4,0.5 L0,2 L4,3.5 z" fill={vc.hc}/></marker>
            </defs>
            {svGrid?<g><path d={svGridMinP} fill="none" stroke={vc.gridMin} strokeWidth="0.5" opacity="0.5"/><path d={svGridMajP} fill="none" stroke={vc.gridMaj} strokeWidth="0.5" opacity="0.6"/></g>:null}
            {svGrid?<g>
              <line x1={svOx-14} y1={svOy+svRH} x2={svOx+22} y2={svOy+svRH} stroke={vc.axX} strokeWidth="0.8" opacity="0.4"/>
              <line x1={svOx} y1={svOy+svRH+14} x2={svOx} y2={svOy+svRH-22} stroke={vc.axY} strokeWidth="0.8" opacity="0.4"/>
              <text x={svOx+24} y={svOy+svRH+3} fill={vc.axX} fontSize="7.5" fontFamily="'IBM Plex Mono', monospace" opacity="0.4" fontWeight="400">x</text>
              <text x={svOx+3} y={svOy+svRH-24} fill={vc.axY} fontSize="7.5" fontFamily="'IBM Plex Mono', monospace" opacity="0.4" fontWeight="400">y</text>
              <circle cx={svOx} cy={svOy+svRH} r="1.8" fill="none" stroke={vc.lbl} strokeWidth="0.6"/>
            </g>:null}
            <rect x={svOx} y={svOy} width={svRW} height={svRH} fill="none" stroke={vc.areaBd} strokeWidth="0.75"/>
            {svRenderBeam?<g clipPath="url(#sv-clip)">{svMarks.map(function(s,i){var dx=s.x2-s.x1,dy=s.y2-s.y1,len=Math.sqrt(dx*dx+dy*dy),ang=Math.atan2(dy,dx)*180/Math.PI;return <rect key={"c"+i} x={-len/2} y={-svBeamR} width={len} height={svBeamR*2} rx={svBeamR} transform={"translate("+((s.x1+s.x2)/2)+","+((s.y1+s.y2)/2)+") rotate("+ang+")"} fill={vc.mark} opacity={vc.corr}/>;})}</g>:null}
            {svFlyback?svJumps.map(function(s,i){var vert=Math.abs(s.x1-s.x2)<1;var d=vert?"M"+s.x1+","+s.y1+"L"+s.x2+","+s.y2:"M"+s.x1+","+s.y1+"C"+(s.x1+(s.x2>s.x1?25:-25))+","+s.y1+" "+(s.x2+(s.x1>s.x2?25:-25))+","+s.y2+" "+s.x2+","+s.y2;return <path key={"j"+i} d={d} fill="none" stroke={vc.jump} strokeWidth="0.6" strokeDasharray="4,2" opacity="0.5"/>;}):null}
            {svMarks.map(function(s,i){var dx=s.x2-s.x1,dy=s.y2-s.y1,mx=(s.x1+s.x2)/2,my=(s.y1+s.y2)/2,ang=Math.atan2(dy,dx)*180/Math.PI;return <g key={"m"+i}><line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={vc.mark} strokeWidth="1.0"/>{svAnts?<line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={vc.canvas} strokeWidth="1.0" strokeDasharray="3,7" strokeDashoffset={-antOff} opacity="0.45"/>:null}<polygon points="0,-2.5 5,0 0,2.5" fill={vc.mark} opacity="0.65" transform={"translate("+mx+","+my+") rotate("+ang+")"}/><circle cx={s.x1} cy={s.y1} r="1.4" fill={vc.mark} opacity="0.35"/></g>;})}
            {svRenderBeam&&svMarks.length>0?<g><circle cx={svMarks[0].x1} cy={svMarks[0].y1} r={svBeamR} fill="none" stroke={vc.mark} strokeWidth="0.75" strokeDasharray="2.5,2" opacity="0.3"/></g>:null}
            {/* Inline hatch callout — bracket in left margin */}
            {svShowHC&&svHcInline?<g>
              <line x1={svHcBX-5} y1={svHcY1} x2={svOx-4} y2={svHcY1} stroke={vc.hc} strokeWidth="0.4"/>
              <line x1={svHcBX-5} y1={svHcY2} x2={svOx-4} y2={svHcY2} stroke={vc.hc} strokeWidth="0.4"/>
              <line x1={svHcBX} y1={svHcY1} x2={svHcBX} y2={svHcY2} stroke={vc.hc} strokeWidth="0.5" markerStart="url(#sv-hc2)" markerEnd="url(#sv-hc1)"/>
              <text x={svHcBX-8} y={(svHcY1+svHcY2)/2-1} textAnchor="end" dominantBaseline="middle" fill={vc.hc} fontSize="9" fontFamily="'IBM Plex Mono', monospace" fontWeight="500">{"Δh"}</text>
              <text x={svHcBX-8} y={(svHcY1+svHcY2)/2+10} textAnchor="end" dominantBaseline="middle" fill={vc.hc} fontSize="8.5" fontFamily="'IBM Plex Mono', monospace" fontWeight="500">{svHcLabel}</text>
            </g>:null}
            {/* Inset hatch callout — for sub-pixel spacing */}
            {svShowHC&&svHcInset?<g>
              <rect x="3" y={svPd_t-2} width={svPd_l-8} height="62" rx="3" fill={_isLt?"white":"#2A2A30"} stroke={vc.hc} strokeWidth="0.8"/>
              <text x={(svPd_l-5)/2+3} y={svPd_t+11} textAnchor="middle" fill={vc.hc} fontSize="9" fontFamily="'IBM Plex Sans', system-ui, sans-serif" fontWeight="700" letterSpacing="0.04em">LINE SPACING</text>
              <line x1="10" y1={svPd_t+24} x2={svPd_l-22} y2={svPd_t+24} stroke={vc.mark} strokeWidth="1.0"/>
              <line x1="10" y1={svPd_t+44} x2={svPd_l-22} y2={svPd_t+44} stroke={vc.mark} strokeWidth="1.0"/>
              <line x1={svPd_l-16} y1={svPd_t+24} x2={svPd_l-16} y2={svPd_t+44} stroke={vc.hc} strokeWidth="0.5" markerStart="url(#sv-hc2)" markerEnd="url(#sv-hc1)"/>
              <line x1={svPd_l-20} y1={svPd_t+24} x2={svPd_l-12} y2={svPd_t+24} stroke={vc.hc} strokeWidth="0.7"/>
              <line x1={svPd_l-20} y1={svPd_t+44} x2={svPd_l-12} y2={svPd_t+44} stroke={vc.hc} strokeWidth="0.7"/>
              <text x={(svPd_l-5)/2+3} y={svPd_t+57} textAnchor="middle" fill={vc.hc} fontSize="10.5" fontFamily="'IBM Plex Mono', monospace" fontWeight="700">{svHcLabel}</text>
            </g>:null}
            {/* Width dimension */}
            <g><line x1={svOx} y1={svOy+svRH+3} x2={svOx} y2={svOy+svRH+24} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx+svRW} y1={svOy+svRH+3} x2={svOx+svRW} y2={svOy+svRH+24} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx} y1={svOy+svRH+18} x2={svOx+svRW} y2={svOy+svRH+18} stroke={vc.dimAct} strokeWidth="0.4" markerStart="url(#sv-arr2)" markerEnd="url(#sv-arr)"/><text x={svOx+svRW/2} y={svOy+svRH+32} textAnchor="middle" fill={vc.dimAct} fontSize="10" fontFamily="'IBM Plex Mono', monospace" fontWeight="600">{svWLabel}</text></g>
            {/* Height dimension */}
            {pat!=="linear"?<g><line x1={svOx+svRW+3} y1={svOy} x2={svOx+svRW+24} y2={svOy} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx+svRW+3} y1={svOy+svRH} x2={svOx+svRW+24} y2={svOy+svRH} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx+svRW+18} y1={svOy} x2={svOx+svRW+18} y2={svOy+svRH} stroke={vc.dimAct} strokeWidth="0.4" markerStart="url(#sv-arr2)" markerEnd="url(#sv-arr)"/><text x={svOx+svRW+28} y={svOy+svRH/2} dominantBaseline="middle" fill={vc.dimAct} fontSize="10" fontFamily="'IBM Plex Mono', monospace" fontWeight="600">{svHLabel}</text></g>:null}
            {/* Pattern label — above scan area */}
            <text x={svPd_l} y="16" fill={vc.lbl} fontSize="9.5" fontWeight="600" fontFamily="'IBM Plex Sans', system-ui, sans-serif" letterSpacing="0.08em">{pat==="linear"?"LINEAR":pat==="bidi"?"BIDIRECTIONAL RASTER":"UNIDIRECTIONAL RASTER"}</text>
            {pat!=="linear"?<text x={svW_c-8} y="16" textAnchor="end" fill={vc.lbl} fontSize="9" fontFamily="'IBM Plex Mono', monospace">{nLines+" lines"}</text>:null}
            {/* Decimation notice — below width dim */}
            {svTooMany?<text x={svOx+svRW/2} y={svOy+svRH+42} textAnchor="middle" fill={vc.lbl2} fontSize="9" fontFamily="'IBM Plex Mono', monospace" fontStyle="italic">{"showing "+svDecCount+" of "+nLines.toLocaleString()+" lines"}</text>:null}
            {/* Beam suppression notice — above scan area */}
            {svBeamOwl&&svBeam?<text x={svOx+svRW/2} y={svOy-8} textAnchor="middle" fill={vc.lbl2} fontSize="9" fontFamily="'IBM Plex Mono', monospace">{"beam ("+svFmtDim(dia)+") \u226B scan area"}</text>:null}
            {/* Legend — bottom right, outside scan area */}
            <g transform={"translate("+(svW_c-8)+","+(svH_c-16)+")"}><line x1="-58" y1="0" x2="-44" y2="0" stroke={vc.mark} strokeWidth="1.0"/><text x="-41" y="0.5" dominantBaseline="middle" fill={vc.legTx} fontSize="8" fontFamily="'IBM Plex Mono', monospace">mark</text>{svFlyback?<g><line x1="-58" y1="-14" x2="-44" y2="-14" stroke={vc.jump} strokeWidth="0.8" strokeDasharray="3,2"/><text x="-41" y="-13.5" dominantBaseline="middle" fill={vc.legTx} fontSize="8" fontFamily="'IBM Plex Mono', monospace">flyback</text></g>:null}</g>
            {/* Hover crosshairs — neutral grey, colorblind safe */}
            {svHovS&&!selPt&&pat!=="linear"?<g opacity="0.4">
              <line x1={svHovS.sx} y1={svOy} x2={svHovS.sx} y2={svOy+svRH} stroke={vc.lbl} strokeWidth="0.7" strokeDasharray="3,3"/>
              <line x1={svOx} y1={svHovS.sy} x2={svOx+svRW} y2={svHovS.sy} stroke={vc.lbl} strokeWidth="0.7" strokeDasharray="3,3"/>
              <circle cx={svHovS.sx} cy={svHovS.sy} r="4" fill="none" stroke={vc.lbl} strokeWidth="1"/>
            </g>:null}
            {/* Selected point marker — circle+cross for shape redundancy */}
            {svSelS&&pat!=="linear"?<g>
              <line x1={svSelS.sx} y1={svOy} x2={svSelS.sx} y2={svOy+svRH} stroke={T.no} strokeWidth="0.8" strokeDasharray="5,3" opacity="0.5"/>
              <line x1={svOx} y1={svSelS.sy} x2={svOx+svRW} y2={svSelS.sy} stroke={T.no} strokeWidth="0.8" strokeDasharray="5,3" opacity="0.5"/>
              <circle cx={svSelS.sx} cy={svSelS.sy} r="6" fill="none" stroke={T.no} strokeWidth="1.5"/>
              <line x1={svSelS.sx-3} y1={svSelS.sy} x2={svSelS.sx+3} y2={svSelS.sy} stroke={T.no} strokeWidth="1.5"/>
              <line x1={svSelS.sx} y1={svSelS.sy-3} x2={svSelS.sx} y2={svSelS.sy+3} stroke={T.no} strokeWidth="1.5"/>
            </g>:null}
            {/* Hover coordinate tooltip — dynamically positioned to avoid edge clipping */}
            {svHov&&svHovS&&!selPt&&pat!=="linear"?(function(){var tp=svTipPos(svHovS.sx,svHovS.sy);return <g>
              <rect x={tp.tx} y={tp.ty} width={svTipW} height={svTipH} rx="2" fill="rgba(31,41,51,0.88)"/>
              <text x={tp.tx+6} y={tp.ty+13} fill="#E6EDF3" fontSize="10" fontFamily={"'IBM Plex Mono', monospace"}>{"("+svHov.x.toFixed(2)+", "+svHov.y.toFixed(2)+")"}</text>
            </g>;})():null}
            {/* Click instruction hint — below dimensions, clear of geometry */}
            {!selPt&&pat!=="linear"?<text x={svOx+svRW/2} y={svH_c-4} textAnchor="middle" fill={vc.lbl} fontSize="8.5" fontFamily={"'IBM Plex Sans', system-ui, sans-serif"} fontWeight="400" opacity="0.5">Click anywhere in scan area to select observation point</text>:null}
          </svg>
        </div>
        {/* Coordinate input bar */}
        {pat!=="linear"?<div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:11,color:T.tm,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>Observation:</span>
            {selPt?<span style={{fontFamily:"'IBM Plex Mono', monospace",fontSize:12,color:T.tx,fontWeight:500,fontVariantNumeric:"tabular-nums"}}>{"("+selPt.x.toFixed(3)+", "+selPt.y.toFixed(3)+") mm"}</span>
              :<span style={{fontSize:11,color:T.td,fontStyle:"italic",fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>click scan area or enter coordinates</span>}
            {selPt?<button onClick={function(){setSelPt(null);setSelXS("");setSelYS("");}} style={{fontSize:10,padding:"2px 8px",background:"transparent",border:"1px solid "+T.bd,borderRadius:4,cursor:"pointer",color:T.ac,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>Reset to worst-case</button>:null}
          </div>
          <div style={{borderLeft:"1px solid "+T.bd,height:18}}/>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:10,color:T.td}}>x</span>
            <input type="text" value={selXS} onChange={function(e){setSelXS(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")svCoordGo();}} placeholder="0.000" style={{width:66,fontFamily:"'IBM Plex Mono', monospace",fontSize:11,height:24,padding:"0 6px",border:"1px solid "+T.bd,borderRadius:4,textAlign:"right",color:T.tx,outline:"none",background:T.card,fontVariantNumeric:"tabular-nums",boxSizing:"border-box"}}/>
            <span style={{fontSize:10,color:T.td}}>y</span>
            <input type="text" value={selYS} onChange={function(e){setSelYS(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")svCoordGo();}} placeholder="0.000" style={{width:66,fontFamily:"'IBM Plex Mono', monospace",fontSize:11,height:24,padding:"0 6px",border:"1px solid "+T.bd,borderRadius:4,textAlign:"right",color:T.tx,outline:"none",background:T.card,fontVariantNumeric:"tabular-nums",boxSizing:"border-box"}}/>
            <span style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>mm</span>
            <button onClick={svCoordGo} style={{height:24,padding:"0 10px",fontSize:10,fontWeight:500,background:T.ac,color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>Go</button>
          </div>
        </div>:null}
        {/* Inputs — compact row */}
        <div style={{display:"grid",gridTemplateColumns:pat==="linear"?"1fr 1fr 1fr":"1fr 1fr 1fr 1fr 1fr",gap:8}}>
          <div><label htmlFor="scan-sw" style={lb}>{pat==="linear"?"B-scan Length (mm)":"B-scan Width (mm)"}</label><input id="scan-sw" type="text" value={lLS} onChange={function(e){upN(setLLS,setLineL,e.target.value);}} style={ip}/></div>
          {pat!=="linear"?<div><label htmlFor="scan-sh" style={lb}>Slow-axis Range (mm)</label><input id="scan-sh" type="text" value={scanHS} onChange={function(e){upN(setScanHS,setScanHN,e.target.value);}} style={ip}/></div>:null}
          {pat!=="linear"?<div><label htmlFor="scan-nl" style={lb}>B-scans / Volume</label><input id="scan-nl" type="text" value={nLS} onChange={function(e){setNLS(e.target.value);var v=Math.max(1,Math.round(Number(e.target.value)));if(isFinite(v))setNLines(v);setDirty(true);}} style={ip}/></div>:null}
          <div><label htmlFor="scan-nbm" style={lb}>BM-scans / Loc.</label><input id="scan-nbm" type="text" value={nBMS} onChange={function(e){setNBMS(e.target.value);var v=Math.max(1,Math.round(Number(e.target.value)));if(isFinite(v))setNBM(v);setDirty(true);}} style={ip}/></div>
          <div>
            <label style={lb}>Scan Speed</label>
            <select value={velMode} onChange={function(e){setVelMode(e.target.value);setDirty(true);}} style={{width:"100%",marginBottom:4,fontSize:10,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer",boxSizing:"border-box"}}><option value="ascans">A-scans / B-scan</option><option value="velocity">Velocity (mm/s)</option><option value="dwell">Dwell (\u00b5s)</option><option value="scanrate">B-scan rate (Hz)</option><option value="framerate">Volume rate (Hz)</option></select>
            {velMode==="ascans"?<input type="text" value={nAS} onChange={function(e){setNAS(e.target.value);var v=Math.max(1,Math.round(Number(e.target.value)));if(isFinite(v))setNA(v);setDirty(true);}} style={ip}/>:velMode==="velocity"?<input type="text" value={vS} onChange={function(e){upN(setVS,setVel,e.target.value);}} style={ip}/>:velMode==="dwell"?<input type="text" value={dwellS} onChange={function(e){upN(setDwellS,setDwellN,e.target.value);}} style={ip}/>:velMode==="scanrate"?<input type="text" value={srateS} onChange={function(e){upN(setSrateS,setSrateN,e.target.value);}} style={ip}/>:<input type="text" value={frateS} onChange={function(e){upN(setFrateS,setFrateN,e.target.value);}} style={ip}/>}
          </div>
        </div>
        {/* Derived readouts — single line below */}
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:4}}>
          {pat!=="linear"&&nLines>1&&scanHN>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"B-scan spacing: "+(scanHN/(nLines-1)*1000).toFixed(2)+" \u00b5m"}</div>:null}
          {velMode==="ascans"&&nA>0&&prf>0&&lineL>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(lineL*prf/nA).toFixed(2)+" mm/s ("+(prf/nA).toFixed(2)+" B-scans/s)"}</div>:null}
          {velMode==="dwell"&&dwellN>0&&dia>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(dia/(dwellN*1e-6)).toFixed(2)+" mm/s"}</div>:null}
          {velMode==="scanrate"&&srateN>0&&lineL>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(srateN*lineL).toFixed(2)+" mm/s"}</div>:null}
          {velMode==="framerate"&&frateN>0&&lineL>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(lineL*(pat==="linear"?1:nLines)*frateN).toFixed(2)+" mm/s"}</div>:null}
        </div>
      </div>

      </div>
    </fieldset>
    <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
      <button onClick={calculate} style={{height:36,padding:"0 24px",fontSize:13,fontWeight:500,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:4,cursor:"pointer",letterSpacing:"-0.005em"}}>{cmp?"Computing...":dirty?"Calculate":"Calculated \u2713"}</button>
    </div>
    </div>

    {/* ── Performance Note ── */}
    {perfNote?<div style={{padding:"8px 12px",borderRadius:4,background:"#fff3e0",border:"1px solid #ffe0b2",fontSize:10,color:"#e65100",fontFamily:"'IBM Plex Mono', monospace",lineHeight:1.6}}>
      {"\u26a1"} {perfNote}
    </div>:null}

    {/* ═══ Region 2: Results ═══ */}
    <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Scan Safety Results</div>
    {/* ── Safety Results ── */}
    {res?<div style={{background:T.card,borderRadius:4,border:"1px solid "+T.bd,padding:14}}>
      {/* Verdict bar + rules in single row */}
      <div style={{display:"flex",gap:12,alignItems:"stretch",marginBottom:12}}>
        <div role="alert" aria-live="polite" style={{background:res.sf.safe?"#E8F5F0":"#fbe9e7",borderRadius:4,padding:"10px 16px",display:"flex",alignItems:"center",gap:10,minWidth:160}}>
          <div><div style={{fontSize:8,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:res.sf.safe?"#00796B":"#bf360c",marginBottom:1}}>Safety Verdict{res.nBM>1?" · ×"+res.nBM+" BM":""}</div><div style={{fontSize:18,fontWeight:700,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.safe?"#00796B":"#bf360c"}}>{res.sf.safe?"PASS":"FAIL"}</div></div>
          <div><div style={{fontSize:9,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.safe?"#00897B":"#d84315"}}>margin: {res.sf.safe?"+":""}{(res.sf.sm*100).toFixed(1)}%</div>
          <div style={{fontSize:9,color:res.sf.safe?"#26a69a":"#e64a19"}}>binding: {res.sf.br}</div></div>
        </div>
        <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,border:"1px solid "+T.bd,borderRadius:4}}>
          <div style={{padding:"8px 12px",borderRight:"1px solid "+T.bd}}>
            <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Rule 1 — Single Pulse</div>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r1m>1?T.no:T.ok}}>{numFmt(res.sf.ppM,4)}</span>
              <span style={{fontSize:9,color:T.td}}>J/cm{"²"}</span>
              <span style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r1m>1?T.no:T.ok,marginLeft:"auto"}}>{res.sf.r1m.toFixed(3)}{"×"}</span>
            </div>
            <div style={{fontSize:8,color:T.td,marginTop:1}}>MPE({"τ"}) = {numFmt(res.sf.mt,4)} J/cm{"²"}</div>
          </div>
          <div style={{padding:"8px 12px"}}>
            <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Rule 2 — Cumulative</div>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r2m>1?T.no:T.ok}}>{numFmt(res.sf.pF,4)}</span>
              <span style={{fontSize:9,color:T.td}}>J/cm{"²"}</span>
              <span style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r2m>1?T.no:T.ok,marginLeft:"auto"}}>{res.sf.r2m.toFixed(3)}{"×"}</span>
            </div>
            <div style={{fontSize:8,color:T.td,marginTop:1}}>MPE(T={numFmt(res.st.tt,3)}s) = {numFmt(res.sf.mT,4)} J/cm{"²"}</div>
          </div>
        </div>
      </div>
      {/* ── Worst-case stationary advisory (galvo-stall fault mode) ── */}
      {(function(){
        var T_st=res.st.tt;
        if(!isFinite(T_st)||T_st<=0)return null;
        var w_cm=(dia/2)/10;
        var denom=Math.PI*w_cm*w_cm;
        if(denom<=0)return null;
        var sRatio,sSafe,sBind,sH,sMPE;
        if(laserMode==="cw"){
          /* CW mode: duty cycle is ignored (CW means continuous emission). */
          var I_peak=2*pw/denom;
          sH=I_peak*T_st;
          sMPE=skinMPE(wl,T_st);
          sRatio=sH/sMPE;sSafe=sRatio<1;sBind="CW (T="+numFmt(T_st,3)+" s)";
        }else if(prf>0){
          var dcStatic=isFinite(dc)&&dc>0&&dc<=1?dc:1.0;
          var H_pp=2*((pw*dcStatic)/prf)/denom;
          var N_st=prf*T_st;
          var H_total=H_pp*N_st;
          var mpe1=skinMPE(wl,tau);
          var mpeT2=skinMPE(wl,T_st);
          var r1s=H_pp/mpe1;
          var r2s=N_st>1?(H_total/mpeT2):r1s;
          if(r1s>=r2s){sRatio=r1s;sBind="Rule 1 (single pulse)";sH=H_pp;sMPE=mpe1;}
          else{sRatio=r2s;sBind="Rule 2 (cumulative)";sH=H_total;sMPE=mpeT2;}
          sSafe=sRatio<1;
        }else return null;
        var bg=sSafe?"#E8F5F0":"#fff3e0";
        var bd=sSafe?"#C4E5DF":"#ffe0b2";
        var col=sSafe?"#00796B":"#e65100";
        var note=sSafe?"tissue safe under galvo-stall fault":"fault-mode exceeds MPE \u2014 stall interlock recommended";
        return <div style={{marginTop:10,padding:"6px 10px",background:bg,borderRadius:4,border:"1px solid "+bd,fontSize:10,color:col,fontFamily:"'IBM Plex Mono', monospace"}}>
          {(sSafe?"\u2713":"\u26a0")+" Advisory \u2014 worst-case stationary: H = "+numFmt(sH,4)+" J/cm\u00b2 ("+sRatio.toFixed(3)+"\u00d7 MPE), binding "+sBind+" \u2014 "+note}
        </div>;
      })()}
      {/* ── Bandwidth diagnostic (broadband-source band-boundary check) ── */}
      {(function(){
        if(!isFinite(bw)||bw<=0)return null;
        var wlLo=wl-bw/2,wlHi=wl+bw/2;
        if(wlLo<=0)return null;
        var bands=[400,700,1050,1400,1500];
        var straddles=null;
        for(var bi=0;bi<bands.length;bi++){if(wlLo<bands[bi]&&wlHi>bands[bi]){straddles=bands[bi];break;}}
        var mpeC=skinMPE(wl,tau);
        var mpeLo=skinMPE(wlLo,tau);
        var mpeHi=skinMPE(wlHi,tau);
        /* Bail out if any band-edge MPE is invalid (e.g., wlLo below standard's range). */
        if(!isFinite(mpeC)||mpeC<=0||!isFinite(mpeLo)||!isFinite(mpeHi))return null;
        var mpeMin=Math.min(mpeC,mpeLo,mpeHi);
        var ratio=mpeMin/mpeC;
        if(!straddles&&ratio>=0.95)return null;
        var msg=straddles
          ?"Spectrum ["+wlLo.toFixed(0)+"–"+wlHi.toFixed(0)+" nm] crosses MPE band edge at "+straddles+" nm. Conservative MPE = "+numFmt(mpeMin,4)+" J/cm² ("+(ratio*100).toFixed(0)+"% of center)."
          :"Spectrum ["+wlLo.toFixed(0)+"–"+wlHi.toFixed(0)+" nm]: per-pulse MPE varies "+(ratio*100).toFixed(0)+"% across band; verdict uses MPE at center.";
        return <div style={{marginTop:10,padding:"6px 10px",background:"#fff8e1",borderRadius:4,border:"1px solid #ffe0b2",fontSize:10,color:"#bf6f00",fontFamily:"'IBM Plex Mono', monospace"}}>
          {"ⓘ Broadband: "+msg}
        </div>;
      })()}
      {/* Compact summary table — single table, essential info only */}
      <div style={secH}>Scan Summary</div>
      <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{[
        ["Scan pattern",pat==="linear"?"Linear":pat==="bidi"?"Bidirectional raster":"Unidirectional raster","Scan velocity",vel.toPrecision(4)+" mm/s"],
        ["Total scan time",numFmt(res.st.tt,4)+" s"+(res.nBM>1?" (×"+res.nBM+" BM)":""),"Grid",res.g.nx+"×"+res.g.ny+" ("+ppd+" pts/dia)"],
        ["Peak fluence",numFmt(res.sf.pF,4)+" J/cm²"+(res.sf.anUsed?" (analytical)":""),"Max pulses at point",String(res.sf.mP)],
        (function(){
          var dcD=(laserMode==="cw"||!isFinite(dc)||dc<=0||dc>1)?1.0:dc;
          var energyLabel=laserMode==="cw"?"Avg power":"Energy / sweep";
          var energyValue=laserMode==="cw"?(numFmt(pw,4)+" W"):(numFmt((pw*dcD)/prf,4)+" J"+(dcD<1?" (dc-corrected)":""));
          return [energyLabel,energyValue,"Dwell time ("+dwm+")",numFmt(dwm==="gaussian"?scanDwellGaussian(dia,vel):scanDwellGeometric(dia,vel),4)+" s"];
        })(),
        ["τᵣ (thermal)",numFmt(res.sf.tauR,4)+" s","Flyback blanking",pat==="linear"?"N/A":(blk?"Yes":"No (conservative)")],
        ["BM-scans / loc.",String(Math.max(1,Math.round(nBM))),"Bandwidth (FWHM)",isFinite(bw)&&bw>0?bw.toFixed(0)+" nm":"—"],
      ].map(function(row,i){return <tr key={i} style={{borderBottom:"1px solid "+T.bgI}}>
        <td style={{padding:"3px 8px",fontSize:10,color:T.tm,width:"18%"}}>{row[0]}</td>
        <td style={{padding:"3px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:500,width:"32%"}}>{row[1]}</td>
        <td style={{padding:"3px 8px",fontSize:10,color:T.tm,width:"18%"}}>{row[2]}</td>
        <td style={{padding:"3px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:500,width:"32%"}}>{row[3]}</td>
      </tr>;})}</tbody></table>
      {/* Thermal relaxation — inline if available */}
      {isFinite(res.sf.minRv)?<div style={{marginTop:10,padding:"6px 10px",background:res.sf.rvOk?"#E8F5F0":"#fff3e0",borderRadius:4,border:"1px solid "+(res.sf.rvOk?"#C4E5DF":"#ffe0b2"),fontSize:10,color:res.sf.rvOk?"#00796B":"#e65100",fontFamily:"'IBM Plex Mono', monospace"}}>
        {res.sf.rvOk?"✓":"⚠"}{" Thermal: τᵣ = "+numFmt(res.sf.tauR,3)+" s, min revisit = "+numFmt(res.sf.minRv,3)+" s ("+((res.sf.minRv/res.sf.tauR)).toFixed(2)+"× τᵣ) — "+(res.sf.rvOk?"tissue cools between passes":"thermal accumulation likely")}
      </div>:null}
      {/* Permissible limits — compact inline */}
      {(function(){
        var maxEp=scanMaxPulseEnergy(wl,dia,tau);
        /* CW mode: duty cycle is ignored. */
        var dcRange=(laserMode==="cw")?1.0:(isFinite(dc)&&dc>0&&dc<=1?dc:1.0);
        var pwEffRange=pw*dcRange;
        var minPRF=scanMinRepRate(wl,dia,tau,pwEffRange);
        return <div style={{marginTop:10}}>
          <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:4}}>Permissible Ranges</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
            {[
              ["Max Ep",numFmt(maxEp,3)+" J",pwEffRange/prf<=maxEp*1.001],
              ["Min PRF",numFmt(minPRF,3)+" Hz",prf>=minPRF*0.999],
              ["Max power",numFmt(res.maxP||0,3)+" W",pwEffRange<=(res.maxP||Infinity)*1.001],
              ["Min velocity",isFinite(res.minV)?numFmt(res.minV,3)+" mm/s":"—",isFinite(res.minV)?vel>=res.minV*0.999:true]
            ].map(function(it,i){
              return <div key={i} style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}}>
                <span style={{color:T.td,fontSize:9}}>{it[0]}: </span>
                <span style={{fontWeight:600,color:it[2]?T.ok:T.no}}>{it[1]}</span>
              </div>;
            })}
          </div>
        </div>;
      })()}
    </div>:null}

    {/* ── Point Timing Visualization ── */}
    <div style={{background:T.card,borderRadius:4,border:"1px solid "+T.bd,padding:14}}>
      <div style={secH}>Point Timing Diagram</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>
          {selPt?"Observing ("+selPt.x.toFixed(3)+", "+selPt.y.toFixed(3)+") mm":"Showing worst-case point"}
          {selPt?" \u2014 select a different point in the scan pattern above or enter coordinates.":"."}
        </div>
        {res?<div style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Mono', monospace",fontVariantNumeric:"tabular-nums"}}>Grid: {res.g.nx}{"\u00d7"}{res.g.ny} {"\u00b7"} Pulses: {(res.pulses && res.pulses.length>0)?res.pulses.length:(res.st.tp||0)}</div>:null}
      </div>
      {lspState.customPath?<div style={{height:300,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12,fontFamily:"'IBM Plex Sans', system-ui, sans-serif",padding:"0 24px",textAlign:"center"}}><div style={{fontSize:13,fontWeight:600,color:T.tm,marginBottom:6}}>Per-point timing not available for custom-path LSPs</div><div style={{maxWidth:480,lineHeight:1.5}}>The point-timing diagram assumes a regular raster scan; this LSP defines an arbitrary segment path. Use the safety verdict and peak fluence above for the worst-case point — these are computed correctly from the actual segments.</div></div>
        :res&&prf>0?<div>
        <div ref={ptTimRef} style={{width:"100%",height:420,borderRadius:4}}/>
      </div>
        :<div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>{res?"CW mode \u2014 no discrete pulses":"Click Calculate to generate timing diagram"}</div>}
    </div>
    </div>

    {/* ═══ Region 3: Safety Notice ═══ */}
    {/* Safety disclaimer — compact */}
    <div style={{fontSize:9,color:T.td,lineHeight:1.6,padding:"8px 0"}}>
      <strong style={{color:T.tm}}>{"⚠"} Notice:</strong>{" "}
      This tool evaluates skin MPE per {STD_NAME} using Rules 1 and 2. OCT defaults assume SS-OCT 1310 nm at the tissue surface. For ophthalmic OCT, additional retinal MPE evaluation is required.{" "}
      <strong style={{color:T.no}}>Research and educational use only.</strong>{" "}Verify all values against the applicable standard.
    </div>
  </div>);
}

/* ═══════ PHOTOACOUSTICS SCANNING ═══════ */
function PAScanContent(p){
  var T=p.T,theme=p.theme,msg=p.msg,setMsg=p.setMsg;
  var _wl=useState("532"),wlS=_wl[0],setWlS=_wl[1]; var _wn=useState(532),wl=_wn[0],setWl=_wn[1];
  var _d=useState("0.010"),dS=_d[0],setDS=_d[1]; var _dn=useState(0.010),dia=_dn[0],setDia=_dn[1];
  var _tau=useState("5"),tauS=_tau[0],setTauS=_tau[1]; var _tn=useState(5e-9),tau=_tn[0],setTau=_tn[1];
  var _tU=useState("ns"),tauU=_tU[0],setTauU=_tU[1];
  var _prf=useState("100"),prfS=_prf[0],setPrfS=_prf[1]; var _pn=useState(100000),prf=_pn[0],setPrf=_pn[1];
  var _pfU=useState("kHz"),prfU=_pfU[0],setPrfU=_pfU[1];
  var _pw=useState("0.001"),pwS=_pw[0],setPwS=_pw[1]; var _pwn=useState(0.001),pw=_pwn[0],setPw=_pwn[1];
  var _pwMode=useState("energy"),pwMode=_pwMode[0],setPwMode=_pwMode[1]; /* "power" or "energy" */
  var _lcm=useState("pulsed"),laserMode=_lcm[0],setLaserMode=_lcm[1]; /* "pulsed" | "cw" */
  var _epS=useState("10e-9"),epS=_epS[0],setEpS=_epS[1];
  var _vs=useState("100"),vS=_vs[0],setVS=_vs[1]; var _vn=useState(100),vel=_vn[0],setVel=_vn[1];
  var _vMode=useState("ascans"),velMode=_vMode[0],setVelMode=_vMode[1]; /* "ascans"|"velocity"|"dwell"|"scanrate"|"framerate" */
  var _dw=useState("10"),dwellS=_dw[0],setDwellS=_dw[1]; var _dwN=useState(10),dwellN=_dwN[0],setDwellN=_dwN[1]; /* µs per spot */
  var _sr=useState("5"),srateS=_sr[0],setSrateS=_sr[1]; var _srN=useState(5),srateN=_srN[0],setSrateN=_srN[1]; /* lines/s */
  var _fr=useState("1"),frateS=_fr[0],setFrateS=_fr[1]; var _frN=useState(1),frateN=_frN[0],setFrateN=_frN[1]; /* fps */
  var _pat=useState("raster"),pat=_pat[0],setPat=_pat[1];
  var _lL=useState("1"),lLS=_lL[0],setLLS=_lL[1]; var _lLn=useState(1),lineL=_lLn[0],setLineL=_lLn[1]; /* B-scan width */
  var _sH=useState("1"),scanHS=_sH[0],setScanHS=_sH[1]; var _sHn=useState(1),scanHN=_sHn[0],setScanHN=_sHn[1]; /* slow-axis range */
  var _nL=useState("1000"),nLS=_nL[0],setNLS=_nL[1]; var _nLn=useState(1000),nLines=_nLn[0],setNLines=_nLn[1]; /* B-scans per volume */
  var _htn=useState(1/999),hatch=_htn[0],setHatch=_htn[1]; /* derived: scanHN/(nLines-1) */
  /* ── PA-specific state ── */
  var _modality=useState("or-pam"),modality=_modality[0],setModality=_modality[1]; /* "or-pam" | "ar-pam" | "pact" */
  var _nBM=useState("1"),nBMS=_nBM[0],setNBMS=_nBM[1]; var _nBMn=useState(1),nBM=_nBMn[0],setNBM=_nBMn[1]; /* averages per location */
  var _nA=useState("1000"),nAS=_nA[0],setNAS=_nA[1]; var _nAn=useState(1000),nA=_nAn[0],setNA=_nAn[1]; /* A-lines per B-scan */
  /* PACT-specific state (used when modality === "pact") */
  var _pactA=useState("1.0"),pactAS=_pactA[0],setPactAS=_pactA[1]; var _pactAn=useState(1.0),pactA=_pactAn[0],setPactA=_pactAn[1]; /* illumination footprint cm² */
  var _pactE=useState("20e-3"),pactES=_pactE[0],setPactES=_pactE[1]; var _pactEn=useState(20e-3),pactE=_pactEn[0],setPactE=_pactEn[1]; /* per-pulse energy J */
  var _pactT=useState("10"),pactTS=_pactT[0],setPactTS=_pactT[1]; var _pactTn=useState(10),pactT=_pactTn[0],setPactT=_pactTn[1]; /* exposure duration s */

  var _ppd=useState(8),ppd=_ppd[0],setPpd=_ppd[1];
  var _dwm=useState("gaussian"),dwm=_dwm[0],setDwm=_dwm[1];
  var _blk=useState(false),blk=_blk[0],setBlk=_blk[1];
  var _res=useState(null),res=_res[0],setRes=_res[1];
  var _cmp=useState(false),cmp=_cmp[0],setCmp=_cmp[1];
  var _dirty=useState(true),dirty=_dirty[0],setDirty=_dirty[1];

  /* Scan visualization feature toggles */
  var _svGrid=useState(true),svGrid=_svGrid[0],setSvGrid=_svGrid[1];
  var _svBeam=useState(true),svBeam=_svBeam[0],setSvBeam=_svBeam[1];
  var _svFlyback=useState(true),svFlyback=_svFlyback[0],setSvFlyback=_svFlyback[1];
  var _svAnts=useState(false),svAnts=_svAnts[0],setSvAnts=_svAnts[1];
  var _antOff=useState(0),antOff=_antOff[0],setAntOff=_antOff[1];
  useEffect(function(){
    if(!svAnts)return;
    var f;var tick=function(){setAntOff(function(p){return(p+0.5)%20;});f=requestAnimationFrame(tick);};
    f=requestAnimationFrame(tick);
    return function(){cancelAnimationFrame(f);};
  },[svAnts]);

  var lb={display:"block",fontSize:11,fontWeight:500,color:T.tm,marginBottom:3,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"};
  var ip={width:"100%",padding:"6px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",fontVariantNumeric:"tabular-nums",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};
  var secH={fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:T.td,marginBottom:8,paddingBottom:4,borderBottom:"1px solid "+T.bd,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"};
  var thS={padding:"5px 8px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700};
  var tdS={padding:"5px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace"};

  function upN(setS,setN,s){setS(s);var v=Number(s);if(isFinite(v))setN(v);setDirty(true);}
  function upTau(s){setTauS(s);var v=Number(s);if(isFinite(v)&&v>0){var m=1;for(var i=0;i<DUR_UNITS.length;i++){if(DUR_UNITS[i].id===tauU)m=DUR_UNITS[i].toS;}setTau(v*m);}setDirty(true);}
  function upPrf(s){setPrfS(s);var v=Number(s);if(isFinite(v)&&v>0){var m=1;for(var i=0;i<FREQ_UNITS.length;i++){if(FREQ_UNITS[i].id===prfU)m=FREQ_UNITS[i].toHz;}setPrf(v*m);}setDirty(true);}
  /* Power/energy toggle helpers */
  function upPw(s){setPwS(s);var v=Number(s);if(isFinite(v)&&v>0){setPw(v);if(prf>0)setEpS((v/prf).toExponential(4));}setDirty(true);}
  function upEp(s){setEpS(s);var v=Number(s);if(isFinite(v)&&v>0&&prf>0){var P=v*prf;setPw(P);setPwS(P.toPrecision(4));}setDirty(true);}
  /* When PRF changes and mode is energy, recompute power */
  useEffect(function(){if(pwMode==="energy"&&prf>0){var v=Number(epS);if(isFinite(v)&&v>0){setPw(v*prf);setPwS((v*prf).toPrecision(4));}}},[prf,pwMode,epS]);
  /* When PRF changes and mode is power, update displayed Ep */
  useEffect(function(){if(pwMode==="power"&&prf>0&&pw>0){setEpS((pw/prf).toExponential(4));}},[prf,pw,pwMode]);
  /* Keep hatch in sync with scan height and scan line count */
  useEffect(function(){
    if((pat==="raster"||pat==="bidi")&&scanHN>0&&nLines>=1)setHatch(nLines>1?scanHN/(nLines-1):scanHN);
  },[pat,scanHN,nLines]);
  /* Keep vel in sync for all derived velocity input modes */
  useEffect(function(){
    var v=0;
    if(velMode==="ascans"&&nA>0&&lineL>0&&prf>0) v=lineL*prf/nA;
    else if(velMode==="dwell"&&dwellN>0&&dia>0) v=dia/(dwellN*1e-6);
    else if(velMode==="scanrate"&&srateN>0&&lineL>0) v=srateN*lineL;
    else if(velMode==="framerate"&&frateN>0&&lineL>0) v=lineL*(pat==="linear"?1:nLines)*frateN;
    if(v>0&&isFinite(v)){setVel(v);setVS(v.toPrecision(4));}
  },[velMode,nA,prf,dwellN,srateN,frateN,lineL,nLines,dia,pat]);

  /* Selected point for timing diagram (null = worst-case) */
  var _selPt=useState(null),selPt=_selPt[0],setSelPt=_selPt[1];
  var _svHov=useState(null),svHov=_svHov[0],setSvHov=_svHov[1];
  var _selXS=useState(""),selXS=_selXS[0],setSelXS=_selXS[1];
  var _selYS=useState(""),selYS=_selYS[0],setSelYS=_selYS[1];
  var svRef=useRef(null);

  var _perfNote=useState(""),perfNote=_perfNote[0],setPerfNote=_perfNote[1];
  var _workerRef=useRef(null);

  /* ── LSP-JSON import state (Sub-phase 1D commit 2) ─────────────────────
     phase:  "idle" | "loading" | "loaded" | "error"
     When phase==="loaded", the existing scan-configuration inputs are
     disabled and display the LSP-derived values.  Eject restores the
     pre-import state.  The LSP worker is created lazily on first import. */
  var _lspState=useState({phase:"idle"}),lspState=_lspState[0],setLspState=_lspState[1];
  var _lspWorkerRef=useRef(null);
  var _lspInitRef=useRef(null);
  var _lspPreImportState=useRef(null);
  var _lspReqIdRef=useRef(0);  // monotonic request ID counter (prevents Math.random collisions)
  /* Holds the engine-format segments for a custom-path LSP (Sub-phase 1D
     commit 3).  Non-null only while phase==="loaded" AND the LSP used a
     segment-array authoritative path (canonicalize emitted scanParams=null
     with non-empty engineSegments).  Shape: {segments, bbox, totalTime_s,
     meanVelocity_mm_s, hasBlankedSegments, d_1e_mm}.                      */
  var _lspCustomSegsRef=useRef(null);

  /* Lazy worker creation + init.  Returns a Promise that resolves when the
     worker has accepted the standard.  Three structural defenses:
     (1) On init rejection we CLEAR _lspInitRef so the next import retries,
         rather than permanently caching the rejected promise.
     (2) We attach an 'error' event listener on the worker so script-load
         failures (CSP block, malformed bundle, etc) reject the promise
         rather than hanging forever.
     (3) We add a 10s init timeout as a last-resort defense; in practice
         init takes 50-200 ms in modern browsers.                          */
  function _getLspWorkerInited(){
    if (_lspInitRef.current) return _lspInitRef.current;
    if (typeof __createLSPWorker!=="function") return null;
    var w = __createLSPWorker();
    if (!w) return null;
    _lspWorkerRef.current = w;

    // Compute stdData OUTSIDE the Promise executor.  If _E.getStandard()
    // throws here, we can clean up the worker reference cleanly before
    // returning a rejected Promise; throwing inside the executor would
    // leak the worker ref because the catch path runs in a context where
    // we've already assigned _lspWorkerRef.current = w.
    var stdData;
    try {
      stdData = (typeof __STD_DATA__!=="undefined") ? __STD_DATA__ :
                (_E && _E.getStandard ? {standard:_E.getStandard()} : null);
    } catch (stdErr) {
      try { w.terminate(); } catch (_) {}
      _lspWorkerRef.current = null;
      _lspInitRef.current = null;
      return Promise.reject(new Error("Failed to obtain standard data: " +
        (stdErr && stdErr.message ? stdErr.message : String(stdErr))));
    }

    var p = new Promise(function(resolve, reject){
      var initReq = (++_lspReqIdRef.current);
      var settled = false;
      function settle(ok, err){
        if (settled) return; settled = true;
        try { w.removeEventListener("message", onInit); } catch (_) {}
        try { w.removeEventListener("error", onError); } catch (_) {}
        if (timeoutId) clearTimeout(timeoutId);
        if (ok) resolve();
        else {
          // Terminate the failed worker to free its thread/memory; clear
          // both refs so the next import retries with a fresh worker.
          try { w.terminate(); } catch (_) {}
          if (_lspWorkerRef.current === w) _lspWorkerRef.current = null;
          _lspInitRef.current = null;
          reject(err);
        }
      }
      function onInit(ev){
        if (!ev||!ev.data) return;
        if (ev.data.requestId!==initReq) return;
        // Accept both init_result and error (worker's top-level catch).
        // Without this, a worker exception during init would silently
        // hang us for the full 10 s timeout.
        if (ev.data.type==="init_result") {
          if (ev.data.ok) settle(true);
          else settle(false, new Error(ev.data.error||"LSP worker init failed"));
        } else if (ev.data.type==="error") {
          var firstErr = ev.data.errors && ev.data.errors[0];
          settle(false, new Error(
            (firstErr && firstErr.message) ? firstErr.message :
            "Worker emitted an error response during init"));
        }
        // Other response types: ignore.
      }
      function onError(ev){
        // Worker script-load failure or uncaught exception inside the worker.
        var msg = (ev && ev.message) ? ev.message :
                  (ev && ev.filename) ? ("error in "+ev.filename) :
                  "Worker reported an error before init completed";
        settle(false, new Error(msg));
      }
      var timeoutId = setTimeout(function(){
        settle(false, new Error("LSP worker init timed out after 10 s"));
      }, 10000);
      w.addEventListener("message", onInit);
      w.addEventListener("error", onError);
      try {
        w.postMessage({type:"init", requestId:initReq, standard:stdData});
      } catch (postErr) {
        settle(false, postErr);
      }
    });
    _lspInitRef.current = p;
    return p;
  }

  /* Send a canonicalize message and wait for the matching response.  Three
     structural defenses against M2 (handler leak): we ALWAYS remove the
     listener via a settle() helper, even on timeout; we time out after 30s
     (canonicalization on the largest realistic doc completes in 1-2 s); and
     errors during postMessage are caught synchronously.                  */
  function _canonicalizeViaWorker(doc){
    return new Promise(function(resolve, reject){
      var initP = _getLspWorkerInited();
      if (!initP){
        reject(new Error("LSP worker is not available in this environment"));
        return;
      }
      initP.then(function(){
        var w = _lspWorkerRef.current;
        if (!w){
          reject(new Error("LSP worker reference was cleared during init"));
          return;
        }
        var req = (++_lspReqIdRef.current);
        var settled = false;
        function settle(ok, val){
          if (settled) return; settled = true;
          try { w.removeEventListener("message", onMsg); } catch (_) {}
          try { w.removeEventListener("error", onError); } catch (_) {}
          if (timeoutId) clearTimeout(timeoutId);
          if (ok) resolve(val); else reject(val);
        }
        function onMsg(ev){
          if (!ev||!ev.data) return;
          if (ev.data.requestId!==req) return;
          // Accept both canonicalize_result (normal path) and error (worker's
          // top-level catch).  Both have matching requestId; both indicate
          // the worker is done with this request.  Without accepting "error"
          // here, an internal worker exception would cause us to wait the
          // full 30 s timeout when we already have the error in hand.
          if (ev.data.type==="canonicalize_result") {
            settle(true, ev.data);
          } else if (ev.data.type==="error") {
            // Worker emitted a top-level error response.  Surface it as a
            // structured canonicalize-style failure so the caller's existing
            // error-handling path works uniformly.
            settle(true, {
              type: "canonicalize_result",
              requestId: req,
              ok: false,
              errors: (ev.data.errors && ev.data.errors.length) ? ev.data.errors : [{
                code: "INTERNAL_ERROR", path: "",
                message: "Worker emitted an error response without details"
              }],
              warnings: []
            });
          }
          // Other response types: ignore (defensive — unknown protocol extension).
        }
        function onError(ev){
          var msg = (ev && ev.message) ? ev.message :
                    "Worker reported an error during canonicalization";
          settle(false, new Error(msg));
        }
        var timeoutId = setTimeout(function(){
          settle(false, new Error("LSP canonicalization timed out after 30 s"));
        }, 30000);
        w.addEventListener("message", onMsg);
        w.addEventListener("error", onError);
        try {
          w.postMessage({type:"canonicalize", requestId:req, doc:doc});
        } catch (postErr) {
          settle(false, postErr);
        }
      }, function(initErr){ reject(initErr); });
    });
  }

  /* Build the dicts of getters/setters used by the module-level LSP helpers.
     These dicts are recreated on every render — the helpers do not retain
     them between calls, so the per-render cost is just object allocation. */
  function _lspGetters(){
    return {
      wlS:wlS, wl:wl, dS:dS, dia:dia,
      tauS:tauS, tau:tau, tauU:tauU,
      prfS:prfS, prf:prf, prfU:prfU,
      pwS:pwS, pw:pw, pwMode:pwMode,
      laserMode:laserMode, epS:epS,
      vS:vS, vel:vel, velMode:velMode,
      dwellS:dwellS, dwellN:dwellN,
      srateS:srateS, srateN:srateN,
      frateS:frateS, frateN:frateN,
      pat:pat, lLS:lLS, lineL:lineL,
      scanHS:scanHS, scanHN:scanHN,
      nLS:nLS, nLines:nLines, blk:blk
    };
  }
  function _lspSetters(){
    return {
      setWlS:setWlS, setWl:setWl, setDS:setDS, setDia:setDia,
      setTauS:setTauS, setTau:setTau, setTauU:setTauU,
      setPrfS:setPrfS, setPrf:setPrf, setPrfU:setPrfU,
      setPwS:setPwS, setPw:setPw, setPwMode:setPwMode,
      setLaserMode:setLaserMode, setEpS:setEpS,
      setVS:setVS, setVel:setVel, setVelMode:setVelMode,
      setDwellS:setDwellS, setDwellN:setDwellN,
      setSrateS:setSrateS, setSrateN:setSrateN,
      setFrateS:setFrateS, setFrateN:setFrateN,
      setPat:setPat, setLLS:setLLS, setLineL:setLineL,
      setScanHS:setScanHS, setScanHN:setScanHN,
      setNLS:setNLS, setNLines:setNLines, setBlk:setBlk,
      setDirty:setDirty
    };
  }

  /* M32 fix: terminate the LSP worker on unmount so tab switching doesn't
     leak workers.  The dependency array is empty so this effect's cleanup
     runs only at unmount.  Reading _lspWorkerRef.current at unmount is
     correct — refs are mutable through the component's lifetime and the
     ref captures the latest worker. */
  useEffect(function(){
    return function(){
      var w = _lspWorkerRef.current;
      if (w) { try { w.terminate(); } catch (_) {} }
      _lspWorkerRef.current = null;
      _lspInitRef.current = null;
      // Clearing the custom-segs ref on unmount makes the setTimeout race
      // guard inside calculate() short-circuit if the user switched tabs
      // (which unmounts this component) during the 60 ms dispatch window.
      _lspCustomSegsRef.current = null;
    };
  }, []);

  function _handleLspImport(file){
    setLspState({phase:"loading", filename:file && file.name});
    _readAndValidateLSP(file).then(function(r){
      if (!r.ok) {
        setLspState({phase:"error", filename:file && file.name,
          errors:r.errors||[], warnings:r.warnings||[]});
        return;
      }
      _canonicalizeViaWorker(r.doc).then(function(cr){
        if (!cr.ok) {
          setLspState({phase:"error", filename:file && file.name,
            errors:cr.errors||[], warnings:(r.warnings||[]).concat(cr.warnings||[])});
          return;
        }
        // Snapshot pre-import state ONLY if we're entering loaded from idle
        // or error.  If we were already loaded (user re-importing without
        // ejecting), the existing snapshot still holds the true pre-LSP
        // state — keep it so Eject restores to manual values, not to the
        // previous LSP.
        if (lspState.phase==="idle" || lspState.phase==="error") {
          _lspPreImportState.current = _lspSnapshotState(_lspGetters());
        }
        // _lspApplyState handles both preset and custom-segment paths.  It
        // populates _lspCustomSegsRef.current when the LSP uses a custom
        // path (scanParams=null + engineSegments present), or clears it
        // for preset paths.
        var applyResult = _lspApplyState(cr, _lspSetters(), _lspCustomSegsRef);
        if (!applyResult.ok) {
          setLspState({phase:"error", filename:file && file.name,
            errors:applyResult.errors||[{code:"INTERNAL_ERROR", path:"",
              message:"Failed to apply LSP-derived values"}],
            warnings:(r.warnings||[]).concat(cr.warnings||[])});
          return;
        }
        setLspState({phase:"loaded", filename:file && file.name, doc:r.doc,
          customPath:applyResult.customPath,
          beam:cr.beam, engineSegments:cr.engineSegments, scanParams:cr.scanParams,
          totalTime_s:cr.totalTime_s, warnings:(r.warnings||[]).concat(cr.warnings||[])});
      }, function(workerErr){
        // Differentiate error codes based on the actual failure mode.
        // The Promise rejector inside _getLspWorkerInited / _canonicalizeViaWorker
        // throws Error objects with specific messages.  We pattern-match the
        // message to assign the right code so users see a meaningful error.
        // Patterns are deliberately broad: any timeout → WORKER_TIMEOUT;
        // any init-related failure → WORKER_INIT_FAILED; everything else
        // (including post-init worker exceptions and structured-clone errors)
        // falls through to WORKER_UNAVAILABLE.
        var errMsg = String(workerErr && workerErr.message || workerErr);
        var code = "WORKER_UNAVAILABLE";
        if (/timed out/i.test(errMsg)) {
          code = "WORKER_TIMEOUT";
        } else if (/\binit\b|standard data/i.test(errMsg)) {
          // Matches: "init failed", "init result", "during init",
          // "before init completed", "Failed to obtain standard data"
          code = "WORKER_INIT_FAILED";
        }
        setLspState({phase:"error", filename:file && file.name,
          errors:[{code:code, path:"", message:errMsg}],
          warnings:r.warnings||[]});
      });
    });
  }

  function _handleLspEject(){
    _lspRestoreState(_lspPreImportState.current, _lspSetters());
    setDirty(true);
    _lspPreImportState.current = null;
    _lspCustomSegsRef.current = null;
    setLspState({phase:"idle"});
  }
  var lspLoaded = lspState.phase==="loaded";
  /* During the "loading" phase the worker is canonicalizing the LSP and the
     state values are about to be overwritten by _lspApplyState. Disabling
     the fieldset during loading prevents the user from making edits that
     would be silently clobbered when the canonicalization resolves.        */
  var lspLocked = lspLoaded || lspState.phase==="loading";

  /* ── Web Worker: runs scanning computation off the main thread ── */
  function getWorker(){
    if(_workerRef.current)return _workerRef.current;
    if(typeof __ENGINE_SOURCE__==="undefined")return null;
    var workerCode=__ENGINE_SOURCE__+"\n"+[
      "self.onmessage=function(e){",
      "  var p=e.data;",
      "  MPEEngine.loadStandard(p.std);",
      "  var E=MPEEngine;",
      "  var isCW=p.prf===0&&p.tau===0;",
      "  var Ep=p.prf>0?p.pw/p.prf:0;",
      "  var beam={d_1e_mm:p.dia,wl_nm:p.wl,tau_s:p.tau,prf_hz:p.prf,",
      "    pulse_energy_J:Ep,avg_power_W:p.pw,is_cw:isCW};",
      "  /* Segment-superposition framework: create scan params for all patterns */",
      "  var sepP={d_1e_mm:p.dia,prf_hz:p.prf||0,pulse_energy_J:Ep,avg_power_W:p.pw,v_scan_mm_s:p.vel,",
      "     x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "     pattern:p.pat,blanking:p.blk,is_cw:isCW,v_jump_mm_s:p.vel*5};",
      "  /* Only build segments if separable path not available */",
      "  function bldSegs(pat,x0,y0,lL,nL,h,sv,jv,d,bl){",
      "    if(pat==='linear')return E.buildLinearScan(x0,y0,0,lL,sv,d);",
      "    return E.buildRasterScan(x0,y0,lL,nL,h,sv,jv,d,bl);}",
      "  var segs=sepP?[]:bldSegs(p.pat,0,0,p.lineL,p.nLines,p.hatch,p.vel,p.vel*5,p.dia,p.blk);",
      "  var cr=E.computeScanFluence(beam,segs,p.effPpd,sepP);",
      "  if(!cr){self.postMessage({error:'Computation returned null'});return;}",
      "  var eg=cr.grid,s=cr.stats;",
      "  var minV=isCW?(s.min_velocity||p.vel):0;",
      "  var sfBeam={wl_nm:p.wl,d_1e_mm:p.dia,tau_s:p.tau,is_cw:isCW,pulse_energy_J:Ep,prf_hz:p.prf,avg_power_W:p.pw};",
      "  var sf=E.evaluateScanSafety(eg,sfBeam,s.total_time_s,p.dwm,minV,{v_mm_s:p.vel,line_spacing_mm:p.hatch||0,n_lines:p.nLines||1});",
      "  /* Max permissible power */",
      "  var unitBeam={d_1e_mm:p.dia,wl_nm:p.wl,tau_s:p.tau,prf_hz:p.prf,",
      "    pulse_energy_J:p.prf>0?1/p.prf:0,avg_power_W:1,is_cw:isCW};",
      "  var unitSepP={d_1e_mm:p.dia,prf_hz:p.prf||0,pulse_energy_J:p.prf>0?1/p.prf:0,avg_power_W:1,v_scan_mm_s:p.vel,",
      "     x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "     pattern:p.pat,blanking:p.blk,is_cw:isCW,v_jump_mm_s:p.vel*5};",
      "  var ucr=E.computeScanFluence(unitBeam,sepP?[]:segs,p.auxPpd,unitSepP);",
      "  var maxP=Infinity;",
      "  if(ucr){var upF=0;for(var i=0;i<ucr.grid.fluence.length;i++)if(ucr.grid.fluence[i]>upF)upF=ucr.grid.fluence[i];",
      "    var mpeT=E.skinMPE(p.wl,ucr.stats.total_time_s||s.total_time_s);",
      "    if(upF>0)maxP=mpeT/upF;",
      "    if(!isCW&&p.prf>0){var w2=p.dia/Math.sqrt(2);var maxPr1=E.skinMPE(p.wl,p.tau)*p.prf*Math.PI*w2*w2/(2*100);",
      "      if(maxPr1<maxP)maxP=maxPr1;}}",
      "  /* Min safe velocity bisection */",
      "  var minVel=0;",
      "  function testV(tv){",
      "    var tSepP={d_1e_mm:p.dia,prf_hz:p.prf||0,pulse_energy_J:Ep,avg_power_W:p.pw,v_scan_mm_s:tv,",
      "       x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "       pattern:p.pat,blanking:p.blk,is_cw:isCW,v_jump_mm_s:tv*5};",
      "    var ts2=tSepP?[]:bldSegs(p.pat,0,0,p.lineL,p.nLines,p.hatch,tv,tv*5,p.dia,p.blk);",
      "    var tb={d_1e_mm:p.dia,wl_nm:p.wl,tau_s:p.tau,prf_hz:p.prf,pulse_energy_J:Ep,avg_power_W:p.pw,is_cw:isCW};",
      "    var tcr=E.computeScanFluence(tb,ts2,p.auxPpd,tSepP);",
      "    if(!tcr)return true;",
      "    var tmv=isCW?(tcr.stats.min_velocity||tv):0;",
      "    var tsf=E.evaluateScanSafety(tcr.grid,sfBeam,tcr.stats.total_time_s,p.dwm,tmv,{v_mm_s:tv,line_spacing_mm:p.hatch||0,n_lines:p.nLines||1});",
      "    return tsf.safe;}",
      "  if(testV(1e6)){var vLo=0.01,vHi=1e6;",
      "    for(var bi=0;bi<p.maxBisect&&(vHi-vLo)/vLo>0.01;bi++){var vMid=(vLo+vHi)/2;if(testV(vMid))vHi=vMid;else vLo=vMid;}",
      "    minVel=vHi;}else{minVel=Infinity;}",
      "  /* Pulse positions for visualization (generated from scan params, not segments) */",
      "  var pulseArr=[];",
      "  if(!isCW&&p.prf>0){",
      "    var maxSP=5000;",
      "    var ps_mm=p.vel/p.prf;",
      "    var nPulsesLine=Math.max(1,Math.floor((p.lineL/p.vel)*p.prf));",
      "    var totalEst=nPulsesLine*(p.nLines||1);",
      "    var pStride=Math.max(1,Math.ceil(totalEst/maxSP));",
      "    var nL=p.nLines||1,hh=p.hatch||0,tAcc=0;",
      "    for(var li=0;li<nL&&pulseArr.length<maxSP;li++){",
      "      var ly=li*hh;",
      "      var scanDir=1; /* raster scans are unidirectional */",
      "      var xStart=scanDir===1?0:p.lineL;",
      "      for(var ki=0;ki<nPulsesLine&&pulseArr.length<maxSP;ki+=pStride){",
      "        var px=xStart+scanDir*ki*ps_mm;",
      "        pulseArr.push({t:tAcc+ki/p.prf,x:px,y:ly,si:li});",
      "      }",
      "      tAcc+=p.lineL/p.vel;",
      "      if(li<nL-1)tAcc+=hh/(p.vel*5);",
      "    }",
      "    if(pulseArr.length>=maxSP)p.notes.push('Showing '+maxSP+' of ~'+Math.round(totalEst)+' pulses');",
      "  }",
      "  /* Coarse segment array for scan path visualization only */",
      "  var vizSegs=[];",
      "  var MAX_VIZ_SEGS=5000;",
      "  var nL2=p.nLines||1;",
      "  var ptsPerLine=Math.ceil(p.lineL/p.dia);",
      "  /* Budget: distribute MAX_VIZ_SEGS across lines, skip lines if too many */",
      "  var lineStride=Math.max(1,Math.ceil(nL2*Math.min(ptsPerLine,200)/MAX_VIZ_SEGS));",
      "  var vizStep=Math.max(1,Math.ceil(ptsPerLine/Math.min(200,Math.floor(MAX_VIZ_SEGS/Math.ceil(nL2/lineStride)))));",
      "  for(var vli=0;vli<nL2&&vizSegs.length<MAX_VIZ_SEGS;vli+=lineStride){",
      "    var vly=vli*(p.hatch||0);",
      "    var vDir=1; /* raster is unidirectional */",
      "    var vx0=vDir===1?0:p.lineL;",
      "    var nVizPts=Math.ceil(ptsPerLine/vizStep);",
      "    for(var vsi=0;vsi<=nVizPts&&vizSegs.length<MAX_VIZ_SEGS;vsi++){",
      "      vizSegs.push({x:vx0+vDir*vsi*vizStep*p.dia,y:vly,a:vDir===1?0:Math.PI,v:p.vel});",
      "    }",
      "  }",
      "  /* Transfer TypedArrays for zero-copy performance */",
      "  var result={",
      "    g:{nx:eg.nx,ny:eg.ny,dx:eg.dx_mm,xn:eg.x_min_mm,yn:eg.y_min_mm},",
      "    flu:eg.fluence,pc:eg.pulse_count,ppH:eg.peak_pulse_H,lvt:eg.last_visit_t,mrv:eg.min_revisit_s,",
      "    st:{tt:s.total_time_s,tp:s.total_pulses||0,mv:s.min_velocity,stride:s.stride||1},",
      "    sf:{safe:sf.safe,wr:sf.worst_ratio,wx:sf.worst_x_mm,wy:sf.worst_y_mm,",
      "      br:sf.binding_rule,sm:sf.safety_margin,mt:sf.mpe_tau,mT:sf.mpe_T,",
      "      pF:sf.peak_fluence,ppM:sf.peak_pulse_H_max,mP:sf.max_pulses,",
      "      r1m:sf.rule1_max_ratio,r2m:sf.rule2_max_ratio,",
      "      minRv:sf.min_revisit_s,rvPts:sf.revisit_points,tauR:sf.thermal_relax_s,rvOk:sf.revisit_adequate,",
      "      anPeak:sf.analytical_peak,anUsed:sf.analytical_used},",
      "    maxP:maxP,minVel:minVel,pulseArr:pulseArr,segs:vizSegs,notes:p.notes};",
      "  self.postMessage(result,[eg.fluence.buffer,eg.pulse_count.buffer,eg.peak_pulse_H.buffer,eg.last_visit_t.buffer,eg.min_revisit_s.buffer]);",
      "};"
    ].join("\n");
    try{
      var blob=new Blob([workerCode],{type:"application/javascript"});
      _workerRef.current=new Worker(URL.createObjectURL(blob));
    }catch(err){
      if(typeof console!=="undefined")console.warn("Web Worker creation failed:",err);
      _workerRef.current=null;
    }
    return _workerRef.current;
  }

  var SCAN_WORKER_TIMEOUT_MS = 60000; // 60-second safety timeout
  var _workerTimeout = useRef(null);

  // Clean up Worker and timeout when ScanTab unmounts (e.g., standard change via key={stdVer})
  useEffect(function(){
    return function(){
      if(_workerRef.current){_workerRef.current.terminate();_workerRef.current=null;}
      if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
    };
  },[]);

  function calculate(){
    // ── Input validation (safety-critical) ──
    if(!isFinite(wl)||wl<180||wl>1e6){alert("Wavelength must be 180–1,000,000 nm");return;}
    if(!isFinite(dia)||dia<=0){alert("Beam diameter must be > 0");return;}
    if(!isFinite(pw)||pw<=0){alert(pwMode==="energy"?"Pulse energy must be > 0 (and PRF must be > 0 to compute average power)":"Average power must be > 0");return;}
    if(laserMode==="pulsed"){
      if(!isFinite(prf)||prf<0){alert("Repetition rate must be ≥ 0");return;}
      if(!isFinite(tau)||tau<=0){alert("Pulse duration must be > 0");return;}
    }
    // Scan area
    if(!isFinite(lineL)||lineL<=0){alert(pat!=="linear"?"Scan width must be > 0":"Scan length must be > 0");return;}
    if(pat!=="linear"){
      if(!isFinite(scanHN)||scanHN<=0){alert("Scan height must be > 0");return;}
      if(!isFinite(nLines)||nLines<1){alert("Number of scan lines must be ≥ 1");return;}
    }
    // Effective scan parameters (nLines and hatch are kept in sync via useEffect)
    var effNLines=pat!=="linear"?Math.max(1,nLines):1;
    var effHatch=pat!=="linear"&&nLines>1?scanHN/(nLines-1):scanHN;
    // Effective scan velocity from selected input mode
    var effVel;
    if(velMode==="ascans"){
      if(!isFinite(nA)||nA<=0){alert("A-lines per B-scan must be > 0");return;}
      if(prf<=0||lineL<=0){alert("PRF and B-scan width must be > 0");return;}
      effVel=lineL*prf/nA;
      if(!isFinite(effVel)||effVel<=0){alert("Invalid PRF or B-scan width");return;}
    }else if(velMode==="velocity"){
      if(!isFinite(vel)||vel<=0){alert("Scan velocity must be > 0");return;}
      effVel=vel;
    }else if(velMode==="dwell"){
      if(!isFinite(dwellN)||dwellN<=0){alert("Dwell time must be > 0");return;}
      effVel=dia/(dwellN*1e-6);
      if(!isFinite(effVel)||effVel<=0){alert("Invalid dwell time — check beam diameter");return;}
    }else if(velMode==="scanrate"){
      if(!isFinite(srateN)||srateN<=0){alert("Line scan rate must be > 0");return;}
      effVel=srateN*lineL;
      if(!isFinite(effVel)||effVel<=0){alert("Invalid line scan rate or scan width");return;}
    }else{
      if(!isFinite(frateN)||frateN<=0){alert("Frame rate must be > 0");return;}
      effVel=lineL*(pat==="linear"?1:nLines)*frateN;
      if(!isFinite(effVel)||effVel<=0){alert("Invalid frame rate or scan parameters");return;}
    }
    setCmp(true);setDirty(false);setPerfNote("");

    // ── Custom-path LSP: bypass parametric segment-building and use the
    //    LSP's engine segments directly via main-thread computation.
    //    Skipping the Worker keeps the implementation simple — the Worker's
    //    code template builds its own segments from pat/lineL/nLines, which
    //    is wrong for custom paths.  Custom-path LSPs typically have <50000
    //    segments (canonicalize.js caps at maxEngineSegments), well within
    //    main-thread performance.  See web/lsp/canonicalize.js mode 2/3.
    if (_lspCustomSegsRef.current) {
      var _customData = _lspCustomSegsRef.current;
      var _customNotes = [];
      if (_customData.hasBlankedSegments) {
        _customNotes.push("Custom path includes blanked (flyback) segments; these advance time but deposit no fluence");
      }
      _customNotes.push("Custom-path LSP: " + _customData.segments.length +
        " engine segments, main-thread computation");
      // Abandon any in-flight Worker from a previous (non-custom) Calculate.
      // We TERMINATE rather than just detach handlers, because the worker may
      // have a message queued or in-flight whose result would otherwise be
      // received by the next preset Calculate's reassigned onmessage handler
      // (the worker queues messages and processes them in order, posting
      // replies to whatever main-thread handler is currently installed).
      // The next preset Calculate creates a fresh worker via getWorker(),
      // costing ~50 ms one time per "custom → preset" transition.
      if (_workerRef.current) {
        try { _workerRef.current.terminate(); } catch (_) {}
        _workerRef.current = null;
      }
      if (_workerTimeout.current) {
        clearTimeout(_workerTimeout.current);
        _workerTimeout.current = null;
      }
      setTimeout(function(){
        // Race-condition guard: the user may have clicked Eject during the
        // 60 ms timeout (the Calculate button sits outside the lspLocked
        // fieldset and so is enabled even while LSP is loaded).  If the ref
        // has been cleared or replaced, abort: the post-Eject state no
        // longer matches the captured custom segments, and proceeding would
        // mix data from two different scan configurations.
        if (_lspCustomSegsRef.current !== _customData) {
          setCmp(false);
          return;
        }
        calculateMainThread(_customData.segments, 8, 3, 0, _customNotes);
      }, 60);
      return;
    }

    // ── Performance estimation ──
    // For separable-eligible scans, compute estimates from params directly
    // (avoids OOM from segment construction for micro-beams)
    var calcPrf=laserMode==="cw"?0:prf;
    var calcTau=laserMode==="cw"?0:tau;
    var isCWEst=laserMode==="cw";
    var canSep=((!isCWEst&&calcPrf>0)||(isCWEst&&pw>0))&&(pat==="linear"||pat==="raster"||pat==="bidi");
    var segsEst=canSep?[]:null;
    var estTime,estPulses;
    if(canSep){
      var lineDurEst=lineL/effVel;
      var nLEst=pat==="linear"?1:effNLines;
      var jumpVEst=effVel*5;
      var hatchEst=pat==="linear"?0:(effHatch||dia);
      var flybackEst=pat==="linear"?0:(pat==="bidi"?(hatchEst/jumpVEst):(lineL/jumpVEst+hatchEst/jumpVEst));
      estTime=nLEst*lineDurEst+(nLEst-1)*flybackEst;
      estPulses=calcPrf*nLEst*lineDurEst;
    }else{
      /* Non-separable (CW): guard against huge nLines — use analytical estimation if >10000 lines */
      if(effNLines>10000){
        var lineDurEst2=lineL/effVel;
        var jumpVEst2=effVel*5;
        var hatchEst2=pat==="linear"?0:(effHatch||dia);
        var flybackEst2=pat==="linear"?0:(pat==="bidi"?(hatchEst2/jumpVEst2):(lineL/jumpVEst2+hatchEst2/jumpVEst2));
        estTime=effNLines*lineDurEst2+(effNLines-1)*flybackEst2;
        estPulses=0; /* CW — no discrete pulses */
        segsEst=[];
      }else{
        if(pat==="linear") segsEst=scanBuildLinear(0,0,0,lineL,effVel,dia);
        else segsEst=scanBuildRaster(0,0,lineL,effNLines,effHatch,effVel,effVel*5,dia,blk);
        estTime=0;for(var ei=0;ei<segsEst.length;ei++)estTime+=dia/segsEst[ei].v;
        estPulses=calcPrf*estTime;
      }
    }
    var sigma=dia/(2*Math.sqrt(2)),estDx=dia/ppd;
    var trunc=Math.ceil(3*sigma/estDx);
    var estOps=canSep?0:estPulses*Math.PI*trunc*trunc; // separable path doesn't scale with ops
    var effPpd=ppd,notes=[];
    if(!canSep&&estOps>_E.OP_BUDGET&&ppd>3){
      for(effPpd=ppd-1;effPpd>=3;effPpd--){
        var dx2=dia/effPpd,tr2=Math.ceil(3*sigma/dx2);
        if(estPulses*Math.PI*tr2*tr2<_E.OP_BUDGET)break;
      }
      effPpd=Math.max(3,effPpd);
      notes.push("Grid auto-reduced to "+effPpd+" pts/dia for "+Math.round(estPulses/1000)+"k pulses");
    }
    /* separable engine note removed — implementation detail not shown to user */
    else if(estPulses>_E.DEFAULT_MAX_COMPUTE_PULSES){
      var estStride=Math.ceil(estPulses/_E.DEFAULT_MAX_COMPUTE_PULSES);
      notes.push("Pulse subsampling active (stride="+estStride+"): computing 1 in every "+estStride+" pulses for "+Math.round(estPulses/1000)+"k total");
    }
    var auxPpd=Math.min(effPpd,3);
    var maxBisect=canSep?3:(estPulses>100000?6:estPulses>10000?8:15);

    // ── Try Web Worker (off main thread) ──
    var worker=getWorker();
    if(worker){
      var params={std:_std,wl:wl,dia:dia,tau:calcTau,prf:calcPrf,pw:pw,
        pat:pat,lineL:lineL,nLines:effNLines,hatch:effHatch,vel:effVel,dwm:dwm,blk:blk,
        effPpd:effPpd,auxPpd:auxPpd,maxBisect:maxBisect,notes:notes,estPulses:estPulses};
      // Safety timeout: kill Worker if it takes too long
      if(_workerTimeout.current)clearTimeout(_workerTimeout.current);
      _workerTimeout.current=setTimeout(function(){
        if(_workerRef.current){_workerRef.current.terminate();_workerRef.current=null;}
        setPerfNote("Computation timed out after 60 seconds. Try reducing line count, increasing hatch spacing, or lowering PRF.");
        setCmp(false);
      },SCAN_WORKER_TIMEOUT_MS);
      worker.onmessage=function(ev){
        if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
        var r=ev.data;
        if(r.error){if(typeof console!=="undefined")console.error("Worker error:",r.error);setCmp(false);return;}
        /* Reconstruct grid with transferred TypedArrays */
        var g={nx:r.g.nx,ny:r.g.ny,dx:r.g.dx,xn:r.g.xn,yn:r.g.yn,
          flu:r.flu,pc:r.pc,ppH:r.ppH,lvt:r.lvt,mrv:r.mrv};
        var isCW2=laserMode==="cw";
        var beam2={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:calcPrf>0?pw/calcPrf:0,P:pw,cw:isCW2};
        if(r.notes&&r.notes.length>0)setPerfNote(r.notes.join(". ")+".");
        /* PA: scale cumulative quantities by averages per location
           — peak fluence and pulse count scale linearly with N_BM,
             but the cumulative MPE must be recomputed at the new total exposure time
             because skinMPE(wl,t) has t-regime structure. */
        var nBMm=Math.max(1,Math.round(nBM));
        var sfAdj=r.sf;
        var stAdj=Object.assign({},r.st,{tt:r.st.tt*nBMm});
        if(nBMm>1){
          var T_total_pa=r.st.tt*nBMm;
          var newMPE_T_pa=skinMPE(wl,T_total_pa);
          var newPF_pa=r.sf.pF*nBMm;
          sfAdj=Object.assign({},r.sf);
          sfAdj.pF=newPF_pa;
          sfAdj.mT=newMPE_T_pa;
          sfAdj.r2m=isFinite(newMPE_T_pa)&&newMPE_T_pa>0?(newPF_pa/newMPE_T_pa):Infinity;
          sfAdj.mP=r.sf.mP*nBMm;
          sfAdj.safe=Math.max(sfAdj.r1m,sfAdj.r2m)<=1;
          sfAdj.sm=1-Math.max(sfAdj.r1m,sfAdj.r2m);
          sfAdj.br=sfAdj.r1m>=sfAdj.r2m?"Rule 1":"Rule 2";
        }
        setRes({g:g,st:stAdj,sf:sfAdj,segs:r.segs,beam:beam2,maxP:r.maxP,minV:r.minVel,
          pulses:r.pulseArr,effPpd:effPpd,effNLines:effNLines,effHatch:effHatch,effVel:effVel,nBM:nBMm});
        setCmp(false);
      };
      worker.onerror=function(err){
        if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
        if(typeof console!=="undefined")console.error("Worker error:",err);
        /* Fall back to main-thread computation */
        calculateMainThread(segsEst,effPpd,auxPpd,maxBisect,notes);
      };
      worker.postMessage(params);
      return;
    }

    // ── Fallback: main-thread computation ──
    setTimeout(function(){calculateMainThread(segsEst,effPpd,auxPpd,maxBisect,notes);},60);
  }

  function calculateMainThread(segs,effPpd,auxPpd,maxBisect,notes){
    try{
      var calcPrf=laserMode==="cw"?0:prf;
      var calcTau=laserMode==="cw"?0:tau;
      var Ep=calcPrf>0?pw/calcPrf:0;
      var isCW=laserMode==="cw";
      var beam={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:Ep,P:pw,cw:isCW};

      // Derive effective scan params (same logic as calculate())
      var effNLines=pat!=="linear"?Math.max(1,nLines):1;
      var effHatch=pat!=="linear"&&nLines>1?scanHN/(nLines-1):scanHN;
      var effVel=velMode==="dwell"?dia/(dwellN*1e-6):velMode==="scanrate"?srateN*lineL:velMode==="framerate"?lineL*(pat==="linear"?1:nLines)*frateN:vel;

      // Build separable params if applicable (same logic as Worker).
      // For custom-path LSPs, force canSep=false so we use the segment-array
      // path with the LSP's actual engine segments rather than building from
      // pat/lineL/nLines (which would describe a rectangular raster).
      var _isLspCustom = !!_lspCustomSegsRef.current;
      var canSep=!_isLspCustom && ((!isCW&&calcPrf>0)||(isCW&&pw>0))&&(pat==="linear"||pat==="raster"||pat==="bidi");
      function mkSepP(vv,ep,optP){
        if(!canSep)return null;
        return{d_1e_mm:dia,prf_hz:calcPrf,pulse_energy_J:ep||Ep,avg_power_W:optP!==undefined?optP:pw,v_scan_mm_s:vv,
          x0:0,y0:0,line_length_mm:lineL,n_lines:pat==="linear"?1:effNLines,
          hatch_mm:pat==="linear"?0:effHatch,pattern:pat,blanking:blk,is_cw:isCW,v_jump_mm_s:vv*5};
      }

      var cr=scanCompute(beam,canSep?[]:segs,effPpd,mkSepP(effVel));
      if(cr){
        var minV=isCW?(cr.st.mv||effVel):0;
        var sf=scanSafety(cr.g,beam,cr.st.tt,dwm,minV,{v_mm_s:effVel,line_spacing_mm:pat==="linear"?0:effHatch,n_lines:pat==="linear"?1:effNLines});
        var unitBeam={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:calcPrf>0?1/calcPrf:0,P:1,cw:isCW};
        var unitCr=scanCompute(unitBeam,canSep?[]:segs,auxPpd,mkSepP(effVel,calcPrf>0?1/calcPrf:0,1));
        var maxP=Infinity;
        if(unitCr){
          var upF=0;for(var ui=0;ui<unitCr.g.nx*unitCr.g.ny;ui++)if(unitCr.g.flu[ui]>upF)upF=unitCr.g.flu[ui];
          var mpeT=skinMPE(wl,unitCr.st.tt||cr.st.tt);
          if(upF>0)maxP=mpeT/upF;
          if(!isCW&&calcPrf>0){var w22=dia/Math.sqrt(2);var maxPr1=skinMPE(wl,calcTau)*calcPrf*Math.PI*w22*w22/(2*100);
            if(maxPr1<maxP)maxP=maxPr1;}
        }
        // Custom-path: no single velocity to scale uniformly (per-segment
        // velocities), so the "minimum safe velocity" question doesn't apply.
        // Use Infinity so display shows "—" rather than misleading "0 mm/s".
        var minVel=_isLspCustom?Infinity:0;
        if(!canSep&&effNLines<=10000&&!_isLspCustom){
          // Only run bisection on the main thread for brute-force paths
          // (separable scans use the Worker; if it fails, skip bisection to prevent UI freeze).
          // Custom-path LSPs are also skipped: each segment has its own velocity
          // (per-segment v_mm_s from the LSP), so a single "minimum safe velocity"
          // value isn't meaningful — scaling all segments uniformly to find a safe
          // velocity would silently misrepresent the user's intended scan pattern.
          function testV(tv){
            var ts;
            if(pat==="linear")ts=scanBuildLinear(0,0,0,lineL,tv,dia);
            else ts=scanBuildRaster(0,0,lineL,effNLines,effHatch,tv,tv*5,dia,blk);
            var tb={wl:wl,d:dia,tau:calcTau,prf:calcPrf,Ep:Ep,P:pw,cw:isCW};
            var tcr2=scanCompute(tb,ts,auxPpd);
            if(!tcr2)return true;
            var tmv=isCW?(tcr2.st.mv||tv):0;
            var tsf2=scanSafety(tcr2.g,tb,tcr2.st.tt,dwm,tmv,{v_mm_s:tv,line_spacing_mm:pat==="linear"?0:effHatch,n_lines:pat==="linear"?1:effNLines});
            return tsf2.safe;
          }
          if(testV(1e6)){var vLo=0.01,vHi=1e6;
            for(var bi=0;bi<maxBisect&&(vHi-vLo)/vLo>0.01;bi++){var vMid=(vLo+vHi)/2;if(testV(vMid))vHi=vMid;else vLo=vMid;}
            minVel=vHi;}else{minVel=Infinity;}
        }

        // Generate pulse positions and viz segments.
        // For preset patterns: derive from pat/lineL/nLines/hatch (parametric).
        // For custom-path LSPs: derive from the LSP's actual engine segments
        // (sub-sampled for performance) so the visualization shows the real
        // scan trajectory rather than a fictitious raster.
        var pulseArr=[];
        var vizSegs2=[];
        var MAX_VIZ2=5000;
        if (_isLspCustom) {
          // Custom path: stride-sample the LSP segments for viz.  Each segment
          // already has {x_start_mm, y_start_mm, angle_rad, v_mm_s} so we add
          // short-name aliases (x, y, a, v) inline to match the renderer's
          // expectations without mutating the LSP-owned array.
          var _customSegs = _lspCustomSegsRef.current.segments;
          var _cStride = Math.max(1, Math.ceil(_customSegs.length / MAX_VIZ2));
          for (var _ci = 0; _ci < _customSegs.length && vizSegs2.length < MAX_VIZ2; _ci += _cStride) {
            var _cs = _customSegs[_ci];
            if (_cs && !_cs.blanked) {
              vizSegs2.push({
                x: _cs.x_start_mm, y: _cs.y_start_mm,
                a: _cs.angle_rad, v: _cs.v_mm_s
              });
            }
          }
          // Pulse positions: for custom paths we don't generate a per-pulse
          // array (the timing diagram assumes a regular raster lattice).  The
          // worst-case point overlay still works because it reads from the
          // grid, not the pulse array.
        } else if(!isCW&&calcPrf>0){
          var maxSP2=5000,ps_mm2=effVel/calcPrf;
          var nPL2=Math.max(1,Math.floor((lineL/effVel)*calcPrf));
          var nLV=pat==="linear"?1:effNLines;
          var totalEst2=nPL2*nLV;
          var pStride2=Math.max(1,Math.ceil(totalEst2/maxSP2));
          var tAcc2=0;
          for(var li2=0;li2<nLV&&pulseArr.length<maxSP2;li2++){
            var ly2=li2*(pat==="linear"?0:effHatch);
            for(var ki2=0;ki2<nPL2&&pulseArr.length<maxSP2;ki2+=pStride2){
              pulseArr.push({t:tAcc2+ki2/calcPrf,x:ki2*ps_mm2,y:ly2,si:li2});
            }
            tAcc2+=lineL/effVel;if(li2<nLV-1)tAcc2+=(pat==="linear"?0:effHatch)/(effVel*5);
          }
        }
        // Capped viz segments (parametric path; custom path filled above)
        if (!_isLspCustom) {
          var nLV2=pat==="linear"?1:effNLines;
          var ppl2=Math.ceil(lineL/dia);
          var lStr2=Math.max(1,Math.ceil(nLV2*Math.min(ppl2,200)/MAX_VIZ2));
          var vStp2=Math.max(1,Math.ceil(ppl2/Math.min(200,Math.floor(MAX_VIZ2/Math.ceil(nLV2/lStr2)))));
          for(var vl2=0;vl2<nLV2&&vizSegs2.length<MAX_VIZ2;vl2+=lStr2){
            var vly2=vl2*(pat==="linear"?0:effHatch);
            var nVP2=Math.ceil(ppl2/vStp2);
            for(var vs2=0;vs2<=nVP2&&vizSegs2.length<MAX_VIZ2;vs2++){
              vizSegs2.push({x:vs2*vStp2*dia,y:vly2,a:0,v:effVel});
            }
          }
        }

        if(notes.length>0)setPerfNote(notes.join(". ")+".");
        /* PA: scale cumulative quantities by averages per location
           (see worker-callback variant for the MPE-recomputation rationale) */
        var nBMm2=Math.max(1,Math.round(nBM));
        var sfMt=sf;
        var stMt=Object.assign({},cr.st,{tt:cr.st.tt*nBMm2});
        if(nBMm2>1){
          var T_total_pa2=cr.st.tt*nBMm2;
          var newMPE_T_pa2=skinMPE(wl,T_total_pa2);
          var newPF_pa2=sf.pF*nBMm2;
          sfMt=Object.assign({},sf);
          sfMt.pF=newPF_pa2;
          sfMt.mT=newMPE_T_pa2;
          sfMt.r2m=isFinite(newMPE_T_pa2)&&newMPE_T_pa2>0?(newPF_pa2/newMPE_T_pa2):Infinity;
          sfMt.mP=sf.mP*nBMm2;
          sfMt.safe=Math.max(sfMt.r1m,sfMt.r2m)<=1;
          sfMt.sm=1-Math.max(sfMt.r1m,sfMt.r2m);
          sfMt.br=sfMt.r1m>=sfMt.r2m?"Rule 1":"Rule 2";
        }
        setRes({g:cr.g,st:stMt,sf:sfMt,segs:vizSegs2,beam:beam,maxP:maxP,minV:minVel,
          pulses:pulseArr,effPpd:effPpd,effNLines:effNLines,effHatch:effHatch,effVel:effVel,nBM:nBMm2});
      }
    }catch(err){if(typeof console!=="undefined")console.error("Calculation error:",err);}
    setCmp(false);
  }

  /* ── ECharts theme config (Paul Tol High-Contrast) ── */
  var ec=useMemo(function(){
    var dk=theme==="dark";
    return {
      bg:dk?"#14171A":"#FAFAFA",
      panel:dk?"#1E1E1E":"#FFFFFF",
      grid:dk?"#2E2E2E":"#E8E8E8",
      spine:dk?"#AAAAAA":"#444444",
      tick:dk?"#9CA3AF":"#555555",
      title:dk?"#E0E0E0":"#222222",
      stem:dk?"#6CB3FF":"#004488",
      stemShaft:dk?"rgba(187,187,187,0.55)":"rgba(136,136,136,0.55)",
      cumLine:dk?"#EE99AA":"#BB5566",
      mpe:dk?"#DDAA33":"#DDAA33",
      sub:dk?"#888888":"#777777",
      navBg:dk?"#252525":"#F0F0F0",
      navWin:dk?"rgba(108,179,255,0.12)":"rgba(0,68,136,0.08)",
      navBorder:dk?"rgba(108,179,255,0.4)":"rgba(0,68,136,0.35)"
    };
  },[theme]);

  var ptTimRef=useRef(null);
  var _chartRef=useRef(null);

  /* Reset selPt when new results arrive */
  useEffect(function(){setSelPt(null);},[res]);

  /* ── Dispose ECharts instance on unmount ── */
  useEffect(function(){
    return function(){
      if(_chartRef.current){_chartRef.current.dispose();_chartRef.current=null;}
    };
  },[]);

  /* ── Point Timing Diagram: pulse arrivals + cumulative fluence at a point ── */
  useEffect(function(){
    if(!res||!ptTimRef.current||typeof echarts==="undefined")return;
    if(prf<=0||pw<=0)return;
    /* Custom-path LSPs don't form a regular raster, so the parametric pulse
       arrival math below (which iterates over lines and pulse spacings)
       doesn't apply.  The JSX renders a placeholder card instead.          */
    if(_lspCustomSegsRef.current)return;

    var w=dia/Math.sqrt(2),sigma=dia/(2*Math.sqrt(2)),w2=w*w;
    var Ep=pw/prf;
    var H0=2*Ep/(Math.PI*w2)*100; // J/cm\u00b2
    var ps=vel/prf; // pulse spacing mm
    var trunc=3*sigma;
    var trunc2=trunc*trunc;
    var nPL=Math.max(1,Math.floor((lineL/vel)*prf));
    var lineDur=lineL/vel;
    var nL=pat==="linear"?1:(res.effNLines||1);
    var hh=pat==="linear"?0:(res.effHatch||hatch);
    var jumpV=vel*5;
    var flybackTime=(pat==="linear"||nL<=1)?0:(lineL/jumpV+hh/jumpV);

    // Determine observation point
    var obsX,obsY;
    if(selPt){obsX=selPt.x;obsY=selPt.y;}
    else{
      var g=res.g,maxF=0,maxIdx=0;
      for(var gi=0;gi<g.nx*g.ny;gi++){if(g.flu[gi]>maxF){maxF=g.flu[gi];maxIdx=gi;}}
      var giy=Math.floor(maxIdx/g.nx),gix=maxIdx-giy*g.nx;
      obsX=g.xn+gix*g.dx;obsY=g.yn+giy*g.dx;
    }

    // Collect pulse contributions at the observation point
    var events=[];
    var tLineStart=0;
    for(var li=0;li<nL;li++){
      var yLine=li*hh;
      var dy=obsY-yLine;
      var dy2=dy*dy;
      if(dy2>trunc2){tLineStart+=lineDur+(li<nL-1?flybackTime:0);continue;}
      var crossAtt=Math.exp(-2*dy2/w2);
      var scanDir=1;
      var xStart=scanDir===1?0:lineL;
      var kCenter=(obsX-xStart)/(scanDir*ps);
      var kRange=trunc/ps;
      var kMin=Math.max(0,Math.ceil(kCenter-kRange));
      var kMax=Math.min(nPL-1,Math.floor(kCenter+kRange));
      for(var k=kMin;k<=kMax;k++){
        var xPulse=xStart+scanDir*k*ps;
        var dx=obsX-xPulse;
        var dx2=dx*dx;
        if(dx2>trunc2)continue;
        var alongAtt=Math.exp(-2*dx2/w2);
        var Hdep=H0*alongAtt*crossAtt;
        if(Hdep<H0*1e-6)continue;
        var tPulse=tLineStart+k/prf;
        events.push({t:tPulse,H:Hdep});
      }
      tLineStart+=lineDur+(li<nL-1?flybackTime:0);
    }

    events.sort(function(a,b){return a.t-b.t;});
    var totalTime=res.st.tt;
    var mpeVal=skinMPE(wl,totalTime);

    // Build cumulative step data and impulse data
    var cumData=[];
    var impulseData=[];
    var cumH=0;
    cumData.push([0,0]);
    for(var ei=0;ei<events.length;ei++){
      var ev=events[ei];
      cumData.push([ev.t,cumH]);
      cumH+=ev.H;
      cumData.push([ev.t,cumH]);
      impulseData.push([ev.t,ev.H]);
    }
    cumData.push([totalTime,cumH]);

    // Scale time for readability
    var tScale=1,tUnit="s";
    if(totalTime<0.01){tScale=1e6;tUnit="\u00b5s";}
    else if(totalTime<10){tScale=1e3;tUnit="ms";}

    var cumScaled=cumData.map(function(p){return [p[0]*tScale,p[1]];});
    var impulseScaled=impulseData.map(function(p){return [p[0]*tScale,p[1]];});

    var safetyRatio=cumH/mpeVal;

    // ── ECharts rendering ──
    if(_chartRef.current){_chartRef.current.dispose();_chartRef.current=null;}
    var chart=echarts.init(ptTimRef.current,null,{renderer:"canvas"});
    _chartRef.current=chart;

    var fontFamily="'IBM Plex Sans', system-ui, -apple-system, sans-serif";

    var option={
      backgroundColor:"transparent",
      animation:false,
      textStyle:{fontFamily:fontFamily},

      /* Panel labels: (a) and (b) per COMSOL/Optica convention */
      title:[
        {text:"(a) Per-pulse fluence",left:68,top:4,
         textStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:600,color:ec.title}},
        {text:"(b) Cumulative fluence",left:68,top:"39%",
         textStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:600,color:ec.title}}
      ],

      /* Two stacked grids with room for panel labels and legends */
      grid:[
        {left:68,right:20,top:24,height:"22%"},
        {left:68,right:20,top:"48%",height:"38%"}
      ],

      xAxis:[
        {type:"value",gridIndex:0,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{show:false},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         min:0,max:totalTime*tScale},
        {type:"value",gridIndex:1,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{show:true,fontFamily:fontFamily,fontSize:10,color:ec.tick,
           formatter:function(v){return v%1===0?String(v):v.toFixed(1);}},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         name:"Time ("+tUnit+")",nameLocation:"middle",nameGap:28,
         nameTextStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:500,color:ec.title},
         min:0,max:totalTime*tScale}
      ],

      yAxis:[
        {type:"value",gridIndex:0,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{fontFamily:fontFamily,fontSize:10,color:ec.tick,
           formatter:function(v){return v<0.001&&v>0?v.toExponential(1):numFmt(v,2);}},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         name:"Fluence (J/cm\u00b2)",nameLocation:"middle",nameGap:52,
         nameTextStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:500,color:ec.title},
         min:0},
        {type:"value",gridIndex:1,
         axisLine:{show:true,lineStyle:{color:ec.spine,width:1}},
         axisTick:{show:true,length:4,inside:false,lineStyle:{color:ec.spine}},
         axisLabel:{fontFamily:fontFamily,fontSize:10,color:ec.tick,
           formatter:function(v){return v<0.001&&v>0?v.toExponential(1):numFmt(v,3);}},
         splitLine:{show:true,lineStyle:{color:ec.grid,width:0.5}},
         name:"Fluence (J/cm\u00b2)",nameLocation:"middle",nameGap:52,
         nameTextStyle:{fontFamily:fontFamily,fontSize:11,fontWeight:500,color:ec.title},
         min:0}
      ],

      toolbox:{show:false},

      /* Per-panel legends — each panel gets its own legend inside the plot area (COMSOL/MATLAB convention) */
      legend:[
        {data:["Per-pulse fluence"],
         top:24,right:28,orient:"vertical",
         itemWidth:20,itemHeight:3,
         icon:"roundRect",
         textStyle:{fontFamily:fontFamily,fontSize:10,color:ec.tick},
         backgroundColor:"rgba(255,255,255,0.88)",
         borderColor:ec.grid,borderWidth:1,
         padding:[4,8]},
        {data:["Cumulative fluence","MPE limit"],
         top:"48%",right:28,orient:"vertical",
         itemWidth:20,itemHeight:3,itemGap:8,
         textStyle:{fontFamily:fontFamily,fontSize:10,color:ec.tick},
         backgroundColor:"rgba(255,255,255,0.88)",
         borderColor:ec.grid,borderWidth:1,
         padding:[4,8]}
      ],

      /* Linked axis pointers across panels — COMSOL/MATLAB synchronized cursor convention */
      axisPointer:{link:[{xAxisIndex:"all"}]},

      tooltip:{
        trigger:"axis",
        axisPointer:{type:"line",lineStyle:{color:ec.spine,width:1,type:"dashed"}},
        textStyle:{fontFamily:fontFamily,fontSize:11},
        formatter:function(params){
          if(!params||!params.length)return "";
          var t=params[0].value[0];
          var out=["<b>t = "+numFmt(t,4)+" "+tUnit+"</b>"];
          for(var pi=0;pi<params.length;pi++){
            var p=params[pi];
            if(p.seriesName==="MPE limit")continue;
            out.push(p.marker+" "+p.seriesName+": "+numFmt(p.value[1],4)+" J/cm\u00b2");
          }
          return out.join("<br>");
        }
      },

      series:[
        {name:"Per-pulse fluence",type:"bar",xAxisIndex:0,yAxisIndex:0,
         data:impulseScaled,
         barWidth:Math.max(1,Math.min(3,400/Math.max(1,impulseScaled.length))),
         itemStyle:{color:ec.stem},
         emphasis:{itemStyle:{color:ec.stem}},
         large:true,largeThreshold:500},

        {name:"Cumulative fluence",type:"line",xAxisIndex:1,yAxisIndex:1,
         data:cumScaled,
         step:false,
         lineStyle:{color:ec.cumLine,width:2,type:"solid"},
         areaStyle:{color:ec.cumLine,opacity:0.04},
         symbol:"none",
         emphasis:{disabled:true}},

        {name:"MPE limit",type:"line",xAxisIndex:1,yAxisIndex:1,
         data:[[0,mpeVal],[totalTime*tScale,mpeVal]],
         lineStyle:{color:ec.mpe,width:1.5,type:"dashed"},
         symbol:"none",
         emphasis:{disabled:true},
         /* Mark the MPE value with a label on the line */
         markPoint:{
           symbol:"rect",symbolSize:[1,1],
           label:{show:true,position:"insideRight",
             formatter:function(){return "MPE = "+numFmt(mpeVal,4)+" J/cm\u00b2";},
             fontFamily:fontFamily,fontSize:9,fontWeight:600,color:ec.mpe,
             backgroundColor:"rgba(255,255,255,0.88)",
             borderColor:ec.mpe,borderWidth:0.5,borderRadius:4,
             padding:[2,6]},
           data:[{coord:[totalTime*tScale*0.02,mpeVal]}]
         }}
      ]
    };

    chart.setOption(option);

    var onResize=function(){chart.resize();};
    window.addEventListener("resize",onResize);

    return function(){
      window.removeEventListener("resize",onResize);
    };
  },[res,ec,dia,wl,pw,prf,vel,lineL,pat,hatch,scanHN,selPt]);

  /* ── Scan pattern visualization: pre-computed values ──────────── */
  /* Engineering notation for dimension labels */
  function svFmtDim(val){
    if(!isFinite(val)||val===0)return "0 mm";
    var av=Math.abs(val);
    if(av>=1e6)return (val/1e6).toPrecision(4)+" km";
    if(av>=1e3)return (val/1e3).toPrecision(4)+" m";
    if(av>=0.1)return +val.toPrecision(4)+" mm";
    if(av>=1e-4)return (val*1e3).toPrecision(4)+" \u00b5m";
    if(av>=1e-7)return (val*1e6).toPrecision(4)+" nm";
    return val.toExponential(2)+" mm";
  }
  /* Scan pattern visualization: pre-computed values */
  var _isLt=theme==="light";
  var vc={
    mark:_isLt?"#334155":"#94A3B8", jump:_isLt?"#94A3B8":"#64748B",
    dimAct:_isLt?"#64748B":"#94A3B8", dimDer:_isLt?"#94A3B8":"#64748B",
    canvas:_isLt?"#FAFBFC":"#1A1F27", canvasBd:_isLt?"rgba(15,23,42,0.08)":"rgba(255,255,255,0.08)",
    gridMin:_isLt?"#E8ECF0":"#252D38", gridMaj:_isLt?"#E0E4EA":"#2A3340",
    area:_isLt?"none":"none",
    areaBd:_isLt?"#CBD5E1":"#475569",
    lbl:_isLt?"#475569":"#94A3B8", legTx:_isLt?"#475569":"#94A3B8",
    lbl2:_isLt?"#334155":"#CBD5E1",
    corr:_isLt?0.04:0.06,
    hc:_isLt?"#64748B":"#94A3B8",
    axX:"#94A3B8", axY:"#94A3B8"
  };
  var svBtnBg=_isLt?"#F1F5F9":"#1E293B";
  var svBtnBd=_isLt?"#CBD5E1":"#475569";
  var svIc=_isLt?"#64748B":"#94A3B8";
  /* Fixed canvas — wider left padding for hatch callout */
  var svW_c=460,svH_c=260;
  var svPd_t=24,svPd_r=44,svPd_b=36,svPd_l=80;
  var svPlW=svW_c-svPd_l-svPd_r, svPlH=svH_c-svPd_t-svPd_b;
  /* Independent x/y scaling */
  var svPatW=Math.max(lineL,0.001);
  // For custom-path LSPs, ALWAYS use the actual bbox height — regardless of
  // the user's pre-import `pat` value (which is preserved under the disabled
  // UI and may still be "linear" even though the imported path is 2D).  The
  // parametric-pattern branch keeps its existing logic: "linear" gets a 35%
  // aspect ratio (since scanHN is irrelevant for a single-line scan), other
  // patterns use scanHN.
  var svPatH=_lspCustomSegsRef.current
    ? Math.max(scanHN||1,0.001)
    : (pat==="linear"?Math.max(svPatW*0.35,Math.max(dia,0.001)*4):Math.max(scanHN||1,0.001));
  var svScX=(svPlW*0.85)/svPatW;
  var svScY=(svPlH*0.85)/svPatH;
  var svOx=svPd_l+(svPlW-svPatW*svScX)/2;
  var svOy=svPd_t+(svPlH-svPatH*svScY)/2;
  var svRW=svPatW*svScX, svRH=svPatH*svScY;
  var svBSc=Math.min(svScX,svScY);
  var svBeamR=Math.max((dia/Math.sqrt(2))*svBSc,1.5);
  svBeamR=Math.min(svBeamR,Math.min(svRW,svRH)/2);
  /* Fix 1: beam suppression when beam >> scan area */
  var svBeamOwl=dia>Math.max(lineL,scanHN||0)*2;
  var svRenderBeam=svBeam&&!svBeamOwl;
  /* Fix 2: line decimation */
  var svHtVis=(nLines>1&&scanHN>0)?scanHN/(nLines-1):0;
  var svLinePx=svHtVis*svScY;
  var svTooMany=pat!=="linear"&&nLines>1&&svLinePx<4;
  var svDecIndices=null;
  if(svTooMany){
    var svMaxShow=12;
    var sdSet={};sdSet[0]=true;sdSet[nLines-1]=true;
    for(var sdi=1;sdi<svMaxShow-1;sdi++){sdSet[Math.round(sdi*(nLines-1)/(svMaxShow-1))]=true;}
    svDecIndices=[];for(var sdk in sdSet){if(sdSet.hasOwnProperty(sdk))svDecIndices.push(Number(sdk));}
    svDecIndices.sort(function(a,b){return a-b;});
  }
  var svDecCount=svDecIndices?svDecIndices.length:0;
  var svMarks=[],svJumps=[];
  /* Custom-path LSP: replace the parametric raster lines with the actual
     LSP segments, polyline-style.  For SHORT paths (≤800 segments) every
     segment renders as its own short line, giving a continuous path.  For
     LONG paths we stride-sample and connect consecutive sampled positions
     so the viz remains a continuous polyline (rather than sparse dots).
     Blanked segments end the current polyline so flybacks render as gaps.
     Segments were already translated to bbox origin in _lspApplyState, so
     the same svOx/svOy/svScX/svScY mapping as parametric paths applies.   */
  if (_lspCustomSegsRef.current) {
    var _customSegs_sv = _lspCustomSegsRef.current.segments;
    var _customD_sv = _lspCustomSegsRef.current.d_1e_mm || dia || 0.001;
    var _svMaxCustom = 800;  // cap polyline points so SVG stays responsive
    var _svCustomStride = Math.max(1, Math.ceil(_customSegs_sv.length / _svMaxCustom));
    // Helper: find the next non-blanked segment at or after index `from`,
    // stepping by `stride`.  Returns null if none.
    function _svNextVisible(arr, from, stride) {
      for (var j = from; j < arr.length; j += stride) {
        if (arr[j] && !arr[j].blanked) return { seg: arr[j], idx: j };
      }
      return null;
    }
    if (_svCustomStride === 1) {
      // Short path: render every segment as its own beam-diameter-long line.
      for (var _svci0 = 0; _svci0 < _customSegs_sv.length; _svci0++) {
        var _csg0 = _customSegs_sv[_svci0];
        if (!_csg0 || _csg0.blanked) continue;
        var _csx10 = _csg0.x_start_mm, _csy10 = _csg0.y_start_mm;
        var _csx20 = _csx10 + _customD_sv * Math.cos(_csg0.angle_rad || 0);
        var _csy20 = _csy10 + _customD_sv * Math.sin(_csg0.angle_rad || 0);
        svMarks.push({
          x1: svOx + _csx10 * svScX, y1: svOy + _csy10 * svScY,
          x2: svOx + _csx20 * svScX, y2: svOy + _csy20 * svScY,
          idx: _svci0
        });
      }
    } else {
      // Long path: connect consecutive sampled positions as a polyline.
      // A blanked segment between samples breaks the line (renders as a gap).
      var _curAnchor = _svNextVisible(_customSegs_sv, 0, _svCustomStride);
      while (_curAnchor) {
        var _nextAnchor = _svNextVisible(_customSegs_sv, _curAnchor.idx + _svCustomStride, _svCustomStride);
        if (_nextAnchor) {
          // Detect a blanked-segment break in the interval (_curAnchor.idx, _nextAnchor.idx).
          var _hasBreak = false;
          for (var _bi = _curAnchor.idx + 1; _bi < _nextAnchor.idx; _bi++) {
            if (_customSegs_sv[_bi] && _customSegs_sv[_bi].blanked) { _hasBreak = true; break; }
          }
          if (!_hasBreak) {
            svMarks.push({
              x1: svOx + _curAnchor.seg.x_start_mm * svScX,
              y1: svOy + _curAnchor.seg.y_start_mm * svScY,
              x2: svOx + _nextAnchor.seg.x_start_mm * svScX,
              y2: svOy + _nextAnchor.seg.y_start_mm * svScY,
              idx: _curAnchor.idx
            });
          }
          // else: skip this mark; break in scan path renders as a gap.
          _curAnchor = _nextAnchor;
        } else {
          // Final anchor — render a beam-diameter-long stub to mark the end.
          var _endX = _curAnchor.seg.x_start_mm + _customD_sv * Math.cos(_curAnchor.seg.angle_rad || 0);
          var _endY = _curAnchor.seg.y_start_mm + _customD_sv * Math.sin(_curAnchor.seg.angle_rad || 0);
          svMarks.push({
            x1: svOx + _curAnchor.seg.x_start_mm * svScX,
            y1: svOy + _curAnchor.seg.y_start_mm * svScY,
            x2: svOx + _endX * svScX,
            y2: svOy + _endY * svScY,
            idx: _curAnchor.idx
          });
          _curAnchor = null;
        }
      }
    }
  } else if(pat==="linear"){
    svMarks.push({x1:svOx,y1:svOy+svRH/2,x2:svOx+svRW,y2:svOy+svRH/2,idx:0});
  }else if(svTooMany){
    /* Decimated: iterate only over the small set of indices (never over all nLines) */
    for(var svdi=0;svdi<svDecIndices.length;svdi++){
      var svIdx=svDecIndices[svdi];
      var svLy=svOy+svIdx*svHtVis*svScY;
      var svLtr=pat==="bidi"?(svIdx%2===0):true;
      svMarks.push({x1:svLtr?svOx:svOx+svRW,y1:svLy,x2:svLtr?svOx+svRW:svOx,y2:svLy,idx:svIdx});
    }
    for(var svmi=0;svmi<svMarks.length-1;svmi++){
      var svCur=svMarks[svmi],svNxt=svMarks[svmi+1];
      var svCurLtr=pat==="bidi"?(svCur.idx%2===0):true;
      var svCurEx=svCurLtr?svOx+svRW:svOx;
      if(pat==="bidi")svJumps.push({x1:svCurEx,y1:svCur.y1,x2:svCurEx,y2:svNxt.y1});
      else svJumps.push({x1:svOx+svRW,y1:svCur.y1,x2:svOx,y2:svNxt.y1});
    }
  }else{
    var svNVis=Math.min(nLines,200);
    for(var svi=0;svi<svNVis;svi++){
      var svLy2=svOy+svi*svHtVis*svScY;
      var svLtr2=pat==="bidi"?(svi%2===0):true;
      svMarks.push({x1:svLtr2?svOx:svOx+svRW,y1:svLy2,x2:svLtr2?svOx+svRW:svOx,y2:svLy2,idx:svi});
    }
    for(var svmi2=0;svmi2<svMarks.length-1;svmi2++){
      var svCur2=svMarks[svmi2],svNxt2=svMarks[svmi2+1];
      var svCurLtr2=pat==="bidi"?(svCur2.idx%2===0):true;
      var svCurEx2=svCurLtr2?svOx+svRW:svOx;
      if(pat==="bidi")svJumps.push({x1:svCurEx2,y1:svCur2.y1,x2:svCurEx2,y2:svNxt2.y1});
      else svJumps.push({x1:svOx+svRW,y1:svCur2.y1,x2:svOx,y2:svNxt2.y1});
    }
  }
  /* Hatch callout geometry — left margin */
  var svShowHC=pat!=="linear"&&nLines>1&&svHtVis>0;
  var svHcY1=svOy,svHcY2=svOy+svHtVis*svScY;
  var svHcGap=svHcY2-svHcY1;
  var svHcBX=svOx-12;
  var svHcInline=svHcGap>=8;
  var svHcInset=svHcGap<8;
  var svHcLabel=svFmtDim(svHtVis);
  /* Formatted dimension labels */
  var svWLabel=svFmtDim(lineL);
  var svHLabel=svFmtDim(scanHN);
  var svGridMinP="",svGridMajP="";
  if(svGrid){
    for(var sgx=0;sgx<=svW_c;sgx+=10){if(sgx%50===0)svGridMajP+="M"+sgx+",0V"+svH_c+" ";else svGridMinP+="M"+sgx+",0V"+svH_c+" ";}
    for(var sgy=0;sgy<=svH_c;sgy+=10){if(sgy%50===0)svGridMajP+="M0,"+sgy+"H"+svW_c+" ";else svGridMinP+="M0,"+sgy+"H"+svW_c+" ";}
  }
  /* SVG click → scan coordinate conversion */
  function svClickToScan(e){
    if(!svRef.current)return null;
    var rect=svRef.current.getBoundingClientRect();
    var sx=(e.clientX-rect.left)/rect.width*svW_c;
    var sy=(e.clientY-rect.top)/rect.height*svH_c;
    var scanX=(sx-svOx)/svScX;
    var scanY=(sy-svOy)/svScY;
    if(scanX<0||scanX>lineL||scanY<0||scanY>(scanHN||0))return null;
    return{x:Math.max(0,Math.min(lineL,scanX)),y:Math.max(0,Math.min(scanHN||0,scanY))};
  }
  function svHandleClick(e){
    var pt=svClickToScan(e);
    if(pt){setSelPt(pt);setSelXS(pt.x.toFixed(3));setSelYS(pt.y.toFixed(3));}
  }
  function svHandleMove(e){setSvHov(svClickToScan(e));}
  function svHandleLeave(){setSvHov(null);}
  function svCoordGo(){
    var x=parseFloat(selXS),y=parseFloat(selYS);
    if(isFinite(x)&&isFinite(y)&&x>=0&&x<=lineL&&y>=0&&y<=(scanHN||0)){
      setSelPt({x:x,y:y});
    }
  }
  /* Convert scan point to SVG pixel coordinates */
  function svPtToSvg(pt){return pt?{sx:svOx+pt.x*svScX,sy:svOy+pt.y*svScY}:null;}
  var svSelS=svPtToSvg(selPt);
  var svHovS=svPtToSvg(svHov);
  /* Tooltip positioning — avoid clipping edges */
  var svTipW=96,svTipH=18;
  function svTipPos(sx,sy){
    var tx=sx+12,ty=sy-22;
    if(tx+svTipW>svW_c-4)tx=sx-svTipW-12;
    if(ty<4)ty=sy+12;
    if(ty+svTipH>svH_c-4)ty=svH_c-svTipH-4;
    return{tx:tx,ty:ty};
  }

  /* ═══ PACT static-fluence branch ═══ */
  if(modality==="pact"){
    var pactValid=isFinite(pactA)&&pactA>0&&isFinite(pactE)&&pactE>0&&isFinite(prf)&&prf>0&&isFinite(pactT)&&pactT>0&&isFinite(wl)&&wl>0&&isFinite(tau)&&tau>0;
    var pH_pp=pactValid?(pactE/pactA):NaN;
    var pN=pactValid?(prf*pactT):NaN;
    var pH_total=pactValid?(pH_pp*pN):NaN;
    var pMPE1=pactValid?skinMPE(wl,tau):NaN;
    var pMPET=pactValid?skinMPE(wl,pactT):NaN;
    /* Defend against engine returning non-finite/zero MPE for out-of-range inputs:
       treat as fail rather than silently displaying "—" or NaN ratios. */
    var pMPE1OK=isFinite(pMPE1)&&pMPE1>0;
    var pMPETOK=isFinite(pMPET)&&pMPET>0;
    var pR1=pactValid&&pMPE1OK?(pH_pp/pMPE1):Infinity;
    var pR2=pactValid&&pN>1?(pMPETOK?(pH_total/pMPET):Infinity):pR1;
    var pSafe=pactValid&&pMPE1OK&&pR1<=1&&pR2<=1;
    var pBind=pR1>=pR2?"Rule 1 (single pulse)":"Rule 2 (cumulative)";
    var pRatio=Math.max(pR1,pR2);
    var pAvgI=pactValid?(pactE*prf/pactA):NaN; /* time-averaged irradiance W/cm² */

    return (<div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* ═══ Region 1: PACT Configuration ═══ */}
      <div>
        <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>PACT / MSOT Static Fluence Configuration</div>
        <div style={{display:"grid",gridTemplateColumns:"0.43fr 1fr",gap:12,alignItems:"start"}}>
          <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
            <div style={secH}>Photoacoustic Source</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div>
                <label style={lb}>Modality Preset</label>
                <select value={modality} onChange={function(e){
                  var v=e.target.value; setModality(v);
                  if(v==="or-pam"){
                    /* OR-PAM default: 10 µm spot, 10 nJ pulse energy → Rule 1 ~0.64 of skin MPE.
                       Note: published OR-PAM systems often use 5 µm spot at >100 nJ for skin imaging,
                       which exceeds skin MPE by ~25×. Such systems target retinal applications via
                       ophthalmic optics where retinal MPE (not skin MPE) governs. */
                    setWlS("532");setWl(532);
                    setDS("0.010");setDia(0.010);
                    setTauS("5");setTau(5e-9);setTauU("ns");
                    setPrfS("100");setPrf(100000);setPrfU("kHz");
                    setPwMode("energy");setEpS("10e-9");setPw(0.001);setPwS("0.001");
                    setLLS("1");setLineL(1);setScanHS("1");setScanHN(1);
                    setNLS("1000");setNLines(1000);setNAS("1000");setNA(1000);
                    setNBMS("1");setNBM(1);
                  } else if(v==="ar-pam"){
                    setWlS("532");setWl(532);
                    setDS("1.0");setDia(1.0);
                    setTauS("5");setTau(5e-9);setTauU("ns");
                    setPrfS("1");setPrf(1000);setPrfU("kHz");
                    setPwMode("energy");setEpS("50e-6");setPw(0.050);setPwS("0.050");
                    setLLS("5");setLineL(5);setScanHS("5");setScanHN(5);
                    setNLS("200");setNLines(200);setNAS("200");setNA(200);
                    setNBMS("1");setNBM(1);
                  }
                  setDirty(true);
                }} style={{...ip,cursor:"pointer"}}>
                  <option value="or-pam">OR-PAM — optical-resolution (10 µm, 100 kHz)</option>
                  <option value="ar-pam">AR-PAM — acoustic-resolution (1 mm dark-field, 1 kHz)</option>
                  <option value="pact">PACT / MSOT — large-area diffuse (1 cm², 10 Hz)</option>
                </select>
              </div>
              <div><label htmlFor="pact-wl" style={lb}>Excitation Wavelength (nm)</label><input id="pact-wl" type="text" value={wlS} onChange={function(e){upN(setWlS,setWl,e.target.value)}} style={ip}/></div>
              <div>
                <label style={lb}>Pulse Duration</label>
                <div style={{display:"flex",gap:4}}>
                  <input type="text" value={tauS} onChange={function(e){upTau(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
                  <select value={tauU} onChange={function(e){setTauU(e.target.value);upTau(tauS)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
                </div>
              </div>
              <div>
                <label style={lb}>PRF</label>
                <div style={{display:"flex",gap:4}}>
                  <input type="text" value={prfS} onChange={function(e){upPrf(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
                  <select value={prfU} onChange={function(e){setPrfU(e.target.value);upPrf(prfS)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{FREQ_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
                </div>
              </div>
              <div><label htmlFor="pact-e" style={lb}>Per-Pulse Energy (J)</label><input id="pact-e" type="text" value={pactES} onChange={function(e){upN(setPactES,setPactE,e.target.value);}} placeholder="e.g. 20e-3" style={ip}/>
                {pactValid?<div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>{"P_avg = "+(pactE*prf*1000).toPrecision(3)+" mW"}</div>:null}
              </div>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
              <div style={secH}>Illumination Geometry</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div><label htmlFor="pact-a" style={lb}>Illumination Footprint (cm²)</label><input id="pact-a" type="text" value={pactAS} onChange={function(e){upN(setPactAS,setPactA,e.target.value);}} style={ip}/>
                  <div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>typical PACT/MSOT: 1–8 cm²</div>
                </div>
                <div><label htmlFor="pact-t" style={lb}>Exposure Duration (s)</label><input id="pact-t" type="text" value={pactTS} onChange={function(e){upN(setPactTS,setPactT,e.target.value);}} style={ip}/>
                  <div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>{pactValid?"N pulses = "+pN.toPrecision(4):""}</div>
                </div>
              </div>
              <div style={{marginTop:10,fontSize:10,color:T.tm,lineHeight:1.6,padding:"8px 10px",background:T.bgI,borderRadius:4,border:"1px solid "+T.bd}}>
                PACT and MSOT systems use diffuse illumination over a cm²-scale footprint with no scanning of the optical beam. The safety analysis reduces to per-pulse surface fluence and cumulative fluence over the exposure interval. For multi-spectral acquisitions (sequential wavelengths), evaluate each wavelength independently and verify the additivity rule Σ(Hₙ/MPEₙ) ≤ 1.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Region 2: PACT Safety Results ═══ */}
      <div>
        <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Safety Results</div>
        {pactValid?<div style={{background:T.card,borderRadius:4,border:"1px solid "+T.bd,padding:14}}>
          <div style={{display:"flex",gap:12,alignItems:"stretch",marginBottom:12}}>
            <div role="alert" aria-live="polite" style={{background:pSafe?"#E8F5F0":"#fbe9e7",borderRadius:4,padding:"10px 16px",display:"flex",alignItems:"center",gap:10,minWidth:160}}>
              <div><div style={{fontSize:8,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:pSafe?"#00796B":"#bf360c",marginBottom:1}}>Safety Verdict</div><div style={{fontSize:18,fontWeight:700,fontFamily:"'IBM Plex Mono', monospace",color:pSafe?"#00796B":"#bf360c"}}>{pSafe?"PASS":"FAIL"}</div></div>
              <div><div style={{fontSize:9,fontFamily:"'IBM Plex Mono', monospace",color:pSafe?"#00897B":"#d84315"}}>margin: {isFinite(pRatio)?(pSafe?"+":"")+((1-pRatio)*100).toFixed(1)+"%":"—"}</div>
              <div style={{fontSize:9,color:pSafe?"#26a69a":"#e64a19"}}>binding: {pBind}</div></div>
            </div>
            <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,border:"1px solid "+T.bd,borderRadius:4}}>
              <div style={{padding:"8px 12px",borderRight:"1px solid "+T.bd}}>
                <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Rule 1 — Single Pulse</div>
                <div style={{display:"flex",alignItems:"baseline",gap:6}}>
                  <span style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:pR1>1?T.no:T.ok}}>{numFmt(pH_pp,4)}</span>
                  <span style={{fontSize:9,color:T.td}}>J/cm²</span>
                  <span style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",color:pR1>1?T.no:T.ok,marginLeft:"auto"}}>{isFinite(pR1)?pR1.toFixed(3)+"×":"—"}</span>
                </div>
                <div style={{fontSize:8,color:T.td,marginTop:1}}>MPE(τ) = {numFmt(pMPE1,4)} J/cm²</div>
              </div>
              <div style={{padding:"8px 12px"}}>
                <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Rule 2 — Cumulative</div>
                <div style={{display:"flex",alignItems:"baseline",gap:6}}>
                  <span style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:pR2>1?T.no:T.ok}}>{numFmt(pH_total,4)}</span>
                  <span style={{fontSize:9,color:T.td}}>J/cm²</span>
                  <span style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",color:pR2>1?T.no:T.ok,marginLeft:"auto"}}>{isFinite(pR2)?pR2.toFixed(3)+"×":"—"}</span>
                </div>
                <div style={{fontSize:8,color:T.td,marginTop:1}}>MPE(T={numFmt(pactT,3)}s) = {numFmt(pMPET,4)} J/cm²</div>
              </div>
            </div>
          </div>
          <div style={secH}>Exposure Summary</div>
          <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{[
            ["Modality","PACT / MSOT (static)","Footprint area",pactA.toPrecision(4)+" cm²"],
            ["Excitation λ",wl+" nm","Pulse duration τ",numFmt(tau,3)+" s"],
            ["Per-pulse energy",numFmt(pactE,4)+" J","PRF",numFmt(prf,4)+" Hz"],
            ["Per-pulse fluence",numFmt(pH_pp,4)+" J/cm²","Time-avg irradiance",numFmt(pAvgI,4)+" W/cm²"],
            ["N pulses",pN.toPrecision(4),"Exposure duration T",numFmt(pactT,3)+" s"],
          ].map(function(row,i){return <tr key={i} style={{borderBottom:"1px solid "+T.bgI}}>
            <td style={{padding:"3px 8px",fontSize:10,color:T.tm,width:"18%"}}>{row[0]}</td>
            <td style={{padding:"3px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:500,width:"32%"}}>{row[1]}</td>
            <td style={{padding:"3px 8px",fontSize:10,color:T.tm,width:"18%"}}>{row[2]}</td>
            <td style={{padding:"3px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:500,width:"32%"}}>{row[3]}</td>
          </tr>;})}</tbody></table>
        </div>:<div style={{padding:14,background:T.card,border:"1px solid "+T.bd,borderRadius:4,fontSize:11,color:T.td}}>
          Enter footprint area, per-pulse energy, PRF, exposure duration, wavelength, and pulse duration to evaluate.
        </div>}
      </div>

      {/* ═══ Region 3: Safety Notice ═══ */}
      <div style={{fontSize:9,color:T.td,lineHeight:1.6,padding:"8px 0"}}>
        <strong style={{color:T.tm}}>{"⚠"} Notice:</strong>{" "}
        PACT static fluence evaluated per {STD_NAME} using Rule 1 (per-pulse) and Rule 2 (average). For multi-wavelength MSOT acquisitions, the additivity rule Σ(Hₙ/MPEₙ) ≤ 1 must be evaluated separately and is not currently implemented.{" "}
        <strong style={{color:T.no}}>Research and educational use only.</strong>{" "}Verify all values against the applicable standard.
      </div>
    </div>);
  }

  return (<div style={{display:"flex",flexDirection:"column",gap:16}}>
    {/* ═══ Pattern Source (Sub-phase 1D commit 3) ═══ */}
    {/* LSP-JSON import card. When loaded, the controls below become read-only
        and display the LSP-derived values; Eject restores the previous state. */}
    <PatternSource T={T} lspState={lspState}
      onImport={_handleLspImport} onEject={_handleLspEject} />

    {/* ═══ Region 1: Configuration ═══ */}
    <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Scan Configuration</div>
    {/* ── Inputs: 2-column layout ──
        fieldset with disabled={lspLocked} natively propagates the disabled
        state to every <input>, <select>, <button>, and <textarea> inside.
        Borders/padding/margin/min-width:0 reset so the fieldset is
        layout-transparent. CSS opacity is conditional so the user sees
        the state change clearly. */}
    <fieldset disabled={lspLocked} style={{
      border:"none",padding:0,margin:0,minWidth:0,
      display:"grid",gridTemplateColumns:"0.43fr 1fr",gap:12,alignItems:"start",
      opacity:lspLocked?0.55:1,
      pointerEvents:lspLocked?"none":"auto"
    }}>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={secH}>Photoacoustic Source</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div>
            <label style={lb}>Modality Preset</label>
            <select value={modality} onChange={function(e){
              var v=e.target.value; setModality(v);
              if(v==="or-pam"){
                /* OR-PAM default: 10 µm spot, 10 nJ pulse energy → Rule 1 ~0.64 of skin MPE.
                   See preset label note re: skin-vs-retinal MPE applicability. */
                setWlS("532");setWl(532);
                setDS("0.010");setDia(0.010);
                setTauS("5");setTau(5e-9);setTauU("ns");
                setPrfS("100");setPrf(100000);setPrfU("kHz");
                setPwMode("energy");setEpS("10e-9");setPw(0.001);setPwS("0.001");
                setLLS("1");setLineL(1);setScanHS("1");setScanHN(1);
                setNLS("1000");setNLines(1000);setNAS("1000");setNA(1000);
                setNBMS("1");setNBM(1);
              } else if(v==="ar-pam"){
                setWlS("532");setWl(532);
                setDS("1.0");setDia(1.0);
                setTauS("5");setTau(5e-9);setTauU("ns");
                setPrfS("1");setPrf(1000);setPrfU("kHz");
                setPwMode("energy");setEpS("50e-6");setPw(0.050);setPwS("0.050");
                setLLS("5");setLineL(5);setScanHS("5");setScanHN(5);
                setNLS("200");setNLines(200);setNAS("200");setNA(200);
                setNBMS("1");setNBM(1);
              } else if(v==="pact"){
                setWlS("800");setWl(800);
                setTauS("5");setTau(5e-9);setTauU("ns");
                setPrfS("10");setPrf(10);setPrfU("Hz");
                setPactAS("1.0");setPactA(1.0);
                setPactES("20e-3");setPactE(20e-3);
                setPactTS("10");setPactT(10);
              }
              setDirty(true);
            }} style={{...ip,cursor:"pointer"}}>
              <option value="or-pam">OR-PAM — optical-resolution (10 µm, 100 kHz)</option>
              <option value="ar-pam">AR-PAM — acoustic-resolution (1 mm dark-field, 1 kHz)</option>
              <option value="pact">PACT / MSOT — large-area diffuse (1 cm², 10 Hz)</option>
            </select>
          </div>
          {modality!=="pact"?<div><label htmlFor="scan-wl" style={lb}>Excitation Wavelength (nm)</label><input id="scan-wl" type="text" value={wlS} onChange={function(e){upN(setWlS,setWl,e.target.value)}} style={ip}/></div>:null}
          {modality!=="pact"?<div><label htmlFor="scan-dia" style={lb}>Illumination Spot 1/e² (mm)</label><input id="scan-dia" type="text" value={dS} onChange={function(e){upN(setDS,setDia,e.target.value)}} style={ip}/></div>:null}
          <div>
            <label style={lb}>Laser Mode</label>
            <div style={{display:"inline-flex",background:T.hov||"rgba(15,23,42,0.04)",borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
              {[["pulsed","Pulsed"],["cw","CW"]].map(function(m){
                return <button key={m[0]} onClick={function(){
                  setLaserMode(m[0]);
                  if(m[0]==="cw")setPwMode("power");
                  setDirty(true);
                }} style={{flex:1,padding:"4px 10px",fontSize:12,fontWeight:laserMode===m[0]?500:400,
                  background:laserMode===m[0]?T.card:"transparent",
                  color:laserMode===m[0]?T.tx:T.tm,
                  border:"none",
                  borderBottom:laserMode===m[0]?"2px solid "+T.ac:"2px solid transparent",
                  cursor:"pointer"}}>{m[1]}</button>;
              })}
            </div>
          </div>
          {laserMode==="pulsed"?<div>
            <label style={lb}>Pulse Duration</label>
            <div style={{display:"flex",gap:4}}>
              <input type="text" value={tauS} onChange={function(e){upTau(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
              <select value={tauU} onChange={function(e){setTauU(e.target.value);upTau(tauS)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
            </div>
          </div>:null}
          {laserMode==="pulsed"?<div>
            <label style={lb}>PRF</label>
            <div style={{display:"flex",gap:4}}>
              <input type="text" value={prfS} onChange={function(e){upPrf(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono', monospace",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
              <select value={prfU} onChange={function(e){setPrfU(e.target.value);upPrf(prfS)}} style={{fontSize:11,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{FREQ_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
            </div>
          </div>:null}
          <div>
            <label style={lb}>Power Input</label>
            <select value={pwMode} onChange={function(e){
              var m=e.target.value;setPwMode(m);setDirty(true);
              if(m==="energy"&&prf>0&&pw>0)setEpS((pw/prf).toExponential(4));
            }} disabled={laserMode==="cw"} style={{width:"100%",marginBottom:6,fontSize:11,padding:"5px 8px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:laserMode==="cw"?"default":"pointer",opacity:laserMode==="cw"?0.6:1,boxSizing:"border-box"}}>
              <option value="power">Average Power (W)</option>
              <option value="energy">Pulse Energy (J)</option>
            </select>
            {pwMode==="power"?
              <div>
                <input id="scan-pw" type="text" value={pwS} onChange={function(e){upPw(e.target.value)}} style={ip}/>
                {laserMode==="pulsed"&&prf>0&&pw>0?<div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>{"Ep = "+(pw/prf).toExponential(3)+" J"}</div>:null}
              </div>
            :
              <div>
                <input type="text" value={epS} onChange={function(e){upEp(e.target.value)}} placeholder="e.g. 50e-6" style={ip}/>
                {prf>0&&pw>0?<div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"'IBM Plex Mono', monospace"}}>{"P_avg = "+pw.toPrecision(3)+" W"}</div>:null}
              </div>
            }
          </div>
        </div>

          {/* Divider */}
          <div style={{borderTop:"1px solid "+T.bd,margin:"4px 0"}}/>
          {/* Dwell time + flyback (merged from Settings) */}
          <div>
            <label style={lb}>Dwell Time Definition</label>
            <div style={{display:"inline-flex",background:T.hov||"rgba(15,23,42,0.04)",borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
              {[["gaussian","Gaussian"],["geometric","Geometric"]].map(function(dm){
                return <button key={dm[0]} onClick={function(){setDwm(dm[0])}} style={{flex:1,padding:"4px 10px",fontSize:11,fontWeight:dwm===dm[0]?500:400,background:dwm===dm[0]?T.card:"transparent",color:dwm===dm[0]?T.tx:T.tm,border:"none",borderBottom:dwm===dm[0]?"2px solid "+T.ac:"2px solid transparent",cursor:"pointer"}}>{dm[1]}</button>;
              })}
            </div>
          </div>
          {pat!=="linear"?<div>
            <label style={{...lb,marginBottom:6}}>Galvo Flyback Blanking</label>
            <label style={{display:"flex",alignItems:"flex-start",gap:6,cursor:"pointer",fontSize:11,color:T.tx}}>
              <input type="checkbox" checked={blk} onChange={function(){setBlk(!blk);setDirty(true);}} style={{accentColor:T.ac,width:14,height:14,marginTop:2}}/>
              <span style={{lineHeight:1.3}}>{blk?"Laser blanked during flyback/jumps":"Laser fires during flyback (conservative)"}</span>
            </label>
            <div style={{fontSize:8,color:T.td,marginTop:2,marginLeft:20}}>OCT/confocal systems typically blank during galvo return</div>
          </div>:null}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden",padding:14}}>
        {/* Header: title + toggle toolbar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={secH}>Scan Pattern</div>
          <div style={{display:"flex",gap:2}}>
            <button onClick={function(){setSvGrid(!svGrid);}} title="Grid" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svGrid?svBtnBg:"transparent",border:svGrid?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svGrid?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.4" strokeLinecap="round"><line x1="5" y1="1" x2="5" y2="15"/><line x1="11" y1="1" x2="11" y2="15"/><line x1="1" y1="5" x2="15" y2="5"/><line x1="1" y1="11" x2="15" y2="11"/></svg></button>
            <button onClick={function(){setSvBeam(!svBeam);}} title="Beam spot" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svBeam?svBtnBg:"transparent",border:svBeam?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svBeam?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.3"><circle cx="8" cy="8" r="5" strokeDasharray="2.5 2"/><circle cx="8" cy="8" r="1.5" fill={svIc} stroke="none"/></svg></button>
            <button onClick={function(){setSvFlyback(!svFlyback);}} title="Flyback paths" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svFlyback?svBtnBg:"transparent",border:svFlyback?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svFlyback?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.3" strokeLinecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="12" x2="14" y2="12"/><path d="M14,4 C16,4 16,12 14,12" strokeDasharray="2 2" opacity="0.6"/></svg></button>
            <button onClick={function(){setSvAnts(!svAnts);}} title="Scan animation" style={{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",background:svAnts?svBtnBg:"transparent",border:svAnts?"1px solid "+svBtnBd:"1px solid transparent",borderRadius:4,cursor:"pointer",opacity:svAnts?1:0.4,padding:0}}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={svIc} strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="8" x2="12" y2="8" strokeDasharray="2.5 3"/><polygon points="11,5.5 15,8 11,10.5" fill={svIc} stroke="none" opacity="0.5"/></svg></button>
          </div>
        </div>
        {/* Pattern selector */}
        <div style={{display:"inline-flex",background:T.hov||"rgba(15,23,42,0.04)",borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden",marginBottom:8}}>
          {[["linear","Linear"],["raster","Raster"],["bidi","Bidirectional"]].map(function(pt){
            return <button key={pt[0]} onClick={function(){setPat(pt[0]);setDirty(true);}} style={{flex:1,padding:"5px 10px",fontSize:12,fontWeight:pat===pt[0]?500:400,background:pat===pt[0]?T.card:"transparent",color:pat===pt[0]?T.tx:T.tm,border:"none",borderBottom:pat===pt[0]?"2px solid "+T.ac:"2px solid transparent",borderRight:pt[0]!=="bidi"?"1px solid "+T.bd:"none",cursor:"pointer"}}>{pt[1]}</button>;
          })}
        </div>
        {/* SVG Visualization — all fixes */}
        <div style={{borderRadius:4,overflow:"hidden",border:"1px solid "+vc.canvasBd,marginBottom:10}}>
          <svg ref={svRef} viewBox={"0 0 "+svW_c+" "+svH_c} style={{width:"100%",height:"auto",display:"block",background:vc.canvas,cursor:pat!=="linear"?"crosshair":"default"}} xmlns="http://www.w3.org/2000/svg" shapeRendering="geometricPrecision" onClick={pat!=="linear"?svHandleClick:null} onMouseMove={pat!=="linear"?svHandleMove:null} onMouseLeave={pat!=="linear"?svHandleLeave:null}>
            <defs>
              <clipPath id="sv-clip"><rect x={svOx-2} y={svOy-2} width={svRW+4} height={svRH+4}/></clipPath>
              <marker id="sv-arr" markerWidth="8" markerHeight="5" refX="7.5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,2.5 L0,5 z" fill={vc.dimAct}/></marker>
              <marker id="sv-arr2" markerWidth="8" markerHeight="5" refX="0.5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M8,0 L0,2.5 L8,5 z" fill={vc.dimAct}/></marker>
              <marker id="sv-hc1" markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0.5 L4,2 L0,3.5 z" fill={vc.hc}/></marker>
              <marker id="sv-hc2" markerWidth="4" markerHeight="4" refX="0.5" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M4,0.5 L0,2 L4,3.5 z" fill={vc.hc}/></marker>
            </defs>
            {svGrid?<g><path d={svGridMinP} fill="none" stroke={vc.gridMin} strokeWidth="0.5" opacity="0.5"/><path d={svGridMajP} fill="none" stroke={vc.gridMaj} strokeWidth="0.5" opacity="0.6"/></g>:null}
            {svGrid?<g>
              <line x1={svOx-14} y1={svOy+svRH} x2={svOx+22} y2={svOy+svRH} stroke={vc.axX} strokeWidth="0.8" opacity="0.4"/>
              <line x1={svOx} y1={svOy+svRH+14} x2={svOx} y2={svOy+svRH-22} stroke={vc.axY} strokeWidth="0.8" opacity="0.4"/>
              <text x={svOx+24} y={svOy+svRH+3} fill={vc.axX} fontSize="7.5" fontFamily="'IBM Plex Mono', monospace" opacity="0.4" fontWeight="400">x</text>
              <text x={svOx+3} y={svOy+svRH-24} fill={vc.axY} fontSize="7.5" fontFamily="'IBM Plex Mono', monospace" opacity="0.4" fontWeight="400">y</text>
              <circle cx={svOx} cy={svOy+svRH} r="1.8" fill="none" stroke={vc.lbl} strokeWidth="0.6"/>
            </g>:null}
            <rect x={svOx} y={svOy} width={svRW} height={svRH} fill="none" stroke={vc.areaBd} strokeWidth="0.75"/>
            {svRenderBeam?<g clipPath="url(#sv-clip)">{svMarks.map(function(s,i){var dx=s.x2-s.x1,dy=s.y2-s.y1,len=Math.sqrt(dx*dx+dy*dy),ang=Math.atan2(dy,dx)*180/Math.PI;return <rect key={"c"+i} x={-len/2} y={-svBeamR} width={len} height={svBeamR*2} rx={svBeamR} transform={"translate("+((s.x1+s.x2)/2)+","+((s.y1+s.y2)/2)+") rotate("+ang+")"} fill={vc.mark} opacity={vc.corr}/>;})}</g>:null}
            {svFlyback?svJumps.map(function(s,i){var vert=Math.abs(s.x1-s.x2)<1;var d=vert?"M"+s.x1+","+s.y1+"L"+s.x2+","+s.y2:"M"+s.x1+","+s.y1+"C"+(s.x1+(s.x2>s.x1?25:-25))+","+s.y1+" "+(s.x2+(s.x1>s.x2?25:-25))+","+s.y2+" "+s.x2+","+s.y2;return <path key={"j"+i} d={d} fill="none" stroke={vc.jump} strokeWidth="0.6" strokeDasharray="4,2" opacity="0.5"/>;}):null}
            {svMarks.map(function(s,i){var dx=s.x2-s.x1,dy=s.y2-s.y1,mx=(s.x1+s.x2)/2,my=(s.y1+s.y2)/2,ang=Math.atan2(dy,dx)*180/Math.PI;return <g key={"m"+i}><line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={vc.mark} strokeWidth="1.0"/>{svAnts?<line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={vc.canvas} strokeWidth="1.0" strokeDasharray="3,7" strokeDashoffset={-antOff} opacity="0.45"/>:null}<polygon points="0,-2.5 5,0 0,2.5" fill={vc.mark} opacity="0.65" transform={"translate("+mx+","+my+") rotate("+ang+")"}/><circle cx={s.x1} cy={s.y1} r="1.4" fill={vc.mark} opacity="0.35"/></g>;})}
            {svRenderBeam&&svMarks.length>0?<g><circle cx={svMarks[0].x1} cy={svMarks[0].y1} r={svBeamR} fill="none" stroke={vc.mark} strokeWidth="0.75" strokeDasharray="2.5,2" opacity="0.3"/></g>:null}
            {/* Inline hatch callout — bracket in left margin */}
            {svShowHC&&svHcInline?<g>
              <line x1={svHcBX-5} y1={svHcY1} x2={svOx-4} y2={svHcY1} stroke={vc.hc} strokeWidth="0.4"/>
              <line x1={svHcBX-5} y1={svHcY2} x2={svOx-4} y2={svHcY2} stroke={vc.hc} strokeWidth="0.4"/>
              <line x1={svHcBX} y1={svHcY1} x2={svHcBX} y2={svHcY2} stroke={vc.hc} strokeWidth="0.5" markerStart="url(#sv-hc2)" markerEnd="url(#sv-hc1)"/>
              <text x={svHcBX-8} y={(svHcY1+svHcY2)/2-1} textAnchor="end" dominantBaseline="middle" fill={vc.hc} fontSize="9" fontFamily="'IBM Plex Mono', monospace" fontWeight="500">{"Δh"}</text>
              <text x={svHcBX-8} y={(svHcY1+svHcY2)/2+10} textAnchor="end" dominantBaseline="middle" fill={vc.hc} fontSize="8.5" fontFamily="'IBM Plex Mono', monospace" fontWeight="500">{svHcLabel}</text>
            </g>:null}
            {/* Inset hatch callout — for sub-pixel spacing */}
            {svShowHC&&svHcInset?<g>
              <rect x="3" y={svPd_t-2} width={svPd_l-8} height="62" rx="3" fill={_isLt?"white":"#2A2A30"} stroke={vc.hc} strokeWidth="0.8"/>
              <text x={(svPd_l-5)/2+3} y={svPd_t+11} textAnchor="middle" fill={vc.hc} fontSize="9" fontFamily="'IBM Plex Sans', system-ui, sans-serif" fontWeight="700" letterSpacing="0.04em">LINE SPACING</text>
              <line x1="10" y1={svPd_t+24} x2={svPd_l-22} y2={svPd_t+24} stroke={vc.mark} strokeWidth="1.0"/>
              <line x1="10" y1={svPd_t+44} x2={svPd_l-22} y2={svPd_t+44} stroke={vc.mark} strokeWidth="1.0"/>
              <line x1={svPd_l-16} y1={svPd_t+24} x2={svPd_l-16} y2={svPd_t+44} stroke={vc.hc} strokeWidth="0.5" markerStart="url(#sv-hc2)" markerEnd="url(#sv-hc1)"/>
              <line x1={svPd_l-20} y1={svPd_t+24} x2={svPd_l-12} y2={svPd_t+24} stroke={vc.hc} strokeWidth="0.7"/>
              <line x1={svPd_l-20} y1={svPd_t+44} x2={svPd_l-12} y2={svPd_t+44} stroke={vc.hc} strokeWidth="0.7"/>
              <text x={(svPd_l-5)/2+3} y={svPd_t+57} textAnchor="middle" fill={vc.hc} fontSize="10.5" fontFamily="'IBM Plex Mono', monospace" fontWeight="700">{svHcLabel}</text>
            </g>:null}
            {/* Width dimension */}
            <g><line x1={svOx} y1={svOy+svRH+3} x2={svOx} y2={svOy+svRH+24} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx+svRW} y1={svOy+svRH+3} x2={svOx+svRW} y2={svOy+svRH+24} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx} y1={svOy+svRH+18} x2={svOx+svRW} y2={svOy+svRH+18} stroke={vc.dimAct} strokeWidth="0.4" markerStart="url(#sv-arr2)" markerEnd="url(#sv-arr)"/><text x={svOx+svRW/2} y={svOy+svRH+32} textAnchor="middle" fill={vc.dimAct} fontSize="10" fontFamily="'IBM Plex Mono', monospace" fontWeight="600">{svWLabel}</text></g>
            {/* Height dimension */}
            {pat!=="linear"?<g><line x1={svOx+svRW+3} y1={svOy} x2={svOx+svRW+24} y2={svOy} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx+svRW+3} y1={svOy+svRH} x2={svOx+svRW+24} y2={svOy+svRH} stroke={vc.dimAct} strokeWidth="0.4"/><line x1={svOx+svRW+18} y1={svOy} x2={svOx+svRW+18} y2={svOy+svRH} stroke={vc.dimAct} strokeWidth="0.4" markerStart="url(#sv-arr2)" markerEnd="url(#sv-arr)"/><text x={svOx+svRW+28} y={svOy+svRH/2} dominantBaseline="middle" fill={vc.dimAct} fontSize="10" fontFamily="'IBM Plex Mono', monospace" fontWeight="600">{svHLabel}</text></g>:null}
            {/* Pattern label — above scan area */}
            <text x={svPd_l} y="16" fill={vc.lbl} fontSize="9.5" fontWeight="600" fontFamily="'IBM Plex Sans', system-ui, sans-serif" letterSpacing="0.08em">{pat==="linear"?"LINEAR":pat==="bidi"?"BIDIRECTIONAL RASTER":"UNIDIRECTIONAL RASTER"}</text>
            {pat!=="linear"?<text x={svW_c-8} y="16" textAnchor="end" fill={vc.lbl} fontSize="9" fontFamily="'IBM Plex Mono', monospace">{nLines+" lines"}</text>:null}
            {/* Decimation notice — below width dim */}
            {svTooMany?<text x={svOx+svRW/2} y={svOy+svRH+42} textAnchor="middle" fill={vc.lbl2} fontSize="9" fontFamily="'IBM Plex Mono', monospace" fontStyle="italic">{"showing "+svDecCount+" of "+nLines.toLocaleString()+" lines"}</text>:null}
            {/* Beam suppression notice — above scan area */}
            {svBeamOwl&&svBeam?<text x={svOx+svRW/2} y={svOy-8} textAnchor="middle" fill={vc.lbl2} fontSize="9" fontFamily="'IBM Plex Mono', monospace">{"beam ("+svFmtDim(dia)+") \u226B scan area"}</text>:null}
            {/* Legend — bottom right, outside scan area */}
            <g transform={"translate("+(svW_c-8)+","+(svH_c-16)+")"}><line x1="-58" y1="0" x2="-44" y2="0" stroke={vc.mark} strokeWidth="1.0"/><text x="-41" y="0.5" dominantBaseline="middle" fill={vc.legTx} fontSize="8" fontFamily="'IBM Plex Mono', monospace">mark</text>{svFlyback?<g><line x1="-58" y1="-14" x2="-44" y2="-14" stroke={vc.jump} strokeWidth="0.8" strokeDasharray="3,2"/><text x="-41" y="-13.5" dominantBaseline="middle" fill={vc.legTx} fontSize="8" fontFamily="'IBM Plex Mono', monospace">flyback</text></g>:null}</g>
            {/* Hover crosshairs — neutral grey, colorblind safe */}
            {svHovS&&!selPt&&pat!=="linear"?<g opacity="0.4">
              <line x1={svHovS.sx} y1={svOy} x2={svHovS.sx} y2={svOy+svRH} stroke={vc.lbl} strokeWidth="0.7" strokeDasharray="3,3"/>
              <line x1={svOx} y1={svHovS.sy} x2={svOx+svRW} y2={svHovS.sy} stroke={vc.lbl} strokeWidth="0.7" strokeDasharray="3,3"/>
              <circle cx={svHovS.sx} cy={svHovS.sy} r="4" fill="none" stroke={vc.lbl} strokeWidth="1"/>
            </g>:null}
            {/* Selected point marker — circle+cross for shape redundancy */}
            {svSelS&&pat!=="linear"?<g>
              <line x1={svSelS.sx} y1={svOy} x2={svSelS.sx} y2={svOy+svRH} stroke={T.no} strokeWidth="0.8" strokeDasharray="5,3" opacity="0.5"/>
              <line x1={svOx} y1={svSelS.sy} x2={svOx+svRW} y2={svSelS.sy} stroke={T.no} strokeWidth="0.8" strokeDasharray="5,3" opacity="0.5"/>
              <circle cx={svSelS.sx} cy={svSelS.sy} r="6" fill="none" stroke={T.no} strokeWidth="1.5"/>
              <line x1={svSelS.sx-3} y1={svSelS.sy} x2={svSelS.sx+3} y2={svSelS.sy} stroke={T.no} strokeWidth="1.5"/>
              <line x1={svSelS.sx} y1={svSelS.sy-3} x2={svSelS.sx} y2={svSelS.sy+3} stroke={T.no} strokeWidth="1.5"/>
            </g>:null}
            {/* Hover coordinate tooltip — dynamically positioned to avoid edge clipping */}
            {svHov&&svHovS&&!selPt&&pat!=="linear"?(function(){var tp=svTipPos(svHovS.sx,svHovS.sy);return <g>
              <rect x={tp.tx} y={tp.ty} width={svTipW} height={svTipH} rx="2" fill="rgba(31,41,51,0.88)"/>
              <text x={tp.tx+6} y={tp.ty+13} fill="#E6EDF3" fontSize="10" fontFamily={"'IBM Plex Mono', monospace"}>{"("+svHov.x.toFixed(2)+", "+svHov.y.toFixed(2)+")"}</text>
            </g>;})():null}
            {/* Click instruction hint — below dimensions, clear of geometry */}
            {!selPt&&pat!=="linear"?<text x={svOx+svRW/2} y={svH_c-4} textAnchor="middle" fill={vc.lbl} fontSize="8.5" fontFamily={"'IBM Plex Sans', system-ui, sans-serif"} fontWeight="400" opacity="0.5">Click anywhere in scan area to select observation point</text>:null}
          </svg>
        </div>
        {/* Coordinate input bar */}
        {pat!=="linear"?<div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:11,color:T.tm,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>Observation:</span>
            {selPt?<span style={{fontFamily:"'IBM Plex Mono', monospace",fontSize:12,color:T.tx,fontWeight:500,fontVariantNumeric:"tabular-nums"}}>{"("+selPt.x.toFixed(3)+", "+selPt.y.toFixed(3)+") mm"}</span>
              :<span style={{fontSize:11,color:T.td,fontStyle:"italic",fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>click scan area or enter coordinates</span>}
            {selPt?<button onClick={function(){setSelPt(null);setSelXS("");setSelYS("");}} style={{fontSize:10,padding:"2px 8px",background:"transparent",border:"1px solid "+T.bd,borderRadius:4,cursor:"pointer",color:T.ac,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>Reset to worst-case</button>:null}
          </div>
          <div style={{borderLeft:"1px solid "+T.bd,height:18}}/>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:10,color:T.td}}>x</span>
            <input type="text" value={selXS} onChange={function(e){setSelXS(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")svCoordGo();}} placeholder="0.000" style={{width:66,fontFamily:"'IBM Plex Mono', monospace",fontSize:11,height:24,padding:"0 6px",border:"1px solid "+T.bd,borderRadius:4,textAlign:"right",color:T.tx,outline:"none",background:T.card,fontVariantNumeric:"tabular-nums",boxSizing:"border-box"}}/>
            <span style={{fontSize:10,color:T.td}}>y</span>
            <input type="text" value={selYS} onChange={function(e){setSelYS(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")svCoordGo();}} placeholder="0.000" style={{width:66,fontFamily:"'IBM Plex Mono', monospace",fontSize:11,height:24,padding:"0 6px",border:"1px solid "+T.bd,borderRadius:4,textAlign:"right",color:T.tx,outline:"none",background:T.card,fontVariantNumeric:"tabular-nums",boxSizing:"border-box"}}/>
            <span style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>mm</span>
            <button onClick={svCoordGo} style={{height:24,padding:"0 10px",fontSize:10,fontWeight:500,background:T.ac,color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>Go</button>
          </div>
        </div>:null}
        {/* Inputs — compact row */}
        <div style={{display:"grid",gridTemplateColumns:pat==="linear"?"1fr 1fr 1fr":"1fr 1fr 1fr 1fr 1fr",gap:8}}>
          <div><label htmlFor="scan-sw" style={lb}>{pat==="linear"?"B-scan Length (mm)":"B-scan Width (mm)"}</label><input id="scan-sw" type="text" value={lLS} onChange={function(e){upN(setLLS,setLineL,e.target.value);}} style={ip}/></div>
          {pat!=="linear"?<div><label htmlFor="scan-sh" style={lb}>Slow-axis Range (mm)</label><input id="scan-sh" type="text" value={scanHS} onChange={function(e){upN(setScanHS,setScanHN,e.target.value);}} style={ip}/></div>:null}
          {pat!=="linear"?<div><label htmlFor="scan-nl" style={lb}>B-scans / Volume</label><input id="scan-nl" type="text" value={nLS} onChange={function(e){setNLS(e.target.value);var v=Math.max(1,Math.round(Number(e.target.value)));if(isFinite(v))setNLines(v);setDirty(true);}} style={ip}/></div>:null}
          <div><label htmlFor="scan-nbm" style={lb}>Averages / Loc.</label><input id="scan-nbm" type="text" value={nBMS} onChange={function(e){setNBMS(e.target.value);var v=Math.max(1,Math.round(Number(e.target.value)));if(isFinite(v))setNBM(v);setDirty(true);}} style={ip}/></div>
          <div>
            <label style={lb}>Scan Speed</label>
            <select value={velMode} onChange={function(e){setVelMode(e.target.value);setDirty(true);}} style={{width:"100%",marginBottom:4,fontSize:10,padding:"4px 6px",background:T.card,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer",boxSizing:"border-box"}}><option value="ascans">A-lines / B-scan</option><option value="velocity">Velocity (mm/s)</option><option value="dwell">Dwell (\u00b5s)</option><option value="scanrate">B-scan rate (Hz)</option><option value="framerate">Volume rate (Hz)</option></select>
            {velMode==="ascans"?<input type="text" value={nAS} onChange={function(e){setNAS(e.target.value);var v=Math.max(1,Math.round(Number(e.target.value)));if(isFinite(v))setNA(v);setDirty(true);}} style={ip}/>:velMode==="velocity"?<input type="text" value={vS} onChange={function(e){upN(setVS,setVel,e.target.value);}} style={ip}/>:velMode==="dwell"?<input type="text" value={dwellS} onChange={function(e){upN(setDwellS,setDwellN,e.target.value);}} style={ip}/>:velMode==="scanrate"?<input type="text" value={srateS} onChange={function(e){upN(setSrateS,setSrateN,e.target.value);}} style={ip}/>:<input type="text" value={frateS} onChange={function(e){upN(setFrateS,setFrateN,e.target.value);}} style={ip}/>}
          </div>
        </div>
        {/* Derived readouts — single line below */}
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:4}}>
          {pat!=="linear"&&nLines>1&&scanHN>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"Step: "+(scanHN/(nLines-1)*1000).toFixed(2)+" \u00b5m"}</div>:null}
          {velMode==="ascans"&&nA>0&&prf>0&&lineL>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(lineL*prf/nA).toFixed(2)+" mm/s ("+(prf/nA).toFixed(2)+" B-scans/s)"}</div>:null}
          {velMode==="dwell"&&dwellN>0&&dia>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(dia/(dwellN*1e-6)).toFixed(2)+" mm/s"}</div>:null}
          {velMode==="scanrate"&&srateN>0&&lineL>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(srateN*lineL).toFixed(2)+" mm/s"}</div>:null}
          {velMode==="framerate"&&frateN>0&&lineL>0?<div style={{fontSize:8,color:T.td,fontFamily:"'IBM Plex Mono', monospace"}}>{"\u2192 "+(lineL*(pat==="linear"?1:nLines)*frateN).toFixed(2)+" mm/s"}</div>:null}
        </div>
      </div>

      </div>
    </fieldset>
    <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
      <button onClick={calculate} style={{height:36,padding:"0 24px",fontSize:13,fontWeight:500,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:4,cursor:"pointer",letterSpacing:"-0.005em"}}>{cmp?"Computing...":dirty?"Calculate":"Calculated \u2713"}</button>
    </div>
    </div>

    {/* ── Performance Note ── */}
    {perfNote?<div style={{padding:"8px 12px",borderRadius:4,background:"#fff3e0",border:"1px solid #ffe0b2",fontSize:10,color:"#e65100",fontFamily:"'IBM Plex Mono', monospace",lineHeight:1.6}}>
      {"\u26a1"} {perfNote}
    </div>:null}

    {/* ═══ Region 2: Results ═══ */}
    <div>
      <div style={{fontSize:13,fontWeight:600,color:T.tx,letterSpacing:"-0.005em",marginBottom:12,paddingBottom:6,borderBottom:"1px solid "+T.bd}}>Scan Safety Results</div>
    {/* ── Safety Results ── */}
    {res?<div style={{background:T.card,borderRadius:4,border:"1px solid "+T.bd,padding:14}}>
      {/* Verdict bar + rules in single row */}
      <div style={{display:"flex",gap:12,alignItems:"stretch",marginBottom:12}}>
        <div role="alert" aria-live="polite" style={{background:res.sf.safe?"#E8F5F0":"#fbe9e7",borderRadius:4,padding:"10px 16px",display:"flex",alignItems:"center",gap:10,minWidth:160}}>
          <div><div style={{fontSize:8,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:res.sf.safe?"#00796B":"#bf360c",marginBottom:1}}>Safety Verdict{res.nBM>1?" · ×"+res.nBM+" avg":""}</div><div style={{fontSize:18,fontWeight:700,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.safe?"#00796B":"#bf360c"}}>{res.sf.safe?"PASS":"FAIL"}</div></div>
          <div><div style={{fontSize:9,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.safe?"#00897B":"#d84315"}}>margin: {res.sf.safe?"+":""}{(res.sf.sm*100).toFixed(1)}%</div>
          <div style={{fontSize:9,color:res.sf.safe?"#26a69a":"#e64a19"}}>binding: {res.sf.br}</div></div>
        </div>
        <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,border:"1px solid "+T.bd,borderRadius:4}}>
          <div style={{padding:"8px 12px",borderRight:"1px solid "+T.bd}}>
            <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Rule 1 — Single Pulse</div>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r1m>1?T.no:T.ok}}>{numFmt(res.sf.ppM,4)}</span>
              <span style={{fontSize:9,color:T.td}}>J/cm{"²"}</span>
              <span style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r1m>1?T.no:T.ok,marginLeft:"auto"}}>{res.sf.r1m.toFixed(3)}{"×"}</span>
            </div>
            <div style={{fontSize:8,color:T.td,marginTop:1}}>MPE({"τ"}) = {numFmt(res.sf.mt,4)} J/cm{"²"}</div>
          </div>
          <div style={{padding:"8px 12px"}}>
            <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Rule 2 — Cumulative</div>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:13,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r2m>1?T.no:T.ok}}>{numFmt(res.sf.pF,4)}</span>
              <span style={{fontSize:9,color:T.td}}>J/cm{"²"}</span>
              <span style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace",color:res.sf.r2m>1?T.no:T.ok,marginLeft:"auto"}}>{res.sf.r2m.toFixed(3)}{"×"}</span>
            </div>
            <div style={{fontSize:8,color:T.td,marginTop:1}}>MPE(T={numFmt(res.st.tt,3)}s) = {numFmt(res.sf.mT,4)} J/cm{"²"}</div>
          </div>
        </div>
      </div>
      {/* ── Worst-case stationary advisory (galvo-stall fault mode) ── */}
      {(function(){
        var T_st=res.st.tt;
        if(!isFinite(T_st)||T_st<=0)return null;
        var w_cm=(dia/2)/10;
        var denom=Math.PI*w_cm*w_cm;
        if(denom<=0)return null;
        var sRatio,sSafe,sBind,sH,sMPE;
        if(laserMode==="cw"){
          var I_peak=2*pw/denom;
          sH=I_peak*T_st;
          sMPE=skinMPE(wl,T_st);
          sRatio=sH/sMPE;sSafe=sRatio<1;sBind="CW (T="+numFmt(T_st,3)+" s)";
        }else if(prf>0){
          var H_pp=2*(pw/prf)/denom;
          var N_st=prf*T_st;
          var H_total=H_pp*N_st;
          var mpe1=skinMPE(wl,tau);
          var mpeT2=skinMPE(wl,T_st);
          var r1s=H_pp/mpe1;
          var r2s=N_st>1?(H_total/mpeT2):r1s;
          if(r1s>=r2s){sRatio=r1s;sBind="Rule 1 (single pulse)";sH=H_pp;sMPE=mpe1;}
          else{sRatio=r2s;sBind="Rule 2 (cumulative)";sH=H_total;sMPE=mpeT2;}
          sSafe=sRatio<1;
        }else return null;
        var bg=sSafe?"#E8F5F0":"#fff3e0";
        var bd=sSafe?"#C4E5DF":"#ffe0b2";
        var col=sSafe?"#00796B":"#e65100";
        var note=sSafe?"tissue safe under galvo-stall fault":"fault-mode exceeds MPE \u2014 stall interlock recommended";
        return <div style={{marginTop:10,padding:"6px 10px",background:bg,borderRadius:4,border:"1px solid "+bd,fontSize:10,color:col,fontFamily:"'IBM Plex Mono', monospace"}}>
          {(sSafe?"\u2713":"\u26a0")+" Advisory \u2014 worst-case stationary: H = "+numFmt(sH,4)+" J/cm\u00b2 ("+sRatio.toFixed(3)+"\u00d7 MPE), binding "+sBind+" \u2014 "+note}
        </div>;
      })()}
      {/* ── ANSI Rule 3 advisory (informational, not applied for ICNIRP skin) ── */}
      {(function(){
        var N=res.sf.mP;
        if(!isFinite(N)||N<=1)return null;
        var rule3Mpe=res.sf.mt*Math.pow(N,-0.25);
        var rule3Ratio=res.sf.ppM/rule3Mpe;
        if(rule3Ratio<=1)return null;
        return <div style={{marginTop:10,padding:"6px 10px",background:"#f5f5f0",borderRadius:4,border:"1px dashed #b8b8a0",fontSize:10,color:"#555",fontFamily:"'IBM Plex Mono', monospace"}}>
          {"ⓘ ANSI Z136.1 Rule 3 (informational): N = "+Math.round(N)+" pulses/spot, N⁻¹ᐞˡ = "+Math.pow(N,-0.25).toFixed(3)+", per-pulse limit drops to "+numFmt(rule3Mpe,3)+" J/cm² ("+rule3Ratio.toFixed(2)+"× actual). ICNIRP 2013 does not apply Rule 3 to skin; this advisory is shown for ANSI cross-reference only."}
        </div>;
      })()}
      {/* Compact summary table — single table, essential info only */}
      <div style={secH}>Scan Summary</div>
      <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{[
        ["Scan pattern",pat==="linear"?"Linear":pat==="bidi"?"Bidirectional raster":"Unidirectional raster","Scan velocity",vel.toPrecision(4)+" mm/s"],
        ["Total scan time",numFmt(res.st.tt,4)+" s"+(res.nBM>1?" (×"+res.nBM+" avg)":""),"Grid",res.g.nx+"×"+res.g.ny+" ("+ppd+" pts/dia)"],
        ["Peak fluence",numFmt(res.sf.pF,4)+" J/cm²"+(res.sf.anUsed?" (analytical)":""),"Max pulses at point",String(res.sf.mP)],
        ["Pulse energy",numFmt(pw/prf,4)+" J","Dwell time ("+dwm+")",numFmt(dwm==="gaussian"?scanDwellGaussian(dia,vel):scanDwellGeometric(dia,vel),4)+" s"],
        ["τᵣ (thermal)",numFmt(res.sf.tauR,4)+" s","Flyback blanking",pat==="linear"?"N/A":(blk?"Yes":"No (conservative)")],
        ["Modality",modality==="or-pam"?"OR-PAM":modality==="ar-pam"?"AR-PAM":"PACT","Averages / loc.",String(Math.max(1,Math.round(nBM)))],
      ].map(function(row,i){return <tr key={i} style={{borderBottom:"1px solid "+T.bgI}}>
        <td style={{padding:"3px 8px",fontSize:10,color:T.tm,width:"18%"}}>{row[0]}</td>
        <td style={{padding:"3px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:500,width:"32%"}}>{row[1]}</td>
        <td style={{padding:"3px 8px",fontSize:10,color:T.tm,width:"18%"}}>{row[2]}</td>
        <td style={{padding:"3px 8px",fontSize:11,fontFamily:"'IBM Plex Mono', monospace",fontWeight:500,width:"32%"}}>{row[3]}</td>
      </tr>;})}</tbody></table>
      {/* Thermal relaxation — inline if available */}
      {isFinite(res.sf.minRv)?<div style={{marginTop:10,padding:"6px 10px",background:res.sf.rvOk?"#E8F5F0":"#fff3e0",borderRadius:4,border:"1px solid "+(res.sf.rvOk?"#C4E5DF":"#ffe0b2"),fontSize:10,color:res.sf.rvOk?"#00796B":"#e65100",fontFamily:"'IBM Plex Mono', monospace"}}>
        {res.sf.rvOk?"✓":"⚠"}{" Thermal: τᵣ = "+numFmt(res.sf.tauR,3)+" s, min revisit = "+numFmt(res.sf.minRv,3)+" s ("+((res.sf.minRv/res.sf.tauR)).toFixed(2)+"× τᵣ) — "+(res.sf.rvOk?"tissue cools between passes":"thermal accumulation likely")}
      </div>:null}
      {/* Permissible limits — compact inline */}
      {(function(){
        var maxEp=scanMaxPulseEnergy(wl,dia,tau);
        var minPRF=scanMinRepRate(wl,dia,tau,pw);
        return <div style={{marginTop:10}}>
          <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:4}}>Permissible Ranges</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
            {[
              ["Max Ep",numFmt(maxEp,3)+" J",pw/prf<=maxEp*1.001],
              ["Min PRF",numFmt(minPRF,3)+" Hz",prf>=minPRF*0.999],
              ["Max power",numFmt(res.maxP||0,3)+" W",pw<=(res.maxP||Infinity)*1.001],
              ["Min velocity",isFinite(res.minV)?numFmt(res.minV,3)+" mm/s":"—",isFinite(res.minV)?vel>=res.minV*0.999:true]
            ].map(function(it,i){
              return <div key={i} style={{fontSize:10,fontFamily:"'IBM Plex Mono', monospace"}}>
                <span style={{color:T.td,fontSize:9}}>{it[0]}: </span>
                <span style={{fontWeight:600,color:it[2]?T.ok:T.no}}>{it[1]}</span>
              </div>;
            })}
          </div>
        </div>;
      })()}
    </div>:null}

    {/* ── Point Timing Visualization ── */}
    <div style={{background:T.card,borderRadius:4,border:"1px solid "+T.bd,padding:14}}>
      <div style={secH}>Point Timing Diagram</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>
          {selPt?"Observing ("+selPt.x.toFixed(3)+", "+selPt.y.toFixed(3)+") mm":"Showing worst-case point"}
          {selPt?" \u2014 select a different point in the scan pattern above or enter coordinates.":"."}
        </div>
        {res?<div style={{fontSize:10,color:T.td,fontFamily:"'IBM Plex Mono', monospace",fontVariantNumeric:"tabular-nums"}}>Grid: {res.g.nx}{"\u00d7"}{res.g.ny} {"\u00b7"} Pulses: {(res.pulses && res.pulses.length>0)?res.pulses.length:(res.st.tp||0)}</div>:null}
      </div>
      {lspState.customPath?<div style={{height:300,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12,fontFamily:"'IBM Plex Sans', system-ui, sans-serif",padding:"0 24px",textAlign:"center"}}><div style={{fontSize:13,fontWeight:600,color:T.tm,marginBottom:6}}>Per-point timing not available for custom-path LSPs</div><div style={{maxWidth:480,lineHeight:1.5}}>The point-timing diagram assumes a regular raster scan; this LSP defines an arbitrary segment path. Use the safety verdict and peak fluence above for the worst-case point — these are computed correctly from the actual segments.</div></div>
        :res&&prf>0?<div>
        <div ref={ptTimRef} style={{width:"100%",height:420,borderRadius:4}}/>
      </div>
        :<div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>{res?"CW mode \u2014 no discrete pulses":"Click Calculate to generate timing diagram"}</div>}
    </div>
    </div>

    {/* ═══ Region 3: Safety Notice ═══ */}
    {/* Safety disclaimer — compact */}
    <div style={{fontSize:9,color:T.td,lineHeight:1.6,padding:"8px 0"}}>
      <strong style={{color:T.tm}}>{"⚠"} Notice:</strong>{" "}
      This tool evaluates skin MPE per {STD_NAME} using Rules 1 (per-pulse) and Rule 2 (average power). ICNIRP 2013 does not specify a Rule 3 (N⁻¹ᐞˡ multi-pulse correction) for skin; for ANSI Z136.1 compliance, additional Rule 3 evaluation may be required, particularly for high-PRF OR-PAM (>100 kHz).{" "}
      <strong style={{color:T.no}}>Research and educational use only.</strong>{" "}Verify all values against the applicable standard.
    </div>
  </div>);
}

/* ═══════ SCANNING PROTOCOLS (sub-tab router) ═══════ */
function ScanTab(p){
  var T=p.T;
  var _sub=useState("general"),scanSub=_sub[0],setScanSub=_sub[1];

  var subTabs=[
    {id:"general", label:"General Scanning"},
    {id:"oct",     label:"OCT Scanning"},
    {id:"pa",      label:"Photoacoustics Scanning"}
  ];

  var tabBtStyle=function(active){
    return {
      padding:"8px 14px",fontSize:12,fontWeight:active?500:400,
      background:"transparent",
      color:active?T.tx:T.tm,
      border:"none",
      borderBottom:active?"2px solid "+T.tx:"2px solid transparent",
      borderRadius:0,cursor:"pointer"
    };
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Sub-tab navigation */}
      <div style={{display:"flex",gap:6,borderBottom:"1px solid "+T.bd,paddingBottom:10}}>
        {subTabs.map(function(st){
          return <button key={st.id}
            role="tab"
            aria-selected={scanSub===st.id}
            onClick={function(){setScanSub(st.id);}}
            style={tabBtStyle(scanSub===st.id)}>{st.label}</button>;
        })}
      </div>

      {/* Sub-tab content */}
      {scanSub==="general"?<GeneralScanContent T={T} theme={p.theme} msg={p.msg} setMsg={p.setMsg}/>:null}
      {scanSub==="oct"?<OCTScanContent T={T} theme={p.theme} msg={p.msg} setMsg={p.setMsg}/>:null}
      {scanSub==="pa"?<PAScanContent T={T} theme={p.theme} msg={p.msg} setMsg={p.setMsg}/>:null}
    </div>
  );
}

/* ═══════ APP (TAB ROUTER) ═══════ */
/* ═══════ ERROR BOUNDARY ═══════ */
/* Prevents a crash in one tab from blanking the entire application (Audit finding: dim 3) */
class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={hasError:false,error:null};}
  static getDerivedStateFromError(error){return{hasError:true,error:error};}
  componentDidCatch(error,info){if(typeof console!=="undefined")console.error("Tab error:",error,info);}
  render(){
    if(this.state.hasError){
      var T=this.props.theme||{};
      return React.createElement("div",{style:{padding:40,textAlign:"center",color:T.no||"#d32f2f"}},
        React.createElement("div",{style:{fontSize:18,fontWeight:700,marginBottom:10}},"\u26a0 Component Error"),
        React.createElement("div",{style:{fontSize:12,fontFamily:"'IBM Plex Mono', monospace",color:T.td||"#666",marginBottom:16}},
          String(this.state.error)),
        React.createElement("button",{onClick:function(){this.setState({hasError:false,error:null});}.bind(this),
          style:{padding:"8px 16px",fontSize:12,cursor:"pointer",border:"1px solid #ccc",borderRadius:4,background:"#f5f5f5"}},"Retry"));
    }
    return this.props.children;
  }
}

export default function App(){
  var _t=useState("light"),theme=_t[0],setTheme=_t[1];
  var _tab=useState("mpe"),tab=_tab[0],setTab=_tab[1];
  var _mg=useState(""),msg=_mg[0],setMsg=_mg[1];
  var _sv=useState(0),stdVer=_sv[0],setStdVer=_sv[1];
  var _se=useState(""),stdErr=_se[0],setStdErr=_se[1];
  var fileRef=useRef(null);
  var T=TH[theme];
  var tabBt=function(id,label){return{padding:"8px 20px",fontSize:12,fontWeight:tab===id?500:400,border:"none",borderBottom:tab===id?"2px solid "+T.ac:"2px solid transparent",cursor:"pointer",background:"transparent",color:tab===id?T.ac:T.tm,letterSpacing:"0.02em"};};

  function handleStdUpload(ev){
    var file=ev.target.files&&ev.target.files[0];
    if(!file)return;
    setStdErr("");
    var reader=new FileReader();
    reader.onload=function(e2){
      try{
        var newData=JSON.parse(e2.target.result);
      }catch(parseErr){
        setStdErr("Invalid JSON: "+parseErr.message);
        return;
      }
      // Save current standard in case validation fails
      var oldStd=_std;
      // Load into engine (runs validation internally)
      _E.loadStandard(newData);
      var errs=_E.getValidationErrors();
      if(errs.length>0){
        // Revert to old standard
        _E.loadStandard(oldStd);
        setStdErr("Validation errors: "+errs.join("; "));
        return;
      }
      // Success — update module-level standard reference and recompute derived values
      _std=newData;
      _recomputeStdVars();
      // Trigger full re-render (key={stdVer} remounts all tabs fresh,
      // which creates new Workers with the updated standard)
      setStdVer(function(v){return v+1;});
      setMsg("Loaded: "+(_std.standard.name||file.name));
      setTimeout(function(){setMsg("");},3000);
    };
    reader.onerror=function(){setStdErr("Failed to read file");};
    reader.readAsText(file);
    // Reset the input so the same file can be re-uploaded
    ev.target.value="";
  }

  return (
    <div style={{minHeight:"100vh",background:T.bg,color:T.tx,fontFamily:"'IBM Plex Sans', system-ui, sans-serif"}}>
      {/* Header */}
      <div style={{borderBottom:"1px solid "+T.bd,padding:"10px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.card}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:15,fontWeight:600,letterSpacing:"-0.005em"}}>Laser Skin MPE Calculator</span>
          <span style={{fontSize:12,fontWeight:500,fontFamily:"'IBM Plex Mono', monospace",color:T.ac,background:T.card,border:"1px solid "+T.bd,borderRadius:4,padding:"4px 12px"}}>{STD_NAME}</span>
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleStdUpload} style={{display:"none"}}/>
          <button onClick={function(){fileRef.current&&fileRef.current.click();}} style={{fontSize:11,padding:"4px 10px",border:"1px solid "+T.bd,borderRadius:4,cursor:"pointer",background:"transparent",color:T.ac,fontWeight:500,display:"inline-flex",alignItems:"center",gap:4}} title="Upload a custom standard JSON file">{"\u21C5"} Load standard</button>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>{msg?<span style={{fontSize:11,color:T.a2,fontWeight:600}}>{msg}</span>:null}<button onClick={function(){setTheme(theme==="light"?"dark":"light")}} style={{padding:"3px 8px",fontSize:13,border:"1px solid "+T.bd,cursor:"pointer",background:"transparent",color:T.tm,borderRadius:4}} title="Toggle theme">{theme==="light"?"\u263E":"\u2600"}</button></div>
      </div>
      {stdErr?<div style={{padding:"8px 24px",background:"#fbe9e7",borderBottom:"1px solid #f4c7c3",fontSize:11,color:"#c62828",fontFamily:"'IBM Plex Mono', monospace"}}>{"\u26a0"} {stdErr}</div>:null}
      {/* Tab bar */}
      <div role="tablist" aria-label="Calculator sections" style={{borderBottom:"1px solid "+T.bd,padding:"0 24px",background:T.card,display:"flex",gap:4}}>
        <button role="tab" aria-selected={tab==="mpe"} aria-controls="panel-mpe" id="tab-mpe" onClick={function(){setTab("mpe")}} style={tabBt("mpe")}>MPE Calculator</button>
        <button role="tab" aria-selected={tab==="scan"} aria-controls="panel-scan" id="tab-scan" onClick={function(){setTab("scan")}} style={tabBt("scan")}>Scanning Protocols</button>
        <button role="tab" aria-selected={tab==="pa"} aria-controls="panel-pa" id="tab-pa" onClick={function(){setTab("pa")}} style={tabBt("pa")}>Photoacoustic SNR Optimizer</button>
      </div>
      <div key={stdVer} style={{padding:"16px 24px 40px",maxWidth:1100,margin:"0 auto"}}>
        {tab==="mpe"?<div role="tabpanel" id="panel-mpe" aria-labelledby="tab-mpe"><ErrorBoundary theme={T}><MPETab T={T} theme={theme} msg={msg} setMsg={setMsg}/></ErrorBoundary></div>:null}
        {tab==="scan"?<div role="tabpanel" id="panel-scan" aria-labelledby="tab-scan"><ErrorBoundary theme={T}><ScanTab T={T} theme={theme} msg={msg} setMsg={setMsg}/></ErrorBoundary></div>:null}
        {tab==="pa"?<div role="tabpanel" id="panel-pa" aria-labelledby="tab-pa"><ErrorBoundary theme={T}><PATab T={T} theme={theme} msg={msg} setMsg={setMsg}/></ErrorBoundary></div>:null}

      </div>
    </div>
  );
}
