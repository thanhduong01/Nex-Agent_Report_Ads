import { get, put } from "@vercel/blob";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { GroupError } from "./groups.ts";
import { isBlobConflict, blobWriteFailure } from "./blob-errors.ts";

function paths(name:string) {
  if(!/^[a-z0-9-]{1,64}$/.test(name))throw new GroupError("Không xác định được kho dữ liệu.");
  return {blob:"report-private/"+(process.env.VERCEL_ENV||"production")+"/"+name+".json",
    local:join(process.env.PRIVATE_CONFIG_DIR || dirname(process.env.REPORT_CONFIG_PATH || join(process.cwd(),".data/report-groups.json")),name+".json")};
}
const blobStorage=()=>!!(process.env.BLOB_READ_WRITE_TOKEN||process.env.BLOB_STORE_ID);
async function read<T>(name:string,initial:T):Promise<{value:T;etag?:string}> {
  const path=paths(name);
  if(blobStorage()) {
    const result=await get(path.blob,{access:"private",useCache:false,abortSignal:AbortSignal.timeout(15000)});
    return result?{value:await new Response(result.stream).json() as T,etag:result.blob.etag}:{value:structuredClone(initial)};
  }
  if(process.env.VERCEL==="1")throw new GroupError("Chưa kết nối kho lưu riêng tư cho cấu hình.",503);
  try{return {value:JSON.parse(await readFile(path.local,"utf8")) as T};}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {value:structuredClone(initial)};throw error;}
}
export async function readPrivate<T>(name:string,initial:T):Promise<T> {
  try{return (await read(name,initial)).value;}
  catch(error){if(error instanceof GroupError)throw error;throw new GroupError("Không đọc được kho dữ liệu riêng tư.",503);}
}
const queues=new Map<string,Promise<unknown>>();
export async function updatePrivate<T>(name:string,initial:T,change:(value:T)=>void):Promise<T> {
  const previous=queues.get(name)||Promise.resolve();
  const pending=previous.catch(()=>{}).then(async()=>{
    for(let attempt=0;attempt<3;attempt++) {
      try {
        const {value,etag}=await read(name,initial);change(value);const content=JSON.stringify(value),path=paths(name);
        if(blobStorage())await put(path.blob,content,{access:"private",addRandomSuffix:false,allowOverwrite:!!etag,
          ...(etag?{ifMatch:etag}:{}),contentType:"application/json",abortSignal:AbortSignal.timeout(15000)});
        else {
          await mkdir(dirname(path.local),{recursive:true,mode:0o700});
          const temporary=path.local+"."+randomUUID();
          await writeFile(temporary,content,{mode:0o600});await rename(temporary,path.local);
        }
        return value;
      } catch(error) {
        if(isBlobConflict(error)) {
          if(attempt<2)continue;
          throw new GroupError("Cấu hình đang được cập nhật. Thử lại sau.",409);
        }
        if(error instanceof GroupError)throw error;
        const failure=blobWriteFailure(error);
        console.warn("Private configuration write failed",{reason:failure.code});
        throw new GroupError(failure.message,503);
      }
    }
    throw new GroupError("Cấu hình đang được cập nhật. Thử lại sau.",409);
  });
  queues.set(name,pending);
  try{return await pending;}finally{if(queues.get(name)===pending)queues.delete(name);}
}
