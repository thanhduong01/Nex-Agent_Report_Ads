import {GroupError} from "../groups.ts";
import {PancakeClient} from "./client.ts";
import {normalizeOrder} from "./normalize.ts";
import {listPancakeConnections,pancakeConnection} from "./connections.ts";
import {salesStore} from "./store.ts";
import type {SyncJob,SalesStore} from "./store.ts";
import {databaseConfigured} from "./database.ts";

type PageStore=Pick<SalesStore,"checkpoint"|"finish"|"fail">;
export async function runSyncPage(store:PageStore,client:Pick<PancakeClient,"orders">,job:SyncJob){
  try{const page=await client.orders(job.shopId,job),facts=page.data.map(raw=>normalizeOrder(raw,job.shopId,job.currency));
    if(page.done)await store.finish(job,facts);
    else if(job.mode==="incremental"){
      // Offset pages move when an earlier order is edited during a scan. Resume by updated_at instead.
      const times=facts.map(f=>Date.parse(f.updatedAt));
      if(times.some((t,i)=>i>0&&t<times[i-1]))throw new GroupError("Pancake: thứ tự cập nhật không ổn định. Chưa tăng mốc đồng bộ.",502);
      const boundary=Math.floor(Math.max(...times)/1000)*1000;
      if(boundary<=Date.parse(job.from))throw new GroupError("Pancake: quá nhiều đơn cùng một giây cập nhật. Cần nhập lại khoảng ngày; chưa tăng mốc đồng bộ.",503);
      await store.checkpoint(job,facts,1,new Date(boundary).toISOString());
    }else await store.checkpoint(job,facts,job.page+1);
    return {done:page.done,page:job.page,orders:facts.length};
  }catch(error){await store.fail(job).catch(()=>{});throw error instanceof GroupError?error:new GroupError("Pancake: đồng bộ chưa hoàn tất. Giữ nguyên mốc dữ liệu trước đó.",503);}
}
export async function syncPancake(connectionId:string,shopId:string,now=new Date()){
  const c=await pancakeConnection(connectionId,shopId),shop=c.shops.find(s=>s.id===shopId)!,store=salesStore();
  const status=await store.status(connectionId,shopId);
  // Only an initial complete import establishes cohort coverage. Incremental overlap handles late updates.
  const initial=!status.importFrom||!status.reconciledAt||now.getTime()-Date.parse(status.reconciledAt)>86400000;
  const from=initial?new Date(Math.max(Date.parse(status.importFrom||"1970-01-01"),now.getTime()-8*86400000)).toISOString():new Date(Date.parse(status.completeThrough!)-10*60000).toISOString();
  await store.enqueue({connectionId,shopId,currency:shop.currency,from,to:now.toISOString(),mode:initial?"initial":"incremental"});
  const client=new PancakeClient(c.key);
  const started=Date.now();
  for(const event of await store.events(connectionId,shopId)){
    if(Date.now()-started>20000)break;
    try{
      const raw=await client.order(shopId,event.orderId),fact=normalizeOrder(raw,shopId,shop.currency);
      if(fact.id!==event.orderId)throw new GroupError("Pancake: API trả sai mã đơn yêu cầu.",502);
      await store.acknowledge(connectionId,shopId,event.orderId,event.receivedAt,fact);
    }catch{await store.rejectEvent(connectionId,shopId,event.orderId,event.receivedAt);console.warn("Pancake order detail deferred",{connectionId,shopId});}
  }
  for(let page=0;page<5;page++){
    if(page>0&&Date.now()-started>20000)break;
    const job=await store.claim(connectionId,shopId);if(!job)break;
    const result=await runSyncPage(store,client,job);if(result.done)break;
  }
  return store.status(connectionId,shopId);
}
export async function syncPancakeTick(){
  type Detail={connectionId:string;shopId:string;orders?:number;pendingEvents?:number;from?:string|null;through?:string|null;state?:string;page?:number;error?:string};
  const details:Detail[]=[];
  if(!databaseConfigured())return {configured:false,processed:0,failed:0,details};
  const connections=await listPancakeConnections();let processed=0,failed=0;const start=Date.now();
  const scopes=connections.flatMap(connection=>connection.shops.map(shop=>({connection,shop})));
  const offset=scopes.length?Math.floor(start/300000)%scopes.length:0;
  const rotated=[...scopes.slice(offset),...scopes.slice(0,offset)];
  for(const {connection,shop} of rotated){
    if(Date.now()-start>45000)break;
    try{
      const status=await syncPancake(connection.id,shop.id);processed++;
      if(details.length<20)details.push({connectionId:connection.id,shopId:shop.id,orders:status.orderCount,pendingEvents:status.pendingEvents,
        from:status.importFrom,through:status.completeThrough,state:status.jobs[0]?.state,page:status.jobs[0]?.page});
    }catch(error){
      failed++;const message=error instanceof GroupError?error.message:"Không hoàn tất đồng bộ. Kiểm tra database và nguồn Pancake.";
      console.warn("Pancake sync pending",{connectionId:connection.id,shopId:shop.id,error:message});
      if(details.length<20)details.push({connectionId:connection.id,shopId:shop.id,error:message});
    }
  }
  return {configured:true,processed,failed,details};
}
