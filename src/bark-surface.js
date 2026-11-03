/**
 * Independently authored, metric bark material. No reference implementation is
 * used. A jittered cellular scaffold describes the same plates/folds/scars in
 * albedo, roughness and physical height; three small value fields describe its
 * growth variation and pores. The nine cellular candidates are the only loop.
 *
 * Inject BARK_SURFACE_GLSL into the fragment declarations. In color_fragment:
 *   float barkPeriod = vBarkRadius*6.28318530718;
 *   vec2 barkUV = vec2(vVegUV.x*barkPeriod/max(vBarkPeriod,.00001),vVegUV.y);
 *   BarkSurface bark = barkSurface(barkUV, vVegTraits.y,
 *     vVegWorldPosition.y-vVegRootY, vVegUp, vVegTraits.x,
 *     vBarkRadius, barkPeriod);
 *   diffuseColor.rgb = bark.colour;
 * In roughnessmap_fragment, after the include, before environmental wetness:
 *   roughnessFactor = bark.roughness;
 * In normal_fragment_maps, after the include:
 *   normal = barkPerturbNormal(-vViewPosition, normal, bark.height);
 * Remove the previous sinusoidal bark bumpMap: it would add an unrelated field.
 *
 * `uv.x` is CURRENT circumference in scene metres; `period` is that complete
 * circumference. Radius is the current ring radius. Every circumferential
 * lattice uses an integer cell count and wrapped hashes, including warp and
 * pores. Both field values and their tangents agree at 0/period, without a
 * blurry seam blend. No aTraits components are repurposed. Small twigs acquire
 * smoother bark, instead of inheriting full-depth trunk cracks.
 */
export const BARK_SURFACE_GLSL = /* glsl */ `
struct BarkSurface {
  vec3 colour;
  float height;
  float roughness;
  float cracks;
  float moss;
  float detail;
};

vec2 barkHash22(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * vec3(.1031, .1030, .0973));
  q += dot(q, q.yzx + 19.19);
  return fract(vec2((q.x+q.y)*q.z, (q.x+q.z)*q.y));
}

vec2 barkPeriodicHash(vec2 cell, float cellsAround) {
  return barkHash22(vec2(mod(cell.x,cellsAround),cell.y));
}

// x holds an integer number of cells around the current physical ring. The
// seed changes phase rather than period. z carries the integer hash period.
vec3 barkPeriodicPoint(vec2 p, float ringPeriod, vec2 density, vec2 phase) {
  float cells=max(1.0,floor(ringPeriod*density.x+.5));
  return vec3(p.x/ringPeriod*cells+phase.x,p.y*density.y+phase.y,cells);
}

float barkValue(vec2 p, float cellsAround) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = barkPeriodicHash(i,cellsAround).x;
  float b = barkPeriodicHash(i+vec2(1.0,0.0),cellsAround).x;
  float c = barkPeriodicHash(i+vec2(0.0,1.0),cellsAround).x;
  float d = barkPeriodicHash(i+vec2(1.0,1.0),cellsAround).x;
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}

// The field is averaged out before its feature frequency becomes subpixel.
// This removes high frequency normal energy, not just albedo contrast.
float barkResolved(vec2 p) {
  float pixel = max(length(dFdx(p)), length(dFdy(p)));
  return 1.0-smoothstep(.32,1.35,pixel);
}

BarkSurface barkSurface(vec2 uv, float species, float heightAboveRoot,
                       float normalUp, float seed, float radius, float period) {
  BarkSurface s;
  float age = smoothstep(.010,.032,radius);
  // Using the same radius ratio for the ring period keeps integer lattice
  // counts stable along a taper. A clamp here would introduce count-change
  // bands on the lower trunk as its circumference passed rounding thresholds.
  float size = max(radius/.057,.018);
  vec2 p = uv/size;
  float ringPeriod=max(period/size,.0001);
  vec2 seedOffset = vec2(seed*53.17, seed*37.91);

  // Coarse growth variation supplies both the warp and the basal damp mask.
  vec3 broadP = barkPeriodicPoint(p,ringPeriod,vec2(8.7,4.3),seedOffset);
  vec3 secondP = barkPeriodicPoint(p,ringPeriod,vec2(16.1,7.9),seedOffset.yx+vec2(7.3,13.7));
  float broad = mix(.5,barkValue(broadP.xy,broadP.z),barkResolved(broadP.xy));
  float secondary = mix(.5,barkValue(secondP.xy,secondP.z),barkResolved(secondP.xy));
  vec3 grainP = barkPeriodicPoint(p,ringPeriod,vec2(265.0,39.0),seedOffset);
  float grainResolved = barkResolved(grainP.xy);
  float grain = mix(.5,barkValue(grainP.xy,grainP.z),grainResolved);
  float basal = 1.0-smoothstep(.035,.36,max(0.0,heightAboveRoot));

  // Spruce plates: roughly 2 x 5 cm on a mature miniature trunk.
  // Hornbeam folds are elongated, whereas paper/cherry scars are horizontal.
  vec2 frequency = vec2(46.0,19.0);
  if (species<.5 || (species>2.5 && species<4.5)) frequency=vec2(37.0,3.9);
  if (species>1.5 && species<2.5) frequency=vec2(17.0,31.0);
  if (species>4.5) frequency=vec2(15.0,49.0);
  vec3 cellP=barkPeriodicPoint(p,ringPeriod,frequency,seedOffset);
  vec2 q=cellP.xy;
  q += vec2(broad-.5,secondary-.5)*vec2(.90,.56);
  float resolved = barkResolved(q);
  s.detail = resolved;
  vec2 cell = floor(q), inside = fract(q);
  float nearest = 20.0, second = 20.0, cellTone = .5;
  vec2 relative = vec2(0.0), otherRelative=vec2(0.0);
  for (int y=-1;y<=1;y++) {
    for (int x=-1;x<=1;x++) {
      vec2 tile = vec2(float(x),float(y));
      vec2 h = barkPeriodicHash(cell+tile,cellP.z);
      vec2 delta = tile+.18+.64*h-inside;
      float distance2 = dot(delta,delta);
      if (distance2<nearest) {
        second=nearest; nearest=distance2; otherRelative=relative;
        relative=delta; cellTone=h.x;
      } else {
        if (distance2<second) {second=distance2;otherRelative=delta;}
      }
    }
  }
  cellTone=mix(.5,cellTone,resolved);
  float edge = sqrt(second)-sqrt(nearest);
  float edgeAA = max(.006,fwidth(edge)*.62);
  float crackRaw = 1.0-smoothstep(.036-edgeAA,.069+edgeAA,edge);
  float crack = mix(.13,crackRaw,resolved);
  float plate = mix(.63,smoothstep(.035,.27,edge),resolved);
  float dome = mix(.54,exp(-nearest*3.1),resolved);
  float lip = smoothstep(.045,.105,edge)*(1.0-smoothstep(.105,.20,edge));
  lip *= resolved*smoothstep(.25,.78,cellTone);

  // A lenticel belongs to a jittered growth cell, with a tapered, interrupted
  // length. This is not an all-around horizontal sine stripe.
  float scarAA = max(.009,fwidth(relative.y)*.62);
  float scarY = 1.0-smoothstep(.024-scarAA,.055+scarAA,abs(relative.y));
  float scarX = 1.0-smoothstep(.12+.15*cellTone,.36+.08*cellTone,abs(relative.x));
  float scar = scarX*scarY*resolved;
  scar *= smoothstep(.12,.40,cellTone);
  s.cracks = crack;

  if (species>.5 && species<1.5) {
    // Spruce is a weathered fibrous skin with occasional lifting thin scales.
    // Select mostly longitudinal boundaries, interrupt them with growth
    // variation, and use a single short lip on selected cells. A complete
    // Voronoi outline never owns either colour or height in this branch.
    vec3 fiberP=barkPeriodicPoint(p,ringPeriod,vec2(108.0,6.1),seedOffset.yx+vec2(17.8,3.2));
    fiberP.xy+=vec2(broad-.5,secondary-.5)*vec2(.74,.25);
    float fiberResolved=barkResolved(fiberP.xy);
    float fiber=mix(.5,barkValue(fiberP.xy,fiberP.z),fiberResolved);
    vec2 boundaryDirection=otherRelative-relative;
    float verticalBoundary=smoothstep(.48,.90,abs(boundaryDirection.x)/(length(boundaryDirection)+.0001));
    float interruption=smoothstep(.32,.72,secondary)*smoothstep(.26,.74,broad);
    float split=crackRaw*verticalBoundary*mix(.08,1.0,interruption)*resolved*age;
    float shortWidth=1.0-smoothstep(.14,.30,abs(relative.x));
    float flap=exp(-pow((relative.y+.22)*11.0,2.0))*shortWidth;
    flap*=smoothstep(.42,.83,cellTone)*smoothstep(.38,.69,secondary)*resolved*age;
    float fineFiber=(1.0-smoothstep(.045,.15,abs(fiber-.5)))*fiberResolved;
    float tone=clamp(.49+.22*broad+.18*(fiber-.5)+.055*(cellTone-.5),0.0,1.0);
    vec3 matureColour=mix(vec3(.155,.148,.132),vec3(.300,.277,.240),tone);
    matureColour*=1.0-.22*split-.055*fineFiber;
    matureColour+=vec3(.014,.013,.011)*flap;
    vec3 youngColour=vec3(.193,.177,.147)*(.96+.08*broad);
    s.colour=mix(youngColour,matureColour,age)*(.97+.06*grain);
    s.height=(.00155*(fiber-.5)+.00070*(broad-.5)+.00085*flap
              -.00105*split+.00023*(grain-.5)-.00018*fineFiber)
              *size*mix(.025,1.0,age);
    s.roughness=clamp(.835+.08*split-.025*flap+.035*grain,.82,.97);
    s.cracks=clamp(split+.24*flap,0.0,1.0);
  } else if (species>4.5) {
    // Thin papery birch bark: pale body, short black transverse lenticels,
    // broken dark basal bark. Broad black patches are confined near the soil.
    float broken = smoothstep(.52,.73,.73*broad+.27*secondary);
    float basalBlack = basal*clamp(.86*broken+.34*crack,0.0,1.0);
    float tear = smoothstep(.81,.94,secondary)*smoothstep(.52,.74,broad)*.42;
    float dark = clamp(scar*.87+basalBlack+tear,0.0,.98);
    s.colour = mix(vec3(.655,.688,.647),vec3(.785,.792,.733),.24+.58*broad);
    s.colour = mix(s.colour,vec3(.032,.037,.031),dark);
    s.colour *= .965+.07*grain;
    s.height = (.00070*dome-.00072*scar-.00135*basalBlack
               +.00017*(grain-.5))*size*mix(.22,1.0,age);
    s.roughness = clamp(.77+.12*dark+.055*grain,.76,.96);
    s.cracks = dark;
  } else if (species>1.5 && species<2.5) {
    // Cherry has a warm smoother skin. Transverse scars interrupt it without
    // giving every trunk the same rings, and older basal skin is mildly split.
    float oldSplit = basal*crack*.45*age;
    s.colour = mix(vec3(.157,.102,.080),vec3(.310,.218,.157),.36+.38*broad+.18*dome);
    s.colour = mix(s.colour,vec3(.070,.058,.047),clamp(.80*scar+oldSplit,0.0,.9));
    s.colour *= .96+.08*grain;
    s.height = (.00065*dome-.00078*scar-.00055*oldSplit
               +.00020*(grain-.5))*size*mix(.20,1.0,age);
    s.roughness = clamp(.755+.14*scar+.10*oldSplit+.055*grain,.75,.96);
    s.cracks = clamp(scar+oldSplit,0.0,1.0);
  } else {
    // Hornbeam: grey-green muscular longitudinal folds. Broad rounded ridges
    // dominate; only older bark develops narrow dark split lines.
    float oldSplit = crack*age;
    s.colour = mix(vec3(.165,.181,.159),vec3(.303,.313,.278),.34+.36*broad+.24*dome);
    s.colour *= 1.0-.15*oldSplit;
    s.colour *= .965+.07*grain;
    s.height = (.00215*dome-.00060*oldSplit+.00021*(grain-.5))
               *size*mix(.16,1.0,age);
    s.roughness = clamp(.805+.095*oldSplit+.055*grain,.80,.97);
    s.cracks = oldSplit;
  }

  // Moss requires a damp basal pocket or upward-facing root. The height gate
  // prevents random green islands from spreading through the whole crown.
  s.moss = basal*smoothstep(.56,.77,.68*broad+.32*secondary)
          *mix(.30,.85,clamp(normalUp,0.0,1.0))*age;
  s.colour = mix(s.colour,vec3(.100,.137,.063)*(.82+.28*grain),s.moss*.68);
  s.height += s.moss*.00048*size;
  s.roughness = mix(s.roughness,.96,s.moss*.66);
  return s;
}

// Gradient of physical height in the local surface plane. Both position and
// normal are view-space, matching MeshStandardMaterial's normal_fragment_maps.
// Height itself has already had its unresolved frequencies removed above.
vec3 barkPerturbNormal(vec3 surfacePosition, vec3 surfaceNormal, float height) {
  vec3 dpdx=dFdx(surfacePosition), dpdy=dFdy(surfacePosition);
  vec3 tx=cross(dpdy,surfaceNormal), ty=cross(surfaceNormal,dpdx);
  float determinant=dot(dpdx,tx);
  vec3 gradient=dFdx(height)*tx+dFdy(height)*ty;
  return normalize(abs(determinant)*surfaceNormal-sign(determinant)*gradient
                   +surfaceNormal*1e-10);
}

// Optional unlit diagnostics. Modes: 1 albedo, 2 signed height, 3 cracks/scars,
// 4 roughness, 5 basal moss, 6 retained cellular frequency (white=resolved).
vec3 barkSurfaceDebug(BarkSurface s, float mode) {
  if (mode>5.5) return vec3(s.detail);
  if (mode>4.5) return vec3(s.moss);
  if (mode>3.5) return vec3(s.roughness);
  if (mode>2.5) return vec3(s.cracks);
  if (mode>1.5) return vec3(clamp(.40+s.height*105.0,0.0,1.0));
  return s.colour;
}
`;
