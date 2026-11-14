import {z} from "zod";
import {GroupError} from "../groups.ts";
import {databaseHealth} from "./database.ts";
import {salesStore} from "./store.ts";
import {listPancakeConnections,savePancakeConnection,pancakeConnection} from "./connections.ts";
import {syncPancake} from "./sync.ts";

export async function pancakeAction(body:Record<string,unknown>,origin:string){
  if(body.action==="database"){
    const health=await databaseHealth();if(health.connected){try{await salesStore().init();}catch{throw new GroupError("Đã kết nối database nhưng chưa tạo được bảng. Kiểm tra quyền CREATE SCHEMA của tài khoản PostgreSQL.",503);}}
    return {database:health};
  }
  if(body.action==="save")return savePancakeConnection(body);
  const parsed=z.object({connectionId:z.string().regex(/^[a-z0-9-]{1,64}$/),shopId:z.string().regex(/^\d{1,30}$/)}).safeParse(body);
  if(!parsed.success)throw new GroupError("Chọn kết nối và shop Pancake.");
  const {connectionId,shopId}=parsed.data,c=await pancakeConnection(connectionId,shopId);
  if(body.action==="webhook")return {url:origin+"/api/pancake-webhook?connection="+encodeURIComponent(c.id),header:"X-Nex-Webhook-Secret",secret:c.secret};
  if(body.action==="sync")return {status:await syncPancake(connectionId,shopId)};
  if(body.action==="status")return {status:await salesStore().status(connectionId,shopId)};
  if(body.action==="retry-events"){await salesStore().retryEvents(connectionId,shopId);return {status:await salesStore().status(connectionId,shopId)};}
  if(body.action==="list")return {connections:await listPancakeConnections()};
  throw new GroupError("Không tìm thấy thao tác Pancake.",404);
}
