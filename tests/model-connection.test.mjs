import test from 'node:test';
import assert from 'node:assert/strict';
import {modelConnectionState,saveModelConnection,normalizeModelStatus,activateOfficialChat,selectModelProvider,CHAT_PROFILES} from '../web/model-connection.mjs';

test('Micu defaults to deepseek-flash without replacing an edited session model or official profile',()=>{
 assert.equal(CHAT_PROFILES.find(p=>p.id==='micu').model,'deepseek-flash');
 assert.equal(CHAT_PROFILES.find(p=>p.id==='minimax-official').model,'MiniMax-M3.1-Flash');
 const status=normalizeModelStatus({provider:'micu',provider_switch:true,model:'my-chosen-model'});
 assert.equal(status.model,'my-chosen-model');
 assert.equal(status.providers.find(p=>p.id==='micu').model,'my-chosen-model');
});

test('disabled service and disabled planner prevent key submission with specific feedback',async()=>{
 for(const status of [{enabled:false,configured:false},{enabled:true,provider:'minimax-official',agent_enabled:false,configured:false}]){
  assert.equal(modelConnectionState(status).canConfigure,false);
  let posted=false;
  await assert.rejects(saveModelConnection({baseURL:'https://api.minimax.cn/v1',key:'test-not-a-real-credential'},
   {loadSession:async()=>status,fetchImpl:async()=>{posted=true;}}),/本地服务/);
  assert.equal(posted,false);
 }
});

test('saving refreshes the session first and uses its fresh CSRF without replacing the model path',async()=>{
 const events=[];
 const result=await saveModelConnection({baseURL:'https://api.minimax.cn/v1',key:'test-not-a-real-credential'},
  {loadSession:async()=>{events.push('session');return {enabled:true,provider:'minimax-official',agent_enabled:true,provider:'minimax-official',csrf:'fresh-csrf'};},
   fetchImpl:async(path,options)=>{events.push('config');assert.equal(path,'/api/config');assert.equal(options.headers['X-CSRF-Token'],'fresh-csrf');
    assert.deepEqual(JSON.parse(options.body),{mode:'api',provider:'minimax-official',model:'MiniMax-M3.1-Flash',base_url:'https://api.minimax.cn/v1',key:'test-not-a-real-credential'});
    return {ok:true,json:async()=>({enabled:true,provider:'minimax-official',configured:true,agent_enabled:true,provider:'minimax-official',key:'ignored-response-field'})};}});
 assert.deepEqual(events,['session','config']);assert.equal(result.configured,true);assert.equal(result.provider,'minimax-official');assert.equal(result.model,'MiniMax-M3.1-Flash');assert.equal(result.key,undefined);
 assert.match(modelConnectionState(result).message,/保存不代表模型已验证/);
});

test('a rejected save is reported once without automatic retry or false connected state',async()=>{
 let calls=0;
 await assert.rejects(saveModelConnection({baseURL:'https://api.minimax.cn/v1',key:'test-not-a-real-credential'},
  {loadSession:async()=>({enabled:true,provider:'minimax-official',agent_enabled:true,provider:'minimax-official',csrf:'fresh'}),fetchImpl:async()=>{
   calls++;return {ok:false,json:async()=>({message:'本次连接未保存'})};}}),/本次连接未保存/);
 assert.equal(calls,1);
});

test('session failure never sends a key or retries configuration',async()=>{
 let calls=0;
 await assert.rejects(saveModelConnection({baseURL:'https://api.minimax.cn/v1',key:'test-not-a-real-credential'},
  {loadSession:async()=>{throw Error('本地会话不可用');},fetchImpl:async()=>{calls++;}}),/本地会话不可用/);
 assert.equal(calls,0);
});


test('old Micu service cannot receive an official chat credential',async()=>{
 let calls=0;
 const legacy={enabled:true,agent_enabled:true,configured:true};
 assert.equal(normalizeModelStatus(legacy).configured,false);
 assert.equal(modelConnectionState(legacy).canConfigure,false);
 await assert.rejects(saveModelConnection({baseURL:'https://api.minimax.cn/v1',key:'synthetic-official-key'},
  {loadSession:async()=>legacy,fetchImpl:async()=>{calls++;}}),/尚未加载/);
 assert.equal(calls,0);
});

test('arbitrary and Micu destinations never receive official configuration',async()=>{
 for(const baseURL of ['https://www.micuapi.ai/v1','https://example.invalid']){
  let calls=0;
  await assert.rejects(saveModelConnection({baseURL,key:'synthetic-official-key'},
   {loadSession:async()=>({enabled:true,provider:'minimax-official',agent_enabled:true}),fetchImpl:async()=>{calls++;}}),/官方接口/);
  assert.equal(calls,0);
 }
});


test('official activation only refreshes local code and never submits a credential',async()=>{
 let reads=0,calls=0;
 const result=await activateOfficialChat({loadSession:async()=>++reads===1?{csrf:'fresh'}:{provider:'minimax-official',configured:false},fetchImpl:async(path,options)=>{
  calls++;assert.equal(path,'/api/agent');assert.equal(options.headers['X-CSRF-Token'],'fresh');
  assert.deepEqual(JSON.parse(options.body),{validation_scope:'finpilot-fifteen-v1',text:'你好',tool_catalog:[],run_history:[]});
  return {json:async()=>({code:'official_chat_not_configured'})};
 }});
 assert.equal(calls,1);assert.equal(result.configured,false);assert.equal(result.provider,'minimax-official');
});

test('provider selection posts no credential and respects the returned active connection',async()=>{
 const session={enabled:true,agent_enabled:true,provider:'minimax-official',provider_switch:true,csrf:'fresh'};let calls=0;
 const result=await selectModelProvider('micu',{loadSession:async()=>session,fetchImpl:async(path,options)=>{
  calls++;assert.equal(path,'/api/config');assert.equal(options.headers['X-CSRF-Token'],'fresh');assert.deepEqual(JSON.parse(options.body),{provider:'micu',mode:'select'});
  return {ok:true,json:async()=>({provider:'micu',configured:false,enabled:true,provider_switch:true,model:'bad',key:'must-not-return',providers:[{id:'minimax-official',configured:true,key:'hidden'}]})};
 }});
 assert.equal(calls,1);assert.equal(result.configured,false);assert.equal(result.model,'bad');assert.equal(result.key,undefined);assert.equal(result.providers[0].key,undefined);assert.equal(result.providers[0].configured,true);
});

test('Micu save is allowed only with explicit supported profile and matching fixed URL',async()=>{
 const session={enabled:true,agent_enabled:true,provider:'micu',provider_switch:true,csrf:'fresh'};let calls=0;
 const fetchImpl=async(path,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.provider,'micu');assert.equal(body.base_url,'https://www.micuapi.ai/v1');return {ok:true,json:async()=>({...session,configured:true})};};
 await saveModelConnection({provider:'micu',baseURL:CHAT_PROFILES[1].base_url,model:CHAT_PROFILES[1].model,key:'synthetic-micu-key'},{loadSession:async()=>session,fetchImpl});
 await assert.rejects(saveModelConnection({provider:'micu',baseURL:CHAT_PROFILES[0].base_url,key:'synthetic-micu-key'},{loadSession:async()=>session,fetchImpl}),/不匹配/);
 assert.equal(calls,1);
});

test('old service cannot receive a provider selection and unknown status never leaks fields',async()=>{
 let calls=0;await assert.rejects(selectModelProvider('micu',{loadSession:async()=>({provider:'minimax-official',enabled:true}),fetchImpl:async()=>calls++}),/尚未加载/);assert.equal(calls,0);
 const status=normalizeModelStatus({provider:'evil',configured:true,key:'synthetic-secret',token:'synthetic-secret',providers:[{id:'evil',key:'synthetic-secret'}]});
 assert.equal(status.configured,false);assert.equal(status.provider,null);assert.doesNotMatch(JSON.stringify(status),/secret|evil/);
});


test('custom model is trimmed, preserved in status and sent only on explicit save',async()=>{
 const status={provider:'micu',provider_switch:true,editable_model:true,configured:true,enabled:true,csrf:'fresh'};
 let calls=0;
 const result=await saveModelConnection({provider:'micu',baseURL:CHAT_PROFILES[1].base_url,model:'  vendor/custom-model:fast  ',key:''},
 {loadSession:async()=>status,fetchImpl:async(path,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.model,'vendor/custom-model:fast');assert.equal(body.key,'');
  return {ok:true,json:async()=>({...status,model:body.model})};
 }});
 assert.equal(calls,1);assert.equal(result.model,'vendor/custom-model:fast');
 await assert.rejects(saveModelConnection({provider:'micu',baseURL:CHAT_PROFILES[1].base_url,model:'   ',key:''},
 {loadSession:async()=>status,fetchImpl:async()=>calls++}),/请输入模型名/);
 assert.equal(calls,1);
});

test('provider model drafts stay separate and fields are editable without exposing secrets',async()=>{
 const {renderChatSettings,rememberModelName}=await import('../web/chat-settings.mjs');
 const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 rememberModelName('micu','vendor/model-b');rememberModelName('minimax-official','MiniMax-M3');
 const micu=renderChatSettings({provider:'micu',model:'old',enabled:true,provider_switch:true},{esc});
 const official=renderChatSettings({provider:'minimax-official',model:'old',enabled:true},{esc});
 assert.match(micu,/id="model-name" value="vendor\/model-b"/);assert.match(official,/id="model-name" value="MiniMax-M3"/);
 assert.doesNotMatch(micu,/id="model-name"[^>]*readonly/);assert.match(micu,/id="base-url"[^>]*readonly/);
});
