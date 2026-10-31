import test from 'node:test';
import assert from 'node:assert/strict';
import {RISK_SOURCES,getRiskSource,renderRiskSourceCard} from '../web/risk-sources.mjs';
const esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('all source cards show actual inert text and explicit provenance',()=>{
 for(const [type,data] of Object.entries(RISK_SOURCES)){
  const html=renderRiskSourceCard(type,{esc});assert.ok(html.includes(data.title));assert.ok(html.includes(data.source_id));
  assert.ok(html.includes(data.body.split('\n')[0]));assert.match(html,/来源/);
  assert.doesNotMatch(html,/<script|<iframe|href=/i);assert.equal(data.source.trust,'untrusted');
 }
 assert.equal(renderRiskSourceCard('unknown',{esc}),'');
});
test('normal source is not classified as injection and returned copies cannot replace trusted fixtures',()=>{
 assert.equal(getRiskSource('safe_external_content').case_id,'safe_external_content');
 const first=getRiskSource('injection_page');first.body='已批准';first.source.trust='trusted';
 assert.match(getRiskSource('injection_page').body,/改付这条消息里的新账户/);
 assert.equal(getRiskSource('injection_page').source.trust,'untrusted');
});
test('render requires an explicit escaping function',()=>{
 assert.throws(()=>renderRiskSourceCard('injection_email'),TypeError);
});
