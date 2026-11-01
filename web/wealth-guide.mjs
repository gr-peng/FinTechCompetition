import {ensureFinance,financialFacts,syncFinance} from './finance-state.mjs';
import {validatePermit,commitExecution,revokeOperation} from './safety-policy.mjs';

const money=n=>'¥'+(n/100).toLocaleString('zh-CN',{maximumFractionDigits:2});
const clone=x=>structuredClone(x);
export const WEALTH_PRODUCTS=Object.freeze([
 {id:'demo-flex',name:'清泉灵活',risk:1,assets:'现金及短期存款类资产',fee:'管理费每年0.20%，无申购费',redemption:'申请赎回后预计1个工作日到账',date:'2026-11-02',horizons:['随时','半年','一年','三年以上','不确定'],detail:'虚构研究产品。净值可能波动，不保本、不保证收益；赎回到账前不可用于付款。'},
 {id:'demo-bond',name:'远山稳健',risk:2,assets:'高等级债券为主，不配置股票',fee:'管理费每年0.35%；持有不足180天赎回费0.50%',redemption:'最短持有180天，开放日申请后预计2个工作日到账',date:'2026-11-02',horizons:['半年','一年','三年以上'],detail:'虚构研究产品。存在利率、信用及流动性风险，可能亏损；六个月内需要的资金不适用。'},
]);
export function allocation(state,{now=Date.now()}={}){
 ensureFinance(state);const month=new Date(now+8*3600000).toISOString().slice(0,7),facts=financialFacts(state,month);
 const budgets=state.nativeBudget?.[month]?.categories||[{category:'住房',limit_minor:350000},{category:'餐饮',limit_minor:200000},{category:'其他',limit_minor:100000}];
 const essential=new Set(['住房','餐饮','其他','生活缴费','出行']);
 const obligations=budgets.filter(c=>essential.has(c.category)).reduce((n,c)=>n+Math.max(0,c.limit_minor-(facts.categories.find(([k])=>k===c.category)?.[1]||0)),0);
 const [y,m]=month.split('-').map(Number),previous=new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7),past=financialFacts(state,previous);
 const buffer=past.categories.filter(([k])=>essential.has(k)).reduce((n,[,v])=>n+v,0);
 const cash=Math.max(0,Math.round(state.balance*100));return {cash,obligations,buffer,available:Math.max(0,cash-obligations-buffer),month,previous};
}
export function startWealthGuide(state,{now,id='wealth-'+crypto.randomUUID()}={}){
 state.wealthGuide={id,revision:1,stage:'direction',fields:{},createdAt:now,expiresAt:now+1800000,allocation:allocation(state,{now})};return state.wealthGuide;
}
const stages={direction:['save','earn','unsure'],extra:['旅行','学费','其他','暂无'],horizon:['随时','半年','一年','三年以上','不确定'],experience:['没有经验','了解基金或理财','有多年投资经验'],loss:['不能接受本金损失','可接受小幅亏损','能承受明显波动'],stability:['收入不稳定','收入稳定但有压力','收入稳定且有充足备用金'],goal:['旅行','应急备用','学习提升']};
export function validWealthRisk(state,now){const p=state.wealthRiskProfile;return p?.source==='self_report'&&p.expiresAt>now&&[1,2,3].includes(p.level)&&Array.isArray(p.answers)&&p.answers.length===3;}
export function wealthChoice(state,value,{now,expectedRevision}={}){
 const g=state.wealthGuide;if(!g||expectedRevision!==g.revision)throw Error('这份方案已更新，请核对当前选项。');
 if(['done','cancelled','verifying'].includes(g.stage))throw Error('当前步骤不能修改。');
 if(value==='cancel'){g.stage='cancelled';g.revision++;return g;}
 const stage=g.stage;
 if(stages[stage]&&!(stage==='goal'&&typeof value==='string'&&value.trim()&&value.length<=24)&&!stages[stage].includes(value))throw Error('请选择当前问题的一个选项。');
 if(stage==='direction'){
  if(value==='unsure'){g.guidance=true;return g;}
  g.fields.direction=value;g.stage=value==='save'?'goal':'extra';
 }else if(stage==='goal'){g.fields.goal=value;g.stage='goal_amount';}
 else if(stage==='goal_amount'){g.fields.target_minor=positive(value);g.stage='daily';}
 else if(stage==='daily'){g.fields.daily_minor=positive(value);if(g.fields.daily_minor>g.fields.target_minor)throw Error('每天存入不能超过目标。');g.stage='saving_confirm';}
 else if(stage==='extra'){g.fields.extra=value;if(value==='暂无'){g.fields.extra_minor=0;g.stage='horizon';}else g.stage='extra_amount';}
 else if(stage==='extra_amount'){g.fields.extra_minor=positive(value);if(g.fields.extra_minor>g.allocation.cash)throw Error('预留金额超过当前现金，请调整。');g.stage='horizon';}
 else if(stage==='horizon'){g.fields.horizon=value;g.stage=validWealthRisk(state,now)?'products':'experience';}
 else if(['experience','loss','stability'].includes(stage)){
  g.fields[stage]=value;g.stage={experience:'loss',loss:'stability',stability:'products'}[stage];
  if(stage==='stability'){const answers=['experience','loss','stability'].map(k=>stages[k].indexOf(g.fields[k]));state.wealthRiskProfile={source:'self_report',answers,level:Math.min(...answers)+1,assessedAt:now,expiresAt:now+365*86400000};}
 }else if(stage==='products'){
  const p=WEALTH_PRODUCTS.find(p=>p.id===value);if(!p||!eligible(state,g,p,now))throw Error('这个产品与本次期限或风险承受范围不匹配。');g.fields.product_id=p.id;g.stage='amount';
 }else if(stage==='amount'){
  g.fields.amount_minor=positive(value);if(g.fields.amount_minor>investable(g))throw Error('申购金额不能超过可投资资金。');g.stage='confirm';g.expiresAt=now+300000;
 }else throw Error('请使用当前卡片完成核对。');
 g.revision++;return g;
}
function positive(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>200000000)throw Error('请输入有效金额。');return n;}
export const investable=g=>Math.max(0,g.allocation.available-(g.fields.extra_minor||0));
const eligible=(state,g,p,now)=>validWealthRisk(state,now)&&p.risk<=state.wealthRiskProfile.level&&p.horizons.includes(g.fields.horizon);
export function wealthOperation(state,{now}={}){
 const g=state.wealthGuide,p=WEALTH_PRODUCTS.find(p=>p.id===g?.fields.product_id);
 if(!g||!['confirm','verifying'].includes(g.stage)||!p||!eligible(state,g,p,now)||g.expiresAt<=now)throw Error('申购方案已失效，请重新核对。');
 const current=allocation(state,{now});if(JSON.stringify(current)!==JSON.stringify(g.allocation))throw Error('账户或近期付款已变化，请重新整理资金。');
 if(!Number.isSafeInteger(g.fields.amount_minor)||g.fields.amount_minor<1||g.fields.amount_minor>investable(g))throw Error('可投资资金不足。');
 const parameters=JSON.stringify({product:p.id,amount:g.fields.amount_minor,source:'living_1608',allocation:g.allocation,fields:g.fields,risk:state.wealthRiskProfile,expiresAt:g.expiresAt});
 return {id:g.id+':subscribe',revision:g.revision,kind:'wealth_purchase',target:p.name,amountMinor:g.fields.amount_minor,currency:'CNY',parameters,scope:{taskId:g.id,sourceAccount:'living_1608',productId:p.id},riskFlags:[],source:{kind:'user'},writes:true};
}
export function commitWealthSubscription(state,{grantId,now}={}){
 const g=state.wealthGuide,previous=state.wealthSubscriptions?.find(x=>x.id===g?.id);
 if(previous&&g.stage==='done')return previous;
 const op=wealthOperation(state,{now});
 // Acquire/validate/commit on the same candidate state; caller persists once.
 return {op,grantId};
}
export function postWealthReservation(state,op,permit,{now}={}){
 const g=state.wealthGuide;if(!g||g.stage==='done')throw Error('请勿重复提交');
 const expected=wealthOperation(state,{now});if(JSON.stringify(expected)!==JSON.stringify(op))throw Error('申购参数已变化');
 validatePermit(state,op,permit,{now});const receipt='local-filled:'+g.id+':'+g.revision;
 commitExecution(state,permit,{status:'completed',receipt,source:'local_adapter',external:false,statusOfSubscription:'completed'},{now});
 const row={id:g.id,productId:g.fields.product_id,name:op.target,amountMinor:op.amountMinor,sourceAccount:'living_1608',status:'completed',units:op.amountMinor/100,unitPriceMinor:100,valuationSource:'synthetic_fixed_nav',createdAt:now,receipt};
 state.wealthSubscriptions??=[];if(state.wealthSubscriptions.some(x=>x.id===g.id))throw Error('请勿重复提交');state.wealthSubscriptions.push(row);
 state.ledger.push({id:'wealth-reserve:'+g.id,date:new Date(now+8*3600000).toISOString().slice(0,10),title:op.target+'买入',category:'理财买入',amountMinor:op.amountMinor,direction:'expense',movement:'principal',kind:'investment',icon:'invest',order:state.ledger.length,receipt,accountLabel:'生活账户1608',source:'synthetic'});
 syncFinance(state);g.stage='done';g.receipt=receipt;return clone(row);
}
export function cancelWealthGuide(state,{now}={}){const g=state.wealthGuide;if(!g||g.stage==='done')return;revokeOperation(state,g.id+':subscribe',{reason:'user_cancel',now});g.stage='cancelled';g.revision++;}
export function renderWealthSubscriptions(state,{esc:e}){
 const rows=state.wealthSubscriptions||[];if(!rows.length)return '';
 return `<section class="card companion-inline wealth-holdings"><h3>理财持仓</h3>${rows.map(r=>`<div class="plan-row"><span>${e(r.name)}<small>${r.status==='completed'?'已买入 · '+e(String(r.units))+'份':'待确认，份额未到账'}</small></span><strong>${money(r.amountMinor)}</strong></div>`).join('')}</section>`;
}
export function renderWealthGuide(state,{esc:e}){
 const g=state.wealthGuide;if(!g||['done','cancelled'].includes(g.stage))return '';
 const button=(v,label,disabled=false)=>`<button type="button" class="secondary full" data-action="wealth-choice" data-value="${e(v)}" data-revision="${g.revision}" ${disabled?'disabled':''}>${e(label)}</button>`;
 const choices=(xs)=>xs.map(x=>button(x,x)).join('');const amounts=xs=>xs.filter((x,i,a)=>x>0&&a.indexOf(x)===i).map(x=>button(x,money(x))).join('');
 const custom=()=>`<form id="wealth-amount-form" data-revision="${g.revision}"><label>其他金额（元）<input name="amount" type="number" min="0.01" step="0.01" required></label><button class="quiet full" type="submit">使用这个金额</button></form>`;
 let title='',html='';const a=g.allocation;
 if(g.stage==='direction'){title='你更想先做哪件事？';html=(g.guidance?'<p>有明确目标可以先攒钱；近期用不到的闲钱，再比较收益与风险。</p>':'')+button('save','为一个目标攒钱')+button('earn','让闲钱赚点收益')+button('unsure','还没想好');}
 else if(g.stage==='goal'){title='想为哪个目标攒钱？';html=choices(stages.goal);}
 else if(g.stage==='goal_amount'){title='目标先定多少？';html=amounts([60000,300000,600000])+custom();}
 else if(g.stage==='daily'){title='每天存多少比较轻松？';html=amounts([1000,2000,5000].filter(x=>x<=g.fields.target_minor))+custom();}
 else if(g.stage==='saving_confirm'){title='确认储蓄计划';const s=state.savingsEditor;html=`<p>${e(g.fields.goal)}储蓄罐 · 目标 ${money(g.fields.target_minor)}</p><div class="plan-row"><span>每天存入</span><strong>${money(g.fields.daily_minor)}</strong></div><p>生活账户1608 · ${e(s?.fields.start_date||'待核对')} 起每天09:00</p><button class="primary full" data-action="wealth-save" data-revision="${g.revision}">确认安排</button>`;}
 else if(g.stage==='extra'){
  title='近期还有额外要用的钱吗？';const total=Math.max(1,a.cash),segments=[Math.min(a.cash,a.obligations),Math.min(Math.max(0,a.cash-a.obligations),a.buffer),a.available];
  html=`<div class="wealth-allocation" role="img" aria-label="现金${money(a.cash)}，近期生活预算预留${money(a.obligations)}，备用金${money(a.buffer)}，可安排${money(a.available)}">${segments.map((v,i)=>`<span style="flex:${v/total};background:var(--${['amber','slate','indigo'][i]}-9)"></span>`).join('')}</div><div class="plan-row"><span>当前可用现金</span><strong>${money(a.cash)}</strong></div><div class="plan-row"><span>本月剩余生活预算</span><strong>${money(a.obligations)}</strong></div><div class="plan-row"><span>预留一个月必要支出</span><strong>${money(a.buffer)}</strong></div><div class="plan-row"><span>可进一步安排</span><strong>${money(a.available)}</strong></div>${choices(stages.extra)}`;
 }else if(g.stage==='extra_amount'){title=g.fields.extra+'先预留多少？';html=amounts([100000,300000,500000].filter(x=>x<=a.cash))+custom();}
 else if(g.stage==='horizon'){title='这笔闲钱大概多久不用？';html=`<p>扣除额外预留后，可投资 ${money(investable(g))}。</p>`+choices(stages.horizon);}
 else if(['experience','loss','stability'].includes(g.stage)){title={experience:'你有多少投资经验？',loss:'你能接受怎样的本金波动？',stability:'目前收入与备用金情况如何？'}[g.stage];html=choices(stages[g.stage]);}
 else if(g.stage==='products'){
  title='先比较，再决定';html=WEALTH_PRODUCTS.map(p=>`<article class="wealth-product"><div class="row between"><strong>${p.name}</strong><span class="pill">R${p.risk}</span></div><p>${p.assets}</p><details><summary>费用、赎回与资料</summary><p>${p.fee}</p><p>${p.redemption}</p><p>${p.detail}</p><small>资料日期 ${p.date}</small></details>${button(p.id,eligible(state,g,p,Date.parse(state.demoClock?.now)||Date.now())?'选择这款':'不适合当前期限或风险范围',!eligible(state,g,p,Date.parse(state.demoClock?.now)||Date.now()))}</article>`).join('');
 }else if(g.stage==='amount'){title='这次安排多少？';const max=investable(g);html=`<p>可投资 ${money(max)}。其余资金继续保留。</p>`+amounts([100000,300000,500000,max].filter(x=>x<=max))+custom();}
 else if(['confirm','verifying'].includes(g.stage)){const p=WEALTH_PRODUCTS.find(p=>p.id===g.fields.product_id);title='核对申购';html=`<p>${p.name} · R${p.risk}</p><div class="plan-row"><span>本次申购</span><strong>${money(g.fields.amount_minor)}</strong></div><div class="plan-row"><span>剩余可投资资金</span><strong>${money(investable(g)-g.fields.amount_minor)}</strong></div><p class="companion-card-meta">生活账户1608。验证通过后买入。</p>${g.stage==='confirm'?`<button class="primary full" data-action="wealth-confirm" data-revision="${g.revision}">确认申购并验证</button>`:''}`;}
 return `<section class="card companion-inline wealth-guide" data-wealth-stage="${e(g.stage)}"><h3>${title}</h3>${html}${g.error?`<p class="error-text">${e(g.error)}</p>`:''}<button class="quiet full" data-action="wealth-cancel" data-revision="${g.revision}">暂不安排</button></section>`;
}
