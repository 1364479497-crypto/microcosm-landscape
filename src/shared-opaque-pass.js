import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';

// Draw the dry scene once at the output resolution. Water and weather read a
// separate colour/depth snapshot while their layers blend over the same frame.
export class SharedOpaquePass extends RenderPass {
  constructor(scene,camera,water,effectRoots) {
    super(scene,camera);
    this.water=water;
    this.effectRoots=new Set(effectRoots);
    this.shared=false;
    this.stats={sharedFrames:0,fallbackFrames:0,fallbackReason:null};
  }

  render(renderer,writeBuffer,readBuffer,deltaTime,maskActive) {
    const {scene,camera,water}=this;
    if (!this.shared || this.renderToScreen || !readBuffer.depthTexture) {
      water.beforeRender();
      super.render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
      return;
    }

    const dry=new Set(),overlays=new Set();
    let fallbackReason=null;
    scene.traverseVisible(object=>{
      if (!object.material || !object.layers.test(camera.layers)) return;
      let overlayObject=false;
      for(let node=object;node&&node!==scene;node=node.parent){
        if(this.effectRoots.has(node))overlayObject=true;
        if(node.isGroup&&node.renderOrder!==0)fallbackReason='custom group ordering';
      }
      const materials=Array.isArray(object.material)?object.material:[object.material];
      for(const material of materials){
        if(!material?.visible)continue;
        if(material.transmission>0)fallbackReason='transmissive material';
        // Keep the worn path and translucent fish fins in the dry snapshot.
        // Clouds, water and other late effects must not sample themselves.
        const overlay=overlayObject||(material.transparent&&object.renderOrder>=3);
        if(overlay&&object.castShadow)fallbackReason='overlay shadow caster';
        if((overlay?dry:overlays).has(material))fallbackReason='material shared across stages';
        (overlay?overlays:dry).add(material);
      }
    });
    this.stats.fallbackReason=fallbackReason;
    if (fallbackReason) {
      this.stats.fallbackFrames++;
      water.beforeRender();
      super.render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
      return;
    }

    water.beforeRender({sharedOpaque:true});
    const previousTarget=renderer.getRenderTarget();
    const previousAutoClear=renderer.autoClear;
    const background=scene.background;
    const shadows=renderer.shadowMap;
    const previousShadowAutoUpdate=shadows.autoUpdate;
    try{
      renderer.autoClear=false;
      renderer.setRenderTarget(readBuffer);
      renderer.clear();
      for(const material of overlays) material.visible=false;
      renderer.render(scene,camera);
      water.copyOpaqueCapture(readBuffer);

      for(const material of overlays) material.visible=true;
      for(const material of dry) material.visible=false;
      scene.background=null;
      shadows.autoUpdate=false;
      renderer.setRenderTarget(readBuffer);
      renderer.render(scene,camera);
      this.stats.sharedFrames++;
    }finally{
      for(const material of dry) material.visible=true;
      for(const material of overlays) material.visible=true;
      scene.background=background;
      shadows.autoUpdate=previousShadowAutoUpdate;
      renderer.autoClear=previousAutoClear;
      renderer.setRenderTarget(previousTarget);
    }
  }
}
