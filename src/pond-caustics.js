import * as THREE from 'three';
import {INLET_GLSL,LAKE_OPTICAL_NORMAL_GLSL} from './water-surface.js';

// Forward refracted-light footprint on this finite bowl. The mesh transports
// photon area from the shared optical normal to a sampled sediment/stone bed;
// receivers use the resulting energy map before the water's view attenuation.
// This is a band-limited, single-interface approximation, not a path tracer.
export function createPondCaustics({renderer,terrain,lake,uniforms,bedHeightAt,receivers=[]}={}){
 const min=new THREE.Vector2(lake.x-lake.rx*1.16,lake.z-lake.rz*1.16),span=new THREE.Vector2(lake.rx*2.32,lake.rz*2.32),N=224,resolution=512;
 const heightSize=192,bed=new Float32Array(heightSize*heightSize*4);
 for(let j=0;j<heightSize;j++)for(let i=0;i<heightSize;i++){const x=min.x+(i+.5)/heightSize*span.x,z=min.y+(j+.5)/heightSize*span.y,k=(j*heightSize+i)*4;bed[k]=Math.max(terrain.height(x,z),bedHeightAt?.(x,z)??-100);bed[k+3]=1;}
 const bedTexture=new THREE.DataTexture(bed,heightSize,heightSize,THREE.RGBAFormat,THREE.FloatType);bedTexture.minFilter=bedTexture.magFilter=THREE.LinearFilter;bedTexture.needsUpdate=true;
 const target=new THREE.WebGLRenderTarget(resolution,resolution,{type:THREE.HalfFloatType,depthBuffer:false,stencilBuffer:false});target.texture.colorSpace=THREE.NoColorSpace;target.texture.generateMipmaps=true;target.texture.minFilter=THREE.LinearMipmapLinearFilter;
 const local={...uniforms,uCausticBed:{value:bedTexture},uCausticTexel:{value:new THREE.Vector2(1/resolution,1/resolution)},uCausticMin:{value:min},uCausticSpan:{value:span},uCausticPitch:{value:Math.max(span.x,span.y)/N},uCausticFront:{value:lake.front||4.25},uCausticSolar:{value:0},uCausticMap:{value:target.texture},uCausticGain:{value:.65},uCausticDebug:{value:0}};
 const geometry=new THREE.PlaneGeometry(1,1,N,N);geometry.rotateX(-Math.PI/2);const attr=geometry.attributes.position;
 for(let i=0;i<attr.count;i++){attr.setXYZ(i,min.x+(attr.getX(i)+.5)*span.x,0,min.y+(attr.getZ(i)+.5)*span.y);}attr.needsUpdate=true;
 const material=new THREE.ShaderMaterial({uniforms:local,depthTest:false,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false,
  vertexShader:`uniform float uTime,uCausticPitch,uCausticFront;uniform vec2 uWind,uCausticMin,uCausticSpan;uniform vec3 uSun;uniform sampler2D uCausticBed;varying vec2 vSource,vLanding;varying float vWet;
  ${INLET_GLSL}
  ${LAKE_OPTICAL_NORMAL_GLSL}
  float bedAt(vec2 p){return texture2D(uCausticBed,clamp((p-uCausticMin)/uCausticSpan,vec2(.001),vec2(.999))).r;}
  void main(){vec2 p=position.xz;float bed=bedAt(p),depth=uLakeLevel-bed,h=uLakeLevel+lakeWave(p,depth,uTime,uWind);vec3 source=vec3(p.x,h,p.y);
   vec3 normal=lakeOpticalNormal(p,depth,uTime,uWind,uCausticPitch*.42),ray=refract(-normalize(uSun),normal,1./1.333);
   vec3 landing=source;float receiver=bed;
   for(int i=0;i<4;i++){float distance=clamp((receiver-h)/min(-.1,ray.y),0.,3.);landing=source+ray*distance;receiver=bedAt(landing.xz);}
   vSource=p;vLanding=landing.xz;vWet=smoothstep(.012,.08,depth)*(1.-smoothstep(uCausticFront-.07,uCausticFront+.01,p.y));
   vec2 uv=(landing.xz-uCausticMin)/uCausticSpan;gl_Position=vec4(uv*2.-1.,0.,1.);
  }`,
  fragmentShader:`varying vec2 vSource,vLanding;varying float vWet;uniform float uLakeLevel;uniform sampler2D uCausticBed;uniform vec2 uCausticMin,uCausticSpan;
  void main(){float bed=texture2D(uCausticBed,clamp((vLanding-uCausticMin)/uCausticSpan,vec2(.001),vec2(.999))).r;if(vWet<.002||bed>uLakeLevel-.008)discard;
   vec2 a=dFdx(vSource),b=dFdy(vSource),c=dFdx(vLanding),d=dFdy(vLanding);float sourceArea=abs(a.x*b.y-a.y*b.x),landingArea=abs(c.x*d.y-c.y*d.x);
   float energy=clamp(sourceArea/max(landingArea,1.e-9),0.,8.)*vWet;gl_FragColor=vec4(energy,0.,0.,1.);
  }`});
 const passScene=new THREE.Scene(),passCamera=new THREE.Camera(),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;passScene.add(mesh);
 const restored=[],materials=new Set();let disposed=false,lastTime=-Infinity,lastKey='',force=true;
 const receiverGLSL=`uniform sampler2D uCausticMap;uniform vec2 uCausticMin,uCausticSpan,uCausticTexel;uniform float uLakeLevel,uCausticFront,uCausticSolar,uCausticGain,uCausticDebug;varying vec3 vCausticWorld;
 float pondFocusedLight(vec3 surfaceNormal){vec2 uv=(vCausticWorld.xz-uCausticMin)/uCausticSpan;float depth=uLakeLevel-vCausticWorld.y;
  if(any(lessThan(uv,vec2(.002)))||any(greaterThan(uv,vec2(.998)))||depth<.012||vCausticWorld.z>uCausticFront-.012)return 0.;
  float energy=texture2D(uCausticMap,uv).r*.50;
  energy+=(texture2D(uCausticMap,uv+vec2(uCausticTexel.x,0.)).r+texture2D(uCausticMap,uv-vec2(uCausticTexel.x,0.)).r+texture2D(uCausticMap,uv+vec2(0.,uCausticTexel.y)).r+texture2D(uCausticMap,uv-vec2(0.,uCausticTexel.y)).r)*.125;
  vec3 wn=normalize((vec4(surfaceNormal,0.)*viewMatrix).xyz);float face=smoothstep(.03,.55,wn.y);
  return min(2.5,max(0.,energy-.92))*face*exp(-depth*.65)*uCausticSolar*uCausticGain;
 }
 `;
 for(const root of receivers)root?.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m?.isMeshStandardMaterial||materials.has(m))continue;materials.add(m);const previous=m.onBeforeCompile,key=m.customProgramCacheKey;
   m.onBeforeCompile=function(shader,...args){previous?.call(this,shader,...args);for(const name of ['uCausticMap','uCausticTexel','uCausticMin','uCausticSpan','uLakeLevel','uCausticFront','uCausticSolar','uCausticGain','uCausticDebug'])shader.uniforms[name]=local[name];shader.vertexShader='varying vec3 vCausticWorld;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
    vec4 causticWorld=vec4(transformed,1.);
    #ifdef USE_BATCHING
     causticWorld=batchingMatrix*causticWorld;
    #endif
    #ifdef USE_INSTANCING
     causticWorld=instanceMatrix*causticWorld;
    #endif
    vCausticWorld=(modelMatrix*causticWorld).xyz;`);
    shader.fragmentShader=receiverGLSL+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directDiffuse*=1.+pondFocusedLight(normal);');
   };m.customProgramCacheKey=()=>key.call(m)+'-bounded-pond-photon-area-v1';m.needsUpdate=true;restored.push(()=>{m.onBeforeCompile=previous;m.customProgramCacheKey=key;m.needsUpdate=true;});
  }});
 const stats={resolution:[resolution,resolution],photonGrid:[N+1,N+1],triangles:geometry.index.count/3,receivers:materials.size,renders:0,solar:0,renderTargets:1,method:'Shared optical-normal refraction to finite sampled bed; differential photon-area ratio; direct-diffuse receiver modulation',disposed:false};
 function prepare(state={}){local.uCausticSolar.value=(state.daylight??0)*Math.min(1.2,(state.sunIntensity??0)/4)*(1-Math.min(.8,(state.effectiveRain??0)*.65))*(1-(uniforms.uIce?.value??0));stats.solar=local.uCausticSolar.value;}
 function beforeRender(){if(disposed||stats.solar<1.e-5)return;const time=uniforms.uTime.value,key=[...uniforms.uSun.value.toArray(),...uniforms.uWind.value.toArray(),uniforms.uLakeLevel.value].join(',');if(!force&&key===lastKey&&time>=lastTime&&time-lastTime<1/20)return;
  const old=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),clipping=renderer.clippingPlanes,shadows=renderer.shadowMap.autoUpdate,shadowNeeds=renderer.shadowMap.needsUpdate;
  try{renderer.clippingPlanes=[];renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(passScene,passCamera);stats.renders++;lastTime=time;lastKey=key;force=false;}
  finally{renderer.setRenderTarget(old);renderer.setClearColor(clear,alpha);renderer.clippingPlanes=clipping;renderer.shadowMap.autoUpdate=shadows;renderer.shadowMap.needsUpdate=shadowNeeds;}
 }
 function reset(){lastTime=-Infinity;lastKey='';force=true;}
 function dispose(){if(disposed)return;disposed=true;restored.forEach(fn=>fn());geometry.dispose();material.dispose();target.dispose();bedTexture.dispose();stats.disposed=true;}
 return{prepare,beforeRender,reset,dispose,stats,texture:target.texture,uniforms:local,setGain(value){local.uCausticGain.value=THREE.MathUtils.clamp(value,0,2);},diagnostics:{material,geometry,bedTexture,min,span,target,receiverGLSL}};
}
