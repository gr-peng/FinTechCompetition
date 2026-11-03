import {judgeWindow as window,judgeRect} from '../judge-viewport.js';
// R1.1 optical shader, integrated into the complete App with one shared context.
import {vertex, background, fragment, makeBackground} from './shaders.js';
import {distribution, GpuTimer} from './timing.js';
import {rasterScale, visibleSurfaces, qualityDecision, TEXTURE_LIMIT, MAX_SURFACES} from './policy.js';
import {BankMetal} from './metal-card.js';

export class AppGlass {
  constructor(app, canvas, onStatus, options = {}) {
    Object.assign(this, {app, canvas, onStatus, options, enabled:true, targets:[], shapes:[], dirty:true,
      frames:0, skipped:0, geometryReads:0, backgroundBuilds:0, epoch:0, raf:0, cap:1.5,
      cpu:[], painted:new Set(), lost:false, disposed:false, terminal:false});
    this.visible=[]; this.nextPainted=new Set(); this.lastElements=[];
    this.lastGeometry=new Float64Array(MAX_SURFACES*6); this.hasDrawn=false;
    this.originalBackground = app.style.background;
    this.motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
    this.motionChanged=()=>{if(this.metal)for(const item of this.metal.items.values())item.dirty=true;this.requestDraw();};
    this.motionQuery.addEventListener('change',this.motionChanged);
    this.gl = options.noWebgl ? null : canvas.getContext('webgl2', {alpha:true, antialias:false,
      depth:false, stencil:false, premultipliedAlpha:true, powerPreference:'low-power'});
    this.ro = new ResizeObserver(() => {this.dirty = true; this.requestDraw();});
    this.handlers = {
      scroll:() => this.requestDraw(), resize:() => this.resize().catch(e => this.fallback(e.message, true)),
      visibility:() => {if(document.hidden) {this.cancel();this.metal?.pause();} else {this.dirty = true; this.requestDraw();} this.status();},
      lost:event => {event.preventDefault(); this.lost = true; this.fallback('context-lost');},
      restored:() => {this.metal?.dispose({lost:true});this.metal=null;this.lost = false; this.resources = false; this.texture = this.source = this.fbo = null;
        this.gpu = null; this.key = null; this.resize().catch(e => this.fallback(e.message, true));}
    };
    window.addEventListener('scroll', this.handlers.scroll, {passive:true});
    window.addEventListener('resize', this.handlers.resize, {passive:true});
    window.visualViewport?.addEventListener('resize', this.handlers.resize, {passive:true});
    document.addEventListener('visibilitychange', this.handlers.visibility);
    canvas.addEventListener('webglcontextlost', this.handlers.lost);
    canvas.addEventListener('webglcontextrestored', this.handlers.restored);
  }
  program(v, f) {
    const gl = this.gl, shaders = [], p = gl.createProgram();
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER,v],[gl.FRAGMENT_SHADER,f]]) {
        const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('shader compilation failed');
        gl.attachShader(p, shader);
      }
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error('shader link failed');
      return p;
    } catch(e) {gl.deleteProgram(p); throw e;}
    finally {for(const s of shaders) gl.deleteShader(s);}
  }
  setTargets(targets) {
    this.ro.disconnect(); this.targets = targets; this.dirty = true;
    for (const e of targets) this.ro.observe(e);
    // New route nodes retain their original CSS until their first successful draw.
    for (const e of this.painted) if(!e.isConnected) this.painted.delete(e);
    this.requestDraw();
  }
  setBankCards(cards){this.bankCards=[...cards];this.metal?.setCards(this.bankCards);}
  async resize() {
    if (this.disposed || this.terminal) return;
    const rect = judgeRect(this.app), width = rect.width, height = window.innerHeight;
    if (!width || !height) return;
    this.canvas.style.left = `${rect.left}px`; this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.width = width; this.height = height;
    this.dpr = rasterScale(width, height, devicePixelRatio || 1, this.cap);
    const w = Math.max(1,Math.floor(width * this.dpr)), h = Math.max(1,Math.floor(height * this.dpr));
    const key = `${width}/${height}/${w}/${h}`;
    this.dirty = true;
    if (key === this.key && this.resources) {this.requestDraw(); return;}
    const epoch = ++this.epoch;
    if (!this.gl) {this.fallback('WebGL2 unavailable', true); return;}
    const image = await makeBackground(w,h);
    if (epoch !== this.epoch || this.disposed || this.lost) return;
    const gl = this.gl;
    if (!this.resources) {
      this.bgProgram = this.program(vertex, background);
      this.programGlass = this.program(vertex, this.options.compileFailure ? fragment + '\n deliberate failure' : fragment);
      this.uniforms = Object.fromEntries(['backdrop','size','shape','shapeRadius','isNav','isBank','dispersion']
        .map(name => [name, gl.getUniformLocation(this.programGlass,name)]));
      this.bgSource = gl.getUniformLocation(this.bgProgram,'source');
      this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
      this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      this.gpu = new GpuTimer(gl); this.resources = true;
      try{this.metal=new BankMetal(gl,(v,f)=>this.program(v,f),this.vao,()=>this.requestDraw(),{reduced:()=>this.motionQuery.matches||document.documentElement.dataset.reduceMotion==='true'});this.metal.setCards(this.bankCards||[]);}
      catch(e){this.bankReason=e.message;this.metal?.dispose();this.metal=null;}
    }
    this.clearPainted();
    this.canvas.width = w; this.canvas.height = h;
    for(const t of [this.source,this.texture]) if(t) gl.deleteTexture(t);
    if(this.fbo) gl.deleteFramebuffer(this.fbo);
    const texture = () => {const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); return t;};
    gl.activeTexture(gl.TEXTURE0); this.source = texture();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    this.texture = texture();
    gl.texStorage2D(gl.TEXTURE_2D,Math.floor(Math.log2(Math.max(w,h)))+1,gl.RGBA8,w,h);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error('background framebuffer incomplete');
    // Source and destination are separate textures; no feedback loop.
    gl.bindTexture(gl.TEXTURE_2D,this.source); gl.useProgram(this.bgProgram); gl.uniform1i(this.bgSource,0);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.viewport(0,0,w,h);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES,0,6);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.bindTexture(gl.TEXTURE_2D,this.texture); gl.generateMipmap(gl.TEXTURE_2D);
    if(gl.getError()!==gl.NO_ERROR) throw Error('background allocation or draw failed');
    this.sourcePixels = image.getContext('2d').getImageData(0,0,w,h).data;
    this.visibleBackground = `url("${image.toDataURL()}") center top / ${width}px ${height}px no-repeat fixed`;
    this.textureBytes = Math.ceil(w*h*4*(1+4/3))+(this.metal?256*256*4*3:0); this.key = key; this.backgroundBuilds++;
    this.hasDrawn = false; this.requestDraw(); this.status();
  }
  geometry() {
    if(this.dirty) {
      // The canvas remains hidden until a successful first draw. A hidden canvas
      // has a zero DOMRect, so use the visible App's x origin and fixed top=0.
      const originLeft = judgeRect(this.app).left; this.geometryReads++;
      this.shapes = this.targets.filter(e=>e.isConnected).map((e,order)=>{
        const r = judgeRect(e), s = getComputedStyle(e), fixed = s.position === 'fixed';
        return {e,order,nav:e.dataset.fpOptical==='nav',bank:e.dataset.fpOptical==='bank',fixed,docY:r.top+(fixed?0:window.scrollY),
          radius:Math.min(parseFloat(s.borderTopLeftRadius)||0,r.height/2,r.width/2),
          rect:new Float32Array([r.left-originLeft,r.top,r.width,r.height])};
      }); this.dirty = false;
    }
    for(const s of this.shapes) s.rect[1] = s.docY-(s.fixed?0:window.scrollY);
    return visibleSurfaces(this.shapes,this.height,MAX_SURFACES,this.visible);
  }
  draw() {
    if(!this.enabled || this.terminal || !this.resources || this.lost || document.hidden || this.disposed) return;
    const start = performance.now(), gl = this.gl, shapes = this.geometry();
    // One WebGL2 context. Metal is copied immediately into an ordinary 2D DOM
    // canvas, then this same backing buffer is cleared/redrawn for App glass.
    // This lets the whole card and its sharp HTML foreground share CSS tilt.
    const q = this.gpu.begin();
    let metalCopied=false;
    try{metalCopied=this.metal?.render(start,this.dpr)||false;}catch(e){this.bankReason=e.message;this.metal?.fallback();}
    let same=!metalCopied&&this.hasDrawn&&shapes.length===this.lastElements.length;
    for(let i=0;same&&i<shapes.length;i++) {
      const s=shapes[i],offset=i*6;
      same=s.e===this.lastElements[i]&&s.radius===this.lastGeometry[offset+4]&&(Number(s.nav)+(s.bank?2:0))===this.lastGeometry[offset+5];
      for(let j=0;same&&j<4;j++) same=s.rect[j]===this.lastGeometry[offset+j];
    }
    if(same && this.painted.size===shapes.length) {this.gpu.end(q);this.gpu.poll();this.skipped++; return;}
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.disable(gl.SCISSOR_TEST); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.programGlass); gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.uniform1i(this.uniforms.backdrop,0); gl.uniform2f(this.uniforms.size,this.width,this.height);
    gl.uniform1i(this.uniforms.dispersion,0); gl.enable(gl.SCISSOR_TEST);
    for(const s of shapes) {
      const [x,y,w,h] = s.rect, pad = 24;
      const left = Math.max(0,Math.floor((x-pad)*this.dpr)), right = Math.min(this.canvas.width,Math.ceil((x+w+pad)*this.dpr));
      const bottom = Math.max(0,Math.floor((this.height-y-h-pad)*this.dpr)), top = Math.min(this.canvas.height,Math.ceil((this.height-y+pad)*this.dpr));
      if(right<=left || top<=bottom) continue;
      gl.uniform4fv(this.uniforms.shape,s.rect); gl.uniform1f(this.uniforms.shapeRadius,s.radius);
      gl.uniform1i(this.uniforms.isNav,s.nav?1:0);gl.uniform1i(this.uniforms.isBank,s.bank?1:0); gl.scissor(left,bottom,right-left,top-bottom);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
    gl.disable(gl.SCISSOR_TEST); this.gpu.end(q); this.gpu.poll();
    // Validate the first draw after allocation/restoration. Avoid a synchronous
    // driver error query on every scroll frame; context loss has its own event.
    if(!this.hasDrawn&&gl.getError()!==gl.NO_ERROR) throw Error('glass draw failed');
    this.app.style.background = this.visibleBackground; this.canvas.hidden = false;
    const next = this.nextPainted; next.clear();for(const s of shapes)next.add(s.e);
    for(const e of this.painted) if(!next.has(e)) e.removeAttribute('data-fp-painted');
    for(const e of next) e.dataset.fpPainted = 'true';
    this.nextPainted=this.painted; this.painted = next; this.reason=null; document.body.dataset.fpMaterialState = 'glass';
    this.lastElements.length=shapes.length;
    for(let i=0;i<shapes.length;i++) {const s=shapes[i],offset=i*6;this.lastElements[i]=s.e;
      this.lastGeometry.set(s.rect,offset);this.lastGeometry[offset+4]=s.radius;this.lastGeometry[offset+5]=Number(s.nav)+(s.bank?2:0);}
    this.hasDrawn=true; this.frames++; this.cpu.push(performance.now()-start);
    if(this.cpu.length>240) this.cpu.shift();
    if(this.frames%32===0) this.checkQuality();
    this.status();
    if(this.metal?.active)this.requestDraw();
  }
  checkQuality() {
    const gpu = this.gpu.result(), cpu = distribution(this.cpu);
    const decision = qualityDecision({gpuSamples:gpu.samples,gpuP95:gpu.p95Ms,cpuSamples:cpu.samples,cpuP95:cpu.p95Ms,cap:this.cap});
    if(decision==='lower-resolution') {this.cap = 1; this.cpu=[]; this.gpu.dispose(); this.gpu = new GpuTimer(this.gl);
      this.resize().catch(e=>this.fallback(e.message,true));}
    else if(decision==='readable-fallback') this.fallback('measured-render-budget',true);
  }
  requestDraw() {
    if(this.raf || this.manualBenchmark || !this.enabled || this.terminal || this.lost || document.hidden || this.disposed) return;
    this.raf = requestAnimationFrame(()=>{this.raf=0;try{this.draw();}catch(e){this.fallback(e.message,true);}});
  }
  cancel() {cancelAnimationFrame(this.raf); this.raf=0;}
  clearPainted() {for(const e of this.painted) e.removeAttribute('data-fp-painted'); this.painted.clear(); this.canvas.hidden=true;}
  fallback(reason, terminal = false) {
    this.metal?.fallback();
    this.cancel(); this.clearPainted(); this.app.style.background=this.originalBackground;
    document.body.dataset.fpMaterialState='fallback'; this.reason=reason; this.terminal=terminal; this.hasDrawn=false; this.status();
  }
  setEnabled(enabled, reason='readable-preference') {
    this.enabled=enabled;
    if(!enabled) this.fallback(reason); else if(!this.terminal) {this.reason=null;this.dirty=true;this.requestDraw();}
  }
  status() {
    this.onStatus({version:'r5-rc3-integrated-r11',phase:this.reason||(!this.resources?'initializing':'ready'),
      active:document.body.dataset.fpMaterialState,webgl2:!!this.gl,contextLost:this.lost,
      contexts: this.gl?1:0,visibleSurfaces:this.painted.size,targetCount:this.targets.length,
      dpr:this.dpr,textureBytes:this.textureBytes||0,textureLimitBytes:TEXTURE_LIMIT,
      renderedFrames:this.frames,backgroundBuilds:this.backgroundBuilds,geometryReads:this.geometryReads,
      skippedUnchanged:this.skipped,pendingRaf:!!this.raf,visibility:document.visibilityState,
      documentHasFocus:document.hasFocus(),cpuSubmission:distribution(this.cpu),gpu:this.gpu?.result(),
      bankMetal:{frames:this.metal?.frames||0,active:!!this.metal?.active,reason:this.bankReason||null,sharedWebglContext:true,textureBytes:256*256*4*3},
      arbitraryDomRefraction:false,navReadability:'transparent CSS blur(24px), not optical DOM refraction'});
  }
  verifyBackground() {
    if(!this.gl||!this.fbo||this.lost||!this.sourcePixels) return {available:false};
    const gl=this.gl,w=this.canvas.width,h=this.canvas.height,pixels=new Uint8Array(w*h*4);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    let sum=0,max=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){
      const d=Math.abs(pixels[(y*w+x)*4+c]-this.sourcePixels[((h-1-y)*w+x)*4+c]);sum+=d;max=Math.max(max,d);
    }
    return {available:true,maxChannelDelta:max,meanChannelDelta:sum/(w*h*3),passed:max<=2,
      scope:'controlled visible-source bitmap vs zero-offset FBO; not DOM capture'};
  }
  testLoss() {this.lossExtension=this.gl?.getExtension('WEBGL_lose_context');this.lossExtension?.loseContext();}
  testRestore() {this.lossExtension?.restoreContext();}
  dispose() {
    this.disposed=true; this.epoch++; this.cancel(); this.ro.disconnect(); this.clearPainted(); this.gpu?.dispose();
    this.motionQuery.removeEventListener('change',this.motionChanged);this.metal?.dispose({lost:this.lost});
    window.removeEventListener('scroll',this.handlers.scroll);window.removeEventListener('resize',this.handlers.resize);
    window.visualViewport?.removeEventListener('resize',this.handlers.resize);
    document.removeEventListener('visibilitychange',this.handlers.visibility);
    this.canvas.removeEventListener('webglcontextlost',this.handlers.lost);this.canvas.removeEventListener('webglcontextrestored',this.handlers.restored);
    const gl=this.gl;
    if(gl&&!this.lost){for(const t of [this.source,this.texture])if(t)gl.deleteTexture(t);if(this.fbo)gl.deleteFramebuffer(this.fbo);
      for(const p of [this.bgProgram,this.programGlass])if(p)gl.deleteProgram(p);if(this.buffer)gl.deleteBuffer(this.buffer);if(this.vao)gl.deleteVertexArray(this.vao);}
    this.app.style.background=this.originalBackground; this.canvas.remove();
  }
}
