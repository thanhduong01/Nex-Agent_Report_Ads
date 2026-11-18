import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import {parseHTML} from 'linkedom';
import {baseVariables} from '../agent/lib/formulas.ts';import {defaultMetrics,reportDefinitionSchema} from '../agent/lib/report-definition.ts';import {botcakeAliases,botcakeTextVariables} from '../agent/lib/botcake/catalog.ts';
async function fixture(){
 const {document,window}=parseHTML(await readFile(new URL('../public/index.html',import.meta.url),'utf8'));
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const o of this.querySelectorAll('option')){if(o.value===value)o.setAttribute('selected','');else o.removeAttribute('selected');}}});
 const $=(id:string):any=>document.getElementById(id);for(const id of ['tplBody','metricFormula']){$(id).setSelectionRange=()=>{};$(id).selectionStart=0;$(id).selectionEnd=0;}
 const conn={id:'bc-one',name:'Page one',pageId:'11',revision:1,fields:[{id:4,name:'Phone field'}],fieldIds:[4],source:'both',hasToken:true};
 const data={canEditGroups:true,databaseConfigured:true,revision:0,botcakeConnections:[conn],botcakeAliases,botcakeTextVariables,metaConnections:[{id:'meta',name:'Meta',accounts:[{id:'act_1',name:'Account'}]}],metrics:[],parameters:{},baseVariables,metricDefinitions:defaultMetrics,groups:[{id:'old',name:'Old report',sources:{},report:reportDefinitionSchema.parse({source:'meta',connectionId:'meta',accountId:'act_1',campaignIds:['20'],metrics:['cost','API_META_REACH'],comparison:'none',botcake:{pageIds:['11']}})}]};
 const calls:any[]=[];let handler=async()=>({});const context=vm.createContext({document,$,state:data,console,location:{hash:'#sources'},window:{addEventListener(){}},Event:window.Event,crypto:{randomUUID:()=> 'new-test'},confirm:()=>true,
 Option:function(text:string,value:string){const o=document.createElement('option');o.textContent=text;o.value=value;return o;},el:(tag:string,text?:string,cls?:string)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;},feedback:(id:string,text='')=>{$(id).textContent=text;},api:async(path:string,body:any)=>{calls.push({path,body});return handler();},updateState:(next:any)=>{context.state=next;run('setupBotcake(state);setupBuilder(state)');}});
 const run=(s:string)=>vm.runInContext(s,context);
 for(const file of ['botcake.js','sales.js','report-builder.js'])run(await readFile(new URL('../public/'+file,import.meta.url),'utf8'));run('setupBotcake(state);setupBuilder(state)');
 return {$,run,data,calls,handle:(fn:any)=>{handler=fn;}};
}
test('Botcake template selects Pages, preserves old metrics across sources and inserts named placeholders at caret',async()=>{
 const {$,run}=await fixture();assert.equal($('tplBotcakeEnabled').checked,true);assert.equal(run('templateDraft().botcake.pageIds[0]'),'11');assert(run('builderMetricOrder.includes("API_META_REACH")'));
 $('tplSource').value='pancake';$('tplSource').onchange();$('tplSource').value='meta';$('tplSource').onchange();assert(run('builderMetricOrder.includes("API_META_REACH")'));
 $('tplMetricSelect').value='API_BOTCAKE_SDT_MOI';$('tplAddMetric').onclick();assert(run('builderMetricOrder.includes("API_BOTCAKE_SDT_MOI")'));
 $('tplBody').value='A B';$('tplBody').selectionStart=2;$('tplBody').selectionEnd=2;$('tplPlaceholderSelect').value='BOTCAKE_SDT_MOI';$('tplInsertPlaceholder').onclick();assert.equal($('tplBody').value,'A {{BOTCAKE_SDT_MOI}}B');
 $('tplSource').value='sheets';$('tplSource').onchange();assert.equal($('tplBotcakeFields').hidden,true);assert.equal(run('templateDraft().botcake'),undefined);
});
test('Botcake connection refresh preserves dirty form, CAS revision and token never returns in UI DTO',async()=>{
 const {$,run,calls,handle,data}=await fixture();$('bcSaved').value='bc-one';$('bcSaved').onchange();assert.equal($('bcPageId').readOnly,true);assert.equal($('bcToken').value,'');
 $('bcName').value='Edited';$('bcForm').oninput();run('setupBotcake(state)');assert.equal($('bcName').value,'Edited');
 handle(async()=>{throw Error('Stale connection revision');});await $('bcForm').onsubmit({preventDefault(){}});assert.match($('bcFeedback').textContent,/Stale/);assert.equal($('bcName').value,'Edited');assert.equal(calls.at(-1).body.revision,1);
 handle(async()=>({connection:{...data.botcakeConnections[0],revision:2},connections:[{...data.botcakeConnections[0],name:'Edited',revision:2}]}));await $('bcForm').onsubmit({preventDefault(){}});assert.equal($('bcToken').value,'');assert.equal(run('bcRevision'),2);assert.equal($('bcConnectionFields').disabled,false);
});
test('Botcake stale field responses cannot overwrite another Page and missing dates remain visible',async()=>{
 const {$,run,handle}=await fixture();$('bcSource').value='custom';$('bcSource').onchange();$('bcPageId').value='11';let resolve:any;handle(()=>new Promise(r=>resolve=r));const request=$('bcLoadFields').onclick();$('bcPageId').value='22';$('bcPageId').oninput();resolve({fields:[{id:99,name:'Wrong Page field'}]});await request;assert.equal(run('bcFields.length'),0);
 run('renderBotcakeStatus({startedAt:null,syncedAt:null,pendingCount:3,baselineCount:10,newCount:0,customerCount:20,job:{state:"queued",stage:1}})');assert.match($('bcSyncStatus').textContent,/khởi tạo/);assert.match($('bcSyncStatus').textContent,/Thiếu ngày/);
});
test('Botcake readiness button checks storage without selecting a Page or clearing a connection draft',async()=>{
 const {$,calls,handle}=await fixture();$('bcName').value='Draft';$('bcForm').oninput();handle(async()=>({ready:false,message:'Database chưa sẵn sàng'}));await $('bcDatabaseCheck').onclick();assert.equal(calls.at(-1).body.action,'health');assert.match($('bcDatabaseFeedback').textContent,/chưa sẵn sàng/);assert.equal($('bcDatabaseCheck').disabled,false);assert.equal($('bcName').value,'Draft');
});
