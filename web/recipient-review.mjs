// Synthetic, local recipient evidence. This module never authorizes a transfer,
// contacts a person, searches a real account or makes a fraud allegation.
const FIELDS=['reference','cardNumber','recipientName','purpose','amountMinor','sourceAccount'];
const INPUT_KEYS=new Set(FIELDS);
const FIXTURES=Object.freeze({
 'new-card-6217':Object.freeze({id:'recipient-fixture-6217',name:'陈宇',sourceAccount:'living_1608',cardNumber:'0000000000006217',suffix:'6217',reports:0}),
 'reported-card-8891':Object.freeze({id:'recipient-fixture-8891',name:'闲鱼卖家',sourceAccount:'living_1608',cardNumber:'0000000000008891',suffix:'8891',reports:7}),
});
const plain=value=>!!value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const invalid=code=>{const error=Error(code==='recipient_details_required'?'请先核对收款人、金额和付款账户。':'收款核查参数无效，请重新核对。');error.code=code;return error;};
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(plain(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
function text(value,limit){
 if(value==null||value==='')return null;
 if(typeof value!=='string'||value.length>limit||/[\u0000-\u001f\u007f]/.test(value))throw invalid('invalid_recipient_input');
 return value.trim()||null;
}
function inputOf(input){
 if(!plain(input))throw invalid('invalid_recipient_input');
 for(const key of Reflect.ownKeys(input)){
  if(typeof key!=='string'||!INPUT_KEYS.has(key)||!Object.hasOwn(Object.getOwnPropertyDescriptor(input,key),'value'))throw invalid('invalid_recipient_input');
 }
 const amount=input.amountMinor;
 if(amount!=null&&(!Number.isSafeInteger(amount)||amount<1||amount>2000000000))throw invalid('invalid_recipient_input');
 const cardNumber=text(input.cardNumber,16);
 if(cardNumber!==null&&!/^\d{16}$/.test(cardNumber))throw invalid('invalid_recipient_input');
 return {reference:text(input.reference,80),cardNumber,recipientName:text(input.recipientName,80),purpose:text(input.purpose,160),amountMinor:amount??null,sourceAccount:text(input.sourceAccount,80)};
}

/** The application may resolve a synthetic contact/account, but never fabricate
 * the requested amount or accept a model's claimed verification. Purpose is optional. */
export function reviewRecipient(input,{history=[]}={}){
 const supplied=inputOf(input),cardReference=Object.keys(FIXTURES).find(key=>FIXTURES[key].cardNumber===supplied.cardNumber)||null;
 // Names and old references are not account evidence. Only the complete card
 // number resolves a local record; an unknown number is never called a scam.
 const fixture=cardReference?FIXTURES[cardReference]:null;
 const resolvedReference=supplied.reference||cardReference||(supplied.cardNumber?'card-'+supplied.cardNumber:null);
 const values={...supplied,reference:resolvedReference,recipientName:supplied.recipientName||fixture?.name||null,purpose:supplied.purpose||'转账',sourceAccount:supplied.sourceAccount||fixture?.sourceAccount||null};
 const missing=FIELDS.filter(key=>!['purpose','reference'].includes(key)&&values[key]===null);
 const reported=!!fixture?.reports;
 const matched=!missing.length&&fixture&&!reported&&values.recipientName===fixture.name&&(!supplied.reference||supplied.reference===cardReference)&&['living_1608','salary_0826'].includes(values.sourceAccount);
 const firstTransfer=!Array.isArray(history)||!history.some(row=>plain(row)&&Object.getOwnPropertyDescriptor(row,'cardNumber')?.value===supplied.cardNumber&&supplied.cardNumber!==null);
 const status=reported?'reported':missing.length?'needs_details':matched?'matched':'unverified';
 const evidence={source:{kind:'program',mode:'local_demo'},fixture_id:fixture?.id??null,
  synthetic:true,record_matched:!!matched,report_count:fixture?.reports??0,first_transfer:firstTransfer,
  findings:reported?['synthetic_multiple_reports']:matched?['contact_record_match','no_synthetic_reports']:['identity_not_established']};
 const target=matched?fixture.name+'（尾号'+fixture.suffix+'）':reported?'闲鱼卖家（尾号8891）':values.recipientName||'待核实收款人';
 const result={version:1,...values,status,missing,target,evidence};
 // This is a canonical binding, not a signature or a remote identity assertion.
 return freeze({...result,fingerprint:canonical(result)});
}

/** Re-read trusted evidence for the current input. No stored verified flag,
 * source claim or editable snapshot can substitute for the fresh comparison. */
export function validateRecipientReview(review,currentInput,options={}){
 try{return plain(review)&&canonical(review)===canonical(reviewRecipient(currentInput,options));}catch{return false;}
}

/** An inert proposal for the shared safety policy. New matched recipients still
 * require yellow-level demo password verification; unknown/reported targets remain
 * blocked even after an identity challenge. No grant or execution is created. */
export function recipientOperation(review,{id,revision=1,expiresAt,history=[]}={}){
 const current=Object.fromEntries(FIELDS.map(key=>[key,review?.[key]]));
 if(!validateRecipientReview(review,current,{history}))throw invalid('invalid_recipient_review');
 if(review.missing.length)throw invalid('recipient_details_required');
 if(typeof id!=='string'||!/^[A-Za-z0-9_.:-]{1,180}$/.test(id)||/^sk-|^gh[pousr]_|^github_pat_/i.test(id)||!Number.isSafeInteger(revision)||revision<1)throw invalid('invalid_recipient_operation');
 if(expiresAt!==undefined&&(!Number.isSafeInteger(expiresAt)||expiresAt<0))throw invalid('invalid_recipient_operation');
 const riskFlags=review.status==='matched'?(review.evidence.first_transfer?['new_recipient']:[]):review.status==='reported'?['reported_scam','unverified_recipient']:['unverified_recipient'];
 const parameters={recipient_reference:review.reference,recipient_card:review.cardNumber,recipient_name:review.recipientName,purpose:review.purpose,
  amount_minor:review.amountMinor,currency:'CNY',source_account:review.sourceAccount,
  recipient_status:review.status==='matched'?'verified_local_fixture':'unverified',
  review_fingerprint:review.fingerprint,evidence:review.evidence,revision,
  ...(expiresAt===undefined?{}:{consent_expires_at:expiresAt})};
 return freeze({id,revision,kind:'transfer',target:review.target,amountMinor:review.amountMinor,currency:'CNY',
  parameters:canonical(parameters),scope:{action:'transfer',recipient:review.reference,account:review.sourceAccount,uses:1},
  source:{kind:'program'},riskFlags,writes:true,scheduledAt:null,...(expiresAt===undefined?{}:{expiresAt})});
}
