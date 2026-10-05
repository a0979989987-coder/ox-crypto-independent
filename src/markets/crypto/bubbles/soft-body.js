const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// A bounded, area-preserving deformation tensor. The contact normal shortens
// the bubble; its tangent expands, then a damped spring restores the circle.
export function squeeze(node,nx,ny,pressure){
 if(!Number.isFinite(pressure)||pressure<=0)return;
 const length=Math.hypot(nx,ny);if(!Number.isFinite(length)||!length)return;nx/=length;ny/=length;
 const p=clamp(pressure,0,.15);
 // Contact changes the spring's target, never the rendered shape directly.
 // This avoids a one-frame snap when a pointer or contact normal changes.
 node.pressureX=(node.pressureX||0)+p*(ny*ny-nx*nx);
 node.pressureY=(node.pressureY||0)-p*2*nx*ny;
 const magnitude=Math.hypot(node.pressureX,node.pressureY),limit=.16;
 if(magnitude>limit){node.pressureX*=limit/magnitude;node.pressureY*=limit/magnitude;}
}
export function recover(node,dt=1){
 dt=Number.isFinite(dt)?clamp(dt,0,2):0;
 // Exact critically damped spring: stable at 30 / 60 / 120 Hz, with no
 // overshoot or first-frame Euler jump when a new contact changes the target.
 const frequency=.34,decay=Math.exp(-frequency*dt);
 for(const [key,velocity] of [['strainX','strainVX'],['strainY','strainVY']]){
  let x=node[key]||0,v=node[velocity]||0;
  const target=node[key==='strainX'?'pressureX':'pressureY']||0;
  const displacement=x-target,coefficient=v+frequency*displacement;
  x=target+(displacement+coefficient*dt)*decay;
  v=(v-frequency*coefficient*dt)*decay;
  if(Math.abs(x)+Math.abs(v)<.0001)x=v=0;
  node[key]=x;node[velocity]=v;
 }
 node.pressureX=(node.pressureX||0)*Math.pow(.62,dt);
 node.pressureY=(node.pressureY||0)*Math.pow(.62,dt);
}
export function deformation(node){
 const amount=Math.min(.24,Math.hypot(node.strainX||0,node.strainY||0));
 return {angle:amount?Math.atan2(node.strainY||0,node.strainX||0)/2:0,sx:Math.exp(amount),sy:Math.exp(-amount)};
}
