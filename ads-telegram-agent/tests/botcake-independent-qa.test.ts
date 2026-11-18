import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {BotcakeClient} from '../agent/lib/botcake/client.ts';
import {BotcakeStore} from '../agent/lib/botcake/store.ts';
import {PhoneVault} from '../agent/lib/botcake/crypto.ts';
import {runBotcakeSync} from '../agent/lib/botcake/sync.ts';
import type {SqlDatabase} from '../agent/lib/pancake/database.ts';

async function fixture(t:test.TestContext){const pg=new PGlite();t.after(()=>pg.close());const db:SqlDatabase={query:(s,p)=>pg.query(s,p),transaction:fn=>pg.transaction(tx=>fn({query:(s,p)=>tx.query(s,p)}))};const store=new BotcakeStore(db,new PhoneVault('d'.repeat(64)));await store.init();return {store,pg};}

test('QA: Botcake custom field enumeration reads all documented 50-row pages',async t=>{
 const pages:number[]=[];
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const page=Number(new URL(input).searchParams.get('page'));pages.push(page);
  const data=page===0?Array.from({length:50},(_,i)=>({id:i+1,name:'Field '+(i+1),type:0})):page===1?[{id:51,name:'Phone field after first page',type:0}]:[];
  return Response.json({success:true,data});
 });
 const fields=await new BotcakeClient('qa-dummy-abcdefghijklmnop').fields('456');
 assert.equal(fields.length,51);assert(fields.some(f=>f.id===51));assert.deepEqual(pages,[0,1,2]);
});

test('QA: unresolvable custom-field customer identity remains pending, never a completed false zero',async t=>{
 const {store}=await fixture(t),config={pageId:'456',source:'custom' as const,fieldIds:[10]};let round=0;
 const client={customers:async()=>({data:[],next:null}),fieldValues:async()=>({data:round?[{customerId:'unsubscribed-customer',psid:null,value:'0901234567'}]:[],next:null}),info:async()=>{throw Error('unknown PSID cannot be hydrated');}};
 await runBotcakeSync(store,client,config,{force:true});round=1;
 await runBotcakeSync(store,client,config,{force:true});
 const s=await store.status('456');assert.equal(s.pendingCount,1);assert.equal(s.newCount,0);assert.equal(await store.pendingSnapshot('456'),1);
 const ledger=await store.ledger(['456'],{from:'2000-01-01',to:'2099-12-31'});assert.equal(ledger.rows[0].recordedDay,null);assert.equal(ledger.rows[0].baseline,false);
});

test('QA: a partial scan does not expose phone rows until a complete checkpoint',async t=>{
 const {store}=await fixture(t),config={pageId:'456',source:'profile' as const,fieldIds:[]};await store.enqueue(config,true);let j=(await store.claim('456'))!;await store.finish(j);
 await store.enqueue(config,true);j=(await store.claim('456'))!;
 const now=new Date().toISOString();await store.profiles(j,[{id:'c-1',psid:'123',phones:['0901234567'],lastInteractiveAt:now,adId:'99',metadata:true,subscribed:true}]);
 assert.equal((await store.reportRows(['456'],'2000-01-01','2099-12-31')).length,0);
 await store.finish(j);assert.equal((await store.reportRows(['456'],'2000-01-01','2099-12-31')).length,1);
});

test('QA: an expired worker failure cannot mark a successfully completed newer lease as failed',async t=>{
 const {store,pg}=await fixture(t),config={pageId:'456',source:'profile' as const,fieldIds:[]};
 await store.enqueue(config,true);const old=(await store.claim('456'))!;
 await pg.query("UPDATE nex_reporting.botcake_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[old.id]);
 const newer=(await store.claim('456'))!;assert.notEqual(old.lease,newer.lease);await store.finish(newer);
 await store.fail(old);assert.equal((await store.status('456')).lastError,null);
});
