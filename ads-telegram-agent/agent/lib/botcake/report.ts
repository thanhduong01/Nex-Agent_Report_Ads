import {botcakeStore,configKey} from './store.ts';
import {listBotcakeConnections} from './connections.ts';
import {readMetaAdIdentities} from '../meta.ts';
import {vietnamDay} from './phones.ts';
import {emptyBotcakeMetrics} from './catalog.ts';
import type {BotcakeSummary} from './types.ts';
import type {ReportDefinition} from '../report-definition.ts';
type Range={from:string;to:string};
type Meta={currency:string;timeZone:string;rows:{id:string;name:string;cost:number|null}[]};
type Status={startedAt:string|null;syncedAt:string|null;sourceKey:string|null;lastError:string|null};
type Input={range:Range;pages:{pageId:string;name:string;status:Status;pending:number;total:number}[];rows:{pageId:string;day:string;adId:string|null}[];ads:{id:string;campaignId:string;campaignName?:string}[];meta:Meta;selectedCampaignIds?:string[]};
export function unavailableBotcake(message='Botcake chưa đủ dữ liệu. Kiểm tra kết nối và đồng bộ trong Nguồn dữ liệu.'):BotcakeSummary{return {complete:false,fresh:false,message,pageNames:[],syncedAt:null,startedAt:null,metrics:emptyBotcakeMetrics(),campaigns:[]};}
export function buildBotcakeSummary({range,pages,rows,ads,meta,selectedCampaignIds}:Input):BotcakeSummary{
 const times=pages.map(p=>p.status.syncedAt),starts=pages.map(p=>p.status.startedAt);
 const syncedAt=times.every(Boolean)?[...times as string[]].sort()[0]:null,startedAt=starts.every(Boolean)?[...starts as string[]].sort().at(-1)!:null;
 const initialized=pages.length>0&&pages.every(p=>p.status.startedAt&&p.status.syncedAt&&p.status.sourceKey);
 const covered=initialized&&pages.every(p=>range.from>=vietnamDay(p.status.startedAt!)&&range.to<=vietnamDay(p.status.syncedAt!));
 const fresh=!!syncedAt&&Date.now()-Date.parse(syncedAt)<45*60000;
 const complete=covered&&fresh&&pages.every(p=>p.pending===0);
 const campaigns=(selectedCampaignIds||meta.rows.map(r=>r.id)).map(id=>meta.rows.find(r=>r.id===id)||{id,name:ads.find(a=>a.campaignId===id)?.campaignName||'Campaign '+id,cost:null});
 const allowed=new Set(campaigns.map(r=>r.id)),mapping=new Map(ads.filter(a=>allowed.has(a.campaignId)).map(a=>[a.id,a.campaignId]));
 const count=new Map<string,number>();for(const row of rows){const campaign=row.adId&&mapping.get(row.adId);if(campaign)count.set(campaign,(count.get(campaign)||0)+1);}
 const matched=[...count.values()].reduce((n,v)=>n+v,0),spend=campaigns.every(r=>r.cost!==null)?campaigns.reduce((n,r)=>n+r.cost!,0):null;
 const compatible=meta.currency==='VND'&&meta.timeZone==='Asia/Ho_Chi_Minh';
 const metrics=emptyBotcakeMetrics();if(complete)Object.assign(metrics,{BOTCAKE_SDT_MOI:rows.length,BOTCAKE_SDT_KHOP_CAMP:matched,BOTCAKE_SDT_CHUA_GAN:rows.length-matched,BOTCAKE_TONG_SDT:pages.reduce((n,p)=>n+p.total,0),BOTCAKE_CP_SDT_MOI:compatible&&spend!==null&&matched>0?spend/matched:null});
 const message=!initialized?'Đang khởi tạo dữ liệu nền Botcake; chưa tính SĐT mới.':!covered?'Kỳ báo cáo ngoài phạm vi đã theo dõi/đồng bộ Botcake; không suy diễn số 0 cho ngày chưa có dữ liệu.':!fresh?'Dữ liệu Botcake đã quá 45 phút hoặc chưa hoàn tất đồng bộ.':!complete?'Còn SĐT thiếu ngày tương tác hợp lệ; chưa đủ dữ liệu.':`SĐT mới ghi nhận từ mốc theo dõi, chống trùng trọn đời từng Page; không gồm dữ liệu nền.${!compatible?' CPA chưa đủ điều kiện tiền tệ/múi giờ.':''}`;
 return {complete,fresh,message,pageNames:pages.map(p=>p.name),syncedAt,startedAt,metrics,campaigns:campaigns.map(c=>({id:c.id,name:c.name,phones:complete?(count.get(c.id)||0):null,cost:c.cost,cpa:complete&&compatible&&c.cost!==null&&(count.get(c.id)||0)>0?c.cost/count.get(c.id)!:null}))};
}
export async function readBotcakeReport(definition:ReportDefinition,range:Range,meta:Meta):Promise<BotcakeSummary>{
 const ids=definition.botcake?.pageIds||[];if(!ids.length)return unavailableBotcake();
 const connections=await listBotcakeConnections(),store=await botcakeStore();
 const snapshot=await store.reportSnapshot(ids,range),pages=[];
 for(const p of snapshot.pages){const c=connections.find(c=>c.pageId===p.pageId);if(!c)return unavailableBotcake('Page Botcake đã gỡ kết nối. Chọn lại Page trong mẫu.');if(p.status.sourceKey!==configKey(c))p.status.sourceKey=null;pages.push({...p,name:c.name});}
 const rows=snapshot.rows;
 // Exact Meta identity only. Failure keeps Page counts but never fabricates campaign attribution.
 let ads:Awaited<ReturnType<typeof readMetaAdIdentities>>;
 try{ads=await readMetaAdIdentities(definition.connectionId!,definition.accountId!,definition.campaignIds);}catch{return unavailableBotcake('Chưa đối chiếu được ad_id Botcake với Meta; kiểm tra quyền đọc quảng cáo.');}
 return buildBotcakeSummary({range,pages,rows,ads,meta,selectedCampaignIds:definition.campaignIds});
}
