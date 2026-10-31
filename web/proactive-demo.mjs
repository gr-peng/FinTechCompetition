import {validateCompoundFields,compoundMissing,mergeCompoundFields} from './compound-fields.mjs';
export {validateCompoundFields,compoundMissing,mergeCompoundFields,COMPOUND_ITEM_FIELDS} from './compound-fields.mjs';
// Local, deterministic demo orchestration. No DOM, timers, network or ledger access.
// The host owns authentication, risk decisions and rendering of these card objects.
const clone = value => structuredClone(value);
const VERSION = 1;
const TERMINAL = new Set(['succeeded', 'cancelled']);
const RISKS = new Set(['green', 'yellow', 'red']);
const BIRTHDAY_FIELDS = new Set(['birthday_date', 'budget_minor', 'partner_id', 'city', 'source_account']);
const LABELS = {
  birthday_date: '生日日期', budget_minor: '总预算（含520元转账）', partner_id: '收款联系人',
  city: '用餐城市', source_account: '付款账户', recipient_id: '收款联系人',
};

function instant(value) {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw Error('时间无效');
  return ms;
}
const iso = value => new Date(instant(value)).toISOString();
function localDate(value) { return new Date(instant(value) + 8 * 3600000).toISOString().slice(0, 10); }
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(Date.parse(value + 'T00:00:00Z')).toISOString().slice(0, 10) === value;
}
function money(value, label = '金额') {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2000000) throw Error(label + '必须是1至2000000之间的整数分');
  return value;
}
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function subscriptionAction(value) {
  if (!['keep', 'cancel'].includes(value)) throw Error('请选择保留本次续费或取消下次续费');
  return value;
}
function subscriptionEffect(node) {
  if (!['renew_subscription', 'cancel_subscription'].includes(node.operation)) return null;
  const p = node.payload;
  if (node.app !== 'subscriptions_demo' || !p || typeof p.subscription_id !== 'string' || !p.subscription_id ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.cycle || '') || p.currency !== 'CNY' || typeof p.source_account !== 'string' || !p.source_account) throw Error('订阅操作范围无效');
  const cancel = node.operation === 'cancel_subscription';
  if (cancel ? p.amount_minor !== 0 || p.subscription_action !== 'cancel' || p.scope !== 'next_renewal' ||
    p.preserve_current_period !== true || p.refund_minor !== 0 || p.future_auto_renewal !== false
    : !Number.isSafeInteger(p.amount_minor) || p.amount_minor <= 0 || p.amount_minor > 2000000 || p.renewals !== 1 || p.future_auto_renewal !== false || p.subscription_action != null && p.subscription_action !== 'keep') throw Error('订阅操作范围无效');
  return { subscription_id: p.subscription_id, cycle: p.cycle, action: cancel ? 'cancel' : 'keep',
    scope: cancel ? 'next_renewal' : 'current_cycle', charged_minor: cancel ? 0 : p.amount_minor,
    refunded_minor: 0, cash_delta_minor: cancel ? 0 : -p.amount_minor, renewals: cancel ? 0 : 1,
    future_auto_renewal: false, preserve_current_period: true };
}
export function validateSubscriptionReceipt(node, result) {
  const expected = subscriptionEffect(node); if (!expected) return null;
  if (stable(result.evidence?.parameters) !== stable(node.payload)) throw Error('订阅回执参数不一致');
  // Older renewal receipts did not carry this field. Their exact original
  // parameters remain necessary; cancellation always needs explicit effect proof.
  if (result.evidence?.subscription_effect === undefined && node.operation === 'renew_subscription' && node.payload.subscription_action === undefined) return expected;
  if (stable(result.evidence?.subscription_effect) !== stable(expected)) throw Error('订阅回执效果不一致');
  return expected;
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

export const PROACTIVE_DEMO_FIXTURES = deepFreeze({
  start_at: '2026-10-26T01:00:00.000Z',
  contacts: [
    { id: 'partner-linxia', name: '林夏', relation: '女朋友', account_suffix: '0520', phone: '13800000003', synthetic: true },
    { id: 'mom', name: '妈妈', relation: '母亲', phone: '13800000001', synthetic: true },
    { id: 'dad', name: '爸爸', relation: '父亲', phone: '13800000002', synthetic: true },
    { id: 'landlord-chen', name: '陈先生', relation: '房东', account_suffix: '8821', email: 'landlord@example.invalid' },
    { id: 'cake-owner', name: '陈老板', shop_name: '麦穗蛋糕', phone: '13800000004', synthetic: true, relation: '蛋糕店老板', channel: '本地联系人演示' },
  ],
  source_accounts: [{ id: 'living_1608', name: '生活账户', suffix: '1608' }],
  lease: { recipient_id: 'landlord-chen', amount_minor: 280000, currency: 'CNY', source_account: 'living_1608' },
  subscription: { id: 'cloud-music', name: '云音乐会员', amount_minor: 2500, renewal_day: 28, source_account: 'living_1608' },
  rent_email: {
    id: 'demo-mail-rent-202611', type: 'rent_email', received_at: '2026-10-26T00:45:00Z',
    from: 'landlord@example.invalid', subject: '11月房租提醒', due_date: '2026-11-01', amount_minor: 280000,
    body: '下个月房租2800元，请在11月1日前处理。',
  },
  birthday: { birthday_date: '2026-11-06', budget_minor: 120000, partner_id: 'partner-linxia', city: '上海', source_account: 'living_1608' },
  restaurant: { id: 'demo-restaurant-01', name: '梧桐里 · 双人晚餐', amount_minor: 32800, dinner_time: '18:30' },
  cake: { id: 'demo-cake-01', name: '六寸草莓蛋糕', amount_minor: 18800, deposit_minor: 5000, contact_id: 'cake-owner' },
});

/** Explicit virtual time; advancing it does not execute anything until tick/run. */
export function createDemoClock(start = PROACTIVE_DEMO_FIXTURES.start_at) {
  let current = instant(start);
  return Object.freeze({
    virtual: true, now: () => iso(current),
    set(value) { current = instant(value); return iso(current); },
    advance(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) throw Error('演示时钟只能向前推进');
      current += milliseconds; return iso(current);
    },
  });
}

function step(id, title, app, operation, payload, dependencies = [], { confirmation = true, scheduledFor = null } = {}) {
  return { id, title, app, operation, payload, dependencies, confirmation_required: confirmation,
    scheduled_for: scheduledFor, status: confirmation ? 'needs_confirmation' : 'pending',
    attempts: 0, receipt_id: null, last_error: null };
}
function birthdayGraph(fields, fixtures) {
  const { birthday_date: date, partner_id, city, source_account } = fields;
  const restaurant = fixtures.restaurant, cake = fixtures.cake, contact = fixtures.contacts.find(c=>c.id===cake.contact_id);
  const at = date + 'T13:14:00+08:00';
  return [
    step('restaurant.search', '查找双人晚餐', 'meituan_demo', 'search_restaurant', { city, date, people: 2 }, [], { confirmation: false }),
    step('cake.contact', '核对蛋糕店联系人', 'contacts_demo', 'resolve_contact', { contact_id: cake.contact_id }, [], { confirmation: false }),
    step('restaurant.reserve', '预订生日晚餐', 'meituan_demo', 'reserve_restaurant', {
      restaurant_id: restaurant.id, restaurant_name: restaurant.name, city, date, time: restaurant.dinner_time,
      people: 2, quoted_amount_minor: restaurant.amount_minor, budget_minor: fields.budget_minor,
    }, ['restaurant.search']),
    step('cake.message', '向蛋糕店老板预订', 'contacts_demo', 'message_contact', {
      recipient_id: cake.contact_id, recipient_name: contact.name, phone: contact.phone, shop_name: contact.shop_name, product_id: cake.id, product_name: cake.name, date, pickup_time: '16:00', fulfillment: 'pickup', deposit_minor: cake.deposit_minor,
      quoted_amount_minor: cake.amount_minor, message: `${date}预订${cake.name}一份，价格188元，定金50元。请确认。`,
    }, ['cake.contact']),
    step('cake.deposit', '支付蛋糕定金', 'payments_demo', 'pay_deposit', {
      recipient_id: cake.contact_id, recipient_name: contact.name, phone: contact.phone, shop_name: contact.shop_name, amount_minor: cake.deposit_minor, currency: 'CNY', source_account,
      purpose: '生日蛋糕定金', order_step: 'cake.message',
    }, ['cake.message']),
    step('birthday.schedule', '保存13:14的生日转账计划', 'calendar_demo', 'schedule_local_task', {
      recipient_id: partner_id, amount_minor: 52000, currency: 'CNY', source_account,
      scheduled_for: at, purpose: '生日祝福', clock_mode: 'explicit_virtual_demo',
    }, ['restaurant.reserve', 'cake.deposit']),
    step('birthday.transfer', '生日当天13:14转账520元', 'payments_demo', 'transfer', {
      recipient_id: partner_id, amount_minor: 52000, currency: 'CNY', source_account, purpose: '生日祝福', scheduled_for: at,
    }, ['birthday.schedule'], { scheduledFor: at }),
  ];
}
function validateBirthday(fields, fixtures, now) {
  for (const key of Object.keys(fields)) if (!BIRTHDAY_FIELDS.has(key)) throw Error('未知生日参数：' + key);
  if (fields.birthday_date != null && (!validDate(fields.birthday_date) || instant(fields.birthday_date + 'T13:14:00+08:00') < instant(now))) throw Error('请确认未来的生日日期');
  if (fields.budget_minor != null) {
    money(fields.budget_minor, '预算');
    if (fields.budget_minor < fixtures.restaurant.amount_minor + fixtures.cake.amount_minor + 52000) throw Error('当前演示方案共1036元，请增加预算或由主UI提供其他方案');
  }
  if (fields.partner_id != null && !fixtures.contacts.some(c => c.id === fields.partner_id && c.relation === '女朋友')) throw Error('请明确选择已核对的女朋友联系人');
  if (fields.city != null && (typeof fields.city !== 'string' || !fields.city.trim() || fields.city.length > 40)) throw Error('请确认用餐城市');
  if (fields.source_account != null && !fixtures.source_accounts.some(a => a.id === fields.source_account)) throw Error('付款账户未核对');
}
function compoundGraph(fields, fixtures, now) {
  const nodes=[];let previous=null;
  for(const item of fields.items){
    const dependencies=previous?[previous]:[];
    if(item.kind==='sms'){
      const contact=fixtures.contacts.find(c=>c.id===item.contact_id);
      if(!contact?.synthetic||!contact.name||!contact.phone)throw Error('短信联系人尚未从可信演示通讯录核实');
      const id=item.id+'.sms';nodes.push(step(id,'发送短信','contacts_demo','send_sms',{
        recipient_id:contact.id,recipient_name:contact.name,phone:contact.phone,message:item.message,
        contact_source:'synthetic_contact_fixture',synthetic:true,
      },dependencies));previous=id;
    }else if(item.kind==='ride'){
      if(instant(item.date+'T'+item.departure_time+':00+08:00')<instant(now))throw Error('请确认未来的顺风车出发时间');
      if(item.origin===item.destination)throw Error('出发地和目的地不能相同');
      const id=item.id+'.ride.reserve';nodes.push(step(id,'预约回家顺风车','rides_demo','reserve_ride',{
        date:item.date,departure_time:item.departure_time,origin:item.origin,destination:item.destination,
        fare_minor:item.fare_minor,source_account:item.source_account,currency:'CNY',
        fare_type:'maximum_approved',payment_status:'unpaid',synthetic:true,
      },dependencies));previous=id;
    }else{
      if(instant(item.date+'T'+item.pickup_time+':00+08:00')<instant(now))throw Error('请确认未来的蛋糕自取时间');
      const cake=fixtures.cake,contact=fixtures.contacts.find(c=>c.id===cake.contact_id);
      if(!contact?.synthetic||!contact.name||!contact.phone)throw Error('蛋糕店联系人尚未从可信演示通讯录核实');
      const lookup=item.id+'.cake.contact',order=item.id+'.cake.order',deposit=item.id+'.cake.deposit';
      nodes.push(step(lookup,'核对蛋糕店联系人','contacts_demo','resolve_contact',{contact_id:contact.id},dependencies,{confirmation:false}));
      nodes.push(step(order,'预订蛋糕','contacts_demo','message_contact',{
        recipient_id:contact.id,recipient_name:contact.name,phone:contact.phone,shop_name:contact.shop_name,
        product_id:cake.id,product_name:cake.name,date:item.date,pickup_time:item.pickup_time,fulfillment:item.fulfillment,
        quoted_amount_minor:cake.amount_minor,deposit_minor:cake.deposit_minor,...(item.budget_minor?{budget_minor:item.budget_minor}:{}),
        message:`预订${item.date} ${item.pickup_time}自取的${cake.name}一份，报价188元，定金50元。`,
        contact_source:'synthetic_contact_fixture',synthetic:true,
      },[lookup]));
      nodes.push(step(deposit,'支付蛋糕定金','payments_demo','pay_deposit',{
        recipient_id:contact.id,recipient_name:contact.name,phone:contact.phone,shop_name:contact.shop_name,
        product_id:cake.id,product_name:cake.name,amount_minor:cake.deposit_minor,currency:'CNY',
        source_account:item.source_account,purpose:'蛋糕预订定金',order_step:order,
      },[order]));previous=deposit;
    }
  }
  return nodes;
}
function binding(plan, node) {
  return stable({ plan_id: plan.id, revision: plan.revision, step_id: node.id, app: node.app,
    operation: node.operation, payload: node.payload, dependencies: node.dependencies, scheduled_for: node.scheduled_for });
}
function refreshPlan(plan) {
  if (plan.status === 'cancelled') return;
  plan.status = plan.missing.length ? 'awaiting_details' : plan.steps.every(n => n.status === 'succeeded') ? 'succeeded'
    : plan.steps.some(n => n.status === 'paused') ? 'paused' : plan.steps.some(n => n.status === 'failed') ? 'failed'
    : plan.steps.some(n => n.status === 'needs_confirmation') ? 'needs_confirmation' : 'scheduled';
}

/** JSON card view models only; host must escape strings when rendering. */
export function proactivePlanCards(plan, now) {
  const cards = [{ type: 'proactive_task', plan_id: plan.id, title: plan.title, status: plan.status,
    revision: plan.revision, mode: 'local_demo', source: clone(plan.source), reason: plan.reason,
    memory_evidence: clone(plan.memory_evidence), created_at: plan.created_at }];
  if (plan.missing.length) cards.push({ type: 'clarification', plan_id: plan.id,
    reply: '我可以一起安排。先在这里核对这些信息，再给你完整方案。',
    fields: plan.missing.map(key => ({ key, label: LABELS[key] || key })), values: clone(plan.fields) });
  if (plan.steps.length) cards.push({ type: 'task_graph', plan_id: plan.id, revision: plan.revision,
    planned_total_minor: plan.planned_total_minor, currency: 'CNY',
    nodes: plan.steps.map(n => ({ ...clone(n), idempotency_key: n.idempotency_key || plan.id + ':' + n.id + ':v' + plan.revision })) });
  const waiting = plan.steps.filter(n => n.status === 'needs_confirmation' || n.status === 'paused');
  if (waiting.length && plan.status !== 'cancelled') cards.push({ type: 'confirmation', plan_id: plan.id,
    revision: plan.revision, reply: '只授权勾选的步骤；金额、对象、日期改变后需要重新确认。',
    steps: waiting.map(n => ({ step_id: n.id, title: n.title, app: n.app, payload: clone(n.payload),
      scheduled_for: n.scheduled_for, binding: binding(plan, n), reason: n.last_error })),
    authorization_scope: 'selected_steps_exact_parameters',
    actions: [{ action: 'authorize', label: '确认这些安排' }, { action: 'edit', label: '修改' }, { action: 'cancel', label: '暂不安排' }],
  });
  const queued = plan.steps.filter(n => n.scheduled_for && !TERMINAL.has(n.status));
  if (queued.length) cards.push({ type: 'local_schedule', plan_id: plan.id, clock_mode: 'explicit_virtual_demo',
    registered: plan.steps.some(n => n.operation === 'schedule_local_task' && n.status === 'succeeded'),
    now: iso(now), reply: plan.steps.some(n => n.operation === 'schedule_local_task' && n.status === 'succeeded')
      ? '已纳入本地演示队列；推进演示时钟后检查，到时重新评估授权与风险。'
      : '这是待授权的定时计划；前置步骤完成后才保存到本地演示队列。',
    items: queued.map(n => ({ step_id: n.id, scheduled_for: n.scheduled_for, overdue: instant(n.scheduled_for) < instant(now), status: n.status })) });
  return cards;
}

/** Local adapters return structured simulated evidence. They cannot contact apps. */
export function createLocalDemoAdapters({ fixtures = PROACTIVE_DEMO_FIXTURES, failures = {} } = {}) {
  const remaining = clone(failures), succeeded = new Map();
  return Object.freeze({
    mode: 'local_demo',
    async execute({ plan_id, step: node, idempotency_key, now }) {
      if (!['meituan_demo', 'contacts_demo', 'payments_demo', 'calendar_demo', 'subscriptions_demo', 'rides_demo'].includes(node.app)) throw Error('仅支持本地演示适配器');
      const signature = stable({ app: node.app, operation: node.operation, payload: node.payload });
      if (succeeded.has(idempotency_key)) {
        const prior = succeeded.get(idempotency_key);
        if (prior.signature !== signature) throw Error('同一幂等键的参数不一致');
        return clone(prior.result);
      }
      if ((remaining[node.id] || 0) > 0) {
        remaining[node.id]--;
        return { status: 'failed', reason: '预设适配器暂时失败，请在对话中重试', retryable: true,
          evidence: { mode: 'local_demo', app: node.app, actual_external_effect: false, at: iso(now) } };
      }
      const subscription = subscriptionEffect(node);
      if (subscription && (node.payload.subscription_id !== fixtures.subscription.id || node.payload.source_account !== fixtures.subscription.source_account ||
        subscription.action === 'keep' && node.payload.amount_minor !== fixtures.subscription.amount_minor)) throw Error('订阅对象或金额未核实');
      const data = subscription ? { simulated_result: node.operation, parameters: clone(node.payload), subscription_effect: subscription }
        : node.operation === 'search_restaurant' ? { candidates: [clone(fixtures.restaurant)] }
        : node.operation === 'resolve_contact' ? { contact: clone(fixtures.contacts.find(c => c.id === node.payload.contact_id)) }
        : node.operation === 'schedule_local_task' ? { queue_entry: { scheduled_for: node.payload.scheduled_for, clock_mode: 'explicit_virtual_demo' } }
        : node.operation === 'reserve_ride' ? { simulated_result:node.operation,parameters:clone(node.payload),ride_reservation:{status:'reserved',fare_cap_minor:node.payload.fare_minor,paid_minor:0,date:node.payload.date,departure_time:node.payload.departure_time,origin:node.payload.origin,destination:node.payload.destination} }
        : { simulated_result: node.operation, parameters: clone(node.payload) };
      const result = { status: 'succeeded', receipt_id: 'DEMO:' + idempotency_key,
        evidence: { mode: 'local_demo', app: node.app, operation: node.operation, at: iso(now), plan_id,
          actual_external_effect: false, mcp_connected: false, ...data } };
      succeeded.set(idempotency_key, { signature, result: clone(result) });
      return result;
    },
    reset() { succeeded.clear(); Object.keys(remaining).forEach(k => delete remaining[k]); Object.assign(remaining, clone(failures)); },
  });
}

/**
 * safetyGate is mandatory at execution. Missing/failed gate pauses every step.
 * Return {decision:'allow',risk:'green'|'yellow'|'red',evaluation_id,reason?} only
 * after the host's current lock, risk, identity and authorization checks.
 */
export function createProactiveDemo({ clock = createDemoClock(), safetyGate, adapters = createLocalDemoAdapters(),
  fixtures = PROACTIVE_DEMO_FIXTURES, snapshot = null } = {}) {
  if (!clock || typeof clock.now !== 'function') throw Error('需要可注入的时钟');
  if (adapters?.mode !== 'local_demo' || typeof adapters.execute !== 'function') throw Error('这里只能接入本地演示适配器');
  let state, generation = 0;
  const running = new Map();
  const now = () => iso(clock.now());
  function fresh() {
    return { version: VERSION, mode: 'local_demo', sequence: 0, locked: null, last_tick_at: null,
      memory: { contacts: clone(fixtures.contacts), lease: clone(fixtures.lease), subscription: clone(fixtures.subscription) },
      source_events: [], plans: [], events: [], receipts: [], journal: {}, subscription_effects: {} };
  }
  function record(type, detail = {}) { state.events.push({ id: 'event-' + ++state.sequence, type, at: now(), ...clone(detail) }); }
  function find(id) { const plan = state.plans.find(p => p.id === id); if (!plan) throw Error('演示任务不存在'); return plan; }
  function invalidate(plan, reason) {
    plan.grants = {};
    for (const node of plan.steps) if (!TERMINAL.has(node.status)) {
      node.status = node.confirmation_required ? 'needs_confirmation' : 'pending'; node.last_error = reason;
    }
    refreshPlan(plan);
  }
  function addPlan(kind, title, fields, source, reason, memoryEvidence = []) {
    const plan = { id: 'proactive-' + ++state.sequence, kind, title, fields: clone(fields), source: clone(source), reason,
      memory_evidence: clone(memoryEvidence), created_at: now(), revision: 1, status: 'awaiting_details',
      missing: [], steps: [], grants: {}, planned_total_minor: null };
    state.plans.push(plan); record('plan_created', { plan_id: plan.id, kind }); return plan;
  }
  function buildBirthday(plan, fields) {
    validateBirthday(fields, fixtures, now());
    const missing = [...BIRTHDAY_FIELDS].filter(k => fields[k] == null);
    const nodes = missing.length ? [] : birthdayGraph(fields, fixtures);
    // A changed plan may preserve completed effects only if their inputs match.
    for (const old of plan.steps.filter(n => n.status === 'succeeded')) {
      const replacement = nodes.find(n => n.id === old.id);
      if (!replacement || stable(replacement.payload) !== stable(old.payload)) throw Error('已完成步骤的对象或参数不能直接修改，请保留回执并新建安排');
      Object.assign(replacement, clone(old));
    }
    plan.fields = clone(fields); plan.missing = missing; plan.steps = nodes;
    plan.planned_total_minor = missing.length ? null : fixtures.restaurant.amount_minor + fixtures.cake.amount_minor + 52000;
    refreshPlan(plan);
  }
  function createBirthdayPlan(fields = {}) {
    validateBirthday(fields, fixtures, now());
    const plan = addPlan('birthday', '一起准备她的生日', fields,
      { type: 'user_request', trust: 'user_intent', at: now() }, '把餐厅、蛋糕、定金与生日转账拆开安排，每个敏感步骤单独限定授权。',
      [{ kind: 'contact', source: '本地演示通讯录', detail: '林夏是已保存的女朋友联系人，仍需本次选择确认。' }]);
    buildBirthday(plan, fields); return clone(plan);
  }
  function clarify(planId, patch) {
    const plan = find(planId); if(plan.kind==='compound')return clarifyCompound(planId,patch); if (plan.kind !== 'birthday' || plan.status === 'cancelled') throw Error('当前任务不能补充生日信息');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw Error('请提供待补充的信息');
    const candidate = clone(plan); buildBirthday(candidate, { ...plan.fields, ...patch });
    candidate.revision++; invalidate(candidate, '参数已修改，旧授权失效');
    Object.assign(plan, candidate); record('plan_edited', { plan_id: planId, revision: plan.revision }); return clone(plan);
  }
  function buildCompound(plan, fields) {
    const clean=validateCompoundFields(fields),missing=compoundMissing(clean);
    const nodes=missing.length?[]:compoundGraph(clean,fixtures,now());
    for(const old of plan.steps.filter(n=>n.status==='succeeded')){
      const replacement=nodes.find(n=>n.id===old.id);
      if(!replacement||stable(replacement.payload)!==stable(old.payload))throw Error('已完成步骤不能直接修改，请保留回执并新建安排');
      Object.assign(replacement,clone(old));
    }
    plan.title=(clean.items||[]).map(i=>i.kind==='sms'?'短信给'+(fixtures.contacts.find(c=>c.id===i.contact_id)?.name||'联系人'):i.kind==='ride'?'预约回家顺风车':'订蛋糕').join('、')||'待办安排';
    plan.fields=clean;plan.missing=missing;plan.steps=nodes;
    plan.planned_total_minor=missing.length?null:clean.items.reduce((n,i)=>n+(i.kind==='cake'?fixtures.cake.amount_minor:i.kind==='ride'?i.fare_minor:0),0);
    refreshPlan(plan);
  }
  function createCompoundPlan(fields={},options={}) {
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='request_id'))throw Error('复合安排来源无效');
    const clean=validateCompoundFields(fields),requestId=options.request_id;
    if(requestId!==undefined&&(typeof requestId!=='string'||!requestId||requestId.length>100||!/^[-A-Za-z0-9_.:]+$/.test(requestId)))throw Error('复合安排来源无效');
    if(requestId){const prior=state.plans.find(p=>p.kind==='compound'&&p.request_id===requestId);if(prior){if(stable(prior.fields)!==stable(clean))throw Error('同一次发送的复合安排参数已变化');return clone(prior);}}
    const candidate={steps:[]};buildCompound(candidate,clean);
    const plan=addPlan('compound',candidate.title,clean,{type:'user_request',trust:'user_intent',at:now()},'每个操作单独核对并确认。');
    if(requestId)plan.request_id=requestId;Object.assign(plan,{fields:candidate.fields,missing:candidate.missing,steps:candidate.steps,planned_total_minor:candidate.planned_total_minor,status:candidate.status});return clone(plan);
  }
  function clarifyCompound(planId,patch) {
    const plan=find(planId);if(plan.kind!=='compound'||plan.status==='cancelled')throw Error('当前任务不能补充复合信息');
    const candidate=clone(plan);buildCompound(candidate,mergeCompoundFields(plan.fields,patch));
    safetyGate?.invalidate?.({plan_id:plan.id,reason:'compound_parameters_changed'});
    candidate.revision++;invalidate(candidate,'参数已修改，请重新核对');Object.assign(plan,candidate);
    record('plan_edited',{plan_id:planId,revision:plan.revision});return clone(plan);
  }
  function ingestRentEmail(email = fixtures.rent_email) {
    if (!email?.id || email.type !== 'rent_email' || !validDate(email.due_date)) throw Error('租金事件格式无效');
    money(email.amount_minor); const receivedAt = iso(email.received_at);
    const existing = state.source_events.find(e => e.external_id === email.id);
    if (existing) return clone(find(existing.plan_id));
    const lease = state.memory.lease, contact = state.memory.contacts.find(c => c.id === lease.recipient_id);
    const matched = email.from === contact?.email && email.amount_minor === lease.amount_minor;
    const source = { type: 'mail_demo', external_id: email.id, sender: email.from, subject: email.subject,
      received_at: receivedAt, due_date: email.due_date, trust: 'external_content', mode: 'local_demo',
      extraction: 'known_fields_only', body_is_instruction: false, actual_mail_connection: false };
    const plan = addPlan('rent', '房租快到期了', { due_date: email.due_date }, source,
      matched ? '收到房东的租金提醒，金额与保存的租约一致。需要你确认后才安排付款。' : '来信与保存的租约信息不一致，请核对来源和金额。',
      [{ kind: 'lease', source: '用户保存的演示租约', recipient_id: lease.recipient_id, amount_minor: lease.amount_minor }]);
    plan.steps = [step('rent.payment', '按已保存租约支付本月房租', 'payments_demo', 'transfer',
      { recipient_id: lease.recipient_id, amount_minor: lease.amount_minor, currency: 'CNY', source_account: lease.source_account,
        due_date: email.due_date, purpose: '本月房租', source_mismatch: !matched })];
    plan.planned_total_minor = lease.amount_minor; refreshPlan(plan);
    state.source_events.push({ ...source, plan_id: plan.id });
    record('reminder_created', { plan_id: plan.id, reason: plan.reason }); return clone(plan);
  }
  function subscriptionCycle() {
    const date = localDate(now()), subscription = state.memory.subscription;
    const due = date.slice(0, 8) + String(subscription.renewal_day).padStart(2, '0');
    return { date, subscription, due, externalId: 'subscription:' + subscription.id + ':' + due };
  }
  const choiceOf = plan => plan.fields.subscription_action || (plan.steps.some(n => n.operation === 'cancel_subscription') ? 'cancel' : 'keep');
  function hasSubscriptionReceipt(plan) {
    return plan.steps.some(n => n.status === 'succeeded' && n.receipt_id && state.receipts.some(r => r.plan_id === plan.id && r.step_id === n.id && r.receipt_id === n.receipt_id));
  }
  function buildSubscription(plan, action, due, subscription) {
    const cancel = action === 'cancel';
    plan.fields = { subscription_id: subscription.id, due_date: due, subscription_action: action };
    plan.title = cancel ? '取消下次会员续费' : '只续本期会员';
    plan.reason = cancel ? '只关闭下次续费，本期权益保留，不退款。' : `${subscription.name}本期续费${(subscription.amount_minor / 100).toFixed(2)}元，不授权未来续费。`;
    const base = { subscription_id: subscription.id, amount_minor: cancel ? 0 : subscription.amount_minor, currency: 'CNY',
      source_account: subscription.source_account, cycle: due.slice(0, 7), subscription_action: action, future_auto_renewal: false };
    plan.steps = [cancel ? step('subscription.cancel', '取消下次续费，保留本期权益', 'subscriptions_demo', 'cancel_subscription',
      { ...base, scope: 'next_renewal', preserve_current_period: true, refund_minor: 0 })
      : step('subscription.renew', '只续本期' + (subscription.amount_minor / 100).toFixed(2) + '元', 'subscriptions_demo', 'renew_subscription', { ...base, renewals: 1, scope: 'current_cycle' })];
    plan.missing = []; plan.planned_total_minor = cancel ? 0 : subscription.amount_minor; refreshPlan(plan);
  }
  /** Explicit user/model choice. A choice is still only a proposal, never consent. */
  function prepareSubscription(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'action')) throw Error('订阅选择无效');
    const action = subscriptionAction(options.action), { subscription, due, externalId } = subscriptionCycle();
    const matching = state.plans.filter(p => p.kind === 'subscription' && p.fields.subscription_id === subscription.id && p.fields.due_date === due);
    const completed = matching.find(p => choiceOf(p) === action && hasSubscriptionReceipt(p));
    if (completed) return clone(completed);
    const event = state.source_events.find(e => e.external_id === externalId), current = event ? find(event.plan_id) : null;
    if (current && current.status !== 'cancelled' && !hasSubscriptionReceipt(current)) {
      if (choiceOf(current) === action) return clone(current);
      // The host's bridge may hold a before/after permit across an await.
      // Replacing a choice must invalidate that ticket before changing the graph.
      safetyGate?.invalidate?.({ plan_id: current.id, reason: 'subscription_choice_changed' });
      const before = choiceOf(current); current.revision++; current.grants = {};
      buildSubscription(current, action, due, subscription); running.delete(current.id);
      record('subscription_choice_changed', { plan_id: current.id, revision: current.revision, from: before, to: action, previous_authorization_invalidated: true });
      return clone(current);
    }
    const source = { type: 'subscription_memory_demo', external_id: externalId, due_date: due,
      source: '用户保存的订阅偏好与本地演示账单', trust: 'saved_user_data', mode: 'local_demo' };
    const plan = addPlan('subscription', '本期订阅安排', {}, source, '',
      [{ kind: 'recurrence', source: source.source, renewal_day: subscription.renewal_day, amount_minor: subscription.amount_minor }]);
    buildSubscription(plan, action, due, subscription);
    if (event) { event.previous_plan_ids = [...new Set([...(event.previous_plan_ids || []), event.plan_id])]; event.plan_id = plan.id; }
    else state.source_events.push({ ...source, plan_id: plan.id });
    record('reminder_created', { plan_id: plan.id, subscription_action: action }); return clone(plan);
  }
  /** Legacy no-argument scan still proposes keep, once per cycle, without consent. */
  function scanSubscription(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'action')) throw Error('订阅选择无效');
    if (Object.hasOwn(options, 'action')) subscriptionAction(options.action);
    const { date, subscription, externalId } = subscriptionCycle();
    if (Number(date.slice(8)) < subscription.renewal_day - 3) return null;
    const existing = state.source_events.find(e => e.external_id === externalId);
    if (!Object.hasOwn(options, 'action') && existing) return clone(find(existing.plan_id));
    if (!Object.hasOwn(options, 'action') && subscription.next_renewal_cancelled === true) return null;
    return prepareSubscription({ action: options.action || 'keep' });
  }
  function authorize(planId, { revision, step_ids, confirmed, expires_at, source = 'dialogue' } = {}) {
    const plan = find(planId);
    if (state.locked || plan.status === 'cancelled' || plan.missing.length) throw Error('任务锁定、已取消或信息未齐，不能授权');
    if (confirmed !== true || revision !== plan.revision || !Array.isArray(step_ids) || !step_ids.length || new Set(step_ids).size !== step_ids.length) throw Error('需要对当前版本的具体步骤明确确认');
    if (!['dialogue', 'voice'].includes(source)) throw Error('确认来源无效');
    const end = expires_at ? iso(expires_at) : iso(instant(now()) + 15 * 60000);
    if (instant(end) <= instant(now()) || instant(end) > instant(now()) + 31 * 86400000) throw Error('授权有效期应在当前时间之后、31天以内');
    const nodes = step_ids.map(id => { const node = plan.steps.find(n => n.id === id); if (!node || TERMINAL.has(node.status)) throw Error('授权步骤不存在或已结束'); return node; });
    for (const node of nodes) {
      plan.grants[node.id] = { binding: binding(plan, node), confirmed_at: now(), expires_at: end, source, revision, scope: 'this_step_only' };
      if (['needs_confirmation', 'paused'].includes(node.status)) node.status = 'pending'; node.last_error = null;
    }
    record('consent_recorded', { plan_id: planId, revision, step_ids, expires_at: end, source }); refreshPlan(plan); return clone(plan);
  }
  function activeGrant(plan, node) {
    if (!node.confirmation_required) return null;
    const grant = plan.grants[node.id];
    return grant && grant.binding === binding(plan, node) && instant(grant.expires_at) > instant(now()) ? grant : null;
  }
  function stillCurrent(plan, node, revision, epoch) {
    return epoch === generation && state.plans.includes(plan) && plan.status !== 'cancelled' && plan.revision === revision && plan.steps.includes(node);
  }
  function previousSubscriptionEffect(node) {
    const effect = subscriptionEffect(node);
    return effect ? state.subscription_effects?.[effect.subscription_id + ':' + effect.cycle + ':' + effect.action] : null;
  }
  function commitSubscriptionEffect(plan, node, result) {
    const effect = validateSubscriptionReceipt(node, result); if (!effect) return;
    if (effect.subscription_id !== state.memory.subscription.id) throw Error('订阅回执对象不一致');
    state.subscription_effects ||= {};
    const key = effect.subscription_id + ':' + effect.cycle + ':' + effect.action, previous = state.subscription_effects[key];
    if (previous) {
      if (previous.receipt_id !== result.receipt_id || stable(previous.effect) !== stable(effect)) throw Error('这一期订阅已有完成回执');
      return;
    }
    state.subscription_effects[key] = { plan_id: plan.id, step_id: node.id, receipt_id: result.receipt_id, effect: clone(effect) };
    const subscription = state.memory.subscription;
    if (effect.action === 'cancel') {
      // No rights, cash or refund record is rewritten by cancellation.
      subscription.auto_renewal = false; subscription.next_renewal_cancelled = true;
      subscription.cancellation_receipt = result.receipt_id; subscription.cancelled_cycle = effect.cycle;
    } else {
      subscription.paid_cycles ||= {};
      subscription.paid_cycles[effect.cycle] = { amount_minor: effect.charged_minor, receipt_id: result.receipt_id, renewals: 1 };
    }
  }
  async function executeStep(plan, node) {
    const revision = plan.revision, epoch = generation;
    if (state.locked) { node.status = 'paused'; node.last_error = state.locked.reason; return; }
    if (previousSubscriptionEffect(node)) { node.status = 'paused'; node.last_error = '这一期已有完成回执，请核对记录'; delete plan.grants[node.id]; return; }
    const grant = activeGrant(plan, node);
    if (node.confirmation_required && !grant) { node.status = 'needs_confirmation'; node.last_error = '需要当前参数的有效授权'; return; }
    if (node.scheduled_for && instant(now()) > instant(node.scheduled_for) + 60000 &&
      (!grant || instant(grant.confirmed_at) < instant(node.scheduled_for))) {
      node.status = 'needs_confirmation'; node.last_error = '已错过原定执行时间，请重新确认是否补办';
      delete plan.grants[node.id];
      record('overdue_recovered', { plan_id: plan.id, step_id: node.id, scheduled_for: node.scheduled_for }); return;
    }
    let verdict;
    try {
      verdict = typeof safetyGate === 'function' ? await safetyGate(clone({ phase: 'before_execute', now: now(), mode: 'local_demo',
        plan_id: plan.id, revision, step: node, grant, source: plan.source, locked: state.locked })) : null;
    } catch { verdict = { decision: 'pause', reason: '主安全门暂时不可用' }; }
    if (!stillCurrent(plan, node, revision, epoch)) return;
    if (state.locked) { node.status = 'paused'; node.last_error = state.locked.reason; return; }
    // Authorization can expire while the async risk check is pending.
    if (node.confirmation_required && !activeGrant(plan, node)) { node.status = 'needs_confirmation'; node.last_error = '等待风险检查时授权已失效'; return; }
    record('risk_evaluated', { plan_id: plan.id, step_id: node.id, evaluation: verdict || { decision: 'pause', reason: '未接入主安全门' } });
    if (verdict?.decision !== 'allow' || !RISKS.has(verdict.risk) || typeof verdict.evaluation_id !== 'string' || !verdict.evaluation_id) {
      node.status = verdict?.decision === 'needs_confirmation' ? 'needs_confirmation' : 'paused';
      node.last_error = verdict?.reason || '等待主任务完成身份、风险与授权检查';
      if (node.confirmation_required) delete plan.grants[node.id];
      return;
    }
    const key = plan.id + ':' + node.id + ':v' + revision;
    node.status = 'started'; node.attempts++; node.idempotency_key = key;
    record('step_started', { plan_id: plan.id, step_id: node.id, idempotency_key: key });
    let result;
    try { result = verdict.replay_result ? clone(verdict.replay_result) : await adapters.execute({ plan_id: plan.id, step: clone(node), idempotency_key: key, now: now() }); }
    catch { result = { status: 'failed', reason: '本地适配器执行失败，保留任务等待显式重试' }; }
    if (!stillCurrent(plan, node, revision, epoch)) {
      // A result arriving after lock/edit/cancel/reset cannot resurrect the plan.
      if (epoch === generation && state.plans.includes(plan)) record('stale_result_ignored', { plan_id: plan.id, step_id: node.id });
      return;
    }
    if (state.locked) { node.status = 'paused'; node.last_error = state.locked.reason; return; }
    const allowedStatus = ['succeeded', 'failed', 'needs_confirmation', 'paused'];
    node.status = allowedStatus.includes(result?.status) ? result.status : 'failed';
    if (node.status === 'succeeded' && (!result.receipt_id || result.evidence?.mode !== 'local_demo' || result.evidence.actual_external_effect !== false)) {
      node.status = 'failed'; node.last_error = '演示回执证据不完整'; return;
    }
    if (node.status === 'succeeded') {
      try { validateSubscriptionReceipt(node, result); }
      catch { node.status = 'failed'; node.last_error = '订阅回执范围与效果不一致'; return; }
      if (previousSubscriptionEffect(node)) { node.status = 'paused'; node.last_error = '这一期已有完成回执，请核对记录'; delete plan.grants[node.id]; return; }
    }
    let final;
    try { final = typeof safetyGate === 'function' ? await safetyGate(clone({ phase:'after_execute', now:now(), mode:'local_demo',
      plan_id:plan.id, revision, step:node, grant:activeGrant(plan,node), source:plan.source, locked:state.locked,
      result, idempotency_key:key, evaluation:verdict })) : null; }
    catch { final={decision:'pause',reason:'提交前安全检查未通过'}; }
    if (!stillCurrent(plan,node,revision,epoch) || state.locked) return;
    if (node.confirmation_required && !activeGrant(plan,node)) { node.status='needs_confirmation';node.last_error='提交前授权已失效';return; }
    if (final?.decision!=='allow' || !RISKS.has(final.risk) || typeof final.evaluation_id!=='string' || !final.evaluation_id) {
      node.status=final?.decision==='needs_confirmation'?'needs_confirmation':'paused';node.last_error=final?.reason||'提交前安全检查未通过';
      record('step_commit_blocked',{plan_id:plan.id,step_id:node.id,reason:node.last_error});return;
    }
    result=final.normalized_result||result;
    node.status=allowedStatus.includes(result?.status)?result.status:'failed';
    node.last_error = result.reason || null;
    if (node.status === 'succeeded') {
      try { commitSubscriptionEffect(plan, node, result); }
      catch { node.status = 'failed'; node.last_error = '订阅回执范围与效果不一致'; return; }
    }
    if (['needs_confirmation', 'paused'].includes(node.status) && node.confirmation_required) delete plan.grants[node.id];
    state.journal[key] = { status: node.status, binding: binding(plan, node), result: clone(result), at: now() };
    if (node.status === 'succeeded') {
      node.receipt_id = result.receipt_id;
      if (!state.receipts.some(r => r.idempotency_key === key)) state.receipts.push({ ...clone(result), plan_id: plan.id, step_id: node.id, idempotency_key: key });
    }
    record('step_' + node.status, { plan_id: plan.id, step_id: node.id, receipt_id: node.receipt_id, reason: node.last_error });
  }
  async function runInternal(planId) {
    const plan = find(planId);
    if (plan.status === 'cancelled' || plan.missing.length) return clone(plan);
    const revision = plan.revision, epoch = generation;
    for (const node of [...plan.steps]) {
      if (!stillCurrent(plan, node, revision, epoch)) break;
      if (!['pending', 'needs_confirmation'].includes(node.status)) continue;
      if (node.dependencies.some(id => plan.steps.find(n => n.id === id)?.status !== 'succeeded')) continue;
      if (node.scheduled_for && instant(node.scheduled_for) > instant(now())) continue;
      await executeStep(plan, node);
      if (plan.status === 'cancelled' || state.locked || !state.plans.includes(plan)) break;
    }
    refreshPlan(plan); return clone(plan);
  }
  function run(planId) {
    if (running.has(planId)) return running.get(planId);
    const promise = runInternal(planId).finally(() => { if (running.get(planId) === promise) running.delete(planId); });
    running.set(planId, promise); return promise;
  }
  function retryStep(planId, stepId) {
    const plan = find(planId), node = plan.steps.find(n => n.id === stepId);
    if (!node || !['failed', 'paused'].includes(node.status) || state.locked || plan.status === 'cancelled') throw Error('当前步骤不能重试');
    node.status = node.confirmation_required && !activeGrant(plan, node) ? 'needs_confirmation' : 'pending'; node.last_error = null;
    record('retry_requested', { plan_id: planId, step_id: stepId }); refreshPlan(plan); return clone(plan);
  }
  function setLocked(locked, reason = '安全熔断已触发') {
    generation++;
    state.locked = locked ? { reason, at: now() } : null;
    for (const plan of state.plans.filter(p => !['succeeded', 'cancelled'].includes(p.status))) {
      invalidate(plan, locked ? reason : '锁定已解除，敏感操作需重新授权');
      if (locked) { for (const node of plan.steps) if (!TERMINAL.has(node.status)) node.status = 'paused'; refreshPlan(plan); }
    }
    record(locked ? 'safety_locked' : 'safety_unlocked', { reason }); return clone(state.locked);
  }
  function cancel(planId) {
    const plan = find(planId); safetyGate?.invalidate?.({ plan_id: plan.id, reason: 'plan_cancelled' });
    plan.revision++; plan.grants = {}; plan.status = 'cancelled';
    for (const node of plan.steps) if (node.status !== 'succeeded') { node.status = 'cancelled'; node.last_error = '用户取消未完成步骤'; }
    record('plan_cancelled', { plan_id: planId, completed_effects_reversed: false }); return clone(plan);
  }
  function recover() {
    generation++;
    // Recover only recorded local effects; never call an adapter or replay cash.
    for (const plan of state.plans) for (const node of plan.steps) if (node.status === 'succeeded' && node.receipt_id && ['renew_subscription', 'cancel_subscription'].includes(node.operation)) {
      const receipt = state.receipts.find(r => r.plan_id === plan.id && r.step_id === node.id && r.receipt_id === node.receipt_id);
      if (receipt) commitSubscriptionEffect(plan, node, receipt);
    }
    for (const plan of state.plans.filter(p => !['succeeded', 'cancelled'].includes(p.status))) {
      invalidate(plan, '会话恢复，旧授权失效');
      for (const node of plan.steps) if (node.scheduled_for && !TERMINAL.has(node.status) && instant(node.scheduled_for) <= instant(now())) {
        node.status = 'needs_confirmation'; node.last_error = '错过原计划时间，请重新确认是否补办';
        record('overdue_recovered', { plan_id: plan.id, step_id: node.id, scheduled_for: node.scheduled_for });
      }
      if (state.locked) for (const node of plan.steps) if (!TERMINAL.has(node.status)) node.status = 'paused';
      refreshPlan(plan);
    }
    record('session_recovered', { background_execution_claimed: false }); scanSubscription(); return clone(state);
  }
  async function tick({ execute = false } = {}) {
    scanSubscription(); state.last_tick_at = now(); record('local_queue_checked', { explicit_trigger: true, execute });
    if (execute) for (const plan of [...state.plans]) await run(plan.id);
    return clone(state);
  }
  function reset() {
    generation++; running.clear(); adapters.reset?.(); state = fresh(); record('demo_reset'); return clone(state);
  }
  state = snapshot ? clone(snapshot) : fresh();
  if (state.version !== VERSION || state.mode !== 'local_demo' || !Array.isArray(state.plans) || !Array.isArray(state.events) || !Array.isArray(state.receipts) || !Array.isArray(state.source_events)) throw Error('演示快照格式无效');
  if (snapshot) recover();
  return Object.freeze({ createBirthdayPlan, createCompoundPlan, clarifyCompound, clarify, ingestRentEmail, scanSubscription, prepareSubscription, authorize, run, retryStep,
    setLocked, cancel, recover, tick, reset,
    snapshot: () => clone(state), getPlan: id => clone(find(id)),
    cards: id => proactivePlanCards(find(id), now()),
    queue: () => state.plans.flatMap(p => p.steps.filter(n => n.scheduled_for && !TERMINAL.has(n.status)).map(n => ({
      plan_id: p.id, revision: p.revision, step_id: n.id, status: n.status, scheduled_for: n.scheduled_for,
      registered: p.steps.some(step => step.operation === 'schedule_local_task' && step.status === 'succeeded'),
      authorized: !!activeGrant(p, n), overdue: instant(n.scheduled_for) < instant(now()), mode: 'local_demo',
    }))),
  });
}

export const PROACTIVE_DEMO_DIALOGUES = deepFreeze([
  {
    id: 'rent-and-subscription', title: '主动提醒，但不替我扩大授权',
    turns: [
      { speaker: 'bot', text: '陈先生刚发来11月房租提醒，2800元，11月1日到期。和你保存的租约一致。要从生活账户支付这一个月吗？', cue: 'ingestRentEmail；对话内展示来源、租约与范围' },
      { speaker: 'user', text: '确认，只付这一个月。', cue: 'authorize rent.payment；调用主安全门后 run' },
      { speaker: 'bot', text: '这笔演示付款已完成，回执在这里。另外，28号云音乐会员将续费25元。这次还继续吗？', cue: 'tick生成订阅提醒；显示两个不同来源' },
      { speaker: 'user', text: '这次不续。', cue: 'cancel订阅任务；不创建支付回执' },
      { speaker: 'bot', text: '好，这次续费提醒已取消。你没有授权我处理后续月份。', cue: '仅取消本地计划，不冒充真实平台取消自动续费' },
    ],
  },
  {
    id: 'birthday-dag', title: '一句话跨场景，长线任务可接续',
    turns: [
      { speaker: 'user', text: '我女朋友下周生日，帮我订餐厅和蛋糕，当天13:14给她转520。', cue: 'createBirthdayPlan({})' },
      { speaker: 'bot', text: '我记得林夏在通讯录里。先确认她的生日日期、用餐城市、总预算和付款账户。', cue: 'clarification卡，不能把“下周”猜成某一天' },
      { speaker: 'user', text: '11月6日，在上海，总共1200以内，用生活账户，收款人就是林夏。', cue: 'clarify(planId, PROACTIVE_DEMO_FIXTURES.birthday)' },
      { speaker: 'bot', text: '晚餐328元，蛋糕188元，转账520元，总计1036元。蛋糕先付50元定金。你可以在这里逐项确认，转账只限林夏、520元和当天13:14。', cue: 'task_graph和confirmation卡；每项有参数绑定' },
      { speaker: 'user', text: '确认这些安排。', cue: 'authorize所有敏感步骤；run；除定时转账外先完成演示步骤' },
      { speaker: 'bot', text: '餐厅和蛋糕的演示回执已保存，13:14的转账在本地队列里。到时我会重新检查授权和风险。', cue: '只显示本地演示证据，不声称真实MCP或后台服务' },
      { speaker: 'narrator', text: '推进演示时钟到生日当天13:14；展示正常执行，再重置演示锁定和逾期恢复。', cue: 'clock.set；tick({execute:true})；异常时主门拒绝，授权失效后留在对话中重新确认' },
    ],
  },
]);
