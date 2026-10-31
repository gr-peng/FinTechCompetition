import {scenarios,createTask,transition} from './engine.mjs';
import {CONTACTS,SOURCES,parameterFingerprint,validateTaskParameters} from './task-parameters.mjs';
import {questionResult,SUBSCRIPTIONS} from './agent-tools.mjs';
import {rememberDraft,showDraft,finishDraft,leaveWorkspace} from './agent-workspace.mjs';

const slotValues={payee_id:new Set(['mom','dad','unknown']),source_account:new Set(SOURCES.map(x=>x.id)),currency:new Set(['CNY']),subscription_id:new Set(SUBSCRIPTIONS.map(x=>x.id)),subscription_action:new Set(['cancel','keep','downgrade']),purpose:new Set(['family','travel','cash']),cadence:new Set(['once','monthly']),transaction_ref:new Set(['unrecognized_1299'])};
export function mergeDraft(existing,result,originTurnId){
 const fields={...(existing?.fields||{}),...Object.fromEntries(Object.entries(result.fields||{}).filter(([,value])=>value!==null))};
 let missing=[...(result.missing||[])];
 // First establish the purpose. Recipient/account questions belong to a later
 // family-transfer step, never to an unchosen travel or savings arrangement.
 if(!fields.purpose&&(result.scenario==='ambiguous'||missing.includes('purpose')))missing=['purpose',...(!fields.amount_minor?['amount_minor']:[])];
 else if(['travel','cash'].includes(fields.purpose))missing=missing.filter(k=>k!=='payee_id');
 return {id:existing?.id||crypto.randomUUID(),originTurnId,scenario:result.scenario,fields,missing,choice_order:['family','travel','cash'],status:'awaiting_details'};
}
function validateFields(fields){
 for(const [key,values] of Object.entries(slotValues))if(fields[key]!=null&&!values.has(fields[key]))throw Error('模型安排含未核实的参数，已停止创建任务');
 if(fields.amount_minor!=null&&(!Number.isSafeInteger(fields.amount_minor)||fields.amount_minor<=0||fields.amount_minor>2000000))throw Error('金额不符合本轮范围，请重新核对');
}
export function missingFields(result){
 const f=result.fields||{};
 if(result.scenario==='card_review')return f.transaction_ref?[]:['transaction_ref'];
 if(result.scenario==='subscription')return ['subscription_id','subscription_action'].filter(k=>!f[k]);
 const purpose=f.purpose;
 if(result.scenario==='transfer'||purpose==='family')return ['amount_minor','payee_id','source_account','scheduled_date',...(f.cadence==='monthly'?['occurrences']:[])].filter(k=>!f[k]);
 if(result.scenario==='budget_link'||purpose==='travel'||purpose==='cash')return ['amount_minor'].filter(k=>!f[k]);
 return ['purpose','amount_minor'].filter(k=>!f[k]);
}
export function applyAgentResult(state,result,facts,context){
 const candidate=structuredClone(state),output=applyResult(candidate,result,facts,context);
 Object.assign(state,candidate);return output;
}
function applyResult(state,result,facts,{originTurnId,userText='',agentRunId=null}){
 if(!result||!['answer','clarify','propose','blocked','decline'].includes(result.status))throw Error('模型安排格式无效');
 const fields=result.fields||{};validateFields(fields);
 const response={text:result.reply,card:null,taskId:null};
 if(result.status==='answer'){
  if(result.scenario==='question')response.card={type:'fact',data:questionResult(facts,result.query,fields)};
  return response;
 }
 if(result.status==='decline')return response;
 if(result.status==='clarify'){
  const sameRun=state.agentDraft?.agentRunId===agentRunId;
  const continuation=result.context_action==='continue'&&sameRun;
  const previous=continuation?state.agentDraft:null;
  if(!continuation)rememberDraft(state);
  showDraft(state,{...mergeDraft(previous,result,originTurnId),agentRunId});response.card={type:'clarification',draftId:state.agentDraft.id};return response;
 }
 if(/只解释|仅解释|不要操作|不要创建任务/.test(userText))return {...response,text:'这次只解释，不创建操作任务。'};
 const prior=state.tasks.find(t=>t.originTurnId===originTurnId);
 if(prior&&result.mode!=='update')return {...response,taskId:prior.id};
 const flags=[];
 if(result.scenario==='risk_transfer'||result.status==='blocked'||fields.payee_id==='unknown')flags.push('unverified_recipient');
 // Additional business denial only; this does not classify ordinary messages or
 // substitute a keyword reply for the real model's structured intent.
 if(/安全账户|解冻费|保证金解冻|绕过确认|验证码转账/.test(userText))flags.push('untrusted_account_claim');
 if(flags.length){
  const task=createTask(state,'risk_transfer',{reuse:false,originTurnId});
  task.status='blocked';task.granted=false;task.amount=(fields.amount_minor||0)/100;task.riskFlags=[...new Set(flags)];task.target='未核实的收款账户';task.riskReason=result.reply;task.agentRunId=agentRunId;
  task.logs.push({text:'本地收款人和风险规则阻断，未发起转账',at:Date.now()});response.taskId=task.id;if(result.context_action==='new')leaveWorkspace(state);else finishDraft(state);state.agentFocus=null;return response;
 }
 const missing=missingFields(result);
 if(missing.length){const previous=result.context_action==='continue'&&state.agentDraft?.agentRunId===agentRunId?state.agentDraft:null;rememberDraft(state);showDraft(state,{...mergeDraft(previous,{...result,status:'clarify',missing:missing.slice(0,3)},originTurnId),agentRunId});return {...response,text:'还需要补齐这些信息，才能整理可核对的方案。',card:{type:'clarification',draftId:state.agentDraft.id}};}
 const purpose=fields.purpose||(result.scenario==='transfer'?'family':result.scenario==='budget_link'?'travel':null);
 const key=result.scenario==='card_review'?'safety':result.scenario==='subscription'?'subscription':purpose==='family'?'transfer':purpose==='cash'?'investment':'travel';
 let task;
 if(result.mode==='update'){
  task=state.tasks.find(t=>t.id===result.task_id);
  if(!task||task.agentRunId!==agentRunId||!['permission','review','verify'].includes(task.status))throw Error('原方案不再可修改，请重新整理');
  if(task.kind!==scenarios[key].kind)throw Error('任务类型已变化，需要独立申请权限');
 }else task=createTask(state,key,{reuse:false,originTurnId});
 const patch={};
 if(fields.amount_minor!=null)patch.amount=fields.amount_minor/100;
 for(const [field,key] of Object.entries({payee_id:'payeeId',source_account:'sourceAccount',currency:'currency',scheduled_date:'scheduledDate',subscription_id:'subscriptionId',subscription_action:'subscriptionAction',purpose:'purpose',cadence:'cadence',occurrences:'occurrences',transaction_ref:'transactionRef'}))if(fields[field]!=null)patch[key]=fields[field];
 if(key==='safety'){patch.amount=0;patch.sourceAccount='living_1608';patch.transactionRef=fields.transaction_ref;}
 if(key==='transfer'){
  const payee=CONTACTS.find(c=>c.id===fields.payee_id);if(!payee)throw Error('收款人尚未核实');
  patch.payeeId=payee.id;patch.sourceAccount=fields.source_account;patch.scheduledDate=fields.scheduled_date;
 }
 // Edits always invalidate confirmation. A new agent task never inherits grants.
 if(task.status==='permission'&&task.agentOrigin&&!task.originParameters)Object.assign(task,patch);
 else if(Object.keys(patch).length)transition(state,task.id,'edit',patch);
 if(task.kind==='transfer'){const payee=CONTACTS.find(c=>c.id===task.payeeId);task.payeeName=payee.name;task.target=payee.name+' 尾号 '+payee.suffix;task.title='给'+payee.name+'转账';}
 if(task.kind==='subscription'){
  const sub=SUBSCRIPTIONS.find(s=>s.id===task.subscriptionId);task.nextRenewalDate=sub.nextDate;task.rightsUntil=sub.rightsUntil;task.scope='next_renewal';task.target=sub.name+' 下次续费';task.title={cancel:'取消下次续费',keep:'保留当前订阅',downgrade:'调整下次套餐'}[task.subscriptionAction];
 }
 if(task.kind==='planning'){task.title='调整旅行预算';task.linkedTasks=state.tasks.filter(t=>t.kind==='subscription'&&t.status==='done').map(t=>t.id);}
 validateTaskParameters(task);
 task.agentOrigin=true;task.agentRunId=agentRunId;task.originParameters=parameterFingerprint(task);task.sourceSnapshot=facts.snapshot_id;
 if(result.context_action==='new')leaveWorkspace(state);else finishDraft(state);
 state.agentFocus=task.id;state.agentWorkspaceVisible=true;response.taskId=task.id;return response;
}
