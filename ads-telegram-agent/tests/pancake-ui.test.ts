import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
import {parseHTML} from 'linkedom';import {defaultMetrics} from '../agent/lib/report-definition.ts';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const sales=await readFile(new URL('../public/sales.js',import.meta.url),'utf8'),builder=await readFile(new URL('../public/report-builder.js',import.meta.url),'utf8');
function harness(handler?:(path:string,body:any)=>Promise<any>){
 const {document,window}=parseHTML(html);
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const o of this.querySelectorAll('option'))o.selected=o.value===value;}});
 const data={canEditGroups:true,revision:1,groups:[{id:'default',name:'Shop',sources:{}}],metrics:[],parameters:{},metricDefinitions:defaultMetrics,metaConnections:[],pancakeConnections:[{id:'pos',name:'Shop test',shops:[{id:'20',name:'Shop',currency:'VND'}]}]};
 const calls:any[]=[],$=(id:string):any=>document.getElementById(id)!;
 const context=vm.createContext({document,window:{addEventListener(){}},$,state:data,location:{hash:'#templates'},confirm:()=>true,crypto:{randomUUID:()=> 'test'},console,Event:window.Event,
  Option:function(text:string,value:string){const o=document.createElement('option');o.textContent=text;o.value=value;return o;},
  el:(tag:string,text?:string,cls?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;},
  feedback:(id:string,text='')=>{$(id).textContent=text;},
  api:async(path:string,body:any)=>{calls.push({path,body});if(handler)return handler(path,body);return {database:{connected:true,message:'Đã kết nối PostgreSQL.'}};}
 });
 vm.runInContext(sales,context);vm.runInContext(builder,context);vm.runInContext('setupSales(state);setupBuilder(state)',context);
 return {$,context,calls,data,run:(code:string)=>vm.runInContext(code,context)};
}
test('real authored DOM exposes POS controls, validates only selected source, and serializes sales policy into guarded template draft',()=>{
 const ui=harness();ui.$('tplSource').value='pancake';ui.run('builderSourceFields()');
 assert.equal(ui.$('tplPosFields').hidden,false);assert.equal((ui.$('tplPosShop') as any).required,true);
 ui.$('tplPosConnection').value='pos';ui.run('fillSalesTemplateShops()');ui.$('tplPosShop').value='20';ui.$('tplPosCpa').value='120000';ui.run('builderCampaignIds=["123"];builderMetricOrder=["pos_orders","pos_cpa"]');
 const draft=JSON.parse(JSON.stringify(ui.run('templateDraft()')));assert.equal(draft.pancakeConnectionId,'pos');assert.equal(draft.shopId,'20');assert.equal(draft.salesPolicy.targetCpa,120000);assert.equal(draft.comparison,'none');
 ui.$('tplSource').value='sheets';ui.run('builderSourceFields()');assert.equal(ui.$('tplPosFields').hidden,true);assert.equal((ui.$('tplPosShop') as any).required,false);
});
test('database check uses the protected app API and shows a safe connectivity result',async()=>{
 const ui=harness();await (ui.$('posDatabaseCheck') as any).onclick();
 assert.deepEqual(ui.calls.map(c=>c.path),['pancake']);assert.equal(ui.calls[0].body.action,'database');assert.match(ui.$('posDatabaseFeedback').textContent,/Đã kết nối/);
});
test('stale sales responses cannot replace an edited date range or enable Telegram preview',async()=>{
 let resolve:any;const ui=harness(async()=>new Promise(r=>resolve=r));ui.$('salesGroup').append(Object.assign(ui.$('tplPosShop').ownerDocument.createElement('option'),{value:'group'}));ui.$('salesGroup').value='group';
 const pending=ui.run('loadSales()');ui.$('salesFrom').value='2026-11-13';(ui.$('salesFilters') as any).oninput();resolve({report:{sales:{complete:true}}});await pending;
 assert.equal((ui.$('salesSendPreview') as any).disabled,true);assert.equal(ui.$('salesContent').children.length,0);
});
