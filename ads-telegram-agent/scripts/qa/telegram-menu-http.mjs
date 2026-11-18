import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const app=process.cwd(),dir=await mkdtemp(join(tmpdir(),'nex-menu-http-')),base='http://127.0.0.1:4419';
const registry={version:1,revision:0,groups:[{id:'meta-qa',name:'QA Ads',enabled:true,sources:{},schedule:{enabled:true,time:'09:00',days:[0,1,2,3,4,5,6],reportDay:'today'},report:{source:'meta',connectionId:'qa-meta',accountId:'act_1',campaignIds:['10'],metrics:['cost','messages'],comparison:'none',detail:'rows'}}]};
await writeFile(join(dir,'groups.json'),JSON.stringify(registry));await writeFile(join(dir,'meta-connections.json'),JSON.stringify([{id:'qa-meta',name:'QA',token:'qaFakeMetaToken1234567890',accounts:[{id:'act_1',name:'QA account',currency:'VND',timezone_name:'Asia/Ho_Chi_Minh'}],checkedAt:new Date().toISOString()}]));
await writeFile(join(dir,'botcake-connections.json'),JSON.stringify([{id:'qa-botcake',name:'QA Page',pageId:'111',token:'qaDummyBotcakeToken123',source:'both',fieldIds:[4],fields:[{id:4,name:'Stored phone',type:1}],revision:1,checkedAt:new Date().toISOString()}]));
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,PORT:'4419',HOST:'127.0.0.1',DASHBOARD_PASSWORD:'qa-local-password',REPORT_CONFIG_PATH:join(dir,'groups.json'),PRIVATE_CONFIG_DIR:dir,TELEGRAM_MENU_DIR:join(dir,'menus'),REPORT_SOURCES_JSON:'{}',TELEGRAM_BOT_TOKEN:'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi',TELEGRAM_CHAT_ID:'123',TELEGRAM_WEBHOOK_SECRET_TOKEN:'qa-webhook-secret',VERCEL_PROJECT_PRODUCTION_URL:'reports.example.test',UPSTASH_REDIS_REST_URL:'https://qa-redis.example.test',UPSTASH_REDIS_REST_TOKEN:'qa-redis-token',QA_EVENTS:join(dir,'events.jsonl'),AI_ENABLED:'false'};
const log=await import('node:fs').then(m=>m.openSync(join(dir,'server.log'),'a'));
const proc=spawn(process.execPath,['--import',resolve(app,'scripts/qa/telegram-menu-fixtures.mjs'),resolve(app,'.output/server/index.mjs')],{cwd:dir,env,stdio:['ignore',log,log]});
async function post(path,body,cookie,extra={}){return fetch(base+path,{method:'POST',headers:{'X-Tram-Ads':'1','Content-Type':'application/json',Origin:base,...(cookie?{cookie}:{}),...extra},body:JSON.stringify(body)});}
const messages=async()=>{try{return (await readFile(env.QA_EVENTS,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch{return [];}};
async function awaitCount(n){for(let i=0;i<60;i++){if((await messages()).length>=n)return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out waiting for '+n+' messages; got '+(await messages()).length);}
try{
 let up=false;for(let i=0;i<50;i++){try{const r=await fetch(base+'/telegram-menu.js');if(r.ok){up=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}assert(up,'Compiled server startup');
 assert.equal((await post('/api/telegram-menu',{revision:0,menu:{}})).status,401);
 const login=await post('/api/login',{password:env.DASHBOARD_PASSWORD});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');
 const state=await fetch(base+'/api/state',{headers:{'X-Tram-Ads':'1',cookie}}).then(r=>r.json());assert.equal(state.telegramMenu.buttons.length,9);
 assert.equal((await fetch(base+'/botcake.js')).status,200);
 assert.equal(state.botcakeConnections.length,1);assert(!JSON.stringify(state).includes('qaDummyBotcakeToken123'));
 assert.equal((await post('/api/botcake',{action:'list'})).status,401);
 assert.equal((await post('/api/botcake',{action:'list'},cookie,{Origin:'https://attacker.test'})).status,403);
 const bcHealth=await post('/api/botcake',{action:'health'},cookie);assert.equal(bcHealth.status,200);assert.equal((await bcHealth.json()).ready,false);
 const bcFields=await post('/api/botcake',{action:'fields',pageId:'111'},cookie);assert.equal(bcFields.status,200);assert.equal((await bcFields.json()).fields[0].id,4);
 const bcInvalid=await post('/api/botcake',{action:'save',id:'bad',pageId:'../bad',name:'Bad',source:'profile',fieldIds:[],token:'qaDummyBotcakeToken123'},cookie);assert.equal(bcInvalid.status,400);assert(!(await bcInvalid.text()).includes('qaDummyBotcakeToken123'));
 const menu={...state.telegramMenu,columns:3};const save=await post('/api/telegram-menu',{revision:0,menu},cookie);assert.equal(save.status,200);assert.equal((await save.json()).revision,1);
 const report=await fetch(base+'/api/report?date=2026-11-14&group=meta-qa',{headers:{'X-Tram-Ads':'1',cookie}}).then(r=>r.json());assert.equal(typeof report.text,"string",JSON.stringify(report));assert.match(report.text,/120.000/);assert(report.id);
 assert.equal((await post('/api/send',{id:report.id},cookie)).status,200);let sent=await messages();assert(sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.text.includes('Cập nhật')));
 const message={message_id:200,from:{id:123,is_bot:false,first_name:'QA'},chat:{id:123,type:'private'},date:Math.floor(Date.now()/1000),text:'/baocao 14/11/2026 meta-qa'};
 assert.equal((await post('/eve/v1/telegram',{update_id:1,message},undefined,{'X-Telegram-Bot-Api-Secret-Token':'qa-webhook-secret'})).status,200);
 await awaitCount(2);sent=await messages();assert(sent.at(-1).reply_markup,'Commands include menu');const count=sent.length;
 const refresh=sent.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.text.includes('Cập nhật'));
 const callback={id:'compiled-callback-1',from:{id:123,is_bot:false,first_name:'QA'},data:refresh.callback_data,message:{message_id:1002,from:{id:456,is_bot:true,first_name:'QA Bot'},chat:{id:123,type:'private'},date:message.date,text:'QA report'}};
 const update={update_id:2,callback_query:callback};
 assert.equal((await post('/eve/v1/telegram',update,undefined,{'X-Telegram-Bot-Api-Secret-Token':'qa-webhook-secret'})).status,200);
 await awaitCount(count+1);assert.equal((await messages()).length,count+1);assert.match((await messages()).at(-1).text,/120.000/);
 await post('/eve/v1/telegram',update,undefined,{'X-Telegram-Bot-Api-Secret-Token':'qa-webhook-secret'});assert.equal((await messages()).length,count+1,'Duplicate callback is deduped');
 const dateButton=(await messages()).at(-1).reply_markup.inline_keyboard.flat().find(b=>b.text.includes('Chọn ngày'));
 callback.id='compiled-date';callback.data=dateButton.callback_data;await post('/eve/v1/telegram',{update_id:3,callback_query:callback},undefined,{'X-Telegram-Bot-Api-Secret-Token':'qa-webhook-secret'});
 await awaitCount(count+2);assert((await messages()).at(-1).reply_markup.inline_keyboard.flat().some(b=>b.text.includes('7 ngày')));
 const before=(await messages()).length;callback.id='wrong-owner';callback.from.id=124;
 await post('/eve/v1/telegram',{update_id:4,callback_query:callback},undefined,{'X-Telegram-Bot-Api-Secret-Token':'qa-webhook-secret'});assert.equal((await messages()).length,before);
 assert.notEqual((await post('/eve/v1/telegram',update,undefined,{'X-Telegram-Bot-Api-Secret-Token':'wrong'})).status,200);
 // Existing help stays text-only and functional.
 message.message_id=201;message.text='/help';await post('/eve/v1/telegram',{update_id:5,message},undefined,{'X-Telegram-Bot-Api-Secret-Token':'qa-webhook-secret'});await awaitCount(before+1);assert.match((await messages()).at(-1).text,/baocao/);assert.equal((await messages()).at(-1).reply_markup,undefined);
 // Existing scheduled reports get controls through the same compiled library.
 const scheduled=spawn(process.execPath,['--import',resolve(app,'scripts/qa/telegram-menu-fixtures.mjs'),'--input-type=module','-e',`const {scheduledReport}=await import(${JSON.stringify(new URL('file://'+app+'/agent/lib/job.ts').href)});const result=await scheduledReport(new Date('2026-11-18T02:00:00Z'));if(result[0]?.status!=='sent')throw new Error('Schedule failed');`],{cwd:dir,env,stdio:['ignore',log,log]});
 assert.equal(await new Promise(r=>scheduled.on('exit',r)),0);assert((await messages()).at(-1).reply_markup,'Scheduled report includes menu');
 console.log('PASS compiled HTTP: Botcake asset/safe DTO/field discovery/auth/CSRF/validation, assets, auth/CSRF, independent menu save, Meta report, manual send, real Eve webhook command+callback, duplicate/owner/secret rejection, date submenu, legacy help, scheduled delivery. All upstream services use isolated fixtures; no live messages sent.');
}catch(error){console.error(error);console.error((await readFile(join(dir,'server.log'),'utf8')).slice(-7000));process.exitCode=1;}
finally{if(proc.exitCode===null){proc.kill('SIGTERM');await new Promise(r=>proc.on('exit',r));}await rm(dir,{recursive:true,force:true});}
