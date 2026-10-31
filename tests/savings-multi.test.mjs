import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh} from '../web/engine.mjs';
import {ensureSafety,authorizeSafety,acquireExecution,invalidateSafetyEpoch} from '../web/safety-policy.mjs';
import * as s from '../web/savings-coach.mjs';
import {createCompanionController} from '../web/companion-controller.mjs';
const NOW=Date.parse('2026-11-02T02:00:00Z'),USER={kind:'user',method:'click'};
const permit=(state,op,at=NOW)=>{const g=authorizeSafety(state,op,{source:USER,now:at});return acquireExecution(state,op,{grantId:g.grantId,executionId:op.id+':'+op.revision,now:at});};
const state=()=>{const n=fresh();ensureSafety(n);return n;};
function create(n,name,daily=1000){s.beginJarEditor(n,{now:NOW});s.updateJarEditor(n,{name,daily_minor:daily});const c=n.savingsEditor,op=s.savingsPlanOperation(n,c,{now:NOW});return s.applySavingsPlan(n,c,{permit:permit(n,op),now:NOW});}
test('budget consent prepares complete future plan without creating a jar or taking money',()=>{
 const n=state(),balance=n.balance;s.startSavingsCoach(n,{now:NOW});let op=s.budgetOperation(n);s.applyBudgetTransfer(n,n.savingsCoach,{permit:permit(n,op),now:NOW});
 assert.equal(n.savingsCoach.stage,'confirm');assert.deepEqual(n.savingsCoach.fields,{daily_minor:2000,source_account:'living_1608',start_date:'2026-11-03',target_minor:1200000});assert.equal(n.savingsJar,undefined);assert.equal(n.balance,balance);
 assert.doesNotMatch(s.renderSavingsCoach(n),/<input/);assert.match(s.renderSavingsCoach(n),/不再调整预算/);
});
test('screenshot past date fails old validation and is re-proposed before any execution',()=>{
 const n=state();s.beginJarEditor(n,{now:NOW});s.updateJarEditor(n,{name:'旅行',start_date:'2026-10-31',daily_minor:2000,target_minor:60000});
 assert.throws(()=>s.savingsPlanOperation(n,n.savingsEditor,{now:NOW}),/开始时间/);const revision=n.savingsEditor.revision;
 assert.equal(s.refreshSavingsStart(n,n.savingsEditor,{now:NOW}),true);assert.equal(n.savingsEditor.fields.start_date,'2026-11-03');assert.ok(n.savingsEditor.revision>revision);assert.equal(s.listSavingsJars(n).length,0);
 const op=s.savingsPlanOperation(n,n.savingsEditor,{now:NOW});s.applySavingsPlan(n,n.savingsEditor,{permit:permit(n,op),now:NOW});assert.equal(s.listSavingsJars(n).length,1);
});
test('two jars edit and cancel independently with no immediate debit or budget update',()=>{
 const n=state(),cash=n.balance,a=create(n,'旅行',2000),b=create(n,'电脑',1000);assert.equal(s.listSavingsJars(n).length,2);assert.equal(n.balance,cash);assert.equal(n.nativeBudget,undefined);
 s.beginJarEditor(n,{jarId:a.id,now:NOW});s.updateJarEditor(n,{name:'假期',target_minor:120000,daily_minor:1500,source_account:'salary_0826'});const op=s.savingsPlanOperation(n,n.savingsEditor,{now:NOW});s.applySavingsPlan(n,n.savingsEditor,{permit:permit(n,op),now:NOW});
 assert.equal(s.listSavingsJars(n).find(j=>j.id===a.id).name,'假期');assert.equal(s.listSavingsJars(n).find(j=>j.id===b.id).daily_minor,1000);
 s.cancelJarPlan(n,a.id,{source:USER});assert.equal(s.listSavingsJars(n).find(j=>j.id===a.id).status,'cancelled');assert.equal(s.listSavingsJars(n).find(j=>j.id===b.id).status,'active');
 s.tickSavingsPlan(n,{now:Date.parse('2026-11-03T01:00:01Z')});assert.equal(n.balance,cash-10);assert.equal(s.savingsTotal(n),1000);s.tickSavingsPlan(n,{now:Date.parse('2026-11-03T01:00:02Z')});assert.equal(n.balance,cash-10);
});
test('closing draft does not create, reset invalidates both and re-review resumes only selected jar',()=>{
 const n=state();s.beginJarEditor(n,{now:NOW});n.savingsEditor=null;assert.equal(s.listSavingsJars(n).length,0);const a=create(n,'甲'),b=create(n,'乙');invalidateSafetyEpoch(n,'reset',{now:NOW});s.tickSavingsPlan(n,{now:NOW+1});assert.ok(s.listSavingsJars(n).every(j=>j.status==='paused_safety'));
 s.beginJarEditor(n,{jarId:a.id,now:NOW,resume:true});const op=s.savingsPlanOperation(n,n.savingsEditor,{now:NOW});s.applySavingsPlan(n,n.savingsEditor,{permit:permit(n,op),now:NOW});assert.equal(s.listSavingsJars(n).find(j=>j.id===a.id).status,'active');assert.equal(s.listSavingsJars(n).find(j=>j.id===b.id).status,'paused_safety');
});
test('finance actions stay on the current page and repeated save cannot create a second jar',async()=>{
 let n=state(),navigation=0;const old=globalThis.location;globalThis.location={href:'http://127.0.0.1/?session=test'};
 const c=createCompanionController({getState:()=>n,commit:x=>n=structuredClone(x),esc:String,toBot:()=>navigation++,voiceTTS:{supported:false,cancel(){}}});
 try{await c.handleAction('savings-jar-new',{},{});s.updateJarEditor(n,{name:'电脑'});const revision=n.savingsEditor.revision;await c.handleAction('savings-editor-save',{dataset:{revision:String(revision)}},{});await c.handleAction('savings-editor-save',{dataset:{revision:String(revision)}},{});assert.equal(s.listSavingsJars(n).length,1);assert.equal(navigation,0);}finally{c.dispose();globalThis.location=old;}
});
test('editing a Bot jar updates its current summary and leaves its budget receipt untouched',async()=>{
 let n=state();const old=globalThis.location;globalThis.location={href:'http://127.0.0.1/?session=test'};
 const c=createCompanionController({getState:()=>n,commit:x=>n=structuredClone(x),esc:String,voiceTTS:{supported:false,cancel(){}}});
 try{
  s.startSavingsCoach(n,{now:c.now()});await c.handleAction('savings-accept-budget',{},{});await c.handleAction('savings-confirm-plan',{},{});
  const jarId=n.savingsJar.id,budget=JSON.stringify(n.nativeBudget),id=n.savingsCoach.id;
  await c.handleAction('savings-jar-adjust',{dataset:{jarId}},{});s.updateJarEditor(n,{name:'海边旅行',daily_minor:1500,target_minor:900000});
  await c.handleAction('savings-editor-save',{dataset:{revision:String(n.savingsEditor.revision)}},{});
  assert.equal(n.savingsJar.daily_minor,1500);assert.equal(n.savingsJar.target_minor,900000);assert.equal(JSON.stringify(n.nativeBudget),budget);
  const summary=n.messages.find(m=>m.planSummary&&m.planId===id);assert.match(summary.text,/15\.00/);assert.match(summary.text,/9,000\.00/);
  await c.handleAction('savings-jar-cancel',{dataset:{jarId}},{});await c.handleAction('savings-jar-cancel-confirm',{dataset:{jarId}},{});assert.equal(n.savingsJar.status,'cancelled');assert.match(n.messages.find(m=>m.planSummary&&m.planId===id).text,/已取消/);
 }finally{c.dispose();globalThis.location=old;}
});
test('the edited daily time controls execution and cannot debit earlier',()=>{
 const n=state();s.beginJarEditor(n,{now:NOW});s.updateJarEditor(n,{name:'下午储蓄',at_time:'15:30'});const op=s.savingsPlanOperation(n,n.savingsEditor,{now:NOW});s.applySavingsPlan(n,n.savingsEditor,{permit:permit(n,op),now:NOW});
 assert.equal(s.tickSavingsPlan(n,{now:Date.parse('2026-11-03T07:29:00Z')}).executed,false);
 assert.equal(s.tickSavingsPlan(n,{now:Date.parse('2026-11-03T07:30:00Z')}).executed,true);
 assert.equal(s.tickSavingsPlan(n,{now:Date.parse('2026-11-03T07:31:00Z')}).executed,false);
});
test('zero shopping reuses existing travel allocation without changing budget or balance',()=>{
 const n=state();n.nativeBudget={'2026-11':{month:'2026-11',revision:3,total_minor:800000,categories:[{category:'住房',limit_minor:350000},{category:'餐饮',limit_minor:200000},{category:'购物',limit_minor:0},{category:'其他',limit_minor:100000},{category:'旅行',limit_minor:150000}]}};
 const before=JSON.stringify(n.nativeBudget),cash=n.balance;s.startSavingsCoach(n,{now:NOW});assert.equal(n.savingsCoach.use_existing,true);assert.match(s.renderSavingsCoach(n),/拟定储蓄计划/);s.useExistingTravelBudget(n,n.savingsCoach,{now:NOW});assert.equal(n.savingsCoach.fields.daily_minor,2000);assert.equal(n.savingsJar,undefined);assert.equal(JSON.stringify(n.nativeBudget),before);assert.equal(n.balance,cash);
});
test('no shopping or travel allocation offers explicit inline budget confirmation',()=>{
 const n=state();n.nativeBudget={'2026-11':{month:'2026-11',revision:1,total_minor:800000,categories:[{category:'购物',limit_minor:0},{category:'其他',limit_minor:800000}]}};
 s.startSavingsCoach(n,{now:NOW});assert.match(s.renderSavingsCoach(n),/调整本月预算/);const old=JSON.stringify(n.nativeBudget),patch={total_minor:800000,category_0_minor:60000,category_1_minor:740000},op=s.editedBudgetOperation(n,n.savingsCoach,patch);assert.equal(JSON.stringify(n.nativeBudget),old);assert.throws(()=>s.applyEditedBudget(n,n.savingsCoach,patch,{permit:{},now:NOW}));s.applyEditedBudget(n,n.savingsCoach,patch,{permit:permit(n,op),now:NOW});assert.equal(n.nativeBudget['2026-11'].total_minor,800000);assert.equal(n.savingsCoach.reduction_minor,60000);
});
test('archive preserves exact recoverable records and hides only selected empty stopped jars',()=>{
 const n=state(),a=create(n,'轻薄本'),b=create(n,'备用金'),c=create(n,'旅行');s.pauseSavingsPlan(n,{source:USER,jarId:a.id});s.cancelJarPlan(n,b.id,{source:USER});const travel=JSON.stringify(s.listSavingsJars(n).find(j=>j.id===c.id));
 s.archiveEmptyJar(n,a.id,{source:USER,now:NOW});s.archiveEmptyJar(n,b.id,{source:USER,now:NOW});assert.deepEqual(s.listSavingsJars(n).map(j=>j.id),[c.id]);assert.equal(JSON.stringify(s.listSavingsJars(n)[0]),travel);assert.equal(n.savingsArchived[a.id].jar.name,'轻薄本');const reloaded=JSON.parse(JSON.stringify(n));assert.equal(s.listSavingsJars(reloaded).length,1);s.restoreArchivedJar(reloaded,a.id,{source:USER});assert.equal(s.listSavingsJars(reloaded).length,2);assert.equal(s.listSavingsJars(reloaded).find(j=>j.id===a.id).status,'paused_safety');assert.throws(()=>s.archiveEmptyJar(n,c.id,{source:USER,now:NOW}));
});
