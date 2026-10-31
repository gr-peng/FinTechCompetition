// Only a fixed profile and an explicit user save may select the credential destination.
export const CHAT_PROVIDER='minimax-official';
export const CHAT_BASE='https://api.minimax.cn/v1';
export const CHAT_PROFILES=Object.freeze([
 Object.freeze({id:CHAT_PROVIDER,label:'MiniMax 官方',model:'MiniMax-M3.1-Flash',base_url:CHAT_BASE}),
 Object.freeze({id:'micu',label:'Micu',model:'deepseek-flash',base_url:'https://www.micuapi.ai/v1'})
]);
const profile=id=>CHAT_PROFILES.find(p=>p.id===id);
export function normalizeModelName(value){
 if(typeof value!=='string'||!value.trim())throw Error('请输入模型名。');
 const model=value.trim();if(model.length>200||!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(model))throw Error('模型名格式不正确。');
 return model;
}
const returnedModel=(value,fallback)=>{try{return normalizeModelName(value);}catch{return fallback;}};
export function normalizeModelStatus(status={}){
 const current=profile(status.provider),supported=!!current&&(status.provider===CHAT_PROVIDER||status.provider_switch===true);
 return {configured:supported&&!!status.configured,provider:current?.id||null,enabled:!!status.enabled,
  agent_enabled:status.agent_enabled!==false,provider_switch:status.provider_switch===true,editable_model:status.editable_model===true,
  model:current?returnedModel(status.model,current.model):null,base_url:current?.base_url||null,
  providers:CHAT_PROFILES.map(p=>({...p,model:returnedModel(status.providers?.find(s=>s.id===p.id)?.model,p.id===current?.id?returnedModel(status.model,p.model):p.model),configured:status.provider_switch===true?status.providers?.some(s=>s.id===p.id&&s.configured===true)===true:p.id===CHAT_PROVIDER&&supported&&!!status.configured})),
  ...(typeof status.csrf==='string'?{csrf:status.csrf}:{})};
}
export async function activateOfficialChat({loadSession,fetchImpl=fetch}){
 const session=await loadSession();
 if(session.provider===CHAT_PROVIDER)return normalizeModelStatus(session);
 const response=await fetchImpl('/api/agent',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},
  body:JSON.stringify({validation_scope:'finpilot-fifteen-v1',text:'你好',tool_catalog:[],run_history:[]})});
 await response.json();const current=await loadSession();
 if(current.provider!==CHAT_PROVIDER)throw Error('现有连接已过期，无法无重启更新接口。请先完成服务更新；无需在旧入口填写 Key。');
 return normalizeModelStatus(current);
}
export function modelConnectionState(status={}){
 const supported=!!profile(status.provider)&&(status.provider===CHAT_PROVIDER||status.provider_switch===true);
 const canConfigure=!!status.enabled&&status.agent_enabled!==false&&supported;
 const message=!status.enabled?'此预览尚未启用模型连接，请先以模型模式启动本地服务。':
  status.agent_enabled===false?'本地服务尚未开启模型规划器，请以模型模式启动本地服务。':
  !supported?'本地服务尚未加载对话服务接口，请先完成服务更新；语音连接保持独立。':
  status.configured?'当前服务的连接已保存在本地服务内存，保存不代表模型已验证。':'请为当前服务填写自己的 Key。';
 return {canConfigure,message};
}
export async function saveModelConnection({provider=CHAT_PROVIDER,baseURL,model,key},{loadSession,fetchImpl=fetch}){
 const session=await loadSession(),readiness=modelConnectionState(session),chosen=profile(provider);
 if(!readiness.canConfigure)throw Error(readiness.message);
 if(!chosen||baseURL!==chosen.base_url)throw Error('服务商与官方接口地址不匹配。');
 const selectedModel=normalizeModelName(model===undefined?chosen.model:model);
 if(!session.editable_model&&(selectedModel!==chosen.model||!key))throw Error('请先发送一条正常消息加载模型设置更新，再保存。');
 if(provider!==CHAT_PROVIDER&&!session.provider_switch)throw Error('本地服务尚未加载切换接口。');
 const response=await fetchImpl('/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},
  body:JSON.stringify({mode:'api',provider,base_url:chosen.base_url,model:selectedModel,key})});
 const result=await response.json();if(!response.ok)throw Error(result.message||'本次连接未保存，请稍后重试。');
 return normalizeModelStatus({...result,agent_enabled:result.agent_enabled??session.agent_enabled});
}
export async function selectModelProvider(provider,{loadSession,fetchImpl=fetch}){
 const session=await loadSession(),readiness=modelConnectionState(session);
 if(!readiness.canConfigure)throw Error(readiness.message);
 if(!profile(provider)||!session.provider_switch)throw Error('本地服务尚未加载切换接口。');
 const response=await fetchImpl('/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({provider,mode:'select'})});
 const result=await response.json();if(!response.ok)throw Error(result.message||'暂时无法切换服务。');
 return normalizeModelStatus(result);
}
