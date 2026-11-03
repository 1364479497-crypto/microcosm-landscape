import * as THREE from 'three';

// Authored orchard grammar and a connected skin compiler. A child replaces a
// real 2x2 parent-skin patch, shares its eight boundary vertices and grows a
// curved collar into its own sweep. No child begins as a capped cylinder inside
// another cylinder. Species rules are case recipes, not Ash/Weber-Penn presets.
const UP=new THREE.Vector3(0,1,0),TAU=Math.PI*2,clamp=THREE.MathUtils.clamp,mix=THREE.MathUtils.lerp;
function random(seed){let s=seed>>>0;return()=>{s+=0x6d2b79f5;let n=s;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
function cubic(a,b,c,d,t){const u=1-t;return a.clone().multiplyScalar(u*u*u).addScaledVector(b,3*u*u*t).addScaledVector(c,3*u*t*t).addScaledVector(d,t*t*t);}
function frame(tangent,x=null){const y=tangent.clone().normalize();x=x?x.clone().addScaledVector(y,-x.dot(y)).normalize():new THREE.Vector3().crossVectors(y,Math.abs(y.y)>.94?new THREE.Vector3(1,0,0):UP).normalize();const z=new THREE.Vector3().crossVectors(x,y).normalize();return {x,y,z,q:new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z))};}
export function sampleSkeletonAxis(axis,t){
 const u=clamp(t,0,1),fractions=axis.sampleFractions,i=Math.min(axis.samples.length-2,fractions?Math.max(0,fractions.findLastIndex(v=>v<=u)):Math.floor(u*(axis.samples.length-1))),f=fractions?(u-fractions[i])/(fractions[i+1]-fractions[i]):u*(axis.samples.length-1)-i,x=axis.samples[i],y=axis.samples[i+1];return {p:x.p.clone().lerp(y.p,f),q:x.q.clone().slerp(y.q,f),r:mix(x.r,y.r,f),tangent:x.tangent.clone().lerp(y.tangent,f).normalize()};
}
export const ORCHARD_GROWTH_RULES=Object.freeze({peach:{form:'low open vase',scaffolds:[3,4],trunkFraction:.29,mainAnglesDegrees:[48,73],secondaryPerMain:4,fruitingPerSecondary:8,shortShootsPerFruiting:5},persimmon:{form:'irregular modified central leader',scaffolds:[5,5],trunkFraction:.52,mainAnglesDegrees:[48,82],secondaryPerMain:3,fruitingPerSecondary:6,shortShootsPerFruiting:5},surface:'shared parent opening / curved collar / child skin, no internal birth cap',budget:{maxBranchesPerTree:900,maxDraws:6,maxTotalTriangles:1100000}});

export function createOrchardSkeleton({terrain,sites,seed=42}){
 const b={p:[],uv:[],idx:[],radius:[],period:[],root:[],species:[],tangent:[]},branches=[],trees=[],roots=[],junctions=[],axes=[],treeRoots=[],stats={parentOpenings:0,sharedBoundaryVertices:0,internalBirthCaps:0,rootBottomCaps:0,tipCaps:0,cabinAvoidance:[]};let nextId=0;
 const push=(p,r,tan,travel,root,species)=>{const id=b.p.length/3;b.p.push(p.x,p.y,p.z);b.uv.push(0,travel);b.radius.push(r);b.period.push(r*TAU);b.root.push(root.x,root.y,root.z,1);b.species.push(species);b.tangent.push(tan.x,tan.y,tan.z);return id;};
 const pos=id=>new THREE.Vector3().fromArray(b.p,id*3);
 // This conservative occupied envelope comes from the retained cabin plan:
 // fixed world pose, foundation owner and complete gabled roof including eaves.
 // It is a spatial guard for every seed, not a per-seed exception or a new
 // terrain/house owner. It reserves a small mature-organ reach as well as wood.
 const cabinY=Math.max(terrain.height(-2.65,-.25),...[-.5,.5].flatMap(x=>[-.35,.35].map(z=>terrain.height(-2.65+x,-.25+z))))+.055,cabinCos=Math.cos(-.07),cabinSin=Math.sin(-.07);
 function insideCabin(p,r){const dx=p.x+2.65,dz=p.z+.25,x=cabinCos*dx-cabinSin*dz,z=cabinSin*dx+cabinCos*dz,y=p.y-cabinY;return Math.abs(x)<.66+r&&Math.abs(z)<.505+r&&y>-.07-r&&y+.62*x<.925+r*Math.hypot(1,.62)&&y-.62*x<.925+r*Math.hypot(1,.62);}
 function safeCurve(points,desc,radius){
  const curve=p=>new THREE.CatmullRomCurve3(p,false,'centripetal'),reach=radius+.050,unsafe=c=>Array.from({length:49},(_,i)=>c.getPoint(i/48)).some(p=>insideCabin(p,reach)),original=curve(points);
  if(!unsafe(original))return original;
  const start=points[0],away=start.clone().sub(new THREE.Vector3(-2.65,start.y,-.25)).normalize(),forward=points.at(-1).clone().sub(start),sense=Math.sign(new THREE.Vector3().crossVectors(forward,away).y)||1;
  // Keep the basal tangent/real graft opening unchanged. Only the subsequent
  // growth bends away from occupied volume; no random number is consumed.
  for(const shrink of [1,.82,.62,.42])for(const turn of [sense*.28,-sense*.28,sense*.52,-sense*.52,sense*.85,-sense*.85,sense*1.2,-sense*1.2]){
   const candidate=points.map((p,i)=>i===0?p:i===1?start.clone().addScaledVector(p.clone().sub(start),shrink):start.clone().add(p.clone().sub(start).applyAxisAngle(UP,turn).multiplyScalar(shrink))),result=curve(candidate);
   if(!unsafe(result)){result.cabinAvoidance={kind:desc.kind,turn,shrink};return result;}
  }
  // Report an unresolved envelope rather than silently dropping a branch or
  // opening a hole. The independent triangle test remains a blocking gate.
  original.cabinAvoidance={kind:desc.kind,unresolved:true};return original;
 }

 for(const [treeIndex,site]of sites.entries()){
  const kaki=site.species==='persimmon',rng=random(seed^0x7b31ac91^Math.imul(treeIndex+1,0x45d9f3b)),range=(a,c)=>mix(a,c,rng()),h=range(...(kaki?[1.94,2.01]:[1.46,1.53])),root=new THREE.Vector3(site.x,site.y-.012,site.z),phase=range(0,TAU),baseR=h*(kaki?.041:.037),startIndex=branches.length,scaffolds=kaki?5:3+(treeIndex%2);treeRoots.push(root.toArray());
  Object.assign(site,{rootY:root.y,height:h,trunkRadius:baseR,trunkBaseRadius:baseR});
  // These few coarse 3D support paths are authored from real dormant tree
  // photographs. The persimmon leader stops inside the crown, and substantial
  // medium forks continue above it. Fine growth is bounded by length/angle at
  // birth; endpoints are never hard-clamped back into a sphere.
  function growthDirection(desc,parentT=UP){
   const radial=new THREE.Vector3(Math.cos(desc.az),0,Math.sin(desc.az));
   let dir=radial.addScaledVector(UP,desc.rise??1).addScaledVector(parentT,desc.continuation?.95:.20).normalize();
   if(desc.continuation)return dir;
   let normal=dir.clone().addScaledVector(parentT,-dir.dot(parentT));
   if(normal.lengthSq()<.02)normal=new THREE.Vector3(Math.cos(desc.az),0,Math.sin(desc.az)).addScaledVector(parentT,-(Math.cos(desc.az)*parentT.x+Math.sin(desc.az)*parentT.z));
   normal.normalize();const along=clamp(dir.dot(parentT),-.25,.86);
   return parentT.clone().multiplyScalar(along).addScaledVector(normal,Math.sqrt(1-along*along)).normalize();
  }
  function curveFor(desc,start){
   if(desc.kind==='trunk'){
    const local=kaki?[[0,0,0],[.015,.17,-.009],[-.012,.34,.017],[.035,.52,.027]]:[[0,0,0],[.004,.10,.003],[-.009,.21,.006],[.012,.29,.002]];
    return new THREE.CatmullRomCurve3(local.map(([x,y,z])=>root.clone().add(new THREE.Vector3((x*Math.cos(phase)-z*Math.sin(phase))*h,y*h,(x*Math.sin(phase)+z*Math.cos(phase))*h))),false,'centripetal');
   }
   const radial=new THREE.Vector3(Math.cos(desc.az),0,Math.sin(desc.az)),side=new THREE.Vector3(-radial.z,0,radial.x),parentT=desc.parentTangent||UP;
   let end,dir,length;
   if(desc.kind==='main'){
    end=root.clone().addScaledVector(radial,h*desc.targetRadius).addScaledVector(UP,h*desc.targetHeight);
    dir=end.clone().sub(start).normalize();length=end.distanceTo(start);
   }else{length=h*desc.length;dir=growthDirection(desc,parentT);end=start.clone().addScaledVector(dir,length);}
   // A side birth leaves the actual selected parent normal first. The next
   // control point joins the intended long growth direction without a U-hook.
   const outward=desc.parentRadial||dir.clone().addScaledVector(parentT,-dir.dot(parentT)).normalize(),initial=desc.continuation?parentT.clone():outward.clone().multiplyScalar(.62).addScaledVector(dir,.38).normalize();
   const points=[start,start.clone().addScaledVector(initial,length*.20),start.clone().lerp(end,.62).addScaledVector(side,length*(desc.bend??0)).addScaledVector(UP,length*(desc.arch??0)),end.clone().addScaledVector(UP,-length*(desc.gravity??0))];
   return safeCurve(points,desc,desc.radius??baseR*.45);
  }
  function childrenFor(desc,curve,radiusAt){
   if(desc.kind==='short')return [];
   const list=[],bend=()=>range(-.055,.055);
   if(desc.kind==='trunk'){
    // No root-star tubes. The continuous trunk collar enters the actual soil.
    for(let i=0;i<scaffolds;i++)list.push({kind:'main',level:1,t:kaki?.39+i*.125:.54+i*.40/(scaffolds-1),az:phase+i*TAU/scaffolds+range(-.17,.17),ordinal:i,radiusFactor:kaki?range(.48,.56):range(.62,.70),targetRadius:kaki?range(.22,.28):range(.23,.28),targetHeight:kaki?.49+i*.038:range(.44,.51),bend:bend()});
    if(kaki)list.push({kind:'secondary',level:2,t:1,az:phase+.31,length:.255,rise:2.6,ordinal:scaffolds,radiusFactor:.90,continuation:true,bend:bend()});
   }else if(desc.kind==='main'){
    const count=kaki?3:4;
    for(let i=0;i<count-1;i++)list.push({kind:'secondary',level:2,t:.36+i*.235,az:desc.az+(i%2?-1:1)*range(.75,1.75),length:range(.19,.27),rise:range(.90,1.90),ordinal:i,radiusFactor:i===0?.43:range(.62,.76),bend:bend()});
    list.push({kind:'secondary',level:2,t:1,az:desc.az+range(-.36,.36),length:range(.23,.30),rise:range(.85,1.75),ordinal:count-1,radiusFactor:.88,continuation:true,bend:bend()});
   }else{
    const next=desc.kind==='secondary'?'fruiting':'short',count=next==='fruiting'?(kaki?5:7):4;
    for(let i=0;i<count;i++){const habit=rng(),rise=next==='fruiting'?(habit<.22?range(-.35,.35):habit<.56?range(.35,.95):range(1.0,2.0)):(habit<.28?range(-.65,.10):range(.15,1.45));list.push({kind:next,level:desc.level+1,t:.23+(i+range(.22,.78))/count*.68,az:desc.az+(i%2?-1:1)*range(.62,2.05),length:next==='fruiting'?range(.095,.18):range(.055,.115),rise,ordinal:i,radiusFactor:next==='fruiting'?range(.34,.50):range(.36,.52),bend:range(-.065,.065),arch:range(.015,.065),gravity:next==='fruiting'?range(.018,.080):range(.015,.10)});}
    list.push({kind:next,level:desc.level+1,t:1,az:desc.az+range(-.30,.30),length:next==='fruiting'?range(.12,.18):range(.07,.11),rise:range(.35,1.55),ordinal:count,radiusFactor:.86,continuation:true,bend:bend(),arch:range(.015,.045),gravity:range(.015,.07)});
   }
   return list;
  }
  function compile(desc,start,startRing=null,parentInfo=null){
   const id=nextId++,level=desc.level,curve=curveFor(desc,start),length=curve.getLength(),sides=startRing?startRing.length:24,baseRadius=desc.radius??baseR,tipRatio=desc.kind==='trunk'?(kaki?.43:.53):desc.kind==='main'?.55:desc.kind==='secondary'?.34:desc.kind==='fruiting'?.14:.035;
   if(curve.cabinAvoidance)stats.cabinAvoidance.push({tree:treeIndex,branch:id,...curve.cabinAvoidance});
   const radiusAt=t=>{const r=baseRadius*mix(1,tipRatio,Math.pow(t,.92));if(parentInfo?.continuation&&t<.21){const f=t/.21,u=f*f*(3-2*f);return mix(parentInfo.parentRadius,r,u);}return r;},children=childrenFor(desc,curve,radiusAt),intervals=children.filter(c=>!c.continuation).map(c=>{const rr=radiusAt(c.t);c.half=Math.min(.045,Math.max(.004,rr*c.radiusFactor*.95)/Math.max(length,.01));return [clamp(c.t-c.half,.005,.985),c.t,clamp(c.t+c.half,.015,.995)];});
   let ts=[0,1,...intervals.flat()];const steps=desc.kind==='trunk'?20:desc.kind==='main'?15:desc.kind==='secondary'?11:desc.kind==='fruiting'?5:4;
   for(let i=1;i<steps;i++){const t=i/steps;if(!children.some(c=>Math.abs(t-c.t)<c.half*1.05))ts.push(t);}if(startRing)ts.push(.045,.09,.15,.21);ts=[...new Set(ts.map(t=>Number(t.toFixed(9))))].sort((a,c)=>a-c);
   const centers=ts.map(t=>curve.getPoint(t)),tangents=ts.map(t=>curve.getTangent(t).normalize()),frames=[],rings=[];let previous=parentInfo?.radialSeed?.clone()||null,travel=0;const vertexBegin=b.p.length/3;
   for(let j=0;j<ts.length;j++){
    const t=ts[j];if(j)travel+=centers[j].distanceTo(centers[j-1]);const f=frame(tangents[j],startRing&&t<=.21?parentInfo.radialSeed:previous);frames.push(f);previous=f.x;
    if(j===0&&startRing){rings.push(startRing);continue;}
    const ring=[];
    for(let k=0;k<sides;k++){
     const a=k/sides*TAU,r=radiusAt(t);let p=centers[j].clone().addScaledVector(f.x,Math.cos(a)*r).addScaledVector(f.z,Math.sin(a)*r);
     if(startRing&&!parentInfo?.continuation&&t<.21){
      const u=t/.21,base=pos(startRing[k]),parentN=parentInfo.boundaryNormals[k],collarLength=curve.getPoint(.21).distanceTo(centers[0]);
      const last=curve.getPoint(.21),endFrame=frame(curve.getTangent(.21),parentInfo.radialSeed),end=last.clone().addScaledVector(endFrame.x,Math.cos(a)*radiusAt(.21)).addScaledVector(endFrame.z,Math.sin(a)*radiusAt(.21)),cp1=base.clone().addScaledVector(parentN,collarLength*.30),cp2=end.clone().addScaledVector(endFrame.y,-collarLength*.25);p=cubic(base,cp1,cp2,end,u);
     }
     ring.push(push(p,r,f.y,(parentInfo?.distance||0)+travel,root,kaki?1:0));
    }rings.push(ring);
   }
   const holes=new Set(),childPorts=[];
   for(const child of children.filter(c=>!c.continuation)){
    const row=ts.findIndex(t=>Math.abs(t-child.t)<1e-7);if(row<1||row>=ts.length-1)throw new Error('Graft row missing');const f=frames[row],planned=curveFor({...child,radius:radiusAt(child.t)*child.radiusFactor,parentTangent:f.y},centers[row]),desired=planned.getTangent(0).addScaledVector(f.y,-planned.getTangent(0).dot(f.y)).normalize(),k0=Math.round(Math.atan2(desired.dot(f.z),desired.dot(f.x))/TAU*sides),wrap=k=>(k%sides+sides)%sides,k=wrap(k0),cells=[];
    for(const rr of [row-1,row])for(const kk of [k-1,k])cells.push(`${rr},${wrap(kk)}`);if(cells.some(x=>holes.has(x)))throw new Error(`Overlapping branch openings ${treeIndex}/${id}`);cells.forEach(x=>holes.add(x));
    const boundaryCells=[[row-1,k-1],[row,k-1],[row+1,k-1],[row+1,k],[row+1,k+1],[row,k+1],[row-1,k+1],[row-1,k]].reverse(),boundary=boundaryCells.map(([rr,kk])=>rings[rr][wrap(kk)]),boundaryNormals=boundaryCells.map(([rr,kk])=>pos(rings[rr][wrap(kk)]).sub(centers[rr]).normalize()),anchor=boundary.reduce((p,i)=>p.add(pos(i)),new THREE.Vector3()).multiplyScalar(1/8),radial=anchor.clone().sub(centers[row]).addScaledVector(f.y,-anchor.clone().sub(centers[row]).dot(f.y)).normalize(),seedVector=pos(boundary[0]).sub(anchor),childR=radiusAt(child.t)*child.radiusFactor;
    childPorts.push({child,anchor,boundary,info:{parent:id,axisPoint:centers[row],tangent:f.y,radialSeed:seedVector,parentRadius:radiusAt(child.t),distance:curve.getLength()*child.t,radial,boundaryNormals},radius:childR});
    junctions.push({tree:treeIndex,parent:id,childKind:child.kind,at:child.t,parentRow:row,boundaryVertexIds:boundary,anchor:anchor.toArray(),parentRadius:radiusAt(child.t),childRadius:childR,shared:true,removedParentQuads:4,internalChildCap:false});stats.parentOpenings++;stats.sharedBoundaryVertices+=8;
   }
   const firstIndex=b.idx.length;
   for(let j=0;j<rings.length-1;j++)for(let k=0;k<sides;k++){if(holes.has(`${j},${k}`))continue;const a=rings[j][k],c=rings[j][(k+1)%sides],d=rings[j+1][k],e=rings[j+1][(k+1)%sides];b.idx.push(a,d,c,c,d,e);}
   if(!startRing){const center=push(centers[0],radiusAt(0),tangents[0],0,root,kaki?1:0);for(let k=0;k<sides;k++)b.idx.push(center,rings[0][k],rings[0][(k+1)%sides]);stats.rootBottomCaps++;}
   const continuation=children.find(c=>c.continuation);
   if(!continuation){const tip=push(centers.at(-1).clone().addScaledVector(tangents.at(-1),radiusAt(1)*.65),radiusAt(1),tangents.at(-1),travel,root,kaki?1:0);for(let k=0;k<sides;k++)b.idx.push(tip,rings.at(-1)[(k+1)%sides],rings.at(-1)[k]);stats.tipCaps++;}
   const samples=ts.map((t,i)=>({p:centers[i].clone(),q:frames[i].q.clone(),r:radiusAt(t),tangent:frames[i].y.clone()}));
   const record={id,tree:treeIndex,species:site.species,kind:desc.kind,level,isRoot:!!desc.isRoot,parent:parentInfo?.parent??null,start:samples[0].p.toArray(),end:samples.at(-1).p.toArray(),radius:baseRadius,treeRoot:root.toArray(),sections:ts.length-1,sides,baseVertex:vertexBegin,vertexCount:b.p.length/3-vertexBegin,firstIndex,indexCount:b.idx.length-firstIndex,closedCaps:!startRing,sharedBirthBoundary:!!startRing,continuation:!!desc.continuation,samples,sampleFractions:ts,az:desc.az??phase,length,leafBearing:['secondary','fruiting','short'].includes(desc.kind),flowerBearing:!kaki&&desc.kind==='fruiting'};branches.push(record);axes.push(record);
   if(desc.isRoot)roots.push({tree:treeIndex,start:record.start,end:record.end,buried:terrain.height(...[record.end[0],record.end[2]])-record.end[1]});
   for(const port of childPorts)compile({...port.child,radius:port.radius,parentRadial:port.info.radial,parentTangent:port.info.tangent},port.anchor,port.boundary,port.info);
   if(continuation){const anchor=centers.at(-1),ring=rings.at(-1),info={parent:id,axisPoint:anchor,tangent:tangents.at(-1),radialSeed:pos(ring[0]).sub(anchor),parentRadius:radiusAt(1),distance:travel,continuation:true};junctions.push({tree:treeIndex,parent:id,childKind:continuation.kind,at:1,boundaryVertexIds:ring,anchor:anchor.toArray(),parentRadius:radiusAt(1),childRadius:radiusAt(1)*continuation.radiusFactor,shared:true,removedParentQuads:0,internalChildCap:false,continuation:true});compile({...continuation,radius:radiusAt(1)*continuation.radiusFactor,parentTangent:tangents.at(-1)},anchor,ring,info);}
   return record;
  }
  compile({kind:'trunk',level:0,az:phase},root);
  const own=branches.slice(startIndex);trees.push({tree:treeIndex,species:site.species,root:root.toArray(),nominalHeight:h,trunkBaseRadius:baseR,scaffolds,branches:own.length,form:kaki?'irregular modified central leader':'low open centre / staggered scaffolds',mainBirthHeights:own.filter(a=>a.kind==='main').map(a=>a.start[1]-site.y),junctions:junctions.filter(j=>j.tree===treeIndex).length});
 }
 // Parent-hole interior vertices are deliberately removed from the compiled
 // stream; only referenced surface vertices survive. No fallback normals.
 const used=[...new Set(b.idx)].sort((a,c)=>a-c),remap=new Map(used.map((id,i)=>[id,i]));
 for(const [name,width]of [['p',3],['uv',2],['radius',1],['period',1],['root',4],['species',1],['tangent',3]]){const old=b[name],out=[];for(const id of used)for(let k=0;k<width;k++)out.push(old[id*width+k]);b[name]=out;}
 b.idx=b.idx.map(id=>remap.get(id));
 for(const axis of branches){axis.vertexIds=[...new Set(b.idx.slice(axis.firstIndex,axis.firstIndex+axis.indexCount))];axis.baseVertex=Math.min(...axis.vertexIds);axis.vertexCount=axis.vertexIds.length;axis.vertexRangeIsContiguous=false;}
 for(const junction of junctions)junction.boundaryVertexIds=junction.boundaryVertexIds.map(id=>remap.get(id));
 stats.unreferencedVerticesRemoved=remap.size?used.at(-1)+1-used.length:0;stats.compactedSurfaceVertices=used.length;
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));geometry.setAttribute('aBarkRadius',new THREE.Float32BufferAttribute(b.radius,1));geometry.setAttribute('aBarkPeriod',new THREE.Float32BufferAttribute(b.period,1));geometry.setAttribute('aPeachRoot',new THREE.Float32BufferAttribute(b.root,4));geometry.setAttribute('aOrchardSpecies',new THREE.Float32BufferAttribute(b.species,1));geometry.setAttribute('aWoodTangent',new THREE.Float32BufferAttribute(b.tangent,3));geometry.setIndex(b.idx);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.name='Connected orchard skin / shared parent holes and curved bark collars';
 return {geometry,buffers:b,branches,trees,roots,junctions,axes,sites,stats,rules:ORCHARD_GROWTH_RULES};
}
