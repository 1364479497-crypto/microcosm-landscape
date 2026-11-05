import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {SharedOpaquePass} from './shared-opaque-pass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createTerrain} from './terrain.js';
import {createVegetation} from './vegetation.js';
import {createProps} from './props.js';
import {createEnvironmentField,seasonalTemperature} from './environment.js';
import {createWeather} from './weather.js';
import {createWater} from './water.js';
import {createDaylightHandle} from './daylight.js';
import {createSceneFauna} from './scene-fauna.js';
import {ENVIRONMENT_LIGHTING,sampleEnvironmentLighting} from './environment-lighting.js';
import {installVegetationPalette} from './vegetation-palette.js';
import {createSceneAudio} from './scene-audio.js';
import {createSceneBackdrop} from './scene-backdrop.js';
import {createWeatherSelection,advanceSeason,describeSeason,SEASONS} from './scene-state.js';
import {createAdaptiveRendering} from './adaptive-rendering.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],params=new URLSearchParams(location.search),seed=Number(params.get('seed')||42),quality=params.get('quality')||'high';
const startup={moduleStartMs:performance.now(),stages:[],progress:[],firstLandscapeMs:null,readyMs:null};const stage=(name,start)=>startup.stages.push({name,ms:performance.now()-start,at:performance.now()});
let storedRenderMode='auto';try{storedRenderMode=localStorage.getItem('microcosm.render-mode')||'auto';}catch{}
const requestedRenderMode=params.get('render')||storedRenderMode;
const renderQuality=createAdaptiveRendering({nativePixelRatio:devicePixelRatio,maxRatio:quality==='high'?1.5:1,mode:['auto','clear','smooth','record'].includes(requestedRenderMode)?requestedRenderMode:'auto',viewport:{width:innerWidth,height:innerHeight},onRatio:applyRenderRatio,onMode:applyRenderBudget});
const errors=[];function failure(message){errors.push(message);$('#loading')?.remove();$('#failure').textContent='景观启动失败：'+message;$('#failure').classList.remove('hidden');}window.addEventListener('error',e=>failure(e.message));window.addEventListener('unhandledrejection',e=>failure(e.reason?.message||String(e.reason)));
async function loading(value,label){const el=$('#loading-progress');if(el)el.value=value;const percent=$('#loading-percent');if(percent)percent.textContent=value+'%';const phase=$('#loading-stage');if(phase)phase.textContent=label;startup.progress.push({value,label,at:performance.now()});await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));}
await loading(5,'准备山居');
const state={time:0,season:0,snow:0,wetness:0,temperature:15,lapseRate:2.2,wind:new THREE.Vector2(.85,.25).normalize(),windStrength:ENVIRONMENT_LIGHTING.baseWind,windPaused:false,daylight:1,rain:0,fog:0,hour:15,cycle:false,dayCycle:false,paused:params.has('paused'),sunDirection:new THREE.Vector3(-.6,1,.4).normalize(),cloudShadows:[],eventCounts:{cloudGrabs:0,lightning:0,windStrokes:0}};
let tapCandidate=null;let activePointerId=null,pointerOwner=null;const touchPoints=new Map(),orbitPointers=new Map();let replayTouch=false;const hoverRay=new THREE.Raycaster(),hoverNdc=new THREE.Vector2();
let stormCloudCoverage=0,lastManualStrike=-99;const weatherSelection=createWeatherSelection();state.weatherSelection=weatherSelection;
let seasonTarget=0,rainTarget=0,fogTarget=0,windPulse=0,flash=0,tool='orbit',frames=0,lastFrame=performance.now(),wallMs=16;
const scene=new THREE.Scene();scene.background=new THREE.Color('#201e19');scene.fog=new THREE.FogExp2('#201e19',.013);
// Scene edges are multisampled in the HDR composition target; the default
// framebuffer only receives a fullscreen OutputPass, so it needs no second MSAA.
const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance',preserveDrawingBuffer:false});renderer.setPixelRatio(renderQuality.ratio);renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.info.autoReset=false;$('#world').append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.1,90);camera.position.set(8.0,10.0,20.8);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.55,-.35);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=2.5;controls.maxDistance=40;controls.zoomToCursor=true;controls.zoomSpeed=1.15;controls.rotateSpeed=.7;controls.maxPolarAngle=1.48;controls.minPolarAngle=.3;
const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(new RoomEnvironment(),.025);scene.environment=environment.texture;scene.environmentIntensity=.13;pmrem.dispose();
const hemi=new THREE.HemisphereLight(0xc4d6df,0x4a3b27,.65);scene.add(hemi);const sun=new THREE.DirectionalLight(0xffe0ac,3.0);sun.position.set(-8,11,6);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-8.5,right:8.5,top:9,bottom:-8,near:.1,far:35});sun.shadow.normalBias=ENVIRONMENT_LIGHTING.shadowNormalBias;sun.shadow.bias=-.00013;sun.shadow.radius=ENVIRONMENT_LIGHTING.shadowRadius;sun.shadow.intensity=ENVIRONMENT_LIGHTING.shadowStrength;scene.add(sun);const moon=new THREE.DirectionalLight(0x94b9ed,.12);moon.position.set(-3,8,-4);scene.add(moon);const lightning=new THREE.PointLight(0xc2ddff,0,26,1.6);lightning.position.set(0,7,0);scene.add(lightning);const lightningFill=new THREE.DirectionalLight(0xdceaff,0);lightningFill.position.set(-2,10,3);scene.add(lightningFill,lightningFill.target);
const backdrop=createSceneBackdrop(scene,{renderer});
await loading(12,'整理山形');
let buildAt=performance.now();const field=createEnvironmentField(),terrain=createTerrain(scene,{seed,quality,field});field.setTerrain(terrain);stage('terrain',buildAt);await loading(25,'安放山居');
buildAt=performance.now();const props=createProps(scene,{terrain,seed});stage('props',buildAt);
const audio=createSceneAudio({camera,button:$('#sound-toggle'),volumeInput:$('#sound-volume')});
const weather=createWeather(scene,camera,renderer,{seed,quality,field,terrain,chimney:props.chimney,onCloudGrab(){state.eventCounts.cloudGrabs++;},onLightning(event){state.eventCounts.lightning++;audio.thunder(event);},onWind(p,d,s){if(state.windPaused)setWindPaused(false);state.eventCounts.windStrokes++;field.addWind(p,d,s);state.wind.copy(d);windPulse=Math.min(1,s+.25);}});
// All geometry and shaders stay covered until a complete valid frame exists.
await loading(36,'栽种林木与草甸');
buildAt=performance.now();const vegetation=createVegetation(scene,{terrain,field,seed,quality});terrain.setRootSources?.(vegetation.wind?.sites||[]);stage('vegetation',buildAt);const vegetationPalette=installVegetationPalette(vegetation.group);await loading(70,'铺设溪流与池塘');

const pondPalette=installVegetationPalette(props.group.getObjectByName('Lotus and small hardy waterlily in sheltered pond pockets')||new THREE.Group());
const water=createWater(scene,terrain.lake,{renderer,camera,terrain,field,bedHeightAt:props.pondBed.heightAt,receivers:[terrain.group,props.pondBed.group,props.fish.group]});water.setInputOccluders([props.group,vegetation.group]);
vegetation.setLakeSurfaceSampler((x,z,time,wind)=>water.sampleSurfaceHeight(x,z,time,wind),(x,z)=>water.compileSurfaceSampler(x,z));
props.setLakeSurfaceSampler((x,z,time,wind)=>water.sampleSurfaceHeight(x,z,time,wind));
await loading(82,'唤醒飞鸟与游鱼');
const fauna=createSceneFauna({terrain,vegetation,field,props,seed});scene.add(fauna.group);
fauna.setLakeSurfaceSampler((x,z,time,wind)=>water.sampleSurfaceHeight(x,z,time,wind));

water.setSceneDepthConsumer(depth=>weather.setSceneDepth(depth));
water.setCaptureExclusions(weather.captureExclusions||[weather.fogVolumes.brush.object,weather.fogVolumes.ambient.object]);
weather.setLakeSurfaceSampler?.((x,z,time,wind)=>water.sampleSurfaceHeight(x,z,time,wind));
weather.setFlowSurfaceSampler?.((x,z,time,wind)=>water.sampleFlowSurface?.(x,z,time,wind));
water.setCloudOcclusion?.(weather.getCloudOcclusion?.());
const daylightHandle=createDaylightHandle(scene,camera,renderer.domElement,h=>{state.hour=h;state.dayCycle=false;$('#time').value=h;syncCycles();});
const compositionTarget=new THREE.WebGLRenderTarget(innerWidth,innerHeight,{type:THREE.HalfFloatType,samples:0});
const composer=new EffectComposer(renderer,compositionTarget);composer.setSize(innerWidth,innerHeight);const scenePass=new SharedOpaquePass(scene,camera,water,[water.group,...weather.captureExclusions]);composer.addPass(scenePass);const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.12,.35,1.7);composer.addPass(bloom);
// Keep landscape detail readable throughout orbit and zoom. A fixed screen-space
// focus band blurred the waterfall and mountain peaks as they crossed the frame.
const edgeAA=new SMAAPass();composer.addPass(edgeAA);
composer.addPass(new OutputPass());
function applyRenderRatio(ratio){renderer.setPixelRatio(ratio);composer.setPixelRatio(ratio);water.resize?.(innerWidth,innerHeight);}
const renderBudgets = {
  clear:  {shadowHz: Infinity, colorHz: 15, reflectionHz: 8, waterScale: 1},
  auto:   {shadowHz: 12, colorHz: 12, reflectionHz: 6, waterScale: 1},
  smooth: {shadowHz: 8, colorHz: 10, reflectionHz: 5, waterScale: .85},
  record: {shadowHz: 4, colorHz: 12, reflectionHz: 3, waterScale: .85},
};
let shadowUpdatedAt = -Infinity, shadowHour = null, nextRecordingFrame = null;
const renderBudget = {shadowUpdates: 0, frameCap: null};
function applyRenderBudget() {
  const mode = renderQuality.mode;
  const budget = renderBudgets[mode];
  Object.assign(renderBudget,budget,{frameCap:mode==='record'?30:null});
  renderer.shadowMap.autoUpdate = mode === 'clear';
  renderer.shadowMap.needsUpdate = true;
  shadowUpdatedAt = -Infinity;
  nextRecordingFrame = null;
  scenePass.shared=mode==='record'||mode==='auto';
  edgeAA.enabled=mode==='record';
  const samples=quality==='high'&&mode==='clear'?2:0;
  for (const target of [composer.renderTarget1,composer.renderTarget2]) {
    if(target.samples===samples && Boolean(target.depthTexture)===scenePass.shared)continue;
    target.dispose();
    target.samples=samples;
    target.depthTexture=scenePass.shared?new THREE.DepthTexture(target.width,target.height,THREE.UnsignedIntType):null;
  }
  water.setRenderBudget(budget);
  updateRenderDetail();
}
function updateRenderDetail() {
  const mode=renderQuality.mode;
  const distance=camera.position.distanceTo(controls.target);
  const compact=mode==='smooth'||((mode==='record'||(mode==='auto'&&renderQuality.ratio<=.85))&&
    distance>(renderBudget.compactDetail?11:13));
  if (vegetation.setCompactDetail(compact)) {
    renderBudget.compactDetail=compact;
    shadowUpdatedAt=-Infinity;
    water.invalidateCaptures();
  }
}
function prepareShadow(now) {
  if (!renderer.shadowMap.autoUpdate && (shadowHour === null ||
      Math.abs(shadowHour-state.hour)>.065 || now-shadowUpdatedAt>=1000/renderBudget.shadowHz)) {
    renderer.shadowMap.needsUpdate = true;
    shadowUpdatedAt = now;
    shadowHour = state.hour;
    renderBudget.shadowUpdates++;
  }
}
const qualityControl=$('#render-quality');
qualityControl.value=renderQuality.mode;
qualityControl.onchange=e=>{
  renderQuality.setMode(e.target.value,performance.now());
  try{localStorage.setItem('microcosm.render-mode',renderQuality.mode);}catch{}
};
applyRenderBudget();
document.addEventListener('visibilitychange',()=>{renderQuality.setVisible(!document.hidden,performance.now());nextRecordingFrame=null;});
function setTool(t){if(activePointerId!==null)release({});tool=t;weather.setTool(t);controls.enableRotate=t==='orbit'||t==='cloud';controls.enablePan=true;$$('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===t);b.setAttribute('aria-pressed',String(b.dataset.tool===t));});}
$$('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
function stopCameraInertia(){const p=camera.position.clone(),q=camera.quaternion.clone(),target=controls.target.clone(),damping=controls.enableDamping;controls.enableDamping=false;controls.update();camera.position.copy(p);camera.quaternion.copy(q);controls.target.copy(target);controls.update();controls.enableDamping=damping;}
const canvas=renderer.domElement;
function cursorAt(e){if(activePointerId!==null){canvas.style.cursor='grabbing';return;}if(tool==='wind'||tool==='fog'||tool==='condense'){canvas.style.cursor='crosshair';return;}
 if(weather.hoverTarget?.(e)){canvas.style.cursor='grab';return;}
 const r=canvas.getBoundingClientRect();hoverNdc.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);camera.updateMatrixWorld();hoverRay.setFromCamera(hoverNdc,camera);const tree=vegetation.wind?.pick(hoverRay.ray),sunHit=[daylightHandle.sun,daylightHandle.moon].some(body=>body.visible&&hoverRay.intersectObject(body,false).length);
 canvas.style.cursor=tree||sunHit?'grab':'move';
}
const release=e=>{if(activePointerId!==null&&e.pointerId!==undefined&&e.pointerId!==activePointerId)return;const id=activePointerId;activePointerId=null;pointerOwner=null;daylightHandle.pointerUp();weather.pointerUp(e);vegetation.pointerUp?.();controls.enabled=true;if(id!==null&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);canvas.style.cursor='move';};
function cancelOrbit(id){for(const [pointerId,point]of [...orbitPointers])if(id===undefined||pointerId===id){orbitPointers.delete(pointerId);if(canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);canvas.dispatchEvent(new PointerEvent('pointercancel',{...point,pointerId,bubbles:true}));}stopCameraInertia();}
canvas.addEventListener('pointerdown',e=>{if(replayTouch){orbitPointers.set(e.pointerId,{pointerType:e.pointerType,clientX:e.clientX,clientY:e.clientY});return;}
 if(e.pointerType==='touch'){touchPoints.set(e.pointerId,{pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY,pointerType:'touch',button:0,buttons:1,bubbles:true,isPrimary:e.isPrimary});if(touchPoints.size>1){tapCandidate=null;if(activePointerId!==null){const first=touchPoints.get(activePointerId);release({});if(first){replayTouch=true;canvas.dispatchEvent(new PointerEvent('pointerdown',first));replayTouch=false;}}orbitPointers.set(e.pointerId,{pointerType:e.pointerType,clientX:e.clientX,clientY:e.clientY});return;}}
 if(activePointerId!==null)return;if(e.button!==0){orbitPointers.set(e.pointerId,{pointerType:e.pointerType,clientX:e.clientX,clientY:e.clientY});return;}let owner=null;
 if(weather.pointerDown(e))owner='weather';
 else if((tool==='orbit'||tool==='cloud')&&daylightHandle.pointerDown(e))owner='sun';
 else if((tool==='orbit'||tool==='cloud')&&vegetation.pointerDown?.(e,camera,canvas))owner='tree';
 if(owner){stopCameraInertia();controls.enabled=false;activePointerId=e.pointerId;pointerOwner=owner;canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';e.preventDefault();e.stopImmediatePropagation();}else{if(tool==='orbit'||tool==='cloud')tapCandidate={id:e.pointerId,x:e.clientX,y:e.clientY,at:performance.now(),moved:false};orbitPointers.set(e.pointerId,{pointerType:e.pointerType,clientX:e.clientX,clientY:e.clientY});canvas.style.cursor='grabbing';}
},{capture:true});
canvas.addEventListener('pointermove',e=>{if(tapCandidate?.id===e.pointerId&&Math.hypot(e.clientX-tapCandidate.x,e.clientY-tapCandidate.y)>6)tapCandidate.moved=true;if(e.pointerType==='touch'&&touchPoints.has(e.pointerId))Object.assign(touchPoints.get(e.pointerId),{clientX:e.clientX,clientY:e.clientY});if(activePointerId!==null&&e.pointerId!==activePointerId)return;if(pointerOwner==='sun')daylightHandle.pointerMove(e);else if(pointerOwner==='tree')vegetation.pointerMove?.(e,camera,canvas);else{weather.pointerMove(e);if(!pointerOwner&&(tool==='cloud'||tool==='orbit')&&!touchPoints.size)vegetation.pointerMove?.(e,camera,canvas);}if(!e.buttons&&e.pointerType!=='touch')cursorAt(e);});
// A wheel gesture always belongs to zoom, even if it begins while an object is held.
canvas.addEventListener('wheel',()=>{if(activePointerId!==null)release({});},{capture:true,passive:true});
function tapWater(e){const c=tapCandidate;tapCandidate=null;if(!c||c.id!==e.pointerId||c.moved||Math.hypot(e.clientX-c.x,e.clientY-c.y)>6||performance.now()-c.at>850||pointerOwner||touchPoints.size>1)return false;const r=canvas.getBoundingClientRect();hoverNdc.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);camera.updateMatrixWorld();hoverRay.setFromCamera(hoverNdc,camera);const p=water.pickSurface(hoverRay.ray);if(!p||!water.emitTouch(p,1))return false;audio.splash(p,1);state.eventCounts.waterTaps=(state.eventCounts.waterTaps||0)+1;return true;}
for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,e=>{if(type==='pointerup')tapWater(e);else tapCandidate=null;touchPoints.delete(e.pointerId);orbitPointers.delete(e.pointerId);release(e);},{capture:true});
canvas.addEventListener('lostpointercapture',e=>{if(orbitPointers.has(e.pointerId))cancelOrbit(e.pointerId);release(e);});window.addEventListener('blur',()=>{tapCandidate=null;cancelOrbit();touchPoints.clear();release({});});
setTool('orbit');

function syncCycles(){
 const phase=describeSeason(state.season,state.cycle),manualTransition=!state.cycle&&Math.abs(((seasonTarget-state.season+6)%4)-2)>.002,activeNode=manualTransition?Math.round(seasonTarget)%4:phase.node,cycle=$('#cycle');cycle.setAttribute('aria-pressed',String(state.cycle));cycle.setAttribute('aria-label',state.cycle?'暂停季节流转':'继续季节流转');cycle.classList.toggle('playing',state.cycle);cycle.querySelector('span').textContent=state.cycle?'暂停流转':'季节流转';
 $('#cycle-status').textContent=manualTransition?`切换至${SEASONS[activeNode]} · 过渡中`:phase.label;$('#cycle-progress').value=phase.phase;
 $$('[data-season]').forEach(b=>{const current=Number(b.dataset.season)===activeNode;b.classList.toggle('active',current);b.setAttribute('aria-pressed',String(current));if(current)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
 const day=$('#day-cycle');day.setAttribute('aria-pressed',String(state.dayCycle));day.setAttribute('aria-label',state.dayCycle?'暂停时间流转':'开始时间流转');day.classList.toggle('playing',state.dayCycle);day.querySelector('span').textContent=state.dayCycle?'暂停时间':'时间流转';
}
function selectSeason(s){seasonTarget=s;state.cycle=false;syncCycles();}
function setSeasonCycle(playing){state.cycle=Boolean(playing);seasonTarget=state.season;syncCycles();}
$$('[data-season]').forEach(b=>b.onclick=()=>selectSeason(Number(b.dataset.season)));$('#cycle').onclick=()=>setSeasonCycle(!state.cycle);$('#time').value=15;$('#time').oninput=e=>{state.hour=Number(e.target.value);state.dayCycle=false;syncCycles();};$('#day-cycle').onclick=()=>{state.dayCycle=!state.dayCycle;syncCycles();};
function syncWeather(){
 rainTarget=weatherSelection.rain?.7:0;fogTarget=weatherSelection.fog?.8:0;state.sunEnabled=weatherSelection.sun;weather.setCloudVisibility(weatherSelection.clouds);
 $$('[data-weather]').forEach(b=>{const selected=!!weatherSelection[b.dataset.weather];b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
}
function setWeather(name,enabled=true){
 if(name==='clear'||!name){Object.assign(weatherSelection,createWeatherSelection());weather.clearRain();weather.clearLightning();lastManualStrike=-99;syncWeather();return;}
 if(!(name in weatherSelection))return;weatherSelection[name]=Boolean(enabled);if(name==='rain'&&!enabled)weather.clearRain();if(name==='storm'){if(enabled){weather.triggerLightning(null,'weather-toggle');lastManualStrike=state.time;}else weather.clearLightning();}syncWeather();
}
$$('[data-weather]').forEach(b=>b.onclick=()=>setWeather(b.dataset.weather,!weatherSelection[b.dataset.weather]));
$('#reset').onclick=resetView;$('#wind-toggle').onclick=()=>setWindPaused(!state.windPaused);$('#reset-effects').onclick=resetEffects;$('#capture').onclick=()=>{renderScene();const a=document.createElement('a');a.download='世外桃源.png';a.href=renderer.domElement.toDataURL();a.click();};$('#fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();window.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.repeat||['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)||e.target?.isContentEditable)return;if(e.key.toLowerCase()==='h')document.body.classList.toggle('ui-hidden');if(e.key==='Escape')release({});});
function resetView(){cancelOrbit();camera.position.set(8,10,20.8);controls.target.set(0,1.55,-.35);stopCameraInertia();controls.update();}
function setWindPaused(value){state.windPaused=Boolean(value);if(state.windPaused){windPulse=0;state.windStrength=0;field.clearWind();weather.clearWind?.();}else state.windStrength=ENVIRONMENT_LIGHTING.baseWind;const button=$('#wind-toggle');button.setAttribute('aria-pressed',String(state.windPaused));(button.querySelector('span')||button).textContent=state.windPaused?'恢复风':'暂停风';}
function resetEffects(){tapCandidate=null;cancelOrbit();release({});touchPoints.clear();weather.reset?.();field.reset();water.reset?.();audio.resetEffects?.();
 Object.assign(state,{time:0,season:0,snow:0,wetness:0,rain:0,effectiveRain:0,fog:0,hour:15,cycle:false,dayCycle:false,paused:false,lightning:0,cloudShadows:[]});state.wind.set(.85,.25).normalize();state.eventCounts={cloudGrabs:0,lightning:0,windStrokes:0};seasonTarget=rainTarget=fogTarget=windPulse=flash=stormCloudCoverage=0;Object.assign(weatherSelection,createWeatherSelection());lastManualStrike=-99;
 const drag=vegetation.wind?.interaction;if(drag){drag.id=null;drag.held=false;drag.target.set(0,0);drag.bend.set(0,0);drag.velocity.set(0,0);drag.root.set(999,999,999,1);}
 setWindPaused(false);selectSeason(0);setTool('orbit');$('#time').value=15;$('#cycle').setAttribute('aria-pressed','false');$('#day-cycle').setAttribute('aria-pressed','false');syncWeather();syncCycles();resetView();update(0);water.touch.reset();props.fish.consumeSurfaceEvents?.();
}

function resize(){renderQuality.resize(devicePixelRatio,performance.now(),{width:innerWidth,height:innerHeight});camera.aspect=innerWidth/innerHeight;camera.fov=camera.aspect<1?THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(35)*.5)/camera.aspect)):35;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);water.resize?.(innerWidth,innerHeight);daylightHandle.setOccluders($$('.side-left,.side-right,.masthead,.top-actions').map(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));}window.addEventListener('resize',resize);
function update(dt){
 if(!state.paused){state.time+=dt;if(state.cycle){state.season=advanceSeason(state.season,dt,true);seasonTarget=state.season;}let delta=((seasonTarget-state.season+6)%4)-2;if(Math.abs(delta+2)<1e-6)delta=2;if(!state.cycle&&Math.abs(delta)<.002){state.season=seasonTarget;delta=0;}state.season=(state.season+delta*(1-Math.exp(-dt*1.8))+4)%4;if(state.dayCycle)state.hour=(state.hour+dt*.12)%24;}
 const theta=(state.hour-12)/12*Math.PI,solar=Math.cos(theta);state.daylight=THREE.MathUtils.smoothstep(solar,-.12,.4);document.body.classList.toggle('night-scene',state.daylight<.25);state.temperature=seasonalTemperature(state.season)+(state.daylight-.5)*3;state.snow=THREE.MathUtils.smoothstep(-state.temperature,-1,5);state.rain=THREE.MathUtils.damp(state.rain,rainTarget,2,dt);state.fog=THREE.MathUtils.damp(state.fog,fogTarget,1.4,dt);windPulse*=Math.exp(-dt*.65);state.windStrength=state.windPaused?0:ENVIRONMENT_LIGHTING.baseWind+windPulse*.9+(weatherSelection.storm?.35:0);state.sunDirection.set(-Math.sin(theta)*.95,Math.max(.2,solar),.55).normalize();sun.position.copy(state.sunDirection).multiplyScalar(16);const lightLevels=sampleEnvironmentLighting(state,stormCloudCoverage);sun.intensity=weatherSelection.sun?lightLevels.sun:0;state.sunIntensity=sun.intensity;sun.color.set(state.hour>16||state.hour<8?0xffbb7b:0xffe6c4);hemi.intensity=lightLevels.sky;state.sunRadiance??=new THREE.Color();state.sunRadiance.copy(sun.color).multiplyScalar(sun.intensity);moon.intensity=.08+(1-state.daylight)*.22;scene.environmentIntensity=lightLevels.environment;
 if(weatherSelection.storm&&state.time-lastManualStrike>=7.5){weather.triggerLightning(null,'weather-toggle');lastManualStrike=state.time;}daylightHandle.update(state);water.prepareFrame?.(dt,state);const outcome=weather.update(dt,state);stormCloudCoverage=outcome.stormCloudCoverage||0;flash=outcome.lightning||0;state.lightning=flash;backdrop.update(state);lightningFill.intensity=flash*6.5;hemi.intensity=lightLevels.sky+flash*1.25;const strike=weather.stats.lastStrike;if(strike?.source){lightning.position.fromArray(strike.source);lightningFill.position.fromArray(strike.source);lightningFill.target.position.fromArray(strike.target);}lightning.intensity=flash*90;state.effectiveRain=Math.max(state.rain,outcome.localRain||0);state.cloudShadows=weather.clouds.filter(c=>c.group.visible).map(c=>({x:c.group.position.x,z:c.group.position.z,y:c.group.position.y,rx:c.mesh.scale.x*1.1,rz:1.2,opacity:c.shadowOpacity??(.16+c.rain*.16)}));const emitters=outcome.emitters||weather.clouds.filter(c=>c.rain>.001).map(c=>({x:c.group.position.x,z:c.group.position.z,y:c.group.position.y,radius:1.15,rate:c.rain}));if(!outcome.emitters&&state.rain>.02)emitters.push({x:0,z:0,y:7,radius:8,rate:state.rain});field.update(dt,state,emitters);state.wetness=field.stats.meanWet;terrain.update(dt,state);vegetation.update(dt,state);props.update(dt,state);for(const event of props.fish.consumeSurfaceEvents?.()||[])water.emitTouch(new THREE.Vector3(event.x,event.y,event.z),event.strength??.22,event.time);weather.updateSmoke(state);water.update(dt,state,camera);fauna.update(dt,state);if(activePointerId===null)controls.update();audio.update(state,outcome);
}
// All translucent layers blend in the same linear HDR target. OutputPass owns the single display conversion.
let postAllowed=true;function renderScene(){prepareShadow(performance.now());bloom.enabled=postAllowed&&flash>.015;composer.render();}
function render(now){requestAnimationFrame(render);if(document.hidden){lastFrame=now;return;}
 if(renderBudget.frameCap){
  const interval=1000/renderBudget.frameCap;
  if(nextRecordingFrame!==null&&now+1<nextRecordingFrame)return;
  // Preserve refresh phase across small delays without queueing catch-up work.
  nextRecordingFrame=Math.max(now-interval*.5,nextRecordingFrame??now)+interval;
 }
 const realDt=Math.max(0,(now-lastFrame)/1000),dt=Math.min(.05,realDt);lastFrame=now;wallMs=wallMs*.95+realDt*1000*.05;renderQuality.sample(realDt*1000,now);renderer.info.reset();update(state.paused?0:dt);updateRenderDetail();weather.prepareRender?.();renderScene();frames++;if(frames===1){startup.readyMs=performance.now();setTimeout(()=>audio.autoStart(),0);}if(frames%5===0){syncCycles();const hour=Math.floor(state.hour),min=Math.floor(state.hour%1*60);$('#clock-label').textContent=String(hour).padStart(2,'0')+':'+String(min).padStart(2,'0');$('#weather-label').textContent=['春日','盛夏','深秋','冬日'][Math.round(state.season)%4]+' · '+(state.temperature<0?'雪':state.rain>.3?'雨':state.daylight<.2?'夜':'晴');}}
window.__MICROCOSM={startup,renderQuality,renderBudget,scenePass,backdrop,resetEffects,setWindPaused,state,scene,camera,controls,renderer,composer,lighting:{sun,hemi,moon,lightning,lightningFill},audio,vegetationPalette,pondPalette,terrain,world:terrain,vegetation,props,water,fauna,weather,field,daylightHandle,errors,setSeason:selectSeason,setSeasonCycle,setTool,setWeather,setHour:h=>state.hour=h,setPost(enabled){postAllowed=enabled;bloom.enabled=enabled;},simulate(seconds){const n=Math.round(seconds*30),paused=state.paused;state.paused=false;for(let i=0;i<n;i++)update(1/30);state.paused=paused;},stats:()=>({frames,frameTimeMs:wallMs,renderQuality:renderQuality.stats,render:{...renderer.info.render},memory:{...renderer.info.memory},terrain:terrain.stats,vegetation:vegetation.stats,props:props.stats,water:water.stats,fauna:fauna.stats,weather:weather.stats,audio:audio.stats,input:{tool,pointerOwner,activePointerId,orbitEnabled:controls.enableRotate},field:field.stats,route:'INDEPENDENT_IMPLEMENTATION'}),fixed({season=0,hour=15,time=0,rain=0,fog=0}={}){state.paused=true;state.cycle=false;seasonTarget=state.season=season;state.hour=hour;state.time=time;state.rain=rainTarget=rain;state.fog=fogTarget=fog;syncCycles();}};
syncWeather();syncCycles();resize();update(0);await loading(90,'准备云水与光影');
if(renderer.compileAsync)await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);
await loading(97,'完成景观');weather.prepareRender?.();renderScene();startup.firstLandscapeMs=performance.now();
await loading(100,'就绪');$('#loading')?.remove();startup.coverRemovedMs=performance.now();lastFrame=performance.now();renderQuality.ready(lastFrame);requestAnimationFrame(render);
