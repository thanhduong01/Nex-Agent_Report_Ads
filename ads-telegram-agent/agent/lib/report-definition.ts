import { z } from "zod";
export const identifier=z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const parametersSchema=z.record(identifier,z.number().finite().min(-1e12).max(1e12))
  .refine(value=>Object.keys(value).length<=20);
export const metricSchema=z.object({
  id:identifier,name:z.string().trim().min(1).max(80),formula:z.string().trim().min(1).max(512),
  unit:z.enum(["number","currency","percent"]),decimals:z.number().int().min(0).max(6),
  scope:z.enum(["total","row","both"]).default("both"),
});
export type CustomMetric=z.infer<typeof metricSchema>;
export const defaultMetrics:CustomMetric[]=[
  {id:"cost",name:"Chi phí",formula:"chi_phi",unit:"currency",decimals:0,scope:"both"},
  {id:"messages",name:"Tin nhắn",formula:"tin_nhan",unit:"number",decimals:0,scope:"both"},
  {id:"phones",name:"SĐT",formula:"so_dien_thoai",unit:"number",decimals:0,scope:"both"},
  {id:"cost_per_message",name:"Chi phí/tin nhắn",formula:"chi_phi / tin_nhan",unit:"currency",decimals:0,scope:"both"},
  {id:"cost_per_phone",name:"Chi phí/SĐT",formula:"chi_phi_co_sdt / so_dien_thoai",unit:"currency",decimals:0,scope:"both"},
  {id:"phone_rate",name:"Tỷ lệ lấy SĐT",formula:"so_dien_thoai / tin_nhan_co_sdt * 100",unit:"percent",decimals:1,scope:"both"},
  {id:"impressions",name:"Hiển thị",formula:"hien_thi",unit:"number",decimals:0,scope:"both"},
  {id:"link_clicks",name:"Nhấp liên kết",formula:"nhap_lien_ket",unit:"number",decimals:0,scope:"both"},
  {id:"cpm",name:"CPM",formula:"chi_phi / hien_thi * 1000",unit:"currency",decimals:0,scope:"both"},
  {id:"ctr",name:"CTR liên kết",formula:"nhap_lien_ket / hien_thi * 100",unit:"percent",decimals:2,scope:"both"},
  {id:"leads",name:"Lead Meta",formula:"lead",unit:"number",decimals:0,scope:"both"},
  {id:"purchases",name:"Đơn hàng",formula:"don_hang",unit:"number",decimals:0,scope:"both"},
  {id:"roas",name:"ROAS",formula:"doanh_thu / chi_phi",unit:"number",decimals:2,scope:"both"},
];
export const periodSchema=z.enum(["today","yesterday","last7","month"]);
export const reportDefinitionSchema=z.object({
  source:z.enum(["sheets","meta","hybrid"]),
  connectionId:z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  accountId:z.string().regex(/^act_\d{1,30}$/).optional(),
  campaignIds:z.array(z.string().regex(/^\d{1,30}$/)).max(100).default([]),
  messageAction:z.string().regex(/^[a-zA-Z0-9_.]{1,120}$/).default("onsite_conversion.messaging_conversation_started_7d"),
  phoneSheetName:z.string().trim().min(1).max(100).optional(),
  metrics:z.array(identifier).min(1).max(30).refine(items=>new Set(items).size===items.length),
  period:periodSchema.default("today"),comparison:z.enum(["previous","none"]).default("previous"),
  detail:z.enum(["summary","rows"]).default("summary"),
  constants:parametersSchema.default({}),
  body:z.string().trim().max(3000).default(""),
}).refine(value=>value.source==="sheets"||!!(value.connectionId&&value.accountId),{message:"Chọn kết nối và tài khoản Meta."})
  .refine(value=>value.source!=="hybrid"||!!value.phoneSheetName,{message:"Chọn sản phẩm Sheets để ghép SĐT."});
export type ReportDefinition=z.infer<typeof reportDefinitionSchema>;
