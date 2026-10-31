import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh} from '../web/engine.mjs';
import {createCompanionController} from '../web/companion-controller.mjs';
import {renderConversation} from '../web/task-feedback.mjs';
import {lockSafety} from '../web/safety-policy.mjs';

const result=(fields={},extra={})=>({scenario:'savings_coach',status:'propose',reply:'先看上月支出，再核对建议。',speak:null,fields,missing:[],mode:'create',task_id:null,query:null,period_month:null,context_action:'new',cards:[{type:'savings_plan'}],actions:[{type:'prepare_savings'}],...extra});
function harness(){let state=fresh();const old=globalThis.location;globalThis.location={href:'http://127.0.0.1:63939/?session=test'};const c=createCompanionController({getState:()=>state,commit:n=>{state=structuredClone(n);},esc:String,repaint(){},onError:e=>{throw Error(e);},voiceTTS:{supported:false,cancel(){}}});return {c,get s(){return state;},close(){c.dispose();globalThis.location=old;}};}
test('fresh model savings intent creates actual chart, retains continuation, and folds whole completed conversation',async()=>{
 const h=harness();try{
  h.s.messages.push({id:'u1',role:'user',text:'最近购物花得多，想为旅行存点钱。'});
  h.c.applyModelResult(result(),{originTurnId:'u1'});const id=h.s.savingsCoach.id;
  assert.match(h.c.render(),/conic-gradient/);assert.match(h.c.render(),/2026-10/);assert.equal(h.c.pendingCount(),1);assert.equal(h.s.messages[0].planId,id);
  h.c.applyModelResult(result({proposal_action:'accept'},{context_action:'continue'}));assert.equal(h.s.savingsCoach.stage,'proposal');assert.equal(h.s.travelBudget,undefined);
  await h.c.handleAction('savings-accept-budget',{},{});assert.equal(h.s.travelBudget,3600);assert.equal(h.s.savingsCoach.stage,'confirm');
  h.s.messages.push({id:'u2',role:'user',text:'每天20元，用生活账户。'});
  h.c.applyModelResult(result({daily_minor:2000,source_account:'living_1608'},{context_action:'continue',status:'clarify',mode:'none',missing:['start_date','target_minor'],cards:[],actions:[]}),{originTurnId:'u2'});
  assert.equal(h.s.savingsCoach.stage,'confirm');assert.equal(h.s.messages.find(x=>x.id==='u2').planId,id);
  h.c.applyModelResult(result({start_date:'2026-11-03',target_minor:1200000},{context_action:'continue'}));assert.equal(h.s.savingsCoach.stage,'confirm');assert.equal(h.s.savingsJar,undefined);
  await h.c.handleAction('savings-confirm-plan',{},{});
  assert.equal(h.s.savingsJar.saved_minor,0);assert.equal(h.s.savingsJar.daily_minor,2000);assert.equal(h.c.pendingCount(),0);
  assert.equal(h.s.companion.planPresentations[id].collapse,true);
  const html=renderConversation(h.s.messages,{esc:String,presentations:h.s.companion.planPresentations,renderMessage:m=>m.text});
  assert.match(html,/conversation-history/);assert.equal((html.match(/<details/g)||[]).length,1);assert.ok(h.s.messages.at(-1).planSummary);
 }finally{h.close();}
});
test('reject and revised amount never apply without explicit confirmation',async()=>{
 const h=harness();try{h.c.applyModelResult(result());h.c.applyModelResult(result({reduction_minor:40000,proposal_action:'adjust'},{context_action:'continue'}));assert.equal(h.s.savingsCoach.reduction_minor,40000);assert.equal(h.s.travelBudget,undefined);await h.c.handleAction('savings-cancel',{},{});assert.equal(h.s.travelBudget,undefined);assert.equal(h.s.savingsJar,undefined);assert.equal(h.s.savingsCoach.stage,'cancelled');}finally{h.close();}
});
test('reset clears frozen chat and stale pending schedules without deleting recorded finance',async()=>{
 const h=harness();try{h.c.applyModelResult(result());const before=h.s.balance;lockSafety(h.s,'password_failures',{now:h.c.now()});h.s.messages.push({id:'old',text:'旧任务'});h.c.resetConversation();assert.equal(h.s.safety.locked,false);assert.deepEqual(h.s.messages,[]);assert.equal(h.s.savingsCoach,null);assert.equal(h.c.pendingCount(),0);assert.equal(h.s.balance,before);assert.doesNotMatch(h.c.render(),/冻结|恢复|savings-accept/);}finally{h.close();}
});
test('a stale confirmation DOM revision and a safety lock cannot commit a budget',async()=>{
 const h=harness();try{h.c.applyModelResult(result());await assert.rejects(()=>h.c.handleAction('savings-accept-budget',{dataset:{revision:'99'}},{}),/已更新/);lockSafety(h.s,'manual_lock',{now:h.c.now()});await assert.rejects(()=>h.c.handleAction('savings-accept-budget',{},{}));assert.equal(h.s.travelBudget,undefined);}finally{h.close();}
});
