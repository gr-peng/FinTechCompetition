// Local demonstration policy. No identity provider, bank, network, or credential store.
// All callers must apply effects on a clone, commit its permit, then persist that clone.
export const DEMO_VERIFICATION_CODE='123456';
export const SAFETY_DEFAULTS=Object.freeze({failureThreshold:3,transferThresholdMinor:100000,grantTTL:300000,challengeTTL:90000,maxGrantTTL:31*86400000});

const READ_KINDS=new Set(['read','query','lookup','readonly','read_only','research','inspect','remind','reminder']);
const RED_KINDS=new Set(['investment','wealth_purchase','card','card_lock','card_loss','card_unlock','password_change','change_password','paper_buy','paper_sell','stock-buy','stock-sell','buy','sell','trade']);
const TRANSFER_KINDS=new Set(['transfer','scheduled_transfer','birthday_transfer','deposit','payment']);
const HARD_FLAGS=new Set(['unverified_recipient','reported_scam','scam_reports','suspected_scam','multiple_reports','known_fraud','fraud_reported','untrusted_account_claim','prompt_injection','external_authorization']);
const CRITICAL_FLAGS=new Set(['reported_scam','scam_reports','suspected_scam','multiple_reports','known_fraud','fraud_reported','prompt_injection','external_authorization']);
const FAILURE_SIGNALS=new Map([['verification_failure','verification'],['password_failure','password'],['tool_failure','tool']]);
const SUSPICIOUS_SIGNALS=new Set(['suspicious','suspicious_activity','prompt_injection','voice_mismatch','unauthorized_attempt','reported_scam']);
const TERMINAL_EXECUTIONS=new Set(['completed','failed','interrupted']);
const SECRET_FIELD=/(?:password|api[_-]?key|authorization|credentials?|verification[_-]?code|^key$|^secret$|^token$|^otp$|^speak$|^tts$|^headers$|^raw$|^prompt$)/i;
const MESSAGES={locked:'安全锁定中，请先完成恢复验证。',invalid_operation:'操作参数无效，请重新整理安排。',untrusted_authority:'第三方内容和模型建议不能授予操作权限。',voice_confirmation_required:'语音确认没有绑定当前对象和参数，请重新核对。',risk_blocked:'收款对象或指令存在未消除的风险，不能通过密码验证放行。',authorization_required:'请先明确确认这项安排。',verification_required:'请先输入演示密码核对这项操作。',stale_binding:'操作参数已变化，请重新授权。',expired_grant:'授权已过期，请重新核对。',clock_rollback:'授权时间无效，请重新核对。',epoch_changed:'安全状态已变化，旧操作不能继续。',invalid_challenge:'本次验证已失效，请重新开始。',challenge_expired:'本次验证已过期，请重新开始。',verification_failed:'演示密码不匹配，请重新输入。',execution_in_progress:'这项操作已经提交，请先核实结果。',execution_consumed:'这次执行标识已经使用，不能重复操作。',already_completed:'这项安排已有完成回执，不会再次执行。',invalid_permit:'执行许可无效，操作未提交。',invalid_result:'执行结果无效，不能记录为完成。',result_mismatch:'回执与原执行结果不一致。',recovery_required:'请先发起演示恢复验证。',safety_state_invalid:'安全状态无法核对，已停止操作。'};

export class SafetyError extends Error{
 constructor(code){super(code==='paused'?'伙伴已暂停，请恢复后重新核对安排。':code==='not_due'?'还未到约定执行时间。':MESSAGES[code]||'安全校验未通过，操作未提交。');this.name='SafetyError';this.code=code;}
}
const fail=code=>{throw new SafetyError(code);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const clone=value=>structuredClone(value);
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function stable(value){if(Array.isArray(value))return value.map(stable);if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
const canonical=value=>JSON.stringify(stable(value));
const safeCode=(value,fallback='other')=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(value)?value:fallback;
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(value)&&!/^sk-|^gh[pousr]_|^github_pat_/i.test(value)?value:null;
function nowValue(state,options={}){
 const value=options.now??state.demoClock?.now??state.demoClock?.iso??Date.now();
 const now=value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):value;
 if(!Number.isFinite(now)||now<0)fail('clock_rollback');return Math.trunc(now);
}
function freshId(prefix){return prefix+'-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));}
function digest(text){let hash=2166136261;for(const char of text){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return 'binding-'+(hash>>>0).toString(16);}
function bounded(value,fallback,min,max){const n=value??fallback;if(!Number.isSafeInteger(n)||n<min||n>max)fail('safety_state_invalid');return n;}
function checkData(value,depth=0){
 if(depth>12)fail('invalid_operation');
 if(value===null||typeof value==='boolean'||typeof value==='number'){if(typeof value==='number'&&!Number.isFinite(value))fail('invalid_operation');return;}
 if(typeof value==='string'){if(value.length>20000)fail('invalid_operation');return;}
 if(Array.isArray(value)){if(value.length>500)fail('invalid_operation');for(const child of value)checkData(child,depth+1);return;}
 if(!plain(value))fail('invalid_operation');
 for(const [key,child] of Object.entries(value)){if(SECRET_FIELD.test(key))fail('invalid_operation');checkData(child,depth+1);}
}
function sourceInfo(source){
 if(typeof source==='string')source={kind:source};
 if(!plain(source))return {kind:'unknown',method:'unknown',voiceMatch:'unknown'};
 const alias={email:'mail',document:'report',attachment:'external',webpage:'external',third_party:'external','third-party':'external'};
 const supplied=alias[source.kind]||source.kind;
 const kind=['user','program','preset','llm','external','mail','report','voice','system'].includes(supplied)?supplied:'unknown';
 const method=source.method||source.input||source.channel||'click';
 const voiceMatch=['matched','mismatched','mismatch','unknown'].includes(source.voiceMatch)?source.voiceMatch:'unknown';
 return {kind,method:['click','voice','typed','system'].includes(method)?method:'unknown',voiceMatch};
}
function assertUser(source,operation,now){
 const info=sourceInfo(source);if(info.kind!=='user')fail('untrusted_authority');
 if(info.method==='voice'&&operation){
  const c=source.confirmation;
  if(source.explicit!==true||!plain(c)||c.taskId!==operation.id||c.revision!==operation.revision||c.target!==operation.target||c.amountMinor!==operation.amountMinor||c.currency!==operation.currency||c.action!==operation.kind||c.parameterKey!==operation.parameters||!Number.isFinite(c.expiresAt)||now>c.expiresAt)fail('voice_confirmation_required');
 }
 return info;
}
function normalizeOperation(operation){
 if(!plain(operation)||!safeId(operation.id??operation.taskId))fail('invalid_operation');
 const id=operation.id??operation.taskId,revision=operation.revision??1,kind=operation.kind??operation.action;
 if(!Number.isSafeInteger(revision)||revision<1||typeof kind!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(kind))fail('invalid_operation');
 const writes=!READ_KINDS.has(kind)||operation.writes===true;
 const target=operation.target??'',amountMinor=operation.amountMinor??0,currency=operation.currency??'CNY';
 if(typeof target!=='string'||target.length>500||!Number.isSafeInteger(amountMinor)||amountMinor<0||amountMinor>2000000000||!/^[A-Z]{3}$/.test(currency))fail('invalid_operation');
 if((TRANSFER_KINDS.has(kind)||['investment','wealth_purchase'].includes(kind))&&amountMinor<=0)fail('invalid_operation');
 let parameters=operation.parameters??operation.parameterKey;
 if(parameters===undefined&&!writes)parameters='{}';
 if(plain(parameters)||Array.isArray(parameters)){checkData(parameters);parameters=canonical(parameters);}
 if(typeof parameters!=='string'||!parameters||parameters.length>20000)fail('invalid_operation');
 try{checkData(JSON.parse(parameters));}catch(error){if(error instanceof SafetyError)throw error;}
 const scope=operation.scope??kind;if(!['string','object'].includes(typeof scope)||scope===null)fail('invalid_operation');checkData(scope);
 if(typeof scope==='string'&&(!scope.trim()||scope.length>1000))fail('invalid_operation');
 const scheduledAt=operation.scheduledAt??null;
 if(scheduledAt!==null&&(typeof scheduledAt!=='string'||!Number.isFinite(Date.parse(scheduledAt))))fail('invalid_operation');
 const riskFlags=operation.riskFlags??[];
 if(!Array.isArray(riskFlags)||riskFlags.length>50||riskFlags.some(flag=>typeof flag!=='string'||!/^[-a-z0-9_]{1,80}$/.test(flag)))fail('invalid_operation');
 const origin=sourceInfo(operation.source);
 const snapshot={id,revision,kind,target,amountMinor,currency,parameters,scope:stable(clone(scope)),scheduledAt,riskFlags:[...new Set(riskFlags)].sort(),source:{kind:origin.kind},writes};
 return {snapshot,binding:canonical(snapshot)};
}
function publicGrant(grant){return freeze(clone({...grant,grantId:grant.id,parameterKey:grant.snapshot.parameters}));}
function publicPermit(entry,replay=false){return freeze(clone({permitId:entry.permitId,executionId:entry.id,operationId:entry.operationId,grantId:entry.grantId,revision:entry.snapshot.revision,epoch:entry.epoch,binding:entry.binding,parameterKey:entry.snapshot.parameters,level:entry.level,status:entry.status,replay,result:entry.result??null}));}

export function ensureSafety(state,options={}){
 if(!plain(state))fail('safety_state_invalid');
 if(state.safety===undefined){
  state.safety={version:1,epoch:0,locked:false,lock:null,grants:{},challenges:{},executions:{},signals:[],audit:[],sequence:0,
   failures:{verification:0,password:0,tool:0,suspicious:0,consecutive:0},
   policy:{failureThreshold:bounded(options.failureThreshold,SAFETY_DEFAULTS.failureThreshold,1,10),transferThresholdMinor:bounded(options.transferThresholdMinor,SAFETY_DEFAULTS.transferThresholdMinor,1,2000000000),grantTTL:bounded(options.grantTTL,SAFETY_DEFAULTS.grantTTL,1000,SAFETY_DEFAULTS.maxGrantTTL),challengeTTL:bounded(options.challengeTTL,SAFETY_DEFAULTS.challengeTTL,1000,300000),maxGrantTTL:SAFETY_DEFAULTS.maxGrantTTL}};
 }
 const safety=state.safety;
 if(!plain(safety)||safety.version!==1||!Number.isSafeInteger(safety.epoch)||safety.epoch<0||typeof safety.locked!=='boolean'||!plain(safety.grants)||!plain(safety.challenges)||!plain(safety.executions)||!Array.isArray(safety.signals)||!Array.isArray(safety.audit)||!plain(safety.failures)||!plain(safety.policy))fail('safety_state_invalid');
 if(!Number.isSafeInteger(safety.sequence)||safety.sequence<0||['verification','password','tool','suspicious','consecutive'].some(key=>!Number.isSafeInteger(safety.failures[key])||safety.failures[key]<0))fail('safety_state_invalid');
 bounded(safety.policy.failureThreshold,null,1,10);bounded(safety.policy.transferThresholdMinor,null,1,2000000000);bounded(safety.policy.grantTTL,null,1000,SAFETY_DEFAULTS.maxGrantTTL);bounded(safety.policy.challengeTTL,null,1000,300000);bounded(safety.policy.maxGrantTTL,null,1000,SAFETY_DEFAULTS.maxGrantTTL);
 return safety;
}

export function auditSafety(state,event,options={}){
 const safety=ensureSafety(state),now=nowValue(state,options),data=typeof event==='string'?{type:event}:event||{};
 const entry={id:'audit-'+(++safety.sequence),at:now,epoch:safety.epoch,type:safeCode(data.type||data.event,'event')};
 for(const name of ['operationId','grantId','challengeId','executionId','receipt','correlationId'])if(safeId(data[name]))entry[name]=data[name];
 if(Number.isSafeInteger(data.revision))entry.revision=data.revision;
 if(['green','yellow','red'].includes(data.level))entry.level=data.level;
 if(typeof data.status==='string')entry.status=safeCode(data.status);
 if(typeof data.reason==='string')entry.reason=safeCode(data.reason);
 if(Array.isArray(data.reasons))entry.reasons=data.reasons.slice(0,20).map(value=>safeCode(value));
 if(typeof data.binding==='string')entry.bindingId=digest(data.binding);
 if(data.source)entry.source=sourceInfo(data.source);
 safety.audit.push(entry);return freeze(clone(entry));
}
function deny(state,code,operation,options={}){
 auditSafety(state,{type:'blocked',reason:code,operationId:operation?.id,revision:operation?.revision},options);fail(code);
}
function assertTime(record,now){if(now<record.createdAt)fail('clock_rollback');if(now>=record.expiresAt)fail('expired_grant');}
function sameGrant(state,operation,grantId,options={}){
 const safety=ensureSafety(state),now=nowValue(state,options),{snapshot,binding}=normalizeOperation(operation),grant=safety.grants[grantId];
 if(!grant)deny(state,'authorization_required',snapshot,options);
 if(grant.binding!==binding||grant.snapshot.id!==snapshot.id||grant.snapshot.revision!==snapshot.revision)deny(state,'stale_binding',snapshot,options);
 if(grant.epoch!==safety.epoch)deny(state,'epoch_changed',snapshot,options);
 if(grant.status==='revoked')deny(state,'authorization_required',snapshot,options);
 try{assertTime(grant,now);}catch(error){deny(state,error.code,snapshot,options);}
 return {safety,now,snapshot,binding,grant};
}
function transferTotal(state,snapshot,safety,excludeExecutionId,now){
 const date=(snapshot.scheduledAt||snapshot.parameters.match(/"scheduled_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1]||new Date(now).toISOString()).slice(0,10);
 let total=0;
 for(const row of state.ledger||[]){if(TRANSFER_KINDS.has(row.kind)&&row.date===date&&Number.isSafeInteger(row.amountMinor)&&row.amountMinor>0&&row.direction!=='income')total+=row.amountMinor;}
 for(const entry of Object.values(safety.executions))if(entry.status==='pending'&&entry.id!==excludeExecutionId&&entry.operationId!==snapshot.id&&TRANSFER_KINDS.has(entry.snapshot.kind)&&(entry.snapshot.scheduledAt||entry.snapshot.parameters.match(/"scheduled_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1]||new Date(entry.createdAt).toISOString()).slice(0,10)===date)total+=entry.snapshot.amountMinor;
 return total;
}

export function classifyOperation(state,operation,options={}){
 const safety=ensureSafety(state),{snapshot}=normalizeOperation(operation),reasons=[],flags=new Set(snapshot.riskFlags.map(flag=>flag.replaceAll('-','_'))),source=sourceInfo(options.source);
 if(snapshot.kind==='risk_transfer')flags.add('unverified_recipient');
 try{const p=JSON.parse(snapshot.parameters);if(p.payee_id==='unknown'||p.payeeId==='unknown'||p.recipientVerified===false||p.recipient_status==='unverified')flags.add('unverified_recipient');}catch{}
 const operationSignals=safety.signals.filter(signal=>!signal.mitigated&&(!signal.operationId||signal.operationId===snapshot.id)&&(signal.epoch===safety.epoch||signal.operationId===snapshot.id&&HARD_FLAGS.has(signal.kind)));
 for(const signal of operationSignals)if(signal.operationId===snapshot.id&&HARD_FLAGS.has(signal.kind))flags.add(signal.kind);
 if(source.voiceMatch==='mismatched'||source.voiceMatch==='mismatch'||operationSignals.some(signal=>signal.kind==='voice_mismatch'))flags.add('voice_mismatch');
 const riskBlocked=snapshot.writes&&[...flags].some(flag=>HARD_FLAGS.has(flag));
 if(riskBlocked)reasons.push(...[...flags].filter(flag=>HARD_FLAGS.has(flag)));
 let level='green';
 if(snapshot.writes&&flags.has('new_recipient')){level='yellow';reasons.push('new_recipient');}
 if(snapshot.writes&&RED_KINDS.has(snapshot.kind)){level='red';reasons.push('sensitive_operation');}
 const cumulativeMinor=TRANSFER_KINDS.has(snapshot.kind)?transferTotal(state,snapshot,safety,options.excludeExecutionId,nowValue(state,options))+snapshot.amountMinor:null;
 if(cumulativeMinor!==null&&cumulativeMinor>safety.policy.transferThresholdMinor){level='red';reasons.push('daily_transfer_threshold');}
 // A recurring confirmation covers every period, so its whole cap counts now.
 let periods=1;try{periods=JSON.parse(snapshot.parameters).occurrences||1;}catch{}
 if(cumulativeMinor!==null&&periods>1&&snapshot.amountMinor*periods>safety.policy.transferThresholdMinor){level='red';reasons.push('recurring_total_threshold');}
 if(snapshot.writes&&flags.has('voice_mismatch')){level='red';reasons.push('voice_mismatch');}
 if(snapshot.writes&&[...flags].some(flag=>flag!=='new_recipient')&&!riskBlocked){level='red';reasons.push('risk_signal');}
 if(snapshot.writes&&snapshot.amountMinor>0&&snapshot.currency!=='CNY'){level='red';reasons.push('currency_requires_review');}
 if(riskBlocked)level='red';
 if(snapshot.writes&&safety.locked)reasons.push('safety_locked');
 if(snapshot.writes&&state.paused)reasons.push('manual_pause');
 if(!reasons.length)reasons.push(snapshot.writes?'explicit_confirmation':'read_only');
 return freeze({level,writes:snapshot.writes,requiresVerification:snapshot.writes&&level!=='green',circuitBreak:snapshot.writes&&[...flags].some(flag=>CRITICAL_FLAGS.has(flag)),blocked:riskBlocked||snapshot.writes&&(safety.locked||!!state.paused),riskBlocked,locked:safety.locked,paused:!!state.paused,cumulativeMinor,thresholdMinor:safety.policy.transferThresholdMinor,reasons:[...new Set(reasons)]});
}

export function authorizeSafety(state,operation,options={}){
 const safety=ensureSafety(state),now=nowValue(state,options),{snapshot,binding}=normalizeOperation(operation);
 try{assertUser(options.source,snapshot,now);}catch(error){recordSafetySignal(state,{kind:'unauthorized_attempt',operationId:snapshot.id,source:options.source},options);deny(state,error.code,snapshot,options);}
 const classification=classifyOperation(state,operation,options);
 auditSafety(state,{type:'classified',operationId:snapshot.id,revision:snapshot.revision,level:classification.level,reasons:classification.reasons,binding,source:options.source},options);
 if(classification.riskBlocked){if(classification.circuitBreak&&!safety.locked)lockSafety(state,classification.reasons.find(r=>CRITICAL_FLAGS.has(r))||'suspicious_activity',options);deny(state,'risk_blocked',snapshot,options);}
 if(classification.writes&&safety.locked)deny(state,'locked',snapshot,options);
 if(classification.writes&&state.paused)deny(state,'paused',snapshot,options);
 if(classification.riskBlocked)deny(state,'risk_blocked',snapshot,options);
 const previousExecutions=Object.values(safety.executions).filter(entry=>entry.operationId===snapshot.id&&entry.snapshot.revision===snapshot.revision);
 if(previousExecutions.some(entry=>entry.status==='completed'))deny(state,'already_completed',snapshot,options);
 if(previousExecutions.some(entry=>entry.status==='pending'))deny(state,'execution_in_progress',snapshot,options);
 const existing=Object.values(safety.grants).find(grant=>grant.binding===binding&&grant.epoch===safety.epoch&&['ready','verification_required'].includes(grant.status)&&grant.createdAt<=now&&grant.expiresAt>now&&!grant.executionId);
 if(existing)return publicGrant(existing);
 const ttl=bounded(options.ttlMs,safety.policy.grantTTL,1000,safety.policy.maxGrantTTL);
 let expiresAt=options.expiresAt??now+ttl;
 if(!Number.isFinite(expiresAt)||expiresAt<=now||expiresAt>now+safety.policy.maxGrantTTL)deny(state,'expired_grant',snapshot,options);
 if(sourceInfo(options.source).method==='voice')expiresAt=Math.min(expiresAt,options.source.confirmation.expiresAt);
 if(snapshot.writes&&snapshot.scheduledAt&&expiresAt<=Date.parse(snapshot.scheduledAt))deny(state,'expired_grant',snapshot,options);
 for(const grant of Object.values(safety.grants))if(grant.snapshot.id===snapshot.id&&grant.status!=='completed')grant.status='revoked';
 const grant={id:freshId('grant'),operationId:snapshot.id,snapshot:freeze(snapshot),binding,level:classification.level,reasons:[...classification.reasons],epoch:safety.epoch,status:classification.requiresVerification?'verification_required':'ready',createdAt:now,expiresAt,source:sourceInfo(options.source),executionId:null,verification:null};
 safety.grants[grant.id]=grant;
 auditSafety(state,{type:'authorized',operationId:snapshot.id,revision:snapshot.revision,grantId:grant.id,level:grant.level,status:grant.status,binding,source:options.source},options);
 return publicGrant(grant);
}

export function beginChallenge(state,operation,options={}){
 if(['recovery','unlock'].includes(options.purpose))return beginRecovery(state,options);
 const safety=ensureSafety(state),normalized=normalizeOperation(operation);
 const grantId=options.grantId||Object.values(safety.grants).findLast(grant=>grant.binding===normalized.binding&&grant.epoch===safety.epoch&&grant.status!=='revoked')?.id;
 const {now,snapshot,binding,grant}=sameGrant(state,operation,grantId,options);
 if(safety.locked)deny(state,'locked',snapshot,options);
 if(state.paused)deny(state,'paused',snapshot,options);
 if(grant.executionId)deny(state,'execution_consumed',snapshot,options);
 if(classifyOperation(state,operation,options).riskBlocked)deny(state,'risk_blocked',snapshot,options);
 const prior=Object.values(safety.challenges).find(challenge=>challenge.grantId===grant.id&&challenge.epoch===safety.epoch&&challenge.status==='pending'&&challenge.expiresAt>now);
 if(prior)return freeze(clone(prior));
 const challenge={id:freshId('challenge'),purpose:'operation',method:'local-demo-password',level:grant.level,grantId:grant.id,operationId:snapshot.id,revision:snapshot.revision,parameterKey:snapshot.parameters,binding,epoch:safety.epoch,status:'pending',createdAt:now,expiresAt:Math.min(now+safety.policy.challengeTTL,grant.expiresAt),attempts:0,maxAttempts:safety.policy.failureThreshold};
 grant.status='verification_required';grant.verification=null;safety.challenges[challenge.id]=challenge;
 auditSafety(state,{type:'challenge_started',operationId:snapshot.id,revision:snapshot.revision,grantId:grant.id,challengeId:challenge.id,level:grant.level,binding},options);
 return freeze(clone(challenge));
}
function challengeFor(state,challengeId,purpose,options={}){
 const safety=ensureSafety(state),now=nowValue(state,options),challenge=safety.challenges[challengeId];
 if(!challenge||challenge.purpose!==purpose||challenge.status!=='pending')fail('invalid_challenge');
 if(challenge.epoch!==safety.epoch)fail('epoch_changed');
 if(now<challenge.createdAt)fail('clock_rollback');
 if(now>=challenge.expiresAt){challenge.status='expired';auditSafety(state,{type:'challenge_expired',challengeId:challenge.id,operationId:challenge.operationId},options);fail('challenge_expired');}
 return {safety,now,challenge};
}
function badCode(state,challenge,options){
 challenge.attempts++;
 recordSafetySignal(state,{kind:'password_failure',operationId:challenge.operationId,challengeId:challenge.id,source:{kind:'program'}},options);
 auditSafety(state,{type:'verification_failed',challengeId:challenge.id,operationId:challenge.operationId,status:state.safety.locked?'locked':'failed'},options);
 return freeze({ok:false,status:state.safety.locked?'locked':'failed',challengeId:challenge.id,attemptsRemaining:Math.max(0,challenge.maxAttempts-challenge.attempts)});
}
export function verifyChallenge(state,options={}){
 const {safety,now,challenge}=challengeFor(state,options.challengeId,'operation',options);
 assertUser(options.source,null,now);
 if(safety.locked)fail('locked');
 if(state.paused)fail('paused');
 const grant=safety.grants[challenge.grantId];
 if(!grant||grant.status!=='verification_required'||grant.binding!==challenge.binding||grant.epoch!==safety.epoch||grant.executionId)fail('invalid_challenge');
 assertTime(grant,now);
 if(typeof options.code!=='string'||options.code!==DEMO_VERIFICATION_CODE)return badCode(state,challenge,options);
 challenge.status='verified';challenge.verifiedAt=now;challenge.proofId=freshId('proof');
 grant.status='ready';grant.verification={challengeId:challenge.id,proofId:challenge.proofId,method:challenge.method,epoch:safety.epoch,verifiedAt:now,expiresAt:grant.expiresAt};
 safety.failures.verification=0;safety.failures.password=0;safety.failures.consecutive=0;
 auditSafety(state,{type:'verified',operationId:challenge.operationId,revision:challenge.revision,challengeId:challenge.id,grantId:grant.id,status:'verified',source:options.source,binding:grant.binding},options);
 return freeze({ok:true,status:'verified',challengeId:challenge.id,grantId:grant.id,proofId:challenge.proofId,expiresAt:grant.expiresAt});
}

function readyGrant(state,operation,grantId,options={}){
 const data=sameGrant(state,operation,grantId,options),{safety,now,snapshot,grant}=data;
 if(options.currentEpoch!==undefined&&options.currentEpoch!==safety.epoch)deny(state,'epoch_changed',snapshot,options);
 if(options.currentLocked===true)deny(state,'locked',snapshot,options);
 if(options.currentPaused===true)deny(state,'paused',snapshot,options);
 if(safety.locked)deny(state,'locked',snapshot,options);
 if(state.paused)deny(state,'paused',snapshot,options);
 const classification=classifyOperation(state,operation,options);
 if(classification.riskBlocked)deny(state,'risk_blocked',snapshot,options);
 if((classification.requiresVerification||grant.level==='red'||grant.level==='yellow')&&!grant.verification){grant.status='verification_required';grant.level=classification.level;deny(state,'verification_required',snapshot,options);}
 if(grant.status!=='ready'&&grant.status!=='executing')deny(state,'authorization_required',snapshot,options);
 if(grant.verification){const proof=grant.verification,challenge=safety.challenges[proof.challengeId];if(proof.epoch!==safety.epoch||proof.expiresAt<=now||!challenge||challenge.status!=='verified'||challenge.proofId!==proof.proofId||challenge.binding!==data.binding)deny(state,'verification_required',snapshot,options);}
 return {...data,classification};
}

// Non-consuming validation for the engine's verify -> executing transition.
export function validateGrant(state,operation,options={}){
 const {grant,snapshot}=readyGrant(state,operation,options.grantId,options);
 if(grant.executionId&&!options.allowExecuting)deny(state,'execution_consumed',snapshot,options);
 if(options.challengeId&&grant.verification?.challengeId!==options.challengeId)deny(state,'verification_required',snapshot,options);
 if(options.proofId&&grant.verification?.proofId!==options.proofId)deny(state,'verification_required',snapshot,options);
 return publicGrant(grant);
}

export function getSafetyGrant(state,grantId){const grant=ensureSafety(state).grants[grantId];return grant?publicGrant(grant):null;}
export function getSafetyChallenge(state,challengeId){const challenge=ensureSafety(state).challenges[challengeId];return challenge?freeze(clone(challenge)):null;}

// Editing or cancelling one task must not revoke unrelated reviewed arrangements.
export function revokeOperation(state,operationId,options={}){
 const safety=ensureSafety(state),now=nowValue(state,options);if(!safeId(operationId))fail('invalid_operation');
 let grants=0,challenges=0,executions=0;
 for(const grant of Object.values(safety.grants))if(grant.operationId===operationId&&!['completed','revoked'].includes(grant.status)){grant.status='revoked';grants++;}
 for(const challenge of Object.values(safety.challenges))if(challenge.operationId===operationId&&['pending','verified'].includes(challenge.status)){challenge.status='invalidated';challenges++;}
 for(const entry of Object.values(safety.executions))if(entry.operationId===operationId&&entry.status==='pending'){entry.status='interrupted';entry.interruptedAt=now;entry.requiresReview=true;executions++;}
 auditSafety(state,{type:'authorization_revoked',operationId,reason:safeCode(options.reason,'parameters_changed')},options);
 return freeze({operationId,revokedGrants:grants,invalidatedChallenges:challenges,interruptedExecutions:executions});
}

export function acquireExecution(state,operation,options={}){
 const safety=ensureSafety(state),now=nowValue(state,options),{snapshot,binding}=normalizeOperation(operation),id=options.executionId;
 if(!safeId(id))deny(state,'invalid_permit',snapshot,options);
 const previous=safety.executions[id];
 if(previous){if(previous.binding!==binding)deny(state,'stale_binding',snapshot,options);return publicPermit(previous,true);}
 if(options.epoch!==undefined&&options.epoch!==safety.epoch)deny(state,'epoch_changed',snapshot,options);
 if(options.currentEpoch!==undefined&&options.currentEpoch!==safety.epoch)deny(state,'epoch_changed',snapshot,options);
 const classification=classifyOperation(state,operation,options);
 if(classification.writes&&snapshot.scheduledAt&&now<Date.parse(snapshot.scheduledAt))deny(state,'not_due',snapshot,options);
 let grant=null;
 if(classification.writes){grant=readyGrant(state,operation,options.grantId,options).grant;if(grant.executionId)deny(state,'execution_consumed',snapshot,options);}
 if(Object.values(safety.executions).some(entry=>entry.operationId===snapshot.id&&entry.snapshot.revision===snapshot.revision&&entry.status==='completed'))deny(state,'already_completed',snapshot,options);
 if(Object.values(safety.executions).some(entry=>entry.operationId===snapshot.id&&entry.snapshot.revision===snapshot.revision&&entry.status==='pending'))deny(state,'execution_in_progress',snapshot,options);
 const entry={id,permitId:freshId('permit'),operationId:snapshot.id,snapshot:freeze(snapshot),binding,epoch:safety.epoch,grantId:grant?.id??null,level:classification.level,status:'pending',createdAt:now,result:null};
 safety.executions[id]=entry;if(grant){grant.executionId=id;grant.status='executing';}
 auditSafety(state,{type:'execution_started',operationId:snapshot.id,revision:snapshot.revision,executionId:id,grantId:grant?.id,level:entry.level,binding},options);
 return publicPermit(entry,false);
}

export function validatePermit(state,operation,permit,options={}){
 const safety=ensureSafety(state),{snapshot,binding}=normalizeOperation(operation),entry=safety.executions[permit?.executionId];
 if(!entry||entry.permitId!==permit?.permitId||permit.binding!==binding||entry.binding!==binding||entry.operationId!==snapshot.id)deny(state,'invalid_permit',snapshot,options);
 if(entry.epoch!==safety.epoch||permit.epoch!==safety.epoch)deny(state,'epoch_changed',snapshot,options);
 if(options.currentEpoch!==undefined&&options.currentEpoch!==safety.epoch)deny(state,'epoch_changed',snapshot,options);
 if(snapshot.writes&&options.currentLocked===true)deny(state,'locked',snapshot,options);
 if(snapshot.writes&&options.currentPaused===true)deny(state,'paused',snapshot,options);
 if(snapshot.writes&&snapshot.scheduledAt&&nowValue(state,options)<Date.parse(snapshot.scheduledAt))deny(state,'not_due',snapshot,options);
 if(permit.replay||entry.status!=='pending')deny(state,entry.status==='completed'?'already_completed':'execution_consumed',snapshot,options);
 if(snapshot.writes)readyGrant(state,operation,entry.grantId,{...options,excludeExecutionId:entry.id});
 return freeze({valid:true,operationId:snapshot.id,executionId:entry.id,epoch:safety.epoch,level:entry.level});
}

export function commitExecution(state,permit,result,options={}){
 const safety=ensureSafety(state),entry=safety.executions[permit?.executionId];
 if(!entry||entry.permitId!==permit?.permitId||entry.binding!==permit?.binding)fail('invalid_permit');
 if(!plain(result)||!['completed','success','succeeded'].includes(result.status))fail('invalid_result');
 checkData(result);const safeResult=clone(result);safeResult.status='completed';
 if(entry.status==='completed'){if(canonical(entry.result)!==canonical(safeResult))fail('result_mismatch');fail('already_completed');}
 validatePermit(state,entry.snapshot,permit,options);
 if(entry.snapshot.writes&&!safeId(safeResult.receipt))fail('invalid_result');
 entry.status='completed';entry.completedAt=nowValue(state,options);entry.result=safeResult;
 const grant=safety.grants[entry.grantId];if(grant)grant.status='completed';
 safety.failures.tool=0;safety.failures.consecutive=0;
 auditSafety(state,{type:'execution_completed',operationId:entry.operationId,revision:entry.snapshot.revision,executionId:entry.id,grantId:entry.grantId,receipt:safeResult.receipt,status:'completed',binding:entry.binding},options);
 return freeze(clone(entry));
}

export function failExecution(state,permit,options={}){
 const safety=ensureSafety(state),entry=safety.executions[permit?.executionId];
 if(!entry||entry.permitId!==permit?.permitId||entry.binding!==permit?.binding)fail('invalid_permit');
 if(TERMINAL_EXECUTIONS.has(entry.status))return freeze(clone(entry));
 entry.status='failed';entry.failedAt=nowValue(state,options);entry.failure=safeCode(options.code,'tool_failure');
 const grant=safety.grants[entry.grantId];if(grant)grant.status='revoked';
 auditSafety(state,{type:'execution_failed',operationId:entry.operationId,executionId:entry.id,grantId:entry.grantId,reason:entry.failure},options);
 recordSafetySignal(state,{kind:'tool_failure',operationId:entry.operationId},options);
 return freeze(clone(entry));
}

export function recordSafetySignal(state,signal,options={}){
 const safety=ensureSafety(state),now=nowValue(state,options),kind=safeCode(signal?.kind,'suspicious_activity');
 if(FAILURE_SIGNALS.has(kind)&&['user','llm','external','mail','report','voice'].includes(sourceInfo(signal?.source).kind)){
  auditSafety(state,{type:'signal_ignored',reason:'untrusted_failure_claim',operationId:signal?.operationId,source:signal?.source},options);
  return freeze({locked:safety.locked,epoch:safety.epoch,failures:clone(safety.failures),ignored:true});
 }
 const item={id:freshId('signal'),kind,at:now,operationId:safeId(signal?.operationId),epoch:safety.epoch};
 safety.signals.push(item);
 auditSafety(state,{type:'safety_signal',operationId:item.operationId,challengeId:signal?.challengeId,reason:kind,source:signal?.source},options);
 const category=FAILURE_SIGNALS.get(kind);
 if(category){safety.failures[category]++;safety.failures.consecutive++;}
 else if(SUSPICIOUS_SIGNALS.has(kind))safety.failures.suspicious++;
 else if(['password_success','verification_success','tool_success'].includes(kind)){safety.failures[kind.split('_')[0]]=0;safety.failures.consecutive=0;}
 const threshold=safety.policy.failureThreshold;
 if(CRITICAL_FLAGS.has(kind)||signal?.severity==='critical'||signal?.strong===true||safety.failures.consecutive>=threshold||Object.values(safety.failures).some(count=>count>=threshold))lockSafety(state,category?category+'_failures':kind,options);
 return freeze({locked:safety.locked,epoch:safety.epoch,failures:clone(safety.failures),signal:clone(item)});
}

export function lockSafety(state,reason='manual_lock',options={}){
 const safety=ensureSafety(state),now=nowValue(state,options);
 invalidateEpoch(safety,now);safety.locked=true;safety.lock={id:freshId('lock'),reason:safeCode(reason,'suspicious_activity'),at:now,epoch:safety.epoch};
 auditSafety(state,{type:'locked',reason:safety.lock.reason,status:'locked'},options);
 return freeze(clone(safety.lock));
}

function invalidateEpoch(safety,now){
 safety.epoch++;
 for(const grant of Object.values(safety.grants))if(grant.status!=='completed')grant.status='revoked';
 for(const challenge of Object.values(safety.challenges))if(challenge.status==='pending'||challenge.status==='verified')challenge.status='invalidated';
 for(const entry of Object.values(safety.executions))if(entry.status==='pending'){entry.status='interrupted';entry.interruptedAt=now;entry.requiresReview=true;}
}

// Manual pause invalidates in-flight writes without pretending a security lock occurred.
export function invalidateSafetyEpoch(state,reason='manual_pause',options={}){
 const safety=ensureSafety(state),now=nowValue(state,options);invalidateEpoch(safety,now);
 auditSafety(state,{type:'permissions_invalidated',reason:safeCode(reason,'manual_pause')},options);
 return freeze({epoch:safety.epoch,locked:safety.locked,requiresReauthorization:true,automaticReplay:false});
}

export function beginRecovery(state,options={}){
 const safety=ensureSafety(state),now=nowValue(state,options);assertUser(options.source,null,now);
 if(!safety.locked||!safety.lock)fail('recovery_required');
 const previous=Object.values(safety.challenges).find(challenge=>challenge.purpose==='recovery'&&challenge.epoch===safety.epoch&&challenge.status==='pending'&&challenge.expiresAt>now);
 if(previous)return freeze(clone(previous));
 const challenge={id:freshId('recovery'),purpose:'recovery',method:'local-demo-password',level:'red',lockId:safety.lock.id,epoch:safety.epoch,status:'pending',createdAt:now,expiresAt:now+safety.policy.challengeTTL,attempts:0,maxAttempts:safety.policy.failureThreshold};
 safety.challenges[challenge.id]=challenge;
 auditSafety(state,{type:'recovery_started',challengeId:challenge.id,reason:safety.lock.reason,source:options.source},options);return freeze(clone(challenge));
}

export function recoverSafety(state,options={}){
 const {safety,now,challenge}=challengeFor(state,options.challengeId,'recovery',options);assertUser(options.source,null,now);
 if(!safety.locked||challenge.lockId!==safety.lock?.id)fail('recovery_required');
 if(typeof options.code!=='string'||options.code!==DEMO_VERIFICATION_CODE)return badCode(state,challenge,options);
 challenge.status='verified';challenge.verifiedAt=now;safety.epoch++;safety.locked=false;safety.lock=null;
 safety.failures={verification:0,password:0,tool:0,suspicious:0,consecutive:0};
 for(const grant of Object.values(safety.grants))if(grant.status!=='completed')grant.status='revoked';
 for(const current of Object.values(safety.challenges))if(current.id!==challenge.id&&current.status!=='expired')current.status='invalidated';
 auditSafety(state,{type:'recovered',challengeId:challenge.id,status:'recovered',source:options.source},options);
 return freeze({ok:true,status:'recovered',epoch:safety.epoch,requiresReauthorization:true,automaticReplay:false});
}
