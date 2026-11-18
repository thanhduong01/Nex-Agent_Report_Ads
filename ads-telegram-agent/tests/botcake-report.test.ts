import test from 'node:test';import assert from 'node:assert/strict';
import {vietnamDay} from '../agent/lib/botcake/phones.ts';
import {buildBotcakeSummary} from '../agent/lib/botcake/report.ts';
import {evaluateMetrics,validateMetrics} from '../agent/lib/formulas.ts';
import {defaultMetrics,reportDefinitionSchema} from '../agent/lib/report-definition.ts';
import {renderConfiguredReport,createConfiguredReport} from '../agent/lib/report-service.ts';
const now=new Date().toISOString(),day=vietnamDay(now);
const scope={pageId:'11',startedAt:now,syncedAt:now,sourceKey:'key',lastError:null,pendingCount:0};
const meta={currency:'VND',timeZone:'Asia/Ho_Chi_Minh',rows:[{id:'20',name:'Camp A',cost:600,messages:12,metrics:{}}],sourceUrl:'https://facebook.com',summaryMetrics:{}};
const inputs={range:{from:day,to:day},pages:[{pageId:'11',name:'Page A',status:scope,total:8,pending:0}],rows:[{pageId:'11',day,adId:'30'},{pageId:'11',day,adId:null},{pageId:'11',day,adId:'outside'}],ads:[{id:'30',campaignId:'20'}],meta};
test('Botcake report matches only exact selected ad identity and separates Page totals from campaign metrics',()=>{
 const s=buildBotcakeSummary(inputs);assert.equal(s.metrics.BOTCAKE_SDT_MOI,3);assert.equal(s.metrics.BOTCAKE_SDT_KHOP_CAMP,1);assert.equal(s.metrics.BOTCAKE_SDT_CHUA_GAN,2);assert.equal(s.metrics.BOTCAKE_CP_SDT_MOI,600);assert.equal(s.metrics.BOTCAKE_TONG_SDT,8);assert.equal(s.campaigns[0].phones,1);
 validateMetrics(defaultMetrics);const r=evaluateMetrics([...defaultMetrics,{id:'qa_bc',formula:'chi_phi / BOTCAKE_SDT_KHOP_CAMP + 10 - 2 * 3'}],{...s.metrics,chi_phi:600});assert.equal(r.qa_bc.value,604);
});
test('Botcake incomplete, stale and historical pre-baseline reports never emit false zero or safe CPA',()=>{
 for(const change of [{pending:1},{status:{...scope,syncedAt:null}},{status:{...scope,sourceKey:null}},{status:{...scope,syncedAt:'2000-01-01T00:00:00Z'}}]){
  const s=buildBotcakeSummary({...inputs,pages:[{...inputs.pages[0],...change}]});assert.equal(s.metrics.BOTCAKE_SDT_MOI,null);assert.equal(s.metrics.BOTCAKE_CP_SDT_MOI,null);
 }
 const s=buildBotcakeSummary({...inputs,range:{from:'2000-01-01',to:day}});assert.equal(s.complete,false);assert.equal(s.metrics.BOTCAKE_SDT_MOI,null);
});
test('Botcake attachment leaves legacy Meta output intact and renders selected numeric/text placeholders',async()=>{
 const report=reportDefinitionSchema.parse({source:'meta',connectionId:'meta-one',accountId:'act_1',campaignIds:['20'],metrics:['cost'],comparison:'none'});
 const group={id:'qa',name:'QA',sources:{},report},registry={version:1,revision:0,groups:[group],parameters:{},metrics:[],requests:[]};
 const legacy=await createConfiguredReport(group as any,registry as any,{from:day,to:day},{meta:async()=>meta as any});assert.equal(legacy.botcake,undefined);assert.equal(legacy.metricValues![0].value,600);
 const bc=buildBotcakeSummary(inputs),definition={...report,botcake:{pageIds:['11']},metrics:['cost','API_BOTCAKE_SDT_MOI'],body:'{{BOTCAKE_TEN_PAGE}}: {{BOTCAKE_SDT_MOI}} · {{BOTCAKE_TRANG_THAI}}'};
 const result=await createConfiguredReport({...group,report:definition} as any,registry as any,{from:day,to:day},{meta:async()=>meta as any,botcake:async()=>bc});
 assert.equal(result.metricValues![0].value,600);assert.equal(result.metricValues![1].value,3);assert.match(renderConfiguredReport(result,definition),/Page A: 3/);
 const failed=await createConfiguredReport({...group,report:definition} as any,registry as any,{from:day,to:day},{meta:async()=>meta as any,botcake:async()=>{throw new Error('secret upstream');}});assert.equal(failed.metricValues![0].value,600);assert.equal(failed.metricValues![1].value,null);assert(!renderConfiguredReport(failed,definition).includes('secret upstream'));
});
test('Botcake counts a selected campaign even when Meta returns no insight row, with CPA unavailable',()=>{
 const s=buildBotcakeSummary({...inputs,meta:{...meta,rows:[]},selectedCampaignIds:['20']});assert.equal(s.metrics.BOTCAKE_SDT_KHOP_CAMP,1);assert.equal(s.metrics.BOTCAKE_CP_SDT_MOI,null);assert.equal(s.campaigns[0].phones,1);assert.equal(s.campaigns[0].cost,null);
});
