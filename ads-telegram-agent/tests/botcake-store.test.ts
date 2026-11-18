import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import type {ScanConfig} from '../agent/lib/botcake/store.ts';
import {BotcakeStore} from '../agent/lib/botcake/store.ts';
import {PhoneVault} from '../agent/lib/botcake/crypto.ts';
import type {SqlDatabase} from '../agent/lib/pancake/database.ts';
import type {CustomerFact} from '../agent/lib/botcake/types.ts';
async function fixture(t:test.TestContext){const pg=new PGlite();t.after(()=>pg.close());const db:SqlDatabase={query:async(s,p)=>(await pg.query(s,p)),transaction:async fn=>pg.transaction(tx=>fn({query:async(s,p)=>tx.query(s,p)}))};const vault=new PhoneVault('a'.repeat(64)),store=new BotcakeStore(db,vault);await store.init();return {pg,store,vault};}
const config={pageId:'456',source:'profile' as const,fieldIds:[]};
const fact=(phone='0901234567',psid='123',date='2026-11-18T02:00:00.000Z',adId:string|null='99'):CustomerFact=>({id:'customer-'+psid,psid,phones:[phone],lastInteractiveAt:date,adId,metadata:true,subscribed:true});
async function start(store:BotcakeStore,configArg:ScanConfig=config){await store.enqueue(configArg,true);return (await store.claim(configArg.pageId))!;}
async function baseline(store:BotcakeStore){const job=await start(store);await store.profiles(job,[fact()]);await store.finish(job);}
test('Botcake baseline, immutable day/ad and normalized phone key survive customer reentry and separate Pages',async t=>{
 const {pg,store}=await fixture(t);await baseline(store);
 let job=await start(store);assert.equal(job.baseline,false);
 await store.profiles(job,[fact('+84901234567','124','2026-11-19T03:00:00.000Z','100'),fact('0912345678','125',new Date().toISOString(),'99')]);await store.finish(job);
 let rows=await store.ledger(['456'],{from:'2000-01-01',to:'2099-12-31'},0);
 assert.equal(rows.total,2);assert.equal(rows.rows.filter(r=>r.baseline).length,1);const fresh=rows.rows.find(r=>!r.baseline)!;const first=fresh.recordedDay;
 job=await start(store);await store.profiles(job,[fact('0912345678','125',new Date(Date.now()+1000).toISOString(),'100')]);await store.finish(job);
 rows=await store.ledger(['456'],{from:'2000-01-01',to:'2099-12-31'},0);assert.equal(rows.total,2);assert.equal(rows.rows.find(r=>!r.baseline)!.recordedDay,first);assert.equal(rows.rows.find(r=>!r.baseline)!.adId,'99');
 const page2={...config,pageId:'457'};job=await start(store,page2);await store.finish(job);job=await start(store,page2);await store.profiles(job,[fact('0912345678','125',new Date().toISOString())]);await store.finish(job);
 assert.equal((await store.ledger(['456','457'],{from:'2000-01-01',to:'2099-12-31'},0)).total,3);
 const raw=JSON.stringify((await pg.query('SELECT * FROM nex_reporting.botcake_phones')).rows);assert(!raw.includes('0901234567'));assert(!raw.includes('0912345678'));assert(!raw.includes('+84901234567'));
});
test('Botcake lease and unique ledger prevent concurrent duplicates and stale job writes',async t=>{
 const {store}=await fixture(t);await baseline(store);await store.enqueue(config,true);
 const jobs=await Promise.all([store.claim('456'),store.claim('456')]);assert.equal(jobs.filter(Boolean).length,1);const job=jobs.find(Boolean)!;
 const f=fact('0923456789','130',new Date().toISOString());await store.profiles(job,[f,{...f,id:'customer-131',psid:'131'}]);await store.finish(job);
 assert.equal((await store.status('456')).newCount,1);await assert.rejects(store.profiles(job,[f]),/thay đổi|hết hạn/);
});
test('Botcake config changes baseline only new unknown numbers and key mismatch cannot reset history',async t=>{
 const {store,pg}=await fixture(t);await baseline(store);
 const changed={...config,source:'both' as const,fieldIds:[10]};const job=await start(store,changed);assert(job.baseline);await store.profiles(job,[fact('0934567890','132',new Date().toISOString())]);await store.finish(job);
 assert.equal((await store.status('456')).newCount,0);assert.equal((await store.status('456')).baselineCount,2);
 const db:SqlDatabase={query:async(s,p)=>pg.query(s,p),transaction:async fn=>pg.transaction(tx=>fn({query:async(s,p)=>tx.query(s,p)}))};
 await assert.rejects(new BotcakeStore(db,new PhoneVault('b'.repeat(64))).enqueue(changed,true),/khóa|Khóa/);
});
test('Botcake pending info never becomes a false zero; detail hydration commits metadata once',async t=>{
 const {store}=await fixture(t);await baseline(store);let job=await start(store);
 await store.profiles(job,[{...fact('0945678901','140'),lastInteractiveAt:null,adId:null,metadata:false}]);await store.finish(job);
 assert.equal((await store.status('456')).pendingCount,1);assert.equal((await store.pending('456'))[0].psid,'140');
 job=await start(store);await store.hydrate(job,'140',fact('0945678901','140',new Date().toISOString(),'777'));await store.finish(job);
 const status=await store.status('456');assert.equal(status.pendingCount,0);assert.equal(status.newCount,1);
 const rows=await store.ledger(['456'],{from:'2000-01-01',to:'2099-12-31'},0);assert.equal(rows.rows.find(r=>!r.baseline)!.adId,'777');assert(rows.rows.every(r=>!r.phone.includes('+8490')));
});
test('a delayed older customer detail cannot demote an already recorded new phone into baseline',async t=>{
 const {store,pg,vault}=await fixture(t);await baseline(store);const job=await start(store),phone='0956789012';
 await store.profiles(job,[fact(phone,'155',new Date().toISOString(),'900')]);
 await pg.query('INSERT INTO nex_reporting.botcake_details(page_id,psid,phone_keys) VALUES($1,$2,$3::text[])',['456','156',[vault.hash(phone)]]);
 await store.hydrate(job,'156',fact(phone,'156','2020-01-01T00:00:00.000Z','old'));
 assert.equal((await store.status('456')).newCount,1);
 const rows=await store.ledger(['456'],{from:'2000-01-01',to:'2099-12-31'},0);assert.equal(rows.rows.find(r=>r.adId==='900')?.baseline,false);
});
test('Botcake report snapshot exposes only committed completed data with matching totals and pending scope',async t=>{
 const {store}=await fixture(t);await baseline(store);const day=new Date(Date.now()+7*3600000).toISOString().slice(0,10);let job=await start(store);await store.profiles(job,[fact('0967890123','160',new Date().toISOString(),'99')]);
 const partial=await store.reportSnapshot(['456'],{from:day,to:day});assert.equal(partial.rows.length,0);assert.equal(partial.pages[0].total,1);
 await store.finish(job);const complete=await store.reportSnapshot(['456'],{from:day,to:day});assert.equal(complete.rows.length,1);assert.equal(complete.pages[0].total,2);assert.equal(complete.pages[0].pending,0);
});
