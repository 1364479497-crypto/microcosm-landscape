import * as THREE from 'three';
import {createCabinMaterials} from './cabin-materials.js';

// Independently authored mountain dwelling. No external mesh, texture, image,
// reference implementation, or mutable shared prop random stream is used.
const UP=new THREE.Vector3(0,1,0),V=(x,y,z)=>new THREE.Vector3(x,y,z);
const D=.367,W=.49,ROOF=.895;
function random(seed){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let a=s;a=Math.imul(a^a>>>15,a|1);a^=a+Math.imul(a^a>>>7,a|61);return((a^a>>>14)>>>0)/4294967296;};}
const roofY=x=>ROOF-Math.abs(x)*.62;

function boxGeometry(sx,sy,sz,bevel=.0016,wear=false){
  const radius=Math.min(bevel,sx*.12,sy*.12,sz*.12),segments=radius>0?(wear?4:3):1;
  const g=new THREE.BoxGeometry(sx,sy,sz,segments,segments,segments),p=g.attributes.position,n=g.attributes.normal,tx=g.attributes.uv;
  const v=V(0,0,0),c=V(0,0,0),d=V(0,0,0),half=V(sx*.5,sy*.5,sz*.5);
  if(radius>0)for(let i=0;i<p.count;i++){
    v.fromBufferAttribute(p,i);
    for(const axis of ['x','y','z'])if(Math.abs(v[axis])<half[axis]*.8)v[axis]=Math.sign(v[axis])*(half[axis]-radius);
    c.set(THREE.MathUtils.clamp(v.x,-half.x+radius,half.x-radius),THREE.MathUtils.clamp(v.y,-half.y+radius,half.y-radius),THREE.MathUtils.clamp(v.z,-half.z+radius,half.z-radius));
    d.subVectors(v,c).normalize();v.copy(c).addScaledVector(d,radius);
    if(wear&&d.y>.95){
      // A shallow compact foot-worn bowl preserves untouched corners and the
      // full stone envelope, while making the central tread visibly used.
      const ax=sx*.42,az=sz*.40,qx=v.x/ax,qz=(v.z-sz*.08)/az;
      const fx=Math.max(0,1-qx*qx),fz=Math.max(0,1-qz*qz);
      v.y-=.0028*fx*fz;
      if(fx>0&&fz>0)d.set(-.0056*qx/ax*fz,1,-.0056*qz/az*fx).normalize();
    }
    p.setXYZ(i,v.x,v.y,v.z);n.setXYZ(i,d.x,d.y,d.z);
  }
  for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));if(ny>=nx&&ny>=nz)tx.setXY(i,p.getX(i),p.getZ(i));else if(nx>=nz)tx.setXY(i,p.getZ(i),p.getY(i));else tx.setXY(i,p.getX(i),p.getY(i));}
  return g;
}

function foundationMasonry(f,seed){
  const r=random(seed),p=[],n=[],uv=[],tone=[],rows=Math.max(2,Math.ceil(f.h/.063)),gap=.0016;
  for(let row=0;row<rows;row++){
    const splitX=(r()-.5)*.027,splitZ=(r()-.5)*.021,xs=[-f.width*.5,splitX,f.width*.5],zs=[-f.depth*.5,splitZ,f.depth*.5];
    for(let ix=0;ix<2;ix++)for(let iz=0;iz<2;iz++){
      const x0=xs[ix]+(ix?gap*.5:0),x1=xs[ix+1]-(ix===0?gap*.5:0),z0=zs[iz]+(iz?gap*.5:0),z1=zs[iz+1]-(iz===0?gap*.5:0);
      const y0=-f.h*.5+row*f.h/rows+(row?gap*.5:0),y1=-f.h*.5+(row+1)*f.h/rows-(row<rows-1?gap*.5:0),h=y1-y0,y=(y0+y1)*.5;
      const source=boxGeometry(x1-x0,h,z1-z0,.0022),block=source.toNonIndexed(),pa=block.attributes.position,no=block.attributes.normal,tx=block.attributes.uv,t=r();source.dispose();
      for(let i=0;i<pa.count;i++){p.push(pa.getX(i)+(x0+x1)*.5,pa.getY(i)+y,pa.getZ(i)+(z0+z1)*.5);n.push(no.getX(i),no.getY(i),no.getZ(i));uv.push(tx.getX(i),tx.getY(i));tone.push(t);}
      block.dispose();
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('aPartTone',new THREE.Float32BufferAttribute(tone,1));return g;
}

/** A serializable construction plan precedes mesh emission. */
function planCabin(terrain,seed){
  const foundationRandom=random(seed+830),detailRandom=random(seed+19317);
  const position={x:-2.65,z:-.25,y:0},yaw=-.07;
  position.y=Math.max(terrain.height(position.x,position.z),...[-.5,.5].flatMap(x=>[-.35,.35].map(z=>terrain.height(position.x+x,position.z+z))))+.055;
  const frontOpenings=[{id:'door',x:-.03,y:.226,w:.206,h:D},{id:'left-window',x:-.337,y:.285,w:.209,h:.176},{id:'right-window',x:.326,y:.285,w:.209,h:.176}];
  const sideOpenings=[{id:'east-window',x:-.08,y:.28,w:.209,h:.176}];
  const facades=[{id:'front',axis:'x',sign:1,fixed:.36,width:1.0,openings:frontOpenings},{id:'back',axis:'x',sign:-1,fixed:-.36,width:1.0,openings:[]},{id:'east',axis:'z',sign:1,fixed:.495,width:.72,openings:sideOpenings},{id:'west',axis:'z',sign:-1,fixed:-.495,width:.72,openings:[]}];
  const foundations=Array.from({length:4},(_,i)=>{const x=i<2?-.45:.45,z=i%2?-.31:.31,h=Math.max(.09,position.y-terrain.height(position.x+x,position.z+z)+.06);return{id:`foundation-${i}`,x,z,y:.015-h*.5,h,width:.20,depth:.19,yaw:(foundationRandom()-.5)*.12};});
  const features={
    canopy:{centerX:-.03,x0:-.235,x1:.172,z0:.388,z1:.674,wallHeight:.553,slope:.304,rows:4,columns:5,tileCount:20,supportXs:[-.171,.111],roofMinimumY:.465,groundColumns:0},
    gableVents:[{id:'front-attic-vent',z:.36,width:.162,y0:.637,y1:.726,slats:5},{id:'rear-attic-vent',z:-.36,width:.136,y0:.645,y1:.712,slats:5}],
    shutters:{windows:3,foldedLeavesPerWindow:2,leafWidth:.027,leafHeight:.184},
    roofDetails:{eaveEndTiles:26,rafterHeelBlocks:18,ridgeEndClosures:2},
  };
  return {seed,position,yaw,dimensions:{door:D,wall:W,body:[1.05,.49,.77],eave:[1.30,.99],ridge:ROOF},mass:{id:'single-room-gabled-dwelling',bounds:[[-.525,.008,-.385],[.525,.49,.385]],caps:['floor','gable-front','gable-back','roof-underlay']},facades,foundations,features,steps:[{id:'inner-step',center:[-.03,-.005,.54],size:[.32,.07,.20]},{id:'outer-step',center:[-.03,-.042,.67],size:[.37,.065,.17]}],roof:{rows:8,columns:13,sides:2,tileCount:208,ridgeCaps:14},chimney:{x:-.285,z:-.17,top:roofY(.285)+.3225,innerWidth:.112},anchors:{door:[-.03,.226,.423],threshold:[-.03,.0425,.437],windows:[[-.337,.285,.4],[.326,.285,.4],[.525,.28,-.08]],eaveCorners:[[-.65,roofY(.65),-.495],[.65,roofY(.65),-.495],[-.65,roofY(.65),.495],[.65,roofY(.65),.495]],canopyBearingPoints:[[-.171,.476,.392],[.111,.476,.392]],canopyOuterBeam:[[-.235,.459,.655],[.172,.459,.655]]},diagnostics:{duplicateSurfaceOwners:[],openingOverlaps:[],missingModuleIds:[],coordinateOwner:'terrain height and retained cabin collision contract',scope:'single room and reserved rectangular holes; empty arrays are reserved fields, not a general overlap solver'},detailRandom};
}

class Writer{
  constructor(materials){this.materials=materials;this.slots=new Map();this.modules={};}
  add(slot,g,{position=V(0,0,0),rotation=new THREE.Quaternion(),tone=.5,exposure=.55,soot=0,role=0,grainAxis,owner='structure'}={}){
    if(!this.materials[slot])throw new Error(`Missing cabin material ${slot}`);
    this.modules[owner]=(this.modules[owner]||0)+1;
    const target=this.slots.get(slot)||{positions:[],normals:[],uv:[],data:[],triangles:0};this.slots.set(slot,target);
    const source=g.index?g.toNonIndexed():g,pa=source.attributes.position,no=source.attributes.normal,uv=source.attributes.uv,partTone=source.attributes.aPartTone;
    const surfaceSeed=((Math.sin(position.x*127.1+position.y*311.7+position.z*74.7+tone*291.3)*43758.5453)%1+1)%1;
    const matrix=new THREE.Matrix4().compose(position,rotation,V(1,1,1)),nm=new THREE.Matrix3().getNormalMatrix(matrix),p=V(0,0,0),n=V(0,0,0);
    for(let i=0;i<pa.count;i++){
      p.fromBufferAttribute(pa,i);
      if(grainAxis==='x')target.uv.push(Math.abs(no.getY(i))>Math.abs(no.getZ(i))?p.z:p.y,p.x);
      else if(grainAxis==='z')target.uv.push(Math.abs(no.getX(i))>Math.abs(no.getY(i))?p.y:p.x,p.z);
      else if(grainAxis==='y')target.uv.push(Math.abs(no.getX(i))>Math.abs(no.getZ(i))?p.z:p.x,p.y);
      else if(uv)target.uv.push(uv.getX(i),uv.getY(i));else target.uv.push(p.x,p.y+p.z);
      p.applyMatrix4(matrix);n.fromBufferAttribute(no,i).applyMatrix3(nm).normalize();
      target.positions.push(p.x,p.y,p.z);target.normals.push(n.x,n.y,n.z);target.data.push(partTone?partTone.getX(i):tone,exposure,soot,slot==='stone'?role:surfaceSeed);
    }
    target.triangles+=pa.count/3;if(source!==g)source.dispose();g.dispose();
  }
  box(slot,x,y,z,sx,sy,sz,{yaw=0,bevel=.0016,wear=false,...opts}={}){
    const g=boxGeometry(sx,sy,sz,bevel,wear);
    const grainAxis=opts.grainAxis||(['timber','joinery'].includes(slot)?(sx>=sy&&sx>=sz?'x':sy>=sz?'y':'z'):undefined);
    this.add(slot,g,{position:V(x,y,z),rotation:new THREE.Quaternion().setFromAxisAngle(UP,yaw),grainAxis,...opts});
  }
  beam(slot,a,b,width,depth=width,opts={}){
    this.add(slot,new THREE.BoxGeometry(width,a.distanceTo(b),depth),{position:a.clone().add(b).multiplyScalar(.5),rotation:new THREE.Quaternion().setFromUnitVectors(UP,b.clone().sub(a).normalize()),grainAxis:'y',...opts});
  }
  finish(group){
    const counts={};
    for(const [slot,s] of this.slots){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(s.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(s.normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(s.uv,2));g.setAttribute('aCabinData',new THREE.Float32BufferAttribute(s.data,4));g.computeBoundingBox();g.computeBoundingSphere();const mesh=new THREE.Mesh(g,this.materials[slot]);mesh.name=`mountain-home:${slot}`;mesh.castShadow=slot!=='glass';mesh.receiveShadow=true;mesh.userData={slot,triangles:s.triangles};group.add(mesh);counts[slot]={triangles:s.triangles,vertices:s.positions.length/3};}
    return counts;
  }
}

function polygon(points,indices){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));g.setAttribute('uv',new THREE.Float32BufferAttribute(points.flatMap(p=>[p.x,p.y]),2));g.setIndex(indices);g.computeVertexNormals();return g;}

// Rectangle subtraction leaves actual window/door holes in the wall shell.
function splitOpenings(rect,holes){let regions=[rect];for(const h of holes){const next=[];for(const r of regions){const x0=Math.max(r.x0,h.x-h.w*.5),x1=Math.min(r.x1,h.x+h.w*.5),y0=Math.max(r.y0,h.y-h.h*.5),y1=Math.min(r.y1,h.y+h.h*.5);if(x0>=x1||y0>=y1){next.push(r);continue;}if(r.x0<x0)next.push({x0:r.x0,x1:x0,y0:r.y0,y1:r.y1});if(x1<r.x1)next.push({x0:x1,x1:r.x1,y0:r.y0,y1:r.y1});if(r.y0<y0)next.push({x0,x1,y0:r.y0,y1:y0});if(y1<r.y1)next.push({x0,x1,y0:y1,y1:r.y1});}regions=next;}return regions;}

function compileFacade(w,face,plan,r){
  const panelRegions=splitOpenings({x0:-face.width*.5,x1:face.width*.5,y0:.088,y1:.478},face.openings);
  face.exposedRegions=panelRegions;
  for(const [index,p] of panelRegions.entries()){
    const center=(p.x0+p.x1)*.5,yy=(p.y0+p.y1)*.5,width=p.x1-p.x0,height=p.y1-p.y0;
    const slot=face.id==='west'&&p.y1<.21?'timber':'plaster';
    if(face.axis==='x')w.box(slot,center,yy,face.fixed,width,height,.035,{bevel:.002,tone:r(),owner:`${face.id}-infill-${index}`});
    else w.box(slot,face.fixed,yy,center,.035,height,width,{bevel:.002,tone:r(),owner:`${face.id}-infill-${index}`});
  }
  // Physical narrow joints and irregular block lengths distinguish the old
  // laid sill from a strip of concrete. Every vertex stays inside the old sill.
  const span=face.axis==='x'?1.015:.72,count=face.axis==='x'?7:5;
  const cuts=Array.from({length:count+1},(_,i)=>-span*.5+span*i/count+(i&&i<count?(r()-.5)*.025:0));
  for(let i=0;i<count;i++){
    const lo=cuts[i]+(i?.0009:0),hi=cuts[i+1]-(i<count-1?.0009:0),u=(lo+hi)*.5,ww=hi-lo;
    if(face.axis==='x')w.box('stone',u,.067,face.fixed,ww,.058,.046,{bevel:.0032,tone:r(),role:1,owner:'stone-sill-block'});
    else w.box('stone',face.fixed,.067,u,.046,.058,ww,{bevel:.0032,tone:r(),role:1,owner:'stone-sill-block'});
  }
}

function addWindow(w,cx,cy,cz,side,r){
  const box=(slot,u,v,d,su,sv,sd,opts={})=>{
    if(side)w.box(slot,cz+d,cy+v,cx+u,sd,sv,su,{...opts,owner:opts.owner||'window-joinery'});
    else w.box(slot,cx+u,cy+v,cz+d,su,sv,sd,{...opts,owner:opts.owner||'window-joinery'});
  };
  box('recess',0,0,-.013,.235,.202,.031,{bevel:0});
  box('glass',0,0,.013,.209,.176,.006,{bevel:0});
  for(const yy of [-.106,.106])box('joinery',0,yy,.026,.273,.025,.042,{tone:.6});
  for(const xx of [-.126,.126])box('joinery',xx,0,.026,.025,.237,.042,{tone:.5});
  box('joinery',0,0,.032,.225,.014,.023,{tone:.66});
  // Slender vertical mullion gives four quiet panes instead of a luminous sign.
  box('joinery',0,0,.034,.011,.19,.022,{tone:.65});
  box('timber',0,-.13,.035,.29,.023,.083,{tone:.71,grainAxis:side?'z':'x'});
  // Small protective head board and a deep reveal are actual geometry.
  box('timber',0,.128,.021,.29,.018,.061,{tone:.62});
  // Folded weather shutters remain alongside the clear opening. Each narrow
  // leaf has three boards, two cleats and an attached hinge, without changing
  // the cabin's ground footprint or replacing the established warm panes.
  for(const sign of [-1,1]){
    for(let j=0;j<3;j++)box('timber',sign*.155+(j-1)*.009,0,.034,.0085,.184,.014,{tone:.38+j*.09+sign*.035,grainAxis:'y',owner:'folded-shutter-board'});
    for(const yy of [-.062,.062])box('joinery',sign*.155,yy,.044,.030,.009,.009,{tone:.55,owner:'shutter-cleat'});
    for(const yy of [-.067,.067])box('iron',sign*.137,yy,.043,.011,.004,.006,{bevel:.0005,tone:.42,owner:'shutter-hinge'});
    box('joinery',sign*.087,-.155,.016,.021,.033,.048,{tone:.59,owner:'sill-bearing-block'});
  }
}

function compileGable(w,vent){
  const z=vent.z,sign=Math.sign(z),cy=(vent.y0+vent.y1)*.5,h=vent.y1-vent.y0;
  const shape=new THREE.Shape();shape.moveTo(-.498,.487);shape.lineTo(.498,.487);shape.lineTo(0,.858);shape.closePath();
  const hole=new THREE.Path();hole.moveTo(-vent.width*.5,vent.y0);hole.lineTo(-vent.width*.5,vent.y1);hole.lineTo(vent.width*.5,vent.y1);hole.lineTo(vent.width*.5,vent.y0);hole.closePath();shape.holes.push(hole);
  const g=new THREE.ShapeGeometry(shape);g.translate(0,0,z);if(z<0){const ix=g.index.array;for(let i=0;i<ix.length;i+=3)[ix[i+1],ix[i+2]]=[ix[i+2],ix[i+1]];g.computeVertexNormals();}
  w.add('plaster',g,{tone:.6,exposure:.1,owner:'vented-gable-surface'});
  w.box('recess',0,cy,z-sign*.012,vent.width,h,.015,{bevel:0,owner:'attic-vent-reveal'});
  for(const xx of [-vent.width*.5,vent.width*.5])w.box('joinery',xx,cy,z+sign*.008,.015,h+.027,.022,{tone:.52,owner:'attic-vent-frame'});
  for(const yy of [vent.y0,vent.y1])w.box('timber',0,yy,z+sign*.010,vent.width+.027,.014,.026,{tone:.62,owner:'attic-vent-head-and-sill'});
  for(let j=0;j<vent.slats;j++)w.box('joinery',(j-(vent.slats-1)*.5)*vent.width/(vent.slats+1),cy,z+sign*.006,.008,h-.008,.018,{tone:.46+j*.025,owner:'attic-vent-lattice'});
  // The split king post bears on the new vent lintel and sill, so the vent
  // remains a real opening instead of a grille pasted over plaster.
  w.beam('joinery',V(0,.484,z+sign*.006),V(0,vent.y0-.006,z+sign*.006),.025,.027,{tone:.62,exposure:.1,owner:'split-gable-king-post'});
  w.beam('joinery',V(0,vent.y1+.006,z+sign*.006),V(0,.858,z+sign*.006),.025,.027,{tone:.62,exposure:.1,owner:'split-gable-king-post'});
  for(const side of [-1,1])w.beam('joinery',V(side*.456,.498,z),V(side*.20,.692,z),.019,.023,{tone:.61,exposure:.1,owner:'gable-brace'});
}

function canopyTile(s0,s1,x0,x1,jitter=0){
  const g=roofTile(s0,s1,x0,x1,1,jitter);
  // Map the existing independently authored closed tile shell to the entry
  // lean-to. The reflection changes winding, which is corrected explicitly.
  const m=new THREE.Matrix4().set(0,0,1,0,.316,1,0,.553-ROOF,1,0,0,.388,0,0,0,1);
  g.applyMatrix4(m);const ix=g.index.array;for(let i=0;i<ix.length;i+=3)[ix[i+1],ix[i+2]]=[ix[i+2],ix[i+1]];g.computeVertexNormals();return g;
}

function compileCanopy(w,c,seed){
  const r=random(seed+31721),length=c.z1-c.z0,roofAt=z=>c.wallHeight-(z-c.z0)*c.slope;
  const bed=new THREE.BoxGeometry(c.x1-c.x0,.011,Math.hypot(length,length*c.slope));
  w.add('joinery',bed,{position:V((c.x0+c.x1)*.5,(roofAt(c.z0)+roofAt(c.z1))*.5-.007,(c.z0+c.z1)*.5),rotation:new THREE.Quaternion().setFromAxisAngle(V(1,0,0),Math.atan(c.slope)),tone:.54,grainAxis:'x',owner:'canopy-closed-roof-bed'});
  for(let row=0;row<c.rows;row++)for(let col=0;col<c.columns;col++){
    const s0=row*.078,s1=Math.min(length,s0+.098),x0=c.x0+col*.081;
    w.add('tiles',canopyTile(s0,s1,x0,x0+.083,(r()-.5)*.0012),{tone:r(),exposure:.95,soot:1,owner:'canopy-overlapping-tile'});
  }
  w.box('joinery',c.centerX,.529,.397,.380,.028,.046,{tone:.53,owner:'canopy-wall-ledger'});
  w.box('timber',c.centerX,.459,.655,.425,.027,.026,{tone:.62,exposure:.62,owner:'canopy-front-fascia'});
  for(const x of c.supportXs){
    w.box('joinery',x,.444,.394,.029,.184,.036,{tone:.48,owner:'canopy-wall-bearing'});
    w.beam('joinery',V(x,.537,.410),V(x,.459,.655),.018,.023,{tone:.56,exposure:.15,owner:'canopy-principal-rafter'});
    w.beam('timber',V(x,.393,.408),V(x,.453,.624),.017,.020,{tone:.58,exposure:.32,owner:'canopy-knee-brace'});
    for(const y of [.387,.488])w.box('iron',x,y,.415,.007,.007,.005,{bevel:.0005,tone:.38,owner:'canopy-attachment-pin'});
  }
  for(const x of [c.x0+.008,c.centerX,c.x1-.008])w.beam('timber',V(x,.539,.400),V(x,.463,.667),.013,.019,{tone:.61,exposure:.2,owner:'canopy-secondary-rafter'});
}

function ridgeEndClosure(z,sign){
  const shape=new THREE.Shape();shape.moveTo(-.028,0);for(let i=0;i<=12;i++){const a=Math.PI-i/12*Math.PI;shape.lineTo(Math.cos(a)*.028,Math.sin(a)*.028);}shape.lineTo(-.028,0);shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:.006,bevelEnabled:false,steps:1});g.translate(0,ROOF+.013,z-(sign>0?0:.006));return g;
}

function roofTile(x0,x1,z0,z1,side,jitter){
  const p=[],uv=[],idx=[],nx=3,nz=5;
  const sag=z=>-.0017*(1-Math.min(1,(z/.51)**2));
  for(let layer=0;layer<2;layer++)for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){
    const t=i/nx,u=j/nz,x=THREE.MathUtils.lerp(x0,x1,t),z=THREE.MathUtils.lerp(z0,z1,u),y=roofY(x)+.008+(1-t)*.0065+Math.sin(u*Math.PI)*.0065+jitter+sag(z)-layer*.0045;
    p.push(side*x,y,z);uv.push(x,z);
  }
  const stride=nz+1,layerSize=(nx+1)*stride;
  const tri=(a,b,c,flip=false)=>{if((side<0)!==flip)idx.push(a,c,b);else idx.push(a,b,c);};
  for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){const a=i*stride+j,b=a+stride;tri(a,a+1,b);tri(a+1,b+1,b);tri(a+layerSize,b+layerSize,a+1+layerSize);tri(a+1+layerSize,b+layerSize,b+1+layerSize);}
  const border=[];for(let j=0;j<=nz;j++)border.push(j);for(let i=1;i<=nx;i++)border.push(i*stride+nz);for(let j=nz-1;j>=0;j--)border.push(nx*stride+j);for(let i=nx-1;i>0;i--)border.push(i*stride);
  for(let k=0;k<border.length;k++){const a=border[k],b=border[(k+1)%border.length];tri(a,b,a+layerSize,true);tri(b,b+layerSize,a+layerSize,true);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}

function ridgeCap(z0,z1,tone){
  const p=[],uv=[],idx=[],n=10;
  for(let end=0;end<2;end++)for(let ring=0;ring<2;ring++)for(let i=0;i<=n;i++){const a=i/n*Math.PI,r=ring?.022:.028;p.push(Math.cos(a)*r,ROOF+.013+Math.sin(a)*r,end?z1:z0);uv.push(i/n*.07,end?z1:z0);}
  const s=n+1;
  for(let i=0;i<n;i++){
    const a=i,b=i+2*s;idx.push(a,a+1,b,a+1,b+1,b);
    const c=i+s,d=i+3*s;idx.push(c,d,c+1,c+1,d,d+1);
    idx.push(a,c,a+1,a+1,c,c+1,b,b+1,d,b+1,d+1,d);
  }
  for(const i of [0,n]){const a=i,b=i+s,c=i+2*s,d=i+3*s;if(i===0)idx.push(a,c,b,b,c,d);else idx.push(a,b,c,b,d,c);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}

function compileRoof(w,plan,r){
  for(const side of [-1,1]){
    // Concealed roof bed supports closed tile shells. Rafters and edge boards
    // below close the visible eaves; this hidden bed itself is a thin surface.
    const a=V(0,.882,-.49),b=V(0,.882,.49),c=V(side*.645,.482,.49),d=V(side*.645,.482,-.49);
    w.add('recess',polygon([a,b,c,d],side>0?[0,1,2,0,2,3]:[0,2,1,0,3,2]),{tone:.5,owner:'roof-underlay'});
    for(let row=0;row<8;row++)for(let col=0;col<13;col++){
      const x0=row*.078,x1=Math.min(.65,x0+.098),z0=-.492+col*.077+(row%2)*.002;
      w.add('tiles',roofTile(x0,x1,z0,z0+.079,side,(r()-.5)*.0018),{tone:r(),exposure:.95,owner:'overlapping-tile'});
    }
    // Exposed square rafters support the overhang. Their positions are tied
    // to the same roof plane rather than scattered underneath a shell.
    for(let j=0;j<9;j++){const z=-.44+j*.11;w.beam('joinery',V(0,.858,z),V(side*.638,.462,z),.023,.023,{tone:.58,exposure:.15,owner:'exposed-rafter'});}
    for(const z of [-.486,.486])w.beam('timber',V(0,.875,z),V(side*.649,.477,z),.023,.027,{tone:.65,exposure:.65,owner:'bargeboard'});
    w.box('joinery',side*.635,.467,0,.028,.035,.988,{tone:.57,exposure:.53,owner:'eave-fascia'});
    // Individual ceramic drip ends and restrained raised rings are connected
    // to the last tile course. They sharpen the eave silhouette at long range.
    for(let col=0;col<13;col++){
      const z=-.451+col*.077,q=new THREE.Quaternion().setFromUnitVectors(UP,V(side,0,0));
      w.add('tiles',new THREE.CylinderGeometry(.0105,.0105,.006,10,1,false),{position:V(side*.650,.493,z),rotation:q,tone:.33+col*.025,exposure:.8,owner:'ceramic-eave-end'});
      w.add('tiles',new THREE.TorusGeometry(.0078,.0011,3,10),{position:V(side*.654,.493,z),rotation:new THREE.Quaternion().setFromAxisAngle(UP,side*Math.PI*.5),tone:.56,exposure:.8,owner:'eave-end-ring'});
    }
    for(let j=0;j<9;j++)w.box('joinery',side*.620,.442,-.44+j*.11,.033,.026,.027,{tone:.50+j*.012,exposure:.22,owner:'rafter-heel-block'});
    // A second narrow timber course reveals the construction depth rather
    // than enlarging the main roof or creating an ornamental upturned roof.
    for(const z of [-.487,.487])w.beam('joinery',V(0,.851,z),V(side*.629,.462,z),.011,.019,{tone:.49,exposure:.17,owner:'inner-bargeboard-course'});
  }
  w.box('joinery',0,.856,0,.043,.044,.95,{tone:.54,owner:'ridge-purlin'});
  for(const x of [-.43,.43])w.box('joinery',x,roofY(x)-.035,0,.032,.036,.95,{tone:.56,owner:'intermediate-purlin'});
  for(let j=0;j<14;j++)w.add('tiles',ridgeCap(-.515+j*.075,-.429+j*.075),{tone:r()*.65,exposure:1,owner:'ridge-cap'});
  w.add('tiles',ridgeEndClosure(-.515,-1),{tone:.29,exposure:.9,owner:'ridge-end-closure'});
  w.add('tiles',ridgeEndClosure(.546,1),{tone:.34,exposure:.9,owner:'ridge-end-closure'});
}

export function createCabin({terrain,seed=42}={}){
  if(!terrain||typeof terrain.height!=='function')throw new Error('createCabin requires terrain.height(x,z)');
  const plan=planCabin(terrain,seed),r=plan.detailRandom;delete plan.detailRandom;
  const group=new THREE.Group();group.name='weathered-gray-tile-mountain-home';group.position.set(plan.position.x,plan.position.y,plan.position.z);group.rotation.y=plan.yaw;
  const pbr=createCabinMaterials(seed),w=new Writer(pbr.materials);
  for(const [i,f] of plan.foundations.entries()){
    w.add('stone',foundationMasonry(f,seed+2303+i*71),{position:V(f.x,f.y,f.z),rotation:new THREE.Quaternion().setFromAxisAngle(UP,f.yaw),tone:r(),role:1,exposure:.35,owner:'foundation'});
    w.box('recess',f.x,f.y,f.z,f.width-.007,f.h-.006,f.depth-.007,{yaw:f.yaw,bevel:.001,owner:'foundation-mortar-core'});
  }
  for(const s of plan.steps)w.box('stone',...s.center,...s.size,{bevel:.0045,wear:true,tone:.72,role:2,exposure:.95,owner:'retained-entry-step'});
  w.box('timber',0,.03,0,1.05,.045,.77,{tone:.6,owner:'closed-floor'});
  for(const face of plan.facades)compileFacade(w,face,plan,r);
  for(const x of [-.497,.497])for(const z of [-.36,.36])w.box('joinery',x,.25,z,.052,.50,.052,{tone:.54,exposure:.32,owner:'corner-post'});
  for(const z of [-.36,.36]){
    w.box('joinery',0,.476,z,1.046,.042,.051,{tone:.57,exposure:.15,owner:'wall-plate'});
    w.box('joinery',0,.118,z,1.018,.018,.047,{tone:.56,owner:'infill-sill'});
  }
  for(const vent of plan.features.gableVents)compileGable(w,vent);
  for(const x of [-.495,.495]){w.box('joinery',x,.476,0,.052,.042,.735,{tone:.57,exposure:.15,owner:'side-wall-plate'});w.box('joinery',x,.117,0,.048,.018,.735,{tone:.59,owner:'side-infill-sill'});}
  // Three discreet old planks repair the rear/side infill. Their misalignment
  // is bounded to millimetres, with the surrounding timber retaining loads.
  for(let j=0;j<5;j++)w.box('timber',-.516,.166+j*.054,0,.013,.052,.61,{tone:.42+r()*.24,bevel:.001,owner:'west-wall-old-boards'});
  // Door dimensions remain the meadow's established relative scale anchor.
  w.box('recess',-.03,.226,.383,.206,D,.031,{bevel:0,owner:'door-reveal'});
  for(let j=0;j<5;j++)w.box('timber',-.114+.0168+j*.0336,.221+(r()-.5)*.0008,.414,.0325,.345,.019,{tone:.48+r()*.18,bevel:.0008,grainAxis:'y',owner:'old-door-board'});
  for(const x of [-.145,.087])w.box('joinery',x,.22,.414,.023,.395,.038,{tone:.57,owner:'door-jamb'});
  w.box('joinery',-.03,.408,.414,.255,.026,.041,{tone:.64,owner:'door-lintel'});
  w.box('stone',-.03,.038,.414,.236,.019,.063,{tone:.73,owner:'door-threshold'});
  for(const yy of [.13,.31])w.box('iron',-.104,yy,.427,.026,.007,.006,{bevel:.001,tone:.4,owner:'door-hinge'});
  w.box('iron',.026,.223,.43,.012,.024,.008,{bevel:.001,tone:.5,owner:'door-latch'});
  w.add('iron',new THREE.TorusGeometry(.0075,.0013,4,10),{position:V(.026,.214,.441),tone:.45,owner:'door-pull-ring'});
  addWindow(w,-.337,.285,.388,false,r);addWindow(w,.326,.285,.388,false,r);addWindow(w,-.08,.28,.513,true,r);
  compileRoof(w,plan,r);
  compileCanopy(w,plan.features.canopy,seed);
  const ch=plan.chimney,bottom=roofY(.285)-.065,top=ch.top;
  const chimneyHeight=top-.024-bottom;
  for(const side of [-1,1]){
    w.box('stone',ch.x+side*.071,bottom+chimneyHeight*.5,ch.z,.033,chimneyHeight,.175,{tone:.34+side*.06,soot:1,role:1,owner:'hollow-chimney-wall'});
    w.box('stone',ch.x,bottom+chimneyHeight*.5,ch.z+side*.071,.109,chimneyHeight,.033,{tone:.47,soot:1,role:1,owner:'hollow-chimney-wall'});
    w.box('stone',ch.x+side*.086,top-.015,ch.z,.040,.03,.212,{tone:.55,soot:1,owner:'open-chimney-cap'});
    w.box('stone',ch.x,top-.015,ch.z+side*.086,.132,.03,.040,{tone:.53,soot:1,owner:'open-chimney-cap'});
  }
  // The inner soot bed is below the open aperture, never a lid on its top.
  w.box('recess',ch.x,top-.067,ch.z,.109,.006,.109,{bevel:0,owner:'chimney-inner-soot'});
  const slots=w.finish(group);group.updateMatrixWorld(true);
  const chimneyLocal=V(ch.x,top-.012,ch.z),chimney=group.localToWorld(chimneyLocal.clone());
  const stats={seed,meshCount:group.children.length,drawCalls:group.children.length,triangles:Object.values(slots).reduce((a,b)=>a+b.triangles,0),slots,modules:w.modules,cabinTiles:228,mainRoofTiles:208,canopyTiles:20,ridgeCaps:14,roofDetails:plan.features.roofDetails,foundationYaws:plan.foundations.map(f=>f.yaw),relativeDimensions:plan.dimensions,ownedTextures:0,originalProceduralAssets:true,diagnostics:plan.diagnostics};
  if(stats.meshCount>12||stats.triangles>65000)throw new Error('Cabin exceeded material/triangle budget');
  group.userData={plan,materialSlots:Object.keys(slots),anchors:{...plan.anchors,chimneyLocal:chimneyLocal.toArray(),chimneyWorld:chimney.toArray()},stats,materialDiagnostics:pbr.uniforms,setMaterialDebug:pbr.setDebug};
  let disposed=false;
  return {group,chimney,stats,update(state={}){if(disposed)return;pbr.update(state);},dispose(){if(disposed)return;disposed=true;group.removeFromParent();group.children.forEach(m=>m.geometry.dispose());pbr.dispose();}};
}
