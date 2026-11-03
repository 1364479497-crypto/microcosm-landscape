// Local leaf/branchlet motion around the actual petiole. Shared woody arc
// deformation below is also sampled by real branch-perching birds.
// Positions and normals use the same two rigid rotations in colour and depth.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export function sampleLeafWindAngles(time=0,phase=0,cohort=0,windFace=0,windEdge=0,magnitude=0,species=0){
  const mag=clamp(magnitude,0,4),gain=Math.min(2.35,mag*1.10);
  const stiffness=species<.5?1:species<1.5?.69:species<2.5?1.04:.82;
  const rate=(species<.5?1:species<1.5?.77:species<2.5?1.14:.88)*(1+Math.min(mag,3)*.24);
  const gust=.74+.16*Math.sin(time*.68+cohort)+.10*Math.sin(time*1.17+cohort*1.71);
  const flutter=.54*Math.sin(time*(2.25+.55*Math.sin(phase))*rate+phase)
    +.28*Math.sin(time*(4.1+.65*Math.cos(phase))*rate+phase*1.91)
    +.18*Math.sin(time*(7.4+.8*Math.sin(phase))*rate+phase*.47);
  const torsion=.64*Math.sin(time*3.35*rate+phase*1.37)+.36*Math.sin(time*6.15*rate+phase*.83);
  return [clamp(gain*stiffness*gust*(windFace*.28+flutter*(.62+.18*Math.abs(windFace))),-1.15,1.15),
    clamp(gain*stiffness*gust*.56*(windEdge*.24+torsion*.76),-1.25,1.25)];
}

export function rotateLeafWindVector(vector,angles){
  const [x,y,z]=vector,[bend,twist]=angles,c=Math.cos(bend),s=Math.sin(bend),a=Math.cos(twist),b=Math.sin(twist);
  const yy=y*c-z*s,zz=y*s+z*c;
  return [x*a+zz*b,yy,-x*b+zz*a];
}

export const LEAF_WIND_GLSL=`
vec2 vegLeafWindAngles(float time,float phase,float cohort,float windFace,float windEdge,float magnitude,float species){
  float mag=clamp(magnitude,0.,4.),gain=min(2.35,mag*1.10);
  float stiffness=species<.5?1.:species<1.5?.69:species<2.5?1.04:.82;
  float rate=(species<.5?1.:species<1.5?.77:species<2.5?1.14:.88)*(1.+min(mag,3.)*.24);
  float gust=.74+.16*sin(time*.68+cohort)+.10*sin(time*1.17+cohort*1.71);
  float flutter=.54*sin(time*(2.25+.55*sin(phase))*rate+phase)
    +.28*sin(time*(4.1+.65*cos(phase))*rate+phase*1.91)
    +.18*sin(time*(7.4+.8*sin(phase))*rate+phase*.47);
  float torsion=.64*sin(time*3.35*rate+phase*1.37)+.36*sin(time*6.15*rate+phase*.83);
  return vec2(clamp(gain*stiffness*gust*(windFace*.28+flutter*(.62+.18*abs(windFace))),-1.15,1.15),
    clamp(gain*stiffness*gust*.56*(windEdge*.24+torsion*.76),-1.25,1.25));
}
vec3 vegLeafWindRotate(vec3 p,vec2 angles){
  float c=cos(angles.x),s=sin(angles.x),a=cos(angles.y),b=sin(angles.y);
  vec3 q=vec3(p.x,p.y*c-p.z*s,p.y*s+p.z*c);
  return vec3(q.x*a+q.z*b,q.y,-q.x*b+q.z*a);
}
`;

// A root-fixed circular-arc centreline, with horizontal sections rotated onto
// its tangent. Every surface of one tree sees the same continuous mapping.
// The inverse Jacobian normal includes the section stretch; bending is not a
// screen-space offset or a collection of disconnected rotating cylinders.
export function sampleTreeBend(time,root,wind,drag=[0,0]){
 const wx=Number(wind[0])||0,wz=Number(wind[1])||0,m=Math.min(2.5,Math.hypot(wx,wz)),l=Math.max(1e-7,Math.hypot(wx,wz)),phase=root[0]*1.9+root[2]*.73;
 const pulse=.76+.42*Math.sin(time*.91+phase)+.16*Math.sin(time*1.73+phase*1.37);
 const a=.46*(1-Math.exp(-m*1.35))*pulse;
 return [wx/l*a+(Number(drag[0])||0),wz/l*a+(Number(drag[1])||0)];
}
export function bendTreePoint(point,root,bend){
 const [rx,ry,rz,h0]=root,h=Math.max(.1,h0),x=point[0]-rx,y=point[1]-ry,z=point[2]-rz;
 if(y<=0)return [...point];
 const b=Math.hypot(...bend);if(b<1e-7)return [...point];
 const dx=bend[0]/b,dz=bend[1]/b,t=y/h,angle=b*t,c=Math.cos(angle),s=Math.sin(angle),u=x*dx+z*dz,v=-x*dz+z*dx;
 const along=h/b*(1-c)+u*c,up=h/b*s-u*s;
 return [rx+dx*along-dz*v,ry+up,rz+dz*along+dx*v];
}
export function bendTreeNormal(normal,point,root,bend){
 const y=point[1]-root[1],b=Math.hypot(...bend);if(y<=0||b<1e-7)return [...normal];
 const h=Math.max(.1,root[3]),dx=bend[0]/b,dz=bend[1]/b,u=(point[0]-root[0])*dx+(point[2]-root[2])*dz,angle=b*y/h,c=Math.cos(angle),s=Math.sin(angle),k=Math.max(.3,1-u*b/h);
 const along=normal[0]*dx+normal[2]*dz,across=-normal[0]*dz+normal[2]*dx,up=normal[1]/k,aa=along*c+up*s,yy=-along*s+up*c;
 const n=[aa*dx-across*dz,yy,aa*dz+across*dx],len=Math.hypot(...n);return n.map(x=>x/Math.max(1e-9,len));
}
export const TREE_WIND_GLSL=`
uniform vec4 uTreeDragRoot;
uniform vec2 uTreeDragBend;
vec2 vegTreeBend(float time,vec4 root,vec2 wind){
 float m=min(2.5,length(wind)),phase=root.x*1.9+root.z*.73;
 float pulse=.76+.42*sin(time*.91+phase)+.16*sin(time*1.73+phase*1.37);
 float a=.46*(1.-exp(-m*1.35))*pulse;
 vec2 drag=uTreeDragBend*(1.-step(.002,distance(root.xz,uTreeDragRoot.xz)));
 return wind/max(.0000001,length(wind))*a+drag;
}
vec3 vegTreeArc(vec3 p,vec4 root,vec2 bend){
 float y=p.y-root.y,b=length(bend);if(y<=0.||b<.0000001)return p;
 float h=max(.1,root.w);vec2 d=bend/b,local=p.xz-root.xz;float angle=b*y/h,c=cos(angle),s=sin(angle),u=dot(local,d),v=dot(local,vec2(-d.y,d.x));
 return vec3(root.x+d.x*(h/b*(1.-c)+u*c)-d.y*v,root.y+h/b*s-u*s,root.z+d.y*(h/b*(1.-c)+u*c)+d.x*v);
}
vec3 vegTreeArcNormal(vec3 n,vec3 p,vec4 root,vec2 bend){
 float y=p.y-root.y,b=length(bend);if(y<=0.||b<.0000001)return n;
 float h=max(.1,root.w);vec2 d=bend/b;float u=dot(p.xz-root.xz,d),angle=b*y/h,c=cos(angle),s=sin(angle),k=max(.3,1.-u*b/h);
 float along=dot(n.xz,d),across=dot(n.xz,vec2(-d.y,d.x)),up=n.y/k,aa=along*c+up*s;
 return normalize(vec3(aa*d.x-across*d.y,-along*s+up*c,aa*d.y+across*d.x));
}
`;
