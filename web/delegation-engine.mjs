// Local plan orchestration only. The host owns safety decisions and ledger commits.
import {validateSubscriptionReceipt} from './proactive-demo.mjs';
export const DEFAULT_DEMO_CLOCK='2026-11-02T09:00:00+08:00';
export const LOCAL_ADAPTER='finpilot-local-demo';
const kinds={read:'local.read',reminder:'local.reminder',book_restaurant:'local.booking.restaurant',book_cake:'local.booking.cake',message:'local.message',deposit:'local.deposit',payment:'local.payment',transfer:'local.transfer',cancel_subscription:'local.subscription.cancel',cancel_booking:'local.booking.cancel'};
const aliases={restaurant_booking:'book_restaurant',cake_booking:'book_cake',send_message:'message',pay_deposit:'deposit',subscription_cancel:'cancel_subscription',compensate_booking:'cancel_booking'};
const reads=new Set(['read','reminder']),money=new Set(['deposit','payment','transfer']),bookings=new Set(['book_restaurant','book_cake']);
const terminal=new Set(['completed','cancelled']);
const sourceKinds=new Set(['user','preset','external','llm','program']);
const copy=x=>structuredClone(x),uid=prefix=>prefix+'-'+crypto.randomUUID();

export class DelegationError extends Error{
 constructor(code,message){super(message);this.name='DelegationError';this.code=code;}
}
const fail=(code,message)=>{throw new DelegationError(code,message);};
const bounded=(value,label,max=160)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('invalid_spec',label+'无效');return value.trim();};
const identifier=(value,label)=>{const id=bounded(value,label,140);if(!/^[A-Za-z0-9_:@.-]+$/.test(id))fail('invalid_spec',label+'无效');return id;};
const safeData=(value,depth=0)=>{
 if(depth>6)fail('invalid_spec','参数层级过深');
 if(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=2000)return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value)&&value.length<=40)return value.map(v=>safeData(v,depth+1));
 if(value&&Object.getPrototypeOf(value)===Object.prototype){
  const out={};if(Object.keys(value).length>40)fail('invalid_spec','参数过多');
  for(const key of Object.keys(value).sort()){
   if(/^(?:__proto__|constructor|prototype|api[_-]?key|password|secret|token|credential|authorization|verified|grant)$/i.test(key))fail('invalid_spec','参数不得携带凭据或授权');
   out[bounded(key,'参数名',80)]=safeData(value[key],depth+1);
  }
  return out;
 }
 fail('invalid_spec','参数必须是普通数据');
};
const canonical=value=>JSON.stringify(safeData(value));
function parseClock(value){
 if(typeof value!=='string')fail('invalid_clock','演示时间需要明确时区');
 const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/);
 if(!match)fail('invalid_clock','演示时间需要日期、时间和时区');
 const [year,month,day,hour,minute,second]=match.slice(1,7).map(x=>Number(x||0));
 const local=new Date(Date.UTC(year,month-1,day,hour,minute,second));
 if(local.getUTCFullYear()!==year||local.getUTCMonth()!==month-1||local.getUTCDate()!==day||hour>23||minute>59||second>59)fail('invalid_clock','演示时间无效');
 const zone=match[7],offset=zone==='Z'?0:(Number(zone.slice(1,3))*60+Number(zone.slice(4)))*(zone[0]==='-'?-1:1);
 if(Math.abs(offset)>840||zone!=='Z'&&Number(zone.slice(4))>59)fail('invalid_clock','演示时区无效');
 return {iso:`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${String(second).padStart(2,'0')}${zone}`,ms:local.getTime()-offset*60000,year,month,day,hour,minute,second,zone};
}
const timeValue=(state,value)=>value===undefined?parseClock(ensureDelegations(state).clockISO).ms:typeof value==='number'&&Number.isFinite(value)?value:parseClock(value).ms;
const atISO=(state,value)=>typeof value==='string'?parseClock(value).iso:new Date(timeValue(state,value)).toISOString().replace('.000Z','Z');
function sourceOf(source){
 if(!source||!sourceKinds.has(source.kind))fail('invalid_source','任务需要明确来源');
 return {kind:source.kind,...(source.id?{id:bounded(source.id,'来源标识',140)}:{}),...(source.channel?{channel:bounded(source.channel,'来源渠道',60)}:{})};
}
function userSource(source){const actual=sourceOf(source);if(actual.kind!=='user')fail('user_required','需要用户明确处理，第三方内容不能授权');return actual;}
function note(state,plan,event,details={}){
 const store=ensureDelegations(state),entry={sequence:++store.sequence,event,planId:plan?.id||null,at:store.clockISO};
 for(const key of ['nodeId','revision','executionId','epoch','reason','decision','receipt','from','to'])if(details[key]!==undefined)entry[key]=details[key];
 store.audit.push(entry);if(plan)plan.audit.push(entry.sequence);return copy(entry);
}

export function ensureDelegations(state,{clockISO=DEFAULT_DEMO_CLOCK}={}){
 if(!state.delegations)state.delegations={version:1,clockISO:parseClock(clockISO).iso,plans:[],audit:[],sequence:0};
 const store=state.delegations;
 if(store.version!==1||!Array.isArray(store.plans)||!Array.isArray(store.audit))fail('invalid_state','计划状态不兼容');
 parseClock(store.clockISO);return store;
}
function getPlan(state,id){const plan=ensureDelegations(state).plans.find(p=>p.id===id);if(!plan)fail('not_found','计划不存在');return plan;}
function getNode(plan,id){const node=plan.nodes.find(n=>n.id===id);if(!node)fail('not_found','计划步骤不存在');return node;}
export const listDelegations=state=>copy(ensureDelegations(state).plans);
export const getDelegation=(state,id)=>copy(getPlan(state,id));
export const queryDelegationNode=(state,planId,nodeId)=>copy(getNode(getPlan(state,planId),nodeId));

function normalizeNode(raw,source,index){
 if(!raw||Object.getPrototypeOf(raw)!==Object.prototype)fail('invalid_spec','步骤无效');
 if(['authorized','grant','verified','permit','result','receipt','status'].some(k=>k in raw))fail('invalid_spec','步骤不能自带授权或执行结果');
 const kind=aliases[raw.kind]||raw.kind;if(!Object.hasOwn(kinds,kind))fail('invalid_spec','不支持的计划步骤');
 const id=identifier(raw.id||'step-'+(index+1),'步骤标识'),amountMinor=raw.amountMinor??0;
 if(!Number.isSafeInteger(amountMinor)||amountMinor<0||amountMinor>2000000||money.has(kind)&&amountMinor<=0)fail('invalid_spec','金额范围无效');
 if(raw.currency!==undefined&&raw.currency!=='CNY')fail('invalid_spec','仅支持人民币本地演示');
 const parameters=safeData(raw.parameters||{});if(canonical(parameters).length>6000)fail('invalid_spec','步骤参数过长');
 if(raw.riskFlags!==undefined&&!Array.isArray(raw.riskFlags))fail('invalid_spec','风险标记无效');
 const dependsOn=raw.dependsOn??[];if(!Array.isArray(dependsOn)||dependsOn.length>20||new Set(dependsOn).size!==dependsOn.length)fail('invalid_spec','步骤依赖无效');
 const scheduledAt=raw.scheduledAt?parseClock(raw.scheduledAt).iso:null;
 let repeat=null;
 if(raw.repeat){
  if(!reads.has(kind)||dependsOn.length||!scheduledAt||raw.repeat.frequency!=='monthly')fail('invalid_spec','仅独立只读提醒支持每月重复');
  const clock=parseClock(scheduledAt),day=raw.repeat.day??clock.day;
  if(!Number.isInteger(day)||day<1||day>28||clock.day!==day)fail('invalid_spec','每月提醒需明确 1 至 28 日');
  repeat={frequency:'monthly',day,...(raw.repeat.until?{until:parseClock(raw.repeat.until).iso}:{})};
  if(repeat.until&&parseClock(repeat.until).ms<clock.ms)fail('invalid_spec','重复结束时间早于首次提醒');
 }
 return {id,baseId:id,label:bounded(raw.label||raw.title||id,'步骤名称',120),kind,target:bounded(raw.target||raw.label||raw.title||id,'步骤对象',180),amountMinor,currency:'CNY',parameters,dependsOn:dependsOn.map(x=>identifier(x,'依赖标识')),scheduledAt,repeat,scope:kinds[kind],source:sourceOf(raw.source||source),riskFlags:Array.isArray(raw.riskFlags)?raw.riskFlags.map(x=>bounded(x,'风险标记',80)).slice(0,12):[],revision:1,status:'queued',executionId:uid('local-step'),ticket:null,result:null,history:[],needsFreshPermit:!reads.has(kind)};
}
function validateDAG(nodes){
 const byId=new Map(nodes.map(n=>[n.id,n]));if(byId.size!==nodes.length)fail('invalid_spec','步骤标识重复');
 const visiting=new Set(),done=new Set();
 const visit=id=>{if(visiting.has(id))fail('invalid_spec','步骤依赖不能成环');if(done.has(id))return;visiting.add(id);for(const dependency of byId.get(id).dependsOn){if(!byId.has(dependency))fail('invalid_spec','依赖步骤不存在');visit(dependency);}visiting.delete(id);done.add(id);};
 nodes.forEach(n=>visit(n.id));
}
export function createDelegation(state,spec,{now}={}){
 const store=ensureDelegations(state);
 if(!spec||!Array.isArray(spec.nodes)||!spec.nodes.length||spec.nodes.length>40)fail('invalid_spec','计划需要 1 至 40 个步骤');
 if(['authorized','grant','verified','permit','status'].some(k=>k in spec))fail('invalid_spec','计划不能自带授权');
 const source=sourceOf(spec.source),nodes=spec.nodes.map((n,i)=>normalizeNode(n,source,i));validateDAG(nodes);
 const id=identifier(spec.id||uid('plan'),'计划标识');
 const prior=store.plans.find(p=>p.id===id);
 const signature=canonical({title:spec.title,nodes:nodes.map(({executionId,ticket,result,history,status,needsFreshPermit,...n})=>n),source});
 if(prior){if(prior.specKey!==signature)fail('duplicate_plan','同一计划标识不能替换参数');return copy(prior);}
 const plan={id,title:bounded(spec.title,'计划名称',140),source,status:'active',revision:1,createdAt:atISO(state,now),nodes,audit:[],specKey:signature};
 store.plans.push(plan);note(state,plan,'plan_created');return copy(plan);
}
export function planOperation(state,planId,nodeId){
 const plan=getPlan(state,planId),node=getNode(plan,nodeId);
 const parameters=canonical({planId:plan.id,nodeId:node.id,revision:node.revision,kind:node.kind,target:node.target,amountMinor:node.amountMinor,currency:node.currency,scope:node.scope,scheduledAt:node.scheduledAt,parameters:node.parameters,riskFlags:[...node.riskFlags].sort(),source:node.source});
 return {id:'plan:'+plan.id+':'+node.id,taskId:'plan:'+plan.id+':'+node.id,planId:plan.id,nodeId:node.id,revision:node.revision,kind:node.kind,target:node.target,amountMinor:node.amountMinor,currency:node.currency,parameters,parameterKey:parameters,scope:node.scope,scheduledAt:node.scheduledAt,source:copy(node.source),riskFlags:copy(node.riskFlags),writes:!reads.has(node.kind),executionId:node.executionId};
}
export function readyNodes(state,planId,{now}={}){
 const plan=getPlan(state,planId),time=timeValue(state,now);if(plan.status!=='active')return [];
 const ready=[];
 for(const node of plan.nodes){
  if(!['queued','scheduled','waiting_dependency','ready','awaiting_consent'].includes(node.status))continue;
  if(node.dependsOn.some(id=>getNode(plan,id).status!=='completed')){node.status='waiting_dependency';continue;}
  if(node.scheduledAt&&parseClock(node.scheduledAt).ms>time){node.status='scheduled';continue;}
  node.status=reads.has(node.kind)?'ready':'awaiting_consent';
  ready.push({...copy(node),operation:planOperation(state,plan.id,node.id)});
 }
 return ready;
}
function securityContext(options){
 if(!Number.isSafeInteger(options.epoch)||options.epoch<0||typeof options.locked!=='boolean')fail('missing_safety_context','需要当前安全状态和代次');
 if(options.locked)fail('safety_locked','安全锁定期间不能推进计划');
 return options.epoch;
}
function validatePermit(operation,permit,validator){
 if(!operation.writes)return;
 if(!permit||typeof permit!=='object'||typeof validator!=='function')fail('permit_required','请先确认当前步骤并完成所需验证');
 if(validator(copy(operation),permit)===false)fail('permit_rejected','当前授权无效');
}
export function startNode(state,planId,nodeId,options={}){
 const epoch=securityContext(options),plan=getPlan(state,planId),node=getNode(plan,nodeId);
 if(node.status==='completed')return {replay:true,result:copy(node.result),ticket:null};
 if(['running','pending'].includes(node.status))return {replay:true,pending:true,ticket:copy(node.ticket)};
 if(plan.status!=='active'||!readyNodes(state,planId,{now:options.now}).some(n=>n.id===nodeId))fail('not_ready','步骤尚未到期、依赖未完成或需要人工处理');
 const operation=planOperation(state,planId,nodeId);validatePermit(operation,options.permit,options.validatePermit);
 const ticket={id:uid('ticket'),planId,nodeId,revision:node.revision,executionId:node.executionId,parameterKey:operation.parameterKey,epoch,operation,startedAt:atISO(state,options.now)};
 node.status='running';node.ticket=copy(ticket);node.needsFreshPermit=false;
 note(state,plan,'node_started',{nodeId,revision:node.revision,executionId:node.executionId,epoch});return {replay:false,ticket:copy(ticket)};
}
function nextMonthly(node){
 if(!node.repeat)return null;
 const clock=parseClock(node.scheduledAt),next=new Date(Date.UTC(clock.year,clock.month,clock.day,clock.hour,clock.minute,clock.second));
 const iso=next.toISOString().slice(0,19)+clock.zone;
 if(node.repeat.until&&parseClock(iso).ms>parseClock(node.repeat.until).ms)return null;
 return iso;
}
function scheduleRepeat(plan,node){
 const next=nextMonthly(node);if(!next||node.nextOccurrenceId)return;
 const id=node.baseId+'@'+next.slice(0,10);node.nextOccurrenceId=id;
 if(plan.nodes.some(n=>n.id===id))return;
 plan.nodes.push({...copy(node),id,scheduledAt:next,status:'queued',revision:1,executionId:uid('local-step'),ticket:null,result:null,history:[],nextOccurrenceId:null,needsFreshPermit:false});
}
export function finishNode(state,ticket,result,options={}){
 const epoch=securityContext(options);
 if(!ticket||typeof ticket!=='object')fail('invalid_ticket','步骤回调标识无效');
 const plan=getPlan(state,ticket.planId),node=getNode(plan,ticket.nodeId),operation=planOperation(state,plan.id,node.id);
 if(node.status==='completed'){
  if(node.result?.executionId===ticket.executionId&&node.result?.parameterKey===ticket.parameterKey)return {accepted:true,replay:true,result:copy(node.result)};
  fail('stale_callback','旧回调不能覆盖完成记录');
 }
 if(plan.status!=='active'||!['running','pending'].includes(node.status)||node.ticket?.id!==ticket.id||node.ticket?.epoch!==ticket.epoch||node.ticket?.revision!==ticket.revision||node.ticket?.executionId!==ticket.executionId||node.ticket?.parameterKey!==ticket.parameterKey||node.revision!==ticket.revision||node.executionId!==ticket.executionId||operation.parameterKey!==ticket.parameterKey||epoch!==ticket.epoch)fail('stale_callback','计划或安全状态已变化，迟到结果不能提交');
 validatePermit(operation,options.permit,options.validatePermit);
 if(!result||result.source!=='local_adapter'||result.adapter!==LOCAL_ADAPTER||result.external!==false||result.operationId!==operation.id||result.executionId!==ticket.executionId||result.parameterKey!==ticket.parameterKey||!['completed','failed','pending'].includes(result.status))fail('invalid_result','只有绑定当前步骤的本地适配器结果可提交');
 const safeResult={status:result.status,source:'local_adapter',adapter:LOCAL_ADAPTER,external:false,operationId:operation.id,executionId:ticket.executionId,parameterKey:ticket.parameterKey,at:atISO(state,options.now)};
 if(result.status==='completed'){
  if(result.receipt!==receiptFor(operation.id+'|'+operation.executionId+'|'+operation.parameterKey)||canonical(result.effect||{})!==canonical(effectFor(operation)))fail('invalid_result','回执或执行效果与当前参数不一致');
  safeResult.receipt=bounded(result.receipt,'本地回执',140);safeResult.effect=safeData(result.effect||{});
  // The effect is returned for the host's atomic local-state commit, never applied here.
  node.status='completed';node.result=safeResult;node.ticket=null;node.history.push({status:'completed',revision:node.revision,executionId:node.executionId,receipt:safeResult.receipt});
  note(state,plan,'node_completed',{nodeId:node.id,revision:node.revision,executionId:node.executionId,epoch,receipt:safeResult.receipt});scheduleRepeat(plan,node);
  if(plan.nodes.every(n=>n.status==='completed'))plan.status='completed';
 }else if(result.status==='failed'){
  safeResult.reason='本地适配器未完成，等待人工处理';node.status='failed';node.result=safeResult;node.history.push({status:'failed',revision:node.revision,executionId:node.executionId});node.ticket=null;plan.status='human_review';
  note(state,plan,'node_failed',{nodeId:node.id,revision:node.revision,executionId:node.executionId,epoch,reason:safeResult.reason});
 }else{node.status='pending';node.result=safeResult;note(state,plan,'node_pending',{nodeId:node.id,executionId:node.executionId,epoch});}
 return {accepted:true,replay:false,result:copy(safeResult)};
}
function invalidateNode(node,status){
 if(terminal.has(node.status))return;
 node.history.push({status:node.status,revision:node.revision,executionId:node.executionId,interrupted:true});
 node.previousStatus=node.status;node.status=status;node.ticket=null;node.revision++;node.executionId=uid('local-step');node.needsFreshPermit=!reads.has(node.kind);
}
export function pauseDelegation(state,planId,{reason='用户暂停',epoch}={}){
 const plan=getPlan(state,planId);if(terminal.has(plan.status)||plan.status==='paused')return copy(plan);
 plan.status='paused';for(const node of plan.nodes)invalidateNode(node,'paused');
 note(state,plan,'plan_paused',{reason:bounded(reason,'暂停原因',180),...(Number.isSafeInteger(epoch)?{epoch}:{})});return copy(plan);
}
export function pauseAllDelegations(state,options={}){return ensureDelegations(state).plans.filter(p=>!terminal.has(p.status)).map(p=>pauseDelegation(state,p.id,options));}
export function resumeDelegation(state,planId,{source,epoch,locked,now}={}){
 userSource(source);securityContext({epoch,locked});const plan=getPlan(state,planId);
 if(plan.status!=='paused')fail('invalid_transition','计划当前未暂停');
 for(const node of plan.nodes)if(node.status==='paused'){node.status=['failed','pending','running'].includes(node.previousStatus)?'needs_review':'queued';node.previousStatus=null;node.needsFreshPermit=!reads.has(node.kind);}
 plan.status=plan.nodes.some(n=>n.status==='needs_review')?'human_review':'active';
 note(state,plan,'plan_resumed',{epoch,reason:'恢复后待办步骤需重新确认，不重放完成记录'});return copy(plan);
}
export function cancelDelegation(state,planId,{source,reason='用户取消后续步骤'}={}){
 userSource(source);const plan=getPlan(state,planId);if(plan.status==='cancelled')return copy(plan);
 plan.status='cancelled';for(const node of plan.nodes)invalidateNode(node,'cancelled');
 note(state,plan,'plan_cancelled',{reason:bounded(reason,'取消原因',180)});return copy(plan);
}
export function handoffDelegation(state,planId,{reason='需要人工处理',source={kind:'program'}}={}){
 sourceOf(source);const plan=getPlan(state,planId);if(terminal.has(plan.status))fail('invalid_transition','结束的计划不能接管');
 for(const node of plan.nodes)if(['running','pending'].includes(node.status))invalidateNode(node,'needs_review');
 plan.status='human_review';note(state,plan,'human_handoff',{reason:bounded(reason,'接管原因',180)});return copy(plan);
}
export function resolveHandoff(state,planId,{decision,nodeId,source,epoch,locked}={}){
 userSource(source);securityContext({epoch,locked});const plan=getPlan(state,planId);
 if(plan.status!=='human_review')fail('invalid_transition','计划当前不在人工处理状态');
 if(decision==='cancel')return cancelDelegation(state,planId,{source,reason:'人工处理后取消后续步骤'});
 if(decision==='retry'){
  const node=getNode(plan,nodeId);if(!['failed','needs_review'].includes(node.status))fail('invalid_transition','只能明确重试失败或待核实的本地步骤');
  invalidateNode(node,'queued');node.result=null;
 }else if(decision!=='resume')fail('invalid_transition','人工处理决定无效');
 plan.status=plan.nodes.some(n=>['failed','needs_review'].includes(n.status))?'human_review':'active';
 note(state,plan,'human_resolved',{decision,...(nodeId?{nodeId}:{}),epoch,reason:'重新执行仍需新的安全许可'});return copy(plan);
}
export function editDelegationNode(state,planId,nodeId,patch,{source}={}){
 userSource(source);const plan=getPlan(state,planId),node=getNode(plan,nodeId);
 if(terminal.has(plan.status)||['running','pending','completed','cancelled'].includes(node.status))fail('invalid_transition','该步骤当前不能修改');
 if(!patch||Object.keys(patch).some(k=>!['label','target','amountMinor','parameters','scheduledAt','riskFlags'].includes(k)))fail('invalid_spec','修改字段无效');
 const declaration={id:node.id,label:node.label,kind:node.kind,target:node.target,amountMinor:node.amountMinor,currency:node.currency,parameters:node.parameters,dependsOn:node.dependsOn,scheduledAt:node.scheduledAt,repeat:node.repeat,riskFlags:node.riskFlags,source:node.source,...patch};
 const candidate=normalizeNode(declaration,node.source,0);
 Object.assign(node,{label:candidate.label,target:candidate.target,amountMinor:candidate.amountMinor,parameters:candidate.parameters,scheduledAt:candidate.scheduledAt,riskFlags:candidate.riskFlags});
 invalidateNode(node,'queued');node.result=null;plan.revision++;note(state,plan,'node_edited',{nodeId,revision:node.revision,reason:'参数变更，旧许可失效'});return copy(node);
}
export function advanceDemoClock(state,to,{reset=false,source={kind:'user'}}={}){
 userSource(source);const store=ensureDelegations(state),next=parseClock(to),before=parseClock(store.clockISO);
 if(next.ms<before.ms&&!reset)fail('clock_backwards','演示时钟不能倒退，请显式复位');
 store.clockISO=next.iso;note(state,null,reset?'clock_reset':'clock_advanced',{from:before.iso,to:next.iso});return store.clockISO;
}
export function requestCompensation(state,planId,nodeId,{source,now}={}){
 const actualSource=userSource(source),plan=getPlan(state,planId),original=getNode(plan,nodeId);
 if(original.status!=='completed'||!bookings.has(original.kind))fail('not_compensatable','仅已完成的本地预订可另行申请取消，消息和转账不能直接撤回');
 if(original.compensationNodeId)return copy(getNode(plan,original.compensationNodeId));
 const id=identifier(original.id+':cancel','补偿步骤标识');
 const node=normalizeNode({id,label:'取消'+original.label,kind:'cancel_booking',target:original.target,amountMinor:0,parameters:{bookingNodeId:original.id,bookingReceipt:original.result.receipt,originalKind:original.kind},dependsOn:[original.id],scheduledAt:atISO(state,now),source:actualSource},actualSource,plan.nodes.length);
 plan.nodes.push(node);original.compensationNodeId=id;plan.status='active';plan.revision++;
 note(state,plan,'compensation_requested',{nodeId:id,revision:node.revision,reason:'独立取消预订步骤，等待新的确认'});return copy(node);
}
const receiptFor=id=>{let hash=2166136261;for(const c of id){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}return 'LOCAL-'+(hash>>>0).toString(16).toUpperCase().padStart(8,'0');};
const effectFor=operation=>({kind:operation.kind,target:operation.target,amountMinor:operation.amountMinor,currency:operation.currency,parameters:JSON.parse(operation.parameterKey).parameters});
export function runLocalDemoAdapter(operation,{outcome='completed',now=DEFAULT_DEMO_CLOCK}={}){
 if(!operation||!Object.hasOwn(kinds,operation.kind)||typeof operation.executionId!=='string'||typeof operation.parameterKey!=='string')fail('invalid_operation','本地适配器操作无效');
 if(!['completed','pending','failed'].includes(outcome))fail('invalid_result','预置适配器结果无效');
 const result={status:outcome,source:'local_adapter',adapter:LOCAL_ADAPTER,external:false,operationId:operation.id,executionId:operation.executionId,parameterKey:operation.parameterKey,at:typeof now==='number'?new Date(now).toISOString():parseClock(now).iso};
 if(outcome==='completed'){
  result.receipt=receiptFor(operation.id+'|'+operation.executionId+'|'+operation.parameterKey);
  result.effect=effectFor(operation);
 }
 return result;
}

// Bridge for the delivered proactive-demo module. This is the integration entry;
// the generic DAG exports above need not be instantiated by the main UI.
const proactiveKinds={search_restaurant:'read',resolve_contact:'read',reserve_restaurant:'booking',reserve_ride:'booking',message_contact:'message',send_sms:'message',pay_deposit:'deposit',schedule_local_task:'schedule',transfer:'transfer',renew_subscription:'subscription',cancel_subscription:'subscription',cancel_booking:'booking_cancel'};
export function proactiveSafetyOperation(context){
 if(context?.mode!=='local_demo'||!context.step||!Object.hasOwn(proactiveKinds,context.step.operation))fail('invalid_operation','未核实的主动计划操作');
 const node=context.step,payload=safeData(node.payload||{}),kind=proactiveKinds[node.operation];
 const planId=identifier(context.plan_id,'主动计划标识'),stepId=identifier(node.id,'主动步骤标识');
 if(!Number.isSafeInteger(context.revision)||context.revision<1)fail('invalid_operation','主动计划版本无效');
 const amountMinor=payload.amount_minor??0;
 if(!Number.isSafeInteger(amountMinor)||amountMinor<0||amountMinor>2000000)fail('invalid_operation','主动计划金额无效');
 const target=String(payload.restaurant_name||payload.recipient_name||payload.recipient_id||payload.contact_id||payload.subscription_id||payload.city||node.title||stepId);
 const parameters=canonical({plan_id:planId,revision:context.revision,step_id:stepId,app:node.app,operation:node.operation,payload,dependencies:node.dependencies||[],scheduled_for:node.scheduled_for||null});
 const riskFlags=[...(Array.isArray(node.riskFlags)?node.riskFlags:[])];
 if(payload.source_mismatch)riskFlags.push('unverified_recipient');
 const origin=context.source?.trust==='external_content'?'external':context.source?.type==='user_request'?'user':'preset';
 return {id:'proactive:'+planId+':'+stepId,taskId:'proactive:'+planId+':'+stepId,revision:context.revision,kind,target,amountMinor,currency:payload.currency||'CNY',parameters,parameterKey:parameters,scope:{app:node.app,action:node.operation,target},scheduledAt:node.scheduled_for||null,riskFlags:[...new Set(riskFlags)],source:{kind:origin},writes:!reads.has(kind)};
}
const bridgeReason={authorization_required:'请先确认这一步的对象、金额和范围。',verification_required:'这一步需要独立的本人验证。',expired_grant:'授权已过期，请重新确认。',stale_binding:'安排已变化，请核对新参数。',locked:'安全锁定中，请先完成恢复验证。',paused:'计划已暂停。',epoch_changed:'安全状态已变化，旧结果未提交。',execution_in_progress:'这一步已有在途请求，请先核实。',execution_consumed:'这次执行标识已使用，请先核实记录。',already_completed:'这一步已有完成记录，请先核实回执。'};
const confirmationErrors=new Set(['authorization_required','verification_required','expired_grant','stale_binding']);
function synchronous(value){if(value&&typeof value.then==='function')fail('async_commit','本地提交回调必须同步完成');return value;}
function assertProactiveResult(context,result){
 const expectedKey=context.plan_id+':'+context.step.id+':v'+context.revision;
 if(result?.status!=='succeeded'||result.receipt_id!=='DEMO:'+expectedKey||result.evidence?.mode!=='local_demo'||result.evidence.actual_external_effect!==false||result.evidence.mcp_connected!==false||result.evidence.plan_id!==context.plan_id||result.evidence.app!==context.step.app||result.evidence.operation!==context.step.operation)fail('invalid_result','本地计划回执不匹配');
 if(context.idempotency_key!==undefined&&context.idempotency_key!==expectedKey)fail('invalid_result','本地计划执行标识不匹配');
 if(context.step.operation==='schedule_local_task'){
  if(result.evidence.queue_entry?.scheduled_for!==context.step.payload.scheduled_for||result.evidence.queue_entry?.clock_mode!=='explicit_virtual_demo')fail('invalid_result','本地排程结果不匹配');
 }else if(context.step.confirmation_required&&canonical(result.evidence.parameters||{})!==canonical(context.step.payload||{}))fail('invalid_result','本地计划参数与回执不一致');
 try{validateSubscriptionReceipt(context.step,result);}catch{fail('invalid_result','订阅回执范围与效果不一致');}
 return copy(result);
}
// Call before constructing createProactiveDemo({snapshot}). A page may close
// after the atomic core safety+effect commit but before the plan journal save.
// This copies only an exact completed proof into the plan's historical journal;
// it never creates a grant, invokes an adapter, or reapplies a financial effect.
export function reconcileProactiveSnapshot(snapshot,coreState,{policy,toOperation=proactiveSafetyOperation,now}={}){
 if(!snapshot||snapshot.version!==1||snapshot.mode!=='local_demo'||!Array.isArray(snapshot.plans)||!Array.isArray(snapshot.events)||!Array.isArray(snapshot.receipts)||!snapshot.journal||typeof snapshot.journal!=='object')fail('invalid_state','主动计划快照无法核对');
 if(!policy||typeof policy.acquireExecution!=='function')fail('invalid_bridge','恢复核实需要宿主安全记录');
 const repaired=copy(snapshot),reconciled=[],skipped=[];
 const completed=Object.values(coreState?.safety?.executions||{}).filter(entry=>entry.status==='completed'&&entry.result?.adapter_result);
 for(const plan of repaired.plans){
  if(!Array.isArray(plan.steps))fail('invalid_state','主动步骤快照无法核对');
  for(const node of plan.steps){
   const context={mode:'local_demo',plan_id:plan.id,revision:plan.revision,step:copy(node),source:copy(plan.source),now:typeof now==='string'?now:new Date(now??Date.now()).toISOString()};
   let operation;try{operation=toOperation(context);}catch{continue;}
   const candidates=completed.filter(entry=>entry.operationId===operation.id&&entry.snapshot?.revision===operation.revision);
   for(const entry of candidates){
    let proof,result;
    try{
     // Existing completed IDs are queried on a disposable clone: no new entry
     // can be created, and a changed operation binding is rejected by policy.
     proof=policy.acquireExecution(copy(coreState),operation,{executionId:entry.id,now:entry.completedAt});
     if(!proof.replay||proof.status!=='completed'||proof.result?.receipt!==entry.result.adapter_result.receipt_id)continue;
     result=assertProactiveResult(context,proof.result.adapter_result);
    }catch{skipped.push({planId:plan.id,stepId:node.id,executionId:entry.id,reason:'binding_or_evidence_mismatch'});continue;}
    const key=plan.id+':'+node.id+':v'+plan.revision,prior=repaired.journal[key];
    if(prior&&(prior.binding!==operation.parameters||prior.status==='succeeded'&&canonical(prior.result)!==canonical(result)))fail('invalid_result','历史计划回执与安全记录不一致');
    const priorReceipt=repaired.receipts.find(item=>item.idempotency_key===key);
    if(priorReceipt&&(priorReceipt.receipt_id!==result.receipt_id||canonical(priorReceipt.evidence)!==canonical(result.evidence)))fail('invalid_result','历史计划回执存在冲突');
    const already=node.status==='succeeded'&&node.receipt_id===result.receipt_id&&prior?.status==='succeeded'&&!!priorReceipt;
    node.status='succeeded';node.receipt_id=result.receipt_id;node.last_error=null;node.idempotency_key=key;
    repaired.journal[key]={status:'succeeded',binding:operation.parameters,result:copy(result),at:new Date(entry.completedAt).toISOString()};
    if(!priorReceipt)repaired.receipts.push({...copy(result),plan_id:plan.id,step_id:node.id,idempotency_key:key});
    if(!already){
     repaired.sequence=(Number.isSafeInteger(repaired.sequence)?repaired.sequence:0)+1;
     repaired.events.push({id:'event-'+repaired.sequence,type:'receipt_reconciled',at:new Date(entry.completedAt).toISOString(),plan_id:plan.id,step_id:node.id,receipt_id:result.receipt_id,safety_execution_id:entry.id,effects_applied:false,background_execution_claimed:false});
     reconciled.push({planId:plan.id,stepId:node.id,executionId:entry.id,receipt:result.receipt_id,idempotencyKey:key});
    }
    break;
   }
  }
 }
 return {snapshot:repaired,reconciled,skipped,effectsApplied:false,grantsCreated:0};
}
export function createProactiveSafetyBridge({policy,getState,persist,getGrantId=()=>undefined,toOperation=proactiveSafetyOperation,onCommitEffect=()=>{},acceptReplay=()=>false}={}){
 if(!policy||['ensureSafety','classifyOperation','acquireExecution','validatePermit','commitExecution','failExecution'].some(name=>typeof policy[name]!=='function')||typeof getState!=='function'||typeof persist!=='function')fail('invalid_bridge','主动计划需要完整的宿主安全门');
 if(persist.constructor.name==='AsyncFunction'||onCommitEffect.constructor.name==='AsyncFunction')fail('async_commit','本地提交回调必须同步完成');
 const tickets=new Map();
 const save=(draft,phase,operation)=>synchronous(persist(draft,{phase,operationId:operation.id}));
 const classify=(draft,operation,now)=>policy.classifyOperation(draft,operation,{now});
 const resultKey=(operation)=>operation.id+'|'+operation.revision+'|'+operation.parameters;
 const failure=(operation,error,level='red')=>({decision:confirmationErrors.has(error?.code)?'needs_confirmation':'pause',risk:level,evaluation_id:'policy-denied:'+operation.id,reason:bridgeReason[error?.code]||'主安全门未通过，结果未提交。'});
 const gate=context=>{
  const operation=toOperation(context),key=resultKey(operation),now=Date.parse(context.now);
  if(!Number.isFinite(now))fail('invalid_clock','主动计划时间无效');
  if(!['before_execute','after_execute'].includes(context.phase))fail('invalid_phase','主动计划安全阶段无效');
  let draft=copy(getState()),classification=classify(draft,operation,now),entry=tickets.get(key),effectStarted=false;
  try{
   if(context.phase==='before_execute'){
    const safety=policy.ensureSafety(draft);
    if(operation.writes&&(safety.locked||draft.paused))fail(safety.locked?'locked':'paused','安全状态不允许执行');
    const attempt=Number(context.step.attempts||0)+1;
    if(!Number.isSafeInteger(attempt)||attempt<1)fail('invalid_operation','主动计划次数无效');
    const grantId=getGrantId(copy(operation),copy(context),draft);
    const completed=Object.values(safety.executions).find(entry=>entry.status==='completed'&&entry.operationId===operation.id&&entry.snapshot?.revision===operation.revision&&entry.snapshot?.parameters===operation.parameters);
    const executionId=completed?.id||operation.id+':v'+context.revision+':a'+attempt+':e'+safety.epoch+':g'+String(grantId||'read').slice(-12);
    const permit=policy.acquireExecution(draft,operation,{grantId,executionId,epoch:safety.epoch,now});
    if(permit.replay){
     const replay=permit.result?.adapter_result;
     if(permit.status!=='completed')fail(permit.status==='pending'?'execution_in_progress':'execution_consumed','已有执行记录，等待明确核实');
     if(!replay||synchronous(acceptReplay({state:draft,operation:copy(operation),permit:copy(permit),context:copy(context)}))!==true)fail('already_completed','已有执行记录，等待明确核实');
     assertProactiveResult(context,replay);
     tickets.set(key,{permit:copy(permit),operation:copy(operation),parameterKey:operation.parameters,completed:true,completedEpoch:safety.epoch});
     return {decision:'allow',risk:permit.level,evaluation_id:'policy-replay:'+permit.executionId,replay:true,replay_result:copy(replay)};
    }
    entry={permit:copy(permit),operation:copy(operation),parameterKey:operation.parameters,completed:false};
    tickets.set(key,entry);save(draft,'before_execute',operation);
    return {decision:'allow',risk:classification.level,evaluation_id:'policy-start:'+permit.executionId,host_ticket_id:permit.permitId};
   }
   if(!entry||entry.parameterKey!==operation.parameters)fail('invalid_permit','缺少当前步骤的宿主许可');
   if(context.result?.status!=='succeeded'){
    policy.failExecution(draft,entry.permit,{code:'local_adapter_failed',now});save(draft,'execution_failed',operation);tickets.delete(key);
    const normalized={status:'failed',reason:'本地适配器未完成，等待明确处理。',evidence:{mode:'local_demo',actual_external_effect:false,mcp_connected:false,app:context.step.app,operation:context.step.operation,plan_id:context.plan_id,at:context.now}};
    return {decision:policy.ensureSafety(draft).locked?'pause':'allow',risk:classification.level,evaluation_id:'policy-failed:'+entry.permit.executionId,normalized_result:normalized,reason:normalized.reason};
   }
   const adapterResult=assertProactiveResult(context,context.result);
   const safeResult={status:'completed',receipt:adapterResult.receipt_id,adapter_result:adapterResult};
   if(entry.completed){
    const currentSafety=policy.ensureSafety(draft);
    if(currentSafety.locked||draft.paused||currentSafety.epoch!==entry.completedEpoch)fail('epoch_changed','恢复核实期间安全状态已变化');
    const previous=policy.acquireExecution(draft,operation,{executionId:entry.permit.executionId,now});
    if(previous.status!=='completed'||canonical(previous.result)!==canonical(safeResult))fail('invalid_result','重复回调与原回执不一致');
    return {decision:'allow',risk:entry.permit.level,evaluation_id:'policy-replay:'+entry.permit.executionId,replay:true,normalized_result:adapterResult};
   }
   policy.validatePermit(draft,operation,entry.permit,{now});
   // Commit and effect share ONE unpersisted clone. Commit first so transfer-risk
   // classification does not count this same newly appended ledger row twice.
   policy.commitExecution(draft,entry.permit,safeResult,{now});
   effectStarted=true;synchronous(onCommitEffect(draft,{operation:copy(operation),result:copy(adapterResult),context:copy(context),permit:copy(entry.permit)}));
   save(draft,'after_execute',operation);entry.completed=true;entry.completedEpoch=policy.ensureSafety(draft).epoch;
   return {decision:'allow',risk:entry.permit.level,evaluation_id:'policy-commit:'+entry.permit.executionId,normalized_result:adapterResult};
  }catch(error){
   // Never persist a clone whose financial effect or storage commit failed.
   // Start again from the latest host state and record only the failure/denial.
   const clean=copy(getState());
   try{
    if(entry?.permit&&(effectStarted||context.phase==='after_execute'&&error?.code==='invalid_result'))policy.failExecution(clean,entry.permit,{code:effectStarted?'local_commit_failed':'invalid_adapter_result',now});
    else policy.auditSafety?.(clean,{type:'proactive_denied',operationId:operation.id,revision:operation.revision,reason:typeof error?.code==='string'?error.code:'safety_gate_failed'},{now});
    save(clean,'denied',operation);
   }catch{/* A failed host storage commit cannot be represented as success. */}
   if(effectStarted||context.phase==='after_execute'&&error?.code==='invalid_result')tickets.delete(key);
   return failure(operation,error,classification.level);
  }
 };
 gate.operation=toOperation;
 gate.invalidate=()=>tickets.clear();
 gate.pending=()=>[...tickets.values()].filter(entry=>!entry.completed).map(entry=>({operationId:entry.operation.id,revision:entry.operation.revision,executionId:entry.permit.executionId,epoch:entry.permit.epoch}));
 return gate;
}
