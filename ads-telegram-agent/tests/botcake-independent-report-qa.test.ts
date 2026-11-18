import test from 'node:test';import assert from 'node:assert/strict';
import {buildBotcakeSummary} from '../agent/lib/botcake/report.ts';
import {validateReportDefinition} from '../agent/lib/report-service.ts';
import {reportDefinitionSchema} from '../agent/lib/report-definition.ts';
import {vietnamDay} from '../agent/lib/botcake/phones.ts';
const now=new Date().toISOString(),today=vietnamDay(now),tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const meta={currency:'VND',timeZone:'Asia/Ho_Chi_Minh',rows:[{id:'20',name:'Camp A',cost:100}]};
test('QA: fresh Botcake sync cannot certify an unobserved future day as a completed zero',()=>{
 const summary=buildBotcakeSummary({range:{from:tomorrow,to:tomorrow},pages:[{pageId:'11',name:'Page one',status:{startedAt:now,syncedAt:now,sourceKey:'key',lastError:null},pending:0,total:1}],rows:[],ads:[],meta});
 assert.equal(summary.complete,false);assert.equal(summary.metrics.BOTCAKE_SDT_MOI,null);
});
test('QA: Botcake text and transitive operands require an attached Page instead of silently rendering blanks',()=>{
 const base={source:'meta',connectionId:'meta',accountId:'act_1',campaignIds:['20'],metrics:['cost'],comparison:'none'};
 const registry={version:1 as const,revision:0,groups:[],requests:[],parameters:{},metrics:[{id:'custom_bc',name:'Phone CPA',formula:'chi_phi / BOTCAKE_SDT_KHOP_CAMP',unit:'number' as const,decimals:0,scope:'both' as const}]};
 assert.throws(()=>validateReportDefinition(reportDefinitionSchema.parse({...base,body:'{{BOTCAKE_TEN_PAGE}}'}),registry),/Botcake/i);
 assert.throws(()=>validateReportDefinition(reportDefinitionSchema.parse({...base,metrics:['custom_bc']}),registry),/Botcake/i);
});
