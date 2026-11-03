import * as THREE from 'three';

// Shared authored lobe density. Beauty, lightning and transparent water all
// integrate the same occupied volume; no projected cloud card or hard layer.
export const CLOUD_SHAPE_GLSL=`
float weatherCloudHash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float weatherCloudNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(weatherCloudHash(i),weatherCloudHash(i+vec3(1,0,0)),f.x),mix(weatherCloudHash(i+vec3(0,1,0)),weatherCloudHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(weatherCloudHash(i+vec3(0,0,1)),weatherCloudHash(i+vec3(1,0,1)),f.x),mix(weatherCloudHash(i+vec3(0,1,1)),weatherCloudHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float weatherCloudFbm(vec3 p){return weatherCloudNoise(p)*.57+weatherCloudNoise(p*2.08+7.)*.28+weatherCloudNoise(p*4.13+13.)*.15;}
float weatherCloudShape(vec3 p,float seed,float time){
 // These bounds only skip values where the original density is already
 // exactly empty or fully filled. Keep the noise, silhouette and march intact.
 if(p.y<=-.54)return 0.;
 vec3 q=p*vec3(1.,1.08,1.);
 float d=length(q-vec3(-.58,-.05,0.))-.38;
 d=min(d,length(q-vec3(-.27,.10,-.06))-.49);
 d=min(d,length(q-vec3(.15,.17,.04))-.48);
 d=min(d,length(q-vec3(.53,-.02,-.07))-.40);
 d=min(d,length(q-vec3(-.03,-.10,.36))-.49);
 d=min(d,length(q-vec3(.18,-.08,-.36))-.47);
 d=min(d,length(q-vec3(-.34,-.11,.29))-.32);
 // FBM is in [0,1] and fine noise in [0,.065], so the displacement
 // lies in [-.155,.17]. The .001 margin stays away from roundoff edges.
 if(d>=.276)return 0.;
 if(d<=-.301)return smoothstep(-.54,-.36,p.y)*.9;
 float n=weatherCloudFbm(p*5.2+vec3(seed,time*.035,0.));
 float fine=weatherCloudNoise(p*15.3+seed)*.065;
 return (1.-smoothstep(-.13,.12,d+(n-.5)*.26+fine-.025))*smoothstep(-.54,-.36,p.y)*.9;
}`;
export const CLOUD_LIGHTING_GLSL=`
vec3 weatherCloudLighting(vec3 p,vec3 ray,vec3 sun,float seed,float time,float day,float rain,float storm,float flash,vec3 lightningLocal){
 float optical=weatherCloudShape(p+sun*.11,seed,time)*.22+weatherCloudShape(p+sun*.25,seed,time)*.30+weatherCloudShape(p+sun*.44,seed,time)*.28+weatherCloudShape(p+sun*.70,seed,time)*.20;
 float light=exp(-optical*2.9),h=clamp(p.y*.78+.52,0.,1.);
 vec3 top=mix(vec3(.29,.37,.49),vec3(.98,.99,.94),day),bottom=mix(vec3(.085,.13,.22),vec3(.24,.30,.33),day);
 vec3 ambient=mix(bottom,top,h*.72+.12),direct=mix(vec3(.30,.39,.54),vec3(1.,.97,.86),day);
 float rim=pow(max(0.,dot(ray,sun)),5.)*.15;
 vec3 lit=(ambient*.35+direct*(light*.60+rim))*(1.-rain*.28);
 lit=mix(lit,lit*vec3(.24,.29,.35),clamp(storm,0.,1.)*.88)+flash*.09;
 vec3 toFlash=p-lightningLocal;lit+=exp(-dot(toFlash,toFlash)*4.3)*flash*vec3(2.05,2.45,3.2);
 return lit;
}`;
export const CLOUD_OCCLUSION_GLSL=`
${CLOUD_SHAPE_GLSL}
${CLOUD_LIGHTING_GLSL}
uniform int uWeatherCloudCount;
uniform mat4 uWeatherCloudInverse[6];
uniform float uWeatherCloudDensity[6],uWeatherCloudSeed[6];
uniform vec3 uWeatherCloudCamera;
uniform float uWeatherCloudTime,uWeatherCloudDay,uWeatherCloudFlash;
uniform float uWeatherCloudRain[6],uWeatherCloudStorm[6];
uniform vec3 uWeatherCloudSun[6],uWeatherCloudLightningLocal[6];
float weatherCloudTransmittance(vec3 target){
 float opticalDepth=0.;
 for(int c=0;c<6;c++){
  if(c>=uWeatherCloudCount)break;
  if(uWeatherCloudDensity[c]<.002)continue;
  vec3 ro=(uWeatherCloudInverse[c]*vec4(uWeatherCloudCamera,1.)).xyz;
  vec3 dest=(uWeatherCloudInverse[c]*vec4(target,1.)).xyz;
  vec3 delta=dest-ro;float limit=length(delta);if(limit<.0001)continue;
  vec3 rd=delta/limit,inv=1./(rd+vec3(.000001));
  vec3 a=(-vec3(1.)-ro)*inv,b=(vec3(1.)-ro)*inv;
  vec3 lo=min(a,b),hi=max(a,b);
  float nearT=max(max(lo.x,lo.y),max(lo.z,0.));
  float farT=min(min(hi.x,hi.y),min(hi.z,limit-.001));
  if(farT<=nearT)continue;
  float stepSize=(farT-nearT)/8.;
  for(int i=0;i<8;i++){
   vec3 p=ro+rd*(nearT+(float(i)+.5)*stepSize);
   opticalDepth+=weatherCloudShape(p,uWeatherCloudSeed[c],uWeatherCloudTime)*uWeatherCloudDensity[c]*stepSize*6.4;
  }
 }
 return exp(-min(opticalDepth,12.));
}
// Normal alpha layers already have foreground cloud in the framebuffer.
// Replace their RGB by C_front + T_front*S, retaining their original alpha.
// The finite cloud layers are sorted by their ray entry; overlapping lobes
// remain a bounded approximation rather than a general transparent OIT pass.
vec4 weatherCloudFrontOptics(vec3 target){
 vec3 layerColour[6];float layerT[6],layerNear[6];
 for(int c=0;c<6;c++){
  layerColour[c]=vec3(0.);layerT[c]=1.;layerNear[c]=100000.;
  if(c>=uWeatherCloudCount||uWeatherCloudDensity[c]<.002)continue;
  vec3 ro=(uWeatherCloudInverse[c]*vec4(uWeatherCloudCamera,1.)).xyz;
  vec3 dest=(uWeatherCloudInverse[c]*vec4(target,1.)).xyz,delta=dest-ro;
  float limit=length(delta);if(limit<.0001)continue;
  vec3 rd=delta/limit,inv=1./(rd+vec3(.000001));
  vec3 a=(-vec3(1.)-ro)*inv,b=(vec3(1.)-ro)*inv,lo=min(a,b),hi=max(a,b);
  float nearT=max(max(lo.x,lo.y),max(lo.z,0.)),farT=min(min(hi.x,hi.y),min(hi.z,limit-.001));
  if(farT<=nearT)continue;
  // Parameterise ordering in world segment distance, not differently-scaled
  // local lengths, so small and large clouds sort consistently.
  layerNear[c]=nearT/max(.0001,limit)*length(target-uWeatherCloudCamera);
  float h=(farT-nearT)/8.,T=1.;vec3 C=vec3(0.);
  for(int i=0;i<8;i++){
   vec3 point=ro+rd*(nearT+(float(i)+.5)*h);
   float den=weatherCloudShape(point,uWeatherCloudSeed[c],uWeatherCloudTime)*uWeatherCloudDensity[c];
   if(den>.005){
    float alpha=1.-exp(-den*h*6.4);
    vec3 light=weatherCloudLighting(point,rd,normalize(uWeatherCloudSun[c]),uWeatherCloudSeed[c],uWeatherCloudTime,uWeatherCloudDay,uWeatherCloudRain[c],uWeatherCloudStorm[c],uWeatherCloudFlash,uWeatherCloudLightningLocal[c]);
    C+=T*alpha*light;T*=1.-alpha;
   }
  }
  layerColour[c]=C;layerT[c]=T;
 }
 vec3 C=vec3(0.);float T=1.;
 for(int layer=0;layer<6;layer++){
  int nearest=-1;float entryDistance=99999.;
  for(int c=0;c<6;c++)if(layerNear[c]<entryDistance){entryDistance=layerNear[c];nearest=c;}
  if(nearest<0)break;
  C+=T*layerColour[nearest];T*=layerT[nearest];layerNear[nearest]=100000.;
 }
 return vec4(C,T);
}
vec3 weatherCloudComposite(vec3 target,vec3 surfaceColour){vec4 front=weatherCloudFrontOptics(target);return front.rgb+front.a*surfaceColour;}
`;
const fract=x=>x-Math.floor(x),mix=(a,b,t)=>a+(b-a)*t,clamp=THREE.MathUtils.clamp;
function hash(p){const q=p.map((x,i)=>fract(x*.3183099+[.1,.2,.3][i])*17);return fract(q[0]*q[1]*q[2]*(q[0]+q[1]+q[2]));}
function noise(p){const i=p.map(Math.floor),f=p.map((x,j)=>{const v=x-i[j];return v*v*(3-2*v)}),h=(x,y,z)=>hash([i[0]+x,i[1]+y,i[2]+z]);return mix(mix(mix(h(0,0,0),h(1,0,0),f[0]),mix(h(0,1,0),h(1,1,0),f[0]),f[1]),mix(mix(h(0,0,1),h(1,0,1),f[0]),mix(h(0,1,1),h(1,1,1),f[0]),f[1]),f[2]);}
function smooth(a,b,x){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
export function cloudDensityAt(point,seed=0,time=0){const p=point.isVector3?point.toArray():point;if(p[1]<=-.54)return 0;const q=[p[0],p[1]*1.08,p[2]],lobes=[[-.58,-.05,0,.38],[-.27,.10,-.06,.49],[.15,.17,.04,.48],[.53,-.02,-.07,.40],[-.03,-.10,.36,.49],[.18,-.08,-.36,.47],[-.34,-.11,.29,.32]];let d=Infinity;for(const[x,y,z,r]of lobes)d=Math.min(d,Math.hypot(q[0]-x,q[1]-y,q[2]-z)-r);if(d>=.276)return 0;if(d<=-.301)return smooth(-.54,-.36,p[1])*.9;const v=[p[0]*5.2+seed,p[1]*5.2+time*.035,p[2]*5.2],n=noise(v)*.57+noise(v.map(x=>x*2.08+7))*.28+noise(v.map(x=>x*4.13+13))*.15,fine=noise(p.map(x=>x*15.3+seed))*.065;return(1-smooth(-.13,.12,d+(n-.5)*.26+fine-.025))*smooth(-.54,-.36,p[1])*.9;}
export function cloudLightingAt(point,ray,sun,seed=0,time=0,day=1,rain=0,storm=0,flash=0,lightning=[99,99,99]){
 const probe=d=>cloudDensityAt(point.map((x,k)=>x+sun[k]*d),seed,time),optical=probe(.11)*.22+probe(.25)*.30+probe(.44)*.28+probe(.70)*.20,light=Math.exp(-optical*2.9),h=clamp(point[1]*.78+.52,0,1),top=[.29,.37,.49].map((n,i)=>mix(n,[.98,.99,.94][i],day)),bottom=[.085,.13,.22].map((n,i)=>mix(n,[.24,.30,.33][i],day)),ambient=bottom.map((n,i)=>mix(n,top[i],h*.72+.12)),direct=[.30,.39,.54].map((n,i)=>mix(n,[1,.97,.86][i],day)),rim=Math.max(0,ray.reduce((n,v,i)=>n+v*sun[i],0))**5*.15,inner=Math.exp(-point.reduce((n,v,i)=>n+(v-lightning[i])**2,0)*4.3)*flash;
 return ambient.map((n,i)=>{const lit=(n*.35+direct[i]*(light*.60+rim))*(1-rain*.28);return mix(lit,lit*[.24,.29,.35][i],clamp(storm,0,1)*.88)+flash*.09+inner*[2.05,2.45,3.2][i];});
}
export function createCloudOcclusion(){
 const inverse=Array.from({length:6},()=>new THREE.Matrix4()),density=new Float32Array(6),seeds=new Float32Array(6),rain=new Float32Array(6),storm=new Float32Array(6),sun=Array.from({length:6},()=>new THREE.Vector3()),lightningLocal=Array.from({length:6},()=>new THREE.Vector3(99,99,99));
 const uniforms={uWeatherCloudCount:{value:0},uWeatherCloudInverse:{value:inverse},uWeatherCloudDensity:{value:density},uWeatherCloudSeed:{value:seeds},uWeatherCloudCamera:{value:new THREE.Vector3()},uWeatherCloudTime:{value:0},uWeatherCloudDay:{value:1},uWeatherCloudFlash:{value:0},uWeatherCloudRain:{value:rain},uWeatherCloudStorm:{value:storm},uWeatherCloudSun:{value:sun},uWeatherCloudLightningLocal:{value:lightningLocal}};
 const ro=new THREE.Vector3(),to=new THREE.Vector3(),dir=new THREE.Vector3(),p=new THREE.Vector3();
 function sync(clouds,camera,time=0){const count=Math.min(6,clouds.length);uniforms.uWeatherCloudCount.value=count;uniforms.uWeatherCloudTime.value=time;camera.getWorldPosition(uniforms.uWeatherCloudCamera.value);for(let i=0;i<6;i++){const c=clouds[i];if(i<count){c.group.updateMatrixWorld(true);inverse[i].copy(c.mesh.matrixWorld).invert();density[i]=(c.density??1)*(c.opacity??1);const u=c.material.uniforms;seeds[i]=u.uSeed.value;rain[i]=u.uRain.value;storm[i]=u.uStorm.value;sun[i].copy(u.uSun.value);lightningLocal[i].copy(u.uLightningLocal.value);if(i===0){uniforms.uWeatherCloudDay.value=u.uDay.value;uniforms.uWeatherCloudFlash.value=u.uFlash.value;}}else density[i]=0;}}
 function transmittance(target,steps=24){let optical=0;for(let c=0;c<uniforms.uWeatherCloudCount.value;c++){if(density[c]<.002)continue;ro.copy(uniforms.uWeatherCloudCamera.value).applyMatrix4(inverse[c]);to.copy(target).applyMatrix4(inverse[c]);dir.copy(to).sub(ro);const limit=dir.length();if(limit<.0001)continue;dir.divideScalar(limit);let near=0,far=limit-.001;for(const a of['x','y','z']){if(Math.abs(dir[a])<1e-8){if(Math.abs(ro[a])>1){far=-1;break;}}else{const a0=(-1-ro[a])/dir[a],a1=(1-ro[a])/dir[a];near=Math.max(near,Math.min(a0,a1));far=Math.min(far,Math.max(a0,a1));}}if(far<=near)continue;const h=(far-near)/steps;for(let i=0;i<steps;i++)optical+=cloudDensityAt(p.copy(ro).addScaledVector(dir,near+(i+.5)*h),seeds[c],uniforms.uWeatherCloudTime.value)*density[c]*h*6.4;}return Math.exp(-Math.min(optical,12));}
 function frontOptics(target,steps=24){
  const layers=[],worldLength=uniforms.uWeatherCloudCamera.value.distanceTo(target);for(let c=0;c<uniforms.uWeatherCloudCount.value;c++){if(density[c]<.002)continue;ro.copy(uniforms.uWeatherCloudCamera.value).applyMatrix4(inverse[c]);to.copy(target).applyMatrix4(inverse[c]);dir.copy(to).sub(ro);const limit=dir.length();if(limit<.0001)continue;dir.divideScalar(limit);let near=0,far=limit-.001;for(const a of['x','y','z']){if(Math.abs(dir[a])<1e-8){if(Math.abs(ro[a])>1){far=-1;break;}}else{const a0=(-1-ro[a])/dir[a],a1=(1-ro[a])/dir[a];near=Math.max(near,Math.min(a0,a1));far=Math.min(far,Math.max(a0,a1));}}if(far<=near)continue;let T=1,C=[0,0,0];const h=(far-near)/steps;
   for(let i=0;i<steps;i++){const point=p.copy(ro).addScaledVector(dir,near+(i+.5)*h).toArray(),den=cloudDensityAt(point,seeds[c],uniforms.uWeatherCloudTime.value)*density[c];if(den>.005){const alpha=1-Math.exp(-den*h*6.4),light=cloudLightingAt(point,dir.toArray(),sun[c].toArray(),seeds[c],uniforms.uWeatherCloudTime.value,uniforms.uWeatherCloudDay.value,rain[c],storm[c],uniforms.uWeatherCloudFlash.value,lightningLocal[c].toArray());for(let k=0;k<3;k++)C[k]+=T*alpha*light[k];T*=1-alpha;}}layers.push({near:near/limit*worldLength,C,T});
  }layers.sort((a,b)=>a.near-b.near);const C=[0,0,0];let T=1;for(const layer of layers){for(let k=0;k<3;k++)C[k]+=T*layer.C[k];T*=layer.T;}return{radiance:C,transmittance:T,layers:layers.length};
 }
 function composite(target,surface){const f=frontOptics(target),rgb=Array.isArray(surface)?surface:[surface.r??surface.x,surface.g??surface.y,surface.b??surface.z];return f.radiance.map((n,i)=>n+f.transmittance*rgb[i]);}
 return{uniforms,glsl:CLOUD_OCCLUSION_GLSL,sync,transmittance,frontOptics,composite,stats:{maxClouds:6,steps:8,ownership:'Borrowed uniforms; camera-to-fragment front-segment integration of the same cloud shape'}};
}
