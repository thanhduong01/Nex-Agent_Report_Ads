import {z} from "zod";
import {GroupError} from "../groups.ts";
import {posId} from "./types.ts";
import type {OrderFact} from "./types.ts";

const amount=z.number().finite().min(0).max(1e14);
const lineSchema=z.object({product_id:posId,variation_id:posId,quantity:z.number().int().min(0).max(100000),
  returned_count:z.number().int().min(0).max(100000).default(0),discount_each_product:amount.default(0),
  is_discount_percent:z.boolean().default(false),is_bonus_product:z.boolean().default(false),is_composite:z.boolean().default(false),
  variation_info:z.object({name:z.string().max(500).default("Sản phẩm"),display_id:z.string().max(100).default(""),retail_price:amount.nullish()}).default({name:"Sản phẩm",display_id:""})});
const rawSchema=z.object({id:posId,shop_id:posId,status:z.number().int().min(0).max(100),inserted_at:z.string(),updated_at:z.string(),
  order_currency:z.string().regex(/^[A-Z]{3}(100)?$/).optional(),ad_id:posId.nullish(),p_utm_content:z.string().max(500).nullish(),
  total_discount:amount.default(0),is_abandoned_order:z.boolean().default(false),items:z.array(lineSchema).max(1000)});
export function moneyUnit(currency:string) {return currency==="VND"?1:100;}
export function utcDate(value:string) {
  const normalized=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)?value+"Z":value;
  if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(normalized)||!Number.isFinite(Date.parse(normalized)))
    throw new GroupError("Pancake: ngày cập nhật đơn không hợp lệ.",502);
  return new Date(normalized).toISOString();
}
export function normalizeOrder(raw:unknown,shopId:string|number,shopCurrency:string):OrderFact {
  const parsed=rawSchema.safeParse(raw);
  if(!parsed.success)throw new GroupError("Pancake: đơn hàng thiếu trường chỉ số bắt buộc. Chưa cập nhật dữ liệu báo cáo.",502);
  const o=parsed.data;
  if(o.shop_id!==String(shopId))throw new GroupError("Pancake: đơn hàng nằm ngoài shop đã cấp quyền.",403);
  const currency=o.order_currency||shopCurrency,unit=moneyUnit(currency);
  return {id:o.id,shopId:o.shop_id,status:o.status,createdAt:utcDate(o.inserted_at),updatedAt:utcDate(o.updated_at),
    currency:currency==="VND100"?"VND":currency,adId:o.ad_id||null,
    utmAdId:o.p_utm_content&&/^\d{1,30}$/.test(o.p_utm_content)?o.p_utm_content:null,
    discount:o.total_discount/unit,abandoned:o.is_abandoned_order,
    lines:o.items.map(l=>{
      if(l.returned_count>l.quantity)throw new GroupError("Pancake: số lượng hoàn vượt số lượng đặt.",502);
      return {productId:l.product_id,variationId:l.variation_id,name:l.variation_info.name,sku:l.variation_info.display_id,
        quantity:l.quantity,returned:l.returned_count,price:l.variation_info.retail_price==null?null:l.variation_info.retail_price/unit,
        discount:l.is_discount_percent?l.discount_each_product:l.discount_each_product/unit,percent:l.is_discount_percent,
        gift:l.is_bonus_product,composite:l.is_composite};
    })};
}
