// Presentation is derived from committed receipts, never from a confirm click.
export function planOutcome(plan,{now=Date.now(),granted=false,paused=false,formatTime=x=>x}={}){
 const writes=plan.steps.filter(n=>n.confirmation_required),done=writes.filter(n=>n.status==='succeeded'&&n.receipt_id),remaining=writes.filter(n=>n.status!=='succeeded');
 const scheduled=remaining.filter(n=>n.scheduled_for&&Date.parse(n.scheduled_for)>now);
 const cash=done.filter(n=>['pay_deposit','transfer','pay_rent','renew_subscription'].includes(n.operation)).reduce((n,s)=>n+(s.payload.amount_minor||0),0);
 const paid=cash?'，已支出 ¥'+(cash/100).toLocaleString('zh-CN',{minimumFractionDigits:2}):'';
 if(plan.status==='cancelled')return {status:'已取消',collapse:true,summary:done.length?`后续已取消，已完成 ${done.length} 步${paid}。`:'这次安排已取消，没有执行操作。'};
 if(paused||plan.status==='paused')return {status:'已暂停',collapse:false,summary:`已完成 ${done.length}/${writes.length} 步，后续已暂停${paid}。`};
 if(plan.status==='failed'||writes.some(n=>n.status==='failed'))return {status:done.length?'部分完成':'未完成',collapse:false,summary:`已完成 ${done.length}/${writes.length} 步${paid}，剩余步骤未成功，请重新核对。`};
 if(writes.length&&done.length===writes.length)return {status:'已完成',collapse:true,summary:plan.kind==='compound'?`${[done.some(n=>n.operation==='send_sms')?'短信':'',done.some(n=>n.operation==='message_contact')?'蛋糕安排':'',done.some(n=>n.operation==='reserve_ride')?'顺风车预约':''].filter(Boolean).join('与')||'这次安排'}已完成${paid}${done.some(n=>n.operation==='reserve_ride')?'，车费未支付':''}。`: `这次安排已完成${paid}。`};
 if(granted&&scheduled.length===remaining.length&&scheduled.length)return {status:'已安排，待执行',collapse:true,summary:`前面的 ${done.length} 步已完成${paid}。${formatTime(scheduled[0].scheduled_for)} 的转账已安排，尚未转出；到时会再核对授权。`};
 return {status:'待你确认',collapse:false,summary:`已完成 ${done.length}/${writes.length} 步，下一步待你确认。`};
}
export function successFeedback(node,{esc:e}={}){
 if(node?.status!=='succeeded'||!node.receipt_id)return '';
 const sms=node.operation==='send_sms',transfer=['transfer','pay_deposit','pay_rent','renew_subscription'].includes(node.operation);
 const path=sms?'<path d="m3 10 18-7-7 18-3-8-8-3Z"/><path d="m11 13 10-10"/>':transfer?'<path class="feedback-arrow" d="M5 12h14m-5-5 5 5-5 5"/><path class="feedback-check" d="m5 12 4 4L19 6"/>':'<path d="m5 12 4 4L19 6"/>';
 return `<div class="action-success ${sms?'sent':transfer?'transferred':'reserved'}" role="status" data-success-receipt="${e(node.receipt_id)}"><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg><span>${sms?'已发送':transfer?(node.operation==='transfer'?'已转账':'已支付'):node.operation==='schedule_local_task'?'已保存':['message_contact','reserve_restaurant','reserve_ride'].includes(node.operation)?'已预订':'已完成'}</span></div>`;
}
export function renderConversation(messages,{renderMessage,esc:e,presentations={}}){
 const folded=new Set();return messages.map((m,i)=>{
  const p=m.planId&&presentations[m.planId];if(!p?.collapse||m.planSummary)return renderMessage(m,i);
  if(folded.has(m.planId))return '';folded.add(m.planId);
  const rows=messages.map((v,j)=>({v,j})).filter(({v})=>v.planId===m.planId&&!v.planSummary);
  return `<details class="conversation-history"><summary>${e(p.title||'本次安排')}<span>${e(p.status)} ${rows.length}条记录</span></summary><div>${rows.map(({v,j})=>renderMessage(v,j)).join('')}</div></details>`;
 }).join('');
}
