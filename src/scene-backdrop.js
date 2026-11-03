import * as THREE from 'three';

// Authored in metres on the receiving plane, never in screen UVs. The painting
// reference contributes paper tooth and quiet dry-brush marks, not its imagery.
// All helpers below depend only on GLSL built-ins so they are legal before
// Three's <common> chunk. No texture, render target, clock or camera is involved.
const PAPER_SURFACE_GLSL=`
float backdropPaperHash(vec2 p){
 p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);
 return fract(p.x*p.y);
}
float backdropPaperNoise(vec2 p){
 vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(backdropPaperHash(cell),backdropPaperHash(cell+vec2(1.,0.)),f.x),mix(backdropPaperHash(cell+vec2(0.,1.)),backdropPaperHash(cell+vec2(1.)),f.x),f.y);
}
float backdropPaperFiltered(vec2 p){
 // Resolve the fibre only while its cell has enough physical pixels. Its
 // mean is retained when minified, rather than shimmering at grazing angles.
 float footprint=max(length(dFdx(p)),length(dFdy(p)));
 return (backdropPaperNoise(p)-.5)*(1.-smoothstep(.28,1.05,footprint));
}
vec4 backdropPaperFields(vec2 p){
 vec2 stroke=mat2(.939693,-.342020,.342020,.939693)*p;
 float tooth=backdropPaperFiltered(p*18.);
 float fibreA=backdropPaperFiltered(p*vec2(72.,9.));
 float fibreB=backdropPaperFiltered(stroke*vec2(14.,63.)+13.7);
 float grain=tooth*.55+fibreA*.26+fibreB*.19;
 // Broad dry brush carries the material at the design camera; the finer
 // broken bristles share its direction and fade before becoming pixel grain.
 float brush=backdropPaperFiltered(stroke*vec2(.42,5.5))*.52
            +backdropPaperFiltered(stroke*vec2(1.15,14.)+17.1)*.30
            +backdropPaperFiltered(stroke*vec2(3.1,29.)+43.3)*.18;
 float glaze=backdropPaperNoise(p*.24+vec2(7.4,21.8));
 // This is a small, view-independent painted contact wash around the known
 // 12 x 9.6 m plinth footprint. It is not a baked directional cast shadow;
 // the actual shadow remains the scene's live shadow-map contribution.
 vec2 q=abs(p-vec2(0.,-.5))-vec2(6.,4.8);
 float outside=max(length(max(q,vec2(0.)))+min(max(q.x,q.y),0.),0.);
 float contact=.28*exp(-pow(outside/.20,2.))
              +.14*exp(-pow(outside/.92,2.))*(.75+glaze*.25);
 return vec4(grain,brush,contact,glaze);
}
`;

// A quiet, authored studio setting for the miniature: pale celadon sky, distant
// colour masses and a paper-sage studio surface. The sky is a regular 2D background
// texture; it owns no geometry/depth and cannot occlude the lake's sky lighting.
export function createSceneBackdrop(scene,{renderer}={}){
 const previousBackground=scene.background,previousFog=scene.fog?.color.clone(),previousFogDensity=scene.fog?.density,group=new THREE.Group();group.name='Peach retreat celadon-paper backdrop';scene.add(group);
 const width=256,height=128,pixels=new Uint8Array(width*height*4),texture=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat,THREE.UnsignedByteType);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.name='Authored mist and distant hill sky';scene.background=texture;
 const horizon=new THREE.Color(),groundColor=new THREE.Color(),viewportUniform={value:new THREE.Vector4(0,0,1,1)},skyUniform={value:texture},intensityUniform={value:scene.backgroundIntensity??1},groundMaterial=new THREE.MeshStandardMaterial({color:0xb7c8bd,roughness:1,metalness:0,fog:false});
 groundMaterial.onBeforeCompile=shader=>{shader.uniforms.uBackdropViewport=viewportUniform;shader.uniforms.uBackdropSky=skyUniform;shader.uniforms.uBackdropIntensity=intensityUniform;shader.vertexShader='varying vec3 vBackdropWorld;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBackdropWorld=(modelMatrix*vec4(position,1.)).xyz;');shader.fragmentShader='uniform vec4 uBackdropViewport;uniform sampler2D uBackdropSky;uniform float uBackdropIntensity;varying vec3 vBackdropWorld;\n'+PAPER_SURFACE_GLSL+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
vec4 backdropPaper=backdropPaperFields(vBackdropWorld.xz);
diffuseColor.rgb*=.985+backdropPaper.x*.14+backdropPaper.y*.34;
// A restrained ivory / warm grey glaze and ink-celadon contact wash keep the
// paper in the accepted palette while the live light still shapes its values.
diffuseColor.rgb*=mix(vec3(1.009,1.,.987),vec3(.992,1.,1.006),backdropPaper.w);
diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.70,.79,.79),backdropPaper.z);
float backdropPaperHeight=backdropPaper.x*.0018+backdropPaper.y*.0038;`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
roughnessFactor=clamp(roughnessFactor*(.955+backdropPaper.x*.060-backdropPaper.y*.055),.94,1.);`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
// Height and colour share the same resolved fibre field. View-space surface
// derivatives match Three's view-space normal; camera rotation cannot slide
// the authored marks or turn the relief into a screen-space shading effect.
vec3 backdropDx=dFdx(-vViewPosition),backdropDy=dFdy(-vViewPosition);
vec3 backdropT=cross(backdropDy,normal),backdropB=cross(normal,backdropDx);
float backdropDet=dot(backdropDx,backdropT);
vec3 backdropGradient=dFdx(backdropPaperHeight)*backdropT+dFdy(backdropPaperHeight)*backdropB;
normal=normalize(max(abs(backdropDet),1e-8)*normal-sign(backdropDet)*backdropGradient);`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',`#include <tonemapping_fragment>
// SRGB backgrounds are exempt from renderer tone mapping. Match their decoded
// linear sample here, after ground tone mapping but before output conversion.
// The current physical viewport also covers all differently sized capture RTs.
float backdropDistance=length(vBackdropWorld.xz-cameraPosition.xz);
float backdropHaze=smoothstep(25.,65.,backdropDistance);
vec2 backdropUv=clamp((gl_FragCoord.xy-uBackdropViewport.xy)/max(vec2(1.),uBackdropViewport.zw),vec2(0.),vec2(1.));
vec3 backdropSky=texture2D(uBackdropSky,backdropUv).rgb*uBackdropIntensity;
gl_FragColor.rgb=mix(gl_FragColor.rgb,backdropSky,backdropHaze);`);};
 groundMaterial.customProgramCacheKey=()=> 'celadon-paper-world-fibre-ground-v5-readable-brush';
 const geometry=new THREE.PlaneGeometry(160,160),ground=new THREE.Mesh(geometry,groundMaterial);ground.rotation.x=-Math.PI/2;ground.position.y=-1.525;ground.receiveShadow=true;ground.name='Matte pale celadon ground receiving miniature shadow';ground.onBeforeRender=(activeRenderer,activeScene)=>{activeRenderer.getCurrentViewport(viewportUniform.value);intensityUniform.value=activeScene.backgroundIntensity??1;};group.add(ground);
 const clamp=THREE.MathUtils.clamp,mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t),rgb=hex=>[(hex>>16&255)/255,(hex>>8&255)/255,(hex&255)/255],night={top:rgb(0x172b38),horizon:rgb(0x344c52),ground:rgb(0x273d42)},day={top:rgb(0xcadbd7),horizon:rgb(0xe7eadf),ground:rgb(0xb7c8bd)},dusk={top:rgb(0x9facad),horizon:rgb(0xd7ceba)};
 let lastKey='',disposed=false;const stats={drawCalls:1,skyGeometry:0,renderTargets:0,textureResolution:[width,height],textureUpdates:0,daylight:1,rain:0,flash:0,fogDensity:.0028,clearAirOwnership:'Weather-scaled distance haze in scene world units; clear miniature has no persistent grey veil',style:'pale celadon / paper sage / vermilion UI accents',surfaceDetail:'World-metre filtered paper fibre and directional dry-brush; coherent colour, roughness and 1.8/3.8 mm relief; design-scale brush contrast',contactSupport:'Live received shadows plus a restrained undirected painted wash at the 12 x 9.6 m plinth; floor gap 0.025 m',backgroundDepth:'default 2D background; no depth geometry',farGroundMatch:'Same sky texture, current physical viewport, after tone map and before output; full fade by65m; ground fog disabled',ownedResources:{geometry:1,material:1,texture:1},disposed:false};
 function update(state={}){if(disposed)return;const daylight=clamp(state.daylight??1,0,1),rain=clamp(Math.max(state.rain??0,(state.effectiveRain??0)*.3),0,1),flash=clamp(state.lightning??0,0,1),hour=state.hour??15,evening=clamp(1-Math.abs(hour-18)/3,0,1)*daylight;
  // FogExp2 is a world-distance term, not a background palette. The old
  // fixed .013 mixed nearly 10% pale fog into a normal 24m design view even
  // in clear weather. Keep clear air thin and restore haze only with weather.
  const fog=clamp(state.fog??0,0,1),fogDensity=.0028+(1-daylight)*.0018+rain*.006+fog*.014;
  if(scene.fog&&typeof scene.fog.density==='number')scene.fog.density=fogDensity;
  Object.assign(stats,{fogDensity,fog});
  const key=[Math.round(daylight*64),Math.round(rain*16),Math.round(evening*24),Math.round(flash*6)].join(':');if(key===lastKey)return;lastKey=key;
  let top=mix(night.top,day.top,daylight),low=mix(night.horizon,day.horizon,daylight),soil=mix(night.ground,day.ground,daylight);top=mix(top,dusk.top,evening*.55);low=mix(low,dusk.horizon,evening*.7);
  const stormTint=rgb(0x889e9e);top=mix(top,stormTint,rain*.55);low=mix(low,stormTint,rain*.36);const flashColor=rgb(0xdde6e6);top=mix(top,flashColor,flash*.28);low=mix(low,flashColor,flash*.20);
  const hillFar=mix(low,top,.32),hillNear=mix(low,top,.50);
  for(let y=0;y<height;y++){const v=y/(height-1),gradient=clamp((v-.22)/.78,0,1),base=mix(low,top,Math.pow(gradient,.72));for(let x=0;x<width;x++){const u=x/(width-1);let c=base;
   // These haze masses stay subordinate to the miniature silhouette. They
   // are painted in the background, never intersected as scene mountains.
   const farRidge=.735+Math.sin(u*5.2+1.8)*.025+Math.sin(u*13.4-.5)*.014+Math.sin(u*21.7+.8)*.007;
   const nearRidge=.665+Math.sin(u*6.7+.3)*.023+Math.sin(u*15.6+1.2)*.010;
   const farCover=clamp((farRidge-v)*60+.5,0,1)*.22,nearCover=clamp((nearRidge-v)*65+.5,0,1)*.17;
   c=mix(c,hillFar,farCover);c=mix(c,hillNear,nearCover);const warmGlaze=Math.exp(-((u-.88)**2/.17+(v-.88)**2/.19))*.055*daylight*(1-rain);const i=(y*width+x)*4;
   pixels[i]=clamp(c[0]+warmGlaze,0,1)*255;pixels[i+1]=clamp(c[1]+warmGlaze*.65,0,1)*255;pixels[i+2]=clamp(c[2],0,1)*255;pixels[i+3]=255;
  }}
  texture.needsUpdate=true;const fogTone=mix(low,top,.65);horizon.setRGB(fogTone[0],fogTone[1],fogTone[2],THREE.SRGBColorSpace);groundColor.setRGB(soil[0],soil[1],soil[2],THREE.SRGBColorSpace);groundMaterial.color.copy(groundColor);if(scene.fog)scene.fog.color.copy(horizon);Object.assign(stats,{textureUpdates:stats.textureUpdates+1,daylight,rain,flash});
 }
 update({daylight:1,hour:15});
 return{group,ground,texture,stats,update,dispose(){if(disposed)return;disposed=true;scene.remove(group);geometry.dispose();groundMaterial.dispose();texture.dispose();if(scene.background===texture)scene.background=previousBackground;if(previousFog&&scene.fog)scene.fog.color.copy(previousFog);if(scene.fog&&Number.isFinite(previousFogDensity))scene.fog.density=previousFogDensity;stats.disposed=true;}};
}
