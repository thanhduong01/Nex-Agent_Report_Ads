import type {OrderFact,AdIdentity,CampaignSpend,SalesPolicy,SalesQuality,SalesReport,SalesProduct} from "./types.ts";
import {moneyUnit} from "./normalize.ts";

const confirmed=new Set([1,12,13,8,9,2,3,16,15]),delivered=new Set([3,16]);
const ratio=(a:number|null,b:number|null)=>a===null||!b?null:a/b;
const sum=(values:(number|null)[])=>values.some(v=>v===null)?null:values.reduce<number>((a,b)=>a+b!,0);
const localDay=(date:string)=>new Date(Date.parse(date)+7*3600000).toISOString().slice(0,10);
const precision=(currency:string)=>moneyUnit(currency)===1?1:100;
const rounded=(n:number,currency:string)=>Math.round(n*precision(currency))/precision(currency);

// Discounts are allocated on the original lines, then returns reverse the same unit value.
// Composite lines are retained as a single commercial product; their components are never counted again.
export function orderAmounts(order:OrderFact,policy:SalesPolicy) {
  const lines=order.lines.filter(l=>policy.includeGifts||!l.gift);
  const lineNet=(l:OrderFact["lines"][number])=>l.gift?0:l.price===null?null:Math.max(0,l.price-(l.percent?l.price*l.discount/100:l.discount))*l.quantity;
  const net=lines.map(lineNet);
  const lineDiscount=order.lines.reduce((s,l)=>s+(l.price||0)*l.quantity-(lineNet(l)||0),0);
  const extra=policy.discountMode==="additional"?order.discount:Math.max(0,order.discount-lineDiscount);
  const total=sum(net);
  const ambiguousGiftDiscount=policy.discountMode==="total"&&order.discount>0&&order.lines.some(l=>l.gift&&l.price===null);
  const valid=total!==null&&extra<=total&&!ambiguousGiftDiscount&&order.lines.every(l=>!l.percent||l.discount<=100);
  const factor=precision(order.currency),discountUnits=Math.round(extra*factor);
  const weights=net.map(value=>valid&&total?discountUnits*value!/total:0),allocations=weights.map(Math.floor);
  let leftover=discountUnits-allocations.reduce((a,b)=>a+b,0);
  const ranked=weights.map((value,index)=>({index,fraction:value-Math.floor(value)})).sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
  if(valid)for(const entry of ranked){if(leftover<=0)break;if(net[entry.index]!>0){allocations[entry.index]++;leftover--;}}
  return lines.map((l,index)=>{
    const allocation=valid?allocations[index]/factor:0;
    return {line:l,units:l.quantity-l.returned,revenue:valid?rounded((net[index]!-allocation)*(l.quantity?(l.quantity-l.returned)/l.quantity:0),order.currency):null};
  }).filter(l=>l.units>0);
}
export function analyzeSales(orders:OrderFact[],ads:AdIdentity[],spend:CampaignSpend[],policy:SalesPolicy,
  range:{from:string;to:string},quality:SalesQuality,now=new Date()):SalesReport {
  const start=Date.parse(range.from+"T00:00:00+07:00"),end=Math.min(Date.parse(range.to+"T23:59:59.999+07:00"),now.getTime());
  const today=localDay(now.toISOString());
  const requiredEnd=range.to>=today?Date.parse(today+"T00:00:00+07:00"):end;
  const complete=!!quality.importFrom&&Date.parse(quality.importFrom)<=start&&!!quality.completeThrough&&Date.parse(quality.completeThrough)>=requiredEnd;
  const cutoff=Math.min(Date.parse(quality.completeThrough||""),Date.parse(quality.syncedAt||""));
  const stale=!Number.isFinite(cutoff)||now.getTime()-cutoff>policy.maximumStaleMinutes*60000;
  const warnings:string[]=[];
  if(!complete)warnings.push("Chưa đồng bộ đầy đủ khoảng ngày đã chọn; chỉ số bán hàng chưa khả dụng.");
  if(stale)warnings.push("Dữ liệu Pancake chưa được cập nhật gần đây.");
  if(quality.timeZone!=="Asia/Ho_Chi_Minh")warnings.push("Múi giờ Meta và shop chưa đồng nhất; không tính CPA/ROAS.");
  const scopedSpend=[...spend];
  for(const ad of ads)if(!scopedSpend.some(c=>c.id===ad.campaignId))scopedSpend.push({id:ad.campaignId,name:ad.campaignName,cost:0,messages:0});
  const campaigns=scopedSpend.map(c=>({...c,orders:complete?0:null,units:complete?0:null,revenue:complete?0:null,cpa:null as number|null,roas:null as number|null}));
  const byCampaign=new Map(campaigns.map(c=>[c.id,c]));
  const identities=new Map<string,AdIdentity[]>();for(const ad of ads)identities.set(ad.id,[...(identities.get(ad.id)||[]),ad]);
  const products=new Map<string,SalesProduct>();
  const excluded={currency:0,status:0,abandoned:0},reasons:Record<string,number>={missing_id:0,ambiguous:0,out_of_scope:0};
  let matched=0,count=0,units=0,deliveredOrders=0;const revenues:(number|null)[]=[],matchedRevenues:(number|null)[]=[];
  for(const order of orders){
    const day=localDay(order.createdAt);if(day<range.from||day>range.to||Date.parse(order.createdAt)>end)continue;
    if(order.abandoned){excluded.abandoned++;continue;}
    if(order.removed||!(policy.basis==="delivered"?delivered:confirmed).has(order.status)){excluded.status++;continue;}
    if(order.currency!==quality.currency){excluded.currency++;continue;}
    count++;if(delivered.has(order.status))deliveredOrders++;
    const amount=orderAmounts(order,policy),revenue=sum(amount.map(l=>l.revenue)),quantity=amount.reduce((s,l)=>s+l.units,0);
    units+=quantity;revenues.push(revenue);
    const conflicting=order.adId&&order.utmAdId&&order.adId!==order.utmAdId;
    const id=order.adId||(policy.allowUtmAdId?order.utmAdId:null),candidates=id?identities.get(id)||[]:[];
    const candidate=candidates.length===1?candidates[0]:undefined;
    const camp=!conflicting&&candidate?byCampaign.get(candidate.campaignId):undefined;
    if(camp){matched++;matchedRevenues.push(revenue);if(complete){camp.orders!++;camp.units!+=quantity;camp.revenue=camp.revenue===null||revenue===null?null:camp.revenue+revenue;}}
    else{const reason=conflicting||candidates.length>1?"ambiguous":!id?"missing_id":"out_of_scope";reasons[reason]++;}
    for(const {line,units:quantity,revenue} of amount){
      const p=products.get(line.productId)||{id:line.productId,name:line.name,sku:line.sku,units:0,orders:0,revenue:0,campaignIds:[]};
      p.units+=quantity;p.revenue=p.revenue===null||revenue===null?null:p.revenue+revenue;
      if(camp&&!p.campaignIds.includes(camp.id))p.campaignIds.push(camp.id);
      products.set(line.productId,p);
    }
    for(const id of new Set(amount.map(l=>l.line.productId)))products.get(id)!.orders++;
  }
  if(excluded.currency)warnings.push("Đã loại "+excluded.currency+" đơn khác tiền tệ; không tính tỷ lệ hiệu quả.");
  const coverage=ratio(matched,count),aligned=quality.timeZone==="Asia/Ho_Chi_Minh"&&!excluded.currency;
  const safe=complete&&aligned&&!stale&&coverage!==null&&coverage>=policy.minimumCoverage;
  const totalSpend=sum(spend.map(c=>c.cost));
  for(const c of campaigns){if(safe){c.cpa=ratio(c.cost,c.orders);c.roas=ratio(c.revenue,c.cost);}}
  const signals:SalesReport["signals"]=[];
  if(complete&&count)signals.push({kind:"watch",title:"Độ phủ nối đơn "+Math.round((coverage||0)*100)+"%",detail:matched+"/"+count+" đơn nối bằng ID quảng cáo; "+(count-matched)+" đơn chưa gán campaign."});
  const ranked=[...products.values()].sort((a,b)=>b.units-a.units||a.id.localeCompare(b.id));
  if(complete&&ranked[0])signals.push({kind:"product",title:ranked[0].name+" đang dẫn đầu số lượng",detail:ranked[0].units+" sản phẩm thương mại giữ lại trong kỳ; chưa có so sánh cùng thời điểm để kết luận tăng trưởng."});
  const mature=now.getTime()-Date.parse(range.to+"T23:59:59+07:00")>=policy.maturityHours*3600000;
  if(safe&&mature)for(const c of campaigns)if(c.orders!>=policy.minimumOrders&&c.cpa!==null&&c.cpa<=policy.targetCpa)
    signals.push({kind:"watch",title:c.name+": tín hiệu CPA tốt",detail:c.orders+" đơn đã đối soát, CPA "+Math.round(c.cpa)+" "+quality.currency+" thấp hơn mục tiêu. Chưa xác định độ phủ riêng campaign, biên lợi nhuận và độ trễ hoàn hàng để khuyến nghị ngân sách."});
  return {complete,quality:{...quality,stale,warnings},basis:policy.basis,
    totals:{orders:complete?count:null,units:complete?units:null,revenue:complete?sum(revenues):null,deliveredOrders:complete?deliveredOrders:null,
      matchedRevenue:complete?sum(matchedRevenues):null,spend:totalSpend,cpa:safe?ratio(totalSpend,matched):null,roas:safe?ratio(sum(matchedRevenues),totalSpend):null},
    attribution:{matchedOrders:matched,unmatchedOrders:count-matched,coverage,reasons},excluded,campaigns,products:complete?ranked:[],signals};
}
