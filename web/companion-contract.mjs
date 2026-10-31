const ORIGINS=new Set(['llm','program','preset','external','user','voice']);
const SPEAK_KINDS=new Set(['conversation','question_summary','confirmation_summary','execution_receipt','safety_status','reminder']);
const executionClaim=/(?:已(?:经)?(?:为你|帮你|替你)?(?:成功)?(?:转账|付款|支付|扣款|发送|预订|下单|锁卡|取消续费)|已(?:经)?(?:为你|帮你|替你)?(?:成功)?(?:设置|设定|开通|开启|创建)[^。！？\n]{0,16}(?:转账|扣款|付款|支付|续费|代扣)|(?:转账|付款|支付|预订|下单|资金).{0,8}(?:成功|已完成|到账))/;
const sensitiveSpeech=/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|API\s*Key|验证码.{0,8}\d{4,8}|密码.{0,8}\S{4})/i;
export const cleanCompanionText=(value,limit=600)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\s*·\s*/g,' ').trim().slice(0,limit);
export const sourceLabel=source=>({llm:'模型理解',program:'本地核对',preset:'预置案例',external:'外部内容',user:'你的输入',voice:'语音输入'}[source?.kind]||'本地核对');

// Origin is assigned by the host intake, never accepted from a document's own source field.
export function companionEnvelope(raw,{origin='program',kind='conversation',evidence=null,id=null}={}){
 const source={kind:ORIGINS.has(origin)?origin:'external'};
 let reply=cleanCompanionText(raw?.reply),speak=typeof raw?.speak==='string'?cleanCompanionText(raw.speak,260):null;
 const trustedReceipt=origin==='program'&&evidence?.status==='completed'&&typeof evidence.receipt==='string';
 if(['llm','preset'].includes(origin)&&(executionClaim.test(reply)||executionClaim.test(speak||''))&&!trustedReceipt){reply='这项操作尚未执行，请先核对下方安排。';if(speak)speak=reply;}
 if(!SPEAK_KINDS.has(kind)||source.kind==='external'||sensitiveSpeech.test(speak||''))speak=null;
 const cards=Array.isArray(raw?.cards)?raw.cards.filter(x=>x&&typeof x==='object').slice(0,12):[];
 // Actions remain inert, declarative suggestions. No function or executable content crosses this boundary.
 const actions=Array.isArray(raw?.actions)?raw.actions.filter(x=>x&&typeof x==='object'&&typeof x.type==='string').map(x=>({type:cleanCompanionText(x.type,60),taskId:cleanCompanionText(x.taskId,100),label:cleanCompanionText(x.label,100)})).slice(0,8):[];
 return {id:id||null,reply,speak,cards,actions,source,kind};
}

export function confirmationSnapshot(operation,{expiresAt,action='confirm'}={}){
 return Object.freeze({taskId:String(operation.id),revision:operation.revision,target:String(operation.target||''),amountMinor:operation.amountMinor||0,
  currency:operation.currency||'CNY',action,parameterKey:String(operation.parameterKey||operation.parameters||''),expiresAt});
}
export function sameConfirmation(a,b,now=Date.now()){
 return !!a&&!!b&&Number.isFinite(a.expiresAt)&&Number.isFinite(b.expiresAt)&&a.expiresAt>now&&b.expiresAt>now&&b.expiresAt<=a.expiresAt&&
  ['taskId','revision','target','amountMinor','currency','action','parameterKey'].every(k=>a[k]===b[k]);
}
