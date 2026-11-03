import * as THREE from 'three';
import {sampleTreeBend,bendTreePoint,bendTreeNormal} from './vegetation-wind.js';
const clamp=THREE.MathUtils.clamp,UP=new THREE.Vector3(0,1,0);

// Match the actual linearly filtered wind texture at normalized root UVs.
// field.sampleWind() is nearest-cell; using it for a moving perch would drift
// away from the GPU branch whenever a painted gust crosses adjacent cells.
export function sampleTreeWind(field,x,z,state={},target=new THREE.Vector2()){
 const image=field?.windTexture?.image,bounds=field?.bounds;
 if(image?.data&&bounds){const {data,width,height}=image,u=clamp((x-bounds.minX)/bounds.sizeX,0,1)*width-.5,v=clamp((z-bounds.minZ)/bounds.sizeZ,0,1)*height-.5,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
  const x0=clamp(i,0,width-1),x1=clamp(i+1,0,width-1),z0=clamp(j,0,height-1),z1=clamp(j+1,0,height-1),p00=(z0*width+x0)*4,p10=(z0*width+x1)*4,p01=(z1*width+x0)*4,p11=(z1*width+x1)*4,lerp=THREE.MathUtils.lerp;
  return target.set(lerp(lerp(data[p00],data[p10],a),lerp(data[p01],data[p11],a),b),lerp(lerp(data[p00+1],data[p10+1],a),lerp(data[p01+1],data[p11+1],a),b));
 }
 const w=state.wind;target.set(w?.x??w?.[0]??.85,w?.isVector3?w.z:w?.y??w?.z??w?.[1]??.25);return target.multiplyScalar(Math.max(0,state.windStrength??.70));
}

export function createTreeMotion({terrain,field,trees,fruitTrees,uniforms,barkMesh}){
 const interaction={held:false,id:null,target:new THREE.Vector2(),bend:new THREE.Vector2(),velocity:new THREE.Vector2(),root:new THREE.Vector4(999,999,999,1),height:1};
 const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),plane=new THREE.Plane(),hitPoint=new THREE.Vector3(),startPoint=new THREE.Vector3(),lastPoint=new THREE.Vector3(),cameraNormal=new THREE.Vector3(),wind=new THREE.Vector2(),springDelta=new THREE.Vector2();
 const forestRoots=new Map(),sites=[];
 for(const row of barkMesh.geometry.userData?.treeRows||[])forestRoots.set(row.tree,row);
 const diag=barkMesh.parent.userData.treeGrowth;
 for(const row of diag.branches.filter(b=>b.level===0&&!b.root))forestRoots.set(row.tree,row);
 const attr=barkMesh.geometry.attributes;
 function metadata(index){const v=n=>Array.from(attr[n].array.subarray(index*4,index*4+4));return{root:v('aRoot'),primary:v('aPrimary'),secondary:v('aSecondary'),traits:v('aTraits')};}
 for(const [index,row]of forestRoots){const meta=metadata(row.baseVertex),root=meta.root,tree=trees[index];if(root[3]<.48)continue;sites.push({id:'forest-'+index,tree:index,root,height:root[3],radius:root[3]*(tree?.type==='pine'?.26:.44),meta});}
 for(const t of fruitTrees.diagnostics.trees)sites.push({id:'orchard-'+t.tree,orchard:t.tree,root:[...t.root,t.nominalHeight],height:t.nominalHeight,radius:Math.max(.22,t.actualWidth*.45)});
 uniforms.uTreeDragRoot={value:interaction.root};uniforms.uTreeDragBend={value:interaction.bend};
 fruitTrees.setTreeMotionUniforms(uniforms);
 const stats={scope:'Shared root-fixed curved tree/wood/organ/normal/depth deformation, single elastic grabbed tree, proximity swish impulse',activeTree:null,held:false,dragCount:0,hoverCount:0,bend:[0,0],sites:sites.length};
 function dragFor(root){return Math.hypot(root[0]-interaction.root.x,root[2]-interaction.root.z)<.002?interaction.bend.toArray():[0,0];}
 function samplePoint(point,meta,time=0,state={}){const p=Array.isArray(point)?[...point]:point.toArray(),root=meta.root,w=sampleTreeWind(field,root[0],root[2],state,wind),mag=Math.min(2.5,w.length()),dir=w.clone().normalize(),axis=new THREE.Vector3(dir.y,0,-dir.x),v=new THREE.Vector3(...p);
  if(meta.primary&&meta.secondary){const pa=Math.sin(time*1.3+meta.primary[3])*.11*mag*meta.traits[2],sa=Math.sin(time*2.45+meta.secondary[3])*.16*mag*meta.traits[3];for(const [origin,angle]of [[meta.secondary,sa],[meta.primary,pa]]){const pivot=new THREE.Vector3(...origin.slice(0,3));v.sub(pivot).applyAxisAngle(axis,angle).add(pivot);}}
  return new THREE.Vector3(...bendTreePoint(v.toArray(),root,sampleTreeBend(time,root,w.toArray(),dragFor(root))));
 }
 function sampleBranchPoint(tree,point,time=0,state={},branchBaseVertex){const row=forestRoots.get(tree);if(!row)return point.clone?point.clone():new THREE.Vector3(...point);return samplePoint(point,metadata(branchBaseVertex??row.baseVertex),time,state);}
 function samplePerch(perch,time=0,state={}){const meta=metadata(perch.branchBaseVertex??perch.row?.baseVertex??forestRoots.get(perch.tree)?.baseVertex??0),feet=perch.feet.map(p=>samplePoint(p,meta,time,state)),contact=feet[0].clone().add(feet[1]).multiplyScalar(.5),right=feet[1].clone().sub(feet[0]).normalize(),forward=samplePoint(perch.contact.clone().addScaledVector(perch.forward,.01),meta,time,state).sub(samplePoint(perch.contact,meta,time,state)).normalize();forward.addScaledVector(right,-forward.dot(right)).normalize();const up=new THREE.Vector3().crossVectors(right,forward).normalize(),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward,up,right)),local=perch.position.clone().sub(perch.contact).applyQuaternion(perch.q.clone().invert()),position=local.applyQuaternion(q).add(contact);return{...perch,position,contact,feet,right,forward,up,q,exit:perch.exit.clone().applyQuaternion(perch.q.clone().invert()).applyQuaternion(q)};}
 function makeRay(event,camera,canvas){const b=canvas.getBoundingClientRect();ndc.set((event.clientX-b.left)/b.width*2-1,1-(event.clientY-b.top)/b.height*2);camera.updateMatrixWorld();raycaster.setFromCamera(ndc,camera);return raycaster.ray;}
 function pick(ray){let best=null;for(const site of sites){const centre=new THREE.Vector3(site.root[0],site.root[1]+site.height*.55,site.root[2]),scale=new THREE.Vector3(site.radius,site.height*.57,site.radius),o=ray.origin.clone().sub(centre).divide(scale),d=ray.direction.clone().divide(scale),a=d.lengthSq(),b=o.dot(d),c=o.lengthSq()-1,disc=b*b-a*c;if(disc<0)continue;const distance=(-b-Math.sqrt(disc))/a;if(distance<0||best&&best.distance<distance)continue;best={...site,distance,point:ray.at(distance,new THREE.Vector3())};}return best;}
 function select(hit){interaction.id=hit.id;interaction.root.fromArray(hit.root);interaction.height=hit.height;interaction.target.set(0,0);interaction.bend.set(0,0);interaction.velocity.set(0,0);stats.activeTree=hit.id;}
 function pointerDown(event,camera,canvas){if(event.button!==undefined&&event.button!==0)return false;const ray=makeRay(event,camera,canvas),hit=pick(ray);if(!hit)return false;select(hit);interaction.held=true;camera.getWorldDirection(cameraNormal);plane.setFromNormalAndCoplanarPoint(cameraNormal,hit.point);startPoint.copy(hit.point);lastPoint.copy(hit.point);stats.held=true;stats.dragCount++;return true;}
 function pointerMove(event,camera,canvas){const ray=makeRay(event,camera,canvas);if(interaction.held){if(ray.intersectPlane(plane,hitPoint)){const d=hitPoint.clone().sub(startPoint),scale=1.7/Math.max(.6,interaction.height);interaction.target.set(d.x*scale,d.z*scale);if(interaction.target.length()>.62)interaction.target.setLength(.62);lastPoint.copy(hitPoint);}return true;}
  if((event.buttons||0)!==0)return false;const hit=pick(ray);if(!hit||Math.abs(event.movementX||0)+Math.abs(event.movementY||0)<1)return false;
  if(interaction.id!==hit.id&&interaction.bend.length()<.025)select(hit);if(interaction.id===hit.id){const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),speed=clamp((event.movementX||0)/130,-.12,.12);interaction.velocity.x+=right.x*speed;interaction.velocity.y+=right.z*speed;stats.hoverCount++;}return false;
 }
 function pointerUp(){const was=interaction.held;interaction.held=false;interaction.target.set(0,0);stats.held=false;return was;}
 function update(dt=0){let remaining=clamp(Number(dt)||0,0,.10);while(remaining>0){const h=Math.min(1/120,remaining),omega=interaction.held?12:8.5,damping=interaction.held?.82:.46;interaction.velocity.addScaledVector(springDelta.copy(interaction.target).sub(interaction.bend),omega*omega*h).multiplyScalar(Math.exp(-2*damping*omega*h));interaction.bend.addScaledVector(interaction.velocity,h);remaining-=h;}if(interaction.bend.length()>.70){interaction.bend.setLength(.70);interaction.velocity.multiplyScalar(.3);}interaction.bend.toArray(stats.bend);stats.held=interaction.held;}
 return{uniforms,stats,pointerDown,pointerMove,pointerUp,update,pick,samplePoint,sampleBranchPoint,samplePerch,get sites(){return sites;},get interaction(){return interaction;},dispose(){pointerUp();interaction.id=null;interaction.bend.set(0,0);interaction.velocity.set(0,0);}};
}
