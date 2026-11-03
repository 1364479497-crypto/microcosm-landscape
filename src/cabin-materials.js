import * as THREE from 'three';

// Original, texture-free PBR surfaces. Coordinates are in the miniature's
// scene units; color, roughness and relief share the same weathering fields.
const IDENTITIES = {
  timber: {color:0x7b6f5e, roughness:.88, kind:0, bump:.00110},
  joinery: {color:0x686050, roughness:.87, kind:0, bump:.00100},
  plaster: {color:0xbdbba5, roughness:.96, kind:1, bump:.00085},
  stone: {color:0x858b7d, roughness:.94, kind:2, bump:.00110},
  tiles: {color:0x3d4846, roughness:.86, kind:3, bump:.00055},
  recess: {color:0x41463e, roughness:.98, kind:4, bump:0},
  iron: {color:0x646c65, roughness:.73, metalness:.48, kind:4, bump:0},
};

const fields = /* glsl */`
uniform float uCabinWet,uCabinSnow,uCabinDebug;
varying vec3 vCabinP,vCabinN;
varying vec2 vCabinUV;
varying vec4 vCabinData;
float cbHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float cbNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(cbHash(i),cbHash(i+vec2(1.,0.)),f.x),mix(cbHash(i+vec2(0.,1.)),cbHash(i+1.),f.x),f.y);}
float cbFine(vec2 p){float fade=1.-smoothstep(.35,1.5,max(length(dFdx(p)),length(dFdy(p))));return (cbNoise(p)-.5)*fade;}
vec3 cbBump(vec3 N,float height){vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition);vec3 r1=cross(q1,N),r2=cross(N,q0);float det=dot(q0,r1);vec3 grad=sign(det)*(dFdx(height)*r1+dFdy(height)*r2);return normalize(abs(det)*N-grad);}
`;

export function createCabinMaterials(seed=42){
  const uniforms={wet:{value:0},snow:{value:0},debug:{value:0}};
  const materials={};
  for(const [slot,id] of Object.entries(IDENTITIES)){
    const material=new THREE.MeshStandardMaterial({color:id.color,roughness:id.roughness,metalness:id.metalness||0});
    material.name=`Cabin ${slot}: causal procedural PBR`;
    material.userData={slot,identity:{...id},coordinateScale:'scene units',seed,debugModes:{0:'beauty',1:'rain exposure',2:'ground moisture',3:'material relief',4:'roughness'}};
    material.onBeforeCompile=shader=>{
      shader.uniforms.uCabinWet=uniforms.wet;shader.uniforms.uCabinSnow=uniforms.snow;shader.uniforms.uCabinDebug=uniforms.debug;
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute vec4 aCabinData;
varying vec3 vCabinP,vCabinN;
varying vec2 vCabinUV;
varying vec4 vCabinData;`).replace('#include <begin_vertex>',`#include <begin_vertex>
vCabinP=position;vCabinN=normal;vCabinUV=uv;vCabinData=aCabinData;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+fields);
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
vec3 cbP=vCabinP;
float cbKind=${id.kind.toFixed(1)};
float cbPart=vCabinData.x;
float cbUp=smoothstep(.30,.88,vCabinN.y);
vec2 cbWall=abs(vCabinN.x)>.55?cbP.zy:cbP.xy;
// Eaves protect the upper vertical wall. Rain streaks begin below that zone;
// capillary moisture belongs to the stone sill and lower wall, not the roof.
float cbRain=vCabinData.y*mix(.18,.82,1.-smoothstep(.13,.48,cbP.y))*(1.-cbUp*.38)+cbUp*.76;
float cbGround=(1.-smoothstep(.035,.25,cbP.y))*(.50+.50*cbNoise(cbP.xz*14.));
float cbStreak=cbNoise(vec2((cbP.x+cbP.z*.73)*37.,cbP.y*2.4));
cbStreak=smoothstep(.36,.78,cbStreak)*cbRain;
float cbBroad=cbNoise(cbP.xz*13.+cbP.y*4.);
float cbMoist=clamp(uCabinWet*(.28+cbRain*.72)+cbGround*.25,0.,1.);
float cbRelief=0.,cbWeather=0.,cbWear=0.;
if(cbKind<.5){
  vec2 wood=vCabinUV+vec2(vCabinData.w*.31,vCabinData.w*.19);
  float warp=cbNoise(wood*vec2(43.,4.2))*.45+sin(wood.y*16.)*.075;
  vec2 knotCenter=vec2(vCabinData.w*.31+(cbHash(vec2(vCabinData.w*19.,1.))-.5)*.022,vCabinData.w*.19+(cbHash(vec2(3.,vCabinData.w*23.))-.5)*.17);
  vec2 knotQ=(wood-knotCenter)*vec2(110.,24.);
  float knotRadius=length(knotQ),knotMask=(1.-smoothstep(.55,1.65,knotRadius))*step(.67,vCabinData.w);
  float wave=(wood.x*103.+warp+knotMask*.45)*6.2831853;
  float band=smoothstep(.15,.86,sin(wave))*(1.-smoothstep(.8,2.7,fwidth(wave)));
  float finePhase=wood.x*2600.+warp*6.;
  float fiber=sin(finePhase)*(1.-smoothstep(.7,2.3,fwidth(finePhase)));
  float meso=cbNoise(wood*vec2(96.,5.5));
  float splitPath=vCabinData.w*.31+(cbHash(vec2(vCabinData.w*17.,8.))-.5)*.020+sin(wood.y*29.+vCabinData.w*9.)*.0008+sin(wood.y*87.)*.00022;
  float splitCenter=vCabinData.w*.19+(cbHash(vec2(4.,vCabinData.w*13.))-.5)*.18;
  float split=(1.-smoothstep(.00020,.00085,abs(wood.x-splitPath)))*(1.-smoothstep(.075,.16,abs(wood.y-splitCenter)))*step(.24,vCabinData.w);
  float knotRing=(.5+.5*sin(knotRadius*19.))*knotMask;
  float silver=.12+cbRain*.16+meso*.13;
  cbWeather=cbStreak*.13+cbGround*.16;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.285,.278,.242),silver);
  diffuseColor.rgb*=.91+cbPart*.18+meso*.18-band*.18+fiber*.035-split*.30-knotRing*.18;
  cbRelief=band*.25+fiber*.10-split*.75-knotRing*.18+(meso-.5)*.4;
}else if(cbKind<1.5){
  float wash=cbNoise(cbWall*8.+cbNoise(cbWall*2.8)*1.3);
  float pores=cbFine(cbWall*173.);
  float jointAge=max(1.-smoothstep(.008,.044,abs(cbP.y-.121)),(1.-smoothstep(.009,.038,abs(cbP.y-.492)))*.45);
  float peelCause=clamp(cbGround*.78+jointAge*.64+cbStreak*.18,0.,1.);
  float flakeField=cbNoise(cbWall*vec2(39.,51.)+cbNoise(cbWall*17.)*.65);
  float flake=smoothstep(.70,.83,flakeField+peelCause*.16)*peelCause;
  float crackPath=.19+sin(cbP.y*9.)*.018+sin(cbP.y*84.)*.0021;
  float crack=(1.-smoothstep(.00035,.00115,abs(cbWall.x-crackPath)))*smoothstep(.515,.55,cbP.y)*(1.-smoothstep(.71,.77,cbP.y));
  cbWeather=cbStreak*.23+cbGround*.24+(1.-wash)*.045+crack*.26;
  diffuseColor.rgb*=.85+wash*.22+cbPart*.035;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.24,.226,.184),flake*.72);
  cbRelief=pores*.28+(wash-.5)*.6-flake*.9-crack*.7;
}else if(cbKind<2.5){
  float grain=cbFine(vCabinUV*190.);
  float stoneRole=vCabinData.w;
  float course=cbP.y/.057+cbNoise(vec2(cbWall.x*28.,0.))*.028;
  float mortarY=(1.-smoothstep(.012,.038,min(fract(course),1.-fract(course))))*.64;
  float across=abs(vCabinN.x)>.5?cbP.z:cbP.x;
  float joint=abs(fract(across/.108+floor(course)*.5)-.5)*.108;
  float mortar=max(mortarY,(1.-smoothstep(.0005,.0022,joint))*.55)*(1.-cbUp)*float(stoneRole>.5&&stoneRole<1.5);
  float stonePatch=cbNoise(vCabinUV*33.+cbNoise(vCabinUV*9.)*.7);
  float pits=smoothstep(.74,.89,cbNoise(vCabinUV*vec2(141.,119.)));
  float stoneMoss=smoothstep(.66,.83,cbNoise(cbP.xz*30.+cbP.y*7.))*cbGround;
  cbWear=float(stoneRole>1.5&&stoneRole<2.5)*cbUp*(1.-smoothstep(.075,.145,abs(vCabinUV.x)))*(1.-smoothstep(.025,.072,abs(vCabinUV.y-.01)));
  cbWeather=cbGround*.16+cbStreak*.08+mortar*.28+pits*.07;
  float soot=vCabinData.z*smoothstep(.86,1.04,cbP.y);
  diffuseColor.rgb*=.78+cbPart*.32+stonePatch*.20-soot*.47+cbWear*.07;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.19,.227,.15),stoneMoss*.31);
  cbRelief=grain*.30+(stonePatch-.5)*.65-mortar*.85-pits*.4;
}else if(cbKind<3.5){
  float kiln=cbNoise(vCabinUV*vec2(35.,11.));
  float roofMoss=smoothstep(.56,.78,cbNoise(cbP.xz*21.+cbNoise(cbP.xz*7.)))*(1.-smoothstep(.04,.29,cbP.z))*cbUp;
  float tileRun=vCabinData.z>.5?cbP.z-.388:abs(cbP.x);
  float lap=(1.-smoothstep(.006,.020,fract(tileRun/.078)*.078))*.055;
  cbWeather=cbStreak*.045+roofMoss*.09+lap;
  diffuseColor.rgb*=.76+cbPart*.35+kiln*.085;
  diffuseColor.rgb*=mix(vec3(1.055,1.018,.94),vec3(.965,1.02,1.035),cbPart);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.070,.095,.055),roofMoss*.43);
  cbRelief=cbFine(vCabinUV*190.)*.25+kiln*.22+roofMoss*.25;
}
diffuseColor.rgb*=1.-cbWeather-cbMoist*.17;
float cbSnow=smoothstep(.31,.78,vCabinN.y)*smoothstep(.12,.85,uCabinSnow+(cbBroad-.5)*.15);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.87,.91,.92),cbSnow*.96);
if(uCabinDebug> .5&&uCabinDebug<1.5)diffuseColor.rgb=vec3(cbRain);
if(uCabinDebug>1.5&&uCabinDebug<2.5)diffuseColor.rgb=vec3(cbGround);
if(uCabinDebug>2.5&&uCabinDebug<3.5)diffuseColor.rgb=vec3(cbRelief*.5+.5);`);
      // Roughness and derivative-filtered relief inherit the same causes.
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
roughnessFactor=clamp(roughnessFactor+cbWeather*.23-cbMoist*.29-cbWear*.19+abs(cbRelief)*.035,.44,.99);
roughnessFactor=mix(roughnessFactor,.94,cbSnow);
if(uCabinDebug>3.5)diffuseColor.rgb=vec3(roughnessFactor);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
normal=cbBump(normal,cbRelief*${id.bump.toFixed(7)}*(1.-cbSnow*.85));
float cbVariance=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));
roughnessFactor=clamp(sqrt(roughnessFactor*roughnessFactor+cbVariance*.20),.44,1.);`);
    };
    material.customProgramCacheKey=()=>`cabin-causal-pbr-6-${slot}`;
    materials[slot]=material;
  }
  materials.glass=new THREE.MeshStandardMaterial({color:0xb9ad83,emissive:0xe9b66a,emissiveIntensity:.23,roughness:.46,metalness:0});
  materials.glass.name='Cabin subdued warm paper-glass';
  materials.glass.userData={slot:'glass',identity:'warm inhabited window, diffuse paper-glass'};
  let disposed=false;
  return {materials,uniforms,update(state={}){uniforms.wet.value=THREE.MathUtils.clamp(Number(state.wetness)||0,0,1);uniforms.snow.value=THREE.MathUtils.clamp(Number(state.snow)||0,0,1);const day=Number.isFinite(state.daylight)?THREE.MathUtils.clamp(state.daylight,0,1):1;materials.glass.emissiveIntensity=.13+(1-day)*.94;},setDebug(mode=0){uniforms.debug.value=mode;},dispose(){if(disposed)return;disposed=true;Object.values(materials).forEach(m=>m.dispose());}};
}
