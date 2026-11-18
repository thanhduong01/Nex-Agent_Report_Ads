import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {dashboardApi} from '../agent/lib/dashboard-api.ts';

test('QA: Botcake administration enforces authenticated same-origin JSON and rejects bad inputs before upstream access',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'botcake-api-qa-'));
 const keys=['DASHBOARD_PASSWORD','PRIVATE_CONFIG_DIR','REPORT_CONFIG_PATH','VERCEL','VERCEL_ENV','BLOB_READ_WRITE_TOKEN','BLOB_STORE_ID'];const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];
 process.env.DASHBOARD_PASSWORD='qa-only-password';process.env.PRIVATE_CONFIG_DIR=dir;process.env.REPORT_CONFIG_PATH=join(dir,'groups.json');
 t.after(async()=>{for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;await rm(dir,{recursive:true,force:true});});
 const base='https://reports.example.test';
 const req=(path:string,body:any,cookie?:string,origin=base)=>new Request(base+path,{method:'POST',headers:{'X-Tram-Ads':'1','Content-Type':'application/json',origin,...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 t.mock.method(globalThis,'fetch',async()=>{assert.fail('Invalid/unauthorized Botcake input must not access external API');});
 assert.equal((await dashboardApi(req('/api/botcake',{action:'list'}))).status,401);
 const login=await dashboardApi(req('/api/login',{password:'qa-only-password'})),cookie=login.headers.get('set-cookie')!;
 assert.equal((await dashboardApi(req('/api/botcake',{action:'list'},cookie,'https://attacker.test'))).status,403);
 const list=await dashboardApi(req('/api/botcake',{action:'list'},cookie));assert.equal(list.status,200);assert.deepEqual(await list.json(),{connections:[]});
 const invalid=await dashboardApi(req('/api/botcake',{action:'save',id:'bc-qa',name:'QA',pageId:'../escape',source:'profile',fieldIds:[],token:'qa-only-dummy-token'},cookie));assert.equal(invalid.status,400);assert(!JSON.stringify(await invalid.json()).includes('qa-only-dummy-token'));
});

test('Botcake database readiness action needs no Page token and reports missing configuration safely',async t=>{
 const old=process.env.DATABASE_URL;delete process.env.DATABASE_URL;t.after(()=>{if(old===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old;});
 const {botcakeAction}=await import('../agent/lib/botcake/api.ts');const result=await botcakeAction({action:'health'});assert.equal((result as any).ready,false);assert.equal((result as any).database.configured,false);
});
