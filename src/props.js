import * as THREE from 'three';
import {createCabin} from './cabin.js';
import {createPondBed} from './pond-bed.js';
import {createPondFish} from './pond-fish.js';
import {createPondFlora} from './pond-flora.js';

// Independently authored miniature objects. No downloaded meshes or image assets.
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
function rng(seed) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let a = s; a = Math.imul(a ^ a >>> 15, a | 1); a ^= a + Math.imul(a ^ a >>> 7, a | 61); return ((a ^ a >>> 14) >>> 0) / 4294967296; }; }
const clamp = THREE.MathUtils.clamp;
export const LANDING_WOOD_PALETTE=Object.freeze({version:'2.2.5',reference:'accepted cabin grey-brown timber and pale weathering',dock:0x9b927e,trim:0x807a6a,boat:0x9b8e77,boatInner:0xaea18a,rope:0x8a826d,textureBase:'#c7c2b4',rule:'Neutral weathered grain multiplied once by muted timber colour; darker immersed hull/piles, pale dry deck and gunwale.'});

class Batch {
  constructor() { this.parts = []; }
  add(g, matrix = new THREE.Matrix4()) { this.parts.push(g.clone().applyMatrix4(matrix)); g.dispose(); }
  box(x, y, z, sx, sy, sz, rotation = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(UP,rotation),new THREE.Vector3(1,1,1));
    this.add(new THREE.BoxGeometry(sx,sy,sz),m);
  }
  rod(a, b, r, radial = 7, r2 = r) {
    const d = b.clone().sub(a), q = new THREE.Quaternion().setFromUnitVectors(UP,d.clone().normalize());
    this.add(new THREE.CylinderGeometry(r2,r,d.length(),radial,1,false),new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(.5),q,new THREE.Vector3(1,1,1)));
  }
  geometry() {
    const p=[],n=[],uv=[];
    for (const source of this.parts) {
      const g=source.index?source.toNonIndexed():source;
      const pa=g.getAttribute('position'),no=g.getAttribute('normal'),tx=g.getAttribute('uv');
      p.push(...pa.array); n.push(...no.array); if(tx)uv.push(...tx.array); else for(let i=0;i<pa.count;i++)uv.push(0,0);
      if(g!==source)g.dispose(); source.dispose();
    }
    this.parts.length=0;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeBoundingSphere();return g;
  }
}
function polygonGeometry(points, indices) {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function texture(kind,seed) {
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),r=rng(seed);
  ctx.fillStyle=kind==='wood'?LANDING_WOOD_PALETTE.textureBase:kind==='roof'?'#514c43':'#6e6c61';ctx.fillRect(0,0,256,256);
  const image=ctx.getImageData(0,0,256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++) {
    const i=(y*256+x)*4;
    const fiber=kind==='wood' ? Math.sin(x*.75+Math.sin(y*.035)*3+Math.sin(y*.014)*5)*9 + Math.sin(x*2.6+y*.07)*3 : Math.sin(x*.16)*Math.sin(y*.22)*3;
    const noise=(r()-.5)*17+fiber;for(let k=0;k<3;k++)image.data[i+k]=clamp(image.data[i+k]+noise,0,255);
  }
  ctx.putImageData(image,0,0);
  if(kind==='wood')for(let j=0;j<7;j++){const x=r()*256,y=r()*256;ctx.strokeStyle='rgba(31,23,15,.32)';ctx.lineWidth=.8;ctx.beginPath();ctx.ellipse(x,y,1+r()*2,9+r()*11,-.08,0,TAU);ctx.stroke();}
  else for(let j=0;j<160;j++){ctx.fillStyle='rgba(22,19,16,.18)';ctx.fillRect(r()*256,r()*256,1+r()*3,1+r()*4);}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
function snowMaterial(color,map,uniforms,{waterline=false}={}) {
  const mat=new THREE.MeshStandardMaterial({color,map,roughness:.9,metalness:0});
  mat.onBeforeCompile=shader=>{
    shader.uniforms.uPropSnow=uniforms.snow;shader.uniforms.uPropWet=uniforms.wet;shader.uniforms.uPropWaterLevel=uniforms.waterLevel;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPropPosition;\nvarying vec3 vPropNormal;').replace('#include <begin_vertex>','#include <begin_vertex>\nvPropPosition=(modelMatrix*vec4(position,1.)).xyz;\nvPropNormal=normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uPropSnow;\nuniform float uPropWet,uPropWaterLevel;\nvarying vec3 vPropPosition;\nvarying vec3 vPropNormal;').replace('#include <color_fragment>',`#include <color_fragment>
      float grains=sin(vPropPosition.x*37.2+sin(vPropPosition.z*19.))*sin(vPropPosition.z*45.7+vPropPosition.y*9.);
      float snowMask=smoothstep(.36,.74,vPropNormal.y)*smoothstep(.12,.7,uPropSnow+grains*.12);
      float immersed=${waterline?'1.-smoothstep(uPropWaterLevel-.025,uPropWaterLevel+.035,vPropPosition.y)':'0.'};
      float timberWet=max(uPropWet*.72,immersed*.85);
      diffuseColor.rgb*=1.-timberWet*.23;
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.81,.91,.81),immersed*.30);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.91,.945,.96),snowMask);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=max(.60,roughnessFactor-timberWet*.12);');
  };
  mat.customProgramCacheKey=()=> 'miniature-props-snow-v2-'+Number(waterline);return mat;
}
function meshFrom(batch,material,parent,name) {
  const g=batch.geometry(),m=new THREE.Mesh(g,material);m.name=name;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}

function makeDock(parent,terrain,materials,r) {
  const lake=terrain.lake || {x:1.45,z:2.8,rx:2.45,rz:2.05,level:.18};
  const z=2.03,edge=lake.x-lake.rx*Math.sqrt(Math.max(0,1-Math.pow((z-lake.z)/lake.rz,2))),start=edge-.36,end=edge+.56;
  const deckY=Math.min(.43,Math.max(lake.level+.13,terrain.height(start,z)+.025));
  const group=new THREE.Group();group.name='west-shore-landing';parent.add(group);
  const wood=new Batch(),trim=new Batch();
  for(let i=0;i<15;i++)wood.box(THREE.MathUtils.lerp(start,end,i/14),deckY,z,.057,.033,.34,(r()-.5)*.025);
  for(const zz of [z-.125,z+.125])trim.box((start+end)/2,deckY-.045,zz,end-start+.06,.052,.038);
  for(const xx of [start+.12,end-.025])for(const zz of [z-.16,z+.16]) {
    const ground=Math.min(terrain.height(xx,zz),lake.level-.28),bottom=Math.max(lake.level-.7,ground-.05);
    trim.rod(new THREE.Vector3(xx,bottom,zz),new THREE.Vector3(xx,deckY+.17,zz),.019,7,.016);
    trim.rod(new THREE.Vector3(xx-.006,deckY+.169,zz),new THREE.Vector3(xx-.006,deckY+.18,zz),.022,7);
  }
  meshFrom(wood,materials.dock,group,'uneven-dock-boards');meshFrom(trim,materials.trim,group,'submerged-dock-pilings');
  return {group,boatX:edge+.52,boatZ:z+.42,deckY,lake};
}

function makeBoat(parent,materials,x,z,water) {
  const boat=new THREE.Group();boat.name='open-rowboat-with-benches';boat.position.set(x,water+.025,z);boat.rotation.y=-.20;parent.add(boat);
  const outer=[],inner=[],uv=[],indices=[],n=20,m=10;
  for(let i=0;i<=n;i++) {
    const t=i/n,xx=(t-.5)*.76,width=.153*Math.pow(Math.sin(Math.PI*t),.62)+.005,keel=-.078+.065*Math.pow(Math.abs(t-.5)*2,3);
    for(let j=0;j<=m;j++) {
      const a=j/m*Math.PI,zz=Math.cos(a)*width,yy=.069-(.069-keel)*Math.sin(a);
      outer.push(xx,yy,zz);inner.push(xx,yy+.014,zz*(1-.015/(width+.02)));uv.push(t,j/m);
    }
  }
  for(let i=0;i<n;i++)for(let j=0;j<m;j++){const a=i*(m+1)+j,b=a+m+1;indices.push(a,b,a+1,b,b+1,a+1);}
  function shell(p,reverse){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(reverse?indices.flatMap((v,i)=>i%3===0?[indices[i],indices[i+2],indices[i+1]]:[]):indices);g.computeVertexNormals();return g;}
  const hull=new THREE.Mesh(shell(outer,false),materials.boat);hull.castShadow=hull.receiveShadow=true;boat.add(hull);
  const inside=new THREE.Mesh(shell(inner,true),materials.boatInner);inside.castShadow=inside.receiveShadow=true;boat.add(inside);
  const frame=new Batch(),seats=new Batch();
  for(const side of [-1,1])for(let i=0;i<n;i++) {
    const a=i/n,b=(i+1)/n,wa=.153*Math.pow(Math.sin(Math.PI*a),.62)+.005,wb=.153*Math.pow(Math.sin(Math.PI*b),.62)+.005;
    frame.rod(new THREE.Vector3((a-.5)*.76,.073,side*wa),new THREE.Vector3((b-.5)*.76,.073,side*wb),.009,5);
  }
  for(const xx of [-.19,0,.19])seats.box(xx,.039,0,.066,.017,.257*(1-Math.abs(xx)*.5));
  for(let i=0;i<5;i++)seats.box(0,-.048,(i-2)*.025,.43,.015,.022);
  for(const xx of [-.25,-.13,.13,.25]) {
    const t=xx/.76+.5,w=.153*Math.pow(Math.sin(Math.PI*t),.62);
    frame.rod(new THREE.Vector3(xx,.043,-w*.92),new THREE.Vector3(xx,-.043,0),.006,4);
    frame.rod(new THREE.Vector3(xx,-.043,0),new THREE.Vector3(xx,.043,w*.92),.006,4);
  }
  // Two true wooden oars, stowed across the gunwales.
  for(let k=0;k<2;k++) {
    const a=new THREE.Vector3(-.23+k*.18,.102,-.22),b=new THREE.Vector3(.28+k*.035,.10,.22);
    frame.rod(a,b,.006,5);const mid=b.clone().add(new THREE.Vector3(.037,0,.037));seats.box(mid.x,mid.y,mid.z,.12,.012,.037,-.72);
  }
  meshFrom(frame,materials.trim,boat,'gunwales-ribs-and-oars');meshFrom(seats,materials.boatInner,boat,'cross-benches-and-open-cockpit-floor');
  // Fixed pier rope is thin and restrained, with a little slack.
  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x-.12,water+.095,z-.20),new THREE.Vector3(x-.18,water+.075,z-.25),new THREE.Vector3(x-.24,water+.13,z-.29)]);
  const rope=new THREE.Mesh(new THREE.TubeGeometry(curve,12,.004,4,false),materials.rope);parent.add(rope);
  return boat;
}

/** Create original cabin, landing, hollow rowboat and a tiny shoal. */
export function createProps(scene,{terrain,seed=42}={}) {
  if(!terrain || typeof terrain.height!=='function')throw new Error('createProps requires terrain.height(x,z)');
  const group=new THREE.Group();group.name='independent-miniature-props';scene.add(group);
  const r=rng(seed+830),uniforms={snow:{value:0},wet:{value:0},waterLevel:{value:terrain.lake.level}},textures=[texture('wood',seed+10)];
  const materials={
    trim:snowMaterial(LANDING_WOOD_PALETTE.trim,textures[0],uniforms,{waterline:true}),
    dock:snowMaterial(LANDING_WOOD_PALETTE.dock,textures[0],uniforms),boat:snowMaterial(LANDING_WOOD_PALETTE.boat,textures[0],uniforms,{waterline:true}),boatInner:snowMaterial(LANDING_WOOD_PALETTE.boatInner,textures[0],uniforms),
    rope:new THREE.MeshStandardMaterial({color:LANDING_WOOD_PALETTE.rope,roughness:1})
  };
  const cabin=createCabin({terrain,seed});group.add(cabin.group);
  // Retired cabin used 4 foundation yaws + 208 tile jitters. The new house
  // owns its RNG, while these draws retain the accepted dock/fish sequence.
  for(let i=0;i<212;i++)r();
  const dock=makeDock(group,terrain,materials,r),boat=makeBoat(group,materials,dock.boatX,dock.boatZ,dock.lake.level);
  const pondBed=createPondBed({terrain,seed});group.add(pondBed.group);
  const fish=createPondFish({terrain,seed,bedHeightAt:pondBed.heightAt});group.add(fish.group);
  const pondFlora=createPondFlora({terrain,seed,bedHeightAt:pondBed.heightAt});group.add(pondFlora.group);
  const lamp=new THREE.PointLight(0xffad4a,.25,1.6,2);lamp.position.copy(cabin.group.position).add(new THREE.Vector3(0,.31,.62));group.add(lamp);
  let elapsed=0,disposed=false;
  const stats={drawCalls:0,triangles:0,cabinTiles:cabin.stats.cabinTiles,cabin:cabin.stats,fish:fish.stats.count,fishSystem:fish.stats,pondBed:pondBed.stats,pondFlora:pondFlora.stats,originalProceduralAssets:true};
  group.traverse(obj=>{if(obj.isMesh){stats.drawCalls++;stats.triangles+=(obj.geometry.index?.count||obj.geometry.getAttribute('position').count)/3*(obj.isInstancedMesh?obj.count:1);}});
  function update(dt,state={}) {
    if(disposed)return;elapsed=Number.isFinite(state.time)?state.time:elapsed+dt;
    const snow=clamp(Number(state.snow)||0,0,1),wet=clamp(Number(state.wetness)||0,0,1),day=Number.isFinite(state.daylight)?clamp(state.daylight,0,1):1;
    uniforms.snow.value=snow;uniforms.wet.value=wet;uniforms.waterLevel.value=terrain.lake.currentLevel??terrain.lake.level;cabin.update(state);lamp.intensity=(1-day)*1.25+.025;
    const wind=Number(state.windStrength)||0;
    boat.position.y=(dock.lake.currentLevel??dock.lake.level)+.025+Math.sin(elapsed*1.33)*.005;boat.rotation.x=Math.sin(elapsed*1.12)*(.012+wind*.003);boat.rotation.z=Math.sin(elapsed*1.67+.4)*(.009+wind*.003);
    fish.update(elapsed,state);stats.visibleFish=fish.stats.visibleFish;pondFlora.update(elapsed,state);
  }
  update(0,{});
  return {group,cabin,pondBed,fish,pondFlora,setLakeSurfaceSampler(fn){pondFlora.setLakeSurfaceSampler(fn);fish.setLakeSurfaceSampler?.(fn);},chimney:cabin.chimney,update,stats,dispose(){if(disposed)return;disposed=true;cabin.dispose();fish.dispose();pondBed.dispose();pondFlora.dispose();group.removeFromParent();const geoms=new Set();group.traverse(o=>{if(o.isMesh)geoms.add(o.geometry);});geoms.forEach(g=>g.dispose());Object.values(materials).forEach(m=>m.dispose());textures.forEach(t=>t.dispose());lamp.dispose?.();}};
}
