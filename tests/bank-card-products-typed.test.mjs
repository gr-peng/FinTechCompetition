import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh} from '../web/engine.mjs';
import {prepareCardProduct,commitCardProduct,hasIssuedCard} from '../web/bank-card-products.mjs';
import {bankCardState,prepareCardReminder} from '../web/bank-cards.mjs';
import {resetDemoOnBoot} from '../web/demo-boot.mjs';

test('both product types create only a third card, preserve money, and reset to two',()=>{
 for(const cardType of ['credit','debit']){
  const state=fresh(),before={balance:state.balance,ledger:structuredClone(state.ledger)};
  const ticket=prepareCardProduct(state,'apply',2000000,{cardType}),result=commitCardProduct(state,ticket);
  assert.equal(result.cardType,cardType);assert.equal(result.external,false);assert.equal(state.bankCards.credit.cardType,cardType);
  const card=bankCardState(state,'credit');assert.equal(card.type,cardType==='credit'?'信用卡':'借记卡');
  assert.equal(card.limitMinor,cardType==='credit'?2000000:null);assert.equal(card.dueMinor,0);
  assert.equal(state.balance,before.balance);assert.deepEqual(state.ledger,before.ledger);
  const once=structuredClone(state);assert.deepEqual(commitCardProduct(state,ticket),result);assert.deepEqual(state,once);
  assert.throws(()=>prepareCardProduct(state,'apply',2000000,{cardType}));
  resetDemoOnBoot(state);assert.equal(hasIssuedCard(state),false);assert.equal(state.balance,before.balance);
 }
});

test('debit cards cannot acquire credit limit or repayment reminder through hidden controls',()=>{
 const state=fresh();commitCardProduct(state,prepareCardProduct(state,'apply',null,{cardType:'debit'}));
 const before=structuredClone(state);
 assert.throws(()=>prepareCardProduct(state,'limit',3000000),/借记卡/);
 assert.throws(()=>prepareCardReminder(state,'credit',true));
 assert.deepEqual(state,before);
});

test('card type is part of the immutable application binding and stale choices cannot survive a lock',()=>{
 for(const cardType of ['credit','debit']){
  const state=fresh(),ticket=prepareCardProduct(state,'apply',2000000,{cardType});
  const tampered=structuredClone(ticket);tampered.parameters.cardType=cardType==='credit'?'debit':'credit';
  assert.throws(()=>commitCardProduct(state,tampered),e=>e.code==='stale_binding');
  state.safety??={epoch:0,locked:false};state.safety.locked=true;state.safety.epoch++;
  const before=structuredClone(state);assert.throws(()=>commitCardProduct(state,ticket),e=>e.code==='locked');assert.deepEqual(state,before);
  state.safety.locked=false;assert.throws(()=>commitCardProduct(state,ticket),e=>e.code==='stale_write');assert.equal(hasIssuedCard(state),false);
 }
});
