import type {TelegramCallbackQuery} from 'eve/channels/telegram';
import {getRegistry,GroupError,type Registry} from './groups.ts';
import {readMenuCallback,type MenuReportContext,type MenuIntent} from './telegram-menu-context.ts';
import {defaultMenu,buttonFingerprint,requestFingerprint,type MenuButton} from './telegram-menu-config.ts';
import {contextGroups,intentKeyboard,reportKeyboard,safeReportKeyboard,supportedButton,type InlineKeyboard} from './telegram-menu.ts';
import {allowedTelegramMessage} from './telegram-commands.ts';
import {deliverOnce,deliveryKey,telegramSend,DeliveryError,type DeliveryStore} from './delivery.ts';
import {prepareReport} from './job.ts';
import {formatRequestReport,groupsForRequest} from './request-actions.ts';
import {resolveRequest} from './request-config.ts';
import {resolvePeriod} from './report-period.ts';
import {vietnamDate} from './schedule-config.ts';
import {formatMetric,type ReportOptions} from './report-service.ts';
import {APP_NAME} from './brand.ts';
import {recordReportRun} from './report-history.ts';
import {recordTelegramTraffic} from './telegram-traffic.ts';
import {limitAdminOperation} from './admin-rate-limit.ts';
import type {Report} from './report.ts';
const expired='Nút này đã hết hạn hoặc cấu hình đã thay đổi. Nhắn /help rồi lấy báo cáo mới.';
type Query=Pick<TelegramCallbackQuery,'id'|'data'|'from'|'message'>;
type Prepare=(date:string,groupId:string,options:ReportOptions)=>ReturnType<typeof prepareReport>;
type Dependencies={registry?:()=>Promise<Registry>;store?:DeliveryStore;prepare?:Prepare;send?:(text:string,keyboard?:InlineKeyboard)=>Promise<number>};
type Reply={text:string;keyboard?:InlineKeyboard;report?:Report};
const n=(value:number|null|undefined)=>value==null?'Chưa đủ dữ liệu':value.toLocaleString('vi-VN',{maximumFractionDigits:2});
export function renderReportView(action:string,report:Report):string{
 const titles:Record<string,string>={campaigns:'CAMPAIGN',products:'SẢN PHẨM BÁN CHẠY',reconciliation:'ĐỐI SOÁT',insights:'NHẬN ĐỊNH'};
 let lines:string[]=[];const sales=report.sales;
 if(action==='campaigns'){
  lines=sales?sales.campaigns.slice(0,10).map(c=>`${c.name}\nChi phí: ${n(c.cost)} ${report.currency||'VND'} · Tin nhắn: ${n(c.messages)}\nĐơn khớp: ${n(c.orders)} · Doanh thu khớp: ${n(c.revenue)} · CPA: ${n(c.cpa)} · ROAS: ${n(c.roas)}`)
   :(report.rowMetricValues||[]).slice(0,10).map(row=>row.name+'\n'+(row.metrics.map(m=>m.name+': '+formatMetric(m,report.currency)).join(' · ')||'Mẫu chưa chọn chỉ số áp dụng cho campaign.'));
  if(report.sourceKind==='sheets')throw new GroupError('Nhóm này không có dữ liệu campaign Meta.');
 }else{
  if(!sales)throw new GroupError('Nhóm này chưa dùng nguồn Pancake POS.');
  if(action==='products')lines=sales.products.slice(0,10).map((p,i)=>`${i+1}. ${p.name}${p.sku?' · '+p.sku:''}\n${n(p.units)} sản phẩm · ${n(p.orders)} đơn · ${n(p.revenue)} ${report.currency||'VND'}`);
  else if(action==='insights')lines=sales.signals.slice(0,8).map(s=>s.title+' — '+s.detail);
  else if(action==='reconciliation')lines=[`${n(sales.attribution.matchedOrders)} đơn khớp · ${n(sales.attribution.unmatchedOrders)} đơn chưa gán\nTỷ lệ khớp: ${sales.attribution.coverage===null?'Chưa đủ dữ liệu':n(sales.attribution.coverage*100)+'%'}`,
   `Cơ sở: ${sales.basis==='confirmed'?'Đã xác nhận':'Đã giao'} · Theo ngày tạo đơn`,
   ...(sales.statusCounts||[]).filter(s=>s.count>0).map(s=>`${s.label} [${s.code}]: ${s.count}`),
   ...Object.entries(sales.attribution.reasons).filter(([,count])=>count>0).map(([reason,count])=>`${reason}: ${count}`)];
  else throw new GroupError('Không tìm thấy hành động của nút.');
 }
 const warnings=[...(sales&&!sales.complete?['Dữ liệu đang đồng bộ; chưa đủ cho toàn kỳ.']:[]),...(sales?.quality.warnings||[])];
 return [APP_NAME,`${titles[action]} · ${report.groupName||''}`,`${report.range?.from||report.date} → ${report.range?.to||report.date}`,'',...(lines.length?lines:['Chưa có dữ liệu phù hợp trong kỳ.']),...warnings.map(w=>'Lưu ý: '+w),`Đọc lúc: ${new Date(report.fetchedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`].join('\n\n');
}
function checkedButton(registry:Registry,context:MenuReportContext,intent:MenuIntent){
 const menu=registry.telegramMenu||defaultMenu();
 const button=menu.buttons.find(b=>b.id===intent.buttonId&&b.enabled);
 const group=contextGroups(registry,context).find(g=>g.id===context.groupId);
 if(!menu.enabled||!button||buttonFingerprint(button)!==intent.fingerprint||!group||!supportedButton(button,group,registry,context))throw new GroupError(expired);
 return button;
}
function back(button:MenuButton){return {text:'↩️ Về báo cáo',fullRow:true,intent:{kind:'back',buttonId:button.id,fingerprint:buttonFingerprint(button)} as MenuIntent};}
async function execute(context:MenuReportContext,intent:MenuIntent,registry:Registry,prepare:Prepare):Promise<Reply>{
 const button=checkedButton(registry,context,intent),action=button.action;
 const rule=context.requestId?registry.requests.find(r=>r.id===context.requestId&&r.enabled):undefined;
 if(context.requestFingerprint&&rule&&requestFingerprint(rule)!==context.requestFingerprint)throw new GroupError(expired);
 if(intent.kind==='back')return {text:'Chọn thao tác cho báo cáo này.',keyboard:await reportKeyboard(context,registry)};
 if(intent.kind==='custom-date'){
  if(action!=='dates'||rule&&!rule.allowDate)throw new GroupError('Yêu cầu đã thay đổi và không cho chọn ngày.');
  const chosen=rule||registry.requests.find(r=>r.enabled&&r.allowDate&&groupsForRequest(registry.groups,r).some(g=>g.id===context.groupId));
  const safeId=!['all','tat-ca'].includes(context.groupId);
  // Repeat the date for one-day commands: the old parser can then accept UUIDs beginning with a digit.
  return {text:chosen&&safeId?`Nhắn lệnh sau, thay cả hai ngày giống nhau để xem một ngày:
/${chosen.command} DD/MM/YYYY DD/MM/YYYY ${context.groupId}

Hoặc thay hai ngày khác nhau để xem một khoảng. Dùng mã nhóm ở cuối lệnh.`:'Chọn ngày trên web trong Mẫu & chỉ số, hoặc bật yêu cầu cho phép chọn ngày cho nhóm này.',keyboard:await reportKeyboard(context,registry)};
 }
 if(intent.kind==='period'){
  if(action!=='dates'||rule&&!rule.allowDate||!['today','yesterday','last7','month'].includes(intent.value||''))throw new GroupError('Yêu cầu đã thay đổi và không cho chọn ngày.');
  const range=resolvePeriod(vietnamDate(),intent.value as 'today');context={...context,...range,legacy:!registry.groups.find(g=>g.id===context.groupId)?.report&&range.from===range.to};
 }else if(intent.kind==='group'){
  if(action!=='groups'||!contextGroups(registry,context).some(g=>g.id===intent.value))throw new GroupError(expired);
  context={...context,groupId:intent.value!,legacy:intent.value===context.groupId?context.legacy:!registry.groups.find(g=>g.id===intent.value)?.report&&context.from===context.to};
 }else if(intent.kind==='button'){
  if(action==='dates')return {text:'Chọn kỳ báo cáo · Giờ Việt Nam',keyboard:await intentKeyboard(context,[...[
   ['today','📆 Hôm nay'],['yesterday','📅 Hôm qua'],['last7','📊 7 ngày gần nhất'],['month','🗓 Tháng này'],
  ].map(([value,text])=>({text,intent:{kind:'period',value,buttonId:button.id,fingerprint:intent.fingerprint} as MenuIntent})),
  {text:'✍️ Nhập ngày khác',fullRow:true,intent:{...intent,kind:'custom-date'}},back(button)],2)};
  if(action==='groups')return {text:'Chọn nhóm · Giữ nguyên khoảng ngày',keyboard:await intentKeyboard(context,[...contextGroups(registry,context).map(g=>({text:g.name,fullRow:true,intent:{kind:'group',buttonId:button.id,fingerprint:intent.fingerprint,value:g.id} as MenuIntent})),back(button)],1)};
  if(action==='request'){
   const target=registry.requests.find(r=>r.id===button.requestId&&r.enabled);if(!target)throw new GroupError(expired);
   const groupId=button.groupMode==='fixed'?button.groupId!:context.groupId;
   if(!groupsForRequest(registry.groups,target,groupId).length)throw new GroupError(expired);
   if(!target.allowDate&&button.dateMode!=='request')throw new GroupError('Yêu cầu không cho chọn ngày. Cập nhật nút trên web.');
   if(button.dateMode==='request'){
    const resolved=resolveRequest([target],'/'+target.command)!;
    const group=registry.groups.find(g=>g.id===groupId)!;
    context={groupId,requestId:target.id,requestFingerprint:requestFingerprint(target),legacy:!group.report&&!resolved.from&&!resolved.templatePeriod,...resolvePeriod(resolved.date,resolved.templatePeriod?group.report?.period||'today':'today',resolved.from)};
   }else {
    const range=button.dateMode==='current'?{from:context.from,to:context.to}:resolvePeriod(vietnamDate(),button.dateMode);
    context={...context,...range,groupId,requestId:target.id,requestFingerprint:requestFingerprint(target),legacy:!registry.groups.find(g=>g.id===groupId)?.report&&range.from===range.to};
   }
  }
 }else throw new GroupError(expired);
 const currentRule=context.requestId?registry.requests.find(r=>r.id===context.requestId&&r.enabled):undefined;
 if(!contextGroups(registry,context).some(g=>g.id===context.groupId))throw new GroupError(expired);
 const legacy=context.legacy??!registry.groups.find(g=>g.id===context.groupId)?.report;
 const options:ReportOptions={...(legacy&&context.from===context.to?{}:{from:context.from}),summary:currentRule?.format==='summary'};
 const prepared=await prepare(context.to,context.groupId,options);
 const view=intent.kind==='button'&&['campaigns','products','reconciliation','insights'].includes(action);
 const text=view?renderReportView(action,prepared.report):currentRule?formatRequestReport(currentRule,prepared.report,prepared.text):prepared.text;
 return {text,report:prepared.report,keyboard:await safeReportKeyboard(context,registry)};
}
export async function handleTelegramCallback(query:Query,acknowledge:(text?:string)=>Promise<unknown>,deps:Dependencies={}){
 const allowed=!!query.message&&allowedTelegramMessage({chat:query.message.chat,from:query.from});
 // Never let an expired Telegram acknowledgement prevent the actual safe action.
 try{await acknowledge(allowed?'Đang xử lý…':'Nút chỉ dùng trong chat riêng đã kết nối.');}catch{/* Already answered/expired. */}
 if(!allowed){await recordTelegramTraffic('ignored','sender-mismatch');return;}
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(query.id))return;
 let partial=false;
 try{
  const send=deps.send||telegramSend;let reply:Reply|undefined;
  const result=await deliverOnce(deliveryKey('telegram','callback-'+query.id),async()=>{
   try{
    limitAdminOperation('telegram-callback',40);
    const decoded=await readMenuCallback(query.data||'');if(!decoded)throw new GroupError(expired);
    reply=await execute(decoded.context,decoded.intent,await (deps.registry||getRegistry)(),deps.prepare||prepareReport);
   }catch(error){reply={text:error instanceof GroupError?error.message:'Chưa đọc được báo cáo. Kiểm tra nguồn dữ liệu trên web rồi thử lấy báo cáo mới.'};}
   return reply.text;
  },deps.store,async text=>{
   // Only the final chunk carries controls. Keep chunk boundaries compatible with old command replies.
   const chunks=text.match(/[\s\S]{1,3900}/g)||[];let messageId=0;
   for(let i=0;i<chunks.length;i++){
    let part;
    try{part=await deliverOnce(deliveryKey('telegram','callback-'+query.id+'-part-'+i),chunks[i],deps.store,
     chunk=>send(chunk,i===chunks.length-1?reply?.keyboard:undefined));}
    catch(error){if(i>0){partial=true;throw new DeliveryError('Báo cáo gửi được một phần.',false);}throw error;}
    if(part.status==='sent')messageId=part.messageId;
   }
   return messageId;
  });
  if(result.status==='sent'&&reply?.report){const r=reply.report;await recordReportRun({groupId:r.groupId||'default',groupName:r.groupName||'Báo cáo',from:r.range?.from||r.date,to:r.range?.to||r.date,source:r.sourceKind||'sheets',status:'sent',mode:'bot'});}
  await recordTelegramTraffic(result.status==='sent'?'sent':'duplicate');
 }catch{
  if(partial)try{await deliverOnce(deliveryKey('telegram','callback-'+query.id+'-recovery'),
   'Báo cáo chỉ gửi được một phần. Nhắn lại lệnh báo cáo từ /help để lấy bản mới đầy đủ; bot sẽ không ghép hai lần đọc dữ liệu.',deps.store,deps.send||telegramSend);}catch{/* The transport is still unavailable; never retry the partial report automatically. */}
  await recordTelegramTraffic('failed','delivery-uncertain');console.warn('Chưa hoàn tất nút Telegram; kiểm tra lịch sử gửi trước khi thử lại.');}
}
