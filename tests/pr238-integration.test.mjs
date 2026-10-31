import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh} from '../web/engine.mjs';
import {buildAgentFacts} from '../web/agent-tools.mjs';
import {applyAgentResult,groundedReply} from '../web/agent-plans.mjs';
import {companionEnvelope} from '../web/companion-contract.mjs';

test('large amounts reach risk or explicit confirmation without executing',()=>{
 for(const risk of [false,true]){
  const s=fresh(),cash=s.balance,rows=s.ledger.length;
  const output=applyAgentResult(s,{status:risk?'blocked':'propose',scenario:risk?'risk_transfer':'transfer',reply:'请核对。',mode:'create',fields:{amount_minor:3000000,payee_id:risk?'unknown':'mom',source_account:'salary_0826',currency:'CNY',scheduled_date:'2026-11-02'}},buildAgentFacts(s),{originTurnId:'large',userText:risk?'转入安全账户':'给妈妈转30000元',agentRunId:'test'});
  const task=s.tasks.find(t=>t.id===output.taskId);assert.equal(task.status,risk?'blocked':'permission');assert.equal(task.granted,false);assert.equal(s.balance,cash);assert.equal(s.ledger.length,rows);
 }
});
test('money evidence cannot confuse fen, counts, user guesses or Chinese amounts',()=>{
 const facts={amount_minor:10000,count:7};
 assert.equal(groundedReply('核对100元',facts,'','fallback'),'核对100元');
 for(const text of ['核对10000元','核对7元','核对999元','核对三万元'])assert.equal(groundedReply(text,facts,'999元','fallback'),'fallback');
});
test('query replies bind the selected period and category to local facts',()=>{
 const s=fresh(),facts=buildAgentFacts(s,null,'2026-10');
 const out=applyAgentResult(s,{status:'answer',scenario:'question',query:'dining_month',reply:'2026-09购物999元',fields:{}},facts,{originTurnId:'read',userText:'999元吗'});
 assert.match(out.text,/2026-10 餐饮支出/);assert.doesNotMatch(out.text,/2026-09|购物|999元/);assert.equal(out.card.data.period,'2026-10');
});
test('speech-only completion claims and preset claims never become receipts',()=>{
 for(const origin of ['llm','preset'])for(const speak of ['已为你付款。','已帮你设置自动转账。']){
  const out=companionEnvelope({reply:'请核对方案',speak},{origin});assert.match(out.reply,/尚未执行/);assert.equal(out.speak,out.reply);
 }
});
