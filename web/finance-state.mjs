// One local financial source. All amounts are integer fen; no bank connector.
import {HISTORY_ROWS,HISTORY_VERSION} from './history-ledger.mjs';
import {MAX_AMOUNT_MINOR} from './limits.mjs';
export const STORY_DATE='2026-11-02';
export const FINANCE_SCHEMA=2;
const seed=[
 ['salary','2026-11-02','工资入账','工资',1580000,'income','wallet'],
 ['refund','2026-11-02','购物退款','退款',35660,'income','wallet'],
 ['breakfast','2026-11-02','早餐与咖啡','餐饮',3200,'expense','receipt'],
 ['rent','2026-11-01','住房租金','住房',350000,'expense','home'],
 ['subscription','2026-11-01','视频会员','订阅',6800,'expense','card'],
 ['transport','2026-11-02','地铁与打车','出行',16466,'expense','plane'],
 ['lunch','2026-11-02','工作日午餐','餐饮',3791,'expense','receipt'],
 ['dinner','2026-11-02','家庭聚餐','餐饮',180309,'expense','receipt'],
 ['shopping','2026-11-02','生活用品','购物',159962,'expense','wallet'],
 ['utilities','2026-11-02','水电与日用品','其他',28183,'expense','home']
];
export const seedLedger=()=>seed.map(([id,date,title,category,amountMinor,direction,icon],i)=>({id:'seed:'+id,date,title,category,amountMinor,direction,icon,movement:'cashflow',order:i,taskId:null,receipt:null}));
const cashDelta=r=>r.movement==='internal_transfer'?0:(r.direction==='income'?1:-1)*r.amountMinor;
const finiteMinor=(v,fallback)=>Number.isSafeInteger(v)?v:fallback;
const moneyKinds=new Set(['transfer','investment','redemption']);
const validReceipt=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const stable=value=>Array.isArray(value)?value.map(stable):plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const canonical=value=>JSON.stringify(stable(value));
// Keep this private projection in step with taskParameters. Importing that module
// here creates finance -> task-parameters -> agent-tools -> finance during startup.
// Exact key/string matching fails closed when that contract gains a new field.
function operationParameters(t){return {
 amount_minor:Math.round((t.amount||0)*100),cadence:t.cadence||'once',currency:t.currency||'CNY',kind:t.kind,
 payee_id:t.payeeId||((t.key==='salary')?'mom':null),purpose:t.purpose||null,scheduled_date:t.scheduledDate||STORY_DATE,
 scope:t.scope||'next_renewal',source_account:t.sourceAccount||'salary_0826',subscription_action:t.subscriptionAction||'cancel',
 subscription_id:t.subscriptionId||'video',next_renewal:t.nextRenewalDate||null,subscription_revision:t.subscriptionRevision||1,
 target:t.target||'',risk_flags:[...(t.riskFlags||[])].sort()
};}
function operationSnapshot(t){
 const p=operationParameters(t),aliases={email:'mail',document:'report',attachment:'external',webpage:'external',third_party:'external','third-party':'external'},supplied=t.proposalSource||(t.agentOrigin?'llm':'program'),source=aliases[supplied]||supplied;
 return {id:t.id,revision:t.revision,kind:t.kind,target:p.target,amountMinor:p.amount_minor,currency:p.currency,parameters:JSON.stringify(p),scope:{taskId:t.id,action:t.kind,sourceAccount:p.source_account,payeeId:p.payee_id,scope:p.scope},scheduledAt:null,riskFlags:[...new Set(t.riskFlags||[])].sort(),source:{kind:['user','program','preset','llm','external','mail','report','voice','system'].includes(source)?source:'unknown'},writes:true};
}
function assertCompletedPolicyProof(state,t,{historical=false}={}){
 const invalid=()=>{throw Error('财务写入缺少与当前任务匹配的已完成安全回执');};
 const safety=state.safety,snapshot=operationSnapshot(t),binding=canonical(snapshot),executionId=t.id+':'+t.revision;
 const entry=safety?.executions?.[executionId],result=entry?.result,grant=safety?.grants?.[entry?.grantId];
 if(!plain(safety)||safety.version!==1||!Number.isSafeInteger(safety.epoch)||safety.epoch<0||typeof safety.locked!=='boolean')invalid();
 if(!Number.isSafeInteger(t.revision)||t.revision<1||typeof t.id!=='string'||!validReceipt(t.receipt))invalid();
 if(!Number.isSafeInteger(snapshot.amountMinor)||snapshot.amountMinor<=0||snapshot.amountMinor>MAX_AMOUNT_MINOR||!Number.isFinite(t.amount)||Math.abs(t.amount*100-snapshot.amountMinor)>.000001)invalid();
 if(snapshot.currency!=='CNY'||!['salary_0826','living_1608'].includes(snapshot.scope.sourceAccount))invalid();
 if(t.approved!==t.revision||t.approvedParameters!==snapshot.parameters)invalid();
 if(!historical&&(!['executing','unknown'].includes(t.status)||t.granted!==true||t.applied===true))invalid();
 if(!plain(entry)||entry.id!==executionId||entry.operationId!==t.id||entry.status!=='completed'||!validReceipt(entry.permitId))invalid();
 if(entry.binding!==binding||canonical(entry.snapshot)!==binding)invalid();
 if(!Number.isSafeInteger(entry.epoch)||entry.epoch<0||entry.epoch>safety.epoch||(!historical&&entry.epoch!==safety.epoch))invalid();
 const expectedResult={status:'completed',receipt:t.receipt,source:'local_adapter',external:false,taskId:t.id,revision:t.revision};
 if(!plain(result)||canonical(result)!==canonical(expectedResult))invalid();
 if(!plain(grant)||grant.id!==t.safetyGrantId||entry.grantId!==t.safetyGrantId||grant.operationId!==t.id||grant.executionId!==executionId)invalid();
 if(grant.status!=='completed'||grant.source?.kind!=='user'||grant.epoch!==entry.epoch||grant.binding!==binding||canonical(grant.snapshot)!==binding)invalid();
 return entry;
}
export function operationEntry(t,order){
 const amountMinor=Math.round(t.amount*100);
 if(!moneyKinds.has(t.kind))return null;
 if(!Number.isSafeInteger(amountMinor)||amountMinor<=0)throw Error('操作金额无效');
 const map={transfer:['给妈妈转账','人情往来','expense','cashflow','user'],investment:['申购灵活现金','理财本金','expense','principal','invest'],redemption:['赎回灵活现金','理财本金','income','principal','invest']};
 let [title,category,direction,movement,icon]=map[t.kind];if(t.kind==='transfer')title='给'+(t.payeeName||(t.payeeId==='dad'?'爸爸':'妈妈'))+'转账';
 return {id:'operation:'+t.id,date:t.scheduledDate||STORY_DATE,title,category,direction,movement,icon,accountLabel:t.sourceAccount==='living_1608'?'生活账户 1608':'工资账户 0826',payment_method:'银行转账',amountMinor,order,taskId:t.id,receipt:t.receipt,kind:t.kind,revision:t.revision};
}
function matchingOperationRow(state,t){
 const row=state.ledger.find(r=>r.id==='operation:'+t.id);if(!row)return null;
 const expected=operationEntry(t,row.order);
 if(!expected||Object.keys(expected).some(key=>row[key]!==expected[key])||t.ledgerId!==undefined&&t.ledgerId!==row.id)throw Error('回执与原流水不一致');
 return row;
}
function insertOperation(state,t){const row=operationEntry(t,state.ledger.length);if(row){state.ledger.push(row);t.ledgerId=row.id;}return row;}
export function postOperation(state,t){
 if(!Array.isArray(state.ledger))throw Error('财务数据尚未初始化');
 const existing=matchingOperationRow(state,t);if(existing)return existing;
 if(!moneyKinds.has(t.kind))return null;
 if(state.paused)throw Error('伙伴已暂停，不能写入新流水');
 if(state.safety?.locked)throw Error('安全锁定中，不能写入新流水');
 assertCompletedPolicyProof(state,t);
 return insertOperation(state,t);
}
// Hydration is not a write permission. Only completed historical receipts may be
// restored, and initialized saves additionally need their original policy proof.
// Old epochs/locks do not erase money movements that already happened.
function restoreHistoricalOperation(state,t,legacy){
 if(t.status!=='done'||t.applied!==true||!validReceipt(t.receipt)||!moneyKinds.has(t.kind))return;
 if(matchingOperationRow(state,t))return;
 if(!legacy)assertCompletedPolicyProof(state,t,{historical:true});
 insertOperation(state,t);
}
export function ensureFinance(state){
 const legacy=state.financeSchema===undefined||Number.isSafeInteger(state.financeSchema)&&state.financeSchema<FINANCE_SCHEMA;
 if(!Array.isArray(state.ledger)){
  state.ledger=seedLedger();state.openingCashMinor=4133051;state.openingInvestedMinor=0;
  // Upgrade old completed fixtures from their existing receipts, never debit twice.
  for(const t of [...(state.tasks||[])].reverse())restoreHistoricalOperation(state,t,legacy);
  state.financeSchema=FINANCE_SCHEMA;
 }
 state.financeSchema=FINANCE_SCHEMA;
 state.openingCashMinor=finiteMinor(state.openingCashMinor,4133051);
 state.openingInvestedMinor=finiteMinor(state.openingInvestedMinor,0);
 if(state.ledgerHistoryVersion!==HISTORY_VERSION){
  // The opening cash is an as-of balance, not an opening before the recovered
  // year. Preserve today's cash exactly; older history must not be counted twice.
  const before=state.openingCashMinor+state.ledger.reduce((n,r)=>n+(!state.openingCashAsOf||r.date>=state.openingCashAsOf?cashDelta(r):0),0);
  const ids=new Set(state.ledger.map(r=>r.id));
  const fingerprint=r=>[r.date,r.title,r.category,r.amountMinor,r.direction].join('|');
  const existing=new Set(state.ledger.map(fingerprint));
  for(const [id,date,title,category,amountMinor,direction,movement,payment_method,accountLabel] of HISTORY_ROWS){
   const row={id,date,title,category,amountMinor,direction,movement,payment_method,accountLabel,source:'synthetic',icon:'receipt',order:state.ledger.length,taskId:null,receipt:null};
   if(!ids.has(id)&&!existing.has(fingerprint(row))){state.ledger.push(row);ids.add(id);}
  }
  state.openingCashAsOf='2026-11-01';
  state.openingCashMinor=before-state.ledger.reduce((n,r)=>n+(r.date>=state.openingCashAsOf?cashDelta(r):0),0);
  state.ledgerHistoryVersion=HISTORY_VERSION;
 }
 for(const t of state.tasks||[])restoreHistoricalOperation(state,t,legacy);
 return syncFinance(state);
}
export function syncFinance(state){
 if(!Array.isArray(state.ledger))return ensureFinance(state);
 let cash=state.openingCashMinor,invested=state.openingInvestedMinor,spent=0;
 for(const row of state.ledger){
  if(!Number.isSafeInteger(row.amountMinor)||row.amountMinor<0)throw Error('流水金额格式无效');
  if(!state.openingCashAsOf||row.date>=state.openingCashAsOf)cash+=cashDelta(row);
  if(row.kind==='investment')invested+=row.amountMinor;
  if(row.kind==='redemption')invested-=row.amountMinor;
  if(row.kind==='transfer'&&row.date===STORY_DATE)spent+=row.amountMinor;
 }
 state.balance=cash/100;state.invested=invested/100;state.spent=spent/100;
 return state;
}
export function financialFacts(state,month='2026-11'){
 ensureFinance(state);
 const rows=state.ledger.filter(r=>r.date.startsWith(month));
 let incomeMinor=0,expenseMinor=0,refundMinor=0,principalInMinor=0,principalOutMinor=0;
 const categories=new Map(),daily=new Map();
 for(const row of rows){
  if(row.movement==='internal_transfer')continue;
  if(row.movement==='principal'){if(row.direction==='income')principalInMinor+=row.amountMinor;else principalOutMinor+=row.amountMinor;continue;}
  if(row.direction==='income'){if(row.category==='退款')refundMinor+=row.amountMinor;else incomeMinor+=row.amountMinor;}
  else{expenseMinor+=row.amountMinor;categories.set(row.category,(categories.get(row.category)||0)+row.amountMinor);const day=Number(row.date.slice(-2));daily.set(day,(daily.get(day)||0)+row.amountMinor);}
 }
 const [year,monthNumber]=month.split('-').map(Number);
 let cumulative=0;const days=Array.from({length:new Date(year,monthNumber,0).getDate()},(_,i)=>{cumulative+=daily.get(i+1)||0;return cumulative;});
 return {incomeMinor,expenseMinor,refundMinor,netExpenseMinor:expenseMinor-refundMinor,netCashflowMinor:incomeMinor+refundMinor-expenseMinor,principalInMinor,principalOutMinor,cashMinor:Math.round(state.balance*100),investedMinor:Math.round(state.invested*100),categories:[...categories].sort((a,b)=>b[1]-a[1]),days,rows};
}
export function ledgerView(state){ensureFinance(state);return [...state.ledger].sort((a,b)=>b.date.localeCompare(a.date)||b.order-a.order);}
