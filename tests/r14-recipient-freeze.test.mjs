import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewRecipient,validateRecipientReview,recipientOperation} from '../web/recipient-review.mjs';
import {ensureSafety,authorizeSafety,beginChallenge,verifyChallenge,beginRecovery,recoverSafety,refreshTimedFreeze,lockSafety,acquireExecution,commitExecution,validateGrant,PASSWORD_FREEZE_MS,DEMO_VERIFICATION_CODE} from '../web/safety-policy.mjs';
import {renderSafetyBanner} from '../web/companion-ui.mjs';

const NOW=Date.parse('2026-11-02T01:00:00Z'),USER={kind:'user',method:'click'};
const input=(patch={})=>({cardNumber:'0000000000006217',recipientName:'陈宇',amountMinor:30000,sourceAccount:'living_1608',...patch});
const op=(patch={})=>({id:'old-write',revision:1,kind:'transfer',target:'妈妈',amountMinor:10000,currency:'CNY',parameters:'{"amount_minor":10000}',scope:'once',...patch});
const state=()=>({ledger:[],paused:false});

test('complete synthetic account, not a person name or suffix, selects evidence',()=>{
 for(const data of [{recipientName:'陈宇',amountMinor:30000},{reference:'new-card-6217',recipientName:'陈宇',amountMinor:30000},{recipientName:'闲鱼卖家',reference:'reported-card-8891',amountMinor:200000}]){
  const r=reviewRecipient(data);assert.equal(r.status,'needs_details');assert.ok(r.missing.includes('cardNumber'));assert.equal(r.evidence.report_count,0);
 }
 assert.throws(()=>reviewRecipient(input({cardNumber:'6217'})),e=>e.code==='invalid_recipient_input');
 assert.throws(()=>reviewRecipient(input({cardNumber:6217})),e=>e.code==='invalid_recipient_input');
 const r=reviewRecipient(input());assert.equal(r.status,'matched');assert.equal(r.evidence.first_transfer,true);
 const unknown=reviewRecipient(input({cardNumber:'0000000000007777',recipientName:'陈宇'}));assert.equal(unknown.status,'unverified');assert.equal(unknown.evidence.report_count,0);
 const mismatch=reviewRecipient(input({recipientName:'其他人'}));assert.equal(mismatch.status,'unverified');assert.equal(mismatch.evidence.report_count,0);
});

test('only the exact full reported fixture has reports, even if renamed',()=>{
 for(const recipientName of ['闲鱼卖家','陈宇','另一个商家']){
  const r=reviewRecipient(input({cardNumber:'0000000000008891',recipientName}));assert.equal(r.status,'reported');assert.equal(r.evidence.report_count,7);
 }
 assert.equal(reviewRecipient(input({recipientName:'闲鱼卖家'})).evidence.report_count,0);
});

test('first transfer comes from successful account history and remains bound to its snapshot',()=>{
 const data=input(),r=reviewRecipient(data),history=[{cardNumber:data.cardNumber,recipientName:'陈宇'}];
 assert.deepEqual(recipientOperation(r,{id:'first'}).riskFlags,['new_recipient']);
 const known=reviewRecipient(data,{history});assert.equal(known.evidence.first_transfer,false);
 assert.deepEqual(recipientOperation(known,{id:'second',history}).riskFlags,[]);
 assert.equal(validateRecipientReview(known,data,{history}),true);
 assert.equal(validateRecipientReview(r,data,{history}),false);
 assert.throws(()=>recipientOperation(known,{id:'stale-without-history'}),e=>e.code==='invalid_recipient_review');
 const renamed=reviewRecipient(input({recipientName:'另一名字'}),{history});assert.equal(renamed.evidence.first_transfer,false);assert.equal(renamed.status,'unverified');
});

test('three real password submissions freeze ten minutes and invalidate late writes',()=>{
 const s=state(),old=op(),g=authorizeSafety(s,old,{source:USER,now:NOW}),permit=acquireExecution(s,old,{grantId:g.id,executionId:'old-in-flight',now:NOW});
 const next=op({id:'new-write',riskFlags:['new_recipient']}),grant=authorizeSafety(s,next,{source:USER,now:NOW}),challenge=beginChallenge(s,next,{grantId:grant.id,now:NOW});
 for(let i=1;i<=3;i++)verifyChallenge(s,{challengeId:challenge.id,source:USER,code:'000000',now:NOW+i});
 const deadline=NOW+3+PASSWORD_FREEZE_MS;assert.equal(s.safety.lock.expiresAt,deadline);
 assert.throws(()=>beginRecovery(s,{source:USER,now:NOW+4}),e=>e.code==='timed_freeze');
 assert.throws(()=>recoverSafety(s,{challengeId:challenge.id,source:USER,code:DEMO_VERIFICATION_CODE,now:NOW+4}),e=>e.code==='timed_freeze');
 assert.equal(refreshTimedFreeze(s,{now:deadline-1}).released,false);assert.equal(s.safety.locked,true);
 const released=refreshTimedFreeze(s,{now:deadline});assert.equal(released.released,true);assert.equal(released.automaticReplay,false);assert.equal(released.requiresReauthorization,true);
 assert.equal(s.safety.executions['old-in-flight'].status,'interrupted');
 assert.throws(()=>commitExecution(s,permit,{status:'completed',receipt:'late'},{now:deadline+1}),e=>e.code==='epoch_changed');
 assert.throws(()=>validateGrant(s,old,{grantId:g.id,now:deadline+1}),e=>e.code==='epoch_changed');
 assert.equal(s.ledger.length,0);assert.equal(refreshTimedFreeze(s,{now:deadline+1}).changed,false);
 const renewed=authorizeSafety(s,{...next,revision:2},{source:USER,now:deadline+1});assert.equal(renewed.status,'verification_required');
});

test('timeout never clears an underlying injection or manual lock',()=>{
 for(const reason of ['prompt_injection','manual_lock']){
  const s=state();lockSafety(s,reason,{now:NOW});const recovery=beginRecovery(s,{source:USER,now:NOW+1});
  for(let i=2;i<=4;i++)recoverSafety(s,{challengeId:recovery.id,source:USER,code:'000000',now:NOW+i});
  assert.equal(s.safety.lock.reason,'password_failures');assert.equal(s.safety.lock.underlyingLock.reason,reason);
  assert.throws(()=>beginRecovery(s,{source:USER,now:NOW+5}),e=>e.code==='timed_freeze');
  const expired=refreshTimedFreeze(s,{now:NOW+4+PASSWORD_FREEZE_MS});assert.equal(expired.released,false);assert.equal(s.safety.locked,true);assert.equal(s.safety.lock.reason,reason);
 }
 const malformed=state();ensureSafety(malformed);malformed.safety.locked=true;malformed.safety.lock={reason:'password_failures',at:NOW,expiresAt:NOW+1};
 assert.equal(refreshTimedFreeze(malformed,{now:NOW+999999}).released,false);assert.equal(malformed.safety.locked,true);
});

test('freeze card stays simple and has no password or recovery control',()=>{
 const s=state();lockSafety(s,'password_failures',{now:NOW});const html=renderSafetyBanner(s.safety,{esc:String});
 assert.match(html,/账户已冻结10分钟/);assert.doesNotMatch(html,/<button|<input|验证后恢复|123456/);
});
