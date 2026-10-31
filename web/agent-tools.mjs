import {MAX_AMOUNT_MINOR} from './limits.mjs';
import {budgetReceiptFacts} from './budget-result.mjs';
import {ensureFinance,financialFacts,STORY_DATE} from './finance-state.mjs';

export const DEMO_AS_OF=STORY_DATE;
export const DEMO_TIMEZONE='Asia/Shanghai';
export const QUESTION_CATALOG=[
 {id:'dining_month',question:'我这个月吃饭花了多少钱？',title:'本月餐饮',view:'amount'},
 {id:'spending_month',question:'我这个月总共花了多少，退款和净支出分别是多少？',title:'本月收支',view:'summary'},
 {id:'annual_trend',question:'看看过去一年的每月花费趋势。',title:'过去十二个完整月',view:'trend'},
 {id:'month_comparison',question:'这个月比上个月同期多花在哪？',title:'与上月同期对比',view:'comparison'},
 {id:'largest_category',question:'这个月花得最多的是哪一类？',title:'支出分类',view:'categories'},
 {id:'income_month',question:'这个月收入从哪里来，退款算收入吗？',title:'收入来源',view:'income'},
 {id:'subscriptions',question:'这个月订阅扣了多少，哪个涨价了？',title:'订阅扣费',view:'subscriptions'},
 {id:'large_expenses',question:'这个月有哪些一千元以上的支出？',title:'大额支出',view:'list'},
 {id:'available_cash',question:'留够房租和生活费后，我还有多少钱可以安排？',title:'可安排资金',view:'reserve'},
 {id:'holdings',question:'我的持仓成本、市值和盈亏是多少？',title:'持仓快照',view:'holdings'},
 {id:'recent_task',question:'解释一下刚才完成的安排，不要创建或执行新操作。',title:'已完成的安排',view:'receipt'}
];
export const SUBSCRIPTIONS=[{id:'video',name:'映像会员',currentMinor:6800,previousMinor:2800,nextDate:'2026-11-25',rightsUntil:'2026-11-25'},
 {id:'cloud',name:'云空间',currentMinor:1800,previousMinor:1800,nextDate:'2026-11-10',rightsUntil:'2026-11-10'},
 {id:'music',name:'回声音乐',currentMinor:1500,previousMinor:1500,nextDate:'2026-11-18',rightsUntil:'2026-11-18'}];
export const CONTACTS=[{id:'mom',name:'妈妈',suffix:'6821'},{id:'dad',name:'爸爸',suffix:'4382'}];
export const SOURCES=[{id:'salary_0826',name:'工资账户',suffix:'0826'},{id:'living_1608',name:'生活账户',suffix:'1608'}];
export const monthOffset=(month,delta)=>{const [year,m]=month.split('-').map(Number);return new Date(Date.UTC(year,m-1+delta,1)).toISOString().slice(0,7);};
export const cashflowRows=rows=>rows.filter(r=>!['principal','internal_transfer'].includes(r.movement));
const minor=value=>{if(typeof value==='number')return Math.round(value*100);if(!/^\d+(\.\d{1,2})?$/.test(String(value??'')))return null;const [whole,fraction='']=String(value).split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null;};
const sortedCategories=rows=>[...rows.reduce((m,r)=>{if(r.direction==='expense')m.set(r.category,(m.get(r.category)||0)+r.amountMinor);return m;},new Map())].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN')).map(([category,amount_minor])=>({category,amount_minor}));
const snapshotHash=value=>{let h=2166136261;for(const c of JSON.stringify(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);};
export function completedTaskFacts(state){
 const entries=[];
 for(const entry of Object.values(state.executions||{})){
  const task=state.tasks.find(t=>t.id===entry.task_id);
  if(!task||task.status!=='done'||!task.applied||entry.status!=='completed'||task.revision!==entry.revision||!entry.receipt||entry.receipt!==task.receipt)continue;
  try{
   const p=JSON.parse(entry.parameters);if(!p||typeof p!=='object'||!Number.isSafeInteger(p.amount_minor)||p.amount_minor<0)continue;
   const budget=task.kind==='planning'?budgetReceiptFacts(state,task,{parameters:entry.parameters}):null;if(task.kind==='planning'&&entry.budget_result&&!budget)continue;
   entries.push({task_id:task.id,receipt:entry.receipt,revision:entry.revision,completed_at:entry.completed_at||0,kind:p.kind,amount_minor:p.amount_minor,target:p.target,currency:p.currency,source_account:p.source_account,payee_id:p.payee_id,scheduled_date:p.scheduled_date,subscription_id:p.subscription_id,subscription_action:p.subscription_action,...(task.kind==='planning'?{budget_result:budget}:{})});
  }catch{}
 }
 return entries.sort((a,b)=>b.completed_at-a.completed_at||a.task_id.localeCompare(b.task_id)).slice(0,12);
}

export function buildAgentFacts(state,positions=null,month=STORY_DATE.slice(0,7)){
 ensureFinance(state);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('查询月份无效');
 const current=financialFacts(state,month),previous=financialFacts(state,monthOffset(month,-1));
 const rows=cashflowRows(current.rows),previousRows=cashflowRows(previous.rows);
 const day=Number(STORY_DATE.slice(-2));
 const sameDayRows=rows.filter(r=>Number(r.date.slice(-2))<=day),priorSameDay=previousRows.filter(r=>Number(r.date.slice(-2))<=day);
 const currentCategories=sortedCategories(sameDayRows),priorCategories=new Map(sortedCategories(priorSameDay).map(x=>[x.category,x.amount_minor]));
 const differences=currentCategories.map(x=>({...x,previous_minor:priorCategories.get(x.category)||0,difference_minor:x.amount_minor-(priorCategories.get(x.category)||0)})).sort((a,b)=>b.difference_minor-a.difference_minor||a.category.localeCompare(b.category,'zh-CN'));
 const months=Array.from({length:12},(_,i)=>monthOffset(STORY_DATE.slice(0,7),i-12));
 const annual=months.map(period=>{const f=financialFacts(state,period);return {period,expense_minor:f.expenseMinor,refund_minor:f.refundMinor,net_expense_minor:f.netExpenseMinor,income_minor:f.incomeMinor};});
 const incomeGroups=[...rows.reduce((m,r)=>{if(r.direction==='income'&&r.category!=='退款')m.set(r.category,(m.get(r.category)||0)+r.amountMinor);return m;},new Map())].map(([category,amount_minor])=>({category,amount_minor})).sort((a,b)=>b.amount_minor-a.amount_minor);
 const subscriptionRows=SUBSCRIPTIONS.map(s=>({...s,cancelled:state.subscriptionStates?.[s.id]?.cancelled??(s.id==='video'&&!!state.subscriptionCancelled),nextMinor:state.subscriptionStates?.[s.id]?.tier==='standard'||s.id==='video'&&state.subscriptionTier==='standard'?s.previousMinor:s.currentMinor}));
 const subscriptionsPaid=rows.filter(r=>r.category==='订阅').reduce((n,r)=>n+(r.direction==='expense'?r.amountMinor:-r.amountMinor),0);
 const budgetTotal=state.nativeBudget?.[month]?.total_minor??(month==='2026-11'?800000:null);
 const queries={
  dining_month:{title:'本月餐饮',amount_minor:rows.filter(r=>r.category==='餐饮'&&r.direction==='expense').reduce((n,r)=>n+r.amountMinor,0),count:rows.filter(r=>r.category==='餐饮'&&r.direction==='expense').length,period:month,category:'餐饮'},
  spending_month:{title:'本月收支',expense_minor:current.expenseMinor,refund_minor:current.refundMinor,net_expense_minor:current.netExpenseMinor,income_minor:current.incomeMinor,net_cashflow_minor:current.netCashflowMinor,period:month},
  annual_trend:{title:'过去十二个完整月',start:months[0]+'-01',end:monthOffset(STORY_DATE.slice(0,7),-1)+'-'+new Date(Number(STORY_DATE.slice(0,4)),Number(STORY_DATE.slice(5,7))-1,0).getDate(),months:annual,total_expense_minor:annual.reduce((n,m)=>n+m.expense_minor,0)},
  month_comparison:{title:'与上月同期对比',period:month,previous_period:monthOffset(month,-1),through_day:day,scope:'截至故事当日，与上月相同日数比较，不与上月整月混比',categories:differences},
  largest_category:{title:'支出分类',period:month,categories:sortedCategories(rows)},
  income_month:{title:'收入来源',period:month,income_minor:current.incomeMinor,refund_minor:current.refundMinor,categories:incomeGroups},
  subscriptions:{title:'订阅扣费',period:month,paid_minor:subscriptionsPaid,next_cycle_minor:subscriptionRows.filter(s=>!s.cancelled).reduce((n,s)=>n+s.nextMinor,0),items:subscriptionRows,source:'本月扣费来自账本；价差与下次续费来自合成订阅合同快照，不包含使用频率推断'},
  large_expenses:{title:'大额支出',period:month,threshold_minor:100000,rows:rows.filter(r=>r.direction==='expense'&&r.amountMinor>=100000).sort((a,b)=>b.amountMinor-a.amountMinor||a.id.localeCompare(b.id)).map(r=>({id:r.id,title:r.title,date:r.date,category:r.category,amount_minor:r.amountMinor}))},
  available_cash:{title:'可安排资金',cash_minor:current.cashMinor,reserve_minor:800000,available_minor:Math.max(0,current.cashMinor-800000),travel_plan_minor:Math.round((state.travelBudget??3000)*100),pending_transfer_minor:state.tasks.filter(t=>t.kind==='transfer'&&!['done','cancelled'].includes(t.status)).reduce((n,t)=>n+Math.round(t.amount*100),0),single_transfer_limit_minor:MAX_AMOUNT_MINOR,period:month,budget_total_minor:budgetTotal,budget_remaining_minor:budgetTotal===null?null:budgetTotal-current.netExpenseMinor},
  holdings:{title:'持仓快照',available:false,reason:'尚未读取持仓，不把未知金额当作零'},
  recent_task:{title:'已完成的安排',entries:completedTaskFacts(state),reference_id:state.agentFocus||null}
 };
 if(positions&&Array.isArray(positions.holdings)&&minor(positions.total_cost)!==null){
  const cost=minor(positions.total_cost),market=positions.quote_quality==='unavailable'?null:minor(positions.market_value??positions.total_market_value);
  queries.holdings={title:'持仓快照',available:true,cost_minor:cost,market_value_minor:market,pnl_minor:market===null?null:market-cost,count:positions.holdings.length,quote_as_of:positions.holdings.map(r=>r.quote_as_of||r.as_of).filter(Boolean).sort()[0]||null,quote_quality:positions.quote_quality||'unavailable',source:'本地持仓与带时点的历史收盘参考，非实时交易报价'};
 }
 const facts={schema:1,dataset_id:'finpilot-ledger-13m-v1+current-v2',as_of:STORY_DATE,timezone:DEMO_TIMEZONE,selected_month:month,queries,contacts:CONTACTS,source_accounts:SOURCES,currency:'CNY'};
 facts.snapshot_id='fp-'+snapshotHash([facts.as_of,month,queries]);
 return facts;
}

export function providerToolContext(facts){
 // No complete ledger, bill notes, API material, IDs of private files or browser data.
 const clean=structuredClone(facts);
 clean.queries.large_expenses.rows=clean.queries.large_expenses.rows.map(({date,category,amount_minor})=>({date,category,amount_minor}));
 return clean;
}
export function questionResult(facts,id,fields={}){if(!QUESTION_CATALOG.some(q=>q.id===id))throw Error('未知只读工具');let data=facts.queries[id];if(id==='recent_task'){const kind={travel:'planning',family:'transfer',cash:'investment'}[fields.purpose],entries=data.entries.filter(e=>!kind||e.kind===kind);const entry=entries.find(e=>e.task_id===data.reference_id)||entries[0]||null;data={title:data.title,available:!!entry,entry};}return structuredClone({...data,query:id,snapshot_id:facts.snapshot_id,as_of:facts.as_of,timezone:facts.timezone});}
