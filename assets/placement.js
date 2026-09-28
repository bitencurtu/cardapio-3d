// Pure placement math: the manual path never depends on a hit-test source.
export function manualPoint(pose, distance=.55){
  if(!pose?.transform) return null;
  const {position:p,orientation:q}=pose.transform;
  if(![p.x,p.y,p.z,q.x,q.y,q.z,q.w].every(Number.isFinite))return null;
  // World-space forward direction of the camera (local -Z).
  const dx=-2*(q.x*q.z+q.w*q.y),dy=2*(q.w*q.x-q.y*q.z),dz=2*(q.x*q.x+q.y*q.y)-1;
  return {x:p.x+dx*distance,y:p.y+dy*distance,z:p.z+dz*distance};
}
export function surfacePoint(hit,space,viewerPose){
  const pose=hit.getPose(space);if(!pose)return null;
  const q=pose.transform.orientation,p=pose.transform.position,v=viewerPose.transform.position;
  const up=1-2*(q.x*q.x+q.z*q.z);
  const distance=Math.hypot(p.x-v.x,p.y-v.y,p.z-v.z);
  if(up<.82||distance<.18||distance>2.5||p.y>v.y+.03)return null;
  return {x:p.x,y:p.y,z:p.z,distance};
}
export function stablePoint(samples,now,p){
  const next=samples.filter(s=>now-s.t<250);
  if(next.some(s=>Math.hypot(s.x-p.x,s.y-p.y,s.z-p.z)>.035))next.length=0;
  next.push({...p,t:now});
  const ready=next.length>=3&&now-next[0].t>=100;
  return {samples:next,ready};
}
