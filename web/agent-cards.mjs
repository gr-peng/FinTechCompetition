import {budgetReceiptFacts} from './budget-result.mjs';
import {CONTACTS,SOURCES,parameterFingerprint} from './task-parameters.mjs';
import {SUBSCRIPTIONS} from './agent-tools.mjs';
export const fieldLabels={amount_minor:'金额',payee_id:'收款人',source_account:'付款账户',scheduled_date:'日期',subscription_id:'订阅',subscription_action:'续费安排',purpose:'用途',cadence:'频率',occurrences:'期数',transaction_ref:'待核对交易'};
const options={occurrences:[['2','2 期'],['3','3 期']],transaction_ref:[['unrecognized_1299','生活账户1608 陌生交易 ¥1,299.00']],purpose:[['family','转给家人'],['travel','旅行安排'],['cash','灵活储蓄']],payee_id:CONTACTS.map(c=>[c.id,c.name+' 尾号 '+c.suffix]),source_account:SOURCES.map(a=>[a.id,a.name+' '+a.suffix]),subscription_id:SUBSCRIPTIONS.map(s=>[s.id,s.name]),subscription_action:[['cancel','取消下次续费'],['keep','保留当前套餐'],['downgrade','下次改标准套餐']],cadence:[['once','只安排这次'],['monthly','每月提醒确认']]};
export function clarificationFields(draft,esc){return draft.missing.map(key=>{
 const value=draft.fields[key];
 if(key==='amount_minor')return `<label>金额（元）<input name="amount_minor" type="number" inputmode="decimal" min="0.01" max="20000" step="0.01" value="${esc(draft.uiValues?.[key]??(value?value/100:''))}" required></label>`;
 if(key==='scheduled_date')return `<label>日期<input name="scheduled_date" type="date" value="${esc(value||'2026-11-02')}" required></label>`;
 return `<label>${fieldLabels[key]||'补充信息'}<select name="${esc(key)}" required><option value="">请选择</option>${(options[key]||[]).map(([id,label])=>`<option value="${id}" ${id===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
}).join('');}
export function draftWithInputs(draft,values){
 const next={...draft,fields:{...draft.fields},uiValues:{...draft.uiValues}};
 for(const [key,raw] of Object.entries(values)){
  if(!fieldLabels[key]||typeof raw!=='string'||raw.length>120)continue;
  next.uiValues[key]=raw;
  if(key==='amount_minor'){
   const n=/^\d+(\.\d{1,2})?$/.test(raw)?Math.round(Number(raw)*100):null;
   if(Number.isSafeInteger(n)&&n>0&&n<=2000000)next.fields[key]=n;else delete next.fields[key];
  }else if(options[key]?.some(([id])=>id===raw)||key==='scheduled_date'&&/^\d{4}-\d{2}-\d{2}$/.test(raw))next.fields[key]=raw;
  else delete next.fields[key];
 }
 return next;
}
export function readClarification(form){
 const fields={};for(const [key,value] of new FormData(form)){
  if(!fieldLabels[key])continue;
  if(key==='amount_minor'){if(!/^\d+(\.\d{1,2})?$/.test(value))throw Error('请输入最多两位小数的金额');fields[key]=Math.round(Number(value)*100);if(fields[key]<=0||fields[key]>2000000)throw Error('金额不在本轮范围内');}
  else fields[key]=value;
 }return fields;
}
export function clarificationText(fields){return Object.entries(fields).map(([key,value])=>fieldLabels[key]+'：'+(key==='amount_minor'?(value/100).toFixed(2)+'元':options[key]?.find(x=>x[0]===value)?.[1]||value)).join('，');}

export function renderAgentCard(card,{state,esc,money}){
 if(!card)return '';
 if(card.type==='task_receipt'){const d=card.data,t=state.tasks?.find(t=>t.receipt===d.receipt&&t.status==='done');if(t?.kind==='planning'){const b=budgetReceiptFacts(state,t,{parameters:parameterFingerprint(t)});return `<section class="card operation-receipt"><h3>旅行预算已调整</h3>${b?`<p>${money(b.before_minor/100)} + ${money(b.delta_minor/100)}</p><strong class="amount money">${money(b.after_minor/100)}</strong>`:`<p>本次调增 ${money(t.amount)}</p><small>历史前后快照未保留</small>`}<small class="receipt">${esc(d.receipt)}</small></section>`;}return `<section class="card operation-receipt"><h3>${esc(d.title)}</h3><p>${esc(d.target)}</p>${d.amount?`<strong class="amount money">${money(d.amount)}</strong>`:''}<small class="receipt">${esc(d.receipt)}</small></section>`;}
 if(card.type==='clarification'){
  const draft=state.agentDraft?.id===card.draftId?state.agentDraft:state.agentDraftHistory?.[card.draftId];
  if(!draft||draft.status!=='awaiting_details'||state.agentDraft?.id===draft.id&&state.agentWorkspaceVisible!==false)return '';
  return `<button class="quiet" type="button" data-action="resume-agent-draft" data-draft="${esc(draft.id)}">继续填写</button>`;
 }
 const d=card.data;if(!d||card.type!=='fact')return '';
 const row=(label,value)=>`<div class="plan-row"><span>${esc(label)}</span><strong class="money">${value===null?'—':money(value/100)}</strong></div>`;
 let body='';
 if(d.query==='dining_month')body=`<div class="amount money">${money(d.amount_minor/100)}</div><p class="muted">${d.count} 笔餐饮支出</p>`;
 if(d.query==='spending_month')body=row('总支出',d.expense_minor)+row('退款',d.refund_minor)+row('净支出',d.net_expense_minor)+row('本月结余',d.net_cashflow_minor);
 if(d.query==='income_month')body=row('收入合计',d.income_minor)+(d.categories||[]).map(c=>row(c.category,c.amount_minor)).join('')+row('退款另列',d.refund_minor);
 if(d.query==='largest_category')body=(d.categories||[]).map(c=>row(c.category,c.amount_minor)).join('');
 if(d.query==='annual_trend'){
  const max=Math.max(1,...d.months.map(m=>m.expense_minor));const points=d.months.map((m,i)=>`${12+i*23.3},${82-m.expense_minor/max*66}`).join(' ');
  body=`<div class="agent-trend" role="img" aria-label="过去十二个完整月的支出趋势"><svg viewBox="0 0 280 90" aria-hidden="true"><polyline points="${points}" fill="none" stroke="var(--ap-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="agent-months">${d.months.map(m=>`<button type="button" data-action="agent-month" data-month="${m.period}" aria-label="查看${m.period}账本">${m.period.slice(5)}月</button>`).join('')}</div>${row('十二个月合计',d.total_expense_minor)}`;
 }
 if(d.query==='month_comparison')body=`<p class="muted">两个月均截至 ${d.through_day} 日</p>`+(d.categories||[]).slice(0,5).map(c=>`<div class="agent-comparison"><strong>${esc(c.category)}</strong><span>${money(c.previous_minor/100)} → ${money(c.amount_minor/100)}</span><strong class="money">${c.difference_minor>=0?'+':''}${money(c.difference_minor/100)}</strong></div>`).join('');
 if(d.query==='subscriptions')body=row('本月已扣',d.paid_minor)+row('下次周期计划',d.next_cycle_minor)+d.items.map(s=>`<div class="agent-subscription"><div class="row between"><strong>${esc(s.name)}</strong><span>${s.cancelled?'已取消下次续费':s.currentMinor!==s.previousMinor&&s.nextMinor===s.previousMinor?'标准套餐':'继续续费'}</span></div>${row('本期价格',s.currentMinor)}${s.currentMinor!==s.previousMinor?row('原价格',s.previousMinor):''}<small>${s.cancelled?'权益保留至':'下次续费'} ${esc(s.cancelled?s.rightsUntil:s.nextDate)}</small></div>`).join('');
 if(d.query==='large_expenses')body=d.rows.map(r=>`<div class="agent-ledger-row"><div><strong>${esc(r.title)}</strong><small>${esc(r.date)} ${esc(r.category)}</small></div><strong class="money">${money(r.amount_minor/100)}</strong></div>`).join('')||'<p>本月没有达到该门槛的支出。</p>';
 if(d.query==='available_cash')body=row('当前现金',d.cash_minor)+row('房租与生活费预留',d.reserve_minor)+row('可安排',d.available_minor)+(d.pending_transfer_minor?row('另有待确认转账计划',d.pending_transfer_minor):'');
 if(d.query==='holdings')body=d.available?row('持仓成本',d.cost_minor)+row('参考市值',d.market_value_minor)+row('持仓盈亏',d.pnl_minor)+`<small>历史收盘参考 ${esc(d.quote_as_of||'时点未提供')}</small>`:'<p>尚未取得持仓资料，请先打开投资页核对。</p>';
 if(d.query==='recent_task'){
  const e=d.entry;
  if(!d.available||!e)body='<p>还没有可核对的已完成回执。</p>';
  else{
   const source=SOURCES.find(s=>s.id===e.source_account);
   body=`<div class="plan-row"><span>安排</span><strong>${esc(e.target||'本次任务')}</strong></div>`+row(e.kind==='planning'?'旅行预算调增':'本次金额',e.amount_minor)+`<div class="plan-row"><span>状态</span><strong>已完成</strong></div>`;
   if(e.kind==='transfer')body+=`<div class="plan-row"><span>付款账户</span><strong>${esc(source?source.name+' '+source.suffix:e.source_account)}</strong></div><div class="plan-row"><span>日期</span><strong>${esc(e.scheduled_date)}</strong></div>`;
   if(e.kind==='planning')body+=(e.budget_result?row('调整前预算',e.budget_result.before_minor)+row('调整后预算',e.budget_result.after_minor):'<p>历史前后快照未保留。</p>')+'<p>预算调整，无现金扣款。</p>';
   if(e.kind==='subscription')body+=`<p>${esc({cancel:'仅取消了下次续费，本期权益保留，不是本期退款。',keep:'保留了当前订阅安排。',downgrade:'仅调整了下次续费套餐，本期权益不变。'}[e.subscription_action]||'请查看本次回执。')}</p>`;
   body+=`<div class="plan-row"><span>回执</span><strong class="receipt">${esc(e.receipt)}</strong></div><a class="quiet full" href="#/bot/task/${esc(e.task_id)}" data-action="open-agent-task" data-id="${esc(e.task_id)}">查看任务记录</a>`;
  }
 }
 const period=d.period||d.start&&`${d.start}—${d.end}`||d.as_of;
 const detail=['dining_month','spending_month','largest_category','large_expenses','income_month'].includes(d.query)?`<button class="quiet full" type="button" data-action="agent-ledger" data-query="${d.query}" data-month="${esc(d.period||'2026-11')}">查看账本</button>`:d.query==='holdings'?'<a class="quiet full" href="#/investment">查看投资</a>':'';
 return `<section class="card agent-fact" data-snapshot="${esc(d.snapshot_id)}"><div class="row between"><h3>${esc(d.title)}</h3><small>${esc(period||'')}</small></div>${body}${detail}</section>`;
}

export function renderActiveDraft(draft,{esc,busy=false}){
 if(!draft||draft.status!=='awaiting_details')return '';
 return `<section class="card agent-clarification"><h3>补充这次安排</h3><form id="agent-clarification-form" data-draft="${esc(draft.id)}" class="form"><fieldset class="form" ${busy?'disabled':''} style="border:0;padding:0;margin:0;min-width:0">${clarificationFields(draft,esc)}<p class="error-text" role="alert" id="draft-error"></p><button class="primary full" type="submit">继续</button></fieldset><button class="quiet full" type="button" data-action="cancel-agent-draft" data-draft="${esc(draft.id)}">取消这次安排</button></form></section>`;
}
