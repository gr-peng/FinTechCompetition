// Public judge build: all API-shaped calls terminate here, within this tab.
// No provider keys, backend cookies, real payments, bookings, or messages.
export function createJudgeTransport(fixtures,{origin='http://judge.local',scope='judge',now=()=>Date.now()}={}){
 let portfolio=structuredClone(fixtures.positions);const events=new Map(),requests=new Map();
 const reply=(data,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
 return async function request(input,options={}){
  const url=new URL(typeof input==='string'?input:input.url,origin),method=options.method||'GET';
  if(url.origin!==origin)return reply({message:'评委版不连接外部服务。'},403);
  let data={};try{data=options.body?JSON.parse(options.body):{};}catch{return reply({message:'输入格式无效'},400);}
  if(url.pathname==='/api/session')return reply({csrf:'judge-local-inert',configured:false,enabled:false,agent_enabled:false,provider:'minimax-official',model:'preset',provider_switch:false});
  if(url.pathname==='/api/health')return reply({status:'ok',service:'finpilot-static-judge',external_api_enabled:false,agent_validation_enabled:false,budget:{}});
  if(url.pathname==='/api/agent/contract')return reply({queries:[],validation_enabled:false});
  if(url.pathname==='/api/voice/config')return reply({configured:false,enabled:false,verified:false});
  if(url.pathname==='/api/demo/events'){
   const key=method==='GET'?url.searchParams.get('scope'):data.scope;
   if(typeof key!=='string'||!(key===scope||key.startsWith(scope.slice(0,16)+'_')||/^[a-f0-9]{24}$/.test(key)))return reply({message:'该事件不属于当前会话'},403);
   const rows=events.get(key)||[];
   if(method==='GET'){const raw=url.searchParams.get('after')||'0',after=raw.includes(':')&&!raw.startsWith(key+':')?0:Number(raw.includes(':')?raw.split(':').at(-1):raw);if(!Number.isInteger(after)||after<0)return reply({message:'游标无效'},400);return reply({events:rows.slice(after),cursor:key+':'+rows.length,mode:'local_demo'});}
   const allowed=fixtures.events[data.event];if(method!=='POST'||!allowed||typeof data.request_id!=='string')return reply({message:'事件无效'},400);
   if(requests.has(data.request_id))return reply(requests.get(data.request_id));
   const event={id:key+':'+(rows.length+1),scope:key,sequence:rows.length+1,type:data.event,fixture_id:allowed[0],source:{kind:'program',mode:'local_demo'},data:structuredClone(allowed[1]),occurred_at:new Date(now()).toISOString()};rows.push(event);events.set(key,rows);const result={event,mode:'local_demo'};requests.set(data.request_id,result);return reply(result);
  }
  if(url.pathname==='/api/positions'&&method==='GET')return reply(portfolio);
  if(url.pathname==='/api/reference/watchlist'&&method==='GET')return reply(fixtures.watchlist);
  // Stock inventory editing remains local; guarded paper trades are managed by the existing engine.
  if(url.pathname.startsWith('/api/positions')&&method!=='GET')return reply({message:'评委版保留合成持仓，资金操作请使用对话内确认。'},409);
  return reply({message:'此入口不用于离线评委体验。'},404);
 };
}
