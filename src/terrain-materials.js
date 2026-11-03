import * as THREE from 'three';
import {LAKE_SPEC} from './terrain-field.js';
import {SOIL_SECTION_GLSL} from './soil-section.js';

// These are original procedural rock/soil identities. There are no downloaded
// surface maps: world-sized mineral, fracture, moisture, and snow causes own
// the related PBR channels, while geometry owns all silhouette relief.
const FIELDS = /* glsl */`
uniform float uLandSeason;
uniform float uLandSnow;
uniform float uLandWet;
uniform float uLandRockOnly;
uniform float uLandHasField;
uniform float uLandDebug;
uniform sampler2D uLandField;
uniform vec4 uLandLake;
uniform float uLandLakeLevel;
varying vec3 vLandPosition;
varying vec3 vLandNormal;
varying float vLandWaterway;
varying vec3 vLandRockStructure;
varying vec2 vLandWetland;
float landHash(vec3 p) {
  p=fract(p*.1031); p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
float landNoise(vec3 p) {
  vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(landHash(i),landHash(i+vec3(1,0,0)),f.x),
                 mix(landHash(i+vec3(0,1,0)),landHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(landHash(i+vec3(0,0,1)),landHash(i+vec3(1,0,1)),f.x),
                 mix(landHash(i+vec3(0,1,1)),landHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float landFbm(vec3 p) {
  float f=landNoise(p)*.5714;
  p=mat3(1.65,.24,.15,-.16,1.89,.18,.21,-.17,1.96)*p+vec3(8.2,-4.1,7.6);
  f+=landNoise(p)*.2857;
  return f+landNoise(p*2.03+4.13)*.1429;
}
float landBeddingCoordinate(vec3 p) {
  float bx=p.x+.24*sin(p.z*.6)+.12*sin(p.x*.41+p.z*.37);
  float bz=p.z+.18*sin(p.x*.7-p.z*.23);
  float warp=.115*sin(bx*.83+bz*.31)+.068*sin(bz*1.21-bx*.27)+.032*sin(bx*3.1+bz*1.7);
  float h=p.y-.43;
  return (h+warp)/.278+.16*sin(h*2.37)+.045*sin(h*5.41);
}
vec3 landSeasonColor(float season) {
  vec3 spring=vec3(.177,.278,.082);
  vec3 summer=vec3(.172,.259,.076);
  vec3 autumn=vec3(.282,.202,.082);
  vec3 winter=vec3(.199,.205,.141);
  float s=mod(max(season,0.0),4.0);
  if(s<1.0)return mix(spring,summer,s*s*(3.0-2.0*s));
  if(s<2.0){s-=1.0;return mix(summer,autumn,s*s*(3.0-2.0*s));}
  if(s<3.0){s-=2.0;return mix(autumn,winter,s*s*(3.0-2.0*s));}
  s-=3.0;return mix(winter,spring,s*s*(3.0-2.0*s));
}
vec3 landBump(vec3 N,vec3 eyePosition,float relief) {
  vec3 qx=dFdx(eyePosition),qy=dFdy(eyePosition);
  vec3 rx=cross(qy,N),ry=cross(N,qx);
  float determinant=dot(qx,rx);
  vec3 gradient=sign(determinant)*(dFdx(relief)*rx+dFdy(relief)*ry);
  return normalize(abs(determinant)*N-gradient);
}
`;

const VERTEX = /* glsl */`
vec4 landWorld=vec4(transformed,1.0);
#ifdef USE_INSTANCING
landWorld=instanceMatrix*landWorld;
#endif
vLandPosition=(modelMatrix*landWorld).xyz;
vLandNormal=inverseTransformDirection(transformedNormal,viewMatrix);
vLandWaterway=landWaterway;
vLandRockStructure=landRockStructure;
vLandWetland=landWetland;
`;

const ROCK_IDENTITY = /* glsl */`
vec3 landP=vLandPosition;
vec3 landN=normalize(vLandNormal);
float landUp=clamp(landN.y,0.0,1.0);
float landRegion=landFbm(landP*vec3(.65,.39,.65));
vec3 landWarp=vec3(landRegion,landNoise(landP*.91+12.7),landNoise(landP*.83-6.4))-.5;
vec3 landGeology=mat3(.79,.17,.59,-.13,.99,-.11,-.60,.01,.80)*(landP+landWarp*.35);
float landMineral=landFbm(landGeology*vec3(3.7,1.5,3.1));
float landFaultField=landFbm(landGeology*vec3(2.1,.83,2.7)+landWarp*.9+5.7);
float landJoint=(1.0-smoothstep(.012,.047,abs(landFaultField-.48)))*smoothstep(.18,.40,landMineral);
float landBedCoordinate=landBeddingCoordinate(landP);
float landBedPhase=fract(landBedCoordinate);
float landBedIndex=floor(landBedCoordinate);
float landBedTone=fract(sin(landBedIndex*127.1+3.17)*43758.5453);
float landBedding=(1.0-smoothstep(.018,.105,landBedPhase))*.56;
float landPieceJoint=vLandRockStructure.x*(1.0-uLandRockOnly);
float landPieceTone=mix(vLandRockStructure.y,landNoise(landGeology*2.1+7.3),uLandRockOnly);
float landPieceSpall=vLandRockStructure.z*(1.0-uLandRockOnly);
float landCrack=max(max(landJoint,landBedding*.60),landPieceJoint*.95);
float landExposure=smoothstep(.30,.78,landUp);
float landMossPatch=landFbm(landP*vec3(1.7,1.35,1.7)+vec3(9.,3.,-4.));
float landMoss=smoothstep(.76,.98,landUp)*smoothstep(.46,.69,landMossPatch);
float landGrass=landExposure*(1.0-smoothstep(.92,2.28,landP.y));
landGrass*=1.0-uLandRockOnly;
float landShore=1.0-smoothstep(.08,.35,abs(landP.y-.18));
float landBankPatch=smoothstep(.35,.67,landMossPatch);
landGrass*=1.0-landShore*mix(.82,.25,landBankPatch);
landGrass*=smoothstep(.165,.265,landP.y);
float landBankCreep=landShore*smoothstep(.36,.68,landUp)*landBankPatch*smoothstep(.175,.245,landP.y);
landGrass=max(landGrass,landBankCreep*.72*(1.-uLandRockOnly));
landGrass*=1.0-vLandWaterway;
landMoss*=1.0-vLandWaterway;
float landFineFilter=1.0-smoothstep(.012,.065,length(fwidth(landP)));
float landMesoFilter=1.0-smoothstep(.045,.15,length(fwidth(landP)));
float landChips=landNoise(landGeology*vec3(17.0,19.0,15.0))*.63+landNoise(landGeology*31.0+11.3)*.37;
float landMicro=landNoise(landP*57.0)*.62+landNoise(landGeology*91.0+7.1)*.38;
vec4 landShared=texture2D(uLandField,clamp((landP.xz+vec2(6.0,5.3))/vec2(12.0,9.6),0.0,1.0));
float landWet=clamp(max(max(uLandWet,landShared.r*uLandHasField),vLandWaterway*.60)+landShore*.23,0.0,1.0);
float landSnow=clamp(max(uLandSnow,landShared.g*uLandHasField),0.0,1.0);
landSnow*=smoothstep(.35,.86,landUp)*smoothstep(.19,.52,landP.y);
landSnow*=smoothstep(.16,.68,landRegion+landSnow*.54);
vec3 landRock=mix(vec3(.085,.092,.090),vec3(.194,.191,.172),landMineral);
vec3 landBedTint=mix(vec3(.92,.95,.98),vec3(1.07,1.01,.91),landBedTone);
landRock*=landBedTint*(.87+.24*landBedTone);
landRock*=mix(vec3(.80,.84,.87),vec3(1.16,1.12,1.05),landPieceTone);
landRock*=.90+.23*landRegion;
landRock*=1.0-landCrack*.27-landPieceSpall*.075;
landRock*=1.0+(landChips-.5)*.17*landMesoFilter;
vec3 landMossColor=landSeasonColor(uLandSeason)*mix(.74,1.13,landMineral);
vec3 landColor=mix(landRock,landMossColor,landMoss*.73);
landColor=mix(landColor,landSeasonColor(uLandSeason)*(.79+landMineral*.54),landGrass);
landColor=mix(landColor,vec3(.245,.233,.179),landShore*(1.0-landGrass)*mix(.45,.18,landBankPatch));
landColor=mix(landColor,vec3(.175,.160,.117)*(.80+landMineral*.32),vLandWaterway*.73);
float landAlluvium=vLandWetland.x*(1.-uLandRockOnly);
vec3 landSilt=mix(vec3(.125,.106,.071),vec3(.225,.205,.155),landChips);
landColor=mix(landColor,landSilt,landAlluvium*.80);
landColor*=1.0-landWet*(.22+.13*(1.-landBankPatch)*landShore);
landColor*=1.0+(landMicro-.5)*.13*landFineFilter;
landColor=mix(landColor,vec3(.79,.835,.85)*( .89+landMineral*.15),landSnow*.96);
// The mountain bedding field is a height coordinate. Projecting its repeated
// strata over the concave lake bowl produced artificial concentric dark arcs.
// Only the submerged ground inside the bounded lake changes identity here;
// every above-water surface has an exactly zero bed weight.
vec2 landLakeQ=(landP.xz-uLandLake.xy)/uLandLake.zw;
float landLakeBed=(1.-smoothstep(1.04,1.16,length(landLakeQ)))*(1.-smoothstep(uLandLakeLevel-.045,uLandLakeLevel-.002,landP.y))*(1.-uLandRockOnly);
float landSediment=landNoise(landP*vec3(11.3,2.5,12.7)+vec3(9.1,-3.7,6.5));
float landSiltGrain=landNoise(landP*vec3(87.,42.,93.));
vec3 landLakeSilt=mix(vec3(.123,.114,.086),vec3(.218,.203,.161),landSediment);
landLakeSilt*=.94+(landSiltGrain-.5)*.13*landFineFilter;
landColor=mix(landColor,landLakeSilt,landLakeBed);
diffuseColor.rgb*=landColor;
if(uLandDebug>.5&&uLandDebug<1.5)diffuseColor.rgb=vec3(landRegion);
if(uLandDebug>1.5&&uLandDebug<2.5)diffuseColor.rgb=vec3(landGrass,landMoss,landCrack);
if(uLandDebug>2.5&&uLandDebug<3.5)diffuseColor.rgb=vec3(landWet,landSnow,landUp);
if(uLandDebug>4.5)diffuseColor.rgb=vec3(landPieceJoint,landPieceTone,landPieceSpall);
if(uLandDebug>5.5)diffuseColor.rgb=vec3(landLakeBed);
float landRelief=((landMineral-.5)*.030-landCrack*.009-landBedding*.006)*(1.0-landGrass*.65);
landRelief+=((landChips-.5)*.015-landPieceJoint*.005)*landMesoFilter*(1.0-landGrass*.82);
landRelief+=(landMicro-.5)*.009*landFineFilter;
landRelief*=1.0-landSnow*.85;
landRelief=mix(landRelief,((landSediment-.5)*.0015+(landSiltGrain-.5)*.0005)*landFineFilter,landLakeBed);
`;

const CUT_FIELDS = /* glsl */`
attribute float sectionTop;
varying float vSectionTop;
`;

const CUT_IDENTITY = /* glsl */`
vec3 cutP=vLandPosition;
vec3 cutLensShape=soilSectionLens(cutP.xz);
vec2 cutHorizons=soilSectionHorizons(cutP.xz);
float cutDepth=vSectionTop-cutP.y;
float cutGrain=landFbm(cutP*vec3(55.,63.,51.));
float cutClods=landFbm(cutP*vec3(14.,20.,13.));
float cutDetailFilter=1.-smoothstep(.012,.05,length(fwidth(cutP)));
float cutDrift=cutLensShape.x+.86;
float cutY=cutP.y-cutHorizons.x;
// A thicker warm A horizon feathers into AB; only the existing thin root mat
// remains dark. Low lake-cut banks compress the organic depth above the lens.
float cutHumusDepth=min(cutHorizons.y,max(.085,(vSectionTop+.48)*.67));
float cutOrganic=1.-smoothstep(cutHumusDepth-.035,cutHumusDepth+.035,cutDepth);
float cutTransition=1.-smoothstep(cutHumusDepth+.105,cutHumusDepth+.195,cutDepth);
float cutRootMat=1.-smoothstep(.035+cutClods*.013,.061+cutClods*.012,cutDepth);
float cutTan=smoothstep(-.57,-.49,cutY)*(1.-cutTransition);
float cutIron=(1.-smoothstep(-.57,-.49,cutY))*smoothstep(cutLensShape.x+.035,cutLensShape.x+.17,cutP.y);
float cutGravel=(1.-smoothstep(cutLensShape.y*.45,cutLensShape.y*1.28,abs(cutP.y-cutLensShape.x)))*(.47+.53*cutLensShape.z);
cutGravel*=1.-cutTransition;
float cutLaminate=landNoise(vec3(cutP.x*1.8,(cutP.y-cutHorizons.x)*31.,cutP.z*1.8));
float cutPores=smoothstep(.72,.86,landNoise(cutP*vec3(122.,106.,119.)))*cutDetailFilter;
// Independent broad soil identities remain readable at the composition scale;
// shared irregular boundaries and restrained laminations join them in close view.
vec3 cutColor=vec3(.390,.286,.160)*(.91+cutClods*.18);
cutColor=mix(cutColor,vec3(.283,.122,.046)*(.92+cutClods*.17),cutIron*.88);
float cutLower=1.-smoothstep(-1.24+cutDrift*.62,-1.14+cutDrift*.62,cutP.y);
float cutSand=smoothstep(-1.18,-1.11,cutP.y-cutDrift*.64)*(1.-smoothstep(cutLensShape.x-cutLensShape.y*.89,cutLensShape.x-cutLensShape.y*.53,cutP.y));
// Buff mineral soil, rusty iron, cool olive gravel matrix and grey parent
// material separate the existing horizons without adding painted layer lines.
cutColor=mix(cutColor,vec3(.348,.290,.184)*(.94+cutClods*.12),cutSand*.64);
cutColor=mix(cutColor,vec3(.115,.133,.119)*(.90+cutClods*.20),cutLower*.96);
cutColor=mix(cutColor,vec3(.180,.187,.158)*(.91+cutClods*.18),cutGravel*.87);
cutColor=mix(cutColor,vec3(.245,.142,.066)*(.90+cutClods*.20),cutTransition*.93);
cutColor=mix(cutColor,vec3(.153,.100,.051)*(.89+cutClods*.22),cutOrganic*.96);
cutColor=mix(cutColor,vec3(.109,.076,.039)*(.94+cutGrain*.15),cutRootMat*.71);
cutColor*=(.96+cutGrain*.09)*(1.-cutPores*.10);
cutColor*=1.-(1.-cutOrganic)*(.012+.023*cutLaminate);
float cutWet=clamp(uLandWet,0.,1.);cutColor*=1.-cutWet*.17;
diffuseColor.rgb*=cutColor;
if(uLandDebug>3.5)diffuseColor.rgb=vec3(cutOrganic,cutGravel,cutTan);
float cutFilter=cutDetailFilter;
float cutRelief=(cutClods-.5)*.009+((cutGrain-.5)*.0035-cutPores*.0016)*cutFilter;
`;

function extendMaterial(material,uniforms,{cut=false}={}) {
  material.defaultAttributeValues={...material.defaultAttributeValues,landWetland:[0,0]};
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nvarying vec3 vLandPosition;\nvarying vec3 vLandNormal;\nattribute float landWaterway;\nvarying float vLandWaterway;\nattribute vec3 landRockStructure;\nvarying vec3 vLandRockStructure;\nattribute vec2 landWetland;\nvarying vec2 vLandWetland;\n${cut?CUT_FIELDS:''}`);
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>\n${VERTEX}\n${cut?'vSectionTop=sectionTop;':''}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${FIELDS}\n${cut?'varying float vSectionTop;'+SOIL_SECTION_GLSL:''}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n${cut?CUT_IDENTITY:ROCK_IDENTITY}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\n${cut?'roughnessFactor=clamp(.96-cutWet*.18, .68, .99);':'roughnessFactor=clamp(.89+(landMineral-.5)*.17+landCrack*.05+(landChips-.5)*.06*landMesoFilter-landWet*.27-landSnow*.04,.46,.99);roughnessFactor=mix(roughnessFactor,.91,landLakeBed);'}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\nnormal=landBump(normal,-vViewPosition,${cut?'cutRelief':'landRelief'});\nfloat landVariance=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));\nroughnessFactor=clamp(sqrt(roughnessFactor*roughnessFactor+landVariance*.35),.43,1.0);`);
    // A is shared cloud light transmission. It owns direct light only, keeping
    // ambient snow response and emissive night contributions independent.
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>\nfloat landCloudTransmission=mix(1.0,texture2D(uLandField,clamp((vLandPosition.xz+vec2(6.0,5.3))/vec2(12.0,9.6),0.0,1.0)).a,uLandHasField);\nfloat landCloudDirect=mix(.55,1.0,landCloudTransmission);\nreflectedLight.directDiffuse*=landCloudDirect;\nreflectedLight.directSpecular*=landCloudDirect;`);
    material.userData.shader=shader;
  };
  material.customProgramCacheKey=()=>cut?'independent-cutaway-v10-distinct-earth-horizons':'independent-crag-submerged-bed-v7';
  return material;
}

export function createLandMaterials(field) {
  const empty=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1,THREE.RGBAFormat);
  empty.needsUpdate=true;
  const shared={
    uLandSeason:{value:0},uLandSnow:{value:0},uLandWet:{value:0},
    uLandRockOnly:{value:0},uLandHasField:{value:field?.texture?1:0},
    uLandDebug:{value:0},uLandField:{value:field?.texture||empty},
    uLandLake:{value:new THREE.Vector4(LAKE_SPEC.x,LAKE_SPEC.z,LAKE_SPEC.rx,LAKE_SPEC.rz)},uLandLakeLevel:{value:LAKE_SPEC.level},
  };
  const ground=extendMaterial(new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9,metalness:0}),shared);
  const rockUniforms={...shared,uLandRockOnly:{value:1}};
  const rock=extendMaterial(new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9,metalness:0}),rockUniforms);
  const section=extendMaterial(new THREE.MeshStandardMaterial({color:0xffffff,roughness:.97,metalness:0}),shared,{cut:true});
  const gravel=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.93,metalness:0});
  const roots=new THREE.MeshStandardMaterial({color:0xa68c62,roughness:1,metalness:0,vertexColors:true});
  // Existing fine-root geometry intentionally stays byte-identical and has no
  // colour attribute; keep its constant white multiplier alongside new roots.
  roots.defaultAttributeValues={color:[1,1,1]};
  return {
    ground,rock,section,gravel,roots,uniforms:shared,
    update(state={}) {
      shared.uLandSeason.value=state.season??0;
      shared.uLandSnow.value=state.snow??0;
      shared.uLandWet.value=state.wetness??0;
      shared.uLandDebug.value=state.terrainDebug??0;
      if(field?.texture){shared.uLandField.value=field.texture;shared.uLandHasField.value=1;}
    },
    dispose(){ground.dispose();rock.dispose();section.dispose();gravel.dispose();roots.dispose();empty.dispose();},
  };
}
