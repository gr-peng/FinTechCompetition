import {ensureFinance,financialFacts,syncFinance,STORY_DATE} from './finance-state.mjs';
import {validatePermit,commitExecution,auditSafety,revokeOperation} from './safety-policy.mjs';

// Local proposals and bounded savings schedules. Model output is never authority.
const DAY=86400000,MONTH=STORY_DATE.slice(0,7),USER_SOURCES=new Set(['click','typed','voice']);
const FIELDS=['daily_minor','source_account','start_date','target_minor'];
export function listSavingsJars(state){return Object.values({...state.savingsJars,...(state.savingsJar?{[state.savingsJar.id]:state.savingsJar}:{})}).filter(j=>!state.savingsArchived?.[j.id]);}
export function savingsTotal(state){return listSavingsJars(state).reduce((sum,j)=>sum+j.saved_minor,0);}
export function archiveEmptyJar(state,jarId,{source,now}={}){
 if(source?.kind!=='user'||!USER_SOURCES.has(source.method))error('请由你确认移除');const jar=findJar(state,jarId);if(!jar)error('储蓄罐不存在');
 if(jar.saved_minor!==0||jar.status==='active')error('仅可移除未存款且已暂停或取消的储蓄罐');
 revokeOperation(state,jar.authority.operation.id,{reason:'user_archive'});state.savingsArchived??={};state.savingsArchived[jar.id]={jar:clone(jar),archived_at:nowOf(state,now)};
 delete state.savingsJars?.[jar.id];if(state.savingsJar?.id===jar.id)state.savingsJar=null;return clone(jar);
}
export function restoreArchivedJar(state,jarId,{source}={}){if(source?.kind!=='user'||!USER_SOURCES.has(source.method))error('请由你确认恢复');const record=state.savingsArchived?.[jarId];if(!record)error('没有这份移除记录');const jar=clone(record.jar);jar.status='paused_safety';jar.revision++;delete state.savingsArchived[jarId];putJar(state,jar);return clone(jar);}
function findJar(state,id){return id?listSavingsJars(state).find(j=>j.id===id):state.savingsJar;}
function putJar(state,jar,{travel=false}={}){state.savingsJars??={};state.savingsJars[jar.id]=jar;if(travel||state.savingsJar?.id===jar.id)state.savingsJar=jar;return jar;}
function previousJar(state,coach){return coach.new_jar?null:findJar(state,coach.jar_id);}
const DEFAULT_CATEGORIES=[['住房',350000],['餐饮',200000],['购物',150000],['其他',100000]];
const clone=x=>structuredClone(x),canonical=x=>JSON.stringify(x),amount=x=>'¥'+(x/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=()=> 'saving-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36));
const error=message=>{throw Error(message);};
const minor=(value,{zero=false,max=200000000}={})=>Number.isSafeInteger(value)&&value>=(zero?0:1)&&value<=max;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const nowOf=(state,now)=>{const n=now??state.demoClock?.now??STORY_DATE+'T01:00:00Z';const t=typeof n==='string'?Date.parse(n):n;if(!Number.isFinite(t))error('时间无法核对');return t;};
const chinaDate=now=>new Date(now+8*3600000).toISOString().slice(0,10);
const dateAdd=(value,days)=>new Date(Date.parse(value+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const nextStart=(at,time='09:00')=>{const today=chinaDate(at);return at<Date.parse(today+'T'+time+':00+08:00')?today:dateAdd(today,1);};
const prevMonth=value=>{const [year,m]=value.split('-').map(Number);return new Date(Date.UTC(year,m-2,1)).toISOString().slice(0,7);};
const accountLabel=source=>source==='salary_0826'?'工资账户 0826':'生活账户 1608';
function budget(state,month){
 const original=state.nativeBudget?.[month];
 const data=original?clone(original):month===MONTH?{month,status:'set',revision:0,total_minor:800000,categories:DEFAULT_CATEGORIES.map(([category,limit_minor])=>({category,limit_minor}))}:null;
 if(!data||!minor(data.total_minor)||!Array.isArray(data.categories)||data.categories.some(x=>typeof x.category!=='string'||!minor(x.limit_minor,{zero:true}))||new Set(data.categories.map(x=>x.category)).size!==data.categories.length||data.categories.reduce((n,c)=>n+c.limit_minor,0)>data.total_minor)error('请先在财务页核对本月预算');
 const travel=Math.round((state.travelBudget??3000)*100);if(!minor(travel,{zero:true}))error('旅行预算无法核对');
 return {...data,revision:data.revision||0,travel_goal_minor:travel};
}
export function previousMonthSpending(state,{month=MONTH}={}){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))error('月份无效');
 const copy=clone(state);ensureFinance(copy);const period=prevMonth(month),facts=financialFacts(copy,period);
 return {period,total_minor:facts.expenseMinor,refund_minor:facts.refundMinor,categories:facts.categories.map(([category,amount_minor])=>({category,amount_minor,ratio:facts.expenseMinor?amount_minor/facts.expenseMinor:0}))};
}
export function startSavingsCoach(state,{id:proposalId=id(),now,month=MONTH}={}){
 if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(proposalId))error('安排标识无效');
 const before=budget(state,month),shopping=before.categories.find(c=>c.category==='购物')?.limit_minor||0;
 const coach={id:proposalId,revision:1,stage:'proposal',month,created_at:nowOf(state,now),analysis:previousMonthSpending(state,{month}),before,reduction_minor:Math.min(60000,shopping),fields:{},budget_receipt:null};
 if(!shopping){const available=before.categories.find(c=>c.category==='旅行')?.limit_minor||0;if(available){coach.use_existing=true;coach.available_minor=available;coach.reduction_minor=Math.min(60000,available);}else coach.blocked_reason='购物和旅行还没有可用预算，先核对本月分配。';}
 state.savingsCoach=coach;return clone(coach);
}
function active(state,coach){const current=coach?.editor?state.savingsEditor:state.savingsCoach;if(!coach||current?.id!==coach.id||current.revision!==coach.revision)error('安排已变化，请重新核对');return current;}
export function prepareSavingsPlan(state,coach=state.savingsCoach,{now}={}){
 active(state,coach);const at=nowOf(state,now),previous=previousJar(state,coach),monthly=coach.budget_receipt?.amount_minor||(coach.use_existing?coach.reduction_minor:60000);
 const target=previous?.target_minor||1200000,atTime=coach.at_time||previous?.at_time||'09:00';
 const fields={daily_minor:Math.max(1,Math.min(200000,Math.floor(monthly/30))),source_account:previous?.source_account||'living_1608',start_date:nextStart(at,atTime),target_minor:target,...coach.fields};
 if(!date(fields.start_date)||Date.parse(fields.start_date+'T'+atTime+':00+08:00')<=at)fields.start_date=nextStart(at,atTime);
 const next=updateSavingsFields({...coach,at_time:atTime,stage:'details'},fields);next.error=null;
 if(coach.editor)state.savingsEditor=next;else state.savingsCoach=next;return clone(next);
}
export function useExistingTravelBudget(state,coach=state.savingsCoach,{now}={}){active(state,coach);if(!coach.use_existing||coach.stage!=='proposal'||canonical(budget(state,coach.month))!==canonical(coach.before))error('预算已变化，请重新核对');state.savingsCoach={...coach,stage:'details'};return prepareSavingsPlan(state,state.savingsCoach,{now});}
export function editedBudgetOperation(state,coach,patch){
 active(state,coach);if(coach.stage!=='proposal'||canonical(budget(state,coach.month))!==canonical(coach.before))error('预算已变化，请重新核对');
 const total=patch.total_minor,categories=coach.before.categories.map((c,i)=>({category:c.category,limit_minor:patch['category_'+i+'_minor']}));
 if(!minor(total)||categories.some(c=>!minor(c.limit_minor,{zero:true}))||categories.reduce((sum,c)=>sum+c.limit_minor,0)>total)error('分类金额不能超过总预算');
 return operation(coach,'allocate','budget_update',total,{month:coach.month,total_minor:total,categories,before:coach.before},'本月预算分配');
}
export function applyEditedBudget(state,coach,patch,{permit,now}={}){const op=editedBudgetOperation(state,coach,patch),at=nowOf(state,now),data=JSON.parse(op.parameters);validatePermit(state,op,permit,{now:at});commitExecution(state,permit,{status:'completed',receipt:'receipt:'+op.id+':'+coach.revision,source:'local_adapter',external:false},{now:at});state.nativeBudget??={};state.nativeBudget[coach.month]={month:coach.month,status:'set',revision:coach.before.revision+1,total_minor:data.total_minor,categories:data.categories};const delta=(data.categories.find(c=>c.category==='旅行')?.limit_minor||0)-(coach.before.categories.find(c=>c.category==='旅行')?.limit_minor||0);state.travelBudget=(coach.before.travel_goal_minor+delta)/100;startSavingsCoach(state,{id:coach.id,month:coach.month,now:at});state.savingsCoach.revision=coach.revision+1;return clone(state.savingsCoach);}
export function refreshSavingsStart(state,coach=state.savingsCoach,{now}={}){
 active(state,coach);const at=nowOf(state,now);
 if(coach.fields?.start_date&&Date.parse(coach.fields.start_date+'T'+(coach.at_time||'09:00')+':00+08:00')<=at){prepareSavingsPlan(state,coach,{now:at});const current=coach.editor?state.savingsEditor:state.savingsCoach;current.error='原开始时间已过，已改到下次存入时间，请确认新日期。';return true;}return false;
}
function proposalReady(state,coach){
 active(state,coach);if(coach.stage!=='proposal'||coach.blocked_reason)error('请先核对购物预算建议');
 if(canonical(budget(state,coach.month))!==canonical(coach.before))error('预算已变化，请重新分析后确认');
 const shopping=coach.before.categories.find(c=>c.category==='购物')?.limit_minor||0;
 if(!minor(coach.reduction_minor)||coach.reduction_minor>shopping)error('减少的金额不能超过购物预算');
}
export function reviseSavingsProposal(state,coach,{reduction_minor}){
 proposalReady(state,coach);if(!minor(reduction_minor)||reduction_minor>(coach.before.categories.find(c=>c.category==='购物')?.limit_minor||0))error('请填写购物预算范围内的金额');
 revokeOperation(state,coach.id+':budget',{reason:'parameters_changed'});
 state.savingsCoach={...clone(coach),revision:coach.revision+1,reduction_minor};return clone(state.savingsCoach);
}
export function cancelSavingsCoach(state,coach=state.savingsCoach){
 active(state,coach);if(coach.stage==='done')return clone(coach);
 revokeOperation(state,coach.id+':budget',{reason:'user_cancel'});revokeOperation(state,coach.id+':plan',{reason:'user_cancel'});
 state.savingsCoach={...clone(coach),stage:'cancelled',revision:coach.revision+1};return clone(state.savingsCoach);
}
function operation(coach,action,kind,value,parameters,target){return {id:coach.id+':'+action,revision:coach.revision,kind,target,amountMinor:value,currency:'CNY',parameters:canonical(parameters),scope:{action,coach_id:coach.id,month:coach.month},source:{kind:'program'},riskFlags:[],writes:true};}
export function budgetOperation(state,coach=state.savingsCoach){
 proposalReady(state,coach);return operation(coach,'budget','budget_update',coach.reduction_minor,{coach_id:coach.id,revision:coach.revision,month:coach.month,before:coach.before,reduction_minor:coach.reduction_minor},'购物预算转入旅行预算');
}
export function applyBudgetTransfer(state,coach=state.savingsCoach,{permit,now}={}){
 if(state.savingsCoach?.budget_receipt&&state.savingsCoach.id===coach?.id&&state.savingsCoach.revision===coach.revision)return clone(state.savingsCoach.budget_receipt);
 const op=budgetOperation(state,coach),at=nowOf(state,now);validatePermit(state,op,permit,{now:at});
 const next=clone(coach.before);delete next.travel_goal_minor;next.revision++;
 next.categories.find(c=>c.category==='购物').limit_minor-=coach.reduction_minor;
 let travel=next.categories.find(c=>c.category==='旅行');if(!travel){travel={category:'旅行',limit_minor:0};next.categories.push(travel);}travel.limit_minor+=coach.reduction_minor;
 const receipt={id:'receipt:'+op.id+':'+coach.revision,month:coach.month,amount_minor:coach.reduction_minor,shopping_before_minor:coach.before.categories.find(c=>c.category==='购物').limit_minor,shopping_after_minor:next.categories.find(c=>c.category==='购物').limit_minor,travel_before_minor:coach.before.travel_goal_minor,travel_after_minor:coach.before.travel_goal_minor+coach.reduction_minor,total_before_minor:coach.before.total_minor,total_after_minor:next.total_minor};
 if(next.categories.reduce((n,c)=>n+c.limit_minor,0)!==coach.before.categories.reduce((n,c)=>n+c.limit_minor,0))error('预算总额校验未通过');
 commitExecution(state,permit,{status:'completed',receipt:receipt.id,source:'local_adapter',external:false,budget_result:receipt},{now:at});
 state.nativeBudget??={};state.nativeBudget[coach.month]=next;state.travelBudget=receipt.travel_after_minor/100;
 state.savingsCoach={...clone(coach),stage:'details',budget_receipt:receipt};prepareSavingsPlan(state,state.savingsCoach,{now:at});return clone(receipt);
}
export function updateSavingsFields(coach,patch){
 if(!coach||!['details','confirm'].includes(coach.stage)||!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!FIELDS.includes(k)))error('请先确认预算，再补充储蓄计划');
 const fields={...coach.fields};
 for(const [key,value] of Object.entries(patch)){
  if(value==null||value===''){delete fields[key];continue;}
  if(key==='daily_minor'&&!minor(value,{max:200000}))error('每日存款金额需在0.01至2000元之间');
  if(key==='target_minor'&&!minor(value))error('储蓄目标金额无效');
  if(key==='source_account'&&!['living_1608','salary_0826'].includes(value))error('请选择付款账户');
  if(key==='start_date'&&!date(value))error('请选择有效的开始日期');
  fields[key]=value;
 }
 if(fields.target_minor&&fields.daily_minor&&fields.target_minor<fields.daily_minor)error('目标金额不能小于每日存款');
 return {...clone(coach),fields,revision:coach.revision+1,stage:FIELDS.every(k=>fields[k]!=null)?'confirm':'details'};
}
function planTerms(state,coach,now){
 active(state,coach);if(coach.stage!=='confirm'||FIELDS.some(k=>coach.fields[k]==null))error('请补齐每日金额、来源、开始日期和目标');
 const checked=updateSavingsFields({...coach,stage:'details'},coach.fields).fields,at=nowOf(state,now),today=chinaDate(at);
 if(checked.start_date<today||checked.start_date>dateAdd(today,30)||Date.parse(checked.start_date+'T'+(coach.at_time||'09:00')+':00+08:00')<=at)error('开始时间须在未来30天内');
 const previous=previousJar(state,coach),saved=previous?.saved_minor||0;
 if(!minor(saved,{zero:true})||checked.target_minor<=saved)error('目标需高于已存金额');
 const review_until=dateAdd(checked.start_date,29),cap=Math.min(checked.target_minor-saved,checked.daily_minor*30);
 if(coach.previous_revision!=null&&coach.previous_revision!==(previous?.revision||0))error('储蓄罐已更新，请重新打开编辑');
 return {...checked,name:coach.name||previous?.name||'旅行储蓄罐',plan_id:previous?.id||coach.id+':jar',plan_revision:(previous?.revision||0)+1,saved_minor:saved,review_until,total_cap_minor:cap,at_time:coach.at_time||'09:00',previous_revision:previous?.revision||0};
}
export function savingsPlanOperation(state,coach=state.savingsCoach,{now}={}){
 const terms=planTerms(state,coach,now);return operation(coach,'plan','savings_schedule',terms.total_cap_minor,{coach_id:coach.id,revision:coach.revision,terms},terms.name+'每日计划');
}
export function applySavingsPlan(state,coach=state.savingsCoach,{permit,now}={}){
 if(state.savingsCoach?.stage==='done'&&state.savingsCoach.id===coach?.id&&state.savingsJar?.coach_id===coach.id)return clone(state.savingsJar);
 const at=nowOf(state,now),op=savingsPlanOperation(state,coach,{now:at}),terms=JSON.parse(op.parameters).terms;
 validatePermit(state,op,permit,{now:at});
 const result={status:'completed',receipt:'receipt:'+op.id+':'+coach.revision,source:'local_adapter',external:false,savings_terms:terms};
 commitExecution(state,permit,result,{now:at});
 const previous=previousJar(state,coach);
 const jar=putJar(state,{...terms,id:terms.plan_id,revision:terms.plan_revision,coach_id:coach.editor?(previous?.coach_id||coach.id):coach.id,coach_ids:[...new Set([...(previous?.coach_ids||[]),previous?.coach_id,...(!coach.editor?[coach.id]:[])].filter(Boolean))],status:'active',deposits:clone(previous?.deposits||{}),cycle_deposited_minor:0,created_at:at,authority:{execution_id:permit.executionId,permit_id:permit.permitId,epoch:permit.epoch,operation:clone(op),result:clone(result)}},{travel:!coach.editor});
 if(coach.editor)state.savingsEditor=null;else state.savingsCoach={...clone(coach),stage:'done',plan_receipt:result.receipt};return clone(jar);
}
export function beginSavingsAdjustment(state,{now,resume=false}={}){
 const jar=state.savingsJar;if(!jar)error('还没有储蓄计划');const today=chinaDate(nowOf(state,now));
 const fields={daily_minor:jar.daily_minor,source_account:jar.source_account,start_date:Date.parse(jar.start_date+'T09:00:00+08:00')<=nowOf(state,now)?nextStart(nowOf(state,now)):jar.start_date,target_minor:jar.target_minor};
 state.savingsCoach={id:id(),revision:1,stage:resume?'confirm':'details',month:today.slice(0,7),fields,jar_id:jar.id,adjusting:true,budget_receipt:null};return clone(state.savingsCoach);
}
export function pauseSavingsPlan(state,{source,jarId}={}){
 if(source?.kind!=='user'||!USER_SOURCES.has(source.method))error('请由你确认暂停');
 const jar=findJar(state,jarId);if(!jar)return null;
 jar.status='paused';putJar(state,jar);auditSafety(state,{type:'savings_plan_paused',operationId:jar.authority.operation.id,reason:'user_pause'});return clone(jar);
}
function scheduleProof(state,jar,at){
 const a=jar.authority,entry=state.safety?.executions?.[a?.execution_id],grant=state.safety?.grants?.[entry?.grantId];
 if(!a||entry?.status!=='completed'||entry.permitId!==a.permit_id||entry.epoch!==a.epoch||state.safety.epoch!==a.epoch||entry.operationId!==a.operation.id||entry.snapshot.parameters!==a.operation.parameters||canonical(entry.result)!==canonical(a.result)||grant?.status!=='completed'||grant.source?.kind!=='user'||grant.epoch!==a.epoch||grant.binding!==entry.binding)error('储蓄授权已失效，请重新核对');
 const terms=JSON.parse(entry.snapshot.parameters).terms;
 for(const key of ['daily_minor','source_account','start_date','target_minor','review_until','total_cap_minor','at_time'])if(jar[key]!==terms[key])error('储蓄参数已变化，请重新核对');
 if(jar.id!==terms.plan_id||jar.revision!==terms.plan_revision)error('储蓄计划已变化，请重新核对');
 if(at<jar.created_at)error('时间无法核对');
 const rows=(state.ledger||[]).filter(r=>r.kind==='savings_deposit'&&r.taskId===jar.id);
 if(rows.reduce((n,r)=>n+r.amountMinor,0)!==jar.saved_minor||rows.filter(r=>r.revision===jar.revision).reduce((n,r)=>n+r.amountMinor,0)!==jar.cycle_deposited_minor||jar.saved_minor!==terms.saved_minor+jar.cycle_deposited_minor||jar.cycle_deposited_minor>terms.total_cap_minor)error('储蓄进度与账本不一致，请先核对');
 return terms;
}
function tickJar(state,jar,{now}={}){
 if(!jar||jar.status!=='active')return {status:jar?.status||'none',executed:false};
 const at=nowOf(state,now),day=chinaDate(at);
 if(state.safety?.locked||state.paused||state.safety?.epoch!==jar.authority?.epoch){jar.status='paused_safety';return {status:jar.status,executed:false};}
 scheduleProof(state,jar,at);
 if(day>jar.review_until){jar.status='needs_review';return {status:jar.status,executed:false};}
 if(day<jar.start_date||at<Date.parse(day+'T'+jar.at_time+':00+08:00'))return {status:'scheduled',executed:false};
 if(jar.deposits[day])return {status:'already_completed',executed:false,receipt:clone(jar.deposits[day])};
 const remaining=Math.min(jar.target_minor-jar.saved_minor,jar.total_cap_minor-jar.cycle_deposited_minor),value=Math.min(jar.daily_minor,remaining);
 if(value<=0){jar.status=jar.saved_minor>=jar.target_minor?'completed':'needs_review';return {status:jar.status,executed:false};}
 ensureFinance(state);
 if(Math.round(state.balance*100)-value<800000){jar.status='paused_balance';return {status:jar.status,executed:false};}
 const rowId='savings:'+jar.id+':'+day;
 if(state.ledger.some(r=>r.id===rowId))error('这一天已有储蓄记录，请先核对');
 const receipt={id:rowId,amount_minor:value,date:day,source_account:jar.source_account,revision:jar.revision};
 state.ledger.push({id:rowId,date:day,title:'旅行储蓄罐',category:'储蓄',amountMinor:value,direction:'expense',movement:'principal',kind:'savings_deposit',revision:jar.revision,order:state.ledger.length,accountLabel:accountLabel(jar.source_account),source:'synthetic',receipt:rowId,taskId:jar.id,icon:'wallet'});
 jar.saved_minor+=value;jar.cycle_deposited_minor+=value;jar.deposits[day]=receipt;
 if(jar.saved_minor>=jar.target_minor)jar.status='completed';
 syncFinance(state);auditSafety(state,{type:'savings_deposit_completed',operationId:jar.authority.operation.id,receipt:rowId,status:'completed'},{now:at});
 return {status:'completed',executed:true,receipt:clone(receipt)};
}
export function tickSavingsPlan(state,{now}={}){const jars=listSavingsJars(state),results=jars.map(j=>{const result=tickJar(state,j,{now});putJar(state,j);return result;});return results.length===1?results[0]:{status:results.some(r=>r.executed)?'completed':'scheduled',executed:results.some(r=>r.executed),results};}
export function beginJarEditor(state,{jarId,now,resume=false}={}){
 const jar=jarId?findJar(state,jarId):null;if(jarId&&!jar)error('储蓄罐不存在');const at=nowOf(state,now);
 state.savingsEditor={id:id(),revision:1,stage:'details',month:chinaDate(at).slice(0,7),at_time:jar?.at_time||'09:00',editor:true,new_jar:!jar,jar_id:jar?.id,previous_revision:jar?.revision||0,name:jar?.name||'新储蓄罐',fields:{daily_minor:jar?.daily_minor||2000,source_account:jar?.source_account||'living_1608',start_date:jar&&Date.parse(jar.start_date+'T'+(jar.at_time||'09:00')+':00+08:00')>at?jar.start_date:nextStart(at,jar?.at_time||'09:00'),target_minor:jar?.target_minor||60000}};
 if(resume)state.savingsEditor.stage='confirm';return clone(state.savingsEditor);
}
export function updateJarEditor(state,patch){const editor=state.savingsEditor;active(state,editor);const {name,at_time=editor.at_time||'09:00',...fields}=patch;if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(at_time))error('请选择有效的每日存入时间');if(typeof name!=='string'||!name.trim()||name.trim().length>24)error('名称需为1至24个字');state.savingsEditor={...updateSavingsFields(editor,fields),name:name.trim(),at_time,error:null};return clone(state.savingsEditor);}
export function cancelJarPlan(state,jarId,{source}={}){if(source?.kind!=='user'||!USER_SOURCES.has(source.method))error('请由你确认取消');const jar=findJar(state,jarId);if(!jar)error('储蓄罐不存在');if(jar.status==='cancelled')return clone(jar);revokeOperation(state,jar.authority.operation.id,{reason:'user_cancel'});jar.status='cancelled';jar.revision++;putJar(state,jar);auditSafety(state,{type:'savings_plan_cancelled',operationId:jar.authority.operation.id,reason:'user_cancel'});return clone(jar);}
export function savingsModelContext(state){
 const c=state.savingsCoach;if(!c||['done','cancelled'].includes(c.stage))return null;
 return {scenario:'savings_coach',stage:c.stage,revision:c.revision,draft_id:c.id,status:c.stage==='details'?'clarify':'propose',fields:{reduction_minor:c.reduction_minor??null,...clone(c.fields)},missing:c.stage==='details'?FIELDS.filter(k=>c.fields[k]==null):[],analysis:c.analysis?{period:c.analysis.period,total_minor:c.analysis.total_minor,categories:clone(c.analysis.categories)}:null};
}
export function savingsSummary(state){
 const c=state.savingsCoach;if(!c)return '';
 if(c.stage==='cancelled')return c.budget_receipt?'预算已调整，储蓄计划未建立。':'没有调整预算，也没有转出资金。';
 if(c.stage!=='done')return c.budget_receipt?'旅行预算已增加 '+amount(c.budget_receipt.amount_minor)+'，储蓄计划待你确认。':'预算建议还没有执行。';
 const jar=state.savingsJar,prefix=c.budget_receipt?'购物预算减少 '+amount(c.budget_receipt.amount_minor)+'，旅行预算增加同样金额。':'';
 return prefix+'储蓄罐已安排从 '+jar.start_date+' 起每天'+(jar.at_time||'09:00')+'存 '+amount(jar.daily_minor)+'，目标 '+amount(jar.target_minor)+'。尚未存入的金额会到时核对。';
}
const pig=`<svg viewBox="0 0 80 72" aria-hidden="true"><path d="M28 18c-7-3-13-1-14 5l-5 7 2 14 9 6 1 9h9l2-6h16l3 6h9l1-12 7-8V28l-9-3c-4-8-12-12-22-11l-6-7-4 3z"/><path d="M32 22h14M13 31H6v10h8M66 23c9-3 10 7 3 6"/><circle cx="23" cy="28" r="1.4"/><path d="M48 4v7M40 8l3 4M57 8l-3 4"/></svg>`;
function graph(analysis,e){
 if(!analysis||!analysis.total_minor)return '<p>上月没有可分析的支出记录。</p>';
 const colors=['var(--indigo-9,#3e63dd)','var(--pink-9,#d6409f)','var(--amber-9,#ffc53d)','var(--teal-9,#12a594)','var(--slate-8,#b9bbc6)','var(--purple-9,#8e4ec6)'];
 const items=analysis.categories.slice(0,5),rest=analysis.categories.slice(5).reduce((n,x)=>n+x.amount_minor,0);if(rest)items.push({category:'其余分类',amount_minor:rest,ratio:rest/analysis.total_minor});
 let start=0;const stops=items.map((x,i)=>{const end=start+x.ratio*100,s=colors[i]+' '+start.toFixed(4)+'% '+end.toFixed(4)+'%';start=end;return s;});
 return `<div class="savings-analysis"><div class="savings-pie" role="img" aria-label="${e(analysis.period)}支出比例" style="background:conic-gradient(${stops.join(',')})"></div><div><span class="muted">${e(analysis.period)} 支出</span><strong class="savings-total">${amount(analysis.total_minor)}</strong></div></div><ul class="savings-legend">${items.map((x,i)=>`<li><span><i style="background:${colors[i]}"></i>${e(x.category)}</span><span>${amount(x.amount_minor)} <b>${(x.ratio*100).toFixed(1)}%</b></span></li>`).join('')}</ul>`;
}
export function renderSavingsCoach(state,{esc:e=escapeHTML}={}){
 const c=state.savingsCoach;if(!c)return '';
 if(['done','cancelled'].includes(c.stage))return `<section class="card savings-card" data-savings-stage="${c.stage}"><h3>${c.stage==='done'?'安排好了':'已取消'}</h3><p>${e(savingsSummary(state))}</p></section>`;
 if(c.stage==='proposal'){
  const before=c.before.categories.find(x=>x.category==='购物')?.limit_minor||0;
  if(c.editingAllocation)return `<section class="card savings-card"><h3>核对本月预算</h3><form id="savings-budget-form" data-revision="${c.revision}"><label>总预算（元）<input name="total_minor" type="number" min="0.01" step="0.01" value="${c.before.total_minor/100}" required></label>${c.before.categories.map((row,i)=>`<label>${e(row.category)}（元）<input name="category_${i}_minor" type="number" min="0" step="0.01" value="${row.limit_minor/100}" required></label>`).join('')}<button class="primary" type="submit">确认预算并继续</button><button class="quiet" type="button" data-action="savings-allocation-cancel">返回</button>${c.error?`<p role="alert">${e(c.error)}</p>`:''}</form></section>`;
  if(c.use_existing||c.blocked_reason)return `<section class="card savings-card" data-savings-stage="proposal"><h3>上月的钱花在哪</h3>${graph(c.analysis,e)}<p>${c.use_existing?`购物预算已调到0，旅行预算已有 ${amount(c.available_minor)}。可用其中 ${amount(c.reduction_minor)} 拟定储蓄计划，不再调整预算。`:e(c.blocked_reason)}</p><div class="task-actions">${c.use_existing?'<button class="primary" data-action="savings-use-existing">拟定储蓄计划</button>':''}<button class="quiet" data-action="savings-allocation-edit">调整本月预算</button></div><button class="quiet full" data-action="savings-cancel">先不调整</button></section>`;
  return `<section class="card savings-card" data-savings-stage="proposal"><h3>上月的钱花在哪</h3>${graph(c.analysis,e)}${c.blocked_reason?`<p>${e(c.blocked_reason)}</p>`:`<div class="savings-proposal"><p>购物预算从 ${amount(before)} 调到 ${amount(before-c.reduction_minor)}，省下的 ${amount(c.reduction_minor)} 放进旅行预算。</p><p class="muted">本月总预算仍是 ${amount(c.before.total_minor)}。</p></div><div class="task-actions"><button class="primary" data-action="savings-accept-budget" data-revision="${c.revision}">同意这样调整</button><button class="quiet" data-action="savings-adjust-budget">改个金额</button></div>`}<button class="quiet full" data-action="savings-cancel">先不调整</button></section>`;
 }
 if(c.stage==='details')return `<section class="card savings-card" data-savings-stage="details"><h3>${c.adjusting?'调整储蓄计划':'每天存一点'}</h3><form id="savings-fields-form" data-revision="${c.revision}"><label>每天存多少（元）<input name="daily_minor" type="number" min="0.01" max="2000" step="0.01" value="${c.fields.daily_minor?c.fields.daily_minor/100:''}" required></label><label>从哪个账户存<select name="source_account" required><option value="">请选择</option><option value="living_1608" ${c.fields.source_account==='living_1608'?'selected':''}>生活账户 1608</option><option value="salary_0826" ${c.fields.source_account==='salary_0826'?'selected':''}>工资账户 0826</option></select></label><label>从哪天开始<input name="start_date" type="date" value="${e(c.fields.start_date||'')}" required></label><label>想存到多少（元）<input name="target_minor" type="number" min="0.01" step="0.01" value="${c.fields.target_minor?c.fields.target_minor/100:''}" required></label><button class="primary full" type="submit">核对储蓄计划</button><button class="quiet full" type="button" data-action="savings-cancel">暂不设置</button></form></section>`;
 const f=c.fields;return `<section class="card savings-card" data-savings-stage="confirm"><h3>确认每日储蓄</h3><div class="savings-confirm-main"><div class="savings-pig">${pig}</div><strong class="savings-total">每天 ${amount(f.daily_minor)}</strong></div><p>${e(accountLabel(f.source_account))} → 旅行储蓄罐</p><p>${e(f.start_date)} 起每天${e(c.at_time||'09:00')}，目标 ${amount(f.target_minor)}</p><p class="muted">本期30天，最多存 ${amount(Math.min(f.daily_minor*30,f.target_minor-(state.savingsJar?.saved_minor||0)))}。${c.budget_receipt?'这笔存款使用已腾出的旅行预算，不再调整预算。':'确认时不扣款。'}</p>${c.error?`<p role="alert">${e(c.error)}</p>`:''}<div class="task-actions"><button class="primary" data-action="savings-confirm-plan" data-revision="${c.revision}">确认安排</button><button class="quiet" data-action="savings-edit-fields">修改</button></div><button class="quiet full" data-action="savings-cancel">暂不设置</button></section>`;
}
export function renderSavingsAdjustment(state,{esc:e=escapeHTML}={}){const c=state.savingsCoach;return c?.stage==='proposal'?`<section class="card savings-card"><form id="savings-adjust-form" data-revision="${c.revision}"><label>购物预算减少多少（元）<input name="reduction_minor" type="number" min="0.01" step="0.01" value="${c.reduction_minor/100}" required></label><button class="primary full" type="submit">更新建议</button></form></section>`:'';}
export function renderSavingsJar(state,{esc:e=escapeHTML}={}){
 const labels={active:'按计划储蓄',paused:'已暂停',paused_safety:'待重新核对',paused_balance:'余额不足，已暂停',needs_review:'本期结束',completed:'目标已完成',cancelled:'已取消'};
 const cards=listSavingsJars(state).map(jar=>{
 const progress=Math.min(100,jar.saved_minor/jar.target_minor*100),attr=`data-jar-id="${e(jar.id)}"`,button=(action,text,css='quiet')=>`<button class="${css}" data-action="${action}" ${attr}>${text}</button>`;
 return `<section class="card savings-card savings-jar" aria-label="${e(jar.name||'旅行储蓄罐')}"><div class="row between"><h3>${e(jar.name||'旅行储蓄罐')}</h3><span class="savings-status">${e(labels[jar.status]||'待核对')}</span></div><div class="savings-jar-main"><div class="savings-pig">${pig}</div><div><strong class="savings-total">${amount(jar.saved_minor)}</strong><span class="muted">目标 ${amount(jar.target_minor)}</span></div></div><progress value="${jar.saved_minor}" max="${jar.target_minor}" aria-label="储蓄进度">${progress.toFixed(1)}%</progress><p>每天 ${amount(jar.daily_minor)}，${e(accountLabel(jar.source_account))}</p><p class="muted">${e(jar.start_date)} 至 ${e(jar.review_until)}，每天${e(jar.at_time||'09:00')}</p>${state.savingsArchiveId===jar.id?`<p>从列表移除，保留可恢复记录。</p><div class="task-actions">${button('savings-jar-archive-confirm','确认移除','primary')}${button('savings-jar-archive-dismiss','保留')}</div>`:state.savingsCancelId===jar.id?`<p>取消后停止后续存款，已存金额保留。</p><div class="task-actions">${button('savings-jar-cancel-confirm','确认取消','primary')}${button('savings-jar-cancel-dismiss','保留计划')}</div>`:`<div class="task-actions">${button('savings-jar-adjust','调整计划')}${jar.status==='active'?button('savings-jar-pause','暂停'):jar.status!=='completed'?button('savings-jar-resume',jar.status==='cancelled'?'重新安排':'核对后继续','primary'):''}${!['cancelled','completed'].includes(jar.status)?button('savings-jar-cancel','取消计划'):''}${jar.saved_minor===0&&jar.status!=='active'?button('savings-jar-archive','移除'):''}</div>`}</section>`;
 }).join('');
 return `<section class="savings-section" aria-label="储蓄罐"><div class="row between"><h2>储蓄罐</h2><button class="quiet" data-action="savings-jar-new">新建储蓄罐</button></div>${renderJarEditor(state,{esc:e})}${cards}${Object.keys(state.savingsArchived||{}).length?`<details class="savings-archive"><summary>已移除（${Object.keys(state.savingsArchived).length}）</summary>${Object.values(state.savingsArchived).map(r=>`<div class="row between"><span>${e(r.jar.name||'储蓄罐')}</span><button class="quiet" data-action="savings-jar-restore" data-jar-id="${e(r.jar.id)}">恢复</button></div>`).join('')}</details>`:''}</section>`;
}
export function renderJarEditor(state,{esc:e=escapeHTML}={}){
 const c=state.savingsEditor;if(!c)return '';const f=c.fields;
 const fields=`<label>名称<input name="name" maxlength="24" value="${e(c.name)}" required></label><label>目标金额（元）<input name="target_minor" type="number" min="0.01" step="0.01" value="${f.target_minor/100}" required></label><label>每天存入（元）<input name="daily_minor" type="number" min="0.01" max="2000" step="0.01" value="${f.daily_minor/100}" required></label><label>来源账户<select name="source_account"><option value="living_1608" ${f.source_account==='living_1608'?'selected':''}>生活账户 1608</option><option value="salary_0826" ${f.source_account==='salary_0826'?'selected':''}>工资账户 0826</option></select></label><label>开始日期<input name="start_date" type="date" value="${e(f.start_date)}" required></label><label>每天存入时间<input name="at_time" type="time" value="${e(c.at_time||'09:00')}" required></label>`;
 return `<section class="card savings-card savings-editor" aria-label="储蓄计划编辑"><h3>${c.new_jar?'新建储蓄罐':'调整储蓄计划'}</h3>${c.error?`<p role="alert">${e(c.error)}</p>`:''}${c.stage==='details'?`<form id="savings-jar-form" data-revision="${c.revision}">${fields}<p class="muted">本期安排30天，确认后生效。</p><button class="primary" type="submit">核对计划</button><button class="quiet" type="button" data-action="savings-editor-close">取消</button></form>`:`<strong>${e(c.name)}</strong><p>每天 ${amount(f.daily_minor)}，${e(accountLabel(f.source_account))}</p><p>${e(f.start_date)} 起每天${e(c.at_time||'09:00')}，目标 ${amount(f.target_minor)}</p><p class="muted">本期最多存 ${amount(Math.min(f.daily_minor*30,f.target_minor-(findJar(state,c.jar_id)?.saved_minor||0)))}，确认时不扣款。</p><div class="task-actions"><button class="primary" data-action="savings-editor-save" data-revision="${c.revision}">确认保存</button><button class="quiet" data-action="savings-editor-edit">修改</button><button class="quiet" data-action="savings-editor-close">取消</button></div>`}</section>`;
}
