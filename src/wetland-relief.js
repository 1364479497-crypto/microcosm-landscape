// Independently authored shoreline microrelief. The original fall, plunge
// pool, central channel and lake level remain the hydraulic datum owners.
// These small sediment tongues are part of the shared height field, never
// floating decorative planes hiding water or plant-root intersections.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
export const WETLAND_POCKETS=Object.freeze({
 creek:[[-2.30,-1,.19,.30],[-1.84,1,.18,.31],[-1.31,-1,.17,.26],[-.72,1,.20,.34],[-.12,-1,.20,.33],[.48,1,.24,.35],[1.05,-1,.24,.34]],
 lake:[[1.10,.97,.38,.29],[-.10,1.43,.32,.34],[3.54,2.03,.30,.38],[3.62,2.89,.30,.39],[3.18,3.83,.31,.30],[-.62,3.39,.30,.36]],
});
export function createWetlandRelief({lake,riverAt,lakeDistance,noise}){
 const pocket=(x,z,cx,cz,rx,rz)=>{
  const u=(x-cx)/rx,v=(z-cz)/rz,warp=(noise(x*11.7+3.1,z*10.1-4.7)-.5)*.34;
  return 1-smooth(.32,1.08,Math.hypot(u,v)+warp);
 };
 return (x,z,baseHeight)=>{
  let lift=0,soil=0,bank=0;
  if(z> -2.64&&z<1.58){
   const r=riverAt(z),q=Math.abs(x-r.x)/r.width;
   if(q>.66&&q<1.42&&r.poolWeight<.015&&baseHeight<r.y+.044){
    for(const [cz,side,rx,rz]of WETLAND_POCKETS.creek){
     if(Math.abs(z-cz)>rz*1.28)continue;const centre=riverAt(cz),cx=centre.x+side*centre.width*1.02;
     const w=pocket(x,z,cx,cz,rx,rz)*smooth(.66,.83,q)*(1-smooth(1.22,1.42,q));if(w<.002)continue;
     const crown=r.y+.030+(noise(x*18.1+5,z*17.9)-.5)*.034;
     lift=Math.max(lift,Math.max(0,crown-baseHeight)*w);soil=Math.max(soil,w);bank=Math.max(bank,w);
    }
   }
  }
  if(x>lake.x-lake.rx*1.14&&x<lake.x+lake.rx*1.14&&z>lake.z-lake.rz*1.14&&z<4.04){
   const q=lakeDistance(x,z),r=riverAt(Math.min(1.6,z)),flowCore=z<1.86&&Math.abs(x-r.x)<r.width*.88;
   const boat=x> -1.50&&x<.40&&z>1.70&&z<3.12;
   if(q>.75&&q<1.075&&!flowCore&&!boat&&baseHeight<lake.level+.028){
    for(const [cx,cz,rx,rz]of WETLAND_POCKETS.lake){
     if(Math.abs(x-cx)>rx*1.28||Math.abs(z-cz)>rz*1.28)continue;
     const w=pocket(x,z,cx,cz,rx,rz)*smooth(.75,.85,q)*(1-smooth(1.015,1.075,q));if(w<.002)continue;
     // Broad shallow apron, then a smaller irregular damp-soil crown.
     const target=lake.level-.014+w*.044+(noise(x*14.7-8,z*15.3+7)-.5)*.025;
     lift=Math.max(lift,Math.max(0,target-baseHeight)*w);soil=Math.max(soil,w);bank=Math.max(bank,w);
    }
   }
  }
  // Uplift is continuous, bounded, and never moves a previously dry bank.
  return {height:baseHeight+lift,wetlandLift:lift,wetlandSoil:soil,wetlandBank:bank};
 };
}
