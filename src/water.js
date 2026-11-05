import * as THREE from 'three';
import {createWaterTouch} from './water-touch.js';
import {createPondCaustics} from './pond-caustics.js';
import {createRunningWater} from './running-water.js';
import {createPondLevel} from './pond-level.js';
import {INLET_GLSL,installInletUniforms,lakeSurfaceHeight,LAKE_OPTICAL_NORMAL_GLSL} from './water-surface.js';

export function createWaterCaptureSchedule({colorHz=15,reflectionHz=8}={}){
 let lastColor=-Infinity,lastReflection=-Infinity,lastCamera='',lastSceneTime=NaN,lastAppearance='',force=true,colorDirty=true,reflectionDirty=true;
 const stats={color:0,reflection:0,skipped:0,colorHz,reflectionHz};
 function request(now,cameraKey,sceneTime,appearance='',flash=0){
  const cameraChanged=cameraKey!==lastCamera,rewind=Number.isFinite(lastSceneTime)&&sceneTime<lastSceneTime,jump=Number.isFinite(lastSceneTime)&&Math.abs(sceneTime-lastSceneTime)>.5;
  const changed=sceneTime!==lastSceneTime||appearance!==lastAppearance||cameraChanged;colorDirty||=changed;reflectionDirty||=changed;
  const color=force||cameraChanged||rewind||jump||flash>.04||colorDirty&&now-lastColor>=1/stats.colorHz-1e-6;
  const reflection=force||rewind||jump||flash>.04||reflectionDirty&&now-lastReflection>=1/stats.reflectionHz-1e-6;
  if(color){lastColor=now;colorDirty=false;stats.color++;}if(reflection){lastReflection=now;reflectionDirty=false;stats.reflection++;}if(!color&&!reflection)stats.skipped++;
  lastCamera=cameraKey;lastSceneTime=sceneTime;lastAppearance=appearance;force=false;return{color,reflection,cameraChanged};
 }
 return {stats,request,invalidate(){force=true;},setRates(color,reflection){
  if (stats.colorHz === color && stats.reflectionHz === reflection) return;
  stats.colorHz=color;stats.reflectionHz=reflection;force=true;
 }};
}

// Independently authored bounded optics: scene/depth refraction, a mirrored
// camera, matched analytic surface normals, local rain and an exposed cutaway.
export function createWater(scene, lake, {renderer,camera,terrain,field,bedHeightAt,receivers=[]}={}) {
 const group=new THREE.Group();group.name='Watershed';scene.add(group);
 const baseLevel=lake.level,level=createPondLevel({base:baseLevel,spill:baseLevel+.09}),schedule=createWaterCaptureSchedule();lake.currentLevel=baseLevel;lake.spillLevel=level.stats.spill;let preparedTime=NaN,lastState={},cssWidth=960,cssHeight=600,closeCapture=false,captureScale=1;
 const colorRT=new THREE.WebGLRenderTarget(960,600,{type:THREE.HalfFloatType});colorRT.depthTexture=new THREE.DepthTexture(960,600,THREE.UnsignedIntType);
 const reflectionRT=new THREE.WebGLRenderTarget(640,400,{type:THREE.HalfFloatType}),reflectionCamera=new THREE.PerspectiveCamera();
 reflectionRT.depthTexture=new THREE.DepthTexture(640,400,THREE.UnsignedIntType);
 const reflectMatrix=new THREE.Matrix4(),bias=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),direction=new THREE.Vector3(),target=new THREE.Vector3();let captureFrame=0;
 const uniforms={uTime:{value:0},uRain:{value:0},uWind:{value:new THREE.Vector2()},uDay:{value:1},uCamera:{value:new THREE.Vector3()},uSun:{value:new THREE.Vector3(-.6,1,.4).normalize()}};
 Object.assign(uniforms,{uEnvironment:{value:scene.environment},uEnvironmentMaxLod:{value:Math.max(0,(scene.environment?.mipmaps?.length??1)-1)},uEnvironmentIntensity:{value:scene.environmentIntensity??.13},uReflectionDepth:{value:reflectionRT.depthTexture},uColor:{value:colorRT.texture},uDepth:{value:colorRT.depthTexture},uReflection:{value:reflectionRT.texture},uReflectionMatrix:{value:reflectMatrix},uResolution:{value:new THREE.Vector2()},uNear:{value:.1},uFar:{value:90},uGround:{value:field.texture},uIce:{value:0},uOpticsDebug:{value:0},uSunStrength:{value:1}});
 installInletUniforms(uniforms,lake.level);
 const caustics=createPondCaustics({renderer,terrain,lake,uniforms,bedHeightAt,receivers});
 const vertices=[],bedDepths=[],bedHeights=[],indices=[],N=88;
 // End the free surface on the exact exposed chord. Truncating a symmetric
 // grid left an uncovered brown strip between its last row and the cut wall.
 const gridNear=Math.min(lake.z+lake.rz*1.12,lake.front||4.25),gridFar=lake.z-lake.rz*1.12;
 const gridZ=j=>THREE.MathUtils.lerp(gridFar,gridNear,j/N);
 for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
  const x=lake.x+(i/N*2-1)*lake.rx*1.12,z=gridZ(j);
  const bed=terrain.height(x,z);vertices.push(x,lake.level,z);bedDepths.push(Math.max(0,lake.level-bed));bedHeights.push(bed);
 }
 const inside=(i,j)=>{const x=lake.x+(i/N*2-1)*lake.rx*1.12,z=gridZ(j);return terrain.height(x,z)<level.stats.spill+.024&&z<=(lake.front||4.25);};
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){
  const a=j*(N+1)+i,b=a+1,c=a+N+1,d=c+1;
  if(inside(i,j)&&inside(i+1,j)&&inside(i,j+1))indices.push(a,c,b);
  if(inside(i+1,j)&&inside(i+1,j+1)&&inside(i,j+1))indices.push(b,c,d);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('bedDepth',new THREE.Float32BufferAttribute(bedDepths,1));geometry.setAttribute('bedHeight',new THREE.Float32BufferAttribute(bedHeights,1));geometry.setIndex(indices);geometry.computeVertexNormals();
 const vertex=`uniform float uTime;uniform vec2 uWind;attribute float bedDepth,bedHeight;varying vec3 vWorld,vNormalW;varying float vBedDepth;${INLET_GLSL}
 void main(){vec3 p=position;float waterDepth=max(0.,uLakeLevel-bedHeight),e=.008;float h=lakeWave(p.xz,waterDepth,uTime,uWind);float dx=(lakeWave(p.xz+vec2(e,0),waterDepth,uTime,uWind)-lakeWave(p.xz-vec2(e,0),waterDepth,uTime,uWind))/(2.*e);float dz=(lakeWave(p.xz+vec2(0,e),waterDepth,uTime,uWind)-lakeWave(p.xz-vec2(0,e),waterDepth,uTime,uWind))/(2.*e);p.y=uLakeLevel+h;vNormalW=normalize(vec3(-dx,1.,-dz));vBedDepth=waterDepth;vWorld=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`;
 const fragment=`uniform float uTime,uRain,uDay,uNear,uFar,uIce,uOpticsDebug,uSunStrength,uEnvironmentIntensity,uEnvironmentMaxLod;uniform vec2 uWind,uResolution;uniform vec3 uCamera,uSun;uniform sampler2D uColor,uDepth,uReflection,uGround,uReflectionDepth;uniform samplerCube uEnvironment;uniform mat4 uReflectionMatrix;varying vec3 vWorld,vNormalW;varying float vBedDepth;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
 ${INLET_GLSL}
 ${LAKE_OPTICAL_NORMAL_GLSL}
 uniform sampler2D uPondCaustic;uniform vec2 uPondCausticMin,uPondCausticSpan;
 float inletDetail(float tau,float across,float bank,float time){
  float a=fract(time/1.8),b=fract(time/1.8+.5),wa=1.-abs(a*2.-1.),wb=1.-abs(b*2.-1.);
  return noise(vec2((tau-a*1.8*bank)*9.,across))*wa+noise(vec2((tau-b*1.8*bank)*9.,across))*wb;
 }
 float depthZ(float d){return (uNear*uFar)/((uFar-uNear)*d-uFar);}
 vec2 fineBand(vec2 p,vec2 direction,float frequency,float speed,float amplitude){
  float phase=dot(p,direction)*frequency+uTime*speed;
  float filtered=1.-smoothstep(.35,1.5,fwidth(phase));
  return direction*cos(phase)*amplitude*filtered;
 }
 void main(){
  if(vBedDepth<.001)discard;vec3 N=normalize(vNormalW),V=normalize(uCamera-vWorld);vec2 p=vWorld.xz;
  float shore=smoothstep(.015,.19,vBedDepth),wind=min(1.,length(uWind)*.35);
  // Small, filtered capillary bands break the reflection without distorting
  // the entire bed into broad repeating swells.
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  N=lakeOpticalNormal(p,vBedDepth,uTime,uWind,footprint);
  vec2 q=p*3.,id=floor(q);float d=length(fract(q)-.5);
  float rain=texture2D(uGround,(p-vec2(-6.,-5.3))/vec2(12.,9.6)).b;
  float r=sin(d*48.-uTime*9.+hash(id)*18.)*exp(-d*5.)*rain;
  N=normalize(N+vec3(r*.045,0.,r*.034)*shore);
  vec4 inlet=inletCoords(p);float inletBank=.42+.58*(1.-clamp(inlet.y*inlet.y/max(.01,inlet.z*inlet.z),0.,1.));float tau=uMouthTravel+inletTravel(inlet.x);
  vec2 inletQ=vec2(tau*9.,inlet.y*28.);float detailAA=1.-smoothstep(.6,1.6,length(fwidth(inletQ)));
  float flowDetail=inletDetail(tau,inlet.y*28.,inletBank,uTime),gradS=inletDetail(tau+.035/9.,inlet.y*28.,inletBank,uTime)-flowDetail,gradC=inletDetail(tau,inlet.y*28.+.035,inletBank,uTime)-flowDetail;
  vec2 inletSlope=(uMouthDirection*gradS+vec2(-uMouthDirection.y,uMouthDirection.x)*gradC)*5.5*inlet.w*detailAA;
  N=normalize(N+vec3(inletSlope.x,0.,inletSlope.y));
  float fres=.021+.979*pow(1.-max(0.,dot(N,V)),5.);
  vec2 screen=gl_FragCoord.xy/uResolution;
  // Near shore both displacement and refraction taper to their actual bed.
  vec2 warp=(viewMatrix*vec4(N,0.)).xy*.0055*shore;
  vec2 uv=clamp(screen+warp,.002,.998);
  float ownDepth=-(viewMatrix*vec4(vWorld,1.)).z;
  float depth=-depthZ(texture2D(uDepth,uv).r)-ownDepth;
  float rejected=step(depth,0.);
  if(depth<0.){uv=screen;depth=-depthZ(texture2D(uDepth,uv).r)-ownDepth;}
  float bedPath=vBedDepth/max(.25,V.y);
  depth=clamp(min(depth,bedPath+.05),.008,2.5);
  float clarity=.89+.11*noise(p*13.4);
  vec3 transmit=exp(-vec3(1.95,.78,.62)*depth*clarity);
  vec3 scatter=mix(vec3(.055,.20,.16),vec3(.015,.17,.19),smoothstep(.03,.58,vBedDepth));
  vec3 body=texture2D(uColor,uv).rgb*transmit+scatter*(1.-transmit)*(.20+.80*uDay);
  body*=vec3(.96,1.00,1.015);
  vec4 mirror=uReflectionMatrix*vec4(vWorld,1.);
  vec2 mirrorUv=clamp(mirror.xy/mirror.w+N.xz*.006,.002,.998);
  vec3 reflection=texture2D(uReflection,mirrorUv).rgb;
  // The scene backdrop is dark, but its existing PMREM contains the actual
  // studio illumination. Reflect that light only where planar depth is sky;
  // foreground tree/rock reflections retain their real captured occlusion.
  float skyVisible=step(.99999,texture2D(uReflectionDepth,mirrorUv).r);
  // r187 PMREM uses a cube texture with perceptual roughness mapped to LOD.
  // Keep the original water roughness and sky-only contribution.
  float environmentLod=uEnvironmentMaxLod*.065*(2.-.065);
  vec3 environmentLight=textureLod(uEnvironment,reflect(-V,N),environmentLod).rgb*uEnvironmentIntensity;
  reflection+=environmentLight*skyVisible;
  float nh=max(0.,dot(normalize(uSun+V),N)),a2=.065,den=nh*nh*(a2-1.)+1.;
  float microfacet=a2/(3.14159265*den*den),crest=clamp(length(N.xz)*5.,0.,1.);
  float spec=clamp(microfacet*.035+pow(nh,180.)*.9,0.,1.8)*(.45+crest*.7);
  float nearShore=1.-smoothstep(.015,.15,vBedDepth);
  float edgeGlint=nearShore*(.25+.75*noise(p*38.+uTime*.18));
  vec3 color=mix(body,reflection,min(.85,fres));
  color+=spec*vec3(.95,.92,.81)*uDay*uSunStrength+edgeGlint*vec3(.022,.028,.021)*uDay*uSunStrength;
  float inletFoam=smoothstep(.64,.86,flowDetail)*inlet.w*.19*(1.-smoothstep(.0,1.8,inlet.x));
  color=mix(color,vec3(.58,.67,.64)*(.28+.72*uDay),inletFoam);
  float inletGlint=pow(max(0.,dot(normalize(uSun+V),N)),55.)*inlet.w*.60*uDay*uSunStrength;
  color+=inletGlint*vec3(.72,.73,.65);
  
  color=mix(color,vec3(.45,.62,.60)*(.22+.78*uDay),uIce*.85*(1.-smoothstep(.12,.65,vBedDepth)));
  // Actual pass diagnostics, default zero. These reveal the existing
  // screen-space limits; they do not disable optics in the final image.
  if(uOpticsDebug>.5&&uOpticsDebug<1.5)color=texture2D(uColor,uv).rgb;
  if(uOpticsDebug>1.5&&uOpticsDebug<2.5)color=reflection;
  if(uOpticsDebug>2.5&&uOpticsDebug<3.5)color=vec3(clamp(depth/2.5,0.,1.));
  if(uOpticsDebug>3.5&&uOpticsDebug<4.5)color=N*.5+.5;
  if(uOpticsDebug>4.5)color=mix(vec3(.08,.55,.12),vec3(.8,.08,.04),rejected);
  if(uOpticsDebug>5.5&&uOpticsDebug<6.5)color=vec3(texture2D(uPondCaustic,(p-uPondCausticMin)/uPondCausticSpan).r*.32);
  if(uOpticsDebug>6.5)color=transmit;
  gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`;
 Object.assign(uniforms,{uPondCaustic:{value:caustics.texture},uPondCausticMin:{value:caustics.diagnostics.min},uPondCausticSpan:{value:caustics.diagnostics.span}});
 const mat=new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,side:THREE.DoubleSide});
 const surface=new THREE.Mesh(geometry,mat);surface.renderOrder=7;group.add(surface);
 // Closed front section: horizontal cut through the water bowl.
 const vp=[],vi=[],waterTop=[],waterBed=[],pts=[],cut=lake.front||4.25;
 const zc=(cut-lake.z)/lake.rz,ac=Math.asin(zc),segments=128;
 for(let i=0;i<=segments;i++){
  const a=Math.PI-ac+(Math.PI+2*ac)*i/segments;
  pts.push(new THREE.Vector2(lake.x+Math.cos(a)*lake.rx,lake.z+Math.sin(a)*lake.rz));
 }
 for(let i=0;i<pts.length;i++){
  const p=pts[i],isFront=i===pts.length-1;
  vp.push(p.x,lake.level,p.y,p.x,-.68,p.y);waterTop.push(1,0);waterBed.push(terrain.height(p.x,p.y),terrain.height(p.x,p.y));
  if(i<pts.length-1){let a=i*2;vi.push(a,a+1,a+2,a+1,a+3,a+2);}
 }
 const left=pts[pts.length-1],right=pts[0],base=vp.length/3;
 // The exposed chord has a curved bed, rather than a rectangular cyan block.
 for(let i=0;i<=64;i++){
  const s=i/64,x=THREE.MathUtils.lerp(left.x,right.x,s),bottom=terrain.height(x,cut);
  vp.push(x,lake.level,cut,x,bottom,cut);waterTop.push(1,0);waterBed.push(bottom,bottom);
  if(i<64){const a=base+i*2;vi.push(a,a+1,a+2,a+1,a+3,a+2);}
 }
 const vg=new THREE.BufferGeometry();vg.setAttribute('position',new THREE.Float32BufferAttribute(vp,3));vg.setAttribute('aWaterTop',new THREE.Float32BufferAttribute(waterTop,1));vg.setAttribute('aWaterBed',new THREE.Float32BufferAttribute(waterBed,1));vg.setIndex(vi);vg.computeVertexNormals();
 const vm=new THREE.ShaderMaterial({uniforms,vertexShader:`uniform float uTime;uniform vec2 uWind;attribute float aWaterTop,aWaterBed;varying vec3 vP;${INLET_GLSL}void main(){vec3 p=position;if(aWaterTop>.5)p.y=uLakeLevel+lakeWave(p.xz,max(.001,uLakeLevel-aWaterBed),uTime,uWind);vP=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.);}`,fragmentShader:`uniform float uTime,uDay,uLakeLevel;varying vec3 vP;void main(){float depth=clamp((uLakeLevel-vP.y)*1.5,0.,1.);float c=pow(max(0.,sin(vP.x*21.+sin(vP.y*19.+uTime)*2.)*sin(vP.y*28.-uTime*.6)),7.);vec3 col=mix(vec3(.014,.28,.27),vec3(.005,.08,.10),depth);col+=c*vec3(.04,.15,.11);col*=.22+.78*uDay;gl_FragColor=vec4(col,mix(.79,.91,depth));
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`,transparent:true,side:THREE.DoubleSide,depthWrite:false});
 const volume=new THREE.Mesh(vg,vm);volume.renderOrder=6.8;group.add(volume);
 let captureExclusions=[];
 const running=createRunningWater(terrain,field,uniforms);group.add(running.group);
 const surfaceSamplerUniforms={...uniforms,uWind:{value:uniforms.uWind.value}};
 function surfaceHeightAtBed(x,z,bed,time,wind){surfaceSamplerUniforms.uWind.value=wind;return lakeSurfaceHeight(x,z,Math.max(0,uniforms.uLakeLevel.value-bed),surfaceSamplerUniforms,time);}
 function sampleSurfaceHeight(x,z,time=uniforms.uTime.value,wind=uniforms.uWind.value){return surfaceHeightAtBed(x,z,terrain.height(x,z),time,wind);}
 function compileSurfaceSampler(x,z){
  const fallback=(time=uniforms.uTime.value,wind=uniforms.uWind.value)=>sampleSurfaceHeight(x,z,time,wind),bounds=terrain.bounds;
  if(!Number.isFinite(x)||!Number.isFinite(z)||!bounds||x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ)return fallback;
  const heightOwner=terrain.height,bed=terrain.height(x,z);if(!Number.isFinite(bed))return fallback;
  // Terrain elevation is fixed for this scene. Only the bathymetric query is
  // cached: live level, time, wind and inlet uniforms retain their old owners.
  // reset mutates these uniform values, so existing samplers remain valid.
  return(time=uniforms.uTime.value,wind=uniforms.uWind.value)=>terrain.height===heightOwner?surfaceHeightAtBed(x,z,bed,time,wind):fallback(time,wind);
 }
 const touch=createWaterTouch({surfaceAt:touchSurface});group.add(touch.group);
 const pickRay=new THREE.Raycaster(),pickPlane=new THREE.Plane(new THREE.Vector3(0,1,0));let inputOccluders=[];
 function touchSurface(x,z,time=uniforms.uTime.value){const bed=terrain.height(x,z),flowY=running.renderedHeight(x,z,time,uniforms.uWind.value),lakeY=lakeSurfaceHeight(x,z,Math.max(0,uniforms.uLakeLevel.value-bed),uniforms,time);if(flowY!==null&&flowY>bed+.002)return{water:true,y:Math.max(flowY,bed<uniforms.uLakeLevel.value-.01?lakeY:-99)};if(bed<uniforms.uLakeLevel.value-.012&&z<=(lake.front||4.25))return{water:true,y:lakeY};return{water:false,y:bed};}
 function isVisibleHit(hit){let o=hit.object;if(o.material?.visible===false||o.material?.opacity===0)return false;while(o){if(!o.visible)return false;o=o.parent;}return true;}
 function pickSurface(ray){
  pickRay.ray.copy(ray);pickRay.far=Infinity;group.updateMatrixWorld(true);const candidates=[];
  // The lake grid is statically authored at the base datum. Intersect the
  // current visible datum, then refine the shared wave height instead of
  // raycasting the old plane after rainfall has flooded a shallow bank.
  const point=new THREE.Vector3();pickPlane.constant=-uniforms.uLakeLevel.value;
  if(ray.intersectPlane(pickPlane,point)){
   for(let i=0;i<3;i++){const s=touchSurface(point.x,point.z);pickPlane.constant=-s.y;if(!ray.intersectPlane(pickPlane,point))break;}
   const s=touchSurface(point.x,point.z);if(s.water&&terrain.height(point.x,point.z)<uniforms.uLakeLevel.value-.012&&Math.abs(point.x-lake.x)<=lake.rx*1.12&&Math.abs(point.z-lake.z)<=lake.rz*1.12&&point.z<=(lake.front||4.25))candidates.push(point.clone());
  }
  for(const h of pickRay.intersectObject(running.stream,false)){const s=touchSurface(h.point.x,h.point.z);if(s.water){const p=h.point.clone();p.y=s.y;candidates.push(p);}}
  candidates.sort((a,b)=>a.distanceToSquared(ray.origin)-b.distanceToSquared(ray.origin));
  for(const p of candidates){const distance=p.distanceTo(ray.origin);pickRay.far=Math.max(0,distance-.028);if(!pickRay.intersectObjects([terrain.group,...inputOccluders],true).some(isVisibleHit)){pickRay.far=Infinity;return p;}}
  pickRay.far=Infinity;return null;
 }

 const stats={caustics:caustics.stats,optics:{extinctionPerMetre:[1.95,.78,.62],ior:1.333,caustics:'Refracted photon area on actual bed and direct-lit receivers'},touch:touch.stats,method:'bounded clear lake optics with shared gentle waves, capped rainfall level and scheduled captures',surfaceTriangles:indices.length/3,running:running.stats,level:level.stats,captures:schedule.stats,captureResolution:{color:[960,600],reflection:[640,400]}};
 function prepareFrame(dt=0,state={}){
  const time=Number.isFinite(state.time)?state.time:0;if(time!==preparedTime){level.update(dt,state);preparedTime=time;}
  lake.currentLevel=level.stats.current;uniforms.uLakeLevel.value=level.stats.current;state.waterLevel=level.stats.current;state.waterRise=level.stats.rise;state.waterSpillLevel=level.stats.spill;
 }
 function setCloudOcclusion(binding){
  for(const [material,point]of [[mat,'vWorld'],[vm,'vP']]){material.userData.cloudBaseFragment??=material.fragmentShader;
   if(binding?.glsl){Object.assign(material.uniforms,binding.uniforms);material.fragmentShader=binding.glsl+'\n'+material.userData.cloudBaseFragment.replace('#include <tonemapping_fragment>','gl_FragColor.rgb=weatherCloudComposite('+point+',gl_FragColor.rgb);\n#include <tonemapping_fragment>');}
   else material.fragmentShader=material.userData.cloudBaseFragment;material.transparent=true;material.depthWrite=false;material.needsUpdate=true;
  }running.setCloudOcclusion?.(binding);touch.setCloudOcclusion(binding);stats.cloudOcclusion=!!binding;
 }
 function reset(){caustics.reset();touch.reset();level.reset();preparedTime=NaN;lake.currentLevel=baseLevel;uniforms.uLakeLevel.value=baseLevel;uniforms.uOpticsDebug.value=0;schedule.invalidate();}
 function captureSize(){const ratio=renderer.getPixelRatio?.()??1,scale=closeCapture?.95:.75,w=Math.max(1,Math.min(1800,Math.round(cssWidth*ratio*scale*captureScale))),h=Math.max(1,Math.round(w*cssHeight/cssWidth)),rw=Math.max(1,Math.min(900,Math.round(cssWidth*ratio*.4*captureScale))),rh=Math.max(1,Math.round(rw*cssHeight/cssWidth));let changed=false;if(colorRT.width!==w||colorRT.height!==h){colorRT.setSize(w,h);changed=true;}if(reflectionRT.width!==rw||reflectionRT.height!==rh){reflectionRT.setSize(rw,rh);changed=true;}if(changed)schedule.invalidate();stats.captureResolution.color=[colorRT.width,colorRT.height];stats.captureResolution.reflection=[reflectionRT.width,reflectionRT.height];}
 return {group,level,caustics,touch,pickSurface,setInputOccluders(objects=[]){inputOccluders=objects.filter(Boolean);},touchSurface,emitTouch(point,strength=1,time=uniforms.uTime.value){return touch.emit(point,time,strength);},prepareFrame,reset,setCloudOcclusion,getSceneDepth(){return colorRT.depthTexture;},
 invalidateCaptures(){schedule.invalidate();},
 setRenderBudget({colorHz,reflectionHz,waterScale}){
  schedule.setRates(colorHz,reflectionHz);
  if(captureScale!==waterScale){captureScale=waterScale;captureSize();}
 },setCaptureExclusions(objects=[]){captureExclusions=[...new Set(objects.filter(Boolean))];schedule.invalidate();},flow:running.flow,running,stats,
 sampleFlowSurface(x,z,time=uniforms.uTime.value,wind=uniforms.uWind.value){return running.renderedHeight(x,z,time,wind);},
 setFlowDebug(mode=0){running.setDebug(mode);},
 setOpticsDebug(mode=0){uniforms.uOpticsDebug.value=THREE.MathUtils.clamp(Number(mode)||0,0,7);schedule.invalidate();},
 get opticsDiagnostics(){return {mode:uniforms.uOpticsDebug.value,passes:{final:0,capturedRefraction:1,planarReflection:2,boundedPathLength:3,surfaceNormal:4,foregroundDepthRejection:5,refractedCausticEnergy:6,waterTransmittance:7},colourOwner:'linear opaque scene capture excluding transparent weather; one final scene output conversion',pathLength:'view-depth bounded by the shared dynamic lake datum and actual local bed; heuristic refraction, not ray tracing',levelOwner:'pond-level capped rainfall reservoir; terrain.lake.level remains static base, currentLevel is shared dynamic datum',debugScope:'actual production captures, normals and shared level'};},
 sampleSurfaceHeight,compileSurfaceSampler,
 beforeRender(){
  caustics.beforeRender();camera.updateMatrixWorld();const cameraKey=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements].join(','),appearance=[lastState.hour,lastState.season,lastState.rain,lastState.fog,uniforms.uLakeLevel.value].join(','),now=performance.now()*.001;
  const plan=schedule.request(now,cameraKey,uniforms.uTime.value,appearance,lastState.lightning??0);if(!plan.color&&!plan.reflection)return;
  const old=renderer.getRenderTarget(),clipping=renderer.clippingPlanes,shadows=renderer.shadowMap.autoUpdate,shadowNeeds=renderer.shadowMap.needsUpdate;
  const touchVisible=touch.group.visible;touch.group.visible=false;const visible=[surface.visible,volume.visible,running.group.visible],excludedVisibility=captureExclusions.map(o=>o.visible),lightShadowNeeds=[];
  scene.traverse(o=>{if(o.isLight&&o.shadow){lightShadowNeeds.push([o.shadow,o.shadow.needsUpdate]);o.shadow.needsUpdate=false;}});
  captureExclusions.forEach(o=>o.visible=false);surface.visible=volume.visible=running.group.visible=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
  try{
   if(plan.color){renderer.setRenderTarget(colorRT);renderer.clear();renderer.render(scene,camera);}
   if(plan.reflection){
    running.group.visible=visible[2];uniforms.uFlowCapture.value=1;reflectionCamera.copy(camera);camera.getWorldDirection(direction);target.copy(camera.position).add(direction);reflectionCamera.position.y=2*uniforms.uLakeLevel.value-camera.position.y;target.y=2*uniforms.uLakeLevel.value-target.y;reflectionCamera.up.set(0,-1,0);reflectionCamera.lookAt(target);reflectionCamera.updateMatrixWorld();reflectMatrix.copy(bias).multiply(reflectionCamera.projectionMatrix).multiply(reflectionCamera.matrixWorldInverse);renderer.clippingPlanes=[new THREE.Plane(new THREE.Vector3(0,1,0),-uniforms.uLakeLevel.value+.02)];renderer.setRenderTarget(reflectionRT);renderer.clear();renderer.render(scene,reflectionCamera);
   }
  }finally{touch.group.visible=touchVisible;captureExclusions.forEach((o,i)=>o.visible=excludedVisibility[i]);lightShadowNeeds.forEach(([shadow,value])=>shadow.needsUpdate=value);renderer.setRenderTarget(old);renderer.clippingPlanes=clipping;renderer.shadowMap.autoUpdate=shadows;renderer.shadowMap.needsUpdate=shadowNeeds;surface.visible=visible[0];volume.visible=visible[1];running.group.visible=visible[2];uniforms.uFlowCapture.value=0;}
 },
 resize(w,h){cssWidth=w;cssHeight=h;captureSize();schedule.invalidate();},
 update(dt,state,camera){uniforms.uEnvironmentIntensity.value=scene.environmentIntensity??.13;prepareFrame(dt,state);lastState=state;const near=Math.hypot(camera.position.x-lake.x,camera.position.y-level.stats.current,camera.position.z-lake.z)<12;if(near!==closeCapture){closeCapture=near;captureSize();}renderer.getDrawingBufferSize(uniforms.uResolution.value);uniforms.uNear.value=camera.near;uniforms.uFar.value=camera.far;uniforms.uIce.value=THREE.MathUtils.smoothstep(-state.temperature,0,5)*.65;uniforms.uTime.value=state.time;uniforms.uRain.value=state.effectiveRain??state.rain;uniforms.uWind.value.copy(state.wind).multiplyScalar(state.windStrength);uniforms.uSunStrength.value=THREE.MathUtils.clamp((state.sunIntensity??3)*.32,0,1.5);if(state.sunDirection)uniforms.uSun.value.copy(state.sunDirection);uniforms.uDay.value=state.daylight;uniforms.uCamera.value.copy(camera.position);running.update(dt,state,camera);caustics.prepare(state);touch.update(state.time,state,uniforms.uResolution.value.y);},
 dispose(){caustics.dispose();touch.dispose();running.dispose();for(const o of [surface,volume])o.geometry.dispose();mat.dispose();vm.dispose();colorRT.dispose();reflectionRT.dispose();scene.remove(group);}};
}
