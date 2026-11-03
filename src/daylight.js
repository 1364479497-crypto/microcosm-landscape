import * as THREE from 'three';

const ORBIT_RADIUS=6.7,ORBIT_CENTRE=new THREE.Vector3(0,2.4,3.8),SOLAR_RADIUS=.45,HALO_RADIUS=1.10,REFERENCE_DEPTH=22;
const wrapHour=hour=>((hour%24)+24)%24;

// One closed world-space circle owns both clocks. The moon is half a turn
// behind the sun; neither the viewport nor HUD rectangles can change its phase.
export function sampleDaylightOrbit(hour,body='sun',target=new THREE.Vector3()){
 const phase=(wrapHour(hour)-12)/12*Math.PI+(body==='moon'?Math.PI:0);
 return target.set(-Math.sin(phase)*ORBIT_RADIUS,Math.cos(phase)*ORBIT_RADIUS,0).add(ORBIT_CENTRE);
}

export function createDaylightHandle(scene,camera,canvas,onHour){
 const group=new THREE.Group();group.name='Authored sun and moon handles';scene.add(group);
 const geometry=new THREE.SphereGeometry(SOLAR_RADIUS,32,22),moonMaterial=new THREE.MeshBasicMaterial({color:0xa8c7e6,toneMapped:false});
 // Radiance rolls through the whole disc, rather than turning a dark limb
 // into a contrasting ring. The centre stays hot with presentation bloom off.
 const sunMaterial=new THREE.ShaderMaterial({
  vertexShader:`varying vec3 vSolarNormal,vSolarView;void main(){vec4 viewPosition=modelViewMatrix*vec4(position,1.);vSolarNormal=normalMatrix*normal;vSolarView=-viewPosition.xyz;gl_Position=projectionMatrix*viewPosition;}`,
  fragmentShader:`varying vec3 vSolarNormal,vSolarView;void main(){float facing=clamp(dot(normalize(vSolarNormal),normalize(vSolarView)),0.,1.);float heat=pow(facing,2.2);vec3 radiance=mix(vec3(1.12,.82,.40),vec3(4.,3.,1.7),heat);gl_FragColor=vec4(radiance,1.);
  #include <colorspace_fragment>
  }`,toneMapped:false,
 });sunMaterial.name='Solar radiance with a continuous warm limb';
 const sun=new THREE.Mesh(geometry,sunMaterial),moon=new THREE.Mesh(geometry,moonMaterial);group.add(sun,moon);
 const glowGeometry=new THREE.PlaneGeometry(HALO_RADIUS*2,HALO_RADIUS*2);
 const glowMaterial=new THREE.ShaderMaterial({
  uniforms:{uStrength:{value:1}},
  vertexShader:`varying vec2 vSolarGlow;void main(){vSolarGlow=position.xy/${SOLAR_RADIUS};vec4 centre=modelViewMatrix*vec4(0.,0.,0.,1.);float worldScale=length(modelMatrix[0].xyz);centre.xy+=position.xy*worldScale;gl_Position=projectionMatrix*centre;}`,
  // Both lobes decrease from the centre. No edge gate or annular shoulder
  // can produce the old outline; the opaque disc naturally covers their core.
  fragmentShader:`uniform float uStrength;varying vec2 vSolarGlow;void main(){float radius=length(vSolarGlow);float cutoff=1.-smoothstep(2.05,${HALO_RADIUS/SOLAR_RADIUS},radius);float halo=(.58*exp(-radius*radius*.72)+.18*exp(-radius*radius*1.9))*cutoff*uStrength;if(halo<.0002)discard;gl_FragColor=vec4(vec3(1.35,.66,.20),halo);
  #include <colorspace_fragment>
  }`,transparent:true,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,side:THREE.DoubleSide,
 });
 const glow=new THREE.Mesh(glowGeometry,glowMaterial);glow.name='Soft solar aureole without an edge ring';glow.renderOrder=2;glow.frustumCulled=false;sun.add(glow);
 const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),sunRaw=new THREE.Vector3(),moonRaw=new THREE.Vector3(),viewPoint=new THREE.Vector3(),skyDirection=new THREE.Vector3();
 let dragging=false,lastHour=15,dragHour=15,dragX=0,dragY=0,disposed=false;
 const stats={orbitRadius:ORBIT_RADIUS,orbitCentre:ORBIT_CENTRE.toArray(),orbitPlane:'world XY',referenceDepth:REFERENCE_DEPTH,occluderCount:0,hudPositionAvoidance:false,disposed:false};
 function setRay(event){const r=canvas.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);camera.updateMatrixWorld();sun.updateMatrixWorld();moon.updateMatrixWorld();ray.setFromCamera(pointer,camera);return true;}
 function placeInSky(body,raw){
  viewPoint.copy(raw).applyMatrix4(camera.matrixWorldInverse);const rawDepth=-viewPoint.z;
  body.position.copy(raw);body.scale.setScalar(1);
  if(rawDepth<=camera.near)return false;
  // Reposition only ALONG the authored sightline, never across the image.
  // Size/depth share one ratio, so orbiting and near inspection keep the same
  // accepted angular radius and normal foreground depth tests still apply.
  skyDirection.copy(raw).sub(camera.position).divideScalar(rawDepth);
  let skyDepth=Math.min(60,camera.far*.8);
  const supportRadius=body===sun?HALO_RADIUS:SOLAR_RADIUS,denominator=supportRadius/REFERENCE_DEPTH-skyDirection.y;
  if(denominator>0){const floorLimit=(camera.position.y-(-1.525)-.06)/denominator;skyDepth=Math.min(skyDepth,Math.max(rawDepth,floorLimit));}
  body.position.copy(camera.position).addScaledVector(skyDirection,skyDepth);body.scale.setScalar(skyDepth/REFERENCE_DEPTH);return true;
 }
 function pointerDown(event){if(disposed||event.button!==0||!setRay(event))return false;const hit=ray.intersectObjects([sun,moon].filter(body=>body.visible),false);if(!hit.length)return false;dragHour=lastHour;dragX=event.clientX;dragY=event.clientY;dragging=true;return true;}
 function pointerMove(event){if(disposed||!dragging)return false;const r=canvas.getBoundingClientRect();if(r.width<=0)return false;const movement=(event.clientX-dragX)+(event.clientY-dragY)*.35;onHour(wrapHour(dragHour-movement/r.width*24));return true;}
 return{sun,moon,stats,setOccluders(boxes){if(!disposed)stats.occluderCount=boxes?.length||0;},get dragging(){return dragging;},pointerDown,pointerMove,pointerUp(){dragging=false;},update(state){if(disposed)return;lastHour=Number.isFinite(state.hour)?wrapHour(state.hour):lastHour;const c=Math.cos((lastHour-12)/12*Math.PI);camera.updateMatrixWorld();sampleDaylightOrbit(lastHour,'sun',sunRaw);sampleDaylightOrbit(lastHour,'moon',moonRaw);const sunInFront=placeInSky(sun,sunRaw),moonInFront=placeInSky(moon,moonRaw);sun.visible=state.sunEnabled!==false&&c>-.08&&sunInFront;moon.visible=state.sunEnabled!==false&&c<.12&&moonInFront;glowMaterial.uniforms.uStrength.value=Math.max(.22,state.daylight??1);},dispose(){if(disposed)return;disposed=true;dragging=false;scene.remove(group);geometry.dispose();sunMaterial.dispose();moonMaterial.dispose();glowGeometry.dispose();glowMaterial.dispose();stats.disposed=true;}};
}
