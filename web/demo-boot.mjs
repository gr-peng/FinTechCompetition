import {resetBotPresentation} from './operation-flow.mjs';
import {invalidateSafetyEpoch,auditSafety} from './safety-policy.mjs';

// A new document is a new card/chat demonstration. Hash navigation never calls
// this. Financial facts, completed receipts and connection cookies stay intact.
export function resetDemoOnBoot(state,{resetCards=true}={}){
 const eventCursor=state.companion?.eventCursor;
 resetBotPresentation(state);
 invalidateSafetyEpoch(state,'page_reloaded');
 // Refresh starts a new synthetic run, not a recovery/replay of old operations.
 // Unknown/manual locks remain protected; only this app's demo breaker resets.
 if(!state.safety.locked||['prompt_injection','reported_scam','voice_mismatch','password_failures','verification_failures','unauthorized_attempt'].includes(state.safety.lock?.reason)){
  state.safety.locked=false;state.safety.lock=null;
  state.safety.failures={verification:0,password:0,tool:0,suspicious:0,consecutive:0};
  for(const signal of state.safety.signals)signal.mitigated=true;
  auditSafety(state,{type:'demo_run_reset',reason:'page_reloaded'});
 }
 if(resetCards&&state.bankCards)delete state.bankCards.credit;
 state.savingsCoach=null;state.savingsEditor=null;state.savingsCancelId=null;state.savingsArchiveId=null;
 for(const jar of [...Object.values(state.savingsJars||{}),state.savingsJar].filter(Boolean))if(jar.status==='active')jar.status='paused_safety';
 state.messages=[];state.conversationArchives=[];state.agentDraftHistory={};
 state.agentLastReceipt=null;
 for(const task of state.tasks||[]){
  if((task.agentOrigin||task.companionRun)&&!['done','cancelled','blocked'].includes(task.status)){
   task.status='cancelled';task.granted=false;task.approved=null;task.approvedParameters=null;
   task.safetyGrantId=null;task.safetyChallengeId=null;task.verifiedRevision=null;task.revision=(task.revision||0)+1;
   (task.logs??=[]).push({text:'刷新已结束本轮待执行安排',at:Date.now()});
  }
 }
 state.companion=eventCursor?{eventCursor}:{};
 return state;
}

export function createDocumentLifetime(){
 let active=true;
 return {active:()=>active,stop:()=>{active=false;},commit:fn=>{if(active)return fn();}};
}
