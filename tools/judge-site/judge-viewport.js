// Adapt scrolling to the visible phone, without changing the real Window or app state.
const port=()=>typeof document==='undefined'?null:document.getElementById('judge-phone-viewport');
const eventTarget=(type)=>['scroll','wheel','touchstart','touchmove','keydown'].includes(type)&&port()?port():window;
export const judgeWindow=typeof window==='undefined'?null:new Proxy(window,{get(target,key){
 const p=port();
 if(key==='scrollY')return p?p.scrollTop:target.scrollY;
 if(key==='innerHeight')return p?p.clientHeight:target.innerHeight;
 if(key==='innerWidth')return p?p.clientWidth:target.innerWidth;
 if(key==='visualViewport'&&p)return null;
 if(key==='scrollTo')return (...args)=>(port()||target).scrollTo(...args);
 if(key==='addEventListener'||key==='removeEventListener')return (type,...args)=>eventTarget(type)[key](type,...args);
 const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
}});
export const judgeDocument=typeof document==='undefined'?null:new Proxy(document,{get(target,key){
 if(key==='scrollingElement')return port()||target.scrollingElement;
 const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
}});
export function judgeRect(el){
 if(!el?.getBoundingClientRect)return undefined;
 const r=el.getBoundingClientRect(),p=port();if(!p)return r;
 const box=p.getBoundingClientRect(),scale=box.width/(p.offsetWidth||p.clientWidth)||1;
 return {top:(r.top-box.top)/scale,bottom:(r.bottom-box.top)/scale,left:(r.left-box.left)/scale,right:(r.right-box.left)/scale,height:r.height/scale,width:r.width/scale};
}
