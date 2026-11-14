import {z} from "zod";
import {randomBytes} from "node:crypto";
import {readPrivate,updatePrivate} from "../private-store.ts";
import {GroupError,getRegistry,hasGroupStorage} from "../groups.ts";
import {PancakeClient} from "./client.ts";
import {posId} from "./types.ts";

const connectionSchema=z.object({id:z.string().regex(/^[a-z0-9-]{1,64}$/),name:z.string().trim().min(1).max(80),
  key:z.string().regex(/^[A-Za-z0-9_.:-]{16,4096}$/),secret:z.string().regex(/^[a-f0-9]{64}$/),checkedAt:z.string(),revision:z.number().int().nonnegative().default(0),
  shops:z.array(z.object({id:posId,name:z.string().max(300),currency:z.string().regex(/^[A-Z]{3}(100)?$/)})).min(1).max(20)});
export type PancakeConnection=z.infer<typeof connectionSchema>;
async function all(){const parsed=z.array(connectionSchema).max(20).safeParse(await readPrivate("pancake-connections",[]));
  if(!parsed.success)throw new GroupError("Không đọc được kho kết nối Pancake.",503);return parsed.data;}
export const safePancakeConnection=(c:PancakeConnection)=>({id:c.id,name:c.name,shops:c.shops,checkedAt:c.checkedAt,revision:c.revision,hasKey:true});
export const listPancakeConnections=async()=>process.env.VERCEL==="1"&&!hasGroupStorage()?[]:(await all()).map(safePancakeConnection);
export async function pancakeConnection(id:string,shopId?:string){const c=(await all()).find(c=>c.id===id);
  if(!c||shopId&&!c.shops.some(s=>s.id===shopId))throw new GroupError("Pancake: kết nối hoặc shop không thuộc phạm vi được cấp quyền.",403);return c;}
export async function savePancakeConnection(body:Record<string,unknown>){
  const input=z.object({id:connectionSchema.shape.id,name:connectionSchema.shape.name,shopIds:z.array(posId).min(1).max(20)}).safeParse(body);
  if(!input.success)throw new GroupError("Nhập tên kết nối và ít nhất một ID shop Pancake hợp lệ.");
  const old=(await all()).find(c=>c.id===input.data.id);
  if(old&&body.revision!==old.revision)throw new GroupError("Kết nối Pancake đã thay đổi hoặc bản chỉnh đã cũ. Tải lại danh sách trước khi lưu.",409);
  if(body.remove===true){const registry=await getRegistry();if(registry.groups.some(g=>g.report&&"pancakeConnectionId" in g.report&&g.report.pancakeConnectionId===input.data.id))throw new GroupError("Đổi nguồn các mẫu báo cáo trước khi xóa kết nối Pancake.");
    await updatePrivate<PancakeConnection[]>("pancake-connections",[],items=>{const at=items.findIndex(c=>c.id===input.data.id);if(at>=0){if((items[at].revision||0)!==old?.revision)throw new GroupError("Kết nối đã thay đổi. Tải lại trước khi gỡ.",409);items.splice(at,1);}});return {connections:await listPancakeConnections()};}
  const key=typeof body.key==="string"&&body.key.trim()?body.key.trim():old?.key;
  if(!connectionSchema.shape.key.safeParse(key).success)throw new GroupError("Nhập khóa API Pancake hợp lệ; chỉ chuỗi khóa, không kèm URL.");
  const client=new PancakeClient(key!);const shops=[];
  for(const id of new Set(input.data.shopIds))shops.push(await client.shop(id));
  const saved:PancakeConnection={id:input.data.id,name:input.data.name,key:key!,shops,checkedAt:new Date().toISOString(),revision:(old?.revision||0)+1,secret:old?.secret||randomBytes(32).toString("hex")};
  await updatePrivate<PancakeConnection[]>("pancake-connections",[],items=>{const at=items.findIndex(c=>c.id===saved.id);
    if((at>=0)!==!!old||(at>=0&&(items[at].revision||0)!==old?.revision))throw new GroupError("Kết nối Pancake vừa được cập nhật ở phiên khác. Giữ bản chỉnh và tải lại danh sách.",409);
    if(at>=0)items[at]=saved;else{if(items.length>=20)throw new GroupError("Tối đa 20 kết nối Pancake.");items.push(saved);}});
  console.info("Pancake connection verified",{id:saved.id,shops:shops.length});return {connections:await listPancakeConnections()};
}
