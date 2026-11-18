import test from 'node:test';
import assert from 'node:assert/strict';
import {menuFixture} from './telegram-menu-fixture.ts';
import {getRegistry,type Registry} from '../agent/lib/groups.ts';
import {defaultMenu,buttonFingerprint} from '../agent/lib/telegram-menu-config.ts';
import {saveMenuContext,readMenuCallback} from '../agent/lib/telegram-menu-context.ts';
import {reportKeyboard} from '../agent/lib/telegram-menu.ts';
import {handleTelegramCallback,renderReportView} from '../agent/lib/telegram-menu-callbacks.ts';
import {aggregate,type Report} from '../agent/lib/report.ts';
import type {DeliveryStore} from '../agent/lib/delivery.ts';
const context={groupId:'default',from:'2026-11-01',to:'2026-11-14',requestId:'today'};
const query=(data:string,id='callback-1')=>({id,data,from:{id:'123',isBot:false},message:{messageId:'55',chat:{id:'123',type:'private' as const}}});
function memoryStore():DeliveryStore{const states=new Map();return {async claim(k){if(states.has(k))return false;states.set(k,'pending');return true;},async finish(k,s){states.set(k,s);}};}
const report:Report={date:context.to,range:{from:context.from,to:context.to},groupId:'default',groupName:'Original',fetchedAt:new Date().toISOString(),sourceKind:'meta',sourceUrl:'https://example.test',confirmed:false,rows:[],rowMetricValues:[{name:'Campaign A',metrics:[{id:'cost',name:'Chi phí',value:100,formula:'chi_phi',scope:'both',unit:'currency',decimals:0}]}],totals:aggregate([]),previous:null,previous7:null};
test('report menu filters unsupported source views and signs only opaque callbacks',async t=>{
 await menuFixture(t);const registry=await getRegistry();
 const keyboard=await reportKeyboard(context,registry);assert(keyboard);
 assert(!keyboard.inline_keyboard.flat().some(b=>/Sản phẩm|Đối soát|Nhận định|Campaign/.test(b.text)));
 for(const b of keyboard.inline_keyboard.flat())if('callback_data' in b){assert(Buffer.byteLength(b.callback_data)<=64);assert(await readMenuCallback(b.callback_data));}
 registry.groups[0].report={source:'meta'} as any;
 assert((await reportKeyboard(context,registry))?.inline_keyboard.flat().some(b=>/Campaign/.test(b.text)));
 assert.equal(await reportKeyboard(context,{...registry,telegramMenu:{...defaultMenu(),enabled:false}}),undefined);
});
test('callback authenticates before storage, acknowledges immediately, preserves dates and deduplicates',async t=>{
 await menuFixture(t);const registry=await getRegistry();registry.groups[0].report={source:'meta'} as any;
 const b=defaultMenu().buttons[0],token=(await saveMenuContext(context,[{kind:'button',buttonId:b.id,fingerprint:buttonFingerprint(b)}]))[0];
 const events:string[]=[],sent:any[]=[],options:any[]=[];
 const deps={registry:async()=>{events.push('registry');return registry;},store:memoryStore(),prepare:async(date:string,id:string,opt:any)=>{options.push({date,id,...opt});return {report,text:'original report'};},send:async(text:string,keyboard:any)=>{sent.push({text,keyboard});return 12;}};
 const ack=async()=>{events.push('ack');};
 await handleTelegramCallback({...query(token),from:{id:'124',isBot:false}},ack,deps);assert.deepEqual(events,['ack']);assert.equal(sent.length,0);
 events.length=0;await handleTelegramCallback(query(token),ack,deps);await handleTelegramCallback(query(token),ack,deps);
 assert.equal(events[0],'ack');assert.equal(sent.length,1);assert.match(sent[0].text,/original report/);assert(sent[0].keyboard);
 assert.deepEqual(options.map(o=>[o.date,o.id,o.from]),[[context.to,'default',context.from]]);
});
test('old callbacks reject disabled/re-scoped requests and changed menu buttons without fetching sources',async t=>{
 await menuFixture(t);const registry=await getRegistry(),b=defaultMenu().buttons[0];
 const token=(await saveMenuContext(context,[{kind:'button',buttonId:b.id,fingerprint:buttonFingerprint(b)}]))[0];
 let prepared=0;const sent:string[]=[];
 const deps={registry:async()=>registry,store:memoryStore(),prepare:async()=>{prepared++;return {report,text:'report'};},send:async(text:string)=>{sent.push(text);return 1;}};
 registry.requests[0].enabled=false;await handleTelegramCallback(query(token,'disabled'),async()=>{},deps);
 registry.requests[0].enabled=true;registry.requests[0].groupMode='selected';registry.requests[0].groupIds=['other'];await handleTelegramCallback(query(token,'scoped'),async()=>{},deps);
 registry.requests[0].groupMode='all';registry.telegramMenu=defaultMenu();registry.telegramMenu.buttons[0].label='Changed';await handleTelegramCallback(query(token,'changed'),async()=>{},deps);
 assert.equal(prepared,0);assert.equal(sent.length,3);assert(sent.every(text=>/thay đổi|không còn|hết hạn/.test(text)));
});
test('date/group submenus preserve request permissions and include valid navigation',async t=>{
 await menuFixture(t);const registry=await getRegistry();registry.groups.push({...registry.groups[0],id:'second',name:'Second'});
 const b=defaultMenu().buttons.find(b=>b.action==='dates')!;
 const token=(await saveMenuContext(context,[{kind:'button',buttonId:b.id,fingerprint:buttonFingerprint(b)}]))[0];
 let keyboard:any,prepared:any;
 const deps={registry:async()=>registry,store:memoryStore(),prepare:async(date:string,id:string,opt:any)=>{prepared={date,id,...opt};return {report,text:'test'};},send:async(_text:string,k:any)=>{keyboard=k;return 1;}};
 await handleTelegramCallback(query(token),async()=>{},deps);assert(keyboard.inline_keyboard.flat().some((b:any)=>/7 ngày/.test(b.text)));
 const seven=keyboard.inline_keyboard.flat().find((b:any)=>/7 ngày/.test(b.text));await handleTelegramCallback(query(seven.callback_data,'seven'),async()=>{},deps);
 assert.equal((Date.parse(prepared.date)-Date.parse(prepared.from))/86400000,6);
 const custom=(await saveMenuContext(context,[{kind:'custom-date',buttonId:b.id,fingerprint:buttonFingerprint(b)}]))[0];
 let guidance='';await handleTelegramCallback(query(custom,'custom'),async()=>{},{...deps,send:async(text:string)=>{guidance=text;return 2;}});assert.match(guidance,/\/baocao/);assert.match(guidance,/default/);
 registry.requests[0].allowDate=false;
 await handleTelegramCallback(query(seven.callback_data,'locked-date'),async()=>{},{...deps,send:async(text:string)=>{guidance=text;return 2;}});assert.match(guidance,/không cho|thay đổi/);
});
test('report views render real campaign and POS data with explicit missing-data states',()=>{
 assert.match(renderReportView('campaigns',report),/Campaign A[\s\S]*100/);
 assert.throws(()=>renderReportView('products',report));
 const sales={...report,sales:{complete:false,products:[{name:'Product A',sku:'A',units:3,revenue:150}],signals:[{title:'Watch',detail:'Partial data'}],attribution:{matchedOrders:1,unmatchedOrders:2,coverage:1/3,reasons:{missing_ad:2}},quality:{warnings:['Still importing'],stale:true},statusCounts:[{code:'4',label:'Returning',count:1}],basis:'confirmed'} as any};
 assert.match(renderReportView('products',sales),/Product A[\s\S]*3/);
 assert.match(renderReportView('products',sales),/chưa đủ|đồng bộ/i);
 assert.match(renderReportView('reconciliation',sales),/33,3|33.3/);
 assert.match(renderReportView('insights',sales),/Watch/);
});
test('date-locked report refresh preserves the original period across Vietnam midnight and rejects policy edits',async t=>{
 await menuFixture(t);const registry=await getRegistry();registry.requests[0].allowDate=false;
 const now=Date.now(),day=new Date(now+7*3600000).toISOString().slice(0,10),ctx={...context,from:day,to:day};
 const keyboard=await reportKeyboard(ctx,registry),token=(keyboard!.inline_keyboard.flat().find(b=>b.text.includes('Cập nhật')) as any).callback_data;
 let prepared=0;const deps={registry:async()=>registry,store:memoryStore(),prepare:async()=>{prepared++;return {report,text:'original'};},send:async()=>1};
 t.mock.timers.enable({apis:['Date'],now:now+86400000});
 await handleTelegramCallback(query(token,'next-day'),async()=>{},deps);assert.equal(prepared,1);
 registry.requests[0].reportDay='yesterday';await handleTelegramCallback(query(token,'changed-policy'),async()=>{},deps);assert.equal(prepared,1);
});
test('legacy single-day callback refresh retains the original report path',async t=>{
 await menuFixture(t);const registry=await getRegistry(),b=defaultMenu().buttons[0];
 const ctx={groupId:'default',from:'2026-11-14',to:'2026-11-14',legacy:true};
 const token=(await saveMenuContext(ctx,[{kind:'button',buttonId:b.id,fingerprint:buttonFingerprint(b)}]))[0];
 let options:any;
 await handleTelegramCallback(query(token),async()=>{},{registry:async()=>registry,store:memoryStore(),prepare:async(_date,_id,opt)=>{options=opt;return {report,text:'Legacy'};},send:async()=>1});
 assert.equal(options.from,undefined);
});
test('custom date guidance can be executed with a digit-leading group ID',async t=>{
 await menuFixture(t);const registry=await getRegistry(),id='12345678-abcd-4321-abcd-123456789abc';registry.groups[0].id=id;
 const b=defaultMenu().buttons.find(b=>b.action==='dates')!;
 const token=(await saveMenuContext({...context,groupId:id},[{kind:'custom-date',buttonId:b.id,fingerprint:buttonFingerprint(b)}]))[0];
 let text='';await handleTelegramCallback(query(token),async()=>{},{registry:async()=>registry,store:memoryStore(),send:async(value)=>{text=value;return 1;}});
 const command=text.split('\n').find(line=>line.startsWith('/'))!.replaceAll('DD/MM/YYYY','14/11/2026');
 const {resolveRequest}=await import('../agent/lib/request-config.ts');
 const parsed=resolveRequest(registry.requests,command);assert.equal(parsed?.group,id);assert.equal(parsed?.date,'2026-11-14');
});
