import * as THREE from 'three';

// Local air/water impact envelope. The existing flow owns the ballistic jet,
// pool datum and discharge; these pooled render primitives represent its
// entrained spray rather than adding mass to A*v=Q.
const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const random=i=>{const q=Math.sin(i*93.17+71.09)*17431.117;return q-Math.floor(q);};
const wrap=x=>((x%1)+1)%1;
const ENDING=`\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n`;
const NOISE=`float ihash(vec2 p){return fract(sin(dot(p,vec2(83.17,247.91)))*17431.117);}
float inoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(ihash(i),ihash(i+vec2(1.,0.)),f.x),mix(ihash(i+vec2(0.,1.)),ihash(i+vec2(1.)),f.x),f.y);}
float ifbm(vec2 p){return inoise(p)*.62+inoise(p*2.03+vec2(3.7,1.8))*.26+inoise(p*4.17+vec2(1.3,8.1))*.12;}`;
export function waterfallSunIntensity(state){
 if(Number.isFinite(state.sunIntensity))return Math.max(0,state.sunIntensity);
 const radiance=state.sunRadiance;if(Number.isFinite(radiance))return Math.max(0,radiance);
 const rgb=Array.isArray(radiance)?radiance:[radiance?.r,radiance?.g,radiance?.b];
 if(rgb.length>=3&&rgb.slice(0,3).every(Number.isFinite))return Math.max(0,rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722);
 return clamp(state.daylight??1,0,1)*2.7;
}
// Impact expression is intentionally independent of the falling curtain's
// white aeration. The source-lip veil stays subtle while real landing spray
// and low mist occupy a larger footprint, clipped by the actual pool/terrain.
export const WATER_IMPACT_CONFIG=Object.freeze({sprayGain:.85,impactMistGain:.80,sourceMistGain:.50,dropSizeScale:1.25,dropUpScale:1.16,dropRadialScale:1.22,mistSpreadScale:1.24,mistSizeScale:1.24,ringScale:1.16});
const DROP_COUNT=384,MIST_COUNT=120,IMPACT_MIST_COUNT=96,RING_COUNT=4,RING_SEGMENTS=56;

export function createWaterImpactVFX({terrain,flow,uniforms,surfaceHeight}){
 const group=new THREE.Group();group.name='Waterfall impact crown spray and low wind mist';
 const fall=flow.falls[0];if(!fall)return{group,update(){},stats:{enabled:false},dispose(){}};
 const c=WATER_IMPACT_CONFIG,origin=fall.end.slice(),lip=fall.start.slice(),g=fall.gravity??9.81,impactSpeed=clamp(fall.exitSpeed,.1,12);
 const width=fall.width,half=width*.5,pool=terrain.pool??terrain.river.pool;
 const radialLimit=Math.min(.60,Math.max(.32,(pool?.rx??.465)*1.18));
 const ownedGeometry=[],ownedMaterials=[];
 const ownGeo=x=>(ownedGeometry.push(x),x),ownMat=x=>(ownedMaterials.push(x),x);
 Object.assign(uniforms,{uImpactDay:{value:1},uImpactSun:{value:1},uImpactActivity:{value:1},uImpactSoftDepth:{value:1}});
 const pointPositions=new Float32Array(DROP_COUNT*3),pointVelocities=new Float32Array(DROP_COUNT*3),pointSizes=new Float32Array(DROP_COUNT),pointAlphas=new Float32Array(DROP_COUNT),pointSeed=new Float32Array(DROP_COUNT);
 const dropGeometry=ownGeo(new THREE.BufferGeometry());dropGeometry.setAttribute('position',new THREE.BufferAttribute(pointPositions,3));dropGeometry.setAttribute('aVelocity',new THREE.BufferAttribute(pointVelocities,3));dropGeometry.setAttribute('aSize',new THREE.BufferAttribute(pointSizes,1));dropGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(pointAlphas,1));dropGeometry.setAttribute('aSeed',new THREE.BufferAttribute(pointSeed,1));
 const dropMaterial=ownMat(new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,
  vertexShader:`uniform vec2 uResolution;attribute vec3 aVelocity;attribute float aSize,aAlpha,aSeed;varying float vAlpha,vSeed,vAspect;varying vec2 vDirection;varying vec3 vWorld;
  void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;vec4 p=modelViewMatrix*vec4(position,1.);vec4 clip=projectionMatrix*p;gl_Position=clip;
   vec3 velocity=(modelViewMatrix*vec4(aVelocity,0.)).xyz;vec4 next=projectionMatrix*vec4(p.xyz+velocity*.012,1.);
   vec2 trail=(next.xy/max(.01,next.w)-clip.xy/max(.01,clip.w))*uResolution*.5;
   float diameter=aSize*uResolution.y*projectionMatrix[1][1]*.5/max(.1,-p.z);
   float smear=min(length(trail),max(1.,diameter)*2.2);float footprint=clamp(max(1.,diameter)+smear,1.,20.);
   gl_PointSize=footprint;vAspect=clamp(max(.55,diameter)/footprint,.22,1.);vDirection=normalize(vec2(trail.x,-trail.y)+vec2(.00001,0.));vAlpha=aAlpha;vSeed=aSeed;
  }`,
  fragmentShader:`uniform float uImpactDay,uImpactSun,uFlowCapture;varying float vAlpha,vSeed,vAspect;varying vec2 vDirection;varying vec3 vWorld;
  void main(){vec2 p=gl_PointCoord*2.-1.;vec2 direction=normalize(vDirection);p=vec2(dot(p,vec2(direction.y,-direction.x))/vAspect,dot(p,direction));
   float r=dot(p,p);if(r>1.)discard;float alpha=exp(-r*3.6)*(1.-smoothstep(.60,1.,r))*vAlpha;
   vec3 color=vec3(.65,.75,.74)*(.16+.44*uImpactDay+.35*uImpactSun);gl_FragColor=vec4(color,alpha);${ENDING}
  }` }));
 const drops=new THREE.Points(dropGeometry,dropMaterial);drops.name='384 gravity returned impact droplets';drops.frustumCulled=false;drops.renderOrder=10;group.add(drops);

 const mistGeometry=ownGeo(new THREE.PlaneGeometry(1,1));const mistOpacity=new Float32Array(MIST_COUNT),mistPhase=new Float32Array(MIST_COUNT);
 mistGeometry.setAttribute('aMistAlpha',new THREE.InstancedBufferAttribute(mistOpacity,1));mistGeometry.setAttribute('aMistPhase',new THREE.InstancedBufferAttribute(mistPhase,1));
 const mistMaterial=ownMat(new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,
  vertexShader:`attribute float aMistAlpha,aMistPhase;varying vec2 vUV;varying float vAlpha,vPhase;varying vec3 vWorld;void main(){vec4 p=modelMatrix*instanceMatrix*vec4(position,1.);vWorld=p.xyz;vUV=uv;vAlpha=aMistAlpha;vPhase=aMistPhase;gl_Position=projectionMatrix*viewMatrix*p;}`,
  fragmentShader:`uniform float uFlowTime,uFlowCapture,uNear,uFar,uImpactDay,uImpactSun,uImpactSoftDepth;uniform vec2 uResolution;uniform vec3 uCamera,uSun;uniform sampler2D uDepth;varying vec2 vUV;varying float vAlpha,vPhase;varying vec3 vWorld;${NOISE}
  float viewDepth(float d){return -(uNear*uFar)/((uFar-uNear)*d-uFar);}
  void main(){vec2 p=vUV*2.-1.;float r=dot(p,p);if(r>1.)discard;
   vec2 q=p*2.7+vec2(vPhase*17.1,-uFlowTime*.18);float n=ifbm(q),detail=ifbm(q*1.9+vec2(uFlowTime*.09,4.1));
   float edge=1.-smoothstep(.30+n*.22,.86+n*.14,r);float density=mix(.38,1.,smoothstep(.12,.8,n*.7+detail*.3));
   float soft=1.;if(uFlowCapture<.5&&uImpactSoftDepth>.5){float own=-(viewMatrix*vec4(vWorld,1.)).z;float behind=viewDepth(texture2D(uDepth,gl_FragCoord.xy/uResolution).r)-own;soft=smoothstep(.0,.10,behind);}
   vec3 view=normalize(uCamera-vWorld);float sunFacing=.55+.45*max(0.,dot(normalize(uSun),view));
   float light=.12+.42*uImpactDay+uImpactSun*(.20+.26*sunFacing);vec3 color=mix(vec3(.43,.53,.53),vec3(.75,.82,.79),density)*light;
   gl_FragColor=vec4(color,edge*density*vAlpha*soft);${ENDING}
  }` }));
 const mist=new THREE.InstancedMesh(mistGeometry,mistMaterial,MIST_COUNT);mist.name='96 surface rooted impact puffs and 24 subtle source lip puffs';mist.frustumCulled=false;mist.renderOrder=11;mist.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(mist);

 const ringVertices=RING_COUNT*(RING_SEGMENTS+1)*2,ringPositions=new Float32Array(ringVertices*3),ringAlpha=new Float32Array(ringVertices),ringPhase=new Float32Array(ringVertices),ringIndices=[];
 for(let r=0;r<RING_COUNT;r++)for(let j=0;j<RING_SEGMENTS;j++){const a=r*(RING_SEGMENTS+1)*2+j*2,b=a+1,c=a+2,d=a+3;ringIndices.push(a,c,b,b,c,d);}
 const ringGeometry=ownGeo(new THREE.BufferGeometry());ringGeometry.setAttribute('position',new THREE.BufferAttribute(ringPositions,3));ringGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(ringAlpha,1));ringGeometry.setAttribute('aPhase',new THREE.BufferAttribute(ringPhase,1));ringGeometry.setIndex(ringIndices);
 const ringMaterial=ownMat(new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,
  vertexShader:`attribute float aAlpha,aPhase;varying float vAlpha,vPhase;varying vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;vAlpha=aAlpha;vPhase=aPhase;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
  fragmentShader:`uniform float uFlowTime,uImpactDay,uImpactSun,uFlowCapture;varying float vAlpha,vPhase;varying vec3 vWorld;${NOISE}void main(){float n=ifbm(vWorld.xz*44.+vec2(-uFlowTime*.3,uFlowTime*.7));float patches=smoothstep(.24,.66,n);vec3 color=vec3(.68,.78,.74)*(.13+.48*uImpactDay+.30*uImpactSun);gl_FragColor=vec4(color,vAlpha*patches);${ENDING}}` }));
 const rings=new THREE.Mesh(ringGeometry,ringMaterial);rings.name='Surface conforming broken whitewater expansion rings';rings.frustumCulled=false;rings.renderOrder=9;group.add(rings);
 const seeds=Array.from({length:DROP_COUNT+MIST_COUNT},(_,i)=>[random(i*11+2),random(i*11+3),random(i*11+4),random(i*11+5),random(i*11+6)]);
 const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),scale=new THREE.Vector3(),position=new THREE.Vector3();
 let lastFingerprint=null,disposed=false;
 const stats={enabled:true,droplets:DROP_COUNT,mistBillboards:MIST_COUNT,surfaceRings:RING_COUNT,drawCalls:3,triangles:RING_COUNT*RING_SEGMENTS*2+MIST_COUNT*2,origin:origin.slice(),radialLimit,sourceMistBillboards:MIST_COUNT-IMPACT_MIST_COUNT,impactMistBillboards:IMPACT_MIST_COUNT,impactAnchor:'actual water-surface height at ballistic landing',geometryResources:3,materialResources:3,instancedObjects:1,activeDroplets:0,mistOpacitySum:0,time:0,intensity:c.impactMistGain,impactConfig:c,scope:'Fixed-count, time-addressable local aeration/splash rendering driven by the existing ballistic fall; no fluid-pressure or aerosol transport solver.'};
 function sampleDrop(i,time,state,impactAnchor=surfaceHeight(origin[0],origin[2]+.012)){
  const[a,b,c,d,e]=seeds[i],up=(.13+b*.192)*impactSpeed*WATER_IMPACT_CONFIG.dropUpScale,duration=2*up/g,phase=wrap(time/duration+a),age=phase*duration;
  const angle=c*Math.PI*2,radial=(.062+d*.144)*impactSpeed*WATER_IMPACT_CONFIG.dropRadialScale,offset=(e*2-1)*half*.65;
  const wx=(state.wind?.x??.85)*(state.windStrength??.12),wz=(state.wind?.y??.25)*(state.windStrength??.12);
  const vx=Math.cos(angle)*radial,vz=Math.sin(angle)*radial*.68+.08;
  const x=origin[0]+offset+vx*age+wx*age*age*.14,z=origin[2]+vz*age+wz*age*age*.14;
  const floor=surfaceHeight(x,z),bed=Number.isFinite(floor)?null:terrain.height(x,z),anchor=impactAnchor,y=(Number.isFinite(anchor)?anchor:origin[1])+.006+up*age-.5*g*age*age;
  const collision=Number.isFinite(floor)?floor:bed;
  const returned=y<collision+.008||Math.hypot(x-origin[0],(z-origin[2])*1.25)>radialLimit;
  return{position:[x,y,z],velocity:[vx+wx*age*.28,up-g*age,vz+wz*age*.28],phase,age,duration,returned,size:(.0043+c*.0068)*(e>.94?1.55:1)*WATER_IMPACT_CONFIG.dropSizeScale,alpha:returned?0:smooth(0,.06,phase)*(1-smooth(.72,1,phase))*(.45+.35*d)*.58,floor,bed};
 }
 function sampleMist(i,time,state){
  const[a,b,c,d,e]=seeds[DROP_COUNT+i],atSource=i>=IMPACT_MIST_COUNT,outer=!atSource&&i>=64;
  const life=atSource?1.7+a*.8:outer?1.7+a*.8:1.0+a*.8,phase=wrap(time/life+b),age=phase*life;
  const angle=c*Math.PI*2,spread=atSource?.025+phase*.075:((outer?.055:.008)+phase*(outer?.28:.17))*WATER_IMPACT_CONFIG.mistSpreadScale;
  const wx=(state.wind?.x??.85)*(state.windStrength??.12),wz=(state.wind?.y??.25)*(state.windStrength??.12),anchor=atSource?lip:origin;
  // Start exactly over the physical contact footprint, without a downstream
  // .11 m offset or max(originY,surfaceY) lift. The ground/water depth sampler
  // clips the lower half of each puff; the first fog is attached to impact.
  const windFactor=atSource?.025:.055;
  const x=anchor[0]+(d*2-1)*half*(atSource?.55:.60)+Math.cos(angle)*spread+wx*age*windFactor;
  const z=anchor[2]+(atSource?-.025:.016)+Math.sin(angle)*spread*(atSource?.55:.58)+wz*age*windFactor;
  const floor=surfaceHeight(x,z),wet=Number.isFinite(floor),bed=wet?null:terrain.height(x,z);
  const contact=wet?floor:atSource?lip[1]:(surfaceHeight(origin[0],origin[2]+.016)??origin[1]);
  const lift=atSource?.005+phase*.035:.003+Math.sin(phase*Math.PI*.72)*(outer?.085:.055);
  const size=atSource?.13+phase*.14:((outer?.34:.24)+phase*(outer?.39:.32))*WATER_IMPACT_CONFIG.mistSizeScale;
  const alpha=Math.sin(phase*Math.PI)*(atSource?.038:outer?.11:.22)*(1-phase*.32)*(wet||atSource&&bed<contact+.025?1:0);
  return{position:[x,contact+lift,z],phase,age,life,size,alpha,outer,atSource,contact,lift,wet};
 }
 function update(state,camera){
  const time=state.time??0,day=clamp(state.daylight??1,0,1),sun=clamp(waterfallSunIntensity(state)*.24,0,1.3),activity=1-smooth(1,8,-(state.temperature??15))*.8;
  const fingerprint=[time,day,sun,activity,state.wind?.x,state.wind?.y,state.windStrength,...camera.quaternion.toArray()];
  if(lastFingerprint&&fingerprint.every((v,i)=>v===lastFingerprint[i]))return;lastFingerprint=fingerprint;
  uniforms.uImpactDay.value=day;uniforms.uImpactSun.value=sun;uniforms.uImpactActivity.value=activity;let visible=0,opacity=0;
  const rainGain=1+clamp(state.effectiveRain??state.rain??0,0,1)*.16;
  const impactAnchor=surfaceHeight(origin[0],origin[2]+.012);
  for(let i=0;i<DROP_COUNT;i++){const d=sampleDrop(i,time,state,impactAnchor);pointPositions.set(d.position,i*3);pointVelocities.set(d.velocity,i*3);pointSizes[i]=d.size;pointAlphas[i]=d.alpha*activity*rainGain*WATER_IMPACT_CONFIG.sprayGain;pointSeed[i]=seeds[i][0];if(pointAlphas[i]>.001)visible++;}
  for(const n of ['position','aVelocity','aSize','aAlpha','aSeed'])dropGeometry.attributes[n].needsUpdate=true;
  q.copy(camera.quaternion);for(let i=0;i<MIST_COUNT;i++){const m=sampleMist(i,time,state);position.fromArray(m.position);scale.set(m.size,m.size*(m.atSource?.50:m.outer?.46:.59),1);matrix.compose(position,q,scale);mist.setMatrixAt(i,matrix);mistOpacity[i]=m.alpha*activity*rainGain*(m.atSource?WATER_IMPACT_CONFIG.sourceMistGain:WATER_IMPACT_CONFIG.impactMistGain);mistPhase[i]=seeds[DROP_COUNT+i][0];opacity+=mistOpacity[i];}
  mist.instanceMatrix.needsUpdate=true;mistGeometry.attributes.aMistAlpha.needsUpdate=true;mistGeometry.attributes.aMistPhase.needsUpdate=true;
  let k=0;for(let r=0;r<RING_COUNT;r++){
   const age=wrap(time*.78+r/RING_COUNT),radius=(.025+age*.34)*WATER_IMPACT_CONFIG.ringScale,thickness=(.012+(1-age)*.033)*1.12,envelope=smooth(0,.08,age)*(1-smooth(.58,1,age));
   for(let j=0;j<=RING_SEGMENTS;j++)for(let edge=0;edge<2;edge++){
    const angle=j/RING_SEGMENTS*Math.PI*2,rr=Math.max(.008,radius+(edge-.5)*thickness),warp=1+.08*Math.sin(angle*5+time*.7+r);
    const x=origin[0]+Math.cos(angle)*rr*warp,z=origin[2]+.016+Math.sin(angle)*rr*.72;
    const floor=surfaceHeight(x,z),wet=Number.isFinite(floor);
    ringPositions[k*3]=x;ringPositions[k*3+1]=(wet?floor:origin[1])+.009+Math.sin(age*Math.PI)*.018;ringPositions[k*3+2]=z;
    ringAlpha[k]=wet?envelope*.36*activity*rainGain:0;ringPhase[k]=age;k++;
   }
  }
  for(const n of ['position','aAlpha','aPhase'])ringGeometry.attributes[n].needsUpdate=true;
  stats.activeDroplets=visible;stats.mistOpacitySum=opacity;stats.time=time;
 }
 let cloudBinding=null;
 function setCloudOcclusion(binding){
  if(binding===cloudBinding)return;cloudBinding=binding;
  for(const m of ownedMaterials){m.userData.cloudBaseFragment??=m.fragmentShader;
   if(binding?.glsl){Object.assign(m.uniforms,binding.uniforms);
    // The destination already contains front-cloud scattering. Normal alpha
    // composition needs the same Cf + T*surface in its source RGB, otherwise
    // multiplying source alpha by T darkens that cloud a second time.
    const composite=m.blending===THREE.AdditiveBlending?'gl_FragColor.a*=weatherCloudTransmittance(vWorld);':'gl_FragColor.rgb=weatherCloudComposite(vWorld,gl_FragColor.rgb);';
    m.fragmentShader=binding.glsl+'\n'+m.userData.cloudBaseFragment.replace('#include <tonemapping_fragment>','if(uFlowCapture<.5){'+composite+'}\n#include <tonemapping_fragment>');}
   else m.fragmentShader=m.userData.cloudBaseFragment;m.needsUpdate=true;
  }
  stats.cloudOcclusionBound=!!binding?.glsl;
 }
 return{group,stats,sampleDrop,sampleMist,update,setCloudOcclusion,setSoftDepth(enabled=true){uniforms.uImpactSoftDepth.value=enabled?1:0;},dispose(){if(disposed)return;disposed=true;mist.dispose();for(const g of ownedGeometry)g.dispose();for(const m of ownedMaterials)m.dispose();stats.disposed=true;}};
}
