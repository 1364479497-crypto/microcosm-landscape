import * as THREE from 'three';
// Rain events are fed by a falling world-space parcel crossing its surface. This module
// owns only their short surface response, never the rain or the water surface.
const clamp=THREE.MathUtils.clamp;
export function rainImpactProfile(age,life=.48){
 const p=clamp(age/life,0,1),envelope=Math.sin(Math.PI*p)*Math.pow(1-p,.6);
 return{progress:p,envelope,radius:.011+p*.12,crownHeight:Math.sin(Math.PI*clamp(p/.72,0,1))*.031,alive:age>=0&&age<life};
}
function crownGeometry(){
 const positions=[],indices=[],N=24;
 for(let j=0;j<2;j++)for(let i=0;i<=N;i++){const a=i/N*Math.PI*2,r=j?1:.64;positions.push(Math.cos(a)*r,j?(.6+.4*(i%2)):0,Math.sin(a)*r);}
 for(let i=0;i<N;i++){const a=i,b=i+N+1;indices.push(a,b,a+1,a+1,b,b+1);}
 const g=new THREE.InstancedBufferGeometry();g.setIndex(indices);g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));return g;
}
function ringGeometry(){const r=new THREE.RingGeometry(.965,1,40);r.rotateX(-Math.PI/2);const g=new THREE.InstancedBufferGeometry();g.index=r.index.clone();g.setAttribute('position',r.attributes.position.clone());r.dispose();return g;}
export function createRainImpacts({camera,quality=1,surfaceAt}={}){
 const count=Math.floor(420*quality),dropsPerImpact=6,group=new THREE.Group();group.name='Rain impacts on actual land and lake';
 const centers=new Float32Array(count*3),normals=new Float32Array(count*3),data=new Float32Array(count*4),dropPositions=new Float32Array(count*dropsPerImpact*3),dropAlpha=new Float32Array(count*dropsPerImpact);
 const events=Array.from({length:count},()=>({start:-99,life:.48,x:0,y:0,z:0,nx:0,ny:1,nz:0,water:false,strength:0,seed:0}));let next=0,disposed=false;
 const uniforms={uDay:{value:1},uCamera:{value:new THREE.Vector3()},uViewport:{value:720}};
 const vertex=`attribute vec3 aCenter,aNormal;attribute vec4 aData;varying float vAlpha,vWater,vArc;void main(){float p=aData.x;vec3 n=normalize(aNormal);vec3 t=normalize(cross(abs(n.y)>.9?vec3(0,0,1):vec3(0,1,0),n));vec3 b=cross(n,t);vec3 q=position;float env=sin(3.14159265*p)*pow(max(0.,1.-p),.6);float radius=RADIUS;float height=HEIGHT;vec3 world=aCenter+t*q.x*radius+b*q.z*radius+n*(q.y*height+.009);vAlpha=env*aData.y*ALPHA;vWater=aData.z;vArc=ARCS;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`;
 const fragment=`uniform float uDay;varying float vAlpha,vWater,vArc;void main(){if(vAlpha<.002)discard;vec3 colour=mix(vec3(.57,.56,.50),vec3(.84,.86,.82),vWater);colour*=.24+.76*uDay;gl_FragColor=vec4(colour,vAlpha*vArc);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`;
 const ringMat=new THREE.ShaderMaterial({uniforms,vertexShader:vertex.replace('RADIUS','(.011+p*.12)*(.8+aData.w*.35)').replace('HEIGHT','0.').replace('ALPHA','aData.z*.38').replace('ARCS','(.30+.70*smoothstep(-.55,.65,sin(atan(position.z,position.x)*3.+aData.w*11.)))'),fragmentShader:fragment,transparent:true,depthWrite:false,side:THREE.DoubleSide});
 const crownMat=new THREE.ShaderMaterial({uniforms,vertexShader:vertex.replace('RADIUS','(.012+p*.055)*(.8+aData.w*.35)*.62').replace('HEIGHT','sin(3.14159265*clamp(p/.65,0.,1.))*(.016+aData.z*.026)').replace('ALPHA','(.11+aData.z*.17)').replace('ARCS','(.35+.65*smoothstep(-.2,.6,sin(atan(position.z,position.x)*5.+aData.w*17.)))'),fragmentShader:fragment,transparent:true,depthWrite:false,side:THREE.DoubleSide});
 const geometries=[ringGeometry(),crownGeometry()];const materials=[ringMat,crownMat];
 for(let i=0;i<2;i++){const g=geometries[i];g.setAttribute('aCenter',new THREE.InstancedBufferAttribute(centers,3));g.setAttribute('aNormal',new THREE.InstancedBufferAttribute(normals,3));g.setAttribute('aData',new THREE.InstancedBufferAttribute(data,4));g.instanceCount=count;const mesh=new THREE.Mesh(g,materials[i]);mesh.frustumCulled=false;mesh.renderOrder=10;mesh.name=i?'Small transient splash crowns':'Rain ring ripples';group.add(mesh);}
 const dropGeo=new THREE.BufferGeometry();dropGeo.setAttribute('position',new THREE.BufferAttribute(dropPositions,3));dropGeo.setAttribute('aOpacity',new THREE.BufferAttribute(dropAlpha,1));
 const dropMat=new THREE.ShaderMaterial({uniforms,vertexShader:`attribute float aOpacity;uniform float uViewport;varying float vAlpha;void main(){vAlpha=aOpacity;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(.008*uViewport*.5*projectionMatrix[1][1]/max(.1,-p.z),.45,3.5);}`,fragmentShader:`uniform float uDay;varying float vAlpha;void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.||vAlpha<.002)discard;gl_FragColor=vec4(vec3(.89,.90,.86)*(.28+.72*uDay),vAlpha*(1.-smoothstep(.15,1.,r)));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`,transparent:true,depthWrite:false});
 const dropMesh=new THREE.Points(dropGeo,dropMat);dropMesh.name='Secondary raindrop splash droplets';dropMesh.frustumCulled=false;dropMesh.renderOrder=10;group.add(dropMesh);geometries.push(dropGeo);materials.push(dropMat);
 const stats={capacity:count,drawCalls:3,dropsPerImpact,active:0,water:0,land:0,totalCreated:0,totalWater:0,totalLand:0,disposed:false,surfaceOwnership:'Actual land/stream/dynamic pond sampling; a matching world-space parcel supplies contact'};
 function emit(point,normal,water,strength,time,seed=0){
  if(disposed||!Number.isFinite(point?.x+point?.y+point?.z)||normal.y<.32)return false;
  const e=events[next++%count];Object.assign(e,{start:time,life:.36+seed*.2,x:point.x,y:point.y,z:point.z,nx:normal.x,ny:normal.y,nz:normal.z,water:!!water,strength:clamp(strength,.1,1),seed});stats.totalCreated++;stats[water?'totalWater':'totalLand']++;return true;
 }
 const n=new THREE.Vector3(),t=new THREE.Vector3(),b=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),forward=new THREE.Vector3(0,0,1),point=new THREE.Vector3();
 function update(time,state={},height=720){
  uniforms.uDay.value=clamp(state.daylight??1,0,1);uniforms.uViewport.value=height;camera?.getWorldPosition(uniforms.uCamera.value);let active=0,waterCount=0,landCount=0;
  for(let i=0;i<count;i++){
   const e=events[i],age=time-e.start,profile=rainImpactProfile(age,e.life);if(!profile.alive)continue;let weight=e.strength;
   const s=surfaceAt?.(e.x,e.z,time,state);if(s&&s.water!==e.water)weight=0;if(!weight)continue;const index=active,j=index*3,k=index*4;
   const y=s&&Number.isFinite(s.y)?s.y:e.y;centers[j]=e.x;centers[j+1]=y;centers[j+2]=e.z;normals[j]=e.nx;normals[j+1]=e.ny;normals[j+2]=e.nz;data[k]=profile.progress;data[k+1]=weight;data[k+2]=e.water?1:0;data[k+3]=e.seed;
   if(weight){active++;if(e.water)waterCount++;else landCount++;}
   n.set(e.nx,e.ny,e.nz);t.crossVectors(Math.abs(n.y)>.9?forward:up,n).normalize();b.crossVectors(n,t);
   for(let d=0;d<dropsPerImpact;d++){
    const id=index*dropsPerImpact+d,a=d/dropsPerImpact*Math.PI*2+e.seed*8,speed=.11+((d*.37+e.seed)%1)*.15,v=.35+(d%3)*.10,flight=age,localY=v*flight-1.9*flight*flight;
    point.set(e.x,y+.008,e.z).addScaledVector(t,Math.cos(a)*speed*flight).addScaledVector(b,Math.sin(a)*speed*flight).addScaledVector(n,Math.max(0,localY));
    dropPositions[id*3]=point.x;dropPositions[id*3+1]=point.y;dropPositions[id*3+2]=point.z;dropAlpha[id]=weight&&localY>0?Math.min(.82,profile.envelope*1.6)*weight:0;
   }
  }
  for(const g of geometries.slice(0,2)){g.instanceCount=active;for(const name of['aCenter','aNormal','aData'])g.attributes[name].needsUpdate=true;}dropGeo.setDrawRange(0,active*dropsPerImpact);
  dropGeo.attributes.position.needsUpdate=true;dropGeo.attributes.aOpacity.needsUpdate=true;group.visible=active>0;Object.assign(stats,{active,water:waterCount,land:landCount});
 }
 function reset(){next=0;for(const e of events)e.start=-99;centers.fill(0);data.fill(0);dropAlpha.fill(0);for(const g of geometries.slice(0,2))g.instanceCount=0;dropGeo.setDrawRange(0,0);group.visible=false;Object.assign(stats,{active:0,water:0,land:0,totalCreated:0,totalWater:0,totalLand:0});}
 function dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.removeFromParent();stats.disposed=true;}
 return{group,stats,emit,update,reset,dispose,events,diagnostics:{geometries,materials}};
}
