import * as THREE from 'three';
import {normalizeSeason,seasonalProfile} from './seasonal-phenology.js';

// Authored warm-temperate pond plants. Photographs inform the structures;
// neither those photographs nor any downloaded plant mesh are runtime assets.
// Lotus and 荷花 are one species here, not two separate decorative categories.
export const POND_FLORA_PROFILES=Object.freeze({
 lotusLeaf:Object.freeze([.52,1,.38,0]),lilyLeaf:Object.freeze([.64,1,.46,0]),
 lotusBloom:Object.freeze([0,1,.015,0]),lilyBloom:Object.freeze([.32,1,.08,0]),
 lotusPod:Object.freeze([0,.10,1,.20]),autumn:Object.freeze([0,0,1,.62]),
});
const TAU=Math.PI*2,UP=new THREE.Vector3(0,1,0),clamp=THREE.MathUtils.clamp;
function random(seed){let s=seed>>>0;return()=>{s+=0x6d2b79f5;let n=s;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
class Forms{
 constructor(){this.p=[];this.c=[];this.uv=[];this.d=[];this.organ=[];this.i=[];}
 vertex(p,c,node,weight=1,pivotY=p.y,vertical=1,uv=[.5,.5],organ=0){const i=this.p.length/3;this.p.push(p.x,p.y,p.z);this.c.push(c.r,c.g,c.b);this.uv.push(...uv);this.d.push(node,weight,pivotY,vertical);this.organ.push(organ);return i;}
 geometry(){const g=new THREE.BufferGeometry();for(const[n,a,s]of[['position',this.p,3],['color',this.c,3],['uv',this.uv,2],['aFloraData',this.d,4],['aFloraOrgan',this.organ,1]])g.setAttribute(n,new THREE.Float32BufferAttribute(a,s));g.setIndex(this.i);g.computeVertexNormals();g.computeBoundingSphere();g.boundingSphere.radius+=.04;return g;}
}
function disk(forms,node,radius,lily,tint){
 const segments=lily?52:56,rings=lily?4:5,gap=lily?.27:0,range=TAU-gap*2,rows=[],center=new THREE.Vector3(node.x,node.top,node.z);
 const centerId=forms.vertex(center.clone(),tint,node.id,1,node.top,1,[.5,.5],lily?1:0);
 for(let j=1;j<=rings;j++){
  const row=[],r=j/rings;
  for(let k=0;k<=segments;k++){
   const a=gap+range*k/segments,edge=1+(lily?.014:.035)*Math.sin(a*7+node.phase)+(!lily?.018*Math.sin(a*11-node.phase):0);
   const x=Math.cos(a)*radius*r*edge,z=Math.sin(a)*radius*r*(lily?.91:1),cup=lily?.0018*r*r:radius*((node.floating?.026:.045)*r*r+(node.floating?.025:.045)*Math.sin(a*9+node.phase)*r*r);
   const p=center.clone().add(new THREE.Vector3(x,cup,z)),c=tint.clone().multiplyScalar((.90+.10*r)*(1+.035*Math.sin(a*3+node.phase)));
   row.push(forms.vertex(p,c,node.id,1,node.top,1,[.5+x/radius*.5,.5+z/radius*.5],lily?1:0));
  }rows.push(row);
 }
 for(let k=0;k<segments;k++)forms.i.push(centerId,rows[0][k+1],rows[0][k]);
 for(let j=0;j<rings-1;j++)for(let k=0;k<segments;k++){const a=rows[j][k],b=rows[j][k+1],c=rows[j+1][k],d=rows[j+1][k+1];forms.i.push(a,b,c,b,d,c);}
}
function tube(forms,node,from,to,radius,color,organ,curve=.0035,radial=7,baseWeight=0){
 const sections=7,rows=[];
 for(let j=0;j<=sections;j++){
  const t=j/sections,p=from.clone().lerp(to,t),a=node.phase;
  p.x+=Math.sin(Math.PI*t)*Math.cos(a)*curve;p.z+=Math.sin(Math.PI*t)*Math.sin(a)*curve;
  const row=[];
  for(let k=0;k<radial;k++){
   const theta=k/radial*TAU,r=radius*(1-t*.22),v=p.clone().add(new THREE.Vector3(Math.cos(theta)*r,0,Math.sin(theta)*r));
   row.push(forms.vertex(v,color.clone().multiplyScalar(.84+.16*Math.cos(theta)),node.id,baseWeight+(1-baseWeight)*t,to.y,0,[k/radial,t],organ));
  }rows.push(row);
 }
 for(let j=0;j<sections;j++)for(let k=0;k<radial;k++){const a=rows[j][k],b=rows[j][(k+1)%radial],c=rows[j+1][k],d=rows[j+1][(k+1)%radial];forms.i.push(a,c,b,b,c,d);}
 const bottom=forms.vertex(from,color,node.id,baseWeight,to.y,0,[.5,0],organ),top=forms.vertex(to,color,node.id,1,to.y,0,[.5,1],organ);
 for(let k=0;k<radial;k++)forms.i.push(bottom,rows[0][k],rows[0][(k+1)%radial],top,rows[sections][(k+1)%radial],rows[sections][k]);
}
function petal(forms,node,yaw,length,width,rise,color,organ,layer){
 const rows=[],steps=7,across=4,center=new THREE.Vector3(node.x,node.top,node.z),radial=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw)),side=new THREE.Vector3(-radial.z,0,radial.x);
 for(let j=0;j<=steps;j++){
  const t=j/steps,stretch=.13+.87*t,w=width*(.014+.986*Math.pow(Math.sin(Math.PI*t),.72)),row=[];
  for(let k=0;k<=across;k++){
   const q=k/across*2-1,p=center.clone().addScaledVector(radial,length*stretch).addScaledVector(side,q*w);
   p.y+=rise*(.14+.86*Math.pow(t,1.65))+.009*layer+.13*width*q*q*Math.sin(Math.PI*t);
   const tint=color.clone().lerp(new THREE.Color(0xffe7d7),Math.pow(1-t,2)*.52).multiplyScalar(.93+.07*Math.cos(q*Math.PI*.6));
   row.push(forms.vertex(p,tint,node.id,1,node.top,1,[k/across,t],organ));
  }rows.push(row);
 }
 for(let j=0;j<steps;j++)for(let k=0;k<across;k++){const a=rows[j][k],b=rows[j][k+1],c=rows[j+1][k],d=rows[j+1][k+1];forms.i.push(a,c,b,b,c,d);}
}
function receptacle(forms,node,radius,color,organ){
 const top=node.top+.021,low=node.top+.007,ring=[],segments=20;
 const cap=forms.vertex(new THREE.Vector3(node.x,top,node.z),color,node.id,1,node.top,1,[.5,.5],organ);
 for(let k=0;k<segments;k++){
  const a=k/segments*TAU;ring.push(forms.vertex(new THREE.Vector3(node.x+Math.cos(a)*radius,top,node.z+Math.sin(a)*radius),color,node.id,1,node.top,1,[.5+Math.cos(a)*.5,.5+Math.sin(a)*.5],organ));
 }
 const lower=[];for(let k=0;k<segments;k++){const a=k/segments*TAU;lower.push(forms.vertex(new THREE.Vector3(node.x+Math.cos(a)*radius*.64,low,node.z+Math.sin(a)*radius*.64),color.clone().multiplyScalar(.68),node.id,1,node.top,1,[.5,.1],organ));}
 for(let k=0;k<segments;k++){const n=(k+1)%segments;forms.i.push(cap,ring[n],ring[k],ring[k],lower[n],lower[k],ring[k],ring[n],lower[n]);}
}

const VERTEX_DECL=`
attribute vec4 aFloraData;attribute float aFloraOrgan;
uniform vec4 uFloraNodes[32],uFloraRoots[32];uniform vec2 uFloraSlopes[32];uniform vec4 uFloraStages;uniform float uFloraPod;
float floraGate(float organ){if(organ<.5)return uFloraStages.x;if(organ<1.5)return uFloraStages.y;if(organ<2.5)return uFloraStages.z;if(organ<3.5)return uFloraStages.w;if(organ<4.5)return max(uFloraStages.z,uFloraPod);return uFloraStages.w;}
`;
const VERTEX_TRANSFORM=`
int floraNode=int(aFloraData.x+.5);float floraGrowth=uFloraNodes[floraNode].w*floraGate(aFloraOrgan);vec4 floraRoot=uFloraRoots[floraNode];
transformed.xz=floraRoot.xz+(transformed.xz-floraRoot.xz)*floraGrowth;
transformed.y=mix(transformed.y,mix(aFloraData.z,transformed.y,floraGrowth),aFloraData.w);
transformed+=uFloraNodes[floraNode].xyz*aFloraData.y;
transformed.y+=dot(uFloraSlopes[floraNode],transformed.xz-floraRoot.xz)*aFloraData.w;
`;
function installVertex(material,uniforms,depth=false){
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms);shader.vertexShader=VERTEX_DECL+'\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+VERTEX_TRANSFORM);
  if(!depth)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
   int floraNormalNode=int(aFloraData.x+.5);objectNormal.x-=uFloraSlopes[floraNormalNode].x*objectNormal.y*aFloraData.w;objectNormal.z-=uFloraSlopes[floraNormalNode].y*objectNormal.y*aFloraData.w;objectNormal=normalize(objectNormal);
  `);
 };
 material.customProgramCacheKey=()=>`pond-flora-authored-226-${depth?'depth':'surface'}`;
}
function leafMaterial(kind,uniforms){
 const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:kind==='lotus'?.64:.43,metalness:0,side:THREE.DoubleSide});installVertex(material,uniforms);
 const install=material.onBeforeCompile;material.name=`226 ${kind} living leaf material`;
 material.onBeforeCompile=shader=>{
  install(shader);shader.uniforms.uFloraAutumn=uniforms.uFloraAutumn;
  shader.vertexShader='varying vec2 vFloraUv;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFloraUv=uv;');
  shader.fragmentShader='uniform float uFloraAutumn;varying vec2 vFloraUv;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   vec2 leafQ=(vFloraUv-.5)*2.;float leafR=length(leafQ),leafAngle=atan(leafQ.y,leafQ.x);
   float leafVein=abs(sin(leafAngle*${kind==='lotus'?'7.':'5.'}+sin(leafR*8.)*.045));float leafAA=max(.012,fwidth(leafAngle)*${kind==='lotus'?'7.':'5.'});
   float mainVein=(1.-smoothstep(.018,.018+leafAA,leafVein))*smoothstep(.06,.25,leafR)*(1.-smoothstep(.94,1.02,leafR));
   float secondary=.5+.5*sin(leafR*71.+sin(leafAngle*13.)*1.8);float fineAA=1.-smoothstep(.02,.08,length(fwidth(leafQ)));
   diffuseColor.rgb*=.91+mainVein*.18+(secondary-.5)*.045*fineAA;
   diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.35,.78,.35),uFloraAutumn*(.42+.30*smoothstep(.65,1.,leafR)));
   if(!gl_FrontFacing)diffuseColor.rgb*=vec3(${kind==='lotus'?'.83,.92,.82':'.99,.69,.72'});
  `);
 };
 material.customProgramCacheKey=()=>`pond-flora-${kind}-veins-226`;return material;
}

export function createPondFlora({terrain,seed=42,bedHeightAt}={}){
 if(!terrain?.lake||typeof terrain.height!=='function')throw new Error('Pond flora needs the shared terrain and lake.');
 const group=new THREE.Group();group.name='Lotus and small hardy waterlily in sheltered pond pockets';
 const lake=terrain.lake,r=random(seed^0x226f10a),nodes=[],meshes=[],forms={lotus:new Forms(),lily:new Forms(),stems:new Forms(),petals:new Forms(),hearts:new Forms()};
 const wind=new THREE.Vector2(),nodeUniforms=Array.from({length:32},()=>new THREE.Vector4(0,0,0,1)),rootUniforms=Array.from({length:32},()=>new THREE.Vector4()),slopes=Array.from({length:32},()=>new THREE.Vector2());
 const uniforms={uFloraNodes:{value:nodeUniforms},uFloraRoots:{value:rootUniforms},uFloraSlopes:{value:slopes},uFloraStages:{value:new THREE.Vector4()},uFloraPod:{value:0},uFloraAutumn:{value:0}};
 let sampler=null,disposed=false;
 const siteAt=(x,z)=>{
  const ground=terrain.height(x,z),bed=typeof bedHeightAt==='function'?bedHeightAt(x,z,ground):ground,depth=lake.level-bed,q=Math.hypot((x-lake.x)/lake.rx,(z-lake.z)/lake.rz);
  if(!Number.isFinite(ground)||!Number.isFinite(bed)||depth<.12||depth>.52||q>.96||z>lake.front-.14||z<1.66||x<lake.x+.45||bed>ground+.010)return null;
  return{x,z,ground,bed,depth,q};
 };
 function choose(kind,index){
  const centers=kind==='lotus'?[[.77,.13]]:index<6?[[.66,.51]]:[[.83,-.27]];
  const candidates=[];
  for(let i=0;i<160;i++){
   const c=centers[0],a=r()*TAU,d=Math.sqrt(r())*(kind==='lotus'?.36:.30),x=lake.x+c[0]*lake.rx+Math.cos(a)*d,z=lake.z+c[1]*lake.rz+Math.sin(a)*d,s=siteAt(x,z);
   if(!s)continue;const radius=(kind==='lotus'?.101:.048)+r()*(kind==='lotus'?.026:.019);
   if(nodes.some(n=>n.kind.endsWith('leaf')&&Math.hypot(n.x-x,n.z-z)<(n.radius+radius)*.86))continue;
   candidates.push({...s,radius,rank:r()});
  }
  candidates.sort((a,b)=>a.rank-b.rank);return candidates[0]||null;
 }
 function addNode(s,kind,top,radius,floating){
  const n={...s,id:nodes.length,kind,top,radius,floating,root:s.ground-.008,phase:r()*TAU,scale:.91+r()*.09};nodes.push(n);rootUniforms[n.id].set(n.x,n.root,n.z,n.top);return n;
 }
 for(let i=0;i<7;i++){
  const s=choose('lotus',i);if(!s)continue;const floating=i<2,n=addNode(s,'lotus-leaf',lake.level+(floating?.006:.135+r()*.082),s.radius,floating),tint=new THREE.Color(0x71935c).multiplyScalar(.90+r()*.18);
  disk(forms.lotus,n,n.radius,false,tint);tube(forms.stems,n,new THREE.Vector3(n.x,n.root,n.z),new THREE.Vector3(n.x,n.top,n.z),.0027,new THREE.Color(0x65794c),0,.008);
 }
 for(let i=0;i<12;i++){
  const s=choose('lily',i);if(!s)continue;const n=addNode(s,'lily-leaf',lake.level+.006,s.radius,true),tint=new THREE.Color(0x3d6334).multiplyScalar(.88+r()*.24);
  disk(forms.lily,n,n.radius,true,tint);tube(forms.stems,n,new THREE.Vector3(n.x,n.root,n.z),new THREE.Vector3(n.x,n.top,n.z),.0017,new THREE.Color(0x71804b),1,.007);
 }
 // Flower sites share the established, actually rooted leaf pockets. A narrow
 // open strip remains between these eastern pockets and the west-side landing.
 const flowerSites=[...nodes.filter(n=>n.kind==='lotus-leaf').filter((_,i)=>[0,2,4].includes(i)),...nodes.filter(n=>n.kind==='lily-leaf').filter((_,i)=>[1,5,9].includes(i))];
 flowerSites.forEach((base,i)=>{
  const lotus=base.kind==='lotus-leaf',offsets=lotus?[[-.055,.04],[.04,.025],[-.022,-.018],[.008,.006]]:[[.036,-.025],[-.026,.018],[.012,.009],[-.006,-.005]],s=offsets.map(([x,z])=>siteAt(base.x+x,base.z+z)).find(Boolean)||siteAt(base.x,base.z);if(!s)return;
  const n=addNode(s,lotus?'lotus-flower':'lily-flower',lake.level+(lotus?.210+r()*.060:.014),lotus?.074:.041,!lotus),organ=lotus?2:3;
  tube(forms.stems,n,new THREE.Vector3(n.x,n.root,n.z),new THREE.Vector3(n.x,n.top+.013,n.z),lotus?.0032:.0018,new THREE.Color(lotus?0x748052:0x7b8351),lotus?4:5,lotus?.008:.004);
  const layers=lotus?[[8,1,.38,.038],[7,.78,.36,.050],[6,.57,.34,.058]]:[[7,1,.25,.021],[6,.77,.25,.030],[5,.53,.24,.034]];
  for(let j=0;j<layers.length;j++){
   const[count,length,width,rise]=layers[j];for(let k=0;k<count;k++)petal(forms.petals,n,k/count*TAU+j*.36+n.phase,n.radius*length,n.radius*width,rise,new THREE.Color(lotus?[0xe291ac,0xe9a9b8,0xd97e9e,0xf0b6c5][i%4]:0xf5edda),organ,j*.26);
  }
  receptacle(forms.hearts,n,lotus?.015:.009,new THREE.Color(lotus?0xd0b550:0xe5b73e),lotus?4:3);
  const stamens=lotus?23:17;
  for(let k=0;k<stamens;k++){
   const a=k/stamens*TAU,rr=lotus?.019:.011,from=new THREE.Vector3(n.x+Math.cos(a)*rr,n.top+.017,n.z+Math.sin(a)*rr),to=from.clone().add(new THREE.Vector3(Math.cos(a)*.002,.010+r()*.005,Math.sin(a)*.002));
   tube(forms.hearts,n,from,to,lotus?.0011:.00085,new THREE.Color(0xe8b93c),organ,.0002,5,1);
  }
 });
 const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});depthMaterial.name='226 plant seasonal and wave-matched depth';installVertex(depthMaterial,uniforms,true);
 const materials={lotus:leafMaterial('lotus',uniforms),lily:leafMaterial('lily',uniforms),stems:new THREE.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.74,side:THREE.DoubleSide}),petals:new THREE.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.59,side:THREE.DoubleSide}),hearts:new THREE.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.73,side:THREE.DoubleSide})};
 for(const key of['stems','petals','hearts']){materials[key].name=`233 aquatic ${key}`;installVertex(materials[key],uniforms);}
 const petalInstall=materials.petals.onBeforeCompile;materials.petals.onBeforeCompile=shader=>{petalInstall(shader);shader.vertexShader='varying vec2 vPetalUv;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPetalUv=uv;');shader.fragmentShader='varying vec2 vPetalUv;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float petalDetail=1.-smoothstep(.018,.065,fwidth(vPetalUv.x));float petalVein=pow(.5+.5*cos((vPetalUv.x-.5)*46.+sin(vPetalUv.y*5.)*.3),7.);diffuseColor.rgb*=1.-petalVein*.065*petalDetail*smoothstep(.12,.7,vPetalUv.y);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.,.91,.77),pow(1.-vPetalUv.y,3.)*.18);
 `);};materials.petals.customProgramCacheKey=()=> 'pond-flora-petals-233';
 const heartInstall=materials.hearts.onBeforeCompile;materials.hearts.onBeforeCompile=shader=>{heartInstall(shader);shader.uniforms.uFloraAutumn=uniforms.uFloraAutumn;shader.fragmentShader='uniform float uFloraAutumn;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.67,.65,.35),uFloraAutumn*.78);');};materials.hearts.customProgramCacheKey=()=> 'pond-flora-autumn-hearts-226';
 for(const [key,batch]of Object.entries(forms)){
  if(!batch.i.length)continue;const g=batch.geometry(),mesh=new THREE.Mesh(g,materials[key]);mesh.name=`226 authored aquatic ${key}`;mesh.castShadow=mesh.receiveShadow=true;mesh.customDepthMaterial=depthMaterial;group.add(mesh);meshes.push(mesh);
 }
 const stats={seed,lotusLeaves:nodes.filter(n=>n.kind==='lotus-leaf').length,lilyLeaves:nodes.filter(n=>n.kind==='lily-leaf').length,lotusFlowers:nodes.filter(n=>n.kind==='lotus-flower').length,lilyFlowers:nodes.filter(n=>n.kind==='lily-flower').length,nodes:nodes.length,drawCalls:meshes.length,triangles:meshes.reduce((n,m)=>n+m.geometry.index.count/3,0),externalAssets:0,renderTargets:0,surfaceMode:'lake level fallback until sampler is attached',season:0,time:0,visibleLeafOrgans:0,visibleFlowerOrgans:0};
 const stagesFor=state=>{const s=normalizeSeason(state.season??0),p={};for(const[k,v]of Object.entries(POND_FLORA_PROFILES))p[k]=seasonalProfile(v,s);return p;};
 function waveAt(x,z,time,state){
  if(!sampler)return lake.level;
  // Match the water owner exactly. Only the extra plant sway is art-bounded;
  // do not silently clamp the supplied wind before asking for wave height.
  wind.set(Number(state.wind?.x)||0,Number(state.wind?.y)||0).multiplyScalar(Number(state.windStrength)||0);
  const y=sampler(x,z,time,wind);return Number.isFinite(y)?y:lake.level;
 }
 function evaluateNode(index,time,state={}){
  const n=nodes[index],wave=waveAt(n.x,n.z,time,state),strength=clamp(Number(state.windStrength)||0,0,1),sway=(n.floating?.0012:.0075)*strength,dx=Math.sin(time*.61+n.phase)*sway,dz=Math.cos(time*.47+n.phase)*sway*.63;
  const offset=new THREE.Vector3(dx,(wave-lake.level)*(n.floating?1:.20),dz),slope=new THREE.Vector2();
  // Fit the support plane across this leaf's footprint. A point derivative at
  // a tiny baseline over-tilts a broad pad over the short capillary waves.
  if(n.floating&&sampler){const e=Math.max(.012,n.radius*.85);slope.set((waveAt(n.x+e,n.z,time,state)-waveAt(n.x-e,n.z,time,state))/(e*2),(waveAt(n.x,n.z+e,time,state)-waveAt(n.x,n.z-e,time,state))/(e*2));}
  return{node:n,offset,slope,stages:stagesFor(state),wave};
 }
 const gate=(organ,p)=>organ<.5?p.lotusLeaf:organ<1.5?p.lilyLeaf:organ<2.5?p.lotusBloom:organ<3.5?p.lilyBloom:organ<4.5?Math.max(p.lotusBloom,p.lotusPod):p.lilyBloom;
 function update(time=0,state={}){
  if(disposed)return;time=Number.isFinite(state.time)?state.time:Number(time)||0;const p=stagesFor(state);
  uniforms.uFloraStages.value.set(p.lotusLeaf,p.lilyLeaf,p.lotusBloom,p.lilyBloom);uniforms.uFloraPod.value=p.lotusPod;uniforms.uFloraAutumn.value=p.autumn;
  for(const n of nodes){const v=evaluateNode(n.id,time,state);nodeUniforms[n.id].set(v.offset.x,v.offset.y,v.offset.z,n.scale);slopes[n.id].copy(v.slope);}
  stats.season=normalizeSeason(state.season??0);stats.time=time;stats.visibleLeafOrgans=nodes.filter(n=>n.kind.endsWith('leaf')&&(n.kind.startsWith('lotus')?p.lotusLeaf:p.lilyLeaf)*n.scale>.025).length;stats.visibleFlowerOrgans=nodes.filter(n=>n.kind.endsWith('flower')&&(n.kind.startsWith('lotus')?p.lotusBloom:p.lilyBloom)*n.scale>.025).length;
 }
 function sampleVertexAt(meshIndex,vertexIndex,time=0,state={}){
  const g=meshes[meshIndex].geometry,d=g.attributes.aFloraData,organ=g.attributes.aFloraOrgan.getX(vertexIndex),v=evaluateNode(Math.round(d.getX(vertexIndex)),Number.isFinite(state.time)?state.time:time,state),n=v.node,p=new THREE.Vector3().fromBufferAttribute(g.attributes.position,vertexIndex),growth=n.scale*gate(organ,v.stages);
  p.x=n.x+(p.x-n.x)*growth;p.z=n.z+(p.z-n.z)*growth;p.y=THREE.MathUtils.lerp(p.y,THREE.MathUtils.lerp(d.getZ(vertexIndex),p.y,growth),d.getW(vertexIndex));p.addScaledVector(v.offset,d.getY(vertexIndex));p.y+=(v.slope.x*(p.x-n.x)+v.slope.y*(p.z-n.z))*d.getW(vertexIndex);return p;
 }
 const diagnostics={species:{lotus:'Nelumbo nucifera: peltate centre attachment, floating juvenile and emergent mature leaves, broad pink petals and elevated receptacle',lily:"Nymphaea tetragona 'Alba' / Pygmaea Alba: small floating leaves with deep sinus and narrow white petals/yellow stamens"},nodes:nodes.map(n=>({...n})),profiles:POND_FLORA_PROFILES,scope:'Three summer lotus blooms with spring leaf growth and small early waterlily flowers; eastern calm shallow pockets with actual soil rooting, not a surveyed native community. Photo observations are research only; art scales follow this miniature boat and existing wetland vegetation.'};
 update(0,{});return{group,stats,diagnostics,update,setLakeSurfaceSampler(fn){sampler=typeof fn==='function'?fn:null;stats.surfaceMode=sampler?'shared water sampler with current absolute time and scaled state wind':'lake level fallback';},sampleVertexAt,sampleNodeAt(index,time=0,state={}){const v=evaluateNode(index,Number.isFinite(state.time)?state.time:time,state);return{...v.node,offset:v.offset.toArray(),slope:v.slope.toArray(),wave:v.wave,stages:v.stages};},dispose(){if(disposed)return;disposed=true;group.removeFromParent();meshes.forEach(m=>m.geometry.dispose());Object.values(materials).forEach(m=>m.dispose());depthMaterial.dispose();stats.disposed=true;}};
}
