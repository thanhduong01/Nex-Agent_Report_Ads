import {GroupError} from '../groups.ts';
import {pageIdSchema,psidSchema,customerIdSchema,type CustomerFact,type CursorPage,type FieldDefinition,type FieldFact} from './types.ts';
import {phoneValues,utcTime} from './phones.ts';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>new GroupError('Botcake: dữ liệu API không đúng định dạng. Chưa tăng mốc đồng bộ.',502);
function unwrap(v:unknown):unknown{
 for(let i=0;i<3;i++){
  if(!object(v))return v;
  if(v.success===false||Number(v.status_code)>=400)throw new GroupError('Botcake: API chưa hoàn tất yêu cầu. Kiểm tra Page và token.',502);
  if(Object.hasOwn(v,'response'))v=v.response;else return v;
 }
 return v;
}
const data=(v:unknown)=>object(v)&&Object.hasOwn(v,'data')?v.data:v;
function contact(value:unknown):CustomerFact{
 if(!object(value)||!customerIdSchema.safeParse(value.id).success||!psidSchema.safeParse(value.psid).success)throw invalid();
 const adId=typeof value.ad_id==='string'&&/^\d{1,40}$/.test(value.ad_id)?value.ad_id:null;
 return {id:value.id,psid:value.psid,phones:phoneValues(value.phone_number),lastInteractiveAt:utcTime(value.last_interactive_at),adId,
 metadata:Object.hasOwn(value,'last_interactive_at')&&Object.hasOwn(value,'ad_id'),subscribed:typeof value.is_subscribed==='boolean'?value.is_subscribed:null};
}
function cursor(value:unknown):string|null{if(value===null||value===undefined||value==='')return null;if(!customerIdSchema.safeParse(value).success)throw invalid();return value as string;}
function nextCursor(value:unknown,headers:Headers,fallback:string|undefined,previous:string){
 let next:string|null;
 if(headers.has('x-next-after'))next=cursor(headers.get('x-next-after'));
 else if(object(value)&&Object.hasOwn(value,'next_after'))next=cursor(value.next_after);
 else if(object(value)&&object(value.meta)&&Object.hasOwn(value.meta,'next_after'))next=cursor(value.meta.next_after);
 else next=fallback||null;
 if(next&&next===previous)throw new GroupError('Botcake: cursor không tiến lên. Giữ nguyên tiến độ để kiểm tra.',502);
 return next;
}
export class BotcakeClient{
 private readonly token:string;
 constructor(token:string){if(typeof token!=='string'||!token.trim()||token.length>4096||/[\r\n]/.test(token))throw new GroupError('Botcake: nhập token của Page hợp lệ.');this.token=token.trim();}
 private async read(pageId:string,suffix:string,query:Record<string,string>={}){
  if(!pageIdSchema.safeParse(pageId).success)throw new GroupError('Botcake: Page ID chỉ gồm chữ số.');
  const url=new URL('https://botcake.io/api/public_api/v1/pages/'+pageId+'/'+suffix);
  for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
  let response:Response;
  try{response=await fetch(url,{headers:{'access-token':this.token},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});}
  catch{throw new GroupError('Botcake: không kết nối được API. Tiến độ được giữ để thử lại.',503);}
  if(!response.ok){await response.body?.cancel();throw new GroupError(response.status===401||response.status===403?'Botcake: token chưa có quyền truy cập Page. Kiểm tra token và Page ID.':response.status===429?'Botcake: API đang giới hạn lượt gọi. Hệ thống sẽ thử lại.':'Botcake: API tạm lỗi (HTTP '+response.status+'). Tiến độ được giữ để thử lại.',response.status===429?429:502);}
  let value:unknown;
  try{
   const reader=response.body?.getReader();if(!reader)throw invalid();let text='',bytes=0;const decoder=new TextDecoder();
   while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_000_000){await reader.cancel();throw invalid();}text+=decoder.decode(part.value,{stream:true});}
   text+=decoder.decode();value=JSON.parse(text);
  }catch{throw invalid();}
  return {value:unwrap(value),headers:response.headers};
 }
 async customers(pageId:string,after=''):Promise<CursorPage<CustomerFact>>{
  if(after&&!customerIdSchema.safeParse(after).success)throw invalid();
  const {value,headers}=await this.read(pageId,'customer',{after,limit:'100'}),rows=data(value);
  if(!Array.isArray(rows)||rows.length>100)throw invalid();const facts=rows.map(contact);
  return {data:facts,next:nextCursor(value,headers,facts.at(-1)?.id,after)};
 }
 async info(pageId:string,psid:string):Promise<CustomerFact>{
  if(!psidSchema.safeParse(psid).success)throw invalid();
  const {value}=await this.read(pageId,'customer/'+psid+'/info'),fact=contact(data(value));
  if(fact.psid!==psid)throw new GroupError('Botcake: hồ sơ API trả về không khớp khách đang yêu cầu.',502);
  return fact;
 }
 async fields(pageId:string):Promise<FieldDefinition[]>{
  const result:FieldDefinition[]=[];
  for(let page=0;page<20;page++){
   const {value}=await this.read(pageId,'custom_fields',{page:String(page)}),rows=data(value);
   if(!Array.isArray(rows)||rows.length>1000)throw invalid();
   const fresh=rows.map(v=>{if(!object(v)||!Number.isSafeInteger(Number(v.id))||Number(v.id)<1||typeof v.name!=='string'||v.name.length>200)throw invalid();return {id:Number(v.id),name:v.name,type:Number.isInteger(v.type)?v.type:null};});
   if(!fresh.length||fresh.every(f=>result.some(r=>r.id===f.id)))return result;
   result.push(...fresh.filter(f=>!result.some(r=>r.id===f.id)));
   // API custom_fields pages contain 50 rows. Only empty/repeated pages prove completion.
  }
  throw new GroupError('Botcake: quá nhiều Custom Field. Chọn lại nguồn trước khi tiếp tục.',502);
 }
 async fieldValues(pageId:string,fieldId:number,after=''):Promise<CursorPage<FieldFact>>{
  if(!Number.isSafeInteger(fieldId)||fieldId<1||after&&!customerIdSchema.safeParse(after).success)throw invalid();
  const {value,headers}=await this.read(pageId,'custom_field/'+fieldId+'/get_customers_field',{after,limit:'100'}),rows=data(value);
  if(!Array.isArray(rows)||rows.length>100)throw invalid();
  const facts=rows.map((v):FieldFact=>{
   if(!object(v))throw invalid();const id=v.page_customer_id??v.customer_id;
   const customerId=customerIdSchema.safeParse(id).success?String(id):null,psid=psidSchema.safeParse(v.psid).success?String(v.psid):null;
   if(!customerId&&!psid)throw invalid();
   if(typeof v.value!=='string'&&v.value!==null&&!Array.isArray(v.value))throw invalid();
   if(JSON.stringify(v.value).length>4096)throw invalid();
   return {customerId,psid,value:v.value};
  });
  return {data:facts,next:nextCursor(value,headers,facts.at(-1)?.customerId||facts.at(-1)?.psid||undefined,after)};
 }
}
