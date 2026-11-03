import * as THREE from 'three';

// Vegetation roots contact the rendered closed stone volumes. Bounding boxes
// only accelerate the query; neither they nor the ecological edge field exclude
// soil. Rebuild this static index if the authored stone transforms change.
const BOULDER_NAME='Irregular partly buried talus and shoreline boulders';
const SCREE_NAME='Loose angular scree concentrated below exposed mountain faces';
const ALLUVIUM_NAME='Small partly buried alluvial gravel on wetland tongues';
const BUCKET=.32,EDGE_RADIUS=.075,LOCAL_BINS=6;
const SURFACE_EPS=1e-8,BARYCENTRIC_EPS=1e-10,STRIDE=15;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const bucketKey=(x,z)=>`${Math.floor(x/BUCKET)},${Math.floor(z/BUCKET)}`;

function geometryTopology(geometry){
  const positions=geometry.getAttribute('position'),index=geometry.getIndex();
  const vertices=[],ids=[],welded=new Map();
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),key=`${x},${y},${z}`;
    if(!welded.has(key)){welded.set(key,vertices.length);vertices.push([x,y,z]);}
    ids.push(welded.get(key));
  }
  const triangles=[],start=geometry.drawRange.start||0;
  const end=Math.min(index?index.count:positions.count,start+geometry.drawRange.count);
  for(let i=start;i+2<end;i+=3)triangles.push([ids[index?index.getX(i):i],ids[index?index.getX(i+1):i+1],ids[index?index.getX(i+2):i+2]]);
  return {vertices,triangles};
}

function compileStone(topology,matrix,terrain,id,kind,instance){
  const vertices=[],offsets=[],v=new THREE.Vector3(),bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity},contour=kind!=='woody-root';
  for(const p of topology.vertices){
    v.set(...p).applyMatrix4(matrix);vertices.push([v.x,v.y,v.z]);
    // Woody contact consumers query only closed-volume membership. Soil-edge
    // contours belong to the stone habitat sampler and are never read there.
    if(contour)offsets.push(v.y-terrain.height(v.x,v.z));
    bounds.minX=Math.min(bounds.minX,v.x);bounds.maxX=Math.max(bounds.maxX,v.x);
    bounds.minY=Math.min(bounds.minY,v.y);bounds.maxY=Math.max(bounds.maxY,v.y);
    bounds.minZ=Math.min(bounds.minZ,v.z);bounds.maxZ=Math.max(bounds.maxZ,v.z);
  }
  const data=[],segments=[],bins=Array.from({length:LOCAL_BINS*LOCAL_BINS},()=>[]);
  const sx=LOCAL_BINS/Math.max(1e-12,bounds.maxX-bounds.minX),sz=LOCAL_BINS/Math.max(1e-12,bounds.maxZ-bounds.minZ);
  const binX=x=>clamp(Math.floor((x-bounds.minX)*sx),0,LOCAL_BINS-1),binZ=z=>clamp(Math.floor((z-bounds.minZ)*sz),0,LOCAL_BINS-1);
  for(const ids of topology.triangles){
    const a=vertices[ids[0]],b=vertices[ids[1]],c=vertices[ids[2]];
    const dx1=b[0]-a[0],dz1=b[2]-a[2],dx2=c[0]-a[0],dz2=c[2]-a[2],det=dx1*dz2-dz1*dx2;
    if(Math.abs(det)>1e-16){
      const minX=Math.min(a[0],b[0],c[0]),maxX=Math.max(a[0],b[0],c[0]),minZ=Math.min(a[2],b[2],c[2]),maxZ=Math.max(a[2],b[2],c[2]),t=data.length;
      // Origin, two projected edges, their heights, inverse determinant, tight
      // projected bounds and oriented vertical crossing. Float64 throughout.
      data.push(a[0],a[2],a[1],dx1,dz1,b[1]-a[1],dx2,dz2,c[1]-a[1],1/det,minX,maxX,minZ,maxZ,Math.sign(det));
      for(let j=binZ(minZ);j<=binZ(maxZ);j++)for(let i=binX(minX);i<=binX(maxX);i++)bins[j*LOCAL_BINS+i].push(t);
    }
    if(!contour)continue;
    // A piecewise-linear stone/soil contour drives only ecological enrichment.
    // Terrain curvature here never feeds back into the exact volume test.
    const crossings=[];
    for(let e=0;e<3;e++){
      const ia=ids[e],ib=ids[(e+1)%3],fa=offsets[ia],fb=offsets[ib];
      if((fa<0)===(fb<0))continue;
      const t=fa/(fa-fb),p=vertices[ia],q=vertices[ib];
      crossings.push([p[0]+(q[0]-p[0])*t,p[2]+(q[2]-p[2])*t]);
    }
    if(crossings.length===2){const [p,q]=crossings;segments.push([p[0],p[1],q[0],q[1]]);}
  }
  return {id,kind,instance,bounds,sx,sz,triangles:new Float64Array(data),bins,segments};
}

function columnSpans(stone,x,z,counters){
  const b=stone.bounds;
  if(x<b.minX-SURFACE_EPS||x>b.maxX+SURFACE_EPS||z<b.minZ-SURFACE_EPS||z>b.maxZ+SURFACE_EPS)return null;
  const ix=clamp(Math.floor((x-b.minX)*stone.sx),0,LOCAL_BINS-1),iz=clamp(Math.floor((z-b.minZ)*stone.sz),0,LOCAL_BINS-1),data=stone.triangles,hits=[];
  counters.preciseColumns++;
  for(const t of stone.bins[iz*LOCAL_BINS+ix]){
    counters.triangleTests++;
    if(x<data[t+10]-SURFACE_EPS||x>data[t+11]+SURFACE_EPS||z<data[t+12]-SURFACE_EPS||z>data[t+13]+SURFACE_EPS)continue;
    const qx=x-data[t],qz=z-data[t+1],u=(qx*data[t+7]-qz*data[t+6])*data[t+9],v=(data[t+3]*qz-data[t+4]*qx)*data[t+9];
    if(u< -BARYCENTRIC_EPS||v< -BARYCENTRIC_EPS||u+v>1+BARYCENTRIC_EPS)continue;
    hits.push({y:data[t+2]+u*data[t+5]+v*data[t+8],sign:data[t+14]});
  }
  if(!hits.length)return null;
  hits.sort((a,b)=>a.y-b.y);
  const events=[];
  for(const hit of hits){
    const previous=events[events.length-1];
    if(previous&&Math.abs(hit.y-previous.y)<=SURFACE_EPS){previous.positive||=hit.sign>0;previous.negative||=hit.sign<0;}
    else events.push({y:hit.y,positive:hit.sign>0,negative:hit.sign<0});
  }
  const spans=[];let winding=0,start=null;
  for(const event of events){
    // Adjacent coplanar faces are one crossing. Opposing crossings at the same
    // height are a tangent, retaining just their actual surface contact.
    const sign=event.positive===event.negative?0:event.positive?1:-1,wasInside=winding!==0;
    winding+=sign;
    if(!wasInside&&winding!==0)start=event.y;
    if(wasInside&&winding===0){spans.push([start,event.y]);start=null;}
    if(sign===0)spans.push([event.y,event.y]);
  }
  // On an exact projected silhouette the volume collapses to a surface. Never
  // extend an unmatched event downwards/upwards into an unbounded exclusion.
  if(start!==null)spans.push([start,start]);
  return spans;
}

function contourDistanceSquared(segments,x,z){
  let distance=EDGE_RADIUS*EDGE_RADIUS;
  for(const s of segments){
    const dx=s[2]-s[0],dz=s[3]-s[1],t=clamp(((x-s[0])*dx+(z-s[1])*dz)/(dx*dx+dz*dz||1),0,1);
    distance=Math.min(distance,(x-s[0]-dx*t)**2+(z-s[1]-dz*t)**2);
  }
  return distance;
}

export function createGroundContacts(terrain){
  const stones=[],buckets=new Map(),topologies=new Map(),instanceMatrix=new THREE.Matrix4(),worldMatrix=new THREE.Matrix4();
  terrain.group.updateWorldMatrix(true,true);
  terrain.group.traverse(mesh=>{
    const kind=mesh.name===BOULDER_NAME?'boulder':mesh.name===SCREE_NAME?'scree':mesh.name===ALLUVIUM_NAME?'alluvium':null;
    if(!kind||!mesh.isInstancedMesh)return;
    if(!topologies.has(mesh.geometry))topologies.set(mesh.geometry,geometryTopology(mesh.geometry));
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,instanceMatrix);worldMatrix.multiplyMatrices(mesh.matrixWorld,instanceMatrix);
      const stone=compileStone(topologies.get(mesh.geometry),worldMatrix,terrain,stones.length,kind,i);stones.push(stone);
      const b=stone.bounds;
      for(let j=Math.floor((b.minZ-EDGE_RADIUS)/BUCKET);j<=Math.floor((b.maxZ+EDGE_RADIUS)/BUCKET);j++)for(let k=Math.floor((b.minX-EDGE_RADIUS)/BUCKET);k<=Math.floor((b.maxX+EDGE_RADIUS)/BUCKET);k++){
        const key=`${k},${j}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(stone);
      }
    }
  });
  const counters={queries:0,exactRepeatHits:0,candidateStones:0,preciseColumns:0,triangleTests:0};
  const stats={method:'actual world triangles / oriented vertical closed-volume spans',boulders:stones.filter(s=>s.kind==='boulder').length,scree:stones.filter(s=>s.kind==='scree').length,alluvium:stones.filter(s=>s.kind==='alluvium').length,stoneVolumes:stones.length,projectedTriangles:stones.reduce((n,s)=>n+s.triangles.length/STRIDE,0),bucketSize:BUCKET,buckets:buckets.size,localBinsPerAxis:LOCAL_BINS,solidClearance:SURFACE_EPS,edgeRadius:EDGE_RADIUS,edgeExcludesSoil:false,quantizedOccupancy:false,counters};
  let previousX=NaN,previousZ=NaN,previousColumns=[],previousEdge=0;
  function sample(x,z,y=terrain.height(x,z)){
    counters.queries++;
    let columns,edge;
    if(x===previousX&&z===previousZ){columns=previousColumns;edge=previousEdge;counters.exactRepeatHits++;}
    else{
      columns=[];let distanceSquared=EDGE_RADIUS*EDGE_RADIUS;
      for(const stone of buckets.get(bucketKey(x,z))||[]){
        counters.candidateStones++;
        const spans=columnSpans(stone,x,z,counters);if(spans)columns.push(...spans);
        const b=stone.bounds,dx=Math.max(b.minX-x,0,x-b.maxX),dz=Math.max(b.minZ-z,0,z-b.maxZ);
        if(dx*dx+dz*dz<distanceSquared)distanceSquared=Math.min(distanceSquared,contourDistanceSquared(stone.segments,x,z));
      }
      edge=1-smooth(Math.sqrt(distanceSquared)/EDGE_RADIUS);
      previousX=x;previousZ=z;previousColumns=columns;previousEdge=edge;
    }
    let solid=false,bottom=null,top=null,nearest=Infinity;
    for(const span of columns){
      const lo=span[0],hi=span[1],inside=y>=lo-SURFACE_EPS&&y<=hi+SURFACE_EPS;
      if(inside)solid=true;
      const distance=inside?0:Math.min(Math.abs(y-lo),Math.abs(y-hi));
      if(distance<nearest){nearest=distance;bottom=lo;top=hi;}
    }
    return {solid,rock:solid?1:0,edge:solid?0:edge,top,bottom};
  }
  return {sample,stats,diagnostics:{instances:stones.map(s=>({id:s.id,kind:s.kind,instance:s.instance,...s.bounds,triangles:s.triangles.length/STRIDE,soilContourSegments:s.segments.length})),limits:'Static closed boulder, loose-scree and alluvial-gravel geometry only; mountain plates are soil supports, not blanket root exclusions. Edge distance uses a linearised soil contour only for enrichment. Top/bottom describe the nearest occupied vertical span, including a zero-thickness exact tangent.'}};
}

// Reuse the same exact closed-volume test for newly planted woody collars.
// Bounds accelerate queries only; there is no expanded circular soil mask.
export function createMeshGroundContacts(meshes,terrain){
  const counters={queries:0,preciseColumns:0,triangleTests:0};
  const volumes=meshes.map((mesh,i)=>{mesh.updateWorldMatrix(true,false);return compileStone(geometryTopology(mesh.geometry),mesh.matrixWorld,terrain,i,'woody-root',0);});
  return {sample(x,z,y=terrain.height(x,z)){
    counters.queries++;
    for(const volume of volumes){const spans=columnSpans(volume,x,z,counters);if(spans?.some(([lo,hi])=>y>=lo-SURFACE_EPS&&y<=hi+SURFACE_EPS))return {solid:true};}
    return {solid:false};
  },stats:{method:'rendered closed woody-root triangles at actual soil height',volumes:volumes.length,edgeExcludesSoil:false,counters},diagnostics:volumes.map(v=>({id:v.id,...v.bounds,triangles:v.triangles.length/STRIDE}))};
}
