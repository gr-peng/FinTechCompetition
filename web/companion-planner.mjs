import {validateCompoundFields,compoundMissing} from './compound-fields.mjs';
export {validateCompoundFields,compoundMissing,mergeCompoundFields,COMPOUND_ITEM_FIELDS} from './compound-fields.mjs';
// A model may select a bounded local proposal. This module grants no authority,
// runs no adapters and never infers a scenario from the user's words.
const SCENARIOS=new Set(['birthday','rent_reminder','subscription_reminder','security_case','plan_control','compound','savings_coach']);
const LEGACY_SCENARIOS=new Set(['transfer','risk_transfer','subscription','budget_link','ambiguous','question','other','card_review']);
const STATUSES=new Set(['answer','clarify','propose','blocked','decline']);
const RESULT_KEYS=new Set(['status','scenario','reply','speak','query','fields','missing','mode','task_id','period_month','context_action','cards','actions']);
const BIRTHDAY_FIELDS=['birthday_date','budget_minor','partner_id','city','source_account'];
const FIELD_KEYS={birthday:BIRTHDAY_FIELDS,rent_reminder:[],subscription_reminder:['subscription_action'],security_case:['case_id','recipient_name','recipient_reference','recipient_card_number','amount_minor','source_account'],plan_control:['plan_action'],compound:['items'],savings_coach:['proposal_action','reduction_minor','daily_minor','source_account','start_date','target_minor']};
const ACTIONS={birthday:'prepare_birthday',rent_reminder:'prepare_rent',subscription_reminder:'prepare_subscription',security_case:'show_security_case',plan_control:'control_plan',compound:'prepare_compound',savings_coach:'prepare_savings'};
const CARDS={birthday:'birthday_plan',rent_reminder:'rent_plan',subscription_reminder:'subscription_plan',security_case:'security_notice',plan_control:'plan_control',compound:'compound_plan',savings_coach:'savings_plan'};
const CASES=new Set(['unfamiliar_recipient','reported_scam','prompt_injection','prompt_injection_email','prompt_injection_page','prompt_injection_tool','safe_external_content','voice_matched','voice_unknown','voice_mismatch']);
const CONTEXT_STATUSES=new Set(['awaiting_details','awaiting_authorization','awaiting_consent','needs_confirmation','pending','ready','scheduled','running','executing','paused','failed','succeeded','done','cancelled','blocked','clarify','review','permission','verify','unknown','needs_review','needs_input','awaiting_review','answer','propose','decline']);
const CONTROL=/[\u0000-\u001f\u007f]/;
const TEXT_CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const fail=()=>{const error=Error('模型安排格式无效，请重新说明这次安排。');error.code='invalid_companion_result';throw error;};
const plain=value=>!!value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const own=(value,key)=>plain(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
function record(value,allowed){
 if(!plain(value))fail();
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||!allowed.has(key))fail();
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!Object.hasOwn(descriptor,'value'))fail();
 }
 return value;
}
function text(value,limit,{optional=false}={}){
 if(optional&&value===null)return null;
 if(typeof value!=='string'||!value.trim()||value.length>limit||TEXT_CONTROL.test(value))fail();
 return value;
}
function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return false;
 const timestamp=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value;
}
function fieldValue(key,value){
 if(value===null)return null;
 if(key==='recipient_card_number'){if(typeof value!=='string'||!/^\d{16}$/.test(value))fail();return value;}
 if(key==='proposal_action'){if(!['accept','adjust','reject'].includes(value))fail();return value;}
 if(['reduction_minor','daily_minor','target_minor'].includes(key)){if(!Number.isSafeInteger(value)||value<1||value>2000000000)fail();return value;}
 if(key==='start_date'){if(!validDate(value))fail();return value;}
 if(key==='recipient_name'){return text(value,80);}
 if(key==='recipient_reference'){if(!['new-card-6217','reported-card-8891'].includes(value))fail();return value;}
 if(key==='amount_minor'){if(!Number.isSafeInteger(value)||value<1||value>2000000)fail();return value;}
 if(key==='birthday_date'){if(!validDate(value))fail();return value;}
 if(key==='budget_minor'){if(!Number.isSafeInteger(value)||value<1||value>2000000)fail();return value;}
 if(key==='partner_id'){if(value!=='partner-linxia')fail();return value;}
 if(key==='source_account'){if(!['living_1608','salary_0826'].includes(value))fail();return value;}
 if(key==='city'){text(value,40);if(value!==value.trim()||CONTROL.test(value)||/<[^>]*>/.test(value))fail();return value;}
 if(key==='plan_action'){if(!['cancel','pause','resume'].includes(value))fail();return value;}
 if(key==='case_id'){if(!CASES.has(value))fail();return value;}
 if(key==='subscription_action'){if(!['keep','cancel'].includes(value))fail();return value;}
 fail();
}
function fieldsFor(scenario,fields){
 if(scenario==='compound'){try{return validateCompoundFields(fields);}catch{fail();}}
 record(fields,new Set(FIELD_KEYS[scenario]));
 if(scenario!=='savings_coach'&&fields.source_account!=null&&fields.source_account!=='living_1608')fail();
 return Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,fieldValue(key,value)]));
}
function missingFor(scenario,missing,fields){
 if(scenario==='compound'){const allowed=compoundMissing(fields);if(!Array.isArray(missing)||missing.length>36||new Set(missing).size!==missing.length||missing.some(key=>!allowed.includes(key)))fail();return [...missing];}
 if(!Array.isArray(missing)||missing.length>5||new Set(missing).size!==missing.length||missing.some(key=>!FIELD_KEYS[scenario].includes(key)))fail();
 return [...missing];
}
function typeMarkers(values,kind,scenario,status){
 if(!Array.isArray(values)||values.length>8)fail();
 const result=values.map(value=>{
  record(value,new Set(['type']));const type=value.type;
  if(kind==='actions'){
   if(status!=='propose'||type!==ACTIONS[scenario])fail();
  }else if(type==='clarification'){
   if(status!=='clarify')fail();
  }else if(type==='fact'||type==='task_receipt'){
   if(!['answer','blocked','decline'].includes(status))fail();
  }else if(type!==CARDS[scenario])fail();
  return {type};
 });
 if(new Set(result.map(value=>value.type)).size!==result.length)fail();
 return result;
}

/** null delegates known R8 scenarios to their existing contract/handler.
 * New scenarios either return an inert normalized proposal or throw; validation
 * never creates a task, confirms a user, verifies identity or executes a tool.
 */
export function validateCompanionResult(result){
 if(!plain(result))fail();
 const scenario=own(result,'scenario');
 if(LEGACY_SCENARIOS.has(scenario))return null;
 if(!SCENARIOS.has(scenario))fail();
 record(result,RESULT_KEYS);
 const status=result.status;if(!STATUSES.has(status))fail();
 const reply=text(result.reply,240),speak=result.speak===undefined?null:text(result.speak,240,{optional:true});
 const fields=fieldsFor(scenario,result.fields===undefined?{}:result.fields),missing=missingFor(scenario,result.missing===undefined?[]:result.missing,fields);
 const mode=result.mode===undefined?(status==='propose'?'create':'none'):result.mode,task_id=result.task_id===undefined?null:result.task_id;
 if(!['none','create','update'].includes(mode)||task_id!==null&&(typeof task_id!=='string'||!task_id.trim()||task_id.length>100||CONTROL.test(task_id)))fail();
 if(status!=='propose'&&(mode!=='none'||task_id!==null)||status==='propose'&&(mode==='create'&&task_id!==null||mode==='update'&&!task_id))fail();
 const context_action=result.context_action===undefined?(mode==='update'?'continue':'none'):result.context_action;
 if(!['none','new','continue'].includes(context_action)||result.query!=null||result.period_month!=null)fail();
 const actions=typeMarkers(result.actions===undefined?[]:result.actions,'actions',scenario,status),cards=typeMarkers(result.cards===undefined?[]:result.cards,'cards',scenario,status);
 if(status==='clarify'&&!missing.length||status!=='clarify'&&missing.length)fail();
 if(status==='clarify'&&scenario==='birthday'&&fields.budget_minor!=null&&fields.budget_minor<103600&&!missing.includes('budget_minor'))fail();
 if(scenario==='plan_control'&&(status!=='propose'||mode!=='update'||!task_id||!fields.plan_action||context_action!=='continue'))fail();
 if(status==='propose'){
  if(!['create','update'].includes(mode)||actions.length!==1)fail();
  if(scenario==='compound'&&compoundMissing(fields).length)fail();
  if(scenario==='birthday'&&(BIRTHDAY_FIELDS.some(key=>fields[key]==null)||fields.budget_minor<103600))fail();
  if(scenario==='security_case'&&!CASES.has(fields.case_id))fail();
  if(scenario==='subscription_reminder'&&!['keep','cancel'].includes(fields.subscription_action))fail();
 }
 return {status,scenario,reply,speak,query:null,fields,missing,mode,task_id,period_month:null,context_action,cards,actions};
}

const sceneOf=value=>{
 const scenario=own(value,'scenario');if(scenario==='plan_control')return null;if(SCENARIOS.has(scenario))return scenario;
 return new Map([['birthday','birthday'],['rent','rent_reminder'],['subscription','subscription_reminder'],['security_case','security_case'],['compound','compound']]).get(own(value,'kind'))||null;
};
function selectContext(input,explicit){
 if(explicit!==undefined)return explicit;
 if(sceneOf(input))return input;
 const companion=own(input,'companion'),draft=own(companion,'modelDraft');
 if(sceneOf(draft))return draft;
 const active=own(companion,'activePlanId'),snapshot=own(companion,'proactiveSnapshot'),plans=own(snapshot,'plans');
 return typeof active==='string'&&Array.isArray(plans)?plans.find(plan=>own(plan,'id')===active):null;
}

// IDs are context metadata only. A local draft must never be promoted into a
// manager plan merely because its state object also has a generic `id` field.
function contextMetadata(selected,result){
 const revision=own(selected,'revision'),draft=own(selected,'draft_id'),status=own(selected,'status');
 const id=own(selected,'plan_id')??(Object.hasOwn(selected,'draft_id')?undefined:own(selected,'id'));
 if(Number.isInteger(revision)&&revision>=1&&revision<=2147483647)result.revision=revision;
 const valid=value=>typeof value==='string'&&value.trim()&&value.length<=100&&!CONTROL.test(value);
 if(valid(id))result.plan_id=id;
 if(valid(draft))result.draft_id=draft;
 if(CONTEXT_STATUSES.has(status))result.status=status;
 return result;
}

/** Only a selected plan/draft's slots cross the model boundary. Passing a full
 * state never copies ledger, messages, credentials, permissions or third-party
 * document text. Those documents cannot supply model instructions or consent.
 * Pass the selected plan explicitly as argument two to avoid state lookup.
 */
export function companionModelContext(stateOrPlan,plan){
 const selected=selectContext(stateOrPlan,plan),scenario=sceneOf(selected);if(!scenario)return null;
 const fields={},rawFields=own(selected,'fields');
 if(scenario==='compound'){let clean;try{clean=validateCompoundFields(rawFields||{});}catch{return null;}return contextMetadata(selected,{scenario,fields:clean,missing:compoundMissing(clean)});}
 for(const key of FIELD_KEYS[scenario]){
  const value=own(rawFields,key);if(value===undefined)continue;
  try{fields[key]=fieldValue(key,value);}catch{/* Malformed saved slots do not become model context. */}
 }
 const rawMissing=own(selected,'missing'),missing=Array.isArray(rawMissing)?[...new Set(rawMissing.filter(key=>FIELD_KEYS[scenario].includes(key)))].slice(0,5):[];
 return contextMetadata(selected,{scenario,fields,missing});
}
