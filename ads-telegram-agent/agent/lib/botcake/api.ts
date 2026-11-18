import {databaseHealth} from "../pancake/database.ts";
import {z} from 'zod';
import {GroupError} from '../groups.ts';
import {botcakeStore} from './store.ts';
import {botcakeConnection,listBotcakeConnections,saveBotcakeConnection,inspectBotcakeFields,removeBotcakeConnection} from './connections.ts';
import {pageIdSchema} from './types.ts';
import {syncBotcake} from './sync.ts';
import {resolvePeriod} from '../report-period.ts';
import {vietnamDate} from '../schedule-config.ts';
export async function botcakeAction(body:Record<string,unknown>){
 if(body.action==='health'){const database=await databaseHealth();let ready=false;if(database.connected)try{await (await botcakeStore()).init();ready=true;}catch{console.warn('Botcake database readiness failed');}return {database,ready,message:ready?'Kho SĐT Botcake đã sẵn sàng.':database.connected?'Chưa tạo được kho SĐT. Kiểm tra quyền database và kho cấu hình riêng tư.':database.message};}
 if(body.action==='list')return {connections:await listBotcakeConnections()};
 if(body.action==='save')return saveBotcakeConnection(body);
 if(body.action==='fields')return inspectBotcakeFields(body);
 if(body.action==='remove')return removeBotcakeConnection(body);
 const p=pageIdSchema.safeParse(body.pageId);if(!p.success)throw new GroupError('Botcake: chọn Page đã kết nối.');
 await botcakeConnection(p.data);
 if(body.action==='sync')return {status:await syncBotcake(p.data)};
 const store=await botcakeStore();
 if(body.action==='status')return {status:await store.status(p.data)};
 if(body.action==='ledger'){
  const parsed=z.object({from:z.string(),to:z.string(),page:z.number().int().min(0).max(100).default(0)}).safeParse({from:body.from||vietnamDate(),to:body.to||vietnamDate(),page:body.page});
  if(!parsed.success)throw new GroupError('Botcake: kiểm tra ngày và trang danh sách SĐT.');
  const range=resolvePeriod(parsed.data.to,'today',parsed.data.from);
  return {ledger:await store.ledger([p.data],range,parsed.data.page*50),status:await store.status(p.data)};
 }
 throw new GroupError('Không tìm thấy thao tác Botcake.',404);
}
