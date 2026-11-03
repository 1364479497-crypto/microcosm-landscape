// Authored alluvial cutaway. Shared world-space lenses bind the matrix and
// exposed grains; depth below the actual surface owns the thicker humic soil.
// This miniature recipe is not a geological survey of a particular location.
export const SOIL_SECTION_SPEC=Object.freeze({version:'2.3.6',bottom:-1.5,grainRadius:[.006,.110],
  grainClasses:['mineral grit','rounded alluvial gravel','coarse cobbles','angular flattened fragments'],
  grainForms:['rounded','angular','platy'],lensMean:-.86,lensHalfWidth:[.065,.235],embedFraction:[.34,.86],
  rootMatThickness:[.035,.065],topsoilThickness:[.36,.46],mineralTop:-.50,parentTop:-1.19,
  // Linear working albedos: the thicker A horizon remains warm brown in shade.
  organicAlbedo:[.153,.100,.051],transitionAlbedo:[.245,.142,.066],
  mineralAlbedo:[.390,.286,.160],ironAlbedo:[.283,.122,.046],
  gravelMatrixAlbedo:[.180,.187,.158],parentAlbedo:[.115,.133,.119]});
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export function sampleSoilSection(x,z){
 const drift=.053*Math.sin(x*.73+z*.41)+.028*Math.sin(z*1.6-x*.33)+.011*Math.sin(x*4+z*2.1);
 const deposit=Math.sin(x*1.06-z*.54+.9)+.48*Math.sin(x*.36+z*.91);
 const fullness=smooth(-.80,.74,deposit);
 const halfWidth=.065+.170*fullness;
 const continuity=.24+.76*smooth(-.91,.72,Math.sin(x*.92+z*.71)+.45*Math.sin(x*2.43-z*.37));
 const sorting=.5+.5*Math.sin(x*.57-z*1.21+.7);
 const skew=.50*Math.sin(x*1.31+z*.74);
 const horizonWarp=.030*Math.sin(x*.94+z*.67)+.014*Math.sin(x*3.3-z*1.71);
 const topsoilThickness=.36+.10*(.5+.5*Math.sin(x*.69-z*.81+1.8));
 return {center:-.86+drift,halfWidth,continuity,drift,fullness,sorting,skew,horizonWarp,topsoilThickness};
}
export const SOIL_SECTION_GLSL=`
vec3 soilSectionLens(vec2 p){
 float drift=.053*sin(p.x*.73+p.y*.41)+.028*sin(p.y*1.6-p.x*.33)+.011*sin(p.x*4.+p.y*2.1);
 float deposit=sin(p.x*1.06-p.y*.54+.9)+.48*sin(p.x*.36+p.y*.91);
 float halfWidth=.065+.170*smoothstep(-.80,.74,deposit);
 float continuity=.24+.76*smoothstep(-.91,.72,sin(p.x*.92+p.y*.71)+.45*sin(p.x*2.43-p.y*.37));
 return vec3(-.86+drift,halfWidth,continuity);
}
vec2 soilSectionHorizons(vec2 p){
 float warp=.030*sin(p.x*.94+p.y*.67)+.014*sin(p.x*3.3-p.y*1.71);
 float topsoilThickness=.36+.10*(.5+.5*sin(p.x*.69-p.y*.81+1.8));
 return vec2(warp,topsoilThickness);
}
`;
