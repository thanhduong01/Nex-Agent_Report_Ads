import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {menuFixture} from './telegram-menu-fixture.ts';
import {getRegistry,updateRegistry} from '../agent/lib/groups.ts';
import {defaultMenu,buttonFingerprint} from '../agent/lib/telegram-menu-config.ts';
import {saveMenuContext,readMenuCallback} from '../agent/lib/telegram-menu-context.ts';
import {handleTelegramCallback} from '../agent/lib/telegram-menu-callbacks.ts';
import {telegramSend,DeliveryError,type DeliveryStore} from '../agent/lib/delivery.ts';
import {connectTelegram} from '../agent/lib/telegram-setup.ts';
import {dashboardApi} from '../agent/lib/dashboard-api.ts';
import {aggregate} from '../agent/lib/report.ts';
import {resolveRequest} from '../agent/lib/request-config.ts';
const query=(data:string,id='qa-1')=>({id,data,from:{id:'123',isBot:false},message:{messageId:'44',chat:{id:'123',type:'private' as const}}});
function store():DeliveryStore{const states=new Map();return {async claim(k){if(states.has(k)&&states.get(k)!=='failed')return false;states.set(k,'pending');return true;},async finish(k,s){states.set(k,s);}};}
const context={groupId:'default',from:'2026-11-01',to:'2026-11-14'};
const report={groupId:'default',groupName:'Original',range:{from:context.from,to:context.to},date:context.to,fetchedAt:new Date().toISOString(),sourceUrl:'',confirmed:false,rows:[],totals:aggregate([]),previous:null,previous7:null};
test('Telegram transport preserves legacy payload while attaching optional keyboards and callback webhook updates',async t=>{
 await menuFixture(t);const old={VERCEL_ENV:process.env.VERCEL_ENV,VERCEL_PROJECT_PRODUCTION_URL:process.env.VERCEL_PROJECT_PRODUCTION_URL};
 t.after(()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 process.env.VERCEL_ENV='production';process.env.VERCEL_PROJECT_PRODUCTION_URL='reports.example.test';
 const calls:any[]=[];t.mock.method(globalThis,'fetch',async(url:string,options:RequestInit)=>{
  const method=url.split('/').pop(),body=JSON.parse(options.body as string);calls.push({method,body});
  return Response.json({ok:true,result:method==='getWebhookInfo'?{url:'https://reports.example.test/eve/v1/telegram'}:method==='getMe'?{id:456}:method==='getChat'?{id:123,type:'private'}:{message_id:99}});
 });
 await telegramSend('Old text');assert.deepEqual(calls[0].body,{chat_id:'123',text:'Old text',link_preview_options:{is_disabled:true}});
 const keyboard={inline_keyboard:[[{text:'Next',callback_data:'safe'}]]};await telegramSend('New text',keyboard);assert.deepEqual(calls[1].body.reply_markup,keyboard);
 await connectTelegram(true);assert.deepEqual(calls.find(c=>c.method==='setWebhook').body.allowed_updates,['message','callback_query']);assert(!calls.some(c=>c.body.drop_pending_updates));
});
test('saved-request button selects fixed group and configured period, never broadens target request scope',async t=>{
 await menuFixture(t);const registry=await getRegistry();registry.groups.push({...registry.groups[0],id:'second',name:'Second'});
 registry.requests.push({...registry.requests[0],id:'weekly',command:'weekly',groupMode:'selected',groupIds:['second'],period:'last7',allowDate:false});
 const button={id:'weekly',label:'Week',enabled:true,action:'request' as const,requestId:'weekly',groupMode:'fixed' as const,groupId:'second',dateMode:'request' as const,fullRow:false};
 registry.telegramMenu={enabled:true,columns:1,buttons:[button]};
 const token=(await saveMenuContext(context,[{kind:'button',buttonId:button.id,fingerprint:buttonFingerprint(button)}]))[0];
 let selected:any;const texts:string[]=[];
 const deps={registry:async()=>registry,store:store(),prepare:async(date:string,id:string,opts:any)=>{selected={date,id,...opts};return {report:{...report,groupId:id,date},text:'Saved request report'};},send:async(text:string)=>{texts.push(text);return 1;}};
 await handleTelegramCallback(query(token),async()=>{},deps);assert.equal(selected.id,'second');assert.equal((Date.parse(selected.date)-Date.parse(selected.from))/86400000,6);
 registry.requests.at(-1)!.groupIds=['default'];selected=undefined;
 await handleTelegramCallback(query(token,'restricted'),async()=>{},deps);assert.equal(selected,undefined);assert.match(texts.at(-1)!,/không thuộc|thay đổi|hết hạn/);
});
test('group chooser retains explicit dates and refreshes the selected group',async t=>{
 await menuFixture(t);const registry=await getRegistry();registry.groups.push({...registry.groups[0],id:'second',name:'Second'});
 const b=defaultMenu().buttons.find(b=>b.action==='groups')!;
 const token=(await saveMenuContext(context,[{kind:'button',buttonId:b.id,fingerprint:buttonFingerprint(b)}]))[0];
 let keyboard:any,selected:any;
 const deps={registry:async()=>registry,store:store(),prepare:async(date:string,id:string,opts:any)=>{selected={date,id,...opts};return {report,text:'group report'};},send:async(_text:string,k:any)=>{keyboard=k;return 1;}};
 await handleTelegramCallback(query(token),async()=>{},deps);
 const next=keyboard.inline_keyboard.flat().find((b:any)=>b.text==='Second');assert(next);
 assert.deepEqual((await readMenuCallback(next.callback_data))?.context,context);
 await handleTelegramCallback(query(next.callback_data,'second'),async()=>{},deps);
 assert.equal(selected.id,'second');assert.equal(selected.from,context.from);assert.equal(selected.date,context.to);
});
test('partial delivery never splices fresh source data on retry and sends a separate recovery notice',async t=>{
 await menuFixture(t);const registry=await getRegistry(),b=defaultMenu().buttons[0];
 const token=(await saveMenuContext(context,[{kind:'button',buttonId:b.id,fingerprint:buttonFingerprint(b)}]))[0];
 const sends:string[]=[];let rejected=false,preparations=0;
 const deps={registry:async()=>registry,store:store(),prepare:async()=>{preparations++;return {report,text:preparations===1?'A'.repeat(3900)+'B'.repeat(100):'changed source'};},send:async(text:string)=>{sends.push(text);if(text[0]==='B'&&!rejected){rejected=true;throw new DeliveryError('Rejected',true);}return 1;}};
 await handleTelegramCallback(query(token),async()=>{},deps);await handleTelegramCallback(query(token),async()=>{},deps);
 assert.equal(preparations,1);assert.equal(sends[0][0],'A');assert.equal(sends[1][0],'B');assert.match(sends[2],/một phần|chưa gửi đủ/);assert.equal(sends.length,3);
 const uncertain={...deps,store:store(),send:async()=>{sends.push('U');throw new DeliveryError('Unknown',false);}};
 await handleTelegramCallback(query(token,'uncertain'),async()=>{},uncertain);await handleTelegramCallback(query(token,'uncertain'),async()=>{},uncertain);assert.equal(sends.filter(s=>s==='U').length,1);
});
test('menu API is authenticated, rejects CSRF and saves through revision CAS without altering old settings',async t=>{
 await menuFixture(t);const oldPassword=process.env.DASHBOARD_PASSWORD;process.env.DASHBOARD_PASSWORD='qa-password';
 t.after(()=>{if(oldPassword===undefined)delete process.env.DASHBOARD_PASSWORD;else process.env.DASHBOARD_PASSWORD=oldPassword;});
 const base='https://reports.example.test';
 const req=(path:string,body:any,cookie?:string,origin=base)=>new Request(base+path,{method:'POST',headers:{'X-Tram-Ads':'1','Content-Type':'application/json',origin,...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 const body={revision:0,menu:{...defaultMenu(),enabled:false}};
 assert.equal((await dashboardApi(req('/api/telegram-menu',body))).status,401);
 const login=await dashboardApi(req('/api/login',{password:'qa-password'})),cookie=login.headers.get('set-cookie')!;
 assert.equal((await dashboardApi(req('/api/telegram-menu',body,cookie,'https://attacker.test'))).status,403);
 const original=await getRegistry();assert.equal((await dashboardApi(req('/api/telegram-menu',body,cookie))).status,200);
 assert.deepEqual((await getRegistry()).groups,original.groups);assert.deepEqual((await getRegistry()).requests,original.requests);
 assert.equal((await dashboardApi(req('/api/telegram-menu',body,cookie))).status,409);
});
