import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh} from '../web/engine.mjs';
import {createBankCards} from '../web/bank-cards.mjs';

function fixture(state=fresh()) {
 let saves=0;
 const ui=createBankCards({getState:()=>state,save:()=>saves++,esc:String,money:n=>String(n),icon:()=>'',onLedger(){}});
 return {state,ui,saves:()=>saves};
}
function withDocument(fn) {
 const previous=globalThis.document;
 globalThis.document={querySelector:()=>null};
 try {fn();} finally {globalThis.document=previous;}
}
const confirmation=ui=>({dataset:{version:ui.html().match(/data-action="bank-product-confirm" data-version="([^"]+)"/)[1]}});
const application=(ui,type='credit')=>{ui.actions['bank-card-apply']();if(type==='debit')ui.actions['bank-product-type']({dataset:{type}});ui.actions['bank-product-review']();};

test('new wallet exposes application beside its heading, ahead of the full card stack',()=>{
 const {ui}=fixture(),html=ui.html();
 assert.match(html,/>2张<\/span>/);
 assert.ok(html.indexOf('data-action="bank-card-apply"')<html.indexOf('class="bank-wallet-stack"'));
 assert.doesNotMatch(html,/管理信用卡|信用卡 0921 已开通/);
});

test('cancelled application leaves two cards, and its late confirmation cannot create a card',()=>withDocument(()=>{
 const {state,ui,saves}=fixture(),before=structuredClone(state);
 application(ui);const old=confirmation(ui),html=ui.html();
 assert.ok(html.indexOf('data-action="bank-product-confirm"')<html.indexOf('class="bank-wallet-stack"'));
 assert.match(html,/data-action="bank-card-apply" disabled/);
 ui.actions['bank-product-cancel']();ui.actions['bank-product-confirm'](old);
 assert.deepEqual(state,before);assert.equal(saves(),0);assert.match(ui.html(),/>2张<\/span>/);
 assert.doesNotMatch(ui.html(),/data-action="bank-card-apply" disabled/);
}));

test('application confirmation makes three cards once; rerender/navigation exposes management without duplicating',()=>withDocument(()=>{
 const {state,ui,saves}=fixture(),cash=state.balance,rows=state.ledger.length;
 application(ui);const submit=confirmation(ui);
 ui.actions['bank-product-confirm'](submit);ui.actions['bank-product-confirm'](submit);
 assert.equal(saves(),1);assert.equal(state.balance,cash);assert.equal(state.ledger.length,rows);
 const reloaded=fixture(JSON.parse(JSON.stringify(state))).ui;
 assert.match(reloaded.html(),/>3张<\/span>/);assert.match(reloaded.html(),/信用卡 0921 已开通/);
 assert.doesNotMatch(reloaded.html(),/data-action="bank-card-apply"/);
 assert.ok(reloaded.html().indexOf('data-action="bank-card-manage"')<reloaded.html().indexOf('class="bank-wallet-stack"'));
}));

test('application offers credit and debit; the selected debit product has no credit debt or limit controls',()=>withDocument(()=>{
 const {state,ui}=fixture();ui.actions['bank-card-apply']();
 assert.match(ui.html(),/data-action="bank-product-type" data-type="credit" aria-pressed="true"/);
 assert.match(ui.html(),/data-action="bank-product-type" data-type="debit"/);
 assert.doesNotMatch(ui.html(),/data-action="bank-product-confirm"/);
 ui.actions['bank-product-type']({dataset:{type:'debit'}});
 assert.doesNotMatch(ui.html(),/id="bank-limit-input"/);
 ui.actions['bank-product-review']();assert.match(ui.html(),/借记卡 尾号0921/);
 ui.actions['bank-product-confirm'](confirmation(ui));
 const html=ui.html();assert.equal(state.bankCards.credit.cardType,'debit');assert.equal(state.bankCards.credit.limitMinor,null);
 assert.match(html,/>3张<\/span>/);assert.match(html,/管理借记卡/);assert.match(html,/借记卡 0921 已开通/);
 assert.doesNotMatch(html,/信用额度|本期待还|还款提醒|data-action="bank-card-limit"/);
 assert.throws(()=>ui.actions['bank-card-limit'](),/信用卡/);
}));

test('limit adjustment replaces current card details instead of appearing above the wallet, and supports cancel then save',()=>{
 const state=fresh();state.bankCards={credit:{limitMinor:2000000}};const {ui,saves}=fixture(state);
 const previous=globalThis.document;let value='30000',focused=0,scrolled=0;
 globalThis.document={querySelector:selector=>selector==='#bank-limit-input'?{value,focus(){focused++;}}:selector==='.bank-product'?{scrollIntoView(){scrolled++;}}:null};
 try{
  ui.actions['bank-card-manage']();ui.actions['bank-card-limit']();
  const html=ui.html();assert.ok(html.indexOf('class="bank-card-details bank-product"')>html.indexOf('class="bank-wallet-stack"'));
  assert.equal((html.match(/id="bank-card-details"/g)||[]).length,1);assert.ok(focused>0&&scrolled>0);
  ui.actions['bank-product-review']();const stale=confirmation(ui);ui.actions['bank-product-cancel']();ui.actions['bank-product-confirm'](stale);
  assert.equal(state.bankCards.credit.limitMinor,2000000);assert.equal(saves(),0);
  ui.actions['bank-card-limit']();ui.actions['bank-product-review']();ui.actions['bank-product-confirm'](confirmation(ui));
  assert.equal(state.bankCards.credit.limitMinor,3000000);assert.equal(saves(),1);assert.match(ui.html(),/信用额度已调整为 30000/);
 }finally{globalThis.document=previous;}
});

test('freeze and unfreeze use current card state and give clear completed feedback',()=>withDocument(()=>{
 const {state,ui,saves}=fixture();ui.actions['bank-card-select']({dataset:{card:'living'}});
 assert.match(ui.html(),/>冻结该卡<\/button>/);ui.actions['bank-card-pause']();
 assert.match(ui.html(),/冻结生活卡尾号1608/);let version=ui.html().match(/data-action="bank-card-confirm" data-card="living" data-version="([^"]+)"/)[1];
 ui.actions['bank-card-confirm']({dataset:{card:'living',version}});
 assert.equal(state.cardLocked,true);assert.match(ui.html(),/生活卡已冻结/);assert.match(ui.html(),/>解冻该卡<\/button>/);
 ui.actions['bank-card-pause']();version=ui.html().match(/data-action="bank-card-confirm" data-card="living" data-version="([^"]+)"/)[1];
 ui.actions['bank-card-confirm']({dataset:{card:'living',version}});
 assert.equal(state.cardLocked,false);assert.match(ui.html(),/生活卡已解冻，可继续使用/);assert.equal(saves(),2);
}));

test('management and card face share an actual toggle and switching clears stale panels',()=>withDocument(()=>{
 const state=fresh();state.bankCards={credit:{}};const {ui}=fixture(state);
 ui.actions['bank-card-manage']();assert.match(ui.html(),/data-action="bank-card-manage" aria-expanded="true"/);
 ui.actions['bank-card-manage']();assert.match(ui.html(),/data-action="bank-card-manage" aria-expanded="false"/);
 assert.match(ui.html(),/id="bank-card-details" hidden/);
 ui.actions['bank-card-details']();assert.match(ui.html(),/data-action="bank-card-manage" aria-expanded="true"/);
 ui.actions['bank-card-limit']();assert.match(ui.html(),/bank-product/);
 ui.actions['bank-card-select']({dataset:{card:'living'}});assert.doesNotMatch(ui.html(),/bank-product/);
 ui.actions['bank-card-manage']();assert.match(ui.html(),/bank-card-credit is-front/);
 ui.actions['bank-card-manage']();assert.match(ui.html(),/id="bank-card-details" hidden/);
}));

test('existing legacy credit card remains intact and its visible management entry opens limit controls',()=>withDocument(()=>{
 const state=fresh();state.bankCards={credit:{limitMinor:3000000,reminder:false,paused:true}};
 const before=structuredClone(state),{ui,saves}=fixture(state);
 assert.match(ui.html(),/信用卡 0921 已开通/);assert.doesNotMatch(ui.html(),/data-action="bank-card-apply"/);
 ui.actions['bank-card-manage']();
 assert.match(ui.html(),/bank-card-credit is-front/);assert.match(ui.html(),/data-action="bank-card-limit">调整额度/);
 assert.match(ui.html(),/30000/);assert.deepEqual(state,before);assert.equal(saves(),0);
 ui.actions['bank-card-limit']();assert.match(ui.html(),/id="bank-limit-input"[^>]*value="30000"/);
 ui.actions['bank-product-cancel']();assert.deepEqual(state,before);assert.equal(saves(),0);
}));
