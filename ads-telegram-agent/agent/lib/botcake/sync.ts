import {GroupError} from '../groups.ts';
import {databaseConfigured} from '../pancake/database.ts';
import {BotcakeClient} from './client.ts';
import {botcakeStore,type BotcakeStore,type ScanConfig} from './store.ts';
import {botcakeConnection,listBotcakeConnections} from './connections.ts';
type Client=Pick<BotcakeClient,'customers'|'fieldValues'|'info'>;
export async function runBotcakeSync(store:BotcakeStore,client:Client,config:ScanConfig,options:{force?:boolean;budgetMs?:number}={}){
 await store.enqueue(config,options.force);const job=await store.claim(config.pageId);if(!job)return store.status(config.pageId);
 const start=Date.now(),budget=options.budgetMs??18000;
 try{
  for(let work=0;work<40;work++){
   if(work>0&&Date.now()-start>=budget){await store.release(job);return store.status(config.pageId);}
   const fieldIds=job.source==='profile'?[]:job.fieldIds;
   if(job.stage===0){
    const page=await client.customers(job.pageId,job.cursor);await store.profiles(job,page.data);
    await store.checkpoint(job,page.next===null?1:0,page.next||'');
   }else if(job.stage<=fieldIds.length){
    const page=await client.fieldValues(job.pageId,fieldIds[job.stage-1],job.cursor);await store.fieldRows(job,page.data);
    await store.checkpoint(job,page.next===null?job.stage+1:job.stage,page.next||'');
   }else{
    const pending=await store.pending(job.pageId);
    if(!pending.length){await store.finish(job);return store.status(config.pageId);}
    for(const row of pending){
     if(Date.now()-start>=budget){await store.release(job);return store.status(config.pageId);}
     const info=await client.info(job.pageId,row.psid);await store.hydrate(job,row.psid,info);
    }
   }
  }
  await store.release(job);return store.status(config.pageId);
 }catch(error){await store.fail(job).catch(()=>{});throw error instanceof GroupError?error:new GroupError('Botcake: đồng bộ chưa hoàn tất. Giữ tiến độ và thử lại sau.',503);}
}
export async function syncBotcake(pageId:string,force=true){const c=await botcakeConnection(pageId);return runBotcakeSync(await botcakeStore(),new BotcakeClient(c.token),c,{force});}
export async function syncBotcakeTick(){
 const result={configured:false,processed:0,failed:0};if(!databaseConfigured())return result;
 const connections=await listBotcakeConnections();if(!connections.length)return result;result.configured=true;
 const store=await botcakeStore(),start=Date.now(),offset=Math.floor(start/300000)%connections.length;
 const rotated=[...connections.slice(offset),...connections.slice(0,offset)];
 for(const c of rotated){if(Date.now()-start>30000)break;
  try{const secret=await botcakeConnection(c.pageId);await runBotcakeSync(store,new BotcakeClient(secret.token),c,{budgetMs:12000});result.processed++;}
  catch{result.failed++;console.warn('Botcake sync pending',{id:c.id});}
 }
 return result;
}
