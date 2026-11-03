// Independent interaction timing for the miniature. A dragged cloud meeting
// another cloud is an authored weather gesture, not atmospheric electrification.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export const CLOUD_EVENT=Object.freeze({mergeSeconds:1.28,firstStrike:.68,rainRise:[.82,2.15],rainFall:[16.5,21],end:21});
export function cloudStormAt(age){
 const envelope=1-smooth(16.5,21,age),dark=smooth(.12,1.55,age)*envelope,rain=smooth(.82,2.15,age)*envelope;
 const phase=age>=21?'clear':age<.55?'coalescing':age<.82?'charging':age<1.45?'thunder':age<16.5?'raining':'clearing';
 return{phase,darkening:dark,rain,alive:age<21};
}
export function startCloudStorm(cloud){cloud.stormAge=0;cloud.storm=0;cloud.stormRain=0;cloud.phase='coalescing';cloud.stormStrikeFired=false;}
export function stepCloudStorm(cloud,dt){
 if(!Number.isFinite(cloud.stormAge))cloud.stormAge=99;
 cloud.stormAge+=Math.max(0,Math.min(.1,dt));const event=cloudStormAt(cloud.stormAge);
 cloud.storm=event.darkening;cloud.stormRain=event.rain;cloud.phase=event.phase;
 const strike=event.alive&&!cloud.stormStrikeFired&&cloud.stormAge>=CLOUD_EVENT.firstStrike;
 if(strike)cloud.stormStrikeFired=true;
 return{...event,strike};
}
export function combinedCloudSize(a,b){return Math.min(1.48,Math.cbrt(Math.max(.001,a)**3+Math.max(.001,b)**3));}
// Optical handover: the incoming lobe keeps its physical dimensions while its
// density fades into the surviving volume. A tiny disappearing ball reads as a
// solid object being swallowed, rather than two clouds mixing.
export function cloudMergeEnvelope(age){const t=clamp(age/CLOUD_EVENT.mergeSeconds);return{progress:smooth(0,1,t),opacity:1-smooth(.10,1,t),density:1-smooth(.10,1,t),scale:1,complete:t>=1};}

// A short perceptual envelope: primary return flash, two re-strikes and a weak
// afterglow. The same value owns bolt radiance and the scene flash in main.
export function lightningEnvelope(age){
 if(!Number.isFinite(age)||age<0||age>=.72)return 0;
 const pulse=(at,amplitude,decay)=>age>=at?amplitude*Math.exp(-(age-at)*decay):0;
 return Math.max(pulse(0,1,26),pulse(.12,.85,29),pulse(.27,.62,22),pulse(.43,.28,18));
}
