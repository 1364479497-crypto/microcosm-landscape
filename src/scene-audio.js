// Default-on ambience. Autoplay is attempted; ordinary interaction resumes a blocked context.
// Environmental state owns the mix; animation seeks never replay old thunder.
export const AUDIO_CLIPS=Object.freeze({
 breeze:{file:'01_forest_breeze.mp3',loop:true,seconds:40,gain:2.0},
 leaves:{file:'02_leaf_gust.mp3',loop:true,seconds:4,gain:.32},
 waterfall:{file:'03_waterfall_body.mp3',loop:true,seconds:30,gain:.53,position:[.06,3.7,-2.8]},
 impact:{file:'04_waterfall_impact.mp3',loop:true,seconds:12,gain:.9,position:[.06,2.15,-2.22]},
 stream:{file:'05_stream_shallow.mp3',loop:true,seconds:2,gain:.36,position:[.2,.5,.4]},
 rainSoil:{file:'06_rain_leaves_soil.mp3',loop:true,seconds:5,gain:.28},
 rainPond:{file:'07_rain_pond.mp3',loop:true,seconds:32,gain:1.7,position:[1.1,0,2.9]},
 thunderClose:{file:'08_thunder_close.mp3',seconds:22,gain:.48},
 thunderDistant:{file:'09_thunder_distant.mp3',seconds:26,gain:.42},
 birds:{file:'10_small_bird_calls.mp3',loop:true,seconds:30,gain:.54}
});
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
export function audioMixTargets(state={},weather={}){
 const rain=clamp(state.effectiveRain??state.rain??0),day=clamp(state.daylight??1),winter=state.temperature<0;
 return {breeze:state.windPaused?0:.56+clamp(state.windStrength??.7)*.25,leaves:state.windPaused?0:clamp((state.windStrength??.7)/.7,.1,1.7),waterfall:1,impact:1,stream:1,rainSoil:winter?0:rain,rainPond:winter?0:rain,birds:day*(1-rain)*.9*(winter?.25:1)};
}
export function createSceneAudio({camera,button,volumeInput}={}){
 let context,master,compressor,analyser,timer,disposed=false,enabled=true,loading=null,hidden=false;
 const channels=new Map(),buffers=new Map(),voices=new Set(),transients=new Set(),pending=new Set(),sample=new Float32Array(512),lastParameters=new WeakMap();
 const stats={enabled:true,needsGesture:false,context:'uninitialized',decoded:0,total:10,playing:0,thunderEvents:0,splashEvents:0,errors:[],rms:0,volume:.65,targets:{},maxDecodedSeconds:0};
 let currentState={},currentWeather={};
 function ui(){if(!button)return;button.setAttribute('aria-pressed',String(enabled));button.setAttribute('aria-label',enabled?'关闭环境声音':'开启环境声音');button.removeAttribute('title');button.querySelector('span').textContent=enabled?'声音开':'声音关';}

 function setParam(param,value,tau=.2){if(context&&Math.abs((lastParameters.get(param)??Infinity)-value)>1e-6){param.setTargetAtTime(value,context.currentTime,tau);lastParameters.set(param,value);}}
 function createChannel(id,config){const gain=context.createGain();gain.gain.value=0;let destination=gain;let panner=null;
  if(config.position){panner=context.createPanner();panner.panningModel='equalpower';panner.distanceModel='inverse';panner.refDistance=12;panner.maxDistance=65;panner.rolloffFactor=.7;panner.positionX.value=config.position[0];panner.positionY.value=config.position[1];panner.positionZ.value=config.position[2];panner.connect(gain);destination=panner;}
  gain.connect(master);const row={id,config,gain,destination,panner,next:0,started:false};channels.set(id,row);return row;
 }
 async function decode(id,config){const response=await fetch(new URL('../assets/audio/runtime/'+config.file,import.meta.url));if(!response.ok)throw Error(config.file+': HTTP '+response.status);let decoded=await context.decodeAudioData(await response.arrayBuffer());
  // Bound resident memory for five-minute field recordings; originals are intact.
  const length=Math.min(decoded.length,Math.round(config.seconds*decoded.sampleRate));if(length<decoded.length){const cut=context.createBuffer(decoded.numberOfChannels,length,decoded.sampleRate);for(let c=0;c<decoded.numberOfChannels;c++)cut.copyToChannel(decoded.getChannelData(c).subarray(0,length),c);decoded=cut;}
  buffers.set(id,decoded);stats.decoded=buffers.size;stats.maxDecodedSeconds+=decoded.duration;createChannel(id,config);update(currentState,currentWeather);schedule();
 }
 function loopVoice(row,when){const buffer=buffers.get(row.id),source=context.createBufferSource(),envelope=context.createGain();source.buffer=buffer;const overlap=Math.min(.65,buffer.duration*.18),duration=buffer.duration,fade=Math.min(.45,overlap);
  source.connect(envelope);envelope.connect(row.destination);envelope.gain.setValueAtTime(0,when);envelope.gain.linearRampToValueAtTime(1,when+fade);envelope.gain.setValueAtTime(1,when+duration-overlap);envelope.gain.linearRampToValueAtTime(0,when+duration);source.start(when);source.stop(when+duration+.02);voices.add(source);source.onended=()=>{voices.delete(source);source.disconnect();envelope.disconnect();};row.next=when+duration-overlap;row.started=true;
 }
 function schedule(){if(!context||disposed||context.state!=='running')return;const now=context.currentTime;for(const row of channels.values())if(row.config.loop){if(!row.started)row.next=now+.04;if(row.next<now)row.next=now+.03;if(row.next<now+.25)loopVoice(row,row.next);}analyser.getFloatTimeDomainData(sample);stats.rms=Math.sqrt(sample.reduce((a,n)=>a+n*n,0)/sample.length);stats.playing=voices.size;}
 function resume(){if(!context||disposed||!enabled)return;if(context.state==='suspended'&&navigator.userActivation&&!navigator.userActivation.hasBeenActive){stats.context=context.state;stats.needsGesture=true;ui();return;}context.resume().then(()=>{stats.context=context.state;stats.needsGesture=context.state!=='running';schedule();ui();}).catch(e=>{stats.needsGesture=true;stats.errors.push(e.message);ui();});stats.context=context.state;stats.needsGesture=context.state!=='running';ui();}
 async function start(){if(disposed)return;enabled=true;stats.enabled=true;try{
  if(!context){const Ctor=window.AudioContext||window.webkitAudioContext;if(!Ctor)throw Error('此浏览器不支持环境声音');context=new Ctor({sampleRate:22050});master=context.createGain();master.gain.value=0;compressor=context.createDynamicsCompressor();compressor.threshold.value=-8;compressor.knee.value=14;compressor.ratio.value=5;compressor.attack.value=.006;compressor.release.value=.22;analyser=context.createAnalyser();analyser.fftSize=512;master.connect(compressor);compressor.connect(analyser);analyser.connect(context.destination);context.onstatechange=()=>{stats.context=context.state;stats.needsGesture=enabled&&context.state!=='running';ui();};}
  resume();timer??=setInterval(schedule,100);
  if(!loading&&buffers.size===0){loading=(async()=>{for(const id of ['breeze','waterfall','impact','leaves','stream','birds','rainSoil','rainPond','thunderClose','thunderDistant']){try{await decode(id,AUDIO_CLIPS[id]);}catch(e){stats.errors.push(id+': '+e.message);}await new Promise(r=>setTimeout(r,20));}})();ui();await loading;loading=null;}
  update(currentState,currentWeather);schedule();ui();
 }catch(e){stats.errors.push(e.message);enabled=false;stats.enabled=false;loading=null;ui();}}

 function autoStart(){if(!enabled||disposed)return;return start();}
 function mute(){enabled=false;stats.enabled=false;if(master)setParam(master.gain,0,.06);ui();}
 function toggle(){if(enabled)mute();else return start();}
 function update(state={},weather={}){currentState=state;currentWeather=weather;stats.targets=audioMixTargets(state,weather);if(!context||disposed)return;
  hidden=Boolean(document.hidden);setParam(master.gain,enabled&&!hidden?stats.volume:0,.12);for(const[id,row]of channels)setParam(row.gain.gain,(stats.targets[id]??0)*row.config.gain,.32);
  const listener=context.listener;if(camera){camera.updateMatrixWorld();const e=camera.matrixWorld.elements;for(const[axis,value]of [['positionX',e[12]],['positionY',e[13]],['positionZ',e[14]],['forwardX',-e[8]],['forwardY',-e[9]],['forwardZ',-e[10]],['upX',e[4]],['upY',e[5]],['upZ',e[6]]])if(listener[axis])setParam(listener[axis],value,.04);}
  analyser.getFloatTimeDomainData(sample);stats.rms=Math.sqrt(sample.reduce((a,n)=>a+n*n,0)/sample.length);stats.context=context.state;stats.playing=voices.size;
 }
 function oneShot(id,position,delay=0,level=1){if(!enabled||hidden||!context||context.state!=='running'||!buffers.has(id)||voices.size>24)return;const row=channels.get(id),source=context.createBufferSource(),gain=context.createGain();source.buffer=buffers.get(id);source.connect(gain);gain.gain.value=row.config.gain*level;
  let panner;if(position){panner=context.createPanner();panner.panningModel='equalpower';panner.refDistance=18;panner.rolloffFactor=.4;panner.positionX.value=position.x??position[0];panner.positionY.value=position.y??position[1];panner.positionZ.value=position.z??position[2];gain.connect(panner);panner.connect(master);}else gain.connect(master);
  source.start(context.currentTime+delay);voices.add(source);transients.add(source);source.onended=()=>{voices.delete(source);transients.delete(source);source.disconnect();gain.disconnect();panner?.disconnect();};
 }
 function thunder(event={}){if(!enabled||!context)return;const p=event.target??event.position??{x:0,y:0,z:0};const distance=camera?Math.hypot(camera.position.x-p.x,camera.position.y-p.y,camera.position.z-p.z):10;oneShot('thunderClose',p,clamp(distance*.025,.08,.65),.9);oneShot('thunderDistant',event.source??p,1.8,.46);stats.thunderEvents++;}
 function splash(position,strength=1){
  if(!enabled||hidden||!context||context.state!=='running'||disposed)return false;
  // Procedural water contact: a short filtered spray plus a descending bubble
  // resonance. Existing recordings remain the ambience, not a chopped thunder/loop.
  const now=context.currentTime,amp=clamp(strength,.15,1.3),duration=.38;
  const buffer=context.createBuffer(1,Math.ceil(context.sampleRate*duration),context.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++){const t=i/context.sampleRate;data[i]=(Math.random()*2-1)*Math.exp(-t*13)*(1-Math.exp(-t*350));}
  const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain(),panner=context.createPanner();
  source.buffer=buffer;filter.type='bandpass';filter.frequency.setValueAtTime(2300,now);filter.frequency.exponentialRampToValueAtTime(520,now+.23);filter.Q.value=.65;gain.gain.value=.58*amp;
  panner.panningModel='equalpower';panner.refDistance=18;panner.rolloffFactor=.4;panner.positionX.value=position.x;panner.positionY.value=position.y;panner.positionZ.value=position.z;
  source.connect(filter);filter.connect(gain);gain.connect(panner);panner.connect(master);source.start(now);
  const bubble=context.createOscillator(),bubbleGain=context.createGain();bubble.type='sine';bubble.frequency.setValueAtTime(930,now);bubble.frequency.exponentialRampToValueAtTime(185,now+.115);bubbleGain.gain.setValueAtTime(.0001,now);bubbleGain.gain.exponentialRampToValueAtTime(.20*amp,now+.009);bubbleGain.gain.exponentialRampToValueAtTime(.0001,now+.17);bubble.connect(bubbleGain);bubbleGain.connect(panner);bubble.start(now);bubble.stop(now+.2);
  for(const v of [source,bubble]){voices.add(v);transients.add(v);}
  bubble.onended=()=>{voices.delete(bubble);transients.delete(bubble);bubble.disconnect();bubbleGain.disconnect();};
  source.onended=()=>{voices.delete(source);transients.delete(source);source.disconnect();filter.disconnect();gain.disconnect();panner.disconnect();};stats.splashEvents++;return true;
 }
 function resetEffects(){for(const source of transients){try{source.stop()}catch{}}transients.clear();stats.thunderEvents=stats.splashEvents=0;}
 function setVolume(n){stats.volume=clamp(Number(n));if(volumeInput)volumeInput.value=String(Math.round(stats.volume*100));update(currentState,currentWeather);}
 const unlock=()=>{if(enabled){if(!context)start();else resume();}},onClick=()=>toggle(),onVolume=e=>setVolume(Number(e.target.value)/100),onVisibility=()=>{if(!context)return;if(document.hidden){setParam(master.gain,0,.03);for(const source of voices){try{source.stop()}catch{}}for(const row of channels.values())row.started=false;context.suspend().catch(()=>{});}else if(enabled){context.resume().then(()=>{schedule();update(currentState,currentWeather)}).catch(()=>{});}};
 button?.addEventListener('click',onClick);volumeInput?.addEventListener('input',onVolume);document.addEventListener('visibilitychange',onVisibility);for(const type of ['pointerdown','pointerup','click','keydown','wheel'])document.addEventListener(type,unlock,{capture:true,passive:true});ui();
 function dispose(){disposed=true;mute();clearInterval(timer);pending.forEach(clearTimeout);voices.forEach(s=>{try{s.stop()}catch{}});channels.clear();buffers.clear();button?.removeEventListener('click',onClick);volumeInput?.removeEventListener('input',onVolume);document.removeEventListener('visibilitychange',onVisibility);for(const type of ['pointerdown','pointerup','click','keydown','wheel'])document.removeEventListener(type,unlock,{capture:true});context?.close().catch(()=>{});}
 return {start,autoStart,mute,toggle,update,thunder,splash,setVolume,resetEffects,stats,dispose};
}
