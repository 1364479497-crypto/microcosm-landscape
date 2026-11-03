// Independently authored parcel-space detail. Short curved capsules represent
// entrained bubble clusters; reflections come from a separate moving slope field.
// A capsule has a finite upstream/downstream extent, so it cannot draw a white
// line through the whole channel or synchronize a full-width breaking wave.
const fract=x=>x-Math.floor(x),clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const hash=(x,y)=>fract(Math.sin(x*161.31+y*93.71+17.3)*21371.173);
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export const FLOW_PARCEL_CONFIG=Object.freeze({acrossCellsPerMetre:31,travelCellsPerSecond:4.2,neighbourRadius:1,minimumHalfLength:.10,maximumHalfLength:.26,representation:'finite curved bubble capsules in advected travel time, independent normal facets'});
// Reflection support is a narrow, irregular strip in the shared mean-current
// travel coordinate. Its ends, centreline and width vary independently: it is
// neither a round cell island nor a synchronized cross-channel wave front.
// The high-band reflecting micro-normal is separately prefiltered for body
// refraction, so a reflective facet cannot carve dark discs into clear water.
export const FLOW_GLINT_CONFIG=Object.freeze({normalAcrossFrequency:8.4,normalTravelFrequency:.95,normalSideGain:6.2,normalAlongGain:8.6,bodyNormalWeight:.12,coverAcrossFrequency:13,coverTravelFrequency:.95,activeThreshold:.20,minimumHalfWidth:.19,maximumHalfWidth:.35,specularExponent:28,fineFoamWeight:.35,opticalAdvection:'mean-current tau-time, without accumulated cross-bank shear',representation:'irregular flow-aligned thin reflection strips; high-band specular and prefiltered body normal share one advected micro-height'});
const noise=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(0,1,fract(x)),fy=smooth(0,1,fract(y)),mix=(a,b,t)=>a+(b-a)*t;return mix(mix(hash(ix,iy),hash(ix+1,iy),fx),mix(hash(ix,iy+1),hash(ix+1,iy+1),fx),fy);};
export function sampleFlowGlintPatch(travel,across){
 const qx=across*FLOW_GLINT_CONFIG.coverAcrossFrequency;
 // A per-lane offset breaks the common row phase without shearing by time.
 const cx=Math.floor(qx),qy=travel*FLOW_GLINT_CONFIG.coverTravelFrequency+hash(cx+6.3,2.8),cy=Math.floor(qy),fx=fract(qx),fy=fract(qy),h=hash(cx,cy);
 if(h<FLOW_GLINT_CONFIG.activeThreshold)return 0;
 const centre=.36+hash(cx+9.1,cy-4.2)*.28+(noise(fy*2.4+cx*1.7,cy+6.2)-.5)*.11;
 const width=(FLOW_GLINT_CONFIG.minimumHalfWidth+hash(cx+11.8,cy+1.7)*(FLOW_GLINT_CONFIG.maximumHalfWidth-FLOW_GLINT_CONFIG.minimumHalfWidth))*(.57+.43*noise(fy*4.7+cy*2.3,cx-7.2));
 const transverse=(fx-centre)/width;
 const start=.08+hash(cx-3.7,cy+8.3)*.18+transverse*.035;
 const end=.76+hash(cx+2.3,cy+5.4)*.16-transverse*.025;
 const acrossMask=1-smooth(.55,.98,Math.abs(transverse));
 const alongMask=smooth(start,start+.11,fy)*(1-smooth(end-.12,end,fy));
 return acrossMask*alongMask*(.72+h*.28)*smooth(.025,.065,Math.min(fx,1-fx));
}
export function sampleFlowParcel(travel,across,footprint=0){
 const qx=across*31,qy=travel*4.2,ix=Math.floor(qx),iy=Math.floor(qy);let coverage=0;
 for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
  const cx=ix+x,cy=iy+y,h=hash(cx,cy);if(h<.37)continue;
  const px=cx+.18+hash(cx+9.1,cy-4.2)*.64,py=cy+.12+hash(cx-3.7,cy+8.3)*.76;
  const dy=qy-py,curve=(hash(cx+2.3,cy+5.4)-.5)*.70*dy*dy;
  const width=.085+hash(cx+11.8,cy+1.7)*.12,halfLength=.10+hash(cx-4.9,cy+2.8)*.16;
  const d=Math.hypot((qx-px-curve)/width,Math.max(0,Math.abs(dy)-halfLength)/.12);
  const aa=Math.max(.025,footprint*.45),shape=1-smooth(.48-aa,1+aa,d);
  coverage=Math.max(coverage,shape*(.42+h*.40));
 }
 return coverage;
}
export const FLOW_PARCEL_GLSL=`
float fpHash(vec2 p){return fract(sin(dot(p,vec2(161.31,93.71))+17.3)*21371.173);}
float fpNoise(vec2 p){vec2 c=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(fpHash(c),fpHash(c+vec2(1.,0.)),f.x),mix(fpHash(c+vec2(0.,1.)),fpHash(c+1.),f.x),f.y);}
float flowParcelFoam(float travel,float across){
 vec2 q=vec2(across*31.,travel*4.2),cell=floor(q);float coverage=0.;
 float aa=max(.025,length(fwidth(q))*.45);
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 c=cell+vec2(float(x),float(y));float h=fpHash(c);if(h<.37)continue;
  vec2 center=c+vec2(.18+fpHash(c+vec2(9.1,-4.2))*.64,.12+fpHash(c+vec2(-3.7,8.3))*.76);
  float dy=q.y-center.y,curve=(fpHash(c+vec2(2.3,5.4))-.5)*.70*dy*dy;
  float width=.085+fpHash(c+vec2(11.8,1.7))*.12,halfLength=.10+fpHash(c+vec2(-4.9,2.8))*.16;
  float d=length(vec2((q.x-center.x-curve)/width,max(0.,abs(dy)-halfLength)/.12));
  coverage=max(coverage,(1.-smoothstep(.48-aa,1.+aa,d))*(.42+h*.40));
 }
 return coverage;
}
float flowFacetHeight(vec2 q){
 vec2 warp=vec2(fpNoise(q*.43+vec2(7.,2.)),fpNoise(q*.43+vec2(-3.,9.)))-.5;
 return fpNoise(q+warp*.8)*.88+fpNoise(q*1.93+vec2(8.1,-2.7))*.12;
}
float flowGlintCover(float travel,float across){
 float qx=across*${FLOW_GLINT_CONFIG.coverAcrossFrequency.toFixed(6)},cx=floor(qx);
 float qy=travel*${FLOW_GLINT_CONFIG.coverTravelFrequency.toFixed(6)}+fpHash(vec2(cx+6.3,2.8));
 vec2 cell=vec2(cx,floor(qy));float fx=fract(qx),fy=fract(qy),h=fpHash(cell);
 float centre=.36+fpHash(cell+vec2(9.1,-4.2))*.28+(fpNoise(vec2(fy*2.4+cell.x*1.7,cell.y+6.2))-.5)*.11;
 float width=mix(${FLOW_GLINT_CONFIG.minimumHalfWidth.toFixed(6)},${FLOW_GLINT_CONFIG.maximumHalfWidth.toFixed(6)},fpHash(cell+vec2(11.8,1.7)))*(.57+.43*fpNoise(vec2(fy*4.7+cell.y*2.3,cell.x-7.2)));
 float transverse=(fx-centre)/width;
 float start=.08+fpHash(cell+vec2(-3.7,8.3))*.18+transverse*.035;
 float end=.76+fpHash(cell+vec2(2.3,5.4))*.16-transverse*.025;
 // Filter axes separately. A large travel footprint may soften an end, but
 // cannot inflate a narrow strip into a round spot or fill cross-lane gaps.
 float crossFoot=max(abs(dFdx(qx)),abs(dFdy(qx))),travelFoot=max(abs(dFdx(qy)),abs(dFdy(qy)));
 float crossAA=clamp(crossFoot/max(width,.08)*.5,.015,.14),alongAA=clamp(travelFoot*.5,.012,.055);
 float acrossMask=1.-smoothstep(.55-crossAA,.98+crossAA,abs(transverse));
 float alongMask=smoothstep(start-alongAA,start+.11+alongAA,fy)*(1.-smoothstep(end-.12-alongAA,end+alongAA,fy));
 float cellGuard=smoothstep(.025,.065,min(fx,1.-fx));
 float coverage=acrossMask*alongMask*(.72+h*.28)*cellGuard*step(${FLOW_GLINT_CONFIG.activeThreshold.toFixed(6)},h);
 return coverage*(1.-smoothstep(.30,.85,crossFoot))*(1.-smoothstep(.50,1.4,travelFoot));
}
`;
