import {botcakeSettingsSchema} from "./botcake/types.ts";
import {botcakeMetrics,botcakeAliases,botcakeTextVariables} from "./botcake/catalog.ts";
import { z } from "zod";
import {salesPolicySchema} from "./pancake/types.ts";
import {sourceFieldMetrics} from "./source-catalog.ts";
export const identifier=z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const templateTextVariables=["ten_nhom","ky_bao_cao","chi_so","chi_tiet","so_sanh","nguon","thoi_diem_doc","mui_gio","san_pham_ban_chay","nhan_dinh","doi_soat","TRANG_THAI_DON_HANG",...Object.keys(botcakeTextVariables)];
export const templateAliases:Record<string,string>={...botcakeAliases,chi_phi:"cost",tin_nhan:"messages",so_dien_thoai:"phones",chi_phi_moi_tin_nhan:"cost_per_message",chi_phi_moi_sdt:"cost_per_phone"};
export const reservedMetricIds=[...templateTextVariables,...Object.keys(templateAliases)];
export const parametersSchema=z.record(identifier,z.number().finite().min(-1e12).max(1e12))
  .refine(value=>Object.keys(value).length<=20);
export const metricSchema=z.object({
  id:identifier.refine(id=>!reservedMetricIds.includes(id),{message:"Mã chỉ số dành riêng cho nội dung mẫu."}),name:z.string().trim().min(1).max(80),formula:z.string().trim().min(1).max(512),
  unit:z.enum(["number","currency","percent"]),decimals:z.number().int().min(0).max(6),
  scope:z.enum(["total","row","both"]).default("both"),
  valueMap:z.record(z.string().regex(/^-?\d+(?:\.\d+)?$/).max(40),z.string().trim().min(1).max(100)).refine(map=>Object.keys(map).length<=50).optional(),
});
export type CustomMetric=z.infer<typeof metricSchema> & {provider?:"meta"|"pancake"|"botcake"};
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
  {id:"purchases",name:"Đơn hàng Meta",formula:"don_hang",unit:"number",decimals:0,scope:"both"},
  {id:"roas",name:"ROAS Meta",formula:"doanh_thu / chi_phi",unit:"number",decimals:2,scope:"both"},
  {id:"pos_orders",name:"Đơn Pancake trong kỳ",formula:"pos_don_hang",unit:"number",decimals:0,scope:"both"},
  {id:"pos_units",name:"Sản phẩm giữ lại",formula:"pos_so_luong",unit:"number",decimals:0,scope:"both"},
  {id:"pos_revenue",name:"Doanh thu hàng hóa Pancake",formula:"pos_doanh_thu",unit:"currency",decimals:0,scope:"both"},
  {id:"pos_matched_orders",name:"Đơn nối đúng campaign",formula:"pos_don_khop",unit:"number",decimals:0,scope:"both"},
  {id:"pos_cpa",name:"CPA đơn Pancake",formula:"pos_cpa_an_toan",unit:"currency",decimals:0,scope:"both"},
  {id:"pos_roas",name:"ROAS Pancake",formula:"pos_roas_an_toan",unit:"number",decimals:2,scope:"both"},
  ...sourceFieldMetrics,...botcakeMetrics,
];
export const periodSchema=z.enum(["today","yesterday","last7","month"]);
export const reportDefinitionSchema=z.object({
  botcake:botcakeSettingsSchema.optional(),
  source:z.enum(["sheets","meta","hybrid","pancake"]),
  pancakeConnectionId:z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  shopId:z.string().regex(/^\d{1,30}$/).optional(),
  salesPolicy:salesPolicySchema.optional(),
  statusLabels:z.record(z.string().regex(/^\d{1,3}$/),z.string().trim().min(1).max(80)).refine(map=>Object.keys(map).length<=30).optional(),
  connectionId:z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  accountId:z.string().regex(/^act_\d{1,30}$/).optional(),
  campaignIds:z.array(z.string().regex(/^\d{1,30}$/)).max(100).default([]),
  messageAction:z.string().regex(/^[a-zA-Z0-9_.]{1,120}$/).default("onsite_conversion.messaging_conversation_started_7d"),
  phoneSheetName:z.string().trim().min(1).max(100).optional(),
  metrics:z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)).min(1).max(60).refine(items=>new Set(items).size===items.length),
  period:periodSchema.default("today"),comparison:z.enum(["previous","none"]).default("previous"),
  detail:z.enum(["summary","rows"]).default("summary"),
  constants:parametersSchema.default({}),
  body:z.string().trim().max(3000).default(""),
}).refine(value=>!value.botcake||value.source!=="sheets",{message:"Botcake cần mẫu có nguồn Meta."}).refine(value=>value.source==="sheets"||!!(value.connectionId&&value.accountId),{message:"Chọn kết nối và tài khoản Meta."})
  .refine(value=>value.source!=="hybrid"||!!value.phoneSheetName,{message:"Chọn sản phẩm Sheets để ghép SĐT."})
  .refine(value=>value.source!=="pancake"||!!(value.pancakeConnectionId&&value.shopId),{message:"Chọn kết nối và shop Pancake."});
export type ReportDefinition=z.infer<typeof reportDefinitionSchema>;
