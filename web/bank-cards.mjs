import {hasIssuedCard,issuedCardType,prepareCardProduct,commitCardProduct} from './bank-card-products.mjs';
// R7 rc2: vertical stack adapted from actual Stitch screen
// cfabf0e622c94fdb803bbf33f8abd14c. Data/events are our local adapter;
// invented issuers/yields/products in the generated preview are not used.
import {prepareLocalWrite,assertLocalWrite} from './local-write-guard.mjs';
export const DEMO_BANK_CARDS=Object.freeze([
 Object.freeze({id:'salary',name:'工资卡',tail:'0826',type:'借记卡',purpose:'工资入账'}),
 Object.freeze({id:'living',name:'生活卡',tail:'1608',type:'借记卡',purpose:'日常支出'}),
 Object.freeze({id:'credit',name:'信用卡',tail:'0921',type:'信用卡',purpose:'本期账单',dueMinor:128000,limitMinor:2000000,dueDate:'2026-11-18'})
]);
export function bankCardState(state,id){
 const card=DEMO_BANK_CARDS.find(c=>c.id===id);if(!card)throw Error('卡片不存在');
 const saved=state.bankCards?.[id]||{};
 return {...card,...Object.fromEntries(Object.entries(saved).filter(([key])=>['limitMinor','dueMinor','dueDate'].includes(key))),...(id==='credit'&&issuedCardType(state)==='debit'?{name:'借记卡',type:'借记卡',purpose:'日常收支',limitMinor:null,dueMinor:0,dueDate:null}:{}),paused:id==='living'?!!state.cardLocked:!!saved.paused,reminder:saved.reminder!==false};
}
const cardRevision=(state,id)=>state.bankCards?.[id]?.revision??0;
const changeParameters=(id,paused,expected,revision)=>({card:id,paused,expected,revision});
const reminderParameters=(id,value,expected,revision)=>({card:id,reminder:value,expected,revision});
const receiptCopy=value=>structuredClone(value);
export function prepareCardChange(state,id,paused,{expected}={}){
 const current=bankCardState(state,id);if(typeof paused!=='boolean')throw Error('卡片状态无效');
 if(expected!==undefined&&current.paused!==expected)throw Error('卡片状态已变化，请重新核对');
 const before=expected??current.paused,revision=cardRevision(state,id),ticket=prepareLocalWrite(state,{kind:'card_state',id:'card-state:'+crypto.randomUUID(),parameters:changeParameters(id,paused,before,revision)});
 return Object.freeze({...ticket,card:id,paused,expected:before,revision});
}
export function prepareCardReminder(state,id,value){
 const current=bankCardState(state,id);if(id!=='credit'||current.type!=='信用卡'||typeof value!=='boolean')throw Error('提醒设置无效');
 const revision=cardRevision(state,id),ticket=prepareLocalWrite(state,{kind:'card_reminder',id:'card-reminder:'+crypto.randomUUID(),parameters:reminderParameters(id,value,current.reminder,revision)});
 return Object.freeze({...ticket,card:id,value,expected:current.reminder,revision});
}
function commitCard(state,id,ticket,parameters,kind,apply){
 // Check the latest passed state even for a repeated set. A local card control
 // must never double as an unlock for the separate global safety state.
 assertLocalWrite(state,ticket,{parameters});
 if(ticket.kind!==kind)throw Error('卡片核对记录无效，请重新打开');
 const previous=state.bankCards?.[id]?.writeResults?.[ticket.id];
 if(previous){if(previous.parameterKey!==ticket.parameterKey)throw Error('卡片参数已变化，请重新核对');return receiptCopy(previous.result);}
 const candidate=structuredClone(state),result=apply(candidate);
 candidate.bankCards||={};candidate.bankCards[id]||={};candidate.bankCards[id].writeResults||={};
 candidate.bankCards[id].writeResults[ticket.id]={parameterKey:ticket.parameterKey,epoch:ticket.epoch,result:receiptCopy(result)};
 assertLocalWrite(state,ticket,{parameters});Object.assign(state,candidate);return receiptCopy(result);
}
export function setCardPaused(state,id,paused,{expected,ticket}={}){
 const current=bankCardState(state,id);if(typeof paused!=='boolean')throw Error('卡片状态无效');
 const before=expected??ticket?.expected,parameters=changeParameters(id,paused,before,ticket?.revision);
 return commitCard(state,id,ticket,parameters,'card_state',candidate=>{
  if(cardRevision(candidate,id)!==ticket.revision)throw Error('卡片状态已变化，请重新核对');
  if(current.paused!==paused&&before!==undefined&&current.paused!==before)throw Error('卡片状态已变化，请重新核对');
  candidate.bankCards||={};candidate.bankCards[id]||={};
  if(id==='living')candidate.cardLocked=paused;else candidate.bankCards[id].paused=paused;
  if(current.paused!==paused)candidate.bankCards[id].revision=ticket.revision+1;
  return bankCardState(candidate,id);
 });
}
export function setCardReminder(state,id,value,{ticket}={}){
 const card=bankCardState(state,id);if(id!=='credit'||card.type!=='信用卡'||typeof value!=='boolean')throw Error('提醒设置无效');
 return commitCard(state,id,ticket,reminderParameters(id,value,ticket?.expected,ticket?.revision),'card_reminder',candidate=>{
  if(cardRevision(candidate,id)!==ticket.revision)throw Error('提醒设置已变化，请重新核对');
  const current=bankCardState(candidate,id);if(current.reminder!==value&&current.reminder!==ticket.expected)throw Error('提醒设置已变化，请重新核对');
  candidate.bankCards||={};candidate.bankCards[id]||={};candidate.bankCards[id].reminder=value;if(current.reminder!==value)candidate.bankCards[id].revision=ticket.revision+1;return bankCardState(candidate,id);
 });
}

const CHIP='<svg viewBox="0 0 30 24" fill="none" aria-hidden="true"><rect x="1" y="1" width="28" height="22" rx="5"/><path d="M10 1v22M20 1v22M1 8h9m10 0h9M1 16h9m10 0h9M10 12h10"/></svg>';
export function createBankCards({getState,save,esc,money,icon,onLedger}){
 let selected='salary',expanded=false,pending=null,product=null,productNotice=null;
 const available=()=>DEMO_BANK_CARDS.filter(c=>c.id!=='credit'||hasIssuedCard(getState())).map(c=>bankCardState(getState(),c.id));
 const amount=n=>money(n/100),card=()=>bankCardState(getState(),selected);
 function details(){
  if(product?.kind==='limit')return productPanel('bank-card-details');
  const c=card();return `<div class="bank-card-details" id="bank-card-details"><dl>${c.type==='信用卡'?`<div><dt>本期待还</dt><dd class="money">${amount(c.dueMinor)}</dd></div><div><dt>还款日</dt><dd>${c.dueDate?'11月18日':'暂无待还'}</dd></div><div><dt>信用额度</dt><dd class="money">${amount(c.limitMinor)}</dd></div>`:`<div><dt>用途</dt><dd>${esc(c.purpose)}</dd></div>`}<div><dt>卡片状态</dt><dd>${c.paused?'已冻结':'使用中'}</dd></div></dl>${c.type==='信用卡'?`<div class="bank-card-reminder"><span>还款提醒</span><button type="button" role="switch" aria-checked="${c.reminder}" aria-label="还款提醒" data-action="bank-card-reminder" class="toggle ${c.reminder?'on':''}"></button></div>`:''}${pending?`<div class="bank-card-confirm"><p>${pending.paused?'冻结':'解冻'}${esc(c.name)}尾号${c.tail}？</p><div><button type="button" class="ap-w-button ap-w-primary" data-action="bank-card-confirm" data-card="${c.id}" data-version="${pending.id}">确认${pending.paused?'冻结':'解冻'}</button><button type="button" class="ap-w-button" data-action="bank-card-cancel">取消</button></div></div>`:`<div class="bank-card-actions">${c.type==='信用卡'?'<button type="button" class="ap-w-button" data-action="bank-card-limit">调整额度</button>':''}<button type="button" class="ap-w-button" data-action="bank-card-pause">${c.paused?'解冻该卡':'冻结该卡'}</button><button type="button" class="ap-w-button" data-action="bank-card-ledger">查看明细</button></div>`}</div>`;
 }
 function productPanel(id='bank-product-panel'){
  if(!product)return '';
  const type=product.cardType,name=type==='debit'?'借记卡':'信用卡',limit=product.ticket?.parameters.limitMinor;
  const choice=product.kind==='apply'&&!product.ticket?`<div class="bank-product-types" role="group" aria-label="卡片类型">${[['credit','信用卡'],['debit','借记卡']].map(([value,label])=>`<button type="button" class="ap-w-button" data-action="bank-product-type" data-type="${value}" aria-pressed="${type===value}">${label}</button>`).join('')}</div>`:'';
  const fields=type==='credit'?`<label>信用额度（元）<input id="bank-limit-input" type="number" min="1000" max="50000" step="100" value="${product.limitMinor/100}"></label>`:'<p>借记卡 · 尾号0921</p>';
  return `<div class="bank-card-details bank-product" id="${id}"><h3>${product.kind==='apply'?'申请一张卡':'调整信用额度'}</h3>${choice}${!product.ticket?`${fields}<button type="button" class="ap-w-button ap-w-primary" data-action="bank-product-review">${product.kind==='apply'?'核对申请':'核对额度'}</button>`:`<p>${name} 尾号0921</p>${type==='credit'?`<div class="plan-row"><span>信用额度</span><strong>${amount(limit)}</strong></div>`:''}<button type="button" class="ap-w-button ap-w-primary" data-action="bank-product-confirm" data-version="${product.ticket.id}">确认${product.kind==='apply'?'申请':'调整'}</button>`}<button type="button" class="ap-w-button" data-action="bank-product-cancel">取消</button></div>`;
 }
 function productEntry(){const name=bankCardState(getState(),'credit').name;return hasIssuedCard(getState())?`<button type="button" class="ap-w-button bank-card-entry" data-action="bank-card-manage" aria-expanded="${selected==='credit'&&expanded}" aria-controls="bank-card-details" aria-label="管理已开通的${name}">管理${name}</button>`:`<button type="button" class="ap-w-button bank-card-entry bank-card-apply" data-action="bank-card-apply"${product?' disabled':''}>申请一张卡</button>`;}
 function html(){if(!available().some(c=>c.id===selected))selected='salary';const c=card(),order=[...available().filter(row=>row.id!==selected),c];
  const candles='<svg class="bank-candle-texture" viewBox="0 0 320 200" aria-hidden="true"><g fill="none" stroke="currentColor"><path d="M90 162v-40m25 24V99m25 36V84m25 35V65m25 42V43m25 49V28m25 56V15"/><path stroke-width="6" d="M90 151v-18m25 2v-24m25 11V96m25 12V78m25 17V56m25 24V42m25 29V29"/></g></svg>';
  return `<section class="bank-cards" aria-labelledby="bank-cards-title"><div class="bank-cards-heading"><h2 id="bank-cards-title">银行卡</h2><span>${available().length}张</span>${productEntry()}</div>${hasIssuedCard(getState())?`<p class="bank-card-issued">${esc(bankCardState(getState(),'credit').name)} 0921 已开通</p>`:''}${productNotice?`<p class="card-product-result" role="status">${icon('check')}${esc(productNotice)}</p>`:''}${product?.kind==='apply'?productPanel():''}<div class="bank-wallet-stack" style="--card-count:${order.length}" role="group" aria-label="选择银行卡">${order.map((row,i)=>{const front=i===order.length-1;return `<div class="bank-wallet-layer" style="--stack-index:${i}"><div class="bank-card-face bank-card-${row.id}${front?' is-front':''}" data-card="${row.id}">${front?`<canvas class="bank-metal-canvas" aria-hidden="true"></canvas>${candles}<button type="button" class="bank-card-foreground" data-action="bank-card-details" data-card="${row.id}" aria-expanded="${expanded}" aria-controls="bank-card-details" aria-label="${expanded?'收起':'展开'}${row.name} 尾号${row.tail}详情"><span class="bank-card-top"><span>${icon('card')}<strong>${esc(row.name)}</strong>${row.type===row.name?'':`<small>${row.type}</small>`}</span><i class="bank-chip">${CHIP}</i></span><span class="bank-card-digits">•••• •••• •••• <strong>${row.tail}</strong></span><span class="bank-card-bottom"><span>${row.paused?'已冻结':'使用中'}${icon(expanded?'down':'next')}</span><b class="bank-network">${row.id==='salary'?'VISA':esc(row.type)}</b></span></button>`:`<button type="button" class="bank-card-tab" data-action="bank-card-select" data-card="${row.id}" aria-label="${row.name} 尾号${row.tail}"><strong>${esc(row.name)}</strong><span>•••• ${row.tail}</span>${icon('down')}</button>`}</div></div>`;}).join('')}</div>${expanded?details():'<div id="bank-card-details" hidden></div>'}</section>`;
 }
 function paint(){const el=document.querySelector('.bank-cards');if(!el)return;const active=el.contains(document.activeElement)?document.activeElement.dataset:null;const old=active?{...active}:null;el.outerHTML=html();if(old){const buttons=[...document.querySelectorAll('.bank-cards button')],next=buttons.find(b=>b.dataset.action===old.action&&(!old.card||b.dataset.card===old.card))||document.querySelector('.bank-card-foreground');next?.focus({preventScroll:true});}}
 function focusProduct(){const panel=document.querySelector('.bank-product');panel?.scrollIntoView?.({block:'nearest',behavior:'auto'});const field=document.querySelector('#bank-limit-input');field?.focus?.({preventScroll:true});}
 return {html,actions:{
  'bank-card-manage':()=>{if(!hasIssuedCard(getState()))return;expanded=selected==='credit'?!expanded:true;selected='credit';pending=null;product=null;productNotice=null;paint();},
  'bank-card-apply':()=>{if(hasIssuedCard(getState()))return;prepareCardProduct(getState(),'apply');productNotice=null;pending=null;product={kind:'apply',cardType:'credit',limitMinor:2000000,ticket:null};paint();focusProduct();},
  'bank-card-limit':()=>{const c=card();if(c.id!=='credit'||c.type!=='信用卡')throw Error('请选择信用卡调整额度');prepareCardProduct(getState(),'limit',c.limitMinor);productNotice=null;pending=null;expanded=true;product={kind:'limit',cardType:'credit',limitMinor:c.limitMinor,ticket:null};paint();focusProduct();},
  'bank-product-type':el=>{if(product?.kind!=='apply'||product.ticket)return;const type=el.dataset.type;if(!['credit','debit'].includes(type))throw Error('请选择卡片类型');const field=document.querySelector('#bank-limit-input');if(field&&Number.isFinite(Number(field.value)))product.limitMinor=Math.round(Number(field.value)*100);product.cardType=type;paint();},
  'bank-product-review':()=>{if(!product||product.ticket)return;const value=product.cardType==='credit'?Math.round(Number(document.querySelector('#bank-limit-input')?.value??product.limitMinor/100)*100):null;product.ticket=prepareCardProduct(getState(),product.kind,value,{cardType:product.cardType});paint();focusProduct();},
  'bank-product-cancel':()=>{product=null;paint();},
  'bank-product-confirm':el=>{if(!product?.ticket||product.ticket.id!==el.dataset.version)return;const result=commitCardProduct(getState(),product.ticket);save();selected='credit';expanded=true;product=null;productNotice=result.kind==='apply'?(result.cardType==='debit'?'借记卡':'信用卡')+'已开通。':'信用额度已调整为 '+amount(result.limitMinor);paint();},
  'bank-card-select':el=>{if(!available().some(c=>c.id===el.dataset.card))return;selected=el.dataset.card;expanded=true;pending=null;product=null;productNotice=null;paint();},
  'bank-card-details':()=>{expanded=!expanded;pending=null;product=null;productNotice=null;paint();},
   'bank-card-pause':()=>{const c=card(),ticket=prepareCardChange(getState(),c.id,!c.paused,{expected:c.paused});pending={id:ticket.id,card:c.id,expected:c.paused,paused:!c.paused,ticket};paint();},
  'bank-card-cancel':()=>{pending=null;paint();},
   'bank-card-confirm':el=>{if(!pending||pending.id!==el.dataset.version||pending.card!==selected||el.dataset.card!==selected)return;const updated=setCardPaused(getState(),selected,pending.paused,{expected:pending.expected,ticket:pending.ticket});save();productNotice=updated.name+'已'+(updated.paused?'冻结。':'解冻，可继续使用。');pending=null;paint();},
   'bank-card-reminder':()=>{const c=card(),ticket=prepareCardReminder(getState(),selected,!c.reminder);setCardReminder(getState(),selected,!c.reminder,{ticket});save();paint();},
  'bank-card-ledger':()=>onLedger(card())
 }};
}
