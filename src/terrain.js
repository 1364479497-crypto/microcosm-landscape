import * as THREE from 'three';
import {createLandformField,seededRandom,TERRAIN_BOUNDS,LAKE_SPEC,RIVER_NODES} from './terrain-field.js';
import {createLandMaterials} from './terrain-materials.js';
import {sampleSoilSection,SOIL_SECTION_SPEC} from './soil-section.js';
import {createCutawayRoots} from './cutaway-roots.js';

const ROOT_UP=new THREE.Vector3(0,1,0);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function terrainSurface(field,nx,nz) {
  const positions=new Float32Array((nx+1)*(nz+1)*3);
  const uv=new Float32Array((nx+1)*(nz+1)*2);
  const waterway=new Float32Array((nx+1)*(nz+1));
  const wetland=new Float32Array((nx+1)*(nz+1)*2);
  const rockStructure=new Float32Array((nx+1)*(nz+1)*3);
  const indices=new Uint32Array(nx*nz*6);
  let p=0,t=0;
  for(let j=0;j<=nz;j++){
    const z=-5.3+9.6*j/nz;
    for(let i=0;i<=nx;i++){
      const x=-6+12*i/nx;
      const semantic=field.fields(x,z);
      const semanticIndex=(j*(nx+1)+i)*3;
      const wetIndex=(j*(nx+1)+i)*2;wetland[wetIndex]=semantic.wetlandSoil||0;wetland[wetIndex+1]=semantic.wetlandLift||0;
      rockStructure[semanticIndex]=semantic.fragmentJoint;
      rockStructure[semanticIndex+1]=semantic.fragmentTone;
      rockStructure[semanticIndex+2]=semantic.fragmentSpall;
      waterway[j*(nx+1)+i]=(z>-3.64&&z<1.9)?1-THREE.MathUtils.smoothstep(semantic.riverDistance,semantic.riverWidth*.65,semantic.riverWidth*1.42):0;
      positions[p++]=x;positions[p++]=semantic.bedHeight??semantic.height;positions[p++]=z;
      uv[t++]=i/nx;uv[t++]=j/nz;
    }
  }
  let n=0;
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
    const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
    indices[n++]=a;indices[n++]=c;indices[n++]=b;
    indices[n++]=b;indices[n++]=c;indices[n++]=d;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geometry.setAttribute('landWaterway',new THREE.BufferAttribute(waterway,1));
  geometry.setAttribute('landRockStructure',new THREE.BufferAttribute(rockStructure,3));geometry.setAttribute('landWetland',new THREE.BufferAttribute(wetland,2));
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

function terrainSections(field,nx,nz) {
  // These edge directions are intentional: tangent × down points outward.
  const edges=[
    {a:[6,4.3],b:[-6,4.3],n:nx},
    {a:[6,-5.3],b:[6,4.3],n:nz},
    {a:[-6,-5.3],b:[6,-5.3],n:nx},
    {a:[-6,4.3],b:[-6,-5.3],n:nz},
  ];
  const positions=[],uv=[],tops=[],indices=[];
  const rows=12;
  for(const edge of edges){
    const start=positions.length/3;
    const length=Math.hypot(edge.b[0]-edge.a[0],edge.b[1]-edge.a[1]);
    for(let j=0;j<=rows;j++)for(let i=0;i<=edge.n;i++){
      const t=i/edge.n,x=edge.a[0]+(edge.b[0]-edge.a[0])*t,z=edge.a[1]+(edge.b[1]-edge.a[1])*t;
      const h=field.height(x,z),y=h+(-1.5-h)*(j/rows);
      positions.push(x,y,z);uv.push(t*length,h-y);tops.push(h);
    }
    for(let j=0;j<rows;j++)for(let i=0;i<edge.n;i++){
      const a=start+j*(edge.n+1)+i,b=a+1,c=a+edge.n+1,d=c+1;
      indices.push(a,b,c,b,d,c);
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geo.setAttribute('sectionTop',new THREE.Float32BufferAttribute(tops,1));
  geo.setIndex(indices);geo.computeVertexNormals();geo.computeBoundingSphere();
  return geo;
}

function pebbleGeometry() {
  const geo=new THREE.IcosahedronGeometry(1,1);
  const p=geo.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const rough=1+.075*Math.sin(x*9.7+y*5.1)*Math.cos(z*7.7-x*2.9)+.045*Math.sin(y*13.4+z*8.1);
    p.setXYZ(i,x*rough,y*rough,z*rough);
  }
  // Keep the generator's radial normals: recomputing normals on its purposely
  // unindexed triangle soup would turn every small pebble into a flat facet.
  p.needsUpdate=true;return geo;
}

// Keep the historical stream consumed by exposed gravel independent from all
// later rooted plants, boulder contacts and mountain fragments. The replacement
// uses its own seed; this small compatibility walk allocates no old mesh.
function retainSectionRandomState(field,random,quality){
  const budget=quality==='high'?2700:quality==='medium'?1600:850;let used=0;
  for(let k=0;k<budget*2&&used<budget;k++){
    const side=k%10<6?0:k%10<8?1:2,u=random(),along=side===0?-6+12*u:-5.3+9.6*u,radius=.012+Math.pow(random(),2.1)*.054;
    const shift=(field.noise(along*.68,3.7)-.5)*.12+.038*Math.sin(along*1.17+1.3);
    let y=-.91+random()*.37+shift;if(random()<.08)y+=.30;
    const outward=-radius*.52+.001,x=side===0?along:side===1?6+outward:-6-outward,z=side===0?4.3+outward:along;
    if(y+radius>field.height(x,z)-.035)continue;
    // Euler, three axis scales, mineral tint and the sparse pale-grain choice.
    for(let j=0;j<11;j++)random();used++;
  }
}
function sectionGravel(group,field,materials,random,quality,seed) {
  retainSectionRandomState(field,random,quality);
  const r=seededRandom(seed^0x39ab817),budget=quality==='high'?6500:quality==='medium'?4100:2300;
  const fineGeo=new THREE.IcosahedronGeometry(1,0),coarseGeo=pebbleGeometry();
  const chipGeo=new THREE.IcosahedronGeometry(1,0),chipPos=chipGeo.attributes.position;
  for(let i=0;i<chipPos.count;i++){
    const x=chipPos.getX(i),y=chipPos.getY(i),z=chipPos.getZ(i);
    const edge=1+.16*Math.sin(x*7.1+y*4.3-z*5.7);
    chipPos.setXYZ(i,(x*edge+.10*y)*1.22,y*(.72+.14*x),z*(.82+.11*y));
  }
  chipPos.needsUpdate=true;chipGeo.computeVertexNormals();
  const fine=new THREE.InstancedMesh(fineGeo,materials.gravel,budget),coarse=new THREE.InstancedMesh(coarseGeo,materials.gravel,budget),chips=new THREE.InstancedMesh(chipGeo,materials.gravel,Math.ceil(budget*.42));
  fine.name='Fine embedded mineral grit in graded alluvial lenses';
  coarse.name='Sparse partly buried rounded and flat section gravel';
  chips.name='Angular and platy fragments in broken alluvial lenses';
  const meshes=[fine,coarse,chips],dummy=new THREE.Object3D(),color=new THREE.Color(),radii=[],records=[],counts=[0,0,0],classes=[0,0,0,0],forms=[0,0,0];
  const stainColor=new THREE.Color(.233,.164,.094);
  const palette=[
    [.340,.305,.246], // warm limestone
    [.235,.244,.224], // grey green weathered stone
    [.346,.244,.130], // ochre sandstone
    [.270,.158,.101], // iron stained brown red
    [.158,.174,.183], // sparse cool slate
    [.435,.405,.342], // occasional pale quartz-rich grain
  ];
  const minerals=new Array(palette.length).fill(0);
  // Rejection samples geological deposits, giving long dense pockets, pinches,
  // quiet gaps and a few spill grains. Density/width/sorting vary independently;
  // the whole deposit still occupies a continuous stratigraphic interval.
  for(let k=0;k<budget*10&&counts.reduce((a,b)=>a+b,0)<budget;k++){
    const u=r(),side=r()<.44?0:1+Math.floor(r()*3),along=side===0||side===3?-6+12*u:-5.3+9.6*u;
    const x=side===0||side===3?along:side===1?6:-6,z=side===0?4.3:side===3?-5.3:along;
    const lens=sampleSoilSection(x,z),stray=r()<.04;
    if(!stray&&r()>lens.continuity*(.38+.62*lens.fullness))continue;
    const sizeChoice=clamp(r()+.13*(lens.sorting-.5),0,.9999);
    const sizeClass=sizeChoice<.35?0:sizeChoice<.76?1:sizeChoice<.95?2:3;
    const radius=sizeClass===0?.006+Math.pow(r(),1.2)*.012:sizeClass===1?.020+Math.pow(r(),1.3)*.024:sizeClass===2?.046+Math.pow(r(),1.1)*.038:.074+r()*.036;
    const shoulder=r()<.23;
    let offset=stray?(r()-.5)*.92:(r()+r()-1)*lens.halfWidth*1.16+lens.skew*lens.halfWidth*.31;
    if(!stray&&shoulder)offset=(lens.skew<0?-1:1)*lens.halfWidth*.66+(r()-.5)*lens.halfWidth*.48;
    const y=lens.center+offset,depth=field.height(x,z)-y;
    if(y-radius<SOIL_SECTION_SPEC.bottom+.012||depth<.08+radius)continue;
    const platy=sizeClass===3||r()<.15,angular=!platy&&(sizeClass===0||r()<.19);
    const slot=platy||angular&&sizeClass>0?2:sizeClass===0?0:1,target=meshes[slot];
    if(counts[slot]>=target.count)continue;
    const embed=.34+r()*.52,normalOffset=-radius*embed+.0012;
    dummy.position.set(x+(side===1?normalOffset:side===2?-normalOffset:0),y,z+(side===0?normalOffset:side===3?-normalOffset:0));
    // Deposition favours a loose horizontal long axis, with angular exceptions.
    dummy.rotation.set((r()-.5)*(platy?.55:1.15),r()*Math.PI*2,(r()-.5)*(platy?.60:1.45));
    const flatten=platy?.22+r()*.25:.49+r()*.44,stretch=platy?1.12+r()*.54:.76+r()*.64;
    dummy.scale.set(radius*stretch,radius*flatten,radius*(.60+r()*.64));dummy.updateMatrix();target.setMatrixAt(counts[slot],dummy.matrix);
    // Distinct related mineral families plus mottled sediment staining. Rare
    // pale grains punctuate the band without making every stone a white bead.
    const mineralChoice=r(),mineral=mineralChoice<.27?0:mineralChoice<.49?1:mineralChoice<.70?2:mineralChoice<.86?3:mineralChoice<.95?4:5;
    const tint=palette[mineral],tone=.83+r()*.32;
    color.setRGB(tint[0]*tone,tint[1]*tone,tint[2]*tone);
    if(r()<.30)color.lerp(stainColor,.16+r()*.21);
    target.setColorAt(counts[slot],color);counts[slot]++;classes[sizeClass]++;forms[platy?2:angular?1:0]++;minerals[mineral]++;radii.push(radius);
    records.push({side,x,y,z,radius,depth,lens:!stray,embed,sizeClass,form:platy?'platy':angular?'angular':'rounded',mineral,layerWidth:lens.halfWidth,depositDensity:lens.continuity});
  }
  for(const [i,mesh] of meshes.entries()){
    mesh.count=counts[i];mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.castShadow=false;mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);
  }
  group.userData.soilSection={spec:SOIL_SECTION_SPEC,seed,counts,classes,forms,minerals,radii,records,owner:'world XZ shared soilSectionLens / sampleSoilSection'};
  return {mesh:fine,count:counts.reduce((a,b)=>a+b,0),classes};
}

function sectionRoots(group,field,materials,random,quality) {
  const positions=[],indices=[];
  const radial=3;
  const tube=(points,radius)=>{
    const start=positions.length/3;
    for(let j=0;j<points.length;j++){
      const p=points[j],prev=points[Math.max(0,j-1)],next=points[Math.min(points.length-1,j+1)];
      const tangent=new THREE.Vector3().subVectors(next,prev).normalize();
      const cross=new THREE.Vector3().crossVectors(tangent,new THREE.Vector3(0,0,1));
      if(cross.lengthSq()<.01)cross.crossVectors(tangent,new THREE.Vector3(1,0,0));
      cross.normalize();
      const bitangent=new THREE.Vector3().crossVectors(tangent,cross).normalize();
      const r=radius*Math.pow(1-j/(points.length-.35),.74);
      for(let i=0;i<radial;i++){
        const a=i/radial*Math.PI*2;
        positions.push(p.x+r*(cross.x*Math.cos(a)+bitangent.x*Math.sin(a)),p.y+r*(cross.y*Math.cos(a)+bitangent.y*Math.sin(a)),p.z+r*(cross.z*Math.cos(a)+bitangent.z*Math.sin(a)));
      }
    }
    for(let j=0;j<points.length-1;j++)for(let i=0;i<radial;i++){
      const a=start+j*radial+i,b=start+j*radial+(i+1)%radial,c=a+radial,d=b+radial;
      indices.push(a,c,b,b,c,d);
    }
  };
  let count=0;
  const attempts=quality==='high'?1050:quality==='medium'?650:360;
  for(let k=0;k<attempts;k++){
    const side=k%5<3?0:k%5===3?1:2;
    const along=side===0?-6+12*random():-5.3+9.6*random();
    const x=side===0?along:side===1?6.006:-6.006;
    const z=side===0?4.306:along;
    const top=field.height(x,z);
    if(top<.23||top>1.25)continue;
    const length=.065+Math.pow(random(),1.5)*.43;
    const offset=(random()-.5)*.11;
    const points=[];
    for(let j=0;j<6;j++){
      const t=j/5,drift=Math.sin(t*2.7+k)*.012+offset*t*t;
      points.push(new THREE.Vector3(x+(side===0?drift:0),top-.008-length*t,z+(side!==0?drift:0)));
    }
    const radius=.0019+random()*.0024;
    tube(points,radius);count++;
    if(random()<.31){
      const base=points[2],sign=random()<.5?-1:1;
      const tip=new THREE.Vector3(base.x+(side===0?sign*.045:0),base.y-length*.35,base.z+(side!==0?sign*.045:0));
      tube([base,base.clone().lerp(tip,.5),tip],radius*.56);count++;
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,materials.roots);mesh.name='Fine organic roots exposed by the section';
  mesh.castShadow=false;mesh.receiveShadow=true;group.add(mesh);
  return {mesh,count};
}

function boulderField(group,field,materials,random,quality) {
  const target=quality==='high'?115:quality==='medium'?76:42;
  const geo=new THREE.IcosahedronGeometry(1,2);
  const p=geo.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const n=Math.sin(x*5.3+y*2.1+z*3.6)*Math.cos(z*6.1-y*4.7);
    const k=1+n*.13+.07*Math.sin(x*11.7+z*8.1);
    p.setXYZ(i,x*k,y*k,z*k);
  }
  p.needsUpdate=true;
  const mesh=new THREE.InstancedMesh(geo,materials.rock,target);
  mesh.name='Irregular partly buried talus and shoreline boulders';
  const dummy=new THREE.Object3D(),q=new THREE.Quaternion(),color=new THREE.Color();
  let used=0;
  for(let k=0;k<target*35&&used<target;k++){
    let x=-5.7+random()*11.4,z=-3.8+random()*7.8;
    const cabinClear=x>-3.55&&x<-1.73&&z>-1.05&&z<.76;
    const landingClear=x>-1.55&&x<.10&&z>1.72&&z<2.83;
    if(cabinClear||landingClear)continue;
    const f=field.fields(x,z),n=field.normal(x,z);
    if(f.height<.24||f.height>2.75||f.shore<.045||f.riverDistance<f.riverWidth+.24||n.y<.51)continue;
    const size=.055+Math.pow(random(),2.4)*.27;
    // The large stones settle near the basin rim; very small stones can sit on
    // steeper foothills, preserving the miniature scale hierarchy.
    if(f.height>1.4&&size>.23)continue;
    q.setFromUnitVectors(ROOT_UP,n);
    dummy.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(ROOT_UP,random()*Math.PI*2));
    dummy.position.set(x,f.height-size*.20,z);
    dummy.scale.set(size*(1.0+random()*.55),size*(.65+random()*.60),size*(.75+random()*.55));
    dummy.updateMatrix();mesh.setMatrixAt(used,dummy.matrix);
    const tone=.83+random()*.24;color.setRGB(tone,tone*(.96+random()*.06),tone*(.92+random()*.08));
    mesh.setColorAt(used,color);used++;
  }
  mesh.count=used;mesh.instanceMatrix.needsUpdate=true;
  if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);
  return {mesh,count:used};
}

function channelRocks(group,field,materials) {
  // Radial outlines are irregular in the shared field, so this broad patch
  // samples the analytic cap directly and buries its outer ring in the bed.
  const groupRocks=new THREE.Group();groupRocks.name='Eight embedded eroded waterway rocks';
  let visible=0;
  for(const rock of field.obstacles){
    const sectors=32,rings=9,radius=Math.max(rock.rx,rock.rz)*1.145;
    const positions=[],uv=[],indices=[];
    const vertex=(x,z)=>{
      const cap=rock.heightAt(x,z);
      // Underlying ground hides the low rim. The +1 mm skin avoids coincident
      // rasterisation while the collision/query surface retains the same cap.
      const y=Number.isFinite(cap)?cap+.001:rock.base-.012;
      positions.push(x,y,z);uv.push((x-rock.x)/radius*.5+.5,(z-rock.z)/radius*.5+.5);
    };
    vertex(rock.x,rock.z);
    for(let ring=1;ring<=rings;ring++)for(let i=0;i<sectors;i++){
      const theta=i/sectors*Math.PI*2,r=radius*ring/rings;
      vertex(rock.x+Math.cos(theta)*r,rock.z+Math.sin(theta)*r);
    }
    for(let i=0;i<sectors;i++)indices.push(0,1+(i+1)%sectors,1+i);
    for(let ring=1;ring<rings;ring++)for(let i=0;i<sectors;i++){
      const a=1+(ring-1)*sectors+i,b=1+(ring-1)*sectors+(i+1)%sectors,c=a+sectors,d=b+sectors;
      indices.push(a,b,c,b,d,c);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setAttribute('landWaterway',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3),1));
    geometry.setAttribute('landRockStructure',new THREE.Float32BufferAttribute(new Float32Array(positions.length),3));
    geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,materials.rock);
    mesh.name=`Water-worn embedded ${rock.id}`;mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.userData.heightOwner='terrain-field.obstacles.heightAt';groupRocks.add(mesh);
    if(rock.heightAt(rock.x,rock.z)>=field.fields(rock.x,rock.z).bedHeight)visible++;
  }
  group.add(groupRocks);
  return {count:field.obstacles.length,visible};
}

function brokenPlateGeometry() {
  // A shallow asymmetric slab has a broad fractured face and a buried back.
  // Independent face vertices preserve the chipped edges under grazing light.
  const outline=[[-.76,-.71],[-.15,-1.00],[.64,-.77],[1.00,-.23],[.83,.65],[.13,.98],[-.68,.80],[-1.00,.10]];
  const back=outline.map(([x,y],i)=>new THREE.Vector3(x,y,-.61+.025*Math.sin(i*2.1)));
  const face=outline.map(([x,y],i)=>new THREE.Vector3(x*.82+.035,y*.82-.02,.46+x*.08+y*.05+.035*Math.sin(i*2.7)));
  const center=new THREE.Vector3(.035,.015,.61),backCenter=new THREE.Vector3(0,0,-.61);
  const positions=[],normals=[];
  const emit=(a,b,c)=>{
    const n=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
    for(const p of [a,b,c]){positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);}
  };
  for(let i=0;i<outline.length;i++){
    const j=(i+1)%outline.length;
    emit(center,face[i],face[j]);emit(backCenter,back[j],back[i]);
    emit(back[i],back[j],face[i]);emit(back[j],face[j],face[i]);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geo.setAttribute('landWaterway',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3),1));
  geo.setAttribute('landRockStructure',new THREE.Float32BufferAttribute(new Float32Array(positions.length),3));
  geo.computeBoundingSphere();return geo;
}

function fracturedOutcrops(group,field,materials,random,quality) {
  const plateBudget=quality==='high'?185:quality==='medium'?120:68;
  const talusBudget=quality==='high'?240:quality==='medium'?150:85;
  const geo=brokenPlateGeometry();
  const plates=new THREE.InstancedMesh(geo,materials.rock,plateBudget);
  plates.name='Embedded chipped limestone plates interrupting the bed faces';
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  const basis=new THREE.Matrix4(),up=new THREE.Vector3(),right=new THREE.Vector3();
  const occupied=[];
  let used=0;
  for(let k=0;k<plateBudget*45&&used<plateBudget;k++){
    const x=-5.65+random()*11.30,z=-4.88+random()*4.15;
    const f=field.fields(x,z),n=field.normal(x,z);
    if(f.height<1.10||f.height>3.44||n.y<.12||n.y>.82||f.riverDistance<f.riverWidth+.28||f.shore<.12)continue;
    if(random()>.40+f.fragmentJoint*.44+f.fragmentSpall*.18)continue;
    const point=new THREE.Vector3(x,f.height,z);
    if(occupied.some(p=>p.distanceToSquared(point)<.045))continue;
    occupied.push(point);
    up.copy(ROOT_UP).addScaledVector(n,-n.y).normalize();
    right.crossVectors(up,n).normalize();
    basis.makeBasis(right,up,n);
    dummy.quaternion.setFromRotationMatrix(basis);
    dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),(random()-.5)*.52));
    dummy.position.copy(point).addScaledVector(n,-.035);
    dummy.scale.set(.15+random()*.29,.105+random()*.16,.11+random()*.13);
    dummy.updateMatrix();plates.setMatrixAt(used,dummy.matrix);
    const tone=.79+random()*.22;color.setRGB(tone,tone*(.99+random()*.035),tone*(.96+random()*.045));
    plates.setColorAt(used,color);used++;
  }
  plates.count=used;plates.instanceMatrix.needsUpdate=true;
  if(plates.instanceColor)plates.instanceColor.needsUpdate=true;
  plates.castShadow=true;plates.receiveShadow=true;plates.computeBoundingSphere();group.add(plates);

  const talus=new THREE.InstancedMesh(geo,materials.rock,talusBudget);
  talus.name='Loose angular scree concentrated below exposed mountain faces';
  let chips=0;
  for(let k=0;k<talusBudget*42&&chips<talusBudget;k++){
    const x=-5.58+random()*11.16,z=-2.72+random()*2.97;
    const cabinClear=x>-3.58&&x<-1.70&&z>-1.08&&z<.80;
    if(cabinClear)continue;
    const f=field.fields(x,z),n=field.normal(x,z);
    if(f.height<.57||f.height>1.64||f.ridge<.20||n.y<.39||f.riverDistance<f.riverWidth+.31||f.shore<.12)continue;
    const size=.035+Math.pow(random(),1.6)*.098;
    dummy.position.set(x,f.height-size*.19,z);
    dummy.rotation.set(random()*Math.PI,random()*Math.PI,random()*Math.PI);
    dummy.scale.set(size*(1.05+random()*.70),size*(.55+random()*.50),size*(.67+random()*.60));
    dummy.updateMatrix();talus.setMatrixAt(chips,dummy.matrix);
    const tone=.78+random()*.27;color.setRGB(tone,tone*(.97+random()*.06),tone*(.91+random()*.08));
    talus.setColorAt(chips,color);chips++;
  }
  talus.count=chips;talus.instanceMatrix.needsUpdate=true;
  if(talus.instanceColor)talus.instanceColor.needsUpdate=true;
  talus.castShadow=true;talus.receiveShadow=true;talus.computeBoundingSphere();group.add(talus);
  return {plates:used,talus:chips};
}

function alluvialGravel(group,field,materials,seed,quality){
  const r=seededRandom(seed^0x42b91d7),target=quality==='high'?310:180,g=new THREE.IcosahedronGeometry(1,0),mesh=new THREE.InstancedMesh(g,materials.rock,target),dummy=new THREE.Object3D(),colour=new THREE.Color();
  mesh.name='Small partly buried alluvial gravel on wetland tongues';let used=0;
  for(let attempt=0;used<target&&attempt<24000;attempt++){
    const creek=r()<.48,z=creek?-2.5+r()*4.05:.8+r()*3.2,reach=field.riverAt(z),x=creek?reach.x+(r()<.5?-1:1)*reach.width*(.76+r()*.55):-1.05+r()*5.1,f=field.fields(x,z),stage=creek?reach.y:.18;
    if(f.wetlandSoil<.24||f.height<stage-.026||f.height>stage+.06||f.obstacle>.01||field.normal(x,z).y<.60)continue;
    const size=.006+r()*.011;
    dummy.position.set(x,f.height+size*.14,z);dummy.rotation.set(r()*.9,r()*Math.PI*2,r()*.7);dummy.scale.set(size*(1+r()*.5),size*(.35+r()*.35),size*(.7+r()*.5));dummy.updateMatrix();mesh.setMatrixAt(used,dummy.matrix);
    const t=.90+r()*.22;colour.setRGB(t,t*(.97+r()*.06),t*(.91+r()*.08));mesh.setColorAt(used,colour);used++;
  }
  mesh.count=used;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.receiveShadow=true;mesh.castShadow=false;mesh.computeBoundingSphere();group.add(mesh);return used;
}

export function createTerrain(scene,{seed=42,quality='high',field:sharedField}={}) {
  const field=createLandformField(seed),random=seededRandom(seed+431);
  const group=new THREE.Group();group.name='Independent continuous mountain and meadow terrain';
  const materials=createLandMaterials(sharedField);
  const [nx,nz]=quality==='high'?[272,222]:quality==='medium'?[208,172]:[144,120];
  const surface=new THREE.Mesh(terrainSurface(field,nx,nz),materials.ground);
  surface.name='Continuous crests, eroded cliff shoulders, meadow, and lake bowl';
  surface.castShadow=true;surface.receiveShadow=true;group.add(surface);
  const section=new THREE.Mesh(terrainSections(field,nx,nz),materials.section);
  section.name='Four exposed nonuniform geological sections';section.castShadow=true;section.receiveShadow=true;group.add(section);
  const bottom=new THREE.Mesh(new THREE.PlaneGeometry(12,9.6),new THREE.MeshStandardMaterial({color:0x29271f,roughness:.99}));
  bottom.name='Closed underside of the cutaway block';bottom.rotation.x=Math.PI/2;bottom.position.set(0,-1.5,-.5);group.add(bottom);
  const gravel=sectionGravel(group,field,materials,random,quality,seed);
  const roots=sectionRoots(group,field,materials,random,quality);
  const rocks=boulderField(group,field,materials,random,quality);
  const outcrops=fracturedOutcrops(group,field,materials,random,quality);
  const waterwayRocks=channelRocks(group,field,materials);
  const wetlandGravel=alluvialGravel(group,field,materials,seed,quality);
  const lake={...LAKE_SPEC,bedHeight:field.height,shoreDistance:(x,z)=>field.lakeDistance(x,z)-1};
  const river=RIVER_NODES.map(n=>n.slice());
  river.sample=field.riverAt;
  river.pool=field.pool;river.obstacles=field.obstacles;
  river.curve=new THREE.CatmullRomCurve3(river.map(p=>new THREE.Vector3(...p)));
  const fall=[
    {top:new THREE.Vector3(...river[0]),bottom:new THREE.Vector3(...river[1]),width:.33},
    {top:new THREE.Vector3(...river[1]),bottom:new THREE.Vector3(...river[2]),width:.37},
  ];
  const stats={seed,quality,grid:[nx,nz],surfaceVertices:surface.geometry.attributes.position.count,surfaceTriangles:nx*nz*2,
    gravelInstances:gravel.count,wetlandGravelInstances:wetlandGravel,rootFilaments:roots.count,boulderInstances:rocks.count,waterwayRockInstances:waterwayRocks.count,visibleWaterwayRocks:waterwayRocks.visible,fracturedPlateInstances:outcrops.plates,talusInstances:outcrops.talus,drawCalls:group.children.filter(o=>o.isMesh).length,
    coordinates:'world XZ in metres; front +Z; bottom -1.5',
    fields:['meadow','ridge','mountain','erosion','fracture','fragmentJoint','fragmentTone','fragmentSpall','shore','riverDistance'],
    debugModes:{0:'final',1:'mineral region',2:'grass/moss/crack',3:'wet/snow/up',4:'organic/gravel/tan section',5:'plate joint/tone/spall'},
  };
  let vertexCount=0,triangleCount=0;
  group.traverse(object=>{
    if(!object.isMesh)return;
    const instances=object.isInstancedMesh?object.count:1;
    vertexCount+=object.geometry.attributes.position.count*instances;
    triangleCount+=(object.geometry.index?object.geometry.index.count:object.geometry.attributes.position.count)/3*instances;
  });
  stats.renderedVertices=vertexCount;stats.renderedTriangles=triangleCount;
  group.userData.fieldContract={coordinates:stats.coordinates,seed,meshPitch:[12/nx,9.6/nz],heightOwner:'terrain-field.js',surfaceBumpOnlyBelowMeshPitch:true};
  scene.add(group);
  let disposed=false,treeRoots=null;
  return {
    group,height:field.height,normal:field.normal,lake,river,fall,stats,pool:field.pool,rocks:field.obstacles,
    sample:field.fields,bounds:{...TERRAIN_BOUNDS},
    setRootSources(sources=[]){
      if(disposed)return null;
      if(treeRoots){stats.renderedVertices-=treeRoots.stats.vertices;stats.renderedTriangles-=treeRoots.stats.triangles;if(treeRoots.stats.vertices)stats.drawCalls--;treeRoots.dispose();}
      treeRoots=createCutawayRoots(field,materials.roots,{seed,sources});group.add(treeRoots.group);
      group.userData.cutawayRoots=treeRoots.group.userData.cutawayRoots;
      stats.treeRootZones=treeRoots.stats.nearFaceZones;stats.treeRootAxes=treeRoots.stats.axes;
      stats.renderedVertices+=treeRoots.stats.vertices;stats.renderedTriangles+=treeRoots.stats.triangles;if(treeRoots.stats.vertices)stats.drawCalls++;
      return treeRoots.stats;
    },
    update(dt,state={}){if(!disposed)materials.update(state);},
    dispose(){
      if(disposed)return;disposed=true;scene.remove(group);
      const geometries=new Set();group.traverse(object=>{if(object.geometry)geometries.add(object.geometry);});
      for(const geometry of geometries)geometry.dispose();
      bottom.material.dispose();materials.dispose();
    },
  };
}
