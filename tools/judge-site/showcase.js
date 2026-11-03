import './judge-static.js';
import {offlineEnabled} from './offline-demo.js';
import {appURL,demoResetKeys,deviceScale} from './desktop-session.js';
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
frame.addEventListener('load',()=>{frame.contentWindow.addEventListener('hashchange',markStep);markStep();});
steps.forEach(button=>button.addEventListener('click',()=>{frame.contentWindow.location.hash=button.dataset.route;frame.focus();}));
document.getElementById('reset').addEventListener('click',()=>{
 if(offlineEnabled(location.href)){frame.contentWindow.postMessage({type:'finpilot-reset-session'},location.origin);return;}
 for(const key of demoResetKeys(Object.keys(localStorage),session))localStorage.removeItem(key);
 frame.src=appURL(location.href,'/today').href;
});
openApp.href=initial.href;frame.src=initial.href;

if(CSS.supports('-moz-appearance','none'))document.addEventListener('pointermove',event=>{document.documentElement.dataset.scrollbarHover=String(document.documentElement.scrollHeight>innerHeight&&innerWidth-event.clientX<12);},{passive:true});

const offline=offlineEnabled(location.href),toggleURL=new URL(location.href);
document.documentElement.dataset.offline=String(offline);
if(offline){toggleURL.searchParams.delete('offline');toggleURL.searchParams.set('session',toggleURL.searchParams.get('online_session')||'latest-local');toggleURL.searchParams.delete('online_session');}
else{toggleURL.searchParams.set('online_session',session);toggleURL.searchParams.set('session','offline-preview');toggleURL.searchParams.set('offline','1');toggleURL.hash='/bot';}
document.getElementById('mode-label').textContent=offline?'离线展示':'在线对话';
const modeSwitch=document.getElementById('mode-switch');modeSwitch.hidden=true;modeSwitch.removeAttribute('href');modeSwitch.textContent=offline?'返回在线模式':'试用离线展示';
const guide=document.getElementById('offline-guide');guide.hidden=!offline;guide.open=offline;
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{if(offline)frame.contentWindow.postMessage({type:'finpilot-offline-prefill',key:button.dataset.prompt},location.origin);}));

document.querySelector('[data-birthday-clock]')?.addEventListener('click',()=>{if(offline)frame.contentWindow.postMessage({type:'finpilot-advance-birthday'},location.origin);});

document.querySelector('[data-ride-clock]')?.addEventListener('click',()=>{if(offline)frame.contentWindow.postMessage({type:'finpilot-advance-ride-reminder'},location.origin);});

addEventListener('message',event=>{if(offline&&event.origin===location.origin&&event.source===frame.contentWindow&&event.data?.type==='finpilot-offline-ready')markStep();});
