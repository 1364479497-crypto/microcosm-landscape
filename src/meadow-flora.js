import * as THREE from 'three';
import {PHENOLOGY_GLSL,meadowBloomForType,sampleSeasonalPhenology} from './seasonal-phenology.js';

// Original, texture-free herbaceous forms. These are deliberately legible
// miniature silhouettes, not a claim of botanical species identification.
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
// Relative art-direction budget in this authored scene, not real-world metres.
// Site selection, root positions, counts, palettes and RNG call counts remain
// separate from these dimensions so later scale changes do not repopulate it.
export const MEADOW_FLORA_SCALE_BUDGET=Object.freeze({
  version:'2.1.8',reference:Object.freeze({doorHeight:.367,wallHeight:.49,units:'authored scene units'}),
  factors:Object.freeze({flowerHeight:.52,flowerLeaf:.52,flowerStemRadius:.60,daisyRadius:.25,purpleSpikeWidth:.40,
    butterfly:.16,butterflyOrbit:.40,butterflyClearance:.40,wetHerb:.50,wetHerbLeafNarrowing:.68,
    groundcover:.68,fern:.78,sedgeRushHeight:.78,sedgeRushWidth:.85,floatingRadius:.68,floatingCup:.68,
    floatingPetioleRadius:.80,submergedHeight:.85,submergedLeafLength:.85,submergedLeafWidth:.90,submergedStemRadius:.90,alpineMat:1}),
  limits:Object.freeze({daisyDiameterToDoor:.085,butterflyOpenSpanToDoor:.095,wetHerbLeafWidthToDoor:.10,
    groundcoverLeafLengthToDoor:.18,floatingDiameterToDoor:.25}),
  anchorRule:'Scale each shoot about its sampled root, each flower head about its stem tip, and each floating leaf about its water contact centre.'
});
const SIZE=MEADOW_FLORA_SCALE_BUDGET.factors;
export const ACCENT_FLORA_SPEC=Object.freeze({
  version:'2.1.9',scaleReference:'Preserves the accepted 2.1.8 door/wall relative scale budget.',
  primula:Object.freeze({form:'small red-purple tiered salvers above a narrow basal rosette',targetPlants:8,headsPerPlant:4,height:[.085,.125],radius:[.0065,.0085],habitat:'low, reliably damp, sun to light shade; dry roots above the lake waterline'}),
  geum:Object.freeze({form:'dusky rose pendant five-petal cups with dark sepals and lobed basal leaves',targetPlants:12,headsPerPlant:2,height:[.075,.115],radius:[.0065,.0090],habitat:'low damp meadow and a bright cool woodland edge; dry roots above the waterline'}),
  blue:Object.freeze({form:'small pale-blue five-lobed flowers along short forked stems with lance leaves',targetPlants:8,headsPerPlant:3,height:[.050,.080],radius:[.0045,.0065],habitat:'moist but drained bright woodland edge, away from deep shade and standing water'})
});
// A case-specific flowering succession, added with an independent RNG stream.
// Size stays within the accepted small-flower budget; abundance comes from
// rooted plants in coherent soil patches, never a larger flower billboard.
export const SEASONAL_FLOWER_DRIFTS=Object.freeze({
  version:'2.2.4',maxPatches:46,patchRadius:[.13,.26],plantsPerPatch:[10,17],
  rootHeight:[.080,.145],headRadius:[.0075,.0128],
  forms:['small white-yellow meadow daisies','pink-red damp-edge salvers','low violet summer spikes'],
  habitat:'drained low meadow openings and moist bright edges; path, stone and building solids retain their existing shared owner',
});
function randomSource(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const colour = value => new THREE.Color(value);
const PALETTE = {
  stem: colour('#456837'), fresh: colour('#608745'), light: colour('#83a256'),
  fern: colour('#3e7040'), fernTip: colour('#71934a'), clover: colour('#5a8544'),
  sedge: colour('#768547'), rush: colour('#6d8144'), wetLeaf: colour('#4c7940'),
  underwater: colour('#6c956a'), underwaterTip: colour('#8aaa7d'),
  white: colour('#f1ead7'), yellow: colour('#e3c554'), pollen: colour('#bf8d2d'),
  purple: colour('#9981c2'), purpleTip: colour('#c0a4d8'), seed: colour('#95805a'),
  rose:colour('#c67b96'), roseInner:colour('#e4bdbe'), wine:colour('#784553'), magenta:colour('#b55288'),
  blue:colour('#8fb4d2'), blueEye:colour('#e9d8a0'), accentLeaf:colour('#638447')
};
function metaAt(x,y,z,height,phase,flex=1,type=0,flutter=.025) {
  return {root:[x,y,z,height],traits:[phase,flex,type,flutter]};
}

class FormBuffer {
  constructor() { this.p=[]; this.c=[]; this.root=[]; this.traits=[]; this.i=[]; }
  vertex(p,c,m,tint=1) {
    const n=this.p.length/3;
    this.p.push(p.x,p.y,p.z); this.c.push(c.r*tint,c.g*tint,c.b*tint);
    this.root.push(...m.root); this.traits.push(...m.traits); return n;
  }
  triangle(a,b,c) { this.i.push(a,b,c); }
  geometry() {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));
    g.setAttribute('aFloraRoot',new THREE.Float32BufferAttribute(this.root,4));
    g.setAttribute('aFloraTraits',new THREE.Float32BufferAttribute(this.traits,4));
    g.setIndex(this.i); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}

// Continuous tapering stems keep their lowest ring fixed to the sampled soil.
function stem(b,points,radius,c,m,sides=4) {
  const rings=[];
  for(let j=0;j<points.length;j++) {
    const tangent=points[Math.min(j+1,points.length-1)].clone().sub(points[Math.max(0,j-1)]).normalize();
    const side=new THREE.Vector3(1,0,0).cross(tangent).normalize();
    if(side.lengthSq()<.1)side.set(0,0,1);
    const other=tangent.clone().cross(side).normalize(), ring=[];
    const taper=lerp(1,.42,j/(points.length-1));
    for(let k=0;k<sides;k++) {
      const a=k*TAU/sides,p=points[j].clone().addScaledVector(side,Math.cos(a)*radius*taper).addScaledVector(other,Math.sin(a)*radius*taper);
      ring.push(b.vertex(p,c,m,.82+.18*j/(points.length-1)));
    }
    rings.push(ring);
  }
  for(let j=0;j<rings.length-1;j++)for(let k=0;k<sides;k++) {
    const a=rings[j][k],d=rings[j][(k+1)%sides],e=rings[j+1][k],f=rings[j+1][(k+1)%sides];
    b.triangle(a,d,e); b.triangle(d,f,e);
  }
}

// A raised midrib, pointed outline and bent surface replace flat alpha cards.
function leaf(b,start,end,width,arch,c,m,steps=3,roll=0,droop=0) {
  const dir=end.clone().sub(start),side=new THREE.Vector3(-dir.z,0,dir.x).normalize();
  if(side.lengthSq()<.1)side.set(1,0,0);
  const n=side.clone().cross(dir).normalize(); if(n.y<0)n.negate();
  side.applyAxisAngle(dir.clone().normalize(),roll); n.applyAxisAngle(dir.clone().normalize(),roll);
  const rings=[];
  for(let j=0;j<=steps;j++) {
    const t=j/steps,w=Math.pow(Math.sin(t*Math.PI),.7)*width+.00015;
    const p=start.clone().addScaledVector(dir,t).addScaledVector(UP,Math.sin(t*Math.PI)*arch);
    p.y-=THREE.MathUtils.smoothstep(t,.55,1)*droop;
    const row=[];
    for(let k=0;k<3;k++) {
      const q=p.clone().addScaledVector(side,(k-1)*w);
      if(k===1)q.addScaledVector(n,width*.23*Math.sin(t*Math.PI));
      row.push(b.vertex(q,c,m,(.77+.23*t)*(k===1?1.06:.96)));
    }
    rings.push(row);
  }
  for(let j=0;j<steps;j++)for(let k=0;k<2;k++) {
    b.triangle(rings[j][k],rings[j+1][k],rings[j][k+1]);
    b.triangle(rings[j][k+1],rings[j+1][k],rings[j+1][k+1]);
  }
}

function disk(b,center,n,side,radius,c,m) {
  const across=n.clone().cross(side).normalize(),top=b.vertex(center.clone().addScaledVector(n,radius*.36),c,m,1.12),ring=[];
  for(let k=0;k<10;k++) {
    const a=k*TAU/10;
    ring.push(b.vertex(center.clone().addScaledVector(side,Math.cos(a)*radius).addScaledVector(across,Math.sin(a)*radius),c,m,.83+.12*Math.cos(a)));
  }
  for(let k=0;k<10;k++)b.triangle(top,ring[k],ring[(k+1)%10]);
}

function daisy(b,center,size,c,m,yaw=0) {
  const n=new THREE.Vector3(Math.cos(yaw)*.18,1,Math.sin(yaw)*.18).normalize();
  const side=new THREE.Vector3(Math.cos(yaw),-.18,Math.sin(yaw)).normalize(),across=n.clone().cross(side).normalize();
  const petals=10+Math.floor(m.traits[0]*3),inner=size*.23;
  for(let k=0;k<petals;k++) {
    const a=k*TAU/petals,axis=side.clone().multiplyScalar(Math.cos(a)).addScaledVector(across,Math.sin(a)),cross=n.clone().cross(axis);
    const p=center.clone().addScaledVector(axis,inner*.6),q=center.clone().addScaledVector(axis,size*.65).addScaledVector(n,size*.08),tip=center.clone().addScaledVector(axis,size).addScaledVector(n,size*.025);
    const v=[b.vertex(p,c,m,.88),b.vertex(q.clone().addScaledVector(cross,size*.20),c,m,1),b.vertex(tip.clone().addScaledVector(cross,size*.12),c,m,1.07),b.vertex(tip.clone().addScaledVector(cross,-size*.12),c,m,1.05),b.vertex(q.clone().addScaledVector(cross,-size*.20),c,m,.96),b.vertex(q.clone().addScaledVector(n,size*.055),c,m,1.04)];
    for(const [a0,a1,a2] of [[0,1,5],[1,2,5],[2,3,5],[3,4,5],[4,0,5]])b.triangle(v[a0],v[a1],v[a2]);
  }
  disk(b,center.clone().addScaledVector(n,size*.08),n,side,inner,PALETTE.pollen,m);
}

function spike(b,base,height,width,m,yaw=0) {
  for(let tier=0;tier<6;tier++) {
    const t=tier/5,rad=width*(1-t*.65),y=base.y+height*t;
    for(let k=0;k<4;k++) {
      const a=yaw+k*TAU/4+t*1.7,axis=new THREE.Vector3(Math.cos(a),.30,Math.sin(a)),side=new THREE.Vector3(-Math.sin(a),0,Math.cos(a));
      const center=new THREE.Vector3(base.x,y,base.z).addScaledVector(axis,rad*.4),tip=center.clone().addScaledVector(axis,rad);
      const c=PALETTE.purple.clone().lerp(PALETTE.purpleTip,t*.7);
      for(let p=0;p<3;p++) {
        const aa=(p-1)*.65,offset=side.clone().multiplyScalar(Math.sin(aa)*rad*.55).addScaledVector(UP,Math.cos(aa)*rad*.38);
        const v0=b.vertex(center,c,m,.79),v1=b.vertex(tip.clone().add(offset).addScaledVector(side,-rad*.26),c,m,1),v2=b.vertex(tip.clone().add(offset).addScaledVector(side,rad*.26),c,m,1.08);
        b.triangle(v0,v1,v2);
      }
    }
  }
}

// Compact five-lobed corollas with a narrow throat. Their broad notched lobes
// and whorled/forked attachment are distinct from the many-petal daisy heads.
function salver(b,center,radius,n,c,eye,m,yaw=0,cup=.12) {
  n=n.clone().normalize();const side=Math.abs(n.y)>.8?new THREE.Vector3(1,0,0):new THREE.Vector3().crossVectors(UP,n).normalize();
  side.addScaledVector(n,-side.dot(n)).normalize();const across=n.clone().cross(side).normalize();
  for(let k=0;k<5;k++) {
    const a=yaw+k*TAU/5,point=(angle,rise,rad)=>center.clone().addScaledVector(side,Math.cos(angle)*rad).addScaledVector(across,Math.sin(angle)*rad).addScaledVector(n,rise);
    const verts=[b.vertex(point(a,-radius*cup,radius*.12),c,m,.80),b.vertex(point(a-.48,radius*cup*.20,radius*.61),c,m,.98),b.vertex(point(a-.20,radius*cup,radius*.98),c,m,1.08),b.vertex(point(a,radius*cup*.8,radius*.87),c,m,1.04),b.vertex(point(a+.20,radius*cup,radius*.98),c,m,1.05),b.vertex(point(a+.48,radius*cup*.20,radius*.61),c,m,.96),b.vertex(point(a,radius*cup*.65,radius*.58),c,m,1.02)];
    for(const [i,j,l] of [[0,1,6],[1,2,6],[2,3,6],[3,4,6],[4,5,6],[5,0,6]])b.triangle(verts[i],verts[j],verts[l]);
  }
  disk(b,center.clone().addScaledVector(n,-radius*cup*.3),n,side,radius*.17,eye,m);
}

function pendantCup(b,neck,radius,m,yaw=0) {
  const n=new THREE.Vector3(Math.cos(yaw)*.26,-1,Math.sin(yaw)*.26).normalize(),side=new THREE.Vector3(-Math.sin(yaw),0,Math.cos(yaw)),across=n.clone().cross(side).normalize();
  for(let k=0;k<5;k++) {
    const a=yaw+k*TAU/5,rows=[];
    for(let j=0;j<3;j++) {
      const r=radius*[.25,1,.78][j],depth=radius*[0,.68,1.45][j],row=[];
      for(let p=0;p<3;p++) {
        const aa=a+(p-1)*.49,q=neck.clone().addScaledVector(n,depth).addScaledVector(side,Math.cos(aa)*r).addScaledVector(across,Math.sin(aa)*r);
        if(j===2&&p===1)q.addScaledVector(n,-radius*.12);
        row.push(b.vertex(q,j===0?PALETTE.wine:PALETTE.rose.clone().lerp(PALETTE.roseInner,j*.18),m,.92+p*.04));
      }
      rows.push(row);
    }
    for(let j=0;j<2;j++)for(let p=0;p<2;p++){b.triangle(rows[j][p],rows[j+1][p],rows[j][p+1]);b.triangle(rows[j][p+1],rows[j+1][p],rows[j+1][p+1]);}
    const calyx=neck.clone().addScaledVector(side,Math.cos(a)*radius*.68).addScaledVector(across,Math.sin(a)*radius*.68).addScaledVector(n,radius*.24);
    const i=b.vertex(neck,PALETTE.wine,m,.8),j=b.vertex(calyx.clone().addScaledVector(side,radius*.15),PALETTE.wine,m,1),l=b.vertex(calyx.clone().addScaledVector(side,-radius*.15),PALETTE.wine,m,.9);b.triangle(i,j,l);
  }
}

const FLORA_VERTEX = `
uniform float uFloraTime,uFloraWindAmount,uFloraHasField,uFloraHasWind,uFloraWet,uFloraSnow;
uniform vec2 uFloraWind;
uniform vec4 uFloraBounds;
uniform sampler2D uFloraField,uFloraWindField;
attribute vec4 aFloraRoot,aFloraTraits;
varying vec4 vFloraTraits;
varying vec3 vFloraField;
varying float vFloraTip;
vec2 floraWind(vec3 root){
  vec2 wind=uFloraWind*uFloraWindAmount;
  vec2 fuv=clamp((root.xz-uFloraBounds.xy)/uFloraBounds.zw,vec2(0.),vec2(1.));
  return mix(wind,texture2D(uFloraWindField,fuv).rg,uFloraHasWind);
}
vec3 floraBend(vec3 p){
  float h=max(.01,aFloraRoot.w),tip=clamp((p.y-aFloraRoot.y)/h,0.,1.15);
  vec2 wind=floraWind(aFloraRoot.xyz);
  float gust=.62+.24*sin(uFloraTime*1.5+aFloraRoot.x*.83+aFloraRoot.z*1.15)+.14*sin(uFloraTime*3.4+aFloraTraits.x*31.);
  p.xz+=wind*pow(tip,1.8)*h*.32*gust*aFloraTraits.y;
  p.y-=dot(wind,wind)*tip*tip*h*.025*aFloraTraits.y;
  p.xz+=vec2(sin(uFloraTime*5.1+aFloraTraits.x*47.),cos(uFloraTime*4.3+aFloraTraits.x*33.))*aFloraTraits.w*h*tip*tip*length(wind);
  return p;
}
`;
const FLORA_FRAGMENT = `
uniform float uFloraSeason,uFloraWet,uFloraSnow;
varying vec4 vFloraTraits;
varying vec3 vFloraField;
varying float vFloraTip;
${PHENOLOGY_GLSL}
float floraBloom(){return meadowBloomForType(1.,uFloraSeason);}
float floraBloomForType(float type){return meadowBloomForType(type,uFloraSeason);}
`;
function plantMaterial(uniforms,underwater=false,depth=false) {
  const m=depth?new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}):new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:underwater?.62:.87,metalness:0,side:THREE.DoubleSide});
  m.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=FLORA_VERTEX+shader.vertexShader;
    if(!depth)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      float floraH=max(.01,aFloraRoot.w),floraTip=clamp((position.y-aFloraRoot.y)/floraH,0.,1.15);
      vec2 floraShear=floraWind(aFloraRoot.xyz)*pow(floraTip,.8)*.30*aFloraTraits.y;
      objectNormal.y-=dot(objectNormal.xz,floraShear);
      objectNormal=normalize(objectNormal);
    `);
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      transformed=floraBend(transformed);
      vFloraTraits=aFloraTraits;
      vFloraTip=clamp((position.y-aFloraRoot.y)/max(.01,aFloraRoot.w),0.,1.);
      vec2 floraUV=clamp((aFloraRoot.xz-uFloraBounds.xy)/uFloraBounds.zw,vec2(0.),vec2(1.));
      vec4 floraField=texture2D(uFloraField,floraUV);
      vFloraField=mix(vec3(uFloraWet,uFloraSnow,1.),floraField.rga,uFloraHasField);
    `);
    // The same seasonal discard and displacement run in the shadow pass.
    shader.fragmentShader=FLORA_FRAGMENT+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      if(vFloraTraits.z>.5&&vFloraTraits.z<1.5&&vFloraTraits.x>floraBloomForType(vFloraTraits.z))discard;
    `);
    if(!depth)shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float floraAutumn=smoothstep(1.1,2.25,uFloraSeason)*(1.-smoothstep(3.55,4.,uFloraSeason));
      float floraWinter=smoothstep(2.25,2.94,uFloraSeason)*(1.-smoothstep(3.55,4.,uFloraSeason));
      float floraAquatic=step(2.5,vFloraTraits.z);
      vec3 floraStraw=diffuseColor.rgb*vec3(1.24,.94,.55)+vec3(.025,.013,.003);
      if(vFloraTraits.z<.5)diffuseColor.rgb=mix(diffuseColor.rgb,floraStraw,floraAutumn*.66);
      diffuseColor.rgb*=1.-clamp(max(vFloraField.x,uFloraWet*.3),0.,1.)*.16;
      diffuseColor.rgb*=.87+.13*clamp(vFloraField.z,0.,1.);
      float floraSnow=clamp(max(vFloraField.y,uFloraSnow*.25),0.,1.)*(1.-floraAquatic);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.87,.91,.92),floraSnow*mix(.45,.76,vFloraTip)*floraWinter);
    `);
  };
  m.customProgramCacheKey=()=>`original-meadow-flora-v2-phenology-${underwater}-${depth}`; return m;
}

function makeWing(side) {
  const b=new FormBuffer(),m=metaAt(0,0,0,1,0),warm=colour('#d7ad66'),dark=colour('#5d4939'),light=colour('#f0dec1');
  // A large forewing and a scalloped hindwing meet along the body hinge.
  for(const [lobe,outline] of [
    [[.006,.023],[.034,.069],[.072,.077],[.100,.053],[.105,.031],[.087,.018],[.064,.006],[.030,-.005]],
    [[.007,.005],[.047,.007],[.080,-.011],[.085,-.035],[.068,-.055],[.050,-.059],[.030,-.043],[.010,-.028]]
  ].entries()) {
    const center=new THREE.Vector3(side*.027,.002,lobe===0?.024:-.020),vcenter=b.vertex(center,warm,m,1),inner=[],outer=[];
    for(let j=0;j<outline.length;j++) {
      const [x,z]=outline[j];
      outer.push(b.vertex(new THREE.Vector3(side*x,0,z),dark,m,.90));
      inner.push(b.vertex(new THREE.Vector3(side*lerp(.020,x,.78),.003,lerp(.005,z,.78)),j%3===1?light:warm,m,j%2?1.08:.89));
    }
    for(let j=0;j<outer.length;j++) {
      const k=(j+1)%outer.length;
      const tris=[[vcenter,inner[j],inner[k]],[inner[j],outer[j],outer[k]],[inner[j],outer[k],inner[k]]];
      for(const t of tris)b.triangle(...(side>0?t:[t[0],t[2],t[1]]));
    }
  }
  return b.geometry();
}
function makeButterflyBody() {
  const g=new THREE.SphereGeometry(1,8,5);g.scale(.007,.008,.038);
  const b=new FormBuffer(),m=metaAt(0,0,0,1,0),c=colour('#4d4032'),p=g.getAttribute('position');
  for(let i=0;i<p.count;i++)b.vertex(new THREE.Vector3().fromBufferAttribute(p,i),c,m);
  b.i.push(...g.index.array);g.dispose();
  for(const sign of [-1,1])stem(b,[new THREE.Vector3(sign*.003,.003,.025),new THREE.Vector3(sign*.009,.009,.043),new THREE.Vector3(sign*.015,.012,.049)],.0011,c,m,3);
  return b.geometry();
}

/** Herb/flower/shore/lake layer. update() accepts absolute time; state.time wins. */
export function createMeadowFlora({terrain,habitat,seed=42,field=null}={}) {
  if(!habitat?.sample||!habitat?.allowed||!habitat?.noise)throw new Error('createMeadowFlora requires the shared meadow habitat.');
  const group=new THREE.Group(); group.name='Original meadow, woodland herbs and lake plants';
  const r=randomSource(seed^0x7f128a91),land=new FormBuffer(),flowers=new FormBuffer(),wet=new FormBuffer(),floating=new FormBuffer(),submerged=new FormBuffer(),accentGreen=new FormBuffer(),accentPetals=new FormBuffer(),springGreen=new FormBuffer(),springPetals=new FormBuffer(),successionGreen=new FormBuffer(),successionPetals=new FormBuffer();
  const scaleAudit={budget:MEADOW_FLORA_SCALE_BUDGET,groups:{}};
  function auditPart(kind,buffer,start,root,details={}) {
    const end=buffer.p.length/3;if(end<=start)return;
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=start;i<end;i++)for(let k=0;k<3;k++){min[k]=Math.min(min[k],buffer.p[i*3+k]);max[k]=Math.max(max[k],buffer.p[i*3+k]);}
    const {dimensions,...context}=details;
    const g=scaleAudit.groups[kind]||(scaleAudit.groups[kind]={count:0,worldBounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},height:{min:Infinity,max:0,sum:0,mean:0},spreadXZ:{min:Infinity,max:0,sum:0,mean:0},...context});
    const height=Math.max(0,max[1]-root.y),spread=Math.max(max[0]-min[0],max[2]-min[2]);g.count++;
    for(let k=0;k<3;k++){g.worldBounds.min[k]=Math.min(g.worldBounds.min[k],min[k]);g.worldBounds.max[k]=Math.max(g.worldBounds.max[k],max[k]);}
    for(const [key,value] of [['height',height],['spreadXZ',spread]]){const v=g[key];v.min=Math.min(v.min,value);v.max=Math.max(v.max,value);v.sum+=value;v.mean=v.sum/g.count;}
    if(dimensions)for(const [key,value] of Object.entries(dimensions)) {
      g.dimensions||={};const v=g.dimensions[key]||(g.dimensions[key]={min:Infinity,max:0,sum:0,mean:0});
      v.min=Math.min(v.min,value);v.max=Math.max(v.max,value);v.sum+=value;v.mean=v.sum/g.count;
    }
    g.maxHeightToDoor=g.height.max/MEADOW_FLORA_SCALE_BUDGET.reference.doorHeight;g.maxSpreadToDoor=g.spreadXZ.max/MEADOW_FLORA_SCALE_BUDGET.reference.doorHeight;
  }
  const geometries=new Set(),materials=new Set(),flowerPatches=[],surfaceLeafCenters=[],underwaterRoots=[],fernRoots=[],shoreRoots=[],alpineRoots=[],floatingLeafRanges=[],floatingStemRanges=[],accentRoots=[],accentPatches=[];
  const shoreR=randomSource(seed^0x2a7cf813),floatR=randomSource(seed^0x0b6a9d43),waterR=randomSource(seed^0x32e716c1),alpineR=randomSource(seed^0x1acb7265);
  const bounds=field?.bounds||{minX:-6,minZ:-5.3,sizeX:12,sizeZ:9.6};
  const zero=new THREE.DataTexture(new Float32Array([0,0,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType);zero.needsUpdate=true;
  const uniforms={uFloraTime:{value:0},uFloraSeason:{value:0},uFloraWet:{value:0},uFloraSnow:{value:0},uFloraWind:{value:new THREE.Vector2(.85,.25).normalize()},uFloraWindAmount:{value:.13},uFloraField:{value:field?.texture||zero},uFloraWindField:{value:field?.windTexture||zero},uFloraHasField:{value:field?.texture?1:0},uFloraHasWind:{value:field?.windTexture?1:0},uFloraBounds:{value:new THREE.Vector4(bounds.minX,bounds.minZ,bounds.sizeX,bounds.sizeZ)}};
  const stats={seed,drawCalls:0,triangles:0,vertices:0,flowerPatches:0,flowerPlants:0,whiteDaisies:0,yellowDaisies:0,purpleSpikes:0,groundcoverPatches:0,cloverLeaves:0,broadLeaves:0,fernClumps:0,fernFronds:0,sedgeClumps:0,rushClumps:0,wetHerbs:0,floatingGroups:0,floatingLeaves:0,submergedPlants:0,submergedBranches:0,butterflies:8,butterflyFlying:0,butterflyPerched:0,alpineHerbs:0,originalProceduralAssets:true};
  stats.accentFlowers=0;stats.accentPlants=0;stats.accentKinds=Object.fromEntries(Object.keys(ACCENT_FLORA_SPEC).filter(k=>typeof ACCENT_FLORA_SPEC[k]==='object').map(k=>[k,{patches:0,plants:0,heads:0,maxHeight:0,maxDiameter:0}]));
  const landSite=(x,z,margin=.035)=>{
    const s=habitat.sample(x,z);
    return habitat.allowed(x,z,margin)&&s.waterDepth<=.004&&s.path<.16&&s.rock<.10&&s.slope>.76?s:null;
  };
  const freshColour=s=>PALETTE.fresh.clone().lerp(PALETTE.fern,clamp(s.shade,0,1)*.55).multiplyScalar(.91+clamp(s.patch,0,1)*.14);

  function flowerPatch(x,z,s,kind) {
    const small=1-s.alpine*.66,phase=r(),count=3+Math.floor(r()*4),radius=(.10+r()*.11)*small,heads=[];
    for(let j=0;j<count;j++) {
      const a=r()*TAU,d=Math.sqrt(r())*radius,px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d,site=landSite(px,pz,.025);if(!site)continue;
      const h=(kind==='purple'?.25+r()*.14:.16+r()*.18)*small*SIZE.flowerHeight,base=new THREE.Vector3(px,site.height-.003,pz),lean=new THREE.Vector3((r()-.5)*h*.2,0,(r()-.5)*h*.2),head=base.clone().add(lean).addScaledVector(UP,h),plantStart=land.p.length/3;
      const m=metaAt(px,base.y,pz,h,phase,.8,0,.015),stemColour=freshColour(site);
      stem(land,[base,base.clone().lerp(head,.5).addScaledVector(lean,-.18),head],.0022*small*SIZE.flowerStemRadius,stemColour,m,4);
      const yaw=r()*TAU;
      for(let k=0;k<3;k++) {
        const a0=yaw+k*2.3,p=base.clone().lerp(head,.21+k*.17),len=(.050+r()*.038)*small*SIZE.flowerLeaf;
        leaf(land,p,p.clone().add(new THREE.Vector3(Math.cos(a0)*len,len*.22,Math.sin(a0)*len)),kind==='purple'?len*.18:len*.28,len*.13,stemColour,m,3,(r()-.5)*.4);
      }
      auditPart('flowerStemAndLeaves',land,plantStart,base,{factor:SIZE.flowerHeight});
      auditPart(kind==='purple'?'purpleStemAndLeaves':'daisyStemAndLeaves',land,plantStart,base,{factor:SIZE.flowerHeight});
      const fm=metaAt(px,base.y,pz,h,phase,.8,kind==='purple'?1.46:1,.012);
      const flowerStart=flowers.p.length/3;
      if(kind==='purple') {
        spike(flowers,head.clone().addScaledVector(UP,-h*.32),h*.34,.021*small*SIZE.purpleSpikeWidth,fm,yaw);stats.purpleSpikes++;
        auditPart('purpleSpike',flowers,flowerStart,head,{heightFactor:SIZE.flowerHeight,widthFactor:SIZE.purpleSpikeWidth});
      } else {const radius=(.041+r()*.016)*small*SIZE.daisyRadius;daisy(flowers,head,radius,kind==='yellow'?PALETTE.yellow:PALETTE.white,fm,yaw);stats[kind==='yellow'?'yellowDaisies':'whiteDaisies']++;
        auditPart('daisyHead',flowers,flowerStart,head,{factor:SIZE.daisyRadius,dimensions:{radius,diameter:radius*2}});}
      heads.push(head);stats.flowerPlants++;if(site.alpine>.5)stats.alpineHerbs++;
    }
    if(heads.length)flowerPatches.push({x,z,y:s.height,height:Math.max(...heads.map(p=>p.y))-s.height,radius,kind,phase,plants:heads.length,positions:heads,bloomType:kind==='purple'?1.46:1});
  }

  function groundcover(x,z,s,clover=true) {
    const small=1-s.alpine*.62,phase=r(),c=freshColour(s).lerp(PALETTE.clover,.4),plants=3+Math.floor(r()*4);
    for(let j=0;j<plants;j++) {
      const a=r()*TAU,d=r()*.10*small,px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d,site=landSite(px,pz,.018);if(!site)continue;
      const h=(.025+r()*.043)*small*SIZE.groundcover,base=new THREE.Vector3(px,site.height-.004,pz),top=base.clone().addScaledVector(UP,h),m=metaAt(px,base.y,pz,h+.04*small*SIZE.groundcover,phase,.75,0,.018),partStart=land.p.length/3;
      stem(land,[base,top],.0014*small*SIZE.groundcover,c,m,3);
      if(clover)for(let k=0;k<3;k++) {
        const aa=a+k*TAU/3,len=(.028+r()*.020)*small*SIZE.groundcover,end=top.clone().add(new THREE.Vector3(Math.cos(aa)*len,.006*small*SIZE.groundcover,Math.sin(aa)*len)),leafStart=land.p.length/3;
        leaf(land,top,end,len*.58,.005*small*SIZE.groundcover,c,m,3);stats.cloverLeaves++;auditPart('cloverLeaf',land,leafStart,top,{factor:SIZE.groundcover});
      } else for(let k=0;k<3;k++) {
        const aa=a+k*2.2,len=(.055+r()*.034)*small*SIZE.groundcover,leafStart=land.p.length/3;
        leaf(land,base.clone().addScaledVector(UP,.008*SIZE.groundcover),base.clone().add(new THREE.Vector3(Math.cos(aa)*len,h*.8,Math.sin(aa)*len)),len*.34,h*.35,c,m,3);stats.broadLeaves++;auditPart('broadGroundLeaf',land,leafStart,base,{factor:SIZE.groundcover});
      }
      auditPart('groundcoverPlant',land,partStart,base,{factor:SIZE.groundcover});
    }
    stats.groundcoverPatches++;if(s.alpine>.5)stats.alpineHerbs++;
  }

  function fern(x,z,s) {
    const h=(.16+r()*.13)*SIZE.fern,base=new THREE.Vector3(x,s.height-.005,z),phase=r(),m=metaAt(x,base.y,z,h,phase,.67,0,.012),yaw=r()*TAU,partStart=land.p.length/3;
    const count=5+Math.floor(r()*3);
    for(let j=0;j<count;j++) {
      const a=yaw+j*TAU/count,len=h*(.82+r()*.40),axis=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),points=[];
      for(let k=0;k<5;k++){const t=k/4;points.push(base.clone().addScaledVector(axis,len*t).addScaledVector(UP,h*Math.sin(t*1.7)*(.95-t*.28)));}
      stem(land,points,.0017*SIZE.fern,PALETTE.fern,m,3);
      const side=new THREE.Vector3(-axis.z,0,axis.x);
      for(let k=1;k<7;k++) {
        const t=k/7,p=base.clone().addScaledVector(axis,len*t).addScaledVector(UP,h*Math.sin(t*1.7)*(.95-t*.28));
        const w=len*.31*Math.pow(Math.sin(t*Math.PI),.7)*(1-t*.25);
        for(const sign of [-1,1])leaf(land,p,p.clone().addScaledVector(side,w*sign).addScaledVector(axis,w*.28).addScaledVector(UP,-w*.16),w*.15,w*.05,PALETTE.fern.clone().lerp(PALETTE.fernTip,t*.6),m,2);
      }
      stats.fernFronds++;
    }
    auditPart('fernClump',land,partStart,base,{factor:SIZE.fern});fernRoots.push(base);stats.fernClumps++;
  }

  // Stratified irregular sites preserve open turf between coherent patches.
  const sites=[];
  for(let z=-5.05;z<4.12;z+=.235)for(let x=-5.75;x<5.8;x+=.235)sites.push([x+(r()-.5)*.21,z+(r()-.5)*.21,r()]);
  sites.sort((a,b)=>a[2]-b[2]);
  for(const [x,z] of sites) {
    const s=landSite(x,z,.045);if(!s)continue;
    const patch=clamp(s.patch,0,1),density=clamp(s.density,0,1),n=habitat.noise(x*.97+13.3,z*.97-8.1);
    const alpine=clamp(s.alpine,0,1);
    const moistShade=s.shade>.34&&s.shade<.80&&(s.shore>.14||(s.height<.86&&patch>.60));
    if(moistShade&&alpine<.4&&stats.fernClumps<62&&r()<(.18+s.shade*.55+s.rockEdge*.20)*Math.max(.15,density)&&patch>.24)fern(x,z,s);
    else if(stats.flowerPatches<90&&s.shade<.56&&s.shore<.7&&patch>.43&&r()<density*(1-s.shade)*(.27-alpine*.21)) {
      const kind=alpine>.6?'white':n>.67?'purple':n>.36?'yellow':'white';flowerPatch(x,z,s,kind);stats.flowerPatches=flowerPatches.length;
    } else if(stats.groundcoverPatches<225&&r()<density*(.20+s.shade*.25+s.rockEdge*.24)*(1-alpine*.7)&&patch>.28)groundcover(x,z,s,n>.44);
  }

  // A few soil pockets support small, low rosettes above the meadow. Each
  // offset root is checked again so a clump cannot grow across a bare cliff.
  const alpineSites=[];
  for(let z=-4.82;z<.8;z+=.16)for(let x=-5.65;x<5.65;x+=.16) {
    const px=x+(alpineR()-.5)*.12,pz=z+(alpineR()-.5)*.12,s=landSite(px,pz,.035);
    if(!s||s.height<1.6||s.height>2.9||s.slope<.84||s.patch<.60&&s.rockEdge<.15)continue;
    alpineSites.push({x:px,z:pz,s,rank:alpineR()+s.patch*.6+s.rockEdge*.4});
  }
  alpineSites.sort((a,b)=>b.rank-a.rank);
  for(const site of alpineSites) {
    if(alpineRoots.length>=14)break;
    if(alpineRoots.some(p=>Math.hypot(p.x-site.x,p.z-site.z)<.20))continue;
    let placed=0;
    for(let j=0;j<4;j++) {
      const a=alpineR()*TAU,px=site.x+Math.cos(a)*alpineR()*.035,pz=site.z+Math.sin(a)*alpineR()*.035,s=landSite(px,pz,.018);
      if(!s||s.height<1.6||s.height>2.9||s.slope<.84||s.patch<.60&&s.rockEdge<.15)continue;
      const h=.026+alpineR()*.018,base=new THREE.Vector3(px,s.height-.004,pz),phase=alpineR(),m=metaAt(px,base.y,pz,h,phase,.42,0,.008),partStart=land.p.length/3;
      const c=PALETTE.clover.clone().lerp(PALETTE.light,alpineR()*.3);
      for(let k=0;k<4;k++) {
        const aa=a+k*TAU/4,len=.024+alpineR()*.021;
        leaf(land,base,base.clone().add(new THREE.Vector3(Math.cos(aa)*len,h*.72,Math.sin(aa)*len)),len*.40,h*.26,c,m,3);stats.broadLeaves++;
      }
      auditPart('existingAlpineRosette',land,partStart,base,{factor:1});
      placed++;
    }
    if(placed){alpineRoots.push({x:site.x,z:site.z,y:site.s.height-.004,plants:placed});stats.groundcoverPatches++;stats.alpineHerbs++;}
  }

  function wetClump(x,z,s,kind) {
    const rootY=s.height-.005,phase=shoreR(),h=(.19+shoreR()*.17)*(kind==='herb'?SIZE.wetHerb:SIZE.sedgeRushHeight),base=new THREE.Vector3(x,rootY,z),m=metaAt(x,rootY,z,h,phase,.62,0,.01),yaw=shoreR()*TAU,partStart=wet.p.length/3;
    if(kind==='herb') {
      for(let k=0;k<5;k++) {
        const a=yaw+k*2.4,len=(.080+shoreR()*.055)*SIZE.wetHerb,leafStart=wet.p.length/3;
        leaf(wet,base,base.clone().add(new THREE.Vector3(Math.cos(a)*len,h*(.30+shoreR()*.22),Math.sin(a)*len)),len*.34*SIZE.wetHerbLeafNarrowing,h*.20,PALETTE.wetLeaf,m,4,k%2?-.13:.13,h*.18);
        auditPart('wetHerbLeaf',wet,leafStart,base,{lengthFactor:SIZE.wetHerb,widthFactor:SIZE.wetHerb*SIZE.wetHerbLeafNarrowing,form:'narrow folded arch with a drooping distal section',dimensions:{length:len,fullWidth:len*.68*SIZE.wetHerbLeafNarrowing}});
      }
      const top=base.clone().addScaledVector(UP,h*.94);stem(wet,[base,top],.0025*SIZE.wetHerb,PALETTE.stem,m,4);
      if(phase>.55)daisy(flowers,top,.030*SIZE.daisyRadius,PALETTE.white,metaAt(x,rootY,z,h,phase,.62,1,.008),yaw);
      auditPart('wetHerbPlant',wet,partStart,base,{factor:SIZE.wetHerb});
      shoreRoots.push({x,z,y:rootY,kind,height:h});stats.wetHerbs++;return;
    }
    const count=kind==='rush'?6:8;
    for(let j=0;j<count;j++) {
      const a=yaw+(j/(count-1)-.5)*2.05+(shoreR()-.5)*.22,height=h*(.55+shoreR()*.5),dx=Math.cos(a),dz=Math.sin(a),p=base.clone().add(new THREE.Vector3(dx*shoreR()*.018,0,dz*shoreR()*.018));
      if(!habitat.allowed(p.x,p.z,.004))continue;
      const root=habitat.sample(p.x,p.z);p.y=root.height-.005;
      const bladeMeta=metaAt(p.x,p.y,p.z,h,phase,.62,0,.01);
      if(kind==='rush') {
        const tip=p.clone().add(new THREE.Vector3(dx*.028*SIZE.sedgeRushHeight,height,dz*.028*SIZE.sedgeRushHeight));
        stem(wet,[p,p.clone().lerp(tip,.55).add(new THREE.Vector3(dx*.01*SIZE.sedgeRushHeight,0,dz*.01*SIZE.sedgeRushHeight)),tip],.0026*SIZE.sedgeRushWidth,PALETTE.rush,bladeMeta,4);
        if(j%3===0)spike(wet,tip.clone().addScaledVector(UP,-.024*SIZE.sedgeRushHeight),.026*SIZE.sedgeRushHeight,.0045*SIZE.sedgeRushWidth,bladeMeta,a);
      } else leaf(wet,p,p.clone().add(new THREE.Vector3(dx*height*(.34+shoreR()*.24),height*.91,dz*height*(.34+shoreR()*.24))),(.0045+shoreR()*.004)*SIZE.sedgeRushWidth,height*.13,PALETTE.sedge,bladeMeta,4);
    }
    auditPart(kind==='rush'?'rushClump':'sedgeClump',wet,partStart,base,{heightFactor:SIZE.sedgeRushHeight,widthFactor:SIZE.sedgeRushWidth});
    shoreRoots.push({x,z,y:rootY,kind,height:h});
    stats[kind==='rush'?'rushClumps':'sedgeClumps']++;
  }
  // Shore roots use their own finer soil grid. The broad random field breaks
  // the narrow waterline into inhabited stretches, leaving bare bank between.
  const shoreSites=[];
  for(let z=.35;z<4.08;z+=.11)for(let x=-1.5;x<4.3;x+=.11) {
    const px=x+(shoreR()-.5)*.068,pz=z+(shoreR()-.5)*.068,s=habitat.sample(px,pz);
    const patchiness=habitat.noise(px*1.18+31.4,pz*1.18-12.7);
    if(s.shore<.28||s.waterDepth<-.24||s.waterDepth>.085||s.rock>.08||s.path>.12||s.slope<.67||!habitat.allowed(px,pz,.035)||patchiness<.31)continue;
    shoreSites.push({x:px,z:pz,s,rank:shoreR()*.48+patchiness*.52});
  }
  shoreSites.sort((a,b)=>b.rank-a.rank);
  for(const [kind,quota,gap] of [['herb',12,.145],['rush',16,.112],['sedge',28,.105]]) {
    let count=0;
    for(const site of shoreSites) {
      if(count>=quota)break;
      if(kind==='herb'&&(site.s.waterDepth>.015||site.s.slope<.70)||kind==='rush'&&site.s.waterDepth<-.19)continue;
      if(shoreRoots.some(p=>Math.hypot(p.x-site.x,p.z-site.z)<gap))continue;
      wetClump(site.x,site.z,site.s,kind);count++;
    }
  }

  // Leave the cascade mouth, landing/boat, and most of the lake open.
  function lakeSite(x,z,minDepth=.13) {
    const s=habitat.sample(x,z);
    if(s.waterDepth<minDepth||s.waterDepth>1.05||s.rock>.08||!habitat.allowed(x,z,.065))return null;
    if(x<.45&&x>-1.60&&z>1.58&&z<3.13)return null;
    if(x>-.60&&x<1.38&&z<2.25)return null;
    if(z>4.04)return null;
    return s;
  }
  const floatingSites=[],floatingCandidates=[];
  const calmPockets=[{x:2.96,z:2.10,rx:.62,rz:.47},{x:2.87,z:3.59,rx:.64,rz:.40}];
  for(let z=1.65;z<4.02;z+=.14)for(let x=2.20;x<3.66;x+=.14) {
    const px=x+(floatR()-.5)*.11,pz=z+(floatR()-.5)*.11;
    const pocket=calmPockets.findIndex(p=>((px-p.x)/p.rx)**2+((pz-p.z)/p.rz)**2<1);
    if(pocket<0)continue;const s=lakeSite(px,pz,.20);if(!s||s.waterDepth>.65)continue;
    floatingCandidates.push({x:px,z:pz,s,pocket,rank:floatR()});
  }
  floatingCandidates.sort((a,b)=>a.rank-b.rank);
  const pocketCounts=[0,0];
  for(const candidate of floatingCandidates) {
    const {x,z,s,pocket}=candidate;
    if(stats.floatingGroups>=7)break;
    if(pocketCounts[pocket]>=4||floatingSites.some(p=>Math.hypot(p.x-x,p.z-z)<.25+candidate.rank*.09))continue;
    const level=s.height+s.waterDepth,phase=floatR(),count=4+(floatR()<.25?1:0),m=metaAt(x,s.height,z,s.waterDepth+.012,phase,0,3,0);
    let accepted=0;
    for(let j=0;j<count;j++) {
      const a=floatR()*TAU,d=.025+floatR()*.11,px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d,site=lakeSite(px,pz,.15);if(!site)continue;
      const center=new THREE.Vector3(px,level+.004,pz),radius=(.040+floatR()*.024)*SIZE.floatingRadius,yaw=floatR()*TAU;
      // A 35-degree notch makes each cupped floating leaf visibly lobed.
      const c=PALETTE.wetLeaf.clone().lerp(PALETTE.light,floatR()*.30),rim=[];
      const leafStart=floating.p.length/3,centerI=floating.vertex(center,c,m,.86);
      for(let k=0;k<=11;k++) {
        const aa=yaw+.30+k/11*(TAU-.60),rr=radius*(.92+.08*Math.sin(aa*3));
        rim.push(floating.vertex(new THREE.Vector3(px+Math.cos(aa)*rr,center.y+.002*SIZE.floatingCup*Math.sin(k/11*Math.PI),pz+Math.sin(aa)*rr),c,m,1+.09*Math.sin(aa)));
      }
      for(let k=0;k<rim.length-1;k++)floating.triangle(centerI,rim[k+1],rim[k]);
      auditPart('floatingLeaf',floating,leafStart,center,{radiusFactor:SIZE.floatingRadius,cupFactor:SIZE.floatingCup,verticalContactOffset:.004});
      floatingLeafRanges.push({start:leafStart,end:floating.p.length/3,level,center});
      const stemStart=submerged.p.length/3;
      const bendAngle=a+.45,bend=.045+floatR()*.035;
      stem(submerged,[new THREE.Vector3(x,s.height+.007,z),new THREE.Vector3(lerp(x,px,.30)+Math.cos(bendAngle)*bend,lerp(s.height,level,.38),lerp(z,pz,.30)+Math.sin(bendAngle)*bend),new THREE.Vector3(lerp(x,px,.74)+Math.cos(bendAngle)*bend*.5,lerp(s.height,level,.76),lerp(z,pz,.74)+Math.sin(bendAngle)*bend*.5),center.clone().addScaledVector(UP,-.006)],.0017*SIZE.floatingPetioleRadius,PALETTE.underwaterTip,m,4);
      auditPart('floatingPetiole',submerged,stemStart,new THREE.Vector3(x,s.height+.007,z),{radiusFactor:SIZE.floatingPetioleRadius,heightFactor:1,depthOwner:'actual soil-to-surface distance'});
      floatingStemRanges.push({start:stemStart,end:submerged.p.length/3,level,rootY:s.height+.007});
      surfaceLeafCenters.push(center);stats.floatingLeaves++;accepted++;
    }
    if(accepted){floatingSites.push({x,z,pocket});pocketCounts[pocket]++;stats.floatingGroups++;}
  }
  for(const [x,z] of sites) {
    const s=lakeSite(x,z,.17);if(!s||stats.submergedPlants>=78||waterR()>.42||habitat.noise(x*1.5+6,z*1.5)>.68)continue;
    const maxH=Math.max(.055,s.waterDepth-.075),h=Math.min(.14+waterR()*.24,maxH)*SIZE.submergedHeight,base=new THREE.Vector3(x,s.height+.006,z),phase=waterR(),yaw=waterR()*TAU,m=metaAt(x,base.y,z,h,phase,.34,3,.018),branches=2+Math.floor(waterR()*2),partStart=submerged.p.length/3;
    for(let j=0;j<branches;j++) {
      const a=yaw+j*2.4,axis=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),bh=h*(.70+waterR()*.26),top=base.clone().addScaledVector(UP,bh).addScaledVector(axis,bh*.27);
      stem(submerged,[base,base.clone().lerp(top,.52).addScaledVector(axis,-.016*SIZE.submergedHeight),top],.0022*SIZE.submergedStemRadius,PALETTE.underwater,m,4);
      for(let k=1;k<5;k++) {
        const t=k/5,p=base.clone().lerp(top,t),len=.034*(.7+Math.sin(t*Math.PI))*SIZE.submergedLeafLength;
        for(let q=0;q<3;q++) {
          const aa=a+q*TAU/3+k*.7,end=p.clone().add(new THREE.Vector3(Math.cos(aa)*len,len*.22,Math.sin(aa)*len));
          leaf(submerged,p,end,.005*SIZE.submergedLeafWidth,.008*SIZE.submergedLeafLength,PALETTE.underwater.clone().lerp(PALETTE.underwaterTip,t*.7),m,3,.2);
        }
      }
      // The terminal blade also remains at least 5 cm below the surface.
      leaf(submerged,top.clone().addScaledVector(UP,-.035*SIZE.submergedHeight),top.clone().addScaledVector(axis,.018*SIZE.submergedLeafLength),.005*SIZE.submergedLeafWidth,.009*SIZE.submergedLeafLength,PALETTE.underwaterTip,m,3);
      stats.submergedBranches++;
    }
    auditPart('submergedPlant',submerged,partStart,base,{heightFactor:SIZE.submergedHeight,leafLengthFactor:SIZE.submergedLeafLength,leafWidthFactor:SIZE.submergedLeafWidth});underwaterRoots.push({x,z,y:base.y,top:base.y+h,water:s.height+s.waterDepth});stats.submergedPlants++;
  }

  // Accent placement has an independent stream for each form. No draw from the
  // original meadow RNG is consumed, and the accepted old buffers stay intact.
  function accentSite(x,z,kind) {
    const s=landSite(x,z,.025);if(!s||s.waterDepth>=0||s.height>.95||s.alpine>.12||s.shade>.66||s.patch<.27)return null;
    if(kind==='blue')return s.shade>.07&&(s.shore>.05||s.height<.72&&s.patch>.42)?s:null;
    return s.shore>.15?s:null;
  }
  function accentPlant(x,z,s,kind,ar) {
    const spec=ACCENT_FLORA_SPEC[kind],h=lerp(...spec.height,ar()),base=new THREE.Vector3(x,s.height-.003,z),phase=ar(),yaw=ar()*TAU;
    const m=metaAt(x,base.y,z,h,phase,.72,0,.012),fm=metaAt(x,base.y,z,h,phase,.72,kind==='primula'?1.1:kind==='geum'?1.2:1.3,.008);
    const green=PALETTE.accentLeaf.clone().lerp(PALETTE.fern,s.shade*.35),stemColour=kind==='geum'?green.clone().lerp(PALETTE.wine,.36):green;
    const greenStart=accentGreen.p.length/3,petalStart=accentPetals.p.length/3,headPositions=[];let maxRadius=0;
    const flower=(center,radius,n)=>{
      if(kind==='geum')pendantCup(accentPetals,center,radius,fm,yaw);
      else salver(accentPetals,center,radius,n,kind==='blue'?PALETTE.blue:PALETTE.magenta,kind==='blue'?PALETTE.blueEye:PALETTE.wine,fm,yaw,kind==='blue'?.045:.18);
      headPositions.push(center);maxRadius=Math.max(maxRadius,radius);
    };
    if(kind==='primula') {
      const top=base.clone().addScaledVector(UP,h);stem(accentGreen,[base,top],.00085,green,m,4);
      for(let k=0;k<4;k++) {
        const a=yaw+k*2.4,len=.025+ar()*.012;
        leaf(accentGreen,base,base.clone().add(new THREE.Vector3(Math.cos(a)*len,.011+ar()*.008,Math.sin(a)*len)),len*.24,.009,green,m,4,k%2?-.12:.12,.004);
      }
      for(let tier=0;tier<2;tier++)for(let k=0;k<2;k++) {
        const a=yaw+k*Math.PI+tier*1.1,radial=new THREE.Vector3(Math.cos(a),.35,Math.sin(a)).normalize();
        const neck=base.clone().addScaledVector(UP,h*(.69+tier*.25)),center=neck.clone().addScaledVector(radial,.006+ar()*.003);
        stem(accentGreen,[neck,center],.00045,green,m,3);flower(center,lerp(...spec.radius,ar()),radial.clone().addScaledVector(UP,.65).normalize());
      }
    } else if(kind==='geum') {
      const top=base.clone().addScaledVector(UP,h);stem(accentGreen,[base,base.clone().lerp(top,.63),top],.00085,stemColour,m,4);
      for(let k=0;k<3;k++) {
        const a=yaw+k*2.2,axis=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),side=new THREE.Vector3(-axis.z,0,axis.x),len=.028+ar()*.009;
        const leafEnd=base.clone().addScaledVector(axis,len).addScaledVector(UP,.014);
        stem(accentGreen,[base,leafEnd],.00045,green,m,3);
        for(const t of [.40,.68])for(const sign of [-1,1]) {
          const p=base.clone().lerp(leafEnd,t);leaf(accentGreen,p,p.clone().addScaledVector(side,sign*.009).addScaledVector(axis,.006),.0045,.002,green,m,2);
        }
        leaf(accentGreen,base.clone().lerp(leafEnd,.62),leafEnd.clone().addScaledVector(axis,.009),.008,.004,green,m,3);
      }
      for(let k=0;k<2;k++) {
        const a=yaw+k*2.8,side=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),neck=top.clone().addScaledVector(side,.012+ar()*.008).addScaledVector(UP,-.009-k*.012);
        stem(accentGreen,[base.clone().lerp(top,.62),top.clone().addScaledVector(side,.011),neck],.00055,stemColour,m,3);flower(neck,lerp(...spec.radius,ar()),UP);
      }
    } else {
      const top=base.clone().addScaledVector(UP,h);stem(accentGreen,[base,top],.00065,green,m,3);
      for(let k=0;k<3;k++) {
        const a=yaw+k*2.35,p=base.clone().lerp(top,.18+k*.17),len=.018+ar()*.009;
        leaf(accentGreen,p,p.clone().add(new THREE.Vector3(Math.cos(a)*len,.007,Math.sin(a)*len)),len*.17,.004,green,m,3);
        const center=base.clone().addScaledVector(UP,h*(.65+k*.14)).add(new THREE.Vector3(Math.cos(a)*(.010+k*.002),0,Math.sin(a)*(.010+k*.002)));
        stem(accentGreen,[base.clone().lerp(top,.44+k*.11),center],.00045,green,m,3);flower(center,lerp(...spec.radius,ar()),new THREE.Vector3(.12,1,.09));
      }
    }
    const typeStats=stats.accentKinds[kind];typeStats.plants++;typeStats.heads+=headPositions.length;typeStats.maxHeight=Math.max(typeStats.maxHeight,h);typeStats.maxDiameter=Math.max(typeStats.maxDiameter,maxRadius*2);stats.accentPlants++;stats.accentFlowers+=headPositions.length;
    auditPart(`accent-${kind}-plant`,accentGreen,greenStart,base,{scaleReference:'2.1.8',morphology:spec.form});
    auditPart(`accent-${kind}-flowers`,accentPetals,petalStart,base,{dimensions:{maxIndividualDiameter:maxRadius*2},morphology:spec.form});
    accentRoots.push({x,y:base.y,z,kind,phase,height:h,heads:headPositions.length,maxRadius,positions:headPositions});
  }
  for(const [kind,patchPlants,salt] of [['primula',2,0x44a7c291],['geum',3,0x1e6f8bc3],['blue',2,0x6c312d71]]) {
    const ar=randomSource(seed^salt),candidates=[];
    for(let z=.35;z<4.03;z+=.17)for(let x=-5.62;x<5.63;x+=.17) {
      const px=x+(ar()-.5)*.13,pz=z+(ar()-.5)*.13,s=accentSite(px,pz,kind);if(!s)continue;
      candidates.push({x:px,z:pz,s,rank:ar()*.7+habitat.noise(px*1.4+19.7,pz*1.4-8.2)*.3});
    }
    candidates.sort((a,b)=>b.rank-a.rank);
    for(const candidate of candidates) {
      if(stats.accentKinds[kind].plants>=ACCENT_FLORA_SPEC[kind].targetPlants)break;
      if(accentPatches.some(p=>Math.hypot(p.x-candidate.x,p.z-candidate.z)<.28))continue;
      const patchRoots=[];
      for(let j=0;j<patchPlants&&stats.accentKinds[kind].plants<ACCENT_FLORA_SPEC[kind].targetPlants;j++)for(let attempt=0;attempt<10;attempt++) {
        const a=ar()*TAU,d=Math.sqrt(ar())*.070,px=candidate.x+Math.cos(a)*d,pz=candidate.z+Math.sin(a)*d,s=accentSite(px,pz,kind);
        if(!s||accentRoots.some(p=>Math.hypot(p.x-px,p.z-pz)<.025))continue;
        accentPlant(px,pz,s,kind,ar);patchRoots.push(accentRoots.length-1);break;
      }
      if(patchRoots.length){accentPatches.push({x:candidate.x,z:candidate.z,kind,roots:patchRoots});stats.accentKinds[kind].patches++;}
    }
  }

  // A separately seeded early-spring layer leaves the accepted growth/placement
  // streams intact. Rosettes live in drained bright woodland/meadow edges;
  // only their five-lobed flower heads follow the early-spring profile.
  const springRoots=[],springPatches=[];
  // Spring reads as coherent low carpets of many small blooms, not enlarged
  // flower heads. The independent spring RNG cannot resample accepted grasses,
  // trees, existing herb forms, water plants, or the summer succession layer.
  const springSpec={version:'2.3.3',maxPatches:52,plantsPerPatch:[24,33],patchRadius:[.17,.27],headRadius:[.008,.0123],height:[.073,.114]};
  const sr=randomSource(seed^0x2d9f673b),springCandidates=[];
  const springSite=(x,z)=>{
    const h=habitat.sample(x,z);
    return habitat.allowed(x,z,.025)&&!habitat.propsSolid?.(x,z)&&h.waterDepth<0&&h.path<.18&&h.height<1.1&&h.slope>.79&&h.shade<.76&&h.patch>.20?h:null;
  };
  for(let z=.05;z<4.12;z+=.23)for(let x=-5.75;x<5.74;x+=.23){
    const px=x+(sr()-.5)*.17,pz=z+(sr()-.5)*.17,h=springSite(px,pz);if(!h)continue;
    const edge=1-Math.abs(h.shade-.29);
    springCandidates.push({x:px,z:pz,rank:sr()*.68+edge*.18+habitat.noise(px*.92+27.4,pz*.92-9.5)*.14});
  }
  springCandidates.sort((a,b)=>b.rank-a.rank);
  for(const candidate of springCandidates){
    if(springPatches.length>=springSpec.maxPatches)break;
    if(springPatches.some(p=>Math.hypot(p.x-candidate.x,p.z-candidate.z)<.43))continue;
    const rootIds=[],patchRadius=.17+sr()*.10,plants=24+Math.floor(sr()*10),patchTint=sr();
    for(let j=0;j<plants;j++)for(let attempt=0;attempt<12;attempt++){
      const a=sr()*TAU,d=Math.sqrt(sr())*patchRadius,x=candidate.x+Math.cos(a)*d,z=candidate.z+Math.sin(a)*d,h=springSite(x,z);
      if(!h||springRoots.some(p=>Math.hypot(p.x-x,p.z-z)<.026))continue;
      const base=new THREE.Vector3(x,h.height-.003,z),height=.073+sr()*.041,phase=sr(),yaw=sr()*TAU,plantStart=springGreen.p.length/3,petalStart=springPetals.p.length/3;
      const m=metaAt(x,base.y,z,height,phase,.78,0,.012),fm=metaAt(x,base.y,z,height,phase,.78,1.40,.010),green=PALETTE.accentLeaf.clone().lerp(PALETTE.fern,h.shade*.35),heads=[];
      for(let k=0;k<5;k++){
        const angle=yaw+k*2.4,len=.025+sr()*.016,dir=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
        leaf(springGreen,base,base.clone().addScaledVector(dir,len).addScaledVector(UP,.009+sr()*.008),len*.25,.006,green,m,4,.08*(k%2?1:-1),.004);
      }
      const count=4+Math.floor(sr()*4),cream=new THREE.Color(patchTint<.14?'#d9c8ee':patchTint<.30?'#f1ccdc':sr()>.22?'#fff6df':'#fbf9ed');
      let maxDiameter=0;
      for(let k=0;k<count;k++){
        const angle=yaw+k*2.3,tip=base.clone().add(new THREE.Vector3(Math.cos(angle)*.012,height*(.76+sr()*.24),Math.sin(angle)*.012));
        stem(springGreen,[base,base.clone().lerp(tip,.63),tip],.00065,green,m,4);
        const radius=.008+sr()*.0043,n=new THREE.Vector3(Math.cos(angle)*.22,1,Math.sin(angle)*.22).normalize();
        salver(springPetals,tip,radius,n,cream,PALETTE.pollen,fm,angle,.10);heads.push(tip.toArray());maxDiameter=Math.max(maxDiameter,radius*2);
      }
      auditPart('springRosette',springGreen,plantStart,base,{scaleReference:'unchanged 2.2.4 early-spring shoot dimensions'});
      auditPart('springFlower',springPetals,petalStart,base,{dimensions:{maxIndividualDiameter:maxDiameter}});
      rootIds.push(springRoots.length);springRoots.push({x,y:base.y,z,height,phase,bloomType:1.40,heads:heads.length,positions:heads,maxDiameter,owner:'terrain.height',form:'early-spring basal rosette with separate five-lobed flowers'});break;
    }
    if(rootIds.length)springPatches.push({x:candidate.x,z:candidate.z,radius:patchRadius,roots:rootIds});
  }
  stats.springRosettes=springRoots.length;stats.springFlowers=springRoots.reduce((n,p)=>n+p.heads,0);stats.springPatches=springPatches.length;

  const successionRoots=[],successionPatches=[],dr=randomSource(seed^0x5f18e2a9),driftCandidates=[];
  const driftSite=(x,z)=>{
    const s=landSite(x,z,.01);
    return s&&s.waterDepth<0&&s.height<1.25&&s.alpine<.15&&s.shade<.62&&s.path<.12&&s.patch>.23?s:null;
  };
  for(let z=-.20;z<4.14;z+=.24)for(let x=-5.85;x<5.86;x+=.24){
    const px=x+(dr()-.5)*.19,pz=z+(dr()-.5)*.19,s=driftSite(px,pz);if(!s)continue;
    driftCandidates.push({x:px,z:pz,s,rank:dr()*.50+habitat.noise(px*1.7-11.2,pz*1.7+6.4)*.34+(1-s.shade)*.16});
  }
  driftCandidates.sort((a,b)=>b.rank-a.rank);
  for(const site of driftCandidates){
    if(successionPatches.length>=SEASONAL_FLOWER_DRIFTS.maxPatches)break;
    if(successionPatches.some(p=>Math.hypot(p.x-site.x,p.z-site.z)<.36))continue;
    const kind=site.s.shore>.12&&dr()>.30?'salver':dr()>.68?'violet':'daisy',radius=lerp(...SEASONAL_FLOWER_DRIFTS.patchRadius,dr()),count=10+Math.floor(dr()*8),rootIds=[];
    for(let j=0;j<count;j++)for(let attempt=0;attempt<10;attempt++){
      const angle=dr()*TAU,d=Math.sqrt(dr())*radius,x=site.x+Math.cos(angle)*d,z=site.z+Math.sin(angle)*d,s=driftSite(x,z);
      if(!s||successionRoots.some(p=>Math.hypot(p.x-x,p.z-z)<.024)||kind==='salver'&&s.shore<.055)continue;
      const base=new THREE.Vector3(x,s.height-.003,z),height=lerp(...SEASONAL_FLOWER_DRIFTS.rootHeight,dr()),phase=dr(),yaw=dr()*TAU,type=kind==='salver'?1.1:kind==='violet'?1.46:1;
      const m=metaAt(x,base.y,z,height,phase,.8,0,.013),fm=metaAt(x,base.y,z,height,phase,.8,type,.010),green=freshColour(s),heads=[],greenStart=successionGreen.p.length/3,petalStart=successionPetals.p.length/3;
      const top=base.clone().add(new THREE.Vector3(Math.cos(yaw)*height*.10,height,Math.sin(yaw)*height*.10));
      stem(successionGreen,[base,base.clone().lerp(top,.55),top],.00085,green,m,4);
      for(let k=0;k<3;k++){
        const a=yaw+k*2.4,origin=kind==='salver'?base:base.clone().lerp(top,.17+k*.18),length=.024+dr()*.016;
        leaf(successionGreen,origin,origin.clone().add(new THREE.Vector3(Math.cos(a)*length,length*.22,Math.sin(a)*length)),length*(kind==='salver'?.27:.21),.005,green,m,3,0,.003);
      }
      const flowerRadius=lerp(...SEASONAL_FLOWER_DRIFTS.headRadius,dr());
      if(kind==='violet'){spike(successionPetals,top.clone().addScaledVector(UP,-height*.25),height*.28,.008,fm,yaw);heads.push(top);}
      else if(kind==='salver'){
        const petalColour=colour(dr()>.50?'#cd789b':'#b95783');
        for(let k=0;k<3;k++){
          const a=yaw+k*TAU/3,neck=top.clone().addScaledVector(UP,-height*.10),head=top.clone().add(new THREE.Vector3(Math.cos(a)*.010,(k%2)*.004,Math.sin(a)*.010));
          stem(successionGreen,[neck,head],.0004,green,m,3);salver(successionPetals,head,flowerRadius*.80,new THREE.Vector3(Math.cos(a)*.5,1,Math.sin(a)*.5),petalColour,PALETTE.wine,fm,a,.12);heads.push(head);
        }
      }else{daisy(successionPetals,top,flowerRadius,dr()>.57?PALETTE.yellow:PALETTE.white,fm,yaw);heads.push(top);}
      auditPart('seasonalDriftPlant',successionGreen,greenStart,base,{scaleReference:'accepted 2.1.8 small plant dimensions'});
      auditPart('seasonalDriftFlower',successionPetals,petalStart,base,{dimensions:{diameter:flowerRadius*2}});
      rootIds.push(successionRoots.length);successionRoots.push({x,y:base.y,z,height,phase,kind,bloomType:type,heads:heads.length,positions:heads.map(p=>p.toArray()),diameter:flowerRadius*2});break;
    }
    if(rootIds.length)successionPatches.push({x:site.x,z:site.z,radius,kind,roots:rootIds});
  }
  stats.successionPlants=successionRoots.length;stats.successionPatches=successionPatches.length;stats.successionFlowers=successionRoots.reduce((n,p)=>n+p.heads,0);

  const addPlants=(buffer,name,aquatic=false)=>{
    if(!buffer.i.length)return null;
    const g=buffer.geometry(),m=plantMaterial(uniforms,aquatic),depth=plantMaterial(uniforms,aquatic,true),mesh=new THREE.Mesh(g,m);
    geometries.add(g);materials.add(m);materials.add(depth);mesh.customDepthMaterial=depth;
    mesh.name=name;mesh.castShadow=!aquatic;mesh.receiveShadow=true;mesh.frustumCulled=false;group.add(mesh);return mesh;
  };
  addPlants(land,'Merged clover, broad herbs, rooted flowers and fern fronds');
  addPlants(flowers,'Merged white-yellow daisy heads and purple flowering spikes');
  addPlants(wet,'Merged wet-bank sedges, rushes and broad wetland herbs');
  const floatingMesh=addPlants(floating,'Sparse notched floating leaves',true);
  const submergedMesh=addPlants(submerged,'Lake-bed rooted branching ribbon and whorled plants',true);
  addPlants(accentGreen,'Independent small red-pink-blue meadow herb stems and leaves');
  addPlants(accentPetals,'Independent small tiered salvers, pendant cups and pale-blue lobed flowers');
  addPlants(springGreen,'Early spring primrose basal rosettes and rooted stalks');
  addPlants(springPetals,'Early spring five-lobed primrose flowers');
  addPlants(successionGreen,'Seasonal flowering drifts rooted stems and small leaves');
  addPlants(successionPetals,'Seasonal meadow drifts small white yellow rose and violet flowers');
  const floatingRest=floatingMesh?Float32Array.from(floatingMesh.geometry.attributes.position.array):null;
  const submergedRest=submergedMesh?Float32Array.from(submergedMesh.geometry.attributes.position.array):null;
  for(const mesh of [floatingMesh,submergedMesh])mesh?.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

  const butterflyGroup=new THREE.Group();butterflyGroup.name='Eight flower-visiting paired-wing butterflies';group.add(butterflyGroup);
  const wingMaterial=new THREE.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.78,side:THREE.DoubleSide,metalness:0});
  const bodyMaterial=new THREE.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.9});materials.add(wingMaterial);materials.add(bodyMaterial);
  const right=new THREE.InstancedMesh(makeWing(1),wingMaterial,8),left=new THREE.InstancedMesh(makeWing(-1),wingMaterial,8),body=new THREE.InstancedMesh(makeButterflyBody(),bodyMaterial,8);
  right.name='Butterfly right fore-and-hind wings';left.name='Butterfly left fore-and-hind wings';body.name='Butterfly bodies and antennae';
  for(const mesh of [right,left,body]) {mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;butterflyGroup.add(mesh);geometries.add(mesh.geometry);}
  const butterflyData=Array.from({length:8},(_,i)=>({patch:flowerPatches.length?flowerPatches[Math.floor(r()*flowerPatches.length)]:null,phase:r()*TAU,speed:.45+r()*.34,size:.72+r()*.28,radius:.11+r()*.18,perch:r()*.65,colour:colour(['#f7e7b4','#e6b770','#d0ddf0','#ebd2a5'][i%4])}));
  const butterflySpans=butterflyData.map(f=>.21*f.size*SIZE.butterfly);
  scaleAudit.groups.butterfly={count:8,factor:SIZE.butterfly,orbitFactor:SIZE.butterflyOrbit,clearanceFactor:SIZE.butterflyClearance,openSpan:{min:Math.min(...butterflySpans),max:Math.max(...butterflySpans),mean:butterflySpans.reduce((a,b)=>a+b,0)/8},maxSpanToDoor:Math.max(...butterflySpans)/MEADOW_FLORA_SCALE_BUDGET.reference.doorHeight};
  for(let i=0;i<8;i++){right.setColorAt(i,butterflyData[i].colour);left.setColorAt(i,butterflyData[i].colour);}right.instanceColor.needsUpdate=left.instanceColor.needsUpdate=true;
  const butterflyVisits=[];
  group.userData.flora={source:'independent procedural geometry',scaleAudit,accentSpec:ACCENT_FLORA_SPEC,successionSpec:SEASONAL_FLOWER_DRIFTS,springSpec,successionRoots,successionPatches,springRoots,springPatches,accentRoots,accentPatches,flowerPatches,fernRoots,underwaterRoots,shoreRoots,alpineRoots,floatingSites,calmPockets,butterflyVisits,surfaceLeafCenters,lakeSurfaceSampleCoordinates:surfaceLeafCenters.map(p=>({x:p.x,z:p.z})),rootAttribute:'aFloraRoot',windInvariant:'displacement is zero at each plant root'};
  group.traverse(o=>{if(!o.isMesh)return;const n=o.isInstancedMesh?o.count:1;stats.drawCalls++;stats.triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*n;stats.vertices+=o.geometry.attributes.position.count*n;});
  stats.flowerPatches=flowerPatches.length;stats.flowers=stats.flowerPlants+stats.accentFlowers+stats.springFlowers+stats.successionFlowers;stats.shorePlants=stats.sedgeClumps+stats.rushClumps+stats.wetHerbs;
  const matrix=new THREE.Matrix4(),orientation=new THREE.Quaternion(),wingOrientation=new THREE.Quaternion(),roll=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3(),surfaceWind=new THREE.Vector2(),wingAxis=new THREE.Vector3(0,0,1),butterflyMeshes=[body,right,left],wingMeshes=[right,left];
  let disposed=false,lakeSurfaceSampler=null,lastFlowerSeason=NaN,flowerBloom=0,openPatches=[];
  const bloomTypes=[1,1.1,1.2,1.3,1.4,1.46],bloomValues=new Array(6);
  function patchBloom(p){const type=p.bloomType||1;return bloomValues[type>1.44?5:type>1.35?4:type>1.25?3:type>1.15?2:type>1.05?1:0];}
  function setLakeSurfaceSampler(fn,compileFn){
    lakeSurfaceSampler=typeof fn==='function'?fn:null;stats.floatingSurfaceSampler=!!lakeSurfaceSampler;
    // These XZ coordinates belong to immutable rest geometry. Compile only
    // their static bed lookup; time, wind and the water level remain live.
    const compile=lakeSurfaceSampler&&typeof compileFn==='function'?compileFn:null;
    for(const range of floatingLeafRanges){
      range.surfaceSamples=compile?Array.from({length:range.end-range.start},(_,k)=>compile(floatingRest[(range.start+k)*3],floatingRest[(range.start+k)*3+2])):null;
      range.centerSurfaceSample=compile?compile(range.center.x,range.center.z):null;
    }
    for(const range of floatingStemRanges)range.surfaceSamples=compile?Array.from({length:range.end-range.start},(_,k)=>compile(submergedRest[(range.start+k)*3],submergedRest[(range.start+k)*3+2])):null;
  }
  function update(time=0,state={}) {
    if(disposed)return;
    const t=Number.isFinite(state.time)?state.time:Number.isFinite(time)?time:0;
    let season=state.season??0;if(typeof season==='string')season=({spring:0,summer:1,autumn:2,winter:3}[season]??0);season=((Number(season)%4)+4)%4;
    uniforms.uFloraTime.value=t;uniforms.uFloraSeason.value=season;uniforms.uFloraWet.value=clamp(state.wetness??0,0,1);uniforms.uFloraSnow.value=clamp(state.snow??0,0,1);
    const wind=Math.max(0,state.windAmount??state.windStrength??.13);uniforms.uFloraWindAmount.value=wind;
    if(state.wind)uniforms.uFloraWind.value.set(state.wind.x??state.wind[0]??.85,state.wind.y??state.wind.z??state.wind[1]??.25).normalize();
    uniforms.uFloraField.value=field?.texture||zero;uniforms.uFloraWindField.value=field?.windTexture||zero;uniforms.uFloraHasField.value=field?.texture?1:0;uniforms.uFloraHasWind.value=field?.windTexture?1:0;
    if(lakeSurfaceSampler&&floatingMesh) {
      const windVector=surfaceWind.copy(uniforms.uFloraWind.value).multiplyScalar(wind),p=floatingMesh.geometry.attributes.position;
      for(const leafRange of floatingLeafRanges) {
        for(let i=leafRange.start;i<leafRange.end;i++) {
          const x=floatingRest[i*3],z=floatingRest[i*3+2],surface=leafRange.surfaceSamples?leafRange.surfaceSamples[i-leafRange.start](t,windVector):lakeSurfaceSampler(x,z,t,windVector);
          if(Number.isFinite(surface))p.setY(i,surface+floatingRest[i*3+1]-leafRange.level);
        }
        const surface=leafRange.centerSurfaceSample?leafRange.centerSurfaceSample(t,windVector):lakeSurfaceSampler(leafRange.center.x,leafRange.center.z,t,windVector);
        if(Number.isFinite(surface))leafRange.center.y=surface+.004;
      }
      p.needsUpdate=true;floatingMesh.geometry.computeVertexNormals();
      if(submergedMesh&&floatingStemRanges.length) {
        const stemPositions=submergedMesh.geometry.attributes.position;
        for(const range of floatingStemRanges)for(let i=range.start;i<range.end;i++) {
          const x=submergedRest[i*3],y=submergedRest[i*3+1],z=submergedRest[i*3+2],fraction=clamp((y-range.rootY)/Math.max(.05,range.level-range.rootY),0,1);
          const surface=range.surfaceSamples?range.surfaceSamples[i-range.start](t,windVector):lakeSurfaceSampler(x,z,t,windVector);
          if(Number.isFinite(surface))stemPositions.setY(i,y+(surface-range.level)*fraction*fraction);
        }
        stemPositions.needsUpdate=true;
      }
    }
    const rain=Math.max(state.rain??0,state.effectiveRain??0),hour=((state.hour??15)%24+24)%24,day=state.daylight??1;
    if(season!==lastFlowerSeason){
      lastFlowerSeason=season;const phenology=sampleSeasonalPhenology(season);
      for(let i=0;i<bloomTypes.length;i++)bloomValues[i]=meadowBloomForType(bloomTypes[i],season);
      flowerBloom=bloomValues[0];openPatches=flowerPatches.filter(p=>p.phase<=patchBloom(p));
      stats.springBloomFraction=phenology.earlyPrimrose;
      stats.visibleSpringFlowers=springRoots.reduce((n,p)=>n+(p.phase<=phenology.earlyPrimrose?p.heads:0),0);
      stats.visibleSuccessionFlowers=successionRoots.reduce((n,p)=>n+(p.phase<=patchBloom(p)?p.heads:0),0);
      stats.visibleFlowerHeads=stats.visibleSpringFlowers+flowerPatches.reduce((n,p)=>n+(p.phase<=patchBloom(p)?p.plants:0),0)+accentRoots.reduce((n,p)=>n+(p.phase<=meadowBloomForType(p.kind==='primula'?1.1:p.kind==='geum'?1.2:1.3,season)?p.heads:0),0)+stats.visibleSuccessionFlowers;
    }
    const bloom=flowerBloom;
    butterflyGroup.visible=rain<.24&&hour>7&&hour<18.7&&day>.30&&season<2.55&&wind<1.20&&openPatches.length>0;
    stats.butterflyFlying=0;stats.butterflyPerched=0;stats.flowerBloomFraction=bloom;
    butterflyVisits.length=0;
    for(let i=0;i<butterflyData.length;i++) {
      const f=butterflyData[i],patch=f.patch&&f.patch.phase<=patchBloom(f.patch)?f.patch:openPatches[i%openPatches.length],head=patch?.positions[i%patch.positions.length];
      if(!head){matrix.makeScale(0,0,0);for(const mesh of butterflyMeshes)mesh.setMatrixAt(i,matrix);continue;}
      const cycle=(t*.056+f.phase/TAU)%1,perched=cycle<.22+f.perch*.24||rain>.11||wind>.7;
      const theta=t*f.speed+f.phase,rad=f.radius*SIZE.butterflyOrbit*(perched?0:1),x=head.x+Math.cos(theta)*rad,z=head.z+Math.sin(theta)*rad*.72;
      const site=habitat.sample(x,z),valid=habitat.allowed(x,z,.012)&&site.waterDepth<0;
      position.copy(head);
      if(!perched&&valid)position.set(x,Math.max(head.y+(.09+Math.sin(theta*2.1)*.075)*SIZE.butterflyClearance,site.height+.12*SIZE.butterflyClearance),z);
      else position.y+=.015*SIZE.butterfly;
      const yaw=perched?f.phase:Math.atan2(-Math.sin(theta),Math.cos(theta)*.72);
      orientation.setFromAxisAngle(UP,yaw);roll.setFromAxisAngle(wingAxis,perched?.03:Math.sin(theta)*.17);orientation.multiply(roll);
      scale.setScalar(f.size*SIZE.butterfly*(season>1.65&&i>4?.0:1));matrix.compose(position,orientation,scale);body.setMatrixAt(i,matrix);
      const flap=perched?.91+Math.sin(t*1.7+f.phase)*.065:.23+(.5+.5*Math.sin(t*(13+i*.7)+f.phase))*1.06;
      for(let k=0;k<wingMeshes.length;k++) {wingOrientation.copy(orientation).multiply(roll.setFromAxisAngle(wingAxis,(k===0?1:-1)*flap));matrix.compose(position,wingOrientation,scale);wingMeshes[k].setMatrixAt(i,matrix);}
      butterflyVisits.push({index:i,patchPhase:patch.phase,kind:patch.kind,bloom,visible:butterflyGroup.visible&&scale.x>0,perched,head:[head.x,head.y,head.z],position:position.toArray(),orbitRadius:rad,bodyScale:scale.x});
      if(butterflyGroup.visible&&scale.x>0)stats[perched?'butterflyPerched':'butterflyFlying']++;
    }
    for(const mesh of butterflyMeshes)mesh.instanceMatrix.needsUpdate=true;
  }
  update(0,{});
  return {group,stats,scaleAudit,flowerPatches,update,setLakeSurfaceSampler,dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const mesh of butterflyMeshes)mesh.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();zero.dispose();}};
}
