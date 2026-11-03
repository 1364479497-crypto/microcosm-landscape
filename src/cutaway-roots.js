import * as THREE from 'three';
import {seededRandom} from './terrain-field.js';

const clamp=THREE.MathUtils.clamp;
const EDGES=[
 {id:'front',side:0,normal:[0,0,1],point:(u,y,d=0)=>new THREE.Vector3(u,y,4.3+d),along:p=>p[0],distance:p=>4.3-p[2],lo:-6,hi:6},
 {id:'right',side:1,normal:[1,0,0],point:(u,y,d=0)=>new THREE.Vector3(6+d,y,u),along:p=>p[2],distance:p=>6-p[0],lo:-5.3,hi:4.3},
 {id:'left',side:2,normal:[-1,0,0],point:(u,y,d=0)=>new THREE.Vector3(-6-d,y,u),along:p=>p[2],distance:p=>p[0]+6,lo:-5.3,hi:4.3},
 {id:'back',side:3,normal:[0,0,-1],point:(u,y,d=0)=>new THREE.Vector3(u,y,-5.3-d),along:p=>p[0],distance:p=>p[2]+5.3,lo:-6,hi:6},
];

// This is an authored near-face exposure, not an X-ray projection of every
// tree in the block. Only real root zones that reach a cut face contribute.
// An underground connector reaches that face; tapered laterals are then
// exposed by the cut. Fine turf roots remain the existing separate mesh.
export function createCutawayRoots(field,material,{seed=42,sources=[]}={}){
 const group=new THREE.Group();group.name='Tree roots exposed only beside real nearby rooted trees';
 const positions=[],indices=[],colors=[],axes=[],accepted=[],r=seededRandom(seed^0x67ab1953),sideCount={front:0,right:0,left:0,back:0};
 const tint=new THREE.Color(),radial=5;
 function addAxis(points,radius,{source,edge,parent=null,kind='lateral',exposed=true,endRatio=.025}={}){
  if(points.some(p=>!Number.isFinite(p.x+p.y+p.z)||p.y< -1.43))return null;
  if(exposed&&points.some(p=>field.height(clamp(p.x,-6,6),clamp(p.z,-5.3,4.3))<.23))return null;
  const id=axes.length,offset=positions.length/3,normal=new THREE.Vector3(...edge.normal),tone=.88+r()*.20;
  for(let j=0;j<points.length;j++){
   const p=points[j],t=j/(points.length-1),prev=points[Math.max(0,j-1)],next=points[Math.min(points.length-1,j+1)];
   const tangent=next.clone().sub(prev).normalize(),cross=normal.clone().cross(tangent);
   if(cross.lengthSq()<.001)cross.set(1,0,0).cross(tangent);cross.normalize();
   const bitangent=tangent.clone().cross(cross).normalize(),width=radius*Math.pow(Math.max(.025,1-t*(1-endRatio)),.88);
   tint.setRGB(tone*(.92+.08*t),tone*(.91+.06*t),tone*(.84+.07*t));
   for(let a=0;a<radial;a++){
    const angle=a/radial*Math.PI*2,q=p.clone().addScaledVector(cross,Math.cos(angle)*width).addScaledVector(bitangent,Math.sin(angle)*width);
    positions.push(q.x,q.y,q.z);colors.push(tint.r,tint.g,tint.b);
   }
  }
  for(let j=0;j<points.length-1;j++)for(let a=0;a<radial;a++){
   const q=offset+j*radial+a,b=offset+j*radial+(a+1)%radial,c=q+radial,d=b+radial;indices.push(q,c,b,b,c,d);
  }
  axes.push({id,source,side:edge.id,parent,kind,exposed,radius,endRatio,points:points.map(p=>p.toArray())});return id;
 }
 const sorted=sources.filter(s=>Array.isArray(s.root)&&s.root.length>=3&&s.root.slice(0,3).every(Number.isFinite)).map(s=>({id:String(s.id??`tree-${s.root[0]}-${s.root[2]}`),root:[...s.root],height:Number(s.height??s.root[3])||1,radius:Number(s.radius)||.35})).sort((a,b)=>a.id.localeCompare(b.id));
 for(const source of sorted){
  const reach=clamp(.57+source.radius*.95+source.height*.13,.72,1.32);
  for(const edge of EDGES){
   const distance=edge.distance(source.root);if(distance<0||distance>reach*.93)continue;
   const u=clamp(edge.along(source.root),edge.lo+.10,edge.hi-.10),p=edge.point(u,0),top=field.height(p.x,p.z);
   if(top<.23||top>1.40||Math.abs(top-source.root[1])>.65)continue;
   const influence=1-distance/reach,depth=.11+distance*.12,spread=.19+influence*.27,drop=.23+influence*.22;
   const radius=clamp(.008+source.height*.003+influence*.009,.009,.021),start=edge.point(u,top-depth,.003),rootStart=new THREE.Vector3(source.root[0],source.root[1]-.045-radius,source.root[2]);
   const connector=[];
   for(let j=0;j<6;j++){
    const t=j/5,q=rootStart.clone().lerp(start,t);q.y-=Math.sin(t*Math.PI)*(.025+distance*.025);
    q.y=Math.min(q.y,field.height(clamp(q.x,-6,6),clamp(q.z,-5.3,4.3))-.026-radius);connector.push(q);
   }
   // Keep a connector wholly under land and attach its last ring to the
   // exposed axis, instead of floating a large root motif below empty turf.
   if(connector.some(q=>field.height(clamp(q.x,-6,6),clamp(q.z,-5.3,4.3))<.23))continue;
   const connectorId=addAxis(connector,radius*1.20,{source:source.id,edge,kind:'soil connector',exposed:false,endRatio:.70});
   for(const sign of [-1,1]){
    const path=[];
    for(let j=0;j<7;j++){
     const t=j/6,along=clamp(u+sign*spread*(t*.65+t*t*.35)+Math.sin(t*3.6)*.018,edge.lo+.025,edge.hi-.025),q=edge.point(along,top-depth-drop*(t*.64+t*t*.36),.003);
     q.y=Math.min(q.y,field.height(clamp(q.x,-6,6),clamp(q.z,-5.3,4.3))-.025-radius);path.push(q);
    }
    path[0].copy(connector.at(-1));const main=addAxis(path,radius*.88,{source:source.id,edge,parent:connectorId,kind:'exposed structural root'});if(main===null)continue;
    for(const node of [2,4]){
     const host=path[node],along=edge.along(host.toArray()),branch=[],length=.09+r()*.15;
     for(let j=0;j<5;j++){
      const t=j/4,q=edge.point(clamp(along+sign*length*t*.58+Math.sin(t*2.8)*.010,edge.lo+.02,edge.hi-.02),host.y-length*(t*.50+t*t*.50),.003);
      q.y=Math.min(q.y,field.height(clamp(q.x,-6,6),clamp(q.z,-5.3,4.3))-.018);branch.push(q);
     }
     branch[0].copy(host);const branchId=addAxis(branch,radius*(node===2?.44:.30),{source:source.id,edge,parent:main,kind:'tapered feeder'});if(branchId===null)continue;
     const from=branch[2],hair=[];
     for(let j=0;j<4;j++){const t=j/3;hair.push(edge.point(edge.along(from.toArray())-sign*t*.045,from.y-t*.085-t*t*.018,.003));}
     hair[0].copy(from);addAxis(hair,radius*.12,{source:source.id,edge,parent:branchId,kind:'fine rootlet'});
    }
   }
   accepted.push({source:source.id,root:source.root.slice(0,3),side:edge.id,distance,reach,influence});sideCount[edge.id]++;
  }
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();if(positions.length)geometry.computeBoundingSphere();
 const mesh=new THREE.Mesh(geometry,material);mesh.name='Tapered structural roots and feeders attached to real tree zones';mesh.castShadow=false;mesh.receiveShadow=true;mesh.visible=positions.length>0;group.add(mesh);
 const stats={sourceCount:sorted.length,nearFaceZones:accepted.length,axes:axes.length,vertices:positions.length/3,triangles:indices.length/3,sideCount};
 group.userData.cutawayRoots={spec:'2.3.5 actual tree root zones / authored near-face exposures',stats,sources:sorted,zones:accepted,axes};
 return {group,stats,dispose(){geometry.dispose();group.removeFromParent();}};
}
