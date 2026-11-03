// Case-level temperate mixed woodland. This is an authored habitat/composition
// model, not a claim that the miniature represents a surveyed geographic site.
const mix=(a,b,t)=>a+(b-a)*t;
function random(seed){let s=seed>>>0;return()=>{s+=0x6d2b79f5;let n=s;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}

export function forestExclusion(terrain,x,z,crown=.25){
 if(x< -5.55||x>5.55||z< -4.65||z>3.72)return true;
 const lake=terrain.lake;
 if(lake&&((x-lake.x)/(lake.rx+crown*.24+.10))**2+((z-lake.z)/(lake.rz+crown*.24+.10))**2<1)return true;
 if(z>-.45-crown*.25&&z<4.25&&x> -3.48-crown*.65&&x< -1.84+crown*.65)return true;
 if(x> -1.5&&x<.14&&z>1.7&&z<2.8)return true;
 if(z> -3.7&&z<2.0){
  const river=terrain.river?.sample?.(z);
  if(river&&Math.abs(x-river.x)<river.width+crown*.72+.17)return true;
 }
 return false;
}

export function createForestLayout(terrain,{seed=42,trees=[]}={}){
 const rng=random(seed^0x31967ea1),range=(a,b)=>mix(a,b,rng());
 const normalY=(x,z)=>{const n=terrain.normal(x,z);return n.y??n[1];};
 const typeFor=(x,z)=>{
  const y=terrain.height(x,z);
  // Birch occupies open brighter edges and stony shoulders, hornbeam the
  // sheltered lower woodland. Cherry remains a few existing edge accents.
  return Math.abs(x)>4.35||y>1.08&&normalY(x,z)>.84?1:0;
 };
 const result=trees.map(t=>({...t,source:'retained',juvenile:false,density:t.shrub?.85:1,
  species:t.type==='pine'?undefined:t.species===2?2:typeFor(t.x,t.z)}));
 const anchors=result.filter(t=>!t.shrub);
 const added=[];
 function candidate(anchor,type,juvenile=false,shrub=false){
  for(let attempt=0;attempt<42;attempt++){
   const angle=range(0,Math.PI*2),distance=range(shrub?.25:.40,shrub?.65:.91);
   const x=anchor.x+Math.cos(angle)*distance,z=anchor.z+Math.sin(angle)*distance;
   const h=shrub?range(.27,.43):juvenile?range(.53,.79):range(.92,1.19);
   const crown=h*(type==='pine'?.30:.40),y=terrain.height(x,z);
   if(forestExclusion(terrain,x,z,crown)||normalY(x,z)<(type==='pine'?.73:.82)||y<.25||y>(type==='pine'?2.32:1.55))continue;
   if(type==='pine'&&z>.45||type!=='pine'&&z< -2.05)continue;
   if(result.some(t=>Math.hypot(t.x-x,t.z-z)<(shrub?.22:juvenile?.31:.45)))continue;
   const tree={type,x,z,h,species:type==='pine'?undefined:typeFor(x,z),shrub,juvenile,
    density:shrub?.80:juvenile?.92:.92,source:'cluster',anchor:[anchor.x,anchor.z]};
   result.push(tree);added.push(tree);return true;
  }
  return false;
 }
 const conifers=anchors.filter(t=>t.type==='pine'),broad=anchors.filter(t=>t.type!=='pine');
 for(let i=0;i<conifers.length;i++){
  if(i%3===0)candidate(conifers[i],'pine');
  if(i%2===0)candidate(conifers[i],'pine',true);
 }
 for(let i=0;i<broad.length;i++){
  if(i%5===1)candidate(broad[i],'deciduous');
  if(i%3===0)candidate(broad[i],'deciduous',true);
  if(i%2===0)candidate(broad[i],'deciduous',false,true);
 }
 const counts={spruce:0,hornbeam:0,birch:0,cherry:0,juveniles:0,shrubs:0};
 for(const t of result){counts[t.type==='pine'?'spruce':t.species===1?'birch':t.species===2?'cherry':'hornbeam']++;if(t.juvenile)counts.juveniles++;if(t.shrub)counts.shrubs++;}
 return {trees:result,stats:{seed,retained:trees.length,added:added.length,total:result.length,...counts,
  distribution:'Grouped cool-slope spruce, sheltered lowland hornbeam, open-edge birch, sparse cherry accents; juvenile/understory layers.'}};
}
