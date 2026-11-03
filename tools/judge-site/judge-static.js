import {createJudgeTransport} from './judge-transport.js';
const nativeFetch=globalThis.fetch.bind(globalThis);
const fixtureURL=new URL('./judge-data/fixtures.json',import.meta.url);
const fixtures=await nativeFetch(fixtureURL).then(r=>{if(!r.ok)throw Error('演示资料未加载');return r.json();});
const scope=new URL(location.href).searchParams.get('session');
const localRequest=createJudgeTransport(fixtures,{origin:location.origin,scope});
globalThis.fetch=(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.pathname.startsWith('/api/')||url.origin!==location.origin)return localRequest(input,options);
 if(!['GET','HEAD'].includes(options.method||'GET'))return Promise.resolve(new Response('Read only static assets',{status:405}));
 return nativeFetch(input,options);
};
