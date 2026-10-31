import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh} from '../web/engine.mjs';
import {createCompanionController} from '../web/companion-controller.mjs';
import {lockSafety,DEMO_VERIFICATION_CODE} from '../web/safety-policy.mjs';

// Actual delivered controller with deterministic microphone/model boundaries.
// These are integration fixtures, never evidence of a real LLM or human speech.
const fields={birthday_date:'2026-11-09',budget_minor:120000,partner_id:'partner-linxia',city:'上海',source_account:'living_1608'};
const model=(scenario,status,extra={})=>({scenario,status,reply:'这是一条来自本次受控模型响应的自然回复。',speak:null,
 fields:{},missing:[],mode:status==='propose'?'create':'none',task_id:null,query:null,period_month:null,
 context_action:'none',cards:[],actions:[],...extra});
const birthday=(extra={})=>model('birthday','propose',{fields:{...fields},cards:[{type:'birthday_plan'}],actions:[{type:'prepare_birthday'}],...extra});
const clarify=(extra={})=>model('birthday','clarify',{fields:{},missing:['birthday_date','budget_minor','partner_id','city','source_account'],cards:[{type:'clarification'}],...extra});
const control=(id,action)=>model('plan_control','propose',{fields:{plan_action:action},mode:'update',task_id:id,context_action:'continue',cards:[{type:'plan_control'}],actions:[{type:'control_plan'}]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const birthdayWrites=['restaurant.reserve','cake.message','cake.deposit','birthday.schedule','birthday.transfer'];
async function confirmStep(h,id,stepId){
 await waitUntil(()=>{const p=h.controller.manager.getPlan(id),n=p.steps.find(x=>x.id===stepId);return !!n&&(n.dependencies||[]).every(d=>p.steps.find(x=>x.id===d)?.status==='succeeded');});
 const plan=h.controller.manager.getPlan(id);
 return h.controller.handleAction('plan-confirm',{dataset:{plan:id,step:stepId,revision:String(plan.revision)}},{isTrusted:true});
}
async function prepareBirthday(h,id,{until='birthday.transfer'}={}){
 for(const stepId of birthdayWrites){await confirmStep(h,id,stepId);if(stepId===until)break;}
}

async function waitUntil(predicate){
 const end=performance.now()+2000;
 while(!predicate()){
  if(performance.now()>=end)throw Error('The intended asynchronous write boundary was not reached');
  await new Promise(resolve=>setTimeout(resolve,2));
 }
}
async function withFormData(run){
 const previous=globalThis.FormData;
 globalThis.FormData=class {constructor(form){this.fields=form.fields;}get(key){return this.fields[key]??null;}*[Symbol.iterator](){yield* Object.entries(this.fields);}};
 try{return await run();}finally{globalThis.FormData=previous;}
}

async function withController(run){
 const savedLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),savedFetch=globalThis.fetch;
 let current=fresh(),controller,networkCalls=0,aborts=0,stops=0;
 current.reduceMotion=true;
 const captures=[],fills=[],sends=[],events=[],errors=[];
 const input={supported:true,start(callbacks){captures.push(callbacks);},abort(){aborts++;}};
 Object.defineProperty(globalThis,'location',{value:{href:'http://127.0.0.1:65321/?session=bot-minimal-test&app=1#/bot'},configurable:true});
 globalThis.fetch=async()=>{networkCalls++;throw Error('No network is permitted by this controller test');};
 try{
  controller=createCompanionController({getState:()=>current,commit:next=>{current=structuredClone(next);},esc:value=>String(value),
   voiceInput:input,voiceScope:{navigator:{userActivation:{isActive:true}}},repaint(){},
   onVoiceText:(text,options)=>fills.push({text,...options}),onVoiceEvent:event=>events.push(event),
   onSend:(text,options)=>sends.push({text,options}),onStop:()=>{stops++;},onError:message=>errors.push(message)});
  const h={controller,get state(){return current;},fills,sends,events,errors,captures,
   get networkCalls(){return networkCalls;},get aborts(){return aborts;},get stops(){return stops;},
   emit(text,isFinal=true,index=captures.length-1){captures[index].onResult({text,isFinal});},
   toggle:()=>controller.handleAction('voice-toggle',{}, {isTrusted:true})};
  await run(h);
  assert.equal(networkCalls,0,'these integration fixtures must not silently call a real provider or TTS');
 }finally{
  controller?.dispose();globalThis.fetch=savedFetch;
  if(savedLocation)Object.defineProperty(globalThis,'location',savedLocation);else delete globalThis.location;
 }
}

test('ordinary greetings and birthday words are never intercepted by a local reply or preset plan',async()=>{
 await withController(async h=>{
  const before={messages:structuredClone(h.state.messages),tasks:structuredClone(h.state.tasks),balance:h.state.balance};
  for(const text of ['hi','你好','女朋友下周生日，帮我安排一下','帮我看看订阅'])assert.equal(await h.controller.handleText(text),false);
  assert.deepEqual(h.state.messages,before.messages);assert.deepEqual(h.state.tasks,before.tasks);
  assert.equal(h.state.balance,before.balance);assert.equal(h.controller.manager.snapshot().plans.length,0);
  assert.equal(h.sends.length,0);assert.equal(Object.keys(h.state.safety.grants).length,0);
 });
});

test('an idle Bot has no scenario directory, demonstration panel, permanent audit or voice options',async()=>{
 await withController(async h=>{
  assert.equal(h.controller.render(),'');
  const html=h.controller.renderVoice();
  assert.equal((html.match(/<button\b/g)||[]).length,1);
  assert.match(html,/aria-label="开始收音"/);assert.match(html,/aria-pressed="false"/);
  assert.doesNotMatch(html,/<select\b|<option\b|data-action="demo-|演示控制|查看处理依据|声纹|语音引擎|设备选择|模型选择/);
 });
});

test('one microphone collects final segments and only fills the input on stop, without automatic sending',async()=>{
 await withController(async h=>{
  assert.equal(h.captures.length,0,'construction must never acquire a microphone');
  await h.toggle();assert.equal(h.captures.length,1);
  assert.equal(h.controller.voiceState().listening,true);
  assert.match(h.controller.renderVoice(),/aria-label="停止收音"/);
  h.emit('帮我核对本月房租');h.emit('先不要付款');
  assert.deepEqual(h.fills.map(x=>x.interim),[true,true]);
  assert.equal(h.sends.length,0);assert.equal(h.state.companion.activePlanId,null);
  await h.toggle();
  assert.equal(h.controller.voiceState().listening,false);
  assert.match(h.controller.renderVoice(),/aria-label="开始收音"/);
  assert.deepEqual(h.fills.filter(x=>!x.interim),[{text:'帮我核对本月房租 先不要付款',interim:false}]);
  assert.equal(h.sends.length,0);assert.equal(h.stops,1);
  const count=h.fills.length;h.emit('这是已经停止的旧结果');
  await h.controller.stopVoiceInput();assert.equal(h.fills.length,count);assert.equal(h.sends.length,0);
 });
});

test('interim-only recognition remains a text draft and does not create consent or execution',async()=>{
 await withController(async h=>{
  const balance=h.state.balance;
  await h.toggle();h.emit('给妈妈转五百元',false);
  assert.deepEqual(h.fills,[{text:'给妈妈转五百元',interim:true}]);
  await h.toggle();
  assert.deepEqual(h.fills.at(-1),{text:'给妈妈转五百元',interim:false});
  assert.equal(h.sends.length,0);assert.equal(h.state.balance,balance);
  assert.equal(Object.keys(h.state.safety.grants).length,0);assert.equal(Object.keys(h.state.safety.executions).length,0);
 });
});

test('cancelling the current view discards recording buffers and ignores late ASR callbacks',async()=>{
 await withController(async h=>{
  await h.toggle();h.emit('尚未发送的识别文字');
  const old=h.captures[0],count=h.fills.length;
  h.controller.resetView();assert.equal(h.controller.voiceState().listening,false);
  old.onResult({text:'取消后的迟到付款指令',isFinal:true});
  await h.controller.stopVoiceInput();
  assert.equal(h.fills.length,count);assert.equal(h.fills.filter(x=>!x.interim).length,0);
  assert.equal(h.sends.length,0);assert.equal(h.controller.render(),'');
 });
});

test('safety lock stops recording and old callbacks cannot refill or authorize a later session',async()=>{
 await withController(async h=>{
  await h.toggle();h.emit('这句尚未发送');const old=h.captures[0],count=h.fills.length;
  lockSafety(h.state,'password_failures',{now:h.controller.now()});h.controller.sync();
  assert.equal(h.controller.voiceState().listening,false);assert.equal(h.state.safety.locked,true);
  old.onResult({text:'旧会话的确认向林夏转账520元',isFinal:true});
  await h.controller.stopVoiceInput();
  assert.equal(h.fills.length,count);assert.equal(h.sends.length,0);
  assert.equal(Object.keys(h.state.safety.grants).length,0);
  assert.match(h.controller.renderVoice(),/aria-pressed="false"/);
 });
});

test('recognition errors restore the one-button idle state and preserve a short text fallback',async()=>{
 await withController(async h=>{
  await h.toggle();h.emit('尚未完成的口述',false);const previous=h.fills.length;
  h.captures[0].onError({code:'not-allowed'});
  assert.equal(h.controller.voiceState().listening,false);
  assert.match(h.controller.renderVoice(),/aria-label="开始收音"/);
  assert.deepEqual(h.errors,['暂时无法收音，请输入文字。']);
  h.captures[0].onResult({text:'被拒绝后的旧结果',isFinal:true});await h.controller.stopVoiceInput();
  assert.equal(h.fills.length,previous);assert.equal(h.sends.length,0);
 });
});

test('a model proposal prepares bounded birthday cards but cannot grant consent or post money',async()=>{
 await withController(async h=>{
  const balance=h.state.balance,rows=h.state.ledger.length,messages=h.state.messages.length;
  const output=h.controller.applyModelResult(birthday());await tick();
  assert.equal(output.text,'这是一条来自本次受控模型响应的自然回复。');assert.equal(output.speak,null);
  assert.equal(h.controller.manager.snapshot().plans.length,1);
  assert.equal(h.controller.manager.getPlan(h.state.companion.activePlanId).kind,'birthday');
  assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
  assert.equal(Object.keys(h.state.safety.grants).length,0);
  assert.equal(h.state.messages.length,messages,'the controller must not add a canned duplicate of the model reply');
  assert.doesNotMatch(h.controller.render(),/companion-demo-controls|data-action="demo-|companion-voice-engine|companion-voice-identity/);
 });
});

test('continuing clarification retains prior known slots when the next normalized response omits them',async()=>{
 await withController(async h=>{
  h.controller.applyModelResult(clarify({fields:{birthday_date:'2026-11-09',city:'上海'},missing:['budget_minor','partner_id','source_account']}));
  h.controller.applyModelResult(clarify({fields:{budget_minor:120000},missing:['partner_id','source_account'],context_action:'continue'}));
  assert.deepEqual(h.controller.modelContext().fields,{birthday_date:'2026-11-09',city:'上海',budget_minor:120000});
  assert.deepEqual(h.controller.modelContext().missing,['partner_id','source_account']);
  assert.equal(h.controller.manager.snapshot().plans.length,0);
  assert.equal(Object.keys(h.state.safety.grants).length,0);
 });
});

test('clarification form returns explicit edits to the normal model sender instead of creating a local preset reply',async()=>{
 await withController(async h=>{
  h.controller.applyModelResult(clarify({fields:{birthday_date:'2026-11-09',city:'上海'},missing:['budget_minor','partner_id','source_account']}));
  const savedFormData=globalThis.FormData,messages=h.state.messages.length;
  globalThis.FormData=class {constructor(form){this.fields=form.fields;}*[Symbol.iterator](){yield* Object.entries(this.fields);}};
  try{
   const handled=await h.controller.handleSubmit({target:{id:'companion-model-form',fields:{budget_minor:'1200',partner_id:'partner-linxia',source_account:'living_1608'}}});
   assert.equal(handled,true);assert.equal(h.sends.length,1);
   assert.equal(h.sends[0].options.companionClarification,true);assert.match(h.sends[0].text,/预算：¥1,200\.00/);
   assert.deepEqual(h.controller.modelContext().fields,fields);
   assert.equal(h.state.messages.length,messages);assert.equal(h.controller.manager.snapshot().plans.length,0);
   assert.equal(Object.keys(h.state.safety.grants).length,0);
  }finally{globalThis.FormData=savedFormData;}
 });
});

test('new-task presentation replaces old cards while preserving unexecuted long-task history without authority',async()=>{
 await withController(async h=>{
  h.controller.applyModelResult(birthday());await tick();const oldId=h.state.companion.activePlanId;
  h.controller.applyModelResult(clarify({context_action:'new'}));
  assert.equal(h.state.companion.activePlanId,null);assert.equal(h.controller.modelContext().scenario,'birthday');
  assert.equal(h.controller.manager.getPlan(oldId).id,oldId);
  assert.doesNotMatch(h.controller.render(),/data-action="plan-confirm"/);
  assert.equal(Object.keys(h.state.safety.grants).length,0);
  h.controller.resetView();assert.equal(h.controller.render(),'');assert.equal(h.controller.modelContext(),null);
 });
});

test('model answer and legacy greetings stay inert and do not manufacture a task or speech fallback',async()=>{
 await withController(async h=>{
  const output=h.controller.applyModelResult(model('security_case','answer',{reply:'只解释安全规则，不发起操作。',speak:null}));
  assert.equal(output.text,'只解释安全规则，不发起操作。');assert.equal(output.speak,null);
  assert.equal(h.controller.applyModelResult(model('other','answer',{reply:'你好，有什么可以帮你？'})),null);
  assert.equal(h.controller.manager.snapshot().plans.length,0);assert.equal(h.controller.render(),'');
  assert.equal(Object.keys(h.state.safety.grants).length,0);assert.equal(Object.keys(h.state.safety.executions).length,0);
 });
});

test('each model-selected security variant uses actual program evidence without creating financial authority',async t=>{
 const cases=['unfamiliar_recipient','reported_scam','prompt_injection_email','prompt_injection_page','prompt_injection_tool','safe_external_content','voice_matched','voice_unknown','voice_mismatch'];
 for(const caseId of cases)await t.test(caseId,async()=>{
  await withController(async h=>{
   const balance=h.state.balance,rows=h.state.ledger.length;
   const sourceTypes={prompt_injection_email:['injection_email','external-mail-v1'],prompt_injection_page:['injection_page','external-page-v1'],prompt_injection_tool:['injection_order','external-order-v1'],safe_external_content:['safe_external_content','external-safe-v1']};
   const pair=sourceTypes[caseId];if(pair)h.state.companion.pendingEvent={type:pair[0],fixture_id:pair[1]};
   const fields={case_id:caseId,...(caseId==='reported_scam'?{recipient_name:'闲鱼卖家',recipient_card_number:'0000000000008891',amount_minor:200000}:{})};
   const output=h.controller.applyModelResult(model('security_case','propose',{fields,cards:[{type:'security_notice'}],actions:[{type:'show_security_case'}]}),{programEvent:!!pair});
   assert.equal(output.text,'这是一条来自本次受控模型响应的自然回复。');
   assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
   assert.equal(Object.keys(h.state.safety.grants).length,0);
   assert.equal(Object.values(h.state.safety.executions).some(e=>e.snapshot.writes),false);
   if(caseId==='unfamiliar_recipient'){
    assert.equal(h.state.companion.recipient.status,'details');assert.equal(h.state.companion.recipient.input.recipientName,null);
    assert.match(h.controller.render(),/companion-recipient-form/);assert.doesNotMatch(h.controller.render(),/多人举报/);
   }else if(caseId==='reported_scam'){
    assert.equal(h.state.companion.securityNotice.level,'red');assert.match(h.state.companion.securityNotice.detail,/合成收款记录有 7 条举报/);
    assert.equal(h.state.safety.locked,true);assert.equal(h.state.companion.recipient.review.evidence.report_count,7);

   }else if(caseId==='prompt_injection_tool'){assert.equal(h.state.safety.locked,false);assert.equal(h.state.companion.securityNotice,null);
   }else if(caseId.startsWith('prompt_injection_')){
    assert.ok(h.state.safety.audit.some(e=>e.type==='blocked'&&e.reason==='untrusted_authority'));
    assert.ok(h.state.safety.signals.some(e=>e.kind==='prompt_injection'));
    assert.equal(h.state.companion.securityNotice.caseId,caseId);
   }else if(caseId==='safe_external_content'){
    assert.equal(h.state.companion.securityNotice.level,'green');assert.equal(h.state.safety.locked,false);
    assert.ok(Object.values(h.state.safety.executions).some(e=>e.snapshot.kind==='read'));
   }else{
    assert.equal(h.controller.voiceState().identity.status,caseId==='voice_matched'?'matched':caseId==='voice_mismatch'?'mismatched':'unknown');
    assert.equal(h.controller.voiceState().identity.verified,false);
   }
   assert.doesNotMatch(h.controller.renderVoice(),/声纹|<select\b/);
  });
 });
});

test('subscription renewal and cancellation stay separate model choices rather than consent or a reminder dismissal',async()=>{
 await withController(async h=>{
  const balance=h.state.balance,rows=h.state.ledger.length;
  h.controller.applyModelResult(model('subscription_reminder','clarify',{missing:['subscription_action'],cards:[{type:'clarification'}]}));
  assert.match(h.controller.render(),/value="keep"/);assert.match(h.controller.render(),/value="cancel"/);
  assert.equal(h.controller.manager.snapshot().plans.length,0);
  h.controller.applyModelResult(model('subscription_reminder','propose',{fields:{subscription_action:'keep'},cards:[{type:'subscription_plan'}],actions:[{type:'prepare_subscription'}]}));
  await tick();const id=h.state.companion.activePlanId,first=h.controller.manager.getPlan(id);
  assert.equal(first.steps[0].operation,'renew_subscription');
  h.controller.applyModelResult(model('subscription_reminder','propose',{fields:{subscription_action:'cancel'},cards:[{type:'subscription_plan'}],actions:[{type:'prepare_subscription'}]}));
  await tick();const second=h.controller.manager.getPlan(h.state.companion.activePlanId);
  assert.equal(second.id,id);assert.ok(second.revision>first.revision);
  assert.equal(second.steps[0].operation,'cancel_subscription');assert.notEqual(second.status,'cancelled');
  assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);assert.equal(Object.keys(h.state.safety.grants).length,0);
 });
});

test('a matched unfamiliar recipient still requires a bound yellow demo password challenge before a one-time local debit',async()=>{
 await withController(async h=>withFormData(async()=>{
  const balance=h.state.balance,rows=h.state.ledger.length;
  h.controller.applyModelResult(model('security_case','propose',{fields:{case_id:'unfamiliar_recipient'},actions:[{type:'show_security_case'}]}));
  await h.controller.handleSubmit({target:{id:'companion-recipient-form',fields:{reference:'new-card-6217',cardNumber:'0000000000006217',recipientName:'陈宇',purpose:'相机维修',amount:'300',sourceAccount:'living_1608'}}});
  const id=h.state.companion.recipient.id;
  assert.equal(h.state.companion.recipient.review.status,'matched');
  await h.controller.handleAction('recipient-confirm',{}, {isTrusted:true});
  assert.equal(h.state.companion.recipient.status,'verify');assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
  const challenge=Object.values(h.state.safety.challenges).find(c=>c.operationId===id&&c.status==='pending');
  assert.ok(challenge);assert.equal(Object.values(h.state.safety.grants).find(g=>g.operationId===id).level,'yellow');
  await h.controller.handleSubmit({target:{id:'safety-challenge-form',dataset:{challenge:challenge.id},fields:{challengeCode:DEMO_VERIFICATION_CODE}}});
  assert.deepEqual(h.errors,[]);assert.equal(h.state.companion.recipient.status,'done');
  assert.equal(h.state.balance,balance-300);assert.equal(h.state.ledger.length,rows+1);
  assert.ok(h.state.companion.recipient.receipt);
  await assert.rejects(h.controller.handleAction('recipient-confirm',{}, {isTrusted:true}),/重新核对/);
  assert.equal(h.state.balance,balance-300);assert.equal(h.state.ledger.length,rows+1);
 }));
});

test('unknown and reported recipient reviews remain distinct and neither can create a payment grant',async t=>{
 for(const [reference,recipientName,purpose,status] of [['other-card-1234','新认识的人','代购物品','unverified'],['reported-card-8891','演示风险收款人','演示核验','reported']]){
  await t.test(status,async()=>withController(async h=>withFormData(async()=>{
   const balance=h.state.balance,rows=h.state.ledger.length;
   h.controller.applyModelResult(model('security_case','propose',{fields:{case_id:'unfamiliar_recipient'},actions:[{type:'show_security_case'}]}));
   await h.controller.handleSubmit({target:{id:'companion-recipient-form',fields:{reference,cardNumber:status==='reported'?'0000000000008891':'0000000000001234',recipientName,purpose,amount:'300',sourceAccount:'living_1608'}}});
   assert.equal(h.state.companion.recipient.review.status,status);
   assert.doesNotMatch(h.controller.render(),/data-action="recipient-confirm"/);
   await assert.rejects(h.controller.handleAction('recipient-confirm',{}, {isTrusted:true}),error=>error.code==='risk_blocked');
   assert.equal(Object.keys(h.state.safety.grants).length,0);assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
   assert.equal(h.state.companion.recipient.review.evidence.report_count,status==='reported'?7:0);
  })));
 }
});

test('cancelling after verified recipient dispatch invalidates its awaited result before money can commit',async()=>{
 await withController(async h=>withFormData(async()=>{
  const balance=h.state.balance,rows=h.state.ledger.length;
  h.controller.applyModelResult(model('security_case','propose',{fields:{case_id:'unfamiliar_recipient'},actions:[{type:'show_security_case'}]}));
  await h.controller.handleSubmit({target:{id:'companion-recipient-form',fields:{reference:'new-card-6217',cardNumber:'0000000000006217',recipientName:'陈宇',purpose:'相机维修',amount:'300',sourceAccount:'living_1608'}}});
  await h.controller.handleAction('recipient-confirm',{}, {isTrusted:true});
  const challenge=Object.values(h.state.safety.challenges).find(c=>c.status==='pending');assert.ok(challenge);
  const running=h.controller.handleSubmit({target:{id:'safety-challenge-form',dataset:{challenge:challenge.id},fields:{challengeCode:DEMO_VERIFICATION_CODE}}});
  assert.equal(h.state.companion.recipient.status,'running');
  await h.controller.handleAction('recipient-cancel',{}, {isTrusted:true});await running;
  assert.equal(h.state.companion.recipient,null);assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
  assert.equal(Object.values(h.state.safety.executions).some(e=>e.status==='completed'&&e.snapshot.writes),false);
  assert.ok(h.errors.length>0,'the invalidated callback must not be represented as a successful payment');
 }));
});

test('model plan controls require the exact visible plan and cannot be authorized by a program event',async()=>{
 await withController(async h=>{
  assert.throws(()=>h.controller.applyModelResult(control('not-active','cancel')),/当前安排/);
  h.controller.applyModelResult(birthday());await tick();const id=h.state.companion.activePlanId;
  const before=h.controller.manager.getPlan(id),balance=h.state.balance;
  for(const action of ['cancel','pause','resume']){
   assert.throws(()=>h.controller.applyModelResult(control(id,action),{programEvent:true}),/当前安排/);
   assert.throws(()=>h.controller.applyModelResult(control('different-plan-id',action)),/当前安排/);
   assert.equal(h.controller.manager.getPlan(id).status,before.status);
   assert.equal(h.controller.manager.getPlan(id).revision,before.revision);
  }
  assert.equal(h.state.balance,balance);assert.equal(h.state.companion.pausedPlans[id],undefined);
  assert.equal(Object.keys(h.state.safety.grants).length,0);
 });
});

test('text cancellation cancels the actual authorized plan and its future 520 transfer while retaining the paid deposit',async()=>{
 await withController(async h=>{
  const balance=h.state.balance,rows=h.state.ledger.length;
  h.controller.applyModelResult(birthday());const id=h.state.companion.activePlanId;
  await prepareBirthday(h,id);
  const prepared=h.controller.manager.getPlan(id);
  assert.equal(prepared.steps.find(n=>n.id==='cake.deposit').status,'succeeded');
  assert.equal(prepared.steps.find(n=>n.id==='birthday.transfer').status,'pending');
  assert.equal(h.state.balance,balance-50);assert.equal(h.state.ledger.length,rows+1);
  const output=h.controller.applyModelResult(control(id,'cancel'));
  assert.equal(output.text,'这是一条来自本次受控模型响应的自然回复。');
  assert.equal(h.controller.manager.getPlan(id).status,'cancelled');
  assert.equal(h.controller.manager.getPlan(id).steps.find(n=>n.id==='birthday.transfer').status,'cancelled');
  assert.equal(Object.values(h.state.safety.grants).some(g=>g.status==='ready'||g.status==='verification_required'),false);
  await h.controller.advanceDemoClock('advance_birthday_clock');await h.controller.manager.tick({execute:true});
  assert.equal(h.state.balance,balance-50);assert.equal(h.state.ledger.length,rows+1);
  assert.equal(h.controller.manager.getPlan(id).steps.find(n=>n.id==='cake.deposit').receipt_id,prepared.steps.find(n=>n.id==='cake.deposit').receipt_id);
  assert.ok(h.state.safety.audit.some(e=>e.type==='authorization_revoked'&&e.reason==='user_plan_control'));
 });
});

test('text pause revokes existing grants and text resume never replays them without fresh explicit confirmation',async()=>{
 await withController(async h=>{
  const balance=h.state.balance,rows=h.state.ledger.length;
  h.controller.applyModelResult(birthday());const id=h.state.companion.activePlanId;
  await prepareBirthday(h,id);
  const oldReady=Object.values(h.state.safety.grants).filter(g=>g.status==='ready').map(g=>g.id);
  assert.ok(oldReady.length>0);assert.equal(h.state.balance,balance-50);
  h.controller.applyModelResult(control(id,'pause'));
  assert.equal(h.state.companion.pausedPlans[id],'user_pause');
  for(const old of oldReady)assert.equal(h.state.safety.grants[old].status,'revoked');
  await h.controller.advanceDemoClock('advance_birthday_clock');
  assert.equal(h.state.balance,balance-50);assert.equal(h.state.ledger.length,rows+1);
  h.controller.applyModelResult(control(id,'resume'));
  assert.equal(h.state.companion.pausedPlans[id],false);
  await h.controller.manager.tick({execute:true});
  assert.equal(h.state.balance,balance-50);assert.equal(h.state.ledger.length,rows+1);
  for(const old of oldReady)assert.equal(h.state.safety.grants[old].status,'revoked');
  await confirmStep(h,id,'birthday.transfer');
  assert.equal(h.state.balance,balance-570);assert.equal(h.state.ledger.length,rows+2);
  await h.controller.manager.tick({execute:true});assert.equal(h.state.balance,balance-570);
 });
});

test('text cancellation during a birthday deposit dispatch rejects the late callback without a financial effect',async()=>{
 await withController(async h=>{
  const balance=h.state.balance,rows=h.state.ledger.length;
  h.controller.applyModelResult(birthday());const id=h.state.companion.activePlanId;
  await prepareBirthday(h,id,{until:'cake.message'});
   const beforeDeposit=h.controller.manager.getPlan(id);
   const confirming=h.controller.handleAction('plan-confirm',{dataset:{plan:id,step:'cake.deposit',revision:String(beforeDeposit.revision)}}, {isTrusted:true});
  await waitUntil(()=>Object.values(h.state.safety.executions).some(e=>e.status==='pending'&&e.snapshot.kind==='deposit'));
  assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
  h.controller.applyModelResult(control(id,'cancel'));await confirming;
  assert.equal(h.controller.manager.getPlan(id).status,'cancelled');
  assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
  assert.equal(Object.values(h.state.safety.executions).some(e=>e.status==='completed'&&e.snapshot.amountMinor>0&&['deposit','transfer'].includes(e.snapshot.kind)),false);
  await h.controller.advanceDemoClock('advance_birthday_clock');
  assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
 });
});

test('fixed demonstration clock events cannot choose arbitrary times, move backwards or authorize a payment',async()=>{
 await withController(async h=>{
  const balance=h.state.balance,rows=h.state.ledger.length;
  h.controller.applyModelResult(birthday());const id=h.state.companion.activePlanId;
  await h.controller.advanceDemoClock('advance_birthday_clock');
  assert.ok(h.controller.now()>=Date.parse('2026-11-09T05:14:00Z'));
  assert.notEqual(h.controller.manager.getPlan(id).steps.find(n=>n.id==='birthday.transfer').status,'succeeded');
  assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
  assert.equal(Object.keys(h.state.safety.grants).length,0);
  await h.controller.advanceDemoClock('advance_subscription_clock');
  assert.ok(h.controller.now()>=Date.parse('2026-11-28T01:00:00Z'));
  await assert.rejects(h.controller.advanceDemoClock('advance_birthday_clock'),/时钟不能倒退/);
  await assert.rejects(h.controller.advanceDemoClock('2026-12-01T01:00:00Z'),/时钟不能倒退/);
  await assert.rejects(h.controller.advanceDemoClock({type:'advance_birthday_clock',target:'2099-01-01'}),/时钟不能倒退/);
  assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
  assert.equal(Object.keys(h.state.safety.grants).length,0);
 });
});

test('text cancel can clear the exact known R8 draft without controlling unrelated tasks or long-term plans',async()=>{
 await withController(async h=>{
  const retained=h.controller.manager.createBirthdayPlan(fields),balance=h.state.balance,rows=h.state.ledger.length,tasks=structuredClone(h.state.tasks);
  const draft={id:'draft-family-500',scenario:'ambiguous',fields:{purpose:'family',amount_minor:50000},missing:['payee_id','source_account','scheduled_date']};
  h.state.agentDraft=structuredClone(draft);h.state.agentWorkspaceVisible=true;h.state.agentFocus='old-draft-focus';
  assert.throws(()=>h.controller.applyModelResult(control('other-draft-id','cancel')),/当前安排/);
  assert.throws(()=>h.controller.applyModelResult(control(draft.id,'cancel'),{programEvent:true}),/当前安排/);
  for(const action of ['pause','resume'])assert.throws(()=>h.controller.applyModelResult(control(draft.id,action)),/当前安排/);
  assert.deepEqual(h.state.agentDraft,draft);
  const output=h.controller.applyModelResult(control(draft.id,'cancel'));
  assert.equal(output.text,'这是一条来自本次受控模型响应的自然回复。');
  assert.equal(h.state.agentDraft,null);assert.equal(h.state.agentWorkspaceVisible,false);assert.equal(h.state.agentFocus,null);
  assert.deepEqual(h.controller.manager.getPlan(retained.id),retained);
  assert.deepEqual(h.state.tasks,tasks);assert.equal(h.state.balance,balance);assert.equal(h.state.ledger.length,rows);
  assert.equal(Object.keys(h.state.safety.grants).length,0);assert.equal(Object.keys(h.state.safety.executions).length,0);
 });
});


test('external attacks require an actual bound source, while a model label cannot invent an attack',async()=>{
 await withController(async h=>{
  const result=model('security_case','propose',{fields:{case_id:'prompt_injection_page'},actions:[{type:'show_security_case'}]});
  h.controller.applyModelResult(result);assert.equal(h.state.safety.locked,false);
  h.state.companion.pendingEvent={type:'injection_page',fixture_id:'wrong'};
  assert.equal(h.controller.inspectExternalSource('injection_page'),false);assert.equal(h.state.safety.locked,false);
  h.state.companion.pendingEvent.fixture_id='external-page-v1';
  assert.equal(h.controller.inspectExternalSource('injection_page'),true);assert.equal(h.state.safety.locked,true);
  assert.match(h.controller.render(),/查看处理依据/);assert.equal(Object.keys(h.state.safety.grants).length,0);
 });
});

test('natural transfer resolves a trusted contact without a purpose and cancellation requires fresh confirmation',async()=>{
 await withController(async h=>withFormData(async()=>{
  const before=h.state.balance;
  h.controller.applyModelResult(model('security_case','propose',{fields:{case_id:'unfamiliar_recipient',recipient_name:'陈宇',recipient_card_number:'0000000000006217',amount_minor:30000},actions:[{type:'show_security_case'}]}));
  assert.equal(h.state.companion.recipient.status,'review');assert.equal(h.state.companion.recipient.input.purpose,'转账');
  await h.controller.handleAction('recipient-confirm',{}, {isTrusted:true});
  const c=Object.values(h.state.safety.challenges).find(x=>x.status==='pending');
  assert.doesNotMatch(h.controller.render(),/123456/);assert.match(h.controller.render(),/type="password"/);assert.doesNotMatch(h.controller.render(),/本地验证器/);
  await h.controller.handleAction('safety-challenge-cancel',{dataset:{challenge:c.id}},{isTrusted:true});
  assert.equal(h.state.companion.recipient.status,'review');assert.equal(h.state.balance,before);
  assert.equal(h.state.safety.grants[c.grantId].status,'revoked');
  await h.controller.handleAction('recipient-confirm',{}, {isTrusted:true});
  const next=Object.values(h.state.safety.challenges).find(x=>x.status==='pending'&&x.id!==c.id);
  assert.ok(next);assert.notEqual(next.grantId,c.grantId);
 }));
});

test('a model risk label without matching trusted evidence cannot invent reports or a lock',async()=>{
 await withController(async h=>{
  h.controller.applyModelResult(model('security_case','propose',{fields:{case_id:'reported_scam',recipient_name:'陈宇',recipient_card_number:'0000000000006217',amount_minor:30000},actions:[{type:'show_security_case'}]}));
  assert.equal(h.state.safety.locked,false);assert.equal(h.state.companion.recipient.review.evidence.report_count,0);
  assert.equal(h.state.companion.recipient.review.status,'matched');
 });
});


test('external review verifies first, warns again, then cancels without sending or paying',async()=>{
 await withController(async h=>withFormData(async()=>{
  const before={balance:h.state.balance,ledger:structuredClone(h.state.ledger)};
  h.state.companion.pendingEvent={type:'injection_email',fixture_id:'external-mail-v1'};
  h.controller.inspectExternalSource('injection_email');
  assert.equal(h.state.safety.locked,true);
  assert.match(h.controller.render(),/输入密码/);
  assert.doesNotMatch(h.controller.render(),/已放弃处理|外部指令已拦截|class="companion-lock|123456/);
  await assert.rejects(h.controller.handleAction('source-review-cancel',{},{}),/先完成/);
  await h.controller.handleAction('source-review-verify',{}, {isTrusted:true});
  const c=Object.values(h.state.safety.challenges).find(c=>c.status==='pending');
  await h.controller.handleSubmit({target:{id:'safety-challenge-form',dataset:{challenge:c.id},fields:{challengeCode:DEMO_VERIFICATION_CODE}}});
  assert.deepEqual(h.errors,[]);assert.equal(h.state.safety.locked,false);
  assert.match(h.controller.render(),/仍然有风险|验证码和密钥|放弃处理|继续核对/);
  assert.doesNotMatch(h.controller.render(),/已放弃处理|已转账/);
  await h.controller.handleAction('source-review-continue',{}, {isTrusted:true});
  assert.match(h.controller.render(),/原订单或已保存的联系人/);
  await h.controller.handleAction('source-review-cancel',{}, {isTrusted:true});
  assert.match(h.controller.render(),/已放弃处理|没有发送任何信息/);
  assert.doesNotMatch(h.controller.render(),/仍然有风险|data-action="source-review-continue"/);
  assert.equal(h.state.balance,before.balance);assert.deepEqual(h.state.ledger,before.ledger);
  assert.equal(Object.keys(h.state.safety.grants).length,0);
  assert.equal(Object.keys(h.state.safety.executions).length,0);
 }));
});

test('external source review counts actual wrong passwords and never creates payment authority',async()=>{
 await withController(async h=>withFormData(async()=>{
  h.state.companion.pendingEvent={type:'injection_email',fixture_id:'external-mail-v1'};
  h.controller.inspectExternalSource('injection_email');
  await h.controller.handleAction('source-review-verify',{},{});
  const c=Object.values(h.state.safety.challenges).find(c=>c.status==='pending');
  for(let i=1;i<=3;i++){
   await h.controller.handleSubmit({target:{id:'safety-challenge-form',dataset:{challenge:c.id},fields:{challengeCode:'000000'}}});
   assert.equal(h.state.safety.failures.password,i);
  }
  assert.equal(h.state.safety.locked,true);assert.equal(h.state.safety.lock.reason,'password_failures');
  assert.equal(Object.keys(h.state.safety.grants).length,0);
  assert.equal(h.state.companion.securityNotice.stage,'locked');
 }));
});
