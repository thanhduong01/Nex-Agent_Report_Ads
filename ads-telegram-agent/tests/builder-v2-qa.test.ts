import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {getRegistry,updateRegistry} from '../agent/lib/groups.ts';
import {reportManagement} from '../agent/lib/report-management.ts';
import {metaAction,readMetaInsights} from '../agent/lib/meta.ts';
import {calculateFormula,evaluateMetrics,requiredInputVariables,baseVariables} from '../agent/lib/formulas.ts';
import {defaultMetrics,reportDefinitionSchema} from '../agent/lib/report-definition.ts';
import {createConfiguredReport,formatMetric,renderConfiguredReport} from '../agent/lib/report-service.ts';
import {normalizeOrder} from '../agent/lib/pancake/normalize.ts';
import {analyzeSales} from '../agent/lib/pancake/analytics.ts';
import {salesPolicySchema} from '../agent/lib/pancake/types.ts';

const range={from:'2026-11-14',to:'2026-11-14'};
async function localConfig(t:test.TestContext){
  const directory=await mkdtemp(join(tmpdir(),'builder-v2-qa-'));
  const keys=['REPORT_CONFIG_PATH','PRIVATE_CONFIG_DIR','VERCEL','BLOB_READ_WRITE_TOKEN','BLOB_STORE_ID','REPORT_SOURCES_JSON'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];
  process.env.REPORT_CONFIG_PATH=join(directory,'groups.json');process.env.PRIVATE_CONFIG_DIR=directory;process.env.REPORT_SOURCES_JSON='{}';
  t.after(async()=>{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}await rm(directory,{recursive:true,force:true});});
}

test('QA: independent creates and concurrent CAS preserve existing report and schedule',async t=>{
  await localConfig(t);
  const definition=reportDefinitionSchema.parse({source:'sheets',metrics:['cost','messages'],comparison:'none'});
  const seeded=await updateRegistry(0,registry=>{
    registry.groups[0].report=definition;
    registry.groups[0].schedule={enabled:true,time:'11:40',days:[1,3,5],reportDay:'yesterday',startAt:'2026-11-01T00:00:00Z'};
  });
  const original=structuredClone(seeded.groups[0]);
  const first=await reportManagement('/api/report-definition',{create:true,groupId:'qa-first',name:'QA first',revision:1,definition});
  const second=await reportManagement('/api/report-definition',{create:true,groupId:'qa-second',name:'QA second',revision:first.revision,definition});
  const saved=await getRegistry();
  assert.deepEqual(saved.groups[0],original);
  assert.deepEqual(saved.groups.map(group=>group.id),['default','qa-first','qa-second']);
  assert(saved.groups.slice(1).every(group=>!group.enabled&&!group.schedule?.enabled));
  await assert.rejects(reportManagement('/api/report-definition',{create:true,groupId:'qa-third',name:'Stale create',revision:1,definition}),error=>(error as any).status===409);
  await assert.rejects(reportManagement('/api/report-definition',{create:true,groupId:'qa-first',name:'Overwrite',revision:second.revision,definition}),error=>(error as any).status===409);
  const raced=await Promise.allSettled(['one','two'].map(suffix=>reportManagement('/api/report-definition',{create:true,groupId:'qa-race-'+suffix,name:'QA race '+suffix,revision:saved.revision,definition})));
  assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(raced.filter(result=>result.status==='rejected'&&(result.reason as any).status===409).length,1);
  assert.deepEqual((await getRegistry()).groups[0],original);
});

test('QA: saved custom metric IDs accepted before the source catalog still load after upgrade',async t=>{
  await localConfig(t);
  const legacy={version:1,revision:8,groups:[{id:'old',name:'Previously saved',enabled:false,sources:{},report:{source:'meta',connectionId:'meta',accountId:'act_1',campaignIds:['10'],metrics:['pos_cash','src_meta_reach','trang_thai_don_hang'],constants:{pos_shipping_fee:2},comparison:'none',body:'{{pos_cash}} | {{src_meta_reach}} | {{trang_thai_don_hang}}'}}],requests:[],parameters:{meta_reach:3},
    metrics:[{id:'pos_cash',name:'Legacy custom cash',formula:'chi_phi / 2 - pos_shipping_fee',unit:'currency',decimals:0,scope:'both'},
      {id:'src_meta_reach',name:'Legacy custom reach',formula:'pos_cash + meta_reach',unit:'number',decimals:0,scope:'both'},
      {id:'trang_thai_don_hang',name:'Legacy custom status',formula:'src_meta_reach + 1',unit:'number',decimals:0,scope:'both'}]};
  await writeFile(process.env.REPORT_CONFIG_PATH!,JSON.stringify(legacy));
  const registry=await getRegistry();
  assert.equal(registry.groups[0].name,'Previously saved');
  assert.equal(registry.metrics?.[0].formula,'chi_phi / 2 - pos_shipping_fee');
  const group={...registry.groups[0],report:{...registry.groups[0].report!,metrics:[...registry.groups[0].report!.metrics,'API_META_REACH']}};
  const report=await createConfiguredReport(group,registry,range,{meta:async()=>({rows:[{id:'10',name:'QA',cost:200,messages:1,metrics:{meta_reach:100}}],summaryMetrics:{meta_reach:500},currency:'VND',timeZone:'Asia/Ho_Chi_Minh',sourceUrl:'https://example.invalid/meta'})});
  assert.deepEqual(report.metricValues?.map(metric=>[metric.id,metric.value]),[['pos_cash',98],['src_meta_reach',101],['trang_thai_don_hang',102],['API_META_REACH',500]]);
  assert.match(renderConfiguredReport(report,group.report),/98 VND \| 101 \| 102/);
  assert.deepEqual(JSON.parse(await readFile(process.env.REPORT_CONFIG_PATH!,'utf8')),legacy);
});

test('QA: old global and template constants retain meaning beside uppercase source variables',async()=>{
  const definition=reportDefinitionSchema.parse({source:'meta',connectionId:'meta',accountId:'act_1',campaignIds:['10'],metrics:['legacy_constants','API_META_REACH'],constants:{pos_shipping_fee:2},comparison:'none'});
  const group={id:'qa-constants',name:'QA constants',enabled:false,sources:{},report:definition};
  const registry={version:1 as const,revision:0,groups:[group],requests:[],parameters:{pos_cash:7,meta_reach:3},metrics:[{id:'legacy_constants',name:'Legacy constants',formula:'pos_cash + meta_reach + pos_shipping_fee',unit:'number' as const,decimals:0,scope:'both' as const}]};
  const report=await createConfiguredReport(group,registry,range,{meta:async()=>({rows:[{id:'10',name:'QA',cost:200,messages:1,metrics:{meta_reach:100}}],summaryMetrics:{meta_reach:500},currency:'VND',timeZone:'Asia/Ho_Chi_Minh',sourceUrl:'https://example.invalid/meta'})});
  assert.equal(report.metricValues?.find(metric=>metric.id==='legacy_constants')?.value,12);
  assert.equal(report.metricValues?.find(metric=>metric.id==='API_META_REACH')?.value,500);
});

test('QA: template status mappings and numeric value mappings survive a private registry reload',async t=>{
  await localConfig(t);
  const metric={id:'order_code',name:'Order code',formula:'4',unit:'number',decimals:0,scope:'both',valueMap:{'0':'Chưa có','4':'Thành công'}};
  await reportManagement('/api/metric',{revision:0,metric,parameters:{}});
  const revision=(await getRegistry()).revision;
  await reportManagement('/api/report-definition',{revision,groupId:'mapped-template',create:true,name:'Mapped template',definition:{source:'sheets',metrics:['order_code'],comparison:'none',statusLabels:{'0':'Chưa có','4':'Thành công'}}});
  const saved=await getRegistry();
  assert.deepEqual(saved.metrics?.find(item=>item.id==='order_code')?.valueMap,metric.valueMap);
  assert.deepEqual(saved.groups.find(group=>group.id==='mapped-template')?.report?.statusLabels,{'0':'Chưa có','4':'Thành công'});
  assert.equal(evaluateMetrics(saved.metrics||[],{}).order_code.value,4);
});

test('QA: transitive formula operands request only needed source fields and labels retain numeric values',()=>{
  const custom=[
    {id:'reach_cost',formula:'chi_phi / API_META_REACH'},
    {id:'net_formula',formula:'(pos_doanh_thu - chi_phi - POS_SHIPPING_FEE) * 2 + reach_cost'},
  ];
  assert.deepEqual(new Set(requiredInputVariables([...defaultMetrics,...custom],['net_formula'])),new Set(['pos_doanh_thu','chi_phi','POS_SHIPPING_FEE','META_REACH']));
  const result=evaluateMetrics([...defaultMetrics,...custom],{pos_doanh_thu:100,chi_phi:20,POS_SHIPPING_FEE:5,META_REACH:10});
  assert.equal(result.net_formula.value,152);
  assert.equal(calculateFormula('(100 - 20) * 2 / 4 + 1',{}).value,41);
  assert.equal(calculateFormula('pos_cash + 1',{pos_cash:null}).value,null);
  assert.equal(calculateFormula('pos_cash + 1',{pos_cash:0}).value,1);
  assert.equal(calculateFormula('1 / pos_cash',{pos_cash:0}).value,null);
  assert.throws(()=>calculateFormula('globalThis.process.exit()',{}));
  const metric={id:'mapped',name:'Mapped',formula:'4',unit:'number' as const,scope:'both' as const,decimals:0,value:0,valueMap:{'0':'Chưa có','4':'Thành công'}};
  assert.equal(formatMetric(metric),'Chưa có');assert.equal(formatMetric({...metric,value:4}),'Thành công');
  assert.equal(evaluateMetrics([{id:'mapped',formula:'4'},{id:'next',formula:'mapped + 1'}],{}).next.value,5);
});

test('QA: configured Meta totals use filtered account summary through custom dependencies',async()=>{
  const definition=reportDefinitionSchema.parse({source:'meta',connectionId:'meta',accountId:'act_1',campaignIds:['10','20'],metrics:['API_META_REACH','API_META_CPC','cost_reach'],comparison:'none'});
  const group={id:'qa-meta',name:'QA Meta',enabled:false,sources:{},report:definition};
  const registry={version:1 as const,revision:0,groups:[group],requests:[],metrics:[{id:'cost_reach',name:'Cost/reach',formula:'chi_phi / API_META_REACH',unit:'number' as const,decimals:2,scope:'both' as const}]};
  let variables:string[]=[];
  const report=await createConfiguredReport(group,registry,range,{meta:async(scope)=>{
    variables=scope.variables||[];assert.deepEqual(scope.campaignIds,['10','20']);
    return {rows:[{id:'10',name:'One',cost:100,messages:10,metrics:{meta_reach:100,meta_cpc:2}},{id:'20',name:'Two',cost:200,messages:20,metrics:{meta_reach:100,meta_cpc:5}}],summaryMetrics:{meta_reach:150,meta_cpc:3.5},currency:'VND',timeZone:'Asia/Ho_Chi_Minh',sourceUrl:'https://example.invalid/meta'};
  }});
  assert(variables.includes('META_REACH'));assert(variables.includes('META_CPC'));assert(!variables.includes('META_FREQUENCY'));
  assert.equal(report.metricValues?.find(metric=>metric.id==='API_META_REACH')?.value,150);
  assert.equal(report.metricValues?.find(metric=>metric.id==='API_META_CPC')?.value,3.5);
  assert.equal(report.metricValues?.find(metric=>metric.id==='cost_reach')?.value,2);
  assert.deepEqual(report.rowMetricValues?.map(row=>row.metrics.find(metric=>metric.id==='API_META_REACH')?.value),[100,100]);
});

test('QA: absent Meta average-video-time remains unavailable instead of a fabricated zero',async t=>{
  await localConfig(t);const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/me/adaccounts'))return Response.json({data:[{id:'act_1',name:'QA',currency:'VND',timezone_name:'Asia/Ho_Chi_Minh'}]});
    if(url.pathname.endsWith('/campaigns'))return Response.json({data:[{id:'10',name:'QA'}]});
    return Response.json({data:[url.searchParams.get('level')==='account'?{spend:'10'}:{campaign_id:'10',campaign_name:'QA',spend:'10'}]});
  };
  await metaAction({id:'qa-meta',name:'QA Meta',token:'synthetic_qa_token_123456789012345'});
  const result=await readMetaInsights({connectionId:'qa-meta',accountId:'act_1',campaignIds:['10'],messageAction:'lead',variables:['META_VIDEO_AVG_TIME']},range);
  assert.equal(result.rows[0].metrics.meta_video_avg_time,null);
  assert.equal(result.summaryMetrics?.meta_video_avg_time,null);
});

const rawOrder=(id:number,status:number,currency='VND100')=>({id,shop_id:20,status,inserted_at:'2026-11-14T01:00:00',updated_at:'2026-11-14T02:00:00',order_currency:currency,
  cash:10000,cod:0,shipping_fee:20000,advanced_platform_fee:{payment_fee:300},bill_phone_number:'private-phone',bill_full_name:'private-customer',items:[{product_id:'product',variation_id:'variation',quantity:1,variation_info:{name:'QA product',retail_price:100000}}]});

test('QA: POS money fields preserve units, zero, missing values and exclude contact data',()=>{
  const vnd=normalizeOrder(rawOrder(1,1),20,'VND100'),usd=normalizeOrder(rawOrder(2,1,'USD'),20,'USD');
  for(const fact of [vnd,usd]){
    assert.equal(fact.amounts?.pos_cash,100);assert.equal(fact.amounts?.pos_cod,0);assert.equal(fact.amounts?.pos_shipping_fee,200);assert.equal(fact.amounts?.pos_payment_fee,3);
    assert.equal(fact.amounts?.pos_charged_by_card,null);assert.equal(fact.lines[0].price,1000);
    assert(!JSON.stringify(fact).includes('private-'));
  }
  assert.equal(vnd.currency,'VND');assert.equal(usd.currency,'USD');
  const unknown=normalizeOrder({...rawOrder(3,1),cash:'10000',shipping_fee:Infinity},20,'VND100');
  assert.equal(unknown.amounts?.pos_cash,null);assert.equal(unknown.amounts?.pos_shipping_fee,null);
});

test('QA: custom status labels including code0 do not turn returned orders into confirmed revenue',async()=>{
  const orders=[0,4,1,6].map((status,index)=>normalizeOrder(rawOrder(index+1,status),20,'VND100'));
  const quality={syncedAt:'2026-11-14T03:00:00Z',importFrom:'2026-11-07T00:00:00Z',completeThrough:'2026-11-14T03:00:00Z',currency:'VND',timeZone:'Asia/Ho_Chi_Minh'};
  const sales=analyzeSales(orders,[],[{id:'10',name:'QA',cost:100,messages:10}],salesPolicySchema.parse({}),range,quality,new Date('2026-11-14T03:00:00Z'));
  assert.equal(sales.totals.orders,1);assert.equal(sales.totals.revenue,1000);assert.equal(sales.metrics?.pos_all_orders,4);assert.equal(sales.metrics?.pos_status_0,1);assert.equal(sales.metrics?.pos_status_4,1);
  const definition=reportDefinitionSchema.parse({source:'pancake',connectionId:'meta',accountId:'act_1',campaignIds:['10'],pancakeConnectionId:'pos',shopId:'20',metrics:['pos_orders','pos_revenue','API_POS_STATUS_4'],statusLabels:{'0':'Chưa có','4':'Thành công'},body:'{{TRANG_THAI_DON_HANG}}\n{{chi_so}}',comparison:'none'});
  const group={id:'qa-pos',name:'QA POS',enabled:false,sources:{},report:definition};
  const report=await createConfiguredReport(group,{version:1,revision:0,groups:[group],requests:[]},range,{meta:async()=>({rows:[{id:'10',name:'QA',cost:100,messages:10,metrics:{}}],currency:'VND',timeZone:'Asia/Ho_Chi_Minh',sourceUrl:'https://example.invalid/meta'}),pancake:async()=>sales});
  const text=renderConfiguredReport(report,definition);
  assert.match(text,/Chưa có \[0\]: 1/);assert.match(text,/Thành công \[4\]: 1/);
  assert.equal(report.metricValues?.find(metric=>metric.id==='pos_orders')?.value,1);
  assert.equal(report.metricValues?.find(metric=>metric.id==='pos_revenue')?.value,1000);
  assert.match(report.metricValues?.find(metric=>metric.id==='API_POS_STATUS_4')?.name||'',/Thành công/);
});

test('QA: real DOM catalogs preserve Meta picks and insert selected operands/placeholders',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../public/report-builder.js',import.meta.url),'utf8');
  const {document,window}=parseHTML(html);
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option')){if(option.value===value)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
  const $=(id:string):any=>document.getElementById(id)!;
  for(const id of ['tplBody','metricFormula']){$(id).setSelectionRange=()=>{};$(id).selectionStart=0;$(id).selectionEnd=0;}
  const data={canEditGroups:true,revision:3,groups:[{id:'old',name:'Existing',sources:{},report:reportDefinitionSchema.parse({source:'meta',connectionId:'meta',accountId:'act_1',campaignIds:['10'],metrics:['cost','API_META_REACH'],comparison:'none'})}],metrics:[],parameters:{},baseVariables,metricDefinitions:defaultMetrics,metaConnections:[{id:'meta',name:'Meta',accounts:[{id:'act_1',name:'Account',currency:'VND',timezone_name:'Asia/Ho_Chi_Minh'}]}]};
  const context=vm.createContext({document,$,state:data,location:{hash:'#templates'},confirm:()=>true,crypto:{randomUUID:()=> 'fresh-qa'},window:{addEventListener(){}},Event:window.Event,console,
    Option:function(text:string,value:string){const option=document.createElement('option');option.textContent=text;option.value=value;return option;},
    el:(tag:string,text?:string,cls?:string)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(cls)element.className=cls;return element;},feedback:(id:string,text='')=>{$(id).textContent=text;}});
  const run=(source:string)=>vm.runInContext(source,context);
  run(script);run('setupBuilder(state)');
  $('tplSource').value='pancake';$('tplSource').onchange();$('tplSource').value='meta';$('tplSource').onchange();
  assert(run('builderMetricOrder.includes("API_META_REACH")'));
  $('tplMetricSearch').value='COD';$('tplMetricSearch').oninput();
  const options=[...$('tplMetricSelect').querySelectorAll('option')];
  assert(options.some(option=>option.value==='API_POS_COD'));assert(!options.some(option=>option.value==='API_META_FREQUENCY'));
  $('formulaVariableSearch').value='shipping_fee';$('formulaVariableSearch').oninput();$('formulaVariableSelect').value='POS_SHIPPING_FEE';$('formulaInsertVariable').onclick();
  assert.equal($('metricFormula').value,'POS_SHIPPING_FEE');
  assert($('formulaTestValues').querySelector('input[data-variable="POS_SHIPPING_FEE"]'));
  $('tplPlaceholderSelect').value='API_META_REACH';$('tplInsertPlaceholder').onclick();assert.equal($('tplBody').value,'{{API_META_REACH}}');
  $('builderNewGroup').onclick();assert.equal(run('builderGroupId'),'fresh-qa');assert.equal(run('builderCreating'),true);assert.equal($('tplName').value,'');
  assert.equal(data.groups[0].name,'Existing');
});
