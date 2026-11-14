import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeOrder,moneyUnit} from '../agent/lib/pancake/normalize.ts';
import {analyzeSales} from '../agent/lib/pancake/analytics.ts';
import {salesPolicySchema} from '../agent/lib/pancake/types.ts';
const raw=(id=1,extra:Record<string,unknown>={})=>({id,shop_id:20,status:1,inserted_at:'2026-11-14T01:00:00',updated_at:'2026-11-14T02:00:00',order_currency:'VND',ad_id:'123',page_id:'page',total_discount:100,
 bill_phone_number:'secret',bill_full_name:'private',items:[{product_id:'p',variation_id:'v',quantity:3,returned_count:1,variation_info:{name:'Sản phẩm',retail_price:1000}},{product_id:'gift',variation_id:'gift',quantity:1,is_bonus_product:true,variation_info:{name:'Gift',retail_price:0}}],...extra});
const ad={id:'123',campaignId:'c1',campaignName:'Camp',accountId:'act_1',adsetId:'s1',name:'Ad',createdAt:'2026-11-10T00:00:00Z'};
const spend=[{id:'c1',name:'Camp',cost:1000,messages:5},{id:'c2',name:'No orders',cost:500,messages:1}];
const range={from:'2026-11-14',to:'2026-11-14'};
const policy=salesPolicySchema.parse({});
const quality={syncedAt:'2026-11-14T03:00:00Z',importFrom:'2026-11-07T00:00:00Z',completeThrough:'2026-11-14T03:00:00Z',currency:'VND',timeZone:'Asia/Ho_Chi_Minh'};
test('POS facts whitelist PII, retain commercial units and allocate discounts without double-counting returns',()=>{
 const fact=normalizeOrder(raw(),20,'VND');assert.equal(fact.lines[0].quantity,3);assert.equal(fact.lines[0].returned,1);assert(!JSON.stringify(fact).includes('private'));assert(!JSON.stringify(fact).includes('secret'));
 assert.equal(moneyUnit('VND'),1);assert.equal(moneyUnit('VND100'),100);assert.equal(moneyUnit('USD'),100);
 const report=analyzeSales([fact],[ad],spend,policy,range,quality,new Date('2026-11-14T03:00:00Z'));
 assert.equal(report.totals.units,2);assert.equal(report.totals.revenue,1933);assert.equal(report.totals.orders,1);assert.equal(report.products.length,1);
 assert.equal(report.products[0].revenue,report.totals.revenue);assert.equal(report.campaigns.length,2);assert.equal(report.campaigns[1].orders,0);assert.equal(report.campaigns[1].cpa,null);
});
test('matching never guesses from names, ambiguous UTM stays unmatched and currencies cannot be combined',()=>{
 const facts=[normalizeOrder(raw(1),20,'VND'),normalizeOrder(raw(2,{ad_id:null}),20,'VND'),normalizeOrder(raw(3,{p_utm_content:'456'}),20,'VND'),normalizeOrder(raw(4,{order_currency:'USD'}),20,'VND')];
 const report=analyzeSales(facts,[ad,{...ad,id:'456',campaignId:'c2'}],spend,policy,range,quality,new Date('2026-11-14T03:00:00Z'));
 assert.equal(report.totals.orders,3);assert.equal(report.attribution.matchedOrders,1);assert.equal(report.attribution.unmatchedOrders,2);assert.equal(report.excluded.currency,1);
 assert.equal(report.attribution.reasons.ambiguous,1);assert.equal(report.attribution.reasons.missing_id,1);
 assert.equal(report.signals.some(s=>s.kind==='scale'),false);
});
test('status/date and partial coverage never invent zero or success; delivered view remains distinct',()=>{
 const facts=[normalizeOrder(raw(1,{status:6}),20,'VND'),normalizeOrder(raw(2,{status:3}),20,'VND'),normalizeOrder(raw(3,{inserted_at:'2026-11-13T16:59:59'}),20,'VND')];
 assert.equal(analyzeSales(facts,[ad],spend,{...policy,basis:'delivered'},range,quality,new Date('2026-11-14T03:00:00Z')).totals.orders,1);
 const missing=analyzeSales([],[],spend,policy,range,{...quality,completeThrough:null},new Date('2026-11-14T03:00:00Z'));
 assert.equal(missing.complete,false);assert.equal(missing.totals.orders,null);assert.equal(missing.totals.revenue,null);
});
test('gifts never create revenue, item discounts are not subtracted twice, allocation never becomes negative',()=>{
 const fact=normalizeOrder(raw(1,{total_discount:100,items:[{product_id:'p',variation_id:'p',quantity:1,discount_each_product:100,variation_info:{name:'Paid',retail_price:1000}},{product_id:'g',variation_id:'g',quantity:1,is_bonus_product:true,variation_info:{name:'Gift',retail_price:100}}]}),20,'VND');
 const r=analyzeSales([fact],[ad],spend,{...policy,includeGifts:true},range,quality,new Date('2026-11-14T03:00:00Z'));
 assert.equal(r.totals.revenue,900);assert.equal(r.totals.units,2);assert.equal(r.products.find(p=>p.id==='g')?.revenue,0);
 assert.equal(moneyUnit('PHP'),1);assert.equal(moneyUnit('PHP100'),100);assert.equal(moneyUnit('JPY'),1);assert.equal(moneyUnit('KRW'),100);
});
test('a recent job completion does not make an old cutoff fresh; scoped zero-delivery ads still attribute orders',()=>{
 const fact=normalizeOrder(raw(),20,'VND');
 const stale=analyzeSales([fact],[ad],spend,policy,range,{...quality,syncedAt:'2026-11-14T10:00:00Z',completeThrough:'2026-11-14T02:00:00Z'},new Date('2026-11-14T10:00:00Z'));
 assert.equal(stale.quality.stale,true);assert.equal(stale.totals.cpa,null);
 const zero=analyzeSales([fact],[ad],[],policy,range,quality,new Date('2026-11-14T03:00:00Z'));
 assert.equal(zero.attribution.matchedOrders,1);assert.equal(zero.campaigns[0].orders,1);assert.equal(zero.campaigns[0].cost,0);assert.equal(zero.campaigns[0].roas,null);
});
