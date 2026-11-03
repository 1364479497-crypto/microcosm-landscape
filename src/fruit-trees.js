import * as THREE from 'three';
import {BARK_SURFACE_GLSL} from './bark-surface.js';
import {LEAF_WIND_GLSL,TREE_WIND_GLSL,sampleLeafWindAngles,rotateLeafWindVector} from './vegetation-wind.js';
import {sampleTreeWind} from './tree-motion.js';
import {bakeLeafCanopy} from './leaf-canopy.js';
import {sampleSeasonalPhenology,normalizeSeason} from './seasonal-phenology.js';
import {createMeshGroundContacts} from './ground-contact.js';
import {createOrchardSkeleton,sampleSkeletonAxis,ORCHARD_GROWTH_RULES} from './tree-skeleton.js';

// Independently authored mature orchard. Growth is a finite woody hierarchy,
// with species-specific scaffolds, side shoots and organs rooted on that wood.
const TAU=Math.PI*2,UP=new THREE.Vector3(0,1,0),clamp=THREE.MathUtils.clamp,mix=THREE.MathUtils.lerp;
const level=(length,radius,sections,sides,children,start,taper)=>Object.freeze({length,radius,sections,sides,children,start,taper});
export const PEACH_SPECIES=Object.freeze({
  id:'peach',name:'Prunus persica / mature open-centre peach',
  growthRule:ORCHARD_GROWTH_RULES.peach,leavesPerShoot:[7,38],flowerNodesPerShoot:6,extraBloomNodesPerShoot:4,fruitPerTree:18,
  leafLength:[.02376,.03672],leafScaleCalibration:1.08,leafWidthRatio:.264,blossomDiameter:[.0088,.0124],fruitDiameter:[.018,.025],
  heightRange:[1.46,1.53],doorHeight:.367,horizontalShootReach:.64,rootReach:.115,
  limits:Object.freeze({draws:8,triangles:1100000,branchesPerTree:900}),
});
export const PERSIMMON_SPECIES=Object.freeze({
  id:'persimmon',name:'Diospyros kaki / mature spreading persimmon',
  growthRule:ORCHARD_GROWTH_RULES.persimmon,leavesPerShoot:[7,38],flowerNodesPerShoot:0,flowersPerTree:60,fruitPerTree:36,
  leafLength:[.03024,.04644],leafScaleCalibration:1.08,leafWidthRatio:.55,blossomDiameter:[.0042,.0062],fruitDiameter:[.018,.026],
  heightRange:[1.94,2.01],doorHeight:.367,horizontalShootReach:.70,rootReach:.108,
  limits:Object.freeze({draws:8,triangles:1100000,branchesPerTree:900}),
});
export const FRUIT_SPECIES=Object.freeze({peach:PEACH_SPECIES,persimmon:PERSIMMON_SPECIES});
function random(seed){let s=seed>>>0;return()=>{s+=0x6d2b79f5;let n=s;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
function basis(direction,roll=0){
  const y=direction.clone().normalize(),x=new THREE.Vector3().crossVectors(y,Math.abs(y.y)>.94?new THREE.Vector3(1,0,0):UP).normalize(),z=new THREE.Vector3().crossVectors(x,y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z)).multiply(new THREE.Quaternion().setFromAxisAngle(UP,roll));
}
function bezier(a,b,c,d,t){const u=1-t;return a.clone().multiplyScalar(u*u*u).addScaledVector(b,3*u*u*t).addScaledVector(c,3*u*t*t).addScaledVector(d,t*t*t);}
function geometry(p,uv,index,colour=null){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);
  if(colour)g.setAttribute('color',new THREE.Float32BufferAttribute(colour,3));g.computeVertexNormals();
  const normals=g.attributes.normal;for(let i=0;i<normals.count;i++)if(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))<.5)normals.setXYZ(i,0,0,1);
  g.computeBoundingBox();g.computeBoundingSphere();return g;
}
function area(g){if(Number.isFinite(g.userData?.leafSurfaceArea))return g.userData.leafSurfaceArea;const p=g.attributes.position,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();let sum=0;for(let i=0;i<g.index.count;i+=3){a.fromBufferAttribute(p,g.index.getX(i));b.fromBufferAttribute(p,g.index.getX(i+1));c.fromBufferAttribute(p,g.index.getX(i+2));sum+=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()*.5;}return sum;}

// Species morphology is a parameter contract, separate from branch placement.
// Unit length includes the petiole; +Y points to the tip and +Z is adaxial.
// Fine peach teeth are derivative-filtered in the shared colour/depth shader,
// rather than spending a dense rim mesh on thousands of sub-pixel teeth.
export const ORCHARD_LEAF_RULES=Object.freeze({
  peach:Object.freeze({species:0,petioleFraction:.075,petioleRadius:.0042,widthRatio:.264,widthPeak:.43,basePower:1.20,tipPower:1.55,midribArch:.014,tipDroop:.140,edgeFold:.009,sideVeinPairs:9,serrationCycles:22,margin:'finely serrulate',blade:'narrow lanceolate, cuneate base and long-acuminate tip'}),
  persimmon:Object.freeze({species:1,petioleFraction:.090,petioleRadius:.0070,widthRatio:.550,widthPeak:.49,basePower:.88,tipPower:1.30,midribArch:.025,tipDroop:.075,edgeFold:-.014,sideVeinPairs:6,serrationCycles:0,margin:'entire',blade:'broad elliptic-obovate, smooth broad shoulder and naturally acuminate tip'}),
});
export function sampleOrchardLeafMask(species,u,v,{teeth=true}={}){
  const rule=typeof species==='string'?ORCHARD_LEAF_RULES[species]:species>.5?ORCHARD_LEAF_RULES.persimmon:ORCHARD_LEAF_RULES.peach;
  if(!rule||v<rule.petioleFraction||v>1||u<0||u>1)return false;
  const t=(v-rule.petioleFraction)/(1-rule.petioleFraction),side=u<.5?-1:1;
  const profile=t<=rule.widthPeak?Math.pow(Math.sin(t/rule.widthPeak*Math.PI*.5),rule.basePower):Math.pow(Math.cos((t-rule.widthPeak)/(1-rule.widthPeak)*Math.PI*.5),rule.tipPower);
  const smooth=(a,b,x)=>{const f=Math.max(0,Math.min(1,(x-a)/(b-a)));return f*f*(3-2*f);};
  let half=.5*profile*(1+side*.022*Math.sin(t*Math.PI));
  if(teeth&&rule.serrationCycles){const phase=((t*rule.serrationCycles+(side<0?0:.43))%1+1)%1,saw=phase<.24?phase/.24:(1-phase)/.76;half-=.009*saw*profile*smooth(.035,.13,t)*(1-smooth(.84,.98,t));}
  return Math.abs(u-.5)<=half;
}
function speciesLeafGeometry(rule){
  const p=[],uv=[],idx=[],parts=[],vertex=(x,y,z,u,v,blade)=>{const i=p.length/3;p.push(x,y,z);uv.push(u,v);parts.push(blade);return i;},fraction=rule.petioleFraction;
  // An actual closed triangular petiole with its basal cap at the organ root.
  for(let ring=0;ring<2;ring++)for(let k=0;k<3;k++){const a=k*TAU/3,r=rule.petioleRadius*(ring?.78:1);vertex(Math.cos(a)*r,ring*fraction,Math.sin(a)*r,.5+Math.cos(a)*.03,ring*fraction,0);}
  for(let k=0;k<3;k++){const n=(k+1)%3;idx.push(k,k+3,n,n,k+3,n+3);}
  idx.push(0,1,2,3,5,4);
  // A genuinely curved 8-triangle lamina, with its smooth species outline
  // evaluated identically in colour/depth. UV is the enclosing ribbon, not
  // a rectangular leaf: CPU consumers must also apply sampleOrchardLeafMask.
  const rings=[];
  for(const t of [0,.5,1]){
    const y=fraction+(1-fraction)*t,half=rule.widthRatio*.5,cx=(rule.species?.006:.014)*t*t,z=rule.midribArch*Math.sin(t*Math.PI)-rule.tipDroop*t*t*t,edge=rule.edgeFold*Math.sin(t*Math.PI),row=[];
    for(const sign of [-1,0,1])row.push(vertex(cx+sign*half,y,z+(sign?edge:0),sign*.5+.5,y,1));
    rings.push(row);
  }
  for(let j=0;j<rings.length-1;j++){const a=rings[j],b=rings[j+1];idx.push(a[0],a[1],b[0],a[1],b[1],b[0],a[1],a[2],b[1],a[2],b[2],b[1]);}
  const g=geometry(p,uv,idx);g.setAttribute('aOrchardLeafSpecies',new THREE.Float32BufferAttribute(new Array(p.length/3).fill(rule.species),1));g.setAttribute('aOrchardLeafBlade',new THREE.Float32BufferAttribute(parts,1));
  // Midpoint quadrature of the actual ribbon triangles after the shared
  // smooth silhouette and full-resolution teeth. Petiole is reported apart.
  let visibleArea=0,petioleArea=0,envelopeArea=0;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
  for(let i=0;i<idx.length;i+=3){const ids=idx.slice(i,i+3);a.fromArray(p,ids[0]*3);b.fromArray(p,ids[1]*3);c.fromArray(p,ids[2]*3);const triangleArea=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()*.5;
    if(i<24){petioleArea+=triangleArea;continue;}envelopeArea+=triangleArea;let retained=0,total=0;
    for(let j=0;j<128;j++)for(let k=0;k<128;k++){let x=(j+.5)/128,y=(k+.5)/128;if(x+y>1){x=1-x;y=1-y;}const w=1-x-y,u=uv[ids[0]*2]*w+uv[ids[1]*2]*x+uv[ids[2]*2]*y,v=uv[ids[0]*2+1]*w+uv[ids[1]*2+1]*x+uv[ids[2]*2+1]*y;retained+=sampleOrchardLeafMask(rule.species,u,v)?1:0;total++;}
    visibleArea+=triangleArea*retained/total;
  }
  g.userData={petioleRoot:[0,0,0],longAxis:'+Y',adaxial:'+Z',rule:{...rule},triangles:idx.length/3,leafSurfaceArea:visibleArea,petioleSurfaceArea:petioleArea,laminaEnvelopeArea:envelopeArea,leafAreaMethod:'128x128 barycentric midpoint quadrature per lamina triangle after shared smooth silhouette and fine teeth; excludes closed petiole',silhouette:'sampleOrchardLeafMask(species,u,v); aOrchardLeafBlade=0 petiole bypasses mask',source:'independently constructed curved lamina and closed petiole; analytic species silhouette and procedural venation, no image texture'};return g;
}
export function createPeachLeafGeometry(){const g=speciesLeafGeometry(ORCHARD_LEAF_RULES.peach);g.name='Prunus persica: narrow long-acuminate folded blade, fine teeth and rooted petiole';return g;}
export function createPersimmonLeafGeometry(){const g=speciesLeafGeometry(ORCHARD_LEAF_RULES.persimmon);g.name='Diospyros kaki: broad entire elliptic-obovate blade, acuminate tip and rooted petiole';return g;}
function blossomGeometry(){
  const p=[],uv=[],idx=[],c=[];
  const vertex=(x,y,z,u,v,colour)=>{const n=p.length/3;p.push(x,y,z);uv.push(u,v);c.push(...new THREE.Color(colour).toArray());return n;};
  // The narrow calyx/pedicel is continuous from the host wood to the cup.
  const stem=[];for(let j=0;j<2;j++)for(let i=0;i<5;i++){const a=i*TAU/5;stem.push(vertex(Math.cos(a)*.075,j*.37,Math.sin(a)*.075,i/5,j*.1,0x76573d));}
  for(let i=0;i<5;i++){const a=stem[i],b=stem[(i+1)%5],d=stem[i+5],e=stem[(i+1)%5+5];idx.push(a,d,b,b,d,e);}
  for(let petal=0;petal<5;petal++){
    const angle=petal*TAU/5+.18,base=p.length/3;
    for(let j=0;j<=4;j++){
      const t=j/4,r=.10+t*.86,w=.42*Math.pow(Math.sin(t*Math.PI),.72),y=.37+.12*t*t;
      for(const side of [-1,1])vertex(Math.cos(angle)*r-Math.sin(angle)*w*side,y-.045*Math.abs(side)*Math.sin(t*Math.PI),Math.sin(angle)*r+Math.cos(angle)*w*side,side<0?0:1,t,t<.26?0xb94769:0xef91af);
    }
    for(let j=0;j<4;j++){const a=base+j*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}
  }
  const center=vertex(0,.393,0,.5,0,0xad4c65);
  for(let i=0;i<10;i++){const a=i*TAU/10,b=(i+1)*TAU/10,ia=vertex(Math.cos(a)*.21,.40,Math.sin(a)*.21,0,0,0xcb6d83),ib=vertex(Math.cos(b)*.21,.40,Math.sin(b)*.21,1,0,0xcb6d83);idx.push(center,ib,ia);const s=vertex(Math.cos(a)*.14,.40,Math.sin(a)*.14,0,0,0xdab06b),e=vertex(Math.cos(a)*.25,.54,Math.sin(a)*.25,1,1,0xebcc87),f=vertex(Math.cos(a+.08)*.25,.54,Math.sin(a+.08)*.25,0,1,0xebcc87);idx.push(s,e,f);}
  const g=geometry(p,uv,idx,c);g.name='Five separate cupped peach petals, calyx and stamens';return g;
}
function peachGeometry(){
  const p=[],uv=[],idx=[],c=[],rings=8,sides=12;
  for(let j=0;j<=rings;j++)for(let i=0;i<=sides;i++){
    const t=j/rings*Math.PI,a=i/sides*TAU,groove=1-.075*Math.exp(-(Math.sin(a)**2)*75),r=Math.sin(t)*groove,x=Math.cos(a)*r,z=Math.sin(a)*r,y=-1.02+Math.cos(t)*.86;
    p.push(x,y,z);uv.push(i/sides,j/rings);const colour=new THREE.Color(0xedb56f).lerp(new THREE.Color(0xde785f),clamp(.42+.46*Math.cos(a-.4)+.14*Math.cos(t*2),0,1));c.push(...colour.toArray());
    if(j<rings&&i<sides){const q=j*(sides+1)+i;idx.push(q,q+sides+1,q+1,q+1,q+sides+1,q+sides+2);}
  }
  // A short real stalk starts at local zero and reaches the fruit's upper pole.
  const start=p.length/3;for(let j=0;j<2;j++)for(let i=0;i<4;i++){const a=i*TAU/4;p.push(Math.cos(a)*.07,-j*.20,Math.sin(a)*.07);uv.push(i/4,j*.1);c.push(...new THREE.Color(0x6b6040).toArray());}
  for(let i=0;i<4;i++){const a=start+i,b=start+(i+1)%4;idx.push(a,a+4,b,b,a+4,b+4);}
  const g=geometry(p,uv,idx,c);g.setAttribute('aOrchardFruitPart',new THREE.Float32BufferAttribute(p.map((_,i)=>i%3===0?(i/3<(rings+1)*(sides+1)?1:0):null).filter(v=>v!==null),1));g.name='Small stalk-attached peach with longitudinal suture and blush';return g;
}

function persimmonGeometry(){
  const p=[],uv=[],idx=[],c=[],rings=9,sides=12;
  for(let j=0;j<=rings;j++)for(let i=0;i<=sides;i++){
    const t=j/rings*Math.PI,a=i/sides*TAU,r=Math.sin(t)*(1-.035*Math.cos(a*4)),x=Math.cos(a)*r,z=Math.sin(a)*r,y=-.87+Math.cos(t)*.77;
    p.push(x,y,z);uv.push(i/sides,j/rings);const colour=new THREE.Color(0xea7c16).lerp(new THREE.Color(0xf6a133),.35+.24*Math.cos(a)+.15*Math.cos(t));c.push(...colour.toArray());
    if(j<rings&&i<sides){const q=j*(sides+1)+i;idx.push(q,q+sides+1,q+1,q+1,q+sides+1,q+sides+2);}
  }
  const start=p.length/3;
  for(let j=0;j<2;j++)for(let i=0;i<5;i++){const a=i*TAU/5;p.push(Math.cos(a)*.065,-j*.14,Math.sin(a)*.065);uv.push(i/5,j*.12);c.push(...new THREE.Color(0x6b6341).toArray());}
  for(let i=0;i<5;i++){const a=start+i,b=start+(i+1)%5;idx.push(a,a+5,b,b,a+5,b+5);}
  // Four persistent sepals form a real raised calyx around the stalk.
  for(let k=0;k<4;k++){
    const a=k*TAU/4+.18,base=p.length/3;
    for(const [r,w,y] of [[.06,.08,-.09],[.37,.25,-.11],[.64,0,-.02]])for(const side of [-1,1]){p.push(Math.cos(a)*r-Math.sin(a)*w*side,y,Math.sin(a)*r+Math.cos(a)*w*side);uv.push(side<0?0:1,r);c.push(...new THREE.Color(0x526334).toArray());}
    idx.push(base,base+2,base+1,base+1,base+2,base+3,base+2,base+4,base+3,base+3,base+4,base+5);
  }
  const g=geometry(p,uv,idx,c);g.setAttribute('aOrchardFruitPart',new THREE.Float32BufferAttribute(p.map((_,i)=>i%3===0?(i/3<(rings+1)*(sides+1)?1:0):null).filter(v=>v!==null),1));g.name='Orange kaki berry, short stalk and four persistent calyx lobes';return g;
}

// Female kaki flowers are small cream bells carried singly within a broad
// four-lobed green calyx, not peach-like pink five-petal stars. Local root=0;
// the complete pedicel hangs down -Y. Independently authored from UF photos.
function persimmonFlowerGeometry(){
 const p=[],uv=[],idx=[],c=[],v=(x,y,z,u,t,col)=>{const id=p.length/3;p.push(x,y,z);uv.push(u,t);c.push(...new THREE.Color(col).toArray());return id;};
 for(let j=0;j<2;j++)for(let k=0;k<4;k++){const a=k*TAU/4;v(Math.cos(a)*.075,-j*.24,Math.sin(a)*.075,k/4,j,0x697d39);}
 for(let k=0;k<4;k++){const a=k,b=(k+1)%4;idx.push(a,b,a+4,b,b+4,a+4);}
 for(let lobe=0;lobe<4;lobe++){
  const angle=lobe*TAU/4,base=p.length/3;
  for(const [r,w,y]of [[.06,.10,-.23],[.63,.42,-.26],[1.08,0,-.12]])for(const side of [-1,1])v(Math.cos(angle)*r-Math.sin(angle)*w*side,y,Math.sin(angle)*r+Math.cos(angle)*w*side,side<0?0:1,r,0x7d9644);
  idx.push(base,base+2,base+1,base+1,base+2,base+3,base+2,base+4,base+3,base+3,base+4,base+5);
  const start=p.length/3;
  for(let j=0;j<=3;j++){const t=j/3,r=.20+t*.46,y=-.26-t*.80,w=.17+.24*Math.sin(t*Math.PI*.7);for(const side of [-1,1])v(Math.cos(angle)*r-Math.sin(angle)*w*side,y+.05*Math.abs(side),Math.sin(angle)*r+Math.cos(angle)*w*side,side<0?0:1,t,t>.6?0xeee5bc:0xd4c791);}
  for(let j=0;j<3;j++){const q=start+j*2;idx.push(q,q+1,q+2,q+1,q+3,q+2);}
 }
 const g=geometry(p,uv,idx,c);g.name='Small solitary cream four-lobed female kaki flower and large green calyx';return g;
}

// Petiole roots and woody terrain roots stay fixed. Visible/depth shaders share
// both flutter and a stable coverage mask. Coverage never multiplies leaf size.
export function peachLeafWindOffset(uvY,time,strength,phase=0){return rotateLeafWindVector([0,uvY,0],sampleLeafWindAngles(time,phase*7.1,0,1,0,Math.max(0,strength),2))[2];}
const ORCHARD_LEAF_MARGIN_GLSL=`
float orchardLeafHalfWidth(vec2 leafUV,float species){
  float kaki=step(.5,species),petiole=mix(.075,.090,kaki),t=clamp((leafUV.y-petiole)/(1.-petiole),0.,1.);
  float peak=mix(.43,.49,kaki),basePower=mix(1.20,.88,kaki),tipPower=mix(1.55,1.30,kaki);
  float profile=t<=peak?pow(max(0.,sin(t/peak*1.570796327)),basePower):pow(max(0.,cos((t-peak)/(1.-peak)*1.570796327)),tipPower);
  float side=leafUV.x<.5?-1.:1.,halfWidth=.5*profile*(1.+side*.022*sin(t*3.141592654));
  if(kaki>.5)return halfWidth;
  float detail=1.-smoothstep(.012,.055,fwidth(t));
  float phase=fract(t*22.+(leafUV.x<.5?0.:.43));
  float saw=phase<.24?phase/.24:(1.-phase)/.76;
  return halfWidth-.009*saw*profile*smoothstep(.035,.13,t)*(1.-smoothstep(.84,.98,t))*detail;
}
`;
const ORCHARD_LEAF_SURFACE_GLSL=`
vec3 orchardLeafVeins(vec2 leafUV,float kaki,float variant){
  float petiole=mix(.075,.090,kaki),t=clamp((leafUV.y-petiole)/(1.-petiole),0.,1.);
  float across=abs(leafUV.x*2.-1.),side=leafUV.x<.5?-1.:1.;
  float count=mix(9.,6.,kaki),secondary=0.;
  for(int i=0;i<9;i++){
    if(float(i)>=count)continue;
    float fi=float(i),origin=.095+fi/max(1.,count-1.)*.70+.019*sin(fi*2.17+variant*.73)+side*(.009+.006*sin(fi*1.6+variant));
    float sweep=mix(.105,.130,kaki)+.023*sin(fi*1.71+variant*.45+side*.8);
    float path=origin+across*(sweep+(.050+.022*sin(fi+variant))*across);
    float distance=t-path,aa=max(.0013,fwidth(distance)*.72),width=mix(.0035,.0055,kaki);
    secondary=max(secondary,1.-smoothstep(width-aa,width+aa,abs(distance)));
  }
  float aa=max(.0015,fwidth(across)*.65),width=mix(.014,.020,kaki);
  float midrib=1.-smoothstep(width-aa,width+aa,across);
  float lamina=smoothstep(.015,.09,t)*(1.-smoothstep(.90,.995,t));
  float detail=1.-smoothstep(.055,.22,max(fwidth(t)*2.5,fwidth(leafUV.x)*.40));
  float minor=(1.-smoothstep(.03,.13,abs(sin((t+.016*sin(across*27.+variant))*171.+across*9.))))*(1.-smoothstep(.08,.22,abs(sin(across*103.+t*19.+variant))));
  return vec3(midrib,secondary,minor)*lamina*detail;
}
vec3 orchardLeafPerturb(vec3 surfacePosition,vec3 N,float height){
  vec3 q0=dFdx(surfacePosition),q1=dFdy(surfacePosition),r1=cross(q1,N),r2=cross(N,q0);
  float det=dot(q0,r1);vec3 gradient=sign(det)*(dFdx(height)*r1+dFdy(height)*r2);
  return normalize(abs(det)*N-gradient);
}
`;
function patchOrchardTreeBend(shader,uniforms,shadow=false,organ=false){
 Object.assign(shader.uniforms,uniforms);
 shader.vertexShader=TREE_WIND_GLSL+'attribute vec4 aPeachRoot;\n'+(organ?'':'uniform float uPeachTime;uniform vec2 uPeachWind0,uPeachWind1,uPeachWind2;attribute float aPeachTree;\n')+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
  vec4 orchardP=vec4(transformed,1.);vec3 orchardN=${shadow?'normal':'objectNormal'};
  #ifdef USE_INSTANCING
   orchardP=instanceMatrix*orchardP;mat3 orchardInstance=mat3(instanceMatrix);orchardN/=vec3(dot(orchardInstance[0],orchardInstance[0]),dot(orchardInstance[1],orchardInstance[1]),dot(orchardInstance[2],orchardInstance[2]));orchardN=orchardInstance*orchardN;
  #endif
  vec2 orchardWind=mix(mix(uPeachWind0,uPeachWind1,step(.5,aPeachTree)),uPeachWind2,step(1.5,aPeachTree));
  vec2 orchardBend=vegTreeBend(uPeachTime,aPeachRoot,orchardWind);
  orchardN=vegTreeArcNormal(orchardN,orchardP.xyz,aPeachRoot,orchardBend);orchardP.xyz=vegTreeArc(orchardP.xyz,aPeachRoot,orchardBend);
  ${!shadow?`
#ifndef FLAT_SHADED
transformedNormal=normalMatrix*orchardN;vNormal=normalize(transformedNormal);
#endif
`:''}
  vec4 mvPosition=modelViewMatrix*orchardP;gl_Position=projectionMatrix*mvPosition;
 `);
 shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','vec4 worldPosition=modelMatrix*orchardP;');
}
function organMaterial(kind,uniforms,shadow=false){
  const leaf=kind==='leaf',fruit=kind==='fruit';
  const m=shadow?new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}):new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:!leaf,roughness:leaf?.72:.88,side:THREE.DoubleSide});
  if(leaf)m.userData.leafSurface={source:'procedural smooth species silhouette and coupled irregular pinnate veins',noImageTextures:true,adaxial:'+Z',margin:'shared analytic colour/depth outline; peach derivative-filtered fine serrulation; kaki entire',veins:'peach 9 / kaki 6 authored pairs, irregular spacing and apex-curved sweep; subtle minor reticulation',roughness:'glossier adaxial kaki, paler/rougher abaxial surface, stable organ-age variation',normal:'same filtered vein field as albedo and roughness'};
  m.onBeforeCompile=s=>{
    Object.assign(s.uniforms,uniforms);
    s.vertexShader='attribute float aPeachPhase,aPeachTree,aPeachRank;attribute vec2 aPeachWindAxis;attribute float aPeachAO;varying float vPeachAO,vOrchardRetain;uniform float uPeachTime,uOrchardCoverage,uOrchardOrganSize;uniform vec2 uPeachWind0,uPeachWind1,uPeachWind2;\n'+s.vertexShader;
    if(fruit)s.vertexShader='attribute float aOrchardFruitPart;varying float vOrchardFruitPart;\n'+s.vertexShader;
    if(leaf)s.vertexShader='attribute float aOrchardLeafSpecies,aOrchardLeafBlade;varying vec4 vOrchardLeaf;varying vec2 vOrchardLeafOrgan;\n'+s.vertexShader;
    const wind='mix(mix(uPeachWind0,uPeachWind1,step(.5,aPeachTree)),uPeachWind2,step(1.5,aPeachTree))';
    if(leaf){
      s.vertexShader=LEAF_WIND_GLSL+s.vertexShader;
      s.vertexShader=s.vertexShader.replace('void main() {',`vec2 orchardLeafMotion(){
        vec2 w=${wind};float magnitude=length(w);vec2 direction=w/max(magnitude,.00001);
        vec2 edge=vec2(1.,0.);
        #ifdef USE_INSTANCING
          vec3 localX=normalize(instanceMatrix[0].xyz);edge=localX.xz;
        #endif
        return vegLeafWindAngles(uPeachTime,aPeachPhase*7.1,aPeachTree*1.71,dot(direction,aPeachWindAxis),dot(direction,edge),magnitude,2.+aOrchardLeafSpecies);
      }
      void main() {`);
    }
    s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nvPeachAO=aPeachAO;vOrchardRetain=smoothstep(aPeachRank-.025,aPeachRank+.025,uOrchardCoverage);${fruit?'transformed*=uOrchardOrganSize;vOrchardFruitPart=aOrchardFruitPart;':''}${leaf?'transformed=vegLeafWindRotate(transformed,orchardLeafMotion());':''}`);
    if(leaf)s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
float orchardLeafLength=1.;
#ifdef USE_INSTANCING
orchardLeafLength=length(instanceMatrix[1].xyz);
#endif
vOrchardLeaf=vec4(uv,aOrchardLeafSpecies,orchardLeafLength);vOrchardLeafOrgan=vec2(aOrchardLeafBlade,aPeachPhase);`);
    if(leaf)s.vertexShader=s.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>\nobjectNormal=vegLeafWindRotate(objectNormal,orchardLeafMotion());`);
    s.fragmentShader='varying float vOrchardRetain;\n'+s.fragmentShader;if(fruit)s.fragmentShader='varying float vOrchardFruitPart;uniform float uOrchardSpecies;\n'+s.fragmentShader;
    if(leaf)s.fragmentShader='varying vec4 vOrchardLeaf;varying vec2 vOrchardLeafOrgan;\n'+ORCHARD_LEAF_MARGIN_GLSL+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nif(vOrchardRetain<.5)discard;');
    if(leaf)s.fragmentShader=s.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
if(vOrchardLeafOrgan.x>.5&&abs(vOrchardLeaf.x-.5)>orchardLeafHalfWidth(vOrchardLeaf.xy,vOrchardLeaf.z))discard;`);
    if(!shadow){
      s.fragmentShader='varying float vPeachAO;uniform float uPeachWet,uPeachLeaf,uPeachAutumn,uPeachRipeness,uOrchardNewLeaf;\n'+s.fragmentShader;
      if(leaf)s.fragmentShader=ORCHARD_LEAF_SURFACE_GLSL+s.fragmentShader;
      s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n${leaf?'float orchardSeasonKaki=step(.5,vOrchardLeaf.z),orchardSeasonVariant=.5+.5*sin(vOrchardLeafOrgan.y*1.43);vec3 orchardGold=mix(vec3(.42,.25,.035),vec3(.72,.48,.09),orchardSeasonVariant),orchardKakiFall=mix(vec3(.71,.40,.035),vec3(.46,.075,.022),orchardSeasonVariant);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.25,.39,.10),uOrchardNewLeaf*mix(.45,.62,orchardSeasonKaki));diffuseColor.rgb=mix(diffuseColor.rgb,mix(orchardGold,orchardKakiFall,orchardSeasonKaki),uPeachAutumn*.92);':fruit?'diffuseColor.rgb=mix(diffuseColor.rgb,mix(vec3(.19,.31,.055),diffuseColor.rgb,uPeachRipeness),vOrchardFruitPart);':''}\ndiffuseColor.rgb*=1.-uPeachWet*.13;`);
      if(fruit)s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(.86,mix(.82,.48,uOrchardSpecies),vOrchardFruitPart)-uPeachWet*.05;');
      if(leaf){
        s.fragmentShader=s.fragmentShader.replace('diffuseColor.rgb*=1.-uPeachWet*.13;',`diffuseColor.rgb*=1.-uPeachWet*.13;
float orchardKaki=step(.5,vOrchardLeaf.z),orchardAdaxial=gl_FrontFacing?1.:0.;
float orchardLeafAge=.5+.5*sin(vOrchardLeafOrgan.y*1.71+orchardKaki);
vec3 orchardVeins=orchardLeafVeins(vOrchardLeaf.xy,orchardKaki,vOrchardLeafOrgan.y)*step(.5,vOrchardLeafOrgan.x);
diffuseColor.rgb*=mix(vec3(1.055,1.07,.95),vec3(.91,.97,1.015),orchardLeafAge);
vec3 orchardAbaxial=diffuseColor.rgb*vec3(1.13,1.17,1.08)+vec3(.012,.019,.009);
diffuseColor.rgb=mix(orchardAbaxial,diffuseColor.rgb,orchardAdaxial);
vec3 orchardVeinColour=diffuseColor.rgb*vec3(1.13,1.10,.86)+vec3(.006,.009,.001);
diffuseColor.rgb=mix(diffuseColor.rgb,orchardVeinColour,(orchardVeins.x*.40+orchardVeins.y*.26+orchardVeins.z*.035)*mix(.95,.55,orchardAdaxial));
diffuseColor.rgb*=mix(.94,1.035,smoothstep(.075,.74,vOrchardLeaf.y));
diffuseColor.rgb=mix(diffuseColor.rgb*vec3(.84,.83,.63),diffuseColor.rgb,step(.5,vOrchardLeafOrgan.x));`);
        s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
roughnessFactor=clamp(roughnessFactor-orchardKaki*.12+(1.-orchardAdaxial)*.14+(orchardVeins.x+orchardVeins.y)*.035+orchardLeafAge*.025-uPeachWet*.06,.45,.94);`);
        s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
float orchardVeinHeight=(orchardVeins.x*.00085+orchardVeins.y*.00042+orchardVeins.z*.00012)*vOrchardLeaf.w*mix(1.4,.45,orchardAdaxial);
normal=orchardLeafPerturb(-vViewPosition,normal,orchardVeinHeight);
float orchardNormalVariance=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));
roughnessFactor=clamp(sqrt(roughnessFactor*roughnessFactor+orchardNormalVariance*.15),.48,1.);`);
      }
      s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nfloat peachAO=pow(max(.08,vPeachAO),clamp(uPeachLeaf,0.,1.));reflectedLight.indirectDiffuse*=peachAO;reflectedLight.indirectSpecular*=sqrt(peachAO);');
    }
    patchOrchardTreeBend(s,uniforms,shadow,true);
  };
  m.customProgramCacheKey=()=>`authored-orchard-${kind}-${shadow?'depth':'pbr'}-seasonal-organs-v7-rooted-tree-stable-coverage`;return m;
}
function barkMaterial(uniforms){
  const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.93});
  m.userData.woodSurface={coordinates:'continuous object-space three dimensional fields; smooth tangent weights select three fixed anisotropic fields',reference:'irregular grey-brown peach/kaki old bark, no periodic rings or image texture',filtering:'derivative footprint suppresses fine fibre and normal relief before undersampling'};
  m.onBeforeCompile=s=>{
    s.vertexShader='attribute float aBarkRadius,aOrchardSpecies;attribute vec3 aWoodTangent;varying vec3 vOrchardWoodP,vOrchardWoodT;varying float vOrchardWoodRadius,vOrchardWoodSpecies;\n'+s.vertexShader;
    s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvOrchardWoodP=position;vOrchardWoodT=aWoodTangent;vOrchardWoodRadius=aBarkRadius;vOrchardWoodSpecies=aOrchardSpecies;');
    s.fragmentShader=`varying vec3 vOrchardWoodP,vOrchardWoodT;varying float vOrchardWoodRadius,vOrchardWoodSpecies;
float orchardWoodHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float orchardWoodNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(orchardWoodHash(i),orchardWoodHash(i+vec3(1,0,0)),f.x),mix(orchardWoodHash(i+vec3(0,1,0)),orchardWoodHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(orchardWoodHash(i+vec3(0,0,1)),orchardWoodHash(i+vec3(1,0,1)),f.x),mix(orchardWoodHash(i+vec3(0,1,1)),orchardWoodHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float orchardWoodGrain(vec3 p,vec3 w,float across,float along){return dot(w,vec3(orchardWoodNoise(p*vec3(along,across,across)),orchardWoodNoise(p*vec3(across,along,across)),orchardWoodNoise(p*vec3(across,across,along))));}
vec3 orchardWoodNormal(vec3 p,vec3 n,float h){vec3 a=dFdx(p),b=dFdy(p),x=cross(b,n),y=cross(n,a);float d=dot(a,x);return normalize(abs(d)*n-sign(d)*(dFdx(h)*x+dFdy(h)*y)+n*1e-10);}
`+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
vec3 woodP=vOrchardWoodP,woodW=pow(abs(normalize(vOrchardWoodT)),vec3(2.));woodW/=max(.001,woodW.x+woodW.y+woodW.z);
float woodAge=smoothstep(.003,.037,vOrchardWoodRadius),woodBroad=orchardWoodNoise(woodP*11.),woodMottle=orchardWoodNoise(woodP*29.);
float woodFootprint=max(length(dFdx(woodP)),length(dFdy(woodP))),woodFilter=1.-smoothstep(.004,.018,woodFootprint);
float woodGrain=orchardWoodGrain(woodP,woodW,82.,9.),woodFine=orchardWoodGrain(woodP,woodW,166.,27.);
woodFine=mix(.5,woodFine,woodFilter);float woodCrack=pow(max(0.,1.-abs(woodGrain*2.-1.)),22.)*smoothstep(.27,.66,woodMottle)*woodAge*woodFilter,woodFlake=smoothstep(.58,.79,orchardWoodNoise(woodP*38.))*woodAge;
vec3 woodYoung=mix(vec3(.265,.210,.143),vec3(.315,.258,.184),woodBroad),woodOld=mix(vec3(.225,.205,.172),vec3(.315,.286,.235),woodBroad);
woodOld=mix(woodOld,woodOld*vec3(.91,.94,.98),vOrchardWoodSpecies*.42);diffuseColor.rgb=mix(woodYoung,woodOld,woodAge)*(1.-.32*woodCrack)*(.955+.075*woodFine+.055*woodFlake);
float woodRelief=min(.00085,vOrchardWoodRadius*.018),woodHeight=woodRelief*(.46*(woodGrain-.5)-.84*woodCrack+.20*woodFlake+.055*(woodFine-.5))*woodFilter*mix(.18,1.,woodAge);`);
    s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=.88+.060*woodAge+.05*woodCrack-.025*woodFlake;');
    s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=orchardWoodNormal(-vViewPosition,normal,woodHeight);');
    patchOrchardTreeBend(s,uniforms,false,false);
  };m.customProgramCacheKey=()=> 'authored-orchard-connected-skin-continuous-object-grain-v6-rooted-tree';return m;
}

function selectSites(terrain,habitat){
  const desired=[{x:-3.75,z:.70,species:'peach',side:'left forecourt peach'},{x:-1.60,z:1.15,species:'peach',side:'right forecourt peach'},{x:-3.90,z:1.85,species:'persimmon',side:'outer forecourt persimmon'}],sites=[];
  for(const target of desired){
    const spec=FRUIT_SPECIES[target.species],candidates=[],footprint=spec.heightRange[1]*spec.rootReach+.025;
    for(let j=-6;j<=6;j++)for(let i=-6;i<=6;i++){
      const x=target.x+i*.055,z=target.z+j*.055,h=habitat.sample(x,z),path=habitat.pathAt(x,z);
      if(!habitat.allowed(x,z)||h.waterDepth>-.025||h.slope<.90||h.shade>.66||h.treeDistance<.27||path.distance<path.width+footprint+.035||sites.some(s=>Math.hypot(x-s.x,z-s.z)<.90))continue;
      let clear=true;
      for(const radial of [.25,.65,1])for(let k=0;k<16;k++){
        const a=k*TAU/16,px=x+Math.cos(a)*footprint*radial,pz=z+Math.sin(a)*footprint*radial,hs=habitat.sample(px,pz);
        if(!habitat.allowed(px,pz)||hs.waterDepth>-.018||habitat.contacts?.sample(px,pz,terrain.height(px,pz)).solid)clear=false;
      }
      if(!clear)continue;
      const score=(x-target.x)**2+(z-target.z)**2+h.shade*.06+(1-h.slope)*.4+Math.max(0,.42-h.treeDistance)*.20;
      candidates.push({x,z,y:terrain.height(x,z),score,species:target.species,side:target.side,treeDistance:h.treeDistance,pathClearance:path.distance-path.width,waterDepth:h.waterDepth,checkedRootFootprint:footprint});
    }
    candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)throw new Error(`No dry, unobstructed mature orchard site: ${target.side}.`);sites.push(candidates[0]);
  }
  return sites;
}

export function createFruitTrees({terrain,habitat,field=null,seed=42}={}){
  if(!terrain?.height||!habitat?.sample||!habitat?.allowed||!habitat?.pathAt)throw new Error('Fruit trees require the actual terrain and shared habitat.');
  const orchardBuildStart=performance.now();const group=new THREE.Group();group.name='Mature forecourt orchard: two peaches and one persimmon';
  const sites=selectSites(terrain,habitat),skeleton=createOrchardSkeleton({terrain,sites,seed}),b=skeleton.buffers,branchGeometry=skeleton.geometry,leaves=[],kakiLeaves=[],flowers=[],kakiFlowers=[],fruit=[],kakiFruit=[];
  const leafGeometry=createPeachLeafGeometry(),kakiLeafGeometry=createPersimmonLeafGeometry(),flowerGeometry=blossomGeometry(),kakiFlowerGeometry=persimmonFlowerGeometry(),fruitGeometry=peachGeometry(),kakiFruitGeometry=persimmonGeometry();
  // Query the exact final wood geometry while selecting organs. This sampler
  // is temporary; the visible bark mesh and its buffers remain the sole owner.
  const uniforms={uPeachTime:{value:0},uPeachWind0:{value:new THREE.Vector2()},uPeachWind1:{value:new THREE.Vector2()},uPeachWind2:{value:new THREE.Vector2()},uPeachWet:{value:0},uTreeDragRoot:{value:new THREE.Vector4(999,999,999,1)},uTreeDragBend:{value:new THREE.Vector2()}};
  branchGeometry.setAttribute('aPeachTree',new THREE.Float32BufferAttribute(Array.from({length:branchGeometry.attributes.position.count},(_,i)=>sites.findIndex(t=>Math.abs(t.x-branchGeometry.attributes.aPeachRoot.getX(i))<.001)),1));
  const bark=barkMaterial(uniforms),barkMesh=new THREE.Mesh(branchGeometry,bark);barkMesh.name='Mature orchard closed woody hierarchy and embedded roots';barkMesh.castShadow=barkMesh.receiveShadow=true;group.add(barkMesh);
  const clearanceStart=performance.now();let fruitWood=createMeshGroundContacts([barkMesh],terrain);const woodGrid=new Map(),gridStep=.04,woodPosition=branchGeometry.attributes.position,fruitClearance={tested:0,rejectedWood:0,rejectedRoot:0,accepted:0,filterMs:0,method:'actual fruit body vertices versus final closed wood and nearby real wood vertices versus conservative fruit ellipsoid at six visible-size samples; stalk/calyx excluded'};
  for(let i=0;i<woodPosition.count;i++){const key=[woodPosition.getX(i),woodPosition.getY(i),woodPosition.getZ(i)].map(x=>Math.floor(x/gridStep)).join(',');if(!woodGrid.has(key))woodGrid.set(key,[]);woodGrid.get(key).push(i);}
  fruitClearance.setupMs=performance.now()-clearanceStart;
  function fruitHasRoom(item,g,kaki){
    const checkStart=performance.now();fruitClearance.tested++;if(!fruitWood.sample(item.p.x,item.p.z,item.p.y).solid){fruitClearance.rejectedRoot++;fruitClearance.filterMs+=performance.now()-checkStart;return false;}const v=new THREE.Vector3(),p=g.attributes.position,part=g.attributes.aOrchardFruitPart;
    for(const fraction of (kaki?[.20,.30,.45,.65,.82,1]:[.28,.40,.55,.72,.86,1])){const organScale=item.size*fraction;
    for(let i=0;i<p.count;i++)if(part.getX(i)>.5){v.fromBufferAttribute(p,i).multiplyScalar(organScale).applyQuaternion(item.q).add(item.p);if(fruitWood.sample(v.x,v.z,v.y).solid){fruitClearance.rejectedWood++;fruitClearance.filterMs+=performance.now()-checkStart;return false;}}
    const center=new THREE.Vector3(0,kaki?-.87:-1.02,0).multiplyScalar(organScale).applyQuaternion(item.q).add(item.p),radius=organScale*1.06,inv=item.q.clone().invert(),lo=center.clone().addScalar(-radius),hi=center.clone().addScalar(radius);
    for(let x=Math.floor(lo.x/gridStep);x<=Math.floor(hi.x/gridStep);x++)for(let y=Math.floor(lo.y/gridStep);y<=Math.floor(hi.y/gridStep);y++)for(let z=Math.floor(lo.z/gridStep);z<=Math.floor(hi.z/gridStep);z++)for(const id of woodGrid.get(`${x},${y},${z}`)||[]){v.fromBufferAttribute(woodPosition,id).sub(item.p).applyQuaternion(inv).multiplyScalar(1/organScale);const dy=(v.y+(kaki?.87:1.02))/(kaki?.77:.86);if(v.x*v.x+v.z*v.z+dy*dy<.98){fruitClearance.rejectedWood++;fruitClearance.filterMs+=performance.now()-checkStart;return false;}}
    }fruitClearance.accepted++;fruitClearance.filterMs+=performance.now()-checkStart;return true;
  }
  const diagnostics={fruitClearance,sites,branches:skeleton.branches,attachments:[],roots:skeleton.roots,trees:skeleton.trees,junctions:skeleton.junctions,skeletonStats:skeleton.stats,growthRules:ORCHARD_GROWTH_RULES,windScope:'continuous rooted arc bending shared by connected wood/flowers/fruits/leaves and depth/normal, plus rigid petiole hinge; stable per-organ seasonal retention',phenologyOwner:'seasonal-phenology.js',placementOwner:'retained actual dry-soil sites and closed skin contact; canopy occlusion allowed',coverageRule:'Mature organ matrices remain constant; shared phase gates stable ranks in colour/depth.'};
  const leafFrame=(axis,twist)=>{
    const y=axis.clone().normalize(),z=UP.clone().addScaledVector(y,-y.y).normalize();if(z.lengthSq()<.1)z.set(0,0,1).addScaledVector(y,-y.z).normalize();z.applyAxisAngle(y,twist);const x=new THREE.Vector3().crossVectors(y,z).normalize();return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
  };
  for(const tree of diagnostics.trees){
    const rng=random(seed^0x48ab39c1^Math.imul(tree.tree+1,0x45d9f3b)),range=(a,c)=>mix(a,c,rng()),kaki=tree.species==='persimmon',spec=FRUIT_SPECIES[tree.species],ownLeaves=kaki?kakiLeaves:leaves,ownFruit=kaki?kakiFruit:fruit,treeMeta=[...tree.root,tree.nominalHeight],leafStart=ownLeaves.length,flowerStart=flowers.length,fruitCandidates=[];
    function attach(axis,t,dir,kind,size,q=null){
      const host=sampleSkeletonAxis(axis,t),radial=dir.clone().addScaledVector(host.tangent,-dir.dot(host.tangent)).normalize();if(radial.lengthSq()<.1)radial.set(1,0,0);const p=host.p.clone().addScaledVector(radial,host.r*(kind==='fruit'?.91:.22)),d={p,q:q||leafFrame(dir,range(-.24,.24)),size,meta:{root:treeMeta,secondary:axis.start},treeIndex:tree.tree,branchId:axis.id,hostT:t,phase:range(0,TAU),rank:.025+.95*rng(),colour:new THREE.Color(kaki?0x557a3c:0x6d9045).multiplyScalar(range(.90,1.07))};diagnostics.attachments.push({kind,species:tree.species,tree:tree.tree,branch:axis.id,t,root:p.toArray(),host:host.p.toArray(),radius:host.r,gap:0});return d;
    }
    for(const axis of skeleton.axes.filter(a=>a.tree===tree.tree&&a.leafBearing)){
      const pitch=(spec.leafLength[0]+spec.leafLength[1])*.5*(kaki?.24:.18),count=clamp(Math.round(axis.length*.70/pitch),axis.kind==='short'?7:10,axis.kind==='short'?28:axis.kind==='fruiting'?38:36),phase=range(0,TAU);
      for(let node=0;node<count;node++){
        const t=.25+(node+range(.12,.88))/count*.70,host=sampleSkeletonAxis(axis,t),az=phase+node*TAU*2/5+range(-.10,.10),radial=new THREE.Vector3(Math.cos(az),0,Math.sin(az)).applyQuaternion(host.q),dir=radial.multiplyScalar(.84).addScaledVector(host.tangent,.20).addScaledVector(UP,-.16-.26*t+range(-.10,.10)).normalize();ownLeaves.push(attach(axis,t,dir,'leaf',range(...spec.leafLength)));
      }
      if(axis.flowerBearing){
        for(let node=0;node<6;node++){const t=.27+(node+range(.1,.9))/6*.65,host=sampleSkeletonAxis(axis,t),az=phase+node*TAU*2/5,dir=new THREE.Vector3(Math.cos(az),.3,Math.sin(az)).applyQuaternion(host.q).normalize(),d=attach(axis,t,dir,'blossom',range(...spec.blossomDiameter)*.5,basis(dir,range(0,TAU)));flowers.push(d);if(rng()<.13)flowers.push(attach(axis,Math.min(.96,t+.015),dir,'paired blossom',d.size*.94,basis(dir,range(0,TAU))));}
      }
      if(axis.kind==='fruiting')for(const t of [.30,.42,.54,.65,.76,.86,.93,.98])fruitCandidates.push({axis,t});
    }
    // Add bloom nodes only after all mature leaves have been emitted. This
    // preserves the accepted leaf RNG sequence, matrices and node arrangement.
    if(!kaki)for(const axis of skeleton.axes.filter(a=>a.tree===tree.tree&&a.flowerBearing)){
      for(let j=0;j<4;j++){const t=.31+(j+.5)/4*.56,host=sampleSkeletonAxis(axis,t),az=range(0,TAU),dir=new THREE.Vector3(Math.cos(az),.18,Math.sin(az)).applyQuaternion(host.q).normalize();flowers.push(attach(axis,t,dir,'extra blossom',range(...spec.blossomDiameter)*.5,basis(dir,range(0,TAU))));}
    }
    if(kaki){const candidates=skeleton.axes.filter(a=>a.tree===tree.tree&&a.kind==='fruiting');for(let j=0;j<spec.flowersPerTree;j++){const axis=candidates[Math.floor((j+.5)/spec.flowersPerTree*candidates.length)%candidates.length],t=.43+range(0,.40);kakiFlowers.push(attach(axis,t,new THREE.Vector3(0,-1,0),'kaki blossom',range(...spec.blossomDiameter)*.5,new THREE.Quaternion().setFromAxisAngle(UP,range(0,TAU))));}}
    for(let i=fruitCandidates.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[fruitCandidates[i],fruitCandidates[j]]=[fruitCandidates[j],fruitCandidates[i]];}
    fruitCandidates.sort((a,b)=>Number(Math.abs(sampleSkeletonAxis(a.axis,a.t).tangent.y)>.70)-Number(Math.abs(sampleSkeletonAxis(b.axis,b.t).tangent.y)>.70));
    const chosen=[];for(const c of fruitCandidates){if(chosen.length>=spec.fruitPerTree)break;const p=sampleSkeletonAxis(c.axis,c.t).p;if(chosen.some(x=>x.distanceTo(p)<(kaki?.095:.075)))continue;const item=attach(c.axis,c.t,new THREE.Vector3(0,-1,0),'fruit',range(...spec.fruitDiameter)*.5,new THREE.Quaternion().setFromAxisAngle(UP,range(0,TAU)));if(!fruitHasRoom(item,kaki?kakiFruitGeometry:fruitGeometry,kaki)){diagnostics.attachments.pop();continue;}item.rank=(chosen.length+.5)/spec.fruitPerTree;ownFruit.push(item);chosen.push(p);}
    Object.assign(tree,{leaves:ownLeaves.length-leafStart,blossoms:kaki?kakiFlowers.length:flowers.length-flowerStart,fruit:chosen.length,doorHeightRatio:tree.nominalHeight/.367});
  }
  // The same final closed bark is queried again while pruning ground plants.
  // Keep its immutable volume index; query counters are the only sampler state.
  const rootContactSampler=fruitWood,rootContactMatrix=barkMesh.matrixWorld.clone(),rootContactGeometry=barkMesh.geometry,rootContactHeightOwner=terrain.height;let rootContactTaken=false;
  fruitClearance.contactSamplerCounters={...rootContactSampler.stats.counters};fruitClearance.rootSamplerReused=false;
  fruitWood=null;woodGrid.clear();
  const canopyParts=[bakeLeafCanopy(leaves,[],{resolution:12,leafArea:area(leafGeometry),extinction:1.45,minAO:.30,aoPower:.72}),bakeLeafCanopy(kakiLeaves,[],{resolution:12,leafArea:area(kakiLeafGeometry),extinction:1.45,minAO:.30,aoPower:.72})];
  const canopy={foliage:leaves.length+kakiLeaves.length,trees:canopyParts.flatMap(x=>x.trees),parts:canopyParts};
  const depthBark=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});depthBark.onBeforeCompile=s=>patchOrchardTreeBend(s,uniforms,true,false);depthBark.customProgramCacheKey=()=> 'orchard-tree-arc-depth-230';barkMesh.customDepthMaterial=depthBark;
  const materials=[bark,depthBark],geometries=[branchGeometry,leafGeometry,kakiLeafGeometry,flowerGeometry,kakiFlowerGeometry,fruitGeometry,kakiFruitGeometry];
  const matrix=new THREE.Matrix4(),scale=new THREE.Vector3(),meshData=[];
  function makeInstances(items,g,kind,species){
    g.setAttribute('aPeachRoot',new THREE.InstancedBufferAttribute(new Float32Array(items.flatMap(x=>x.meta.root)),4));
    g.setAttribute('aPeachPhase',new THREE.InstancedBufferAttribute(new Float32Array(items.map(x=>x.phase)),1));g.setAttribute('aPeachRank',new THREE.InstancedBufferAttribute(new Float32Array(items.map(x=>x.rank)),1));g.setAttribute('aPeachAO',new THREE.InstancedBufferAttribute(new Float32Array(items.map(x=>x.canopyLightB?.[2]??1)),1));
    g.setAttribute('aPeachTree',new THREE.InstancedBufferAttribute(new Float32Array(items.map(x=>x.treeIndex)),1));g.setAttribute('aPeachWindAxis',new THREE.InstancedBufferAttribute(new Float32Array(items.flatMap(x=>{const z=new THREE.Vector3(0,0,1).applyQuaternion(x.q);return[z.x,z.z];})),2));
    const local={...uniforms,uOrchardCoverage:{value:1},uPeachLeaf:{value:1},uPeachAutumn:{value:0},uPeachRipeness:{value:0},uOrchardNewLeaf:{value:0},uOrchardOrganSize:{value:1},uOrchardSpecies:{value:species==='persimmon'?1:0}},mat=organMaterial(kind,local),depth=organMaterial(kind,local,true),mesh=new THREE.InstancedMesh(g,mat,items.length);materials.push(mat,depth);mesh.name=`${species} ${kind}: mature organs, independent coverage`;mesh.customDepthMaterial=depth;mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
    items.forEach((d,i)=>{matrix.compose(d.p,d.q,scale.setScalar(d.size));mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,kind==='leaf'?d.colour:new THREE.Color(0xffffff));});group.add(mesh);meshData.push({mesh,items,g,kind,species,uniforms:local});return mesh;
  }
  makeInstances(leaves,leafGeometry,'leaf','peach');makeInstances(kakiLeaves,kakiLeafGeometry,'leaf','persimmon');makeInstances(flowers,flowerGeometry,'blossom','peach');makeInstances(kakiFlowers,kakiFlowerGeometry,'blossom','persimmon');makeInstances(fruit,fruitGeometry,'fruit','peach');makeInstances(kakiFruit,kakiFruitGeometry,'fruit','persimmon');
  barkMesh.userData.rootContacts={closed:true,geometryOwner:'this mesh includes every peach and persimmon woody tube',trees:diagnostics.trees,lowSurfaceRule:'Only actual solid at candidate ground height. Roots lie below ground + .08; never use crown radius as a soil exclusion.'};
  group.userData.diagnostics=diagnostics;group.userData.peachSpecies=PEACH_SPECIES;group.userData.fruitSpecies=FRUIT_SPECIES;group.userData.sites=sites;group.userData.rootContactMesh=barkMesh;
  const triangles=branchGeometry.index.count/3+meshData.reduce((n,d)=>n+d.g.index.count/3*d.items.length,0);
  const stats={seed,species:{peach:{name:PEACH_SPECIES.name,trees:2,leaves:leaves.length,blossoms:flowers.length,fruit:fruit.length},persimmon:{name:PERSIMMON_SPECIES.name,trees:1,leaves:kakiLeaves.length,blossoms:kakiFlowers.length,fruit:kakiFruit.length}},trees:3,sites:sites.map(p=>({...p})),branches:diagnostics.branches.length,leaves:leaves.length+kakiLeaves.length,blossoms:flowers.length+kakiFlowers.length,fruit:fruit.length+kakiFruit.length,drawCalls:7,triangles,canopy,unitLeafArea:{peach:area(leafGeometry),persimmon:area(kakiLeafGeometry)},scale:{doorHeight:.367,maxLeafLength:Math.max(...leaves.map(d=>d.size),...kakiLeaves.map(d=>d.size)),maxBlossomDiameter:Math.max(...flowers.map(d=>d.size*2),...kakiFlowers.map(d=>d.size*2)),maxFruitDiameter:Math.max(...fruit.map(d=>d.size*2),...kakiFruit.map(d=>d.size*2))},phase:sampleSeasonalPhenology(0),windScope:diagnostics.windScope,coverageRule:diagnostics.coverageRule,externalAssets:0,renderTargets:0};
  if(triangles>1100000||stats.drawCalls>8)throw new Error(`Mature orchard budget exceeded: ${triangles} triangles.`);
  for(const tree of diagnostics.trees){
    const box=new THREE.Box3(),v=new THREE.Vector3();
    for(let i=0;i<branchGeometry.attributes.position.count;i++)if(branchGeometry.attributes.aPeachRoot.getX(i)===Math.fround(tree.root[0]))box.expandByPoint(v.fromBufferAttribute(branchGeometry.attributes.position,i));
    for(const d of meshData)for(const item of d.items)if(item.treeIndex===tree.tree)for(let i=0;i<d.g.attributes.position.count;i++){v.fromBufferAttribute(d.g.attributes.position,i).multiplyScalar(item.size).applyQuaternion(item.q).add(item.p);box.expandByPoint(v);}
    tree.boundsMeaning='Carrier geometry bounds, including analytic-alpha leaf envelopes; not exact visible leaf width or pixel coverage.';tree.fullBounds={min:box.min.toArray(),max:box.max.toArray()};tree.actualBounds=tree.fullBounds;tree.actualHeight=box.max.y-sites[tree.tree].y;tree.actualWidth=Math.max(box.max.x-box.min.x,box.max.z-box.min.z);
    const leafData=meshData.find(d=>d.kind==='leaf'&&d.species===tree.species),items=leafData.items.filter(d=>d.treeIndex===tree.tree),unitArea=area(leafData.g),widthX=box.max.x-box.min.x,widthZ=box.max.z-box.min.z,crownPlanArea=Math.PI*.25*widthX*widthZ;
    tree.leafArea={singleSided:items.reduce((n,d)=>n+unitArea*d.size*d.size,0),crownPlanArea,areaToCrownPlanRatio:0,maxLeafLength:Math.max(...items.map(d=>d.size)),maxLeafLengthToDoor:Math.max(...items.map(d=>d.size))/.367,unitPrimitiveArea:unitArea,note:'Visible leaf-blade area from the analytic unit silhouette integral, excluding petiole, divided by full-organ carrier-geometry crown bounding ellipse; an optical density proxy, not measured pixel coverage.'};tree.leafArea.areaToCrownPlanRatio=tree.leafArea.singleSided/crownPlanArea;
  }
  stats.buildMs=performance.now()-orchardBuildStart;stats.fruitClearance=fruitClearance;stats.treeGeometry=diagnostics.trees;stats.actualBounds=diagnostics.trees.map(t=>({tree:t.tree,species:t.species,bounds:t.actualBounds,height:t.actualHeight,width:t.actualWidth}));group.userData.stats=stats;let disposed=false,lastOrganSeason=NaN;const windStats=sites.map(()=>[0,0]);
  function update(time=0,state={}){
    if(disposed)return;
    const season=normalizeSeason(state.season??0);uniforms.uPeachTime.value=Number.isFinite(state.time)?state.time:Number.isFinite(time)?time:0;
    for(let i=0;i<sites.length;i++){
      const target=uniforms[`uPeachWind${i}`].value,site=sites[i];
      sampleTreeWind(field,site.x,site.z,state,target);
      if(target.length()>4)target.setLength(4);
    }
    stats.time=uniforms.uPeachTime.value;for(let i=0;i<sites.length;i++)uniforms[`uPeachWind${i}`].value.toArray(windStats[i]);stats.wind=windStats;uniforms.uPeachWet.value=clamp(state.wetness??0,0,1);
    if(season===lastOrganSeason)return;lastOrganSeason=season;
    const phase=sampleSeasonalPhenology(season);stats.phase=phase;
    stats.organs=[];
    for(const d of meshData){
      const prefix=d.species==='peach'?'peach':'persimmon',coverage=phase[prefix+(d.kind==='leaf'?'Leaf':d.kind==='blossom'?'Blossom':'Fruit')];
      d.uniforms.uOrchardCoverage.value=coverage;d.uniforms.uPeachLeaf.value=phase[prefix+'Leaf'];d.uniforms.uPeachRipeness.value=phase[prefix+'Ripeness'];d.uniforms.uPeachAutumn.value=phase[prefix+'Autumn'];d.uniforms.uOrchardNewLeaf.value=phase[prefix+'NewLeaf'];d.uniforms.uOrchardOrganSize.value=d.kind==='fruit'?phase[prefix+'FruitSize']:1;d.mesh.visible=coverage>1e-7;
      let retained=0,equivalent=0;for(const item of d.items){const linear=clamp((coverage-item.rank)*20+.5,0,1),amount=linear*linear*(3-2*linear);if(amount>=.5)retained++;equivalent+=amount;}
      stats.organs.push({species:d.species,kind:d.kind,capacity:d.items.length,coverage,retainedAtHalfCoverage:retained,equivalentWholeOrgans:equivalent,matureSizeRatio:d.uniforms.uOrchardOrganSize.value,leafAutumn:phase[prefix+'Autumn'],newLeaf:phase[prefix+'NewLeaf'],visible:d.mesh.visible});
    }
  }
  update(0,{season:0});
  function takeRootContactSampler(){
    if(disposed||rootContactTaken)return null;barkMesh.updateWorldMatrix(true,false);
    if(barkMesh.geometry!==rootContactGeometry||terrain.height!==rootContactHeightOwner||!barkMesh.matrixWorld.equals(rootContactMatrix))return null;
    rootContactTaken=true;fruitClearance.rootSamplerReused=true;for(const key of Object.keys(rootContactSampler.stats.counters))rootContactSampler.stats.counters[key]=0;
    return rootContactSampler;
  }
  return {group,stats,diagnostics,setTreeMotionUniforms(shared){for(const name of['uTreeDragRoot','uTreeDragBend']){uniforms[name].value=shared[name].value;}},contactMeshes:[barkMesh],takeRootContactSampler,barkMesh,update,dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const {mesh}of meshData)mesh.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();stats.disposed=true;},get disposed(){return disposed;}};
}
