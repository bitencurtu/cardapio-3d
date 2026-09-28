import * as THREE from 'three';

// Native depth only. No camera capture, readPixels, segmentation, or ML work.
// Sampling uses the transform returned with THIS frame, in top-left view UVs.
export class DepthOcclusion {
  constructor(){
    this.texture=new THREE.DataTexture(new Float32Array([0]),1,1,THREE.RedFormat,THREE.FloatType);
    this.texture.needsUpdate=true;
    this.uniforms={
      uRealDepth:{value:this.texture},uDepthActive:{value:0},
      uDepthTransform:{value:new THREE.Matrix4()},uDepthScale:{value:1},
      uDepthPacked:{value:0},uDepthViewport:{value:new THREE.Vector4(0,0,1,1)}
    };
    this.failed=false;this.clones=new Set();
  }
  attach(root){
    const cache=new Map();
    root.traverse(o=>{
      if(!o.isMesh)return;
      const clone=m=>{
        if(cache.has(m))return cache.get(m);
        const copy=m.clone();cache.set(m,copy);this.clones.add(copy);
        copy.onBeforeCompile=shader=>{
          Object.assign(shader.uniforms,this.uniforms);
          shader.vertexShader='varying float vOcclusionZ;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvOcclusionZ = -mvPosition.z;');
          shader.fragmentShader=`
            uniform sampler2D uRealDepth;
            uniform float uDepthActive, uDepthScale, uDepthPacked;
            uniform mat4 uDepthTransform;
            uniform vec4 uDepthViewport;
            varying float vOcclusionZ;
          `+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
            if (uDepthActive > 0.5) {
              vec2 uv = (gl_FragCoord.xy - uDepthViewport.xy) / uDepthViewport.zw;
              uv.y = 1.0 - uv.y;
              vec2 duv = (uDepthTransform * vec4(uv, 0.0, 1.0)).xy;
              if (all(greaterThanEqual(duv,vec2(0.0))) && all(lessThanEqual(duv,vec2(1.0)))) {
                vec2 raw = texture2D(uRealDepth,duv).rg;
                float meters = (uDepthPacked > 0.5 ? dot(raw,vec2(255.0,65280.0)) : raw.r) * uDepthScale;
                if (meters > 0.08 && meters < vOcclusionZ - 0.025) discard;
              }
            }
          `);
        };
        copy.customProgramCacheKey=()=> 'native-cpu-depth-v1';
        return copy;
      };
      o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
      o.onBeforeRender=(_renderer,_scene,cam)=>{
        if(cam.viewport)this.uniforms.uDepthViewport.value.copy(cam.viewport);
      };
    });
  }
  update(frame,pose){
    this.uniforms.uDepthActive.value=0;
    if(this.failed||!frame?.getDepthInformation||pose?.views?.length!==1)return false;
    try{
      const info=frame.getDepthInformation(pose.views[0]);
      if(!info||!info.width||!info.height||info.width*info.height>1048576)return false;
      const format=frame.session.depthDataFormat;
      if(!['float32','luminance-alpha','unsigned-short'].includes(format))return false;
      const floats=format==='float32',array=floats?new Float32Array(info.data):new Uint8Array(info.data);
      const glFormat=floats?THREE.RedFormat:THREE.RGFormat,glType=floats?THREE.FloatType:THREE.UnsignedByteType;
      if(this.texture.type!==glType||this.texture.image.width!==info.width||this.texture.image.height!==info.height){
        this.texture.dispose();
        this.texture=new THREE.DataTexture(array,info.width,info.height,glFormat,glType);
        this.texture.minFilter=this.texture.magFilter=THREE.NearestFilter;
        this.texture.unpackAlignment=1;
        this.uniforms.uRealDepth.value=this.texture;
      }else this.texture.image.data=array;
      this.texture.needsUpdate=true;
      this.uniforms.uDepthTransform.value.fromArray(info.normDepthBufferFromNormView.matrix);
      this.uniforms.uDepthScale.value=info.rawValueToMeters;
      this.uniforms.uDepthPacked.value=floats?0:1;
      this.uniforms.uDepthActive.value=1;
      return true;
    }catch(e){
      // Missing permission/support is a normal capability result, never a render failure.
      this.failed=true;return false;
    }
  }
  dispose(){this.uniforms.uDepthActive.value=0;this.texture.dispose();this.clones.forEach(m=>m.dispose());this.clones.clear();}
}
