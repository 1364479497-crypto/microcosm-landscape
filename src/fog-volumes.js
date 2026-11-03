import * as THREE from 'three';

// Independent bounded 3D fog lobes. Each instance owns a world-space occupied
// box: the camera can orbit it without ever exposing a camera-facing card.
// Kept deliberately low-frequency (14 steps, one shape noise) for brush use.
const noise=`float fogHash(vec3 p){p=fract(p*.3183099+vec3(.13,.27,.31));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float fogNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(fogHash(i),fogHash(i+vec3(1,0,0)),f.x),mix(fogHash(i+vec3(0,1,0)),fogHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(fogHash(i+vec3(0,0,1)),fogHash(i+vec3(1,0,1)),f.x),mix(fogHash(i+vec3(0,1,1)),fogHash(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
export function createFogVolumes(count, random){
 const box=new THREE.BoxGeometry(2,2,2),geometry=new THREE.InstancedBufferGeometry();
 geometry.index=box.index.clone();geometry.setAttribute('position',box.attributes.position.clone());box.dispose();
 const centers=new Float32Array(count*3),scales=new Float32Array(count*3),seeds=new Float32Array(count),alphas=new Float32Array(count);
 for(let i=0;i<count;i++){seeds[i]=random();const radius=.65+random()*.9,height=.28+random()*.23;scales.set([radius,height,radius*.85],i*3);}
 geometry.setAttribute('aCenter',new THREE.InstancedBufferAttribute(centers,3));geometry.setAttribute('aScale',new THREE.InstancedBufferAttribute(scales,3));geometry.setAttribute('aSeed',new THREE.InstancedBufferAttribute(seeds,1));geometry.setAttribute('aOpacity',new THREE.InstancedBufferAttribute(alphas,1));geometry.instanceCount=0;
 const material=new THREE.ShaderMaterial({uniforms:{uCamera:{value:new THREE.Vector3()},uSun:{value:new THREE.Vector3(-.6,1,.4).normalize()},uTime:{value:0},uOpacity:{value:1},uDay:{value:1},uFlash:{value:0},uSceneDepth:{value:null},uHasSceneDepth:{value:0},uViewport:{value:new THREE.Vector4(0,0,1,1)},uNear:{value:.1},uFar:{value:90}},
 vertexShader:`attribute vec3 aCenter,aScale;attribute float aSeed,aOpacity;varying vec3 vLocal,vCenter,vScale;varying float vSeed,vOpacity;void main(){vLocal=position;vCenter=aCenter;vScale=aScale;vSeed=aSeed;vOpacity=aOpacity;gl_Position=projectionMatrix*modelViewMatrix*vec4(aCenter+position*aScale,1.);}`,
 fragmentShader:`${noise}
uniform vec3 uCamera,uSun;uniform sampler2D uSceneDepth;uniform vec4 uViewport;uniform float uTime,uOpacity,uDay,uFlash,uHasSceneDepth,uNear,uFar;varying vec3 vLocal,vCenter,vScale;varying float vSeed,vOpacity;
float density(vec3 p){
 float d=length(p-vec3(-.30,-.04,.02))-.58;
 d=min(d,length(p-vec3(.25,.12,-.12))-.56);
 d=min(d,length(p-vec3(.05,-.02,.32))-.49);
 // Erosion is in [0,.14]. Outside this conservative support the original
 // smoothstep is already zero; its dense core needs only the bulk noise.
 if(d>=.141)return 0.;
 float shape=1.;
 // Texture erodes the shaped mass; it never creates disconnected noise dots.
 if(d>-.271){
  float erode=fogNoise(p*3.1+vec3(vSeed*17.,uTime*.045,0.))*.14;
  shape=1.-smoothstep(-.13,.14,d+erode);
  if(shape<=0.)return 0.;
 }
 float bulk=.58+.42*fogNoise(p*1.35+vec3(vSeed*9.,.17,2.));
 return shape*.82*bulk;
}
void main(){
 if(vOpacity<.002)discard;
 vec3 ro=(uCamera-vCenter)/vScale,rd=normalize(vLocal-ro),inv=1./(rd+vec3(.000001));
 vec3 ta=(-vec3(1.)-ro)*inv,tb=(vec3(1.)-ro)*inv;
 vec3 lo=min(ta,tb),hi=max(ta,tb);float nearT=max(max(lo.x,lo.y),max(lo.z,0.)),farT=min(min(hi.x,hi.y),hi.z);
 float worldRayLength=length(rd*vScale),sceneStop=100000.;
 if(uHasSceneDepth>.5){
  vec2 uv=clamp((gl_FragCoord.xy-uViewport.xy)/uViewport.zw,vec2(.000001),vec2(.999999));
  float depth=texture2D(uSceneDepth,uv).r;
  // Reconstruct perspective view Z, then convert it into this instance's
  // local ray parameter. Local rd is not a unit world/view ray under scaling.
  float sceneViewZ=(uNear*uFar)/((uFar-uNear)*depth-uFar);
  float viewRayZ=(viewMatrix*vec4(rd*vScale,0.)).z;
  if(viewRayZ<-.000001){sceneStop=max(0.,sceneViewZ/viewRayZ);farT=min(farT,sceneStop);}
 }
 if(farT<=nearT)discard;
 float stepSize=(farT-nearT)/14.,worldStep=stepSize*worldRayLength,alpha=0.;vec3 radiance=vec3(0.);
 for(int i=0;i<14;i++){
  float sampleT=nearT+(float(i)+.5)*stepSize;vec3 p=ro+rd*sampleT;float contact=smoothstep(0.,.10,max(0.,sceneStop-sampleT)*worldRayLength);float den=density(p)*contact;
  if(den>.005){
   float a=1.-exp(-den*worldStep*1.25*uOpacity*vOpacity);
   // A directional short optical-depth probe makes dense lobe interiors and
   // the lower face read darker than the sun-facing, ventilated upper edge.
   vec3 sunLocal=normalize(uSun/vScale);
   float optical=density(p+sunLocal*.18)*.42+density(p+sunLocal*.40)*.36+density(p+sunLocal*.72)*.22;
   float light=exp(-optical*3.0),h=clamp(p.y*.60+.46,0.,1.);
   vec3 ambient=mix(vec3(.18,.23,.25),vec3(.43,.48,.48),h);
   vec3 direct=vec3(.48,.50,.46)*light;
   vec3 lit=mix(vec3(.09,.14,.20),ambient+direct,uDay)+uFlash*.42;
   radiance+=(1.-alpha)*lit*a;alpha+=(1.-alpha)*a;
  }if(alpha>.96)break;
 }
 if(alpha<.006)discard;gl_FragColor=vec4(radiance/max(alpha,.001),alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`,
 transparent:true,depthWrite:false,side:THREE.BackSide});
 const object=new THREE.Mesh(geometry,material);object.onBeforeRender=(renderer,scene,camera)=>{renderer.getCurrentViewport(material.uniforms.uViewport.value);camera.getWorldPosition(material.uniforms.uCamera.value);material.uniforms.uNear.value=camera.near;material.uniforms.uFar.value=camera.far;};object.name='Bounded three-dimensional brush fog lobes';object.frustumCulled=false;object.renderOrder=12;
 function setSceneDepth(texture){material.uniforms.uSceneDepth.value=texture??null;material.uniforms.uHasSceneDepth.value=texture?1:0;material.depthTest=!texture;}
 return{object,geometry,material,centers,scales,seeds,alphas,count,setSceneDepth};
}
export function fogEnvelope(age,life,sinceFed=age){
 if(age<0||sinceFed>=life||life<=0)return 0;
 const attack=1-Math.exp(-age*11),fade=1-THREE.MathUtils.smoothstep(Math.max(0,sinceFed)/life,.50,1);
 return attack*fade;
}
