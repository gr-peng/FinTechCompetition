import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh} from '../web/engine.mjs';
import {financialFacts} from '../web/finance-state.mjs';
import {ensureSafety,authorizeSafety,acquireExecution,lockSafety,invalidateSafetyEpoch} from '../web/safety-policy.mjs';
import {previousMonthSpending,startSavingsCoach,reviseSavingsProposal,cancelSavingsCoach,budgetOperation,applyBudgetTransfer,updateSavingsFields,savingsPlanOperation,applySavingsPlan,beginSavingsAdjustment,pauseSavingsPlan,tickSavingsPlan,savingsModelContext,savingsSummary,renderSavingsCoach,renderSavingsAdjustment,renderSavingsJar} from '../web/savings-coach.mjs';

const NOW=Date.parse('2026-11-02T01:00:00Z'),USER={kind:'user',method:'click'};
const FIELDS={daily_minor:2000,source_account:'living_1608',start_date:'2026-11-03',target_minor:1200000};
function state(){const s=fresh();ensureSafety(s);return s;}
function permit(s,op,now=NOW){const g=authorizeSafety(s,op,{source:USER,now});assert.equal(g.status,'ready');return acquireExecution(s,op,{grantId:g.grantId,executionId:op.id+':'+op.revision,now});}
function budgetDone(s){startSavingsCoach(s,{id:'test-saving',now:NOW});const op=budgetOperation(s);return applyBudgetTransfer(s,s.savingsCoach,{permit:permit(s,op),now:NOW});}
function planDone(s,fields=FIELDS){budgetDone(s);s.savingsCoach=updateSavingsFields(s.savingsCoach,fields);const op=savingsPlanOperation(s,s.savingsCoach,{now:NOW});return applySavingsPlan(s,s.savingsCoach,{permit:permit(s,op),now:NOW});}
const t=date=>Date.parse(date+'T01:00:00Z');

test('new conversation derives the previous full month from ledger, not the current two days',()=>{
 const s=state(),facts=financialFacts(s,'2026-10'),analysis=previousMonthSpending(s),coach=startSavingsCoach(s,{now:NOW});
 assert.equal(analysis.period,'2026-10');assert.equal(analysis.total_minor,facts.expenseMinor);
 assert.deepEqual(analysis.categories.map(x=>[x.category,x.amount_minor]),facts.categories);
 assert.ok(Math.abs(analysis.categories.reduce((n,x)=>n+x.ratio,0)-1)<1e-10);
 assert.equal(coach.stage,'proposal');assert.equal(s.travelBudget,undefined);assert.equal(s.nativeBudget,undefined);
 const html=renderSavingsCoach(s);assert.match(html,/2026-10/);assert.match(html,/conic-gradient/);assert.match(html,/savings-accept-budget/);
});

test('declining a proposal never changes budget, travel amount, balance or ledger',()=>{
 const s=state(),before=structuredClone(s);startSavingsCoach(s,{now:NOW});cancelSavingsCoach(s);
 assert.equal(s.savingsCoach.stage,'cancelled');assert.equal(s.travelBudget,before.travelBudget);assert.equal(s.nativeBudget,before.nativeBudget);assert.deepEqual(s.ledger,before.ledger);assert.equal(s.balance,before.balance);
 assert.equal(savingsSummary(s),'没有调整预算，也没有转出资金。');
});

test('accepted 600 yuan moves between shopping and travel with an immutable conserved total',()=>{
 const s=state(),cash=s.balance,ledger=structuredClone(s.ledger),receipt=budgetDone(s),b=s.nativeBudget['2026-11'];
 assert.equal(b.total_minor,800000);assert.equal(b.categories.reduce((n,c)=>n+c.limit_minor,0),800000);
 assert.equal(b.categories.find(c=>c.category==='购物').limit_minor,90000);assert.equal(b.categories.find(c=>c.category==='旅行').limit_minor,60000);
 assert.equal(s.travelBudget,3600);assert.equal(s.balance,cash);assert.deepEqual(s.ledger,ledger);
 assert.deepEqual([receipt.travel_before_minor,receipt.travel_after_minor,receipt.amount_minor],[300000,360000,60000]);
 assert.equal(s.savingsCoach.stage,'confirm');assert.match(savingsSummary(s),/待你确认/);
});

test('a repeat budget callback returns the stored receipt without adding another 600',()=>{
 const s=state(),receipt=budgetDone(s);const repeated=applyBudgetTransfer(s,s.savingsCoach);
 assert.deepEqual(repeated,receipt);assert.equal(s.travelBudget,3600);assert.equal(s.nativeBudget['2026-11'].revision,1);
});

test('adjustment revokes the original proposal permit and only the new amount can execute',()=>{
 const s=state();startSavingsCoach(s,{now:NOW});const old=structuredClone(s.savingsCoach),oldOp=budgetOperation(s),p=permit(s,oldOp);
 reviseSavingsProposal(s,s.savingsCoach,{reduction_minor:40000});assert.equal(s.savingsCoach.revision,2);
 assert.throws(()=>applyBudgetTransfer(s,old,{permit:p,now:NOW}),/变化/);
 const op=budgetOperation(s);applyBudgetTransfer(s,s.savingsCoach,{permit:permit(s,op),now:NOW});
 assert.equal(s.travelBudget,3400);assert.equal(s.nativeBudget['2026-11'].categories.find(c=>c.category==='购物').limit_minor,110000);
});

test('an independently changed native budget invalidates the before snapshot',()=>{
 const s=state();startSavingsCoach(s,{now:NOW});s.nativeBudget={'2026-11':{...s.savingsCoach.before,revision:9}};
 assert.throws(()=>budgetOperation(s),/预算已变化/);assert.equal(s.travelBudget,undefined);
});

test('a custom real monthly budget is preserved without manufacturing new total funds',()=>{
 const s=state();s.nativeBudget={'2026-11':{month:'2026-11',revision:3,status:'set',total_minor:500000,categories:[{category:'购物',limit_minor:100000},{category:'住房',limit_minor:350000}]}};
 budgetDone(s);assert.equal(s.nativeBudget['2026-11'].total_minor,500000);assert.equal(s.nativeBudget['2026-11'].categories.reduce((n,c)=>n+c.limit_minor,0),450000);
});

test('unaffordable shopping reduction is rejected rather than making a negative budget',()=>{
 const s=state();startSavingsCoach(s,{now:NOW});assert.throws(()=>reviseSavingsProposal(s,s.savingsCoach,{reduction_minor:150001}),/范围/);assert.equal(s.travelBudget,undefined);
});

test('no financial write accepts a forged or absent permit, and a late permit is invalid after lock',()=>{
 const s=state();startSavingsCoach(s,{now:NOW});assert.throws(()=>applyBudgetTransfer(s,s.savingsCoach,{permit:{},now:NOW}));
 const op=budgetOperation(s),p=permit(s,op);lockSafety(s,'manual_lock',{now:NOW+1});assert.throws(()=>applyBudgetTransfer(s,s.savingsCoach,{permit:p,now:NOW+2}));assert.equal(s.travelBudget,undefined);
});

test('plan requires each daily amount, source, date and target, retaining already filled answers',()=>{
 const s=state();budgetDone(s);s.savingsCoach={...s.savingsCoach,stage:'details',fields:{}};s.savingsCoach=updateSavingsFields(s.savingsCoach,{daily_minor:2000});
 assert.equal(s.savingsCoach.stage,'details');assert.equal(s.savingsCoach.fields.daily_minor,2000);assert.throws(()=>savingsPlanOperation(s,s.savingsCoach,{now:NOW}),/补齐/);
 s.savingsCoach=updateSavingsFields(s.savingsCoach,{source_account:'salary_0826',start_date:'2026-11-03'});
 assert.equal(s.savingsCoach.stage,'details');s.savingsCoach=updateSavingsFields(s.savingsCoach,{target_minor:1200000});assert.equal(s.savingsCoach.stage,'confirm');
 assert.equal(s.savingsJar,undefined);assert.match(renderSavingsCoach(s),/本期30天/);
 const context=savingsModelContext(s);assert.equal(context.fields.daily_minor,2000);assert.equal(context.draft_id,s.savingsCoach.id);assert.ok(!JSON.stringify(context).includes('ledger'));
});

test('cancel after budget confirmation keeps the factual budget result but creates no jar',()=>{
 const s=state();budgetDone(s);cancelSavingsCoach(s);assert.equal(s.travelBudget,3600);assert.equal(s.savingsJar,undefined);assert.equal(savingsSummary(s),'预算已调整，储蓄计划未建立。');
});

test('invalid cents, past date and invented source do not create a savings schedule',()=>{
 const s=state();budgetDone(s);for(const patch of [{daily_minor:1.5},{daily_minor:-1},{target_minor:0},{source_account:'external_account'},{start_date:'2026-02-30'}])assert.throws(()=>updateSavingsFields(s.savingsCoach,patch));
 s.savingsCoach=updateSavingsFields(s.savingsCoach,{...FIELDS,start_date:'2026-11-01'});assert.throws(()=>savingsPlanOperation(s,s.savingsCoach,{now:NOW}),/开始时间/);
});

test('confirming the schedule does not pretend that deposits have already happened',()=>{
 const s=state(),balance=s.balance;const jar=planDone(s);
 assert.equal(jar.saved_minor,0);assert.equal(s.balance,balance);assert.equal(s.savingsCoach.stage,'done');assert.equal(savingsModelContext(s),null);
 assert.match(savingsSummary(s),/尚未存入/);const html=renderSavingsJar(s);assert.match(html,/旅行储蓄罐/);assert.match(html,/savings-jar-pause/);assert.match(html,/<svg/);assert.doesNotMatch(html.replace(/<[^>]*>/g,''),/receipt:|permit-|test-saving/);
 assert.equal(applySavingsPlan(s,s.savingsCoach).id,jar.id);
});

test('a changed plan parameter invalidates the old one-time confirmation',()=>{
 const s=state();budgetDone(s);s.savingsCoach=updateSavingsFields(s.savingsCoach,FIELDS);const old=structuredClone(s.savingsCoach),op=savingsPlanOperation(s,old,{now:NOW}),p=permit(s,op);
 s.savingsCoach=updateSavingsFields(s.savingsCoach,{daily_minor:3000});assert.throws(()=>applySavingsPlan(s,old,{permit:p,now:NOW}),/变化/);assert.equal(s.savingsJar,undefined);
});

test('a due day debits available cash once, records savings principal, and keeps expense totals unchanged',()=>{
 const s=state(),beforeCash=s.balance,before=financialFacts(s,'2026-11').expenseMinor;planDone(s);
 assert.equal(tickSavingsPlan(s,{now:NOW}).executed,false);const result=tickSavingsPlan(s,{now:t('2026-11-03')});
 assert.equal(result.executed,true);assert.equal(s.savingsJar.saved_minor,2000);assert.equal(s.balance,beforeCash-20);assert.equal(financialFacts(s,'2026-11').expenseMinor,before);
 assert.equal(tickSavingsPlan(s,{now:t('2026-11-03')+1000}).executed,false);assert.equal(s.balance,beforeCash-20);assert.match(renderSavingsJar(s),/¥20\.00/);
});

test('offline days are not replayed or backfilled on the next tick',()=>{
 const s=state();planDone(s);const result=tickSavingsPlan(s,{now:t('2026-11-07')});assert.equal(result.executed,true);assert.equal(s.savingsJar.saved_minor,2000);assert.deepEqual(Object.keys(s.savingsJar.deposits),['2026-11-07']);
});

test('the reviewed thirty-day window expires without silently renewing or depositing',()=>{
 const s=state();planDone(s);assert.equal(tickSavingsPlan(s,{now:t('2026-12-03')}).status,'needs_review');assert.equal(s.savingsJar.saved_minor,0);
});

test('pause and restore require review, while safe read-only cards remain available',()=>{
 const s=state();planDone(s);pauseSavingsPlan(s,{source:USER});assert.equal(tickSavingsPlan(s,{now:t('2026-11-03')}).executed,false);assert.match(renderSavingsJar(s),/核对后继续/);
 beginSavingsAdjustment(s,{now:t('2026-11-03'),resume:true});assert.equal(s.savingsCoach.stage,'confirm');assert.equal(s.savingsJar.status,'paused');
 const op=savingsPlanOperation(s,s.savingsCoach,{now:t('2026-11-03')});applySavingsPlan(s,s.savingsCoach,{permit:permit(s,op,t('2026-11-03')),now:t('2026-11-03')});
 assert.equal(tickSavingsPlan(s,{now:t('2026-11-03')}).executed,false);assert.equal(tickSavingsPlan(s,{now:t('2026-11-04')}).executed,true);
});

test('safety lock and epoch reset stop future writes, and clearing only a flag does not reactivate the plan',()=>{
 const s=state();planDone(s);lockSafety(s,'manual_lock',{now:NOW+1});assert.equal(tickSavingsPlan(s,{now:t('2026-11-03')}).status,'paused_safety');s.safety.locked=false;s.safety.lock=null;assert.equal(tickSavingsPlan(s,{now:t('2026-11-04')}).executed,false);assert.equal(s.savingsJar.saved_minor,0);
 const s2=state();planDone(s2);invalidateSafetyEpoch(s2,'demo_reset',{now:NOW+1});assert.equal(tickSavingsPlan(s2,{now:t('2026-11-03')}).status,'paused_safety');
});

test('tampered saved progress, terms and completion proofs cannot produce a deposit',()=>{
 for(const change of [s=>s.savingsJar.daily_minor=9000,s=>s.savingsJar.saved_minor=1,s=>s.safety.executions[s.savingsJar.authority.execution_id].status='pending']){
  const s=state();planDone(s);change(s);const count=s.ledger.length;assert.throws(()=>tickSavingsPlan(s,{now:t('2026-11-03')}));assert.equal(s.ledger.length,count);
 }
});

test('a funded jar can be adjusted without losing past deposits or depositing twice on the same day',()=>{
 const s=state();planDone(s);tickSavingsPlan(s,{now:t('2026-11-03')});const jarId=s.savingsJar.id;beginSavingsAdjustment(s,{now:t('2026-11-03')});s.savingsCoach=updateSavingsFields(s.savingsCoach,{daily_minor:3000});const op=savingsPlanOperation(s,s.savingsCoach,{now:t('2026-11-03')});applySavingsPlan(s,s.savingsCoach,{permit:permit(s,op,t('2026-11-03')),now:t('2026-11-03')});
 assert.equal(s.savingsJar.id,jarId);assert.equal(s.savingsJar.saved_minor,2000);assert.equal(tickSavingsPlan(s,{now:t('2026-11-03')}).executed,false);assert.equal(tickSavingsPlan(s,{now:t('2026-11-04')}).executed,true);assert.equal(s.savingsJar.saved_minor,5000);
});

test('the last deposit is capped at the actual target instead of exceeding it',()=>{
 const s=state();planDone(s,{...FIELDS,target_minor:2500});tickSavingsPlan(s,{now:t('2026-11-03')});const r=tickSavingsPlan(s,{now:t('2026-11-04')});assert.equal(r.receipt.amount_minor,500);assert.equal(s.savingsJar.saved_minor,2500);assert.equal(s.savingsJar.status,'completed');
});

test('form actions remain explicit, concise, and safe to render at narrow widths',()=>{
 const s=state();startSavingsCoach(s,{now:NOW});assert.match(renderSavingsAdjustment(s),/id="savings-adjust-form"/);assert.doesNotMatch(renderSavingsCoach(s),/已调整|已存入/);
 budgetDone(s);assert.match(renderSavingsCoach(s),/savings-confirm-plan/);assert.doesNotMatch(renderSavingsCoach(s),/<input/);s.savingsCoach.stage='details';assert.match(renderSavingsCoach(s),/id="savings-fields-form"/);
});
