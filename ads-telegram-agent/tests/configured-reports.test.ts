import test from "node:test";
import assert from "node:assert/strict";
import { createConfiguredReport, renderConfiguredReport } from "../agent/lib/report-service.ts";
import { reportDefinitionSchema } from "../agent/lib/report-definition.ts";
import { resolvePeriod } from "../agent/lib/report-period.ts";
import { resolveRequest, defaultRequests } from "../agent/lib/request-config.ts";
import type { Registry, ReportGroup } from "../agent/lib/groups.ts";
import type { Tables } from "../agent/lib/report.ts";

const source={spreadsheetId:"fixture",mappings:[{sheet:"Tour",name:"Tour",startRow:2,dateColumn:0,dateMode:"date" as const,costColumn:1,messagesColumn:2,phonesColumn:3,spendColumns:[1]}]};
const definition=reportDefinitionSchema.parse({source:"sheets",metrics:["cost","messages","cp_custom"],comparison:"none"});
const group:ReportGroup={id:"tour",name:"Tour",enabled:false,sources:{"2026-11":source},report:definition};
const registry:Registry={version:1,revision:0,requests:defaultRequests(),groups:[group],metrics:[{id:"cp_custom",name:"CP tùy chỉnh",formula:"chi_phi / tin_nhan",unit:"currency",decimals:2,scope:"both"}]};
const sheets=async():Promise<Tables>=>({Tour:[["Ngày","Chi phí","Tin nhắn","SĐT"],["2026-11-01",100,1,1],["2026-11-02",200,10,2]]});
test("configured Sheets ranges calculate formulas on totals rather than average daily ratios",async()=>{
  const result=await createConfiguredReport(group,registry,{from:"2026-11-01",to:"2026-11-02"},{sheets});
  assert.equal(result.totals.cost.value,300);
  assert.equal(result.metricValues?.find(metric=>metric.id==="cp_custom")?.value,300/11);
  assert.match(renderConfiguredReport(result,definition),/CP tùy chỉnh: 27,27 VND/);
});
test("hybrid joins phones once and missing phones never erase valid Meta cost",async()=>{
  const hybrid={...group,report:reportDefinitionSchema.parse({...definition,source:"hybrid",connectionId:"meta",accountId:"act_1001",campaignIds:["2001"],phoneSheetName:"Tour",metrics:["cost","phones","cost_per_phone"]})};
  const meta=async()=>({currency:"VND",timeZone:"Asia/Ho_Chi_Minh",sourceUrl:"https://adsmanager.facebook.com",rows:[
    {id:"2001",name:"One",cost:1000,messages:10,metrics:{hien_thi:1000,nhap_lien_ket:50,lead:0,don_hang:0,doanh_thu:0}},
    {id:"2002",name:"Two",cost:2000,messages:20,metrics:{hien_thi:2000,nhap_lien_ket:50,lead:0,don_hang:0,doanh_thu:0}}
  ]});
  const result=await createConfiguredReport(hybrid,registry,{from:"2026-11-01",to:"2026-11-02"},{sheets,meta});
  assert.equal(result.totals.cost.value,3000);assert.equal(result.totals.phones.value,3);
  const missing=await createConfiguredReport(hybrid,registry,{from:"2026-11-01",to:"2026-11-02"},{sheets:async()=>{throw Error("offline");},meta});
  assert.equal(missing.totals.cost.value,3000);
  assert.equal(missing.metricValues?.find(metric=>metric.id==="phones")?.value,null);
});
test("templates reject unknown placeholders and produce plain text without evaluating HTML",async()=>{
  const result=await createConfiguredReport(group,registry,{from:"2026-11-01",to:"2026-11-02"},{sheets});
  assert.throws(()=>renderConfiguredReport(result,{...definition,body:"{{constructor}}"}),/biến|placeholder/i);
  assert.match(renderConfiguredReport(result,{...definition,body:"<b>{{ten_nhom}}</b>\n{{cp_custom}}"}),/<b>Tour<\/b>/);
  assert.match(renderConfiguredReport(result,{...definition,body:"Chi phí: {{chi_phi}}"}),/Chi phí: 300 VND/);
});
test("hotel phone counts remain untracked in hybrid reports even when an imported mapping includes a phone column",async()=>{
  const hotel={...group,report:reportDefinitionSchema.parse({...definition,source:"hybrid",connectionId:"meta",accountId:"act_1001",campaignIds:["2001"],phoneSheetName:"Khách Sạn",metrics:["phones","cost_per_phone"],comparison:"previous"})};
  const sourceHotel={...source,mappings:source.mappings.map(mapping=>({...mapping,name:"Khách Sạn"}))};
  hotel.sources={"2026-11":sourceHotel};
  const meta=async()=>({currency:"VND",timeZone:"Asia/Ho_Chi_Minh",sourceUrl:"https://adsmanager.facebook.com",rows:[{id:"2001",name:"Hotel",cost:1000,messages:10,metrics:{hien_thi:100,nhap_lien_ket:2,lead:0,don_hang:0,doanh_thu:0}}]});
  const result=await createConfiguredReport(hotel,registry,{from:"2026-11-01",to:"2026-11-02"},{sheets,meta});
  assert.equal(result.rows[0].tracksPhones,false);assert.equal(result.metricValues?.find(metric=>metric.id==="phones")?.value,null);
  assert.doesNotMatch(renderConfiguredReport(result,hotel.report!),/chưa đủ dữ liệu so sánh|chưa đọc được SĐT/);
});
test("periods and command date ranges validate leap dates and enforce inclusive bounds",()=>{
  assert.deepEqual(resolvePeriod("2026-11-06","last7"),{from:"2026-10-31",to:"2026-11-06"});
  assert.deepEqual(resolvePeriod("2026-11-06","month"),{from:"2026-11-01",to:"2026-11-06"});
  const resolved=resolveRequest(defaultRequests(),"/baocao 01/11/2026 06/11/2026 Tour");
  assert.equal(resolved?.from,"2026-11-01");assert.equal(resolved?.date,"2026-11-06");assert.equal(resolved?.group,"Tour");
  assert.throws(()=>resolveRequest(defaultRequests(),"/baocao 06/11/2026 01/11/2026"),/Ngày|ngày/);
  assert.throws(()=>resolvePeriod("2026-11-06","today","2026-01-01"),/93/);
});
