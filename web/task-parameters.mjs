import {SUBSCRIPTIONS} from './agent-tools.mjs';
import {MAX_AMOUNT_MINOR,MAX_AMOUNT_YUAN} from './limits.mjs';
export const CONTACTS=[{id:'mom',name:'妈妈',suffix:'6821'},{id:'dad',name:'爸爸',suffix:'4382'}];
export const SOURCES=[{id:'salary_0826',name:'工资账户',suffix:'0826'},{id:'living_1608',name:'生活账户',suffix:'1608'}];
export function taskParameters(t){return {amount_minor:Math.round((t.amount||0)*100),cadence:t.cadence||'once',currency:t.currency||'CNY',kind:t.kind,payee_id:t.payeeId||((t.key==='salary')?'mom':null),purpose:t.purpose||null,scheduled_date:t.scheduledDate||'2026-11-02',scope:t.scope||'next_renewal',source_account:t.sourceAccount||(t.kind==='card'?'living_1608':'salary_0826'),subscription_action:t.subscriptionAction||'cancel',subscription_id:t.subscriptionId||'video',next_renewal:t.nextRenewalDate||null,subscription_revision:t.subscriptionRevision||1,target:t.target||'',risk_flags:[...(t.riskFlags||[])].sort(),...(t.kind==='card'?{transaction_ref:t.transactionRef||'unrecognized_1299'}:{})};}
export const parameterFingerprint=t=>JSON.stringify(taskParameters(t));
export function validateTaskParameters(t){
 const p=taskParameters(t);
 if(['transfer','investment','redemption','planning'].includes(t.kind)&&(!Number.isSafeInteger(p.amount_minor)||p.amount_minor<=0||p.amount_minor>MAX_AMOUNT_MINOR))throw Error('请核对有效金额');
 if(p.currency!=='CNY'||!SOURCES.some(s=>s.id===p.source_account))throw Error('请核对付款账户和币种');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(p.scheduled_date)||!Number.isFinite(Date.parse(p.scheduled_date+'T00:00:00Z'))||new Date(p.scheduled_date+'T00:00:00Z').toISOString().slice(0,10)!==p.scheduled_date)throw Error('日期无效');
 if(p.scheduled_date!=='2026-11-02')throw Error('未来日期先保留为草稿，此轮只执行当天安排');
 if(t.kind==='card'&&(p.transaction_ref!=='unrecognized_1299'||p.source_account!=='living_1608'))throw Error('请先核对所选交易与卡片账户');
 if(t.kind==='transfer'&&(!CONTACTS.some(c=>c.id===p.payee_id)||p.risk_flags.length))throw Error('收款人尚未核实或存在风险，不能继续转账');
 if(t.kind==='subscription'&&(!['video','cloud','music'].includes(p.subscription_id)||!['cancel','keep','downgrade'].includes(p.subscription_action)||p.scope!=='next_renewal'))throw Error('请核对订阅对象与下次续费范围');
 if(t.kind==='subscription'&&p.subscription_action==='downgrade'&&p.subscription_id!=='video')throw Error('这项订阅尚无可核实的标准套餐，请选择保留或取消下次续费');
 return p;
}
export function editedTask(t,payload){
 const allowed=['amount','payeeId','sourceAccount','currency','scheduledDate','subscriptionId','subscriptionAction','scope','cadence','purpose','transactionRef'];
 if(Object.keys(payload).some(k=>!allowed.includes(k)))throw Error('修改字段不受支持');
 const next={...t,...payload};
 if(payload.amount!==undefined){const n=Number(payload.amount);if(!Number.isFinite(n)||n<=0||n>MAX_AMOUNT_YUAN||Math.abs(Math.round(n*100)-n*100)>.000001)throw Error('请输入有效金额，最多两位小数');next.amount=n;}
 if(payload.payeeId!==undefined){const person=CONTACTS.find(c=>c.id===payload.payeeId);if(!person)throw Error('请先核实收款人');next.target=person.name+' 尾号 '+person.suffix;next.payeeName=person.name;}
 if(next.kind==='subscription'){
  const sub=SUBSCRIPTIONS.find(s=>s.id===next.subscriptionId);
  if(!sub)throw Error('请核对订阅对象');
  next.target=sub.name+' 下次续费';next.nextRenewalDate=sub.nextDate;next.rightsUntil=sub.rightsUntil;next.scope='next_renewal';
  next.title={cancel:'取消下次续费',keep:'保留当前订阅',downgrade:'调整下次套餐'}[next.subscriptionAction];
 }
 validateTaskParameters(next);return next;
}
