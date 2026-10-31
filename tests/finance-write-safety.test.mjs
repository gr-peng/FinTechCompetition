import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,createTask,transition} from '../web/engine.mjs';
import {ensureFinance,postOperation,syncFinance,ledgerView} from '../web/finance-state.mjs';
import {parameterFingerprint} from '../web/task-parameters.mjs';
import {acquireTaskExecution,commitTaskExecution} from '../web/task-safety.mjs';
import {lockSafety,beginRecovery,recoverSafety,DEMO_VERIFICATION_CODE,refreshTimedFreeze} from '../web/safety-policy.mjs';
import {verifyForTest,userConsent} from './safety-fixture.mjs';

function ready({kind='salary',commit=true}={}){
 const state=fresh();
 if(kind==='redemption'){state.openingInvestedMinor=300000;syncFinance(state);}
 const task=createTask(state,kind);
 transition(state,task.id,'grant');
 if(kind==='salary')transition(state,task.id,'edit',{amount:800});
 transition(state,task.id,'confirm',{source:userConsent,revision:task.revision,parameters:parameterFingerprint(task)});
 if(task.status==='verify')verifyForTest(state,task.id);
 const permit=acquireTaskExecution(state,task);
 task.receipt='FP-'+task.id.slice(0,8).toUpperCase();
 if(commit)commitTaskExecution(state,task,permit,task.receipt);
 return {state,task,permit};
}
function deniedWithoutMutation(state,task,pattern){
 const before=structuredClone(state);
 assert.throws(()=>postOperation(state,task),pattern);
 assert.deepEqual(state,before);
}
const rebindTask=task=>{task.approved=task.revision;task.approvedParameters=parameterFingerprint(task);};

test('raw finance write rejects receipts and public verification flags without policy execution proof',()=>{
 const state=fresh(),task=createTask(state,'salary');
 Object.assign(task,{status:'executing',granted:true,receipt:'FP-FORGED',safetyVerified:true,verified:true,verifiedRevision:task.revision});
 rebindTask(task);
 deniedWithoutMutation(state,task,/安全回执/);
 assert.equal(state.balance,50000);
 assert.equal(state.ledger.filter(row=>row.taskId===task.id).length,0);
});

test('pending policy permit cannot post before its independently completed receipt',()=>{
 const {state,task}=ready({commit:false});
 deniedWithoutMutation(state,task,/安全回执/);
});

for(const kind of ['salary','investment','redemption'])test(`${kind} posts once from a matching completed policy proof`,()=>{
 const {state,task}=ready({kind}),before=state.ledger.length,cash=state.balance,invested=state.invested;
 const row=postOperation(state,task);syncFinance(state);
 assert.equal(state.ledger.length,before+1);
 assert.equal(row.taskId,task.id);assert.equal(row.receipt,task.receipt);assert.equal(row.revision,task.revision);
 assert.equal(state.balance,cash+(kind==='redemption'?1:-1)*task.amount);
 assert.equal(state.invested,invested+(kind==='investment'?task.amount:kind==='redemption'?-task.amount:0));
 const snapshot=structuredClone(state);
 assert.strictEqual(postOperation(state,task),row);
 assert.deepEqual(state,snapshot);
});

for(const flag of ['paused','locked'])test(`new finance write is blocked while ${flag} even after policy completion`,()=>{
 const {state,task}=ready();
 if(flag==='paused')state.paused=true;else state.safety.locked=true;
 deniedWithoutMutation(state,task,/暂停|锁定/);
});

const taskChanges={
 id:t=>{t.id+='-other';},revision:t=>{t.revision++;},receipt:t=>{t.receipt='FP-OTHER';},
 amount:t=>{t.amount=801;},target:t=>{t.target='爸爸 尾号 4382';},kind:t=>{t.kind='investment';},
 payee:t=>{t.payeeId='dad';},sourceAccount:t=>{t.sourceAccount='living_1608';},currency:t=>{t.currency='USD';},
 date:t=>{t.scheduledDate='2026-11-03';},scope:t=>{t.scope='all_future';},cadence:t=>{t.cadence='monthly';},
 purpose:t=>{t.purpose='changed';},subscription:t=>{t.subscriptionId='music';},subscriptionAction:t=>{t.subscriptionAction='keep';},
 renewal:t=>{t.nextRenewalDate='2026-12-02';},subscriptionRevision:t=>{t.subscriptionRevision=2;},
 risk:t=>{t.riskFlags=['voice_mismatch'];},origin:t=>{t.agentOrigin=true;}
};
for(const [name,change] of Object.entries(taskChanges))test(`completed finance proof cannot be reused after ${name} changes`,()=>{
 const {state,task}=ready();change(task);rebindTask(task);
 deniedWithoutMutation(state,task,/安全回执/);
});

const proofChanges={
 executionId:(s,e)=>{e.id+='-other';},operationId:(s,e)=>{e.operationId='other';},
 executionStatus:(s,e)=>{e.status='failed';},binding:(s,e)=>{e.binding+='x';},
 snapshotTarget:(s,e)=>{e.snapshot.target='other';},snapshotAmount:(s,e)=>{e.snapshot.amountMinor++;},
 snapshotParameters:(s,e)=>{e.snapshot.parameters='{}';},snapshotScope:(s,e)=>{e.snapshot.scope.scope='all_future';},
 snapshotWrites:(s,e)=>{e.snapshot.writes=false;},snapshotSource:(s,e)=>{e.snapshot.source.kind='external';},
 resultStatus:(s,e)=>{e.result.status='pending';},resultReceipt:(s,e)=>{e.result.receipt='FP-OTHER';},
 resultTask:(s,e)=>{e.result.taskId='other';},resultRevision:(s,e)=>{e.result.revision++;},
 resultSource:(s,e)=>{e.result.source='llm';},resultExternal:(s,e)=>{e.result.external=true;},
 grantId:(s,e)=>{e.grantId='other';},grantStatus:(s,e)=>{s.safety.grants[e.grantId].status='revoked';},
 grantSource:(s,e)=>{s.safety.grants[e.grantId].source.kind='external';},
 grantSnapshot:(s,e)=>{s.safety.grants[e.grantId].snapshot.amountMinor++;},grantEpoch:(s,e)=>{s.safety.grants[e.grantId].epoch++;},
 grantExecution:(s,e)=>{s.safety.grants[e.grantId].executionId='other';},
 permitId:(s,e)=>{e.permitId=null;},epoch:(s,e)=>{s.safety.epoch++;}
};
for(const [name,change] of Object.entries(proofChanges))test(`new finance write rejects mismatched ${name} in the policy proof`,()=>{
 let {state,task}=ready();state=structuredClone(state);task=state.tasks.find(t=>t.id===task.id);
 const entry=state.safety.executions[task.id+':'+task.revision];change(state,entry);
 deniedWithoutMutation(state,task,/安全回执/);
});

test('password freeze and expiry cannot replay a pre-lock completed callback into a new row',()=>{
 const {state,task}=ready();
 lockSafety(state,'password_failures');
 assert.throws(()=>beginRecovery(state,{source:userConsent}),error=>error.code==='timed_freeze');
 refreshTimedFreeze(state,{now:state.safety.lock.expiresAt});
 assert.equal(state.safety.locked,false);
 deniedWithoutMutation(state,task,/安全回执/);
});

test('existing financial row is read-only and remains queryable during lock and pause',()=>{
 const {state,task}=ready();const row=postOperation(state,task);syncFinance(state);
 task.applied=true;task.status='done';task.granted=false;
 lockSafety(state);state.paused=true;
 const snapshot=structuredClone(state);
 assert.strictEqual(postOperation(state,task),row);
 assert.deepEqual(state,snapshot);
 ensureFinance(state);assert.equal(state.balance,49200);
 assert.equal(ledgerView(state).filter(r=>r.taskId===task.id).length,1);
});

for(const change of [t=>{t.kind='redemption';},t=>{t.revision++;},t=>{t.scheduledDate='2026-11-03';},t=>{t.sourceAccount='living_1608';},t=>{t.amount++;},t=>{t.receipt='FP-OTHER';}])test('read-only existing row lookup rejects inconsistent financial facts',()=>{
 const {state,task}=ready();postOperation(state,task);state.safety.locked=true;change(task);
 deniedWithoutMutation(state,task,/原流水不一致/);
});

const historicalTask=status=>({id:'old-transfer',key:'salary',kind:'transfer',amount:1800,revision:2,status,applied:true,receipt:'FP-OLD',logs:[]});
test('legacy done and applied receipt hydrates privately under lock without double debit',()=>{
 const state={version:1,paused:true,safety:{locked:true},tasks:[historicalTask('done')]};
 ensureFinance(state);const cash=state.balance,count=state.ledger.length;
 assert.equal(cash,48200);assert.equal(state.tasks[0].ledgerId,'operation:old-transfer');
 for(let i=0;i<3;i++)ensureFinance(state);
 assert.equal(state.balance,cash);assert.equal(state.ledger.length,count);
 assert.equal(state.ledger.filter(r=>r.receipt==='FP-OLD').length,1);
});

for(const status of ['permission','review','verify','executing','unknown','cancelled','paused','blocked'])test(`legacy ${status} marker never restores a money movement`,()=>{
 const state={version:1,tasks:[historicalTask(status)]};
 ensureFinance(state);assert.equal(state.balance,50000);
 assert.equal(state.ledger.some(r=>r.taskId==='old-transfer'),false);
});

test('legacy done record without both applied and a receipt is not financial history',()=>{
 for(const patch of [{applied:false},{receipt:null},{receipt:''}]){
  const state={tasks:[{...historicalTask('done'),...patch}]};
  ensureFinance(state);assert.equal(state.balance,50000);
  assert.equal(state.ledger.some(r=>r.taskId==='old-transfer'),false);
 }
});

test('initialized save cannot turn forged done/applied flags into legacy hydration permission',()=>{
 const state=fresh();state.tasks.push(historicalTask('done'));
 const ledger=structuredClone(state.ledger);
 assert.throws(()=>ensureFinance(state),/安全回执/);
 assert.deepEqual(state.ledger,ledger);assert.equal(state.balance,50000);
});

test('genuine completed current receipt restores missing saved history after lock without replaying its execution',()=>{
 const {state,task}=ready();postOperation(state,task);task.applied=true;task.status='done';task.granted=false;syncFinance(state);
 const before=state.balance,proof=structuredClone(state.safety.executions[task.id+':'+task.revision]);
 state.ledger=state.ledger.filter(r=>r.taskId!==task.id);lockSafety(state);state.paused=true;
 const auditCount=state.safety.audit.length;
 ensureFinance(state);ensureFinance(state);
 assert.equal(state.balance,before);assert.equal(state.ledger.filter(r=>r.taskId===task.id).length,1);
 assert.deepEqual(state.safety.executions[task.id+':'+task.revision],proof);
 assert.equal(state.safety.audit.length,auditCount);
});

test('nonfinancial tasks produce no ledger entry through the money writer',()=>{
 const state=fresh(),task=createTask(state,'refund'),before=structuredClone(state);
 assert.equal(postOperation(state,task),null);assert.deepEqual(state,before);
});
