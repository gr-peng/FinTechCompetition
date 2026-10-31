import {renderSavingsJar,savingsTotal} from './savings-coach.mjs';
import {prepareLocalWrite,assertLocalWrite} from './local-write-guard.mjs';
import {stableCategories} from './category-order.mjs';
import {createBankCards} from './bank-cards.mjs';
import {createProductCapture} from './dot-capture.js';
import {createCaptureStore} from './capture-store.mjs';
import {entryPage} from './capture-entry.mjs';
import {financialFacts,ledgerView} from './finance-state.mjs';
import {createApprovedHome} from './baseline/approved-home.js';
import {createApprovedLedger} from './baseline/approved-ledger.js';
import {createApprovedOverview} from './baseline/approved-overview.js';
import {createApprovedTrends} from './baseline/approved-trends.js';
import {createApprovedBudget} from './baseline/approved-budget.js';
import {createApprovedResearch} from './baseline/approved-research.js';
import {createApprovedWealth} from './baseline/approved-wealth.js';
import {createProductInvestment} from './baseline/product-investment.js';
import {createInvestmentUI} from './investment-ui.mjs';
import {ensurePaperPortfolio,paperPortfolio,reviewTrade,executePaperTrade,riskProfile} from './investment-state.mjs';
import {createRiskExperience} from './risk-experience.mjs';
import {mountChartsInteraction} from './baseline/charts-interaction.js';
import {categoryChartColor} from './baseline/product-analysis.js';
import {categoryIconSVG} from './baseline/category-icons.js';
import {approvedIcon,approvedNav,approvedHeader} from './baseline/approved-shell.js';
import {investmentNavigation} from './baseline/investment-shell.js';

// Copies own presentation and native interactions; only these DTO/route adapters
// know about the Dot task engine's single integer-fen financial source.
export function createBaselineBridge(host){
 const {getState,save,render,esc,money,showModal,closeModal,start,icon:dotIcon,getCsrf}=host;
 const ui={month:'2026-11',epoch:0,filter:{category:'',q:'',type:''},ledgerRange:null,productLedgerPending:0,productAnalysisTab:'composition',productAnalysisMetric:'expense',productAnalysisPoint:null,investmentTab:'自选',favorites:[]};
 const captureRequest=createCaptureStore({getState,save});
 const prefs={get mask(){return !!getState().mask}};
 let view='',investment='holdings',cleanup=()=>{},currentPortfolio=null,researchRows=null,historical=null;
 const storage={get(k,fallback){try{return JSON.parse(localStorage.getItem('finpilot-native-'+host.namespace+'-'+k))??fallback}catch{return fallback}},set(k,v){localStorage.setItem('finpilot-native-'+host.namespace+'-'+k,JSON.stringify(v))}};
 const icon=name=>{const glyph=categoryIconSVG(name);if(glyph)return `<svg class="icon ap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg>`;const aliases={next:'arrow',down:'arrow',add:'plus',filter:'list',investment:'invest',visualization:'chart',assistant:'spark',settings:'gear'};return dotIcon(aliases[name]||name)};
 const rows=()=>ledgerView(getState()).map(r=>({id:r.id,event_date:r.date,description:r.title,category:r.category,type:r.direction,amount:r.amountMinor/100,currency:'CNY',movement:r.movement,metadata:{movement:r.movement,account_label:r.accountLabel||'生活账户 1608',receipt:r.receipt,task_id:r.taskId,payment_method:r.payment_method||''}}));
 const dates=()=>({start_date:ui.month+'-01',end_date:ui.month+'-'+new Date(Number(ui.month.slice(0,4)),Number(ui.month.slice(5,7)),0).getDate()});
 function report(selected=rows()){
  const period=dates(),monthRows=selected.filter(r=>r.event_date>=period.start_date&&r.event_date<=period.end_date&&!['principal','internal_transfer'].includes(r.movement));
  const totals={gross_income_minor:0,gross_expense_minor:0,refund_minor:0,net_expense_minor:0,net_cashflow_minor:0},cats=new Map();
  const trend=Array.from({length:Number(period.end_date.slice(-2))},(_,i)=>({period:ui.month+'-'+String(i+1).padStart(2,'0'),gross_income_minor:0,gross_expense_minor:0}));
  for(const r of monthRows){const n=Math.round(r.amount*100),day=trend[Number(r.event_date.slice(-2))-1];if(r.type==='expense'){totals.gross_expense_minor+=n;cats.set(r.category,(cats.get(r.category)||0)+n);day.gross_expense_minor+=n}else if(r.category==='退款'){totals.refund_minor+=n}else{totals.gross_income_minor+=n;day.gross_income_minor+=n}}
  totals.net_expense_minor=totals.gross_expense_minor-totals.refund_minor;totals.net_cashflow_minor=totals.gross_income_minor+totals.refund_minor-totals.gross_expense_minor;
  return {period,totals,trend,expense_categories:[...cats].sort((a,b)=>b[1]-a[1]).map(([category,amount_minor])=>({category,amount_minor}))};
 }
 function overview(){const s=getState(),profile=riskProfile(s);return {cash_minor:Math.round(s.balance*100),assets_minor:Math.round((s.balance+s.invested)*100)+savingsTotal(s),investable_minor:Math.max(0,Math.round((s.balance-8000)*100)),execution_available:true,risk_completed:profile.ready,risk_level:profile.level,products:[{id:'reserve',name:'灵活现金',risk:1,holding_minor:Math.round(s.invested*100),eligible:true,liquidity:'按产品规则赎回',horizon_months:0,fee:'0',purpose:'近期资金'},{id:'growth',name:'长期均衡',risk:3,holding_minor:0,eligible:false,liquidity:'按产品规则赎回',horizon_months:12,fee:'0',purpose:'一年以上资金'}],planning:{ready:false,basis:{observed_months:1},quality:{message:'仍需核对产品适当性与用钱期限'}},cashflow:{observed_months:1},profile:{goal_name:'旅行基金',goal_amount:'12000'}}}
 function budget(month=ui.month){const s=getState();return s.nativeBudget?.[month]||{month,status:month==='2026-11'?'set':'unset',revision:0,total_minor:month==='2026-11'?800000:null,categories:month==='2026-11'?[{category:'住房',limit_minor:350000},{category:'餐饮',limit_minor:200000},{category:'购物',limit_minor:150000},{category:'其他',limit_minor:100000}]:[]}}
 async function finance(path,options={}){
  const writes=options.method&&!['GET','HEAD'].includes(options.method.toUpperCase());
  const ticket=writes?prepareLocalWrite(getState(),{kind:'data_maintenance',id:path,parameters:options.body||{}}):null;

  if(path==='/positions'&&!options.method&&!options.seed)return getPaper();
  if(path.startsWith('/capture'))return captureRequest(path,options);
  if(path==='/overview')return overview();
  if(path.startsWith('/budget')){
   const month=new URL(path,'http://127.0.0.1').searchParams.get('month')||ui.month;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('预算月份无效');if(!options.method)return budget(month);
   const s=getState(),d=options.body,current=budget(month);if(d.month!==undefined&&d.month!==month)throw Error('预算月份不匹配');s.nativeBudgetRequests||={};const previous=s.nativeBudgetRequests[d.request_id];if(previous){if(previous.month!==month||previous.total_minor!==d.total_minor||JSON.stringify(previous.categories)!==JSON.stringify(d.categories))throw Error('请求参数已变化，请重新核对');return previous;}
   if(current.revision!==d.expected_revision){const e=Error('预算已变化，请重新载入');e.status=409;throw e}
   if(!Number.isSafeInteger(d.total_minor)||d.total_minor<=0||!Array.isArray(d.categories)||d.categories.some(c=>!Number.isSafeInteger(c.limit_minor)||c.limit_minor<0)||d.categories.reduce((n,c)=>n+c.limit_minor,0)>d.total_minor)throw Error('请核对预算金额');
   const result={month,status:'set',revision:current.revision+1,total_minor:d.total_minor,categories:d.categories};assertLocalWrite(getState(),ticket,{parameters:options.body||{}});s.nativeBudget||={};s.nativeBudget[month]=result;s.nativeBudgetRequests[d.request_id]=result;save();return result;
  }
  const request=()=>fetch('/api'+path,{method:options.method||'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':getCsrf()},body:options.body?JSON.stringify(options.body):undefined});
  let res=await request();
  // Only idempotent reads may be retried after renewing an expired local session.
  if(res.status===401&&(!options.method||options.method==='GET')&&host.refreshSession){await host.refreshSession();res=await request();}
  const data=await res.json();if(writes){try{assertLocalWrite(getState(),ticket,{parameters:options.body||{}});}catch(error){error.outcomeUnknown=true;error.message='安全状态已变化，已发出的资料维护请求需核实，未回填或自动重试。';throw error;}}if(!res.ok){const e=Error(data.message||'本地资料暂不可用');e.status=res.status;throw e}if(path.startsWith('/position-imports/')&&path.endsWith('/confirm')&&options.method==='POST')seedPositions=null;return data;
 }
 let seedPositions=null;
 const getPaper=async()=>{if(!seedPositions)seedPositions=await finance('/positions',{seed:true});ensurePaperPortfolio(getState(),seedPositions);save();return paperPortfolio(getState(),seedPositions);};
 const riskExperience=createRiskExperience({prepare:getPaper,modal:showModal,closeSheet:()=>closeModal({history:false}),onClose:()=>host.closeRiskNavigation?.(),profile:()=>riskProfile(getState()),esc,money,reduced:()=>!!getState().reduceMotion});
 function openRisk({history=true}={}){if(history)host.registerRiskNavigation?.();return riskExperience.open();}
 const context={paper:{get:getPaper,profile:()=>riskProfile(getState()),review:d=>reviewTrade(getState(),d),requestInline:d=>host.requestPaperInline?.(d),execute:(d,id)=>{const candidate=structuredClone(getState()),r=executePaperTrade(candidate,d,id);if(host.persistState)host.persistState(candidate);else{save(candidate);Object.assign(getState(),candidate);}return r;},openRisk:()=>openRisk()},state:ui,prefs,esc,money,icon,finance,allBills:async()=>rows(),range:dates,loading:()=>'<p class="ap-l-status">正在读取…</p>',modal:(title,body)=>showModal(title,body.replace('证券字标为原创文字识别，非官方标志。','公司标识来源见本地资料记录。')),closeSheet:()=>closeModal({consume:true}),render,storage,go:route=>{closeModal({consume:true});if(route==='risk'){openRisk();return}host.navigateInvestment(route==='research'?'research':['holdings','wealth'].includes(route)?'wealth':'holdings')}};
 const bankCards=createBankCards({getState,save,esc,money,icon,onLedger:card=>{ui.filter={q:'',category:'',type:'',accountTail:card.tail};ui.ledgerRange=null;host.navigateFinancial('ledger');}});
 const home=createApprovedHome(context),ledger=createApprovedLedger(context),composition=createApprovedOverview({...context,categoryColor:c=>c==='餐饮'?'var(--jade9)':categoryChartColor(c)}),trends=createApprovedTrends(context),budgets=createApprovedBudget(context),research=createApprovedResearch(context),wealth=createApprovedWealth(context),legacyPortfolio=createProductInvestment(context),portfolio=createInvestmentUI(context);

 const captureCategories={expense:['餐饮','购物','出行','生活缴费','娱乐','住房','医疗健康','教育学习','通讯','运动健身','订阅','其他'],income:['工资','奖金','副业','理财收益','退款','其他收入']};
 const btn=(label,action,cls='',extra='')=>`<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>`;
 const draft=getState().captureDraft||{type:'expense',category:'餐饮',amount:'',description:'',payment:'',event_date:'2026-11-02'};
 const captureGo=route=>{const [name,query='']=route.split('?');if(name==='ledger'){const q=new URLSearchParams(query);ui.month=q.get('month')||ui.month;ui.ledgerRange=q.get('start_date')?{start_date:q.get('start_date'),end_date:q.get('end_date')}:null;ui.filter={category:'',q:'',type:''};host.setFinancial('ledger');location.hash='/finance';render();return}host.navigateCapture('/finance/'+(name==='entry'?'entry':'capture')+(query?'?'+query:''))};
 const capture=createProductCapture({...context,finance,storage,btn,today:'2026-11-02',book:async()=>rows().filter(r=>r.type==='expense'),go:captureGo,resetLedgerContext:()=>{},});
 const syncDraft=()=>{const form=document.querySelector('#entry-form');if(form){for(const k of ['amount','event_date','description','payment'])draft[k]=form.elements[k]?.value??draft[k]}getState().captureDraft={...draft};save()};
 function filtered(){const range=ui.ledgerRange||dates();return rows().filter(r=>r.event_date>=range.start_date&&r.event_date<=range.end_date&&(!ui.filter.accountTail||r.metadata.account_label.includes(ui.filter.accountTail))&&(!ui.filter.category||r.category===ui.filter.category)&&(!ui.filter.type||r.type===ui.filter.type)&&(!ui.filter.minMinor||Math.round(r.amount*100)>=ui.filter.minMinor)&&(!ui.ledgerRange||r.event_date>=ui.ledgerRange.start_date&&r.event_date<=ui.ledgerRange.end_date)&&[r.description,r.category,r.metadata.receipt].join(' ').includes(ui.filter.q||''))}
 function ledgerHTML(){const xs=filtered(),d=report(xs);let html=ledger.shell({categories:stableCategories(rows().map(r=>r.category)),pending:(getState().capture?.batches||[]).filter(b=>b.status==='pending').length});
  html=html.replace('<div id="ledger-filter-summary" aria-live="polite"></div>',`<div id="ledger-filter-summary" aria-live="polite">${ledger.summary(d.totals)}</div>`).replace('<div id="bill-list" class="ap-l-list"></div>',`${ui.filter.accountTail?`<button type="button" class="bank-ledger-filter" data-action="bank-clear-filter" aria-label="清除银行卡筛选">尾号 ${esc(ui.filter.accountTail)} ${icon('close')}</button>`:''}<div id="bill-list" class="ap-l-list">${xs.length?ledger.rows(xs):ledger.empty(true)}</div>`);return html;
 }
 const clean=html=>html.replace(/\s*·\s*/g,' ');
 function nav(active){const mapping=[['home','today','今天'],['ledger','bot','Bot'],['visualization','finance','财务'],['assistant','investment','投资'],['investment','me','我的']];let html=approvedNav(mapping.find(x=>x[1]===active)?.[0]);mapping.forEach(([from],i)=>{html=html.replace(`href="#/${from}" data-nav-tab="${from}"`,`href="#/native-${i}" data-nav-tab="native-${i}"`)});mapping.forEach(([from,to,label],i)=>{html=html.replace(`href="#/native-${i}" data-nav-tab="native-${i}"`,`href="#/${to}" data-nav-tab="${to}"`).replace(new RegExp(`(<a[^>]+data-nav-tab="${to}"[^>]*>)[\\s\\S]*?(<span>)[^<]+(<\\/span><\\/a>)`),(_,a,b,c)=>a+(to==='investment'?approvedIcon('investment'):to==='me'?icon('user'):to==='bot'?approvedIcon('assistant'):to==='finance'?approvedIcon('ledger'):approvedIcon('home'))+b+label+c)});return html}
 function placeholder(kind,tab=''){view=kind;investment=tab;return (kind==='investment'&&tab!=='research'?investmentNavigation(tab==='wealth'?'holdings':'investment'):'')+'<div id="baseline-content" aria-live="polite"></div>'}
 function role(){if(['capture','entry'].includes(view))return view;return view==='charts'?ui.productAnalysisTab==='trend'?'trend':ui.productAnalysisTab==='budget'?'budget':'overview':view==='ledger'?'ledger':view==='finance-home'?'home':view==='investment'?investment==='research'?'research':investment==='wealth'?'wealth':'portfolio':'home'}
 function mount(){if(!['capture','entry'].includes(view))capture.leave();cleanup();ui.epoch++;const epoch=ui.epoch,node=document.querySelector('#baseline-content');if(!node)return;const paint=html=>{if(epoch!==ui.epoch||!node.isConnected)return;node.innerHTML=clean(html);node.querySelectorAll('button[data-action=mask]').forEach(b=>{if(!b.textContent.trim())b.setAttribute('aria-label',prefs.mask?'显示金额':'隐藏金额')});cleanup();cleanup=mountChartsInteraction(node,{onSelectCategory:c=>{ui.productAnalysisFocus=c},onSelectTrend:i=>{ui.productAnalysisPoint=i;const scroll=window.scrollY,focused=document.activeElement===node.querySelector('[data-chart-trend]');paint(trends.html(report()));if(focused)node.querySelector('[data-chart-trend]')?.focus({preventScroll:true});window.scrollTo(0,scroll)}})};
  ui.productBudget=budget();
  if(view==='capture'){ui.route='capture';ui.query=Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]||''));capture.pages.capture(paint).catch(e=>paint(`<p class="pc-error">${esc(e.message)}</p>`));return}
  if(view==='entry'){capture.leave();ui.route='entry';entryPage(paint,{draft,categories:captureCategories,btn,esc,icon,card:(html,cls='')=>`<section class="card glass ${cls}">${html}</section>`,segmented:(labels,selected,action)=>`<div class="segmented glass" role="tablist">${labels.map(label=>`<button type="button" role="tab" aria-selected="${label===selected}" data-action="${action}" data-value="${label}">${label}</button>`).join('')}</div>`});return}
  if(view==='finance-home'){home.pages.home(html=>paint(html.replace('<section class="ap-home-card ap-home-month">',bankCards.html()+'<section class="ap-home-card ap-home-month">'))).catch(()=>paint('<p class="ap-l-status">账户资料暂不可用</p>'));return}
  if(view==='ledger'){paint(ledgerHTML());return}
  if(view==='charts'){paint(ui.productAnalysisTab==='trend'?trends.html(report()):ui.productAnalysisTab==='budget'?budgets.html(report(),budget()).replace('<section class="ap-b-card ap-b-categories">',renderSavingsJar(getState())+'<section class="ap-b-card ap-b-categories">'):composition.html(report()));return}
  if(view==='investment'&&investment==='holdings'){portfolio.pages.investment(paint);return}
  if(view==='investment'&&investment==='wealth'){paint(wealth.html(overview()));return}
  if(view==='investment'&&investment==='research'){Promise.all([researchRows?Promise.resolve(researchRows):finance('/reference/watchlist'),historical?Promise.resolve(historical):fetch('assets/baseline-portfolio.json').then(r=>r.json())]).then(([list,history])=>{researchRows=list;historical=history;const held=history.holdings||[],historyHTML=`<section class="ap-r-list">${held.map(r=>`<button class="ap-r-stock" data-action="stock" data-code="${esc(r.code)}"><span class="ap-r-stock-copy"><strong>${esc(r.name)}</strong><small>${esc(r.code)}</small></span><span class="ap-r-price"><strong>${money(r.market_value||0)}</strong></span>${icon('next')}</button>`).join('')}</section>`;paint(research.html({watchlist:list,portfolio:history,planning:overview(),historyHTML}))}).catch(()=>paint(research.html({error:true})));}
 }
 async function action(a,b){
  if(a==='bank-clear-filter'){delete ui.filter.accountTail;render();return true;}
  if(capture.actions[a]){await capture.actions[a](b);return true}
  if(a==='fp-ledger-capture'||a==='product-capture-open'){captureGo('capture');return true}
  if(a==='entry-type'||a==='entry-category'){syncDraft();if(a==='entry-type'){draft.type=b.dataset.value==='收入'?'income':'expense';draft.category=captureCategories[draft.type][0]}else draft.category=b.dataset.value;getState().captureDraft={...draft};save();render();return true}
  if(a==='pa-tab'){ui.productAnalysisTab=b.dataset.value;host.setFinancial('charts');render();return true}
  if(a==='ap-chart-trend'||a==='ap-chart-budget'){ui.productAnalysisTab=a==='ap-chart-trend'?'trend':'budget';host.setFinancial('charts');render();return true}
  if(a==='pa-trend-metric'){ui.productAnalysisMetric=b.dataset.metric;ui.productAnalysisPoint=null;render();return true}
  if(a==='pa-category'){ui.ledgerRange=null;ui.filter={category:b.dataset.category,q:'',type:''};host.setFinancial('ledger');render();return true}
  if(a==='pa-point-ledger'){const point=report().trend[Number(b.dataset.pointIndex)];ui.filter={category:'',q:'',type:''};ui.ledgerRange={start_date:point.period,end_date:point.period};host.setFinancial('ledger');render();return true}
  if(a==='fp-ledger-category'){ui.filter.category=b.dataset.value;render();return true}
  if(a==='fp-ledger-month'){ui.ledgerRange=null;render();return true}
  if(a==='nl-month-open'){showModal('选择月份',`<form id="native-month-form" class="form"><label>月份<input type="month" name="month" value="${ui.month}" required></label><button class="primary full">查看</button></form>`);return true}
  if(a==='fp-ledger-bill'){const r=rows().find(r=>r.id===b.dataset.id);if(r){const receipt=r.metadata.receipt;showModal(r.description,`<div class="big money">${money(r.amount)}</div><div class="plan-row"><span>日期</span><span>${r.event_date}</span></div><div class="plan-row"><span>分类</span><span>${esc(r.category)}</span></div>${receipt?`<p class="receipt">回执 ${esc(receipt)}</p>${r.metadata.task_id?`<a class="secondary full" href="#/bot/task/${esc(r.metadata.task_id)}" data-action="close-link">查看原任务</a>`:''}`:''}`)}return true}
  if(a==='filter'&&view==='ledger'){showModal('筛选账单',`<form id="native-filter-form" class="form"><label>分类<select name="category"><option value="">全部</option>${stableCategories(rows().map(r=>r.category)).map(c=>`<option ${ui.filter.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label>收支<select name="type"><option value="">全部</option><option value="expense">支出</option><option value="income">收入</option></select></label><button class="primary full">应用筛选</button></form>`);return true}
  if(a==='close-sheet'){closeModal();return true}
  if(a==='investment-section'){host.setInvestment(b.dataset.value==='research'?'research':b.dataset.value==='holdings'?'wealth':'holdings');render();return true}
  if(a==='investment-tab'){ui.investmentTab=b.dataset.value;render();return true}
  if(a==='journey-subscribe'||a==='journey-redeem'){if(b.dataset.product&&b.dataset.product!=='reserve')throw Error('请先核对该产品的资金期限与适当性');closeModal({consume:true});start(a==='journey-redeem'?'redemption':'investment');return true}
  if(a==='journey-profile'||a==='risk'){openRisk();return true}
  if(a==='journey-bank'){host.navigateFinancial('overview');return true}
  if(a==='journey-security'){ui.filter={category:'理财本金',q:'',type:''};host.navigateFinancial('ledger');return true}
  if(a==='journey-compare'){showModal('方案比较',wealth.comparison(overview()));return true}
  if(a==='journey-fund-condition'){showModal('资金条件',wealth.product(overview(),b.dataset.product||'reserve')+'<p class="notice">房租和生活费预留 ¥8,000。理财存在本金与流动性风险，收益不保证。</p>');return true}
  if(a==='refresh'){render();return true}
  for(const module of [bankCards,portfolio,legacyPortfolio,research,budgets])if(module.actions?.[a]){await module.actions[a](b);return true}
  return false;
 }
 function input(e){if(portfolio.onInput(e))return true;if(e.target.closest('#entry-form')){syncDraft();return true}if(view==='capture'){capture.onInput(e);return true}if(view==='ledger'&&e.target.id==='bill-search'){ui.filter.q=e.target.value;const xs=filtered();document.querySelector('#bill-list').innerHTML=xs.length?ledger.rows(xs):ledger.empty(true);document.querySelector('#ledger-filter-summary').innerHTML=ledger.summary(report(xs).totals);return true}return false}
 async function submit(e){if(['pc-text-form','pc-file-form','pc-edit-form'].includes(e.target.id)){await capture.onSubmit(e);return true}if(e.target.id==='entry-form'){e.preventDefault();syncDraft();const batch=await capture.flow.manual({...draft,payment_method:draft.payment,movement:'cashflow'});if(!batch)throw Error(capture.flow.state.error||'请核对输入');if(batch){draft.amount='';draft.description='';getState().captureDraft={...draft};save();captureGo('capture?batch='+batch.id)}return true}if(e.target.id==='native-month-form'){e.preventDefault();ui.month=e.target.elements.month.value;ui.ledgerRange=null;ui.productAnalysisPoint=null;closeModal();render();return true}if(e.target.id==='native-filter-form'){e.preventDefault();ui.filter.category=e.target.elements.category.value;ui.filter.type=e.target.elements.type.value;closeModal();render();return true}if(await portfolio.onSubmit(e))return true;if(await legacyPortfolio.onSubmit(e))return true;if(await budgets.onSubmit(e))return true;return false}
 async function change(e){if(view==='capture'){await capture.onChange(e);return true}if(e.target.closest('#entry-form')){syncDraft();return true}if(e.target.id==='month-picker'){ui.month=e.target.value;ui.ledgerRange=null;ui.productAnalysisPoint=null;render();return true}if(await portfolio.onChange(e))return true;return legacyPortfolio.onChange(e)}
 function receipt(value){const row=rows().find(r=>r.metadata.receipt===value);if(row)ui.month=row.event_date.slice(0,7);ui.ledgerRange=null;ui.filter={category:'',q:value,type:''};host.setFinancial('ledger')}
 return {openRisk,disposeRisk:()=>riskExperience.dispose(),monthControl:()=>approvedHeader('overview',{state:ui,esc}).match(/<label class="ap-month">[\s\S]*?<\/label>/)?.[0]||'',placeholder,mount,role,nav,icon,action,input,submit,change,receipt,report,request:finance,ledgerRows:filtered,ui};
}
