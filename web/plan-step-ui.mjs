import {planOutcome,successFeedback} from './task-feedback.mjs';
// Presentation only. Current-step authorization remains in the core controller.
export function nextPlanStep(plan){
 if(!plan||['succeeded','cancelled'].includes(plan.status))return null;
 const complete=new Set(plan.steps.filter(n=>n.status==='succeeded').map(n=>n.id));
 return plan.steps.find(n=>n.confirmation_required&&!['succeeded','cancelled'].includes(n.status)&&(n.dependencies||[]).every(id=>complete.has(id)))||null;
}
export const PLAN_ACTIONS=Object.freeze({
 send_sms:{title:'发送短信',confirm:'确认发送',done:'短信已发送'},
 message_contact:{title:'预订蛋糕',confirm:'确认预订',done:'蛋糕已预订'},
 pay_deposit:{title:'支付蛋糕定金',confirm:'确认支付定金',done:'定金已支付'},
 reserve_restaurant:{title:'预订晚餐',confirm:'确认预订',done:'晚餐已预订'},
 reserve_ride:{title:'预约回家顺风车',confirm:'确认预约',done:'顺风车已预约，车费未支付'},
 schedule_local_task:{title:'保存定时转账',confirm:'确认定时安排',done:'定时安排已保存'},
 transfer:{title:'转账',confirm:'确认转账',done:'转账已完成'},
 renew_subscription:{title:'续本期会员',confirm:'确认续费',done:'本期会员已续费'},
 cancel_subscription:{title:'取消下次续费',confirm:'确认取消续费',done:'下次续费已取消'},
});
export function stepDetails(node,{esc:e,money,target,contacts=[],formatTime=x=>x}={}){
 const p=node.payload||{},contact=contacts.find(c=>c.id===(p.recipient_id||p.contact_id));
 const name=p.recipient_name||p.restaurant_name||contact?.name||target||'',phone=p.phone||contact?.phone;
 const row=(label,value)=>value?`<div class="plan-row"><span>${e(label)}</span><strong>${e(value)}</strong></div>`:'';
 let html=`<div class="step-contact"><strong>${e(p.shop_name||name)}</strong>${p.shop_name&&name&&p.shop_name!==name?`<span>${e(name)}${phone?` <span class="step-phone">${e(phone)}</span>`:''}</span>`:phone?`<span class="step-phone">${e(phone)}</span>`:''}</div>`;
 if(node.operation==='reserve_ride')html='';
 if(p.product_name)html+=row('蛋糕',p.product_name);
 if(p.date||p.time||p.pickup_time||p.departure_time)html+=row(node.operation==='reserve_ride'?'出发时间':p.fulfillment==='pickup'?'自取':'时间',[p.date,p.departure_time||p.pickup_time||p.time].filter(Boolean).join(' '));
 if(node.operation==='reserve_ride'){html+=row('从',p.origin)+row('到',p.destination)+row('车费上限',money(p.fare_minor));html+='<p class="companion-card-meta">确认预约，不扣车费。</p>';}
 if(p.people)html+=row('人数',p.people+'人');
 if(p.quoted_amount_minor)html+=row('报价',money(p.quoted_amount_minor));
 if(p.deposit_minor)html+=row('定金',money(p.deposit_minor));
 if(p.amount_minor)html+=row(node.operation==='pay_deposit'?'定金':'金额',money(p.amount_minor));
 if(p.source_account)html+=row(node.operation==='reserve_ride'?'费用来源':'付款账户',p.source_account==='living_1608'?'生活账户1608':'工资账户0826');
 if(node.scheduled_for||p.scheduled_for)html+=row('执行时间',formatTime(node.scheduled_for||p.scheduled_for));
 if(node.operation==='cancel_subscription')html+='<p class="companion-card-meta">保留本期权益，不退款。</p>';
 if(p.message&&node.operation==='send_sms')html+=`<div class="step-message">${e(p.message)}</div>`;
 return html;
}
export function renderStepPlan(plan,{esc:e,money,node,operation,classification,contacts,paused=false,running=false,verifying=false,granted=false,locked=false,now=Date.now(),formatTime,details='',paymentSummary='',feedback=null}={}){
 const action=PLAN_ACTIONS[node?.operation]||{title:plan.title,confirm:'确认这一步'};
 const writes=plan.steps.filter(n=>n.confirmation_required),done=writes.filter(n=>n.status==='succeeded'&&n.receipt_id).length;
 const terminal=['succeeded','cancelled'].includes(plan.status),waiting=!!node?.scheduled_for&&Date.parse(node.scheduled_for)>now&&granted;
 const outcome=planOutcome(plan,{now,granted,paused,formatTime});const status=running?'处理中':verifying?'待验证':outcome.status;
 const active=node?`<div class="step-context">${stepDetails(node,{esc:e,money,target:operation?.target,contacts,formatTime})}</div>`:'';
 const reason=classification?.riskBlocked?'当前对象存在未消除的风险，不能继续。':classification?.requiresVerification&&!terminal?'请输入密码确认。':'';
 const confirm=node&&!terminal&&!paused&&!running&&!verifying&&!granted&&!locked&&!classification?.riskBlocked?`<button class="primary full" data-action="plan-confirm" data-plan="${e(plan.id)}" data-step="${e(node.id)}" data-revision="${plan.revision}">${e(action.confirm)}</button>`:'';
 const controls=feedback?successFeedback(feedback,{esc:e}):!terminal?`${confirm}${paused?`<button class="secondary full" data-action="plan-resume" data-plan="${e(plan.id)}">接回并重新核对</button>`:''}${!running&&!paused&&!verifying&&['compound','birthday'].includes(plan.kind)?`<button class="quiet" data-action="plan-edit" data-plan="${e(plan.id)}">修改</button>`:''}<button class="quiet" data-action="plan-cancel" data-plan="${e(plan.id)}">取消后续</button>`:'';
 return `<section class="card companion-plan" data-current-plan="${e(plan.id)}" data-current-step="${e(node?.id||'')}" data-plan-revision="${plan.revision}"><div class="row between"><h3>${e(terminal?plan.title:action.title)}</h3><span class="pill">${e(status)}${node&&!terminal&&!waiting?` ${done+1}/${writes.length}`:''}</span></div>${active}${waiting?'<p class="step-scheduled">已安排，尚未转出。到时再次核对授权。</p>':''}${reason?`<p class="step-risk">${e(reason)}</p>`:''}${terminal?`<p class="companion-card-meta">已完成${done}/${writes.length}步${paymentSummary?'，'+e(paymentSummary):''}</p>`:''}<div class="step-controls">${controls}</div><details class="step-history"><summary>本次安排与记录</summary>${details}${!terminal?`<div class="step-management"><button class="quiet" data-action="plan-pause" data-plan="${e(plan.id)}">暂停后续</button><button class="quiet" data-action="plan-handoff" data-plan="${e(plan.id)}">由我接手</button></div>`:''}</details></section>`;
}
