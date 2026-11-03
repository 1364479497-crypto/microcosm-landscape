// Presentation state is independent of the renderers. Each weather effect owns
// one Boolean; selecting another effect never clears its neighbours.
export const WEATHER_DEFAULTS=Object.freeze({sun:true,clouds:true,rain:false,fog:false,storm:false});
export const SEASONS=Object.freeze(['春','夏','秋','冬']);
export function createWeatherSelection(){return{...WEATHER_DEFAULTS};}
export function seasonPhase(value){return((value%4)+4)%4;}
export function advanceSeason(value,seconds,playing){return seasonPhase(value+(playing?Math.max(0,seconds)/28:0));}
export function describeSeason(value,playing){
 const phase=seasonPhase(value),node=Math.floor(phase),fraction=phase-node;
 return{phase,node,next:(node+1)%4,progress:Math.round(fraction*100),label:`${SEASONS[node]} → ${SEASONS[(node+1)%4]} · ${Math.round(fraction*100)}% · ${playing?'流转中':'已暂停'}`};
}
