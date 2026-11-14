import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {reportManagement} from '../agent/lib/report-management.ts';import {getRegistry} from '../agent/lib/groups.ts';
test('explicit template creation appends a paused independent group, rejects existing IDs and preserves the old report',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'template-create-')),keys=['REPORT_CONFIG_PATH','PRIVATE_CONFIG_DIR','VERCEL','BLOB_READ_WRITE_TOKEN','BLOB_STORE_ID','REPORT_SOURCES_JSON'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));t.after(async()=>{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];await rm(dir,{recursive:true,force:true});});
 for(const k of keys)delete process.env[k];process.env.REPORT_CONFIG_PATH=join(dir,'groups.json');process.env.PRIVATE_CONFIG_DIR=dir;process.env.REPORT_SOURCES_JSON='{}';
 const before=await getRegistry(),definition={source:'sheets',metrics:['cost','messages'],comparison:'none'};
 const result=await reportManagement('/api/report-definition',{groupId:'new-template',create:true,name:'New template',revision:0,definition});
 assert.equal(result.saved,true);const after=await getRegistry();assert.equal(after.groups.length,2);assert.deepEqual(after.groups[0],before.groups[0]);assert.equal(after.groups[1].schedule?.enabled,false);
 await assert.rejects(reportManagement('/api/report-definition',{groupId:'default',create:true,name:'Overwrite attempt',revision:1,definition}),error=>(error as any).status===409);
 assert.deepEqual((await getRegistry()).groups[0],before.groups[0]);
});
