import { getRegistry, GroupError } from "./groups.ts";
import type { Registry, ReportGroup } from "./groups.ts";
import { readSpreadsheet, liveReport } from "./sheets.ts";
import { mappedRows } from "./mapping.ts";
import { aggregate, dayRows, ratio, shiftDate } from "./report.ts";
import type { Row, Tables, Report } from "./report.ts";
import type { Source } from "./config.ts";
import { readMetaInsights } from "./meta.ts";
import { defaultMetrics, reportDefinitionSchema } from "./report-definition.ts";
import type { CustomMetric, ReportDefinition } from "./report-definition.ts";
import { evaluateMetrics, validateMetrics } from "./formulas.ts";
import { previousPeriod, resolvePeriod } from "./report-period.ts";
import { APP_NAME } from "./brand.ts";
export type MetricResult=CustomMetric & {value:number|null;reason?:string};
type Range={from:string;to:string};
type Readers={sheets?:(source:Source)=>Promise<Tables>;meta?:typeof readMetaInsights};
export type ReportOptions={from?:string;period?:ReportDefinition["period"];definition?:ReportDefinition;summary?:boolean};
export const metricDefinitions=(registry:Registry)=>[...defaultMetrics,...(registry.metrics||[])];
const sum=(values:(number|null)[])=>values.some(value=>value===null)?null:values.reduce<number>((total,value)=>total+value!,0);
const makeRow=(name:string,cost:number|null,messages:number|null,phones:number|null,tracksPhones:boolean,issues:string[]=[],metrics?:Row["metrics"]):Row=>({
  name,cost,messages,phones,tracksPhones,issues,metrics,costPerMessage:ratio(cost,messages),
  costPerPhone:tracksPhones?ratio(cost,phones):null,phoneRate:tracksPhones?ratio(phones,messages):null,
});
export async function sheetsRange(group:ReportGroup,range:Range,reader=readSpreadsheet,cache=new Map<string,Promise<Tables>>()) {
  const collected=new Map<string,Row[]>();const dates:string[]=[];
  for(let date=range.from;date<=range.to;date=shiftDate(date,1)) {
    dates.push(date);const month=date.slice(0,7),source=group.sources[month];
    if(!source)throw new GroupError("Chưa có file Google Sheets cho tháng "+month+".");
    if(!cache.has(month))cache.set(month,reader(source));
    const tables=await cache.get(month)!;
    const rows=source.mappings?mappedRows(tables,date,source.mappings):dayRows(tables,date);
    for(const row of rows) {const values=collected.get(row.name)||[];values.push(row);collected.set(row.name,values);}
  }
  const rows=[...collected].map(([name,values])=>{
    const complete=values.length===dates.length;
    const tracks=values.some(row=>row.tracksPhones);
    return makeRow(name,complete?sum(values.map(row=>row.cost)):null,complete?sum(values.map(row=>row.messages)):null,
      complete&&values.every(row=>row.tracksPhones)?sum(values.map(row=>row.phones)):null,tracks,
      [...new Set(values.flatMap(row=>row.issues)),...(!complete?["thiếu sản phẩm trong một phần khoảng ngày"]:[])]);
  });
  return {rows,sourceUrl:"https://docs.google.com/spreadsheets/d/"+group.sources[range.to.slice(0,7)].spreadsheetId+"/edit"};
}
function valuesFor(rows:Row[],constants:Record<string,number>):Record<string,number|null> {
  const t=aggregate(rows),tracked=rows.filter(row=>row.tracksPhones);
  const complete=(value:{value:number;complete:boolean})=>value.complete?value.value:null;
  const extra=(key:string)=>rows.length&&rows.every(row=>row.metrics&&Object.hasOwn(row.metrics,key))?sum(rows.map(row=>row.metrics![key])):null;
  return {...constants,chi_phi:complete(t.cost),tin_nhan:complete(t.messages),so_dien_thoai:complete(t.phones),
    chi_phi_co_sdt:tracked.length?sum(tracked.map(row=>row.cost)):null,
    tin_nhan_co_sdt:tracked.length?sum(tracked.map(row=>row.messages)):null,
    hien_thi:extra("hien_thi"),nhap_lien_ket:extra("nhap_lien_ket"),lead:extra("lead"),don_hang:extra("don_hang"),doanh_thu:extra("doanh_thu")};
}
function results(rows:Row[],definitions:CustomMetric[],selected:string[],constants:Record<string,number>,scope:"total"|"row"):MetricResult[] {
  const calculated=evaluateMetrics(definitions,valuesFor(rows,constants));
  return selected.map(id=>definitions.find(metric=>metric.id===id)!).filter(metric=>metric.scope==="both"||metric.scope===scope)
    .map(metric=>({...metric,...calculated[metric.id]}));
}
async function loadRange(group:ReportGroup,definition:ReportDefinition,range:Range,readers:Readers,cache:Map<string,Promise<Tables>>) {
  if(definition.source==="sheets") {
    const loaded=await sheetsRange(group,range,readers.sheets,cache);
    return {...loaded,currency:"VND",timeZone:"Asia/Ho_Chi_Minh",breakdown:loaded.rows};
  }
  const meta=await (readers.meta||readMetaInsights)({connectionId:definition.connectionId!,accountId:definition.accountId!,
    campaignIds:definition.campaignIds,messageAction:definition.messageAction},range);
  const extras=Object.fromEntries(["hien_thi","nhap_lien_ket","lead","don_hang","doanh_thu"].map(key=>
    [key,sum(meta.rows.map(row=>row.metrics[key as keyof typeof row.metrics]))]));
  let phones:number|null=null,tracks=false;const issues:string[]=[];
  if(definition.source==="hybrid") {
    tracks=!/^kh[aá]ch s[aạ]n$/iu.test(definition.phoneSheetName||"");
    try {
      const sheet=await sheetsRange(group,range,readers.sheets,cache);
      const row=sheet.rows.find(row=>row.name===definition.phoneSheetName);
      if(row){phones=row.phones;tracks=row.tracksPhones;issues.push(...row.issues.filter(issue=>/SĐT|sản phẩm/.test(issue)));}
      else issues.push("không tìm thấy sản phẩm Sheets để ghép SĐT");
    } catch {issues.push("chưa đọc được SĐT từ Sheets cho toàn khoảng ngày");}
  }
  return {rows:[makeRow(group.name,sum(meta.rows.map(row=>row.cost)),sum(meta.rows.map(row=>row.messages)),phones,tracks,issues,extras)],
    currency:meta.currency,timeZone:meta.timeZone,sourceUrl:meta.sourceUrl,
    breakdown:meta.rows.map(row=>makeRow(row.name,row.cost,row.messages,null,false,[],row.metrics))};
}
export function validateReportDefinition(input:unknown,registry:Registry):ReportDefinition {
  const parsed=reportDefinitionSchema.safeParse(input);
  if(!parsed.success)throw new GroupError("Kiểm tra nguồn, kết nối Meta, chỉ số và cấu hình mẫu báo cáo.");
  const definition=parsed.data,definitions=metricDefinitions(registry);
  if(definition.metrics.some(id=>!definitions.some(metric=>metric.id===id)))throw new GroupError("Chỉ số đã thay đổi hoặc không tồn tại. Tải lại danh sách.");
  if(definition.detail==="summary"&&definition.metrics.every(id=>definitions.find(metric=>metric.id===id)?.scope==="row"))
    throw new GroupError("Mẫu tổng quan cần ít nhất một chỉ số tính cho tổng kỳ.");
  if(definition.source!=="sheets"&&!definition.campaignIds.length)throw new GroupError("Chọn ít nhất một campaign cho mẫu báo cáo.");
  const constants={...registry.parameters,...definition.constants};
  if(Object.keys(constants).some(key=>Object.hasOwn(valuesFor([],{}),key)||["constructor","prototype","__proto__"].includes(key)))
    throw new GroupError("Tên biến cố định trùng với biến nguồn hoặc tên dành riêng.");
  try{validateMetrics(definitions,Object.keys(constants));validateBody(definition.body,definitions.filter(metric=>definition.metrics.includes(metric.id)&&metric.scope!=="row"));}
  catch(error){throw new GroupError((error as Error).message);}
  return definition;
}
export async function createConfiguredReport(group:ReportGroup,registry:Registry,range:Range,readers:Readers={}):Promise<Report> {
  range=resolvePeriod(range.to,"today",range.from);
  const definition=validateReportDefinition(group.report||{source:"sheets",metrics:["cost","messages","phones","cost_per_message"]},registry);
  const definitions=metricDefinitions(registry),constants={...registry.parameters,...definition.constants};
  const cache=new Map<string,Promise<Tables>>();
  const current=await loadRange(group,definition,range,readers,cache);
  let previous:Awaited<ReturnType<typeof loadRange>>|undefined;
  if(definition.comparison==="previous") {
    try{previous=await loadRange(group,definition,previousPeriod(range),readers,cache);}catch{/* Explicitly unavailable comparison; current result remains valid. */}
  }
  const summary=results(current.rows,definitions,definition.metrics,constants,"total");
  const detail=results;
  return {date:range.to,range,groupId:group.id,groupName:group.name,fetchedAt:new Date().toISOString(),
    sourceUrl:current.sourceUrl,currency:current.currency,timeZone:current.timeZone,sourceKind:definition.source,confirmed:false,
    rows:current.rows,totals:aggregate(current.rows),previous:previous?aggregate(previous.rows):null,previous7:null,
    metricValues:summary,rowMetricValues:current.breakdown.map(row=>({name:row.name,metrics:detail([row],definitions,definition.metrics,constants,"row")})),
    comparisonValues:previous?results(previous.rows,definitions,definition.metrics,constants,"total"):undefined};
}
const textVariables=["ten_nhom","ky_bao_cao","chi_so","chi_tiet","so_sanh","nguon","thoi_diem_doc","mui_gio"];
function validateBody(body:string,definitions:CustomMetric[]) {
  const allowed=new Set([...textVariables,...definitions.map(metric=>metric.id)]);
  for(const match of body.matchAll(/\{\{(.*?)\}\}/g))if(!allowed.has(match[1].trim()))throw new Error("Mẫu có biến không tồn tại: "+match[1].trim()+".");
  if(body.replace(/\{\{[^{}]*\}\}/g,"").includes("{{")||body.replace(/\{\{[^{}]*\}\}/g,"").includes("}}"))throw new Error("Mẫu có placeholder chưa đóng đúng.");
}
export function formatMetric(metric:MetricResult,currency="VND") {
  if(metric.value===null)return "Không tính được";
  const value=new Intl.NumberFormat("vi-VN",{minimumFractionDigits:metric.decimals,maximumFractionDigits:metric.decimals}).format(metric.value);
  return value+(metric.unit==="currency"?" "+currency:metric.unit==="percent"?"%":"");
}
export function renderConfiguredReport(report:Report,definition:ReportDefinition) {
  const metrics=report.metricValues||[];
  validateBody(definition.body,metrics);
  const values:Record<string,string>=Object.create(null);
  for(const metric of metrics)values[metric.id]=formatMetric(metric,report.currency);
  values.ten_nhom=report.groupName||"Báo cáo";
  const date=(value:string)=>value.split("-").reverse().join("/");
  values.ky_bao_cao=report.range&&report.range.from!==report.range.to?date(report.range.from)+" – "+date(report.range.to):date(report.date);
  values.chi_so=metrics.map(metric=>metric.name+": "+formatMetric(metric,report.currency)+(metric.value===null?" ("+(metric.reason||"Thiếu số liệu")+")":"")).join("\n");
  values.chi_tiet=definition.detail==="rows"?(report.rowMetricValues||[]).map(row=>
    row.name+"\n"+row.metrics.map(metric=>metric.name+": "+formatMetric(metric,report.currency)).join(" · ")).join("\n\n"):"";
  values.so_sanh=definition.comparison==="none"?"":metrics.map(metric=>{
    const old=report.comparisonValues?.find(item=>item.id===metric.id);
    return metric.name+": "+(metric.value===null||!old||old.value===null||old.value===0?"chưa đủ dữ liệu so sánh":
      ((metric.value/old.value-1)*100).toLocaleString("vi-VN",{maximumFractionDigits:1,signDisplay:"always"})+"% so với kỳ trước");
  }).join("\n");
  values.nguon={sheets:"Google Sheets",meta:"Meta Ads Insights",hybrid:"Meta Ads + Google Sheets"}[definition.source];
  values.thoi_diem_doc=new Date(report.fetchedAt).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"});
  values.mui_gio=report.timeZone||"Asia/Ho_Chi_Minh";
  const body=definition.body||"📊 {{ten_nhom}} · {{ky_bao_cao}}\n\n{{chi_so}}\n\n{{chi_tiet}}\n\n{{so_sanh}}\n\nNguồn: {{nguon}}\nNgày dữ liệu: {{mui_gio}}\nĐọc lúc: {{thoi_diem_doc}}";
  let text=APP_NAME+"\n"+body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_,key:string)=>values[key]||"");
  const issues=report.rows.flatMap(row=>row.issues);
  if(issues.length)text+="\n\nLưu ý: "+[...new Set(issues)].join("; ")+".";
  text=text.replace(/\n{3,}/g,"\n\n").trim();
  if(text.length>4000)throw new GroupError("Báo cáo vượt giới hạn Telegram. Rút ngắn mẫu, giảm chỉ số hoặc chọn bản tổng quan.");
  return text;
}
export async function configuredReport(date:string,groupId="default",options:ReportOptions={}) {
  const registry=await getRegistry(),existing=registry.groups.find(group=>group.id===groupId);
  if(!existing)throw new GroupError("Không tìm thấy nhóm báo cáo.",404);
  if(!existing.report&&!options.definition&&!options.from&&!options.period)return liveReport(date,groupId);
  const group={...existing,...(options.definition?{report:options.definition}:{})};
  const range=resolvePeriod(date,options.period||"today",options.from);
  const report=await createConfiguredReport(group,registry,range);
  const definition=group.report||reportDefinitionSchema.parse({source:"sheets",metrics:["cost","messages","phones","cost_per_message"]});
  report.customText=renderConfiguredReport(report,options.summary?{...definition,detail:"summary"}:definition);
  return report;
}
