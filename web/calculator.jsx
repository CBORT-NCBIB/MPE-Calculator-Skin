import { useState, useMemo, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot, ResponsiveContainer, ReferenceLine, Legend } from "recharts";

/* ═══════ ENGINE ═══════ */
function CA(wl){var w=wl/1000;return w<0.7?1:w<1.05?Math.pow(10,2*(w-0.7)):w<=1.4?5:1;}
function uvTh(t){return(t<1e-9||t>=10)?NaN:0.56*Math.pow(t,0.25);}
function uvPc(wl,t){var w=wl/1000;if(w>=0.18&&w<0.302)return(t<1e-9||t>=3e4)?NaN:3e-3;if(w>=0.302&&w<0.315){if(t<1e-9||t>=3e4)return NaN;var s=[[303,4e-3],[304,6e-3],[305,1e-2],[306,1.6e-2],[307,2.5e-2],[308,4e-2],[309,6.3e-2],[310,1e-1],[311,1.6e-1],[312,2.5e-1],[313,4e-1]];for(var i=0;i<s.length;i++){if(wl<s[i][0])return s[i][1];}return 6.3e-1;}if(w>=0.315&&w<0.4)return t<10?Infinity:t>=3e4?NaN:1.0;return NaN;}
function uvS(wl,t){var a=uvTh(t),b=uvPc(wl,t),fa=isFinite(a),fb=isFinite(b);if(fa&&fb)return Math.min(a,b);return fa?a:fb?b:NaN;}
function visS(wl,t){var c=CA(wl);if(t<1e-9||t>=3e4)return NaN;if(t<1e-7)return .02*c;if(t<10)return 1.1*c*Math.pow(t,.25);return .2*c*t;}
function f14(t){if(t<1e-9||t>=3e4)return NaN;if(t<1e-3)return .1;if(t<10)return .56*Math.pow(t,.25);return .1*t;}
function f15(t){if(t<1e-9||t>=3e4)return NaN;return t<10?1:.1*t;}
function f18(t){if(t<1e-9||t>=3e4)return NaN;if(t<1e-3)return .1;if(t<10)return .56*Math.pow(t,.25);return .1*t;}
function f26(t){if(t<1e-9||t>=3e4)return NaN;if(t<1e-7)return .01;if(t<10)return .56*Math.pow(t,.25);return .1*t;}
function skinMPE(wl,t){var w=wl/1000;if(w>=.18&&w<.4)return uvS(wl,t);if(w>=.4&&w<1.4)return visS(wl,t);if(w>=1.4&&w<1.5)return f14(t);if(w>=1.5&&w<1.8)return f15(t);if(w>=1.8&&w<2.6)return f18(t);if(w>=2.6&&w<=1e6)return f26(t);return NaN;}
function rpCalc(wl,tau,prf,T){var r1=skinMPE(wl,tau),ht=skinMPE(wl,T),N=prf*T;if(N<=1)return{r1:r1,r2:r1,H:r1,N:N,bd:"Rule 1"};var r2=ht/N;return{r1:r1,r2:r2,H:Math.min(r1,r2),N:N,bd:r1<=r2?"Rule 1":"Rule 2"};}
function bnd(w){return w<400?"Ultraviolet":w<700?"Visible":w<1400?"Near-IR":"Far-IR";}
function si(v,u){if(!isFinite(v))return"\u2014";var a=Math.abs(v);if(a===0)return"0 "+u;if(a>=1e6)return(v/1e6).toPrecision(4)+" M"+u;if(a>=1e3)return(v/1e3).toPrecision(4)+" k"+u;if(a>=.1)return v.toPrecision(4)+" "+u;if(a>=1e-3)return(v*1e3).toPrecision(4)+" m"+u;if(a>=1e-6)return(v*1e6).toPrecision(4)+" \u00b5"+u;if(a>=1e-9)return(v*1e9).toPrecision(4)+" n"+u;return v.toExponential(3)+" "+u;}
function ft(t){if(t<1e-9)return(t*1e12).toPrecision(3)+" ps";if(t<1e-6)return(t*1e9).toPrecision(3)+" ns";if(t<1e-3)return(t*1e6).toPrecision(3)+" \u00b5s";if(t<1)return(t*1e3).toPrecision(3)+" ms";return t.toPrecision(3)+" s";}

/* PA engine */
function paEffFluence(wl,tau,f,T){var r1=skinMPE(wl,tau),hT=skinMPE(wl,T);if(!isFinite(r1)||!isFinite(hT))return NaN;var N=f*T;if(N<1)N=1;return Math.min(r1,hT/N);}
function paRelSNR(wl,tau,f,T){var ps=skinMPE(wl,tau);if(!isFinite(ps)||ps<=0)return NaN;var pe=paEffFluence(wl,tau,f,T);if(!isFinite(pe)||pe<=0)return NaN;var N=f*T;if(N<1)N=1;return(pe*Math.sqrt(N))/ps;}
function paOptPRF(wl,tau,T){var hs=skinMPE(wl,tau),hT=skinMPE(wl,T);if(!isFinite(hs)||!isFinite(hT)||hs<=0||T<=0)return NaN;return hT/(hs*T);}

var WC=["#0072B2","#E69F00","#009E73","#CC79A7","#56B4E9","#D55E00","#F0E442","#000000"];
var DTICKS=[1e-9,1e-7,1e-5,1e-3,.1,10,1000];
var WLTICKS=[200,400,700,1000,1400,2000,3000];
function dtf(v){if(v>=1e3)return(v/1e3)+"ks";if(v>=1)return v+"s";if(v>=1e-3)return(v*1e3)+"ms";if(v>=1e-6)return(v*1e6)+"\u00b5s";return(v*1e9)+"ns";}

var TH={
  light:{bg:"#fafafa",card:"#ffffff",bgI:"#f5f5f5",bd:"#d4d4d4",bl:"#a3a3a3",tx:"#171717",tm:"#525252",td:"#737373",ac:"#0072B2",a2:"#E69F00",ok:"#0072B2",no:"#D55E00",gr:"#f0f0f0",tp:"#ffffff"},
  dark:{bg:"#18181b",card:"#27272a",bgI:"#1f1f23",bd:"#3f3f46",bl:"#52525b",tx:"#e4e4e7",tm:"#a1a1aa",td:"#71717a",ac:"#56B4E9",a2:"#E69F00",ok:"#56B4E9",no:"#E69F00",gr:"#27272a",tp:"#27272a"}
};
var BANDS=[{n:"UV",s:180,e:400},{n:"Visible",s:400,e:700},{n:"Near-IR",s:700,e:1400},{n:"Far-IR",s:1400,e:3000}];

var uid=1;
function mkL(wl){return{id:uid++,wl:wl,wlStr:String(wl),ds:"1e-8",dur:1e-8,rp:false,prf:10,prfStr:"10",tT:1,tTStr:"1",show:true};}
function pDur(s){var v=parseFloat(s);return(isFinite(v)&&v>0)?v:null;}
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
  var wRef=useRef(null),dRef=useRef(null);
  var lb={display:"block",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:4};
  var ipFull={width:"100%",padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};
  var thS={padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"};
  var tdSt={padding:"7px 10px",fontSize:12,fontFamily:"monospace"};

  function calc(){setCv(cv+1);setDirty(false);}
  useEffect(function(){calc();},[]);
  function upL(id,k,v){setLasers(lasers.map(function(L){if(L.id!==id)return L;var n={id:L.id,wl:L.wl,wlStr:L.wlStr,ds:L.ds,dur:L.dur,rp:L.rp,prf:L.prf,prfStr:L.prfStr,tT:L.tT,tTStr:L.tTStr,show:L.show};n[k]=v;if(k==="wlStr"){var wv=Number(v);if(isFinite(wv)&&wv>=180&&wv<=1e6)n.wl=wv;}if(k==="ds"){var d=pDur(v);if(d)n.dur=d;}if(k==="prfStr"){n.prfStr=v;var pp=Number(v);if(isFinite(pp)&&pp>0)n.prf=pp;}if(k==="tTStr"){n.tTStr=v;var tt=Number(v);if(isFinite(tt)&&tt>0)n.tT=tt;}return n;}));setDirty(true);}
  function addL(){var v=parseInt(nw,10);if(!isNaN(v)&&v>=180&&v<=1e6){setLasers(lasers.concat([mkL(v)]));setNw("");setDirty(true);}}
  function rmL(id){if(lasers.length<=1)return;setLasers(lasers.filter(function(L){return L.id!==id}));setDirty(true);}
  function toggleShow(id){setLasers(lasers.map(function(L){if(L.id!==id)return L;var n={id:L.id,wl:L.wl,wlStr:L.wlStr,ds:L.ds,dur:L.dur,rp:L.rp,prf:L.prf,prfStr:L.prfStr,tT:L.tT,tTStr:L.tTStr,show:!L.show};return n;}));}
  var results=useMemo(function(){return lasers.map(computeR);},[cv,lasers]);
  var plotLasers=lasers.filter(function(L){return L.show});
  var flv=fl?parseFloat(fl):null;var rat=(flv!==null&&results[0]&&isFinite(results[0].effH))?flv/results[0].effH:null;var safe=rat!==null?rat<=1:null;
  var wld=useMemo(function(){var durs=[];plotLasers.forEach(function(L){if(durs.indexOf(L.dur)===-1)durs.push(L.dur);});var sp=[[180,400,3],[400,700,4],[700,1400,8],[1400,3000,15]];var pp=[];for(var si2=0;si2<sp.length;si2++)for(var w=sp[si2][0];w<=sp[si2][1];w+=sp[si2][2]){var row={wl:w},any=false;for(var di=0;di<durs.length;di++){var h=skinMPE(w,durs[di]);if(isFinite(h)&&h>0){row["d"+di]=h*1e3;any=true;}}if(any)pp.push(row);}return{d:pp,durs:durs};},[cv,plotLasers]);
  var drd=useMemo(function(){var ws=[];plotLasers.forEach(function(L){if(ws.indexOf(L.wl)===-1)ws.push(L.wl);});var a=[];for(var e=-9;e<=4.5;e+=.05){var t=Math.pow(10,e),r={t:t},any=false;for(var j=0;j<ws.length;j++){var h=skinMPE(ws[j],t);if(isFinite(h)&&h>0){r["w"+ws[j]]=h*1e3;any=true;}}if(any)a.push(r);}return{d:a,ws:ws};},[cv,plotLasers]);

  function doExport(){try{var ths2="background:#f1f5f9;padding:8px 12px;text-align:left;border-bottom:2px solid #d4d4d4;font-size:11px";var tds2="padding:6px 12px;border-bottom:1px solid #e5e5e5;font-size:13px";var rows="";for(var i=0;i<results.length;i++){var r=results[i],L=lasers[i];rows+='<tr><td style="'+tds2+'">'+r.wl+'</td><td style="'+tds2+'">'+ft(r.dur)+'</td><td style="'+tds2+'">'+r.band+'</td><td style="'+tds2+'">'+(r.wl>=400&&r.wl<1400?r.ca.toFixed(3):"\u2014")+'</td><td style="'+tds2+';font-weight:700">'+si(r.effH,"J/cm\u00b2")+'</td><td style="'+tds2+'">'+si(r.irr,"W/cm\u00b2")+'</td><td style="'+tds2+'">'+(L.rp?L.prf+" Hz":"\u2014")+'</td><td style="'+tds2+'">'+(r.rp?Math.round(r.rp.N):"\u2014")+'</td><td style="'+tds2+'">'+r.rule+'</td></tr>';}var html='<!DOCTYPE html><html><head><title>MPE Report</title><style>body{font-family:Helvetica,sans-serif;max-width:960px;margin:40px auto;color:#171717;line-height:1.5;padding:0 20px}table{border-collapse:collapse;width:100%;margin:16px 0}th{'+ths2+'}h1{font-size:22px}h2{font-size:14px;color:#525252;margin:24px 0 8px}</style></head><body><h1>Laser Skin MPE Report</h1><p style="color:#737373;font-size:12px">ICNIRP 2013 \u2014 '+new Date().toLocaleString()+'</p><h2>Results</h2><table><thead><tr><th style="'+ths2+'">Wavelength (nm)</th><th style="'+ths2+'">Duration</th><th style="'+ths2+'">Band</th><th style="'+ths2+'">C_A</th><th style="'+ths2+'">Per-Pulse MPE</th><th style="'+ths2+'">Irradiance</th><th style="'+ths2+'">Repetition Rate (Hz)</th><th style="'+ths2+'">Number of Pulses</th><th style="'+ths2+'">Rule</th></tr></thead><tbody>'+rows+'</tbody></table><p style="margin-top:32px;font-size:11px;color:#a3a3a3;border-top:1px solid #e5e5e5;padding-top:12px">ICNIRP 2013 \u2014 For research and educational purposes.</p></body></html>';var u="data:text/html;charset=utf-8,"+encodeURIComponent(html);var a=document.createElement("a");a.href=u;a.download="mpe-report.html";a.style.display="none";var root=document.getElementById("root");root.appendChild(a);a.click();root.removeChild(a);setMsg("Report downloaded!");setTimeout(function(){setMsg("")},2e3);}catch(e){setMsg("Export failed");}}

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {lasers.map(function(L,idx){var r=results[idx];var col=WC[idx%WC.length];return (
        <div key={L.id} style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 14px",borderBottom:"1px solid "+T.bd,background:T.bg}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:10,height:10,borderRadius:5,background:col,flexShrink:0}}/><span style={{fontSize:14,fontWeight:700}}>{L.wl} nm</span><span style={{fontSize:11,color:T.td}}>{r.band}</span>{r.wl>=400&&r.wl<1400?<span style={{fontSize:10,color:T.td,fontFamily:"monospace"}}>C_A = {r.ca.toFixed(3)}</span>:null}</div>
            {lasers.length>1?<button onClick={function(){rmL(L.id)}} style={{background:"none",border:"none",color:T.td,cursor:"pointer",fontSize:15}}>{"\u00d7"}</button>:null}
          </div>
          <div style={{padding:"12px 14px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div><label style={lb}>Wavelength (nm)</label><input type="text" value={L.wlStr} onChange={function(e){upL(L.id,"wlStr",e.target.value)}} style={ipFull}/><div style={{fontSize:9,color:T.td,marginTop:3,fontFamily:"monospace"}}>{L.wl<400?"UV 180\u2013400 nm":L.wl<700?"Visible 400\u2013700 nm":L.wl<1400?"Near-IR 700\u20131400 nm":"Far-IR 1400+ nm"}</div></div>
              <div><label style={lb}>Pulse Duration (s)</label><input type="text" value={L.ds} onChange={function(e){upL(L.id,"ds",e.target.value)}} placeholder="e.g. 1e-8" style={ipFull}/><div style={{fontSize:9,color:T.td,marginTop:3,fontFamily:"monospace"}}>= {ft(L.dur)}</div></div>
            </div>
            <div style={{marginTop:10,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:T.tm}} onClick={function(){upL(L.id,"rp",!L.rp)}}><div style={{width:34,height:18,borderRadius:9,background:L.rp?T.a2:"#a3a3a3",position:"relative",flexShrink:0,transition:"background 0.15s"}}><div style={{width:14,height:14,borderRadius:7,background:"#fff",position:"absolute",top:2,left:L.rp?18:2,transition:"left 0.15s",boxShadow:"0 1px 2px rgba(0,0,0,0.15)"}}/></div>Repetitive Pulse</label>
              {L.rp?<div style={{display:"flex",gap:10,alignItems:"end"}}><div><label style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Repetition Rate (Hz)</label><input type="text" value={L.prfStr} onChange={function(e){upL(L.id,"prfStr",e.target.value)}} style={{width:90,padding:"4px 8px",fontSize:12,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/></div><div><label style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Exposure Time (s)</label><input type="text" value={L.tTStr} onChange={function(e){upL(L.id,"tTStr",e.target.value)}} style={{width:90,padding:"4px 8px",fontSize:12,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/></div></div>:null}
            </div>
            {r?<div style={{marginTop:12,paddingTop:10,borderTop:"1px solid "+T.bd}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                <div><div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Per-Pulse MPE</div><div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:T.ac}}>{si(r.effH,"J/cm\u00b2")}</div><div style={{fontSize:9,color:T.a2,marginTop:1}}>ICNIRP table value</div>{isFinite(r.effH)?<div style={{fontSize:10,color:T.td,fontFamily:"monospace",marginTop:3}}>{"\u2261"} {si(r.effH*1e4,"J/m\u00b2")} <span style={{fontSize:8}}>(converted)</span></div>:null}</div>
                <div><div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Irradiance</div><div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:T.tm}}>{si(r.irr,"W/cm\u00b2")}</div><div style={{fontSize:9,color:T.td,marginTop:1}}>E = H / t (converted)</div></div>
                <div><div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td,marginBottom:3}}>Rule</div><div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:T.tm}}>{r.rule}</div><div style={{fontSize:9,color:T.td,marginTop:1}}>{L.rp?Math.round(r.rp.N)+" pulses":"Single pulse"}</div></div>
              </div>
              {L.dur<1e-9?<div style={{marginTop:8,fontSize:11,color:T.no,fontWeight:600}}>Duration below 1 ns {"\u2014"} ICNIRP 2013 does not define skin MPE for this regime (p. 287)</div>:null}
              {r.rp?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}><div style={{padding:"8px 12px",borderRadius:4,opacity:r.rp.bd==="Rule 1"?1:0.35,background:r.rp.bd==="Rule 1"?T.ac+"12":"transparent",border:"1px solid "+(r.rp.bd==="Rule 1"?T.ac:T.bd)}}><div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Rule 1 {"\u2014"} Single Pulse Limit</div><div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:r.rp.bd==="Rule 1"?T.ac:T.td,marginTop:2}}>{si(r.rp.r1,"J/cm\u00b2")}</div></div><div style={{padding:"8px 12px",borderRadius:4,opacity:r.rp.bd==="Rule 2"?1:0.35,background:r.rp.bd==="Rule 2"?T.ac+"12":"transparent",border:"1px solid "+(r.rp.bd==="Rule 2"?T.ac:T.bd)}}><div style={{fontSize:9,fontWeight:600,textTransform:"uppercase",color:T.td}}>Rule 2 {"\u2014"} Average (H_T / N)</div><div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:r.rp.bd==="Rule 2"?T.ac:T.td,marginTop:2}}>{si(r.rp.r2,"J/cm\u00b2")}</div></div></div>:null}
            </div>:null}
          </div>
        </div>
      );})}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}><input type="number" placeholder="Wavelength (nm)" value={nw} onChange={function(e){setNw(e.target.value)}} onKeyDown={function(e){if(e.key==="Enter"){e.preventDefault();addL();}}} style={{width:160,padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/><button onClick={addL} style={mkBt(true,T.a2,T)}>+ Add Wavelength</button></div>
        <div style={{display:"flex",alignItems:"center",gap:10}}><button onClick={calc} style={{padding:"8px 24px",fontSize:13,fontWeight:700,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:5,cursor:"pointer"}}>{dirty?"Calculate":"Calculated \u2713"}</button>{dirty?<span style={{fontSize:11,color:T.ac,fontWeight:500}}>Click to update</span>:null}</div>
      </div>
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <label style={{fontSize:10,fontWeight:600,textTransform:"uppercase",color:T.td,whiteSpace:"nowrap"}}>Safety Check (J/cm{"\u00b2"})</label>
        <input type="number" placeholder="Your fluence" value={fl} step="any" onChange={function(e){setFl(e.target.value);setDirty(true);}} style={{width:180,padding:"5px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none"}}/>
        {rat!==null?<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:14,fontWeight:700}}>{safe?"\u2713":"!"}</span><span style={{fontSize:12,fontWeight:600,color:safe?T.ok:T.no}}>{safe?"Below MPE":"Exceeds MPE"}</span><span style={{fontSize:11,fontFamily:"monospace",color:T.tm}}>{rat.toPrecision(3)}{"\u00d7"}</span></div>:null}
      </div>
      {/* Summary table */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"14px",opacity:dirty?0.6:1,transition:"opacity 0.2s"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td}}>Summary{dirty?" (stale)":""}</div><button onClick={doExport} style={mkBt(false,T.ac,T)}>Export Report</button></div>
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th style={thS}>{"\u03bb"} (nm)</th><th style={thS}>Duration</th><th style={thS}>Band</th><th style={thS}>C_A</th><th style={thS}>Per-Pulse MPE</th><th style={thS}>Irradiance</th><th style={thS}>Repetition Rate (Hz)</th><th style={thS}>Number of Pulses</th><th style={thS}>Rule</th></tr></thead><tbody>{results.map(function(r,i){var L=lasers[i];return (<tr key={L.id} style={{borderBottom:"1px solid "+T.bd}}><td style={{padding:"7px 10px",color:WC[i%WC.length],fontWeight:700,fontSize:12,fontFamily:"monospace"}}>{r.wl}</td><td style={tdSt}>{ft(r.dur)}</td><td style={{padding:"7px 10px",fontSize:12,color:T.tm}}>{r.band}</td><td style={tdSt}>{r.wl>=400&&r.wl<1400?r.ca.toFixed(3):"\u2014"}</td><td style={{padding:"7px 10px",fontSize:12,fontFamily:"monospace",fontWeight:700}}>{si(r.effH,"J/cm\u00b2")}</td><td style={tdSt}>{si(r.irr,"W/cm\u00b2")}</td><td style={tdSt}>{L.rp?L.prf:"\u2014"}</td><td style={tdSt}>{r.rp?Math.round(r.rp.N):"\u2014"}</td><td style={tdSt}>{r.rule}</td></tr>);})}</tbody></table></div>
      </div>
      {/* Charts */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:6}}>Per-Pulse MPE Plot</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{lasers.map(function(L,i){var col=WC[i%WC.length];return (<label key={L.id} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:11,fontFamily:"monospace",color:L.show?col:T.td,opacity:L.show?1:0.4}}><input type="checkbox" checked={L.show} onChange={function(){toggleShow(L.id)}} style={{accentColor:col,width:13,height:13}}/>{L.wl} nm</label>);})}</div></div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}><div style={{display:"flex"}}><button onClick={function(){setCht("wl")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(cht==="wl"?T.ac:T.bd),cursor:"pointer",background:cht==="wl"?T.ac:"transparent",color:cht==="wl"?"#fff":T.tm,borderRadius:"4px 0 0 4px"}}>MPE vs. Wavelength</button><button onClick={function(){setCht("t")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(cht==="t"?T.ac:T.bd),cursor:"pointer",background:cht==="t"?T.ac:"transparent",color:cht==="t"?"#fff":T.tm,borderRadius:"0 4px 4px 0"}}>MPE vs. Duration</button></div><button onClick={function(){dlSVG(cht==="wl"?wRef:dRef,cht==="wl"?"mpe_vs_wavelength.svg":"mpe_vs_duration.svg",setMsg)}} style={mkBt(false,T.ac,T)}>{"\u2913"} Download SVG</button><button onClick={function(){if(cht==="wl"){var hdr=["wavelength_nm"];for(var di=0;di<wld.durs.length;di++)hdr.push("mpe_mJ_cm2_t"+ft(wld.durs[di]).replace(/ /g,""));var nd=wld.d.map(function(row){var o={wavelength_nm:row.wl};for(var di2=0;di2<wld.durs.length;di2++){o[hdr[di2+1]]=row["d"+di2];}return o;});dlCSV(nd,hdr,"mpe_vs_wavelength.csv",setMsg);}else{var hdr2=["duration_s"];drd.ws.forEach(function(w){hdr2.push("mpe_mJ_cm2_"+w+"nm");});var nd2=drd.d.map(function(row){var o2={duration_s:row.t};drd.ws.forEach(function(w){o2["mpe_mJ_cm2_"+w+"nm"]=row["w"+w];});return o2;});dlCSV(nd2,hdr2,"mpe_vs_duration.csv",setMsg);}}} style={mkBt(false,T.a2,T)}>{"\u2913"} Download CSV</button></div>
        </div>
        {cht==="wl"?(<div ref={wRef}><div style={{fontSize:11,color:T.tm,marginBottom:4}}>Per-Pulse Skin MPE (mJ/cm{"\u00b2"}) vs. Wavelength{wld.durs.length===1?" \u2014 t = "+ft(wld.durs[0]):""}</div><ResponsiveContainer width="100%" height={320}><LineChart data={wld.d} margin={{top:8,right:16,bottom:4,left:8}}><CartesianGrid strokeDasharray="3 3" stroke={T.gr}/><XAxis dataKey="wl" type="number" domain={[180,3000]} ticks={WLTICKS} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd}/><YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} width={55}/><Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:12,fontFamily:"monospace",color:T.tx}} labelFormatter={function(v){return v+" nm"}} formatter={function(v,n){var idx2=parseInt(String(n).replace("d",""),10);var label=wld.durs[idx2]!==undefined?"t="+ft(wld.durs[idx2]):"MPE";return [Number(v).toPrecision(4)+" mJ/cm\u00b2",label]}}/>{wld.durs.map(function(d,di){var ci=0;for(var j=0;j<plotLasers.length;j++){if(plotLasers[j].dur===d){ci=lasers.indexOf(plotLasers[j]);break;}}return <Line key={"wlc"+di} dataKey={"d"+di} stroke={WC[ci%WC.length]} strokeWidth={2} dot={false} name={"t="+ft(d)} connectNulls={true} isAnimationActive={false}/>;})}{wld.durs.length>1?<Legend wrapperStyle={{fontSize:11,fontFamily:"monospace"}}/>:null}<ReferenceLine x={400} stroke={T.bl} strokeDasharray="4 4"/><ReferenceLine x={700} stroke={T.bl} strokeDasharray="4 4"/><ReferenceLine x={1400} stroke={T.bl} strokeDasharray="4 4"/>{plotLasers.map(function(L){var i=lasers.indexOf(L);var h=skinMPE(L.wl,L.dur);if(!isFinite(h)||h<=0)return null;return <ReferenceDot key={"wd"+L.id} x={L.wl} y={h*1e3} r={5} fill={WC[i%WC.length]} stroke={T.bg} strokeWidth={2}/>;})}</LineChart></ResponsiveContainer></div>):(<div ref={dRef}><div style={{fontSize:11,color:T.tm,marginBottom:4}}>Per-Pulse Skin MPE (mJ/cm{"\u00b2"}) vs. Duration</div><ResponsiveContainer width="100%" height={320}><LineChart data={drd.d} margin={{top:8,right:16,bottom:4,left:8}}><CartesianGrid strokeDasharray="3 3" stroke={T.gr}/><XAxis dataKey="t" type="number" scale="log" domain={[1e-9,3e4]} ticks={DTICKS} tickFormatter={dtf} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd}/><YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} width={55}/><Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:12,fontFamily:"monospace",color:T.tx}} labelFormatter={function(v){return ft(Number(v))}} formatter={function(v,n){return [Number(v).toPrecision(4)+" mJ/cm\u00b2",String(n).replace("w","")+" nm"]}}/>{drd.ws.map(function(w,wi){var ci=0;for(var j=0;j<lasers.length;j++){if(lasers[j].wl===w&&lasers[j].show){ci=j;break;}}return <Line key={"ln"+w} dataKey={"w"+w} stroke={WC[ci%WC.length]} strokeWidth={2} dot={false} name={w+" nm"} connectNulls={true} isAnimationActive={false}/>;})}{drd.ws.length>1?<Legend wrapperStyle={{fontSize:11,fontFamily:"monospace"}}/>:null}{plotLasers.map(function(L){var i=lasers.indexOf(L);var h=skinMPE(L.wl,L.dur);if(!isFinite(h)||h<=0)return null;return <ReferenceDot key={"dd"+L.id} x={L.dur} y={h*1e3} r={5} fill={WC[i%WC.length]} stroke={T.bg} strokeWidth={2}/>;})}</LineChart></ResponsiveContainer></div>)}
      </div>
    </div>
  );
}

/* ═══════ PA TAB ═══════ */
function PATab(p){
  var T=p.T,theme=p.theme,msg=p.msg,setMsg=p.setMsg;
  var _wl=useState("800"),wlStr=_wl[0],setWlStr=_wl[1];
  var _wn=useState(800),wl=_wn[0],setWl=_wn[1];
  var _tau=useState("5e-9"),tauStr=_tau[0],setTauStr=_tau[1];
  var _tn=useState(5e-9),tau=_tn[0],setTau=_tn[1];
  var _pc=useState("wl"),paCht=_pc[0],setPaCht=_pc[1];
  var _cv=useState(0),cv=_cv[0],setCv=_cv[1];
  var _dr=useState(false),dirty=_dr[0],setDirty=_dr[1];
  var flRef=useRef(null),snrRef=useRef(null);
  var lb={display:"block",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:4};
  var ipFull={width:"100%",padding:"7px 10px",fontSize:13,fontFamily:"monospace",background:T.bgI,border:"1px solid "+T.bd,borderRadius:4,color:T.tx,outline:"none",boxSizing:"border-box"};

  function onWl(s){setWlStr(s);var v=Number(s);if(isFinite(v)&&v>=180&&v<=1e6)setWl(v);setDirty(true);}
  function onTau(s){setTauStr(s);var v=parseFloat(s);if(isFinite(v)&&v>0)setTau(v);setDirty(true);}
  function calc(){setCv(cv+1);setDirty(false);}
  useEffect(function(){calc();},[]);

  /* Exposure times for SNR curves */
  var exTimes=[0.01,0.1,1,10,30,120];

  /* Compute per-pulse fluence vs PRF (Figure 2a) */
  var fluenceData=useMemo(function(){
    var r1=skinMPE(wl,tau);
    var pts=[];
    for(var le=-0.5;le<=5.5;le+=0.05){
      var f=Math.pow(10,le);
      var row={f:f,rule1:isFinite(r1)?r1*1e3:null};
      /* Rule 2 for T=1s reference */
      var hT=skinMPE(wl,1);
      if(isFinite(hT)){row.rule2=(hT/(f*1))*1e3;row.eff=Math.min(isFinite(r1)?r1:Infinity,hT/(f*1))*1e3;}
      pts.push(row);
    }
    return pts;
  },[cv,wl,tau]);

  /* Compute SNR vs PRF for multiple T values (Figure 2b) */
  var snrData=useMemo(function(){
    var pts=[];
    for(var le=-0.5;le<=5.5;le+=0.05){
      var f=Math.pow(10,le);
      var row={f:f};
      for(var ti=0;ti<exTimes.length;ti++){
        var Tv=exTimes[ti];
        var snr=paRelSNR(wl,tau,f,Tv);
        if(isFinite(snr)&&snr>0)row["T"+ti]=snr;
      }
      pts.push(row);
    }
    return pts;
  },[cv,wl,tau]);

  /* Optimal PRF for each T */
  var optData=useMemo(function(){
    return exTimes.map(function(Tv,i){
      var fopt=paOptPRF(wl,tau,Tv);
      var snrOpt=isFinite(fopt)?paRelSNR(wl,tau,fopt,Tv):NaN;
      return{T:Tv,fopt:fopt,snrOpt:snrOpt,idx:i};
    });
  },[cv,wl,tau]);

  var PRFTICKS=[1,10,100,1e3,1e4,1e5];
  function prfFmt(v){if(v>=1e3)return(v/1e3)+"k";return String(v);}

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Inputs */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"14px"}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.ac,marginBottom:10}}>Photoacoustic System Parameters</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><label style={lb}>Wavelength (nm)</label><input type="text" value={wlStr} onChange={function(e){onWl(e.target.value)}} style={ipFull}/><div style={{fontSize:9,color:T.td,marginTop:3,fontFamily:"monospace"}}>{bnd(wl)} {"\u00b7"} C_A = {CA(wl).toFixed(3)}</div></div>
          <div><label style={lb}>Pulse Duration (s)</label><input type="text" value={tauStr} onChange={function(e){onTau(e.target.value)}} style={ipFull}/><div style={{fontSize:9,color:T.td,marginTop:3,fontFamily:"monospace"}}>= {ft(tau)}</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginTop:12}}>
          <button onClick={calc} style={{padding:"8px 24px",fontSize:13,fontWeight:700,background:dirty?T.ac:T.a2,color:"#fff",border:"none",borderRadius:5,cursor:"pointer"}}>{dirty?"Calculate":"Calculated \u2713"}</button>
          {dirty?<span style={{fontSize:11,color:T.ac,fontWeight:500}}>Click to update</span>:null}
        </div>
      </div>

      {/* Key results */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"14px",opacity:dirty?0.6:1,transition:"opacity 0.2s"}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td,marginBottom:10}}>Optimal Repetition Rate by Exposure Time</div>
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th style={{padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700,textTransform:"uppercase"}}>Exposure Time</th><th style={{padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700,textTransform:"uppercase"}}>Optimal Repetition Rate</th><th style={{padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700,textTransform:"uppercase"}}>Peak Relative SNR</th><th style={{padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700,textTransform:"uppercase"}}>Single-Pulse MPE</th><th style={{padding:"7px 10px",textAlign:"left",borderBottom:"2px solid "+T.bd,color:T.td,fontSize:9,fontWeight:700,textTransform:"uppercase"}}>Per-Pulse at Optimal</th></tr></thead>
        <tbody>{optData.map(function(o){var col=WC[o.idx%WC.length];return (<tr key={o.T} style={{borderBottom:"1px solid "+T.bd}}><td style={{padding:"7px 10px",fontSize:12,fontFamily:"monospace",fontWeight:600,color:col}}>{ft(o.T)}</td><td style={{padding:"7px 10px",fontSize:12,fontFamily:"monospace"}}>{isFinite(o.fopt)?o.fopt.toFixed(1)+" Hz":"\u2014"}</td><td style={{padding:"7px 10px",fontSize:12,fontFamily:"monospace",fontWeight:700}}>{isFinite(o.snrOpt)?o.snrOpt.toFixed(2)+"\u00d7":"\u2014"}</td><td style={{padding:"7px 10px",fontSize:12,fontFamily:"monospace"}}>{si(skinMPE(wl,tau),"J/cm\u00b2")}</td><td style={{padding:"7px 10px",fontSize:12,fontFamily:"monospace"}}>{isFinite(o.fopt)?si(paEffFluence(wl,tau,o.fopt,o.T),"J/cm\u00b2"):"\u2014"}</td></tr>);})}</tbody></table></div>
      </div>

      {/* Charts */}
      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:T.td}}>Safety-Constrained Analysis</div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{display:"flex"}}><button onClick={function(){setPaCht("fl")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(paCht==="fl"?T.ac:T.bd),cursor:"pointer",background:paCht==="fl"?T.ac:"transparent",color:paCht==="fl"?"#fff":T.tm,borderRadius:"4px 0 0 4px"}}>Fluence vs. Repetition Rate</button><button onClick={function(){setPaCht("snr")}} style={{padding:"5px 12px",fontSize:11,fontWeight:600,border:"1px solid "+(paCht==="snr"?T.ac:T.bd),cursor:"pointer",background:paCht==="snr"?T.ac:"transparent",color:paCht==="snr"?"#fff":T.tm,borderRadius:"0 4px 4px 0"}}>SNR vs. Repetition Rate</button></div>
            <button onClick={function(){dlSVG(paCht==="fl"?flRef:snrRef,paCht==="fl"?"fluence_vs_prf.svg":"snr_vs_prf.svg",setMsg)}} style={mkBt(false,T.ac,T)}>{"\u2913"} Download SVG</button>
            <button onClick={function(){
              if(paCht==="fl"){var hdr=["repetition_rate_Hz","rule1_mJ_cm2","rule2_mJ_cm2","effective_mJ_cm2"];dlCSV(fluenceData.map(function(r){return{repetition_rate_Hz:r.f,rule1_mJ_cm2:r.rule1,rule2_mJ_cm2:r.rule2,effective_mJ_cm2:r.eff}}),hdr,"fluence_vs_prf.csv",setMsg);}
              else{var hdr2=["repetition_rate_Hz"];exTimes.forEach(function(Tv,i){hdr2.push("snr_T"+ft(Tv).replace(/ /g,""));});dlCSV(snrData.map(function(r){var o={repetition_rate_Hz:r.f};exTimes.forEach(function(Tv,i){o["snr_T"+ft(Tv).replace(/ /g,"")]=r["T"+i];});return o;}),hdr2,"snr_vs_prf.csv",setMsg);}
            }} style={mkBt(false,T.a2,T)}>{"\u2913"} Download CSV</button>
          </div>
        </div>

        {paCht==="fl"?(
          <div ref={flRef}>
            <div style={{fontSize:11,color:T.tm,marginBottom:4}}>Per-Pulse Fluence Limit (mJ/cm{"\u00b2"}) vs. Repetition Rate {"\u2014"} {wl} nm, {ft(tau)}, T = 1 s</div>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={fluenceData} margin={{top:8,right:16,bottom:4,left:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.gr}/>
                <XAxis dataKey="f" type="number" scale="log" domain={[0.3,3e5]} ticks={PRFTICKS} tickFormatter={prfFmt} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} label={{value:"Repetition Rate (Hz)",position:"insideBottom",offset:-2,style:{fontSize:10,fill:T.td}}}/>
                <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} width={55}/>
                <Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:12,fontFamily:"monospace",color:T.tx}} labelFormatter={function(v){return Number(v).toFixed(1)+" Hz"}} formatter={function(v,n){var label=n==="rule1"?"Rule 1 (single pulse)":n==="rule2"?"Rule 2 (average)":"Effective limit";return [Number(v).toPrecision(4)+" mJ/cm\u00b2",label]}}/>
                <Line dataKey="rule1" stroke={T.ac} strokeWidth={2} strokeDasharray="8 4" dot={false} name="Rule 1" isAnimationActive={false}/>
                <Line dataKey="rule2" stroke={T.a2} strokeWidth={2} strokeDasharray="8 4" dot={false} name="Rule 2" isAnimationActive={false}/>
                <Line dataKey="eff" stroke={T.no} strokeWidth={2.5} dot={false} name="Effective" isAnimationActive={false}/>
                <Legend wrapperStyle={{fontSize:11,fontFamily:"monospace"}}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        ):(
          <div ref={snrRef}>
            <div style={{fontSize:11,color:T.tm,marginBottom:4}}>Relative SNR vs. Repetition Rate {"\u2014"} {wl} nm, {ft(tau)} pulse</div>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={snrData} margin={{top:8,right:16,bottom:4,left:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.gr}/>
                <XAxis dataKey="f" type="number" scale="log" domain={[0.3,3e5]} ticks={PRFTICKS} tickFormatter={prfFmt} tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} label={{value:"Repetition Rate (Hz)",position:"insideBottom",offset:-2,style:{fontSize:10,fill:T.td}}}/>
                <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tick={{fill:T.td,fontSize:10,fontFamily:"monospace"}} stroke={T.bd} width={40}/>
                <Tooltip contentStyle={{background:T.tp,border:"1px solid "+T.bd,borderRadius:4,fontSize:12,fontFamily:"monospace",color:T.tx}} labelFormatter={function(v){return Number(v).toFixed(1)+" Hz"}} formatter={function(v,n){var idx=parseInt(String(n).replace("T",""),10);return [Number(v).toFixed(3)+"\u00d7","T = "+ft(exTimes[idx])]}}/>
                {exTimes.map(function(Tv,i){return <Line key={"snr"+i} dataKey={"T"+i} stroke={WC[i%WC.length]} strokeWidth={2} dot={false} name={"T = "+ft(Tv)} connectNulls={true} isAnimationActive={false}/>;})
                }
                <Legend wrapperStyle={{fontSize:11,fontFamily:"monospace"}}/>
                <ReferenceLine y={1} stroke={T.bl} strokeDasharray="4 4" label={{value:"N = 1",position:"right",style:{fontSize:9,fill:T.td}}}/>
                {optData.map(function(o){if(!isFinite(o.fopt)||!isFinite(o.snrOpt)||o.snrOpt<=0)return null;return <ReferenceDot key={"opt"+o.idx} x={o.fopt} y={o.snrOpt} r={5} fill={WC[o.idx%WC.length]} stroke={T.bg} strokeWidth={2}/>;})
                }
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={{background:T.card,borderRadius:6,border:"1px solid "+T.bd,padding:"12px 14px",fontSize:11,color:T.td,lineHeight:1.6}}>
        <strong>Reference:</strong> Francis et al., "Optimization of light source parameters for photoacoustic imaging: trade-offs, technologies, and clinical considerations," <em>JPhys Photonics</em> (2026). SNR analysis based on Equations 5{"\u2013"}12. All MPE values computed using ICNIRP 2013 skin exposure limits.
      </div>
    </div>
  );
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
        <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:16,fontWeight:700}}>Laser Skin MPE Calculator</span><span style={{fontSize:9,fontFamily:"monospace",color:T.td,border:"1px solid "+T.bd,borderRadius:3,padding:"2px 6px",fontWeight:600}}>ICNIRP 2013</span></div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>{msg?<span style={{fontSize:11,color:T.a2,fontWeight:600}}>{msg}</span>:null}<button onClick={function(){setTheme(theme==="light"?"dark":"light")}} style={{padding:"3px 8px",fontSize:13,border:"1px solid "+T.bd,cursor:"pointer",background:"transparent",color:T.tm,borderRadius:4}} title="Toggle theme">{theme==="light"?"\u263E":"\u2600"}</button></div>
      </div>
      {/* Tab bar */}
      <div style={{borderBottom:"1px solid "+T.bd,padding:"0 24px",background:T.card,display:"flex",gap:4}}>
        <button onClick={function(){setTab("mpe")}} style={tabBt("mpe")}>MPE Calculator</button>
        <button onClick={function(){setTab("pa")}} style={tabBt("pa")}>Photoacoustic SNR Optimizer</button>
      </div>
      <div style={{padding:"16px 24px 40px",maxWidth:960,margin:"0 auto"}}>
        {tab==="mpe"?<MPETab T={T} theme={theme} msg={msg} setMsg={setMsg}/>:null}
        {tab==="pa"?<PATab T={T} theme={theme} msg={msg} setMsg={setMsg}/>:null}
        <div style={{textAlign:"center",fontSize:10,color:T.td,padding:"12px 0 4px",lineHeight:1.7,borderTop:"1px solid "+T.bd,marginTop:16}}>ICNIRP 2013 {"\u00b7"} Health Phys. 105(3):271{"\u2013"}295 {"\u00b7"} Tables 3, 5, 7<br/>For research and educational purposes. Verify independently for safety-critical applications.</div>
      </div>
    </div>
  );
}
