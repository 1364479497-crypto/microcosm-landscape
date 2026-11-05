import * as THREE from 'three';
import {createTreeGrowth,createTreeLeafGeometry,createConiferNeedleGeometry} from './tree-growth.js';
import {LEAF_WIND_GLSL,TREE_WIND_GLSL} from './vegetation-wind.js';
import {createTreeMotion} from './tree-motion.js';
import {WOODLAND_LAYOUT} from './woodland-layout.js';
import {createForestLayout} from './forest-layout.js';
import {BARK_SURFACE_GLSL} from './bark-surface.js';
import {bakeLeafCanopy,LEAF_CANOPY_GLSL} from './leaf-canopy.js';
import {createMeadowHabitat,createFootpath} from './meadow-habitat.js';
import {createMeadowFlora} from './meadow-flora.js';
import {createStreamsideVegetation} from './streamside-vegetation.js';
import {createFruitTrees} from './fruit-trees.js';
import {createMeshGroundContacts} from './ground-contact.js';

// Independently authored growth/foliage system. The sparse Ash reference is used
// only as a growth contract: queues, continuations, stratified child slots,
// explicit ring seams, rooted leaves, and separate wind scopes. This miniature
// uses intentionally denser hornbeam / birch / cherry presets and real-length UVs.
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
function randomSource(seed) {
  let s = seed >>> 0;
  const value = () => { s += 0x6d2b79f5; let t=s; t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296; };
  value.range=(a,b)=>mix(a,b,value());
  value.shuffle=n=>{const a=Array.from({length:n},(_,i)=>i);for(let i=n-1;i>0;i--){const j=Math.floor(value()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  value.restore=state=>{s=state>>>0;};
  return value;
}
function noise(x,z) { return .5+.24*Math.sin(x*1.77+z*.82)+.16*Math.sin(x*4.7-z*3.33)+.09*Math.sin(x*11.3+z*8.7); }
function createPattern(kind, size=128) {
  const w=size,h=kind==='bark'?size:size*2,data=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const u=x/(w-1),v=y/(h-1),px=(u-.5)*2;let alpha=1,shade=1;
    if(kind==='leaf'){
      const width=Math.pow(Math.max(0,Math.sin(v*Math.PI)),.72)*(.93+.055*Math.sin(v*87));
      alpha=clamp((width-Math.abs(px))*38,0,1);
      const stem=Math.exp(-px*px*1000),vein=Math.pow(Math.max(0,Math.cos(v*65-Math.abs(px)*15)),16)*.18;
      shade=.79+.13*Math.sqrt(Math.max(0,1-px*px))-.1*stem-vein*.7;
    }else if(kind==='needle'){
      // Dense paired needles around an opaque twig core. Coverage survives
      // minification instead of averaging a handful of hairlines below alphaTest.
      const width=Math.pow(Math.max(0,Math.sin(v*Math.PI)),.52)*.96;
      const edge=clamp((width-Math.abs(px))*23,0,1);
      const rib=v*21-Math.abs(px)*1.6+(px<0?.27:0);
      const ribDistance=Math.abs((rib-Math.floor(rib))-.5);
      const needles=clamp((.22-ribDistance)*28,0,1)*edge;
      const core=clamp((width*.34-Math.abs(px))*19,0,1)*.9;
      const stem=clamp((.048-Math.abs(px))*50,0,1);
      alpha=Math.max(stem,Math.max(needles,core))*clamp(v*18,0,1)*clamp((1-v)*15,0,1);
      shade=.68+.22*v+.1*Math.sin(px*37+v*11);
    }else if(kind==='flower'){
      let petal=0;for(let p=0;p<5;p++){const a=p*TAU/5,dx=px-Math.sin(a)*.43,dy=(v-.5)*2-Math.cos(a)*.43;petal=Math.max(petal,clamp((.3-Math.hypot(dx,dy))*32,0,1));}
      alpha=petal;shade=.84+.16*Math.sin(v*Math.PI);if(Math.hypot(px,(v-.5)*2)<.13)shade=.63;
    }else if(kind==='bark'){
      // Small-scale relief only; species-scale bark colour is shaded in metres.
      const furrow=Math.pow(.5+.5*Math.sin(u*TAU*11+Math.sin(v*TAU*3)*.7),8);
      shade=.84+.065*Math.sin(u*TAU*17+Math.sin(v*TAU*5)*.3)+.035*Math.sin(u*TAU*41+v*TAU*7)-furrow*.075;
    }
    const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=clamp(shade*255,0,255);data[i+3]=Math.floor(alpha*255);
  }
  const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat);t.needsUpdate=true;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;
  if(kind==='bark'){t.wrapS=t.wrapT=THREE.RepeatWrapping;}
  t.name=`Independent analytic ${kind} pattern`;return t;
}
function dataPixel(r=0,g=0,b=0,a=1){const t=new THREE.DataTexture(new Float32Array([r,g,b,a]),1,1,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;}
function buffer() {return {p:[],n:[],uv:[],c:[],root:[],primary:[],secondary:[],traits:[],radius:[],period:[],idx:[]};}
function putMeta(b, m){b.radius.push(0);b.period.push(1);b.root.push(...m.root);b.primary.push(...m.primary);b.secondary.push(...m.secondary);b.traits.push(...m.traits);}
function finishBuffer(b){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));g.setAttribute('aRoot',new THREE.Float32BufferAttribute(b.root,4));g.setAttribute('aPrimary',new THREE.Float32BufferAttribute(b.primary,4));g.setAttribute('aSecondary',new THREE.Float32BufferAttribute(b.secondary,4));g.setAttribute('aTraits',new THREE.Float32BufferAttribute(b.traits,4));g.setAttribute('aBarkRadius',new THREE.Float32BufferAttribute(b.radius,1));g.setAttribute('aBarkPeriod',new THREE.Float32BufferAttribute(b.period,1));g.setIndex(b.idx);g.computeBoundingSphere();return g;
}
function leafGeometry(needle=false){
  const g=new THREE.BufferGeometry();
  if(needle){g.setAttribute('position',new THREE.Float32BufferAttribute([-.46,0,0,.46,0,0,-.46,1,0,.46,1,0],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));g.setIndex([0,1,2,1,3,2]);}
  else {g.setAttribute('position',new THREE.Float32BufferAttribute([-.42,0,0,.42,0,0,-.42,.5,.085,.42,.5,.085,-.42,1,0,.42,1,0],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,.5,1,.5,0,1,1,1],2));g.setIndex([0,1,2,1,3,2,2,3,4,3,5,4]);}
  g.computeVertexNormals();return g;
}
// Distinct growth habits share rooted wind, not one repeated crossed card.
function grassGeometry(species=0,compact=false){
  const p=[],uv=[],idx=[],blades=[5,6,8,5][species],segments=compact?(species===0?1:2):(species===0?2:3);
  for(let k=0;k<blades;k++){
    const angle=k*2.399+species*.71,c=Math.cos(angle),sn=Math.sin(angle),base=p.length/3;
    const h=.58+((k*7)%11)/11*.42,width=[.040,.033,.027,.018][species],spread=(species===0?.07:.025)+(k%3)*(species===0?.08:.022);
    const curve=[.23,.47,.28,.22][species]*(.65+(k%3)*.20);
    for(let j=0;j<=segments;j++){
      const t=j/segments,y=h*t-curve*t*t*.16,bend=curve*t*t,half=width*Math.pow(1-t,.72)*(.82+.18*Math.sin(t*Math.PI));
      for(const side of [-1,1]){const x=spread+bend,z=side*half;p.push(x*c-z*sn,y,x*sn+z*c);uv.push(side<0?0:1,t);}
      if(j<segments){const a=base+j*2;idx.push(a,a+1,a+2);if(j<segments-1)idx.push(a+2,a+1,a+3);}
    }
    if(species===3){
      // Small alternating spikelets on a slender seed stem.
      for(let j=0;j<5;j++){const t=.67+j*.057,x=spread+curve*t*t,y=h*t,side=j%2?1:-1,off=p.length/3;
        const pts=[[x,y,-.003],[x+.022,y+.022,side*.012],[x+.006,y+.039,side*.004]];
        for(const [xx,yy,zz] of pts){p.push(xx*c-zz*sn,yy,xx*sn+zz*c);uv.push(.5,.8);}
        idx.push(off,off+1,off+2);
      }
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();g.computeBoundingSphere();return g;
}

const COMMON_GLSL=`
uniform float uVegTime,uVegSeason,uVegSnow,uVegWet,uVegStrength,uVegDay;
uniform vec2 uVegWind;
uniform sampler2D uVegField,uVegWindField;
uniform float uVegHasField,uVegHasWindField;
uniform vec4 uVegBounds;
attribute vec4 aRoot;
attribute vec4 aTraits;
varying vec4 vVegTraits;
varying vec3 vVegField;
varying float vVegUp,vVegTip;
varying vec3 vVegWorldNormal;
varying vec3 vVegWorldPosition;
varying vec2 vVegUV;
varying float vVegRootY;
varying float vBarkRadius;
varying float vBarkPeriod;
vec3 vegRotate(vec3 p,vec3 pivot,vec3 axis,float angle){vec3 d=p-pivot;return pivot+d*cos(angle)+cross(axis,d)*sin(angle)+axis*dot(axis,d)*(1.-cos(angle));}
`;
const FRAGMENT_GLSL=`
uniform float uVegTime,uVegSeason,uVegSnow,uVegWet,uVegStrength,uVegDay;
uniform sampler2D uVegFlower;
varying vec4 vVegTraits;
varying vec3 vVegField;
varying float vVegUp,vVegTip;
varying vec3 vVegWorldNormal;
varying vec3 vVegWorldPosition;
varying vec2 vVegUV;
varying float vVegRootY;
varying float vBarkRadius;
varying float vBarkPeriod;
float vegWinter(){return smoothstep(2.2,2.98,uVegSeason)*(1.-smoothstep(3.52,3.98,uVegSeason));}
float vegSpring(){return 1.-smoothstep(.32,.9,uVegSeason)+smoothstep(3.65,4.,uVegSeason);}
`;
function patchMaterial(material, uniforms, kind, shadow=false,treeFoliage=false){
  const canopy=treeFoliage&&!shadow;
  const tree=kind==='bark'||kind==='leaf'||kind==='pine';const foliage=kind==='leaf'||kind==='pine';
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=(tree?TREE_WIND_GLSL:'')+COMMON_GLSL+(canopy?'attribute vec4 aCanopyLightA,aCanopyLightB;varying vec4 vCanopyLightA,vCanopyLightB;varying vec3 vLeafSunLocal;uniform vec3 uLeafSunDirection;\n':'')+(kind==='bark'?'attribute float aBarkRadius;attribute float aBarkPeriod;\n':'')+(tree?'attribute vec4 aPrimary;attribute vec4 aSecondary;\n':'')+(foliage?'attribute vec3 aCanopy;\n':'')+shader.vertexShader;
    if(foliage){
      shader.vertexShader=LEAF_WIND_GLSL+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('void main() {',`vec2 vegLeafMotion(){
        vec2 rootUV=clamp((aRoot.xz-uVegBounds.xy)/uVegBounds.zw,vec2(0.),vec2(1.));
        vec2 w=mix(uVegWind*uVegStrength,texture2D(uVegWindField,rootUV).rg,uVegHasWindField);
        float magnitude=length(w);vec3 direction=vec3(w.x,0.,w.y)/max(magnitude,.00001);
        vec3 face=vec3(0.,0.,1.),edge=vec3(1.,0.,0.);
        #ifdef USE_INSTANCING
          face=normalize(instanceMatrix[2].xyz);edge=normalize(instanceMatrix[0].xyz);
        #endif
        return vegLeafWindAngles(uVegTime,aTraits.x*57.+aRoot.x*.31+aRoot.z*.27,aRoot.x*1.9+aRoot.z*.73,dot(face,direction),dot(edge,direction),magnitude,${kind==='pine'?'1.':'0.'});
      }
      void main() {
        vec2 vegPetioleAngles=vegLeafMotion();`);
      if(!shadow)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
        objectNormal=vegLeafWindRotate(normalize(objectNormal*.67+aCanopy*.33),vegPetioleAngles);`);
    }
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      ${foliage?'transformed=vegLeafWindRotate(transformed,vegPetioleAngles);':''}
    `);
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vec4 vegPosition=vec4(transformed,1.);
      vec3 vegN=${foliage&&!shadow?'objectNormal':'normal'};
      #ifdef USE_INSTANCING
        vegPosition=instanceMatrix*vegPosition;
        mat3 vegInstance=mat3(instanceMatrix);
        vegN/=vec3(dot(vegInstance[0],vegInstance[0]),dot(vegInstance[1],vegInstance[1]),dot(vegInstance[2],vegInstance[2]));
        vegN=vegInstance*vegN;
      #endif
      vec2 vegUV=clamp((aRoot.xz-uVegBounds.xy)/uVegBounds.zw,vec2(0.),vec2(1.));
      vec4 vegSurfaceField=texture2D(uVegField,vegUV);
      vVegField=mix(vec3(uVegWet,uVegSnow,1.),vec3(vegSurfaceField.rg,vegSurfaceField.a),uVegHasField);
      vec2 vegWind=mix(uVegWind*uVegStrength,texture2D(uVegWindField,vegUV).rg,uVegHasWindField);
      float vegMag=clamp(length(vegWind),0.,2.5);
      vec2 vegDir=normalize(vegWind+vec2(.00001,0.));
      vec3 vegAxis=vec3(vegDir.y,0.,-vegDir.x);
      vec3 vegP=vegPosition.xyz;
      float vegPhase=aRoot.x*1.9+aRoot.z*.73;
      ${tree?`
        float primaryAngle=sin(uVegTime*1.3+aPrimary.w)*.11*vegMag*aTraits.z;
        float secondaryAngle=sin(uVegTime*2.45+aSecondary.w)*.16*vegMag*aTraits.w;
        vegP=vegRotate(vegP,aSecondary.xyz,vegAxis,secondaryAngle);
        vegP=vegRotate(vegP,aPrimary.xyz,vegAxis,primaryAngle);
        vegN=vegRotate(vegN,vec3(0.),vegAxis,secondaryAngle);vegN=vegRotate(vegN,vec3(0.),vegAxis,primaryAngle);
        vec2 treeBend=vegTreeBend(uVegTime,aRoot,vegWind);
        ${canopy?`vec3 leafSunRest=vegRotate(uLeafSunDirection,vec3(0.),vegAxis,-primaryAngle);vLeafSunLocal=vegRotate(leafSunRest,vec3(0.),vegAxis,-secondaryAngle);`:''}
        vegN=vegTreeArcNormal(vegN,vegP,aRoot,treeBend);
        vegP=vegTreeArc(vegP,aRoot,treeBend);
      `:`
        float tip=clamp((vegP.y-aRoot.y)/max(aRoot.w,.001),0.,1.2);
        float gust=.48+.3*sin(aRoot.x*1.1+aRoot.z*.7-uVegTime*1.8)+.16*sin(uVegTime*4.1+aTraits.x*71.);
        float bend=vegMag*gust*.48;
        vegP.xz+=vegDir*pow(tip,1.75)*aRoot.w*bend;
        vegP.y-=pow(tip,2.)*aRoot.w*bend*bend*.28;
      `}
      ${canopy?'vCanopyLightA=aCanopyLightA;vCanopyLightB=aCanopyLightB;':''}
      ${tree&&!shadow?`
#ifndef FLAT_SHADED
transformedNormal=normalMatrix*vegN;vNormal=normalize(transformedNormal);
#endif
`:''}
      vBarkPeriod=${kind==='bark'?'aBarkPeriod':'1.'};vBarkRadius=${kind==='bark'?'aBarkRadius':'0.'};vVegRootY=aRoot.y;vVegUV=uv;vVegTip=uv.y;vVegUp=clamp(normalize(vegN).y,0.,1.);vVegWorldNormal=normalize(mat3(modelMatrix)*vegN);vVegWorldPosition=(modelMatrix*vec4(vegP,1.)).xyz;vVegTraits=aTraits;
      vec4 mvPosition=modelViewMatrix*vec4(vegP,1.);
      gl_Position=projectionMatrix*mvPosition;
    `);
    shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','vec4 worldPosition=modelMatrix*vec4(vegP,1.);');
    shader.fragmentShader=FRAGMENT_GLSL+(canopy?'varying vec4 vCanopyLightA,vCanopyLightB;varying vec3 vLeafSunLocal;uniform vec3 uLeafSunDirection,uLeafSunRadiance;uniform float uLeafDebug,uLeafStrength;\n'+LEAF_CANOPY_GLSL:'')+(kind==='bark'&&!shadow?'uniform float uBarkDebug;\n'+BARK_SURFACE_GLSL:'')+shader.fragmentShader;
    if(canopy)shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>','#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
    if(kind==='leaf'){
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        #ifdef USE_MAP
          vec4 vegTexel=texture2D(map,vMapUv);
          if(vVegTraits.y>1.5 && vVegTraits.y<2.5 && vegSpring()>.3)vegTexel=texture2D(uVegFlower,vMapUv);
          diffuseColor*=vegTexel;
        #endif
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`
        if(vVegTraits.x < vegWinter()*1.001)discard;
        #include <alphatest_fragment>
      `);
    }
    if(!shadow){
      // Thin meadow cards represent a tuft volume, whose two sides share an
      // upward shading normal. Back-face flipping would turn half the meadow
      // into dark fragments even though its continuous sward is lit correctly.
      if(kind==='grass'||kind==='reed')shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 vegTuftNormal=normalize(mix(normalize(vVegWorldNormal),vec3(0.,1.,0.),.48));
        normal=normalize((viewMatrix*vec4(vegTuftNormal,0.)).xyz);
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float vegAutumn=smoothstep(1.15,2.14,uVegSeason)*(1.-smoothstep(2.75,3.25,uVegSeason));
        float vegWet=clamp(max(uVegWet*.35,vVegField.x),0.,1.);
        ${kind==='bark'?`
          float barkPeriod=max(vBarkRadius*6.28318530718,.00001);
          vec2 barkUV=vec2(vVegUV.x*barkPeriod/max(vBarkPeriod,.00001),vVegUV.y);
          BarkSurface bark=barkSurface(barkUV,vVegTraits.y,vVegWorldPosition.y-vVegRootY,vVegUp,vVegTraits.x,vBarkRadius,barkPeriod);
          diffuseColor.rgb=bark.colour;
        `:kind==='leaf'?`
          ${!material.map?`float midrib=exp(-pow((vVegUV.x-.5)*70.,2.));
          float veins=pow(.5+.5*cos(vVegUV.y*51.-abs(vVegUV.x-.5)*22.),20.);
          diffuseColor.rgb*=1.-.10*midrib-.055*veins;`:''}
          ${canopy?`diffuseColor.rgb*=mix(vec3(1.),vec3(1.04,1.06,.94),vCanopyLightB.w*vegSpring()*uLeafStrength);`:''}
          vec3 autumnA=vec3(.51,.25,.055),autumnB=vec3(.8,.52,.10),autumnC=vec3(.45,.075,.025);
          vec3 autumnHue=mix(autumnA,autumnB,smoothstep(.15,.8,vVegTraits.x));
          autumnHue=mix(autumnHue,autumnC,step(.73,vVegTraits.x)*.7);
          diffuseColor.rgb=mix(diffuseColor.rgb,autumnHue,vegAutumn*.91);
          if(vVegTraits.y>1.5 && vVegTraits.y<2.5)diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.73,.39,.49),vegSpring()*.82);
        `:kind==='grass'||kind==='reed'||kind==='sward'?`
          float vegMeadowPatch=.5+.22*sin(vVegWorldPosition.x*.93+sin(vVegWorldPosition.z*1.2))+.18*sin(vVegWorldPosition.z*1.8-vVegWorldPosition.x*.57);
          diffuseColor.rgb*=mix(vec3(.84,.90,.78),vec3(1.0,1.015,.96),pow(clamp(vVegTip,0.,1.),.7))*(.84+.23*vegMeadowPatch);
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.3,.96,.5)+vec3(.075,.046,.016),vegAutumn*.9);
        `:''}
        ${kind==='sward'?`
          diffuseColor.a*=smoothstep(.015,.21,vVegTraits.w);
          if(diffuseColor.a<.015)discard;
          float swardGrain=.5+.15*sin(vVegWorldPosition.x*114.+sin(vVegWorldPosition.z*46.))+.14*sin(vVegWorldPosition.z*133.-vVegWorldPosition.x*79.);
          diffuseColor.rgb*=mix(.94,1.04,swardGrain);
        `:''}
        diffuseColor.rgb*=(1.-vegWet*.25)*mix(.63,1.,clamp(vVegField.z,0.,1.));
        float snowMask=clamp(max(uVegSnow*.4,vVegField.y),0.,1.);
        snowMask*=smoothstep(${kind==='grass'||kind==='reed'?'.35,.9,vVegTip':'.1,.7,vVegUp'});
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.86,.9,.88),snowMask*.94);
      `);
      if(canopy){
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
          float leafRetention=${kind==='leaf'?'1.-vegWinter()':'1.'};
          float leafAO=mix(1.,vCanopyLightB.z,leafRetention*uLeafStrength);
          float leafEscape=pow(max(.000001,leafCanopyEscape(vLeafSunLocal,vCanopyLightA,vCanopyLightB)),leafRetention);
          reflectedLight.indirectDiffuse*=leafAO;
          reflectedLight.indirectSpecular*=mix(1.,sqrt(max(.001,leafAO)),uLeafStrength);
          vec3 leafSunView=normalize(mat3(viewMatrix)*uLeafSunDirection);
          float leafBacklight=max(0.,dot(-normal,leafSunView));
          float leafTransmission=leafBacklight*leafEscape*${kind==='pine'?'.055':'.085'}*uLeafStrength;
          if(leafTransmission>.00001&&dot(uLeafSunRadiance,vec3(1.))>.00001){
            reflectedLight.directDiffuse+=diffuseColor.rgb*uLeafSunRadiance*(leafTransmission*getShadowMask())/3.141593;
          }
        `);
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`#include <opaque_fragment>
          if(uLeafDebug>.5&&uLeafDebug<1.5)gl_FragColor.rgb=vec3(leafAO);
          else if(uLeafDebug<2.5&&uLeafDebug>1.5)gl_FragColor.rgb=vec3(leafEscape);
          else if(uLeafDebug<3.5&&uLeafDebug>2.5)gl_FragColor.rgb=vec3(vCanopyLightB.w);
          else if(uLeafDebug>3.5)gl_FragColor.rgb=inverseTransformDirection(normal,viewMatrix)*.5+.5;
        `);
      }else{
      if(kind!=='bark')shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
        float vegTransmission=max(0.,dot(-normalize(vVegWorldNormal),normalize(vec3(-.6,.9,.4))));
        ${kind==='sward'?'reflectedLight.indirectDiffuse+=diffuseColor.rgb*.10*uVegDay;':''}
        reflectedLight.indirectDiffuse+=diffuseColor.rgb*vegTransmission*${kind==='leaf'?'.11':kind==='pine'?'.15':kind==='grass'||kind==='sward'?'.035':'.1'}*uVegDay*pow(clamp(vVegTip,0.,1.),.7);
      `);
      }
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
${kind==='bark'?'roughnessFactor=bark.roughness;':''}
roughnessFactor=mix(roughnessFactor,.5,clamp(vVegField.x,0.,1.)*.52);`);
      if(kind==='bark'){shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=barkPerturbNormal(-vViewPosition,normal,bark.height);');shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','#include <opaque_fragment>\nif(uBarkDebug>.5)gl_FragColor.rgb=barkSurfaceDebug(bark,uBarkDebug);');}
    }
  };
  material.customProgramCacheKey=()=>`independent-vegetation-v11-rooted-tree-${kind}-${shadow}-${treeFoliage}`;
  return material;
}
function riverAt(terrain,z){
  if(terrain.river?.sample)return terrain.river.sample(z);
  const nodes=Array.isArray(terrain.river)?terrain.river:[[0,3.05,-3.35],[0,1.25,-2.1],[-.12,.72,-1.2],[.15,.4,-.15],[.45,.22,.85],[.95,.18,1.6]];
  for(let i=1;i<nodes.length;i++)if(z<=nodes[i][2]&&z>=nodes[i-1][2]){const t=(z-nodes[i-1][2])/(nodes[i][2]-nodes[i-1][2]);return {x:mix(nodes[i-1][0],nodes[i][0],t),y:mix(nodes[i-1][1],nodes[i][1],t),width:mix(.195,.37,clamp((z+3.35)/4.95,0,1))};}
  return null;
}
function terrainNormal(terrain,x,z){const n=terrain.normal(x,z);return n?.isVector3?n:new THREE.Vector3(...(Array.isArray(n)?n:[n.x,n.y,n.z]));}
function blocked(terrain,x,z,margin=.1){
  const lake=terrain.lake||{x:1.45,z:2.8,rx:2.45,rz:2.05,level:.18};
  if(((x-lake.x)/(lake.rx+margin))**2+((z-lake.z)/(lake.rz+margin))**2<1)return true;
  const river=riverAt(terrain,z);if(river&&Math.abs(x-river.x)<(river.width||.3)+margin)return true;
  if(x>-3.4-margin&&x<-1.88+margin&&z>-.9-margin&&z<.61+margin)return true;
  if(x>-1.45&&x<-.02&&z>1.82&&z<2.72)return true;
  return false;
}

export function createVegetation(scene,{terrain,field=null,seed=42,quality='high'}={}){
  if(!terrain?.height||!terrain?.normal)throw new Error('Vegetation requires terrain.height(x,z) and terrain.normal(x,z).');
  const rng=randomSource(seed),group=new THREE.Group();group.name='Independently grown mixed woodland and meadow';scene.add(group);
  const textures=[],geometries=[],materials=[],leaves=[],needles=[],bark=buffer();
  const keepTexture=t=>(textures.push(t),t),keepGeometry=g=>(geometries.push(g),g),keepMaterial=m=>(materials.push(m),m);
  const flowerMap=keepTexture(createPattern('flower'));
  const zero=keepTexture(dataPixel()),bounds=field?.bounds||{minX:-6,minZ:-5.3,sizeX:12,sizeZ:9.6};
  const leafSunColour=new THREE.Color();
  const uniforms={uLeafSunDirection:{value:new THREE.Vector3(-.6,.9,.4).normalize()},uLeafSunRadiance:{value:new THREE.Color(0)},uLeafDebug:{value:0},uLeafStrength:{value:1},uBarkDebug:{value:0},uVegTime:{value:0},uVegSeason:{value:0},uVegSnow:{value:0},uVegWet:{value:0},uVegStrength:{value:.3},uVegDay:{value:1},uVegWind:{value:new THREE.Vector2(.8,.25)},uVegField:{value:field?.texture||zero},uVegWindField:{value:field?.windTexture||zero},uVegHasField:{value:field?.texture?1:0},uVegHasWindField:{value:field?.windTexture?1:0},uVegBounds:{value:new THREE.Vector4(bounds.minX,bounds.minZ,bounds.sizeX,bounds.sizeZ)},uVegFlower:{value:flowerMap}};
  const stats={seed,preset:'pendulous spruce / hornbeam / silver birch / cherry',trees:0,broadleafTrees:0,pines:0,shrubs:0,grassClumps:0,grassBlades:0,reeds:0,flowers:0,leafCards:0,needleSprays:0,branchJobs:[0,0,0,0],continuations:[0,0,0,0],lateralChildren:[0,0,0,0],triangles:0,vertices:0,drawCalls:0};
  function addMesh(g,m,name,shadow=true){const mesh=new THREE.Mesh(keepGeometry(g),keepMaterial(m));mesh.name=name;mesh.castShadow=shadow;mesh.receiveShadow=true;mesh.frustumCulled=false;group.add(mesh);return mesh;}
  // Instanced foliage has instanceColor, not a vertex color attribute. Enabling
  // vertexColors there would multiply that color by the missing attribute (0).
  function makePlantMaterial(kind,map,treeFoliage=false){return patchMaterial(new THREE.MeshStandardMaterial({color:0xffffff,map,vertexColors:kind==='bark'||kind==='sward',roughness:kind==='bark'||kind==='grass'||kind==='sward'?.96:.85,side:kind==='bark'?THREE.FrontSide:THREE.DoubleSide,alphaTest:map&&kind!=='bark'?(kind==='pine'?.24:.42):0}),uniforms,kind,false,treeFoliage);}
  function shadowMaterial(kind,map,treeFoliage=false){return keepMaterial(patchMaterial(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map,alphaTest:map&&kind!=='bark'?(kind==='pine'?.24:.42):0,side:kind==='bark'?THREE.FrontSide:THREE.DoubleSide}),uniforms,kind,true,treeFoliage));}
  // Growth RNG is independent from site selection and meadow sampling.
  const treeGrowth=createTreeGrowth({terrain,rng:randomSource(seed^0x5a7d1389),stats,bark,leaves,needles,quality});
  const treePlans=[];
  const deciduous=(x,z,h,species=0,shrub=false)=>treePlans.push({type:'deciduous',x,z,h,species,shrub});
  const pine=(x,z,h)=>treePlans.push({type:'pine',x,z,h});
  group.userData.treeGrowth=treeGrowth.diagnostics;
  const treeSites=[];
  // Clear the complete crown envelope in front of the house, not just its roots.
  // Grass and meadow flowers remain in this sightline to give the cabin a lawn.
  function cabinSightline(x,z,crown=.45){return z>-.36-crown*.25 && z<4.28 && x>-3.4-crown && x<-1.9+crown;}
  function riverSightline(x,z,crown=.5){
    if(z< -3.45||z>1.93)return false;
    const river=riverAt(terrain,z);return river&&Math.abs(x-river.x)<(river.width||.3)*.5+crown+.14;
  }
  // The high mountain habitat is controlled in XZ, not by a periodic height
  // function: distant shelves receive a few broken tufts, never green rings.
  function grassHabitat(x,z,y,sward=false){
    const patch=clamp(noise(x*.63+6.7,z*.63-2.1),0,1);
    if(y<1.16)return 1;
    if(sward){if(y>1.8)return 0;return patch>mix(.44,.85,clamp((y-1.16)/.64,0,1))?1:0;}
    if(y>2.85)return 0;
    if(y>2.4)return patch>.91?.018:0;
    if(y>1.5)return patch>mix(.63,.88,(y-1.5)/.9)?mix(.16,.025,(y-1.5)/.9):0;
    return patch>.41?mix(1,.38,(y-1.16)/.34):.12;
  }
  function preferredSite(x,z){
    for(let i=0;i<32;i++){
      const a=i*2.399,r=i===0?0:.045*Math.sqrt(i),px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r,y=terrain.height(px,pz);
      if(blocked(terrain,px,pz,.3)||cabinSightline(px,pz,.48)||riverSightline(px,pz,.62)||terrainNormal(terrain,px,pz).y<.81||y<.25||y>1.68||treeSites.some(p=>Math.hypot(px-p.x,pz-p.z)<.61))continue;
      const site={x:px,z:pz};treeSites.push(site);return site;
    }
    return null;
  }
  function treeSite(type){
    for(let attempt=0;attempt<1600;attempt++){
      const x=rng.range(-5.58,5.58),z=type==='pine'?rng.range(-4.55,1.1):rng.range(-1.62,3.46),y=terrain.height(x,z),normal=terrainNormal(terrain,x,z);
      if(blocked(terrain,x,z,type==='pine'?.22:.33)||cabinSightline(x,z,type==='pine'?.38:.58)||riverSightline(x,z,type==='pine'?.36:.62)||normal.y<(type==='pine'?.66:.85)||y>(type==='pine'?2.35:1.68)||y<.25)continue;
      if(treeSites.some(p=>Math.hypot(x-p.x,z-p.z)<(type==='pine'?.46:.61)))continue;
      // A little air beside the cascade and a foreground window onto the lake.
      if(z<-.75&&Math.abs(x)<.78)continue;
      treeSites.push({x,z});return {x,z};
    }
    return null;
  }
  if(seed===WOODLAND_LAYOUT.seed && quality===WOODLAND_LAYOUT.quality){
    for(const t of WOODLAND_LAYOUT.trees){if(t.type==='pine')pine(t.x,t.z,t.h);else deciduous(t.x,t.z,t.h,t.species,t.shrub);}
    rng.restore(WOODLAND_LAYOUT.meadowRngState);
  }else{
  const compositionSites=[[-4.72,2.24],[-4.69,.78],[4.5,1.43],[-4.35,-.53],[4.72,.02],[4.55,2.65]];
  for(let i=0;i<23;i++){const p=i<compositionSites.length?(preferredSite(...compositionSites[i])||treeSite('broadleaf')):treeSite('broadleaf');if(p)deciduous(p.x,p.z,rng.range(.91,1.43)*(p.z>-.5?.85:1),[2,3].includes(i)?2:i%4===0?1:0);}
  for(let i=0;i<23;i++){const p=treeSite('pine');if(p)pine(p.x,p.z,rng.range(1.1,1.65)*Math.exp(-Math.max(0,terrain.height(p.x,p.z)-.65)*.22));}
  for(let i=0;i<26;i++){
    for(let a=0;a<80;a++){const x=rng.range(-5.55,5.55),z=rng.range(-2.15,3.65),h=terrain.height(x,z);if(blocked(terrain,x,z,.16)||cabinSightline(x,z,.27)||riverSightline(x,z,.30)||terrainNormal(terrain,x,z).y<.78||h<.25||h>1.8)continue;deciduous(x,z,rng.range(.23,.44),i%11===0?2:0,true);break;}
  }
  }
  const forest=createForestLayout(terrain,{seed,trees:treePlans});
  for(const t of forest.trees){const options={density:t.density,juvenile:t.juvenile};if(t.type==='pine')treeGrowth.pine(t.x,t.z,t.h,options);else treeGrowth.deciduous(t.x,t.z,t.h,t.species,t.shrub,options);}
  stats.forest=forest.stats;group.userData.forestLayout=forest;
  stats.canopy=bakeLeafCanopy(leaves,needles);group.userData.canopy=stats.canopy;
  const barkMesh=addMesh(finishBuffer(bark),makePlantMaterial('bark',null),'Hierarchical bark rings with visible winter twigs');barkMesh.customDepthMaterial=shadowMaterial('bark',null);
  function instances(data,kind,map,name,treeFoliage=false){
    const g=keepGeometry(treeFoliage?(kind==='pine'?createConiferNeedleGeometry():createTreeLeafGeometry()):leafGeometry()),root=[],primary=[],secondary=[],traits=[],canopy=[];
    for(const d of data){root.push(...d.meta.root);primary.push(...d.meta.primary);secondary.push(...d.meta.secondary);traits.push(...d.meta.traits);canopy.push(d.canopy.x,d.canopy.y,d.canopy.z);}
    for(const [n,a,size]of[['aRoot',root,4],['aPrimary',primary,4],['aSecondary',secondary,4],['aTraits',traits,4],['aCanopy',canopy,3]])g.setAttribute(n,new THREE.InstancedBufferAttribute(new Float32Array(a),size));
    if(treeFoliage){g.setAttribute('aCanopyLightA',new THREE.InstancedBufferAttribute(new Float32Array(data.flatMap(d=>d.canopyLightA)),4));g.setAttribute('aCanopyLightB',new THREE.InstancedBufferAttribute(new Float32Array(data.flatMap(d=>d.canopyLightB)),4));}
    const mesh=new THREE.InstancedMesh(g,keepMaterial(makePlantMaterial(kind,map,treeFoliage)),data.length),matrix=new THREE.Matrix4(),scale=new THREE.Vector3();mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.customDepthMaterial=shadowMaterial(kind,map,treeFoliage);
    data.forEach((d,i)=>{scale.setScalar(d.size);matrix.compose(d.p,d.q,scale);mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,d.color);});mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;group.add(mesh);return mesh;
  }
  instances(leaves,'leaf',null,'Petiole rooted folded broad leaves',true);
  const spruceMesh=instances(needles,'pine',null,'Pendant spruce branchlets with individual geometric needles',true);
  const detailVariants=[{mesh:spruceMesh,full:spruceMesh.geometry,create:()=>createConiferNeedleGeometry(true)}];
  stats.leafCards=leaves.length;stats.needleSprays=needles.length;
  const habitat=createMeadowHabitat(terrain,forest.trees,seed);
  const footpath=createFootpath(habitat,terrain);group.add(footpath.mesh);
  const dummy=new THREE.Object3D();
  function lowSward(){
    const b=buffer(),nx=240,nz=192;
    const corners=(x,z)=>{const h=habitat.sample(x,z),y=h.height,n=h.normal||terrainNormal(terrain,x,z);return {x,z,y,n,h,coverage:(habitat.allowed(x,z,.012)?1:0)*h.density*(1-h.shade*.55)*grassHabitat(x,z,y,true),valid:y>terrain.lake.level+.008&&h.waterDepth<0&&n.y>.64&&y<1.88};};
    const grid=[];
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++)grid.push(corners(-6+12*i/nx,-5.3+9.6*j/nz));
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
      const cells=[grid[j*(nx+1)+i],grid[(j+1)*(nx+1)+i],grid[j*(nx+1)+i+1],grid[(j+1)*(nx+1)+i+1]];
      if(cells.some(p=>!p.valid))continue;
      const base=b.p.length/3;
      for(const p of cells){
        const patch=p.h.patch,c=new THREE.Color(0x526b36).lerp(new THREE.Color(0x7d8d4c),patch*.8).multiplyScalar(1-p.h.shade*.22);
        b.p.push(p.x,p.y+.008,p.z);b.n.push(p.n.x,p.n.y,p.n.z);b.uv.push(0,0);b.c.push(c.r,c.g,c.b);
        putMeta(b,{root:[p.x,p.y+.008,p.z,.008],primary:[p.x,p.y,p.z,0],secondary:[p.x,p.y,p.z,0],traits:[patch,4,0,p.coverage]});
      }
      b.idx.push(base,base+1,base+2,base+2,base+1,base+3);
    }
    const material=makePlantMaterial('sward',null);material.transparent=true;material.depthWrite=false;material.alphaTest=.015;
    const mesh=addMesh(finishBuffer(b),material,'Continuous low meadow sward under discrete blades',false);mesh.renderOrder=-1;
    stats.swardTriangles=b.idx.length/3;
  }
  lowSward();
  const meadowStats=[];
  function meadow(count,species){
    const geo=keepGeometry(grassGeometry(species)),roots=[],traits=[],matrices=[],colors=[],heights=[],color=new THREE.Color();
    let attempts=0;
    for(;matrices.length<count&&attempts<count*12;attempts++){
      const x=rng.range(-5.996,5.996),z=rng.range(-5.296,4.296);
      const h=habitat.evaluate(x,z);if(!h)continue;if(h.height<terrain.lake.level+.010||h.waterDepth>0||h.slope<.72||h.rock>.03||h.path>.94||h.treeClearance<.002)continue;
      const tuft=habitat.tussock(x,z),accept=h.density*(species===0?.6+tuft*.4:tuft*tuft*1.35);
      if(rng()>accept)continue;
      if(species===1&&(h.height>1.65||h.shade>.55)||species===2&&(h.height>1.55||h.shore<.03&&h.patch<.57)||species===3&&(h.shade>.30||h.height>1.18||h.shore>.7))continue;
      const base=[.075,.11,.16,.18][species],variance=[.085,.10,.12,.10][species];
      const originalHeight=(base+variance*tuft)*rng.range(.76,1.18)*(1-h.alpine*.74)*(1-h.shade*.27),height=originalHeight*[1,.85,.76,.72][species]*(1-h.path*.75);
      const n=h.normal||terrainNormal(terrain,x,z),q=new THREE.Quaternion().setFromUnitVectors(UP,n.clone().lerp(UP,.75).normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(UP,rng()*TAU));
      dummy.position.set(x,h.height-.005,z);dummy.quaternion.copy(q);dummy.scale.set(originalHeight*rng.range(.75,1.2),height,originalHeight*rng.range(.75,1.2));dummy.updateMatrix();matrices.push(dummy.matrix.clone());roots.push(x,h.height,z,height);traits.push(rng(),4,species,0);heights.push(height);
      const palette=[0x7c944b,0x698c43,0x527c4a,0x9f9e61];color.set(palette[species]).lerp(new THREE.Color(0x4f743d),h.shade*.5).multiplyScalar(rng.range(.83,1.13)*mix(.87,1.12,h.patch));colors.push(color.clone());
    }
    geo.setAttribute('aRoot',new THREE.InstancedBufferAttribute(new Float32Array(roots),4));geo.setAttribute('aTraits',new THREE.InstancedBufferAttribute(new Float32Array(traits),4));
    const names=['Fine short meadow fescue','Arching broad meadow grass','Dense uneven sedge tussocks','Tall flowering grass with seed panicles'];
    const mesh=new THREE.InstancedMesh(geo,keepMaterial(makePlantMaterial('grass',null)),matrices.length);mesh.name=names[species];mesh.receiveShadow=true;mesh.castShadow=false;mesh.frustumCulled=false;
    matrices.forEach((matrix,i)=>{mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,colors[i]);});mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;group.add(mesh);
    detailVariants.push({mesh,full:geo,create:()=>grassGeometry(species,true)});
    stats.grassClumps+=matrices.length;stats.grassBlades+=matrices.length*[5,6,8,5][species];heights.sort((a,b)=>a-b);
    meadowStats.push({species:names[species],count:matrices.length,blades:[5,6,8,5][species],heightMin:heights[0],heightMedian:heights[Math.floor(heights.length*.5)],heightMax:heights.at(-1),heightRatio:[1,.85,.76,.72][species],attempts});
  }
  const scale=quality==='high'?1:.65;
  for(const [i,count] of [30000,6500,4000,2200].entries())meadow(Math.round(count*scale),i);
  const flora=createMeadowFlora({terrain,habitat,seed:seed^0x78a21,field});group.add(flora.group);
  const streamside=createStreamsideVegetation({terrain,habitat,field,seed});group.add(streamside.group);group.userData.streamside=streamside;
  const fruitTrees=createFruitTrees({terrain,habitat,field,seed});group.add(fruitTrees.group);group.userData.fruitTrees=fruitTrees;
  const treeMotion=createTreeMotion({terrain,field,trees:forest.trees,fruitTrees,uniforms,barkMesh});
  const rootContacts=fruitTrees.takeRootContactSampler?.()||createMeshGroundContacts(fruitTrees.contactMeshes||[fruitTrees.group.userData.rootContactMesh],terrain),rootContactCache=new Map();
  const rootSolid=(x,y,z)=>{const key=`${x},${y},${z}`;if(!rootContactCache.has(key))rootContactCache.set(key,rootContacts.sample(x,z,y).solid);return rootContactCache.get(key);};
  const orchardContacts={grass:[],herbs:[],sampler:rootContacts.stats,rule:'Only rendered closed wood at root height; no crown-radius/expanded soil exclusion.'};
  // Retain all old random streams, positions and sizes. Compact only roots that
  // now lie INSIDE the actual new wood, keeping every surviving buffer row exact.
  for(const mesh of group.children){
    if(!mesh.isInstancedMesh||!mesh.geometry.attributes.aRoot||!mesh.name.includes('meadow')&&!mesh.name.includes('tussocks')&&!mesh.name.includes('panicles'))continue;
    const roots=mesh.geometry.attributes.aRoot,keep=[],rejected=[];
    for(let i=0;i<mesh.count;i++)(rootSolid(roots.getX(i),roots.getY(i),roots.getZ(i))?rejected:keep).push(i);
    orchardContacts.grass.push({name:mesh.name,before:mesh.count,after:keep.length,rejected:rejected.map(i=>({index:i,x:roots.getX(i),y:roots.getY(i),z:roots.getZ(i)}))});
    if(!rejected.length)continue;
    const packed=attribute=>{const array=new attribute.array.constructor(keep.length*attribute.itemSize);keep.forEach((index,j)=>array.set(attribute.array.subarray(index*attribute.itemSize,(index+1)*attribute.itemSize),j*attribute.itemSize));return new THREE.InstancedBufferAttribute(array,attribute.itemSize,attribute.normalized,attribute.meshPerAttribute||1);};
    for(const[name,attribute]of Object.entries(mesh.geometry.attributes))if(attribute.isInstancedBufferAttribute)mesh.geometry.setAttribute(name,packed(attribute));
    mesh.instanceMatrix=packed(mesh.instanceMatrix);if(mesh.instanceColor)mesh.instanceColor=packed(mesh.instanceColor);mesh.count=keep.length;
    const row=meadowStats.find(x=>x.species===mesh.name),species=meadowStats.indexOf(row);stats.grassClumps-=rejected.length;stats.grassBlades-=rejected.length*[5,6,8,5][species];
    if(row){const heights=keep.map(i=>roots.getW(i)).sort((a,b)=>a-b);row.count=keep.length;row.heightMin=heights[0];row.heightMedian=heights[Math.floor(heights.length*.5)];row.heightMax=heights.at(-1);}
  }
  flora.group.traverse(mesh=>{
    const roots=mesh.geometry?.attributes.aFloraRoot,index=mesh.geometry?.index;if(!roots||!index||mesh.isInstancedMesh)return;
    const keep=[];let removed=0;
    for(let i=0;i<index.count;i+=3){const j=index.getX(i);if(rootSolid(roots.getX(j),roots.getY(j),roots.getZ(j)))removed++;else keep.push(index.getX(i),index.getX(i+1),index.getX(i+2));}
    if(removed){mesh.geometry.setIndex(keep);flora.stats.triangles-=removed;orchardContacts.herbs.push({name:mesh.name,removedTriangles:removed});}
  });
  group.userData.orchardContacts=orchardContacts;
  stats.flowers=flora.stats.flowers||0;stats.reeds=flora.stats.shorePlants||0;stats.meadow={habitat:habitat.stats,grasses:meadowStats,flora:flora.stats,streamside:streamside.stats};group.userData.habitat=habitat;group.userData.flora=flora;stats.orchard=fruitTrees.stats;stats.orchardContacts=orchardContacts;stats.wind={scope:'Curved rooted tree/branch deformation with elastic drag, independent petiole hinge/torsion and shared perch sampling',module:'vegetation-wind.js + tree-motion.js',defaultCalibratedStrength:[2.6,3.0],rooted:true,colourDepthShared:true,interaction:treeMotion.stats};
  // Owned objects keep fixed local transforms; animation is in shader uniforms,
  // vertex buffers and instance matrices. World matrices can still follow a
  // parent transform without recomposing every static local matrix per pass.
  group.traverse(o=>{o.updateMatrix();o.matrixAutoUpdate=false;if(!o.isMesh)return;const n=o.geometry.index?o.geometry.index.count/3:o.geometry.attributes.position.count/3,inst=o.isInstancedMesh?o.count:1;stats.triangles+=n*inst;stats.vertices+=o.geometry.attributes.position.count*inst;stats.drawCalls++;});
  group.userData.stats=stats;
  let elapsed=0,disposed=false,compactDetail=false;
  function setCompactDetail(compact) {
    if (disposed || compact === compactDetail) return false;
    for (const variant of detailVariants) {
      if (compact && !variant.compact) {
        variant.compact = keepGeometry(variant.create());
        for (const [name,attribute] of Object.entries(variant.full.attributes))
          if (attribute.isInstancedBufferAttribute) variant.compact.setAttribute(name,attribute);
      }
      variant.mesh.geometry = compact ? variant.compact : variant.full;
    }
    compactDetail=compact;
    return true;
  }
  return {group,stats,setCompactDetail,wind:treeMotion,pointerDown:(e,c,v)=>treeMotion.pointerDown(e,c,v),pointerMove:(e,c,v)=>treeMotion.pointerMove(e,c,v),pointerUp:()=>treeMotion.pointerUp(),setLakeSurfaceSampler(fn,compileFn){flora.setLakeSurfaceSampler(fn,compileFn);},get leafLighting(){return {sunDirection:uniforms.uLeafSunDirection.value.toArray(),sunRadiance:uniforms.uLeafSunRadiance.value.toArray(),strength:uniforms.uLeafStrength.value};},debugLeaves(mode=0){uniforms.uLeafDebug.value=Math.max(0,Number(mode)||0);},setLeafCanopyStrength(value=1){uniforms.uLeafStrength.value=clamp(value,0,1);},debugBark(mode=0){uniforms.uBarkDebug.value=Math.max(0,Number(mode)||0);},update(dt=0,state={}){
    if(disposed)return;
    const day=clamp(state.daylight??1,0,1),rain=clamp(state.rain??0,0,1),hour=state.hour??15;
    if(state.sunDirection)uniforms.uLeafSunDirection.value.copy(state.sunDirection).normalize();
    if(state.sunRadiance?.isColor)leafSunColour.copy(state.sunRadiance);
    else if(state.sunRadiance?.length===3)leafSunColour.fromArray(state.sunRadiance);
    else leafSunColour.set(hour>16||hour<8?0xffbb7b:0xffe1b1).multiplyScalar(day*(.03+day*2.7)*(1-rain*.45));
    uniforms.uLeafSunRadiance.value.copy(leafSunColour);
    treeMotion.update(dt);elapsed+=Math.max(0,Math.min(dt,.1));uniforms.uVegTime.value=Number.isFinite(state.time)?state.time:elapsed;
    let season=state.season??0;if(typeof season==='string')season=({spring:0,summer:1,autumn:2,winter:3}[season]??0);uniforms.uVegSeason.value=((season%4)+4)%4;
    uniforms.uVegSnow.value=clamp(state.snow??0,0,1);uniforms.uVegWet.value=clamp(state.wetness??0,0,1);uniforms.uVegStrength.value=Math.max(0,state.windStrength??.3);uniforms.uVegDay.value=clamp(state.daylight??1,0,1);
    if(state.wind){if(state.wind.isVector2)uniforms.uVegWind.value.copy(state.wind);else uniforms.uVegWind.value.set(state.wind.x??state.wind[0]??.8,state.wind.y??state.wind.z??state.wind[1]??.25);}
    flora.update(uniforms.uVegTime.value,state);streamside.update(uniforms.uVegTime.value,state);fruitTrees.update(uniforms.uVegTime.value,state);footpath.update(state);
    if(field){uniforms.uVegField.value=field.texture||zero;uniforms.uVegWindField.value=field.windTexture||zero;uniforms.uVegHasField.value=field.texture?1:0;uniforms.uVegHasWindField.value=field.windTexture?1:0;}
  },dispose(){if(disposed)return;disposed=true;treeMotion.dispose();scene.remove(group);flora.dispose();streamside.dispose();fruitTrees.dispose();footpath.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();}};
}
