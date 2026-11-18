import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {defaultMenu} from '../agent/lib/telegram-menu-config.ts';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
async function ui(){
 const code=await readFile(new URL('../public/telegram-menu.js',import.meta.url),'utf8');
 const {window,document}=parseHTML(html),calls:any[]=[];
 const data={revision:7,canEditGroups:true,telegramMenu:defaultMenu(),requests:[{id:'today',name:'Today',enabled:true,groupMode:'all',groupIds:[],allowDate:true}],groups:[{id:'default',name:'POS group',report:{source:'pancake'}}]};
 const el=(name:string,text?:string,cls?:string)=>{const n=document.createElement(name);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const scope=vm.createContext({document,window,crypto:{randomUUID:()=>crypto.randomUUID()},URL,console,structuredClone,JSON,Set,state:data,$:(id:string)=>document.getElementById(id),el,confirm:()=>true,
 feedback:(id:string,text='')=>{document.getElementById(id)!.textContent=text;},api:async(path:string,body:any)=>{calls.push({path,body});return path==='state'?{...data,revision:8,telegramMenu:calls.find(c=>c.path==='telegram-menu')?.body.menu||data.telegramMenu}:{saved:true,revision:8};},updateState:(d:any)=>{scope.state=d;scope.data=d;vm.runInContext('setupTelegramMenu(data)',scope);}});
 scope.data=data;vm.runInContext(code,scope);vm.runInContext('setupTelegramMenu(data)',scope);
 return {document,scope,calls,data,run:(s:string)=>vm.runInContext(s,scope)};
}
test('menu editor independently adds, reorders, removes and saves without touching requests',async()=>{
 const u=await ui();u.run("document.getElementById('menuTab').onclick()");
 assert.equal(u.document.getElementById('telegramMenuPanel')!.hidden,false);
 assert.equal(u.document.getElementById('requestCommandsPanel')!.hidden,true);
 u.run("document.getElementById('menuAdd').onclick()");
 assert.equal(u.document.querySelectorAll('.menuButtonCard').length,10);
 const labels=u.document.querySelectorAll<HTMLInputElement>('[data-menu-field="label"]');labels[9].value='🧪 <img src=x onerror=alert(1)>';
 labels[9].dispatchEvent(new u.document.defaultView!.Event('input',{bubbles:true}));
 assert.equal(u.document.querySelectorAll('#menuKeyboardPreview img').length,0);
 assert.match(u.document.getElementById('menuKeyboardPreview')!.textContent!,/<img/);
 u.document.querySelector<HTMLButtonElement>('[data-menu-up="9"]')!.click();
 assert.match(u.document.querySelectorAll<HTMLInputElement>('[data-menu-field="label"]')[8].value,/<img/);
 u.document.querySelector<HTMLButtonElement>('[data-menu-remove="8"]')!.click();
 assert.equal(u.document.querySelectorAll('.menuButtonCard').length,9);
 await u.run("document.getElementById('telegramMenuForm').onsubmit({preventDefault(){}})");
 assert.equal(u.calls[0].path,'telegram-menu');assert.equal(u.calls[0].body.revision,7);assert.equal('requests' in u.calls[0].body,false);
});
test('background state refresh keeps dirty menu and preview widths/labels remain bounded',async()=>{
 const u=await ui();const first=u.document.querySelector<HTMLInputElement>('[data-menu-field="label"]')!;
 first.value='Đã chỉnh riêng';first.dispatchEvent(new u.document.defaultView!.Event('input',{bubbles:true}));
 u.scope.data={...u.data,revision:8,telegramMenu:{...defaultMenu(),enabled:false}};u.run('setupTelegramMenu(data)');
 assert.equal(u.document.querySelector<HTMLInputElement>('[data-menu-field="label"]')!.value,'Đã chỉnh riêng');
 assert.equal(u.document.getElementById('menuDirty')!.textContent,'Chưa lưu');
 u.scope.data={...u.data,canEditGroups:false};u.run('setupTelegramMenu(data)');assert.equal(u.document.getElementById('menuSave')!.hasAttribute('disabled'),true);
 const css=await readFile(new URL('../public/sales.css',import.meta.url),'utf8');
 assert.match(css,/\.menuWorkspace[\s\S]*minmax\(0,1fr\)/);assert.match(css,/\.menuKeyboardRow[\s\S]*min-width:0/);
});
test('menu script bootstraps in actual deferred order before app.js defines helpers',async()=>{
 const code=await readFile(new URL('../public/telegram-menu.js',import.meta.url),'utf8');
 const {document,window}=parseHTML(html);
 assert.doesNotThrow(()=>vm.runInContext(code,vm.createContext({document,window})));
 assert.equal(typeof document.getElementById('menuTab')!.onclick,'function');
});
test('older state responses cannot replace a successfully saved menu',async()=>{
 const u=await ui();const first=u.document.querySelector<HTMLInputElement>('[data-menu-field="label"]')!;
 first.value='Saved at revision 8';first.dispatchEvent(new u.document.defaultView!.Event('input',{bubbles:true}));
 await u.run("document.getElementById('telegramMenuForm').onsubmit({preventDefault(){}})");
 u.scope.data={...u.data,revision:7};u.run('setupTelegramMenu(data)');
 assert.equal(u.document.querySelector<HTMLInputElement>('[data-menu-field="label"]')!.value,'Saved at revision 8');
});
test('intentional reload locks editing and controls until the response is applied',async()=>{
 const u=await ui();let finish!:(data:any)=>void;
 u.scope.api=()=>new Promise(resolve=>{finish=resolve;});
 const pending=u.run("document.getElementById('menuReload').onclick()");
 assert(u.document.getElementById('menuFields')!.hasAttribute('disabled'));
 assert(u.document.getElementById('menuReload')!.hasAttribute('disabled'));
 finish({...u.data,revision:8});await pending;
 assert(!u.document.getElementById('menuFields')!.hasAttribute('disabled'));
 assert(!u.document.getElementById('menuReload')!.hasAttribute('disabled'));
});
