import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {BotcakeStore} from '../agent/lib/botcake/store.ts';import {PhoneVault} from '../agent/lib/botcake/crypto.ts';
import {runBotcakeSync} from '../agent/lib/botcake/sync.ts';
import {saveBotcakeConnection,listBotcakeConnections} from '../agent/lib/botcake/connections.ts';
import type {SqlDatabase} from '../agent/lib/pancake/database.ts';import type {CustomerFact} from '../agent/lib/botcake/types.ts';
async function fixture(t:test.TestContext){const pg=new PGlite();t.after(()=>pg.close());const db:SqlDatabase={query:(s,p)=>pg.query(s,p),transaction:fn=>pg.transaction(tx=>fn({query:(s,p)=>tx.query(s,p)}))};return new BotcakeStore(db,new PhoneVault('c'.repeat(64)));}
const c=(id:string,phones:string[]):CustomerFact=>({id:'customer-'+id,psid:id,phones,lastInteractiveAt:null,adId:null,metadata:false,subscribed:true});
test('sync scans old subscribers for added phone, seeds baseline and enriches only unknown phones',async t=>{
 const store=await fixture(t),config={pageId:'456',source:'both' as const,fieldIds:[10]};let round=0,infoCalls=0;
 const client={customers:async(_page:string,cursor:string)=>({data:cursor?[]:[c('123',['0901234567']),c('124',round?['0912345678']:[])],next:cursor?null:'customer-124'}),
 fieldValues:async()=>({data:[{customerId:'customer-123',psid:null,value:'0901234567'}],next:null}),
 info:async(_page:string,psid:string)=>{infoCalls++;return {...c(psid,['0912345678']),lastInteractiveAt:new Date().toISOString(),adId:'99',metadata:true};}};
 await runBotcakeSync(store,client,config,{force:true});assert.equal((await store.status('456')).baselineCount,1);assert.equal(infoCalls,0);
 round=1;await runBotcakeSync(store,client,config,{force:true});assert.equal((await store.status('456')).newCount,1);assert.equal((await store.status('456')).pendingCount,0);assert.equal(infoCalls,1);
 await runBotcakeSync(store,client,config,{force:true});assert.equal((await store.status('456')).newCount,1);assert.equal(infoCalls,1);
});
test('sync source failure leaves cursor and last complete snapshot intact and retries safely',async t=>{
 const store=await fixture(t),config={pageId:'456',source:'profile' as const,fieldIds:[]};let fail=false;
 const client={customers:async()=>{if(fail)throw Error('raw token must not leak');return {data:[c('123',['0901234567'])],next:null};},fieldValues:async()=>({data:[],next:null}),info:async()=>c('123',[])};
 await runBotcakeSync(store,client,config,{force:true});const synced=(await store.status('456')).syncedAt;fail=true;
 await assert.rejects(runBotcakeSync(store,client,config,{force:true}),/Botcake/);assert.equal((await store.status('456')).syncedAt,synced);assert(!JSON.stringify(await store.status('456')).includes('raw token'));
 fail=false;await runBotcakeSync(store,client,config,{force:true});assert.equal((await store.status('456')).phoneCount,1);
});
test('connection saves verify live scope, hide token, preserve Page identity and reject stale revisions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bc-connections-')),keys=['PRIVATE_CONFIG_DIR','REPORT_CONFIG_PATH','BLOB_READ_WRITE_TOKEN','BLOB_STORE_ID','VERCEL'];const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const k of keys)delete process.env[k];process.env.PRIVATE_CONFIG_DIR=dir;
 t.after(async()=>{for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;await rm(dir,{recursive:true,force:true});});
 const store=await fixture(t),client={customers:async()=>({data:[],next:null}),fields:async()=>[{id:10,name:'Phone',type:1}]};
 const body={id:'bc-qa',name:'QA page',pageId:'456',token:'fake-api-token-abcdefghijklmnop',source:'both',fieldIds:[10]};
 await saveBotcakeConnection(body,{client,store});let rows=await listBotcakeConnections();assert.equal(rows.length,1);assert.equal(rows[0].revision,1);assert(!JSON.stringify(rows).includes('fake-api-token'));
 await saveBotcakeConnection({...body,token:'',name:'Updated',revision:1},{client,store});rows=await listBotcakeConnections();assert.equal(rows[0].revision,2);
 await assert.rejects(saveBotcakeConnection({...body,revision:1},{client,store}),/đã thay đổi/);
 await assert.rejects(saveBotcakeConnection({...body,pageId:'999',revision:2},{client,store}),/Page/);
 await assert.rejects(saveBotcakeConnection({...body,id:'bc-other'},{client,store}),/đã có/);
});
