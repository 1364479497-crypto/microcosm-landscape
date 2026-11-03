import * as THREE from 'three';

// Independent world-space accumulation grid. This is a damped local forcing
// model, not a claim of a physically conservative atmosphere/fluid solver.
export function createEnvironmentField({width=80,height=64}={}){
 const bounds={minX:-6,minZ:-5.3,sizeX:12,sizeZ:9.6};
 const count=width*height,wet=new Float32Array(count),snow=new Float32Array(count),impact=new Float32Array(count),heights=new Float32Array(count),vx=new Float32Array(count),vz=new Float32Array(count),data=new Float32Array(count*4),windData=new Float32Array(count*4);
 const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
 const windTexture=new THREE.DataTexture(windData,width,height,THREE.RGBAFormat,THREE.FloatType);windTexture.minFilter=windTexture.magFilter=THREE.LinearFilter;windTexture.needsUpdate=true;
 let terrain=null,elapsed=0,meanWet=0,meanSnow=0;
 const index=(x,z)=>{const i=THREE.MathUtils.clamp(Math.floor((x-bounds.minX)/bounds.sizeX*width),0,width-1),j=THREE.MathUtils.clamp(Math.floor((z-bounds.minZ)/bounds.sizeZ*height),0,height-1);return j*width+i;};
 function setTerrain(t){terrain=t;for(let j=0;j<height;j++)for(let i=0;i<width;i++)heights[j*width+i]=t.height(bounds.minX+(i+.5)/width*bounds.sizeX,bounds.minZ+(j+.5)/height*bounds.sizeZ);}
 function addWind(point,direction,strength=1){
  const radius=1.6;for(let j=0;j<height;j++)for(let i=0;i<width;i++){const x=bounds.minX+(i+.5)/width*bounds.sizeX,z=bounds.minZ+(j+.5)/height*bounds.sizeZ,d2=(x-point.x)**2+(z-point.z)**2;if(d2>radius*radius*3)continue;const f=Math.exp(-d2/(radius*radius))*.8*strength,k=j*width+i;vx[k]=THREE.MathUtils.clamp(vx[k]+direction.x*f,-2,2);vz[k]=THREE.MathUtils.clamp(vz[k]+direction.y*f,-2,2);}
 }
 function update(dt,state,emitters=[]){
  dt=Math.min(.05,Math.max(0,dt));elapsed+=dt;let sw=0,ss=0;
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){
   const k=j*width+i,x=bounds.minX+(i+.5)/width*bounds.sizeX,z=bounds.minZ+(j+.5)/height*bounds.sizeZ;
   const localTemp=state.temperature-Math.max(0,heights[k])*(state.lapseRate??2.2);let rainRate=0,snowRate=0;
   for(const e of emitters){const d=((x-e.x)**2+(z-e.z)**2)/(e.radius*e.radius);if(d>3.5)continue;const rate=e.rate*Math.exp(-d*1.55);const fraction=THREE.MathUtils.smoothstep(-localTemp,-1.2,1.8);rainRate+=rate*(1-fraction);snowRate+=rate*fraction;}
   const cold=THREE.MathUtils.smoothstep(-localTemp,.2,4.5);
   // A slow winter front supplies light ambient deposition; squeezed clouds
   // add spatially distinct, much faster accumulation on top of that baseline.
   snow[k]=THREE.MathUtils.clamp(snow[k]+dt*(snowRate*.16+cold*.035)-dt*Math.max(localTemp,0)*.0025,0,1);
   const melt=Math.max(0,localTemp)*.003*snow[k];
   wet[k]=THREE.MathUtils.clamp(wet[k]+dt*(rainRate*.35+melt)-dt*(.006+state.daylight*.005)*(1-rainRate*.25),0,1);
   impact[k]=THREE.MathUtils.damp(impact[k],rainRate,8,dt);vx[k]*=Math.exp(-dt*.7);vz[k]*=Math.exp(-dt*.7);
   if(state.windPaused){vx[k]=0;vz[k]=0;}
   const gust=.65+.35*Math.sin(elapsed*.6+x*.9+z*.7),wx=state.windPaused?0:state.wind.x*state.windStrength*gust+vx[k],wz=state.windPaused?0:state.wind.y*state.windStrength*gust+vz[k];
   let transmission=1;
   const sun=state.sunDirection;
   if(sun&&sun.y>.12)for(const cloud of state.cloudShadows||[]){const drop=Math.max(0,cloud.y-heights[k])/Math.max(.3,sun.y),cx=cloud.x-sun.x*drop,cz=cloud.z-sun.z*drop,q=((x-cx)/cloud.rx)**2+((z-cz)/cloud.rz)**2;transmission*=1-Math.exp(-q*1.3)*cloud.opacity;}
   const a=k*4;data[a]=wet[k];data[a+1]=snow[k];data[a+2]=Math.min(1,impact[k]);data[a+3]=transmission;
   windData[a]=wx;windData[a+1]=wz;windData[a+2]=Math.min(1,Math.hypot(wx,wz));windData[a+3]=1;sw+=wet[k];ss+=snow[k];
  }
  meanWet=sw/count;meanSnow=ss/count;texture.needsUpdate=true;windTexture.needsUpdate=true;
 }
 function clearWind(){vx.fill(0);vz.fill(0);windData.fill(0);for(let k=0;k<count;k++)windData[k*4+3]=1;windTexture.needsUpdate=true;}
 function reset(){wet.fill(0);snow.fill(0);impact.fill(0);data.fill(0);for(let k=0;k<count;k++)data[k*4+3]=1;elapsed=meanWet=meanSnow=0;clearWind();texture.needsUpdate=true;}
 return{texture,windTexture,reset,clearWind,bounds,width,height,setTerrain,addWind,update,sampleHeight:(x,z)=>heights[index(x,z)],sampleWet:(x,z)=>wet[index(x,z)],sampleSnow:(x,z)=>snow[index(x,z)],sampleImpact:(x,z)=>impact[index(x,z)],sampleWind(x,z,target=new THREE.Vector2()){const k=index(x,z);return target.set(windData[k*4],windData[k*4+1]);},get stats(){return{resolution:[width,height],meanWet,meanSnow};},dispose(){texture.dispose();windTexture.dispose();}};
}

export function seasonalTemperature(phase){
 const values=[15,25,10,-7],i=Math.floor(((phase%4)+4)%4),t=((phase%4)+4)%4-i,a=values[(i+3)%4],b=values[i],c=values[(i+1)%4],d=values[(i+2)%4];return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
}
