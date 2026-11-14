import {z} from "zod";
import {GroupError} from "../groups.ts";
import {posId} from "./types.ts";

const shopSchema=z.object({id:posId,name:z.string().max(300),currency:z.string().regex(/^[A-Z]{3}(100)?$/).optional()});
export class PancakeClient {
  private key:string;
  private fetcher:typeof fetch;
  constructor(key:string,fetcher:typeof fetch=fetch){this.key=key;this.fetcher=fetcher;}
  private async get(path:string,params:Record<string,string>={}){
    const url=new URL("https://pos.pages.fm/api/v1/"+path);url.searchParams.set("api_key",this.key);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    for(let attempt=0;attempt<2;attempt++){
      let response:Response;
      try{response=await this.fetcher(url,{method:"GET",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});}
      catch{throw new GroupError("Pancake: không kết nối được API. Thử đồng bộ lại sau.",503);}
      if((response.status===429||response.status>=500)&&attempt===0){
        const delay=Number(response.headers.get("retry-after")||0.5);
        await response.body?.cancel();
        if(!Number.isFinite(delay)||delay>2)throw new GroupError("Pancake đang giới hạn truy cập. Thử lại sau.",429);
        await new Promise(resolve=>setTimeout(resolve,Math.max(0.35,delay)*1000));continue;
      }
      let body:Record<string,unknown>;
      try{
        const reader=response.body?.getReader();if(!reader)throw Error();let text="",bytes=0;const decoder=new TextDecoder();
        while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>4_000_000){await reader.cancel();throw Error();}text+=decoder.decode(part.value,{stream:true});}
        text+=decoder.decode();body=JSON.parse(text);if(!body||typeof body!=="object"||Array.isArray(body))throw Error();
      }catch{throw new GroupError("Pancake: phản hồi API không hợp lệ hoặc quá lớn.",502);}
      if(!response.ok||body.success===false){
        if(response.status===401||response.status===403)throw new GroupError("Pancake: khóa API chưa hợp lệ hoặc chưa có quyền vào shop.",403);
        throw new GroupError("Pancake: API chưa hoàn tất yêu cầu. Kiểm tra kết nối rồi đồng bộ lại.",502);
      }
      return body;
    }
    throw new GroupError("Pancake: cần thử lại sau.",503);
  }
  async shops(){const body=await this.get("shops"),parsed=z.array(shopSchema).max(100).safeParse(body.shops);
    if(!parsed.success)throw new GroupError("Pancake: không đọc được danh sách shop.",502);return parsed.data;}
  async shop(id:string){posId.parse(id);const body=await this.get("shops/"+encodeURIComponent(id)),parsed=shopSchema.safeParse(body.shop);
    if(!parsed.success||parsed.data.id!==id||!parsed.data.currency)throw new GroupError("Pancake: shop thiếu thông tin tiền tệ hoặc không đúng phạm vi.",502);
    return {...parsed.data,currency:parsed.data.currency};}
  async orders(shopId:string,job:{from:string;to:string;page:number;mode:"initial"|"incremental"}){
    posId.parse(shopId);
    if(!Number.isInteger(job.page)||job.page<1||job.page>10000)throw new GroupError("Pancake: tác vụ vượt giới hạn phân trang.");
    const body=await this.get("shops/"+encodeURIComponent(shopId)+"/orders",{page_size:"100",page_number:String(job.page),include_removed:"1",
      updateStatus:job.mode==="initial"?"inserted_at":"updated_at",startDateTime:String(Math.floor(Date.parse(job.from)/1000)),
      endDateTime:String(Math.floor(Date.parse(job.to)/1000)),option_sort:job.mode==="initial"?"inserted_at_asc":"last_updated_order_asc"});
    const page=z.object({data:z.array(z.unknown()).max(100),total_pages:z.number().int().min(0).max(10000),total_entries:z.number().int().min(0).max(1_000_000)}).safeParse(body);
    if(!page.success||(page.data.data.length===0&&job.page<page.data.total_pages))throw new GroupError("Pancake: phân trang thiếu dữ liệu. Giữ nguyên mốc đồng bộ.",502);
    return {data:page.data.data,done:job.page>=page.data.total_pages};
  }
  async order(shopId:string,orderId:string){posId.parse(shopId);posId.parse(orderId);
    const body=await this.get("shops/"+encodeURIComponent(shopId)+"/orders/"+encodeURIComponent(orderId));
    const order=body.data||body.order||body,parsed=z.object({id:posId,shop_id:posId}).safeParse(order);
    if(!parsed.success||parsed.data.id!==orderId||parsed.data.shop_id!==shopId)throw new GroupError("Pancake: chưa đọc được chi tiết đơn hàng đúng phạm vi.",502);
    return order;}
}
