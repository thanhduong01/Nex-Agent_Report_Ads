import {getRegistry,updateRegistry,GroupError,type Registry} from './groups.ts';
import {menuSchema,type TelegramMenu} from './telegram-menu-config.ts';

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
