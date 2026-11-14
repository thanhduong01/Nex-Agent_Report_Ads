import {GroupError} from "../groups.ts";
import {readMetaAdIdentities} from "../meta.ts";
import type {readMetaInsights} from "../meta.ts";
import type {ReportDefinition} from "../report-definition.ts";
import {salesPolicySchema} from "./types.ts";
import {pancakeConnection} from "./connections.ts";
import {salesStore} from "./store.ts";
import {analyzeSales} from "./analytics.ts";

export async function readPancakeSales(definition:ReportDefinition,range:{from:string;to:string},meta:Awaited<ReturnType<typeof readMetaInsights>>){
  const c=await pancakeConnection(definition.pancakeConnectionId!,definition.shopId),shop=c.shops.find(s=>s.id===definition.shopId)!;
  const currency=shop.currency.replace(/100$/,"");
  if(currency!==meta.currency)throw new GroupError("Tiền tệ shop Pancake và tài khoản Meta khác nhau. Chọn nguồn cùng tiền tệ; ứng dụng không tự quy đổi.");
  const store=salesStore(),status=await store.status(c.id,shop.id);
  const [orders,ads]=await Promise.all([store.orders(c.id,shop.id,range.from,range.to),readMetaAdIdentities(definition.connectionId!,definition.accountId!,definition.campaignIds)]);
  const report=analyzeSales(orders,ads,meta.rows,salesPolicySchema.parse(definition.salesPolicy||{}),range,
    {...status,completeThrough:status.pendingEvents?null:status.completeThrough,currency,timeZone:meta.timeZone});
  if(status.pendingEvents)report.quality.warnings.push("Còn "+status.pendingEvents+" đơn đang chờ đối chiếu chi tiết/webhook; chưa công bố tổng bán hàng.");
  if(status.error)report.quality.warnings.push(status.error);
  return report;
}
