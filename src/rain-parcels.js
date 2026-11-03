import * as THREE from 'three';

// Every parcel owns its birthplace and velocity. Moving a source only changes
// future births; falling water never gets re-projected under the current cloud.
// This is a bounded dense pool, with one cached land clip per live drop and an
// exact surface query only near contact. It owns no reflection/refraction RT.
export function createRainParcels({capacity=2600,random=Math.random,surfaceHeight,surfaceAt,onImpact}={}){
 const count=Math.max(1,Math.floor(capacity)),stride=13,parcels=new Float32Array(count*stride),positions=new Float32Array(count*6),appearance=new Float32Array(count*2),sources=new Map();
 let live=0,serial=0,lastTime=null,disposed=false;
 const geometry=new THREE.InstancedBufferGeometry();geometry.setIndex([0,1,2,0,2,3]);geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,0,1,0,1,1,0,1,-1,0],3));
 const channels=new THREE.InstancedInterleavedBuffer(positions,6);geometry.setAttribute('aStart',new THREE.InterleavedBufferAttribute(channels,3,0));geometry.setAttribute('aEnd',new THREE.InterleavedBufferAttribute(channels,3,3));geometry.setAttribute('aAppearance',new THREE.InstancedBufferAttribute(appearance,2));geometry.instanceCount=0;
 const uniforms={uCamera:{value:new THREE.Vector3()},uDay:{value:1}};
 const material=new THREE.ShaderMaterial({uniforms,vertexShader:`attribute vec3 aStart,aEnd;attribute vec2 aAppearance;uniform vec3 uCamera;varying vec2 vUv;varying float vAlpha;void main(){vec3 world=mix(aStart,aEnd,position.x);vec3 d=normalize(aEnd-aStart);vec3 crossed=cross(d,normalize(uCamera-world));vec3 side=length(crossed)>.0001?normalize(crossed):vec3(1,0,0);world+=side*position.y*aAppearance.x;vUv=vec2(position.x,position.y);vAlpha=aAppearance.y;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,fragmentShader:`uniform float uDay;varying vec2 vUv;varying float vAlpha;void main(){float edge=1.-smoothstep(.12,1.,abs(vUv.y));float tip=smoothstep(0.,.12,vUv.x)*(1.-smoothstep(.62,1.,vUv.x));float alpha=edge*tip*vAlpha;if(alpha<.003)discard;vec3 neutral=mix(vec3(.48,.49,.50),vec3(.88,.89,.86),uDay);gl_FragColor=vec4(neutral,alpha);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`,transparent:true,depthWrite:false,side:THREE.DoubleSide});
 const object=new THREE.Mesh(geometry,material);object.name='World-history rain parcels';object.frustumCulled=false;object.renderOrder=8;
 const stats={capacity:count,active:0,totalBorn:0,totalContacts:0,exactQueries:0,droppedBirths:0,sourceHistory:0,drawCalls:1,birthOwnership:'Immutable world-space birthplace; velocity relaxes toward wind; emitter history only feeds new births'};
 function birth(em,x,y,z,vx,vz,lag,windX,windZ){
  if(live>=count){stats.droppedBirths++;return;}
  const i=live++,j=i*stride,a=random()*Math.PI*2,r=Math.sqrt(random())*em.radius,speed=5.6+random()*3.4,len=.11+random()*.11;
  parcels[j]=x+Math.cos(a)*r;parcels[j+1]=y;parcels[j+2]=z+Math.sin(a)*r*.70;parcels[j+3]=vx*.10+windX*.25;parcels[j+4]=vz*.10+windZ*.25;parcels[j+5]=speed;parcels[j+6]=0;parcels[j+7]=len;parcels[j+8]=.0035+random()*.0022;parcels[j+9]=.34+random()*.22;parcels[j+10]=em.id;parcels[j+11]=++serial;parcels[j+12]=em.rate*(1-em.snowFraction);
  // Account for a birth within this simulation step instead of releasing all
  // new parcels at the frame boundary. No future cloud pose enters this step.
  parcels[j]+=parcels[j+3]*lag;parcels[j+2]+=parcels[j+4]*lag;parcels[j+1]-=speed*lag;parcels[j+6]=lag;stats.totalBorn++;
 }
 function update(dt,{time=0,emitters=[],windX=0,windZ=0,camera,daylight=1,state={}}={}){
  if(disposed)return 0;dt=Math.max(0,Math.min(.1,dt));if(lastTime!==null&&time<lastTime){live=0;sources.clear();}lastTime=time;
  uniforms.uDay.value=THREE.MathUtils.clamp(daylight,0,1);camera?.getWorldPosition(uniforms.uCamera.value);
  const existing=live,drag=1-Math.exp(-dt*1.65);let i=0;
  while(i<live){
   const j=i*stride,oldX=parcels[j],oldY=parcels[j+1],oldZ=parcels[j+2];parcels[j+3]+=(windX*1.25-parcels[j+3])*drag;parcels[j+4]+=(windZ*1.25-parcels[j+4])*drag;parcels[j+5]+=dt*1.5;
   const x=oldX+parcels[j+3]*dt,y=oldY-parcels[j+5]*dt,z=oldZ+parcels[j+4]*dt;parcels[j]=x;parcels[j+1]=y;parcels[j+2]=z;parcels[j+6]+=dt;
   const clip=surfaceHeight(x,z);let contact=null;
   if(y<=clip+.08){stats.exactQueries++;contact=surfaceAt(x,z,time,state);}
   const ground=Number.isFinite(contact?.y)?contact.y:clip;
   if(y<=ground+.012||x<-6||x>6||z<-5.3||z>4.3||parcels[j+6]>3){
    if(contact&&y<=ground+.012&&oldY>ground-.08){stats.totalContacts++;if(parcels[j+11]%5===0)onImpact?.(x,ground,z,contact,parcels[j+12],time,(parcels[j+11]*.61803398875)%1);}
    live--;if(i!==live)parcels.copyWithin(j,live*stride,(live+1)*stride);continue;
   }i++;
  }
  const ids=new Set();let weight=0;for(const em of emitters)weight+=em.rate*(1-em.snowFraction);const unit=count/3*Math.min(1,3/Math.max(3,weight));
  for(const em of emitters){
   ids.add(em.id);let source=sources.get(em.id);if(!source){source={x:em.x,y:em.y,z:em.z,carry:0};sources.set(em.id,source);}
   const rate=em.rate*(1-em.snowFraction),births=source.carry+unit*rate/0.72*dt,n=Math.floor(births);source.carry=births-n;
   const vx=dt>0?THREE.MathUtils.clamp((em.x-source.x)/dt,-8,8):0,vz=dt>0?THREE.MathUtils.clamp((em.z-source.z)/dt,-8,8):0;
   for(let b=0;b<n;b++){const u=(b+.5)/Math.max(1,n);birth(em,THREE.MathUtils.lerp(source.x,em.x,u),THREE.MathUtils.lerp(source.y,em.y,u),THREE.MathUtils.lerp(source.z,em.z,u),vx,vz,dt*(1-u),windX,windZ);}
   source.x=em.x;source.y=em.y;source.z=em.z;
  }
  for(const id of sources.keys())if(!ids.has(id))sources.delete(id);
  for(let n=0;n<live;n++){
   const j=n*stride,k=n*6,x=parcels[j],y=parcels[j+1],z=parcels[j+2],tail=parcels[j+7]/parcels[j+5];positions[k]=x-parcels[j+3]*tail;positions[k+1]=y+parcels[j+7];positions[k+2]=z-parcels[j+4]*tail;positions[k+3]=x;positions[k+4]=y;positions[k+5]=z;appearance[n*2]=parcels[j+8];appearance[n*2+1]=parcels[j+9]*Math.min(1,parcels[j+6]/.035);
  }
  geometry.instanceCount=live;object.visible=live>0;if(live>0){channels.needsUpdate=true;geometry.attributes.aAppearance.needsUpdate=true;}Object.assign(stats,{active:live,previousLive:existing,sourceHistory:sources.size});return live;
 }
 function reset(){live=serial=0;lastTime=null;sources.clear();parcels.fill(0);positions.fill(0);appearance.fill(0);geometry.instanceCount=0;object.visible=false;channels.needsUpdate=true;geometry.attributes.aAppearance.needsUpdate=true;Object.assign(stats,{active:0,totalBorn:0,totalContacts:0,exactQueries:0,droppedBirths:0,sourceHistory:0,previousLive:0});}
 function dispose(){if(disposed)return;disposed=true;object.removeFromParent();geometry.dispose();material.dispose();sources.clear();}
 return{object,geometry,material,positions,parcels,appearance,stats,update,reset,dispose};
}
