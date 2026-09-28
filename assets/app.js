import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {catalog} from './catalog.js';
import {manualPoint,surfacePoint,stablePoint} from './placement.js';
import {DepthOcclusion} from './depth.js';

const $=id=>document.getElementById(id), viewer=document.querySelector('.viewer');
const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const categories=['Todos','Lanches','Combos','Porções','Bebidas'];
let category='Todos',query='',selected=null,selection=0,previewGeneration=0;
let renderer,scene,camera,controls,previewRoot=null,previewShown=false;
let xr=null,opening=false,arEpoch=0,iosModule=null,iosURL=null;
const loader=new GLTFLoader(),models=new Map();
const lowMemory=(navigator.deviceMemory||4)<=4;

function status(text,progress=0){$('status').textContent=text;$('loadBar').style.width=progress+'%';}
function filtered(){return catalog.filter(i=>(category==='Todos'||i.cat===category)&&(!query||(i.name+' '+i.desc).toLocaleLowerCase('pt-BR').includes(query)));}
function tabs(){
  $('tabs').replaceChildren(...categories.map(c=>{
    const b=document.createElement('button');b.className='tab'+(c===category?' active':'');
    b.textContent=c;b.setAttribute('aria-pressed',c===category);
    b.onclick=()=>{category=c;const list=filtered();if(!list.includes(selected))choose(list[0]||null);tabs();cards();};return b;
  }));
}
function cards(){
  const items=filtered();$('products').replaceChildren();
  if(!items.length){const p=document.createElement('p');p.className='nomatches';p.textContent='Nenhum produto encontrado.';$('products').append(p);}
  items.forEach(item=>{
    const b=document.createElement('button');b.className='menuitem'+(item===selected?' active':'');b.setAttribute('aria-pressed',item===selected);
    const thumb=document.createElement('span');thumb.className='menuthumb';
    if(item.image){const img=document.createElement('img');img.src=item.image;img.alt='';img.loading='lazy';img.draggable=false;thumb.append(img);}else thumb.textContent=item.emoji;
    const d=document.createElement('span'),n=document.createElement('strong'),desc=document.createElement('small'),price=document.createElement('em');
    n.textContent=item.name;desc.textContent=item.desc;price.textContent=item.price;d.append(n,desc,price);b.append(thumb,d);
    b.onclick=()=>choose(item);$('products').append(b);
  });
}
function removePreview(){
  if(previewRoot){scene?.remove(previewRoot);previewRoot=null;}
  previewShown=false;viewer.classList.remove('is3d');
  $('viewBadge').textContent='IMAGEM DO PRODUTO';$('viewHint').textContent='';$('previewBtn').textContent='VISUALIZAR EM 3D';
}
function choose(item){
  selected=item;selection++;previewGeneration++;removePreview();cards();
  $('artfigure').replaceChildren();$('chips').replaceChildren();
  $('previewBtn').disabled=$('arBtn').disabled=!item;
  if(!item){$('name').textContent='Nenhum item encontrado';$('price').textContent='—';$('desc').textContent='Experimente outra busca.';status('');return;}
  $('kick').textContent=item.kick;$('name').textContent=item.name;$('price').textContent=item.price;$('desc').textContent=item.desc;
  for(const chip of item.chips){const s=document.createElement('span');s.textContent=chip;$('chips').append(s);}
  if(item.image){const img=document.createElement('img');img.src=item.image;img.alt=item.name;img.draggable=false;$('artfigure').append(img);}
  else{const s=document.createElement('span');s.className='artemoji';s.textContent=item.emoji;$('artfigure').append(s);}
  if(item.combo){const s=document.createElement('span');s.className='artcombo';s.textContent='🍟🥤';$('artfigure').append(s);}
  status('Veja o modelo em 3D ou coloque na sua mesa.');
}
$('search').addEventListener('input',()=>{query=$('search').value.trim().toLocaleLowerCase('pt-BR');const items=filtered();if(!items.includes(selected))choose(items[0]||null);cards();});

function init3D(){
  if(renderer)return;
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,powerPreference:'default'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');renderer.xr.setFramebufferScaleFactor(lowMemory?.68:.82);
  $('canvas').append(renderer.domElement);
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,1,.01,15);
  scene.add(new THREE.HemisphereLight(0xffffff,0x59473b,2.1));
  const light=new THREE.DirectionalLight(0xffecd5,2.4);light.position.set(.5,.9,.7);scene.add(light);
  const fill=new THREE.DirectionalLight(0xffffff,.7);fill.position.set(-.6,.4,-.4);scene.add(fill);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.enablePan=false;
  controls.maxPolarAngle=Math.PI*.66;controls.addEventListener('change',renderPreview);
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();if(xr)xr.session.end().catch(()=>{});status('A visualização foi interrompida. Recarregue a página para tentar novamente.');});
  new ResizeObserver(resize).observe(viewer);resize();
}
function resize(){
  if(!renderer||xr||opening)return;
  const r=viewer.getBoundingClientRect();renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.4));
  renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderPreview();
}
function renderPreview(){if(renderer&&!xr&&!opening&&previewShown)renderer.render(scene,camera);}
function ground(root){
  root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root),center=box.getCenter(new THREE.Vector3());
  root.position.x-=center.x;root.position.z-=center.z;root.position.y-=box.min.y;root.updateMatrixWorld(true);return root;
}
function fit(root){
  const box=new THREE.Box3().setFromObject(root),sphere=box.getBoundingSphere(new THREE.Sphere());
  const fov=THREE.MathUtils.degToRad(camera.fov),effective=Math.min(fov,2*Math.atan(Math.tan(fov/2)*camera.aspect));
  const dist=sphere.radius/Math.sin(effective/2)*1.14;
  controls.target.copy(sphere.center);camera.position.copy(sphere.center).add(new THREE.Vector3(.32,.30,1).normalize().multiplyScalar(dist));
  controls.minDistance=sphere.radius*1.7;controls.maxDistance=dist*2.5;controls.update();
}
async function baseModel(id){
  if(!models.has(id)){
    const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),15000);
    const p=fetch('models/'+id+'.glb?v=20260928-r2',{signal:abort.signal})
      .then(r=>{if(!r.ok)throw new Error('Falha ao carregar '+id+': '+r.status);return r.arrayBuffer();})
      .then(bytes=>loader.parseAsync(bytes,'./models/')).then(g=>ground(g.scene))
      .catch(e=>{models.delete(id);throw e;}).finally(()=>clearTimeout(timeout));
    models.set(id,p);
  }
  return (await models.get(id)).clone(true);
}
const comboBurger={combo_xbacon:'xbacon',combo_xtudo:'xtudo_bbq',combo_xonion:'xonion'};
const trayGeometry=new THREE.CylinderGeometry(.174,.17,.005,48),trayMaterial=new THREE.MeshStandardMaterial({color:0x292a2c,roughness:.9});
async function build(item){
  let root;
  if(comboBurger[item.model]){
    const [burger,fries,soda]=await Promise.all([baseModel(comboBurger[item.model]),baseModel('fries'),baseModel('soda')]);
    root=new THREE.Group();const tray=new THREE.Mesh(trayGeometry,trayMaterial);tray.position.y=.0025;root.add(tray);
    burger.position.add(new THREE.Vector3(-.073,.006,.025));fries.position.add(new THREE.Vector3(.063,.006,.058));soda.position.add(new THREE.Vector3(.072,.006,-.062));root.add(burger,fries,soda);
  }else root=await baseModel(item.model);
  root.scale.multiplyScalar(item.scale||1);return root;
}
$('previewBtn').onclick=async()=>{
  if(!selected||opening||xr)return;
  if(previewShown){removePreview();status('Imagem do produto.');return;}
  const item=selected,token=selection,job=++previewGeneration;$('previewBtn').disabled=true;status('Carregando o modelo 3D…',12);
  try{
    init3D();const model=await build(item);
    if(token!==selection||job!==previewGeneration||opening||xr)return;
    removePreview();previewRoot=model;scene.add(model);previewShown=true;viewer.classList.add('is3d');resize();fit(model);renderPreview();
    $('viewBadge').textContent='MODELO 3D';$('viewHint').textContent='Arraste para girar · pinça para aproximar';$('previewBtn').textContent='VOLTAR À IMAGEM';status('Modelo 3D pronto.',100);
  }catch(e){console.error(e);if(token===selection)status('Não foi possível carregar o modelo. Toque em visualizar para tentar novamente.');}
  finally{if(token===selection)$('previewBtn').disabled=false;}
};

function scanText(state,title,description,measure){
  if(!state||state!==xr)return;
  if(title)$('prepTitle').textContent=title;if(description)$('prepText').textContent=description;if(measure)$('scanMeasure').textContent=measure;
}
function resetScan(){
  $('arui').classList.remove('hidden');$('prep').classList.remove('done');$('scanMarker').classList.remove('found');
  $('manualPlace').disabled=false;$('manualPlace').textContent='COLOCAR AQUI';$('manualPlace').classList.add('show');
  $('pill').classList.remove('show');$('exit').disabled=false;$('exit').textContent='SAIR';
  $('prepTitle').textContent='APONTE PARA A MESA';$('prepText').textContent='Mova o celular devagar. O lanche aparece ao encontrar a superfície.';
  $('scanMeasure').textContent='INICIANDO CÂMERA…';$('prepBar').style.width='0';
}
function place(state,point,frame,hit=null,manual=false){
  if(!point||state!==xr||state.placed||!state.pose)return false;
  const v=state.pose.transform.position,yaw=Math.atan2(v.x-point.x,v.z-point.z);
  const pos=new THREE.Vector3(point.x,point.y+.002,point.z),quat=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
  const desired=new THREE.Matrix4().compose(pos,quat,new THREE.Vector3(1,1,1));
  state.root.matrix.copy(desired);state.root.matrixWorldNeedsUpdate=true;state.root.visible=true;
  state.placed=true;state.manual=false;state.reticle.visible=false;
  $('prep').classList.add('done');$('pill').textContent=manual?'POSIÇÃO APROXIMADA':'NA SUA MESA';$('pill').classList.add('show');
  // Start creation inside the live XR frame. Resolve later, without delaying display.
  let anchorPromise;
  try{
    if(hit?.createAnchor)anchorPromise=hit.createAnchor();
    else if(frame.createAnchor&&typeof XRRigidTransform!=='undefined')anchorPromise=frame.createAnchor(new XRRigidTransform(pos,quat),state.space);
  }catch{}
  if(anchorPromise)anchorPromise.then(anchor=>{
    if(state!==xr){anchor.delete?.();return;}state.anchor=anchor;state.anchorDesired=desired.clone();
  }).catch(()=>{});
  try{state.hitSource?.cancel();}catch{}state.hitSource=null;return true;
}
function anchorUpdate(state,frame){
  if(!state.anchor)return;
  try{
    const p=frame.getPose(state.anchor.anchorSpace,state.space);if(!p)return;
    const m=new THREE.Matrix4().fromArray(p.transform.matrix);
    if(state.anchorDesired){state.anchorOffset=m.clone().invert().multiply(state.anchorDesired);state.anchorDesired=null;}
    state.root.matrix.copy(m.multiply(state.anchorOffset));state.root.matrixWorldNeedsUpdate=true;
  }catch{}
}
function arLoop(time,frame){
  const state=xr;if(!state||!frame||!state.space)return;
  // Always render even if a capability returns an error for this frame.
  try{
    state.pose=frame.getViewerPose(state.space);
    state.depth.uniforms.uDepthActive.value=0;
    if(state.pose){
      if(state.placed){anchorUpdate(state,frame);if(state.depthSupported)state.depth.update(frame,state.pose);}
      else{
        let hits=[];if(state.hitSource){try{hits=frame.getHitTestResults(state.hitSource);}catch{state.hitSource=null;}}
        let point=null,hit=null;
        for(const candidate of hits){const p=surfacePoint(candidate,state.space,state.pose);if(p){point=p;hit=candidate;break;}}
        // This branch deliberately runs with no hit source and with zero hits.
        if(state.manual&&state.loaded){place(state,point||manualPoint(state.pose),frame,hit,true);}
        else if(point){
          state.reticle.visible=true;state.reticle.position.set(point.x,point.y+.001,point.z);
          const stable=stablePoint(state.samples,time,point);state.samples=stable.samples;
          $('scanMarker').classList.add('found');
          if(time-state.lastUI>160){scanText(state,state.loaded?'MESA ENCONTRADA':'CARREGANDO O LANCHE…','Mantenha o celular por um instante.',Math.round(point.distance*100)+' cm de distância');state.lastUI=time;}
          if(stable.ready&&state.loaded)place(state,point,frame,hit);
        }else{
          state.samples=[];state.reticle.visible=false;$('scanMarker').classList.remove('found');
          if(time-state.lastUI>250){
            scanText(state,state.loaded?'APONTE PARA A MESA':'CARREGANDO O LANCHE…',time-state.started>5000?'Mesa de vidro? Mire no tampo e toque em Colocar aqui.':'Mova o celular devagar ou escolha Colocar aqui.',state.manual?'POSICIONANDO…':'POSIÇÃO MANUAL · CERCA DE 55 cm');state.lastUI=time;
          }
        }
      }
    }else{
      state.reticle.visible=false;
      if(time-state.lastUI>500){scanText(state,'RECUPERANDO A POSIÇÃO','Mantenha o celular apontado para a mesa.','AGUARDANDO CÂMERA');state.lastUI=time;}
    }
  }catch(e){
    state.depth.uniforms.uDepthActive.value=0;
    if(!state.frameError){console.warn('AR frame capability:',e);state.frameError=true;}
  }
  renderer.render(scene,camera);
}
function release(state){
  if(!state||state.released)return;state.released=true;
  try{state.hitSource?.cancel();state.anchor?.delete();}catch{}
  state.space?.removeEventListener('reset',state.onReset);
  scene?.remove(state.root,state.reticle);state.reticle.geometry.dispose();state.reticle.material.dispose();state.depth.dispose();
}
function finish(state){
  release(state);if(xr!==state)return;
  renderer.setAnimationLoop(null);xr=null;opening=false;arEpoch++;
  $('arui').classList.add('hidden');$('page').style.visibility='';$('page').inert=false;
  controls.enabled=true;$('arBtn').disabled=!selected;$('previewBtn').disabled=!selected;
  if(previewRoot)previewRoot.visible=true;
  resize();if(previewRoot)fit(previewRoot);renderPreview();
}
async function startWebXR(item){
  if(!navigator.xr||!window.isSecureContext){status('Para usar a mesa, abra o link HTTPS em um celular compatível com AR.');return;}
  const epoch=++arEpoch;opening=true;previewGeneration++;$('arBtn').disabled=true;$('previewBtn').disabled=true;
  let sessionPromise;
  try{
    init3D();controls.enabled=false;
    // Keep requestSession in the button's user gesture. Hit-test is optional:
    // even a device without plane detection can use manual placement.
    sessionPromise=navigator.xr.requestSession('immersive-ar',{
      requiredFeatures:['dom-overlay'],optionalFeatures:['hit-test','anchors','depth-sensing'],
      domOverlay:{root:$('arui')},depthSensing:{usagePreference:['cpu-optimized'],dataFormatPreference:['luminance-alpha','float32']}
    });
    status('Abrindo a câmera…',10);
    const session=await sessionPromise;
    if(epoch!==arEpoch){await session.end();return;}
    const root=new THREE.Group();root.visible=false;root.matrixAutoUpdate=false;
    const reticle=new THREE.Mesh(new THREE.RingGeometry(.026,.031,36),new THREE.MeshBasicMaterial({color:0xffab54,side:THREE.DoubleSide}));reticle.rotation.x=-Math.PI/2;reticle.visible=false;
    const state={session,root,reticle,depth:new DepthOcclusion(),space:null,hitSource:null,anchor:null,placed:false,loaded:false,manual:false,pose:null,samples:[],started:performance.now(),lastUI:0};
    xr=state;scene.add(root,reticle);if(previewRoot)previewRoot.visible=false;
    // Let Three restore the XR framebuffer before resuming the page renderer.
    session.addEventListener('end',()=>queueMicrotask(()=>finish(state)),{once:true});
    resetScan();$('page').style.visibility='hidden';$('page').inert=true;
    await renderer.xr.setSession(session);if(xr!==state)return;
    state.space=renderer.xr.getReferenceSpace();
    state.onReset=e=>{
      if(state.placed&&!state.anchor&&e.transform){state.root.matrix.premultiply(new THREE.Matrix4().fromArray(e.transform.matrix).invert());state.root.matrixWorldNeedsUpdate=true;}
    };
    state.space.addEventListener('reset',state.onReset);
    try{state.depthSupported=session.depthUsage==='cpu-optimized';}catch{state.depthSupported=false;}
    opening=false;renderer.setAnimationLoop(arLoop);
    // Detection and model loading are independent; a failed hit source is not fatal.
    session.requestReferenceSpace('viewer').then(space=>session.requestHitTestSource?.({space})).then(source=>{
      if(state!==xr||state.placed){source?.cancel();return;}state.hitSource=source||null;
    }).catch(()=>{if(state===xr)scanText(state,'ESCOLHA A POSIÇÃO','Mire no tampo da mesa e toque em Colocar aqui.');});
    build(item).then(model=>{
      if(state!==xr)return;
      state.depth.attach(model);root.add(model);state.loaded=true;
      // Compile once before displaying instead of stalling at placement.
      try{renderer.compile(model,camera,scene);}catch{}
    }).catch(async e=>{
      console.error(e);if(state!==xr)return;
      try{await session.end();}catch{}
      finish(state);status('Não foi possível carregar o lanche. Tente novamente.');
    });
  }catch(e){
    console.warn('AR:',e);
    const state=xr;
    if(state){try{await state.session.end();}catch{}finish(state);}
    opening=false;controls&&(controls.enabled=true);$('arBtn').disabled=!selected;$('previewBtn').disabled=!selected;
    status(e.name==='NotAllowedError'?'A câmera não foi autorizada. Toque em Ver na mesa para tentar novamente.':'AR indisponível neste navegador. Você pode usar a visualização 3D.');renderPreview();
  }
}
$('manualPlace').onclick=()=>{
  if(!xr||xr.placed)return;xr.manual=true;$('manualPlace').textContent='POSICIONANDO…';
  // The live animation frame will use a fresh pose, never an expired XRFrame.
};
$('arui').addEventListener('beforexrselect',e=>e.preventDefault());
$('exit').onclick=async()=>{
  const state=xr;if(!state)return;$('exit').disabled=true;
  try{await state.session.end();}catch{$('exit').disabled=false;$('exit').textContent='TENTAR SAIR';}
};
async function startIOS(item){
  const token=selection;$('arBtn').disabled=true;status('Preparando a visualização na mesa…',20);
  try{
    if(!iosModule)iosModule=import('https://unpkg.com/@google/model-viewer@4.2.0/dist/model-viewer.min.js').catch(e=>{iosModule=null;throw e;});
    await iosModule;await customElements.whenDefined('model-viewer');
    const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
    const buffer=await new GLTFExporter().parseAsync(await build(item),{binary:true});if(token!==selection)return;
    if(iosURL)URL.revokeObjectURL(iosURL);iosURL=URL.createObjectURL(new Blob([buffer],{type:'model/gltf-binary'}));
    const mv=$('iosAR');
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(new Error('Tempo de carregamento esgotado'));},20000);
      const cleanup=()=>{clearTimeout(timer);mv.removeEventListener('load',ok);mv.removeEventListener('error',fail);};
      const ok=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error('Falha no modelo'));};
      mv.addEventListener('load',ok,{once:true});mv.addEventListener('error',fail,{once:true});mv.src=iosURL;
    });
    if(token!==selection)return;
    if(!mv.canActivateAR)throw new Error('AR indisponível');
    await mv.activateAR();status('Visualização na mesa pronta.',100);
  }catch(e){console.warn(e);if(token===selection)status('Abra no Safari para usar a mesa. A visualização 3D continua disponível.');}
  finally{if(token===selection)$('arBtn').disabled=false;}
}
$('arBtn').onclick=()=>{if(!selected||xr||opening)return;if(isIOS)startIOS(selected);else startWebXR(selected);};
tabs();choose(catalog[0]);
