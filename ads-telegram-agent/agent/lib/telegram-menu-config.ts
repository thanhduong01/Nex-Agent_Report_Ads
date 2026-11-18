import {z} from 'zod';
import {createHash} from 'node:crypto';
import {getRegistry,updateRegistry,GroupError,type Registry} from './groups.ts';
const id=z.string().regex(/^[a-z0-9-]{1,64}$/);
export const menuButtonSchema=z.object({
 id:id.max(32),label:z.string().trim().min(1).max(48),enabled:z.boolean(),
 action:z.enum(['refresh','dates','groups','campaigns','products','reconciliation','insights','request','web','settings','url']),
 requestId:id.optional(),groupMode:z.enum(['current','fixed']).default('current'),groupId:id.optional(),
 dateMode:z.enum(['current','request','today','yesterday','last7','month']).default('current'),
 fullRow:z.boolean().default(false),
 url:z.string().max(500).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}).optional(),
}).superRefine((b,ctx)=>{
 if(b.action==='request'&&!b.requestId)ctx.addIssue({code:'custom',message:'Chọn yêu cầu.',path:['requestId']});
 if(b.groupMode==='fixed'&&!b.groupId)ctx.addIssue({code:'custom',message:'Chọn nhóm.',path:['groupId']});
 if(b.action==='url'&&!b.url)ctx.addIssue({code:'custom',message:'Nhập liên kết HTTPS.',path:['url']});
});
export const menuSchema=z.object({enabled:z.boolean(),columns:z.number().int().min(1).max(3),buttons:z.array(menuButtonSchema).max(20)
 .refine(items=>new Set(items.map(b=>b.id)).size===items.length)});
export type MenuButton=z.infer<typeof menuButtonSchema>;
export type TelegramMenu=z.infer<typeof menuSchema>;
export function defaultMenu():TelegramMenu {
 return menuSchema.parse({enabled:true,columns:2,buttons:[
  ['refresh','🔄 Cập nhật'],['dates','📅 Chọn ngày'],['campaigns','📣 Campaign'],['products','📦 Sản phẩm'],
  ['reconciliation','🔎 Đối soát'],['insights','💡 Nhận định'],['groups','🗂 Đổi nhóm'],['settings','⚙️ Cài lịch gửi'],['web','🌐 Mở báo cáo trên web'],
 ].map(([action,label])=>({id:action,action,label,enabled:true,fullRow:action==='web'}))});
}
export function validateMenu(input:unknown,registry:Registry):TelegramMenu {
 const parsed=menuSchema.safeParse(input);
 if(!parsed.success)throw new GroupError('Kiểm tra tên nút, hành động, nhóm và liên kết HTTPS. Tối đa 20 nút, 48 ký tự mỗi tên.');
 for(const b of parsed.data.buttons){
  if(b.action==='request'&&!registry.requests.some(r=>r.id===b.requestId))throw new GroupError('Yêu cầu đã thay đổi. Chọn lại yêu cầu cho nút.');
  if(b.groupMode==='fixed'&&!registry.groups.some(g=>g.id===b.groupId))throw new GroupError('Nhóm đã thay đổi. Chọn lại nhóm cho nút.');
  const rule=registry.requests.find(r=>r.id===b.requestId);
  if(b.action==='request'&&b.groupMode==='fixed'&&rule?.groupMode==='selected'&&!rule.groupIds.includes(b.groupId!))throw new GroupError('Nhóm của nút không thuộc phạm vi yêu cầu.');
  if(b.action==='request'&&rule&&!rule.allowDate&&!['request'].includes(b.dateMode))throw new GroupError('Yêu cầu không cho chọn ngày. Chọn ngày theo yêu cầu đã lưu.');
 }
 return parsed.data;
}
export async function menuAction(body:Record<string,unknown>){
 if(!Number.isInteger(body.revision))throw new GroupError('Tải lại cấu hình trước khi lưu.');
 const registry=await getRegistry(),menu=validateMenu(body.menu,registry);
 const saved=await updateRegistry(body.revision as number,draft=>{draft.telegramMenu=validateMenu(menu,draft);});
 console.info('Đã cập nhật nút Telegram, phiên bản:',saved.revision);
 return {saved:true,revision:saved.revision};
}
export const buttonFingerprint=(button:MenuButton)=>createHash('sha256').update(JSON.stringify(button)).digest('hex').slice(0,24);
export function layoutButtons<T extends {fullRow?:boolean}>(buttons:T[],columns:number):T[][]{
 const rows:T[][]=[];let row:T[]=[];
 for(const b of buttons){if(b.fullRow){if(row.length)rows.push(row);rows.push([b]);row=[];}else{row.push(b);if(row.length===columns){rows.push(row);row=[];}}}
 if(row.length)rows.push(row);return rows;
}
