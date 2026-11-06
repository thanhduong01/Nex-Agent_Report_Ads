import { z } from "zod";
import { GroupError, getRegistry, hasGroupStorage } from "./groups.ts";
import { readPrivate, updatePrivate } from "./private-store.ts";
import { validateDate } from "./report.ts";

export const metaVersion="v26.0";
const accountSchema=z.object({id:z.string().regex(/^act_\d{1,30}$/),name:z.string().max(200),
  currency:z.string().regex(/^[A-Z]{3}$/),timezone_name:z.string().min(1).max(100)});
const connectionSchema=z.object({id:z.string().regex(/^[a-z0-9-]{1,64}$/),name:z.string().trim().min(1).max(80),
  token:z.string().regex(/^[A-Za-z0-9_-]{20,4096}$/),accounts:z.array(accountSchema).max(100),checkedAt:z.string()});
type Connection=z.infer<typeof connectionSchema>;
type Account=z.infer<typeof accountSchema>;
const safeConnection=(value:Connection)=>({id:value.id,name:value.name,accounts:value.accounts,checkedAt:value.checkedAt,hasToken:true});
async function stored() {
  const value=await readPrivate<unknown>("meta-connections",[]);
  const parsed=z.array(connectionSchema).max(20).safeParse(value);
  if(!parsed.success)throw new GroupError("Không đọc được cấu hình kết nối Meta đã lưu.",503);
  return parsed.data;
}
export async function listMetaConnections() {
  if(process.env.VERCEL==="1"&&!hasGroupStorage())return [];
  return (await stored()).map(safeConnection);
}
async function connection(id:string) {
  const value=(await stored()).find(item=>item.id===id);
  if(!value)throw new GroupError("Chưa có kết nối Meta này. Lưu hoặc chọn lại kết nối.");
  return value;
}
async function graph(token:string,path:string,params:Record<string,string>={}) {
  const url=new URL("https://graph.facebook.com/"+metaVersion+"/"+path);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  for(let attempt=0;attempt<2;attempt++) {
    let response:Response;
    try {response=await fetch(url,{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(20000),redirect:"error",cache:"no-store"});}
    catch {throw new GroupError("Meta: không kết nối được API. Thử lại sau.",503);}
    if((response.status===429||response.status>=500)&&attempt===0) {await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,350));continue;}
    let body:{data?:unknown[];paging?:{next?:string};error?:{code?:number};[key:string]:unknown};
    try {
      const text=await response.text();if(text.length>4_000_000)throw new Error();
      body=JSON.parse(text);
    }catch{throw new GroupError("Meta: phản hồi không hợp lệ hoặc quá lớn.",502);}
    if(!response.ok||body.error) {
      const code=typeof body.error?.code==="number"?body.error.code:undefined;
      console.warn("Meta API request rejected",{status:response.status,code:typeof code==="number"?code:null});
      if(code===190)throw new GroupError("Meta: token hết hạn hoặc không hợp lệ. Kết nối lại nguồn.",400);
      if(code===10||code===200)throw new GroupError("Meta: chưa có quyền đọc tài khoản hoặc chỉ số này.",403);
      throw new GroupError("Meta: API từ chối yêu cầu. Kiểm tra quyền, chỉ số và tài khoản (mã "+(code||response.status)+").",400);
    }
    return body;
  }
  throw new GroupError("Meta: tạm thời giới hạn truy cập. Thử lại sau.",429);
}
async function collection(token:string,path:string,params:Record<string,string>={}) {
  const rows:unknown[]=[];const seen=new Set<string>();let query:Record<string,string>={...params,limit:"200"};
  for(let page=0;page<50;page++) {
    const body=await graph(token,path,query);
    if(!Array.isArray(body.data))throw new GroupError("Meta: phản hồi danh sách không hợp lệ.",502);
    rows.push(...body.data);if(rows.length>10000)throw new GroupError("Meta: báo cáo quá lớn. Thu hẹp khoảng ngày hoặc campaign.");
    if(!body.paging?.next)return rows;
    let next:URL;
    try{next=new URL(body.paging.next);}catch{throw new GroupError("Meta: đường dẫn phân trang không hợp lệ.",502);}
    const samePath=next.pathname==="/"+metaVersion+"/"+path;
    const canonicalMe=path==="me/adaccounts"&&new RegExp("^/"+metaVersion.replace(".","\\.")+"/\\d+/adaccounts$").test(next.pathname);
    if(next.origin!=="https://graph.facebook.com"||next.username||next.password||(!samePath&&!canonicalMe))
      throw new GroupError("Meta: từ chối đường dẫn phân trang ngoài phạm vi.",502);
    next.searchParams.delete("access_token");next.searchParams.delete("appsecret_proof");
    if(seen.has(next.toString()))throw new GroupError("Meta: phân trang lặp lại.",502);
    seen.add(next.toString());
    const cursor=next.searchParams.get("after"),before=next.searchParams.get("before"),offset=next.searchParams.get("offset");
    if(!cursor&&!before&&!(offset&&/^\d+$/.test(offset)))throw new GroupError("Meta: phản hồi phân trang thiếu con trỏ.",502);
    query={...params,limit:"200",...(cursor?{after:cursor}:before?{before}:{offset:offset!})};
  }
  throw new GroupError("Meta: quá nhiều trang. Thu hẹp báo cáo.");
}
export async function metaAction(body:Record<string,unknown>) {
  if(process.env.VERCEL==="1"&&!hasGroupStorage())throw new GroupError("Kết nối kho Vercel Blob riêng tư trước khi lưu nguồn Meta.",503);
  const base=z.object({id:connectionSchema.shape.id,name:connectionSchema.shape.name}).safeParse(body);
  if(!base.success)throw new GroupError("Nhập tên và mã kết nối Meta hợp lệ.");
  if(body.remove===true) {
    const registry=await getRegistry();
    if(registry.groups.some(group=>group.report?.connectionId===base.data.id))throw new GroupError("Kết nối đang được dùng trong mẫu báo cáo. Đổi nguồn của mẫu trước khi xóa.");
    await updatePrivate<Connection[]>("meta-connections",[],items=>{const at=items.findIndex(item=>item.id===base.data.id);if(at>=0)items.splice(at,1);});
    console.info("Meta connection removed",{id:base.data.id});
    return {connections:await listMetaConnections()};
  }
  const old=(await stored()).find(item=>item.id===base.data.id);
  const parsed=connectionSchema.shape.token.safeParse(typeof body.token==="string"&&body.token.trim()?body.token.trim():old?.token);
  if(!parsed.success)throw new GroupError("Nhập token Meta hợp lệ: chỉ chuỗi token, không kèm URL hoặc dấu nháy.");
  const token=parsed.data;
  const raw=await collection(token,"me/adaccounts",{fields:"id,name,currency,timezone_name"});
  const accounts=z.array(accountSchema).max(100).safeParse(raw);
  if(!accounts.success||!accounts.data.length)throw new GroupError("Meta: token chưa đọc được tài khoản quảng cáo nào. Kiểm tra quyền ads_read và tài sản đã cấp.");
  const saved:Connection={...base.data,token,accounts:accounts.data,checkedAt:new Date().toISOString()};
  await updatePrivate<Connection[]>("meta-connections",[],items=>{
    const at=items.findIndex(item=>item.id===saved.id);
    if(at<0){if(items.length>=20)throw new GroupError("Tối đa 20 kết nối Meta.");items.push(saved);}else items[at]=saved;
  });
  console.info("Meta connection verified",{id:saved.id,accounts:saved.accounts.length});
  return {connections:await listMetaConnections()};
}
async function accessible(id:string,accountId:string):Promise<{saved:Connection;account:Account}> {
  const saved=await connection(id),account=saved.accounts.find(account=>account.id===accountId);
  if(!account)throw new GroupError("Meta: tài khoản không thuộc kết nối được chọn.",403);
  return {saved,account};
}
export async function metaCampaigns(connectionId:string,accountId:string) {
  const {saved}=await accessible(connectionId,accountId);
  const rows=await collection(saved.token,accountId+"/campaigns",{fields:"id,name,effective_status"});
  const parsed=z.array(z.object({id:z.string().regex(/^\d{1,30}$/),name:z.string().max(300),effective_status:z.string().optional()})).safeParse(rows);
  if(!parsed.success)throw new GroupError("Meta: danh sách campaign không hợp lệ.",502);
  return parsed.data;
}
type MetaScope={connectionId:string;accountId:string;campaignIds:string[];messageAction:string};
export async function readMetaInsights(scope:MetaScope,range:{from:string;to:string}) {
  validateDate(range.from);validateDate(range.to);
  const {saved,account}=await accessible(scope.connectionId,scope.accountId);
  const campaigns=await metaCampaigns(scope.connectionId,scope.accountId);
  if(scope.campaignIds.some(id=>!campaigns.some(campaign=>campaign.id===id)))throw new GroupError("Meta: campaign không còn thuộc tài khoản đã chọn. Kiểm tra lại phạm vi.");
  const raw=await collection(saved.token,scope.accountId+"/insights",{
    fields:"campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions,action_values",
    level:"campaign",time_range:JSON.stringify({since:range.from,until:range.to}),
    use_unified_attribution_setting:"true",action_report_time:"impression",
    ...(scope.campaignIds.length?{filtering:JSON.stringify([{field:"campaign.id",operator:"IN",value:scope.campaignIds}])}:{})
  });
  const numeric=(value:unknown):number|null=>{if(typeof value!=="string"&&typeof value!=="number")return null;const number=Number(value);return value!==""&&Number.isFinite(number)&&number>=0?number:null;};
  const action=(value:unknown,names:string[]):number|null=>{
    if(value===undefined)return 0;
    if(!Array.isArray(value))return null;
    for(const name of names){const item=value.find(item=>item&&typeof item==="object"&&item.action_type===name);if(item)return numeric(item.value);}
    return 0;
  };
  const campaignRows=new Set<string>();
  const rows=raw.map(value=>{
    if(!value||typeof value!=="object")throw new GroupError("Meta: dòng báo cáo không hợp lệ.",502);
    const row=value as Record<string,unknown>;
    if(typeof row.campaign_id!=="string"||!campaigns.some(campaign=>campaign.id===row.campaign_id)||
      (scope.campaignIds.length&&!scope.campaignIds.includes(row.campaign_id)))throw new GroupError("Meta: kết quả nằm ngoài campaign được chọn.",502);
    if(campaignRows.has(row.campaign_id))throw new GroupError("Meta: campaign bị lặp trong báo cáo. Thử lại với phạm vi hẹp hơn.",502);
    campaignRows.add(row.campaign_id);
    return {id:row.campaign_id,name:typeof row.campaign_name==="string"?row.campaign_name:"Campaign "+row.campaign_id,
      cost:numeric(row.spend),messages:action(row.actions,[scope.messageAction]),
      metrics:{hien_thi:numeric(row.impressions),nhap_lien_ket:numeric(row.inline_link_clicks),
        lead:action(row.actions,["lead","offsite_conversion.fb_pixel_lead"]),
        don_hang:action(row.actions,["purchase","offsite_conversion.fb_pixel_purchase"]),
        doanh_thu:action(row.action_values,["purchase","offsite_conversion.fb_pixel_purchase"])}};
  });
  return {rows,currency:account.currency,timeZone:account.timezone_name,
    sourceUrl:"https://adsmanager.facebook.com/adsmanager/manage/campaigns?act="+scope.accountId.slice(4)};
}
