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
function rpCalc(wl,tau,prf,T){
  var r=_E.repPulse(wl,tau,prf,T);
  return{r1:r.rule1,r2:r.rule2,H:r.H,N:r.N,bd:r.binding};
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

function si(v,u){if(!isFinite(v))return"\u2014";var a=Math.abs(v);if(a===0)return"0 "+u;if(a>=1e6)return numFmt(v,4)+" "+u;if(a>=1e3)return(v/1e3).toPrecision(4)+" k"+u;if(a>=.1)return v.toPrecision(4)+" "+u;if(a>=1e-3)return(v*1e3).toPrecision(4)+" m"+u;if(a>=1e-6)return(v*1e6).toPrecision(4)+" \u00b5"+u;if(a>=1e-9)return(v*1e9).toPrecision(4)+" n"+u;return numFmt(v,4)+" "+u;}

/* ═══════ SCIENTIFIC NOTATION ═══════ */
var SUPS={"-":"\u207b","0":"\u2070","1":"\u00b9","2":"\u00b2","3":"\u00b3","4":"\u2074","5":"\u2075","6":"\u2076","7":"\u2077","8":"\u2078","9":"\u2079"};
function supStr(n){var s=String(n),r="";for(var i=0;i<s.length;i++){r+=SUPS[s[i]]||s[i];}return r;}
function numFmt(v,p){if(!isFinite(v))return"\u2014";if(v===0)return"0";var a=Math.abs(v),pr=p||4;if(a>=0.01&&a<1e4)return v.toPrecision(pr);var exp=Math.floor(Math.log10(a));var man=v/Math.pow(10,exp);return man.toFixed(pr-1)+"\u00d710"+supStr(exp);}
function logTick(v){if(v==null||!isFinite(v)||v<=0)return"";var lg=Math.log10(v);if(Math.abs(lg-Math.round(lg))<0.01){var exp=Math.round(lg);return"10"+supStr(exp);}var exp2=Math.floor(lg);var man=v/Math.pow(10,exp2);return man.toPrecision(2)+"\u00d710"+supStr(exp2);}
function ft(t){if(t===undefined||t===null||isNaN(t))return"\u2014";if(t<1e-9)return(t*1e12).toPrecision(3)+" ps";if(t<1e-6)return(t*1e9).toPrecision(3)+" ns";if(t<1e-3)return(t*1e6).toPrecision(3)+" \u00b5s";if(t<1)return(t*1e3).toPrecision(3)+" ms";return t.toPrecision(3)+" s";}
var STD_NAME=_std.standard.name;
var STD_REF=_std.standard.reference;
var STD_TABLES=_std.standard.tables_used;

/* ═══════ UNIT CONVERSION ═══════ */
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

var WC=["#0072B2","#E69F00","#009E73","#CC79A7","#56B4E9","#D55E00","#B8860B","#000000"];
var DTICKS=[1e-9,1e-7,1e-5,1e-3,.1,10,1000];
var WLTICKS=[200,400,700,1000,1400,2000,3000];
function dtf(v){if(v>=1e3)return(v/1e3)+"ks";if(v>=1)return v+"s";if(v>=1e-3)return(v*1e3)+"ms";if(v>=1e-6)return(v*1e6)+"\u00b5s";return(v*1e9)+"ns";}

var TH={
  light:{bg:"#f0f2f5",card:"#f8f9fb",bgI:"#eaecf0",bd:"#d4d8de",bl:"#a0a4aa",tx:"#1a1d22",tm:"#525960",td:"#737880",ac:"#0072B2",a2:"#E69F00",ok:"#0072B2",no:"#D55E00",gr:"#e4e7eb",tp:"#f8f9fb"},
  dark:{bg:"#28282e",card:"#333338",bgI:"#2c2c32",bd:"#48484f",bl:"#58585f",tx:"#d8d8e0",tm:"#a0a0a8",td:"#808088",ac:"#56B4E9",a2:"#E69F00",ok:"#56B4E9",no:"#E69F00",gr:"#38383e",tp:"#333338"}
};

var uid=1;
function mkL(wl){return{id:uid++,wl:wl,wlStr:String(wl),wlU:"nm",ds:"10",dur:1e-8,dU:"ns",rp:false,prf:10,prfStr:"10",prfU:"Hz",tT:1,tTStr:"1",tTU:"s",show:true,fU:"mJ/cm\u00b2",eU:"W/cm\u00b2"};}
function pDur(s){var v=parseFloat(s);return(isFinite(v)&&v>0)?v:null;}
function uMult(arr,uid2){for(var i=0;i<arr.length;i++){if(arr[i].id===uid2)return arr[i];}return arr[0];}
function computeR(L){var h=skinMPE(L.wl,L.dur);var rp=L.rp?rpCalc(L.wl,L.dur,L.prf,L.tT):null;var effH=rp?rp.H:h;var irr=isFinite(effH)&&L.dur>0?effH/L.dur:NaN;return{wl:L.wl,dur:L.dur,h:h,rp:rp,effH:effH,irr:irr,ca:CA(L.wl),band:bnd(L.wl),rule:rp?rp.bd:"Rule 1"};}

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
  var lb={display:"block",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:4};
  var ipFull={width:"100%",padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};
  var thS={padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700,letterSpacing:"0.03em"};
  var tdSt={padding:"7px 10px",fontSize:12,fontFamily:"monospace"};
  var hSel={fontSize:9,padding:"2px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer",fontWeight:700,outline:"none"};

  function calc(){setCv(function(c){return c+1;});setDirty(false);setBeamDirty(false);}
  function beamCalc(){setBeamDirty(false);}
  useEffect(function(){calc();},[]);
  function upL(id,k,v){setLasers(lasers.map(function(L){if(L.id!==id)return L;var n={id:L.id,wl:L.wl,wlStr:L.wlStr,wlU:L.wlU,ds:L.ds,dur:L.dur,dU:L.dU,rp:L.rp,prf:L.prf,prfStr:L.prfStr,prfU:L.prfU,tT:L.tT,tTStr:L.tTStr,tTU:L.tTU,show:L.show,fU:L.fU,eU:L.eU};n[k]=v;if(k==="wlStr"){var wv=Number(v)*uMult(WL_UNITS,n.wlU).toNM;if(isFinite(wv)&&wv>=180&&wv<=1e6)n.wl=wv;}if(k==="wlU"){var cWl=parseFloat(n.wlStr);if(isFinite(cWl)){var nmVal=cWl*uMult(WL_UNITS,L.wlU).toNM;n.wlStr=(nmVal/uMult(WL_UNITS,v).toNM).toPrecision(6).replace(/\.?0+$/,"");}n.wlU=v;}if(k==="ds"){var d=pDur(v);if(d)n.dur=d*uMult(DUR_UNITS,n.dU).toS;}if(k==="dU"){var cD=parseFloat(n.ds);if(isFinite(cD)&&cD>0){var sVal=cD*uMult(DUR_UNITS,L.dU).toS;n.ds=(sVal/uMult(DUR_UNITS,v).toS).toPrecision(4).replace(/\.?0+$/,"");}n.dU=v;var d2=parseFloat(n.ds);if(d2>0)n.dur=d2*uMult(DUR_UNITS,v).toS;}if(k==="prfStr"){n.prfStr=v;var pp=Number(v)*uMult(FREQ_UNITS,n.prfU).toHz;if(isFinite(pp)&&pp>0)n.prf=pp;}if(k==="prfU"){var cP=parseFloat(n.prfStr);if(isFinite(cP)&&cP>0){var hzVal=cP*uMult(FREQ_UNITS,L.prfU).toHz;n.prfStr=(hzVal/uMult(FREQ_UNITS,v).toHz).toPrecision(4).replace(/\.?0+$/,"");}n.prfU=v;var p2=parseFloat(n.prfStr);if(p2>0)n.prf=p2*uMult(FREQ_UNITS,v).toHz;}if(k==="tTStr"){n.tTStr=v;var tt=Number(v)*uMult(DUR_UNITS,n.tTU).toS;if(isFinite(tt)&&tt>0)n.tT=tt;}if(k==="tTU"){var cT=parseFloat(n.tTStr);if(isFinite(cT)&&cT>0){var sVal2=cT*uMult(DUR_UNITS,L.tTU).toS;n.tTStr=(sVal2/uMult(DUR_UNITS,v).toS).toPrecision(4).replace(/\.?0+$/,"");}n.tTU=v;var t2=parseFloat(n.tTStr);if(t2>0)n.tT=t2*uMult(DUR_UNITS,v).toS;}return n;}));setDirty(true);}
  function addL(){var v=parseInt(nw,10);if(!isNaN(v)&&v>=180&&v<=1e6){setLasers(lasers.concat([mkL(v)]));setNw("");setDirty(true);}}
  function rmL(id){if(lasers.length<=1)return;setLasers(lasers.filter(function(L){return L.id!==id}));setDirty(true);}
  function toggleShow(id){setLasers(lasers.map(function(L){if(L.id!==id)return L;var n={id:L.id,wl:L.wl,wlStr:L.wlStr,ds:L.ds,dur:L.dur,rp:L.rp,prf:L.prf,prfStr:L.prfStr,tT:L.tT,tTStr:L.tTStr,show:!L.show,fU:L.fU,eU:L.eU};return n;}));}
  var _pfu=useState("mJ/cm\u00b2"),plotFU=_pfu[0],setPlotFU=_pfu[1];
  var results=useMemo(function(){return lasers.map(computeR);},[cv,lasers]);
  var plotLasers=lasers.filter(function(L){return L.show});
  var pfm=fluMult(plotFU);
  var wld=useMemo(function(){var durs=[];plotLasers.forEach(function(L){if(durs.indexOf(L.dur)===-1)durs.push(L.dur);});var sp=[[180,400,3],[400,700,4],[700,1400,8],[1400,3000,15]];var pp=[];for(var si2=0;si2<sp.length;si2++)for(var w=sp[si2][0];w<=sp[si2][1];w+=sp[si2][2]){var row={wl:w},any=false;for(var di=0;di<durs.length;di++){var h=skinMPE(w,durs[di]);if(isFinite(h)&&h>0){row["d"+di]=h*pfm;any=true;}}if(any)pp.push(row);}return{d:pp,durs:durs};},[cv,plotLasers,pfm]);
  var drd=useMemo(function(){var ws=[];plotLasers.forEach(function(L){if(ws.indexOf(L.wl)===-1)ws.push(L.wl);});var a=[];for(var e=-9;e<=4.5;e+=.05){var t=Math.pow(10,e),r={t:t},any=false;for(var j=0;j<ws.length;j++){var h=skinMPE(ws[j],t);if(isFinite(h)&&h>0){r["w"+ws[j]]=h*pfm;any=true;}}if(any)a.push(r);}return{d:a,ws:ws};},[cv,plotLasers,pfm]);

  function doExport(){try{var ths2="background:#f1f5f9;padding:8px 12px;text-align:left;border-bottom:2px solid #d4d4d4;font-size:11px";var tds2="padding:6px 12px;border-bottom:1px solid #e5e5e5;font-size:13px";var rows="";for(var i=0;i<results.length;i++){var r=results[i],L=lasers[i];rows+='<tr><td style="'+tds2+'">'+r.wl+'</td><td style="'+tds2+'">'+durInUnit(r.dur,sumDurU)+'</td><td style="'+tds2+'">'+r.band+'</td><td style="'+tds2+'">'+(r.wl>=400&&r.wl<1400?r.ca.toFixed(3):"\u2014")+'</td><td style="'+tds2+';font-weight:700">'+convFN(r.effH,sumFluU)+'</td><td style="'+tds2+'">'+convEN(r.irr,sumIrrU)+'</td><td style="'+tds2+'">'+(L.rp?L.prf:"\u2014")+'</td><td style="'+tds2+'">'+(r.rp?Math.round(r.rp.N):"1")+'</td><td style="'+tds2+'">'+r.rule+'</td></tr>';}var html='<!DOCTYPE html><html><head><title>MPE Report</title><style>body{font-family:Helvetica,sans-serif;max-width:960px;margin:40px auto;color:#171717;line-height:1.5;padding:0 20px}table{border-collapse:collapse;width:100%;margin:16px 0}th{'+ths2+'}h1{font-size:22px}h2{font-size:14px;color:#525252;margin:24px 0 8px}</style></head><body><h1>Laser Skin MPE Report</h1><p style="color:#737373;font-size:12px">'+STD_NAME+' \u2014 '+new Date().toLocaleString()+'</p><h2>Results</h2><table><thead><tr><th style="'+ths2+'">Wavelength (nm)</th><th style="'+ths2+'">Duration ('+sumDurU+')</th><th style="'+ths2+'">Band</th><th style="'+ths2+'">C<sub>A</sub></th><th style="'+ths2+'">Fluence, H ('+sumFluU+')</th><th style="'+ths2+'">Irradiance, E ('+sumIrrU+')</th><th style="'+ths2+'">Repetition Rate (Hz)</th><th style="'+ths2+'">Pulses</th><th style="'+ths2+'">Rule</th></tr></thead><tbody>'+rows+'</tbody></table><p style="margin-top:32px;font-size:11px;color:#a3a3a3;border-top:1px solid #e5e5e5;padding-top:12px">'+STD_NAME+' \u2014 For research and educational purposes only. Not a certified safety instrument. Skin MPE only \u2014 ocular limits not evaluated. Verify all values against the applicable standard with a qualified Laser Safety Officer.</p></body></html>';var u="data:text/html;charset=utf-8,"+encodeURIComponent(html);var a=document.createElement("a");a.href=u;a.download="mpe-report.html";a.style.display="none";var root=document.getElementById("root");root.appendChild(a);a.click();root.removeChild(a);setMsg("Report downloaded!");setTimeout(function(){setMsg("")},2e3);}catch(e){setMsg("Export failed");}}

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {lasers.map(function(L,idx){var r=results[idx];var col=WC[idx%WC.length];return (
        <div key={L.id} style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 14px",borderBottom:"1px solid "+T.bd,background:T.bg}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:10,height:10,borderRadius:5,background:col,flexShrink:0}}/><span style={{fontSize:14,fontWeight:700}}>{L.wl} nm</span><span style={{fontSize:11,color:T.td}}>{r.band}</span>{r.wl>=400&&r.wl<1400?<span style={{fontSize:10,color:T.td,fontFamily:"monospace"}}>C{"\u2090"} = {r.ca.toFixed(3)}</span>:null}</div>
            {lasers.length>1?<button onClick={function(){rmL(L.id)}} style={{background:"none",border:"none",color:T.td,cursor:"pointer",fontSize:15}}>{"\u00d7"}</button>:null}
          </div>
          <div style={{padding:"12px 14px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div><label style={lb}>Wavelength</label><div style={{display:"flex",gap:4}}><input type="text" value={L.wlStr} onChange={function(e){upL(L.id,"wlStr",e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/><select value={L.wlU} onChange={function(e){upL(L.id,"wlU",e.target.value)}} style={{fontSize:11,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{WL_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div><div style={{fontSize:9,color:T.td,marginTop:3,fontFamily:"monospace"}}>{L.wl<400?"UV 180\u2013400 nm":L.wl<700?"Visible 400\u2013700 nm":L.wl<1400?"Near-IR 700\u20131400 nm":"Far-IR 1400+ nm"}</div></div>
              <div><label style={lb}>Pulse Duration</label><div style={{display:"flex",gap:4}}><input type="text" value={L.ds} onChange={function(e){upL(L.id,"ds",e.target.value)}} placeholder="e.g. 10" style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/><select value={L.dU} onChange={function(e){upL(L.id,"dU",e.target.value)}} style={{fontSize:11,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div><div style={{fontSize:9,color:T.td,marginTop:3,fontFamily:"monospace"}}>= {ft(L.dur)}</div></div>
            </div>
            <div style={{marginTop:10,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:T.tm}} onClick={function(){upL(L.id,"rp",!L.rp)}}><div style={{width:34,height:18,borderRadius:9,background:L.rp?T.a2:"#a3a3a3",position:"relative",flexShrink:0,transition:"background 0.15s"}}><div style={{width:14,height:14,borderRadius:7,background:"#fff",position:"absolute",top:2,left:L.rp?18:2,transition:"left 0.15s",boxShadow:"0 1px 2px rgba(0,0,0,0.15)"}}/></div>Repetitive Pulse</label>
              {L.rp?<div style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap"}}><div><label style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Repetition Rate</label><div style={{display:"flex",gap:3}}><input type="text" value={L.prfStr} onChange={function(e){upL(L.id,"prfStr",e.target.value)}} style={{width:70,padding:"4px 8px",fontSize:12,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><select value={L.prfU} onChange={function(e){upL(L.id,"prfU",e.target.value)}} style={{fontSize:10,padding:"2px 4px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:3,color:T.tx,outline:"none",cursor:"pointer"}}>{FREQ_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div></div><div><label style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Exposure Time</label><div style={{display:"flex",gap:3}}><input type="text" value={L.tTStr} onChange={function(e){upL(L.id,"tTStr",e.target.value)}} style={{width:70,padding:"4px 8px",fontSize:12,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><select value={L.tTU} onChange={function(e){upL(L.id,"tTU",e.target.value)}} style={{fontSize:10,padding:"2px 4px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:3,color:T.tx,outline:"none",cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div></div></div>:null}
            </div>
            {r?<div style={{marginTop:12,paddingTop:10,borderTop:"1px solid "+T.bd}}>
              {/* Task 7: Section 1 — MPE (total exposure limit) */}
              {(function(){
                // Task 6: determine if irradiance is the primary standard quantity
                // ICNIRP Table 7: for t ≥ 10s at λ ≥ 400nm, the limit is expressed as irradiance
                var evalDur=L.rp?L.tT:L.dur;
                var irrPrimary=(r.wl>=400&&evalDur>=10);
                var totalH=L.rp?skinMPE(r.wl,L.tT):r.h;
                var totalE=isFinite(totalH)&&evalDur>0?totalH/evalDur:NaN;
                var durLabel=L.rp?"T = "+ft(L.tT):"\u03c4 = "+ft(L.dur);
                return <div style={{marginBottom:L.rp?12:0}}>
                  <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.ac,marginBottom:8}}>{L.rp?"MPE (total exposure at "+durLabel+")":"MPE"}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"+(L.rp?"":" 1fr"),gap:12}}>
                    <div style={{padding:irrPrimary?"6px 0":"6px 0 6px 0",borderLeft:!irrPrimary?"3px solid "+T.ac:"none",paddingLeft:!irrPrimary?8:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                        <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Fluence (H)</div>
                        <select value={L.fU} onChange={function(e){upL(L.id,"fU",e.target.value)}} style={{fontSize:9,padding:"1px 4px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:3,color:T.tx,outline:"none",cursor:"pointer"}}>
                          {FLUENCE_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}
                        </select>
                      </div>
                      <div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:!irrPrimary?T.ac:T.tm}}>{convF(totalH,L.fU)}</div>
                      <div style={{fontSize:9,color:!irrPrimary?T.a2:T.td,marginTop:1}}>{!irrPrimary?STD_NAME+" table value":"= E \u00d7 "+durLabel}</div>
                    </div>
                    <div style={{borderLeft:irrPrimary?"3px solid "+T.ac:"none",paddingLeft:irrPrimary?8:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                        <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Irradiance (E)</div>
                        <select value={L.eU} onChange={function(e){upL(L.id,"eU",e.target.value)}} style={{fontSize:9,padding:"1px 4px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:3,color:T.tx,outline:"none",cursor:"pointer"}}>
                          {IRRAD_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}
                        </select>
                      </div>
                      <div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:irrPrimary?T.ac:T.tm}}>{convE(totalE,L.eU)}</div>
                      <div style={{fontSize:9,color:irrPrimary?T.a2:T.td,marginTop:1}}>{irrPrimary?STD_NAME+" table value":"E = H / "+durLabel}</div>
                    </div>
                    {!L.rp?<div><div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Mode</div><div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:T.tm}}>Single pulse</div><div style={{fontSize:9,color:T.td,marginTop:1}}>{durLabel}</div></div>:null}
                  </div>
                </div>;
              })()}
              {/* Task 7: Section 2 — Per-Pulse MPE (only for repetitive pulses) */}
              {r.rp?<div style={{paddingTop:10,borderTop:"1px solid "+T.bd}}>
                <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.ac,marginBottom:8}}>Per-Pulse MPE</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                      <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Fluence (H)</div>
                    </div>
                    <div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:T.ac}}>{convF(r.effH,L.fU)}</div>
                    <div style={{fontSize:9,color:T.a2,marginTop:1}}>Governing per-pulse limit</div>
                  </div>
                  <div>
                    <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Irradiance (E)</div>
                    <div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:T.tm}}>{convE(r.irr,L.eU)}</div>
                    <div style={{fontSize:9,color:T.td,marginTop:1}}>E = H / {"\u03c4"}</div>
                  </div>
                  <div><div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Governing Rule</div><div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:T.ac}}>{r.rule}</div><div style={{fontSize:9,color:T.td,marginTop:1}}>{Math.round(r.rp.N)+" pulses in "+ft(L.tT)}</div></div>
                </div>
                {/* Task 5: Rule comparison with correct labels; Task 8: show correct values */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
                  <div style={{padding:"8px 12px",borderRadius:4,opacity:r.rp.bd==="Rule 1"?1:0.35,background:r.rp.bd==="Rule 1"?T.ac+"12":"transparent",border:"1px solid "+(r.rp.bd==="Rule 1"?T.ac:T.bd)}}>
                    <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Rule 1 MPE (single pulse limit)</div>
                    <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:r.rp.bd==="Rule 1"?T.ac:T.td,marginTop:2}}>{convF(r.rp.r1,L.fU)}</div>
                    <div style={{fontSize:8,color:T.td,marginTop:2}}>MPE({"\u03c4"} = {ft(L.dur)})</div>
                  </div>
                  <div style={{padding:"8px 12px",borderRadius:4,opacity:r.rp.bd==="Rule 2"?1:0.35,background:r.rp.bd==="Rule 2"?T.ac+"12":"transparent",border:"1px solid "+(r.rp.bd==="Rule 2"?T.ac:T.bd)}}>
                    <div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Rule 2 (average)</div>
                    <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:r.rp.bd==="Rule 2"?T.ac:T.td,marginTop:2}}>{convF(r.rp.r2,L.fU)}</div>
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
        <div style={{display:"flex",gap:6,alignItems:"center"}}><input type="number" placeholder="Wavelength (nm)" value={nw} onChange={function(e){setNw(e.target.value)}} onKeyDown={function(e){if(e.key==="Enter"){e.preventDefault();addL();}}} style={{width:160,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><button onClick={addL} style={mkBt(true,T.a2,T)}>+ Add Wavelength</button></div>
        <div style={{display:"flex",alignItems:"center",gap:10}}><button onClick={calc} style={{padding:"8px 24px",fontSize:13,fontWeight:700,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:5,cursor:"pointer"}}>{dirty?"Calculate":"Calculated \u2713"}</button>{dirty?<span style={{fontSize:11,color:T.ac,fontWeight:500}}>Click to update</span>:null}</div>
      </div>
      {/* ═══════ BEAM SAFETY EVALUATION (collapsible) ═══════ */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
        <button onClick={function(){setBeamOpen(!beamOpen)}} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"transparent",border:"none",cursor:"pointer",color:T.tm,textAlign:"left"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:600,color:beamOpen?T.ac:T.tm}}>{beamOpen?"\u25BC":"\u25B6"}</span>
            <span style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:beamOpen?T.ac:T.tm}}>Beam Safety Evaluation</span>
            {!beamOpen?<span style={{fontSize:10,color:T.td,fontWeight:400}}>{"\u2014"} Evaluate max permissible pulse energy for a specific beam diameter</span>:null}
            {!beamOpen?<span style={{fontSize:9,fontFamily:"monospace",color:T.tm,background:T.bgI,padding:"2px 8px",borderRadius:3,border:"1px solid "+T.bd}}>Limiting aperture: {getAperture(lasers[0]?lasers[0].wl:532).toFixed(1)} mm (skin, {STD_NAME} Table 8)</span>:null}
          </div>
        </button>
        {beamOpen?(
          <div style={{padding:"0 14px 14px"}}>
            {/* Convention warning — reads from standard JSON */}
            {(function(){
              var ap=_std.supplementary&&_std.supplementary.limiting_apertures;
              var defn=(ap&&ap.beam_diameter_definition)||"For Gaussian beams, beam diameter is the 1/e diameter (37% of peak irradiance).";
              var dRef=(ap&&ap.beam_diameter_reference)||"";
              return (
                <div style={{padding:"8px 12px",marginBottom:12,borderRadius:4,background:T.bgI,border:"1px solid "+T.bd,fontSize:10,color:T.tm,lineHeight:1.7}}>
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
                  <input type="text" value={bdStr} onChange={function(e){setBdStr(e.target.value);var v=parseFloat(e.target.value);if(isFinite(v)&&v>0){var toMM=1;for(var i=0;i<BEAM_DIA_UNITS.length;i++){if(BEAM_DIA_UNITS[i].id===bdUnit)toMM=BEAM_DIA_UNITS[i].toMM;}setBeamDia(v*toMM);}setBeamDirty(true);}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/>
                  <select value={bdUnit} onChange={function(e){var oldMM=1,newMM=1;for(var i=0;i<BEAM_DIA_UNITS.length;i++){if(BEAM_DIA_UNITS[i].id===bdUnit)oldMM=BEAM_DIA_UNITS[i].toMM;if(BEAM_DIA_UNITS[i].id===e.target.value)newMM=BEAM_DIA_UNITS[i].toMM;}var cur=parseFloat(bdStr);if(isFinite(cur)){var mm=cur*oldMM;setBdStr((mm/newMM).toPrecision(4));}setBdUnit(e.target.value);setBeamDirty(true);}} style={{fontSize:11,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{BEAM_DIA_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
                </div>
              </div>
              <div>
                <label style={lb}>Pulse Energy (optional)</label>
                <div style={{display:"flex",gap:4}}>
                  <input type="text" placeholder="e.g. 500" value={peStr} onChange={function(e){setPeStr(e.target.value);setBeamDirty(true);}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/>
                  <select value={peUnit} onChange={function(e){setPeUnit(e.target.value);setBeamDirty(true);}} style={{fontSize:11,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{ENERGY_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
                </div>
              </div>
              <div>
                <label style={lb}>Or Direct Fluence</label>
                <div style={{display:"flex",gap:4}}>
                  <input type="text" placeholder="Your fluence" value={fl} step="any" onChange={function(e){setFl(e.target.value);setBeamDirty(true);}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"}}/>
                  <select value={flUnit} onChange={function(e){setFlUnit(e.target.value);setBeamDirty(true);}} style={{fontSize:11,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{FLUENCE_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
                </div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <button onClick={beamCalc} style={{padding:"8px 24px",fontSize:13,fontWeight:700,background:beamDirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:5,cursor:"pointer"}}>{beamDirty?"Calculate":"Calculated \u2713"}</button>
              {beamDirty?<span style={{fontSize:11,color:T.ac,fontWeight:500}}>Click to update beam evaluation</span>:null}
            </div>
            {/* Wavelength selection */}
            <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Evaluate</span>
              {lasers.map(function(L,i){var col=WC[i%WC.length];var sel=isBeamSel(L.id);return(
                <label key={L.id} style={{display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,fontFamily:"monospace",color:sel?col:T.td,opacity:sel?1:0.4}}>
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

              var bthS={padding:"6px 8px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.tx,fontSize:8,fontWeight:700,letterSpacing:"0.03em",whiteSpace:"nowrap"};
              var btdS={padding:"6px 8px",fontSize:11,fontFamily:"monospace",borderBottom:"1px solid "+T.bd,color:T.tx};

              return(
                <div style={{opacity:(dirty||beamDirty)?0.6:1,transition:"opacity 0.2s"}}>
                  {/* Task 4: Large area correction warning */}
                  {(function(){
                    var warns=[];
                    for(var wi2=0;wi2<selRows.length;wi2++){
                      var wr=selRows[wi2];if(wr.invalid)continue;
                      if(wr.r.wl>=1400&&wr.r.dur>=10){
                        var A_beam_cm2=wr.bev.area_cm2;
                        var A_beam_m2=A_beam_cm2/1e4;
                        if(A_beam_m2>=0.01){
                          var irr_limit;
                          if(A_beam_m2>=0.1)irr_limit=100; // W/m²
                          else irr_limit=10000/A_beam_m2; // proportional to 1/A, W/m² → between 1000 and 100
                          warns.push({wl:wr.r.wl, A_m2:A_beam_m2, limit_W_m2:irr_limit, limit_W_cm2:irr_limit/1e4});
                        }
                      }
                    }
                    if(warns.length===0)return null;
                    return <div style={{padding:"10px 12px",marginBottom:12,borderRadius:4,background:"#fff3e0",border:"1px solid #ffe0b2",fontSize:10,color:"#e65100",lineHeight:1.7}}>
                      <strong>{"\u26a0"} Large-Area Correction ({STD_NAME} Table 7, note c):</strong>{" "}
                      For {"\u03bb"} {"\u2265"} 1400 nm, t {"\u2265"} 10 s, and exposed areas {"\u2265"} 0.01 m{"\u00b2"}, the skin exposure limit is reduced.
                      {warns.map(function(w,wi3){
                        return <div key={wi3} style={{marginTop:4,fontFamily:"monospace"}}>
                          {w.wl} nm: beam area = {numFmt(w.A_m2,3)} m{"\u00b2"} {"\u2192"} limit = {numFmt(w.limit_W_m2,4)} W/m{"\u00b2"} = {numFmt(w.limit_W_cm2,4)} W/cm{"\u00b2"}
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
                          <td style={{padding:"6px 8px",fontWeight:700,fontSize:12,fontFamily:"monospace",color:col,borderBottom:"1px solid "+T.bd}}>{row.r.wl}</td>
                          <td style={btdS}>{durInUnit(row.r.dur,sumDurU)}</td>
                          <td style={{padding:"6px 8px",fontSize:11,color:T.tx,borderBottom:"1px solid "+T.bd}}>{row.r.band}</td>
                          <td style={btdS}>{row.bev.aperture_mm.toFixed(1)}</td>
                          <td style={{padding:"6px 8px",fontSize:11,fontFamily:"monospace",fontWeight:600,color:regC,borderBottom:"1px solid "+T.bd}}>{regLbl}</td>
                          <td style={{padding:"6px 8px",fontSize:11,fontFamily:"monospace",fontWeight:700,color:T.tx,borderBottom:"1px solid "+T.bd}}>{row.bev.d_eval_mm.toFixed(3)}</td>
                          <td style={btdS}>{fmtA(row.bev.area_cm2)}</td>
                          <td style={{padding:"6px 8px",fontSize:11,fontFamily:"monospace",fontWeight:700,borderBottom:"1px solid "+T.bd,color:T.tx}}>{fmtH(row.mpe)}</td>
                          <td style={{padding:"6px 8px",fontSize:11,fontFamily:"monospace",fontWeight:700,color:T.ac,borderBottom:"1px solid "+T.bd}}>{fmtE(row.E_max)}</td>
                          {hasInput?<td style={{padding:"6px 8px",fontSize:11,fontFamily:"monospace",fontWeight:700,color:row.safe===null?T.td:row.safe?T.ok:T.no,borderBottom:"1px solid "+T.bd}}>{row.ratio!==null?(row.safe?"\u2713 ":"! ")+row.ratio.toPrecision(3)+"\u00d7":"\u2014"}</td>:null}
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
      {/* Summary table */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"14px",opacity:dirty?0.6:1,transition:"opacity 0.2s"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td}}>Summary{dirty?" (stale)":""}</div><button onClick={doExport} style={mkBt(false,T.ac,T)}>Export Report</button></div>
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
          <td style={{padding:"7px 10px",color:WC[i%WC.length],fontWeight:700,fontSize:12,fontFamily:"monospace"}}>{r.wl}</td>
          <td style={tdSt}>{durInUnit(r.dur,sumDurU)}</td>
          <td style={{padding:"7px 10px",fontSize:12,color:T.tm}}>{r.band}</td>
          <td style={tdSt}>{r.wl>=400&&r.wl<1400?r.ca.toFixed(3):"\u2014"}</td>
          <td style={{padding:"7px 10px",fontSize:12,fontFamily:"monospace",fontWeight:700}}>{convFN(r.effH,sumFluU)}</td>
          <td style={tdSt}>{convEN(r.irr,sumIrrU)}</td>
          <td style={tdSt}>{L.rp?L.prf:"\u2014"}</td>
          <td style={tdSt}>{r.rp?Math.round(r.rp.N):"1"}</td>
          <td style={tdSt}>{r.rule}</td>
        </tr>);})}</tbody></table></div>
      </div>
      {/* Charts */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:6}}>Per-Pulse MPE Plot</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{lasers.map(function(L,i){var col=WC[i%WC.length];return (<label key={L.id} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:11,fontFamily:"monospace",color:L.show?col:T.td,opacity:L.show?1:0.4}}><input type="checkbox" checked={L.show} onChange={function(){toggleShow(L.id)}} style={{accentColor:col,width:13,height:13}}/>{L.wl} nm</label>);})}</div></div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <select value={plotFU} onChange={function(e){setPlotFU(e.target.value)}} style={{fontSize:10,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",cursor:"pointer"}}>{FLUENCE_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
            <div style={{display:"flex"}}><button onClick={function(){setCht("wl")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(cht==="wl"?T.ac:T.bd),cursor:"pointer",background:cht==="wl"?T.ac:"transparent",color:cht==="wl"?"#fff":T.tm,borderRadius:"4px 0 0 4px"}}>MPE vs. Wavelength</button><button onClick={function(){setCht("t")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(cht==="t"?T.ac:T.bd),cursor:"pointer",background:cht==="t"?T.ac:"transparent",color:cht==="t"?"#fff":T.tm,borderRadius:"0 4px 4px 0"}}>MPE vs. Duration</button></div><button onClick={function(){dlSVG(cht==="wl"?wRef:dRef,cht==="wl"?"mpe_vs_wavelength.svg":"mpe_vs_duration.svg",setMsg)}} style={mkBt(false,T.ac,T)}>{"\u2913"} Download SVG</button><button onClick={function(){if(cht==="wl"){var hdr=["wavelength_nm"];for(var di=0;di<wld.durs.length;di++)hdr.push("mpe_"+plotFU.replace(/[/\u00b2]/g,"")+"_t"+ft(wld.durs[di]).replace(/ /g,""));var nd=wld.d.map(function(row){var o={wavelength_nm:row.wl};for(var di2=0;di2<wld.durs.length;di2++){o[hdr[di2+1]]=row["d"+di2];}return o;});dlCSV(nd,hdr,"mpe_vs_wavelength.csv",setMsg);}else{var hdr2=["duration_s"];drd.ws.forEach(function(w){hdr2.push("mpe_"+plotFU.replace(/[/\u00b2]/g,"")+"_"+w+"nm");});var nd2=drd.d.map(function(row){var o2={duration_s:row.t};drd.ws.forEach(function(w){o2["mpe_"+plotFU.replace(/[/\u00b2]/g,"")+"_"+w+"nm"]=row["w"+w];});return o2;});dlCSV(nd2,hdr2,"mpe_vs_duration.csv",setMsg);}}} style={mkBt(false,T.a2,T)}>{"\u2913"} Download CSV</button></div>
        </div>
        {cht==="wl"?(<div ref={wRef}><div style={{fontSize:11,color:T.tm,marginBottom:4}}>Per-Pulse Skin MPE ({plotFU}) vs. Wavelength (nm){wld.durs.length===1?" \u2014 t = "+ft(wld.durs[0]):""}</div><ResponsiveContainer width="100%" height={320}><LineChart data={wld.d} margin={{top:8,right:16,bottom:4,left:8}}><CartesianGrid strokeDasharray="3 3" stroke={T.gr}/><XAxis dataKey="wl" type="number" domain={[180,3000]} ticks={WLTICKS} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} label={{value:"Wavelength (nm)",position:"insideBottom",offset:-2,style:{fontSize:10,fill:T.td}}}/><YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tickFormatter={logTick} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} width={65} label={{value:"Fluence, H ("+plotFU+")",angle:-90,position:"insideLeft",offset:0,style:{fontSize:10,fill:T.td,textAnchor:"middle"}}}/><Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:12,fontFamily:"monospace",color:T.tx}} labelFormatter={function(v){return v!=null?v+" nm":""}} formatter={function(v,n){if(v==null)return["",""];var idx2=parseInt(String(n).replace("d",""),10);var label=wld.durs[idx2]!==undefined?"t="+ft(wld.durs[idx2]):"MPE";return [numFmt(Number(v),4)+" "+plotFU,label]}}/>{wld.durs.map(function(d,di){var ci=0;for(var j=0;j<plotLasers.length;j++){if(plotLasers[j].dur===d){ci=lasers.indexOf(plotLasers[j]);break;}}return <Line key={"wlc"+di} dataKey={"d"+di} stroke={WC[ci%WC.length]} strokeWidth={2} dot={false} name={"t="+ft(d)} connectNulls={true} isAnimationActive={false}/>;})}{wld.durs.length>1?<Legend wrapperStyle={{fontSize:11,fontFamily:"monospace"}}/>:null}<ReferenceLine x={400} stroke={T.bl} strokeDasharray="4 4"/><ReferenceLine x={700} stroke={T.bl} strokeDasharray="4 4"/><ReferenceLine x={1400} stroke={T.bl} strokeDasharray="4 4"/>{plotLasers.map(function(L){var i=lasers.indexOf(L);var h=skinMPE(L.wl,L.dur);if(!isFinite(h)||h<=0)return null;return <ReferenceDot key={"wd"+L.id} x={L.wl} y={h*pfm} r={5} fill={WC[i%WC.length]} stroke={T.bg} strokeWidth={2}/>;})}</LineChart></ResponsiveContainer></div>):(<div ref={dRef}><div style={{fontSize:11,color:T.tm,marginBottom:4}}>Per-Pulse Skin MPE ({plotFU}) vs. Duration</div><ResponsiveContainer width="100%" height={320}><LineChart data={drd.d} margin={{top:8,right:16,bottom:4,left:8}}><CartesianGrid strokeDasharray="3 3" stroke={T.gr}/><XAxis dataKey="t" type="number" scale="log" domain={[1e-9,3e4]} ticks={DTICKS} tickFormatter={dtf} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd}/><YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tickFormatter={logTick} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} width={65} label={{value:"Fluence, H ("+plotFU+")",angle:-90,position:"insideLeft",offset:0,style:{fontSize:10,fill:T.td,textAnchor:"middle"}}}/><Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:12,fontFamily:"monospace",color:T.tx}} labelFormatter={function(v){return v!=null?ft(Number(v)):""}} formatter={function(v,n){if(v==null)return["",""];return [numFmt(Number(v),4)+" "+plotFU,String(n).replace("w","")+" nm"]}}/>{drd.ws.map(function(w,wi){var ci=0;for(var j=0;j<lasers.length;j++){if(lasers[j].wl===w&&lasers[j].show){ci=j;break;}}return <Line key={"ln"+w} dataKey={"w"+w} stroke={WC[ci%WC.length]} strokeWidth={2} dot={false} name={w+" nm"} connectNulls={true} isAnimationActive={false}/>;})}{drd.ws.length>1?<Legend wrapperStyle={{fontSize:11,fontFamily:"monospace"}}/>:null}{plotLasers.map(function(L){var i=lasers.indexOf(L);var h=skinMPE(L.wl,L.dur);if(!isFinite(h)||h<=0)return null;return <ReferenceDot key={"dd"+L.id} x={L.dur} y={h*pfm} r={5} fill={WC[i%WC.length]} stroke={T.bg} strokeWidth={2}/>;})}</LineChart></ResponsiveContainer></div>)}
      </div>
    </div>
  );
}

/* ═══════ PA TAB ═══════ */
/* Seven ICNIRP wavelength bands for multi-band fluence chart (cf. Francis et al. Fig. 2a) */
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

  var lb={display:"block",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:4};
  var secH={fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:10};
  var thS={padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.tx,fontSize:9,fontWeight:700,letterSpacing:"0.03em",whiteSpace:"nowrap"};
  var tdSt={padding:"7px 10px",fontSize:12,fontFamily:"monospace",borderBottom:"1px solid "+T.bd};
  var hSel={fontSize:9,padding:"2px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer",fontWeight:700,outline:"none"};
  var ipSm={padding:"5px 8px",fontSize:12,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};

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
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* ── Wavelength entries ── */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={secH}>Photoacoustic System Parameters</div>
        {entries.map(function(e,ei){var col=WC[ei%WC.length];return (
          <div key={e.id} style={{borderBottom:"1px solid "+T.bd,paddingBottom:10,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:10,height:10,borderRadius:5,background:col}}/>
                <span style={{fontSize:12,fontWeight:700,fontFamily:"monospace",color:col}}>{e.wl} nm</span>
                <span style={{fontSize:9,color:T.td}}>{bnd(e.wl)} {"\u00b7"} C{"\u2090"} = {CA(e.wl).toFixed(3)}</span>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {entries.length>1?<button onClick={function(){rmEntry(e.id)}} style={{background:"none",border:"none",color:T.td,cursor:"pointer",fontSize:15}}>{"\u00d7"}</button>:null}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div><label style={lb}>Wavelength</label><div style={{display:"flex",gap:3}}>
                <input type="text" value={e.wlStr} onChange={function(ev){upE(e.id,"wlStr",ev.target.value)}} style={Object.assign({},ipSm,{flex:1})}/>
                <select value={e.wlU} onChange={function(ev){upE(e.id,"wlU",ev.target.value)}} style={{fontSize:10,padding:"3px 4px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:3,color:T.tx,cursor:"pointer"}}>{WL_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
              </div></div>
              <div><label style={lb}>Pulse Duration</label><div style={{display:"flex",gap:3}}>
                <input type="text" value={e.tauStr} onChange={function(ev){upE(e.id,"tauStr",ev.target.value)}} style={Object.assign({},ipSm,{flex:1})}/>
                <select value={e.tauU} onChange={function(ev){upE(e.id,"tauU",ev.target.value)}} style={{fontSize:10,padding:"3px 4px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:3,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
              </div><div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"monospace"}}>= {ft(e.tau)}</div></div>
              <div><label style={lb}>Exposure Time</label><div style={{display:"flex",gap:3}}>
                <input type="text" value={e.TStr} onChange={function(ev){upE(e.id,"TStr",ev.target.value)}} style={Object.assign({},ipSm,{flex:1})}/>
                <select value={e.TU} onChange={function(ev){upE(e.id,"TU",ev.target.value)}} style={{fontSize:10,padding:"3px 4px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:3,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select>
              </div><div style={{fontSize:8,color:T.td,marginTop:2,fontFamily:"monospace"}}>= {ft(e.T)}</div></div>
            </div>
          </div>
        );})}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="number" placeholder="Wavelength (nm)" value={nwl} onChange={function(ev){setNwl(ev.target.value)}} onKeyDown={function(ev){if(ev.key==="Enter"){ev.preventDefault();addEntry();}}} style={{width:150,padding:"6px 10px",fontSize:12,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
            <button onClick={addEntry} style={mkBt(true,T.a2,T)}>+ Add Wavelength</button>
          </div>
          <button onClick={calc} style={{padding:"8px 24px",fontSize:13,fontWeight:700,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:5,cursor:"pointer"}}>{dirty?"Calculate":"Calculated \u2713"}</button>
        </div>
      </div>

      {/* ── Optimal PRF Summary Table ── */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14,opacity:dirty?0.6:1,transition:"opacity 0.2s"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={secH}>Optimal Repetition Rate Summary</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Include:</span>
            {entries.map(function(e,ei){var col=WC[ei%WC.length];return(
              <label key={e.id} style={{display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,fontFamily:"monospace",color:e.inTable?col:T.td,opacity:e.inTable?1:0.4}}>
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
          <td style={{padding:"7px 10px",fontSize:12,fontFamily:"monospace",fontWeight:700,color:col,borderBottom:"1px solid "+T.bd}}>{e2.wl}</td>
          <td style={tdSt}>{ft(e2.tau)}</td>
          <td style={tdSt}>{ft(e2.T)}</td>
          <td style={tdSt}>{isFinite(fopt)?numFmt(fopt,4):"\u2014"}</td>
          <td style={tdSt}>{isFinite(Nopt)?numFmt(Nopt,4):"\u2014"}</td>
          <td style={{padding:"7px 10px",fontSize:12,fontFamily:"monospace",fontWeight:700,borderBottom:"1px solid "+T.bd}}>{isFinite(snrOpt)?snrOpt.toFixed(2)+"\u00d7":"\u2014"}</td>
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
            <label key={e.id} style={{display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,fontFamily:"monospace",color:e.show?col:T.td,opacity:e.show?1:0.4}}>
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
                <XAxis dataKey="f" type="number" scale="log" domain={[1,3e5]} ticks={PRFTICKS} tickFormatter={prfFmt} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd}>
                  <Label value="Pulse Repetition Frequency (Hz)" position="insideBottom" offset={-18} style={{fontSize:10,fill:T.td}}/>
                </XAxis>
                <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tickFormatter={logTick} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} width={65}>
                  <Label value={"Per-Pulse Fluence Limit (mJ/cm\u00b2)"} angle={-90} position="insideLeft" offset={0} style={{fontSize:10,fill:T.td,textAnchor:"middle"}}/>
                </YAxis>
                <Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:11,fontFamily:"monospace",color:T.tx}} labelFormatter={function(v){return v!=null?numFmt(Number(v),3)+" Hz":""}} formatter={function(v,n){if(v==null)return["",""];var wi=parseInt(String(n).replace("w",""),10);var en=showEntries[wi];return[numFmt(Number(v),4)+" mJ/cm\u00b2",en?en.wl+" nm":""]}}/>
                {showEntries.map(function(e,i){
                  return <Line key={"fl"+e.id} dataKey={"w"+i} stroke={WC[entries.indexOf(e)%WC.length]} strokeWidth={2} dot={false} name={e.wl+" nm"} connectNulls={true} isAnimationActive={false}/>;
                })}
                {showEntries.length>1?<Legend verticalAlign="top" wrapperStyle={{fontSize:10,fontFamily:"monospace",paddingBottom:4}}/>:null}
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
                <XAxis dataKey="f" type="number" scale="log" domain={[1,3e5]} ticks={PRFTICKS} tickFormatter={prfFmt} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd}>
                  <Label value="Pulse Repetition Frequency (Hz)" position="insideBottom" offset={-18} style={{fontSize:10,fill:T.td}}/>
                </XAxis>
                <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tickFormatter={logTick} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} width={65}>
                  <Label value={"Relative SNR (\u221aN \u00d7 H / H\u2080)"} angle={-90} position="insideLeft" offset={0} style={{fontSize:10,fill:T.td,textAnchor:"middle"}}/>
                </YAxis>
                <Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:11,fontFamily:"monospace",color:T.tx}} labelFormatter={function(v){return v!=null?numFmt(Number(v),3)+" Hz":""}} formatter={function(v,n){if(v==null)return["",""];var si2=parseInt(String(n).replace("s",""),10);var en=showEntries[si2];return[Number(v).toFixed(3)+"\u00d7",en?en.wl+" nm, T="+ft(en.T):""]}}/>
                {showEntries.map(function(e,i){return <Line key={"snr"+e.id} dataKey={"s"+i} stroke={WC[entries.indexOf(e)%WC.length]} strokeWidth={2} dot={false} name={e.wl+" nm (T="+ft(e.T)+")"} connectNulls={true} isAnimationActive={false}/>;})
                }
                {showEntries.length>1?<Legend verticalAlign="top" wrapperStyle={{fontSize:10,fontFamily:"monospace",paddingBottom:4}}/>:null}
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
        <strong>Reference:</strong> Francis et al., {"\u201c"}Optimization of light source parameters for photoacoustic imaging: trade-offs, technologies, and clinical considerations,{"\u201d"} <em>JPhys Photonics</em> (2026). SNR analysis based on Equations 5{"\u2013"}12. All MPE values computed using {STD_NAME} skin exposure limits.
      </div>
    </div>
  );
}

/* ═══════ SCAN TAB ═══════ */
function ScanTab(p){
  var T=p.T,theme=p.theme,msg=p.msg,setMsg=p.setMsg;
  var _wl=useState("532"),wlS=_wl[0],setWlS=_wl[1]; var _wn=useState(532),wl=_wn[0],setWl=_wn[1];
  var _d=useState("1"),dS=_d[0],setDS=_d[1]; var _dn=useState(1),dia=_dn[0],setDia=_dn[1];
  var _tau=useState("10"),tauS=_tau[0],setTauS=_tau[1]; var _tn=useState(1e-8),tau=_tn[0],setTau=_tn[1];
  var _tU=useState("ns"),tauU=_tU[0],setTauU=_tU[1];
  var _prf=useState("10"),prfS=_prf[0],setPrfS=_prf[1]; var _pn=useState(10000),prf=_pn[0],setPrf=_pn[1];
  var _pfU=useState("kHz"),prfU=_pfU[0],setPrfU=_pfU[1];
  var _pw=useState("0.5"),pwS=_pw[0],setPwS=_pw[1]; var _pwn=useState(0.5),pw=_pwn[0],setPw=_pwn[1];
  var _vs=useState("100"),vS=_vs[0],setVS=_vs[1]; var _vn=useState(100),vel=_vn[0],setVel=_vn[1];
  var _pat=useState("bidi"),pat=_pat[0],setPat=_pat[1];
  var _lL=useState("20"),lLS=_lL[0],setLLS=_lL[1]; var _lLn=useState(20),lineL=_lLn[0],setLineL=_lLn[1];
  var _nL=useState("8"),nLS=_nL[0],setNLS=_nL[1]; var _nLn=useState(8),nLines=_nLn[0],setNLines=_nLn[1];
  var _ht=useState("0.5"),htS=_ht[0],setHtS=_ht[1]; var _htn=useState(0.5),hatch=_htn[0],setHatch=_htn[1];
  var _ppd=useState(8),ppd=_ppd[0],setPpd=_ppd[1];
  var _dwm=useState("gaussian"),dwm=_dwm[0],setDwm=_dwm[1];
  var _blk=useState(false),blk=_blk[0],setBlk=_blk[1];
  var _res=useState(null),res=_res[0],setRes=_res[1];
  var _cmp=useState(false),cmp=_cmp[0],setCmp=_cmp[1];
  var _dirty=useState(true),dirty=_dirty[0],setDirty=_dirty[1];
  var canRef=useRef(null);

  var lb={display:"block",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:4};
  var ip={width:"100%",padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};
  var secH={fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:10};
  var thS={padding:"5px 8px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700};
  var tdS={padding:"5px 8px",fontSize:11,fontFamily:"monospace"};

  function upN(setS,setN,s){setS(s);var v=Number(s);if(isFinite(v))setN(v);setDirty(true);}
  function upTau(s){setTauS(s);var v=Number(s);if(isFinite(v)&&v>0){var m=1;for(var i=0;i<DUR_UNITS.length;i++){if(DUR_UNITS[i].id===tauU)m=DUR_UNITS[i].toS;}setTau(v*m);}setDirty(true);}
  function upPrf(s){setPrfS(s);var v=Number(s);if(isFinite(v)&&v>0){var m=1;for(var i=0;i<FREQ_UNITS.length;i++){if(FREQ_UNITS[i].id===prfU)m=FREQ_UNITS[i].toHz;}setPrf(v*m);}setDirty(true);}

  var _perfNote=useState(""),perfNote=_perfNote[0],setPerfNote=_perfNote[1];
  var _workerRef=useRef(null);

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
      "  /* Separable fast-path: bypass segment construction entirely */",
      "  var sepP=(!isCW&&p.prf>0&&(p.pat==='linear'||p.pat==='raster'||p.pat==='bidi'))?",
      "    {d_1e_mm:p.dia,prf_hz:p.prf,pulse_energy_J:Ep,v_scan_mm_s:p.vel,",
      "     x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "     pattern:p.pat,blanking:p.blk,is_cw:false}:null;",
      "  /* Only build segments if separable path not available */",
      "  function bldSegs(pat,x0,y0,lL,nL,h,sv,jv,d,bl){",
      "    if(pat==='linear')return E.buildLinearScan(x0,y0,0,lL,sv,d);",
      "    if(pat==='bidi')return E.buildBidiRasterScan(x0,y0,lL,nL,h,sv,jv,d,bl);",
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
      "  var unitSepP=sepP?{d_1e_mm:p.dia,prf_hz:p.prf,pulse_energy_J:p.prf>0?1/p.prf:0,v_scan_mm_s:p.vel,",
      "     x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "     pattern:p.pat,blanking:p.blk,is_cw:false}:null;",
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
      "    var tSepP=sepP?{d_1e_mm:p.dia,prf_hz:p.prf,pulse_energy_J:Ep,v_scan_mm_s:tv,",
      "       x0:0,y0:0,line_length_mm:p.lineL,n_lines:p.nLines||1,hatch_mm:p.hatch||0,",
      "       pattern:p.pat,blanking:p.blk,is_cw:false}:null;",
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
      "      var scanDir=(p.pat==='bidi'&&li%2===1)?-1:1;",
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
      "    var vDir=(p.pat==='bidi'&&vli%2===1)?-1:1;",
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

  var SCAN_WORKER_TIMEOUT_MS = 30000; // 30-second safety timeout
  var _workerTimeout = useRef(null);

  function calculate(){
    // ── Input validation (safety-critical) ──
    if(!isFinite(wl)||wl<180||wl>1e6){alert("Wavelength must be 180–1,000,000 nm");return;}
    if(!isFinite(dia)||dia<=0){alert("Beam diameter must be > 0");return;}
    if(!isFinite(vel)||vel<=0){alert("Scan velocity must be > 0");return;}
    if(!isFinite(pw)||pw<=0){alert("Average power must be > 0");return;}
    if(!isFinite(prf)||prf<0){alert("Repetition rate must be ≥ 0");return;}
    if(!isFinite(tau)||tau<=0){alert("Pulse duration must be > 0");return;}
    if(pat!=="linear"){
      if(!isFinite(nLines)||nLines<1){alert("Number of lines must be ≥ 1");return;}
      if(!isFinite(hatch)||hatch<=0){alert("Hatch spacing must be > 0");return;}
      if(!isFinite(lineL)||lineL<=0){alert("Line length must be > 0");return;}
    }else{
      if(!isFinite(lineL)||lineL<=0){alert("Line length must be > 0");return;}
    }
    setCmp(true);setDirty(false);setPerfNote("");

    // ── Performance estimation ──
    // For separable-eligible scans, compute estimates from params directly
    // (avoids OOM from segment construction for micro-beams)
    var isCWEst=prf===0&&tau===0;
    var canSep=!isCWEst&&prf>0&&(pat==="linear"||pat==="raster"||pat==="bidi");
    var segsEst=canSep?[]:null;
    var estTime,estPulses;
    if(canSep){
      var lineDurEst=lineL/vel;
      var nLEst=pat==="linear"?1:nLines;
      var jumpVEst=vel*5;
      var hatchEst=pat==="linear"?0:(hatch||dia);
      var flybackEst=pat==="linear"?0:(lineL/jumpVEst+hatchEst/jumpVEst);
      estTime=nLEst*lineDurEst+(nLEst-1)*flybackEst;
      estPulses=prf*nLEst*lineDurEst;
    }else{
      if(pat==="linear") segsEst=scanBuildLinear(0,0,0,lineL,vel,dia);
      else if(pat==="bidi") segsEst=scanBuildBidi(0,0,lineL,nLines,hatch,vel,vel*5,dia,blk);
      else segsEst=scanBuildRaster(0,0,lineL,nLines,hatch,vel,vel*5,dia,blk);
      estTime=0;for(var ei=0;ei<segsEst.length;ei++)estTime+=dia/segsEst[ei].v;
      estPulses=prf*estTime;
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
    if(canSep){notes.push("Separable engine: "+Math.round(estPulses/1000)+"k pulses computed analytically");}
    else if(estPulses>_E.DEFAULT_MAX_COMPUTE_PULSES){
      var estStride=Math.ceil(estPulses/_E.DEFAULT_MAX_COMPUTE_PULSES);
      notes.push("Pulse subsampling active (stride="+estStride+"): computing 1 in every "+estStride+" pulses for "+Math.round(estPulses/1000)+"k total");
    }
    var auxPpd=Math.min(effPpd,3);
    var maxBisect=estPulses>100000?6:estPulses>10000?8:15;

    // ── Try Web Worker (off main thread) ──
    var worker=getWorker();
    if(worker){
      var params={std:__STD_DATA__,wl:wl,dia:dia,tau:tau,prf:prf,pw:pw,
        pat:pat,lineL:lineL,nLines:nLines,hatch:hatch,vel:vel,dwm:dwm,blk:blk,
        effPpd:effPpd,auxPpd:auxPpd,maxBisect:maxBisect,notes:notes,estPulses:estPulses};
      // Safety timeout: kill Worker if it takes too long
      if(_workerTimeout.current)clearTimeout(_workerTimeout.current);
      _workerTimeout.current=setTimeout(function(){
        if(_workerRef.current){_workerRef.current.terminate();_workerRef.current=null;}
        setPerfNote("Computation timed out after 30 seconds. Try reducing line count, increasing hatch spacing, or lowering PRF.");
        setCmp(false);
      },SCAN_WORKER_TIMEOUT_MS);
      worker.onmessage=function(ev){
        if(_workerTimeout.current){clearTimeout(_workerTimeout.current);_workerTimeout.current=null;}
        var r=ev.data;
        if(r.error){if(typeof console!=="undefined")console.error("Worker error:",r.error);setCmp(false);return;}
        /* Reconstruct grid with transferred TypedArrays */
        var g={nx:r.g.nx,ny:r.g.ny,dx:r.g.dx,xn:r.g.xn,yn:r.g.yn,
          flu:r.flu,pc:r.pc,ppH:r.ppH,lvt:r.lvt,mrv:r.mrv};
        var isCW2=prf===0&&tau===0;
        var beam2={wl:wl,d:dia,tau:tau,prf:prf,Ep:prf>0?pw/prf:0,P:pw,cw:isCW2};
        if(r.notes&&r.notes.length>0)setPerfNote(r.notes.join(". ")+".");
        setRes({g:g,st:r.st,sf:r.sf,segs:r.segs,beam:beam2,maxP:r.maxP,minV:r.minVel,
          pulses:r.pulseArr,effPpd:effPpd});
        setCmp(false);
      };
      worker.onerror=function(err){
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
      var Ep=prf>0?pw/prf:0;
      var isCW=prf===0&&tau===0;
      var beam={wl:wl,d:dia,tau:tau,prf:prf,Ep:Ep,P:pw,cw:isCW};

      // Build separable params if applicable (same logic as Worker)
      var canSep=!isCW&&prf>0&&(pat==="linear"||pat==="raster"||pat==="bidi");
      function mkSepP(vv,ep){
        if(!canSep)return null;
        return{d_1e_mm:dia,prf_hz:prf,pulse_energy_J:ep||Ep,v_scan_mm_s:vv,
          x0:0,y0:0,line_length_mm:lineL,n_lines:pat==="linear"?1:nLines,
          hatch_mm:pat==="linear"?0:hatch,pattern:pat,blanking:blk,is_cw:false};
      }

      var cr=scanCompute(beam,canSep?[]:segs,effPpd,mkSepP(vel));
      if(cr){
        var minV=isCW?(cr.st.mv||vel):0;
        var sf=scanSafety(cr.g,beam,cr.st.tt,dwm,minV,{v_mm_s:vel,line_spacing_mm:pat==="linear"?0:hatch,n_lines:pat==="linear"?1:nLines});
        var unitBeam={wl:wl,d:dia,tau:tau,prf:prf,Ep:prf>0?1/prf:0,P:1,cw:isCW};
        var unitCr=scanCompute(unitBeam,canSep?[]:segs,auxPpd,mkSepP(vel,prf>0?1/prf:0));
        var maxP=Infinity;
        if(unitCr){
          var upF=0;for(var ui=0;ui<unitCr.g.nx*unitCr.g.ny;ui++)if(unitCr.g.flu[ui]>upF)upF=unitCr.g.flu[ui];
          var mpeT=skinMPE(wl,unitCr.st.tt||cr.st.tt);
          if(upF>0)maxP=mpeT/upF;
          if(!isCW&&prf>0){var w22=dia/Math.sqrt(2);var maxPr1=skinMPE(wl,tau)*prf*Math.PI*w22*w22/(2*100);
            if(maxPr1<maxP)maxP=maxPr1;}
        }
        var minVel=0;
        function testV(tv){
          if(canSep){
            var tcr=scanCompute(beam,[],auxPpd,mkSepP(tv));
            if(!tcr)return true;
            var tsf=scanSafety(tcr.g,beam,tcr.st.tt,dwm,0,{v_mm_s:tv,line_spacing_mm:pat==="linear"?0:hatch,n_lines:pat==="linear"?1:nLines});
            return tsf.safe;
          }
          var ts;
          if(pat==="linear")ts=scanBuildLinear(0,0,0,lineL,tv,dia);
          else if(pat==="bidi")ts=scanBuildBidi(0,0,lineL,nLines,hatch,tv,tv*5,dia,blk);
          else ts=scanBuildRaster(0,0,lineL,nLines,hatch,tv,tv*5,dia,blk);
          var tb={wl:wl,d:dia,tau:tau,prf:prf,Ep:Ep,P:pw,cw:isCW};
          var tcr2=scanCompute(tb,ts,auxPpd);
          if(!tcr2)return true;
          var tmv=isCW?(tcr2.st.mv||tv):0;
          var tsf2=scanSafety(tcr2.g,tb,tcr2.st.tt,dwm,tmv,{v_mm_s:tv,line_spacing_mm:pat==="linear"?0:hatch,n_lines:pat==="linear"?1:nLines});
          return tsf2.safe;
        }
        if(testV(1e6)){var vLo=0.01,vHi=1e6;
          for(var bi=0;bi<maxBisect&&(vHi-vLo)/vLo>0.01;bi++){var vMid=(vLo+vHi)/2;if(testV(vMid))vHi=vMid;else vLo=vMid;}
          minVel=vHi;}else{minVel=Infinity;}

        // Generate pulse positions and viz segments from scan params (not from segment array)
        var pulseArr=[];
        if(!isCW&&prf>0){
          var maxSP2=5000,ps_mm2=vel/prf;
          var nPL2=Math.max(1,Math.floor((lineL/vel)*prf));
          var nLV=pat==="linear"?1:nLines;
          var totalEst2=nPL2*nLV;
          var pStride2=Math.max(1,Math.ceil(totalEst2/maxSP2));
          var tAcc2=0;
          for(var li2=0;li2<nLV&&pulseArr.length<maxSP2;li2++){
            var ly2=li2*(pat==="linear"?0:hatch);
            var sDir2=(pat==="bidi"&&li2%2===1)?-1:1;
            var xSt2=sDir2===1?0:lineL;
            for(var ki2=0;ki2<nPL2&&pulseArr.length<maxSP2;ki2+=pStride2){
              pulseArr.push({t:tAcc2+ki2/prf,x:xSt2+sDir2*ki2*ps_mm2,y:ly2,si:li2});
            }
            tAcc2+=lineL/vel;if(li2<nLV-1)tAcc2+=(pat==="linear"?0:hatch)/(vel*5);
          }
        }
        // Capped viz segments
        var vizSegs2=[];
        var MAX_VIZ2=5000,nLV2=pat==="linear"?1:nLines;
        var ppl2=Math.ceil(lineL/dia);
        var lStr2=Math.max(1,Math.ceil(nLV2*Math.min(ppl2,200)/MAX_VIZ2));
        var vStp2=Math.max(1,Math.ceil(ppl2/Math.min(200,Math.floor(MAX_VIZ2/Math.ceil(nLV2/lStr2)))));
        for(var vl2=0;vl2<nLV2&&vizSegs2.length<MAX_VIZ2;vl2+=lStr2){
          var vly2=vl2*(pat==="linear"?0:hatch);
          var vDir2=(pat==="bidi"&&vl2%2===1)?-1:1;
          var vx02=vDir2===1?0:lineL;
          var nVP2=Math.ceil(ppl2/vStp2);
          for(var vs2=0;vs2<=nVP2&&vizSegs2.length<MAX_VIZ2;vs2++){
            vizSegs2.push({x:vx02+vDir2*vs2*vStp2*dia,y:vly2,a:vDir2===1?0:Math.PI,v:vel});
          }
        }

        if(notes.length>0)setPerfNote(notes.join(". ")+".");
        setRes({g:cr.g,st:cr.st,sf:sf,segs:vizSegs2,beam:beam,maxP:maxP,minV:minVel,pulses:pulseArr,effPpd:effPpd});
      }
    }catch(err){if(typeof console!=="undefined")console.error("Calculation error:",err);}
    setCmp(false);
  }

  var _hover=useState(null),hover=_hover[0],setHover=_hover[1];

  // ── Plotly heatmap for cumulative fluence map ─────────────────
  var fluMapRef=useRef(null);
  var HEATMAP_MAX_DIM=400; // Max pixels per axis for Plotly heatmap performance

  // Plotly theme colors (shared by all three Plotly charts)
  var plotBg=theme==="dark"?"#333338":"#ffffff";
  var plotGrid=theme==="dark"?"#48484f":"#e4e7eb";
  var plotText=theme==="dark"?"#a0a0a8":"#737880";
  var plotLine=theme==="dark"?"#56B4E9":"#0072B2";

  useEffect(function(){
    if(!res||!fluMapRef.current||typeof Plotly==="undefined")return;
    var g=res.g,maxF=res.sf.pF||1;

    // Downsample grid for display if larger than HEATMAP_MAX_DIM per axis
    var strideX=1,strideY=1;
    if(g.nx>HEATMAP_MAX_DIM)strideX=Math.ceil(g.nx/HEATMAP_MAX_DIM);
    if(g.ny>HEATMAP_MAX_DIM)strideY=Math.ceil(g.ny/HEATMAP_MAX_DIM);
    var dispNx=Math.ceil(g.nx/strideX),dispNy=Math.ceil(g.ny/strideY);

    // Build axis arrays and z-matrix (Plotly wants z[row][col])
    var xArr=new Array(dispNx),yArr=new Array(dispNy);
    for(var xi=0;xi<dispNx;xi++)xArr[xi]=g.xn+(xi*strideX)*g.dx;
    for(var yi=0;yi<dispNy;yi++)yArr[yi]=g.yn+(yi*strideY)*g.dx;
    var zData=new Array(dispNy);
    for(var iy=0;iy<dispNy;iy++){
      var row=new Array(dispNx);
      var srcY=iy*strideY;
      for(var ix=0;ix<dispNx;ix++){
        var srcX=ix*strideX;
        // For downsampled cells, take max of the block (conservative for safety)
        var maxVal=0;
        for(var by=0;by<strideY&&srcY+by<g.ny;by++){
          for(var bx=0;bx<strideX&&srcX+bx<g.nx;bx++){
            var val=g.flu[(srcY+by)*g.nx+(srcX+bx)];
            if(val>maxVal)maxVal=val;
          }
        }
        row[ix]=maxVal;
      }
      zData[iy]=row;
    }

    // Scan path overlay as a line trace
    var pathX=[],pathY=[];
    // Subsample scan path for display (max 2000 points)
    var segStep=Math.max(1,Math.floor(res.segs.length/2000));
    for(var si=0;si<res.segs.length;si+=segStep){
      var s=res.segs[si];pathX.push(s.x);pathY.push(s.y);
    }
    var lastSeg=res.segs[res.segs.length-1];
    pathX.push(lastSeg.x+res.beam.d*Math.cos(lastSeg.a));
    pathY.push(lastSeg.y+res.beam.d*Math.sin(lastSeg.a));

    var traces=[
      {z:zData,x:xArr,y:yArr,type:"heatmap",
        colorscale:[[0,"#000033"],[0.15,"#0066cc"],[0.35,"#00cc66"],[0.55,"#66ff00"],[0.75,"#ffcc00"],[0.9,"#ff6600"],[1.0,"#cc0000"]],
        colorbar:{title:{text:"J/cm\u00b2",font:{size:10,family:"monospace",color:plotText},side:"right"},
          tickfont:{size:9,family:"monospace",color:plotText},
          thickness:14,len:0.9},
        hovertemplate:"x: %{x:.3f} mm<br>y: %{y:.3f} mm<br>Fluence: %{z:.4g} J/cm\u00b2<extra></extra>",
        zsmooth:"best"},
      {x:pathX,y:pathY,type:"scatter",mode:"lines",
        line:{color:"rgba(255,255,255,0.5)",width:1,dash:"dot"},
        hoverinfo:"skip",showlegend:false},
      // Worst-point marker
      {x:[res.sf.wx],y:[res.sf.wy],type:"scatter",mode:"markers",
        marker:{size:12,color:"rgba(0,0,0,0)",line:{color:"#D55E00",width:2.5}},
        hoverinfo:"text",text:["Worst point: "+numFmt(res.sf.pF,4)+" J/cm\u00b2"],showlegend:false}
    ];
    var layout={
      xaxis:{title:{text:"x (mm)",font:{size:11,family:"monospace",color:plotText}},
        color:plotText,gridcolor:plotGrid,linecolor:plotGrid,
        tickfont:{size:9,family:"monospace",color:plotText},
        constrain:"domain",scaleanchor:"y"},
      yaxis:{title:{text:"y (mm)",font:{size:11,family:"monospace",color:plotText}},
        color:plotText,gridcolor:plotGrid,linecolor:plotGrid,
        tickfont:{size:9,family:"monospace",color:plotText},
        constrain:"domain"},
      plot_bgcolor:plotBg,paper_bgcolor:"rgba(0,0,0,0)",
      margin:{l:60,r:20,t:10,b:44},
      showlegend:false
    };
    var config={responsive:true,scrollZoom:true,displayModeBar:true,
      modeBarButtonsToRemove:["select2d","lasso2d"],displaylogo:false};
    Plotly.react(fluMapRef.current,traces,layout,config);
  },[res,vizTab,theme]);

  var _vizTab=useState("fluence"),vizTab=_vizTab[0],setVizTab=_vizTab[1];
  var timRef=useRef(null),spcRef=useRef(null);

  // Render Plotly timing diagram
  useEffect(function(){
    if(vizTab!=="timing"||!res||!res.pulses||!res.pulses.length||!timRef.current||typeof Plotly==="undefined")return;
    var pp=res.pulses,allN=pp.length;
    // Build stem data: vertical lines from 0 to 1 at each pulse time
    var tX=[],tY=[];
    for(var i=0;i<allN;i++){tX.push(pp[i].t,pp[i].t,null);tY.push(0,1,null);}
    // Initial zoom: first ~50 pulses
    var initEnd=pp[Math.min(49,allN-1)].t*1.15;
    var traces=[{x:tX,y:tY,type:"scatter",mode:"lines",line:{color:plotLine,width:1.2},
      fill:"tozeroy",fillcolor:theme==="dark"?"rgba(86,180,233,0.15)":"rgba(0,114,178,0.15)",
      hoverinfo:"x",name:"Pulses"}];
    var layout={
      xaxis:{title:{text:"Time",font:{size:12,family:"monospace",color:plotText}},
        rangeslider:{visible:true,thickness:0.08,bgcolor:plotBg,bordercolor:plotGrid},
        range:[0,initEnd],color:plotText,gridcolor:plotGrid,linecolor:plotGrid,
        tickfont:{size:10,family:"monospace",color:plotText},
        hoverformat:".4s",tickformat:".3s"},
      yaxis:{title:{text:"Pulse Amplitude",font:{size:11,family:"monospace",color:plotText}},
        range:[0,1.12],showticklabels:false,gridcolor:plotGrid,linecolor:plotGrid,zeroline:true,zerolinecolor:plotGrid},
      plot_bgcolor:plotBg,paper_bgcolor:"rgba(0,0,0,0)",
      margin:{l:60,r:16,t:10,b:40},
      showlegend:false,
      annotations:[{x:0.01,y:0.97,xref:"paper",yref:"paper",text:allN+" pulses total",
        showarrow:false,font:{size:10,family:"monospace",color:plotText}}]
    };
    var config={responsive:true,scrollZoom:true,displayModeBar:true,
      modeBarButtonsToRemove:["select2d","lasso2d","autoScale2d"],
      displaylogo:false};
    Plotly.react(timRef.current,traces,layout,config);
  },[res,vizTab,theme]);

  // Render Plotly fluence cross-section (analytical computation, not capped pulse array)
  useEffect(function(){
    if(vizTab!=="spatial"||!res||!spcRef.current||typeof Plotly==="undefined")return;
    // Skip if CW mode
    if(prf<=0||pw<=0){return;}

    var w=dia/Math.sqrt(2); // 1/e² radius in mm
    var sigma=dia/(2*Math.sqrt(2));
    var w2=w*w;
    var Ep=prf>0?pw/prf:0;
    var H0_cm2=2*Ep/(Math.PI*w2)*100; // peak per-pulse fluence J/cm²

    // Compute fluence analytically along the first scan line using 1D Gaussian sum
    // This is independent of the capped pulse array — uses actual beam physics
    var pulse_spacing=vel/prf; // mm between consecutive pulses
    var line_dur=lineL/vel;
    var n_pulses_line=Math.max(1,Math.floor(line_dur*prf));
    var trunc_mm=3*sigma;

    // Evaluation grid: 800 points spanning the scan line ± 2× beam diameter
    var xMin0=-dia*2, xMax0=lineL+dia*2;
    var nPts=800, xRange0=xMax0-xMin0, dxPlot=xRange0/nPts;

    var xArr=new Array(nPts),cumArr=new Array(nPts);
    var cumMax=0;
    for(var xi=0;xi<nPts;xi++){
      var xp=xMin0+xi*dxPlot;
      xArr[xi]=xp;
      // Sum Gaussian contributions from all pulses within truncation radius
      var center_k=(xp-0)/pulse_spacing; // x0=0 for first line
      var k_range=trunc_mm/pulse_spacing;
      var k_lo=Math.max(0,Math.ceil(center_k-k_range));
      var k_hi=Math.min(n_pulses_line-1,Math.floor(center_k+k_range));
      var sum=0;
      for(var k=k_lo;k<=k_hi;k++){
        var dx_k=xp-k*pulse_spacing;
        sum+=Math.exp(-2*dx_k*dx_k/w2);
      }
      // Multiply by cross-line sum at y=0 (on the scan line, cross=1 for center line)
      // For multi-line rasters, adjacent lines contribute:
      var cross_sum=1.0;
      if(pat!=="linear"&&hatch>0&&nLines>1){
        for(var m=1;m<=nLines;m++){
          var yy=m*hatch;
          var cy=Math.exp(-2*yy*yy/w2);
          if(cy<1e-12)break;
          cross_sum+=2*cy;
        }
      }
      cumArr[xi]=H0_cm2*sum*cross_sum;
      if(cumArr[xi]>cumMax)cumMax=cumArr[xi];
    }

    // Individual pulse envelopes (subsample for display, max 30 visible)
    var indivX=[],indivY=[];
    var nShow=Math.min(30,n_pulses_line);
    var pStep=Math.max(1,Math.floor(n_pulses_line/nShow));
    for(var pi=0;pi<n_pulses_line;pi+=pStep){
      var px0=pi*pulse_spacing;
      // Only draw within ±3σ of this pulse
      var xlo=Math.max(xMin0,px0-trunc_mm),xhi=Math.min(xMax0,px0+trunc_mm);
      for(var xii=0;xii<40;xii++){
        var xp2=xlo+xii*(xhi-xlo)/39;
        var rr=(xp2-px0)*(xp2-px0);
        indivX.push(xp2);indivY.push(H0_cm2*Math.exp(-2*rr/w2));
      }
      indivX.push(null);indivY.push(null);
    }

    var mpeVal=skinMPE(wl,res.st.tt);

    // Y-axis should scale to show the cumulative peak and MPE clearly
    // Hide individual pulses if they'd distort the y-axis (peak pulse << cumulative)
    var showIndiv=H0_cm2>cumMax*0.05; // only show if individual pulse is >5% of cumulative

    var traces=[];
    if(showIndiv){
      traces.push({x:indivX,y:indivY,type:"scatter",mode:"lines",
        line:{color:plotLine,width:0.8},opacity:0.2,
        name:"Individual pulses (1 of "+pStep+" shown)",hoverinfo:"skip"});
    }
    traces.push({x:xArr,y:cumArr,type:"scatter",mode:"lines",
      line:{color:plotLine,width:2.5},fill:"tozeroy",
      fillcolor:theme==="dark"?"rgba(86,180,233,0.08)":"rgba(0,114,178,0.08)",
      name:"Cumulative ("+n_pulses_line+" pulses"+((pat!=="linear"&&nLines>1)?", "+nLines+" lines":"")+")"});
    if(isFinite(mpeVal)&&mpeVal>0){
      traces.push({x:[xMin0,xMax0],y:[mpeVal,mpeVal],type:"scatter",mode:"lines",
        line:{color:"#d32f2f",width:2,dash:"dash"},
        name:"MPE(T="+ft(res.st.tt)+") = "+numFmt(mpeVal,3)+" J/cm\u00b2"});
    }

    // Set y-axis to show the relevant range: max of cumulative peak, MPE, or individual pulse (if shown)
    var yMax=cumMax*1.15;
    if(isFinite(mpeVal)&&mpeVal>yMax*0.5)yMax=Math.max(yMax,mpeVal*1.15);
    if(showIndiv&&H0_cm2>yMax)yMax=H0_cm2*1.1;

    var layout={
      xaxis:{title:{text:"Position along scan line (mm)",font:{size:12,family:"monospace",color:plotText}},
        rangeslider:{visible:true,thickness:0.08,bgcolor:plotBg,bordercolor:plotGrid},
        color:plotText,gridcolor:plotGrid,linecolor:plotGrid,
        tickfont:{size:10,family:"monospace",color:plotText},ticksuffix:" mm"},
      yaxis:{title:{text:"Fluence, H (J/cm\u00b2)",font:{size:12,family:"monospace",color:plotText}},
        color:plotText,gridcolor:plotGrid,linecolor:plotGrid,
        range:[0,yMax],
        tickfont:{size:10,family:"monospace",color:plotText}},
      plot_bgcolor:plotBg,paper_bgcolor:"rgba(0,0,0,0)",
      margin:{l:70,r:16,t:10,b:40},
      legend:{x:0.02,y:0.98,bgcolor:"rgba(255,255,255,0.7)",bordercolor:plotGrid,borderwidth:1,
        font:{size:10,family:"monospace",color:plotText}},
      showlegend:true
    };
    var config={responsive:true,scrollZoom:true,displayModeBar:true,
      modeBarButtonsToRemove:["select2d","lasso2d","autoScale2d"],
      displaylogo:false};
    Plotly.react(spcRef.current,traces,layout,config);
  },[res,vizTab,theme,dia,wl,pw,prf,vel,lineL,pat,hatch,nLines]);

  return (<div style={{display:"flex",flexDirection:"column",gap:14}}>
    {/* ── Inputs: full width, 3-column ── */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={secH}>Beam Parameters</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div><label htmlFor="scan-wl" style={lb}>Wavelength (nm)</label><input id="scan-wl" type="text" value={wlS} onChange={function(e){upN(setWlS,setWl,e.target.value)}} style={ip}/></div>
          <div><label htmlFor="scan-dia" style={lb}>Beam 1/e Diameter (mm)</label><input id="scan-dia" type="text" value={dS} onChange={function(e){upN(setDS,setDia,e.target.value)}} style={ip}/></div>
          <div><label style={lb}>Pulse Duration</label><div style={{display:"flex",gap:4}}><input type="text" value={tauS} onChange={function(e){upTau(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><select value={tauU} onChange={function(e){setTauU(e.target.value);upTau(tauS)}} style={{fontSize:11,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div></div>
          <div><label style={lb}>Repetition Rate</label><div style={{display:"flex",gap:4}}><input type="text" value={prfS} onChange={function(e){upPrf(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><select value={prfU} onChange={function(e){setPrfU(e.target.value);upPrf(prfS)}} style={{fontSize:11,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{FREQ_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div></div>
          <div><label htmlFor="scan-pw" style={lb}>Average Power (W)</label><input id="scan-pw" type="text" value={pwS} onChange={function(e){upN(setPwS,setPw,e.target.value)}} style={ip}/></div>
        </div>
      </div>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={secH}>Scan Pattern</div>
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          {[["linear","Linear"],["raster","Raster"],["bidi","Bidirectional"]].map(function(pt){
            return <button key={pt[0]} onClick={function(){setPat(pt[0]);setDirty(true)}} style={{flex:1,padding:"6px 8px",fontSize:11,fontWeight:pat===pt[0]?700:500,background:pat===pt[0]?T.ac:"transparent",color:pat===pt[0]?"#fff":T.tm,border:pat===pt[0]?"none":"1px solid "+T.bd,borderRadius:4,cursor:"pointer"}}>{pt[1]}</button>;
          })}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><label htmlFor="scan-vel" style={lb}>Scan Velocity (mm/s)</label><input id="scan-vel" type="text" value={vS} onChange={function(e){upN(setVS,setVel,e.target.value)}} style={ip}/></div>
            <div><label htmlFor="scan-ll" style={lb}>Line Length (mm)</label><input id="scan-ll" type="text" value={lLS} onChange={function(e){upN(setLLS,setLineL,e.target.value)}} style={ip}/></div>
          </div>
          {pat!=="linear"?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><label htmlFor="scan-nl" style={lb}>Number of Lines</label><input id="scan-nl" type="text" value={nLS} onChange={function(e){upN(setNLS,setNLines,e.target.value)}} style={ip}/></div>
            <div><label htmlFor="scan-ht" style={lb}>Hatch Spacing (mm)</label><input id="scan-ht" type="text" value={htS} onChange={function(e){upN(setHtS,setHatch,e.target.value)}} style={ip}/></div>
          </div>:null}
        </div>
      </div>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
        <div>
          <div style={secH}>Settings</div>
          <div style={{marginBottom:10}}>
            <label style={lb}>Grid Resolution (pts/diameter)</label>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="range" min={3} max={32} value={ppd} onChange={function(e){setPpd(Number(e.target.value));setDirty(true)}} style={{flex:1}}/>
              <span style={{fontSize:12,fontFamily:"monospace",fontWeight:700,color:T.ac,minWidth:20}}>{ppd}</span>
            </div>
            <div style={{fontSize:9,color:T.td,marginTop:2,fontFamily:"monospace"}}>Spacing: {(dia/ppd).toFixed(4)} mm {ppd>=8?"\u2713 converged":""}</div>
          </div>
          <div>
            <label style={lb}>Dwell Time Definition</label>
            <div style={{display:"flex",gap:6}}>
              {[["gaussian","Gaussian"],["geometric","Geometric"]].map(function(dm){
                return <button key={dm[0]} onClick={function(){setDwm(dm[0])}} style={{flex:1,padding:"5px 8px",fontSize:10,fontWeight:dwm===dm[0]?700:500,background:dwm===dm[0]?T.ac:"transparent",color:dwm===dm[0]?"#fff":T.tm,border:dwm===dm[0]?"none":"1px solid "+T.bd,borderRadius:4,cursor:"pointer"}}>{dm[1]}</button>;
              })}
            </div>
          </div>
          {pat!=="linear"?<div>
            <label style={lb}>Galvo Flyback Blanking</label>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:11,color:blk?T.ac:T.tm}}>
              <input type="checkbox" checked={blk} onChange={function(){setBlk(!blk);setDirty(true);}} style={{accentColor:T.ac,width:14,height:14}}/>
              {blk?"Laser blanked during flyback/jumps":"Laser fires during flyback (conservative)"}
            </label>
            <div style={{fontSize:8,color:T.td,marginTop:2}}>OCT/confocal systems typically blank during galvo return</div>
          </div>:null}
        </div>
        <button onClick={calculate} style={{padding:"10px 24px",fontSize:13,fontWeight:700,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:5,cursor:"pointer",width:"100%",marginTop:12}}>{cmp?"Computing...":dirty?"Calculate Scan Safety":"Calculated \u2713"}</button>
      </div>
    </div>

    {/* ── Tabbed Visualization ── */}
    <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:4}}>
          {[["fluence","Cumulative Fluence Map"],["timing","Pulse Timing Diagram"],["spatial","Fluence Cross-Section"]].map(function(vt){
            return <button key={vt[0]} onClick={function(){setVizTab(vt[0])}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(vizTab===vt[0]?T.ac:T.bd),cursor:"pointer",background:vizTab===vt[0]?T.ac:"transparent",color:vizTab===vt[0]?"#fff":T.tm,borderRadius:4}}>{vt[1]}</button>;
          })}
        </div>
        {res?<div style={{fontSize:9,color:T.td,fontFamily:"monospace"}}>Grid: {res.g.nx}{"\u00d7"}{res.g.ny} {"\u00b7"} Pulses: {res.pulses?res.pulses.length:res.st.tp||0}</div>:null}
      </div>

      {/* All three panels are always mounted; only visibility toggles.
           This prevents the canvas from being destroyed/recreated on tab switch,
           which would lose its painted heatmap content. */}
      <div style={{display:vizTab==="fluence"?"block":"none"}}>
        <div style={{fontSize:9,color:T.td,marginBottom:4}}>Total radiant exposure (J/cm{"\u00b2"}) accumulated at each skin surface point from all pulses across the entire scan.</div>
        {res?<div ref={fluMapRef} style={{width:"100%",height:440,borderRadius:6}}/>
          :<div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12}}>Click Calculate to generate fluence map</div>}
      </div>

      <div style={{display:vizTab==="timing"?"block":"none"}}>
        <div style={{fontSize:9,color:T.td,marginBottom:4}}>Each vertical stem represents one laser pulse. Use the range slider below the chart to zoom into any time region. Scroll to zoom, drag to pan.</div>
        {res&&res.pulses&&res.pulses.length>0?
          <div ref={timRef} style={{width:"100%",height:380,borderRadius:6}}/>
          :<div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12}}>{res?"CW mode \u2014 no discrete pulses":"Click Calculate to generate timing diagram"}</div>}
      </div>

      <div style={{display:vizTab==="spatial"?"block":"none"}}>
        <div style={{fontSize:9,color:T.td,marginBottom:4}}>Cumulative fluence profile along the first scan line showing individual pulse Gaussians and their sum. The dashed red line marks the MPE limit. Use the range slider to zoom.</div>
        {res&&prf>0?
          <div ref={spcRef} style={{width:"100%",height:420,borderRadius:6}}/>
          :<div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12}}>{res?"CW mode \u2014 no discrete pulses":"Click Calculate to generate fluence profile"}</div>}
      </div>
    </div>

    {/* ── Performance Note ── */}
    {perfNote?<div style={{padding:"8px 12px",borderRadius:4,background:"#fff3e0",border:"1px solid #ffe0b2",fontSize:10,color:"#e65100",fontFamily:"monospace",lineHeight:1.6}}>
      {"\u26a1"} {perfNote}
    </div>:null}

    {/* ── Safety Results ── */}
    {res?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
      <div role="alert" aria-live="polite" style={{background:res.sf.safe?"#e8f5e9":"#fbe9e7",borderRadius:6,padding:14,textAlign:"center"}}>
        <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",color:res.sf.safe?"#2e7d32":"#bf360c",marginBottom:4}}>Safety Verdict</div>
        <div style={{fontSize:22,fontWeight:700,color:res.sf.safe?"#2e7d32":"#bf360c"}}>{res.sf.safe?"PASS":"FAIL"}</div>
        <div style={{fontSize:10,fontFamily:"monospace",color:res.sf.safe?"#388e3c":"#d84315",marginTop:4}}>Margin: {res.sf.safe?"+":""}{(res.sf.sm*100).toFixed(1)}%</div>
        <div style={{fontSize:9,color:res.sf.safe?"#4caf50":"#e64a19",marginTop:2}}>Binding: {res.sf.br}</div>
      </div>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:4}}>Rule 1 {"\u2014"} Single Pulse</div>
        <div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:res.sf.r1m>1?T.no:T.ok}}>{numFmt(res.sf.ppM,4)} J/cm{"\u00b2"}</div>
        <div style={{fontSize:9,color:T.td,marginTop:2}}>MPE({"\u03c4"}) = {numFmt(res.sf.mt,4)} J/cm{"\u00b2"}</div>
        <div style={{fontSize:10,fontFamily:"monospace",color:res.sf.r1m>1?T.no:T.ok,marginTop:2}}>Ratio: {res.sf.r1m.toFixed(4)}</div>
      </div>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:4}}>Rule 2 {"\u2014"} Cumulative</div>
        <div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:res.sf.r2m>1?T.no:T.ok}}>{numFmt(res.sf.pF,4)} J/cm{"\u00b2"}</div>
        <div style={{fontSize:9,color:T.td,marginTop:2}}>MPE(T={numFmt(res.st.tt,3)} s) = {numFmt(res.sf.mT,4)} J/cm{"\u00b2"}</div>
        <div style={{fontSize:10,fontFamily:"monospace",color:res.sf.r2m>1?T.no:T.ok,marginTop:2}}>Ratio: {res.sf.r2m.toFixed(4)}</div>
      </div>
    </div>:null}

    {/* ── Scan Summary (2 columns) ── */}
    {res?<div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
      <div style={secH}>Scan Summary</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{[
          ["Wavelength",wl+" nm"],["Beam 1/e diameter",dia+" mm"],
          ["Gaussian \u03c3",(dia/(2*Math.sqrt(2))).toFixed(4)+" mm"],
          ["Pulse duration",ft(tau)],["Repetition rate",prf+" Hz"],
          ["Average power",pw+" W"],["Pulse energy",numFmt(pw/prf,4)+" J"],
          ["Scan velocity",vel+" mm/s"],
        ].map(function(row,i){return <tr key={i} style={{borderBottom:"1px solid "+T.bd}}>
          <td style={{padding:"4px 8px",fontSize:10,color:T.tm}}>{row[0]}</td>
          <td style={{padding:"4px 8px",fontSize:11,fontFamily:"monospace",fontWeight:600}}>{row[1]}</td>
        </tr>;})}</tbody></table>
        <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{[
          ["Pattern",pat==="bidi"?"Bidirectional raster":pat==="raster"?"Unidirectional raster":"Linear"],
          ["Flyback blanking",pat==="linear"?"N/A":(blk?"Yes (laser off during jumps)":"No (conservative)")],
          ["Total segments",String(res.segs.length)],
          ["Total scan time",numFmt(res.st.tt,4)+" s"],
          ["Dwell time ("+dwm+")",numFmt(dwm==="gaussian"?scanDwellGaussian(dia,vel):scanDwellGeometric(dia,vel),4)+" s"],
          ["Grid",res.g.nx+"\u00d7"+res.g.ny+" ("+ppd+" pts/dia)"+(res.st.stride>1?", stride="+res.st.stride:"")],
          ["Peak fluence",numFmt(res.sf.pF,4)+" J/cm\u00b2"+(res.sf.anUsed?" (analytical bound)":"")],
          ["Max pulses at point",String(res.sf.mP)+(res.st.stride&&res.st.stride>1?" (approx)":"")],
          ["\u03c4\u1d63 (thermal)",numFmt(res.sf.tauR,4)+" s"],
        ].map(function(row,i){return <tr key={i} style={{borderBottom:"1px solid "+T.bd}}>
          <td style={{padding:"4px 8px",fontSize:10,color:T.tm}}>{row[0]}</td>
          <td style={{padding:"4px 8px",fontSize:11,fontFamily:"monospace",fontWeight:600}}>{row[1]}</td>
        </tr>;})}</tbody></table>
      </div>
    </div>:null}

    {/* ── Thermal Relaxation ── */}
    {res&&isFinite(res.sf.minRv)?<div style={{background:res.sf.rvOk?"#e8f5e9":"#fff3e0",borderRadius:6,border:"1px solid "+(res.sf.rvOk?"#c8e6c9":"#ffe0b2"),padding:14}}>
      <div style={secH}>Thermal Relaxation Assessment</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:9,color:T.td,textTransform:"uppercase",fontWeight:600,marginBottom:4}}>Thermal Relaxation {"\u03c4"}{"\u1d63"}</div>
          <div style={{fontSize:16,fontFamily:"monospace",fontWeight:700,color:T.tx}}>{numFmt(res.sf.tauR,3)} s</div>
          <div style={{fontSize:8,color:T.td,marginTop:2}}>d{"\u00b2"}/(4{"\u03ba"}), {"\u03ba"} = 0.13 mm{"\u00b2"}/s</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:9,color:T.td,textTransform:"uppercase",fontWeight:600,marginBottom:4}}>Min Revisit Interval</div>
          <div style={{fontSize:16,fontFamily:"monospace",fontWeight:700,color:res.sf.rvOk?"#2e7d32":"#e65100"}}>{numFmt(res.sf.minRv,3)} s</div>
          <div style={{fontSize:8,color:T.td,marginTop:2}}>{res.sf.rvPts} points revisited</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:9,color:T.td,textTransform:"uppercase",fontWeight:600,marginBottom:4}}>Ratio (revisit / {"\u03c4"}{"\u1d63"})</div>
          <div style={{fontSize:16,fontFamily:"monospace",fontWeight:700,color:res.sf.rvOk?"#2e7d32":"#e65100"}}>{(res.sf.minRv/res.sf.tauR).toFixed(2)}{"\u00d7"}</div>
          <div style={{fontSize:8,color:res.sf.rvOk?"#388e3c":"#e65100",fontWeight:600,marginTop:2}}>{res.sf.rvOk?"\u2713 Tissue cools between passes":"\u26a0 Thermal accumulation likely"}</div>
        </div>
      </div>
      <div style={{fontSize:9,color:T.td,marginTop:10,lineHeight:1.5}}>
        {res.sf.rvOk
          ?"The minimum time between beam revisits exceeds the thermal relaxation time. The fully cumulative model used by the standards is conservative for this scan."
          :"The beam revisits some points faster than the tissue can thermally relax. Consider increasing scan velocity or hatch spacing to allow more cooling time."}
      </div>
    </div>:null}

    {/* ── Safety Limits ── */}
    {res?<div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
      <div style={secH}>Safety Limits {"\u2014"} Permissible Parameter Ranges</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {(function(){
          var maxEp=scanMaxPulseEnergy(wl,dia,tau);
          var minPRF=scanMinRepRate(wl,dia,tau,pw);
          var items=[
            ["Max pulse energy","Rule 1: H\u2080 \u2264 MPE(\u03c4)",numFmt(maxEp,4)+" J",
              "Current: "+numFmt(pw/prf,4)+" J",pw/prf<=maxEp*1.001],
            ["Min repetition rate","Rule 1 at "+pw+" W",
              numFmt(minPRF,4)+" Hz"+(minPRF>=1e3?" ("+numFmt(minPRF/1e3,3)+" kHz)":""),
              "Current: "+prf+" Hz",prf>=minPRF*0.999],
            ["Max average power","Rules 1+2 combined",numFmt(res.maxP||0,4)+" W",
              "Current: "+pw+" W",pw<=(res.maxP||Infinity)*1.001],
            ["Min scan velocity","Rules 1+2 combined",
              isFinite(res.minV)?numFmt(res.minV,4)+" mm/s":"\u2014",
              "Current: "+vel+" mm/s",isFinite(res.minV)?vel>=res.minV*0.999:true]
          ];
          return items.map(function(it,i){
            return <div key={i} style={{background:T.bgI,borderRadius:5,padding:10}}>
              <div style={{fontSize:10,fontWeight:700,color:T.tx,marginBottom:2}}>{it[0]}</div>
              <div style={{fontSize:8,color:T.td,marginBottom:4}}>{it[1]}</div>
              <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:it[4]?T.ok:T.no}}>{it[2]}</div>
              <div style={{fontSize:9,fontFamily:"monospace",color:T.tm,marginTop:2}}>{it[3]}</div>
            </div>;
          });
        })()}
      </div>
    </div>:null}

    {/* ── Safety Disclaimer ── */}
    <div style={{background:T.bgI,borderRadius:6,border:"1px solid "+T.bd,padding:"12px 14px",fontSize:10,color:T.td,lineHeight:1.7}}>
      <strong style={{color:T.tx}}>{"\u26a0"} Important Safety Notice</strong><br/>
      This scanning protocol analysis evaluates skin MPE compliance per {STD_NAME} (Tables 5 and 7) using the repetitive-pulse framework (Rules 1 and 2). Rule 3 (N{"\u207b\u00b0\u00b7\u00b2\u2075"} correction) does not apply to skin {"\u2014"} only to retinal thermal hazards.<br/>
      <strong>Safety evaluation method:</strong> The safety verdict uses the maximum of the grid-sampled peak fluence and an exact analytical Gaussian overlap computation, ensuring grid resolution and pulse subsampling cannot cause unsafe underestimates. Rule 1 uses the exact analytical single-pulse peak fluence H{"\u2080"} = 2E/({"\u03c0"}w{"\u00b2"}).<br/>
      <strong>Limitations:</strong> This tool assumes a perfectly Gaussian beam profile, uniform pulse energy, and ideal galvanometer positioning. Real-world deviations (beam aberrations, pointing jitter, power fluctuations) may increase actual exposure.{" "}
      <strong style={{color:T.no}}>This is a research and educational tool, not a certified safety instrument.</strong>{" "}
      Verify all values independently against the applicable standard before any safety-critical use.
    </div>
  </div>);
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
        React.createElement("div",{style:{fontSize:12,fontFamily:"monospace",color:T.td||"#666",marginBottom:16}},
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
  var T=TH[theme];
  var tabBt=function(id,label){return{padding:"8px 20px",fontSize:12,fontWeight:tab===id?700:500,border:"none",borderBottom:tab===id?"2px solid "+T.ac:"2px solid transparent",cursor:"pointer",background:"transparent",color:tab===id?T.ac:T.tm,letterSpacing:"0.02em"};};

  return (
    <div style={{minHeight:"100vh",background:T.bg,color:T.tx,fontFamily:"system-ui,-apple-system,sans-serif"}}>
      {/* Header */}
      <div style={{borderBottom:"1px solid "+T.bd,padding:"10px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.card}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:16,fontWeight:700}}>Laser Skin MPE Calculator</span><span style={{fontSize:9,fontFamily:"monospace",color:T.td,border:"1px solid "+T.bd,borderRadius:3,padding:"2px 6px",fontWeight:600}}>{STD_NAME}</span></div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>{msg?<span style={{fontSize:11,color:T.a2,fontWeight:600}}>{msg}</span>:null}<button onClick={function(){setTheme(theme==="light"?"dark":"light")}} style={{padding:"3px 8px",fontSize:13,border:"1px solid "+T.bd,cursor:"pointer",background:"transparent",color:T.tm,borderRadius:4}} title="Toggle theme">{theme==="light"?"\u263E":"\u2600"}</button></div>
      </div>
      {/* Tab bar */}
      <div role="tablist" aria-label="Calculator sections" style={{borderBottom:"1px solid "+T.bd,padding:"0 24px",background:T.card,display:"flex",gap:4}}>
        <button role="tab" aria-selected={tab==="mpe"} aria-controls="panel-mpe" id="tab-mpe" onClick={function(){setTab("mpe")}} style={tabBt("mpe")}>MPE Calculator</button>
        <button role="tab" aria-selected={tab==="scan"} aria-controls="panel-scan" id="tab-scan" onClick={function(){setTab("scan")}} style={tabBt("scan")}>Scanning Protocols</button>
        <button role="tab" aria-selected={tab==="pa"} aria-controls="panel-pa" id="tab-pa" onClick={function(){setTab("pa")}} style={tabBt("pa")}>Photoacoustic SNR Optimizer</button>
      </div>
      <div style={{padding:"16px 24px 40px",maxWidth:1100,margin:"0 auto"}}>
        {tab==="mpe"?<div role="tabpanel" id="panel-mpe" aria-labelledby="tab-mpe"><ErrorBoundary theme={T}><MPETab T={T} theme={theme} msg={msg} setMsg={setMsg}/></ErrorBoundary></div>:null}
        {tab==="scan"?<div role="tabpanel" id="panel-scan" aria-labelledby="tab-scan"><ErrorBoundary theme={T}><ScanTab T={T} theme={theme} msg={msg} setMsg={setMsg}/></ErrorBoundary></div>:null}
        {tab==="pa"?<div role="tabpanel" id="panel-pa" aria-labelledby="tab-pa"><ErrorBoundary theme={T}><PATab T={T} theme={theme} msg={msg} setMsg={setMsg}/></ErrorBoundary></div>:null}
        <div style={{textAlign:"center",fontSize:10,color:T.td,padding:"12px 0 4px",lineHeight:1.7,borderTop:"1px solid "+T.bd,marginTop:16}}>{STD_NAME} {"\u00b7"} {STD_REF} {"\u00b7"} {STD_TABLES}<br/>For research and educational purposes only. Not a certified safety instrument. Skin MPE only {"\u2014"} ocular limits are not evaluated.<br/>Verify all values independently against the applicable standard before any safety-critical use.</div>
      </div>
    </div>
  );
}
