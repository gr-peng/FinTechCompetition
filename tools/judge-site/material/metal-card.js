import {judgeWindow,judgeRect} from '../judge-viewport.js';
// Stitch supplied the reflection formula and spring constants. This file is our
// audited engineering completion: actual separable blur, exact rotations,
// demand-driven frames, shared WebGL context, recovery and resource disposal.
import {tiltTarget,springStep} from './metal-math.js';
export const metalVertex=`#version 300 es
layout(location=0) in vec2 a_position;out vec2 vUv;
void main(){vUv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;
export const blurFragment=`#version 300 es
precision highp float;in vec2 vUv;out vec4 color;
uniform sampler2D source;uniform vec2 direction;
void main(){vec3 c=texture(source,vUv).rgb*.227027027;
 c+=(texture(source,vUv+direction*1.384615384).rgb+texture(source,vUv-direction*1.384615384).rgb)*.316216216;
 c+=(texture(source,vUv+direction*3.230769230).rgb+texture(source,vUv-direction*3.230769230).rgb)*.070270270;
 color=vec4(c,1.);}`;
export const metalFragment=`#version 300 es
precision highp float;in vec2 vUv;out vec4 color;
uniform sampler2D environment;uniform vec2 dimensions;uniform vec2 angle;uniform vec3 tint;uniform vec2 toneRange;
float sdRound(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+vec2(r);return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
vec3 rotateCss(vec3 n){float x=-angle.x,y=angle.y;
 vec3 v=vec3(cos(y)*n.x+sin(y)*n.z,n.y,-sin(y)*n.x+cos(y)*n.z);
 return vec3(v.x,cos(x)*v.y-sin(x)*v.z,sin(x)*v.y+cos(x)*v.z);}
void main(){
 vec2 p=(vUv-.5)*dimensions;float radius=min(24.,min(dimensions.x,dimensions.y)*.5);
 float d=sdRound(p,dimensions*.5,radius);
 float aa=max(fwidth(d),.55),alpha=1.-smoothstep(-aa,aa,d);if(alpha<=0.)discard;
 vec2 g=vec2(sdRound(p+vec2(.5,0.),dimensions*.5,radius)-sdRound(p-vec2(.5,0.),dimensions*.5,radius),
             sdRound(p+vec2(0.,.5),dimensions*.5,radius)-sdRound(p-vec2(0.,.5),dimensions*.5,radius));
 g/=max(length(g),.0001);
 float bevel=1.-smoothstep(0.,10.,-d);
 float noise=(hash(floor(vUv*vec2(500.,90.)))-.5)*.014;
 vec3 N=normalize(rotateCss(normalize(vec3(g*bevel*.55+vec2(noise,noise*.25),1.))));
 vec3 position=rotateCss(vec3((vUv-.5)*vec2(2.,2.*dimensions.y/dimensions.x),0.));
 vec3 I=normalize(position-vec3(0.,0.,2.2));
 vec3 R=reflect(I,N);vec2 q=R.xy/max(R.z,.2);
 vec2 sampleUV=clamp(vUv+.12*q,vec2(.002),vec2(.998));
 vec3 sampleColor=texture(environment,sampleUV).rgb;
 float gray=dot(sampleColor,vec3(.299,.587,.114));
 float fresnel=pow(1.-max(dot(-I,N),0.),3.);
 vec3 metal=tint*mix(toneRange.x,toneRange.y,gray)+vec3(.23,.25,.29)*fresnel*.45;
 float rim=(1.-smoothstep(.5,1.6,abs(d+1.)))*.13;
 metal+=vec3(rim);color=vec4(metal*alpha,alpha);
}`;

function drawEnvironment(ctx){
  // Planar studio scene, drawn locally. No panorama, screenshot or external image.
  const w=ctx.canvas.width,h=ctx.canvas.height;ctx.fillStyle='#101824';ctx.fillRect(0,0,w,h);
  ctx.save();ctx.translate(w*.46,h*.42);ctx.rotate(-.19);ctx.fillStyle='#2678b5';ctx.fillRect(-w*.5,-h*.4,w*.72,h*.73);ctx.restore();
  const x=w*.28,y=h*.62,r=w*.19,g=ctx.createRadialGradient(x-r*.3,y-r*.35,r*.04,x,y,r);
  g.addColorStop(0,'#fff1b7');g.addColorStop(.55,'#d99a55');g.addColorStop(1,'#69472d');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.translate(w*.72,h*.42);ctx.rotate(.37);ctx.fillStyle='#ffffff';ctx.fillRect(-w*.035,-h*.36,w*.07,h*.72);ctx.restore();
}

// Radix-based material grades: default wallet order is violet / black / silver.
// Keep each grade tied to its card identity when it is brought to the front.
// Bounded silver exposure keeps its dark DOM text readable under reflections.
const CARD_GRADES={
 living:{tint:[101/255,77/255,196/255],tone:[.72,1.05]},
 credit:{tint:[28/255,32/255,36/255],tone:[.55,1.8]},
 salary:{tint:[224/255,225/255,230/255],tone:[.86,1.08]}
};

class CardMotion{
 constructor(el,wake,reduced){this.el=el;this.wake=wake;this.reduced=reduced;this.s={x:0,y:0,vx:0,vy:0,tx:0,ty:0};this.dirty=true;this.frames=0;
  this.move=e=>{if(this.reduced()||e.pointerType==='touch')return;const r=el.parentElement.getBoundingClientRect(),t=tiltTarget(e.clientX-r.left,e.clientY-r.top,r.width,r.height);this.s.tx=t.x;this.s.ty=t.y;this.dirty=true;wake();};
  this.touch=e=>{if(e.pointerType!=='touch'||this.reduced())return;const r=el.parentElement.getBoundingClientRect(),t=tiltTarget(e.clientX-r.left,e.clientY-r.top,r.width,r.height);this.s.tx=t.x;this.s.ty=t.y;this.dirty=true;wake();};
  this.reset=()=>{this.s.tx=this.s.ty=0;this.dirty=true;wake();};
  this.up=e=>{if(e.pointerType==='touch')this.reset();};
  el.addEventListener('pointerdown',this.touch,{passive:true});el.addEventListener('pointerup',this.up);
  el.addEventListener('pointermove',this.move,{passive:true});el.addEventListener('pointerleave',this.reset);el.addEventListener('pointercancel',this.reset);el.addEventListener('blur',this.reset);
 }
 tick(dt){if(this.reduced()){this.s={x:0,y:0,vx:0,vy:0,tx:0,ty:0};this.el.style.transform='none';return false;}
  const active=springStep(this.s,dt);this.el.style.transform=`perspective(1000px) rotateX(${this.s.x}deg) rotateY(${this.s.y}deg)`;
  this.el.dataset.metalAngleX=this.s.x.toFixed(3);this.el.dataset.metalAngleY=this.s.y.toFixed(3);return active;
 }
 dispose(){this.el.removeEventListener('pointerdown',this.touch);this.el.removeEventListener('pointerup',this.up);this.el.removeEventListener('pointermove',this.move);this.el.removeEventListener('pointerleave',this.reset);this.el.removeEventListener('pointercancel',this.reset);this.el.removeEventListener('blur',this.reset);this.el.style.transform='';delete this.el.dataset.metalState;}
}

export class BankMetal{
 constructor(gl,program,vao,wake,{reduced=()=>false}={}){
  Object.assign(this,{gl,program,vao,wake,reduced,cards:[],items:new Map(),active:false,last:0,disposed:false,frames:0});
  this.envCanvas=document.createElement('canvas');this.envCanvas.width=this.envCanvas.height=256;this.envCtx=this.envCanvas.getContext('2d');drawEnvironment(this.envCtx);
  this.textures=[];this.fbos=[];
  try{
  this.blur=program(metalVertex,blurFragment);this.metal=program(metalVertex,metalFragment);
  this.bu={source:gl.getUniformLocation(this.blur,'source'),direction:gl.getUniformLocation(this.blur,'direction')};
  this.mu=Object.fromEntries(['environment','dimensions','angle','tint','toneRange'].map(n=>[n,gl.getUniformLocation(this.metal,n)]));
  for(let i=0;i<3;i++){const t=gl.createTexture();this.textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   for(const [p,v]of[[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,p,v);
   if(i){const f=gl.createFramebuffer();this.fbos.push(f);gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('metal framebuffer incomplete');}}
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }catch(error){this.dispose();throw error;}
 }
 setCards(cards){const wanted=new Set(cards);for(const[e,item]of this.items)if(!wanted.has(e)){item.dispose();this.items.delete(e);}
  for(const e of cards)if(!this.items.has(e))this.items.set(e,new CardMotion(e,this.wake,this.reduced));
  this.cards=[...cards];this.last=0;this.wake();
 }
 pause(){this.active=false;this.last=0;}
 render(now,dpr=1){
  if(this.disposed||document.hidden||!this.cards.length)return false;
  const dt=this.last?Math.min(.05,(now-this.last)/1000):1/60;this.last=now;const gl=this.gl;let copied=false;this.active=false;
  for(const e of this.cards){const item=this.items.get(e);if(!e.isConnected||!item)continue;
   const r=judgeRect(e.parentElement);if(r.bottom<0||r.top>judgeWindow.innerHeight)continue;
   const beforeX=item.s.x,beforeY=item.s.y,moving=item.tick(dt);this.active||=moving;
   const canvas=e.querySelector('canvas.bank-metal-canvas');if(!canvas)continue;
   const width=Math.max(1,Math.round(e.clientWidth*Math.min(dpr,1.5))),height=Math.max(1,Math.round(e.clientHeight*Math.min(dpr,1.5)));
   const sizeChanged=canvas.width!==width||canvas.height!==height;
   if(!item.dirty&&!sizeChanged&&beforeX===item.s.x&&beforeY===item.s.y)continue;
   if(width>gl.canvas.width||height>gl.canvas.height)continue;
   // Only reset backing stores after a real untransformed size/DPR change.
   if(sizeChanged){canvas.width=width;canvas.height=height;}
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
   gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,this.envCanvas);
   gl.bindVertexArray(this.vao);gl.disable(gl.BLEND);gl.disable(gl.SCISSOR_TEST);gl.useProgram(this.blur);gl.uniform1i(this.bu.source,0);gl.viewport(0,0,256,256);
   for(let pass=0;pass<2;pass++){gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbos[pass]);gl.bindTexture(gl.TEXTURE_2D,this.textures[pass]);gl.uniform2f(this.bu.direction,pass?0:2/256,pass?2/256:0);gl.drawArrays(gl.TRIANGLES,0,6);}
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);gl.useProgram(this.metal);gl.bindTexture(gl.TEXTURE_2D,this.textures[2]);
   gl.uniform1i(this.mu.environment,0);gl.uniform2f(this.mu.dimensions,e.clientWidth,e.clientHeight);gl.uniform2f(this.mu.angle,item.s.x*Math.PI/180,item.s.y*Math.PI/180);
   const grade=CARD_GRADES[e.dataset.card]||CARD_GRADES.salary;gl.uniform3fv(this.mu.tint,grade.tint);gl.uniform2f(this.mu.toneRange,...grade.tone);
   gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);
   const ctx=canvas.getContext('2d',{alpha:true});ctx.clearRect(0,0,width,height);ctx.drawImage(gl.canvas,0,gl.canvas.height-height,width,height,0,0,width,height);
   e.dataset.metalState='ready';e.dataset.metalFrames=String(++item.frames);item.dirty=false;copied=true;this.frames++;
  }
  if(!this.active)this.last=0;return copied;
 }
 fallback(){this.pause();for(const [e,item]of this.items){e.dataset.metalState='fallback';item.dirty=true;item.s={x:0,y:0,vx:0,vy:0,tx:0,ty:0};e.style.transform='none';}}
 dispose({lost=false}={}){this.disposed=true;for(const item of this.items.values())item.dispose();this.items.clear();if(!lost){const gl=this.gl;for(const t of this.textures)gl.deleteTexture(t);for(const f of this.fbos)gl.deleteFramebuffer(f);if(this.blur)gl.deleteProgram(this.blur);if(this.metal)gl.deleteProgram(this.metal);}this.cards=[];this.active=false;}
}
