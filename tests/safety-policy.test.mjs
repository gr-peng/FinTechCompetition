import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DEMO_VERIFICATION_CODE,SAFETY_DEFAULTS,SafetyError,ensureSafety,classifyOperation,authorizeSafety,
 beginChallenge,verifyChallenge,validateGrant,getSafetyGrant,acquireExecution,validatePermit,commitExecution,
 failExecution,recordSafetySignal,lockSafety,invalidateSafetyEpoch,revokeOperation,getSafetyChallenge,beginRecovery,recoverSafety,auditSafety,refreshTimedFreeze,PASSWORD_FREEZE_MS,
} from '../web/safety-policy.mjs';

const NOW=Date.parse('2026-11-02T09:00:00+08:00');
const USER={kind:'user',method:'click'};
const state=()=>({ledger:[],paused:false});
const operation=(extra={})=>({id:'transfer-one',revision:1,kind:'transfer',target:'妈妈 6821',amountMinor:50000,currency:'CNY',
 parameters:JSON.stringify({amount_minor:50000,payee_id:'mom',source_account:'salary_0826',scheduled_date:'2026-11-02'}),
 scope:{action:'transfer',account:'salary_0826',payee:'mom'},scheduledAt:'2026-11-02T09:00:00+08:00',...extra});
const errorCode=code=>error=>error instanceof SafetyError&&error.code===code;
const consent=(s,op,options={})=>authorizeSafety(s,op,{source:USER,now:NOW,...options});
const permit=(s,op,grant,executionId='execution-one',options={})=>acquireExecution(s,op,{grantId:grant.id,executionId,now:NOW,...options});

test('yellow new-recipient password is a real challenge, not a typed claim or green confirmation',()=>{
 const s=state(),op=operation({amountMinor:30000,riskFlags:['new_recipient']}),risk=classifyOperation(s,op,{now:NOW});
 assert.equal(DEMO_VERIFICATION_CODE,'123456');assert.equal(risk.level,'yellow');assert.equal(risk.requiresVerification,true);
 for(let i=0;i<3;i++)recordSafetySignal(s,{kind:'password_failure',source:{kind:'llm'}},{now:NOW+i});
 assert.equal(s.safety.locked,false);assert.equal(s.safety.failures.password,0);
 const grant=consent(s,op),challenge=beginChallenge(s,op,{grantId:grant.id,now:NOW});
 assert.equal(challenge.level,'yellow');assert.equal(challenge.method,'local-demo-password');
 assert.throws(()=>permit(s,op,grant),errorCode('verification_required'));
 for(let i=1;i<=2;i++){const result=verifyChallenge(s,{challengeId:challenge.id,code:'000000',source:USER,now:NOW+i});assert.equal(result.ok,false);assert.equal(s.safety.locked,false);assert.equal(s.safety.failures.password,i);}
 verifyChallenge(s,{challengeId:challenge.id,code:'000000',source:USER,now:NOW+3});assert.equal(s.safety.locked,true);
 assert.equal(s.safety.lock.reason,'password_failures');assert.throws(()=>verifyChallenge(s,{challengeId:challenge.id,code:DEMO_VERIFICATION_CODE,source:USER,now:NOW+4}),errorCode('invalid_challenge'));
});

test('correct demo password clears consecutive failures, but changed amount invalidates authority',()=>{
 const s=state(),op=operation({riskFlags:['new_recipient']}),grant=consent(s,op),challenge=beginChallenge(s,op,{grantId:grant.id,now:NOW});
 verifyChallenge(s,{challengeId:challenge.id,code:'000000',source:USER,now:NOW+1});
 assert.equal(verifyChallenge(s,{challengeId:challenge.id,code:DEMO_VERIFICATION_CODE,source:USER,now:NOW+2}).ok,true);
 assert.equal(s.safety.failures.password,0);assert.equal(s.safety.failures.consecutive,0);
 const changed=operation({riskFlags:['new_recipient'],amountMinor:50001,revision:2});
 assert.throws(()=>validateGrant(s,changed,{grantId:grant.id,now:NOW+3}),errorCode('stale_binding'));
 assert.equal(validateGrant(s,op,{grantId:grant.id,now:NOW+3}).status,'ready');
});

test('critical operation evidence locks and cannot be washed away by a password',()=>{
 for(const flag of ['reported_scam','prompt_injection','external_authorization']){
  const s=state(),op=operation({riskFlags:[flag]});assert.throws(()=>consent(s,op),errorCode('risk_blocked'));assert.equal(s.safety.locked,true);
  const recovery=beginRecovery(s,{source:USER,now:NOW+1});recoverSafety(s,{challengeId:recovery.id,source:USER,code:DEMO_VERIFICATION_CODE,now:NOW+2});
  assert.throws(()=>consent(s,op,{now:NOW+3}),errorCode('risk_blocked'));assert.equal(s.safety.locked,true);assert.equal(Object.keys(s.safety.executions).length,0);
 }
 const s=state(),unknown=operation({riskFlags:['unverified_recipient']});assert.throws(()=>consent(s,unknown),errorCode('risk_blocked'));assert.equal(s.safety.locked,false);
});
function verifiedGrant(s,op,options={}){
 const grant=consent(s,op,options),challenge=beginChallenge(s,op,{grantId:grant.id,now:NOW});
 const proof=verifyChallenge(s,{challengeId:challenge.id,code:DEMO_VERIFICATION_CODE,source:USER,now:NOW+1});
 assert.equal(proof.ok,true);
 return {grant,challenge,proof};
}

test('third actual yellow password failure invalidates already in-flight writes and recovery never replays them',()=>{
 const s=state(),old=operation(),oldGrant=consent(s,old),ticket=permit(s,old,oldGrant,'old-in-flight');
 const next=operation({id:'new-payee',amountMinor:30000,riskFlags:['new_recipient']}),grant=consent(s,next),challenge=beginChallenge(s,next,{grantId:grant.id,now:NOW});
 for(let i=1;i<=3;i++)verifyChallenge(s,{challengeId:challenge.id,code:'000000',source:USER,now:NOW+i});
 assert.equal(s.safety.executions[ticket.executionId].status,'interrupted');
 assert.throws(()=>commitExecution(s,ticket,{status:'completed',receipt:'late-receipt'},{now:NOW+4}),errorCode('epoch_changed'));
 assert.throws(()=>beginRecovery(s,{source:USER,now:NOW+5}),errorCode('timed_freeze'));
 const result=refreshTimedFreeze(s,{now:s.safety.lock.expiresAt});
 assert.equal(result.automaticReplay,false);assert.equal(result.requiresReauthorization,true);
 assert.throws(()=>validateGrant(s,old,{grantId:oldGrant.id,now:NOW+7}),errorCode('epoch_changed'));
 assert.equal(s.ledger.length,0);
});

test('cancelling or refreshing a yellow challenge prevents its former password submission',()=>{
 for(const invalidate of [(s,op)=>revokeOperation(s,op.id,{now:NOW+1}),s=>invalidateSafetyEpoch(s,'page_reloaded',{now:NOW+1})]){
  const s=state(),op=operation({riskFlags:['new_recipient']}),grant=consent(s,op),challenge=beginChallenge(s,op,{grantId:grant.id,now:NOW});invalidate(s,op);
  assert.throws(()=>verifyChallenge(s,{challengeId:challenge.id,source:USER,code:DEMO_VERIFICATION_CODE,now:NOW+2}),errorCode('invalid_challenge'));
  assert.equal(Object.keys(s.safety.executions).length,0);
 }
});

test('green queries need no grant while known writes cannot label themselves read-only',()=>{
 const s=state(),query=operation({id:'query-one',kind:'query',amountMinor:0,parameters:'{}',writes:false});
 assert.equal(classifyOperation(s,query,{now:NOW}).level,'green');
 const ticket=acquireExecution(s,query,{executionId:'read-one',now:NOW});
 commitExecution(s,ticket,{status:'completed',value:12},{now:NOW+1});
 assert.equal(s.safety.executions['read-one'].result.value,12);
 assert.equal(Object.keys(s.safety.grants).length,0);
 assert.equal(classifyOperation(s,operation({writes:false}),{now:NOW}).level,'green');
 assert.equal(classifyOperation(s,operation({writes:false}),{now:NOW}).writes,true);
 assert.throws(()=>acquireExecution(s,operation({writes:false}),{executionId:'write-without-confirm',now:NOW}),errorCode('authorization_required'));
});

test('the 1000 yuan threshold and same-date transfer history classify independently of consent',()=>{
 const s=state();
 assert.equal(classifyOperation(s,operation({amountMinor:100000}),{now:NOW}).level,'green');
 assert.equal(classifyOperation(s,operation({amountMinor:100001}),{now:NOW}).level,'red');
 s.ledger=[{kind:'transfer',date:'2026-11-02',direction:'expense',amountMinor:50000},
  {kind:'transfer',date:'2026-11-01',direction:'expense',amountMinor:900000},
  {kind:'investment',date:'2026-11-02',direction:'expense',amountMinor:900000}];
 assert.equal(classifyOperation(s,operation(),{now:NOW}).cumulativeMinor,100000);
 assert.equal(classifyOperation(s,operation({amountMinor:50001}),{now:NOW}).level,'red');
 for(const kind of ['investment','card','card_unlock','password_change','paper_buy','paper_sell'])assert.equal(classifyOperation(s,operation({kind,amountMinor:1}),{now:NOW}).level,'red');
});

test('pending transfer reservations escalate a second write before either callback commits',()=>{
 const s=state(),first=operation({amountMinor:60000}),second=operation({id:'transfer-two',amountMinor:60000});
 const a=consent(s,first),b=consent(s,second);
 assert.equal(a.level,'green');assert.equal(b.level,'green');
 permit(s,first,a,'parallel-one');
 assert.equal(classifyOperation(s,second,{now:NOW}).cumulativeMinor,120000);
 assert.throws(()=>permit(s,second,b,'parallel-two'),errorCode('verification_required'));
 assert.equal(s.safety.executions['parallel-two'],undefined);
});

test('mail, report, model and external data cannot issue authority even if the operation says user',()=>{
 for(const kind of ['mail','report','llm','external','preset']){
  const s=state(),op=operation({source:{kind:'user'}});
  assert.throws(()=>consent(s,op,{source:{kind,authority:'user',confirmed:true}}),errorCode('untrusted_authority'));
  assert.equal(Object.keys(s.safety.grants).length,0);
  assert.equal(s.safety.audit.at(-1).type,'blocked');
 }
});

test('unverified or reported-scam targets remain blocked separately from strong identity',()=>{
 for(const riskFlags of [['unverified_recipient'],['reported_scam'],['untrusted_account_claim'],['prompt_injection'],['reported-scam']]){
  const s=state(),op=operation({riskFlags});
  assert.equal(classifyOperation(s,op,{now:NOW}).riskBlocked,true);
  assert.throws(()=>consent(s,op),errorCode('risk_blocked'));
  assert.equal(Object.keys(s.safety.challenges).length,0);
 }
 assert.equal(classifyOperation(state(),operation({kind:'risk_transfer'}),{now:NOW}).riskBlocked,true);
 assert.equal(classifyOperation(state(),operation({parameters:'{"payee_id":"unknown"}'}),{now:NOW}).riskBlocked,true);
});

test('recovering identity never clears a separately reported-scam operation risk',()=>{
 const s=state(),op=operation();recordSafetySignal(s,{kind:'reported_scam',operationId:op.id},{now:NOW});
 assert.throws(()=>consent(s,op),errorCode('risk_blocked'));
 lockSafety(s,'manual_lock',{now:NOW+1});const recovery=beginRecovery(s,{source:USER,now:NOW+2});
 recoverSafety(s,{challengeId:recovery.id,code:DEMO_VERIFICATION_CODE,source:USER,now:NOW+3});
 assert.throws(()=>consent(s,op,{now:NOW+4}),errorCode('risk_blocked'));
 assert.throws(()=>consent(s,operation({id:'separate-known-payee'}),{now:NOW+4}),errorCode('locked'));
 const again=beginRecovery(s,{source:USER,now:NOW+5});recoverSafety(s,{challengeId:again.id,source:USER,code:DEMO_VERIFICATION_CODE,now:NOW+6});
 assert.equal(consent(s,operation({id:'separate-known-payee'}),{now:NOW+7}).status,'ready');
});

test('grants bind every operation field and freeze the complete displayed snapshot',()=>{
 const s=state(),op=operation(),grant=consent(s,op);
 assert.equal(Object.isFrozen(grant.snapshot),true);assert.equal(Object.isFrozen(grant.snapshot.scope),true);
 assert.throws(()=>{grant.snapshot.scope.account='other';},TypeError);
 const changes=[{revision:2},{target:'爸爸 4382'},{amountMinor:50001},{currency:'USD'},{parameters:'changed-parameters'},
  {scope:{action:'transfer',account:'living_1608',payee:'mom'}},{scheduledAt:'2026-11-03T09:00:00+08:00'},{riskFlags:['voice_mismatch']}];
 for(const change of changes)assert.throws(()=>validateGrant(s,{...op,...change},{grantId:grant.id,now:NOW+1}),errorCode('stale_binding'));
 assert.equal(validateGrant(s,op,{grantId:grant.id,now:NOW+1}).id,grant.id);
 assert.equal(getSafetyGrant(s,grant.id).snapshot.target,'妈妈 6821');
});

test('grants have a five-minute default, reject rollback and never allow unbounded future consent',()=>{
 const s=state(),op=operation(),grant=consent(s,op);
 assert.equal(grant.expiresAt,NOW+300000);
 assert.throws(()=>validateGrant(s,op,{grantId:grant.id,now:NOW-1}),errorCode('clock_rollback'));
 assert.throws(()=>validateGrant(s,op,{grantId:grant.id,now:grant.expiresAt}),errorCode('expired_grant'));
 assert.throws(()=>consent(state(),op,{ttlMs:32*86400000}),errorCode('safety_state_invalid'));
 assert.throws(()=>consent(state(),op,{expiresAt:NOW+32*86400000}),errorCode('expired_grant'));
});

test('red writes need an independent code challenge; a plain verified boolean does not authorize',()=>{
 const s=state(),op=operation({amountMinor:100001}),grant=consent(s,op);
 assert.equal(grant.status,'verification_required');
 assert.throws(()=>permit(s,op,grant),errorCode('verification_required'));
 const challenge=beginChallenge(s,op,{grantId:grant.id,now:NOW});
 const forged=verifyChallenge(s,{challengeId:challenge.id,verified:true,source:USER,now:NOW+1});
 assert.equal(forged.ok,false);assert.equal(s.safety.grants[grant.id].verification,null);
 const proof=verifyChallenge(s,{challengeId:challenge.id,code:DEMO_VERIFICATION_CODE,source:USER,now:NOW+2});
 assert.equal(proof.ok,true);
 assert.equal(validateGrant(s,op,{grantId:grant.id,challengeId:challenge.id,proofId:proof.proofId,now:NOW+3}).status,'ready');
 assert.throws(()=>validateGrant(s,op,{grantId:grant.id,challengeId:'other-challenge',now:NOW+3}),errorCode('verification_required'));
 const ticket=permit(s,op,grant,'red-one',{now:NOW+3});
 assert.equal(validatePermit(s,op,ticket,{now:NOW+4}).valid,true);
 assert.equal(JSON.stringify(s.safety.audit).includes(DEMO_VERIFICATION_CODE),false);
});

test('a verified future scheduled grant survives challenge expiry but not the displayed consent expiry',()=>{
 const s=state(),op=operation({id:'birthday-transfer',amountMinor:152000,scheduledAt:'2026-11-09T13:14:00+08:00'});
 const {grant,challenge}=verifiedGrant(s,op,{ttlMs:8*86400000});
 assert.equal(validateGrant(s,op,{grantId:grant.id,now:NOW+2}).status,'ready');
 assert.throws(()=>permit(s,op,grant,'too-early',{now:NOW+2}),errorCode('not_due'));
 const future=Date.parse(op.scheduledAt)+1;
 assert.ok(future>challenge.expiresAt);
 const ticket=permit(s,op,grant,'future-one',{now:future});
 assert.equal(validatePermit(s,op,ticket,{now:future+1}).valid,true);
 assert.throws(()=>validatePermit(s,op,ticket,{now:grant.expiresAt}),errorCode('expired_grant'));
});

test('challenge expiry and parameter changes cannot become successful verification',()=>{
 const s=state(),op=operation({kind:'investment'}),grant=consent(s,op),challenge=beginChallenge(s,op,{grantId:grant.id,now:NOW});
 assert.throws(()=>verifyChallenge(s,{challengeId:challenge.id,code:DEMO_VERIFICATION_CODE,source:USER,now:challenge.expiresAt}),errorCode('challenge_expired'));
 assert.equal(s.safety.grants[grant.id].verification,null);
 const next=beginChallenge(s,op,{grantId:grant.id,now:challenge.expiresAt+1});
 verifyChallenge(s,{challengeId:next.id,code:DEMO_VERIFICATION_CODE,source:USER,now:challenge.expiresAt+2});
 assert.throws(()=>validateGrant(s,{...op,revision:2},{grantId:grant.id,now:challenge.expiresAt+3}),errorCode('stale_binding'));
});

test('three failed identity attempts lock all writes and invalidate the challenge epoch',()=>{
 const s=state(),op=operation({kind:'investment'}),grant=consent(s,op),challenge=beginChallenge(s,op,{grantId:grant.id,now:NOW});
 for(let i=1;i<=3;i++){
  const result=verifyChallenge(s,{challengeId:challenge.id,code:'000000',source:USER,now:NOW+i});
  assert.equal(result.ok,false);assert.equal(result.status,i===3?'locked':'failed');
 }
 assert.equal(s.safety.locked,true);assert.equal(s.safety.epoch,1);assert.equal(s.safety.grants[grant.id].status,'revoked');
 assert.throws(()=>verifyChallenge(s,{challengeId:challenge.id,code:DEMO_VERIFICATION_CODE,source:USER,now:NOW+4}),SafetyError);
 for(const kind of ['transfer','paper_buy','booking','send_message'])assert.throws(()=>consent(s,operation({id:kind,kind}),{now:NOW+5}),errorCode('locked'));
});

test('password failures freeze writes for ten minutes while suspicious signals remain independently locked',()=>{
 const s=state();
 for(let i=0;i<3;i++)recordSafetySignal(s,{kind:'password_failure'},{now:NOW+i});
 assert.equal(s.safety.locked,true);assert.equal(s.safety.lock.reason,'password_failures');
 assert.equal(s.safety.lock.expiresAt,NOW+2+PASSWORD_FREEZE_MS);
 assert.equal(classifyOperation(s,operation(),{now:NOW+600001}).blocked,true);
 assert.equal(classifyOperation(s,operation(),{now:NOW+600002}).blocked,false);
 const other=state();recordSafetySignal(other,{kind:'prompt_injection',severity:'critical',source:{kind:'report'}},{now:NOW});
 assert.equal(other.safety.locked,true);assert.equal(refreshTimedFreeze(other,{now:NOW+86400000}).released,false);assert.equal(other.safety.locked,true);
});

test('one-shot execution permits support non-consuming validation and completed read-only replay',()=>{
 const s=state(),op=operation(),grant=consent(s,op),ticket=permit(s,op,grant);
 assert.equal(validatePermit(s,op,ticket,{now:NOW+1}).valid,true);assert.equal(validatePermit(s,op,ticket,{now:NOW+2}).valid,true);
 const result={status:'completed',receipt:'FP-LOCAL-ONE',amountMinor:50000};
 commitExecution(s,ticket,result,{now:NOW+3});
 assert.throws(()=>commitExecution(s,ticket,result,{now:NOW+4}),errorCode('already_completed'));
 const repeat=permit(s,op,grant);assert.equal(repeat.replay,true);assert.equal(repeat.status,'completed');
 assert.equal(repeat.result.receipt,result.receipt);
 assert.throws(()=>validatePermit(s,op,repeat,{now:NOW+4}),errorCode('already_completed'));
 assert.throws(()=>commitExecution(s,ticket,{...result,receipt:'different-receipt'},{now:NOW+4}),errorCode('result_mismatch'));
 assert.throws(()=>consent(s,op,{now:NOW+4}),errorCode('already_completed'));
 assert.equal(s.safety.audit.filter(event=>event.type==='execution_completed').length,1);
});

test('pending and failed replays never get another executable permit; a fresh consent needs a fresh execution id',()=>{
 const s=state(),op=operation(),grant=consent(s,op),ticket=permit(s,op,grant);
 const pending=permit(s,op,grant);assert.equal(pending.replay,true);assert.equal(pending.status,'pending');
 assert.throws(()=>validatePermit(s,op,pending,{now:NOW+1}),errorCode('execution_consumed'));
 assert.throws(()=>permit(s,op,grant,'different-pending'),errorCode('execution_consumed'));
 failExecution(s,ticket,{code:'adapter_failed',now:NOW+1});
 const renewed=consent(s,op,{now:NOW+2});assert.notEqual(renewed.id,grant.id);
 const failed=permit(s,op,renewed);assert.equal(failed.replay,true);assert.equal(failed.status,'failed');
 assert.throws(()=>validatePermit(s,op,failed,{now:NOW+3}),errorCode('execution_consumed'));
 assert.equal(permit(s,op,renewed,'fresh-execution',{now:NOW+3}).replay,false);
});

test('lock rejects a late callback before its financial effect is committed',()=>{
 const s=state(),op=operation(),grant=consent(s,op),ticket=permit(s,op,grant);
 lockSafety(s,'manual_lock',{now:NOW+1});
 assert.equal(s.safety.executions[ticket.executionId].status,'interrupted');
 assert.throws(()=>validatePermit(s,op,ticket,{now:NOW+2}),errorCode('epoch_changed'));
 assert.throws(()=>commitExecution(s,ticket,{status:'completed',receipt:'FP-LATE'},{now:NOW+2}),errorCode('epoch_changed'));
 assert.equal(s.safety.executions[ticket.executionId].result,null);
 assert.throws(()=>acquireExecution(s,op,{grantId:grant.id,executionId:'late-new',epoch:ticket.epoch,now:NOW+2}),errorCode('epoch_changed'));
});

test('a callback holding an old clone must also match the latest host safety epoch',()=>{
 const current=state(),op=operation(),grant=consent(current,op),ticket=permit(current,op,grant),oldClone=structuredClone(current);
 lockSafety(current,'manual_lock',{now:NOW+1});
 const context={now:NOW+2,currentEpoch:current.safety.epoch,currentLocked:current.safety.locked,currentPaused:current.paused};
 assert.throws(()=>validatePermit(oldClone,op,ticket,context),errorCode('epoch_changed'));
 assert.throws(()=>commitExecution(oldClone,ticket,{status:'completed',receipt:'FP-STALE-CLONE'},context),errorCode('epoch_changed'));
 assert.equal(current.safety.executions[ticket.executionId].result,null);
});

test('revoking an edited operation invalidates only its grants, challenge and pending callback',()=>{
 const s=state(),a=operation(),b=operation({id:'other-operation',kind:'investment'}),ag=consent(s,a),{grant:bg,challenge:bc}=verifiedGrant(s,b);
 const aTicket=permit(s,a,ag),epoch=s.safety.epoch;
 const result=revokeOperation(s,a.id,{reason:'parameters_changed',now:NOW+2});
 assert.equal(result.revokedGrants,1);assert.equal(result.interruptedExecutions,1);assert.equal(s.safety.epoch,epoch);
 assert.throws(()=>validatePermit(s,a,aTicket,{now:NOW+3}),errorCode('execution_consumed'));
 assert.equal(validateGrant(s,b,{grantId:bg.id,now:NOW+3}).status,'ready');
 assert.equal(getSafetyChallenge(s,bc.id).status,'verified');
 revokeOperation(s,b.id,{reason:'cancelled',now:NOW+4});
 assert.equal(getSafetyChallenge(s,bc.id).status,'invalidated');
 assert.throws(()=>validateGrant(s,b,{grantId:bg.id,now:NOW+5}),errorCode('authorization_required'));
});

test('manual pause invalidates callbacks without setting a security lock and ordinary resume revives no grant',()=>{
 const s=state(),op=operation(),grant=consent(s,op),ticket=permit(s,op,grant);
 s.paused=true;
 assert.throws(()=>validatePermit(s,op,ticket,{now:NOW+1}),errorCode('paused'));
 const result=invalidateSafetyEpoch(s,'manual_pause',{now:NOW+1});assert.equal(result.locked,false);assert.equal(result.epoch,1);
 s.paused=false;
 assert.throws(()=>validatePermit(s,op,ticket,{now:NOW+2}),errorCode('epoch_changed'));
 assert.throws(()=>validateGrant(s,op,{grantId:grant.id,now:NOW+2}),errorCode('epoch_changed'));
 const renewed=consent(s,op,{now:NOW+3});assert.equal(permit(s,op,renewed,'after-resume',{now:NOW+3}).replay,false);
});

test('controlled recovery requires its own challenge and does not reauthorize or replay interrupted writes',()=>{
 const s=state(),op=operation(),grant=consent(s,op),ticket=permit(s,op,grant);
 lockSafety(s,'manual_lock',{now:NOW+1});
 assert.throws(()=>beginRecovery(s,{source:{kind:'llm'},now:NOW+2}),errorCode('untrusted_authority'));
 const recovery=beginRecovery(s,{source:USER,now:NOW+2});
 const failed=recoverSafety(s,{challengeId:recovery.id,code:'000000',source:USER,now:NOW+3});assert.equal(failed.ok,false);assert.equal(s.safety.locked,true);
 const done=recoverSafety(s,{challengeId:recovery.id,code:DEMO_VERIFICATION_CODE,source:USER,now:NOW+4});
 assert.equal(done.ok,true);assert.equal(done.requiresReauthorization,true);assert.equal(done.automaticReplay,false);
 assert.equal(s.safety.locked,false);assert.equal(s.safety.epoch,2);assert.equal(s.safety.executions[ticket.executionId].status,'interrupted');
 assert.throws(()=>validateGrant(s,op,{grantId:grant.id,now:NOW+5}),errorCode('epoch_changed'));
 assert.throws(()=>commitExecution(s,ticket,{status:'completed',receipt:'FP-OLD'},{now:NOW+5}),errorCode('epoch_changed'));
 assert.equal(Object.values(s.safety.grants).filter(item=>item.status==='ready').length,0);
});

test('a new lock signal invalidates a pending recovery; expiration is not an unlock',()=>{
 const s=state();lockSafety(s,'manual_lock',{now:NOW});
 const recovery=beginRecovery(s,{source:USER,now:NOW+1});
 assert.throws(()=>recoverSafety(s,{challengeId:recovery.id,code:DEMO_VERIFICATION_CODE,source:USER,now:recovery.expiresAt}),errorCode('challenge_expired'));
 assert.equal(s.safety.locked,true);
 const second=beginRecovery(s,{source:USER,now:recovery.expiresAt+1});
 lockSafety(s,'suspicious_activity',{now:recovery.expiresAt+2});
 assert.throws(()=>recoverSafety(s,{challengeId:second.id,code:DEMO_VERIFICATION_CODE,source:USER,now:recovery.expiresAt+3}),SafetyError);
 assert.equal(s.safety.locked,true);
});

test('voice consent must be explicit and bound to the current card; voice match is never red verification',()=>{
 const s=state(),op=operation();
 assert.throws(()=>consent(s,op,{source:{kind:'user',method:'voice',text:'好'}}),errorCode('voice_confirmation_required'));
 const confirmation={taskId:op.id,revision:op.revision,target:op.target,amountMinor:op.amountMinor,currency:op.currency,action:op.kind,parameterKey:op.parameters,expiresAt:NOW+30000};
 const voice={kind:'user',method:'voice',explicit:true,voiceMatch:'mismatched',confirmation};
 const grant=consent(s,op,{source:voice});assert.equal(grant.status,'verification_required');assert.equal(grant.expiresAt,confirmation.expiresAt);
 assert.throws(()=>permit(s,op,grant),errorCode('verification_required'));
 assert.throws(()=>consent(state(),op,{source:{...voice,confirmation:{...confirmation,amountMinor:1}}}),errorCode('voice_confirmation_required'));
 const big=operation({amountMinor:200000});
 const matched={...voice,voiceMatch:'matched',confirmation:{...confirmation,amountMinor:big.amountMinor}};
 assert.equal(consent(state(),big,{source:matched}).status,'verification_required');
});

test('JSON persistence preserves proof binding and execution history without restoring unsafe authority',()=>{
 const s=state(),op=operation({kind:'card'}),{grant,proof}=verifiedGrant(s,op);
 const restored=JSON.parse(JSON.stringify(s));
 assert.equal(validateGrant(restored,op,{grantId:grant.id,proofId:proof.proofId,now:NOW+2}).status,'ready');
 const ticket=permit(restored,op,grant,'restored-one',{now:NOW+2});
 commitExecution(restored,ticket,{status:'completed',receipt:'FP-RESTORED'},{now:NOW+3});
 const again=JSON.parse(JSON.stringify(restored));assert.equal(permit(again,op,grant,'restored-one',{now:NOW+4}).replay,true);
});

test('audit whitelists correlation metadata and excludes codes, TTS, arbitrary bodies and credentials',()=>{
 const s=state();
 auditSafety(s,{type:'example_event',operationId:'audit-operation',reason:'verification_failed',code:DEMO_VERIFICATION_CODE,
  key:'test-credential-never-audit',speak:'private-tts-body',raw:'untrusted-body',binding:'opaque-parameter-data'}, {now:NOW});
 const text=JSON.stringify(s.safety.audit);
 for(const forbidden of [DEMO_VERIFICATION_CODE,'test-credential-never-audit','private-tts-body','untrusted-body','opaque-parameter-data'])assert.equal(text.includes(forbidden),false);
 assert.match(s.safety.audit[0].bindingId,/^binding-/);
 assert.throws(()=>consent(state(),operation({parameters:{password:'test-credential-never-audit'}})),errorCode('invalid_operation'));
});

test('invalid persisted policy fails closed and read-only work stays available while locked',()=>{
 const s=state();ensureSafety(s);s.safety.policy.failureThreshold=Infinity;
 assert.throws(()=>consent(s,operation()),errorCode('safety_state_invalid'));
 const other=state();lockSafety(other,'manual_lock',{now:NOW});
 const query=operation({id:'locked-query',kind:'query',parameters:'{}',amountMinor:0});
 assert.equal(classifyOperation(other,query,{now:NOW}).blocked,false);
 const ticket=acquireExecution(other,query,{executionId:'locked-read',now:NOW});
 assert.equal(commitExecution(other,ticket,{status:'completed',value:'read-only'},{now:NOW+1}).status,'completed');
 assert.equal(SAFETY_DEFAULTS.maxGrantTTL,31*86400000);
});
