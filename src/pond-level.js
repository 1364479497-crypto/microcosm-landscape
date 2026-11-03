// A bounded miniature reservoir, not a watershed/pressure solver. The base
// bathymetric datum never changes: all consumers can distinguish rise from wave.
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
export function createPondLevel({base=.18,spill=base+.09,risePerSecond=.0036,recessionPerSecond=.00022}={}){
 const top=Math.max(base,spill),stats={base,spill:top,current:base,rise:0,input:0,laggedRain:0,spilling:false,overflow:0,updates:0};
 function update(dt=0,state={}){
  const seconds=clamp(Number(dt)||0,0,.2),input=(state.temperature??15)<0?0:clamp(state.effectiveRain??state.rain??0),k=.9,old=stats.laggedRain,decay=Math.exp(-k*seconds);
  // Analytic integration of the lagged catchment inflow keeps the visible rise
  // consistent at 30/60/120 Hz and avoids per-frame fill increments.
  const integrated=input*seconds+(old-input)*(1-decay)/k;
  stats.laggedRain=input+(old-input)*decay;stats.input=input;
  const next=stats.current+risePerSecond*integrated-recessionPerSecond*seconds*(1-input);
  stats.overflow+=Math.max(0,next-top);stats.current=clamp(next,base,top);stats.rise=stats.current-base;stats.spilling=stats.current>=top-1e-8&&stats.laggedRain>.02;stats.updates++;
  return stats.current;
 }
 function reset(value=base){stats.current=clamp(value,base,top);stats.rise=stats.current-base;stats.laggedRain=0;stats.input=0;stats.spilling=false;stats.overflow=0;stats.updates=0;}
 return{stats,update,reset};
}
