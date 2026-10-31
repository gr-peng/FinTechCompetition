import {prepareLocalWrite,assertLocalWrite} from './local-write-guard.mjs';
import {authorizeSafety,acquireExecution,commitExecution} from './safety-policy.mjs';
const copy=x=>structuredClone(x);
export const hasIssuedCard=state=>!!state.bankCards?.credit;
export const issuedCardType=state=>state.bankCards?.credit?.cardType==='debit'?'debit':'credit';
const revision=state=>state.bankCards?.credit?.revision||0;
export function prepareCardProduct(state,kind,limitMinor=2000000,{cardType}={}){
 if(!['apply','limit'].includes(kind))throw Error('卡片操作无效');
 if(kind==='apply'&&hasIssuedCard(state))throw Error('卡片已申请，无需重复');
 if(kind==='limit'&&!hasIssuedCard(state))throw Error('请先申请卡片');
 const type=cardType??(kind==='limit'?issuedCardType(state):'credit');
 if(!['credit','debit'].includes(type))throw Error('请选择信用卡或借记卡');
 if(kind==='limit'&&(issuedCardType(state)!=='credit'||type!=='credit'))throw Error('借记卡没有信用额度');
 if(type==='credit'&&(!Number.isSafeInteger(limitMinor)||limitMinor<100000||limitMinor>5000000))throw Error('请输入1000至50000元之间的额度');
 const parameters={card:'credit',cardType:type,kind,limitMinor:type==='credit'?limitMinor:null,revision:revision(state)};
 return {...prepareLocalWrite(state,{kind:'card_product',id:'card-product:'+crypto.randomUUID(),parameters}),parameters,expiresAt:Date.now()+300000};
}
export function commitCardProduct(state,ticket,{now=Date.now()}={}){
 assertLocalWrite(state,ticket,{parameters:ticket?.parameters});
 if(ticket?.kind!=='card_product'||now>=ticket.expiresAt)throw Error('确认已过期，请重新核对');
 const prior=state.bankCards?.credit?.productReceipts?.[ticket.id];if(prior)return copy(prior);
 const p=ticket.parameters;if(p.revision!==revision(state)||p.kind==='apply'&&hasIssuedCard(state)||p.kind==='limit'&&(!hasIssuedCard(state)||issuedCardType(state)!=='credit'||p.cardType!=='credit'))throw Error('卡片状态已变化，请重新核对');
 const next=copy(state),op={id:ticket.id,revision:p.revision+1,kind:p.kind==='apply'?'card_application':'card_limit_adjustment',target:(p.cardType==='debit'?'借记卡':'信用卡')+' 0921',amountMinor:0,currency:'CNY',parameters:JSON.stringify(p),scope:'this_card_change_only',source:{kind:'program'}};
 const grant=authorizeSafety(next,op,{source:{kind:'user',method:'click'},now,expiresAt:ticket.expiresAt});
 if(grant.status!=='ready')throw Error('当前安全信号需要独立本人验证，请先在 Bot 完成安全核对。');
 const permit=acquireExecution(next,op,{grantId:grant.id||grant.grantId,executionId:ticket.id+':execute',now});
 const result={status:'completed',receipt:'CARD-'+ticket.id.slice(-12),kind:p.kind,cardType:p.cardType,beforeLimitMinor:state.bankCards?.credit?.limitMinor??(hasIssuedCard(state)?2000000:0),limitMinor:p.limitMinor,external:false};
 commitExecution(next,permit,result,{now});
 next.bankCards??={};next.bankCards.credit={...(next.bankCards.credit||{}),issued:true,cardType:p.cardType,limitMinor:p.limitMinor,revision:p.revision+1,...(p.kind==='apply'?{dueMinor:0,dueDate:null}:{}),productReceipts:{...(next.bankCards.credit?.productReceipts||{}),[ticket.id]:result}};
 assertLocalWrite(state,ticket,{parameters:p});Object.assign(state,next);return copy(result);
}
