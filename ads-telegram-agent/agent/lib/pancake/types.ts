import {z} from "zod";

export const posId = z.union([z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),z.number().int().nonnegative().safe()]).transform(String);
export const salesPolicySchema = z.object({
  basis:z.enum(["confirmed","delivered"]).default("confirmed"),
  includeGifts:z.boolean().default(false),
  // Pancake total_discount includes item discounts. An explicit override is available for shops with a different convention.
  discountMode:z.enum(["total","additional"]).default("total"),
  allowUtmAdId:z.boolean().default(false),
  targetCpa:z.number().positive().max(1e12).default(100000),
  minimumOrders:z.number().int().min(5).max(1000).default(10),
  minimumCoverage:z.number().min(0.5).max(1).default(0.8),
  maximumStaleMinutes:z.number().int().min(5).max(1440).default(15),
  maturityHours:z.number().int().min(24).max(720).default(48),
});
export type SalesPolicy = z.infer<typeof salesPolicySchema>;
export type OrderLine = {productId:string;variationId:string;name:string;sku:string;quantity:number;returned:number;
  price:number|null;discount:number;percent:boolean;gift:boolean;composite:boolean};
export type OrderFact = {id:string;shopId:string;status:number;createdAt:string;updatedAt:string;currency:string;removed:boolean;
  adId:string|null;utmAdId:string|null;discount:number;abandoned:boolean;lines:OrderLine[]};
export type AdIdentity = {id:string;accountId:string;campaignId:string;campaignName:string;adsetId:string;name:string;createdAt?:string};
export type SalesQuality = {syncedAt:string|null;importFrom:string|null;completeThrough:string|null;currency:string;timeZone:string};
export type CampaignSpend = {id:string;name:string;cost:number|null;messages:number|null};
export type SalesCampaign = {id:string;name:string;cost:number|null;messages:number|null;orders:number|null;units:number|null;revenue:number|null;cpa:number|null;roas:number|null};
export type SalesProduct = {id:string;name:string;sku:string;units:number;orders:number;revenue:number|null;campaignIds:string[]};
export type SalesReport = {complete:boolean;quality:SalesQuality & {stale:boolean;warnings:string[]};basis:SalesPolicy["basis"];
  totals:{orders:number|null;units:number|null;revenue:number|null;deliveredOrders:number|null;matchedRevenue:number|null;spend:number|null;cpa:number|null;roas:number|null};
  attribution:{matchedOrders:number;unmatchedOrders:number;coverage:number|null;reasons:Record<string,number>};
  excluded:{currency:number;status:number;abandoned:number};campaigns:SalesCampaign[];products:SalesProduct[];
  signals:{kind:"scale"|"watch"|"product";title:string;detail:string}[]};
