import * as THREE from 'three';
import {createChimneySmoke} from './chimney-smoke.js';
import {CLOUD_EVENT,startCloudStorm,stepCloudStorm,combinedCloudSize,cloudMergeEnvelope,lightningEnvelope} from './cloud-interaction.js';
import {createRainImpacts} from './rain-impact.js';
import {createFogVolumes,fogEnvelope} from './fog-volumes.js';
import {createRainParcels} from './rain-parcels.js';
import {CLOUD_SHAPE_GLSL,CLOUD_LIGHTING_GLSL,createCloudOcclusion} from './cloud-optics.js';

// A bounded weather system for a physical-scale miniature. All time is seconds,
// all wind is in world X/Z. This is an observed-behaviour reconstruction.
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
function randomGenerator(seed) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const noise3 = `
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){return noise(p)*.57+noise(p*2.08+7.)*.28+noise(p*4.13+13.)*.15;}
`;

function cloudMaterial(seed, steps=36) {
 return new THREE.ShaderMaterial({
  uniforms:{uCamera:{value:new THREE.Vector3()},uSun:{value:new THREE.Vector3(-.6,.85,.25).normalize()},uTime:{value:0},uSeed:{value:seed},uDay:{value:1},uRain:{value:0},uStorm:{value:0},uOpacity:{value:1},uDensity:{value:1},uFlash:{value:0},uLightningLocal:{value:new THREE.Vector3(99,99,99)},uWorldMatrix:{value:new THREE.Matrix4()},uSceneDepth:{value:null},uHasSceneDepth:{value:0},uViewport:{value:new THREE.Vector4(0,0,1,1)},uNear:{value:.1},uFar:{value:90}},
  vertexShader:`varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`${CLOUD_SHAPE_GLSL}
${CLOUD_LIGHTING_GLSL}
uniform vec3 uCamera,uSun,uLightningLocal;uniform sampler2D uSceneDepth;uniform mat4 uWorldMatrix;uniform vec4 uViewport;
uniform float uTime,uSeed,uDay,uRain,uStorm,uOpacity,uDensity,uFlash,uHasSceneDepth,uNear,uFar;varying vec3 vLocal;
float density(vec3 p){return weatherCloudShape(p,uSeed,uTime);}
void main(){
 vec3 rd=normalize(vLocal-uCamera),inv=1./(rd+vec3(.000001));
 vec3 ta=(-vec3(1.)-uCamera)*inv,tb=(vec3(1.)-uCamera)*inv;
 vec3 lo=min(ta,tb),hi=max(ta,tb);float start=max(max(lo.x,lo.y),max(lo.z,0.)),end=min(min(hi.x,hi.y),hi.z),sceneStop=100000.;
 vec3 worldRay=(uWorldMatrix*vec4(rd,0.)).xyz;
 if(uHasSceneDepth>.5){
  vec2 uv=clamp((gl_FragCoord.xy-uViewport.xy)/uViewport.zw,vec2(.000001),vec2(.999999));
  float depth=texture2D(uSceneDepth,uv).r,sceneViewZ=(uNear*uFar)/((uFar-uNear)*depth-uFar);
  float viewRayZ=(viewMatrix*vec4(worldRay,0.)).z;
  if(viewRayZ<-.000001){sceneStop=max(0.,sceneViewZ/viewRayZ);end=min(end,sceneStop);}
 }
 if(end<=start)discard;
 float stepSize=(end-start)/${steps}.;vec4 col=vec4(0.);vec3 sun=normalize(uSun);
 for(int i=0;i<${steps};i++){
  float t=start+(float(i)+.5)*stepSize;vec3 p=uCamera+rd*t;
  float contact=smoothstep(0.,.035,max(0.,sceneStop-t)*length(worldRay));
  float den=density(p)*uDensity*contact;
  if(den>.005){
   vec3 lit=weatherCloudLighting(p,rd,sun,uSeed,uTime,uDay,uRain,uStorm,uFlash,uLightningLocal);
   float alpha=1.-exp(-den*stepSize*6.4);col.rgb+=(1.-col.a)*lit*alpha;col.a+=(1.-col.a)*alpha;
  }if(col.a>.985)break;
 }
 if(col.a<.008)discard;gl_FragColor=vec4(col.rgb/max(col.a,.001),col.a*uOpacity);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`,
  transparent:true,depthWrite:false,side:THREE.BackSide,
 });
}

function makeSoftPoints(count, random, color, maxSize, blend=THREE.NormalBlending) {
  const positions=new Float32Array(count*3),sizes=new Float32Array(count),seeds=new Float32Array(count);
  for(let i=0;i<count;i++){sizes[i]=.45+random()*.55;seeds[i]=random();}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));geometry.setAttribute('aSeed',new THREE.BufferAttribute(seeds,1));
  const material=new THREE.ShaderMaterial({uniforms:{uColor:{value:new THREE.Color(color)},uSize:{value:maxSize},uOpacity:{value:1},uTime:{value:0}},vertexShader:`attribute float aSize,aSeed;uniform float uSize;varying float vSeed;void main(){vSeed=aSeed;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=min(28.,uSize*aSize*300./max(1.,-p.z));}`,fragmentShader:`uniform vec3 uColor;uniform float uOpacity,uTime;varying float vSeed;void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;float a=exp(-r*4.5)*(1.-smoothstep(.55,1.,r));gl_FragColor=vec4(uColor,a*uOpacity*(.68+.32*sin(uTime*2.+vSeed*40.)));
#include <tonemapping_fragment>\n#include <colorspace_fragment>}`,transparent:true,depthWrite:false,blending:blend});
  const object=new THREE.Points(geometry,material);object.frustumCulled=false;return {object,positions,geometry,material,seeds,count};
}

export function createWeather(scene,camera,renderer,options={}) {
  const {onCloudGrab,onCloudRelease,onLightning,onWind,seed=42}=options;
  const quality=typeof options.quality==='number'?clamp(options.quality,.45,1.6):({low:.55,medium:.8,high:1.15}[options.quality]??1);
  const bounds={left:-5.65,right:5.65,back:-4.95,front:3.95,bottom:5.7,top:7.9};
  const terrain=options.terrain;
  let lakeSurfaceSampler=null,flowSurfaceSampler=null,sceneDepthTexture=null;
  const lake=terrain?.lake??{x:1.45,z:2.8,rx:2.45,rz:2.05,level:.18,front:4.25};
  const precipitationWind=new THREE.Vector2();
  function isLake(x,z,bed){return ((x-lake.x)/lake.rx)**2+((z-lake.z)/lake.rz)**2<.995&&z<=(lake.front??4.25)&&bed<(lake.currentLevel??lake.level)-.012;}
  function surfaceContact(x,z,time=0,state={}){
    let bed=terrain?.height?.(x,z);if(!Number.isFinite(bed))bed=.24;
    const flow=flowSurfaceSampler?.(x,z,time,precipitationWind),flowY=typeof flow==='number'?flow:flow?.height??flow?.y;
    if(Number.isFinite(flowY)&&flowY>=bed-.03)return{y:flowY,water:true,kind:'stream',bed};
    const lakeY=lakeSurfaceSampler?.(x,z,time,precipitationWind)??lake.currentLevel??lake.level;
    const water=((x-lake.x)/lake.rx)**2+((z-lake.z)/lake.rz)**2<.995&&z<=(lake.front??4.25)&&bed<lakeY-.012;
    return{y:water?lakeY:bed,water,kind:water?'pond':'land',bed};
  }
  // Rain streaks need thousands of cheap height clips per frame. Cache this
  // static landform only; an actual impact still samples exact land and wave.
  const heightWidth=145,heightHeight=117,heightGrid=new Float32Array(heightWidth*heightHeight),flowHeightGrid=new Float32Array(heightWidth*heightHeight).fill(NaN);
  for(let j=0;j<heightHeight;j++)for(let i=0;i<heightWidth;i++)heightGrid[j*heightWidth+i]=terrain?.height?.(-6+i/(heightWidth-1)*12,-5.3+j/(heightHeight-1)*9.6)??.24;
  function surfaceHeight(x,z){const gx=clamp((x+6)/12*(heightWidth-1),0,heightWidth-1),gz=clamp((z+5.3)/9.6*(heightHeight-1),0,heightHeight-1),i=Math.min(heightWidth-2,Math.floor(gx)),j=Math.min(heightHeight-2,Math.floor(gz)),u=gx-i,v=gz-j,a=heightGrid[j*heightWidth+i],b=heightGrid[j*heightWidth+i+1],c=heightGrid[(j+1)*heightWidth+i],d=heightGrid[(j+1)*heightWidth+i+1],bed=(a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;let height=isLake(x,z,bed)?lake.currentLevel??lake.level:bed;const k=j*heightWidth+i,fa=flowHeightGrid[k],fb=flowHeightGrid[k+1],fc=flowHeightGrid[k+heightWidth],fd=flowHeightGrid[k+heightWidth+1];if(Number.isFinite(fa))height=Math.max(height,fa);if(Number.isFinite(fb))height=Math.max(height,fb);if(Number.isFinite(fc))height=Math.max(height,fc);if(Number.isFinite(fd))height=Math.max(height,fd);return height;}
  function surfaceNormal(x,z,water){if(water)return normal.set(0,1,0);const e=.035;return normal.set((terrain?.height?.(x-e,z)??0)-(terrain?.height?.(x+e,z)??0),2*e,(terrain?.height?.(x,z-e)??0)-(terrain?.height?.(x,z+e)??0)).normalize();}
  const random=randomGenerator(seed+91),root=new THREE.Group();root.name='weather';scene.add(root);
  let cloudsVisible=true;const ownedTextures=[],ownedGeometries=[],ownedMaterials=[];const cloudOcclusion=createCloudOcclusion();
  let nextCloudId=0;const clouds=[];
  // Unequal near/low, far/high and small/foreground masses orbit the miniature's
  // centre. Height, depth and size each vary; equal clouds on an X line read as
  // a decorative row. Only untouched defaults retain these bounded anchors.
  const cloudDefaults=[
    {position:[-1.90,6.08,1.12],size:.66},
    {position:[.25,7.38,-.94],size:.91},
    {position:[1.82,6.44,1.85],size:.56},
  ];
  const cloudBox=new THREE.BoxGeometry(2,2,2);ownedGeometries.push(cloudBox);
  const proxyGeo=new THREE.SphereGeometry(1,12,8),proxyMat=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false});ownedGeometries.push(proxyGeo);ownedMaterials.push(proxyMat);
  function createCloud(p,size=1,defaultAnchor=null){
    const i=nextCloudId++;
    const group=new THREE.Group();group.position.set(...p);root.add(group);
    const mat=cloudMaterial(i*11.8+seed,quality<.7?26:quality>1.2?42:34);ownedMaterials.push(mat);
    const mesh=new THREE.Mesh(cloudBox,mat);mesh.scale.set(1.60*size,1.52*size,1.55*size);mesh.renderOrder=3;group.add(mesh);
    const proxy=new THREE.Mesh(proxyGeo,proxyMat);proxy.scale.set(1.65*size,.97*size,1.50*size);group.add(proxy);
    const cloud={id:i,group,mesh,proxy,material:mat,base:new THREE.Vector3(...p),defaultAnchor:defaultAnchor?new THREE.Vector3(...defaultAnchor):null,velocity:new THREE.Vector3(),size,targetSize:size,rain:0,rainTarget:0,compression:0,squeeze:0,squeezeVelocity:0,sizeVelocity:0,grabbed:false,held:0,lastStrike:-99,stormAge:99,storm:0,stormRain:0,stormStrikeFired:true,phase:'clear',mergingInto:null,mergeAge:0,opacity:1,density:1,shadowOpacity:.16};proxy.userData.cloud=cloud;clouds.push(cloud);
    mat.uniforms.uSceneDepth.value=sceneDepthTexture;mat.uniforms.uHasSceneDepth.value=sceneDepthTexture?1:0;mat.depthTest=!sceneDepthTexture;
    mesh.onBeforeRender=(activeRenderer,activeScene,activeCamera)=>syncCloudRender(cloud,activeCamera,activeRenderer);
    return cloud;
  }
  function createDefaultClouds(){for(const {position,size} of cloudDefaults)createCloud(position,size,position);}
  createDefaultClouds();

  const rainCount=Math.floor(3200*quality);
  // Preserve the established random stream for snow, stars, fog and lightning.
  for(let i=0;i<Math.floor(3600*quality)*5;i++)random();
  const snow=makeSoftPoints(Math.floor(1900*quality),random,0xe6f4ff,.11);root.add(snow.object);
  const snowSeeds=new Float32Array(snow.count*4);for(let i=0;i<snowSeeds.length;i++)snowSeeds[i]=random();
  const stars=makeSoftPoints(440,random,0xe3eeff,.15,THREE.AdditiveBlending);root.add(stars.object);
  for(let i=0;i<stars.count;i++){const a=random()*Math.PI*2,r=10+random()*6;stars.positions[i*3]=Math.cos(a)*r;stars.positions[i*3+1]=5+random()*8;stars.positions[i*3+2]=Math.sin(a)*r-4;}
  stars.geometry.attributes.position.needsUpdate=true;
  const flies=makeSoftPoints(70,random,0xe9ff91,.13,THREE.AdditiveBlending);root.add(flies.object);
  const flyOrigins=new Float32Array(70*3);for(let i=0;i<70;i++){flyOrigins[i*3]=(random()-.5)*10;flyOrigins[i*3+1]=.6+random()*1.9;flyOrigins[i*3+2]=(random()-.5)*8+1;}
  const mist=createFogVolumes(Math.floor(30*quality),random);
  // The retired 17 smoke sprites consumed three draws each. Preserve that
  // stream position so fog, trails, and later weather events keep their layout.
  for(let i=0;i<17*3;i++)random();
  const brushMist=createFogVolumes(Math.floor(88*quality),random);
  const smoke=createChimneySmoke({origin:options.chimney??{x:-3.12,y:1.88,z:-.43},seed,field:options.field});
  root.add(mist.object,smoke.object,brushMist.object);
  const fogPatches=Array.from({length:brushMist.count},()=>({age:99,life:0,x:0,z:0,y:0,radius:1,feed:0,lastFed:0,seed:random()}));let fogIndex=0;
  brushMist.alphas.fill(0);
  const cabinGlow=new THREE.PointLight(0xffae62,0,3.4,1.8);root.add(cabinGlow);

  const lightningCapacity=500,lightningPositions=new Float32Array(lightningCapacity*6),lightningWidths=new Float32Array(lightningCapacity).fill(1);
  const lightningGeo=new THREE.BufferGeometry();lightningGeo.setAttribute('position',new THREE.BufferAttribute(lightningPositions,3));lightningGeo.setDrawRange(0,0);
  const lightningMat=new THREE.LineBasicMaterial({color:0xd9e9ff,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});const lightningLines=new THREE.LineSegments(lightningGeo,lightningMat);lightningLines.frustumCulled=false;lightningLines.renderOrder=5;root.add(lightningLines);
  const lightningLight=new THREE.PointLight(0xabcfff,0,22,1.5);root.add(lightningLight);ownedGeometries.push(lightningGeo);ownedMaterials.push(lightningMat);
  // World-width ribbons keep the ground-striking branch readable on high-DPI
  // renderers where WebGL LineBasicMaterial is always one physical pixel.
  const lightningRibbonGeo=new THREE.InstancedBufferGeometry();lightningRibbonGeo.setIndex([0,1,2,0,2,3]);lightningRibbonGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,0,1,0,1,1,0,1,-1,0],3));
  const lightningInterleaved=new THREE.InstancedInterleavedBuffer(lightningPositions,6);lightningRibbonGeo.setAttribute('aStart',new THREE.InterleavedBufferAttribute(lightningInterleaved,3,0));lightningRibbonGeo.setAttribute('aEnd',new THREE.InterleavedBufferAttribute(lightningInterleaved,3,3));lightningRibbonGeo.setAttribute('aWidth',new THREE.InstancedBufferAttribute(lightningWidths,1));lightningRibbonGeo.instanceCount=0;
  const lightningUniforms={uCamera:{value:new THREE.Vector3()},uAlpha:{value:0},uWidth:{value:.052},uColour:{value:new THREE.Color(0xf5f9ff).multiplyScalar(3.8)},...cloudOcclusion.uniforms};
  const ribbonVertex=`attribute vec3 aStart,aEnd;attribute float aWidth;uniform vec3 uCamera;uniform float uWidth;varying float vSide;varying vec3 vWeatherBoltWorld;void main(){vec3 world=mix(aStart,aEnd,position.x),direction=normalize(aEnd-aStart),crossed=cross(direction,normalize(uCamera-world));vec3 side=length(crossed)>.0001?normalize(crossed):vec3(1,0,0);world+=side*position.y*uWidth*aWidth;vSide=position.y;vWeatherBoltWorld=world;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`;
  const ribbonFragment=`${cloudOcclusion.glsl}\nuniform float uAlpha;uniform vec3 uColour;varying float vSide;varying vec3 vWeatherBoltWorld;void main(){float alpha=exp(-vSide*vSide*4.8)*(1.-smoothstep(.78,1.,abs(vSide)))*uAlpha*weatherCloudTransmittance(vWeatherBoltWorld);if(alpha<.001)discard;gl_FragColor=vec4(uColour,alpha);}`;
  const coreMat=new THREE.ShaderMaterial({uniforms:lightningUniforms,vertexShader:ribbonVertex,fragmentShader:ribbonFragment,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,side:THREE.DoubleSide});
  const haloUniforms={uCamera:lightningUniforms.uCamera,uAlpha:{value:0},uWidth:{value:.185},uColour:{value:new THREE.Color(0x8caaff).multiplyScalar(2.2)},...cloudOcclusion.uniforms};
  const haloMat=new THREE.ShaderMaterial({uniforms:haloUniforms,vertexShader:ribbonVertex,fragmentShader:ribbonFragment,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,side:THREE.DoubleSide});
  const boltCore=new THREE.Mesh(lightningRibbonGeo,coreMat),boltHalo=new THREE.Mesh(lightningRibbonGeo,haloMat);for(const mesh of[boltHalo,boltCore]){mesh.frustumCulled=false;mesh.renderOrder=6;mesh.visible=false;root.add(mesh);}ownedGeometries.push(lightningRibbonGeo);ownedMaterials.push(coreMat,haloMat);
  let lightningAge=99,lightningSegments=0,lightningStrength=0,lightningOwner=null;
  const lightningRestPositions=new Float32Array(lightningCapacity*6),lightningSourceOrigin=new THREE.Vector3(),lightningTarget=new THREE.Vector3(),lightningDisplacement=new THREE.Vector3();

  const trailCount=80,trailSegments=13,trails=Array.from({length:trailCount},()=>({age:99,life:1,origin:new THREE.Vector3(),dir:new THREE.Vector2(1,0),strength:0,seed:random()})),trailPositions=new Float32Array(trailCount*trailSegments*6),trailColors=new Float32Array(trailCount*trailSegments*6);
  const trailGeo=new THREE.BufferGeometry();trailGeo.setAttribute('position',new THREE.BufferAttribute(trailPositions,3));trailGeo.setAttribute('color',new THREE.BufferAttribute(trailColors,3));
  const trailMat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.72,depthWrite:false,blending:THREE.AdditiveBlending});const trailLines=new THREE.LineSegments(trailGeo,trailMat);trailLines.frustumCulled=false;trailLines.renderOrder=4;root.add(trailLines);ownedGeometries.push(trailGeo);ownedMaterials.push(trailMat);
  let trailIndex=0,tool='orbit',grab=null,condensing=null,fogDrawing=false,windDrawing=false,lastPointer=null,lastWindPoint=null,lastFogPoint=null,smoothRain=0,manualRain=0,elapsed=0,autoWindClock=0,fogBrushClock=0;
  let shakeSigns=[],lastDX=0,lastShakeTime=-99;
  const impacts=createRainImpacts({camera,quality,surfaceAt:surfaceContact});root.add(impacts.group);
  const rainfall=createRainParcels({capacity:rainCount,random:randomGenerator(seed+2191),surfaceHeight,surfaceAt:surfaceContact,onImpact(x,y,z,contact,strength,time,dropSeed){tempPoint.set(x,y+.002,z);impacts.emit(tempPoint,surfaceNormal(x,z,contact.water),contact.water,strength,time,dropSeed);}});root.add(rainfall.object);
  Object.assign(rainfall.material.uniforms,cloudOcclusion.uniforms);
  rainfall.material.vertexShader=rainfall.material.vertexShader.replace('varying vec2 vUv;','varying vec2 vUv;varying vec3 vWeatherRainWorld;').replace('vUv=vec2(position.x,position.y);','vWeatherRainWorld=world;vUv=vec2(position.x,position.y);');
  rainfall.material.fragmentShader=cloudOcclusion.glsl+'\n'+rainfall.material.fragmentShader.replace('varying vec2 vUv;','varying vec2 vUv;varying vec3 vWeatherRainWorld;').replace('gl_FragColor=vec4(neutral,alpha);','gl_FragColor=vec4(weatherCloudComposite(vWeatherRainWorld,neutral),alpha);');
  let mergeSerial=0,lastMergeTime=-99;
  const lastStrike={source:null,target:null,time:-99,reason:null};
  const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),dragPlane=new THREE.Plane(),groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-.18),skyPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-6.65),hitPoint=new THREE.Vector3(),dragOffset=new THREE.Vector3(),downPoint=new THREE.Vector2();
  const windVec=new THREE.Vector2(),localCamera=new THREE.Vector3(),worldCamera=new THREE.Vector3(),normal=new THREE.Vector3(),tempPoint=new THREE.Vector3(),oldCloudPosition=new THREE.Vector3(),pointerVelocity=new THREE.Vector3(),sunDirection=new THREE.Vector3(),inverseCloud=new THREE.Matrix4(),rayPoint=new THREE.Vector3();
  const stats={defaultCloudAnchors:3,defaultCloudLayout:'centred unequal near/low, far/high and small/foreground masses; bounded drift, released by user interaction',heightClipCache:{resolution:[heightWidth,heightHeight],bytes:heightGrid.byteLength,scope:'Static landform clip only; event impact height/normal and dynamic pond waves sample exact owner'},cloudMerges:0,mergeInProgress:0,lastMerge:null,lastStrike,rainImpacts:impacts.stats,clouds:3,rainDrops:0,snowflakes:0,windTrails:0,fogPatches:0,fogFeeds:0,fogDeposits:0,localRain:0,effectiveRain:0,lightning:0,grabbedCloud:null,condensingCloud:null,tool:'orbit',budgets:{quality,maxClouds:6,rainDrops:rainCount,snowflakes:snow.count,fogPatches:brushMist.count,cloudMarchSteps:quality<.7?26:quality>1.2?42:34}};

  function rayFromEvent(e){const r=renderer.domElement.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);camera.updateMatrixWorld();root.updateMatrixWorld(true);raycaster.setFromCamera(ndc,camera);}
  function cloudAtEvent(e){if(!cloudsVisible)return null;rayFromEvent(e);const hits=raycaster.intersectObjects(clouds.filter(c=>!c.mergingInto&&c.opacity>.2).map(c=>c.proxy),false);return hits[0]?.object.userData.cloud||null;}
  function eventSeconds(e){return Number.isFinite(e.timeStamp)?e.timeStamp*.001:elapsed;}
  function insideWorld(p){return p.x>-6&&p.x<6&&p.z>-5.3&&p.z<4.3;}
  function groundAtEvent(e){
    rayFromEvent(e);
    if(!raycaster.ray.intersectPlane(groundPlane,hitPoint))return false;
    const far=raycaster.ray.origin.distanceTo(hitPoint)+.1;
    let previous=Math.max(0,far-25);
    for(let t=previous;t<=far+.26;t+=.26){
      raycaster.ray.at(t,rayPoint);
      if(!insideWorld(rayPoint)){previous=t;continue;}
      if(rayPoint.y<=surfaceHeight(rayPoint.x,rayPoint.z)+.045){
        let lo=previous,hi=t;
        for(let i=0;i<7;i++){const mid=(lo+hi)*.5;raycaster.ray.at(mid,rayPoint);if(rayPoint.y>surfaceHeight(rayPoint.x,rayPoint.z)+.045)lo=mid;else hi=mid;}
        raycaster.ray.at((lo+hi)*.5,hitPoint);hitPoint.y=surfaceContact(hitPoint.x,hitPoint.z,elapsed).y+.12;return true;
      }previous=t;
    }return false;
  }
  function skyAtEvent(e){rayFromEvent(e);return !!raycaster.ray.intersectPlane(skyPlane,hitPoint)&&hitPoint.x>bounds.left-4&&hitPoint.x<bounds.right+4&&hitPoint.z>bounds.back-4&&hitPoint.z<bounds.front+4;}
  function emitFog(point,strength=1.05){
    // Feed an existing nearby lobe instead of stacking identical white optical
    // columns. Age (and hence expansion) stays continuous while its tail is fed.
    let nearby=null,nearest=.63*.63;
    for(const p of fogPatches){if(p.age-(p.lastFed??0)>=p.life)continue;const distance=(point.x-p.x)**2+(point.z-p.z)**2;if(distance<nearest){nearest=distance;nearby=p;}}
    if(nearby){nearby.feed=Math.min(1,(nearby.feed??0)+.20*clamp(strength,.35,1.5));nearby.lastFed=nearby.age;stats.fogFeeds++;return true;}
    let patch=fogPatches.find(p=>p.age-(p.lastFed??0)>=p.life);
    if(!patch){let weakest=null,best=Infinity;for(const p of fogPatches){const e=fogEnvelope(p.age,p.life,p.age-(p.lastFed??0));if(e<best){best=e;weakest=p;}}if(best>.28)return false;patch=weakest;}
    patch.age=.14;patch.lastFed=0;patch.feed=0;patch.life=15+random()*7;patch.x=clamp(point.x+(random()-.5)*.12,-5.8,5.8);patch.z=clamp(point.z+(random()-.5)*.12,-5.1,4.1);patch.y=surfaceHeight(patch.x,patch.z)+.39;patch.radius=(.86+random()*.24)*clamp(strength,.35,1.5);patch.seed=random();stats.fogDeposits++;return true;
  }
  function emitWind(point,direction,strength=.6){
    const d=direction?.isVector2?direction:new THREE.Vector2(direction?.x??1,direction?.z??direction?.y??0);if(d.lengthSq()<.00001)return;d.normalize();
    for(let k=0;k<4;k++){const tr=trails[trailIndex++%trailCount];tr.origin.copy(point);tr.origin.x+=(random()-.5)*.5;tr.origin.y+=(random()-.5)*.42;tr.origin.z+=(random()-.5)*.6;tr.dir.copy(d);tr.strength=clamp(strength,.1,1);tr.age=0;tr.life=.85+random()*.7;tr.seed=random();}
  }
  function triggerLightning(cloud=null,reason='gesture'){
    const c=cloud?.group?cloud:(grab||clouds[Math.floor(random()*clouds.length)]);if(!c||elapsed-c.lastStrike<.85)return false;c.lastStrike=elapsed;
    const start=c.group.position.clone();start.y+=c.mesh.scale.y*.12;const target=start.clone();target.x+=(random()-.5)*1.5;target.z+=(random()-.5)*1.4;target.y=surfaceContact(target.x,target.z,elapsed).y+.05;
    let n=0;const put=(a,b,width=1)=>{if(n>=lightningCapacity||a.distanceToSquared(b)<.0000001)return;lightningPositions.set([a.x,a.y,a.z,b.x,b.y,b.z],n*6);lightningWidths[n++]=width;};
    function subdivide(a,b,amplitude,depth){if(depth===0)return[a.clone(),b.clone()];const mid=a.clone().lerp(b,.5);mid.x+=(random()-.5)*amplitude;mid.z+=(random()-.5)*amplitude*.8;mid.y+=(random()-.5)*amplitude*.22;const left=subdivide(a,mid,amplitude*.48,depth-1),right=subdivide(mid,b,amplitude*.48,depth-1);return left.slice(0,-1).concat(right);}
    const points=subdivide(start,target,Math.min(1.65,(start.y-target.y)*.26),5);
    for(let i=1;i<points.length;i++)put(points[i-1],points[i],1.0-.12*i/points.length);
    for(let b=0;b<7;b++){
      const at=4+Math.floor(random()*21),s=points[at].clone(),end=s.clone().add(new THREE.Vector3((b%2?1:-1)*(.30+random()*.95),-(.35+random()*1.4),(random()-.5)*1.25));end.y=Math.max(surfaceHeight(end.x,end.z)+.13,end.y);const branch=subdivide(s,end,.28+random()*.30,3);
      for(let j=1;j<branch.length;j++)put(branch[j-1],branch[j],.56*(1-j/(branch.length+1))+.08);
      if(b%2===0){const fork=branch[4],tip=fork.clone().add(new THREE.Vector3((b%2?1:-1)*.28,-.22,(random()-.5)*.45));const twig=subdivide(fork,tip,.12,2);for(let j=1;j<twig.length;j++)put(twig[j-1],twig[j],.15*(1-j/(twig.length+1))+.04);}
    }
    lightningOwner=c;lightningSourceOrigin.copy(start);lightningTarget.copy(target);lightningRestPositions.set(lightningPositions);lightningSegments=n;lightningRibbonGeo.instanceCount=n;lightningInterleaved.needsUpdate=true;lightningRibbonGeo.attributes.aWidth.needsUpdate=true;lightningGeo.setDrawRange(0,n*2);lightningGeo.attributes.position.needsUpdate=true;lightningAge=0;lightningStrength=1;lightningLight.position.copy(start).add(new THREE.Vector3(0,-1,0));Object.assign(lastStrike,{source:start.toArray(),target:target.toArray(),time:elapsed,reason});onLightning?.({position:start.clone(),target:target.clone(),cloud:c,strength:1,reason});return true;
  }
  function beginMerge(survivor,donor){
    if(!survivor||!donor||survivor===donor||donor.mergingInto||survivor.mergingInto||elapsed-lastMergeTime<.9)return false;
    survivor.defaultAnchor=donor.defaultAnchor=null;donor.mergingInto=survivor;donor.mergeAge=0;donor.mergeOrigin=donor.group.position.clone();donor.mergeOriginalSize=donor.size;
    survivor.mergeStartSize=survivor.targetSize;survivor.mergeFinalSize=combinedCloudSize(survivor.targetSize,donor.targetSize);survivor.volumeBlendAge=0;survivor.velocity.multiplyScalar(.35);if(lightningOwner===donor)lightningOwner=survivor;startCloudStorm(survivor);lastMergeTime=elapsed;
    stats.cloudMerges=++mergeSerial;stats.lastMerge={survivor:survivor.id,donor:donor.id,time:elapsed};return true;
  }
  function checkDraggedMerge(){
    if(!grab||grab.mergingInto)return;
    // Soft cloud edges and a fixed-depth 2D drag plane need a small contact
    // tolerance. This is a gesture affordance, not physical cloud collision.
    let closest=null,best=Infinity;
    for(const c of clouds){if(c===grab||c.mergingInto)continue;const dx=(grab.group.position.x-c.group.position.x)/(1.2*(grab.size+c.size)),dy=(grab.group.position.y-c.group.position.y)/(.72*(grab.size+c.size)),dz=(grab.group.position.z-c.group.position.z)/(.82*(grab.size+c.size)),q=dx*dx+dy*dy+dz*dz;if(q<1.18&&q<best){best=q;closest=c;}}
    if(closest)beginMerge(grab,closest);
  }
  function pointerDown(e){
    if(e.button!==undefined&&e.button!==0)return false;
    {
      const c=cloudAtEvent(e);if(c){grab=c;c.defaultAnchor=null;c.grabbed=true;c.held=0;c.velocity.set(0,0,0);stats.grabbedCloud=c.id;camera.getWorldDirection(normal);dragPlane.setFromNormalAndCoplanarPoint(normal,c.group.position);raycaster.ray.intersectPlane(dragPlane,hitPoint);dragOffset.copy(c.group.position).sub(hitPoint);downPoint.set(e.clientX,e.clientY);lastPointer={x:e.clientX,y:e.clientY,time:eventSeconds(e)};shakeSigns=[];lastDX=0;onCloudGrab?.(c);return true;}
    }
    if(tool==='condense'){
      if(!skyAtEvent(e))return false;
      if(clouds.length<6)condensing=createCloud([clamp(hitPoint.x,bounds.left,bounds.right),6.65,clamp(hitPoint.z,bounds.back,bounds.front)],.32);
      else condensing=clouds.reduce((nearest,c)=>c.group.position.distanceToSquared(hitPoint)<nearest.group.position.distanceToSquared(hitPoint)?c:nearest,clouds[0]);
      condensing.defaultAnchor=null;condensing.velocity.set(0,0,0);condensing.targetSize=Math.max(condensing.size,.48);stats.condensingCloud=condensing.id;stats.clouds=clouds.length;return true;
    }
    if(tool==='fog'){
      if(!groundAtEvent(e))return false;fogDrawing=true;lastFogPoint=hitPoint.clone();fogBrushClock=0;emitFog(lastFogPoint);return true;
    }
    if(tool==='wind'){
      if(!groundAtEvent(e))return false;windDrawing=true;lastWindPoint=hitPoint.clone();lastPointer={x:e.clientX,y:e.clientY,time:eventSeconds(e)};return true;
    }return false;
  }
  function pointerMove(e){
    if(grab){
      const now=eventSeconds(e),pointerDt=clamp(now-(lastPointer?.time??now),.008,.18);
      rayFromEvent(e);if(raycaster.ray.intersectPlane(dragPlane,hitPoint)){hitPoint.add(dragOffset);oldCloudPosition.copy(grab.group.position);grab.group.position.set(clamp(hitPoint.x,bounds.left,bounds.right),clamp(hitPoint.y,bounds.bottom,bounds.top),clamp(hitPoint.z,bounds.back,bounds.front));grab.base.copy(grab.group.position);pointerVelocity.copy(grab.group.position).sub(oldCloudPosition).divideScalar(pointerDt).clampLength(0,5.5);pointerVelocity.y=clamp(pointerVelocity.y,-2,2);grab.velocity.lerp(pointerVelocity,.55);}
      checkDraggedMerge();
      grab.compression=clamp(.18+(e.clientY-downPoint.y)/210,0,.8);
      if(lastPointer){const dx=e.clientX-lastPointer.x,speed=dx/pointerDt;
        if(Math.abs(speed)>300&&Math.sign(dx)!==Math.sign(lastDX)&&Math.abs(lastDX)>2){shakeSigns.push(elapsed);shakeSigns=shakeSigns.filter(t=>elapsed-t<.8);if(shakeSigns.length>=3&&elapsed-lastShakeTime>1){triggerLightning(grab);shakeSigns=[];lastShakeTime=elapsed;}}
        if(Math.abs(dx)>2)lastDX=dx;
      }lastPointer={x:e.clientX,y:e.clientY,time:now};return true;
    }
    if(condensing){
      if(skyAtEvent(e)){condensing.base.x=clamp(hitPoint.x,bounds.left,bounds.right);condensing.base.z=clamp(hitPoint.z,bounds.back,bounds.front);condensing.group.position.copy(condensing.base);}return true;
    }
    if(fogDrawing){
      if(groundAtEvent(e)){if(lastFogPoint){const distance=lastFogPoint.distanceTo(hitPoint),steps=Math.min(32,Math.floor(distance/.48));if(steps>0){tempPoint.copy(lastFogPoint);for(let i=1;i<=steps;i++)emitFog(tempPoint.clone().lerp(hitPoint,i/steps));fogBrushClock=0;lastFogPoint.copy(hitPoint);}}else lastFogPoint=hitPoint.clone();}return true;
    }
    if(windDrawing){
      if(groundAtEvent(e)&&lastWindPoint){windVec.set(hitPoint.x-lastWindPoint.x,hitPoint.z-lastWindPoint.z);const distance=windVec.length();if(distance>.025){const now=eventSeconds(e),pointerDt=clamp(now-(lastPointer?.time??now),.008,.18),strength=clamp(distance/pointerDt*.11,.22,1);windVec.normalize();emitWind(hitPoint,windVec,strength);onWind?.(hitPoint.clone(),windVec.clone(),strength);lastWindPoint.copy(hitPoint);lastPointer={x:e.clientX,y:e.clientY,time:now};}}return true;
    }return false;
  }
  function pointerUp(){
    let handled=false;if(grab){const c=grab;c.grabbed=false;c.base.copy(c.group.position);c.held=0;c.rainTarget=c.stormRain||0;c.compression=0;grab=null;stats.grabbedCloud=null;onCloudRelease?.(c);handled=true;}if(windDrawing){windDrawing=false;lastWindPoint=null;handled=true;}if(condensing){condensing=null;stats.condensingCloud=null;handled=true;}if(fogDrawing){fogDrawing=false;lastFogPoint=null;handled=true;}lastPointer=null;shakeSigns=[];return handled;
  }
  function setTool(value){pointerUp();tool=value;stats.tool=value;}

  function update(dt,state){
    dt=Math.min(Math.max(dt,0),.1);elapsed=Number.isFinite(state.time)?state.time:elapsed+dt;
    const day=clamp(state.daylight??1,0,1),windStrength=clamp(state.windStrength??0,0,1),wind=state.windVector2??state.wind??{x:1,y:0};
    const wx=(wind.x??0)*windStrength,wz=(wind.y??wind.z??0)*windStrength;precipitationWind.set(wx,wz);
    const globalRain=clamp(Math.max(manualRain,state.rain??0),0,1);smoothRain=damp(smoothRain,globalRain,2.2,dt);
    sunDirection.copy(state.sunDirection??normal.set(-.6,.85,.25)).normalize();camera.getWorldPosition(worldCamera);lightningUniforms.uCamera.value.copy(worldCamera);
    let localRain=0,stormCloudCoverage=0;const completedMerges=[];
    if(grab)checkDraggedMerge();
    for(const c of clouds){
      if(c.mergingInto){const survivor=c.mergingInto;c.mergeAge+=dt;const transition=cloudMergeEnvelope(c.mergeAge);c.group.position.copy(c.mergeOrigin).lerp(survivor.group.position,transition.progress*.70);c.size=c.mergeOriginalSize;c.opacity=1;c.density=transition.density;c.mesh.scale.set(1.60*c.size,1.52*c.size,1.55*c.size);c.proxy.visible=false;if(transition.complete)completedMerges.push(c);}
      const stormEvent=stepCloudStorm(c,dt);if(stormEvent.strike&&!c.mergingInto)triggerLightning(c,'cloud-merge');
      if(c.mergingInto){c.rain=0;c.rainTarget=0;}
      else if(c.grabbed){c.held+=dt;c.rainTarget=Math.max(c.stormRain,clamp((c.held-.18)*.7+c.compression,0,1));c.velocity.multiplyScalar(Math.exp(-dt*6));}
      else{
        c.rainTarget=c.stormRain;
        if(c!==condensing){
          if(c.defaultAnchor){
            // Bounded world-space cloud drift. A gentle wind bias oscillates
            // instead of accumulating until the cloud hits a scene boundary.
            // Absolute time keeps fixed captures and long seeks deterministic.
            const a=c.defaultAnchor,phase=c.id*1.7;
            c.base.set(a.x+(Math.sin(elapsed*.055+phase)-Math.sin(phase))*.17+Math.sin(elapsed*.037)*wx*.10,a.y,a.z+(Math.cos(elapsed*.047+phase)-Math.cos(phase))*.12+Math.sin(elapsed*.031)*wz*.08);
            c.velocity.set(0,0,0);
          }else{c.base.addScaledVector(c.velocity,dt);c.base.x+=wx*dt*.055;c.base.z+=wz*dt*.055;c.velocity.multiplyScalar(Math.exp(-dt*.85));}
          for(const [axis,lo,hi] of [['x',bounds.left,bounds.right],['y',bounds.bottom,bounds.top],['z',bounds.back,bounds.front]]){
            if(c.base[axis]<lo){c.base[axis]=lo;c.velocity[axis]=Math.abs(c.velocity[axis])*.48;}else if(c.base[axis]>hi){c.base[axis]=hi;c.velocity[axis]=-Math.abs(c.velocity[axis])*.48;}
          }
        }
        c.group.position.set(c.base.x+Math.sin(elapsed*.19+c.id*2)*.055,c.base.y+Math.sin(elapsed*.31+c.id)*.035,c.base.z+Math.cos(elapsed*.17+c.id)*.04);
      }
      if(Number.isFinite(c.volumeBlendAge)){c.volumeBlendAge+=dt;const optical=cloudMergeEnvelope(c.volumeBlendAge);c.targetSize=Math.cbrt(c.mergeStartSize**3+(c.mergeFinalSize**3-c.mergeStartSize**3)*(1-optical.density));if(optical.complete)c.volumeBlendAge=undefined;}
      if(c===condensing)c.targetSize=Math.min(1.18,c.targetSize+dt*.42);
      // Mass handover and condensation may grow monotonically; grabbing never
      // squeezes, stretches or spring-scales a cloud.
      if(!c.mergingInto){c.size=clamp(c.targetSize,.15,1.60);c.sizeVelocity=0;}
      c.rain=damp(c.rain,c.rainTarget,c.grabbed?4:c.stormRain>.01?2.5:1.1,dt);localRain=Math.max(localRain,c.rain);
      if(!c.mergingInto){
      c.squeeze=c.squeezeVelocity=0;c.mesh.scale.set(1.60*c.size,1.52*c.size,1.55*c.size);c.proxy.scale.set(1.65*c.size,.97*c.size,1.50*c.size);
      }
      c.group.updateMatrixWorld(true);inverseCloud.copy(c.mesh.matrixWorld).invert();localCamera.copy(worldCamera).applyMatrix4(inverseCloud);c.material.uniforms.uCamera.value.copy(localCamera);c.material.uniforms.uSun.value.copy(sunDirection).transformDirection(inverseCloud);c.material.uniforms.uTime.value=elapsed;c.material.uniforms.uDay.value=day;c.material.uniforms.uRain.value=Math.max(c.rain,smoothRain);c.material.uniforms.uStorm.value=Math.max(c.storm,smoothRain*.8);c.material.uniforms.uOpacity.value=c.opacity;c.material.uniforms.uDensity.value=c.density;c.material.uniforms.uFlash.value=lightningStrength;c.shadowOpacity=(.16+c.storm*.40)*c.density;stormCloudCoverage+=c.storm*c.size*c.size*.10*c.density;
    }
    for(const c of completedMerges){const index=clouds.indexOf(c);if(index>=0)clouds.splice(index,1);c.group.removeFromParent();c.material.dispose();const mi=ownedMaterials.indexOf(c.material);if(mi>=0)ownedMaterials.splice(mi,1);}
    stats.mergeInProgress=clouds.filter(c=>c.mergingInto).length;
    // Source rates remain separate from the global rain state. One source at
    // 20% receives 20% of its full particle budget, with no second thinning pass.
    const emitters=[];let rainWeight=0,snowWeight=0;
    for(const c of clouds){
      if(c.mergingInto)continue;const rate=Math.max(c.rain,smoothRain);if(rate<.001)continue;
      const ground=surfaceHeight(c.group.position.x,c.group.position.z),temperature=Number.isFinite(state.temperature)?state.temperature-(state.lapseRate??.7)*Math.max(0,ground-.3):null;
      const snowFraction=temperature===null?clamp(state.snow??0,0,1):1-THREE.MathUtils.smoothstep(temperature,-1.5,2);
      const emitter={id:c.id,x:c.group.position.x,z:c.group.position.z,y:c.group.position.y-c.mesh.scale.y*.29,radius:Math.max(.4,c.mesh.scale.x*.83),rate,snowFraction};
      emitters.push(emitter);rainWeight+=rate*(1-snowFraction);snowWeight+=rate*snowFraction;
    }
    const snowUnit=snow.count/3*Math.min(1,3/Math.max(3,snowWeight));
    const active=rainfall.update(dt,{time:elapsed,emitters,windX:wx,windZ:wz,camera,daylight:day,state});let snowActive=0;
    for(const em of emitters){
      const snowQuota=Math.floor(snowUnit*em.rate*em.snowFraction);
      for(let n=0;n<snowQuota&&snowActive<snow.count;n++){
        const i=snowActive++,j=i*4,angle=snowSeeds[j]*Math.PI*2,radius=Math.sqrt(snowSeeds[j+1])*em.radius,speed=.5+snowSeeds[j+3]*.65;
        const sx=em.x+Math.cos(angle)*radius,sz=em.z+Math.sin(angle)*radius*.72,landingX=clamp(sx+wx*em.y*.36,-5.98,5.98),landingZ=clamp(sz+wz*em.y*.36,-5.28,4.28),bottom=surfaceHeight(landingX,landingZ)+.045,fall=Math.max(.15,em.y-bottom),u=(snowSeeds[j+2]+elapsed*speed/fall)%1,y=em.y-u*fall;
        const x=clamp(sx+Math.sin(elapsed*.66+angle*7)*.16+wx*(em.y-y)*.36,-5.98,5.98),z=clamp(sz+Math.cos(elapsed*.51+angle*5)*.15+wz*(em.y-y)*.36,-5.28,4.28),ground=surfaceHeight(x,z)+.045;
        snow.positions[i*3]=x;snow.positions[i*3+1]=Math.max(y,ground);snow.positions[i*3+2]=z;
      }
    }
    impacts.update(elapsed,state,renderer.domElement.clientHeight||720);
    snow.geometry.setDrawRange(0,snowActive);snow.object.visible=snowActive>0;snow.material.uniforms.uOpacity.value=.78;snow.material.uniforms.uTime.value=elapsed;
    if(snowActive>0)snow.geometry.attributes.position.needsUpdate=true;

    const fog=clamp(state.fog??0,0,1);mist.material.uniforms.uOpacity.value=fog*.33;mist.material.uniforms.uTime.value=elapsed;mist.material.uniforms.uDay.value=day;mist.material.uniforms.uSun.value.copy(sunDirection);mist.material.uniforms.uCamera.value.copy(worldCamera);mist.material.uniforms.uFlash.value=lightningStrength;mist.object.visible=fog>.002;mist.geometry.instanceCount=mist.count;
    for(let i=0;i<mist.count;i++){const s=mist.seeds[i],a=i/mist.count*Math.PI*8,rad=.3+s*1.8,x=.7+Math.sin(a+elapsed*.055)*rad+wx*.2,z=1.45+Math.cos(a*.7+elapsed*.04)*2.55+wz*.2;mist.centers[i*3]=x;mist.centers[i*3+1]=surfaceHeight(x,z)+.35+Math.sin(a*1.4+elapsed*.25)*.055+s*.18;mist.centers[i*3+2]=z;mist.scales.set([1.15+s*.7,.48+s*.16,.92+s*.5],i*3);mist.alphas[i]=1;}mist.geometry.attributes.aCenter.needsUpdate=true;mist.geometry.attributes.aScale.needsUpdate=true;mist.geometry.attributes.aOpacity.needsUpdate=true;
    if(fogDrawing&&lastFogPoint){fogBrushClock+=dt;if(fogBrushClock>.24){fogBrushClock=0;emitFog(lastFogPoint);}}
    let liveFog=0;const visibleFog=[];
    for(const patch of fogPatches){
      patch.age+=dt;if(patch.age-(patch.lastFed??0)>=patch.life)continue;
      patch.x+=wx*dt*.11+Math.sin(elapsed*.31+patch.seed*10)*dt*.018;patch.z+=wz*dt*.11+Math.cos(elapsed*.27+patch.seed*12)*dt*.014;
      patch.y=damp(patch.y,surfaceHeight(patch.x,patch.z)+.39+Math.sin(elapsed*.5+patch.seed*10)*.05,2,dt);
      visibleFog.push(patch);
    }
    // Back-to-front instance order makes normal alpha blending consistent.
    visibleFog.sort((a,b)=>((b.x-worldCamera.x)**2+(b.y-worldCamera.y)**2+(b.z-worldCamera.z)**2)-((a.x-worldCamera.x)**2+(a.y-worldCamera.y)**2+(a.z-worldCamera.z)**2));
    for(const patch of visibleFog){const i=liveFog++,spread=(1+1.18*(1-Math.exp(-patch.age*1.35)))*(1+(patch.feed??0)*.18),lift=Math.min(.15,patch.age*.015);brushMist.centers.set([patch.x,patch.y+lift,patch.z],i*3);brushMist.scales.set([patch.radius*spread,patch.radius*(.55+.20*(1-Math.exp(-patch.age*1.1))),patch.radius*spread*.90],i*3);brushMist.seeds[i]=patch.seed;brushMist.alphas[i]=fogEnvelope(patch.age,patch.life,patch.age-(patch.lastFed??0));}
    brushMist.geometry.instanceCount=liveFog;brushMist.object.visible=liveFog>0;brushMist.material.uniforms.uOpacity.value=.76;brushMist.material.uniforms.uTime.value=elapsed;brushMist.material.uniforms.uDay.value=day;brushMist.material.uniforms.uSun.value.copy(sunDirection);brushMist.material.uniforms.uCamera.value.copy(worldCamera);brushMist.material.uniforms.uFlash.value=lightningStrength;for(const attribute of['aCenter','aScale','aSeed','aOpacity'])brushMist.geometry.attributes[attribute].needsUpdate=true;
    const chimney=options.chimney??{x:-3.12,y:1.88,z:-.43};
    const night=Math.pow(1.-day,2);cabinGlow.position.set(chimney.x,chimney.y-.55,chimney.z+.36);cabinGlow.intensity=night*1.8;stars.object.visible=night>.015;stars.material.uniforms.uOpacity.value=night*.9;stars.material.uniforms.uTime.value=elapsed;flies.object.visible=night>.015;flies.material.uniforms.uOpacity.value=night;flies.material.uniforms.uTime.value=elapsed;
    if(flies.object.visible){for(let i=0;i<flies.count;i++){const s=flies.seeds[i],j=i*3;flies.positions[j]=flyOrigins[j]+Math.sin(elapsed*.5+s*80)*.32;flies.positions[j+1]=flyOrigins[j+1]+Math.sin(elapsed*.8+s*40)*.2;flies.positions[j+2]=flyOrigins[j+2]+Math.cos(elapsed*.4+s*27)*.35;}flies.geometry.attributes.position.needsUpdate=true;}
    if(windStrength>1.15){autoWindClock+=dt;if(autoWindClock>.10){autoWindClock=0;tempPoint.set((random()-.5)*10,.8+random()*1.5,(random()-.5)*8);emitWind(tempPoint,new THREE.Vector2(wx,wz),windStrength*.65);}}
    let liveTrails=0;
    for(const tr of trails){tr.age+=dt;if(tr.age<tr.life)liveTrails++;}
    // LineBasicMaterial also applies scene fog. Keep the complete old line
    // buffers while any trail is visible; only a fully hidden pool is idle.
    if(liveTrails>0){
      for(let i=0;i<trailCount;i++){const tr=trails[i],live=tr.age<tr.life,env=live?Math.sin(Math.PI*clamp(tr.age/tr.life,0,1)):0,speed=2.5+tr.strength*4,len=.6+tr.strength*2.;
        for(let j=0;j<trailSegments;j++){const k=(i*trailSegments+j)*6,a=j/trailSegments,b=(j+1)/trailSegments;for(let end=0;end<2;end++){const u=end?b:a,dist=tr.age*speed-u*len;trailPositions[k+end*3]=tr.origin.x+tr.dir.x*dist;trailPositions[k+end*3+1]=tr.origin.y+Math.sin(u*4+tr.seed*7+elapsed)*.055;trailPositions[k+end*3+2]=tr.origin.z+tr.dir.y*dist;const alpha=env*Math.sin(Math.PI*u)*.42;trailColors[k+end*3]=alpha*.8;trailColors[k+end*3+1]=alpha*.91;trailColors[k+end*3+2]=alpha;}}
      }trailGeo.attributes.position.needsUpdate=true;trailGeo.attributes.color.needsUpdate=true;
    }trailGeo.setDrawRange(0,liveTrails>0?trailCount*trailSegments*2:0);trailLines.visible=liveTrails>0;
    lightningAge+=dt;lightningStrength=lightningEnvelope(lightningAge);
    if(lightningStrength>0&&lightningOwner){
      // Keep the ground attachment fixed while the upper channel follows its
      // emitting cloud. Branches inherit the same continuous vertical warp.
      lightningDisplacement.copy(lightningOwner.group.position);lightningDisplacement.y+=lightningOwner.mesh.scale.y*.12;lightningDisplacement.sub(lightningSourceOrigin);
      const span=Math.max(.1,lightningSourceOrigin.y-lightningTarget.y);
      for(let i=0;i<lightningSegments*2;i++){const k=i*3,weight=clamp((lightningRestPositions[k+1]-lightningTarget.y)/span,0,1);lightningPositions[k]=lightningRestPositions[k]+lightningDisplacement.x*weight;lightningPositions[k+1]=lightningRestPositions[k+1]+lightningDisplacement.y*weight;lightningPositions[k+2]=lightningRestPositions[k+2]+lightningDisplacement.z*weight;}
      lightningInterleaved.needsUpdate=true;lightningGeo.attributes.position.needsUpdate=true;const source=lastStrike.source;source[0]=lightningSourceOrigin.x+lightningDisplacement.x;source[1]=lightningSourceOrigin.y+lightningDisplacement.y;source[2]=lightningSourceOrigin.z+lightningDisplacement.z;lightningLight.position.set(source[0],source[1]-1,source[2]);
    }
    lightningMat.opacity=lightningStrength;lightningLight.intensity=lightningStrength*110;lightningLines.visible=false;boltCore.visible=boltHalo.visible=lightningStrength>.004;lightningUniforms.uAlpha.value=lightningStrength;haloUniforms.uAlpha.value=lightningStrength*.72;for(const c of clouds)c.material.uniforms.uFlash.value=lightningStrength;mist.material.uniforms.uFlash.value=brushMist.material.uniforms.uFlash.value=lightningStrength;
    stats.defaultCloudAnchors=clouds.filter(c=>c.defaultAnchor).length;stats.defaultCloudLayout='centred unequal near/low, far/high and small/foreground masses; bounded drift, released by user interaction';stats.clouds=clouds.length;stats.rainDrops=active;stats.rainParcels=rainfall.stats;stats.rainMotion='world-birth-history-wind-relaxation';stats.cloudMerge='constant-lobe-density-handover';stats.lightningSourceFollowsCloud=true;stats.snowflakes=snowActive;stats.windTrails=liveTrails;stats.fogPatches=liveFog;stats.localRain=localRain;stats.effectiveRain=Math.max(smoothRain,localRain);stats.lightning=lightningStrength;stats.lightningSegments=lightningSegments;stats.lightningRibbonDraws=2;stats.cloudVolume='three-dimensional-lobed-depth-clamped-raymarch';stats.cloudElasticScale=false;stats.cloudDepthBound=!!sceneDepthTexture;stats.cloudFrontOcclusion='shared-camera-to-fragment-density';stats.lightningInsideCloud=true;stats.fogVolume='three-dimensional-brush-lobes';stats.fogRetained=liveFog;stats.lightningAge=lightningAge;
    stats.cloudPhases=clouds.map(c=>({id:c.id,phase:c.mergingInto?'absorbing':c.phase,storm:c.storm,rain:c.rain,opacity:c.opacity,density:c.density,size:c.size}));stats.stormCloudCoverage=Math.min(.65,stormCloudCoverage);
    prepareRender();
    return {rain:smoothRain,localRain,lightning:lightningStrength,emitters,stormCloudCoverage:stats.stormCloudCoverage};
  }

  function syncCloudRender(c,activeCamera=camera,activeRenderer=renderer){
    const u=c.material.uniforms;c.group.updateMatrixWorld(true);inverseCloud.copy(c.mesh.matrixWorld).invert();activeCamera.getWorldPosition(worldCamera);
    u.uCamera.value.copy(worldCamera).applyMatrix4(inverseCloud);u.uWorldMatrix.value.copy(c.mesh.matrixWorld);u.uSun.value.copy(sunDirection.lengthSq()?sunDirection:normal.set(-.6,.85,.25)).transformDirection(inverseCloud);
    u.uNear.value=activeCamera.near;u.uFar.value=activeCamera.far;activeRenderer.getCurrentViewport?.(u.uViewport.value);
    if(!activeRenderer.getCurrentViewport){const rect=activeRenderer.domElement.getBoundingClientRect();u.uViewport.value.set(0,0,rect.width,rect.height);}
    const source=lastStrike.source;u.uLightningLocal.value.set(...(source??[99,99,99])).applyMatrix4(inverseCloud);u.uFlash.value=lightningStrength;
  }
  function prepareRender(){for(const c of clouds){c.group.visible=cloudsVisible;if(cloudsVisible)syncCloudRender(c);}cloudOcclusion.sync(cloudsVisible?clouds:[],camera,elapsed);}
  function clearLightning(){lightningAge=99;lightningStrength=0;lightningOwner=null;lightningRibbonGeo.instanceCount=0;lightningGeo.setDrawRange(0,0);boltCore.visible=boltHalo.visible=lightningLines.visible=false;lightningLight.intensity=0;lightningUniforms.uAlpha.value=haloUniforms.uAlpha.value=0;stats.lightning=0;}
  function clearRain(){manualRain=smoothRain=0;for(const c of clouds){c.rain=c.rainTarget=c.stormRain=0;c.stormAge=99;c.storm=0;c.phase='clear';c.stormStrikeFired=true;}rainfall.reset();impacts.reset();}
  function setCloudVisibility(visible){cloudsVisible=!!visible;if(!cloudsVisible)pointerUp();prepareRender();stats.cloudsVisible=cloudsVisible;}
  function clearWind(){windDrawing=false;lastWindPoint=null;autoWindClock=0;for(const t of trails)t.age=99;trailLines.visible=false;stats.windTrails=0;}
  function reset(){
    pointerUp();for(const c of [...clouds]){c.group.removeFromParent();c.material.dispose();const i=ownedMaterials.indexOf(c.material);if(i>=0)ownedMaterials.splice(i,1);}clouds.length=0;nextCloudId=0;createDefaultClouds();
    smoothRain=manualRain=elapsed=autoWindClock=fogBrushClock=0;lastWindPoint=lastFogPoint=null;windDrawing=fogDrawing=false;shakeSigns=[];lastDX=0;lastShakeTime=-99;mergeSerial=0;lastMergeTime=-99;
    for(const p of fogPatches){p.age=99;p.life=0;p.feed=0;p.lastFed=0;}brushMist.alphas.fill(0);brushMist.geometry.instanceCount=0;brushMist.object.visible=mist.object.visible=false;mist.material.uniforms.uOpacity.value=0;
    for(const t of trails)t.age=99;trailGeo.setDrawRange(0,trailCount*trailSegments*2);trailLines.visible=false;trailIndex=0;snow.geometry.setDrawRange(0,0);snow.object.visible=false;
    rainfall.reset();impacts.reset();lightningAge=99;lightningSegments=lightningStrength=0;lightningOwner=null;lightningRibbonGeo.instanceCount=0;lightningGeo.setDrawRange(0,0);boltCore.visible=boltHalo.visible=lightningLines.visible=false;lightningLight.intensity=0;lightningUniforms.uAlpha.value=haloUniforms.uAlpha.value=0;
    Object.assign(lastStrike,{source:null,target:null,time:-99,reason:null});Object.assign(stats,{defaultCloudAnchors:3,cloudMerges:0,mergeInProgress:0,lastMerge:null,clouds:3,rainDrops:0,snowflakes:0,windTrails:0,fogPatches:0,fogFeeds:0,fogDeposits:0,localRain:0,effectiveRain:0,lightning:0,grabbedCloud:null,condensingCloud:null,stormCloudCoverage:0,fogRetained:0,lightningAge:99,lightningSegments:0,cloudPhases:clouds.map(c=>({id:c.id,phase:'clear',storm:0,rain:0,opacity:1,density:1,size:c.size})),resetCount:(stats.resetCount??0)+1});
    prepareRender();return true;
  }
  // Main advances weather sources, then the environment field, then this plume.
  // Its local wind therefore comes from this frame's field rather than a stale one.
  function updateSmoke(state={}){smoke.update(elapsed,state);stats.smoke=smoke.stats;}
  function dispose(){pointerUp();scene.remove(root);impacts.dispose();rainfall.dispose();smoke.dispose();for(const p of [snow,stars,flies,mist,brushMist]){p.geometry.dispose();p.material.dispose();}ownedGeometries.forEach(x=>x.dispose());ownedMaterials.forEach(x=>x.dispose());ownedTextures.forEach(x=>x.dispose());}
  return {update,prepareRender,reset,clearWind,setCloudVisibility,clearRain,clearLightning,getCloudOcclusion(){prepareRender();return cloudOcclusion;},updateSmoke,smoke,impacts,rainfall,captureExclusions:[root],precipitationObjects:[rainfall.object,snow.object,impacts.group],lightningObjects:[boltCore,boltHalo],hoverTarget(event){return cloudAtEvent(event)?'cloud':null;},setFlowSurfaceSampler(fn){flowSurfaceSampler=typeof fn==='function'?fn:null;for(let j=0;j<heightHeight;j++)for(let i=0;i<heightWidth;i++){const value=flowSurfaceSampler?.(-6+i/(heightWidth-1)*12,-5.3+j/(heightHeight-1)*9.6,elapsed,precipitationWind);flowHeightGrid[j*heightWidth+i]=typeof value==='number'?value:value?.height??value?.y??NaN;}},setSceneDepth(texture){sceneDepthTexture=texture??null;for(const c of clouds){c.material.uniforms.uSceneDepth.value=sceneDepthTexture;c.material.uniforms.uHasSceneDepth.value=texture?1:0;c.material.depthTest=!texture;}mist.setSceneDepth(texture);brushMist.setSceneDepth(texture);stats.fogSceneDepthBound=!!texture;},fogVolumes:{brush:brushMist,ambient:mist},setLakeSurfaceSampler(fn){lakeSurfaceSampler=typeof fn==='function'?fn:null;},setTool,pointerDown,pointerMove,pointerUp,triggerLightning,emitWind,emitFog,setRain(v){manualRain=clamp(v,0,1);},clouds,stats,dispose};
}
