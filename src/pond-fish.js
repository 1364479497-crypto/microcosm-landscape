import * as THREE from 'three';

// Independently authored pond fishes. Morphology is informed by FAO,
// USGS/FWS and actual photographs; no photograph, downloaded mesh or third-
// party fish generator is used at runtime. These are miniature scene units.
const TAU=Math.PI*2,UP=new THREE.Vector3(0,1,0),clamp=THREE.MathUtils.clamp,mix=THREE.MathUtils.lerp;
const random=seed=>{let s=seed>>>0;return()=>{s+=0x6d2b79f5;let a=s;a=Math.imul(a^(a>>>15),a|1);a^=a+Math.imul(a^(a>>>7),a|61);return((a^(a>>>14))>>>0)/4294967296;};};
export const POND_FISH_SPECIES=Object.freeze([
 Object.freeze({id:'silver',zh:'鲢鱼',scientific:'Hypophthalmichthys molitrix',length:[.235,.275],height:.134,width:.058,head:.245,eyeX:.355,eyeY:-.031,scales:99,rows:18,layer:.22,depthMeaning:'upper water preference',back:0x627c70,side:0xb8c9c1,belly:0xd5d8c8,fin:0x7c9988,mottled:false}),
 Object.freeze({id:'bighead',zh:'鳙鱼',scientific:'Hypophthalmichthys nobilis',length:[.285,.335],height:.132,width:.069,head:.315,eyeX:.360,eyeY:-.043,scales:105,rows:18,layer:.43,depthMeaning:'upper to middle water preference; overlaps silver',back:0x4c5e58,side:0xa3b0a7,belly:0xccd0bc,fin:0x667d70,mottled:true}),
 Object.freeze({id:'grass',zh:'草鱼',scientific:'Ctenopharyngodon idella',length:[.265,.315],height:.105,width:.061,head:.23,eyeX:.370,eyeY:.028,scales:43,rows:12,layer:.63,depthMeaning:'middle/lower water near vegetation',back:0x52664a,side:0xa6ad7d,belly:0xcbd1b1,fin:0x6d7d51,mottled:false}),
 Object.freeze({id:'black',zh:'青鱼',scientific:'Mylopharyngodon piceus',length:[.295,.345],height:.097,width:.056,head:.24,eyeX:.377,eyeY:.024,scales:42,rows:12,layer:.84,depthMeaning:'benthic preference with real bottom clearance',back:0x343f3c,side:0x69786c,belly:0xaeb8a0,fin:0x4c5a4d,mottled:false}),
 Object.freeze({id:'redcarp',zh:'红鲤鱼',scientific:'Cyprinus carpio (red ornamental form)',length:[.265,.305],height:.142,width:.074,head:.225,eyeX:.382,eyeY:.030,scales:36,rows:12,layer:.55,count:2,depthMeaning:'middle/lower cruising; red domesticated common carp, not a grass-carp recolour',back:0x8f3223,side:0xca512e,belly:0xe6b17b,fin:0xbd603d,mottled:false}),
 Object.freeze({id:'crucian',zh:'鲫鱼',scientific:'Carassius auratus (wild body form)',length:[.182,.218],height:.176,width:.063,head:.215,eyeX:.387,eyeY:.035,scales:29,rows:10,layer:.77,count:3,depthMeaning:'lower vegetated pond cruising with occasional shallower excursions',back:0x58614a,side:0xa5aa82,belly:0xd0d0b0,fin:0x7d8365,mottled:false}),
 Object.freeze({id:'sharpbelly',zh:'白条鱼',scientific:'Hemiculter leucisculus',length:[.107,.133],height:.100,width:.036,head:.205,eyeX:.400,eyeY:.009,scales:49,rows:10,layer:.105,count:7,depthMeaning:'small upper-water cruising school; individual tail phases and loose offsets',back:0x687e77,side:0xc4cec7,belly:0xd9dece,fin:0x9eaf97,mottled:false}),
]);

class Shape {
 constructor(){this.p=[];this.uv=[];this.part=[];this.fin=[];this.i=[];}
 vertex(p,uv=[0,0],part=0,fin=[0,0,0]){const n=this.p.length/3;this.p.push(...p);this.uv.push(...uv);this.part.push(part);this.fin.push(...fin);return n;}
 tri(a,b,c){this.i.push(a,b,c);}
 append(g,part,matrix=new THREE.Matrix4()){const p=g.attributes.position,uv=g.attributes.uv,base=this.p.length/3,v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(matrix);this.vertex(v.toArray(),uv?[uv.getX(i),uv.getY(i)]:[0,0],part);}const ix=g.index;if(ix)for(let i=0;i<ix.count;i++)this.i.push(base+ix.getX(i));else for(let i=0;i<p.count;i++)this.i.push(base+i);g.dispose();}
 geometry(name){const g=new THREE.BufferGeometry();g.name=name;g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));g.setAttribute('aFishPart',new THREE.Float32BufferAttribute(this.part,1));g.setAttribute('aFishFin',new THREE.Float32BufferAttribute(this.fin,3));g.setIndex(this.i);g.computeVertexNormals();g.computeBoundingSphere();return g;}
}
// Interpolated radii define a species silhouette, including the head and
// narrow caudal peduncle. The eye is placed on that actual surface.
// Monotone cubic sections keep a continuous shoulder: easing each adjacent
// pair separately made every sample a small flat/round "bead" under grazing light.
const SILHOUETTES=Object.freeze({
 silver:[[-.34,.14,.19],[-.27,.25,.35],[-.16,.53,.64],[-.02,.88,.91],[.12,1,1],[.26,.84,.87],[.38,.57,.68],[.46,.31,.41],[.50,.24,.31]],
 bighead:[[-.34,.15,.20],[-.27,.26,.36],[-.16,.54,.63],[-.02,.88,.89],[.12,1,1],[.26,.96,1.01],[.38,.73,.89],[.46,.46,.53],[.50,.32,.42]],
 grass:[[-.34,.17,.22],[-.27,.30,.42],[-.16,.59,.71],[-.02,.91,.94],[.12,1,1],[.26,.86,.87],[.38,.55,.62],[.46,.28,.36],[.50,.19,.25]],
 black:[[-.34,.18,.24],[-.27,.31,.43],[-.16,.61,.72],[-.02,.93,.95],[.12,1,1],[.26,.83,.86],[.38,.48,.55],[.46,.24,.29],[.50,.15,.20]],
 redcarp:[[-.34,.15,.22],[-.27,.28,.38],[-.16,.61,.72],[-.02,.93,.98],[.12,1,1],[.24,.94,.94],[.34,.82,.85],[.41,.68,.73],[.46,.49,.56],[.485,.35,.43],[.50,.27,.35]],
 crucian:[[-.34,.15,.21],[-.27,.34,.41],[-.16,.72,.76],[-.02,1,1],[.12,.99,.97],[.25,.87,.88],[.36,.70,.74],[.43,.51,.58],[.475,.34,.41],[.50,.25,.31]],
 sharpbelly:[[-.34,.16,.21],[-.25,.32,.38],[-.12,.70,.73],[.06,1,1],[.22,.93,.86],[.35,.60,.58],[.44,.31,.31],[.50,.17,.22]],
});
function smoothSection(table,x,channel){
 let j=1;while(j<table.length-1&&x>table[j][0])j++;
 const a=table[j-1],b=table[j],h=b[0]-a[0],t=clamp((x-a[0])/h,0,1),d=(b[channel]-a[channel])/h;
 const slope=k=>{if(k===0)return(table[1][channel]-table[0][channel])/(table[1][0]-table[0][0]);if(k===table.length-1)return(table[k][channel]-table[k-1][channel])/(table[k][0]-table[k-1][0]);const h0=table[k][0]-table[k-1][0],h1=table[k+1][0]-table[k][0],d0=(table[k][channel]-table[k-1][channel])/h0,d1=(table[k+1][channel]-table[k][channel])/h1;if(d0*d1<=0)return 0;const w0=2*h1+h0,w1=h1+2*h0;return(w0+w1)/(w0/d0+w1/d1);};
 const ma=slope(j-1),mb=slope(j),t2=t*t,t3=t2*t;
 return(2*t3-3*t2+1)*a[channel]+(t3-2*t2+t)*h*ma+(-2*t3+3*t2)*b[channel]+(t3-t2)*h*mb;
}
function profile(spec,x){
 const table=SILHOUETTES[spec.id],h=smoothSection(table,x,1)*spec.height,w=smoothSection(table,x,2)*spec.width;
 // Sharpbelly has a straighter back and fuller ventral contour; the other
 // cyprinids have an arched shoulder and a distinct, tapered scaleless head.
 const center=spec.id==='sharpbelly'?.033-h*.78:spec.id==='redcarp'?-.008*Math.exp(-(((x-.39)/.12)**2)):spec.id==='bighead'?-.008*Math.exp(-(((x-.34)/.13)**2)):0;
 return{h,w,center};
}
function tube(shape,points,radius,part){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));shape.append(new THREE.TubeGeometry(curve,14,radius,4,false),part);}
function bodyGeometry(spec){
 const small=spec.id==='sharpbelly',s=new Shape(),rings=small?36:54,sides=small?18:26;
 for(let j=0;j<=rings;j++){const x=mix(-.34,.50,j/rings),r=profile(spec,x);for(let k=0;k<=sides;k++){const a=k/sides*TAU,keel=(spec.id==='silver'&&x>-.27&&x<.32||spec.id==='bighead'&&x>-.25&&x<-.03||small&&x>-.25&&x<.29)?Math.max(0,1-Math.abs(Math.cos(a))/.28)*Math.max(0,-Math.sin(a))*(small?.006:.009):0;s.vertex([x,r.center+Math.sin(a)*r.h-keel,Math.cos(a)*r.w],[j/rings,k/sides],0);}}
 for(let j=0;j<rings;j++)for(let k=0;k<sides;k++){const a=j*(sides+1)+k,b=a+sides+1;s.tri(a,b,a+1);s.tri(a+1,b,b+1);}
 for(const [j,x,reverse]of [[0,-.341,false],[rings,.501,true]]){const c=s.vertex([x,profile(spec,x).center,0],[j/rings,.5],0);for(let k=0;k<sides;k++){const a=j*(sides+1)+k,b=a+1;reverse?s.tri(c,b,a):s.tri(c,a,b);}}
 for(const sign of [-1,1]){
  const r=profile(spec,spec.eyeX),y=spec.eyeY,z=sign*(r.w*Math.sqrt(Math.max(.1,1-((y-r.center)/r.h)**2))+.0015),radius=spec.id==='bighead'?.012:small?.014:.0105;
  s.append(new THREE.SphereGeometry(radius,12,8),2,new THREE.Matrix4().compose(new THREE.Vector3(spec.eyeX,y,z),new THREE.Quaternion(),new THREE.Vector3(1,1,.38)));
  s.append(new THREE.SphereGeometry(radius*.59,12,8),3,new THREE.Matrix4().compose(new THREE.Vector3(spec.eyeX+.001,y,z+sign*.0034),new THREE.Quaternion(),new THREE.Vector3(1,1,.22)));
  const gx=.5-spec.head,p=[];
  for(let k=0;k<=9;k++){const a=mix(-1.05,1.05,k/9),x=gx-.015*Math.cos(a),gr=profile(spec,x),fraction=Math.sin(a)*.86;p.push([x,gr.center+fraction*gr.h,sign*(Math.sqrt(1-fraction*fraction)*gr.w+.001)]);}tube(s,p,.00125,4);
 }
 const mouthY=small?.022:spec.id==='redcarp'?-.018:spec.id==='silver'||spec.id==='bighead'?-.005:-.011,mouthW=spec.id==='bighead'?.026:spec.id==='silver'?.020:spec.id==='black'?.009:small?.008:.012;
 // A small dark mouth aperture and continuous fleshy lip, rather than a
 // line pasted on a flat nose. Barbels remain common-carp-only organs.
 const mouthH=spec.id==='bighead'?.013:spec.id==='silver'?.010:small?.0055:.0065;
 s.append(new THREE.SphereGeometry(1,14,10),6,new THREE.Matrix4().compose(new THREE.Vector3(.502,mouthY,0),new THREE.Quaternion(),new THREE.Vector3(.0015,mouthH,mouthW)));
 tube(s,Array.from({length:19},(_,i)=>{const a=i/18*TAU;return[.503+Math.sin(a)*.001,mouthY+Math.sin(a)*mouthH,Math.cos(a)*mouthW];}),small?.0010:spec.id==='redcarp'?.0023:.0016,5);
 for(const sign of[-1,1]){const x=.454,pr=profile(spec,x),y=pr.center+pr.h*.35,z=sign*pr.w*.92;s.append(new THREE.SphereGeometry(.0026,7,5),7,new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(1,.65,.35)));}
 if(spec.id==='redcarp')for(const side of [-1,1]){
  tube(s,[[.488,-.013,side*.016],[.475,-.025,side*.030],[.438,-.038,side*.048],[.417,-.036,side*.052]],.0021,5);
  tube(s,[[.501,-.007,side*.010],[.497,-.019,side*.019],[.485,-.026,side*.027]],.0017,5);
 }
 const g=s.geometry(spec.id+' authored body, scaleless head, eye lenses and opercular seams'),n=g.attributes.normal,v=new THREE.Vector3();for(let j=0;j<=rings;j++){const a=j*(sides+1),b=a+sides;v.set(n.getX(a)+n.getX(b),n.getY(a)+n.getY(b),n.getZ(a)+n.getZ(b)).normalize();n.setXYZ(a,v.x,v.y,v.z);n.setXYZ(b,v.x,v.y,v.z);}return g;
}
function finFan(s,root,rim,type,side=0){
 const rootIndex=s.vertex(root,[0,0],1,[type,side,0]),rows=[];
 for(let j=1;j<=3;j++){const row=[],t=j/3;for(let k=0;k<rim.length;k++){const p=root.map((v,n)=>mix(v,rim[k][n],t));p[2]+=(type===1?.005:.008)*Math.sin(k/(rim.length-1)*Math.PI)*Math.sin(t*Math.PI);row.push(s.vertex(p,[k/(rim.length-1),t],1,[type,side,t]));}rows.push(row);}
 for(let k=0;k<rim.length-1;k++)s.tri(rootIndex,rows[0][k],rows[0][k+1]);
 for(let j=0;j<rows.length-1;j++)for(let k=0;k<rim.length-1;k++){const a=rows[j][k],b=rows[j+1][k],c=rows[j][k+1],d=rows[j+1][k+1];s.tri(a,b,c);s.tri(c,b,d);}
}
function finGeometry(spec){
 const s=new Shape(),big=spec.id==='bighead',h=spec.height;
 if(spec.id==='redcarp'||spec.id==='crucian'||spec.id==='sharpbelly'){
  const small=spec.id==='sharpbelly',carp=spec.id==='redcarp',rim=[];
  if(small){for(let k=0;k<=16;k++){const q=k/16*2-1;rim.push([-.414-.110*Math.pow(Math.abs(q),.72),q*(q<0?.112:.102),0]);}}
  else{const span=carp?1:.94,depth=carp?1:.90;for(const[x,y]of[[-.382,-.072],[-.432,-.122],[-.488,-.142],[-.505,-.132],[-.488,-.102],[-.459,-.058],[-.425,-.015],[-.420,0],[-.425,.015],[-.459,.058],[-.488,.102],[-.505,.132],[-.488,.142],[-.432,.122],[-.382,.072]])rim.push([-.335+(x+.335)*depth,y*span,0]);}
  finFan(s,[-.335,0,0],rim,2);
  if(small){
   finFan(s,[-.055,.044,0],[[.018,.052,0],[-.020,.123,0],[-.075,.104,0],[-.150,.042,0]],3);
   finFan(s,[-.19,-.082,0],[[-.095,-.080,0],[-.13,-.126,0],[-.26,-.108,0],[-.31,-.040,0]],3);
  }else{
   finFan(s,[.015,h*.94,0],[[.21,h*.85,0],[.155,h+.066,0],[.10,h+.062,0],[.005,h+.035,0],[-.10,h+.025,0],[-.21,h*.78,0],[-.27,h*.48,0]],3);
   finFan(s,[-.205,-h*.68,0],[[-.15,-h*.80,0],[-.19,-h-.042,0],[-.265,-h-.031,0],[-.315,-h*.40,0]],3);
  }
  for(const side of [-1,1]){
   const px=small?.250:.255,pw=profile(spec,px).w,spread=small?.072:.100;
   const pectoralRim=small?[[px-.015,-h*.38,side*(pw+.018)],[px-.10,-h*.55,side*(pw+spread)],[px-.23,-h*.64,side*(pw+spread*.62)],[px-.12,-h*.43,side*pw]]:[[px-.012,-h*.33,side*(pw+.012)],[px-.045,-h*.40,side*(pw+.050)],[px-.087,-h*.51,side*(pw+.082)],[px-.127,-h*.63,side*(pw+.085)],[px-.158,-h*.69,side*(pw+.068)],[px-.176,-h*.63,side*(pw+.041)],[px-.143,-h*.48,side*(pw+.010)]];
   finFan(s,[px,small?-.018:-h*.30,side*pw*.88],pectoralRim,1,side);
   finFan(s,[small?.01:-.055,-h*.79,side*.023],[[small?.00:-.06,-h*.85,side*.028],[-.08,-h-.028,side*(small?.047:.071)],[-.15,-h-.010,side*.046],[-.14,-h*.68,side*.021]],1,side);
  }
  return s.geometry(spec.id+' authored species fins; long carp/crucian dorsal or posterior sharpbelly dorsal and deep fork');
 }
 // Forked caudal with concave central trailing edge, not a single triangle.
 const rim=[];for(let k=0;k<=16;k++){const q=k/16*2-1;rim.push([-.426-.078*Math.pow(Math.abs(q),.72),q*(big?.131:.120),0]);}finFan(s,[-.335,0,0],rim,2);
 finFan(s,[.04,h*.88,0],[[.12,h*.94,0],[.080,h+.064,0],[.005,h+.058,0],[-.09,h*.98,0],[-.17,h*.72,0]],3);
 finFan(s,[-.18,-h*.70,0],[[-.12,-h*.76,0],[-.18,-h-.040,0],[-.26,-h-.031,0],[-.31,-h*.37,0]],3);
 for(const side of [-1,1]){
  const px=big?.185:.245,pw=profile(spec,px).w;
  finFan(s,[px,-h*.35,side*pw*.85],[[px-.015,-h*.38,side*(pw+.025)],[px-.085,-h*.54,side*(pw+.092)],[px-(big?.19:.16),-h*.54,side*(pw+.066)],[px-.10,-h*.45,side*pw]],1,side);
  finFan(s,[-.07,-h*.75,side*.025],[[-.075,-h*.84,side*.032],[-.12,-h-.025,side*.070],[-.185,-h-.016,side*.052],[-.16,-h*.70,side*.024]],1,side);
 }
 return s.geometry(spec.id+' forked caudal, dorsal, anal and paired pectoral/pelvic fins');
}

export function deformFishPoint(point,{time=0,frequency=1.2,phase=0,amplitude=1,turn=0,fin=[0,0,0]}={}){
 const p=Array.isArray(point)?point:[point.x,point.y,point.z],q=clamp((.20-p[0])/.60,0,1),a=TAU*frequency*time+phase-q*3.8;
 let y=p[1],z=p[2]+amplitude*.055*q*q*Math.sin(a)+turn*.045*q*q;
 if(fin[0]===1){y+=Math.sin(TAU*frequency*time*.55+phase+fin[1]*.6)*.027*fin[2];z+=fin[1]*Math.cos(TAU*frequency*time*.55+phase)*.012*fin[2];}
 else if(fin[0]===2)z+=Math.sin(a+.8)*.018*fin[2]*amplitude;
 else if(fin[0]===3)z+=Math.sin(a)*.005*fin[2];
 return [p[0],y,z];
}
const VERTEX=`
attribute float aFishPart;attribute vec3 aFishFin;
uniform float uFishTime,uFishFrequency,uFishPhase,uFishAmplitude,uFishTurn;
varying vec3 vFishLocal;varying vec2 vFishUV;varying float vFishPart;
vec3 fishDeform(vec3 p){float q=clamp((.20-p.x)/.60,0.,1.),phase=6.28318530718*uFishFrequency*uFishTime+uFishPhase-q*3.8;
 p.z+=uFishAmplitude*.055*q*q*sin(phase)+uFishTurn*.045*q*q;
 if(aFishFin.x>.5&&aFishFin.x<1.5){p.y+=sin(6.28318530718*uFishFrequency*uFishTime*.55+uFishPhase+aFishFin.y*.6)*.027*aFishFin.z;p.z+=aFishFin.y*cos(6.28318530718*uFishFrequency*uFishTime*.55+uFishPhase)*.012*aFishFin.z;}
 else if(aFishFin.x>1.5&&aFishFin.x<2.5)p.z+=sin(phase+.8)*.018*aFishFin.z*uFishAmplitude;
 else if(aFishFin.x>2.5)p.z+=sin(phase)*.005*aFishFin.z;return p;}
`;
const FRAGMENT=`
varying vec3 vFishLocal;varying vec2 vFishUV;varying float vFishPart;
uniform vec3 uFishBack,uFishSide,uFishBelly,uFishFinColor;uniform float uFishHeight,uFishWidth,uFishScales,uFishRows,uFishMottle,uFishVariant,uFishLength;
float fishHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float fishNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(fishHash(i),fishHash(i+vec3(1,0,0)),f.x),mix(fishHash(i+vec3(0,1,0)),fishHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(fishHash(i+vec3(0,0,1)),fishHash(i+vec3(1,0,1)),f.x),mix(fishHash(i+vec3(0,1,1)),fishHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
vec2 fishScaleEdges(){float body=(1.-smoothstep(.20,.31,vFishLocal.x))*(1.-step(.5,vFishPart));vec2 grid=vec2((.5-vFishLocal.x)*uFishScales,vFishUV.y*uFishRows);float footprint=max(length(dFdx(grid)),length(dFdy(grid))),scaleBandWeight=1.-smoothstep(.45,1.30,footprint);
 float row=floor(grid.y),y=fract(grid.y)-.5,x=fract(grid.x+mod(row,2.)*.5),arc=.19+sqrt(max(0.,.29-y*y))*.92,aa=max(.015,fwidth(x)*.65+fwidth(y)*.40);
 float edge=(1.-smoothstep(.035,.035+aa,abs(x-arc)))*scaleBandWeight*body;float scaleHighlight=(1.-smoothstep(.09,.09+aa,abs(x-arc-.09)))*scaleBandWeight*body;return vec2(edge,scaleHighlight);}
vec3 fishIdentity(){float vertical=clamp(vFishLocal.y/uFishHeight,-1.,1.);vec3 c=mix(uFishBelly,uFishSide,smoothstep(-.83,-.05,vertical));c=mix(c,uFishBack,smoothstep(.12,.80,vertical));float body=1.-smoothstep(.20,.31,vFishLocal.x);vec2 scales=fishScaleEdges();float edge=scales.x,scaleHighlight=scales.y;
 c*=1.-edge*mix(.13,.24,step(uFishScales,50.));c+=scaleHighlight*vec3(.025,.030,.021);
 float side=clamp(abs(vFishLocal.z)/max(.001,uFishWidth),0.,1.),line=(1.-smoothstep(.006,.011+fwidth(vFishLocal.y),abs(vFishLocal.y+.014)))*body*smoothstep(.45,.85,side);c*=1.-line*.11;float headPlate=smoothstep(.23,.33,vFishLocal.x)*(1.-smoothstep(.43,.50,vFishLocal.x));c=mix(c,c*vec3(.94,1.015,1.025),headPlate*.28);float shoulderSheen=pow(max(0.,1.-abs(vertical-.22)*1.7),3.)*side*body;c+=shoulderSheen*vec3(.030,.037,.027);
 float mottleFieldValue=fishNoise(vFishLocal*vec3(18.,43.,32.)+uFishVariant);float mottle=smoothstep(.48,.66,mottleFieldValue)*smoothstep(-.50,.50,vertical);c*=1.-mottle*uFishMottle*.44;
 if(vFishPart>1.5&&vFishPart<2.5)c=vec3(.36,.31,.12);else if(vFishPart>2.5&&vFishPart<3.5)c=vec3(.012,.018,.014);else if(vFishPart>3.5&&vFishPart<4.5)c=mix(uFishBack,uFishSide,.48)*.84;else if(vFishPart>4.5&&vFishPart<5.5)c=mix(uFishSide,uFishBack,.42)*.78;else if(vFishPart>5.5)c=vec3(.035,.042,.031);
 return c;}
`;
function material(spec,u,fin=false,depth=false){
 const m=depth?new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}):new THREE.MeshStandardMaterial({color:0xffffff,roughness:fin?.53:.37,metalness:fin?0:.09,side:fin?THREE.DoubleSide:THREE.FrontSide,transparent:fin,opacity:fin?.72:1,depthWrite:!fin});m.name=`pond-${spec.id}-${fin?'fins':'skin'}-${depth?'depth':'pbr'}`;
 m.onBeforeCompile=s=>{
  Object.assign(s.uniforms,u);s.vertexShader=VERTEX+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFishLocal=position;vFishUV=uv;vFishPart=aFishPart;transformed=fishDeform(transformed);');
  if(!depth)s.vertexShader=s.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
float fishQ=clamp((.20-position.x)/.60,0.,1.),fishPhase=6.28318530718*uFishFrequency*uFishTime+uFishPhase-fishQ*3.8;
float fishDX=(uFishAmplitude*(.11*fishQ*sin(fishPhase)-.209*fishQ*fishQ*cos(fishPhase))+uFishTurn*.09*fishQ)*(-1./.60)*step(-.40,position.x)*step(position.x,.20);
objectNormal.x-=fishDX*objectNormal.z;objectNormal=normalize(objectNormal);`);
  if(!depth){s.fragmentShader=FRAGMENT+s.fragmentShader;
   if(spec.id==='sharpbelly')s.fragmentShader=s.fragmentShader.replace('float side=clamp(abs(vFishLocal.z)','float lateralBow=-.012-.045*smoothstep(-.28,-.05,vFishLocal.x)*(1.-smoothstep(.12,.30,vFishLocal.x));float side=clamp(abs(vFishLocal.z)').replace('abs(vFishLocal.y+.014)','abs(vFishLocal.y-lateralBow)');
   s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
diffuseColor.rgb*=${fin?'uFishFinColor':'fishIdentity()'};${fin?'float ray=pow(.5+.5*cos(vFishUV.x*12.*6.2831853),6.),rayFade=1.-smoothstep(.3,1.0,fwidth(vFishUV.x)*72.);diffuseColor.rgb*=1.-ray*.22*rayFade;diffuseColor.a*=mix(1.,.68,smoothstep(.4,1.,vFishUV.y));':''}`);
   s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
roughnessFactor=${fin?'.60+ray*.06*rayFade':'mix(.37,.19,step(1.5,vFishPart)*step(vFishPart,3.5))'};${fin?'':'vec2 fishEdges=fishScaleEdges();roughnessFactor+=fishEdges.x*.07-fishEdges.y*.045;'}`);
   if(!fin)s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
vec2 fishReliefEdges=fishScaleEdges();float fishRelief=(fishReliefEdges.y*.00055-fishReliefEdges.x*.00018)*uFishLength;
vec3 fishQ0=dFdx(-vViewPosition),fishQ1=dFdy(-vViewPosition),fishR1=cross(fishQ1,normal),fishR2=cross(normal,fishQ0);float fishDet=dot(fishQ0,fishR1);vec3 fishGrad=sign(fishDet)*(dFdx(fishRelief)*fishR1+dFdy(fishRelief)*fishR2);normal=normalize(abs(fishDet)*normal-fishGrad);
float fishVariance=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));roughnessFactor=clamp(sqrt(roughnessFactor*roughnessFactor+fishVariance*.12),.22,.90);`);
  }
 };m.customProgramCacheKey=()=>`pond-carps-${fin?'fins':'body'}-${depth?'depth':'pbr'}-v233${spec.id==='sharpbelly'?'-sharpbelly':''}`;return m;
}

function makeRoute(terrain,bedHeightAt,spec,rng,lake){
 const points=[],angle=rng()*TAU,rx=.94+rng()*.24,rz=.61+rng()*.13,cx=lake.x+(rng()-.5)*.24,cz=lake.z-.10+(rng()-.5)*.16,length=(spec.length[0]+spec.length[1])*.5,clearanceRadius=length*.60;
 const floorAt=(x,z)=>Math.max(terrain.height(x,z),bedHeightAt(x,z));
 for(let i=0;i<16;i++){
  const a=angle+i/16*TAU,rad=.89+.09*Math.sin(a*3+angle)+.04*Math.cos(a*5-angle),x=cx+Math.cos(a)*rx*rad,z=cz+Math.sin(a)*rz*rad;
  let bed=floorAt(x,z);for(let k=0;k<16;k++){const theta=k/16*TAU;bed=Math.max(bed,floorAt(x+Math.cos(theta)*clearanceRadius,z+Math.sin(theta)*clearanceRadius));}
  const top=lake.level-.035-spec.height*length-.018,bottom=bed+spec.height*length+.035;
  if(bottom>=top)throw Error('Pond fish route has insufficient water column');
  const fraction=clamp(spec.layer+Math.sin(a*2+angle)*.025,0,1);points.push(new THREE.Vector3(x,mix(top,bottom,fraction),z));
 }
 const route=new THREE.CatmullRomCurve3(points,true,'centripetal');route.arcLengthDivisions=256;route.updateArcLengths();return route;
}

// New habitat lanes have their own seed stream. Height follows a conservative
// soil/stone envelope over the complete fish/school footprint, not a layer plane.
function makeAddedRoute(terrain,bedHeightAt,spec,rng,lake){
 const small=spec.id==='sharpbelly',crucian=spec.id==='crucian',angle=rng()*TAU,rx=small?1.04:crucian?1.48:.52,rz=small?.59:crucian?.91:.27,cx=lake.x+(small?.12:crucian?-.05:-.025),cz=lake.z+(small?-.14:crucian?-.12:-.10),extent=spec.length[1]*.62+(small?.19:0),points=[];
 for(let i=0;i<24;i++){
  const a=angle+i/24*TAU,rad=(small?.94:.89)+(small?.020:.070)*Math.sin(a*3+angle)+(small?.008:.035)*Math.cos(a*5-angle),x=cx+Math.cos(a)*rx*rad,z=cz+Math.sin(a)*rz*rad;
  let bed=Math.max(terrain.height(x,z),bedHeightAt(x,z));for(let k=0;k<20;k++){const q=k/20*TAU,px=x+Math.cos(q)*extent,pz=z+Math.sin(q)*extent;bed=Math.max(bed,terrain.height(px,pz),bedHeightAt(px,pz));}
  const top=lake.level-.058-spec.height*spec.length[1],bottom=bed+spec.height*spec.length[1]+.054;
  if(bottom>=top)throw Error('Additional pond fish lane has insufficient water column');
  const fraction=clamp(spec.layer+Math.sin(a*2+angle)*(small?.028:.065),0,1);points.push(new THREE.Vector3(x,mix(top,bottom,fraction),z));
 }
 const route=new THREE.CatmullRomCurve3(points,true,'centripetal');route.arcLengthDivisions=320;route.updateArcLengths();return route;
}

/** Absolute time wins; group can join the existing submerged scene capture. */
export function createPondFish({terrain,seed=42,bedHeightAt=terrain?.height}={}){
 if(!terrain?.height||typeof bedHeightAt!=='function')throw Error('createPondFish requires terrain.height and optional bedHeightAt');
 const lake=terrain.lake||{x:1.45,z:2.8,rx:2.45,rz:2.05,level:.18,front:4.25},group=new THREE.Group();group.name='Chinese pond fishes and loose sharpbelly school';
 const rng=random(seed^0x68b3f2c7),items=[],geometries=new Set(),materials=new Set(),routes=[],diagnostics={seed,species:POND_FISH_SPECIES,fish:[],routeRule:'smooth closed authored cruising lanes, overlapping species layer preferences relative to actual local soil/stone depth; no spawning or stocking simulation',bodyCoordinates:'head +X, up +Y, left/right +Z/-Z, total length approximately one local unit',windScope:'tail traveling wave and coordinated fins; no arbitrary body rolling',externalAssets:0};
 // This original four-species stream is deliberately unchanged from 2.2.5.
 for(let speciesIndex=0;speciesIndex<4;speciesIndex++){
  const spec=POND_FISH_SPECIES[speciesIndex],body=bodyGeometry(spec),fins=finGeometry(spec),route=makeRoute(terrain,bedHeightAt,spec,rng,lake),period=46+rng()*13,routePhase=rng();geometries.add(body);geometries.add(fins);routes.push(route);
  for(let pair=0;pair<2;pair++){
   const length=mix(...spec.length,rng()),phase=rng()*TAU,frequency=.95+rng()*.32,root=new THREE.Group();root.name=spec.zh+' '+(pair+1);group.add(root);
   const u={uFishTime:{value:0},uFishFrequency:{value:frequency},uFishPhase:{value:phase},uFishAmplitude:{value:1},uFishTurn:{value:0},uFishLength:{value:length},uFishHeight:{value:spec.height},uFishWidth:{value:spec.width},uFishScales:{value:spec.scales},uFishRows:{value:spec.rows},uFishMottle:{value:spec.mottled?1:0},uFishVariant:{value:rng()*10},uFishBack:{value:new THREE.Color(spec.back)},uFishSide:{value:new THREE.Color(spec.side)},uFishBelly:{value:new THREE.Color(spec.belly)},uFishFinColor:{value:new THREE.Color(spec.fin)}};
   const mat=material(spec,u),finMat=material(spec,u,true),dep=material(spec,u,false,true),finDep=material(spec,u,true,true);for(const m of [mat,finMat,dep,finDep])materials.add(m);
   const bodyMesh=new THREE.Mesh(body,mat),finMesh=new THREE.Mesh(fins,finMat);bodyMesh.name=spec.id+' scaled body and head';finMesh.name=spec.id+' separate articulated fins';bodyMesh.customDepthMaterial=dep;finMesh.customDepthMaterial=finDep;for(const m of [bodyMesh,finMesh]){m.frustumCulled=false;m.receiveShadow=true;root.add(m);}root.scale.setScalar(length);
   const item={index:items.length,spec,length,phase,frequency,period,routePhase:(routePhase+pair*.5)%1,route,root,bodyMesh,finMesh,uniforms:u};items.push(item);diagnostics.fish.push({index:item.index,species:spec.id,length,frequency,phase,period,routePhase:item.routePhase,preferredDepthFraction:spec.layer});
  }
 }
 const extraRng=random(seed^0x2e6f175b);
 for(const spec of POND_FISH_SPECIES.slice(4)){
  const body=bodyGeometry(spec),fins=finGeometry(spec),route=makeAddedRoute(terrain,bedHeightAt,spec,extraRng,lake),small=spec.id==='sharpbelly',period=small?31+extraRng()*3:52+extraRng()*13,routePhase=extraRng(),schoolPhase=extraRng()*TAU;geometries.add(body);geometries.add(fins);routes.push(route);
  const schoolOffsets=[[0,0],[-.025,-.078],[-.025,.078],[-.052,-.145],[-.052,0],[-.052,.145],[-.079,.008]];
  for(let member=0;member<spec.count;member++){
   const length=mix(...spec.length,extraRng()),phase=extraRng()*TAU,frequency=small?2.05+extraRng()*.57:.88+extraRng()*.34,root=new THREE.Group();root.name=spec.zh+' '+(member+1);root.scale.setScalar(length);group.add(root);
   const u={uFishTime:{value:0},uFishFrequency:{value:frequency},uFishPhase:{value:phase},uFishAmplitude:{value:1},uFishTurn:{value:0},uFishLength:{value:length},uFishHeight:{value:spec.height},uFishWidth:{value:spec.width},uFishScales:{value:spec.scales},uFishRows:{value:spec.rows},uFishMottle:{value:0},uFishVariant:{value:extraRng()*10},uFishBack:{value:new THREE.Color(spec.back)},uFishSide:{value:new THREE.Color(spec.side)},uFishBelly:{value:new THREE.Color(spec.belly)},uFishFinColor:{value:new THREE.Color(spec.fin)}};
   const mat=material(spec,u),finMat=material(spec,u,true),dep=material(spec,u,false,true),finDep=material(spec,u,true,true);for(const m of [mat,finMat,dep,finDep])materials.add(m);
   const bodyMesh=new THREE.Mesh(body,mat),finMesh=new THREE.Mesh(fins,finMat);bodyMesh.name=spec.id+' distinct body, head and identification details';finMesh.name=spec.id+' species fins';bodyMesh.customDepthMaterial=dep;finMesh.customDepthMaterial=finDep;for(const m of [bodyMesh,finMesh]){m.frustumCulled=false;m.receiveShadow=true;root.add(m);}
   const item={index:items.length,spec,length,phase,frequency,period,routePhase:(routePhase+(small?schoolOffsets[member][0]:member/spec.count))%1,route,root,bodyMesh,finMesh,uniforms:u,...(small?{schoolPhase,schoolSide:schoolOffsets[member][1],schoolMember:member}:{})};items.push(item);diagnostics.fish.push({index:item.index,species:spec.id,length,frequency,phase,period,routePhase:item.routePhase,preferredDepthFraction:spec.layer,...(small?{school:'loose sharpbelly group',schoolSide:item.schoolSide,schoolMember:member}:{})});
  }
 }
 // Only a subset visits the surface. Independent deterministic windows make
 // this reproducible without forcing the whole school onto one display layer.
 const visits=random(seed^0x233b71a9),surfaceIndices=new Set([0,3,4,8,10,13,16]);
 for(const item of items)item.surfaceVisit={enabled:surfaceIndices.has(item.index),period:43+visits()*29,offset:visits()*48,salt:visits()*47};
 let surfaceSampler=null,motionState={},lastTime=0;
 const surfaceWind=new THREE.Vector2(),surfaceEvents=[],reportedVisits=new Map();
 function waterAt(x,z,time){if(!surfaceSampler)return lake.currentLevel??lake.level;surfaceWind.set(Number(motionState.wind?.x)||0,Number(motionState.wind?.y)||0).multiplyScalar(Number(motionState.windStrength)||0);const y=surfaceSampler(x,z,time,surfaceWind);return Number.isFinite(y)?y:lake.currentLevel??lake.level;}
 const ease=t=>{t=clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);};
 function visitAt(item,time){const v=item.surfaceVisit;if(!v.enabled)return{amount:0,cycle:-1};const clock=time+v.offset,cycle=Math.floor(clock/v.period),local=clock-cycle*v.period,variation=Math.sin(cycle*12.982+v.salt)*43758.5453,start=2+(variation-Math.floor(variation))*9,duration=9.0+(Math.sin(cycle*7.133+v.salt)+1)*.8,q=(local-start)/duration;
  const amount=q<=0||q>=1?0:q<.39?ease(q/.39):q<.55?1:1-ease((q-.55)/.45),season=((Number(motionState.season)||0)%4+4)%4,winter=Math.max(0,1-Math.abs(season-3));return{amount:amount*(1-winter*.72),cycle,local,start,duration};}
 const direction=new THREE.Vector3(),side=new THREE.Vector3(),up=new THREE.Vector3(),rotation=new THREE.Matrix4(),quaternion=new THREE.Quaternion();
 function routePoint(item,time){
  const school=Number.isFinite(item.schoolMember),drift=.010*Math.sin(time*.145+(school?item.schoolPhase:item.phase)),u=((time/item.period+item.routePhase+drift)%1+1)%1,p=item.route.getPointAt(u);
  if(school){const tangent=item.route.getTangentAt(u),n=new THREE.Vector3(-tangent.z,0,tangent.x).normalize(),offset=item.schoolSide+.008*Math.sin(time*.69+item.phase);p.addScaledVector(n,offset);p.y+=.007*Math.sin(time*.41+item.phase);}
  const surface=waterAt(p.x,p.z,time),rise=Math.max(0,(lake.currentLevel??lake.level)-lake.level),floor=Math.max(terrain.height(p.x,p.z),bedHeightAt(p.x,p.z)),bodyHalf=item.spec.height*item.length,visit=visitAt(item,time);
  p.y+=rise*(1-item.spec.layer);const lower=floor+bodyHalf+.035,cruiseTop=surface-bodyHalf-.026;
  p.y=clamp(p.y,lower,Math.max(lower,cruiseTop));
  // The dorsal ridge/lip may just break the surface at the top of a visit;
  // no leap or whole fish floating above the water. The lake sampler owns waves.
  const feedingY=Math.max(lower,surface-bodyHalf*.62);p.y=mix(p.y,feedingY,visit.amount);return p;
 }
 function sampleAt(time=0,index=0){
  const item=items[index];if(!item)throw Error('Invalid fish index');const t=Number.isFinite(time)?time:0,p=routePoint(item,t),previous=routePoint(item,t-.06),next=routePoint(item,t+.06),velocity=next.clone().sub(previous).multiplyScalar(1/.12),forward=velocity.clone().normalize(),before=previous.clone().sub(routePoint(item,t-.12)).normalize(),after=routePoint(item,t+.12).sub(next).normalize(),signedTurn=clamp((before.x*after.z-before.z*after.x)*13,-1.2,1.2),speed=velocity.length(),amplitude=clamp(speed/(item.length*.36),.55,1.12);
  const visit=visitAt(item,t);forward.y=clamp(forward.y,-.14,.20);forward.normalize();if(visit.amount>.85){forward.y=mix(forward.y,.18,ease((visit.amount-.85)/.15));forward.normalize();}
  direction.copy(forward);side.crossVectors(direction,UP).normalize();if(side.lengthSq()<.5)side.set(0,0,1);up.crossVectors(side,direction).normalize();rotation.makeBasis(direction,up,side);quaternion.setFromRotationMatrix(rotation).normalize();
  const bed=Math.max(terrain.height(p.x,p.z),bedHeightAt(p.x,p.z)),surface=waterAt(p.x,p.z,t);return{index,species:item.spec.id,time:t,position:p.toArray(),velocity:velocity.toArray(),quaternion:quaternion.toArray(),length:item.length,frequency:item.frequency,phase:item.phase,amplitude,turn:signedTurn,speed,bed,surface,waterDepth:surface-bed,depthFraction:(surface-p.y)/Math.max(.001,surface-bed),surfaceActivity:visit.amount,surfaceVisitCycle:visit.cycle,dorsalClearance:surface-(p.y+item.spec.height*item.length)};
 }
 const stats={seed,count:items.length,visibleFish:items.length,species:Object.fromEntries(POND_FISH_SPECIES.map(s=>[s.id,{zh:s.zh,scientific:s.scientific,count:s.count||2,preferredDepthFraction:s.layer}])),drawCalls:items.length*2,triangles:items.reduce((n,i)=>n+i.bodyMesh.geometry.index.count/3+i.finMesh.geometry.index.count/3,0),time:0,externalAssets:0,renderTargets:0};
 let disposed=false;
 function update(time=0,state={}){if(disposed)return stats;motionState=state;const t=Number.isFinite(state.time)?state.time:Number.isFinite(time)?time:0;if(t<lastTime){surfaceEvents.length=0;reportedVisits.clear();}stats.time=t;stats.poses=[];stats.surfaceVisitors=0;for(const item of items){const pose=sampleAt(t,item.index);item.root.position.fromArray(pose.position);item.root.quaternion.fromArray(pose.quaternion);item.uniforms.uFishTime.value=t;item.uniforms.uFishAmplitude.value=pose.amplitude;item.uniforms.uFishTurn.value=pose.turn;stats.poses.push(pose);if(pose.surfaceActivity>.85)stats.surfaceVisitors++;if(pose.surfaceActivity>.92&&reportedVisits.get(item.index)!==pose.surfaceVisitCycle){reportedVisits.set(item.index,pose.surfaceVisitCycle);surfaceEvents.push({x:pose.position[0],y:pose.surface,z:pose.position[2],time:t,strength:item.spec.id==='sharpbelly'?.06:.16,length:item.length});if(surfaceEvents.length>32)surfaceEvents.shift();}}lastTime=t;return stats;}
 update(0,{});group.userData.fishSystem={diagnostics,stats};
 diagnostics.surfaceVisits={indices:[...surfaceIndices],rule:'Independent seeded variable-duration surface visits; dorsal ridge and feeding lip only, actual sampled wave height, black carp retain benthic lane',windows:items.filter(i=>i.surfaceVisit.enabled).map(i=>({index:i.index,species:i.spec.id,...i.surfaceVisit}))};
 return{group,items,stats,diagnostics,sampleAt,update,setLakeSurfaceSampler(fn){surfaceSampler=typeof fn==='function'?fn:null;},consumeSurfaceEvents(){return surfaceEvents.splice(0);},dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();stats.disposed=true;}};
}
