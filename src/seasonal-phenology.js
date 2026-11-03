// One shared season owner: spring=0, summer=1, autumn=2, early winter=3.
// These are compressed artistic viewing windows for a warm-temperate mountain
// orchard, not a simultaneous real-world calendar or a chill/heat-unit model.
// The general meadow node favours this case's spring flowering window; summer
// spikes retain a separate summer peak rather than every flower staying open.
// Meadow nodes were selected with the root's RHS/Woodland Trust research.
export const PHENOLOGY_PROFILES=Object.freeze({
  meadow:Object.freeze([1,.72,.12,0]),
  tieredPrimula:Object.freeze([1,.72,.04,0]),
  geum:Object.freeze([1,.68,.12,0]),
  blue:Object.freeze([1,.24,.015,0]),
  earlyPrimrose:Object.freeze([1,.03,0,0]),
  summerSpike:Object.freeze([.28,1,.20,0]),
  peachBlossom:Object.freeze([1,0,0,0]),
  peachLeaf:Object.freeze([.12,1,.38,0]),
  peachFruit:Object.freeze([0,1,.02,0]),
  peachRipeness:Object.freeze([0,1,1,0]),
  peachFruitSize:Object.freeze([.28,1,1,.28]),
  peachAutumn:Object.freeze([0,0,1,0]),
  peachNewLeaf:Object.freeze([.75,0,0,0]),
  persimmonLeaf:Object.freeze([.30,1,.55,0]),
  // The exact four endpoints are zero; the late-spring flower event below
  // follows leaf emergence instead of pretending kaki flowers with bare peach.
  persimmonBlossom:Object.freeze([0,0,0,0]),
  persimmonFruit:Object.freeze([0,.48,1,.24]),
  persimmonRipeness:Object.freeze([0,.04,1,1]),
  persimmonFruitSize:Object.freeze([.20,.65,1,1]),
  persimmonAutumn:Object.freeze([0,0,1,0]),
  persimmonNewLeaf:Object.freeze([1,0,0,0]),
});
export const PHENOLOGY_EVENTS=Object.freeze({persimmonBlossom:Object.freeze({start:.16,peak:.42,end:.86,amplitude:.80,meaning:'small solitary cream female flowers after new leaves on current shoots'})});
export const SEASON_VIEW_WINDOWS=Object.freeze({spring:'peach bloom before most leaves; kaki beginning new leaves',summer:'mature green leaves, ripe summer peaches and growing green kaki',autumn:'peach harvest over; yellowing peach and orange-red kaki foliage, ripe orange kaki',winter:'early winter after leaf fall; peach bare, a small retained kaki crop, not all-winter fruit persistence'});
export function normalizeSeason(value=0){if(typeof value==='string')value=({spring:0,summer:1,autumn:2,winter:3}[value]??0);return Number.isFinite(Number(value))?((Number(value)%4)+4)%4:0;}
const smooth=x=>{const f=Math.max(0,Math.min(1,x));return f*f*(3-2*f);};
export function seasonalProfile(profile,season=0){const s=normalizeSeason(season),i=Math.floor(s),f=s-i,u=smooth(f);return profile[i]+(profile[(i+1)%4]-profile[i])*u;}
export function seasonalEvent(event,season=0){const s=normalizeSeason(season);return event.amplitude*(s<=event.peak?smooth((s-event.start)/(event.peak-event.start)):1-smooth((s-event.peak)/(event.end-event.peak)));}
export function meadowBloomForType(type=1,season=0){const key=type>1.44?'summerSpike':type>1.35?'earlyPrimrose':type>1.25?'blue':type>1.15?'geum':type>1.05?'tieredPrimula':'meadow';return seasonalProfile(PHENOLOGY_PROFILES[key],season);}
export function sampleSeasonalPhenology(season=0){const result={season:normalizeSeason(season)};for(const [key,p]of Object.entries(PHENOLOGY_PROFILES))result[key]=PHENOLOGY_EVENTS[key]?seasonalEvent(PHENOLOGY_EVENTS[key],season):seasonalProfile(p,season);for(const [i,key]of ['spring','summer','autumn','winter'].entries()){const profile=[0,0,0,0];profile[i]=1;result[key]=seasonalProfile(profile,season);}return result;}
const vec4=values=>`vec4(${values.map(x=>Number(x).toFixed(6)).join(',')})`;
export const PHENOLOGY_GLSL=`
float seasonalProfile(vec4 p,float season){float s=mod(mod(season,4.)+4.,4.),f=fract(s);f=f*f*(3.-2.*f);if(s<1.)return mix(p.x,p.y,f);if(s<2.)return mix(p.y,p.z,f);if(s<3.)return mix(p.z,p.w,f);return mix(p.w,p.x,f);}
float meadowBloomForType(float type,float season){
 if(type>1.44)return seasonalProfile(${vec4(PHENOLOGY_PROFILES.summerSpike)},season);
 if(type>1.35)return seasonalProfile(${vec4(PHENOLOGY_PROFILES.earlyPrimrose)},season);
 if(type>1.25)return seasonalProfile(${vec4(PHENOLOGY_PROFILES.blue)},season);
 if(type>1.15)return seasonalProfile(${vec4(PHENOLOGY_PROFILES.geum)},season);
 if(type>1.05)return seasonalProfile(${vec4(PHENOLOGY_PROFILES.tieredPrimula)},season);
 return seasonalProfile(${vec4(PHENOLOGY_PROFILES.meadow)},season);
}
`;
