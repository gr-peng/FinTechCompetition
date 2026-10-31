// A bounded monthly transfer: one confirmation covers a fixed amount, count and cap, at most 90 days.
import {syncFinance} from './finance-state.mjs';
const RESERVE_MINOR=800000;
function addMonths(date,months){
 const [y,m,d]=date.split('-').map(Number),next=new Date(Date.UTC(y,m-1+months,1)),last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();
 return next.getUTCFullYear()+'-'+String(next.getUTCMonth()+1).padStart(2,'0')+'-'+String(Math.min(d,last)).padStart(2,'0');
}
export const lastPeriodDate=(date,occurrences)=>addMonths(date,occurrences-1);
export function createStandingOrder(state,t){
 if(t.cadence!=='monthly'||t.status!=='done')return null;
 state.standingOrders||=[];
 const existing=state.standingOrders.find(o=>o.taskId===t.id);if(existing)return existing;
 const order={id:'standing-'+t.id,taskId:t.id,payeeName:t.payeeName,target:t.target,sourceAccount:t.sourceAccount,amountMinor:Math.round(t.amount*100),total:t.occurrences,executed:1,firstDate:t.scheduledDate,status:'active',companionRun:state.companion?.runId??null};
 state.standingOrders.push(order);return order;
}
export const activeStandingOrder=state=>(state.standingOrders||[]).find(o=>o.status==='active'&&o.companionRun===(state.companion?.runId??null))||null;
export const nextPeriodDate=order=>addMonths(order.firstDate,order.executed);
// Runs only what the first confirmation fixed. Any safety change stops it instead of asking the model.
export function runNextPeriod(state,orderId){
 const order=(state.standingOrders||[]).find(o=>o.id===orderId);
 if(!order||order.status!=='active')throw Error('这项定期转账已结束或已停止。');
 if(state.paused||state.safety?.locked){order.status='stopped';return {order,text:'安全保护或暂停已开启，定期转账已停止，本期没有转出。'};}
 if(Math.round(state.balance*100)-order.amountMinor<RESERVE_MINOR){order.status='stopped';return {order,text:'本期转账会动用房租和生活费预留，定期转账已停止，本期没有转出。'};}
 const period=order.executed+1,date=nextPeriodDate(order),id='standing:'+order.id+':'+period;
 if(state.ledger.some(row=>row.id===id))throw Error('这一期已有流水，不会重复转账。');
 state.ledger.push({id,date,title:'给'+order.payeeName+'转账（定期 第'+period+'期）',category:'人情往来',amountMinor:order.amountMinor,direction:'expense',movement:'cashflow',kind:'transfer',order:state.ledger.length,taskId:order.taskId,receipt:'FP-'+crypto.randomUUID().slice(0,8).toUpperCase(),source:'synthetic',companionRun:order.companionRun,icon:'user',accountLabel:order.sourceAccount==='living_1608'?'生活账户 1608':'工资账户 0826',payment_method:'本地演示适配器'});
 syncFinance(state);order.executed=period;if(period===order.total)order.status='done';
 const money='¥'+(order.amountMinor/100).toLocaleString('zh-CN',{minimumFractionDigits:2});
 return {order,text:`${date} 第 ${period}/${order.total} 期已按首次确认的安排转给${order.payeeName} ${money}${order.status==='done'?'，定期转账全部完成。':'。'}`};
}
export function stopStandingOrder(state,orderId){
 const order=(state.standingOrders||[]).find(o=>o.id===orderId);if(!order||order.status!=='active')throw Error('这项定期转账已结束或已停止。');
 order.status='stopped';return {order,text:`已停止给${order.payeeName}的定期转账，已转出的 ${order.executed} 期不受影响，后续不再执行。`};
}
