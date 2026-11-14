import test from 'node:test';import assert from 'node:assert/strict';
import {PancakeClient} from '../agent/lib/pancake/client.ts';
import {runSyncPage} from '../agent/lib/pancake/sync.ts';
test('POS client uses fixed read-only endpoints and validates pagination without leaking API key',async()=>{
 let calls=0;
 const client=new PancakeClient('private-key',async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://pos.pages.fm');assert.equal(init?.redirect,'error');assert.equal(url.searchParams.get('api_key'),'private-key');
  calls++;return Response.json({success:true,data:[],total_pages:1,total_entries:0});
 });
 assert.equal((await client.orders('20',{from:'2026-11-07T00:00:00Z',to:'2026-11-14T00:00:00Z',page:1,mode:'initial'})).done,true);assert.equal(calls,1);
 const bad=new PancakeClient('private-key',async()=>Response.json({success:false,message:'private-key'},{status:403}));
 await assert.rejects(bad.shops(),error=>!String(error).includes('private-key'));
 const malformed=new PancakeClient('key',async()=>Response.json({success:true,data:[]}));
 await assert.rejects(malformed.orders('20',{from:'2026-11-07T00:00:00Z',to:'2026-11-14T00:00:00Z',page:1,mode:'initial'}));
});
test('sync does not finish or checkpoint when a page fails or returns a cross-shop order',async()=>{
 const job={id:'j',connectionId:'pos',shopId:'20',currency:'VND',from:'2026-11-07T00:00:00Z',to:'2026-11-14T00:00:00Z',page:1,mode:'initial' as const,lease:'l'};
 let written=0,failed=0;const store={checkpoint:async()=>{written++;},finish:async()=>{written++;},fail:async()=>{failed++;}};
 await assert.rejects(runSyncPage(store,{orders:async()=>{throw Error('secret');}},job));assert.equal(written,0);assert.equal(failed,1);
 await assert.rejects(runSyncPage(store,{orders:async()=>({data:[{id:1,shop_id:30,status:1,inserted_at:'2026-11-07T00:00:00',updated_at:'2026-11-07T00:00:00',items:[]}],done:true})},job));
 assert.equal(written,0);
});
test('incremental pagination resumes inclusively by update time instead of a shifting page offset',async()=>{
 let checkpoint:any[]=[];
 const store={checkpoint:async(...args:any[])=>{checkpoint=args;},finish:async()=>{throw Error('must not finish');},fail:async()=>{}};
 const job={id:'j',connectionId:'pos',shopId:'20',currency:'VND',from:'2026-11-14T00:00:00Z',to:'2026-11-14T03:00:00Z',page:1,mode:'incremental' as const,lease:'l'};
 await runSyncPage(store,{orders:async()=>({done:false,data:[{id:1,shop_id:20,status:1,inserted_at:'2026-11-14T01:00:00',updated_at:'2026-11-14T02:00:00',items:[]}]})},job);
 assert.equal(checkpoint[2],1);assert.equal(checkpoint[3],'2026-11-14T02:00:00.000Z');
});
test('documented order detail response is a root order object, not a data envelope',async()=>{
 const raw={id:1,shop_id:20,status:1,items:[]};const client=new PancakeClient('key',async()=>Response.json(raw));
 assert.deepEqual(await client.order('20','1'),raw);await assert.rejects(client.order('20','2'));
});
