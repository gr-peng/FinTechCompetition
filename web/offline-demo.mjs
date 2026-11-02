import {validateCompanionResult,compoundMissing,mergeCompoundFields} from './companion-planner.mjs';
import {getRiskSource} from './risk-sources.mjs';

// An explicit, finite presentation adapter, never an online-model fallback.
// Produces inert proposals only. The ordinary controller retains every gate.
export const offlineEnabled=href=>new URL(href).searchParams.get('offline')==='1';
export const OFFLINE_PROMPTS=Object.freeze({
 recipient:'给陈宇转300元，卡号0000000000006217。',
 seller:'给闲鱼卖家转2000元，卡号0000000000008891。',
 ride:'跟妈妈说我周六中午回家吃饭，帮我约辆周六上午从学校回家的顺风车，出发前记得提醒我。',
 rideDetails:'11月7日上午9点，从学校东门到锦绣小区南门，车费最多80元，从生活账户1608出。',
 birthday:'林夏11月9日生日，预算1200元，帮我安排上海的双人晚餐和六寸草莓蛋糕，联系陈老板并从生活账户1608支付50元定金，当天13:14转账520元。',
 savings:'手里有点钱，想理一理。',
});
const actions={wealth_guide:'prepare_wealth',security_case:'show_security_case',compound:'prepare_compound',birthday:'prepare_birthday',rent_reminder:'prepare_rent',subscription_reminder:'prepare_subscription',savings_coach:'prepare_savings',plan_control:'control_plan'};
const cards={wealth_guide:'wealth_plan',security_case:'security_notice',compound:'compound_plan',birthday:'birthday_plan',rent_reminder:'rent_plan',subscription_reminder:'subscription_plan',savings_coach:'savings_plan',plan_control:'plan_control'};
const normalize=x=>String(x||'').replace(/[\s，。！？、,!?]/g,'');
export function groupOfflineConversation(state,result,context,originTurnId,output){
 const draft=state.companion?.modelDraft;
 if(result.status==='clarify'&&draft?.draft_id)output.planId=draft.draft_id;
 if(!output.planId)return;
 const oldId=result.context_action==='continue'?context?.draft_id:null;
 for(const message of state.messages)if(message.id===originTurnId||oldId&&message.planId===oldId)message.planId=output.planId;
}
function proposal(scenario,fields,reply,extra={}){
 const value={scenario,status:'propose',reply,speak:null,fields,missing:[],mode:'create',task_id:null,query:null,period_month:null,context_action:'new',cards:[{type:cards[scenario]}],actions:[{type:actions[scenario]}],...extra};
 return validateCompanionResult(value);
}
const answer=reply=>({scenario:'other',status:'answer',reply,speak:null,fields:{},missing:[],mode:'none',task_id:null,query:null,period_month:null,context_action:'none',cards:[],actions:[]});
function compound(fields,{context=null}={}){
 const missing=compoundMissing(fields),continued=!!context;
 return proposal('compound',fields,missing.length?'短信和顺风车一起安排。还需要出发时间、上下车地点和车费上限。':'请逐项核对短信和顺风车，确认一项才推进一项。',{
  status:missing.length?'clarify':'propose',missing,mode:missing.length?'none':continued&&context.plan_id?'update':'create',task_id:!missing.length&&context?.plan_id||null,context_action:continued?'continue':'new',
  cards:[{type:missing.length?'clarification':'compound_plan'}],actions:missing.length?[]:[{type:'prepare_compound'}],
 });
}
export function offlineResult(request,{programEvent=false,formContinuation=false}={}){
 const text=normalize(request.text),context=request.run_companion;
 let result;
 const event=programEvent?request.run_event:null,source=getRiskSource(event?.type);
 if(source&&event.fixture_id===source.source_id)result=proposal('security_case',{case_id:source.case_id},source.summary);
 else if(event?.type==='rent_due')result=proposal('rent_reminder',{},'房东提醒11月房租3500元到期了，要安排这一期吗？');
 else if(event?.type==='subscription_due')result=proposal('subscription_reminder',{},'云音乐每月28日续费25元。这次只续一个月，还是取消下次续费？',{status:'clarify',mode:'none',missing:['subscription_action'],cards:[{type:'clarification'}],actions:[]});
 else if(/^给(.{1,20})转(\d+(?:\.\d{1,2})?)元卡号(\d{16})$/.test(text)){
  const [,name,amount,card]=text.match(/^给(.{1,20})转(\d+(?:\.\d{1,2})?)元卡号(\d{16})$/);
  result=proposal('security_case',{case_id:'unfamiliar_recipient',recipient_name:name,recipient_card_number:card,amount_minor:Math.round(Number(amount)*100),source_account:'living_1608'},'先核对收款人和这张卡的转账记录。');
 }else if(context?.scenario==='compound'&&(formContinuation||text===normalize(OFFLINE_PROMPTS.rideDetails))){
  const patch=formContinuation?{}:{'items.1.date':'2026-11-07','items.1.departure_time':'09:00','items.1.origin':'学校东门','items.1.destination':'锦绣小区南门','items.1.fare_minor':8000,'items.1.source_account':'living_1608'};
  result=compound(mergeCompoundFields(context.fields,patch),{context});
 }else if(context?.scenario==='birthday'&&formContinuation){
  const missing=['birthday_date','budget_minor','partner_id','city','source_account'].filter(k=>context.fields[k]==null);
  result=proposal('birthday',context.fields,'请核对更新后的生日安排。',{status:missing.length?'clarify':'propose',missing,mode:missing.length?'none':context.plan_id?'update':'create',task_id:missing.length?null:context.plan_id||null,context_action:'continue',cards:[{type:missing.length?'clarification':'birthday_plan'}],actions:missing.length?[]:[{type:'prepare_birthday'}]});
 }else if(text===normalize(OFFLINE_PROMPTS.ride))result=compound({items:[{id:'item-1',kind:'sms',contact_id:'mom',message:'妈妈，我周六中午回家吃饭。'},{id:'item-2',kind:'ride',date:'2026-11-07',source_account:'living_1608',reminder_before_minutes:60}]});

 else if(text===normalize(OFFLINE_PROMPTS.birthday))result=proposal('birthday',{birthday_date:'2026-11-09',budget_minor:120000,partner_id:'partner-linxia',city:'上海',source_account:'living_1608'},'晚餐、联系蛋糕店、定金和生日转账分开核对，每一步由你确认。');
 else if([OFFLINE_PROMPTS.savings,'有点闲钱，想打理一下。','最近想攒点钱。'].some(x=>normalize(x)===text))result=proposal('wealth_guide',{},'先选一个方向，我们一步一步来。');
 else if(context?.scenario==='wealth_guide')result=proposal('wealth_guide',{choice:/^\d+元$/.test(text)?String(Number(text.slice(0,-1))*100):text},'按你的选择继续核对。',{context_action:'continue'});
 else if(context?.scenario==='savings_coach'&&/^(先不调整|不同意|取消|先不办了)$/.test(text))result=proposal('savings_coach',{proposal_action:'reject'},'先不调整，保留原来的预算。',{context_action:'continue'});
 else if(context?.scenario==='savings_coach'&&/^改成\d+元$/.test(text))result=proposal('savings_coach',{proposal_action:'adjust',reduction_minor:Number(text.match(/\d+/)[0])*100},'已按这个金额重拟建议，请核对后再确认。',{context_action:'continue'});
 else if(context?.scenario==='savings_coach'&&/^(同意|可以|就这么办)$/.test(text))result=answer('请点击当前方案的确认按钮，核对预算后再安排储蓄。');
 else if(context?.scenario==='subscription_reminder'&&(formContinuation&&context.fields.subscription_action||/续一个月|不续|取消下次续费/.test(text))){
  const action=formContinuation?context.fields.subscription_action:(/不续|取消/.test(text)?'cancel':'keep');result=proposal('subscription_reminder',{subscription_action:action},action==='cancel'?'请核对取消下次续费，当前权益保留。':'只安排本期25元，请核对。',{context_action:'continue'});
 }else if(context?.scenario==='rent_reminder'&&text===normalize('这次房租从生活账户1608出，只付11月这一期。'))result={...answer('已保留11月这一期，请在房租卡上核对并确认。'),context_action:'continue'};
 else if(context&&(context.plan_id||context.draft_id)&&/^(先不办了|取消|取消这次安排|顺风车先不约了)$/.test(text))result=proposal('plan_control',{plan_action:'cancel'},'已取消未完成的后续安排。',{mode:'update',task_id:context.plan_id||context.draft_id,context_action:'continue'});
 else if(/^(你好|hi|hello)$/i.test(text))result=answer('你好，小林。想先看看账单，还是安排一件事？');
 else result=answer('离线展示支持左侧示例和卡片里的修改、确认。自由提问请切换在线模式。');
 return {source:'preset',provider:null,result};
}
