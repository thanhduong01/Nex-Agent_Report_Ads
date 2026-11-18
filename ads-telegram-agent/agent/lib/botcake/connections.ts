import {z} from 'zod';
import {randomBytes} from 'node:crypto';
import {GroupError,getRegistry,hasGroupStorage} from '../groups.ts';
import {readPrivate,updatePrivate} from '../private-store.ts';
import {BotcakeClient} from './client.ts';
import {botcakeStore,type BotcakeStore} from './store.ts';
import {pageIdSchema,type PageConfig} from './types.ts';
const schema=z.object({id:z.string().regex(/^[a-z0-9-]{1,64}$/),name:z.string().trim().min(1).max(80),pageId:pageIdSchema,
 token:z.string().trim().min(16).max(4096).regex(/^[A-Za-z0-9_.:-]+$/),source:z.enum(['profile','custom','both']),
 fieldIds:z.array(z.number().int().positive().max(2147483647)).max(5),fields:z.array(z.object({id:z.number().int().positive(),name:z.string().max(200),type:z.number().nullable()})).max(2000),
 revision:z.number().int().nonnegative(),checkedAt:z.string()});
export type BotcakeConnection=z.infer<typeof schema>;
async function all(){const parsed=z.array(schema).max(20).safeParse(await readPrivate('botcake-connections',[]));if(!parsed.success)throw new GroupError('Botcake: không đọc được cấu hình kết nối đã lưu.',503);return parsed.data;}
export const safeConnection=(c:BotcakeConnection):PageConfig&{fields:BotcakeConnection['fields']}=>({id:c.id,name:c.name,pageId:c.pageId,source:c.source,fieldIds:c.fieldIds,fields:c.fields,revision:c.revision,checkedAt:c.checkedAt,hasToken:true});
export async function listBotcakeConnections(){return process.env.VERCEL==='1'&&!hasGroupStorage()?[]:(await all()).map(safeConnection);}
export async function botcakeConnection(pageId:string){const c=(await all()).find(c=>c.pageId===pageId);if(!c)throw new GroupError('Botcake: Page chưa được kết nối hoặc đã gỡ. Chọn lại Page trong mẫu.',403);return c;}
export async function saveBotcakeConnection(body:Record<string,unknown>,deps?:{client:Pick<BotcakeClient,'customers'|'fields'>;store:BotcakeStore}){
 const input=schema.omit({token:true,fields:true,revision:true,checkedAt:true}).safeParse(body);
 if(!input.success||input.data.source!=='profile'&&!input.data.fieldIds.length)throw new GroupError('Botcake: nhập tên kết nối, Page ID, nguồn SĐT và chọn Custom Field cần đọc.');
 const old=(await all()).find(c=>c.id===input.data.id);
 if(old&&body.revision!==old.revision)throw new GroupError('Kết nối Botcake đã thay đổi. Tải lại danh sách trước khi lưu.',409);
 if(old&&old.pageId!==input.data.pageId)throw new GroupError('Botcake: không đổi Page của kết nối cũ. Tạo kết nối riêng cho Page mới.');
 if((await all()).some(c=>c.id!==input.data.id&&c.pageId===input.data.pageId))throw new GroupError('Botcake: Page này đã có kết nối. Chọn kết nối đó để cập nhật.');
 const token=typeof body.token==='string'&&body.token.trim()?body.token.trim():old?.token;
 if(!schema.shape.token.safeParse(token).success)throw new GroupError('Botcake: nhập token của Page; chỉ chuỗi token, không kèm URL hoặc dấu nháy.');
 const client=deps?.client||new BotcakeClient(token!);await client.customers(input.data.pageId);
 let fields:BotcakeConnection['fields']=[];
 try{fields=await client.fields(input.data.pageId);}catch(error){if(input.data.source!=='profile')throw error;}
 if(input.data.source!=='profile'&&input.data.fieldIds.some(id=>!fields.some(f=>f.id===id)))throw new GroupError('Botcake: Custom Field không thuộc Page hoặc đã thay đổi. Tải lại danh sách trường.');
 const store=deps?.store||await botcakeStore();await store.init();
 const saved:BotcakeConnection={...input.data,fieldIds:input.data.source==='profile'?[]:[...new Set(input.data.fieldIds)],token:token!,fields,revision:(old?.revision||0)+1,checkedAt:new Date().toISOString()};
 await updatePrivate<BotcakeConnection[]>('botcake-connections',[],rows=>{
  const at=rows.findIndex(c=>c.id===saved.id);
  if((at>=0)!==!!old||at>=0&&rows[at].revision!==old?.revision)throw new GroupError('Kết nối Botcake vừa được sửa ở cửa sổ khác. Giữ bản chỉnh và tải lại.',409);
  if(rows.some(c=>c.id!==saved.id&&c.pageId===saved.pageId))throw new GroupError('Botcake: Page này đã có kết nối.',409);
  if(at>=0)rows[at]=saved;else{if(rows.length>=20)throw new GroupError('Botcake: tối đa 20 Page đã kết nối.');rows.push(saved);}
 });
 await store.enqueue(saved,true);
 console.info('Botcake connection verified',{id:saved.id});return {connection:safeConnection(saved),connections:await listBotcakeConnections()};
}
export async function inspectBotcakeFields(body:Record<string,unknown>){
 const page=pageIdSchema.safeParse(body.pageId);if(!page.success)throw new GroupError('Botcake: nhập Page ID trước khi tải trường.');
 const existing=(await all()).find(c=>c.pageId===page.data);
 const token=typeof body.token==='string'&&body.token.trim()?body.token.trim():existing?.token;
 if(!token)throw new GroupError('Botcake: nhập token hoặc chọn kết nối đã lưu.');
 const client=new BotcakeClient(token);await client.customers(page.data);return {fields:await client.fields(page.data)};
}
export async function removeBotcakeConnection(body:Record<string,unknown>){
 const old=(await all()).find(c=>c.id===body.id);if(!old||old.revision!==body.revision)throw new GroupError('Kết nối Botcake đã thay đổi. Tải lại trước khi gỡ.',409);
 const registry=await getRegistry();
 if(registry.groups.some(g=>(g.report as {botcake?:{pageIds:string[]}}|undefined)?.botcake?.pageIds.includes(old.pageId)))throw new GroupError('Botcake: bỏ Page khỏi các mẫu báo cáo trước khi gỡ kết nối.');
 await updatePrivate<BotcakeConnection[]>('botcake-connections',[],rows=>{const at=rows.findIndex(c=>c.id===old.id);if(at<0||rows[at].revision!==old.revision)throw new GroupError('Kết nối Botcake đã thay đổi. Tải lại trước khi gỡ.',409);rows.splice(at,1);});
 return {removed:true,connections:await listBotcakeConnections()};
}
export const newBotcakeId=()=> 'botcake-'+randomBytes(8).toString('hex');
