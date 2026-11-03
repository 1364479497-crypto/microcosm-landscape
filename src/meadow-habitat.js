import * as THREE from 'three';
import {createGroundContacts} from './ground-contact.js';
import {seededRandom} from './terrain-field.js';

// Case recipe, not a species distribution claim. Every ground-layer system
// samples the same soil/water, canopy, stone and human-disturbance fields.
const clamp=THREE.MathUtils.clamp,mix=THREE.MathUtils.lerp;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const hash=(x,z,seed)=>{const a=Math.sin(x*127.1+z*311.7+seed*.381)*43758.5453;return a-Math.floor(a);};
export function createMeadowHabitat(terrain,trees,seed=42){
 const noise=(x,z)=>{const ix=Math.floor(x),iz=Math.floor(z),fx=smooth(0,1,x-ix),fz=smooth(0,1,z-iz);return mix(mix(hash(ix,iz,seed),hash(ix+1,iz,seed),fx),mix(hash(ix,iz+1,seed),hash(ix+1,iz+1,seed),fx),fz);};
 const lake=terrain.lake;
 // Door step to the landward end of the dock; no road crosses the lake.
 const pathCurve=new THREE.CatmullRomCurve3([[-2.72,.43],[-2.68,.83],[-2.59,1.31],[-2.16,1.73],[-1.67,1.94],[-1.18,2.03]].map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');
 const pathPoints=pathCurve.getPoints(96).map((p,i)=>({x:p.x,z:p.z,width:mix(.18,.125,i/96)}));
 const pathAt=(x,z)=>{if(x< -3.05||x>-.86||z<.14||z>2.35)return {distance:9,width:.15,strength:0};let distance=Infinity,width=.15;for(let i=1;i<pathPoints.length;i++){const a=pathPoints[i-1],b=pathPoints[i],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1),d=Math.hypot(x-a.x-dx*t,z-a.z-dz*t);if(d<distance){distance=d;width=mix(a.width,b.width,t);}}const ragged=(noise(x*15,z*15)-.5)*.023;return {distance,width,strength:1-smooth(width*.68,width+ragged+.042,distance)};};
 const contacts=createGroundContacts(terrain),stones=contacts.diagnostics.instances.filter(s=>s.kind==='boulder');
 const treeMap=new Map(),cell=.65;
 const key=(x,z)=>`${Math.floor(x/cell)},${Math.floor(z/cell)}`;
 const insert=(map,item,r)=>{for(let j=Math.floor((item.z-r)/cell);j<=Math.floor((item.z+r)/cell);j++)for(let i=Math.floor((item.x-r)/cell);i<=Math.floor((item.x+r)/cell);i++){const k=`${i},${j}`;if(!map.has(k))map.set(k,[]);map.get(k).push(item);}};
 for(const t of trees){if(t.shrub)continue;insert(treeMap,t,Math.max(.35,t.h*.55));}
 const foundationRandom=seededRandom(seed+830),foundations=Array.from({length:4},(_,i)=>({x:i<2?-.45:.45,z:i%2?-.31:.31,yaw:(foundationRandom()-.5)*.12}));
 function propsSolid(x,z){
  // Inverse of the actual cabin rotation; roof overhang does not sterilise soil.
  const dx=x+2.65,dz=z+.25,c=Math.cos(-.07),sn=Math.sin(-.07),lx=c*dx-sn*dz,lz=sn*dx+c*dz;
  if(Math.abs(lx)<.530&&Math.abs(lz)<.392)return true;
  for(const f of foundations){const dx=lx-f.x,dz=lz-f.z,c=Math.cos(f.yaw),sn=Math.sin(f.yaw);if(Math.abs(c*dx-sn*dz)<.1001&&Math.abs(sn*dx+c*dz)<.0951)return true;}
  if(Math.abs(lx+.03)<.161&&Math.abs(lz-.54)<.101)return true;
  if(Math.abs(lx+.03)<.186&&Math.abs(lz-.67)<.086)return true;
  const dockZ=2.03,edge=lake.x-lake.rx*Math.sqrt(Math.max(0,1-((dockZ-lake.z)/lake.rz)**2));
  return x>edge-.39&&x<edge+.59&&Math.abs(z-dockZ)<.178;
 }
 function sample(x,z,cached=null){
  const height=cached?.height??terrain.height(x,z),normal=terrain.normal(x,z),slope=normal.y??normal[1],shoreDistance=lake.shoreDistance(x,z);
  // Match the lake mesh's finite domain and physical stage, rather than an
  // ideal ellipse that incorrectly called low wet pockets outside q=1 dry.
  const inBasin=Math.abs(x-lake.x)<lake.rx*1.12&&Math.abs(z-lake.z)<lake.rz*1.12&&z<=lake.front;
  const waterDepth=inBasin?lake.level-height:-Math.max(.001,height-lake.level);
  let shade=0,treeDistance=5,treeClearance=5;
  for(const t of treeMap.get(key(x,z))||[]){const d=Math.hypot(x-t.x,z-t.z),radius=t.h*(t.type==='pine'?.34:.48);treeDistance=Math.min(treeDistance,d);treeClearance=Math.min(treeClearance,d-t.h*.034);shade=Math.max(shade,(1-smooth(radius*.15,radius,d))*(t.type==='pine'?.9:.73));}
  const contact=cached?.contact??contacts.sample(x,z,height),rock=contact.rock,rockEdge=contact.edge;
  // Mountain ledges retain soil in sheltered depressions, not on every contour.
  const patch=clamp(noise(x*1.5+3.7,z*1.5-1.2)*.66+noise(x*4.8-8,z*4.8+4)*.34,0,1);
  const alpine=smooth(1.55,3.1,height),shelter=smooth(.50,.74,patch)*smooth(.77,.95,slope);
  const highDensity=mix(1,.035,alpine)*mix(.12,1,shelter);
  const path=cached?.path??pathAt(x,z).strength;
  const shore=(1-smooth(.035,.28,Math.abs(height-lake.level)))*(1-smooth(.04,.26,Math.abs(shoreDistance)));
  const density=(1-path)*(1-rock)*(1-smooth(.7,.42,slope))*(1-smooth(.035,.13,waterDepth))*mix(1,.14,shade)*smooth(.002,.032,treeClearance)*mix(.45,1,patch)*mix(1,highDensity,smooth(.95,1.50,height));
  return {height,normal,slope,waterDepth,shore,shade,treeDistance,treeClearance,rock,rockEdge,patch,path,alpine,density};
 }
 function allowed(x,z,margin=0,onStreamBank=false){
  // Only actual roots inside a solid or the heavily trodden path core are
  // excluded. Small shoots can reach walls, stones and the cutaway boundary.
  if(x< -5.998||x>5.998||z< -5.298||z>4.298)return false;
  if(propsSolid(x,z))return false;
  if(!onStreamBank&&z> -3.46&&z<1.63){const r=terrain.river.sample(z);if(Math.abs(x-r.x)<r.width*.88)return false;}
  if(pathAt(x,z).strength>.94)return false;
  if(contacts.sample(x,z,terrain.height(x,z)).solid)return false;
  return true;
 }
 // The grass constructor used to call allowed then sample, repeating exact
 // height/contact/path work for every candidate. Share those deterministic
 // results without changing rejection order or consuming random numbers.
 function evaluate(x,z){
  if(x< -5.998||x>5.998||z< -5.298||z>4.298||propsSolid(x,z))return null;
  if(z> -3.46&&z<1.63){const r=terrain.river.sample(z);if(Math.abs(x-r.x)<r.width*.88)return null;}
  const path=pathAt(x,z).strength;if(path>.94)return null;
  const height=terrain.height(x,z),contact=contacts.sample(x,z,height);if(contact.solid)return null;
  return sample(x,z,{height,contact,path});
 }
 // Stable jittered clump centres; a shared field controls density AND height.
 function tussock(x,z){let strength=0;const size=.39,ix=Math.floor(x/size),iz=Math.floor(z/size);for(let j=iz-1;j<=iz+1;j++)for(let i=ix-1;i<=ix+1;i++){const cx=(i+.15+hash(i,j,seed+7)*.7)*size,cz=(j+.15+hash(i,j,seed+13)*.7)*size,r=.10+hash(i,j,seed+19)*.14;strength=Math.max(strength,1-smooth(0,r,Math.hypot(x-cx,z-cz)));}return strength;}
 return {sample,evaluate,allowed,contacts,propsSolid,allowedOnStreamBank:(x,z,margin=0)=>allowed(x,z,margin,true),noise,tussock,pathAt,pathPoints,stones,stats:{trees:trees.length,stoneFootprints:stones.length,contactVolumes:contacts.stats.stoneVolumes,contactRule:'actual closed mesh at root height; no sterile padding',pathLength:pathCurve.getLength(),coordinateOwner:'terrain height + lake level; door and dock in case recipe'}};
}

export function createFootpath(habitat,terrain){
 const p=[],n=[],uv=[],alpha=[],indices=[],samples=habitat.pathPoints,cols=10;
 for(let j=0;j<samples.length;j++){
  const a=samples[Math.max(0,j-1)],b=samples[Math.min(samples.length-1,j+1)],t=samples[j],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
  for(let i=0;i<=cols;i++){const across=i/cols*2-1,w=t.width+.055,x=t.x-dz/len*w*across,z=t.z+dx/len*w*across,y=terrain.height(x,z),normal=terrain.normal(x,z);p.push(x,y+.029,z);n.push(normal.x,normal.y,normal.z);uv.push(x,z);alpha.push(habitat.pathAt(x,z).strength);}
 }
 for(let j=0;j<samples.length-1;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+cols+1;indices.push(a,a+1,b,b,a+1,b+1);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('aWear',new THREE.Float32BufferAttribute(alpha,1));g.setIndex(indices);g.computeBoundingSphere();
 const uniforms={wet:{value:0},snow:{value:0}},material=new THREE.MeshStandardMaterial({color:0x8c8068,roughness:1,transparent:true,depthWrite:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
 material.onBeforeCompile=s=>{s.uniforms.uPathWet=uniforms.wet;s.uniforms.uPathSnow=uniforms.snow;s.vertexShader='attribute float aWear;varying float vWear;varying vec2 vSoil;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvWear=aWear;vSoil=uv;');s.fragmentShader='uniform float uPathWet,uPathSnow;varying float vWear;varying vec2 vSoil;\nfloat pathHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\nfloat pathNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(pathHash(i),pathHash(i+vec2(1.,0.)),f.x),mix(pathHash(i+vec2(0.,1.)),pathHash(i+vec2(1.)),f.x),f.y); }\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float grain=pathNoise(vSoil*183.)*2.-1.;
 float gravel=smoothstep(.86,.96,pathNoise(vSoil*91.));
 float soilPatch=pathNoise(vSoil*7.3);
 diffuseColor.rgb*=(.87+grain*.10+gravel*.18+soilPatch*.12)*(1.-uPathWet*.32);
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.89,.93,.95),uPathSnow*.94);
 diffuseColor.a*=smoothstep(.08,.70,vWear);
 if(diffuseColor.a<.015)discard;`);};
 material.customProgramCacheKey=()=> 'independent-footpath-v1';
 const mesh=new THREE.Mesh(g,material);mesh.name='Continuous worn earth from cabin steps to landing';mesh.receiveShadow=true;mesh.renderOrder=-.5;
 return {mesh,update(state){uniforms.wet.value=state.wetness??0;uniforms.snow.value=state.snow??0;},dispose(){g.dispose();material.dispose();}};
}
