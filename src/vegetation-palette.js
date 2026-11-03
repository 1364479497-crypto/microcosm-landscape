// Saturate green reflectance before lighting, preserving linear luminance and
// existing canopy/wetness/snow/species colour. This is not a screen-wide grade.
export const VEGETATION_CHROMA_GAIN=1.2;
const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)};
export function saturateVegetationRGB(rgb,gain=VEGETATION_CHROMA_GAIN){
 const [r,g,b]=rgb,hi=Math.max(r,g,b),lo=Math.min(r,g,b),green=smooth(.01,.06,(g-Math.max(r,b))/Math.max(.02,hi))*smooth(.14,.35,(hi-lo)/Math.max(.02,hi)),lum=r*.2126+g*.7152+b*.0722,k=1+(gain-1)*green;
 return rgb.map(v=>Math.min(1,Math.max(0,lum+(v-lum)*k)));
}
export function installVegetationPalette(group,{gain=VEGETATION_CHROMA_GAIN}={}){
 const seen=new Set(),rows=[],uniform={value:gain};
 group.traverse(o=>{if(!o.isMesh)return;for(const m of(Array.isArray(o.material)?o.material:[o.material])){if(!m?.isMeshStandardMaterial||seen.has(m))continue;seen.add(m);const previous=m.onBeforeCompile,previousKey=m.customProgramCacheKey();
  m.onBeforeCompile=function(shader,renderer){previous.call(this,shader,renderer);shader.uniforms.uVegetationChromaGain=uniform;shader.fragmentShader='uniform float uVegetationChromaGain;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`float vegColourHi=max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b));
float vegColourLo=min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b));
float vegGreenWeight=smoothstep(.01,.06,(diffuseColor.g-max(diffuseColor.r,diffuseColor.b))/max(.02,vegColourHi))*smoothstep(.14,.35,(vegColourHi-vegColourLo)/max(.02,vegColourHi));
float vegColourLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
diffuseColor.rgb=clamp(vec3(vegColourLuma)+(diffuseColor.rgb-vegColourLuma)*(1.+(uVegetationChromaGain-1.)*vegGreenWeight),0.,1.);
#include <roughnessmap_fragment>`)};
  m.customProgramCacheKey=()=>previousKey+'|green-reflectance-chroma-v1';m.needsUpdate=true;m.userData.vegetationChroma={gain,space:'linear reflectance before direct/indirect lighting',greenOnly:true};rows.push({mesh:o.name,material:m.name||m.type});}});
 return{setGain(v){uniform.value=Math.min(1.5,Math.max(1,Number(v)||1));},get stats(){return{gain:uniform.value,materials:rows.length,scope:'Green albedo only; existing species/AO/snow/lighting retained',rows}}};
}
