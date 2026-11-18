import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {put} from '@vercel/blob';
import {z} from 'zod';
import {hasGroupStorage} from './groups.ts';
import {readBlobJson} from './blob-json.ts';
import {botToken} from './telegram-token.ts';
import {resolvePeriod} from './report-period.ts';
const id=z.string().regex(/^[a-z0-9-]{1,64}$/);
export const reportContextSchema=z.object({groupId:id,from:z.string(),to:z.string(),requestId:id.optional()});
export type MenuReportContext=z.infer<typeof reportContextSchema>;
const intentSchema=z.object({kind:z.enum(['button','period','group','back','custom-date']),buttonId:id,fingerprint:z.string().max(64),value:z.string().max(64).optional()});
export type MenuIntent=z.infer<typeof intentSchema>;
const recordSchema=z.object({context:reportContextSchema,intents:z.array(intentSchema).min(1).max(40),expires:z.number(),owner:z.string(),created:z.number()});
const lifetime=7*86400000;
const owner=()=>process.env.TELEGRAM_CHAT_ID||'';
const signature=(data:string)=>createHmac('sha256',botToken()).update('nex-report/menu/v1\0'+owner()+'\0'+data).digest('base64url').slice(0,16);
const path=(id:string)=>`telegram-menu/${process.env.VERCEL_ENV||'production'}/${id}.json`;
const localDir=()=>process.env.TELEGRAM_MENU_DIR||resolve(process.cwd(),'.data/telegram-menu');
export async function saveMenuContext(context:MenuReportContext,intents:MenuIntent[],now=Date.now()):Promise<string[]>{
 const range=resolvePeriod(context.to,'today',context.from);if(!owner())throw new Error('Chưa cấu hình chat.');
 const record=recordSchema.parse({context:{...context,...range, to:range.to},intents,created:now,expires:now+lifetime,owner:signature('owner')});
 // Keep only references, never report text, financial data or credentials.
 const id=randomBytes(16).toString('base64url');
 const tokens=intents.map((_,index)=>{const data=`n1.${id}.${index.toString(36)}`;return data+'.'+signature(data);});
 if(hasGroupStorage())await put(path(id),JSON.stringify(record),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',abortSignal:AbortSignal.timeout(15000)});
 else if(process.env.VERCEL==='1')throw new Error('Chưa có kho lưu nút Telegram.');
 else {await mkdir(localDir(),{recursive:true});await writeFile(resolve(localDir(),id+'.json'),JSON.stringify(record),{flag:'wx',mode:0o600});}
 return tokens;
}
export async function readMenuCallback(token:string,now=Date.now()):Promise<{context:MenuReportContext;intent:MenuIntent}|null>{
 if(typeof token!=='string'||Buffer.byteLength(token)>64)return null;
 const match=/^(n1\.([A-Za-z0-9_-]{22})\.([0-9a-z]{1,2}))\.([A-Za-z0-9_-]{16})$/.exec(token);
 if(!match||!owner())return null;
 const expected=signature(match[1]);if(!timingSafeEqual(Buffer.from(expected),Buffer.from(match[4])))return null;
 let data:unknown;
 if(hasGroupStorage())data=(await readBlobJson(path(match[2])))?.value;
 else if(process.env.VERCEL==='1')return null;
 else {try{data=JSON.parse(await readFile(resolve(localDir(),match[2]+'.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('Không đọc được nút Telegram.');}}
 const parsed=recordSchema.safeParse(data);if(!parsed.success)return null;
 const r=parsed.data,index=parseInt(match[3],36);
 if(r.owner!==signature('owner')||r.expires<=now||r.created>now+60000||!r.intents[index])return null;
 try{resolvePeriod(r.context.to,'today',r.context.from);}catch{return null;}
 return {context:r.context,intent:r.intents[index]};
}
