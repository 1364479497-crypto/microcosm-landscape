import * as THREE from 'three';
import {createSceneBirds} from './scene-birds.js';
import {createSceneButterflies} from './scene-butterflies.js';
import {createKingfisherPrey} from './kingfisher-prey.js';

// Aerial-life owner. Existing vegetation still owns its plants and legacy
// butterflies; we borrow their habitat data and suppress only the old draw.
export function createSceneFauna({terrain,vegetation,field,props,seed=42}={}) {
  if(!terrain?.height||!vegetation?.group)throw new Error('Aerial fauna needs the existing terrain and vegetation.');
  const initStart=performance.now();
  const group=new THREE.Group();group.name='Birds and flower-visiting butterflies';
  const birds=createSceneBirds({terrain,vegetation,field,seed,obstacles:props?.cabin?.group?[props.cabin.group]:[]});
  // The kingfisher's head/bill is rigid in the current authored mesh. These
  // centreline endpoints correspond to birdGeometry('kingfisher'), before its
  // species scale. Keep this small adapter paired with that anatomy contract.
  birds.getBillPoseAt=(time,index=birds.items.findIndex(item=>item.kind==='kingfisher'),state={})=>{
    const item=birds.items[index];
    if(!item||item.kind!=='kingfisher')throw new RangeError('Bill grip requires a kingfisher item.');
    const pose=birds.sampleAt(time,index,state),q=new THREE.Quaternion().fromArray(pose.quaternion),origin=new THREE.Vector3().fromArray(pose.position);
    const localBase=new THREE.Vector3(.39,.16,0).multiplyScalar(item.spec.scale),localTip=new THREE.Vector3(.89,.153,0).multiplyScalar(item.spec.scale);
    const base=localBase.clone().applyQuaternion(q).add(origin),tip=localTip.clone().applyQuaternion(q).add(origin),grip=base.clone().lerp(tip,.62);
    const period=birds.diagnostics.kingfisher.period,localTime=(((Number.isFinite(time)?time:0)+(item.shift||0))%period+period)%period;
    return {base:base.toArray(),tip:tip.toArray(),grip:grip.toArray(),forward:tip.clone().sub(base).normalize().toArray(),up:new THREE.Vector3(0,1,0).applyQuaternion(q).toArray(),quaternion:q.toArray(),billLength:base.distanceTo(tip),localTime,period,phase:pose.phase,visible:pose.visible,index,kind:item.kind};
  };
  const birdsReady=performance.now();
  const butterflies=createSceneButterflies({terrain,vegetation,field,seed});
  const butterfliesReady=performance.now();
  const prey=createKingfisherPrey({birds,terrain,seed});
  const preyReady=performance.now();
  group.add(birds.group,butterflies.group,prey.group);
  const legacyFlora=vegetation.group.userData.flora;
  const legacyGroup=legacyFlora?.group.getObjectByName('Eight flower-visiting paired-wing butterflies');
  let enabled=true,disposed=false,lastState=null,lastTime=0;
  const initialLegacyVisible=legacyGroup?.visible;
  const stats={birds:birds.stats,butterflies:butterflies.stats,prey:prey.stats,enabled:true,legacyButterfliesSuppressed:false,
    legacyOwnerSimulation:null,disposed:false,
    initializationMs:{birds:birdsReady-initStart,butterflies:butterfliesReady-birdsReady,prey:preyReady-butterfliesReady,total:preyReady-initStart}};
  function restoreLegacy() {
    if(!legacyGroup)return;
    // Re-evaluate the original owner's current seasonal/weather gate rather
    // than restoring a stale constructor-time visible flag after a time jump.
    if(lastState&&typeof legacyFlora.update==='function')legacyFlora.update(lastTime,lastState);
    else legacyGroup.visible=initialLegacyVisible;
    stats.legacyButterfliesSuppressed=false;
  }
  function update(dt=0,state={}) {
    if(disposed)return;
    lastState=state;lastTime=Number.isFinite(state.time)?state.time:lastTime+Math.max(0,Number(dt)||0);
    birds.update(dt,state);butterflies.update(dt,state);prey.update(dt,state);
    group.visible=enabled;stats.enabled=enabled;
    if(legacyGroup&&enabled){
      stats.legacyOwnerSimulation={flying:legacyFlora.stats.butterflyFlying,perched:legacyFlora.stats.butterflyPerched,
        note:'Computed by the unchanged old owner; these are not additional drawable butterflies.'};
      legacyGroup.visible=false;stats.legacyButterfliesSuppressed=true;
    }
  }
  return {group,birds,butterflies,prey,stats,update,
    setLakeSurfaceSampler(fn){birds.setLakeSurfaceSampler?.(fn);butterflies.setLakeSurfaceSampler?.(fn);prey.setLakeSurfaceSampler?.(fn);},
    setEnabled(value=true){if(disposed)return;enabled=!!value;group.visible=enabled;stats.enabled=enabled;if(!enabled)restoreLegacy();else if(legacyGroup){legacyGroup.visible=false;stats.legacyButterfliesSuppressed=true;}},
    dispose(){if(disposed)return;restoreLegacy();disposed=true;enabled=false;group.visible=false;stats.enabled=false;prey.dispose();birds.dispose();butterflies.dispose();group.removeFromParent();stats.disposed=true;}
  };
}
