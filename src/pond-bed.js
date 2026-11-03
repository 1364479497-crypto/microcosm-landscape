import * as THREE from 'three';

// Authored cobbles are static objects rooted in the existing pond floor.
// Neither their shape nor their spacing changes the terrain/shoreline owner.
const TAU=Math.PI*2;
function random(seed){let s=seed>>>0;return()=>{s+=0x6d2b79f5;let n=s;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
const mix=THREE.MathUtils.lerp;
export function createPondBed({terrain,seed=42}={}){
 if(!terrain?.height||!terrain?.lake)throw new Error('Pond bed requires the shared terrain and lake.');
 const group=new THREE.Group();group.name='Submerged cobble clusters rooted in the pond bowl';
 const lake=terrain.lake,r=random(seed^0x25b71af3),positions=[],colors=[],indices=[],stones=[];
 const clusters=[[-.51,-.13],[.27,-.30],[.48,.20],[-.15,.43],[.07,.02]];
 const candidates=[];
 for(let i=0;i<270;i++){
  // The central drift receives comparable density to the outer loose groups;
  // its broader original footprint left a decorative U-shaped gap in top view.
  const cluster=[0,1,2,3,4,4][i%6],c=clusters[cluster],a=r()*TAU,d=Math.sqrt(r())*(cluster===4?.27:.23),nx=c[0]+Math.cos(a)*d,nz=c[1]+Math.sin(a)*d;
  candidates.push({x:lake.x+nx*lake.rx,z:lake.z+nz*lake.rz,rank:r(),cluster});
 }
 candidates.sort((a,b)=>a.rank-b.rank);
 for(const candidate of candidates){
  if(stones.length>=53)break;
  const {x,z,cluster}=candidate,base=terrain.height(x,z),q=((x-lake.x)/lake.rx)**2+((z-lake.z)/lake.rz)**2;
  const radius=.035+r()*.057,height=.022+r()*.042,yaw=r()*TAU,aspect=.72+r()*.45;
  if(q>.78||z>lake.front-.17||base>lake.level-.25)continue;
  if(stones.some(s=>Math.hypot(s.x-x,s.z-z)<(s.radius+radius)*.82))continue;
  const sectors=12,rings=3,first=positions.length/3,topTriangles=[],outline=[];
  const tint=new THREE.Color().setRGB(.17+r()*.055,.165+r()*.055,.14+r()*.052),phase=r()*TAU;
  const add=(px,py,pz,brightness=1)=>{const id=positions.length/3;positions.push(px,py,pz);colors.push(tint.r*brightness,tint.g*brightness,tint.b*brightness);return id;};
  add(x,base+height-.004,z,1.05);
  for(let ring=1;ring<=rings;ring++)for(let k=0;k<sectors;k++){
   const angle=yaw+k*TAU/sectors,jag=.91+.07*Math.sin(k*2.17+phase)+.025*Math.cos(k*4.1-phase),s=ring/rings;
   const dx=Math.cos(angle)*radius*jag,dz=Math.sin(angle)*radius*aspect*jag,px=x+dx*s,pz=z+dz*s,soil=terrain.height(px,pz);
   const cap=height*Math.pow(Math.max(0,1-s*s),.58),y=soil+cap-.006+(ring<rings?Math.sin(k*1.9+phase)*height*.06:0);
   add(px,y,pz,.89+.14*(1-s)+.045*Math.sin(k*1.71+phase));if(ring===rings)outline.push([px,pz]);
  }
  const tri=(a,b,c)=>{indices.push(a,b,c);topTriangles.push([a,b,c]);};
  for(let k=0;k<sectors;k++)tri(first,first+1+(k+1)%sectors,first+1+k);
  for(let ring=1;ring<rings;ring++)for(let k=0;k<sectors;k++){
   const a=first+1+(ring-1)*sectors+k,b=first+1+(ring-1)*sectors+(k+1)%sectors,c=a+sectors,d=b+sectors;tri(a,b,c);tri(b,d,c);
  }
  const bottom=[];let minY=base;
  for(const [px,pz]of outline){const y=terrain.height(px,pz)-.035;minY=Math.min(minY,y);bottom.push(add(px,y,pz,.80));}
  const bottomCenter=add(x,minY-.003,z,.80),topStart=first+1+(rings-1)*sectors;
  for(let k=0;k<sectors;k++){const a=topStart+k,b=topStart+(k+1)%sectors,c=bottom[k],d=bottom[(k+1)%sectors];indices.push(a,b,c,b,d,c,bottomCenter,c,d);}
  const bounds={minX:Math.min(...outline.map(p=>p[0])),maxX:Math.max(...outline.map(p=>p[0])),minZ:Math.min(...outline.map(p=>p[1])),maxZ:Math.max(...outline.map(p=>p[1]))};
  stones.push({id:stones.length,x,z,base,radius,height,aspect,yaw,cluster,bounds,topTriangles,groundSampleOwner:'terrain.height',contact:'top outer ring buried 0.006 below sampled bed; closed side and base below soil'});
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
 const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.83,metalness:0});
 material.onBeforeCompile=s=>{
  s.vertexShader='varying vec3 vBedStoneP;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBedStoneP=(modelMatrix*vec4(transformed,1.)).xyz;');
  s.fragmentShader='varying vec3 vBedStoneP;\nfloat stoneHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}\nfloat stoneNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(stoneHash(i),stoneHash(i+vec3(1,0,0)),f.x),mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+1.),f.x),f.y),f.z);}\n'+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat bedMottle=stoneNoise(vBedStoneP*23.);float bedFineFilter=1.-smoothstep(.015,.055,length(fwidth(vBedStoneP)));float bedFine=stoneNoise(vBedStoneP*139.);diffuseColor.rgb*=.86+bedMottle*.25+(bedFine-.5)*.10*bedFineFilter;');
  s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(.76+bedMottle*.12,.72,.90);');
 };
 material.customProgramCacheKey=()=> 'authored-submerged-bed-cobbles-v1';
 const mesh=new THREE.Mesh(geometry,material);mesh.name='Small water-worn cobbles with buried rims';mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
 const grid=new Map(),cell=.24,key=(x,z)=>`${Math.floor(x/cell)},${Math.floor(z/cell)}`;
 for(const s of stones)for(let j=Math.floor(s.bounds.minZ/cell);j<=Math.floor(s.bounds.maxZ/cell);j++)for(let i=Math.floor(s.bounds.minX/cell);i<=Math.floor(s.bounds.maxX/cell);i++){const k=`${i},${j}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(s);}
 const p=geometry.attributes.position;
 function heightAt(x,z,ground=terrain.height(x,z)){
  let y=ground;
  for(const stone of grid.get(key(x,z))||[]){if(x<stone.bounds.minX||x>stone.bounds.maxX||z<stone.bounds.minZ||z>stone.bounds.maxZ)continue;
   for(const [ia,ib,ic]of stone.topTriangles){const ax=p.getX(ia),az=p.getZ(ia),bx=p.getX(ib),bz=p.getZ(ib),cx=p.getX(ic),cz=p.getZ(ic),det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(det)<1e-14)continue;
    const a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det,b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det,c=1-a-b;if(a>=-1e-8&&b>=-1e-8&&c>=-1e-8)y=Math.max(y,a*p.getY(ia)+b*p.getY(ib)+c*p.getY(ic));
   }
  }return y;
 }
 const stats={seed,stones:stones.length,triangles:indices.length/3,vertices:positions.length/3,drawCalls:1,externalAssets:0,heightQuery:'actual Float32 top triangle vertical intersection; max with unchanged terrain.height; XZ grid only accelerates lookup'};
 const diagnostics={stones:stones.map(({topTriangles,...s})=>s),heightQuery:stats.heightQuery,scope:'Static submerged cobbles only, no lake/river/shore/vegetation changes.'};
 group.userData.pondBed={stats,diagnostics};let disposed=false;
 return {group,stats,diagnostics,heightAt,dispose(){if(disposed)return;disposed=true;group.removeFromParent();geometry.dispose();material.dispose();stats.disposed=true;}};
}
