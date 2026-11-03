// Scene-referred direct/fill balance; exposure/output conversion stay with main.
export const ENVIRONMENT_LIGHTING=Object.freeze({sunDay:4.05,skyDay:.62,skyNight:.20,environmentDay:.105,environmentNight:.045,shadowStrength:.88,shadowNormalBias:.009,shadowRadius:2.2,baseWind:1.96});
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
export function sampleEnvironmentLighting(state={},stormCloudCoverage=0){
 const day=clamp(state.daylight??1),rain=clamp(state.rain??0),cloud=clamp(stormCloudCoverage),sunTransmission=(1-rain*.42)*(1-cloud*.20),skyTransmission=(1-rain*.22)*(1-cloud*.08);
 return{sun:(.03+day*ENVIRONMENT_LIGHTING.sunDay)*sunTransmission,sky:ENVIRONMENT_LIGHTING.skyNight+day*ENVIRONMENT_LIGHTING.skyDay*skyTransmission,environment:ENVIRONMENT_LIGHTING.environmentNight+day*ENVIRONMENT_LIGHTING.environmentDay*skyTransmission,sunTransmission,skyTransmission};
}
