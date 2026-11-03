import * as THREE from 'three';
import {createFlowField} from './flow-field.js';
import {FLOW_PARCEL_GLSL,FLOW_PARCEL_CONFIG,FLOW_GLINT_CONFIG} from './flow-optics.js';
import {createWaterImpactVFX,waterfallSunIntensity} from './water-impact-vfx.js';
import {INLET_GLSL,configureInlet,lakeSurfaceHeight,inletTracer,inletCoordinates} from './water-surface.js';

// A steady one-dimensional discharge field plus gravity-driven free flight.
// This is an independently authored real-time flow approximation, not a 3-D
// Navier–Stokes solver. Material features use fluid travel time, not world UV.
const GLSL_NOISE=`
float hash21(vec2 p){return fract(sin(dot(p,vec2(87.71,243.19)))*19341.1379);}
float valueNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1)),f.x),f.y);}
float flowNoise(vec2 p){return valueNoise(p)*.60+valueNoise(p*2.17+vec2(7.2,1.3))*.27+valueNoise(p*4.07+vec2(2.8,9.1))*.13;}
float advectedNoise(float tau,float across,float bank,float time,float scale){
 // Lagrangian texture: a parcel keeps its shape along the complete reach.
 // The old 1.8 s phase reset cross-faded away highlights before they reached
 // the lake. Only a weak long-scale shear changes its outline now.
 float shear=sin((tau-time*bank)*.31+across*.17)*.09;
 return flowNoise(vec2((tau-time*bank)*scale,across+shear));
}
`;
const FLOW_WAVES=`
float surfaceWave(vec4 flow,vec4 section){
 float bank=.42+.58*(1.-section.x*section.x),age=flow.y-uFlowTime;
 float amp=min(flow.w*.20,.008)*(1.+min(section.z,1.)*.9);
 float crossPhase=section.x*section.y;
 float p=age*2.0+crossPhase*13.,q=age*3.1-crossPhase*21.+.7;
 return amp*(sin(p)*.54+sin(q)*.30+sin(age*4.4+crossPhase*7.)*.16)*(1.-pow(abs(section.x),6.));
}
`;
const ENDING=`
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;
const rng=n=>{const q=Math.sin(n*93.17+11.83)*17343.3847;return q-Math.floor(q);};
const clamp=THREE.MathUtils.clamp;

export function createRunningWater(terrain,field,uniforms){
 const flow=createFlowField(terrain,{discharge:.0095,sourceSpeed:.50});
 const inlet=configureInlet(flow,terrain,uniforms);
 const group=new THREE.Group();group.name='Gravity and discharge driven stream';
 Object.assign(uniforms,{uFlowTime:{value:0},uFlowCapture:{value:0},uFlowDebug:{value:0},uFlowRate:{value:1},uImpactDistance:{value:flow.falls[0]?.endDistance??0},uFlowSunStrength:{value:1},uFlowActivity:{value:1},uFallIntensity:{value:.18},uFallTime:{value:0}});
 const ownedMaterials=[],ownedGeometry=[];
 const material=(options)=>{const m=new THREE.ShaderMaterial(options);ownedMaterials.push(m);return m;};
 const geometry=(p,idx,attrs={})=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p instanceof Float32Array?p:new Float32Array(p),3));if(idx)g.setIndex(idx);for(const [name,[data,size]]of Object.entries(attrs))g.setAttribute(name,new THREE.BufferAttribute(data instanceof Float32Array?data:new Float32Array(data),size));g.computeBoundingSphere();ownedGeometry.push(g);return g;};
 const p=[],meta=[],section=[],tangent=[],lakeData=[],wet=[],idx=[],rowCount=flow.samples.length,crossCount=25;
 const valid=[],cellTriangles=new Uint8Array((rowCount-1)*(crossCount-1));
 for(let i=0;i<rowCount;i++){
  const center=flow.samples[i];valid.push(center.fallIndex<0);
  for(let j=0;j<crossCount;j++){
   const lateral=j/(crossCount-1)*2-1,c=flow.crossSectionAtDistance(center.distance,lateral,center);
   p.push(...c.position);meta.push(center.distance,center.travelTime,c.speed,c.depth);wet.push(c.wet);
   const lakeDepth=Math.max(0,terrain.lake.level-c.bedHeight),lakeBlend=smooth(.015,.13,lakeDepth)*smooth(inlet.position[2]-.24,inlet.position[2]+.18,c.position[2]);lakeData.push(lakeBlend,lakeDepth);
   section.push(lateral,center.halfWidth,center.slope,center.froude);tangent.push(...center.tangent);
  }
 }
 for(let i=0;i<rowCount-1;i++)if(valid[i]&&valid[i+1])for(let j=0;j<crossCount-1;j++){
  const a=i*crossCount+j,b=a+1,c=a+crossCount,d=c+1,key=i*(crossCount-1)+j;
  if(wet[a]&&wet[b]&&wet[c]&&rockSafeTriangle(a,c,b)){idx.push(a,c,b);cellTriangles[key]|=1;}
  if(wet[b]&&wet[c]&&wet[d]&&rockSafeTriangle(b,c,d)){idx.push(b,c,d);cellTriangles[key]|=2;}
 }
 function rockSafeTriangle(a,b,c){
  const ids=[a,b,c],rocks=terrain.rocks||[];
  for(const r of rocks){
   const cx=(p[a*3]+p[b*3]+p[c*3])/3,cz=(p[a*3+2]+p[b*3+2]+p[c*3+2])/3;
   if(Math.abs(cx-r.x)>Math.max(r.rx,r.rz)+.07||Math.abs(cz-r.z)>Math.max(r.rx,r.rz)+.07)continue;
   for(const weights of [[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]){
    let x=0,y=0,z=0;for(let k=0;k<3;k++){x+=p[ids[k]*3]*weights[k];y+=p[ids[k]*3+1]*weights[k];z+=p[ids[k]*3+2]*weights[k];}
    if(r.heightAt(x,z)>y-.0015)return false;
   }
  }return true;
 }
 const streamGeometry=geometry(p,idx,{aFlow:[meta,4],aSection:[section,4],aTangent:[tangent,3],aLake:[lakeData,2]});
 const streamMaterial=material({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,
 vertexShader:`uniform float uFlowTime;uniform vec2 uWind;attribute vec4 aFlow,aSection;attribute vec3 aTangent;attribute vec2 aLake;varying vec4 vFlow,vSection;varying vec2 vLake;varying vec3 vWorld,vTangent;${INLET_GLSL}${FLOW_WAVES}
 void main(){vec3 p=position;p.y+=surfaceWave(aFlow,aSection);p.y=mix(p.y,uLakeLevel+lakeWave(p.xz,aLake.y+uLakeLevel-uLakeBaseLevel,uFlowTime,uWind),aLake.x);vWorld=(modelMatrix*vec4(p,1.)).xyz;vFlow=aFlow;vFlow.w=mix(aFlow.w,aLake.y,aLake.x);vSection=aSection;vLake=aLake;vTangent=aTangent;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
 fragmentShader:`uniform float uFlowTime,uFlowCapture,uFlowDebug,uDay,uNear,uFar,uFlowSunStrength;uniform vec2 uResolution;uniform vec3 uCamera,uSun;uniform sampler2D uColor,uDepth;varying vec4 vFlow,vSection;varying vec2 vLake;varying vec3 vWorld,vTangent;${INLET_GLSL}${GLSL_NOISE}
${FLOW_PARCEL_GLSL}
${FLOW_WAVES}
 float viewDepth(float d){return -(uNear*uFar)/((uFar-uNear)*d-uFar);}
 void main(){
  float bank=.42+.58*(1.-vSection.x*vSection.x);vec4 inletSample=inletCoords(vWorld.xz);
  float tau=mix(vFlow.y,uMouthTravel+inletTravel(inletSample.x),vLake.x),age=tau-uFlowTime;
  vec2 q=vec2(tau*5.7,vSection.x*vSection.y*23.);
  float footprint=max(length(dFdx(q)),length(dFdy(q))),bandAA=1.-smoothstep(.6,1.7,footprint);
  float n=advectedNoise(tau,q.y,bank,uFlowTime,5.7),na=advectedNoise(tau+.025/5.7,q.y,bank,uFlowTime,5.7),nb=advectedNoise(tau,q.y+.025,bank,uFlowTime,5.7);
  vec3 along=normalize(vTangent),side=normalize(vec3(-along.z,0,along.x));
  vec3 N=normalize(cross(dFdx(vWorld),dFdy(vWorld)));if(N.y<0.)N=-N;
  float parcel=tau-uFlowTime*bank,across=vSection.x*vSection.y;
  // Both micro-height and reflection strips follow mean travel time. The
  // coordinate cannot accumulate cross-bank time shear into U-shaped ribbons.
  // Fine entrained aeration keeps its existing bank-advection coordinate.
  float glintTravel=tau-uFlowTime;
  vec2 facetQ=vec2(across*${FLOW_GLINT_CONFIG.normalAcrossFrequency.toFixed(6)},glintTravel*${FLOW_GLINT_CONFIG.normalTravelFrequency.toFixed(6)});
  float sideSlope=(flowFacetHeight(facetQ+vec2(.045,0.))-flowFacetHeight(facetQ-vec2(.045,0.)))*${FLOW_GLINT_CONFIG.normalSideGain.toFixed(6)};
  float alongSlope=(flowFacetHeight(facetQ+vec2(0.,.045))-flowFacetHeight(facetQ-vec2(0.,.045)))*${FLOW_GLINT_CONFIG.normalAlongGain.toFixed(6)};
  float slopeAA=1.-smoothstep(.55,1.8,length(fwidth(facetQ)));
  vec3 reflectionN=normalize(N-side*sideSlope*slopeAA-along*alongSlope*slopeAA);
  // Specular resolves the full optical microfacet slope. Body transmission
  // sees its prefiltered low band instead of inheriting large black sky/
  // refraction blotches from individual unresolved reflecting facets.
  N=normalize(mix(N,reflectionN,${FLOW_GLINT_CONFIG.bodyNormalWeight.toFixed(6)}));
  vec3 V=normalize(uCamera-vWorld);float NV=max(.02,abs(dot(N,V))),fres=.0204+.9796*pow(1.-NV,5.);
  vec2 uv=clamp(gl_FragCoord.xy/uResolution+(viewMatrix*vec4(N,0.)).xy*.0035,.002,.998);
  float own=-(viewMatrix*vec4(vWorld,1.)).z,path=clamp(vFlow.w/max(.26,V.y),.012,.7);
  vec3 under=vec3(.075,.10,.08)*(.2+.8*uDay);
  if(uFlowCapture<.5){float behind=viewDepth(texture2D(uDepth,uv).r)-own;if(behind<0.)uv=gl_FragCoord.xy/uResolution;path=clamp(min(max(behind,.012),path*1.7),.012,.7);under=texture2D(uColor,uv).rgb;}
  // Miniature rapids have millimetres of resolved depth. A bounded extra
  // optical path stands for unresolved bubbly/turbulent scattering, otherwise
  // the captured grey rock reads as an uncovered dry chute beneath glints.
  float turbulence=smoothstep(.12,.75,vSection.z);
  float opticalPath=max(path,.024+turbulence*.12);
  vec3 transmission=exp(-vec3(6.8,1.7,.8)*opticalPath);
  vec3 body=under*transmission+vec3(.035,.23,.26)*(1.-transmission)*(.22+.78*uDay);
  vec3 R=reflect(-V,N),sky=mix(vec3(.035,.045,.037),vec3(.22,.29,.30),smoothstep(-.1,.8,R.y))*(.18+.82*uDay);
  vec3 color=mix(body,sky,min(.8,fres));
  float rough=smoothstep(.12,.75,vSection.z),fast=smoothstep(.85,2.5,vSection.w);
  // Irregular narrow strips gate the sunlit microfacet response. Their long
  // dimension follows the current; each lane has independent ends and gaps.
  float glintCover=flowGlintCover(glintTravel,across);
  float normalVariance=max(dot(dFdx(reflectionN),dFdx(reflectionN)),dot(dFdy(reflectionN),dFdy(reflectionN)));
  float specExponent=1./(1./${FLOW_GLINT_CONFIG.specularExponent.toFixed(6)}+min(normalVariance*.45,.0105));
  float reflectionLobe=pow(max(0.,dot(normalize(uSun+V),reflectionN)),specExponent)*(specExponent/${FLOW_GLINT_CONFIG.specularExponent.toFixed(6)});
  float spec=reflectionLobe*glintCover;
  color+=spec*vec3(1.35,1.30,1.14)*uDay*1.55*uFlowSunStrength;
  float impact=0.;
  ${flow.falls.map(f=>`impact+=exp(-max(0.,vFlow.x-${f.endDistance.toFixed(6)})*4.6)*step(${f.endDistance.toFixed(6)},vFlow.x);`).join('\n')}
  float capsules=flowParcelFoam(parcel,across);
  float broken=flowNoise(vec2(across*37.+4.8,parcel*3.7));
  float churn=smoothstep(.55,.79,broken)*(rough*.17+impact*.23);
  // Fine aeration remains present, but it must not dominate coarse sunlit
  // water with a dense set of long bright needles. Churn/impact stay intact.
  float foam=clamp(capsules*(.13+rough*.28+fast*.10+impact*.24)*${FLOW_GLINT_CONFIG.fineFoamWeight.toFixed(6)}+churn,0.,.56);
  foam*=1.-smoothstep(.76,1.,abs(vSection.x));
  // Aerated clusters are surface material, not emissive painted lines.
  vec3 foamLight=vec3(.67,.76,.73)*(.24+.64*uDay);
  color=mix(color,foamLight,foam);
  float edge=(1.-smoothstep(.87,1.,abs(vSection.x)))*smoothstep(.001,.015,vFlow.w);
  float mouth=1.-smoothstep(.36,.98,vLake.x);
  if(uFlowDebug>.5&&uFlowDebug<1.5)color=vec3(vFlow.z/4.,.2,1.-vFlow.z/4.);
  if(uFlowDebug>1.5&&uFlowDebug<2.5)color=vec3(.2+vTangent.x*.5,.5,.2+vTangent.z*.5);
  if(uFlowDebug>2.5&&uFlowDebug<3.5)color=vec3(foam);
  if(uFlowDebug>3.5&&uFlowDebug<4.5)color=vec3(spec);
  if(uFlowDebug>4.5&&uFlowDebug<5.5)color=reflectionN*.5+.5;
  if(uFlowDebug>5.5&&uFlowDebug<6.5)color=vec3(glintCover);
  if(uFlowDebug>6.5&&uFlowDebug<7.5)color=vec3(reflectionLobe);
  if(uFlowDebug>7.5)color=N*.5+.5;
  gl_FragColor=vec4(color,edge*mouth);${ENDING}
 }`});
 const stream=new THREE.Mesh(streamGeometry,streamMaterial);stream.name='Bed bounded advecting clear stream and rapids';stream.frustumCulled=false;stream.renderOrder=8;group.add(stream);

 const fallMeshes=[];
 for(const fall of flow.falls){
  const fp=[],fd=[],fu=[],fj=[],fi=[],rows=88;
  const landingA=flow.crossSectionAtDistance(fall.endDistance+.016,-1).position,landingB=flow.crossSectionAtDistance(fall.endDistance+.016,1).position;
  const landingMin=Math.min(landingA[0],landingB[0]),landingMax=Math.max(landingA[0],landingB[0]);
  // A rounded transverse envelope, then three narrower broken front bundles.
  // This is optical aerated volume; the hydraulic clear-water core still uses
  // the unchanged Q/speed and ballistic travel time from the shared flow.
  for(let layer=0;layer<4;layer++){
   const cols=layer===0?33:17,base=fp.length/3,centers=[0,-.47,.08,.52],spans=[1,.32,.38,.29];
   for(let i=0;i<=rows;i++){
    const age=i/rows*fall.duration,s=fall.sampleAtTime(age),pos=s.position,progress=age/fall.duration,tail=smooth(.84,1,progress);
    for(let j=0;j<cols;j++){
     const u=j/(cols-1)*2-1,theta=(u+1)*Math.PI;
     const lateral=layer===0?Math.sin(theta):centers[layer]+u*spans[layer];
     const half=.86*(s.halfWidth*(1-tail)+Math.min(s.halfWidth,Math.max(.001,(lateral<0?pos[0]-landingMin:landingMax-pos[0])*.96))*tail);
     const envelopeHalf=.045+Math.min(.055,s.depth)*.65+progress*.038;
     const z=layer===0?pos[2]+envelopeHalf*Math.cos(theta):pos[2]+envelopeHalf*Math.sqrt(Math.max(0,1-lateral*lateral))+.018+layer*.004;
     fp.push(pos[0]+lateral*half,pos[1],z);
     fd.push(age,fall.duration,fall.speedAtTime(age),progress);fu.push(lateral,fall.halfWidth);fj.push(layer,layer*1.791,theta,u);
    }
   }
   for(let i=0;i<rows;i++)for(let j=0;j<cols-1;j++){const a=base+i*cols+j,b=a+1,c=a+cols,d=c+1;fi.push(a,c,b,b,c,d);}
  }
  const fg=geometry(fp,fi,{aFall:[fd,4],aCross:[fu,2],aJet:[fj,4]});
  fg.userData.airWaterEnvelope={layers:4,closedCrossSection:true,coreRows:rows+1,coreColumns:33,physicalDischargeUnchanged:true,representation:'closed aerated optical envelope, not a solid mass extrusion',coreDepthRange:[.10,.18],frontBundleGapRange:[.022,.030],normalOwner:'central differences of the same deformed parameter surface'};
  const fm=material({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:false,
   vertexShader:`uniform float uFlowTime,uFallTime;uniform vec2 uWind;attribute vec4 aFall,aJet;attribute vec2 aCross;varying vec4 vFall,vJet;varying vec2 vCross;varying vec3 vWorld,vSurfaceNormal;
   vec3 jetSurface(float age,float u,float layer){
    float duration=(${fall.duration.toFixed(10)}),progress=clamp(age/duration,0.,1.);age=progress*duration;
    float theta=(u+1.)*3.141592653589793;
    float lateral=layer<.5?sin(theta):(layer<1.5?-.47:layer<2.5?.08:.52)+u*(layer<1.5?.32:layer<2.5?.38:.29);
    vec3 center=vec3(mix((${fall.start[0].toFixed(10)}),(${fall.end[0].toFixed(10)}),progress),(${fall.start[1].toFixed(10)})-(${fall.entryVerticalSpeed.toFixed(10)})*age-(${(fall.gravity*.5).toFixed(10)})*age*age,mix((${fall.start[2].toFixed(10)}),(${fall.end[2].toFixed(10)}),progress));
    float speed=length(vec2((${fall.entrySpeed.toFixed(10)}),(${fall.entryVerticalSpeed.toFixed(10)})+(${fall.gravity.toFixed(10)})*age));
    float sheetWidth=(${fall.width.toFixed(10)})*(1.-.10*smoothstep(0.,1.,progress)),physicalDepth=(${fall.discharge.toFixed(10)})/(speed*sheetWidth);
    float tail=smoothstep(.84,1.,progress),sectionHalf=sheetWidth*.5;
    float landingHalf=max(.001,(lateral<0.?center.x-(${landingMin.toFixed(10)}):(${landingMax.toFixed(10)})-center.x)*.96);
    sectionHalf=mix(sectionHalf,min(sectionHalf,landingHalf),tail)*.86;
    float envelopeHalf=.045+min(.055,physicalDepth)*.65+progress*.038;
    float front=layer<.5?cos(theta):sqrt(max(0.,1.-lateral*lateral));
    vec3 p=center+vec3(lateral*sectionHalf,0.,envelopeHalf*front);
    // All three front bundles follow the SAME deformed outer core. Their
    // guaranteed positive separation prevents a moving coplanar intersection
    // from exposing a triangle-row checker pattern in transparency blending.
    if(layer>.5)p.z+=.018+layer*.004;
    float emitted=uFallTime-age,breakup=smoothstep(.025,.30,progress)*(1.-smoothstep(.88,1.,progress));
    float roll=sin(emitted*13.7+lateral*8.4)*.62+sin(emitted*24.3-lateral*15.1)*.38;
    p.x+=(sin(emitted*8.1)*.010+lateral*roll*.023)*breakup;
    p.z+=(sin(emitted*17.3+lateral*6.8)*.014+front*roll*.012)*breakup;
    p.xz+=uWind*.012*age*age*(1.-smoothstep(.88,1.,progress));
    return p;
   }
   void main(){
    vec3 p=jetSurface(aFall.x,aJet.w,aJet.x);
    // Derive a smooth normal from the same continuously deformed parameter
    // surface, rather than dFdx(world)/dFdy(world)'s hard triangle normals.
    // This removes faceted rim glints at their geometric cause, without blur.
    float eu=.001,et=.0001;
    vec3 across=jetSurface(aFall.x,aJet.w+eu,aJet.x)-jetSurface(aFall.x,aJet.w-eu,aJet.x);
    vec3 along=jetSurface(aFall.x+et,aJet.w,aJet.x)-jetSurface(aFall.x-et,aJet.w,aJet.x);
    vSurfaceNormal=normalize(mat3(modelMatrix)*normalize(cross(along,across)));
    vWorld=(modelMatrix*vec4(p,1.)).xyz;vFall=aFall;vCross=aCross;vJet=aJet;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
   }`,
   fragmentShader:`uniform float uFlowTime,uFlowCapture,uDay,uFlowSunStrength,uFlowActivity,uFallIntensity,uFallTime;uniform vec2 uResolution;uniform vec3 uCamera,uSun;uniform sampler2D uColor;varying vec4 vFall,vJet;varying vec2 vCross;varying vec3 vWorld,vSurfaceNormal;${GLSL_NOISE}
   void main(){
    float emitted=uFallTime-vFall.x,progress=vFall.w,layer=vJet.x;
    // Retarded emission time makes each field move downward with the same
    // accelerated parcel map. A coarse rolling field modulates fine rivulets.
    vec2 parcelQ=vec2(vCross.x*8.7+vJet.y*.31,emitted*9.4);
    vec2 warp=vec2(flowNoise(parcelQ*.37+vec2(5.4,1.8)),flowNoise(parcelQ*.37+vec2(1.1,6.9)))-.5;
    float broad=flowNoise(parcelQ*.53+warp*.92);
    float threads=flowNoise(parcelQ*vec2(2.41,.82)+warp*1.14);
    float micro=valueNoise(parcelQ*vec2(4.13,1.47)+vec2(2.7,9.2));
    float bandAA=1.-smoothstep(.65,1.8,length(fwidth(parcelQ)));
    vec3 N=normalize(vSurfaceNormal),V=normalize(uCamera-vWorld);if(dot(N,V)<0.)N=-N;
    float slope=(flowNoise(parcelQ+vec2(.045,0.))-flowNoise(parcelQ-vec2(.045,0.)))*3.8;
    N=normalize(N+vec3(slope,.05*sin(emitted*12.7+vCross.x*19.),(micro-.5)*.10)*bandAA);
    float NV=max(.02,dot(N,V)),fres=.0204+.9796*pow(1.-NV,5.);
    vec2 screen=clamp(gl_FragCoord.xy/uResolution+(viewMatrix*vec4(N,0.)).xy*.0022,.002,.998);
    vec3 under=vec3(.07,.13,.14)*(.2+.8*uDay);if(uFlowCapture<.5)under=texture2D(uColor,screen).rgb;
    float bulk=sqrt(max(0.,1.-vCross.x*vCross.x));
    float developed=smoothstep(.055,.66,progress);
    float bubbles=smoothstep(.53,.78,threads*.63+broad*.37+micro*.13);
    float torn=smoothstep(.38,.67,broad+threads*.18);
    float air=bubbles*(.15+developed*.85)*clamp(.08+uFallIntensity*3.8,0.,1.);
    float depth=(1.70+developed*.90+broad*.60)*bulk;
    float transmission=exp(-depth);
    float facing=max(0.,dot(N,normalize(uSun)));
    float light=.17+.61*uDay+.20*facing*uFlowSunStrength;
    vec3 clearWater=mix(vec3(.055,.19,.21),vec3(.18,.37,.38),smoothstep(.26,.73,broad))*light;
    vec3 aeratedWater=vec3(.72,.84,.83)*light;
    vec3 color=mix(clearWater,aeratedWater,air);
    // A thick central body retains limited coherent image transmission while
    // luminous entrained clusters interrupt it. Do not solve bulk by a flat
    // nearly-opaque cyan slab or by making every layer uniformly white.
    color=mix(color,under*vec3(.64,.83,.86),transmission*.14);
    float spec=pow(max(0.,dot(normalize(uSun+V),N)),126.);
    color+=spec*vec3(.91,.98,.89)*uFlowSunStrength*.25*(1.-air*.5);
    color+=vec3(.055,.10,.095)*fres*uDay;
    float edgeWidth=.91-progress*.045+(threads-.5)*.13;
    float bank=layer>.5?1.-smoothstep(.58,.97,abs(vJet.w)):1.-smoothstep(edgeWidth-.12,edgeWidth,abs(vCross.x));
    float alpha;
    if(layer>.5){
     float cluster=smoothstep(.43,.75,threads)*torn;
     color=mix(clearWater,aeratedWater,.68+air*.25);
     alpha=cluster*(.11+developed*.13)*clamp(uFallIntensity*4.2,.0,1.);
    }else alpha=(.47+.39*(1.-transmission))*(.86+.14*torn);
    alpha*=bank*smoothstep(0.,.018,progress)*(1.-smoothstep(.985,1.,progress))*uFlowActivity;
    gl_FragColor=vec4(color,alpha);${ENDING}
   }`});
  const mesh=new THREE.Mesh(fg,fm);mesh.name='Thick water core with advected aeration clusters and frayed rivulets';mesh.renderOrder=8;mesh.frustumCulled=false;group.add(mesh);fallMeshes.push(mesh);
 }

 const foamCount=220,dropCount=80,mistCount=0,count=foamCount+dropCount+mistCount;
 const positions=new Float32Array(count*3),sizes=new Float32Array(count),alphas=new Float32Array(count),kinds=new Float32Array(count),directions=new Float32Array(count*2);
 const particles=geometry(positions,null,{aSize:[sizes,1],aAlpha:[alphas,1],aKind:[kinds,1],aDirection:[directions,2]});
 const particleMaterial=material({uniforms,transparent:true,depthWrite:false,
  vertexShader:`uniform vec2 uResolution;attribute float aSize,aAlpha,aKind;attribute vec2 aDirection;varying float vAlpha,vKind;varying vec2 vDirection;varying vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*uResolution.y*.5/max(.1,-p.z),1.,32.);vAlpha=aAlpha;vKind=aKind;vDirection=aDirection;}`,
  fragmentShader:`uniform float uDay,uFlowCapture;varying vec3 vWorld;varying float vAlpha,vKind;varying vec2 vDirection;
  void main(){vec2 p=gl_PointCoord-.5;vec2 dir=normalize(vDirection+vec2(.0001,0.));p=vec2(dot(p,vec2(dir.y,-dir.x)),dot(p,dir));if(vKind<.5)p.x*=2.5;else if(vKind<1.5)p.x*=3.6;float r=dot(p,p)*4.;if(r>1.)discard;float a=exp(-r*(vKind>1.5?3.6:2.8))*(1.-smoothstep(.65,1.,r));vec3 c=mix(vec3(.57,.69,.66),vec3(.78,.87,.85),step(.5,vKind))*(.28+.72*uDay);gl_FragColor=vec4(c,a*vAlpha);${ENDING}}`});
 const points=new THREE.Points(particles,particleMaterial);points.name='Advected impact foam, ballistic droplets and wind mist';points.renderOrder=9;points.frustumCulled=false;group.add(points);
 const seeds=Array.from({length:count},(_,i)=>{const id=i<foamCount?i:i+160;return[rng(id*7+3),rng(id*7+4),rng(id*7+5),rng(id*7+6)];});
 const fall=flow.falls[0],impact=fall?.end||terrain.river[2],impactTravel=fall?.endTravelTime||1;
 const downView=new THREE.Vector3(),originView=new THREE.Vector3(),tempPoint=new THREE.Vector3();
 const foamSources=[impactTravel,flow.sampleAtDistance((flow.falls[0]?.endDistance??1)+.84).travelTime,flow.sampleAtDistance(Math.max(0,inlet.distance-.85)).travelTime,inlet.travelTime-.65];
 let elapsed=0;const heightCache=new Float64Array(p.length/3);let lastState=null;
 function vertexHeight(id,time=elapsed,wind=uniforms.uWind.value){
  const cached=time===elapsed&&wind===uniforms.uWind.value;
  if(cached&&Number.isFinite(heightCache[id]))return heightCache[id];
  const f={travelTime:meta[id*4+1],depth:meta[id*4+3],slope:section[id*4+2],halfWidth:section[id*4+1]};
  const y=p[id*3+1]+surfaceHeight(f,section[id*4],time),blend=lakeData[id*2];
  // Most attached stream vertices have no lake contribution. The omitted
  // wave would be multiplied by exactly zero in the shared surface blend.
  if(blend===0){if(cached)heightCache[id]=y;return y;}
  const ly=lakeSurfaceHeight(p[id*3],p[id*3+2],lakeData[id*2+1]+uniforms.uLakeLevel.value-terrain.lake.level,{...uniforms,uWind:{value:wind}},time);
  const result=y*(1-blend)+ly*blend;if(cached)heightCache[id]=result;return result;
 }
 // Static XZ indexing remains valid because the stream vertex shader only
 // displaces Y. Tilted channel sections can span many longitudinal rows.
 const triangleCell=.025,triangleGrid=new Map(),triangleStride=13,triangleData=new Float64Array(idx.length/3*triangleStride);
 for(let n=0;n<idx.length;n+=3){
  const ids=[idx[n],idx[n+1],idx[n+2]],xs=ids.map(i=>p[i*3]),zs=ids.map(i=>p[i*3+2]);
  const [ix,jx,kx]=xs,[iz,jz,kz]=zs,offset=n/3*triangleStride;
  // XZ never moves. Retain the original subtraction/division order while
  // caching its fixed terms; Y still comes from the live shared wave cache.
  const xMin=Math.min(...xs),xMax=Math.max(...xs),zMin=Math.min(...zs),zMax=Math.max(...zs);
  const xPad=(xMax-xMin)*.00002+1e-12,zPad=(zMax-zMin)*.00002+1e-12;
  triangleData.set([kx,kz,jz-kz,kx-jx,kz-iz,ix-kx,(jz-kz)*(ix-kx)+(kx-jx)*(iz-kz),xMin-xPad,xMax+xPad,zMin-zPad,zMax+zPad,idx[n],idx[n+1]],offset);
  const minX=Math.floor((Math.min(...xs)-.00001)/triangleCell),maxX=Math.floor((Math.max(...xs)+.00001)/triangleCell),minZ=Math.floor((Math.min(...zs)-.00001)/triangleCell),maxZ=Math.floor((Math.max(...zs)+.00001)/triangleCell);
  for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const key=x+':'+z;if(!triangleGrid.has(key))triangleGrid.set(key,[]);triangleGrid.get(key).push(n);}
 }
 function renderedHeight(x,z,time=elapsed,wind=uniforms.uWind.value){
  const bucket=triangleGrid.get(Math.floor(x/triangleCell)+':'+Math.floor(z/triangleCell));if(!bucket)return null;
  for(const n of bucket){
   const offset=n/3*triangleStride;
   // An accepted barycentric weight may be -1e-5. Twice that fraction of
   // each axis span conservatively bounds all three tolerant weights.
   if(x<triangleData[offset+7]||x>triangleData[offset+8]||z<triangleData[offset+9]||z>triangleData[offset+10])continue;
   const den=triangleData[offset+6];if(Math.abs(den)<1e-10)continue;
   const dx=x-triangleData[offset],dz=z-triangleData[offset+1],i=triangleData[offset+11],j=triangleData[offset+12],k=idx[n+2];
   const u=(triangleData[offset+2]*dx+triangleData[offset+3]*dz)/den,v=(triangleData[offset+4]*dx+triangleData[offset+5]*dz)/den,w=1-u-v;
   if(u>=-1e-5&&v>=-1e-5&&w>=-1e-5)return u*vertexHeight(i,time,wind)+v*vertexHeight(j,time,wind)+w*vertexHeight(k,time,wind);
  }return null;
 }
 const impactVFX=createWaterImpactVFX({terrain,flow,uniforms,surfaceHeight:renderedHeight});group.add(impactVFX.group);
 // Shared cloud integrator uniforms are borrowed from Weather. All water
 // layers use their actual fragment positions so a cloud in front can cover
 // the curtain instead of the whole waterfall being drawn over its face.
 let cloudBinding=null;
 function setCloudOcclusion(binding){
  if(binding===cloudBinding)return;cloudBinding=binding;
  for(const m of ownedMaterials){
   m.userData.cloudBaseFragment??=m.fragmentShader;
   if(binding?.glsl){Object.assign(m.uniforms,binding.uniforms);
    // The destination already contains front-cloud scattering. Normal alpha
    // composition needs the same Cf + T*surface in its source RGB, otherwise
    // multiplying source alpha by T darkens that cloud a second time.
    const composite=m.blending===THREE.AdditiveBlending?'gl_FragColor.a*=weatherCloudTransmittance(vWorld);':'gl_FragColor.rgb=weatherCloudComposite(vWorld,gl_FragColor.rgb);';
    m.fragmentShader=binding.glsl+'\n'+m.userData.cloudBaseFragment.replace('#include <tonemapping_fragment>','if(uFlowCapture<.5){'+composite+'}\n#include <tonemapping_fragment>');}
   else m.fragmentShader=m.userData.cloudBaseFragment;
   m.needsUpdate=true;
  }
  impactVFX.setCloudOcclusion?.(binding);
 }

 function update(dt,state,camera){
  // The simulation clock follows the parent and can be frozen or reset for
  // comparisons. Discharge remains the explicitly authored steady boundary.
  elapsed=state.time;
  uniforms.uFlowTime.value=elapsed;uniforms.uFallTime.value=elapsed*.70;uniforms.uFlowRate.value=1.+(state.effectiveRain??state.rain)*.18;uniforms.uFlowSunStrength.value=clamp(waterfallSunIntensity(state)*.24,0,1.3);
  const fingerprint=[elapsed,state.temperature,state.daylight,waterfallSunIntensity(state),state.effectiveRain,state.wind.x,state.wind.y,state.windStrength,uniforms.uLakeLevel.value,...camera.position.toArray(),...camera.quaternion.toArray()];
  if(lastState&&fingerprint.every((v,i)=>v===lastState[i]))return;lastState=fingerprint;heightCache.fill(NaN);
  const ice=THREE.MathUtils.smoothstep(-state.temperature,1,8),activity=1.-ice*.8;uniforms.uFlowActivity.value=activity;impactVFX.update(state,camera);
  for(let i=0;i<count;i++){
   const [a,b,c,d]=seeds[i];let x=0,y=0,z=0,size=0,alpha=0,kind=0,vx=0,vy=0,vz=0;
   if(i<foamCount){
    const lifespan=i%4===0?5.2:10.0,age=(elapsed+a*lifespan)%lifespan,life=1.-age/lifespan;
    const groupIndex=i%4,start=foamSources[groupIndex];
    const lateral=(b*2-1)*.76,bank=.42+.58*(1-lateral*lateral),t=start+age*bank;
    let wetPoint=true;
    const transition=smooth(inlet.travelTime-.45,inlet.travelTime+1.8,t);
    const tracer=inletTracer(Math.max(0,t-inlet.travelTime),lateral,uniforms);
    let riverX=tracer.x,riverZ=tracer.z,tx=inlet.direction[0],tz=inlet.direction[1],riverBed=null;
    if(transition<.999){const center=flow.sampleAtTime(Math.min(t,flow.totalTravelTime),false),cs=flow.crossSectionAtDistance(center.distance,clamp(lateral,-.92,.92),center);riverX=cs.position[0];riverZ=cs.position[2];tx=center.tangent[0];tz=center.tangent[2];riverBed=cs.bedHeight;}
    x=riverX*(1-transition)+tracer.x*transition;z=riverZ*(1-transition)+tracer.z*transition;
    const bed=transition===0&&riverBed!==null?riverBed:tracer.s>.30&&field?.sampleHeight?field.sampleHeight(x,z):terrain.height(x,z),depth=uniforms.uLakeLevel.value-bed;
    const ly=lakeSurfaceHeight(x,z,depth,uniforms,elapsed),ry=renderedHeight(x,z);
    y=Math.max(ry??-1e6,depth>.012?ly:-1e6)+.006;
    wetPoint=(ry!==null||depth>.012)&&y>bed+.001;
    alpha=1-smooth(1.25,2.15,tracer.s);vx=inlet.direction[0]*transition+tx*(1-transition);vz=inlet.direction[1]*transition+tz*(1-transition);
    size=.009+c*.024;alpha*=Math.pow(life,.48)*(.39+life*.31)*activity*.43*(wetPoint?1:0);kind=0;
   }else if(i<foamCount+dropCount&&fall){
    const sheet=i%4===0;
    if(sheet){
     const age=(elapsed*.70+a*fall.duration)%fall.duration,s=fall.sampleAtTime(age),pos=s.position||s,progress=age/fall.duration;
     x=pos[0]+(b*2-1)*(s.halfWidth||fall.halfWidth)*.85;y=pos[1];z=pos[2]+.024+(c-.5)*progress*.08;
     vx=fall.entrySpeed*.04;vy=-(fall.entryVerticalSpeed+9.81*age);vz=fall.entrySpeed;
     size=.025+c*.032;alpha=smooth(.12,.55,progress)*(.07+d*.11)*activity*uniforms.uFallIntensity.value;kind=1;
    }else{
     const up=.65+b*.85,duration=2*up/9.81,age=(elapsed+a*duration)%duration,angle=c*Math.PI*2,radial=.35+d*.55;
     vx=Math.cos(angle)*radial;vz=Math.sin(angle)*radial*.65+.18;vy=up-9.81*age;
     x=impact[0]+vx*age;y=impact[1]+.012+up*age-4.905*age*age;z=impact[2]+vz*age;
     size=.012+c*.02;alpha=(1.-age/duration)*.60*activity;kind=1;
     if(y<terrain.height(x,z)+.009)alpha=0;
    }
   }else{
    const life=.65+a*.55,age=(elapsed*.7+b*life)%life,phase=age/life,angle=c*Math.PI*2;
    x=impact[0]+Math.cos(angle)*phase*.18+state.wind.x*state.windStrength*age*.14;
    y=impact[1]+.03+phase*.12;z=impact[2]+Math.sin(angle)*phase*.12+state.wind.y*state.windStrength*age*.14;
    size=.065+phase*.15;alpha=Math.sin(phase*Math.PI)*.04*activity;kind=2;
   }
   positions[i*3]=x;positions[i*3+1]=y;positions[i*3+2]=z;sizes[i]=size;alphas[i]=alpha;kinds[i]=kind;
   tempPoint.set(x,y,z).project(camera);originView.copy(tempPoint);tempPoint.set(x+vx*.02,y+vy*.02,z+vz*.02).project(camera);downView.subVectors(tempPoint,originView);
   directions[i*2]=downView.x*camera.aspect;directions[i*2+1]=-downView.y;
  }
  for(const name of ['position','aSize','aAlpha','aKind','aDirection'])particles.attributes[name].needsUpdate=true;
 }
 return{group,flow,inlet,stream,falls:fallMeshes,impactVFX,uniforms,update,renderedHeight,setCloudOcclusion,setDebug(n=0){uniforms.uFlowDebug.value=n;},stats:{method:'1D steady discharge + accelerated ballistic fall + advected clear-water optics',field:flow.diagnostics,inlet,streamTriangles:idx.length/3,foamParticles:foamCount,ballisticParticles:dropCount,mistParticles:mistCount,impact:impactVFX.stats,fallVolumeLayers:4,fallVolumeTriangles:fallMeshes.reduce((n,m)=>n+m.geometry.index.count/3,0),fallIntensity:.18,apparentFallRate:.70,dischargeRatio:.0095/.0135,fallWidthRatio:.86,streamDetail:FLOW_PARCEL_CONFIG.representation,parcelOptics:FLOW_PARCEL_CONFIG,glintOptics:FLOW_GLINT_CONFIG,streamPath:'actual view path with bounded subgrid turbulent-scattering floor',full3DFluidSolver:false},dispose(){impactVFX.dispose();for(const g of ownedGeometry)g.dispose();for(const m of ownedMaterials)m.dispose();}};
}
function smooth(a,b,x){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
function surfaceHeight(s,lateral,time){const bank=.42+.58*(1-lateral*lateral),age=s.travelTime-time,cross=lateral*s.halfWidth,amp=Math.min(s.depth*.20,.008)*(1+Math.min(s.slope,1)*.9);return amp*(Math.sin(age*2.0+cross*13)*.54+Math.sin(age*3.1-cross*21+.7)*.30+Math.sin(age*4.4+cross*7)*.16)*(1-Math.pow(Math.abs(lateral),6));}
