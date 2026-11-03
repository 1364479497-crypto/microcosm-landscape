import * as THREE from 'three';
import {seededRandom} from './terrain-field.js';
import {createWetlandPlants} from './wetland-plants.js';

// Case-scale ecology accents. They add no water/terrain state and do not
// consume the accepted meadow/tree random streams. Shape names describe a
// growth habit, not an identification of surveyed species.
const UP=new THREE.Vector3(0,1,0),DOWN=new THREE.Vector3(0,-1,0),TAU=Math.PI*2;
const clamp=THREE.MathUtils.clamp,mix=THREE.MathUtils.lerp;

/** Follow the rendered terrain triangles, including attached rock plates.
 * The regular ground grid is sampled in O(1); only small cliff meshes need
 * raycasts. Analytic terrain is retained as the habitat/water datum owner. */
export function createVegetationSurfaceSampler(terrain){
 const ground=terrain.group.children.find(o=>o.isMesh&&o.name.startsWith('Continuous crests'));
 const attr=ground.geometry.attributes.position,[nx,nz]=terrain.stats.grid;
 const plates=terrain.group.children.filter(o=>o.isInstancedMesh&&/chipped limestone|angular scree/.test(o.name));
 const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3(),matrix=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3();
 terrain.group.updateMatrixWorld(true);for(const m of plates){m.geometry.computeBoundingSphere();m.computeBoundingSphere();}
 return (x,z)=>{
  const gx=clamp((x+6)/12*nx,0,nx-.00001),gz=clamp((z+5.3)/9.6*nz,0,nz-.00001),i=Math.floor(gx),j=Math.floor(gz),u=gx-i,v=gz-j,index=j*(nx+1)+i;
  let ids,weights;
  if(u+v<=1){ids=[index,index+nx+1,index+1];weights=[1-u-v,v,u];}
  else{ids=[index+1,index+nx+1,index+nx+2];weights=[1-v,1-u,u+v-1];}
  a.fromBufferAttribute(attr,ids[0]);b.fromBufferAttribute(attr,ids[1]);c.fromBufferAttribute(attr,ids[2]);
  let y=a.y*weights[0]+b.y*weights[1]+c.y*weights[2],normal=ab.copy(b).sub(a).cross(ac.copy(c).sub(a)).normalize().clone(),owner='ground-triangle';
  if(plates.length){origin.set(x,5.5,z);ray.set(origin,DOWN);ray.far=6.5;
   const hits=ray.intersectObjects(plates,false),hit=hits[0];
   if(hit&&hit.point.y>y+.002){
    y=hit.point.y;matrix.copy(hit.object.matrixWorld);
    if(hit.object.isInstancedMesh){const local=new THREE.Matrix4();hit.object.getMatrixAt(hit.instanceId,local);matrix.multiply(local);}
    normal=hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(matrix)).normalize();owner='rock-plate-triangle';
   }
  }
  return {x,z,y,normal,owner};
 };
}

class Forms{
 constructor(){this.p=[];this.c=[];this.root=[];this.i=[];this.snow=[];}
 vertex(p,c,root,snow=1,tone=1){const i=this.p.length/3;this.p.push(...p.toArray());this.c.push(c.r*tone,c.g*tone,c.b*tone);this.root.push(...root);this.snow.push(snow);return i;}
 geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));g.setAttribute('aSiteRoot',new THREE.Float32BufferAttribute(this.root,4));g.setAttribute('aSiteKind',new THREE.Float32BufferAttribute(new Float32Array(this.p.length/3),1));g.setAttribute('aSiteSnow',new THREE.Float32BufferAttribute(this.snow,1));g.setIndex(this.i);g.computeVertexNormals();g.computeBoundingSphere();return g;}
}
function blade(buffer,base,direction,height,width,lean,color,root,phase=0,steps=5){
 const side=new THREE.Vector3(-direction.z,0,direction.x),rows=[];
 for(let j=0;j<=steps;j++){
  const t=j/steps,center=base.clone().addScaledVector(UP,height*(t-.14*t*t)).addScaledVector(direction,lean*t*t),w=width*Math.pow(Math.max(0,Math.sin(Math.PI*(.08+t*.92))),.8);
  const row=[];for(let k=0;k<3;k++){const p=center.clone().addScaledVector(side,(k-1)*w);if(k===1)p.addScaledVector(direction,-width*.18*Math.sin(t*Math.PI));row.push(buffer.vertex(p,color,root,1,(.73+.27*t)*(k===1?1.06:1)));}rows.push(row);
 }
 for(let j=0;j<steps;j++)for(let k=0;k<2;k++){const a=rows[j][k],b=rows[j+1][k],c=rows[j][k+1],d=rows[j+1][k+1];buffer.i.push(a,b,c,c,b,d);}
}

function fernAxis(buffer,base,direction,height,color,root){
 const side=new THREE.Vector3(-direction.z,0,direction.x),rings=[];
 for(let j=0;j<=4;j++){
  const t=j/4,p=base.clone().addScaledVector(direction,height*t*.8).addScaledVector(UP,height*Math.sin(t*1.8)*.6),ring=[];
  for(let k=0;k<3;k++){const a=k*TAU/3,r=.00085*(1-t*.6);ring.push(buffer.vertex(p.clone().addScaledVector(side,Math.cos(a)*r).addScaledVector(UP,Math.sin(a)*r),color,root,1,.78+t*.16));}rings.push(ring);
 }
 for(let j=0;j<4;j++)for(let k=0;k<3;k++){const a=rings[j][k],b=rings[j][(k+1)%3],c=rings[j+1][k],d=rings[j+1][(k+1)%3];buffer.i.push(a,c,b,b,c,d);}
}

function siteMaterial(uniforms,depth=false,wetland=false){
 const m=depth?new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}):new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.91,side:THREE.DoubleSide});
 m.onBeforeCompile=s=>{Object.assign(s.uniforms,uniforms);s.vertexShader=`uniform float uSiteTime,uSiteWind,uSiteSnow,uSiteWet;uniform vec2 uSiteDirection;uniform sampler2D uSiteWindField,uSiteField;uniform float uSiteHasField;uniform vec4 uSiteBounds;attribute vec4 aSiteRoot;attribute float aSiteSnow,aSiteKind;varying float vSiteTip,vSiteSnow,vSiteKind;varying vec3 vSiteWorldNormal;varying vec2 vSiteWetSnow;\n`+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   vec2 siteUV=clamp((aSiteRoot.xz-uSiteBounds.xy)/uSiteBounds.zw,vec2(0.),vec2(1.));
   vec2 siteWind=mix(uSiteDirection*uSiteWind,texture2D(uSiteWindField,siteUV).rg,uSiteHasField);
   float tip=clamp((position.y-aSiteRoot.y)/max(.006,aSiteRoot.w),0.,1.2);
   float wave=.55+.28*sin(uSiteTime*1.6+aSiteRoot.x*1.3+aSiteRoot.z*.8);
   transformed.xz+=siteWind*tip*tip*aSiteRoot.w*.25*wave;
   transformed.y-=dot(siteWind,siteWind)*tip*tip*aSiteRoot.w*.016;
   vSiteTip=tip;vSiteSnow=aSiteSnow;vSiteKind=aSiteKind;vSiteWorldNormal=normalize(mat3(modelMatrix)*normal);vSiteWetSnow=mix(vec2(uSiteWet,uSiteSnow),texture2D(uSiteField,siteUV).rg,uSiteHasField);
  `);
  if(!depth){s.fragmentShader='uniform float uSiteSeason,uSiteDay;uniform vec3 uSiteSunDirection;varying float vSiteTip,vSiteSnow,vSiteKind;varying vec3 vSiteWorldNormal;varying vec2 vSiteWetSnow;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float dry=smoothstep(1.2,2.7,uSiteSeason)*(1.-smoothstep(3.55,4.,uSiteSeason));
   diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.19,.96,.64)+vec3(.016,.008,0.),dry*.55);
   diffuseColor.rgb*=1.-clamp(vSiteWetSnow.x,0.,1.)*.16;
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.85,.90,.91),clamp(vSiteWetSnow.y,0.,1.)*vSiteSnow*.80);
  `);
  if(wetland){
   s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    if(vSiteKind<1.5){vec3 leafVolumeNormal=normalize(vSiteWorldNormal);normal=normalize((viewMatrix*vec4(leafVolumeNormal,0.)).xyz);}
   `);
   s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
    if(vSiteKind<1.5){vec3 thinFacing=normalize(vec3(vSiteWorldNormal.x,.08,vSiteWorldNormal.z));float backlight=max(0.,dot(-thinFacing,normalize(uSiteSunDirection)));reflectedLight.indirectDiffuse+=diffuseColor.rgb*backlight*.045*pow(clamp(vSiteTip,0.,1.),.7)*uSiteDay;}
   `);
  }}
 };m.customProgramCacheKey=()=>`independent-stream-and-cliff-plants-v2-${depth}-${wetland}`;return m;
}

export function createStreamsideVegetation({terrain,habitat,field=null,seed=42}={}){
 const mountainR=seededRandom(seed^0x3ad71c9),group=new THREE.Group();group.name='Mixed creek and inlet wetland plants with sheltered mountain crevices';
 const cliff=new Forms(),sampleSurface=createVegetationSurfaceSampler(terrain),mountainRoots=[],leafRoots=[];
 const wetland=createWetlandPlants({terrain,habitat,sampleSurface,seed}),bankRoots=wetland.clumps.filter(p=>p.zone==='creek').map(p=>({...p,halfWidth:terrain.river.sample(p.z).width,centreX:terrain.river.sample(p.z).x})),lakeRoots=wetland.clumps.filter(p=>p.zone==='lake');
 const statistics={seed,bankClumps:0,bankLeaves:0,mountainPatches:0,mossCushions:0,shortTufts:0,creviceFerns:0,cliffLeaves:0,triangles:0,drawCalls:0,maxBankHeight:0,maxMountainHeight:0,surfaceOwners:{},scaleReference:{doorHeight:.367,wallHeight:.49},habitat:'margins beside attached reaches; no free fall, deep scour pool or channel centre'};
 const colour=new THREE.Color(),rootColour=new THREE.Color(0x507b3f),tipColour=new THREE.Color(0x82a14e);
 statistics.bankClumps=wetland.stats.creekClumps;statistics.lakeClumps=wetland.stats.lakeClumps;statistics.bankLeaves=wetland.stats.leaves;statistics.wetland=wetland.stats;statistics.maxBankHeight=Math.max(wetland.stats.maxLeafHeight,wetland.stats.maxSpikeHeight);

 const mountainSites=[];
 for(let z=-4.96;z<-.66;z+=.127)for(let x=-5.72;x<5.72;x+=.127){
  const px=x+(mountainR()-.5)*.10,pz=z+(mountainR()-.5)*.10;if(!habitat.allowed(px,pz,.018))continue;
  const f=terrain.sample(px,pz),h=habitat.sample(px,pz);if(f.height<1.16||f.height>3.64||h.treeDistance<.14||h.path>.01||h.rock>.04)continue;
  const joint=Math.max(f.fragmentJoint,f.crestJoint*.8),shelter=h.patch*.65+joint*.35;
  // Exposed walls stay open; small joints can support cushions even when the
  // surrounding slope is steep. Gentle soil shelves permit taller short tufts.
  if(shelter<.44||h.slope<.37&&joint<.60)continue;
  const p=sampleSurface(px,pz);if(p.normal.y<.24||Math.abs(p.y-f.height)>.38)continue;
  mountainSites.push({x:px,z:pz,p,f,h,joint,shelter,rank:mountainR()*.55+shelter*.45});
 }
 mountainSites.sort((a,b)=>b.rank-a.rank);
 for(const site of mountainSites){
  if(mountainRoots.length>=210)break;
  if(mountainRoots.some(p=>Math.hypot(p.x-site.x,p.z-site.z)<.19))continue;
  const kind=site.p.normal.y>.65&&site.h.patch>.53?1:site.joint>.50&&site.p.normal.y>.42&&site.f.height<2.8?2:0;
  const height=kind===0?.018+mountainR()*.016:kind===1?.035+mountainR()*.045:.043+mountainR()*.040;
  const radius=kind===0?.055+mountainR()*.050:.043+mountainR()*.035,base=new THREE.Vector3(site.x,site.p.y-.0015,site.z),root=[site.x,base.y,site.z,height];
  const plants=kind===0?14:kind===1?10:6,yaw=mountainR()*TAU;
  let placed=0;
  for(let j=0;j<plants;j++){
   const angle=yaw+j*2.399,d=Math.sqrt(mountainR())*radius,px=site.x+Math.cos(angle)*d,pz=site.z+Math.sin(angle)*d;
   if(!habitat.allowed(px,pz,.008))continue;
   const f=terrain.sample(px,pz),point=sampleSurface(px,pz);if(point.normal.y<.22||Math.abs(point.y-site.p.y)>.095||Math.abs(point.y-f.height)>.38)continue;
   const local=new THREE.Vector3(px,point.y-.0015,pz),localRoot=[px,local.y,pz,height],dir=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
   colour.set(kind===0?0x557a3d:kind===1?0x718b45:0x477448).lerp(tipColour,mountainR()*.27);
   if(kind===0){
    for(let k=0;k<3;k++){const a=angle+k*TAU/3,v=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),h=height*(.65+mountainR()*.35);blade(cliff,local,v,h,.005+mountainR()*.003,h*.65,colour,localRoot,0,3);statistics.cliffLeaves++;}
   }else if(kind===1){blade(cliff,local,dir,height*(.65+mountainR()*.35),.0019+mountainR()*.0012,height*.34,colour,localRoot,0,4);statistics.cliffLeaves++;}
   else{
    fernAxis(cliff,local,dir,height,colour,localRoot);
    const side=new THREE.Vector3(-dir.z,0,dir.x);
    for(let k=0;k<5;k++)for(const sign of [-1,1]){const t=.18+k*.15,p=local.clone().addScaledVector(dir,height*t*.8).addScaledVector(UP,height*Math.sin(t*1.8)*.6),direction=side.clone().multiplyScalar(sign).addScaledVector(dir,.28).normalize();blade(cliff,p,direction,height*.14,.0018,height*.20*(1-t*.7),colour,localRoot,0,2);statistics.cliffLeaves++;}
   }
   placed++;leafRoots.push({x:px,z:pz,y:local.y,owner:point.owner});
  }
  if(!placed)continue;mountainRoots.push({x:site.x,z:site.z,y:base.y,height,radius,kind,plants:placed,normalY:site.p.normal.y,joint:site.joint,owner:site.p.owner});statistics.mountainPatches++;statistics[['mossCushions','shortTufts','creviceFerns'][kind]]++;statistics.maxMountainHeight=Math.max(statistics.maxMountainHeight,height);
 }
 const zero=new THREE.DataTexture(new Float32Array([0,0,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType);zero.needsUpdate=true;
 const bounds=field?.bounds||{minX:-6,minZ:-5.3,sizeX:12,sizeZ:9.6};
 const uniforms={uSiteTime:{value:0},uSiteWind:{value:.13},uSiteSnow:{value:0},uSiteWet:{value:0},uSiteSeason:{value:0},uSiteDay:{value:1},uSiteSunDirection:{value:new THREE.Vector3(-.6,.9,.4).normalize()},uSiteDirection:{value:new THREE.Vector2(.85,.25).normalize()},uSiteWindField:{value:field?.windTexture||zero},uSiteField:{value:field?.texture||zero},uSiteHasField:{value:field?.texture&&field?.windTexture?1:0},uSiteBounds:{value:new THREE.Vector4(bounds.minX,bounds.minZ,bounds.sizeX,bounds.sizeZ)}};
 const geometries=[],materials=[];
 for(const [g,name,isWetland]of [[wetland.geometry,'Mixed low mats, folded sedges, round rushes and small brown cattails',true],[cliff.geometry(),'Sheltered rock-joint cushions, short tufts and tiny ferns',false]]){
  if(!g.index?.count){g.dispose();continue;}const m=siteMaterial(uniforms,false,isWetland),depth=siteMaterial(uniforms,true,isWetland),mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.customDepthMaterial=depth;mesh.frustumCulled=false;group.add(mesh);geometries.push(g);materials.push(m,depth);statistics.triangles+=g.index.count/3;statistics.drawCalls++;
 }
 for(const p of [...bankRoots,...lakeRoots,...mountainRoots])statistics.surfaceOwners[p.owner]=(statistics.surfaceOwners[p.owner]||0)+1;
 group.userData.sites={bankRoots,lakeRoots,wetlandRoots:wetland.shootRoots,mountainRoots,leafRoots,scaleReference:statistics.scaleReference};
 let disposed=false;
 return {group,stats:statistics,sampleSurface,update(time,state={}){if(disposed)return;uniforms.uSiteTime.value=state.time??time;uniforms.uSiteWind.value=state.windStrength??.13;uniforms.uSiteSnow.value=state.snow??0;uniforms.uSiteWet.value=state.wetness??0;uniforms.uSiteSeason.value=state.season??0;uniforms.uSiteDay.value=clamp(state.daylight??1,0,1);if(state.sunDirection)uniforms.uSiteSunDirection.value.copy(state.sunDirection).normalize();if(state.wind)uniforms.uSiteDirection.value.set(state.wind.x??state.wind[0]??.85,state.wind.y??state.wind.z??state.wind[1]??.25);},dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();zero.dispose();}};
}
