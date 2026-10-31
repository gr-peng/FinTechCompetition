import {budgetPreview,budgetReceiptFacts} from './budget-result.mjs';
import {taskParameters,parameterFingerprint,CONTACTS,SOURCES} from './task-parameters.mjs';
import {SUBSCRIPTIONS} from './agent-tools.mjs';
import {lastPeriodDate} from './standing-orders.mjs';
const actionNames={cancel:'取消下次续费',keep:'保留当前套餐',downgrade:'下次改标准套餐'};
export function salaryPlanRows(t,original){
 const person=CONTACTS.find(c=>c.id===taskParameters(t).payee_id);
 const name=person?.name||t.payeeName||t.target;
 const total=original.reduce((n,[,amount])=>n+Math.round(amount*100),0);
 const fixed=original.filter(([label])=>!['给妈妈','待安排'].includes(label)).reduce((n,[,amount])=>n+Math.round(amount*100),0);
 return original.map(([label,amount])=>label==='给妈妈'?['给'+name,t.amount]:label==='待安排'?[label,(total-fixed-Math.round(t.amount*100))/100]:[label,amount]);
}
export function taskPermission(t){
 if(t.kind==='subscription'){const sub=SUBSCRIPTIONS.find(s=>s.id===(t.subscriptionId||'video'));return '查看'+(sub?.name||'本项订阅')+'并'+(actionNames[t.subscriptionAction||'cancel'])+'，仅限下次续费';}
 if(t.kind==='transfer'){const p=taskParameters(t),source=SOURCES.find(s=>s.id===p.source_account);return '读取'+source.name+' '+source.suffix+'并准备向'+t.target+(p.cadence==='monthly'?'的'+p.occurrences+'期定期转账':'的这一次转账');}
 if(t.kind==='planning')return '读取并修改本月旅行预算，保留必要支出预留';
 return null;
}
export function subscriptionDetailHTML(t,{esc}){
 const sub=SUBSCRIPTIONS.find(s=>s.id===(t.subscriptionId||'video'));if(!sub)return '';
 const cash=n=>'¥'+(n/100).toFixed(2);
 return `<div class="spacer"></div><div class="card"><h3>${esc(sub.name)}</h3><div class="plan-row"><span>原月费</span><strong>${cash(sub.previousMinor)}</strong></div><div class="plan-row"><span>当前月费</span><strong>${cash(sub.currentMinor)}</strong></div><div class="plan-row"><span>下次续费日</span><strong>${esc(sub.nextDate)}</strong></div><div class="plan-row"><span>本期权益至</span><strong>${esc(sub.rightsUntil)}</strong></div></div>`;
}
export function taskReviewHTML(t,{state,esc}){
 const p=taskParameters(t),cash=n=>'¥'+(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const row=(label,value)=>`<div class="plan-row ${label==='金额'?'operation-amount-row':''}"><span>${label}</span><strong>${esc(value)}</strong></div>`;
 let html='';
 if(t.kind==='card')html+=row('核对交易','陌生商户 ¥1,299.00')+row('卡片账户','生活账户 1608')+row('安排','临时锁卡并提交核查，不转出资金');
 if(['transfer','investment','redemption'].includes(t.kind))html+=row(t.kind==='transfer'?'收款人':'安排对象',t.target)+row('付款账户',SOURCES.find(a=>a.id===p.source_account)?.name+' '+SOURCES.find(a=>a.id===p.source_account)?.suffix)+row('币种',p.currency)+row(p.cadence==='monthly'?'每期金额':'金额',cash(p.amount_minor))+(p.cadence==='monthly'?row('频率','每月一次')+row('期数',p.occurrences+' 期（今天执行第 1 期）')+row('累计上限',cash(p.amount_minor*p.occurrences))+row('最后一期',lastPeriodDate(p.scheduled_date,p.occurrences)):row('日期',p.scheduled_date));
 if(t.kind==='subscription'){
  const sub=SUBSCRIPTIONS.find(x=>x.id===p.subscription_id);
  html+=row('订阅对象',sub?.name||'待核对')+row('安排',actionNames[p.subscription_action])+row('生效范围','下次续费')+row('下次续费日',sub?.nextDate||'待核对')+row('本期权益保留至',sub?.rightsUntil||'待核对')+row('本期已扣费用',cash(sub?.currentMinor||0));
 }
 if(t.kind==='planning'){const completed=t.status==='done',b=completed?budgetReceiptFacts(state,t,{parameters:parameterFingerprint(t)}):budgetPreview(state,t);html+=b?row(completed?'调整前预算':'当前旅行预算',cash(b.before_minor))+row('本次调增',cash(b.delta_minor))+row('调整后预算',cash(b.after_minor)):row('本次调增',cash(p.amount_minor))+row('执行前后预算','历史快照未保留');}
 if(['transfer','investment','planning'].includes(t.kind)&&!['done','cancelled'].includes(t.status))html+=row('必要支出预留','¥8,000.00');
 if(t.kind==='planning'&&state.subscriptionCancelled)html+=row('已取消的下期订阅','不计入本期现金');
 return html;
}
export function taskEditHTML(t,{esc}){
 const p=taskParameters(t);let html='';
 const select=(name,label,values,current)=>`<label>${label}<select name="${name}" required>${values.map(([id,text])=>`<option value="${id}" ${id===current?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
 if(['transfer','investment','redemption','planning'].includes(t.kind))html+=`<label>金额（元）<input name="amount" id="edit-amount" type="number" min="0.01" max="20000" step="0.01" value="${t.amount}" required></label>`;
 if(t.kind==='transfer')html+=select('payeeId','收款人',CONTACTS.map(c=>[c.id,c.name+' 尾号 '+c.suffix]),p.payee_id);
 if(['transfer','investment','redemption'].includes(t.kind))html+=select('sourceAccount','付款账户',SOURCES.map(a=>[a.id,a.name+' '+a.suffix]),p.source_account)+select('currency','币种',[['CNY','人民币 CNY']],p.currency)+`<label>日期<input name="scheduledDate" type="date" value="${esc(p.scheduled_date)}" min="2026-11-02" max="2026-11-02" required></label>`;
 if(t.kind==='subscription')html+=select('subscriptionId','订阅对象',SUBSCRIPTIONS.map(x=>[x.id,x.name]),p.subscription_id)+select('subscriptionAction','下次续费安排',Object.entries(actionNames),p.subscription_action);
 return html;
}
export function readTaskEdit(form){const out={};for(const [name,value] of new FormData(form))if(['amount','payeeId','sourceAccount','currency','scheduledDate','subscriptionId','subscriptionAction'].includes(name))out[name]=value;return out;}
