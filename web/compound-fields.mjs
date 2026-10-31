// Bounded data slots for local SMS/cake/ride proposals. No authority or execution.
export const COMPOUND_ITEM_FIELDS=Object.freeze({sms:Object.freeze(['contact_id','message']),cake:Object.freeze(['product_id','date','pickup_time','fulfillment','source_account','budget_minor']),ride:Object.freeze(['date','departure_time','origin','destination','fare_minor','source_account'])});
const CONTACTS=new Set(['mom','dad','partner-linxia','cake-owner']);
const REQUIRED={sms:['contact_id','message'],cake:['product_id','date','pickup_time','fulfillment','source_account'],ride:['date','departure_time','origin','destination','fare_minor','source_account']};
const invalid=()=>{const error=Error('复合安排信息无效，请保留每一项并重新核对。');error.code='invalid_compound_fields';throw error;};
const plain=x=>!!x&&typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function record(x,keys){if(!plain(x))invalid();for(const k of Reflect.ownKeys(x)){if(typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'))invalid();}return x;}
function value(k,v){
 if(v===null)return null;
 if(k==='contact_id'){if(!CONTACTS.has(v)&&v!=='unknown')invalid();return v;}
 if(k==='message'){if(typeof v!=='string'||!v.trim()||v.length>240||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(v))invalid();return v.trim();}
 if(k==='product_id'){if(v!=='demo-cake-01')invalid();return v;}
 if(k==='date'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000-')||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)invalid();return v;}
 if(k==='pickup_time'||k==='departure_time'){if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))invalid();return v;}
 if(k==='origin'||k==='destination'){if(typeof v!=='string'||!v.trim()||v.length>80||/[\u0000-\u001f\u007f<>]/.test(v))invalid();return v.trim();}
 if(k==='fare_minor'){if(!Number.isSafeInteger(v)||v<1||v>200000)invalid();return v;}
 if(k==='fulfillment'){if(v!=='pickup')invalid();return v;}
 if(k==='source_account'){if(v!=='living_1608')invalid();return v;}
 if(k==='budget_minor'){if(!Number.isSafeInteger(v)||v<1||v>2000000)invalid();return v;}
 invalid();
}
export function validateCompoundFields(fields){
 record(fields,['items']);if(!Object.hasOwn(fields,'items'))return {};
 if(!Array.isArray(fields.items)||fields.items.length<1||fields.items.length>6)invalid();
 const ids=new Set();const items=fields.items.map(item=>{
  if(!plain(item)||!['sms','cake','ride'].includes(item.kind)||typeof item.id!=='string'||!/^item-[1-6]$/.test(item.id)||ids.has(item.id))invalid();ids.add(item.id);
  record(item,['id','kind',...COMPOUND_ITEM_FIELDS[item.kind]]);
  return Object.fromEntries(Object.entries(item).map(([k,v])=>[k,['id','kind'].includes(k)?v:value(k,v)]));
 });return {items};
}
export function compoundMissing(fields){
 const {items}=validateCompoundFields(fields);if(!items)return ['items'];const missing=[];
 items.forEach((item,i)=>{for(const k of REQUIRED[item.kind])if(item[k]==null||k==='contact_id'&&item[k]==='unknown')missing.push(`items.${i}.${k}`);if(item.kind==='cake'&&item.budget_minor!=null&&item.budget_minor<18800)missing.push(`items.${i}.budget_minor`);});return missing;
}
export function isCompoundMissingPath(fields,path){return compoundMissing(fields).includes(path);}
// A continued answer may contain only the changed item/slot. Existing order and
// all other requests survive retries; removing a request requires a new plan.
export function mergeCompoundFields(previous={},patch={}){
 const before=validateCompoundFields(previous);if(!plain(patch))invalid();
 if(Object.keys(patch).some(k=>k.startsWith('items.'))){
  if(!before.items)invalid();const result=structuredClone(before);
  for(const [path,v] of Object.entries(patch)){const m=/^items\.([0-5])\.([a-z_]+)$/.exec(path);if(!m||!Object.hasOwn(Object.getOwnPropertyDescriptor(patch,path),'value'))invalid();const item=result.items[Number(m[1])];if(!item||!COMPOUND_ITEM_FIELDS[item.kind].includes(m[2]))invalid();item[m[2]]=value(m[2],v);}
  return validateCompoundFields(result);
 }
 record(patch,['items']);if(!Object.hasOwn(patch,'items'))return before;
 if(!before.items)return validateCompoundFields(patch);
 if(!Array.isArray(patch.items)||!patch.items.length||patch.items.length>6)invalid();
 const result=structuredClone(before),seen=new Set();
 for(const changed of patch.items){
  if(!plain(changed)||typeof changed.id!=='string'||seen.has(changed.id))invalid();seen.add(changed.id);
  const old=result.items.find(x=>x.id===changed.id);if(!old)invalid();
  record(changed,['id','kind',...COMPOUND_ITEM_FIELDS[old.kind]]);if(changed.kind!=null&&changed.kind!==old.kind)invalid();
  Object.assign(old,changed);
 }
 return validateCompoundFields(result);
}
