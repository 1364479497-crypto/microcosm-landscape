import * as THREE from 'three';
import {seededRandom} from './terrain-field.js';

// Small temperate wet-bank growth habits. Botanical names are research
// references, not claims of a surveyed native plant community.
const UP=new THREE.Vector3(0,1,0),TAU=Math.PI*2;
const clamp=THREE.MathUtils.clamp,mix=THREE.MathUtils.lerp;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const angularDistance=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
class WetForms{
 constructor(){this.p=[];this.c=[];this.root=[];this.kind=[];this.n=[];this.i=[];}
 vertex(p,color,root,kind,normal,tone=1){const i=this.p.length/3;this.p.push(p.x,p.y,p.z);this.c.push(color.r*tone,color.g*tone,color.b*tone);this.root.push(...root);this.kind.push(kind);this.n.push(normal.x,normal.y,normal.z);return i;}
 geometry(){const g=new THREE.BufferGeometry();for(const [name,values,size]of [['position',this.p,3],['normal',this.n,3],['color',this.c,3],['aSiteRoot',this.root,4],['aSiteKind',this.kind,1],['aSiteSnow',Array(this.kind.length).fill(1),1]])g.setAttribute(name,new THREE.Float32BufferAttribute(values,size));g.setIndex(this.i);g.computeBoundingSphere();return g;}
}
function leaf(forms,base,direction,height,width,reach,color,root,kind=1,steps=4){
 const side=new THREE.Vector3(-direction.z,0,direction.x),rows=[];
 for(let j=0;j<=steps;j++){
  const t=j/steps,arching=kind===0?.56:.18,y=height*(t-arching*t*t),p=base.clone().addScaledVector(UP,y).addScaledVector(direction,reach*t*t);
  const w=width*(.25+.75*Math.sin(Math.PI*t))*(1-t*.92),row=[];
  for(let k=0;k<3;k++){
   const v=p.clone().addScaledVector(side,(k-1)*w);v.y+=(k===1?width*.34:0)*Math.sin(t*Math.PI);
   // A blade is shaded as part of its upward/outward leaf volume on either
   // face. Geometry still retains its real fold and a narrowing silhouette.
   const n=UP.clone().multiplyScalar(.78).addScaledVector(direction,.25).addScaledVector(side,(k-1)*.18).normalize();
   row.push(forms.vertex(v,color,root,1,n,(.82+.18*t)*(k===1?1.07:1)));
  }rows.push(row);
 }
 for(let j=0;j<steps;j++)for(let k=0;k<2;k++){const a=rows[j][k],b=rows[j+1][k],c=rows[j][k+1],d=rows[j+1][k+1];forms.i.push(a,b,c,c,b,d);}
}
function tube(forms,points,radius,color,root,kind=2,radial=4){
 const rings=[];
 for(let j=0;j<points.length;j++){
  const tangent=points[Math.min(points.length-1,j+1)].clone().sub(points[Math.max(0,j-1)]).normalize(),side=new THREE.Vector3(1,0,0);
  side.addScaledVector(tangent,-side.dot(tangent)).normalize();if(side.lengthSq()<.1)side.set(0,0,1);
  const across=new THREE.Vector3().crossVectors(tangent,side).normalize(),ring=[];
  for(let k=0;k<radial;k++){const a=k/radial*TAU,n=side.clone().multiplyScalar(Math.cos(a)).addScaledVector(across,Math.sin(a));ring.push(forms.vertex(points[j].clone().addScaledVector(n,radius*(1-j/(points.length-1)*.35)),color,root,kind,n,.90+.10*Math.cos(a)));}rings.push(ring);
 }
 for(let j=0;j<rings.length-1;j++)for(let k=0;k<radial;k++){const a=rings[j][k],b=rings[j][(k+1)%radial],c=rings[j+1][k],d=rings[j+1][(k+1)%radial];forms.i.push(a,c,b,b,c,d);}
}
function spike(forms,base,height,radius,color,root){
 const rings=[],radial=5,levels=4;
 for(let j=0;j<=levels;j++){
  const t=j/levels,r=radius*(j===0||j===levels?.55:1),ring=[];
  for(let k=0;k<radial;k++){const a=k/radial*TAU,n=new THREE.Vector3(Math.cos(a),.10,Math.sin(a)).normalize();ring.push(forms.vertex(base.clone().add(new THREE.Vector3(Math.cos(a)*r,height*t,Math.sin(a)*r)),color,root,3,n,.85+.15*Math.cos(a)));}rings.push(ring);
 }
 for(let j=0;j<levels;j++)for(let k=0;k<radial;k++){const a=rings[j][k],b=rings[j][(k+1)%radial],c=rings[j+1][k],d=rings[j+1][(k+1)%radial];forms.i.push(a,c,b,b,c,d);}
}

export function createWetlandPlants({terrain,habitat,sampleSurface,seed=42}={}){
 const r=seededRandom(seed^0x70c417b),forms=new WetForms(),lake=terrain.lake,clumps=[],shootRoots=[];
 const stats={creekClumps:0,lakeClumps:0,inletClumps:0,shoulderMats:0,shoulderTriangles:0,lowMats:0,fanSedges:0,roundRushes:0,cattailClumps:0,brownSpikes:0,leaves:0,stems:0,triangles:0,maxLeafHeight:0,maxSpikeHeight:0,requested:{creek:122,lake:190,shoulder:64},groups:{creek:0,lake:0},habitat:'temperate freshwater: moist tongues, very shallow margins, sheltered lake inlet; no open channel core'};
 const colours=[new THREE.Color(0x6e944e),new THREE.Color(0x6d914c),new THREE.Color(0x688752),new THREE.Color(0x8b9e63)],tip=new THREE.Color(0xa4b96c),brown=new THREE.Color(0x806246);
 const allowed=(x,z)=>habitat.allowedOnStreamBank(x,z,.004)&&habitat.sample(x,z).treeDistance>.065&&!terrain.rocks.some(s=>{const h=s.heightAt(x,z);return Number.isFinite(h)&&h>terrain.sample(x,z).bedHeight+.002;});
 function siteAt(x,z,zone){
  if(!allowed(x,z))return null;
  const p=sampleSurface(x,z),f=terrain.sample(x,z),shore=lake.shoreDistance(x,z),reach=terrain.river.sample(z);
  if(!Number.isFinite(p.y)||p.normal.y<(zone==='creek'?.43:zone==='shoulder'?.35:.50))return null;
  if(zone==='creek'){
   const q=Math.abs(x-reach.x)/reach.width,delta=p.y-reach.y;
   if(z< -2.54||z>1.61||reach.segment<2||reach.poolWeight>.08||Math.abs(reach.dyDz)>1.45||q<.77||q>1.96||delta<-.075||delta>.145)return null;
   return{x,z,p,f,reach,stage:reach.y,delta,depth:-delta,shore,q,zone,out:new THREE.Vector3(Math.sign(x-reach.x),0,0)};
  }
  const delta=p.y-lake.level;
  if(zone==='shoulder'){
   if(z>3.84||shore<-.06||shore>.22||delta<.025||delta>.15||p.normal.y>.68)return null;
   if(z<1.74&&Math.abs(x-reach.x)<reach.width*.80)return null;
   return{x,z,p,f,reach,stage:lake.level,delta,depth:-delta,shore,zone:'lake',shoulder:true,out:new THREE.Vector3(x-lake.x,0,(z-lake.z)*1.05).normalize()};
  }
  if(z>3.84||shore<-.18||shore>.17||delta<-.11||delta>.135)return null;
  if(z<1.74&&Math.abs(x-reach.x)<reach.width*.72)return null;
  return{x,z,p,f,reach,stage:lake.level,delta,depth:-delta,shore,zone,out:new THREE.Vector3(x-lake.x,0,(z-lake.z)*1.05).normalize()};
 }
 const candidates=[];
 const creekCentres=[-2.35,-1.95,-1.54,-1.12,-.71,-.28,.15,.59,1.04,1.44];
 for(let z=-2.50;z<1.60;z+=.022)for(const sign of [-1,1])for(const lateral of [.80,.96,1.13,1.31,1.51,1.74]){
  const zz=z+(r()-.5)*.019,reach=terrain.river.sample(zz),x=reach.x+sign*(reach.width*lateral+(r()-.5)*.032),s=siteAt(x,zz,'creek');if(!s)continue;
  let patch=0,group=0;for(let i=0;i<creekCentres.length;i++){if((i+(sign>0?1:0))%7===5)continue;const centre=creekCentres[i]+(sign>0?.045:-.025),width=.17+.035*Math.sin(i*1.7),v=1-smooth(width*.36,width,Math.abs(zz-centre));if(v>patch){patch=v;group=i*2+(sign>0?1:0);}}
  if(patch<.15)continue;s.patch=patch;s.group=group;s.rank=patch*.52+r()*.35+clamp(finiteSoil(s.f),0,1)*.13;candidates.push(s);
 }
 const lakeCentres=[.08,.56,1.30,1.91,2.36,2.91,3.56,4.03,4.43,4.91,5.38,5.91];
 for(let angle=0;angle<TAU;angle+=.023)for(const radial of [.85,.89,.93,.97,1.01,1.055,1.10,1.145]){
  const a=angle+(r()-.5)*.017,rr=radial+(r()-.5)*.018,x=lake.x+Math.cos(a)*lake.rx*rr,z=lake.z+Math.sin(a)*lake.rz*rr,s=siteAt(x,z,'lake');if(!s)continue;
  let patch=0,group=0;for(let i=0;i<lakeCentres.length;i++){const width=.20+.045*Math.sin(i*2.1),v=1-smooth(width*.32,width,angularDistance(a,lakeCentres[i]));if(v>patch){patch=v;group=i;}}
  if(patch<.12)continue;s.patch=patch;s.group=group;s.rank=patch*.48+r()*.37+clamp(finiteSoil(s.f),0,1)*.15;candidates.push(s);
 }
 candidates.sort((a,b)=>b.rank-a.rank);
 const selected=[];
 for(const s of candidates){
  if(stats[`${s.zone}Clumps`]>=stats.requested[s.zone])continue;
  if(selected.some(p=>Math.hypot(p.x-s.x,p.z-s.z)<(p.zone===s.zone?.058:.075)))continue;
  selected.push(s);stats[`${s.zone}Clumps`]++;
 }
 // One targeted layer on the moist, steeper shoulder between short bank grass
 // and taller fans. It has a separate random stream, so the first 312 clumps
 // and all mountain sites keep their prior draw sequence and shape parameters.
 const shoulderR=seededRandom(seed^0x519a37),shoulders=[],shoulderRadials=Array.from({length:31},(_,i)=>.86+i*.01);
 for(let angle=0;angle<TAU;angle+=.014)for(const radial of shoulderRadials){
  const a=angle+(shoulderR()-.5)*.015,rr=radial+(shoulderR()-.5)*.014,x=lake.x+Math.cos(a)*lake.rx*rr,z=lake.z+Math.sin(a)*lake.rz*rr,s=siteAt(x,z,'shoulder');if(!s)continue;
  let patch=0,group=0;for(let i=0;i<lakeCentres.length;i++){const width=.17+.025*Math.sin(i*2.1),v=1-smooth(width*.26,width,angularDistance(a,lakeCentres[i]));if(v>patch){patch=v;group=i;}}
  if(patch<.18||habitat.noise(x*3.4+8,z*3.4-2)<.28)continue;s.group=group;s.patch=patch;s.rank=patch*.55+shoulderR()*.45;shoulders.push(s);
 }
 shoulders.sort((a,b)=>b.rank-a.rank);
 for(const s of shoulders){
  if(stats.shoulderMats>=stats.requested.shoulder)break;
  if(selected.some(p=>Math.hypot(p.x-s.x,p.z-s.z)<(p.shoulder?.045:.022)))continue;
  selected.push(s);stats.shoulderMats++;stats.lakeClumps++;
 }
 // Count/layout RNG is complete before emitting leaves, keeping shape budgets
 // independent from a rejected local shoot or an extra stem in another clump.
 const shape=seededRandom(seed^0x47e5109),usedGroups={creek:new Set(),lake:new Set()};
 for(const s of selected){
  const phase=habitat.noise(s.x*3.9+11,s.z*3.7-7),calm=s.zone==='lake'&&(s.z>1.72||Math.abs(s.x-s.reach.x)>s.reach.width*2.1);
  let kind=s.shoulder?0:calm&&s.depth>.008&&s.depth<.085&&s.p.normal.y>.70&&phase>.68&&stats.cattailClumps<15?3:phase>.67?2:s.delta>.012&&phase<.31?0:1;
  if(kind===0&&!s.shoulder&&s.p.normal.y<.65)kind=1;
  const height=s.shoulder?.035+shape()*.020:kind===0?.04+shape()*.035:kind===1?.095+shape()*.069:kind===2?.125+shape()*.057:.163+shape()*.024;
  const count=s.shoulder?4+Math.floor(shape()*2):kind===0?9+Math.floor(shape()*4):kind===1?10+Math.floor(shape()*4):kind===2?7+Math.floor(shape()*4):6+Math.floor(shape()*3),heading=Math.atan2(s.out.z,s.out.x)+(shape()-.5)*.9;
  const triangleStart=forms.i.length;
  const record={x:s.x,z:s.z,y:s.p.y-.0015,height,kind,zone:s.zone,shoulder:!!s.shoulder,normalY:s.p.normal.y,stage:s.stage,depth:s.depth,shore:s.shore,group:s.group,owner:s.p.owner,shoots:0};
  usedGroups[s.zone].add(s.group);stats[['lowMats','fanSedges','roundRushes','cattailClumps'][kind]]++;
  if(s.zone==='lake'&&s.z<1.7&&s.x>.05&&s.x<2.8)stats.inletClumps++;
  for(let k=0;k<count;k++){
   const a=shape()*TAU,d=Math.sqrt(shape())*(kind===0?.035:.018),px=s.x+Math.cos(a)*d,pz=s.z+Math.sin(a)*d,local=siteAt(px,pz,s.shoulder?'shoulder':s.zone)||s;
   const base=new THREE.Vector3(local.x,local.p.y-.0015,local.z),root=[base.x,base.y,base.z,height],yaw=heading+(k/count-.5)*(kind===0?TAU:2.45)+(shape()-.5)*.32;
   const direction=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw)).multiplyScalar(.40).addScaledVector(s.out,.60).normalize();
   const c=colours[kind].clone().lerp(tip,shape()*.27).multiplyScalar(.91+shape()*.16),h=height*(.58+shape()*.42);
   if(kind===2){
    const top=base.clone().addScaledVector(UP,h).addScaledVector(direction,h*.12),mid=base.clone().lerp(top,.55).addScaledVector(direction,-h*.04);
    tube(forms,[base,mid,top],.0013+shape()*.00065,c,root,2,4);stats.stems++;
   }else{
    const width=kind===0?.0045+shape()*.003:kind===3?.0036+shape()*.0018:.0040+shape()*.0024;
    leaf(forms,base,direction,h,width,h*(kind===0?.92:kind===1?.46:.20),c,root,kind,kind===0?3:4);stats.leaves++;
   }
   shootRoots.push({x:base.x,y:base.y,z:base.z,zone:s.zone,kind,owner:local.p.owner});record.shoots++;stats.maxLeafHeight=Math.max(stats.maxLeafHeight,h);
  }
  if(kind===3){
   const root=[s.x,record.y,s.z,.20],base=new THREE.Vector3(...root.slice(0,3)),stemTop=Math.min(.195,height+.012),headHeight=.025+shape()*.008,tipPoint=base.clone().addScaledVector(UP,stemTop);
   tube(forms,[base,base.clone().addScaledVector(UP,stemTop*.52),tipPoint],.0013,colours[3],root,2,4);
   spike(forms,tipPoint.clone().addScaledVector(UP,-headHeight),headHeight,.0044+shape()*.0014,brown,root);stats.brownSpikes++;stats.stems++;stats.maxSpikeHeight=Math.max(stats.maxSpikeHeight,stemTop);
   shootRoots.push({x:s.x,y:record.y,z:s.z,zone:s.zone,kind,owner:s.p.owner});
  }
  clumps.push(record);
  if(s.shoulder)stats.shoulderTriangles+=(forms.i.length-triangleStart)/3;
 }
 stats.groups={creek:usedGroups.creek.size,lake:usedGroups.lake.size};stats.triangles=forms.i.length/3;
 return{geometry:forms.geometry(),clumps,shootRoots,stats};
}
function finiteSoil(field){return Number.isFinite(field.wetlandSoil)?field.wetlandSoil:0;}
