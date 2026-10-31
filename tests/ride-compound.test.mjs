import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompoundFields,compoundMissing,mergeCompoundFields} from '../web/compound-fields.mjs';
import {createProactiveDemo,createLocalDemoAdapters,createDemoClock} from '../web/proactive-demo.mjs';
import {createProactiveSafetyBridge,proactiveSafetyOperation} from '../web/delegation-engine.mjs';
import {stepDetails,PLAN_ACTIONS} from '../web/plan-step-ui.mjs';
import * as policy from '../web/safety-policy.mjs';
import {fresh} from '../web/engine.mjs';
const copy=x=>structuredClone(x),USER={kind:'user',method:'click'};
const fields=()=>({items:[{id:'item-1',kind:'sms',contact_id:'mom',message:'妈妈，周六我回家吃饭。'},
 {id:'item-2',kind:'ride',date:'2026-11-07',departure_time:'16:00',origin:'学校东门',destination:'锦绣小区南门',fare_minor:8000,source_account:'living_1608'}]});
function setup(hook,snapshot,existingState){
 let state=existingState?copy(existingState):fresh();policy.ensureSafety(state);state.rideTest??={grants:{},effects:[]};
 const clock=createDemoClock('2026-11-02T01:00:00Z'),raw=createLocalDemoAdapters(),calls=[];
 const bridge=createProactiveSafetyBridge({policy,getState:()=>state,persist:s=>{state=copy(s);},getGrantId:op=>state.rideTest.grants[op.id],acceptReplay:()=>true,
  onCommitEffect(next,{operation,result,context}){assert.equal(operation.amountMinor,0);const key=operation.id+':v'+operation.revision;assert.ok(!next.rideTest.effects.some(x=>x.key===key));next.rideTest.effects.push({key,operation:context.step.operation,receipt:result.receipt_id,payload:copy(context.step.payload)});}});
 const manager=createProactiveDemo({clock,snapshot,safetyGate:bridge,adapters:{mode:'local_demo',reset:()=>raw.reset(),execute:async input=>{calls.push(copy(input));return hook?hook(input,raw):raw.execute(input);}}});
 const op=(plan,node)=>proactiveSafetyOperation({mode:'local_demo',plan_id:plan.id,revision:plan.revision,step:node,source:plan.source,now:clock.now()});
 function consent(id,stepId){const p=manager.getPlan(id),n=p.steps.find(x=>x.id===stepId),next=copy(state),operation=op(p,n);const grant=policy.authorizeSafety(next,operation,{source:USER,now:Date.parse(clock.now())});next.rideTest.grants[operation.id]=grant.id;state=next;manager.authorize(id,{revision:p.revision,step_ids:[stepId],confirmed:true,expires_at:new Date(Date.parse(clock.now())+300000).toISOString()});}
 return {manager,clock,calls,consent,state:()=>copy(state),replace:s=>{state=copy(s);},op};
}
test('ride slots require date, time, route, fare cap and account without dropping the SMS',()=>{
 const incomplete={items:[fields().items[0],{id:'item-2',kind:'ride'}]};
 assert.deepEqual(compoundMissing(incomplete),['items.1.date','items.1.departure_time','items.1.origin','items.1.destination','items.1.fare_minor','items.1.source_account']);
 const filled=mergeCompoundFields(incomplete,{'items.1.date':'2026-11-07','items.1.departure_time':'16:00','items.1.origin':'学校东门','items.1.destination':'锦绣小区南门','items.1.fare_minor':8000,'items.1.source_account':'living_1608'});
 assert.deepEqual(filled,fields());assert.deepEqual(compoundMissing(filled),[]);
});
test('ride input is bounded inert data; invalid dates, fees, locations and authority fields fail',()=>{
 for(const [key,value] of [['date','2026-02-30'],['departure_time','25:00'],['fare_minor',200001],['fare_minor',0],['fare_minor',1.5],['origin',''],['origin','x'.repeat(81)],['destination','<script>'],['origin','地\n点'],['source_account','other'],['authorized',true],['driver_phone','13800000000']]){
  const f=fields();f.items[1][key]=value;assert.throws(()=>validateCompoundFields(f));
 }
 const f=fields();f.items[1].origin=' 学校东门 ';assert.equal(validateCompoundFields(f).items[1].origin,'学校东门');
 const manager=setup().manager;const same=fields();same.items[1].destination=same.items[1].origin;assert.throws(()=>manager.createCompoundPlan(same));
 const past=fields();past.items[1].date='2026-11-01';assert.throws(()=>manager.createCompoundPlan(past));
});
test('SMS and ride each require their own consent and complete only with local receipts; no fare is debited',async()=>{
 const h=setup(),p=h.manager.createCompoundPlan(fields(),{request_id:'ride-turn-1'}),before=h.state();
 assert.deepEqual(p.steps.map(n=>n.operation),['send_sms','reserve_ride']);assert.deepEqual(p.steps[1].dependencies,['item-1.sms']);
 assert.equal(p.planned_total_minor,8000);assert.equal(h.op(p,p.steps[1]).amountMinor,0);
 await h.manager.run(p.id);assert.equal(h.calls.length,0);
 h.consent(p.id,'item-1.sms');await h.manager.run(p.id);assert.equal(h.calls.length,1);assert.equal(h.manager.getPlan(p.id).steps[1].status,'needs_confirmation');
 h.consent(p.id,'item-2.ride.reserve');await h.manager.run(p.id);const done=h.manager.getPlan(p.id);assert.equal(done.status,'succeeded');
 assert.equal(h.calls.length,2);assert.equal(h.state().balance,before.balance);assert.deepEqual(h.state().ledger,before.ledger);
 const receipt=h.manager.snapshot().receipts.find(r=>r.step_id==='item-2.ride.reserve');assert.equal(receipt.evidence.ride_reservation.paid_minor,0);assert.equal(receipt.evidence.actual_external_effect,false);assert.equal(receipt.evidence.mcp_connected,false);
 assert.equal(receipt.evidence.ride_reservation.fare_cap_minor,8000);
 await h.manager.run(p.id);await h.manager.tick({execute:true});assert.equal(h.calls.length,2);assert.equal(h.state().rideTest.effects.length,2);
 assert.equal(h.manager.createCompoundPlan(fields(),{request_id:'ride-turn-1'}).id,p.id);
});
test('changing ride fare or route revokes its old consent while preserving completed SMS',async()=>{
 const h=setup(),p=h.manager.createCompoundPlan(fields());h.consent(p.id,'item-1.sms');await h.manager.run(p.id);h.consent(p.id,'item-2.ride.reserve');
 const before=h.manager.getPlan(p.id),oldOp=h.op(before,before.steps[1]);
 const changed=h.manager.clarifyCompound(p.id,{'items.1.fare_minor':6000,'items.1.destination':'家附近地铁站'});
 assert.notEqual(h.op(changed,changed.steps[1]).parameters,oldOp.parameters);
 await h.manager.run(p.id);assert.equal(h.calls.length,1);
 h.consent(p.id,'item-2.ride.reserve');await h.manager.run(p.id);assert.equal(h.calls.length,2);assert.equal(h.calls[1].step.payload.fare_minor,6000);assert.equal(h.manager.getPlan(p.id).status,'succeeded');
});
test('cancellation, safety lock and reset discard an in-flight ride result and never replay it',async()=>{
 for(const action of ['cancel','lock','reset']){
  let enter,release;const started=new Promise(r=>enter=r),hold=new Promise(r=>release=r);
  const h=setup(async(input,raw)=>{if(input.step.operation==='reserve_ride'){enter();await hold;}return raw.execute(input);});const p=h.manager.createCompoundPlan(fields());
  h.consent(p.id,'item-1.sms');await h.manager.run(p.id);h.consent(p.id,'item-2.ride.reserve');const running=h.manager.run(p.id);await started;
  if(action==='cancel')h.manager.cancel(p.id);else if(action==='reset')h.manager.reset();else{const state=h.state();policy.lockSafety(state,'manual_lock',{now:Date.parse(h.clock.now())});h.replace(state);h.manager.setLocked(true);}
  release();await running;assert.equal(h.state().rideTest.effects.length,1);assert.equal(h.calls.length,2);
  if(action!=='reset'){await h.manager.run(p.id);assert.equal(h.state().rideTest.effects.length,1);assert.equal(h.calls.length,2);}
 }
});
test('failed ride remains unfinished without a success receipt or automatic paid retry',async()=>{
 const h=setup((input,raw)=>input.step.operation==='reserve_ride'?{status:'failed',reason:'暂无匹配行程'}:raw.execute(input));const p=h.manager.createCompoundPlan(fields());
 h.consent(p.id,'item-1.sms');await h.manager.run(p.id);h.consent(p.id,'item-2.ride.reserve');await h.manager.run(p.id);
 const ride=h.manager.getPlan(p.id).steps[1];assert.notEqual(ride.status,'succeeded');assert.ok(!ride.receipt_id);assert.equal(h.state().rideTest.effects.length,1);
 await h.manager.run(p.id);assert.equal(h.calls.filter(c=>c.step.operation==='reserve_ride').length,1);
});
test('restored completed SMS does not silently authorize the remaining ride',async()=>{
 const a=setup(),p=a.manager.createCompoundPlan(fields());a.consent(p.id,'item-1.sms');await a.manager.run(p.id);
 const b=setup(undefined,a.manager.snapshot(),a.state());await b.manager.run(p.id);assert.equal(b.calls.length,0);
 b.consent(p.id,'item-2.ride.reserve');await b.manager.run(p.id);assert.equal(b.calls.length,1);assert.equal(b.calls[0].step.operation,'reserve_ride');
});
test('ride confirmation exposes route, time, cap and no-payment boundary',()=>{
 const h=setup(),p=h.manager.createCompoundPlan(fields()),node=p.steps[1],html=stepDetails(node,{esc:x=>String(x),money:n=>'¥'+n/100,target:'预约回家顺风车'});
 for(const text of ['学校东门','锦绣小区南门','2026-11-07 16:00','车费上限','¥80','确认预约，不扣车费。','费用来源'])assert.ok(html.includes(text));
 assert.equal(PLAN_ACTIONS.reserve_ride.confirm,'确认预约');assert.match(PLAN_ACTIONS.reserve_ride.done,/未支付/);
});
