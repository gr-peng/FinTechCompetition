import {appURL,demoResetKeys,deviceScale} from './desktop-session.mjs';
import {SCENES} from './showcase-scenes.mjs';
const frame=document.getElementById('app-frame');
const steps=[...document.querySelectorAll('.sc-tour [data-route]')];
const initial=appURL(location.href);
const session=initial.searchParams.get('session');
const openApp=document.getElementById('open-app');
function fit(){document.documentElement.style.setProperty('--device-scale',deviceScale(innerWidth,innerHeight).toFixed(3));}
addEventListener('resize',fit);fit();
function markStep(){
 const route=frame.contentWindow.location.hash.replace(/^#/,'')||'/today';
 const top='/'+route.split('/')[1];
 steps.forEach(button=>button.removeAttribute('aria-current'));
 steps.find(button=>button.dataset.route===top)?.setAttribute('aria-current','step');
 const outer=new URL(location.href);outer.hash=route;history.replaceState(null,'',outer);
 openApp.href=appURL(location.href,route).href;
}
const device=document.querySelector('.sc-device'),trace=document.getElementById('trace'),note=document.getElementById('demo-note'),sceneBox=document.getElementById('scenes');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,matchMedia('(prefers-reduced-motion: reduce)').matches?0:ms));
let sceneRun=0;
function installReplay(){frame.contentWindow.finpilotReplay=text=>JSON.stringify(SCENES.find(scene=>scene.text===text)?.result??null);}
function reload(route){
 for(const key of demoResetKeys(Object.keys(localStorage),session))localStorage.removeItem(key);
 return new Promise(resolve=>{frame.addEventListener('load',resolve,{once:true});const url=appURL(location.href,route);url.searchParams.set('run',String(Date.now()));frame.src=url.href;});
}
async function composer(){for(let i=0;i<40;i++){const input=frame.contentDocument?.querySelector('#chat-input');if(input)return input;await wait(100);}throw Error('composer unavailable');}
async function playScene(scene,button){
 const run=++sceneRun;device.dataset.verdict='';trace.replaceChildren();note.hidden=false;
 sceneBox.querySelectorAll('button').forEach(item=>item.toggleAttribute('aria-pressed',item===button));
 await reload('/bot');if(run!==sceneRun)return;
 const input=await composer();input.value=scene.text;input.dispatchEvent(new Event('input',{bubbles:true}));
 frame.contentDocument.querySelector('[aria-label="发送消息"]').click();
 for(const [index,[title,detail]] of scene.steps.entries()){
  await wait(520);if(run!==sceneRun)return;
  const item=document.createElement('li');item.dataset.final=String(index===scene.steps.length-1);item.dataset.verdict=scene.verdict;
  const name=document.createElement('b'),text=document.createElement('span');name.textContent=title;text.textContent=detail;item.append(name,text);trace.append(item);
 }
 device.dataset.verdict=scene.verdict;
}
for(const scene of SCENES){const button=document.createElement('button');button.type='button';const name=document.createElement('b'),hint=document.createElement('small');name.textContent=scene.label;hint.textContent=scene.hint;button.append(name,hint);button.addEventListener('click',()=>playScene(scene,button));sceneBox.append(button);}
frame.addEventListener('load',()=>{installReplay();frame.contentWindow.addEventListener('hashchange',markStep);markStep();});
steps.forEach(button=>button.addEventListener('click',()=>{frame.contentWindow.location.hash=button.dataset.route;frame.focus();}));
document.getElementById('reset').addEventListener('click',()=>{
 sceneRun++;device.dataset.verdict='';trace.replaceChildren();note.hidden=true;
 // Reload only this demo namespace. API cookies and other sessions stay intact.
 reload('/today');
});
openApp.href=initial.href;frame.src=initial.href;

if(CSS.supports('-moz-appearance','none'))document.addEventListener('pointermove',event=>{document.documentElement.dataset.scrollbarHover=String(document.documentElement.scrollHeight>innerHeight&&innerWidth-event.clientX<12);},{passive:true});
