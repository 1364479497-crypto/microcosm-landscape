import * as THREE from 'three';

// A bounded local surface response. The surface owner supplies the current
// pond/stream datum; no water level or camera state is owned here.
const CAPACITY=10,SEGMENTS=64,DROPS=32;
const clamp=THREE.MathUtils.clamp;
export function createWaterTouch({surfaceAt}={}){
 const group=new THREE.Group();group.name='Local water touch crowns, droplets and spreading rings';
 const events=Array.from({length:CAPACITY},()=>({start:-100,x:0,y:0,z:0,strength:0,seed:0}));let next=0,disposed=false;
 const uniforms={uDay:{value:1},uViewport:{value:720}};
 function geometry(capacity){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(capacity*3),3));g.setAttribute('aAlpha',new THREE.BufferAttribute(new Float32Array(capacity),1));g.setDrawRange(0,0);return g;}
 const ringGeo=geometry(CAPACITY*3*SEGMENTS*6),crownGeo=geometry(CAPACITY*SEGMENTS*6),dropGeo=geometry(CAPACITY*DROPS);
 const vertex=`attribute float aAlpha;varying float vAlpha;varying vec3 vWorld;void main(){vAlpha=aAlpha;vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`;
 const fragment=`uniform float uDay;varying float vAlpha;varying vec3 vWorld;void main(){if(vAlpha<.003)discard;gl_FragColor=vec4(vec3(.79,.92,.89)*(.28+.72*uDay),vAlpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>}`;
 const ringMat=new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,side:THREE.DoubleSide});
 const crownMat=ringMat.clone();crownMat.uniforms=uniforms;
 const dropMat=new THREE.ShaderMaterial({uniforms,vertexShader:vertex.replace('void main()', 'uniform float uViewport;void main()').replace('gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);','vec4 mv=viewMatrix*vec4(vWorld,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(.017*uViewport*projectionMatrix[1][1]/max(.1,-mv.z),1.,5.);'),fragmentShader:fragment.replace('if(vAlpha<.003)discard;','if(vAlpha<.003||length(gl_PointCoord-.5)>.5)discard;'),transparent:true,depthWrite:false});
 for(const [g,m,name]of [[ringGeo,ringMat,'Expanding sharp touch ripples'],[crownGeo,crownMat,'Breaking water splash crown'],[dropGeo,dropMat,'Ballistic touch droplets']]){const o=g===dropGeo?new THREE.Points(g,m):new THREE.Mesh(g,m);o.name=name;o.frustumCulled=false;o.renderOrder=11;group.add(o);}
 const stats={capacity:CAPACITY,active:0,total:0,droplets:0,drawCalls:3,disposed:false};
 function emit(point,time,strength=1){if(disposed||!Number.isFinite(point?.x+point?.y+point?.z))return false;const s=surfaceAt?.(point.x,point.z,time);if(!s?.water)return false;
  Object.assign(events[next++%CAPACITY],{start:time,x:point.x,y:s.y,z:point.z,strength:clamp(strength,.15,1.3),seed:stats.total*.61803398875%1});stats.total++;return true;}
 function put(g,index,x,y,z,alpha){g.attributes.position.array.set([x,y,z],index*3);g.attributes.aAlpha.array[index]=alpha;return index+1;}
 function update(time,state={},viewport=720){uniforms.uDay.value=state.daylight??1;uniforms.uViewport.value=viewport;const cache=new Map(),sample=(x,z)=>{const key=x.toFixed(7)+","+z.toFixed(7);if(!cache.has(key))cache.set(key,surfaceAt?.(x,z,time));return cache.get(key);};let nr=0,nc=0,nd=0,active=0;
  for(const e of events){const age=time-e.start;if(age<0||age>2.25)continue;const center=sample(e.x,e.z);if(!center?.water)continue;active++;const y=center.y;
   for(let r=0;r<3;r++){const t=age-r*.13;if(t<=0||t>1.9)continue;const radius=(.035+t*(.47-r*.045))*Math.sqrt(e.strength),width=.008+radius*.012,alpha=Math.min(1,t/.07)*Math.pow(1-t/1.9,1.25)*e.strength*(.72-r*.12);
    for(let i=0;i<SEGMENTS;i++){const a=i/SEGMENTS*Math.PI*2,b=(i+1)/SEGMENTS*Math.PI*2;for(const [angle,rad]of [[a,radius-width],[b,radius-width],[a,radius],[a,radius],[b,radius-width],[b,radius]]){const x=e.x+Math.cos(angle)*rad,z=e.z+Math.sin(angle)*rad,s=sample(x,z);nr=put(ringGeo,nr,x,(s?.y??y)+.008,z,s?.water?alpha:0);}}
   }
   if(age<.42){const t=age/.42,radius=.035+.15*t,height=Math.sin(Math.PI*t)*.16*e.strength,alpha=Math.pow(1-t,.55)*.30*e.strength;
    for(let i=0;i<SEGMENTS;i++){const a=i/SEGMENTS*Math.PI*2,b=(i+1)/SEGMENTS*Math.PI*2;for(const [angle,top]of [[a,0],[b,0],[a,1],[a,1],[b,0],[b,1]]){const r=radius*(top?1:.68),h=top?height*(.62+.24*Math.sin(angle*9+e.seed*10)+.14*Math.sin(angle*5+2.4)):0;nc=put(crownGeo,nc,e.x+Math.cos(angle)*r,y+.012+h,e.z+Math.sin(angle)*r,alpha*(top?.45+.55*Math.abs(Math.sin(angle*6.5+e.seed*5)):.6));}}
   }
   for(let i=0;i<DROPS;i++){const rate=(i*.381966+e.seed)%1,angle=i/DROPS*Math.PI*2+e.seed*6.28+Math.sin(i*7.23)*.17,v=(.78+rate*.8)*Math.sqrt(e.strength),speed=.19+rate*.44,h=v*age-3.4*age*age;if(h<=0||age>.7)continue;nd=put(dropGeo,nd,e.x+Math.cos(angle)*speed*age,y+.01+h,e.z+Math.sin(angle)*speed*age,Math.min(.68,(1-age/.7)*.8)*e.strength);}
  }
  for(const[g,count]of [[ringGeo,nr],[crownGeo,nc],[dropGeo,nd]]){g.setDrawRange(0,count);g.attributes.position.needsUpdate=true;g.attributes.aAlpha.needsUpdate=true;}group.visible=active>0;stats.active=active;stats.droplets=nd;
 }
 function setCloudOcclusion(binding){for(const m of [ringMat,crownMat,dropMat]){m.userData.base??=m.fragmentShader;m.fragmentShader=binding?.glsl?binding.glsl+'\n'+m.userData.base.replace('#include <tonemapping_fragment>','gl_FragColor.rgb=weatherCloudComposite(vWorld,gl_FragColor.rgb);\n#include <tonemapping_fragment>'):m.userData.base;if(binding)Object.assign(m.uniforms,binding.uniforms);m.needsUpdate=true;}}
 function reset(){for(const e of events)e.start=-100;next=0;stats.active=stats.total=stats.droplets=0;group.visible=false;for(const g of [ringGeo,crownGeo,dropGeo])g.setDrawRange(0,0);}
 function dispose(){if(disposed)return;disposed=true;reset();for(const g of [ringGeo,crownGeo,dropGeo])g.dispose();for(const m of [ringMat,crownMat,dropMat])m.dispose();group.removeFromParent();stats.disposed=true;}
 reset();return{group,emit,update,reset,dispose,setCloudOcclusion,stats,events};
}
