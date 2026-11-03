import * as THREE from 'three';
import {BUTTERFLY_CC0_ASSET} from '../assets/butterfly-cc0/data.js';
import {normalizeSeason,seasonalProfile,meadowBloomForType} from './seasonal-phenology.js';

// Twenty-six photo-informed authored butterflies plus four CC0 art assets.
// Original CC0 geometry/UV/RGBA live under assets/butterfly-cc0; references
// inform anatomy, while the motion/host adapter here is independently authored.
const TAU=Math.PI*2,UP=new THREE.Vector3(0,1,0),AXIS=new THREE.Vector3(0,0,1);
const clamp=THREE.MathUtils.clamp,mix=THREE.MathUtils.lerp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const ease=x=>x*x*x*(10+x*(-15+6*x));
const random=seed=>{let s=seed>>>0;return()=>{s+=0x6d2b79f5;let a=s;a=Math.imul(a^a>>>15,a|1);a^=a+Math.imul(a^a>>>7,a|61);return((a^a>>>14)>>>0)/4294967296;};};
const colour=x=>new THREE.Color(x);
const angleMix=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
const TIP=new THREE.Vector3(0,-.16,.40);
export const BUTTERFLY_SPEC=Object.freeze({
 smallWhite:Object.freeze({scientific:'Pieris rapae',count:18,openSpan:[.0245,.0293],identity:'Cream-white upper wings, dark forewing tip and discal spots; pale yellow underside; club antennae'}),
 paintedLady:Object.freeze({scientific:'Vanessa cardui',count:8,openSpan:[.0290,.0338],identity:'Orange and dark-brown upper pattern, white forewing-tip spots; muted mottled underside with hindwing eyespots'}),
 artisticOrange:Object.freeze({scientific:null,label:'CC0 artistic orange butterfly',count:4,openSpan:[.0300,.0338],identity:'Unidentified artistic orange butterfly: original CC0 outline, UV, body/legs/antennae and 512×512 diffuse by Čestmír Dammer; no native-species claim'}),
 scaleOwner:'Retains the accepted miniature open-span range, below .095 of case door .367; these are not literal species metres.',
 flight:'Authored nectar visits and smooth low meadow travel with independent phase; not aerodynamic or pollination simulation.'
});

class Forms{
 constructor(){this.p=[];this.c=[];this.i=[];}
 vertex(p,c){const n=this.p.length/3;this.p.push(p.x,p.y,p.z);this.c.push(c.r,c.g,c.b);return n;}
 tri(a,b,c){this.i.push(a,b,c);}
 append(g,c){const off=this.p.length/3,p=g.attributes.position;for(let i=0;i<p.count;i++)this.vertex(new THREE.Vector3().fromBufferAttribute(p,i),c);if(g.index)this.i.push(...Array.from(g.index.array,n=>n+off));else for(let i=0;i<p.count;i++)this.i.push(off+i);g.dispose();}
 geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));g.setIndex(this.i);g.computeVertexNormals();g.computeBoundingSphere();return g;}
}
function ellipsoid(b,center,size,c){const g=new THREE.SphereGeometry(1,8,5);g.scale(...size);g.translate(...center);b.append(g,c);}
function rod(b,a,z,r,c,sides=5){a=new THREE.Vector3(...a);z=new THREE.Vector3(...z);const d=z.clone().sub(a),g=new THREE.CylinderGeometry(r*.78,r,d.length(),sides);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP,d.clone().normalize()));g.translate(...a.add(z).multiplyScalar(.5).toArray());b.append(g,c);}
function surfaceY(x,z,lobe){return .018*Math.sin(clamp(x,0,1)*Math.PI)+.008*Math.sin(z*3)+(lobe===0?.009:0);}
function spot(b,x,z,rx,rz,c,lobe,top=true){const y=surfaceY(x,z,lobe)+(top?.0035:-.0035),center=b.vertex(new THREE.Vector3(x,y,z),c),ring=[];for(let i=0;i<12;i++){const a=i/12*TAU,xx=x+Math.cos(a)*rx,zz=z+Math.sin(a)*rz;ring.push(b.vertex(new THREE.Vector3(xx,surfaceY(xx,zz,lobe)+(top?.0038:-.0038),zz),c));}for(let i=0;i<12;i++)top?b.tri(center,ring[(i+1)%12],ring[i]):b.tri(center,ring[i],ring[(i+1)%12]);}
function vein(b,a,z,width,c,lobe,top){const d=new THREE.Vector2(z[0]-a[0],z[1]-a[1]).normalize(),side=new THREE.Vector2(-d.y,d.x).multiplyScalar(width),vs=[];for(const p of [a,z])for(const s of [-1,1]){const x=p[0]+side.x*s,zz=p[1]+side.y*s;vs.push(b.vertex(new THREE.Vector3(x,surfaceY(x,zz,lobe)+(top?.004:-.004),zz),c));}if(top){b.tri(vs[0],vs[1],vs[3]);b.tri(vs[0],vs[3],vs[2]);}else{b.tri(vs[0],vs[3],vs[1]);b.tri(vs[0],vs[2],vs[3]);}}
function wingGeometry(kind,side){
 const b=new Forms(),painted=kind==='paintedLady',dark=colour('#34332d'),cream=colour('#eee8d6'),white=colour('#f0eee0'),orange=colour('#ce8a48');
 const outlines=[[[.035,.12],[.23,.39],[.55,.62],[.78,.63],[.95,.51],[1,.34],[.95,.18],[.82,.07],[.53,-.045],[.19,-.08]],[[.035,.045],[.31,.07],[.57,-.035],[.76,-.19],[.75,-.31],[.68,-.43],[.53,-.55],[.36,-.61],[.20,-.56],[.075,-.34]]];
 for(let lobe=0;lobe<2;lobe++){
  const outline=outlines[lobe],center=lobe===0?[.38,.22]:[.34,-.25];
  for(const top of [true,false]){
   const base=painted?(top?orange:colour('#9d9478')):(top?white:colour('#d5d7ad')),offset=top?.0015:-.0015;
   const ci=b.vertex(new THREE.Vector3(center[0],surfaceY(...center,lobe)+offset,center[1]),base),rings=[];
   for(const radius of [.48,.80,1]){
    const ring=[];for(let i=0;i<outline.length;i++){const[x,z]=outline[i],xx=mix(center[0],x,radius),zz=mix(center[1],z,radius),edge=radius>.99,tip=lobe===0&&xx>.77&&zz>.23;let c=base.clone().multiplyScalar(.93+.07*radius);if(top&&tip)c.copy(dark);if(top&&painted&&edge)c.copy(dark);if(!top&&painted&&edge)c.copy(cream).multiplyScalar(.8);ring.push(b.vertex(new THREE.Vector3(xx,surfaceY(xx,zz,lobe)+offset,zz),c));}rings.push(ring);
   }
   for(let i=0;i<outline.length;i++){const k=(i+1)%outline.length,emit=(a,c,d)=>top?b.tri(a,c,d):b.tri(a,d,c);emit(ci,rings[0][i],rings[0][k]);for(let j=0;j<2;j++){emit(rings[j][i],rings[j+1][i],rings[j+1][k]);emit(rings[j][i],rings[j+1][k],rings[j][k]);}}
   const vcolour=(painted?dark:colour('#9a9d81')).clone().multiplyScalar(top?.86:.92);
   for(let j=2;j<outline.length-1;j++)vein(b,[.07,lobe===0?.10:-.04],outline[j],.0023,vcolour,lobe,top);
   if(lobe===0){
    if(painted){for(const [x,z,rx,rz]of [[.79,.47,.055,.045],[.89,.37,.033,.039],[.68,.48,.045,.036]])spot(b,x,z,rx,rz,cream,lobe,top);for(const[x,z]of [[.36,.26],[.56,.14],[.58,.36]])spot(b,x,z,.05,.06,top?dark:cream,lobe,top);}
    else{spot(b,.54,.22,.053,.050,dark,lobe,top);if(top)spot(b,.40,.04,.039,.034,dark,lobe,top);}
   }else if(painted){
    for(const [x,z]of [[.21,-.45],[.34,-.49],[.47,-.44],[.59,-.36]]){spot(b,x,z,.055,.046,top?dark:cream,lobe,top);if(!top){spot(b,x,z,.035,.029,dark,lobe,false);spot(b,x,z,.010,.010,cream,lobe,false);}}
   }else if(top)spot(b,.18,-.07,.032,.030,dark,lobe,true);
  }
 }
 const g=b.geometry();if(side<0){g.scale(-1,1,1);const a=g.index.array;for(let i=0;i<a.length;i+=3){const t=a[i+1];a[i+1]=a[i+2];a[i+2]=t;}g.index.needsUpdate=true;g.computeVertexNormals();}return g;
}
function bodyGeometry(){const b=new Forms(),dark=colour('#49483b'),light=colour('#8d8c73');ellipsoid(b,[0,0,-.22],[.055,.052,.31],dark);ellipsoid(b,[0,.012,0],[.077,.074,.15],light);ellipsoid(b,[0,.025,.195],[.055,.055,.062],dark);for(const s of [-1,1]){rod(b,[s*.022,.05,.22],[s*.13,.12,.47],.005,light);ellipsoid(b,[s*.13,.12,.47],[.017,.016,.023],dark);ellipsoid(b,[s*.046,.04,.205],[.018,.023,.022],colour('#242a24'));for(const z of[-.08,.02,.11]){rod(b,[s*.04,-.025,z],[s*.11,-.06,z+.04],.0037,dark);rod(b,[s*.11,-.06,z+.04],[s*.16,-.16,z+.085],.0029,dark);}}return b.geometry();}
function proboscisGeometry(){const b=new Forms(),c=colour('#484438');rod(b,[0,.00,.25],[0,-.06,.33],.0036,c);rod(b,[0,-.06,.33],TIP.toArray(),.0025,c);return b.geometry();}

function cc0Geometry(part){const d=BUTTERFLY_CC0_ASSET.parts[part],g=new THREE.BufferGeometry();for(const [n,key,size]of[['position','position',3],['normal','normal',3],['uv','uv',2]])g.setAttribute(n,new THREE.Float32BufferAttribute(d[key],size));g.setIndex(d.index);g.computeBoundingSphere();return g;}
function cc0Texture(){const t=BUTTERFLY_CC0_ASSET.texture,b=globalThis.atob(t.rgbaBase64),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);const texture=new THREE.DataTexture(a,t.width,t.height,THREE.RGBAFormat,THREE.UnsignedByteType);texture.name='Exact CC0 butterfly-skin.png RGBA';texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=true;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;return texture;}

function inspectFlowerHosts(terrain,vegetation){
 const flora=vegetation?.group?.userData.flora,habitat=vegetation?.group?.userData.habitat,hosts=[];
 if(!flora?.group||!habitat?.sample)return{hosts,flora,habitat};
 const byRoot=new Map();flora.group.updateWorldMatrix(true,true);
 flora.group.traverse(mesh=>{
  if(!mesh.isMesh||mesh.isInstancedMesh||!/daisy heads|primrose flowers|lobed flowers|meadow drifts small/.test(mesh.name))return;
  const g=mesh.geometry,p=g.attributes.position,c=g.attributes.color,roots=g.attributes.aFloraRoot,traits=g.attributes.aFloraTraits;if(!roots||!traits||!c||!g.index)return;
  const used=new Set(g.index.array);
  for(const i of used){if(traits.getZ(i)<.5||traits.getZ(i)>1.5||c.getX(i)<.25||c.getY(i)>.44||c.getZ(i)>.09)continue;
   const x=roots.getX(i),z=roots.getZ(i);if(z<-.30)continue;
   const root=[x,roots.getY(i),z,roots.getW(i)],trait=[traits.getX(i),traits.getY(i),traits.getZ(i),traits.getW(i)],key=root.map(v=>v.toFixed(6)).join(',')+','+trait[2].toFixed(3),pos=new THREE.Vector3().fromBufferAttribute(p,i);
   const old=byRoot.get(key);if(!old||pos.y>old.position[1])byRoot.set(key,{position:pos.toArray(),root,traits:trait,mesh:mesh.name,vertex:i,world:mesh.matrixWorld.clone()});
  }
 });
 for(const h of byRoot.values()){if(h.traits[0]>=.70)continue;const[x,,z]=h.root,site=habitat.sample(x,z);if(site.waterDepth>-.01||site.height>1.45||site.shade>.64||site.treeClearance<.12||h.position[1]<site.height+.035||!habitat.allowed(x,z,.012))continue;h.site={height:site.height,shade:site.shade,treeClearance:site.treeClearance};hosts.push(h);}
 hosts.sort((a,b)=>a.position[0]-b.position[0]||a.position[2]-b.position[2]);return{hosts,flora,habitat};
}
function textureWind(field,x,z,state){
 const image=field?.windTexture?.image,b=field?.bounds;if(image?.data&&b){const w=image.width,h=image.height,fx=clamp((x-b.minX)/b.sizeX,0,1)*w-.5,fz=clamp((z-b.minZ)/b.sizeZ,0,1)*h-.5,ix=Math.floor(fx),iz=Math.floor(fz),u=fx-ix,v=fz-iz,at=(i,j,k)=>image.data[(clamp(j,0,h-1)*w+clamp(i,0,w-1))*4+k],out=[];for(let k=0;k<2;k++)out.push(mix(mix(at(ix,iz,k),at(ix+1,iz,k),u),mix(at(ix,iz+1,k),at(ix+1,iz+1,k),u),v));return out;}
 const wind=state.wind||{},xw=wind.x??wind[0]??.85,zw=wind.y??wind.z??wind[1]??.25,n=Math.hypot(xw,zw)||1,s=Math.max(0,state.windAmount??state.windStrength??.13);return[xw/n*s,zw/n*s];
}
function bendHost(host,time,state,field){const p=new THREE.Vector3(...host.position),[x,y,z,height]=host.root,[phase,flex,,flutter]=host.traits,h=Math.max(.01,height),tip=clamp((p.y-y)/h,0,1.15),[wx,wz]=textureWind(field,x,z,state),gust=.62+.24*Math.sin(time*1.5+x*.83+z*1.15)+.14*Math.sin(time*3.4+phase*31),s=Math.pow(tip,1.8)*h*.32*gust*flex;p.x+=wx*s;p.z+=wz*s;p.y-=(wx*wx+wz*wz)*tip*tip*h*.025*flex;const f=flutter*h*tip*tip*Math.hypot(wx,wz);p.x+=Math.sin(time*5.1+phase*47)*f;p.z+=Math.cos(time*4.3+phase*33)*f;return p.applyMatrix4(host.world);}

export function createSceneButterflies({terrain,vegetation,seed=42,field=null}={}){
 if(typeof terrain?.height!=='function')throw new Error('Butterflies require the shared terrain.');
 const group=new THREE.Group();group.name='Species-informed flower-visiting butterflies';const r=random(seed^0x227b17f),{hosts,flora,habitat}=inspectFlowerHosts(terrain,vegetation),items=[],geometries=[],meshes=[];
 const routeHosts=hosts.filter(h=>Math.min(meadowBloomForType(h.traits[2],0),meadowBloomForType(h.traits[2],1))-h.traits[0]>.095);
 const wingMaterial=new THREE.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.82,metalness:0}),bodyMaterial=new THREE.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.94});wingMaterial.name='White and painted-lady wings: authored upper/under geometry';bodyMaterial.name='Butterfly thorax, abdomen, eyes, club antennae, feet and proboscis';
 const assetTexture=cc0Texture(),assetMaterial=new THREE.MeshStandardMaterial({map:assetTexture,color:0xffffff,roughness:.82,side:THREE.DoubleSide,alphaTest:.2});assetMaterial.name='CC0 butterfly original UV diffuse, PBR lighting adapter';
 const bodyG=bodyGeometry(),probG=proboscisGeometry();geometries.push(bodyG,probG);const count=30,body=new THREE.InstancedMesh(bodyG,bodyMaterial,26),proboscis=new THREE.InstancedMesh(probG,bodyMaterial,count),byKind={};
 // Reserve real flower heads per insect. A max-min home distribution keeps
 // the larger cohort spread across the actual meadow rather than copying pairs.
 const reserved=new Set(),homeHosts=[],edgeCache=new Map(),hostId=new Map(routeHosts.map((h,i)=>[h,i])),routeDiagnostics={threeStop:0,fallbackTwoStop:0,unassigned:0,corridorHalfWidth:.102};
 const distance=(a,b)=>Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2]);
 const safeRoute=(a,b)=>{const ai=hostId.get(a),bi=hostId.get(b),key=ai<bi?`${ai}:${bi}`:`${bi}:${ai}`;if(edgeCache.has(key))return edgeCache.get(key);const dx=b.position[0]-a.position[0],dz=b.position[2]-a.position[2],length=Math.hypot(dx,dz),nx=-dz/Math.max(.001,length),nz=dx/Math.max(.001,length);let valid=true;for(let k=0;k<=24&&valid;k++){const f=k/24;for(const offset of [-.102,0,.102]){const x=mix(a.position[0],b.position[0],f)+nx*offset,z=mix(a.position[2],b.position[2],f)+nz*offset,h=habitat.sample(x,z),river=z> -3.46&&z<1.63?terrain.river?.sample(z):null;if(habitat.propsSolid(x,z)||river&&Math.abs(x-river.x)<river.width*.96||h.treeClearance<.036||h.shade>.82||h.height>1.60||h.waterDepth>0){valid=false;break;}}}edgeCache.set(key,valid);return valid;};
 const unused=h=>!reserved.has(h)&&Array.from(reserved).every(q=>distance(h,q)>.062);
 const circuit=()=>{const available=routeHosts.filter(unused),homes=available.map(h=>({h,score:(homeHosts.length?Math.min(...homeHosts.map(q=>distance(h,q))):r()*2)+r()*.08})).sort((a,b)=>b.score-a.score);let fallback=null;
  for(const {h:a}of homes.slice(0,64)){const neighbors=available.filter(h=>h!==a&&distance(a,h)>.34&&distance(a,h)<1.26).map(h=>({h,score:r()})).sort((a,b)=>a.score-b.score).map(o=>o.h);
   for(const b of neighbors.slice(0,24)){if(!safeRoute(a,b))continue;if(!fallback)fallback=[a,b];const cs=available.filter(c=>c!==a&&c!==b&&distance(a,c)>.16&&distance(a,c)<1.26&&distance(b,c)>.16&&distance(b,c)<1.26).map(c=>({c,score:r()})).sort((a,b)=>a.score-b.score);for(const {c}of cs.slice(0,24)){if(!safeRoute(b,c)||!safeRoute(c,a))continue;for(const h of[a,b,c])reserved.add(h);homeHosts.push(a);routeDiagnostics.threeStop++;return[a,b,c];}}
  }
  if(fallback){for(const h of fallback)reserved.add(h);homeHosts.push(fallback[0]);routeDiagnostics.fallbackTwoStop++;return fallback;}routeDiagnostics.unassigned++;return[];
 };
 for(const[k,spec]of Object.entries(BUTTERFLY_SPEC)){
  if(typeof spec!=='object')continue;const external=k==='artisticOrange',rightG=external?cc0Geometry('right'):wingGeometry(k,1),leftG=external?cc0Geometry('left'):wingGeometry(k,-1),mat=external?assetMaterial:wingMaterial,right=new THREE.InstancedMesh(rightG,mat,spec.count),left=new THREE.InstancedMesh(leftG,mat,spec.count);geometries.push(rightG,leftG);byKind[k]={right,left};right.name=`${spec.label||spec.scientific} right fore/hind wings`;left.name=`${spec.label||spec.scientific} left fore/hind wings`;meshes.push(right,left);if(external){const g=cc0Geometry('body'),m=new THREE.InstancedMesh(g,mat,spec.count);geometries.push(g);m.name='CC0 original butterfly bodies, legs and antennae';byKind[k].body=m;meshes.push(m);}
  for(let n=0;n<spec.count;n++){
   const id=items.length,stops=circuit(),[a,b,c]=stops,yaws=stops.map(()=>r()*TAU),dwells=stops.map(()=>.085+r()*.055),flightBudget=1-dwells.reduce((sum,d)=>sum+d,0),weights=stops.map(()=>.82+r()*.36),weightSum=weights.reduce((sum,w)=>sum+w,0),schedule=[];let end=0;for(let j=0;j<stops.length;j++){end+=dwells[j];schedule.push({end,perched:true,from:j,to:j});end+=flightBudget*weights[j]/weightSum;schedule.push({end,perched:false,from:j,to:(j+1)%stops.length});}if(schedule.length)schedule[schedule.length-1].end=1;
   items.push({index:id,kind:k,kindIndex:n,a,b,c,stops,yaws,schedule,span:mix(spec.openSpan[0],spec.openSpan[1],r()),period:22+r()*13,offset:r()*40,phase:r()*TAU,flapHz:5.1+r()*1.5,side:(r()>.5?1:-1)*(.040+r()*.038),flightHeight:.16+r()*.18,seasonRank:.06+r()*.78});
  }
 }
 meshes.push(body,proboscis);body.name='Twenty-six authored butterfly bodies and club antennae';proboscis.name='Feeding proboscides, shown only during actual visits';for(const m of meshes){m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.frustumCulled=false;m.castShadow=true;m.receiveShadow=true;group.add(m);}
 let disposed=false,lastState={};const matrix=new THREE.Matrix4(),scale=new THREE.Vector3(),wingQ=new THREE.Quaternion(),zero=new THREE.Vector3();
 function positionAt(f,time,state){
  if(!f.a||!f.b)return{position:new THREE.Vector3(),anchor:new THREE.Vector3(),yaw:0,pitch:0,bank:0,perched:true,phase:'no-flower',flightWeight:0,u:0};
  const cycle=((time+f.offset)%f.period+f.period)%f.period/f.period,si=Math.max(0,f.schedule.findIndex(s=>cycle<s.end)),segment=f.schedule[si],begin=si?f.schedule[si-1].end:0,u=segment.perched?0:(cycle-begin)/Math.max(.001,segment.end-begin),start=bendHost(f.stops[segment.from],time,state,field),end=bendHost(f.stops[segment.to],time,state,field),from=f.yaws[segment.from],to=f.yaws[segment.to],perched=segment.perched,phase=perched?`feeding-${'abc'[segment.from]}`:`flight-${'abc'[segment.from]}-${'abc'[segment.to]}`;let flightWeight=0;
  const s=ease(u),arch=Math.pow(Math.sin(Math.PI*u),2),anchor=start.clone().lerp(end,s),delta=end.clone().sub(start),length=Math.hypot(delta.x,delta.z),side=new THREE.Vector3(-delta.z,0,delta.x).multiplyScalar(1/Math.max(.001,length));
  const trajectory=anchor.clone();if(!perched){trajectory.addScaledVector(side,f.side*arch*Math.sin(u*TAU+f.phase));trajectory.y+=arch*(f.flightHeight+.026*Math.sin(time*6.8+f.phase));trajectory.y=Math.max(trajectory.y,terrain.height(trajectory.x,trajectory.z)+.01+.10*arch);flightWeight=smooth(0,.13,u)*(1-smooth(.86,1,u));}
  const routeYaw=length>.01?Math.atan2(delta.x,delta.z):from;let yaw=perched?from:angleMix(from,routeYaw,smooth(0,.17,u));if(!perched)yaw=angleMix(yaw,to,smooth(.81,1,u));const pitch=perched?0:-.12*Math.sin(TAU*u)*flightWeight,bank=perched?0:Math.sin(u*TAU+f.phase)*.18*flightWeight;
  const q=new THREE.Quaternion().setFromAxisAngle(UP,yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pitch)).multiply(new THREE.Quaternion().setFromAxisAngle(AXIS,bank));
  const position=trajectory.sub(TIP.clone().applyQuaternion(q).multiplyScalar(f.span/2));return{position,anchor,q,yaw,pitch,bank,perched,phase,flightWeight,u,cycle,stopIndex:segment.from,targetStopIndex:segment.to};
 }
 function sampleAt(time=0,index=0,state=lastState){
  const f=items[index];if(!f)return null;time=Number.isFinite(time)?time:0;const pose=positionAt(f,time,state),season=normalizeSeason(state.season??0),rain=Math.max(Number(state.rain)||0,Number(state.effectiveRain)||0),wind=Math.max(0,Number(state.windStrength??.13)||0),day=Number(state.daylight??1),hour=((Number(state.hour??15)%24)+24)%24;
  const bloom=f.stops.length?Math.min(...f.stops.map(h=>meadowBloomForType(h.traits[2],season)-h.traits[0])):-1;
  const activity=smooth(f.seasonRank-.055,f.seasonRank+.055,seasonalProfile([1,1,.35,0],season))*smooth(7,8.3,hour)*(1-smooth(17.7,19,hour))*smooth(.20,.48,day)*(1-smooth(.10,.28,rain))*(1-smooth(.70,1.22,wind))*smooth(-.025,.09,bloom);
  const perchAngle=f.kind==='smallWhite'?1.14+.13*Math.sin(time*1.1+f.phase):.48+(.5+.5*Math.sin(time*.8+f.phase))*.48,wingAngle=mix(perchAngle,.22+(.5+.5*Math.sin(time*TAU*f.flapHz+f.phase))*.98,pose.flightWeight),q=pose.q||new THREE.Quaternion();
  const renderPresence=activity>.02?1:0,actualPosition=pose.position.clone().add(TIP.clone().applyQuaternion(q).multiplyScalar(f.span/2*(1-renderPresence)));
  return{index,kind:f.kind,scientific:BUTTERFLY_SPEC[f.kind].scientific,label:BUTTERFLY_SPEC[f.kind].label||BUTTERFLY_SPEC[f.kind].scientific,externalAsset:f.kind==='artisticOrange',position:actualPosition.toArray(),quaternion:q.toArray(),phase:pose.phase,perched:pose.perched,flightWeight:pose.flightWeight,wingAngle,anchor:pose.anchor.toArray(),proboscisTip:TIP.clone().multiplyScalar(f.span/2*renderPresence).applyQuaternion(q).add(actualPosition).toArray(),openSpan:f.span,visibility:activity,visible:activity>.02,bodyScale:f.span/2*renderPresence,season,flapHz:f.flapHz,cycle:pose.cycle??0,sourceAnchor:f.stops[pose.stopIndex]?{mesh:f.stops[pose.stopIndex].mesh,vertex:f.stops[pose.stopIndex].vertex}:null,stopIndex:pose.stopIndex??0,targetStopIndex:pose.targetStopIndex??0,routeStops:f.stops.length};
 }
 const stats={seed,count,drawCalls:meshes.length,triangles:meshes.reduce((n,m)=>n+m.geometry.index.count/3*m.count,0),geometries:geometries.length,materials:3,textures:1,externalAssets:1,flowerHosts:hosts.length,routeHosts:routeHosts.length,assignedHosts:reserved.size,threeStopRoutes:routeDiagnostics.threeStop,twoStopFallbacks:routeDiagnostics.fallbackTwoStop,unassigned:routeDiagnostics.unassigned,visible:0,flying:0,feeding:0,spanRange:[Math.min(...items.map(f=>f.span)),Math.max(...items.map(f=>f.span))],hostWindSampler:field?.windTexture?'same float texture with CPU bilinear clamp-to-edge':'state wind fallback, matching host only when no field is used',time:0,poses:[]};
 function update(dt=0,state={}){if(disposed)return;lastState=state;const time=Number.isFinite(state.time)?state.time:stats.time+Math.max(0,Number(dt)||0);stats.time=time;stats.visible=stats.flying=stats.feeding=0;stats.poses=[];for(const f of items){const p=sampleAt(time,f.index,state),position=new THREE.Vector3(...p.position),q=new THREE.Quaternion(...p.quaternion);scale.setScalar(p.bodyScale);matrix.compose(position,q,scale);if(byKind[f.kind].body)byKind[f.kind].body.setMatrixAt(f.kindIndex,matrix);else body.setMatrixAt(f.index,matrix);matrix.compose(position,q,p.perched?scale:zero);proboscis.setMatrixAt(f.index,matrix);for(const[mesh,sign]of [[byKind[f.kind].right,1],[byKind[f.kind].left,-1]]){wingQ.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(AXIS,sign*p.wingAngle));matrix.compose(position,wingQ,scale);mesh.setMatrixAt(f.kindIndex,matrix);}if(p.visible){stats.visible++;stats[p.perched?'feeding':'flying']++;}stats.poses.push(p);}for(const m of meshes)m.instanceMatrix.needsUpdate=true;group.visible=stats.visible>0;}
 const diagnostics={species:BUTTERFLY_SPEC,externalAsset:BUTTERFLY_CC0_ASSET.metadata,routeDistribution:{...routeDiagnostics,uniqueHosts:reserved.size,routePairCache:edgeCache.size},hostMode:'actual surviving indexed pollen vertices and aFloraRoot/aFloraTraits; same flora deformation, read-only field texture',items:items.map(f=>({index:f.index,kind:f.kind,span:f.span,period:f.period,offset:f.offset,flapHz:f.flapHz,schedule:f.schedule,stops:f.stops.map(h=>({hostId:hostId.get(h),position:h.position,root:h.root,traits:h.traits,mesh:h.mesh,vertex:h.vertex})),a:f.a?{position:f.a.position,root:f.a.root,traits:f.a.traits,mesh:f.a.mesh,vertex:f.a.vertex}:null,b:f.b?{position:f.b.position,root:f.b.root,traits:f.b.traits,mesh:f.b.mesh,vertex:f.b.vertex}:null})),limits:'Small relative scale is preserved. Three-stop routes reserve distinct flower heads and sample a finite horizontal corridor to avoid known solid/water/trunk regions, not arbitrary all-triangle foliage collisions; seasonal/weather suppression keeps adult span fixed while active and uses a visibility gate, not a simulated shelter or full butterfly life cycle.'};
 update(0,{});return{group,stats,diagnostics,update,sampleAt,sampleHostAt(time=0,index=0,state=lastState){const f=items[index];return f?.a?bendHost(f.a,time,state,field).toArray():null;},dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const m of meshes)m.dispose();for(const g of geometries)g.dispose();wingMaterial.dispose();bodyMaterial.dispose();assetMaterial.dispose();assetTexture.dispose();stats.disposed=true;}};
}
