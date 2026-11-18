import test from 'node:test';
import assert from 'node:assert/strict';
import {BotcakeClient} from '../agent/lib/botcake/client.ts';
import {normalizePhone,phoneValues,utcTime,vietnamDay} from '../agent/lib/botcake/phones.ts';

test('Botcake stored phone normalization deduplicates Vietnam formats and never extracts from arbitrary text',()=>{
 assert.equal(normalizePhone('0901 234 567'),'+84901234567');assert.equal(normalizePhone('+84 (901) 234-567'),'+84901234567');
 assert.equal(normalizePhone('84901234567'),'+84901234567');assert.equal(normalizePhone('user says 0901234567'),null);
 assert.equal(normalizePhone('0000000000'),null);assert.equal(normalizePhone('123'),null);
 assert.deepEqual(phoneValues(['0901234567','+84901234567']),['+84901234567']);
 assert.deepEqual(phoneValues('["0901234567", "0912345678"]'),['+84901234567','+84912345678']);
 assert.equal(utcTime('2026-11-18T16:59:59'),'2026-11-18T16:59:59.000Z');
 assert.equal(vietnamDay('2026-11-18T17:00:00'),'2026-11-19');assert.equal(utcTime('2026-02-31T01:00:00'),null);
 assert.equal(utcTime(null),null);
});
test('Botcake list uses bounded keyset pagination and whitelists returned contact facts',async t=>{
 const calls:any[]=[];t.mock.method(globalThis,'fetch',async(input:any,options:any)=>{
  const u=new URL(input);calls.push({u,options});return Response.json([{id:'customer-a',psid:'123',phone_number:['0901234567'],full_name:'private name',message:'must not retain'}],{headers:{'x-next-after':'customer-a'}});
 });
 const page=await new BotcakeClient('test-token-abcdefghijklmnop').customers('456','');
 assert.equal(calls[0].u.hostname,'botcake.io');assert.equal(calls[0].u.searchParams.get('after'),'');assert.equal(calls[0].u.searchParams.get('limit'),'100');
 assert.equal(calls[0].options.headers['access-token'],'test-token-abcdefghijklmnop');assert.equal(calls[0].options.redirect,'error');
 assert.equal(page.next,'customer-a');assert.equal(page.data[0].psid,'123');assert(!JSON.stringify(page).includes('private name'));assert(!JSON.stringify(page).includes('must not retain'));
 await assert.rejects(new BotcakeClient('test-token-abcdefghijklmnop').customers('../other'),/Page/);
});
test('Botcake info preserves null, newest ad and UTC time with documented response wrappers',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:{id:'customer-a',psid:'123',phone_number:['0901234567'],ad_id:'99',ad_ids:['98','99'],last_interactive_at:'2026-11-18T02:00:00',is_subscribed:false,full_name:'private name'}}));
 const info=await new BotcakeClient('test-token-abcdefghijklmnop').info('456','123');
 assert.equal(info.adId,'99');assert.equal(info.lastInteractiveAt,'2026-11-18T02:00:00.000Z');assert.equal(info.subscribed,false);assert(!('full_name' in info));
 t.mock.method(globalThis,'fetch',async()=>Response.json({response:{success:true,data:{id:'customer-a',psid:'123',phone_number:null,ad_id:null,last_interactive_at:null}}}));
 const missing=await new BotcakeClient('test-token-abcdefghijklmnop').info('456','123');assert.equal(missing.lastInteractiveAt,null);assert.deepEqual(missing.phones,[]);
});
test('Botcake fields bulk retain customer identity and safe cursor; API errors never expose response/token',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:[{page_customer_id:'customer-a',custom_field_id:10,value:'0901234567',customer_name:'private name'}],next_after:'customer-a'}));
 const page=await new BotcakeClient('test-token-abcdefghijklmnop').fieldValues('456',10,'');assert.equal(page.next,'customer-a');assert.equal(page.data[0].customerId,'customer-a');assert(!JSON.stringify(page).includes('private name'));
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:false,message:'sensitive upstream details test-token-abcdefghijklmnop'}, {status:401}));
 await assert.rejects(new BotcakeClient('test-token-abcdefghijklmnop').info('456','123'),error=>!/sensitive|test-token/.test((error as Error).message)&&/Botcake/.test((error as Error).message));
});

test('Botcake stops oversized streamed responses before buffering the entire body',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let chunks=0,cancelled=false;
 globalThis.fetch=async()=>new Response(new ReadableStream({pull(controller){chunks++;if(chunks>6){controller.close();return;}controller.enqueue(new Uint8Array(1_000_001));},cancel(){cancelled=true;}}));
 await assert.rejects(new BotcakeClient('qaFakeTokenNeverLog').customers('123'),/định dạng/);assert(cancelled);assert(chunks<=4);
});
