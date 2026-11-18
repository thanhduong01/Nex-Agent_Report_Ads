import {getRegistry,type Registry,type ReportGroup} from './groups.ts';
import {defaultMenu,buttonFingerprint,requestFingerprint,layoutButtons,type MenuButton} from './telegram-menu-config.ts';
import {saveMenuContext,type MenuReportContext,type MenuIntent} from './telegram-menu-context.ts';
import {groupsForRequest} from './request-actions.ts';
import {productionOrigin} from './telegram-setup.ts';
export type InlineButton={text:string;callback_data:string}|{text:string;url:string};
export type InlineKeyboard={inline_keyboard:InlineButton[][]};
export function contextGroups(registry:Registry,context:MenuReportContext):ReportGroup[]{
 const rule=context.requestId?registry.requests.find(r=>r.id===context.requestId&&r.enabled):undefined;
 if(context.requestId&&!rule)return [];
 return rule?groupsForRequest(registry.groups,rule):registry.groups.filter(g=>Object.keys(g.sources).length||(g.report&&g.report.source!=='sheets'));
}
export function supportedButton(button:MenuButton,group:ReportGroup,registry:Registry,context:MenuReportContext){
 const source=group.report?.source||'sheets';
 if(button.action==='campaigns'&&source==='sheets')return false;
 if(['products','reconciliation','insights'].includes(button.action)&&source!=='pancake')return false;
 if(button.action==='dates'&&context.requestId&&!registry.requests.find(r=>r.id===context.requestId)?.allowDate)return false;
 if(button.action==='request'){
  const rule=registry.requests.find(r=>r.id===button.requestId&&r.enabled);
  if(!rule)return false;
  try{if(!groupsForRequest(registry.groups,rule,button.groupMode==='fixed'?button.groupId:context.groupId).length)return false;}catch{return false;}
 }
 return true;
}
export function reportWebUrl(context:MenuReportContext,section='report'){
 let origin:string;try{origin=productionOrigin();}catch{return undefined;}
 const params=new URLSearchParams({group:context.groupId,date:context.to,...(context.legacy&&context.from===context.to?{}:{from:context.from})});
 return `${origin}/?${params}#${section}`;
}
export async function intentKeyboard(context:MenuReportContext,items:{text:string;intent:MenuIntent;fullRow?:boolean}[],columns=2):Promise<InlineKeyboard>{
 const tokens=await saveMenuContext(context,items.map(i=>i.intent));
 const buttons=items.map((item,i)=>({text:item.text,callback_data:tokens[i],fullRow:item.fullRow}));
 return {inline_keyboard:layoutButtons(buttons,columns).map(row=>row.map(({fullRow,...b})=>b))};
}
export async function reportKeyboard(context:MenuReportContext,registry?:Registry):Promise<InlineKeyboard|undefined>{
 const config=registry||await getRegistry(),menu=config.telegramMenu||defaultMenu();
 if(!menu.enabled)return undefined;
 const group=contextGroups(config,context).find(g=>g.id===context.groupId);if(!group)return undefined;
 const rule=context.requestId?config.requests.find(r=>r.id===context.requestId):undefined;
 if(rule)context={...context,requestFingerprint:requestFingerprint(rule)};
 const chosen=menu.buttons.filter(b=>b.enabled&&supportedButton(b,group,config,context));
 const callbacks=chosen.filter(b=>!['url','web','settings'].includes(b.action));
 const tokens=callbacks.length?await saveMenuContext(context,callbacks.map(b=>({kind:'button',buttonId:b.id,fingerprint:buttonFingerprint(b)}))):[];
 let cursor=0;
 const buttons=chosen.flatMap<InlineButton & {fullRow:boolean}>(b=>{
  if(['url','web','settings'].includes(b.action)){
   const url=b.action==='url'?b.url:reportWebUrl(context,b.action==='settings'?'settings':'report');
   return url?[{text:b.label,url,fullRow:b.fullRow}]:[];
  }
  return [{text:b.label,callback_data:tokens[cursor++],fullRow:b.fullRow}];
 });
 if(!buttons.length)return undefined;
 return {inline_keyboard:layoutButtons(buttons,menu.columns).map(row=>row.map(({fullRow,...b})=>b))};
}
// Adding buttons must never make a previously deliverable report fail.
export async function safeReportKeyboard(context:MenuReportContext,registry?:Registry){
 try{return await reportKeyboard(context,registry);}catch{console.warn('Chưa tạo được nút Telegram; vẫn gửi nội dung báo cáo.');return undefined;}
}
