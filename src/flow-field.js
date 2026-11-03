// Independently authored steady watershed approximation, in metres/seconds.
// The terrain owns the attached free-surface datum and the excavated channel.
// A*v=Q determines the mean velocity of each actual wet section; Manning-type
// drag and impact retention remain explicit empirical diagnostics. This is not
// a pressure-solving or obstacle-resolving three-dimensional fluid simulation.
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const length = a => Math.hypot(...a);
const normalize = a => { const m = length(a) || 1; return a.map(v => v / m); };
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const arrayLerp = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const finite = a => a.every(Number.isFinite);

function locate(list, value, key) {
  let lo = 0, hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (list[mid][key] <= value) lo = mid; else hi = mid;
  }
  const a = list[lo], b = list[hi];
  return [a, b, clamp((value - a[key]) / Math.max(1e-10, b[key] - a[key]))];
}

/**
 * Eight authored anchors are copied without mutation. Attached water follows
 * river.sample(z).y, including its C1 bed-following descents and pool datum.
 * sample(s) uses normalised 3-D arc length. Distances/times use metres/seconds.
 * sectionsAtDistance() exposes separate wet intervals around exposed rocks.
 */
export function createFlowField(terrain, options = {}) {
  if (!terrain?.river || terrain.river.length !== 8 || typeof terrain.height !== 'function') {
    throw new TypeError('createFlowField requires terrain.height and the eight existing river nodes');
  }
  const nodes = terrain.river.map(n => Array.isArray(n) ? n.slice(0, 3) : [n.x, n.y, n.z]);
  if (!nodes.every(finite) || nodes.some((n, i) => i && n[2] <= nodes[i - 1][2])) {
    throw new RangeError('River anchors must be finite and ordered downstream in +Z');
  }
  const requestedDivisions = Math.max(24, options.sectionDivisions ?? 48);
  const config = {
    gravity: options.gravity ?? 9.81,
    discharge: options.discharge ?? 0.0135,
    roughness: options.roughness ?? 0.105,
    sourceSpeed: options.sourceSpeed ?? 0.68,
    minimumClearance: options.minimumClearance ?? 0.003,
    surfaceLift: options.surfaceLift ?? 0.008,
    maximumStageRise: options.maximumStageRise ?? 0.027,
    channelWidthScale: options.channelWidthScale ?? 0.975,
    impactSpeedRetention: options.impactSpeedRetention ?? 0.12,
    sampleSpacing: options.sampleSpacing ?? 0.012,
    sectionDivisions: Math.ceil(requestedDivisions / 2) * 2,
  };
  const {gravity: g, discharge: Q, minimumClearance: skin, surfaceLift} = config;
  if (!(g > 0 && Q > 0 && skin > 0 && config.sampleSpacing > 0 && config.roughness > 0)) {
    throw new RangeError('Gravity, discharge, roughness, clearance and spacing must be positive');
  }
  const lakeLevel = terrain.lake?.level ?? nodes[7][1];
  // A monotone Hermite fallback is only needed by older terrain adapters. The
  // terrain's own y/dyDz always wins when supplied. The jet is a separate block.
  const fallbackSlopes = new Array(8).fill(0);
  for (const [first,last] of [[0,1],[2,7]]) {
    const h = [], d = [];
    for (let i=first;i<last;i++) { h[i]=nodes[i+1][2]-nodes[i][2];d[i]=(nodes[i+1][1]-nodes[i][1])/h[i]; }
    fallbackSlopes[first]=d[first];fallbackSlopes[last]=d[last-1];
    for (let i=first+1;i<last;i++) {
      const a=d[i-1],b=d[i],w0=2*h[i]+h[i-1],w1=h[i]+2*h[i-1];
      fallbackSlopes[i]=a*b<=0?0:(w0+w1)/(w0/a+w1/b);
    }
  }
  const riverPlan = z => {
    const found = terrain.river.sample?.(z);
    let i=0;while(i<6&&z>nodes[i+1][2])i++;
    const a=nodes[i],b=nodes[i+1],h=b[2]-a[2],t=clamp((z-a[2])/h),t2=t*t,t3=t2*t;
    const before=nodes[Math.max(0,i-1)],after=nodes[Math.min(7,i+2)];
    const m0=(b[0]-before[0])*.5,m1=(after[0]-a[0])*.5;
    const y=i===1?lerp(a[1],b[1],t):(2*t3-3*t2+1)*a[1]+(t3-2*t2+t)*h*fallbackSlopes[i]+(-2*t3+3*t2)*b[1]+(t3-t2)*h*fallbackSlopes[i+1];
    return {
      x:Number.isFinite(found?.x)?found.x:(2*t3-3*t2+1)*a[0]+(t3-2*t2+t)*m0+(-2*t3+3*t2)*b[0]+(t3-t2)*m1,
      y:Number.isFinite(found?.y)?found.y:y,
      width:Math.max(.02,Number.isFinite(found?.width)?found.width:lerp(.195,.37,clamp((z-nodes[0][2])/(nodes[7][2]-nodes[0][2])))),
      poolWeight:clamp(found?.poolWeight ?? 0),
    };
  };
  const sideAt = z => {
    const e=.001,za=clamp(z-e,nodes[0][2],nodes[7][2]),zb=clamp(z+e,nodes[0][2],nodes[7][2]);
    return normalize([-(zb-za),0,riverPlan(zb).x-riverPlan(za).x]);
  };
  const profileAt = p => {
    const side=sideAt(p[2]),half=riverPlan(p[2]).width*config.channelWidthScale,offsets=[],beds=[];
    for(let i=0;i<=config.sectionDivisions;i++) {
      const off=(i/config.sectionDivisions*2-1)*half;
      offsets.push(off);beds.push(terrain.height(p[0]+side[0]*off,p[2]+side[2]*off));
    }
    if(!finite(beds))throw new RangeError('Terrain returned a non-finite river section');
    return {center:p,side,half,offsets,beds,bedHeight:terrain.height(p[0],p[2])};
  };
  const areaAt = (profile,stage) => {
    let area=0;
    for(let i=0;i<profile.beds.length-1;i++) {
      const a=stage-profile.beds[i],b=stage-profile.beds[i+1],dx=profile.offsets[i+1]-profile.offsets[i];
      if(a>0&&b>0)area+=(a+b)*dx*.5;
      else if(a>0)area+=.5*a*dx*a/(a-b);
      else if(b>0)area+=.5*b*dx*b/(b-a);
    }
    return Math.max(area,1e-7);
  };
  const intervalsAt = (profile,stage) => {
    const intervals=[];
    for(let i=0;i<profile.beds.length-1;i++) {
      const x0=profile.offsets[i],x1=profile.offsets[i+1],a=stage-skin-profile.beds[i],b=stage-skin-profile.beds[i+1];
      if(a<0&&b<0)continue;
      let lo=x0,hi=x1;
      if(a<0)lo=lerp(x0,x1,-a/(b-a));
      if(b<0)hi=lerp(x0,x1,a/(a-b));
      if(hi-lo<1e-8)continue;
      const depthAt=x=>stage-lerp(profile.beds[i],profile.beds[i+1],(x-x0)/(x1-x0));
      const area=(depthAt(lo)+depthAt(hi))*(hi-lo)*.5,last=intervals[intervals.length-1];
      if(last&&lo-last.maxOffset<1e-7) {last.maxOffset=hi;last.width=hi-last.minOffset;last.area+=area;}
      else intervals.push({minOffset:lo,maxOffset:hi,width:hi-lo,area});
    }
    return intervals;
  };

  // Only the steep unsupported authored drop becomes a free jet. The lower
  // descent remains attached to its smooth excavated chute.
  const fallSegments=[];
  for(let i=0;i<7;i++) {
    const a=nodes[i],b=nodes[i+1],horizontal=Math.hypot(b[0]-a[0],b[2]-a[2]);
    if(a[1]-b[1]>.65&&(a[1]-b[1])/horizontal>2.2)fallSegments.push(i);
  }
  const falls=fallSegments.map((segment,index)=>{
    const start=nodes[segment].slice(),end=nodes[segment+1].slice();
    start[1]+=surfaceLift;end[1]+=surfaceLift;
    const profile=profileAt(start),width=profile.half*2,lipSpeed=Q/areaAt(profile,start[1]);
    const H=start[1]-end[1],L=Math.hypot(end[0]-start[0],end[2]-start[2]);
    const minimumSpeed=Math.sqrt(g*(Math.hypot(H,L)-H));
    const initialSpeed=Math.max(lipSpeed,minimumSpeed*1.025);
    const discriminant=Math.max(0,(g*H+initialSpeed**2)**2-g*g*(L*L+H*H));
    const duration=Math.sqrt((g*H+initialSpeed**2-Math.sqrt(discriminant))/(.5*g*g));
    const horizontalSpeed=L/duration,verticalSpeed=Math.max(0,H/duration-.5*g*duration);
    const horizontalDirection=[(end[0]-start[0])/L,0,(end[2]-start[2])/L];
    return {
      index,startIndex:segment,endIndex:segment+1,start,end,height:H,duration,entrySpeed:horizontalSpeed,
      entryVerticalSpeed:verticalSpeed,initialSpeed:Math.hypot(horizontalSpeed,verticalSpeed),
      exitSpeed:Math.hypot(horizontalSpeed,verticalSpeed+g*duration),width,halfWidth:width*.5,discharge:Q,gravity:g,
      speedAtTime(t){t=clamp(t,0,duration);return Math.hypot(horizontalSpeed,verticalSpeed+g*t);},
      sampleAtTime(t){
        t=clamp(t,0,duration);const u=t/duration;
        const position=[lerp(start[0],end[0],u),start[1]-verticalSpeed*t-.5*g*t*t,lerp(start[2],end[2],u)];
        const velocity=[horizontalDirection[0]*horizontalSpeed,-verticalSpeed-g*t,horizontalDirection[2]*horizontalSpeed];
        const speed=length(velocity),sheetWidth=width*(1-.10*smooth(0,1,u));
        return {position,velocity,tangent:normalize(velocity),side:normalize([-horizontalDirection[2],0,horizontalDirection[0]]),
          speed,fallSpeed:speed,fallIndex:index,fallWeight:1,fallAge:t,fallTime:duration,depth:Q/(speed*sheetWidth),
          width:sheetWidth,wetWidth:sheetWidth,halfWidth:sheetWidth*.5,leftWidth:sheetWidth*.5,rightWidth:sheetWidth*.5,area:Q/speed,discharge:Q};
      },
    };
  });
  const mouthWeightAt=z=>smooth(nodes[6][2]-.18,nodes[7][2],z);
  const raw=[];
  for(let segment=0;segment<7;segment++) {
    const a=nodes[segment],b=nodes[segment+1],fall=falls.find(f=>f.startIndex===segment);
    const count=Math.max(20,Math.ceil(distance(a,b)/config.sampleSpacing));
    for(let j=segment===0?0:1;j<=count;j++) {
      const t=j/count,z=lerp(a[2],b[2],t),plan=riverPlan(z),backwater=mouthWeightAt(z);
      // This is a water-level datum, not the bottom of an extruded water slab.
      // Excavating a deep pool therefore increases depth/area and slows Q/A;
      // an emergent stone becomes a dry interval instead of raising the river.
      const stage=Math.max(lakeLevel,lerp(plan.y+surfaceLift,lakeLevel,backwater));
      let position=[plan.x,stage,z],fallData=null;
      if(fall){fallData=fall.sampleAtTime(t*fall.duration);position=fallData.position.slice();}
      raw.push({segment,t,position,authoredY:plan.y,fallData,isJet:!!fall&&j<count,impact:!!fall&&j===count,poolWeight:plan.poolWeight,backwater});
    }
  }
  for(const fall of falls) {
    const lip=raw.find(r=>Math.abs(r.position[2]-fall.start[2])<1e-8);
    if(lip){lip.fallData=fall.sampleAtTime(0);lip.isJet=true;lip.position=fall.start.slice();}
  }
  // The supplied monotone C1 datum normally needs no correction. This guard
  // only prevents a malformed older adapter from sending attached water uphill;
  // it never lifts a section to clear a rock or fill an excavated plunge basin.
  let maximumDatumCorrection=0;
  for(let i=1;i<raw.length;i++) {
    const r=raw[i];if(r.isJet||r.impact)continue;
    const bounded=Math.min(r.position[1],raw[i-1].position[1]);
    maximumDatumCorrection=Math.max(maximumDatumCorrection,r.position[1]-bounded);r.position[1]=bounded;
  }
  for(const r of raw)r.profile=profileAt(r.position);

  let totalLength=0,totalTravelTime=0,previousSpeed=config.sourceSpeed;
  const sampleSections=[];
  const samples=raw.map((r,i)=>{
    const jet=r.isJet?r.fallData:null,position=r.position.slice(),profile=r.profile;
    const wetIntervals=jet?[{minOffset:-jet.leftWidth,maxOffset:jet.rightWidth,width:jet.width,area:jet.area}]:intervalsAt(profile,position[1]);
    const area=jet?jet.area:areaAt(profile,position[1]),speed=jet?jet.speed:Q/area;
    const leftWidth=wetIntervals.length?Math.max(0,-wetIntervals[0].minOffset):0;
    const rightWidth=wetIntervals.length?Math.max(0,wetIntervals[wetIntervals.length-1].maxOffset):0;
    const width=Math.max(.0001,leftWidth+rightWidth),wetWidth=Math.max(.0001,wetIntervals.reduce((sum,w)=>sum+w.width,0));
    const depth=jet?jet.depth:Math.max(0,position[1]-profile.bedHeight),ds=i?distance(raw[i-1].position,position):0;
    let dragPrediction=previousSpeed;
    if(i&&!jet) {
      const previous=raw[i-1],previousDepth=Math.max(.008,previous.position[1]-previous.profile.bedHeight);
      const radius=previousDepth*wetWidth/(wetWidth+2*previousDepth),resistance=g*config.roughness**2/Math.max(.008,radius)**(4/3);
      const attenuation=Math.exp(-2*resistance*Math.max(.001,ds));
      const slope=Math.max(0,(previous.position[1]-position[1])/Math.max(.001,ds));
      dragPrediction=Math.sqrt(Math.max(.055**2,previousSpeed**2*attenuation+g*slope/resistance*(1-attenuation)));
      if(r.impact)dragPrediction=r.fallData.speed*config.impactSpeedRetention;
    }
    if(i){
      totalLength+=ds;
      if(r.fallData&&raw[i-1].fallData&&r.fallData.fallIndex===raw[i-1].fallData.fallIndex)totalTravelTime+=r.fallData.fallAge-raw[i-1].fallData.fallAge;
      else {const prevArea=raw[i-1].isJet?raw[i-1].fallData.area:areaAt(raw[i-1].profile,raw[i-1].position[1]);totalTravelTime+=ds*(prevArea+area)*.5/Q;}
    }
    let before=i>0?raw[i-1].position:position,after=i<raw.length-1?raw[i+1].position:position;
    if(!jet){if(i>0&&raw[i-1].isJet)before=position;if(i<raw.length-1&&raw[i+1].isJet)after=position;}
    const tangent=jet?jet.tangent:normalize(after.map((v,k)=>v-before[k]));
    const horizontal=Math.max(1e-7,Math.hypot(tangent[0],tangent[2]));
    const normal=normalize([-tangent[1]*tangent[0]/horizontal,horizontal,-tangent[1]*tangent[2]/horizontal]);
    previousSpeed=speed;
    const sample={position,tangent,side:jet?jet.side:profile.side,normal,distance:totalLength,s:0,travelTime:totalTravelTime,
      speed,velocity:tangent.map(v=>v*speed),depth,hydraulicDepth:area/wetWidth,halfWidth:width*.5,leftWidth,rightWidth,width,wetWidth,
      area,discharge:Q,bedHeight:profile.bedHeight,clearance:position[1]-profile.bedHeight,centerWet:depth>=skin?1:0,
      slope:Math.max(0,-tangent[1]/horizontal),fallWeight:jet?1:0,fallIndex:jet?jet.fallIndex:-1,
      ballisticIndex:r.fallData?.fallIndex??-1,fallAge:r.fallData?.fallAge??0,
      fallTime:jet?falls[jet.fallIndex].duration:0,fallSpeed:r.fallData?.speed??0,impact:r.impact?1:0,
      energyHead:position[1]+speed*speed/(2*g),froude:speed/Math.sqrt(g*Math.max(.001,area/wetWidth)),
      sourceSegment:r.segment,backwater:r.backwater,poolWeight:r.poolWeight,dragPrediction,
      dragRelativeResidual:(speed-dragPrediction)/Math.max(.01,dragPrediction),sampleIndex:i};
    sampleSections.push({center:sample,wetIntervals,leftWidth,rightWidth,width,wetWidth,area});
    return sample;
  });
  samples.forEach(s=>s.s=s.distance/totalLength);
  for(const fall of falls) {
    const start=samples.find(s=>Math.abs(s.position[2]-fall.start[2])<1e-8),end=samples.find(s=>Math.abs(s.position[2]-fall.end[2])<1e-8);
    Object.assign(fall,{startDistance:start.distance,endDistance:end.distance,startTravelTime:start.travelTime,endTravelTime:end.travelTime});
  }
  const interpolate=(a,b,t)=>{
    const result={};
    for(const key of Object.keys(a)) {
      if(Array.isArray(a[key]))result[key]=arrayLerp(a[key],b[key],t);
      else if(typeof a[key]==='number')result[key]=lerp(a[key],b[key],t);
    }
    const discrete=t<.5?a:b;
    result.fallIndex=discrete.fallIndex;result.fallWeight=discrete.fallWeight;result.sourceSegment=discrete.sourceSegment;result.sampleIndex=discrete.sampleIndex;
    // Keep arbitrary queries on the same exact ballistic trajectory as the
    // sheet, rather than linearly interpolating a falling particle's height.
    if(a.ballisticIndex>=0&&a.ballisticIndex===b.ballisticIndex&&a.fallWeight&&t<1) {
      const jet=falls[a.ballisticIndex].sampleAtTime(lerp(a.fallAge,b.fallAge,t));Object.assign(result,jet);
    }
    result.tangent=normalize(result.tangent);result.side=normalize(result.side);
    const h=Math.max(1e-7,Math.hypot(result.tangent[0],result.tangent[2]));
    result.normal=normalize([-result.tangent[1]*result.tangent[0]/h,h,-result.tangent[1]*result.tangent[2]/h]);
    result.area=Q/result.speed;result.discharge=Q;result.hydraulicDepth=result.area/Math.max(.0001,result.wetWidth);
    result.velocity=result.tangent.map(v=>v*result.speed);
    return result;
  };
  const sampleAtDistance=d=>{const [a,b,t]=locate(samples,clamp(d,0,totalLength),'distance');return interpolate(a,b,t);};
  const sampleAtTime=(t,wrap=true)=>{
    const seconds=wrap?((t%totalTravelTime)+totalTravelTime)%totalTravelTime:clamp(t,0,totalTravelTime);
    const [a,b,u]=locate(samples,seconds,'travelTime');return interpolate(a,b,u);
  };
  const rowSections=new Map(samples.map((s,i)=>[s.distance.toFixed(7),sampleSections[i]])),sectionCache=new Map();
  const sectionsAtDistance=d=>{
    d=clamp(d,0,totalLength);const key=d.toFixed(7);
    if(rowSections.has(key))return rowSections.get(key);
    if(sectionCache.has(key))return sectionCache.get(key);
    const [a,b,t]=locate(samples,d,'distance'),center=interpolate(a,b,t);
    let wetIntervals;
    if(center.fallWeight)wetIntervals=[{minOffset:-center.leftWidth,maxOffset:center.rightWidth,width:center.width,area:center.area}];
    else {
      // Interpolate the cached terrain sections. Moving foam makes only its
      // one actual terrain-height query below, not 49 geology queries per dot.
      const pa=raw[a.sampleIndex].profile,pb=raw[b.sampleIndex].profile;
      wetIntervals=intervalsAt({offsets:arrayLerp(pa.offsets,pb.offsets,t),beds:arrayLerp(pa.beds,pb.beds,t)},center.position[1]);
    }
    const result={center,wetIntervals,leftWidth:center.leftWidth,rightWidth:center.rightWidth,width:center.width,
      wetWidth:wetIntervals.reduce((sum,w)=>sum+w.width,0),area:center.area};
    sectionCache.set(key,result);if(sectionCache.size>256)sectionCache.delete(sectionCache.keys().next().value);
    return result;
  };
  const crossSectionAtDistance=(d,lateral=0,centerHint=null)=>{
    d=clamp(d,0,totalLength);
    const fixed=rowSections.get(d.toFixed(7));
    const center=centerHint&&Math.abs(centerHint.distance-d)<1e-7?centerHint:fixed?.center??sampleAtDistance(d);
    // Mesh rows use their exact interval list. Animated particles only need
    // their single actual height/clearance test; a nearby cached row supplies
    // a branch label without resampling and allocating a complete section.
    const wetIntervals=fixed?.wetIntervals??sampleSections[center.sampleIndex].wetIntervals;
    const l=clamp(lateral,-1,1);
    const offset=l*(l<0?center.leftWidth:center.rightWidth);
    const x=center.position[0]+center.side[0]*offset,z=center.position[2]+center.side[2]*offset,bedHeight=terrain.height(x,z);
    const depth=center.fallWeight?center.depth:Math.max(0,center.position[1]-bedHeight);
    // Never project a dry island point back toward the centre: that folds a
    // triangle across the stone. Consumers omit dry vertices/crossing faces.
    const wet=!!center.fallWeight||depth>=skin*.99;
    const intervalIndex=wet?wetIntervals.findIndex(w=>offset>=w.minOffset-.001&&offset<=w.maxOffset+.001):-1;
    return {position:[x,center.position[1],z],normal:center.normal.slice(),lateral:l,offset,wet,intervalIndex,
      depth,bedHeight,clearance:center.position[1]-bedHeight,speed:center.speed,distance:center.distance,halfWidth:center.halfWidth,
      edgeFade:wet?smooth(skin,skin+.016,depth):0,center};
  };
  const last=samples[samples.length-1],mouth={
    startDistance:samples.find(s=>s.backwater>0)?.distance??totalLength,
    exit:{position:[last.position[0],lakeLevel,last.position[2]],tangent:normalize([last.tangent[0],0,last.tangent[2]]),
      speed:last.speed,travelTime:last.travelTime,width:last.width,wetWidth:last.wetWidth,distance:last.distance},
  };
  let minimumBedClearance=Infinity,minimumWetClearance=Infinity,maxFluxRelativeError=0,maxPotentialRise=0,maxAttachedEnergyRise=0,maximumWetIntervals=0;
  let finiteSamples=true;
  for(let i=0;i<samples.length;i++) {
    const s=samples[i];finiteSamples&&=Object.values(s).every(v=>Array.isArray(v)?finite(v):Number.isFinite(v));
    maxFluxRelativeError=Math.max(maxFluxRelativeError,Math.abs(s.area*s.speed-Q)/Q);minimumBedClearance=Math.min(minimumBedClearance,s.clearance);
    if(s.centerWet)minimumWetClearance=Math.min(minimumWetClearance,s.clearance);
    maximumWetIntervals=Math.max(maximumWetIntervals,sampleSections[i].wetIntervals.length);
    if(i){maxPotentialRise=Math.max(maxPotentialRise,s.position[1]-samples[i-1].position[1]);
      if(!s.fallWeight&&!samples[i-1].fallWeight&&!s.impact)maxAttachedEnergyRise=Math.max(maxAttachedEnergyRise,s.energyHead-samples[i-1].energyHead);}
  }
  const pool=terrain.pool??terrain.river.pool,poolSamples=pool?samples.filter(s=>Math.hypot((s.position[0]-pool.x)/pool.rx,(s.position[2]-pool.z)/pool.rz)<1&&!s.fallWeight):[];
  const diagnostics={finite:finiteSamples,nodeCount:nodes.length,sampleCount:samples.length,freeFallCount:falls.length,
    minimumBedClearance,minimumWetClearance,maxFluxRelativeError,maxPotentialRise,maxAttachedEnergyRise,maximumDatumCorrection,maximumWetIntervals,
    speedRange:[Math.min(...samples.map(s=>s.speed)),Math.max(...samples.map(s=>s.speed))],
    depthRange:[Math.min(...samples.map(s=>s.depth)),Math.max(...samples.map(s=>s.depth))],
    poolDepthRange:poolSamples.length?[Math.min(...poolSamples.map(s=>s.depth)),Math.max(...poolSamples.map(s=>s.depth))]:[0,0],
    mouthLevelError:Math.abs(last.position[1]-lakeLevel),
    fallChecks:falls.map(f=>({index:f.index,duration:f.duration,height:f.height,
      gravityError:Math.abs(f.entryVerticalSpeed*f.duration+.5*g*f.duration**2-f.height),
      finalSpeedError:Math.abs(f.exitSpeed**2-f.initialSpeed**2-2*g*f.height)})),
    approximation:'Prescribed C1 attached water datum; sampled wet-section continuity A*v=Q; diagnostic Manning-type drag; fixed-head lake mouth; exact ballistic primary fall.',
    empiricalParameters:['roughness','impactSpeedRetention','channelWidthScale','surfaceLift','sourceSpeed','sampleSpacing','sectionDivisions'],
    gravity:g,config:{...config}};
  return {nodes,samples,falls,mouth,totalLength,totalTravelTime,discharge:Q,config,diagnostics,
    sample:s=>sampleAtDistance(clamp(s)*totalLength),sampleAtDistance,sampleAtTime,crossSectionAtDistance,sectionsAtDistance};
}
