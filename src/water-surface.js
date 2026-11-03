import * as THREE from 'three';

// Shared optical micro-surface. These sub-grid capillary slopes affect light
// transport, not the supported height of a fish or a floating leaf.
export const LAKE_OPTICAL_NORMAL_GLSL=`
vec2 lakeSlopeBand(vec2 p,vec2 direction,float frequency,float rate,float amplitude,float time,float footprint){
 vec2 across=vec2(-direction.y,direction.x);float bend=dot(p,across)*(frequency*.14)+time*.19+frequency*.37;
 float phase=dot(p,direction)*frequency+time*rate+1.85*sin(bend);
 float weight=1.-smoothstep(.8,2.4,frequency*footprint);
 vec2 phaseGradient=direction+across*(1.85*.14*cos(bend));
 return phaseGradient*cos(phase)*amplitude*weight;
}
float lakeMicroHash(vec2 p){return fract(sin(dot(p,vec2(117.31,269.57)))*29341.1297);}
vec3 lakeMicroNoiseD(vec2 p){
 vec2 i=floor(p),f=fract(p),u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f-1.)*(f-1.);
 float a=lakeMicroHash(i),b=lakeMicroHash(i+vec2(1,0)),c=lakeMicroHash(i+vec2(0,1)),d=lakeMicroHash(i+vec2(1,1)),crossTerm=a-b-c+d;
 return vec3(a+(b-a)*u.x+(c-a)*u.y+crossTerm*u.x*u.y,((b-a)+crossTerm*u.y)*du.x,((c-a)+crossTerm*u.x)*du.y);
}
vec2 lakeMicroSlope(vec2 p,float time,float footprint){
 vec2 drift=p+vec2(time*.025,-time*.018);vec3 wx=lakeMicroNoiseD(drift*1.3+vec2(7.2,1.9)),wy=lakeMicroNoiseD(drift*1.1+vec2(1.4,9.1));
 vec2 warp=vec2(wx.x,wy.x)-.5,dx=wx.yz*1.3,dy=wy.yz*1.1;
 mat2 turn=mat2(.80,.60,-.60,.80);
 vec3 a=lakeMicroNoiseD(drift*7.2+warp*2.2),b=lakeMicroNoiseD(turn*drift*12.7+warp*3.1+vec2(3.1,time*.09));
 vec2 ga=a.y*(vec2(7.2,0.)+dx*2.2)+a.z*(vec2(0.,7.2)+dy*2.2);
 vec2 gb=b.y*(vec2(.80,-.60)*12.7+dx*3.1)+b.z*(vec2(.60,.80)*12.7+dy*3.1);
 float low=1.-smoothstep(.45,1.5,footprint*7.2),high=1.-smoothstep(.35,1.1,footprint*12.7);
 return -(ga*(.018*low)+gb*(.0055*high));
}
vec3 lakeOpticalNormal(vec2 p,float depth,float time,vec2 wind,float footprint){
 float e=.008,dx=(lakeWave(p+vec2(e,0),depth,time,wind)-lakeWave(p-vec2(e,0),depth,time,wind))/(2.*e);
 float dz=(lakeWave(p+vec2(0,e),depth,time,wind)-lakeWave(p-vec2(0,e),depth,time,wind))/(2.*e);
 float strength=.76+.24*sqrt(min(2.8,length(wind))),shore=smoothstep(.015,.19,depth);
 vec2 slope=lakeMicroSlope(p,time,footprint);
 slope+=lakeSlopeBand(p,normalize(vec2(.61,.79)),58.,-2.7,.012,time,footprint);
 return normalize(vec3(-dx+slope.x*shore*strength,1.,-dz+slope.y*shore*strength));
}
`;

// One surface definition for the lake mesh and the foam that enters it.
// The inlet is a prescribed decaying surface jet, not a whole-lake fluid solver.
export const INLET_GLSL=`
uniform vec2 uMouthOrigin,uMouthDirection;
uniform float uMouthSpeed,uMouthTravel,uMouthHalfWidth,uLakeLevel,uLakeBaseLevel;
vec4 inletCoords(vec2 p){
 vec2 d=p-uMouthOrigin,side=vec2(-uMouthDirection.y,uMouthDirection.x);
 float s=dot(d,uMouthDirection),c=dot(d,side),w=uMouthHalfWidth+.25*max(s,0.);
 float mask=exp(-c*c/(w*w)*1.65)*smoothstep(-.12,.15,s)*(1.-smoothstep(1.25,2.15,s));
 return vec4(s,c,w,mask);
}
float inletTravel(float s){s=max(s,0.);return (s+.575*s*s)/max(.05,uMouthSpeed);}
float inletWave(vec2 p,float time){
 vec4 f=inletCoords(p);float bank=.42+.58*(1.-clamp(f.y*f.y/max(.01,f.z*f.z),0.,1.));
 float age=uMouthTravel+inletTravel(f.x)-time;
 float wave=sin(age*2.0+f.y*13.)*.54+sin(age*3.1-f.y*21.+.7)*.30+sin(age*4.4+f.y*7.)*.16;
 return wave*.0015*f.w;
}
float lakeWave(vec2 p,float bedDepth,float time,vec2 wind){
 vec2 a=normalize(vec2(.86,.45)+wind*.7),b=vec2(-.42,.91);
 float shore=smoothstep(.015,.22,bedDepth),breeze=sqrt(min(2.8,length(wind)));
 return (sin(dot(p,a)*15.-time*1.7)*(.0015+breeze*.00105)+sin(dot(p,b)*26.+time*2.5)*.0010+sin(dot(p,vec2(.27,-.96))*39.-time*3.2)*.00045)*shore+inletWave(p,time)*shore;
}
`;
const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export function installInletUniforms(uniforms,level=.18){
 for(const [name,value]of Object.entries({uMouthOrigin:new THREE.Vector2(.7,1.05),uMouthDirection:new THREE.Vector2(.35,.94).normalize(),uMouthSpeed:.3,uMouthTravel:0,uMouthHalfWidth:.3,uLakeLevel:level,uLakeBaseLevel:level}))if(!uniforms[name])uniforms[name]={value};
}
export function configureInlet(flow,terrain,uniforms){
 installInletUniforms(uniforms,terrain.lake.level);
 const entry=flow.samples.find(s=>s.backwater>.15&&!s.fallWeight&&terrain.height(s.position[0],s.position[2])<terrain.lake.level-.035)||flow.samples[flow.samples.length-1];
 const incoming=flow.sampleAtDistance(Math.max(0,entry.distance-.65));
 const dir=new THREE.Vector2(entry.tangent[0],entry.tangent[2]).normalize();
 uniforms.uMouthOrigin.value.set(entry.position[0],entry.position[2]);uniforms.uMouthDirection.value.copy(dir);
 // A shallow incoming jet retains momentum above the much slower deep-water
 // cross-section mean. Its explicit decay is used by both waves and tracers.
 uniforms.uMouthSpeed.value=THREE.MathUtils.clamp(incoming.speed*.8,.18,.65);uniforms.uMouthTravel.value=entry.travelTime;uniforms.uMouthHalfWidth.value=entry.halfWidth;
 return{position:[entry.position[0],terrain.lake.level,entry.position[2]],direction:[dir.x,dir.y],travelTime:entry.travelTime,distance:entry.distance,speed:uniforms.uMouthSpeed.value,maxDistance:2.15};
}
export function inletCoordinates(x,z,u){const dx=x-u.uMouthOrigin.value.x,dz=z-u.uMouthOrigin.value.y,dir=u.uMouthDirection.value,s=dx*dir.x+dz*dir.y,c=-dx*dir.y+dz*dir.x,w=u.uMouthHalfWidth.value+.25*Math.max(s,0),mask=Math.exp(-c*c/(w*w)*1.65)*smooth(-.12,.15,s)*(1-smooth(1.25,2.15,s));return{s,c,w,mask};}
export function lakeSurfaceHeight(x,z,bedDepth,u,time=u.uTime.value){
 const wind=u.uWind.value,wx=.86+wind.x*.7,wz=.45+wind.y*.7,n=Math.hypot(wx,wz),shore=smooth(.015,.22,bedDepth);
 const breeze=Math.sqrt(Math.min(2.8,wind.length())),base=(Math.sin((x*wx/n+z*wz/n)*15-time*1.7)*(.0015+breeze*.00105)+Math.sin((x*-.42+z*.91)*26+time*2.5)*.0010+Math.sin((x*.27-z*.96)*39-time*3.2)*.00045)*shore;
 const f=inletCoordinates(x,z,u),bank=.42+.58*(1-THREE.MathUtils.clamp(f.c*f.c/Math.max(.01,f.w*f.w),0,1)),s=Math.max(0,f.s),tau=(s+.575*s*s)/Math.max(.05,u.uMouthSpeed.value),age=u.uMouthTravel.value+tau-time;
 const wave=(Math.sin(age*2.0+f.c*13)*.54+Math.sin(age*3.1-f.c*21+.7)*.30+Math.sin(age*4.4+f.c*7)*.16)*.0015*f.mask*shore;
 return u.uLakeLevel.value+base+wave;
}
export function inletTracer(age,lane,u){
 const s=(-1+Math.sqrt(1+2*1.15*u.uMouthSpeed.value*Math.max(0,age)))/1.15,w=u.uMouthHalfWidth.value+.25*s,dir=u.uMouthDirection.value;
 return{x:u.uMouthOrigin.value.x+dir.x*s-dir.y*lane*w,z:u.uMouthOrigin.value.y+dir.y*s+dir.x*lane*w,s};
}
