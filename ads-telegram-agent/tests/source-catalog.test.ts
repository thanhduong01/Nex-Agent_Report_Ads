import test from 'node:test';import assert from 'node:assert/strict';
import {sourceFields} from '../agent/lib/source-catalog.ts';
import {validateReportDefinition,createConfiguredReport,renderConfiguredReport} from '../agent/lib/report-service.ts';
import {normalizeOrder} from '../agent/lib/pancake/normalize.ts';import {analyzeSales} from '../agent/lib/pancake/analytics.ts';import {salesPolicySchema} from '../agent/lib/pancake/types.ts';
test('catalog exposes distinct Meta and POS operands and formula arithmetic remains numeric',()=>{
 assert.equal(new Set(sourceFields.map(f=>f.id)).size,sourceFields.length);assert(sourceFields.length>70);
 const registry={version:1 as const,revision:1,groups:[],requests:[],metrics:[{id:'contribution',name:'Lãi',formula:'pos_doanh_thu - chi_phi - POS_SHIPPING_FEE',unit:'currency' as const,decimals:0,scope:'both' as const}]};
 assert.doesNotThrow(()=>validateReportDefinition({source:'sheets',metrics:['contribution','API_META_REACH','API_POS_COD']},registry));
});
test('POS code label changes only display; raw status4 remains returning and cannot become confirmed revenue',()=>{
 const fact=normalizeOrder({id:1,shop_id:20,status:4,inserted_at:'2026-11-14T01:00:00',updated_at:'2026-11-14T02:00:00',order_currency:'VND100',cash:10000,shipping_fee:20000,items:[]},20,'VND100');
 assert.equal(fact.amounts?.pos_cash,100);assert.equal(fact.amounts?.pos_shipping_fee,200);
 const report=analyzeSales([fact],[],[],salesPolicySchema.parse({}),{from:'2026-11-14',to:'2026-11-14'},
 {syncedAt:'2026-11-14T03:00:00Z',importFrom:'2026-11-06T00:00:00Z',completeThrough:'2026-11-14T03:00:00Z',currency:'VND',timeZone:'Asia/Ho_Chi_Minh'},new Date('2026-11-14T03:00:00Z'));
 assert.equal(report.totals.orders,0);assert.equal(report.metrics?.pos_status_4,1);assert.equal(report.metrics?.pos_cash,100);
});
test('POS row fields only include exactly joined campaign orders; shop-level counts retain unmatched orders',()=>{
 const make=(id:number,adId:string,status:number,cash:number)=>normalizeOrder({id,shop_id:20,status,ad_id:adId,inserted_at:'2026-11-14T01:00:00',updated_at:'2026-11-14T02:00:00',cash,items:[]},20,'VND');
 const report=analyzeSales([make(1,'a',4,100),make(2,'b',1,200),make(3,'missing',1,400)],
 [{id:'a',name:'Ad A',accountId:'act_1',adsetId:'s',campaignId:'1',campaignName:'A'},{id:'b',name:'Ad B',accountId:'act_1',adsetId:'s',campaignId:'2',campaignName:'B'}],
 [{id:'1',name:'A',cost:10,messages:1},{id:'2',name:'B',cost:20,messages:2}],salesPolicySchema.parse({}),{from:'2026-11-14',to:'2026-11-14'},
 {syncedAt:'2026-11-14T03:00:00Z',importFrom:'2026-11-06T00:00:00Z',completeThrough:'2026-11-14T03:00:00Z',currency:'VND',timeZone:'Asia/Ho_Chi_Minh'},new Date('2026-11-14T03:00:00Z'));
 assert.equal(report.metrics?.pos_cash,700);assert.equal(report.campaigns[0].metrics?.pos_cash,100);assert.equal(report.campaigns[1].metrics?.pos_cash,200);assert.equal(report.campaigns[0].metrics?.pos_status_4,1);assert.equal(report.campaigns[1].metrics?.pos_status_4,0);
});
