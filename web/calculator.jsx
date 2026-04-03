import { useState, useMemo, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot, ResponsiveContainer, ReferenceLine, Legend, Label } from "recharts";

/* ═══════ STANDARD DATA (loaded from JSON; edit this to change standard) ═══════ */
var _std = (typeof __STD_DATA__ !== "undefined") ? __STD_DATA__ : {"standard":{"name":"ICNIRP 2013","short_name":"ICNIRP 2013","reference":"Health Phys. 105(3):271\u2013295","year":2013,"organization":"International Commission on Non-Ionizing Radiation Protection","tables_used":"Tables 3, 5, 7","notes":"Skin exposure limits only. Ocular limits are not included.","unit":"J/cm\u00b2","wl_range_nm":[180,1000000],"dur_range_s":[1e-09,30000]},"correction_factors":{"CA":{"description":"Wavelength correction factor for 400\u20131400 nm skin MPE (Table 3, p. 282)","applies_to_bands":["Visible/Near-IR"],"default_outside_range":1.0,"regions":[{"wl_min_nm":400,"wl_max_nm":700,"type":"constant","value":1.0,"note":"400 \u2264 \u03bb < 700 nm"},{"wl_min_nm":700,"wl_max_nm":1050,"type":"power10","coefficient":0.002,"offset_nm":700,"note":"C_A = 10^(0.002 \u00d7 (\u03bb_nm \u2212 700))"},{"wl_min_nm":1050,"wl_max_nm":1400,"type":"constant","value":5.0,"note":"1050 \u2264 \u03bb \u2264 1400 nm"}]}},"uv_discrete_steps":{"description":"UV photochemical MPE for 302\u2013315 nm (Table 5). Discrete 1-nm steps. Values in J/cm\u00b2. Each entry gives the upper wavelength boundary and the MPE below that boundary.","note":"Left-inclusive, right-exclusive. For \u03bb in [302, 303): H = 4e-3, for [303, 304): H = 6e-3, etc.","steps":[{"wl_upper_nm":303,"H_J_cm2":0.004,"H_J_m2":40},{"wl_upper_nm":304,"H_J_cm2":0.006,"H_J_m2":60},{"wl_upper_nm":305,"H_J_cm2":0.01,"H_J_m2":100},{"wl_upper_nm":306,"H_J_cm2":0.016,"H_J_m2":160},{"wl_upper_nm":307,"H_J_cm2":0.025,"H_J_m2":250},{"wl_upper_nm":308,"H_J_cm2":0.04,"H_J_m2":400},{"wl_upper_nm":309,"H_J_cm2":0.063,"H_J_m2":630},{"wl_upper_nm":310,"H_J_cm2":0.1,"H_J_m2":1000},{"wl_upper_nm":311,"H_J_cm2":0.16,"H_J_m2":1600},{"wl_upper_nm":312,"H_J_cm2":0.25,"H_J_m2":2500},{"wl_upper_nm":313,"H_J_cm2":0.4,"H_J_m2":4000}],"fallback_H_J_cm2":0.63,"fallback_note":"313\u2013315 nm: 6.3 kJ/m\u00b2 = 0.63 J/cm\u00b2"},"display_bands":[{"name":"UV","wl_start_nm":180,"wl_end_nm":400},{"name":"Visible","wl_start_nm":400,"wl_end_nm":700},{"name":"Near-IR","wl_start_nm":700,"wl_end_nm":1400},{"name":"Far-IR","wl_start_nm":1400,"wl_end_nm":1000000}],"bands":[{"name":"UV","wl_min_nm":180,"wl_max_nm":400,"mode":"dual_limit","combination":"min","note":"MPE = min(thermal, photochemical). Table 5, pp. 283\u2013284.","thermal":{"description":"UV thermal limit: 5.6 t^0.25 kJ/m\u00b2 = 0.56 t^0.25 J/cm\u00b2. Listed as 'Also not to exceed' in Table 5.","regions":[{"t_min_s":1e-09,"t_max_s":10,"formula":"power","a":0.56,"b":0.25,"note":"H = 0.56 \u00d7 t^0.25 J/cm\u00b2"}]},"photochemical":{"description":"UV photochemical limit. Wavelength-dependent sub-regions.","regions":[{"wl_min_nm":180,"wl_max_nm":302,"t_min_s":1e-09,"t_max_s":30000,"formula":"constant","a":0.003,"note":"30 J/m\u00b2 = 3\u00d710\u207b\u00b3 J/cm\u00b2"},{"wl_min_nm":302,"wl_max_nm":315,"t_min_s":1e-09,"t_max_s":30000,"formula":"discrete","lookup":"uv_discrete_steps","note":"Discrete 1-nm step values from Table 5"},{"wl_min_nm":315,"wl_max_nm":400,"t_min_s":10,"t_max_s":30000,"formula":"constant","a":1.0,"below_t_min":"not_applicable","note":"10 kJ/m\u00b2 = 1.0 J/cm\u00b2 for t \u2265 10 s. Below 10 s: photochemical undefined, only thermal applies."}]}},{"name":"Visible/Near-IR","wl_min_nm":400,"wl_max_nm":1400,"mode":"single","uses_ca":true,"note":"Table 7, p. 285. All sub-regions multiply by C_A.","regions":[{"t_min_s":1e-09,"t_max_s":1e-07,"formula":"ca_constant","a":0.02,"note":"200 C_A J/m\u00b2 = 0.02 C_A J/cm\u00b2"},{"t_min_s":1e-07,"t_max_s":10,"formula":"ca_power","a":1.1,"b":0.25,"note":"11 C_A t^0.25 kJ/m\u00b2 = 1.1 C_A t^0.25 J/cm\u00b2"},{"t_min_s":10,"t_max_s":30000,"formula":"ca_linear","a":0.2,"note":"2.0 C_A kW/m\u00b2 = 0.2 C_A W/cm\u00b2 \u2192 H = 0.2 C_A t J/cm\u00b2"}]},{"name":"FIR 1400\u20131500","wl_min_nm":1400,"wl_max_nm":1500,"mode":"single","note":"Table 5.","regions":[{"t_min_s":1e-09,"t_max_s":0.001,"formula":"constant","a":0.1,"note":"1 kJ/m\u00b2 = 0.1 J/cm\u00b2"},{"t_min_s":0.001,"t_max_s":10,"formula":"power","a":0.56,"b":0.25,"note":"5.6 t^0.25 kJ/m\u00b2"},{"t_min_s":10,"t_max_s":30000,"formula":"linear","a":0.1,"note":"1.0 kW/m\u00b2 = 0.1 W/cm\u00b2"}]},{"name":"FIR 1500\u20131800","wl_min_nm":1500,"wl_max_nm":1800,"mode":"single","note":"Table 5.","regions":[{"t_min_s":1e-09,"t_max_s":10,"formula":"constant","a":1.0,"note":"10 kJ/m\u00b2 = 1.0 J/cm\u00b2"},{"t_min_s":10,"t_max_s":30000,"formula":"linear","a":0.1,"note":"1.0 kW/m\u00b2 = 0.1 W/cm\u00b2"}]},{"name":"FIR 1800\u20132600","wl_min_nm":1800,"wl_max_nm":2600,"mode":"single","note":"Table 5.","regions":[{"t_min_s":1e-09,"t_max_s":0.001,"formula":"constant","a":0.1,"note":"1.0 kJ/m\u00b2 = 0.1 J/cm\u00b2"},{"t_min_s":0.001,"t_max_s":10,"formula":"power","a":0.56,"b":0.25,"note":"5.6 t^0.25 kJ/m\u00b2"},{"t_min_s":10,"t_max_s":30000,"formula":"linear","a":0.1,"note":"1.0 kW/m\u00b2 = 0.1 W/cm\u00b2"}]},{"name":"FIR 2600\u20131 mm","wl_min_nm":2600,"wl_max_nm":1000000,"mode":"single","note":"Table 5.","regions":[{"t_min_s":1e-09,"t_max_s":1e-07,"formula":"constant","a":0.01,"note":"100 J/m\u00b2 = 0.01 J/cm\u00b2"},{"t_min_s":1e-07,"t_max_s":10,"formula":"power","a":0.56,"b":0.25,"note":"5.6 t^0.25 kJ/m\u00b2"},{"t_min_s":10,"t_max_s":30000,"formula":"linear","a":0.1,"note":"1.0 kW/m\u00b2 = 0.1 W/cm\u00b2"}]}],"supplementary":{"t_max":{"description":"Recommended maximum anticipated exposure durations for skin (Table 4, Diffuse column).","regions":[{"wl_min_nm":180,"wl_max_nm":400,"t_max_s":30000,"note":"UV"},{"wl_min_nm":400,"wl_max_nm":700,"t_max_s":600,"note":"Visible"},{"wl_min_nm":700,"wl_max_nm":1400,"t_max_s":600,"note":"Near-IR"},{"wl_min_nm":1400,"wl_max_nm":1000000,"t_max_s":10,"note":"Far-IR"}]},"limiting_apertures":{"description":"Limiting aperture diameters for skin MPE averaging (Table 8, Skin column).","regions":[{"wl_min_nm":180,"wl_max_nm":100000,"diameter_mm":3.5,"note":"180 nm to 100 \u00b5m"},{"wl_min_nm":100000,"wl_max_nm":1000000,"diameter_mm":11.0,"note":"100 \u00b5m to 1 mm"}]},"large_area_correction":{"description":"MPE correction for large beam cross-sections (\u03bb > 1.4 \u00b5m, t > 10 s). Table 7 note c.","threshold_cm2":100,"cap_cm2":1000,"formula_mW_cm2":"10000 / A_s","cap_mW_cm2":10},"uv_successive_day_derate":{"description":"De-rating factor for UV (280\u2013400 nm) on successive days.","wl_min_nm":280,"wl_max_nm":400,"factor":2.5}}};

/* ═══════ DATA-DRIVEN ENGINE ═══════ */
/*
 * NOTE: These functions duplicate web/engine.js. Both implementations read
 * from the same JSON schema and must produce identical results.
 *
 * WHY THE DUPLICATION EXISTS:
 * calculator.jsx is Babel-transpiled into a self-contained <script> block
 * inside index.html. There is no module bundler, so it cannot import from
 * engine.js. The standalone engine.js exists for Node.js server-side use
 * and for cross-language verification against the Python engine.
 *
 * If you modify the calculation logic, update BOTH files and re-run the
 * cross-language test suite to verify they remain in agreement.
 */
function CA(wl){var regs=_std.correction_factors.CA.regions;for(var i=0;i<regs.length;i++){var r=regs[i];if(wl>=r.wl_min_nm&&(wl<r.wl_max_nm||(i===regs.length-1&&wl===r.wl_max_nm))){if(r.type==="constant")return r.value;if(r.type==="power10")return Math.pow(10,r.coefficient*(wl-r.offset_nm));}}return _std.correction_factors.CA.default_outside_range||1;}
function uvDisc(wl){var ds=_std.uv_discrete_steps;for(var i=0;i<ds.steps.length;i++){if(wl<ds.steps[i].wl_upper_nm)return ds.steps[i].H_J_cm2;}return ds.fallback_H_J_cm2;}
function evalF(r,wl,t){var f=r.formula;if(f==="constant")return r.a;if(f==="power")return r.a*Math.pow(t,r.b);if(f==="linear")return r.a*t;if(f==="ca_constant")return r.a*CA(wl);if(f==="ca_power")return r.a*CA(wl)*Math.pow(t,r.b);if(f==="ca_linear")return r.a*CA(wl)*t;if(f==="discrete")return uvDisc(wl);return NaN;}
function evalRegs(regs,wl,t){for(var i=0;i<regs.length;i++){var r=regs[i];if(r.wl_min_nm!==undefined&&r.wl_max_nm!==undefined){if(wl<r.wl_min_nm||wl>=r.wl_max_nm)continue;}if(t>=r.t_min_s&&t<r.t_max_s)return evalF(r,wl,t);if(t<r.t_min_s&&r.below_t_min==="not_applicable"){if(r.wl_min_nm!==undefined&&(wl<r.wl_min_nm||wl>=r.wl_max_nm))continue;return Infinity;}}return NaN;}
function evalDual(band,wl,t){var th=evalRegs(band.thermal.regions,wl,t),pc=evalRegs(band.photochemical.regions,wl,t),a=isFinite(th),b=isFinite(pc);if(a&&b)return Math.min(th,pc);return a?th:b?pc:NaN;}
function skinMPE(wl,t){for(var i=0;i<_std.bands.length;i++){var band=_std.bands[i];var inB=wl>=band.wl_min_nm&&wl<band.wl_max_nm;if(!inB&&i===_std.bands.length-1&&wl===band.wl_max_nm)inB=true;if(!inB)continue;return band.mode==="dual_limit"?evalDual(band,wl,t):evalRegs(band.regions,wl,t);}return NaN;}
function rpCalc(wl,tau,prf,T){var r1=skinMPE(wl,tau),ht=skinMPE(wl,T),N=prf*T;if(N<=1)return{r1:r1,r2:r1,H:r1,N:N,bd:"Rule 1"};var r2=ht/N;return{r1:r1,r2:r2,H:Math.min(r1,r2),N:N,bd:r1<=r2?"Rule 1":"Rule 2"};}
function bnd(wl){var db=_std.display_bands;for(var i=0;i<db.length;i++){if(wl>=db[i].wl_start_nm&&wl<db[i].wl_end_nm)return db[i].name;}return db[db.length-1].name;}

/* ═══════ SCANNING ENGINE ═══════ */
function scanDwellGaussian(d,v){return d*Math.sqrt(Math.PI)/(2*v);}
function scanDwellGeometric(d,v){return d/v;}
function _erf(x){var a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;var s=x<0?-1:1;x=Math.abs(x);var t=1/(1+p*x);return s*(1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x));}
var _gT=null,_gN=1024,_gM=9.0;
function _initG(){if(_gT)return;_gT=new Float64Array(_gN);for(var i=0;i<_gN;i++)_gT[i]=Math.exp(-i*_gM/(_gN-1));}
function _gL(u){if(u>=_gM)return 0;if(u<=0)return 1;var idx=u*(_gN-1)/_gM,i=idx|0,f=idx-i;return _gT[i]*(1-f)+_gT[i+1]*f;}

function scanCreateGrid(d,segs,ppd){
  ppd=ppd||8;if(ppd<4)ppd=4;if(ppd>32)ppd=32;
  var dx=d/ppd,margin=3*d;
  var xn=Infinity,xx=-Infinity,yn=Infinity,yx=-Infinity;
  for(var i=0;i<segs.length;i++){var s=segs[i];var xe=s.x+d*Math.cos(s.a),ye=s.y+d*Math.sin(s.a);if(s.x<xn)xn=s.x;if(s.x>xx)xx=s.x;if(s.y<yn)yn=s.y;if(s.y>yx)yx=s.y;if(xe<xn)xn=xe;if(xe>xx)xx=xe;if(ye<yn)yn=ye;if(ye>yx)yx=ye;}
  xn-=margin;xx+=margin;yn-=margin;yx+=margin;
  var nx=Math.ceil((xx-xn)/dx)+1,ny=Math.ceil((yx-yn)/dx)+1;
  if(nx*ny>4e6){var sc=Math.sqrt(4e6/(nx*ny));nx=Math.floor(nx*sc);ny=Math.floor(ny*sc);dx=(xx-xn)/(nx-1);}
  return{nx:nx,ny:ny,dx:dx,xn:xn,yn:yn,flu:new Float32Array(nx*ny),pc:new Float32Array(nx*ny),ppH:new Float32Array(nx*ny),
    lvt:(function(){var a=new Float32Array(nx*ny);for(var i=0;i<a.length;i++)a[i]=-1e30;return a;})(),
    mrv:(function(){var a=new Float32Array(nx*ny);for(var i=0;i<a.length;i++)a[i]=1e30;return a;})()};
}

function scanFluPulsed(g,d,prf,Ep,segs){
  _initG();var w=d/Math.sqrt(2),sig=d/(2*Math.sqrt(2)),w2=w*w;
  var H0=2*Ep/(Math.PI*w2)*100,tr=3*sig,tr2=tr*tr,tg=Math.ceil(tr/g.dx);
  var nx=g.nx,ny=g.ny,dx=g.dx,xn=g.xn,yn=g.yn,flu=g.flu,pc=g.pc,ppH=g.ppH,lvt=g.lvt,mrv=g.mrv;
  var te=0,tp=0;
  var rth=0;for(var ri=0;ri<segs.length;ri++){var rd=d/segs[ri].v;if(rd>rth)rth=rd;}rth*=2;
  for(var si=0;si<segs.length;si++){
    var s=segs[si],sd=d/s.v,ts=te,ca=Math.cos(s.a),sa=Math.sin(s.a);
    var kf=Math.ceil(ts*prf),klf=(te+sd)*prf;
    var kl=(klf===Math.floor(klf))?Math.floor(klf)-1:Math.floor(klf);
    for(var k=kf;k<=kl;k++){
      var tk=k/prf,fr=(tk-ts)/sd,px=s.x+fr*d*ca,py=s.y+fr*d*sa;
      var cx=Math.round((px-xn)/dx),cy=Math.round((py-yn)/dx);
      var x0=cx-tg,x1=cx+tg,y0=cy-tg,y1=cy+tg;
      if(x0<0)x0=0;if(x1>=nx)x1=nx-1;if(y0<0)y0=0;if(y1>=ny)y1=ny-1;
      for(var iy=y0;iy<=y1;iy++){var gy=yn+iy*dx,dy2=(gy-py)*(gy-py);if(dy2>tr2)continue;
        for(var ix=x0;ix<=x1;ix++){var gx=xn+ix*dx,r2=(gx-px)*(gx-px)+dy2;if(r2>tr2)continue;
          var Hp=H0*_gL(2*r2/w2),idx=iy*nx+ix;flu[idx]+=Hp;pc[idx]+=1;if(Hp>ppH[idx])ppH[idx]=Hp;
          var gap=tk-lvt[idx];if(gap>rth&&lvt[idx]>-1e29){if(gap<mrv[idx])mrv[idx]=gap;}lvt[idx]=tk;}}
      tp++;
    }
    te+=sd;
  }
  return{tp:tp,tt:te};
}

function scanFluCW(g,d,P,segs){
  var sig=d/(2*Math.sqrt(2)),s2=sig*Math.sqrt(2),sig2=sig*sig,tp=3*sig,tp2=tp*tp;
  var nx=g.nx,ny=g.ny,dx=g.dx,xn=g.xn,yn=g.yn,flu=g.flu,ppH=g.ppH,lvt=g.lvt,mrv=g.mrv;
  var sws=[],si=0;
  while(si<segs.length){var s0=segs[si],a=s0.a,v=s0.v,ca=Math.cos(a),sa=Math.sin(a),nm=1;
    while(si+nm<segs.length&&segs[si+nm].a===a&&segs[si+nm].v===v){
      var ex=s0.x+nm*d*ca,ey=s0.y+nm*d*sa,nx2=segs[si+nm];
      var dg=(nx2.x-ex)*(nx2.x-ex)+(nx2.y-ey)*(nx2.y-ey);
      if(dg>d*d*0.01)break;nm++;}
    var L=nm*d;
    sws.push({x1:s0.x,y1:s0.y,x2:s0.x+L*ca,y2:s0.y+L*sa,ux:ca,uy:sa,L:L,v:v});si+=nm;}
  var coeff0=P/(sig*Math.sqrt(2*Math.PI)),tt=0,mv=Infinity;
  for(var wi=0;wi<sws.length;wi++){var sw=sws[wi],co=coeff0/sw.v*100,st0=tt;
    if(sw.v<mv)mv=sw.v;
    var sxn=Math.min(sw.x1,sw.x2)-tp,sxx=Math.max(sw.x1,sw.x2)+tp;
    var syn=Math.min(sw.y1,sw.y2)-tp,syx=Math.max(sw.y1,sw.y2)+tp;
    var ix0=Math.max(0,Math.floor((sxn-xn)/dx)),ix1=Math.min(nx-1,Math.ceil((sxx-xn)/dx));
    var iy0=Math.max(0,Math.floor((syn-yn)/dx)),iy1=Math.min(ny-1,Math.ceil((syx-yn)/dx));
    for(var iy=iy0;iy<=iy1;iy++){var gy=yn+iy*dx;
      for(var ix=ix0;ix<=ix1;ix++){var gx=xn+ix*dx;
        var qx=gx-sw.x1,qy=gy-sw.y1,tpar=qx*sw.ux+qy*sw.uy;
        if(tpar<-tp||tpar>sw.L+tp)continue;
        var dp=qx*sw.uy-qy*sw.ux,dp2=dp*dp;if(dp2>tp2)continue;
        var env=Math.exp(-dp2/(2*sig2));
        var F=co*env*0.5*(_erf((sw.L-tpar)/s2)-_erf(-tpar/s2));
        if(F>0){var idx=iy*nx+ix;flu[idx]+=F;if(F>ppH[idx])ppH[idx]=F;
          var tc=tpar<0?0:(tpar>sw.L?sw.L:tpar),tv=st0+tc/sw.v;
          var gp=tv-lvt[idx];if(gp>0&&lvt[idx]>-1e29){if(gp<mrv[idx])mrv[idx]=gp;}lvt[idx]=tv;}}}
    tt+=sw.L/sw.v;}
  return{ns:sws.length,tt:tt,mv:mv};
}

function scanCompute(beam,segs,ppd){
  if(!segs||!segs.length)return null;var g=scanCreateGrid(beam.d,segs,ppd||8);
  var st=beam.cw?scanFluCW(g,beam.d,beam.P,segs):scanFluPulsed(g,beam.d,beam.prf,beam.Ep,segs);
  return{g:g,st:st};
}

function scanSafety(g,beam,T,dwMode,minV){
  var mT=skinMPE(beam.wl,T),mt,r1L;
  if(beam.cw&&isFinite(minV)&&minV>0){
    var td=dwMode==="geometric"?scanDwellGeometric(beam.d,minV):scanDwellGaussian(beam.d,minV);
    mt=skinMPE(beam.wl,td);r1L=mt;
  }else if(!beam.cw){mt=skinMPE(beam.wl,beam.tau);r1L=mt;}
  else{mt=NaN;r1L=Infinity;}
  var n=g.nx*g.ny,wR1=0,wR2=0,wI=0,wV=0,pF=0,mP=0;
  for(var i=0;i<n;i++){if(g.flu[i]>pF)pF=g.flu[i];if(g.pc[i]>mP)mP=g.pc[i];
    var r1=isFinite(r1L)&&r1L>0?(g.ppH[i]/r1L):0,r2=isFinite(mT)?(g.flu[i]/mT):0;
    if(r1>wR1)wR1=r1;if(r2>wR2)wR2=r2;var w=r1>r2?r1:r2;if(w>wV){wV=w;wI=i;}}
  var wx=wI%g.nx,wy=(wI-wx)/g.nx;
  // Revisit timing
  var gmr=1e30,rp=0;
  for(var ri=0;ri<n;ri++){if(g.mrv[ri]<1e29){rp++;if(g.mrv[ri]<gmr)gmr=g.mrv[ri];}}
  if(gmr>=1e29)gmr=Infinity;
  var kappa=0.13,tauR=beam.d*beam.d/(4*kappa);
  return{safe:wR1<=1&&wR2<=1,wr:wV,wx:g.xn+wx*g.dx,wy:g.yn+wy*g.dx,br:wR1>=wR2?"Rule 1":"Rule 2",
    sm:1-wV,mt:mt,mT:mT,pF:pF,ppM:g.ppH[wI],mP:mP,r1m:wR1,r2m:wR2,
    minRv:gmr,rvPts:rp,tauR:tauR,rvOk:gmr>=tauR};
}

function scanBuildLinear(x0,y0,a,L,v,d){var n=Math.round(L/d);if(n<1)n=1;var ca=Math.cos(a),sa=Math.sin(a),r=[];
  for(var i=0;i<n;i++)r.push({x:x0+i*d*ca,y:y0+i*d*sa,a:a,v:v});return r;}
function scanBuildBidi(x0,y0,lL,nL,h,sv,jv,d){var r=[];
  for(var j=0;j<nL;j++){var ly=y0+j*h;
    if(j%2===0){var ls=scanBuildLinear(x0,ly,0,lL,sv,d);for(var k=0;k<ls.length;k++)r.push(ls[k]);}
    else{var ls2=scanBuildLinear(x0+lL,ly,Math.PI,lL,sv,d);for(var k2=0;k2<ls2.length;k2++)r.push(ls2[k2]);}
    if(j<nL-1){var jx=j%2===0?x0+lL:x0;var js=scanBuildLinear(jx,ly,Math.PI/2,h,jv,d);for(var k3=0;k3<js.length;k3++)r.push(js[k3]);}}
  return r;}
function scanBuildRaster(x0,y0,lL,nL,h,sv,jv,d){var r=[];
  for(var j=0;j<nL;j++){var ly=y0+j*h;
    var ls=scanBuildLinear(x0,ly,0,lL,sv,d);for(var k=0;k<ls.length;k++)r.push(ls[k]);
    if(j<nL-1){var ret=scanBuildLinear(x0+lL,ly,Math.PI,lL,jv,d);for(var k2=0;k2<ret.length;k2++)r.push(ret[k2]);
      var st=scanBuildLinear(x0,ly,Math.PI/2,h,jv,d);for(var k3=0;k3<st.length;k3++)r.push(st[k3]);}}
  return r;}
function scanMaxPulseEnergy(wl,d,tau){var w=d/Math.sqrt(2);return skinMPE(wl,tau)*Math.PI*w*w/200;}
function scanMinRepRate(wl,d,tau,P){var w=d/Math.sqrt(2),mt=skinMPE(wl,tau);return mt<=0?Infinity:200*P/(Math.PI*w*w*mt);}
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

/* PA engine */
function paEffFluence(wl,tau,f,T){var r1=skinMPE(wl,tau),hT=skinMPE(wl,T);if(!isFinite(r1)||!isFinite(hT))return NaN;var N=f*T;if(N<1)N=1;return Math.min(r1,hT/N);}
function paRelSNR(wl,tau,f,T){var ps=skinMPE(wl,tau);if(!isFinite(ps)||ps<=0)return NaN;var pe=paEffFluence(wl,tau,f,T);if(!isFinite(pe)||pe<=0)return NaN;var N=f*T;if(N<1)N=1;return(pe*Math.sqrt(N))/ps;}
function paOptPRF(wl,tau,T){var hs=skinMPE(wl,tau),hT=skinMPE(wl,T);if(!isFinite(hs)||!isFinite(hT)||hs<=0||T<=0)return NaN;return hT/(hs*T);}

/* ═══════ BEAM GEOMETRY & LIMITING APERTURE (ICNIRP 2013 Table 8, Table 7 note b, p. 288) ═══════ */
/*
 * Limiting aperture: the diameter over which radiant exposure is averaged
 * for comparison with the MPE. For skin:
 *   λ < 100 µm:  3.5 mm  (Table 8)
 *   λ ≥ 100 µm:  11 mm   (Table 8)
 *
 * Evaluation rules (Table 7 note b, p. 288):
 *   d < 1 mm:     Use ACTUAL radiant exposure (not averaged over aperture)
 *   1 mm ≤ d < d_ap: Average over the limiting aperture → H_eval = E / A_aperture
 *   d ≥ d_ap:     Beam fills aperture → H_eval = E / A_beam
 *
 * "Beam diameter" for Gaussian beams is the 1/e diameter (p. 288):
 *   "the distance between diametrically opposed points in the beam where
 *    the local irradiance is 1/e, 0.37 times peak irradiance"
 */
function getAperture(wl_nm){
  var regs=_std.supplementary.limiting_apertures.regions;
  for(var i=0;i<regs.length;i++){
    if(wl_nm>=regs[i].wl_min_nm&&wl_nm<regs[i].wl_max_nm)return regs[i].diameter_mm;
  }
  return regs[regs.length-1].diameter_mm;
}

function beamEval(wl_nm, beam_dia_mm){
  var d_ap=getAperture(wl_nm);
  if(!isFinite(beam_dia_mm)||beam_dia_mm<=0)return{d_eval_mm:0,area_cm2:0,regime:"invalid",aperture_mm:d_ap,threshold_mm:1,note:"Enter a beam diameter greater than zero."};
  var ap=_std.supplementary&&_std.supplementary.limiting_apertures;
  var threshold=(ap&&ap.small_beam_threshold_mm)||1.0;
  var d=beam_dia_mm;
  var d_eval, regime, note;
  var apRef=(ap&&ap.aperture_reference)||"";
  var sbRef=(ap&&ap.small_beam_reference)||"";

  if(d<threshold){
    d_eval=d;
    regime="actual";
    note="Beam < "+threshold+" mm: actual radiant exposure used ("+sbRef+"). No aperture averaging.";
  } else if(d<d_ap){
    d_eval=d_ap;
    regime="aperture";
    note="Beam \u2265 "+threshold+" mm but < "+d_ap.toFixed(1)+" mm aperture: averaged over "+d_ap.toFixed(1)+" mm limiting aperture ("+apRef+").";
  } else {
    d_eval=d;
    regime="beam";
    note="Beam \u2265 "+d_ap.toFixed(1)+" mm aperture: actual beam area used. For non-uniform beams, evaluate the highest H within any "+d_ap.toFixed(1)+" mm circle.";
  }

  var r_cm=d_eval/20;
  var area_cm2=Math.PI*r_cm*r_cm;
  return{d_eval_mm:d_eval, area_cm2:area_cm2, regime:regime, aperture_mm:d_ap, threshold_mm:threshold, note:note};
}

var WC=["#0072B2","#E69F00","#009E73","#CC79A7","#56B4E9","#D55E00","#F0E442","#000000"];
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
  var T=p.T,msg=p.msg,setMsg=p.setMsg;
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

  function calculate(){
    setCmp(true);setDirty(false);
    setTimeout(function(){
      var segs;
      if(pat==="linear") segs=scanBuildLinear(0,0,0,lineL,vel,dia);
      else if(pat==="bidi") segs=scanBuildBidi(0,0,lineL,nLines,hatch,vel,vel*5,dia);
      else segs=scanBuildRaster(0,0,lineL,nLines,hatch,vel,vel*5,dia);

      var Ep=prf>0?pw/prf:0;
      var isCW=prf===0&&tau===0;
      var beam={wl:wl,d:dia,tau:tau,prf:prf,Ep:Ep,P:pw,cw:isCW};
      var cr=scanCompute(beam,segs,ppd);
      if(cr){
        var minV=isCW?(cr.st.mv||vel):0;
        var sf=scanSafety(cr.g,beam,cr.st.tt,dwm,minV);

        // Compute safety limits
        // Max permissible power: fluence scales linearly with power
        var unitBeam={wl:wl,d:dia,tau:tau,prf:prf,Ep:prf>0?1/prf:0,P:1,cw:isCW};
        var unitCr=scanCompute(unitBeam,segs,ppd);
        var maxP=Infinity;
        if(unitCr){
          var upF=0;for(var ui=0;ui<unitCr.g.nx*unitCr.g.ny;ui++)if(unitCr.g.flu[ui]>upF)upF=unitCr.g.flu[ui];
          var mpeT=skinMPE(wl,unitCr.st.tt||cr.st.tt);
          if(upF>0)maxP=mpeT/upF;
          // Also check Rule 1 for pulsed
          if(!isCW&&prf>0){var w2=dia/Math.sqrt(2);var maxPr1=skinMPE(wl,tau)*prf*Math.PI*w2*w2/(2*100);
            if(maxPr1<maxP)maxP=maxPr1;}
        }

        // Min safe velocity: bisection search
        var minVel=0;
        function testV(tv){
          var ts;
          if(pat==="linear")ts=scanBuildLinear(0,0,0,lineL,tv,dia);
          else if(pat==="bidi")ts=scanBuildBidi(0,0,lineL,nLines,hatch,tv,tv*5,dia);
          else ts=scanBuildRaster(0,0,lineL,nLines,hatch,tv,tv*5,dia);
          var tb={wl:wl,d:dia,tau:tau,prf:prf,Ep:Ep,P:pw,cw:isCW};
          var tcr=scanCompute(tb,ts,Math.min(ppd,8)); // use ppd≤8 for speed
          if(!tcr)return true;
          var tmv=isCW?(tcr.st.mv||tv):0;
          var tsf=scanSafety(tcr.g,tb,tcr.st.tt,dwm,tmv);
          return tsf.safe;
        }
        if(testV(1e6)){
          var vLo=0.01,vHi=1e6;
          for(var bi=0;bi<30&&(vHi-vLo)/vLo>0.005;bi++){
            var vMid=(vLo+vHi)/2;
            if(testV(vMid))vHi=vMid;else vLo=vMid;
          }
          minVel=vHi;
        }else{minVel=Infinity;}

        setRes({g:cr.g,st:cr.st,sf:sf,segs:segs,beam:beam,maxP:maxP,minV:minVel,
          pulses:(function(){
            if(isCW||!prf||prf<=0)return[];
            var pp=[],te2=0;
            for(var si2=0;si2<segs.length;si2++){
              var s2=segs[si2],sd2=dia/s2.v,ts2=te2;
              var ca2=Math.cos(s2.a),sa2=Math.sin(s2.a);
              var kf2=Math.ceil(ts2*prf),klf2=(te2+sd2)*prf;
              var kl2=(klf2===Math.floor(klf2))?Math.floor(klf2)-1:Math.floor(klf2);
              for(var k2=kf2;k2<=kl2;k2++){
                var tk2=k2/prf,fr2=(tk2-ts2)/sd2;
                pp.push({t:tk2,x:s2.x+fr2*dia*ca2,y:s2.y+fr2*dia*sa2,si:si2});
              }
              te2+=sd2;
            }
            return pp;
          })()
        });
      }
      setCmp(false);
    },50);
  }

  var _hover=useState(null),hover=_hover[0],setHover=_hover[1];

  // Draw heatmap with axes, colorbar, and scan path overlay
  var MARGIN={l:48,r:70,t:12,b:30};
  var CW=720,CH=380;
  var PW=CW-MARGIN.l-MARGIN.r,PH=CH-MARGIN.t-MARGIN.b;

  function colorMap(v){
    var ri,gi,bi;
    if(v<0.25){ri=0;gi=Math.round(v*4*255);bi=Math.round(128+127*(1-v*4));}
    else if(v<0.5){ri=0;gi=255;bi=Math.round((0.5-v)*2*255);}
    else if(v<0.75){ri=Math.round((v-0.5)*4*255);gi=255;bi=0;}
    else{ri=255;gi=Math.round((1-v)*4*255);bi=0;}
    return[ri,gi,bi];
  }

  useEffect(function(){
    if(!res||!canRef.current)return;
    var c=canRef.current,ctx=c.getContext("2d");
    var g=res.g,maxF=res.sf.pF||1;
    ctx.clearRect(0,0,CW,CH);ctx.fillStyle=T.bg;ctx.fillRect(0,0,CW,CH);

    // Draw heatmap in plot area
    var img=ctx.createImageData(g.nx,g.ny);
    for(var i=0;i<g.nx*g.ny;i++){
      var v=g.flu[i]/maxF,rgb=colorMap(v);
      var al=v>0.005?220:0;
      img.data[i*4]=rgb[0];img.data[i*4+1]=rgb[1];img.data[i*4+2]=rgb[2];img.data[i*4+3]=al;
    }
    var tmp=document.createElement("canvas");tmp.width=g.nx;tmp.height=g.ny;
    tmp.getContext("2d").putImageData(img,0,0);
    ctx.save();ctx.translate(MARGIN.l,MARGIN.t);
    ctx.scale(PW/g.nx,PH/g.ny);ctx.drawImage(tmp,0,0);ctx.restore();

    // Plot area border
    ctx.strokeStyle=T.bd;ctx.lineWidth=1;
    ctx.strokeRect(MARGIN.l,MARGIN.t,PW,PH);

    // Scan path overlay
    var xRange=g.xn+(g.nx-1)*g.dx-g.xn,yRange=g.yn+(g.ny-1)*g.dx-g.yn;
    var sx=PW/xRange,sy=PH/yRange;
    ctx.strokeStyle="rgba(255,255,255,0.4)";ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();
    for(var si=0;si<res.segs.length;si++){
      var s=res.segs[si],px=MARGIN.l+(s.x-g.xn)*sx,py=MARGIN.t+(s.y-g.yn)*sy;
      if(si===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    var last=res.segs[res.segs.length-1];
    ctx.lineTo(MARGIN.l+(last.x+res.beam.d*Math.cos(last.a)-g.xn)*sx,MARGIN.t+(last.y+res.beam.d*Math.sin(last.a)-g.yn)*sy);
    ctx.stroke();ctx.setLineDash([]);

    // Worst point marker
    var wpx=MARGIN.l+(res.sf.wx-g.xn)*sx,wpy=MARGIN.t+(res.sf.wy-g.yn)*sy;
    ctx.strokeStyle="#D55E00";ctx.lineWidth=2;ctx.beginPath();ctx.arc(wpx,wpy,6,0,2*Math.PI);ctx.stroke();

    // Axis labels
    ctx.fillStyle=T.td;ctx.font="9px monospace";ctx.textAlign="center";
    var xMin=g.xn,xMax=g.xn+(g.nx-1)*g.dx,yMin=g.yn,yMax=g.yn+(g.ny-1)*g.dx;

    // X-axis ticks
    function niceTicks(lo,hi,n){var range=hi-lo,step=range/n,mag=Math.pow(10,Math.floor(Math.log10(step)));
      var frac=step/mag;var ns=frac<1.5?1:frac<3.5?2:frac<7.5?5:10;step=ns*mag;
      var start=Math.ceil(lo/step)*step,ticks=[];for(var v=start;v<=hi+step*0.01;v+=step)ticks.push(Math.round(v*1e6)/1e6);return ticks;}

    var xTicks=niceTicks(xMin,xMax,6);
    for(var ti=0;ti<xTicks.length;ti++){
      var tx=MARGIN.l+(xTicks[ti]-xMin)/(xMax-xMin)*PW;
      ctx.fillText(xTicks[ti].toFixed(1),tx,MARGIN.t+PH+14);
      ctx.strokeStyle=T.bd;ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(tx,MARGIN.t+PH);ctx.lineTo(tx,MARGIN.t+PH+4);ctx.stroke();
    }
    ctx.fillText("x (mm)",MARGIN.l+PW/2,MARGIN.t+PH+26);

    // Y-axis ticks
    ctx.textAlign="right";
    var yTicks=niceTicks(yMin,yMax,5);
    for(var ti2=0;ti2<yTicks.length;ti2++){
      var ty=MARGIN.t+(yTicks[ti2]-yMin)/(yMax-yMin)*PH;
      ctx.fillText(yTicks[ti2].toFixed(1),MARGIN.l-6,ty+3);
      ctx.strokeStyle=T.bd;ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(MARGIN.l,ty);ctx.lineTo(MARGIN.l-4,ty);ctx.stroke();
    }
    ctx.save();ctx.translate(10,MARGIN.t+PH/2);ctx.rotate(-Math.PI/2);ctx.textAlign="center";
    ctx.fillText("y (mm)",0,0);ctx.restore();

    // Colorbar
    var cbX=CW-MARGIN.r+14,cbW=14,cbH=PH;
    for(var cy=0;cy<cbH;cy++){
      var frac2=1-cy/cbH;var rgb2=colorMap(frac2);
      ctx.fillStyle="rgb("+rgb2[0]+","+rgb2[1]+","+rgb2[2]+")";
      ctx.fillRect(cbX,MARGIN.t+cy,cbW,1);
    }
    ctx.strokeStyle=T.bd;ctx.lineWidth=1;ctx.strokeRect(cbX,MARGIN.t,cbW,cbH);
    ctx.textAlign="left";ctx.fillStyle=T.td;ctx.font="8px monospace";
    var cbTicks=[0,0.25,0.5,0.75,1.0];
    for(var ci=0;ci<cbTicks.length;ci++){
      var cyp=MARGIN.t+cbH*(1-cbTicks[ci]);
      var cbVal=cbTicks[ci]*maxF;
      ctx.fillText(numFmt(cbVal,2),cbX+cbW+4,cyp+3);
    }
    ctx.save();ctx.translate(cbX+cbW+40,MARGIN.t+cbH/2);ctx.rotate(-Math.PI/2);ctx.textAlign="center";
    ctx.font="8px monospace";ctx.fillText("J/cm\u00b2",0,0);ctx.restore();

  },[res,T]);

  function onCanvasMove(e){
    if(!res||!canRef.current)return;
    var rect=canRef.current.getBoundingClientRect();
    var scaleX=CW/rect.width,scaleY=CH/rect.height;
    var cx=(e.clientX-rect.left)*scaleX,cy=(e.clientY-rect.top)*scaleY;
    // Check if inside plot area
    if(cx<MARGIN.l||cx>MARGIN.l+PW||cy<MARGIN.t||cy>MARGIN.t+PH){setHover(null);return;}
    var g=res.g;
    var xRange=g.xn+(g.nx-1)*g.dx-g.xn,yRange=g.yn+(g.ny-1)*g.dx-g.yn;
    var xMM=g.xn+(cx-MARGIN.l)/PW*xRange;
    var yMM=g.yn+(cy-MARGIN.t)/PH*yRange;
    var ix=Math.round((xMM-g.xn)/g.dx),iy=Math.round((yMM-g.yn)/g.dx);
    if(ix<0||ix>=g.nx||iy<0||iy>=g.ny){setHover(null);return;}
    var idx=iy*g.nx+ix;
    setHover({x:xMM,y:yMM,f:g.flu[idx],pc:g.pc[idx],pp:g.ppH[idx],rv:g.mrv[idx]});
  }

  var _vizTab=useState("fluence"),vizTab=_vizTab[0],setVizTab=_vizTab[1];
  var timRef=useRef(null),spcRef=useRef(null);
  var _tView=useState(null),tView=_tView[0],setTView=_tView[1];
  var _dragStart=useState(null),dragStart=_dragStart[0],setDragStart=_dragStart[1];

  // Initialize timing view on new results
  useEffect(function(){
    if(!res||!res.pulses||!res.pulses.length)return;
    var pp=res.pulses,allN=pp.length,fullT=pp[allN-1].t*1.05||1;
    // Default zoom: show ~40-80 pulses worth
    var nVis=Math.min(60,allN);
    setTView({t0:0,t1:pp[nVis-1].t*1.15,fullT:fullT});
  },[res]);

  // Draw timing diagram (runs when tView changes)
  useEffect(function(){
    if(vizTab!=="timing"||!res||!res.pulses||!res.pulses.length||!timRef.current||!tView)return;
    var c=timRef.current,ctx=c.getContext("2d"),W=c.width,H=c.height;
    var ML=60,MR=16,MT=40,MB=36,PW2=W-ML-MR,PH2=H-MT-MB;
    var pp=res.pulses,allN=pp.length;
    var t0=tView.t0,t1=tView.t1,fullT=tView.fullT,tRange=t1-t0||1;

    // Collect visible pulses
    var visPulses=[];for(var vi=0;vi<allN;vi++){if(pp[vi].t>=t0-tRange*0.1&&pp[vi].t<=t1+tRange*0.1)visPulses.push(pp[vi]);}

    ctx.clearRect(0,0,W,H);ctx.fillStyle=T.bgI;ctx.fillRect(0,0,W,H);

    // Overview minimap strip
    var stripH=14,stripY=4;
    ctx.fillStyle=T.card;ctx.fillRect(ML,stripY,PW2,stripH);
    ctx.strokeStyle=T.bd;ctx.lineWidth=0.5;ctx.strokeRect(ML,stripY,PW2,stripH);
    for(var mi=0;mi<allN;mi+=Math.max(1,Math.floor(allN/PW2))){
      var mx=ML+pp[mi].t/fullT*PW2;
      ctx.fillStyle=T.ac;ctx.globalAlpha=0.3;ctx.fillRect(mx,stripY+1,1,stripH-2);
    }
    var zx1=ML+t0/fullT*PW2,zx2=ML+t1/fullT*PW2;
    ctx.globalAlpha=0.2;ctx.fillStyle=T.ac;ctx.fillRect(zx1,stripY,Math.max(2,zx2-zx1),stripH);
    ctx.globalAlpha=1;ctx.strokeStyle=T.ac;ctx.lineWidth=1.5;ctx.strokeRect(zx1,stripY,Math.max(2,zx2-zx1),stripH);
    ctx.fillStyle=T.td;ctx.font="8px monospace";ctx.textAlign="left";
    ctx.fillText(visPulses.length+" of "+allN+" pulses | Scroll to zoom, drag to pan",ML+4,stripY+stripH+10);

    // Main plot
    ctx.fillStyle=T.card;ctx.fillRect(ML,MT,PW2,PH2);
    ctx.strokeStyle=T.bd;ctx.lineWidth=1;ctx.strokeRect(ML,MT,PW2,PH2);

    // Draw Gaussian pulse profiles
    var pulsePixW=Math.max(3,Math.min(25,PW2/(visPulses.length*2.2)));
    var sigma=pulsePixW/3;
    var baseline=MT+PH2-1,peakH=PH2*0.85;

    ctx.save();ctx.beginPath();ctx.rect(ML,MT,PW2,PH2);ctx.clip();
    for(var pi=0;pi<visPulses.length;pi++){
      var cx2=ML+(visPulses[pi].t-t0)/tRange*PW2;
      ctx.beginPath();ctx.moveTo(cx2-pulsePixW*2.5,baseline);
      for(var gx=-pulsePixW*2.5;gx<=pulsePixW*2.5;gx+=0.8){
        var gy=peakH*Math.exp(-0.5*(gx/sigma)*(gx/sigma));
        ctx.lineTo(cx2+gx,baseline-gy);
      }
      ctx.lineTo(cx2+pulsePixW*2.5,baseline);ctx.closePath();
      ctx.fillStyle=T.ac;ctx.globalAlpha=0.3;ctx.fill();
      ctx.strokeStyle=T.ac;ctx.globalAlpha=0.7;ctx.lineWidth=0.8;ctx.stroke();
    }
    ctx.restore();ctx.globalAlpha=1;

    // Time axis with smart formatting
    ctx.fillStyle=T.td;ctx.font="9px monospace";ctx.textAlign="center";
    for(var ti=0;ti<=5;ti++){
      var tv=t0+ti/5*tRange,tx=ML+ti/5*PW2;
      var tl;if(tRange<2e-4)tl=(tv*1e6).toFixed(1)+"\u00b5s";
      else if(tRange<0.2)tl=(tv*1e3).toFixed(2)+"ms";
      else tl=tv.toFixed(3)+"s";
      ctx.fillText(tl,tx,MT+PH2+14);
      ctx.strokeStyle=T.bd;ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(tx,MT+PH2);ctx.lineTo(tx,MT+PH2+4);ctx.stroke();
    }
    ctx.fillText("Time",ML+PW2/2,MT+PH2+30);
    ctx.textAlign="right";ctx.fillText("Pulse",ML-6,MT+PH2/2-4);ctx.fillText("Amplitude",ML-6,MT+PH2/2+8);
  },[res,vizTab,T,tView]);

  // Timing canvas interaction handlers
  function onTimWheel(e){
    e.preventDefault();if(!tView||!timRef.current)return;
    var rect=timRef.current.getBoundingClientRect();
    var ML2=60,MR2=16,PW3=timRef.current.width-ML2-MR2;
    var frac=(e.clientX-rect.left)/(rect.width)*timRef.current.width;
    var tFrac=Math.max(0,Math.min(1,(frac-ML2)/PW3));
    var tMouse=tView.t0+tFrac*(tView.t1-tView.t0);
    var zf=e.deltaY>0?1.3:1/1.3;
    var newRange=(tView.t1-tView.t0)*zf;
    newRange=Math.max(1e-7,Math.min(tView.fullT,newRange));
    var nt0=tMouse-tFrac*newRange,nt1=tMouse+(1-tFrac)*newRange;
    if(nt0<0){nt1-=nt0;nt0=0;}if(nt1>tView.fullT){nt0-=(nt1-tView.fullT);nt1=tView.fullT;nt0=Math.max(0,nt0);}
    setTView({t0:nt0,t1:nt1,fullT:tView.fullT});
  }
  function onTimDown(e){
    if(!tView||!timRef.current)return;
    setDragStart({x:e.clientX,t0:tView.t0,t1:tView.t1});
  }
  function onTimMove(e){
    if(!dragStart||!tView||!timRef.current)return;
    var rect=timRef.current.getBoundingClientRect();
    var dx=e.clientX-dragStart.x;
    var dtPx=(tView.t1-tView.t0)/rect.width;
    var dt=-dx*dtPx;
    var nt0=dragStart.t0+dt,nt1=dragStart.t1+dt;
    if(nt0<0){nt1-=nt0;nt0=0;}if(nt1>tView.fullT){nt0-=(nt1-tView.fullT);nt1=tView.fullT;nt0=Math.max(0,nt0);}
    setTView({t0:nt0,t1:nt1,fullT:tView.fullT});
  }
  function onTimUp(){setDragStart(null);}

  // Draw 1D spatial cross-section: fluence along scan line
  useEffect(function(){
    if(vizTab!=="spatial"||!res||!res.pulses||!res.pulses.length||!spcRef.current)return;
    var c=spcRef.current,ctx=c.getContext("2d"),W=c.width,H=c.height;
    var ML=65,MR=16,MT=20,MB=40,PW2=W-ML-MR,PH2=H-MT-MB;
    var pp=res.pulses;
    var sigma=dia/(2*Math.sqrt(2)); // Gaussian sigma in mm
    var w=dia/Math.sqrt(2); // 1/e² radius
    var Ep=prf>0?pw/prf:0;
    var H0_cm2=2*Ep/(Math.PI*w*w)*100; // peak fluence per pulse in J/cm²

    // Compute fluence along x-axis (y=0 for first scan line)
    var xMin=pp[0].x-dia*2,xMax=pp[pp.length-1].x+dia*2;
    // For raster patterns, just use first line y-value
    var yLine=pp[0].y;
    var firstLinePulses=[];
    for(var fi=0;fi<pp.length;fi++){
      if(Math.abs(pp[fi].y-yLine)<dia*0.5)firstLinePulses.push(pp[fi]);
      else if(firstLinePulses.length>0)break; // stop at end of first line
    }
    if(firstLinePulses.length>0){
      xMin=firstLinePulses[0].x-dia*2;
      xMax=firstLinePulses[firstLinePulses.length-1].x+dia*2;
    }
    var nPts=Math.min(800,PW2);
    var xR=xMax-xMin||1;
    var dx=xR/nPts;

    // Compute individual pulse profiles and cumulative
    var cumFlu=new Float64Array(nPts);
    var pulseFlu=[];
    for(var pi2=0;pi2<firstLinePulses.length;pi2++){
      var pf=new Float64Array(nPts);
      var px0=firstLinePulses[pi2].x;
      for(var xi=0;xi<nPts;xi++){
        var xp=xMin+xi*dx;
        var r2=(xp-px0)*(xp-px0);
        var h=H0_cm2*Math.exp(-2*r2/(w*w));
        pf[xi]=h;cumFlu[xi]+=h;
      }
      pulseFlu.push(pf);
    }

    // Find y-axis max
    var yMax=0;for(var yi=0;yi<nPts;yi++){if(cumFlu[yi]>yMax)yMax=cumFlu[yi];}
    if(yMax<=0)yMax=1;
    yMax*=1.15; // headroom

    // MPE line
    var mpeVal=skinMPE(wl,res.st.tt);

    ctx.clearRect(0,0,W,H);ctx.fillStyle=T.bgI;ctx.fillRect(0,0,W,H);
    ctx.fillStyle=T.card;ctx.fillRect(ML,MT,PW2,PH2);
    ctx.strokeStyle=T.bd;ctx.lineWidth=1;ctx.strokeRect(ML,MT,PW2,PH2);

    // Draw individual pulse profiles (light)
    ctx.save();ctx.beginPath();ctx.rect(ML,MT,PW2,PH2);ctx.clip();
    for(var pi3=0;pi3<pulseFlu.length;pi3++){
      ctx.beginPath();
      for(var xi2=0;xi2<nPts;xi2++){
        var px2=ML+xi2/nPts*PW2,py2=MT+PH2-pulseFlu[pi3][xi2]/yMax*PH2;
        if(xi2===0)ctx.moveTo(px2,py2);else ctx.lineTo(px2,py2);
      }
      ctx.strokeStyle=T.ac;ctx.globalAlpha=0.15;ctx.lineWidth=0.6;ctx.stroke();
    }
    // Draw cumulative envelope (bold)
    ctx.beginPath();
    for(var xi3=0;xi3<nPts;xi3++){
      var px3=ML+xi3/nPts*PW2,py3=MT+PH2-cumFlu[xi3]/yMax*PH2;
      if(xi3===0)ctx.moveTo(px3,py3);else ctx.lineTo(px3,py3);
    }
    ctx.strokeStyle=T.ac;ctx.globalAlpha=1;ctx.lineWidth=2.5;ctx.stroke();
    // Fill under cumulative
    ctx.lineTo(ML+PW2,MT+PH2);ctx.lineTo(ML,MT+PH2);ctx.closePath();
    ctx.fillStyle=T.ac;ctx.globalAlpha=0.1;ctx.fill();
    ctx.globalAlpha=1;

    // MPE reference line
    if(isFinite(mpeVal)&&mpeVal>0&&mpeVal<yMax){
      var mpeY=MT+PH2-mpeVal/yMax*PH2;
      ctx.strokeStyle="#d32f2f";ctx.lineWidth=1.5;ctx.setLineDash([6,4]);
      ctx.beginPath();ctx.moveTo(ML,mpeY);ctx.lineTo(ML+PW2,mpeY);ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle="#d32f2f";ctx.font="bold 9px monospace";ctx.textAlign="left";
      ctx.fillText("MPE(T) = "+numFmt(mpeVal,3)+" J/cm\u00b2",ML+4,mpeY-4);
    }
    ctx.restore();

    // X axis
    ctx.fillStyle=T.td;ctx.font="9px monospace";ctx.textAlign="center";
    for(var ti2=0;ti2<=5;ti2++){
      var xv=xMin+ti2/5*xR;ctx.fillText(xv.toFixed(2)+" mm",ML+ti2/5*PW2,MT+PH2+14);
      ctx.strokeStyle=T.bd;ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(ML+ti2/5*PW2,MT+PH2);ctx.lineTo(ML+ti2/5*PW2,MT+PH2+4);ctx.stroke();
    }
    ctx.fillText("Position along scan line (mm)",ML+PW2/2,MT+PH2+30);

    // Y axis
    ctx.textAlign="right";
    var nYT=5;for(var ti3=0;ti3<=nYT;ti3++){
      var yv=ti3/nYT*yMax,yy=MT+PH2-ti3/nYT*PH2;
      ctx.fillStyle=T.td;ctx.fillText(numFmt(yv,3),ML-6,yy+3);
      if(ti3>0){ctx.strokeStyle=T.bd;ctx.lineWidth=0.3;ctx.beginPath();ctx.moveTo(ML,yy);ctx.lineTo(ML+PW2,yy);ctx.stroke();}
    }
    ctx.save();ctx.translate(12,MT+PH2/2);ctx.rotate(-Math.PI/2);ctx.textAlign="center";
    ctx.fillStyle=T.td;ctx.fillText("Fluence, H (J/cm\u00b2)",0,0);ctx.restore();

    // Legend
    ctx.fillStyle=T.td;ctx.font="9px monospace";ctx.textAlign="left";
    ctx.strokeStyle=T.ac;ctx.globalAlpha=0.3;ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(ML+10,MT+12);ctx.lineTo(ML+30,MT+12);ctx.stroke();
    ctx.globalAlpha=1;ctx.fillText("Individual pulses",ML+34,MT+15);
    ctx.strokeStyle=T.ac;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(ML+10,MT+26);ctx.lineTo(ML+30,MT+26);ctx.stroke();
    ctx.fillText("Cumulative ("+firstLinePulses.length+" pulses)",ML+34,MT+29);
    if(isFinite(mpeVal)&&mpeVal>0){
      ctx.strokeStyle="#d32f2f";ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(ML+10,MT+40);ctx.lineTo(ML+30,MT+40);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle="#d32f2f";ctx.fillText("MPE(T="+ft(res.st.tt)+")",ML+34,MT+43);
    }
  },[res,vizTab,T,dia,wl,pw,prf]);

  return (<div style={{display:"flex",flexDirection:"column",gap:14}}>
    {/* ── Inputs: full width, 3-column ── */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14}}>
        <div style={secH}>Beam Parameters</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div><label style={lb}>Wavelength (nm)</label><input type="text" value={wlS} onChange={function(e){upN(setWlS,setWl,e.target.value)}} style={ip}/></div>
          <div><label style={lb}>Beam 1/e Diameter (mm)</label><input type="text" value={dS} onChange={function(e){upN(setDS,setDia,e.target.value)}} style={ip}/></div>
          <div><label style={lb}>Pulse Duration</label><div style={{display:"flex",gap:4}}><input type="text" value={tauS} onChange={function(e){upTau(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><select value={tauU} onChange={function(e){setTauU(e.target.value);upTau(tauS)}} style={{fontSize:11,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{DUR_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div></div>
          <div><label style={lb}>Repetition Rate</label><div style={{display:"flex",gap:4}}><input type="text" value={prfS} onChange={function(e){upPrf(e.target.value)}} style={{flex:1,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><select value={prfU} onChange={function(e){setPrfU(e.target.value);upPrf(prfS)}} style={{fontSize:11,padding:"4px 6px",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,cursor:"pointer"}}>{FREQ_UNITS.map(function(u){return <option key={u.id} value={u.id}>{u.label}</option>;})}</select></div></div>
          <div><label style={lb}>Average Power (W)</label><input type="text" value={pwS} onChange={function(e){upN(setPwS,setPw,e.target.value)}} style={ip}/></div>
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
            <div><label style={lb}>Scan Velocity (mm/s)</label><input type="text" value={vS} onChange={function(e){upN(setVS,setVel,e.target.value)}} style={ip}/></div>
            <div><label style={lb}>Line Length (mm)</label><input type="text" value={lLS} onChange={function(e){upN(setLLS,setLineL,e.target.value)}} style={ip}/></div>
          </div>
          {pat!=="linear"?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><label style={lb}>Number of Lines</label><input type="text" value={nLS} onChange={function(e){upN(setNLS,setNLines,e.target.value)}} style={ip}/></div>
            <div><label style={lb}>Hatch Spacing (mm)</label><input type="text" value={htS} onChange={function(e){upN(setHtS,setHatch,e.target.value)}} style={ip}/></div>
          </div>:null}
        </div>
      </div>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:14,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
        <div>
          <div style={secH}>Settings</div>
          <div style={{marginBottom:10}}>
            <label style={lb}>Grid Resolution (pts/diameter)</label>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="range" min={4} max={32} value={ppd} onChange={function(e){setPpd(Number(e.target.value));setDirty(true)}} style={{flex:1}}/>
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

      {vizTab==="fluence"?<div>
        <div style={{fontSize:9,color:T.td,marginBottom:4}}>Total radiant exposure (J/cm{"\u00b2"}) accumulated at each skin surface point from all pulses across the entire scan.</div>
        {res?<div>
          <canvas ref={canRef} width={CW} height={CH} onMouseMove={onCanvasMove} onMouseLeave={function(){setHover(null)}} style={{borderRadius:6,border:"1px solid "+T.bd,width:"100%",height:"auto",cursor:"crosshair"}}/>
          {hover?<div style={{fontSize:9,fontFamily:"monospace",color:T.tm,marginTop:4,display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
            <span>x: {hover.x.toFixed(2)} mm</span>
            <span>y: {hover.y.toFixed(2)} mm</span>
            <span style={{fontWeight:700,color:T.ac}}>Fluence: {numFmt(hover.f,4)} J/cm{"\u00b2"}</span>
            <span>Pulses: {hover.pc}</span>
            <span>Peak pulse: {numFmt(hover.pp,4)} J/cm{"\u00b2"}</span>
            {hover.rv<1e29?<span>Revisit: {numFmt(hover.rv,3)} s</span>:null}
          </div>:<div style={{fontSize:9,color:T.td,marginTop:4,textAlign:"center"}}>Hover over the map to query fluence at any point</div>}
        </div>:<div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12}}>Click Calculate to generate fluence map</div>}
      </div>:null}

      {vizTab==="timing"?<div>
        <div style={{fontSize:9,color:T.td,marginBottom:4}}>Each Gaussian peak represents one laser pulse. Scroll to zoom, drag to pan. The minimap strip shows the full time range with your current view highlighted.</div>
        {res&&res.pulses&&res.pulses.length>0?
          <canvas ref={timRef} width={900} height={280} onWheel={onTimWheel} onMouseDown={onTimDown} onMouseMove={onTimMove} onMouseUp={onTimUp} onMouseLeave={onTimUp} style={{borderRadius:6,border:"1px solid "+T.bd,width:"100%",height:"auto",cursor:dragStart?"grabbing":"grab"}}/>
          :<div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12}}>{res?"CW mode \u2014 no discrete pulses":"Click Calculate to generate timing diagram"}</div>}
      </div>:null}

      {vizTab==="spatial"?<div>
        <div style={{fontSize:9,color:T.td,marginBottom:4}}>1D cross-section showing individual pulse Gaussian profiles (light lines) and cumulative fluence envelope (bold line) along the first scan line. The dashed red line shows the MPE limit for comparison.</div>
        {res&&res.pulses&&res.pulses.length>0?
          <canvas ref={spcRef} width={900} height={360} style={{borderRadius:6,border:"1px solid "+T.bd,width:"100%",height:"auto"}}/>
          :<div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",background:T.bgI,borderRadius:6,color:T.td,fontSize:12}}>{res?"CW mode \u2014 no discrete pulses":"Click Calculate to generate spatial profile"}</div>}
      </div>:null}
    </div>

    {/* ── Safety Results ── */}
    {res?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
      <div style={{background:res.sf.safe?"#e8f5e9":"#fbe9e7",borderRadius:6,padding:14,textAlign:"center"}}>
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
          ["Total segments",String(res.segs.length)],
          ["Total scan time",numFmt(res.st.tt,4)+" s"],
          ["Dwell time ("+dwm+")",numFmt(dwm==="gaussian"?scanDwellGaussian(dia,vel):scanDwellGeometric(dia,vel),4)+" s"],
          ["Grid",res.g.nx+"\u00d7"+res.g.ny+" ("+ppd+" pts/dia)"],
          ["Peak fluence",numFmt(res.sf.pF,4)+" J/cm\u00b2"],
          ["Max pulses at point",String(res.sf.mP)],
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
  </div>);
}

/* ═══════ APP (TAB ROUTER) ═══════ */
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
      <div style={{borderBottom:"1px solid "+T.bd,padding:"0 24px",background:T.card,display:"flex",gap:4}}>
        <button onClick={function(){setTab("mpe")}} style={tabBt("mpe")}>MPE Calculator</button>
        <button onClick={function(){setTab("scan")}} style={tabBt("scan")}>Scanning Protocols</button>
        <button onClick={function(){setTab("pa")}} style={tabBt("pa")}>Photoacoustic SNR Optimizer</button>
      </div>
      <div style={{padding:"16px 24px 40px",maxWidth:1100,margin:"0 auto"}}>
        {tab==="mpe"?<MPETab T={T} theme={theme} msg={msg} setMsg={setMsg}/>:null}
        {tab==="scan"?<ScanTab T={T} theme={theme} msg={msg} setMsg={setMsg}/>:null}
        {tab==="pa"?<PATab T={T} theme={theme} msg={msg} setMsg={setMsg}/>:null}
        <div style={{textAlign:"center",fontSize:10,color:T.td,padding:"12px 0 4px",lineHeight:1.7,borderTop:"1px solid "+T.bd,marginTop:16}}>{STD_NAME} {"\u00b7"} {STD_REF} {"\u00b7"} {STD_TABLES}<br/>For research and educational purposes only. Not a certified safety instrument. Skin MPE only {"\u2014"} ocular limits are not evaluated.<br/>Verify all values independently against the applicable standard before any safety-critical use.</div>
      </div>
    </div>
  );
}
