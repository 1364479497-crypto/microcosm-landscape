import * as THREE from 'three';
import {createWetlandRelief} from './wetland-relief.js';

// Coordinate contract: metres in the miniature's authored frame. All relief,
// bank masks, vegetation contacts, and section boundaries share this field.
export const TERRAIN_BOUNDS = Object.freeze({minX:-6,maxX:6,minZ:-5.3,maxZ:4.3,bottom:-1.5});
export const LAKE_SPEC = Object.freeze({x:1.45,z:2.8,rx:2.45,rz:2.05,level:.18,front:4.25});
export const RIVER_NODES = Object.freeze([
  [0,3.05,-3.35],[0,2.96,-3.16],[0,1.25,-2.96],[-.08,1.23,-2.25],[-.12,.72,-1.2],
  [.15,.4,-.15],[.45,.22,.85],[.95,.18,1.6],
]);

const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = (a,b,x) => {const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};

// Shape-preserving Hermite derivatives in metres per metre of downstream Z.
// The harmonic mean cannot invent a crest between the authored anchors.
function monotoneSlopes(nodes,axis) {
  const h=[],d=[],m=Array(nodes.length).fill(0);
  for(let i=0;i<nodes.length-1;i++){h.push(nodes[i+1][2]-nodes[i][2]);d.push((nodes[i+1][axis]-nodes[i][axis])/h[i]);}
  if(nodes.length===2)return [d[0],d[0]];
  const endpoint=(h0,h1,d0,d1)=>{
    let v=((2*h0+h1)*d0-h0*d1)/(h0+h1);
    if(v*d0<=0)v=0;else if(d0*d1<0&&Math.abs(v)>3*Math.abs(d0))v=3*d0;
    return v;
  };
  m[0]=endpoint(h[0],h[1],d[0],d[1]);
  m[m.length-1]=endpoint(h.at(-1),h.at(-2),d.at(-1),d.at(-2));
  for(let i=1;i<m.length-1;i++){
    if(d[i-1]*d[i]<=0)continue;
    const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];
    m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);
  }
  return m;
}
const hermite=(a,b,ma,mb,h,t)=>{
  const t2=t*t,t3=t2*t;
  return (2*t3-3*t2+1)*a+(t3-2*t2+t)*h*ma+(-2*t3+3*t2)*b+(t3-t2)*h*mb;
};
const hermiteDerivative=(a,b,ma,mb,h,t)=>{
  const t2=t*t;
  return ((6*t2-6*t)*a+(3*t2-4*t+1)*h*ma+(-6*t2+6*t)*b+(3*t2-2*t)*h*mb)/h;
};

export function seededRandom(seed=42) {
  let a=seed>>>0;
  return () => {a+=0x6D2B79F5;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}

export function createLandformField(seed=42) {
  const offset=(seed%8192)*.173;
  const hash=(x,z) => {
    const v=Math.sin(x*127.1+z*311.7+offset*53.13)*43758.5453123;
    return v-Math.floor(v);
  };
  const noise=(x,z) => {
    const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
    const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
    return mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v);
  };
  const fbm=(x,z,octaves=4) => {
    let sum=0,weight=0,amp=.5;
    for(let i=0;i<octaves;i++){sum+=noise(x,z)*amp;weight+=amp;const old=x;x=x*1.91-z*.41+17.1;z=old*.43+z*1.93-9.7;amp*=.5;}
    return sum/weight;
  };
  // Segmented, asymmetric crest lines deliberately replace radial mountain
  // primitives. The third and fourth coordinates are height and shoulder width.
  const crests=[
    [[-4.65,-4.6,2.35,1.68],[-3.94,-4.14,3.55,2.02],[-3.20,-3.46,3.72,2.10],[-2.92,-2.87,3.28,1.87],[-2.12,-2.28,2.18,1.55]],
    [[-1.65,-4.75,2.65,1.62],[-.78,-4.03,3.10,1.64],[.21,-3.80,2.78,1.58],[.96,-3.50,2.31,1.43]],
    [[1.32,-4.82,2.35,1.64],[2.12,-4.12,2.98,1.94],[2.76,-3.42,3.18,1.97],[3.28,-2.91,2.79,1.76],[3.82,-2.13,1.74,1.45]],
    [[4.38,-4.31,1.87,1.17],[4.58,-3.56,2.31,1.22],[4.68,-2.88,1.68,1.12],[5.02,-2.13,1.11,.94]],
    // Short transverse crests broaden the upper shoulders into broken mesas.
    // Their uneven heights and offsets avoid circular contours around a point.
    [[-4.40,-3.56,2.89,.92],[-3.73,-3.48,3.54,1.16],[-2.91,-3.58,3.58,1.17],[-2.36,-3.76,2.87,.95]],
    [[1.87,-3.62,2.72,1.10],[2.54,-3.49,3.10,1.23],[3.24,-3.67,2.88,1.12]],
  ];
  const ridgeAt=(x,z,line) => {
    let high=0;
    for(let i=0;i<line.length-1;i++){
      const a=line[i],b=line[i+1],dx=b[0]-a[0],dz=b[1]-a[1];
      const t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz));
      const dist=Math.hypot(x-mix(a[0],b[0],t),z-mix(a[1],b[1],t));
      const radius=mix(a[3],b[3],t);
      const support=clamp(1-dist/radius);
      // A broad fractured shoulder and a narrow crest have separate scales.
      const shoulder=(Math.pow(support,.36)*.72+Math.pow(support,2.2)*.28)*smooth(0,.20,support);
      high=Math.max(high,mix(a[2],b[2],t)*shoulder);
    }
    return high;
  };
  const planSlopes=monotoneSlopes(RIVER_NODES,0);
  const attachedSlopes=monotoneSlopes(RIVER_NODES.slice(2),1);
  // A real scour hollow is below the impact. Its outlet narrows gradually
  // into the original attached channel; the surrounding mountain is untouched.
  const poolSpec={x:-.003,z:-2.84,rx:.465,rz:.38,level:1.25,depth:.46};
  const poolLongitudinal=z=>(1-smooth(0,1,Math.abs((z-poolSpec.z)/poolSpec.rz)))*smooth(-3.015,-2.94,z);
  const riverAt=(z) => {
    const nodes=RIVER_NODES;
    let i=0;while(i<nodes.length-2&&z>nodes[i+1][2])i++;
    const a=nodes[i],b=nodes[i+1],h=b[2]-a[2],t=clamp((z-a[2])/h);
    const x=hermite(a[0],b[0],planSlopes[i],planSlopes[i+1],h,t);
    // The steep free jet retains its exact authored start/end coordinates.
    // Only attached reaches use C1 monotone vertical interpolation.
    const y=i<2?mix(a[1],b[1],t):hermite(a[1],b[1],attachedSlopes[i-2],attachedSlopes[i-1],h,t);
    const dyDz=i<2?(b[1]-a[1])/h:hermiteDerivative(a[1],b[1],attachedSlopes[i-2],attachedSlopes[i-1],h,t);
    const poolWeight=poolLongitudinal(z),ordinaryWidth=mix(.195,.37,clamp((z+3.35)/4.95));
    return {x,y,width:mix(ordinaryWidth,poolSpec.rx,poolWeight),dyDz,segment:i,poolWeight};
  };
  poolSpec.x=riverAt(poolSpec.z).x;
  const pool={...poolSpec,influence(x,z){
    const r=riverAt(z),q=Math.abs(x-r.x)/r.width;
    return poolLongitudinal(z)*(1-smooth(.05,1,q));
  }};
  // These are height-field rocks, not floating visual props. Each cap is
  // represented in terrain.height and meshed from this same analytic function.
  // Offset signs alternate down the reach; the centre remains a clear route.
  const rockSites=[
    ['left lip',-3.19,-.215,.128,.100,.13],
    ['right impact rim',-2.91,.367,.168,.153,.14],
    ['left pool rim',-2.695,-.345,.175,.143,.12],
    ['outlet shoulder',-2.385,.235,.123,.133,.10],
    ['left chute turn',-1.73,-.225,.133,.166,.105],
    ['right chute foot',-1.035,.242,.153,.135,.13],
    ['left lower run',-.405,-.225,.116,.148,.095],
    ['right lake approach',.435,.265,.156,.129,.105],
  ];
  const obstacles=rockSites.map(([id,z,offset,rx,rz,emergence],index)=>{
    const r=riverAt(z),x=r.x+offset,yaw=.31+index*1.137;
    const base=r.y-(.13+.12*r.poolWeight),top=r.y+emergence;
    const c=Math.cos(yaw),s=Math.sin(yaw);
    const radiusAt=(px,pz)=>{
      const dx=px-x,dz=pz-z,u=(dx*c+dz*s)/rx,v=(-dx*s+dz*c)/rz;
      const theta=Math.atan2(v,u),rim=1+.09*Math.sin(theta*3+index*.7)+.045*Math.sin(theta*5-1.2);
      return {q:Math.hypot(u,v)/rim,u,v};
    };
    return {id,x,z,rx,rz,base,top,yaw,
      influence(px,pz){const q=radiusAt(px,pz).q;return q<1?1-smooth(.78,1,q):0;},
      heightAt(px,pz){
        const {q,u,v}=radiusAt(px,pz);if(q>=1)return -Infinity;
        const shoulder=Math.pow(Math.max(0,1-q*q),.66);
        const chip=(.012*Math.sin(u*5.1+v*2.3+index)+.007*Math.sin(v*8.9-u*3.7))*shoulder*q;
        return base+(top-base)*shoulder+chip;
      },
    };
  });
  const lakeDistance=(x,z) => {
    const dx=(x-LAKE_SPEC.x)/LAKE_SPEC.rx,dz=(z-LAKE_SPEC.z)/LAKE_SPEC.rz;
    const q=Math.hypot(dx,dz),angle=Math.atan2(dz,dx);
    return q+.052*Math.sin(angle*5+.7)+.027*Math.sin(angle*9-1.2)+.025*(fbm(x*1.9+4.3,z*1.9-2.7,3)-.5)*2;
  };
  const wetlandRelief=createWetlandRelief({lake:LAKE_SPEC,riverAt,lakeDistance,noise});
  // This analytic bedding coordinate is mirrored verbatim by the PBR shader.
  // Layers belong to the whole outcrop, rather than to each radial summit.
  // Its vertical derivative yields local beds approximately .24–.33 m thick.
  const beddingAt=(y,x,z) => {
    const bx=x+.24*Math.sin(z*.6)+.12*Math.sin(x*.41+z*.37);
    const bz=z+.18*Math.sin(x*.7-z*.23);
    const warp=.115*Math.sin(bx*.83+bz*.31)+.068*Math.sin(bz*1.21-bx*.27)+.032*Math.sin(bx*3.1+bz*1.7);
    const h=y-.43;
    const coordinate=(h+warp)/.278+.16*Math.sin(h*2.37)+.045*Math.sin(h*5.41);
    const derivative=1/.278+.3792*Math.cos(h*2.37)+.24345*Math.cos(h*5.41);
    return {coordinate,phase:coordinate-Math.floor(coordinate),spacing:1/derivative,warp};
  };
  // Irregular fracture cells follow the exposed X/height face, with depth
  // drifting their plan. Their coordinates never contain a periodic layer
  // index: one broken plate can cross several sedimentary beds.
  const fragmentCell=(x,y,z,scale) => {
    const u=(x*1.65+z*.49)*scale+.16*(noise(x*.70,z*.70)-.5);
    const v=(y*2.25+z*.31-x*.13)*scale+.13*(noise(x*.60+4,z*.65)-.5);
    const ix=Math.floor(u),iy=Math.floor(v);
    let first=1e9,second=1e9,cellX=0,cellY=0,localX=0,localY=0;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
      const cx=ix+i,cy=iy+j;
      const px=cx+.075+.85*hash(cx+13.7,cy-6.3);
      const py=cy+.075+.85*hash(cx-31.3,cy+27.1);
      const dx=u-px,dy=v-py,d=dx*dx+dy*dy;
      if(d<first){second=first;first=d;cellX=cx;cellY=cy;localX=dx;localY=dy;}
      else if(d<second)second=d;
    }
    const border=Math.sqrt(second)-Math.sqrt(first);
    const tone=hash(cellX+51.9,cellY-19.4);
    const tiltX=(hash(cellX+5,cellY+9)-.5)*.8;
    const tiltY=(hash(cellX-7,cellY+3)-.5)*.7;
    return {joint:1-smooth(.014,.092,border),tone,distance:Math.sqrt(first),plane:localX*tiltX+localY*tiltY};
  };
  const fields=(x,z) => {
    const meadow=.43+.17*(fbm(x*.47,z*.47)-.5)+.045*(noise(x*2.1,z*2.1)-.5);
    const wx=x+.16*(fbm(x*.76+14.1,z*.76)-.5)*2;
    const wz=z+.19*(fbm(x*.67-8.4,z*.67+3.1)-.5)*2;
    let ridge=0;for(const crest of crests)ridge=Math.max(ridge,ridgeAt(wx,wz,crest));
    const rearShelf=1.48*Math.exp(-Math.pow((x+.15)/4.05,4)-Math.pow((z+3.75)/2.05,4));
    ridge=Math.max(ridge,rearShelf);
    // These anisotropic fields suggest downslope drainage and broken ledges.
    // Frequencies above the ~4.5 cm vertex pitch are reserved for the shader.
    const fracture=fbm(wx*5.1,wz*1.85,3)-.5;
    const erosion=(1-Math.abs(noise(wx*3.6+noise(wx,wz)*.9,wz*.92)-.5)*2);
    const mountain=smooth(.15,1.2,ridge);
    const meso=(fracture*.25+(erosion-.5)*.18)*mountain;
    const breakHeight=.11*Math.sin(wx*6.8+wz*1.15+fbm(wx*.7,wz*.7)*4.0)*mountain;
    let y=meadow+ridge+meso+breakHeight;
    // A continuous narrow channel is carved after the geology; no rock can
    // accidentally close the blue path from crest to lake.
    const river=riverAt(z),d=Math.abs(x-river.x);
    // A narrow worn spine supports the two cascade lips. Its width and
    // shoulders vary continuously; it is a ridge, never a box or shelf mesh.
    const supportExtent=smooth(-3.78,-3.53,z)*(1-smooth(-1.15,-.85,z));
    const supportWidth=river.width+1.15+.08*(noise(x*1.8,z*2.1)-.5);
    const supportCrest=(river.y+.20+.06*(noise(x*4.1,z*3.2)-.5));
    const canyonSpine=supportCrest*Math.pow(clamp(1-d/supportWidth),.40);
    y=Math.max(y,canyonSpine*supportExtent);
    // Open two warped joints between the main crest groups. These are real
    // shadow-catching cuts, deliberately away from the uninterrupted river.
    const jointZ=smooth(-5.24,-4.72,z)*(1-smooth(-2.20,-1.60,z));
    const jointLeft=x-(-1.62+.18*Math.sin(z*1.61)+.06*Math.sin(z*4.7));
    const jointRight=x-(1.16+.16*Math.sin(z*1.47+.8));
    const crestJoint=(.43*Math.exp(-Math.pow(jointLeft/.20,2))+.36*Math.exp(-Math.pow(jointRight/.18,2)))*jointZ*mountain;
    y-=crestJoint;
    // A wide tread occupies most of each bed, followed by a short eroded
    // riser. Domain-warped shared bedding interrupts the old triangular faces
    // without adding concentric primitive meshes or a stack of equal rings.
    const bedding=beddingAt(y,x,z);
    const tread=smooth(.55,.86,bedding.phase);
    const strataWeight=(.19+.66*smooth(.30,.72,fbm(wx*1.2+5.3,wz*1.1,3)))*smooth(.56,1.30,y-meadow);
    y+=(tread-bedding.phase)*bedding.spacing*strataWeight;
    y+=.055*(noise(wx*10.7,wz*8.3)-.5)*mountain;
    // Chiselled seams and missing plate corners interrupt the regular treads.
    // The erosion is subtractive, preserving the accepted summit heights.
    let fragmentJoint=0,fragmentTone=.5,fragmentSpall=0;
    const plateWeight=smooth(.62,1.35,y-meadow);
    if(plateWeight>.001){
      const coarse=fragmentCell(x,y,z,.72),fine=fragmentCell(x,y,z,1.80);
      fragmentJoint=Math.max(coarse.joint,fine.joint*.53);
      fragmentTone=coarse.tone;
      fragmentSpall=smooth(.64,.88,coarse.tone)*smooth(.17,.44,coarse.distance);
      const cut=.108*coarse.joint+.049*fine.joint+.052*fragmentSpall+.025*Math.abs(coarse.plane);
      y-=cut*plateWeight;
    }
    const extent=smooth(-3.66,-3.3,z)*(1-smooth(1.65,1.95,z));
    const bank=1-smooth(river.width*.77,river.width+.23,d);
    const chuteThin=.032*smooth(-2.43,-1.91,z)*(1-smooth(-.95,-.20,z));
    // Source pool and undercut are bounded to the already authored waterway.
    // Their water-level datum stays unchanged; the common bed becomes deeper,
    // so terrain, wet-section hydraulics and vegetation all agree on contact.
    const sourcePool=smooth(-3.61,-3.43,z)*(1-smooth(-3.235,-3.165,z));
    const wallUndercut=smooth(-3.18,-3.14,z)*(1-smooth(-3.005,-2.955,z));
    const depth=.074-chuteThin+poolSpec.depth*river.poolWeight+.19*sourcePool+.22*wallUndercut;
    // Convex wet banks and a concave hollow round the old straight fold feet.
    // Longitudinal bed elevation and its slope share the water's C1 owner.
    const bed=river.y-depth+(depth-.002)*Math.pow(clamp(d/river.width),2.35);
    if(extent>0)y=mix(y,Math.min(y,bed),bank*extent);
    const q=lakeDistance(x,z);
    const bowl=-.69+.81*Math.pow(Math.max(0,q),2.18)+.018*(noise(x*6.2,z*6.2)-.5);
    const lakeBlend=1-smooth(1.035,1.18,q);
    y=mix(y,Math.min(y,bowl),lakeBlend);
    const wetland=wetlandRelief(x,z,y);y=wetland.height;
    const bedHeight=y;
    let rockHeight=-Infinity,obstacle=0;
    for(const rock of obstacles){
      // Bounding rejection keeps the shared field inexpensive for vegetation.
      if(Math.abs(x-rock.x)>Math.max(rock.rx,rock.rz)*1.14||Math.abs(z-rock.z)>Math.max(rock.rx,rock.rz)*1.14)continue;
      const h=rock.heightAt(x,z);if(h>rockHeight)rockHeight=h;
      if(h>y)obstacle=Math.max(obstacle,rock.influence(x,z));
    }
    y=Math.max(y,rockHeight);
    return {height:y,bedHeight,wetlandLift:wetland.wetlandLift,wetlandSoil:wetland.wetlandSoil,wetlandBank:wetland.wetlandBank,rockHeight,obstacle,poolWeight:river.poolWeight,ridge,mountain,erosion,fracture,meadow,bedding:beddingAt(y,x,z).coordinate,crestJoint,fragmentJoint,fragmentTone,fragmentSpall,shore:q-1,riverDistance:d,riverWidth:river.width};
  };
  const height=(x,z) => fields(clamp(x,-6,6),clamp(z,-5.3,4.3)).height;
  const normal=(x,z) => {
    const e=.028;
    return new THREE.Vector3(height(x-e,z)-height(x+e,z),2*e,height(x,z-e)-height(x,z+e)).normalize();
  };
  return {height,normal,fields,noise,fbm,beddingAt,riverAt,lakeDistance,seed,crests,pool,obstacles};
}
