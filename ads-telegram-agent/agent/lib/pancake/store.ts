import {randomUUID} from "node:crypto";
import {GroupError} from "../groups.ts";
import {migrations,salesDatabase} from "./database.ts";
import type {SqlDatabase,SqlSession} from "./database.ts";
import type {OrderFact} from "./types.ts";

export type SyncJob={id:string;connectionId:string;shopId:string;currency:string;from:string;to:string;mode:"initial"|"incremental";page:number;lease:string};
const iso=(value:unknown)=>value?new Date(value instanceof Date?value.getTime():String(value)).toISOString():null;
const jobDto=(r:Record<string,any>):SyncJob=>({id:r.id,connectionId:r.connection_id,shopId:r.shop_id,currency:r.currency,
  from:iso(r.from_at)!,to:iso(r.to_at)!,mode:r.mode,page:r.page,lease:r.lease});
export class SalesStore {
  db:SqlDatabase;
  private initialized?:Promise<void>;
  constructor(db:SqlDatabase=salesDatabase()){this.db=db;}
  async init(){
    if(!this.initialized)this.initialized=this.db.transaction(async tx=>{if(this.db.migrationLock)await tx.query("SELECT pg_advisory_xact_lock(781425113)");for(const sql of migrations)await tx.query(sql);}).catch(error=>{this.initialized=undefined;throw error;});
    return this.initialized;
  }
  private async write(tx:SqlSession,connectionId:string,facts:OrderFact[],canonical=false){
    for(const fact of facts){
      await tx.query(`INSERT INTO nex_reporting.orders(connection_id,shop_id,order_id,created_at,updated_at,fact)
      VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(connection_id,shop_id,order_id) DO UPDATE SET
      created_at=excluded.created_at,updated_at=excluded.updated_at,fact=excluded.fact
      WHERE excluded.updated_at>nex_reporting.orders.updated_at OR ($7 AND excluded.updated_at=nex_reporting.orders.updated_at)`,[connectionId,fact.shopId,fact.id,fact.createdAt,fact.updatedAt,JSON.stringify(fact),canonical]);
      if(!canonical){
        // API timestamps can have second precision. Queue an authoritative detail read when content differs at the same version.
        await tx.query(`INSERT INTO nex_reporting.events(connection_id,shop_id,order_id)
          SELECT connection_id,shop_id,order_id FROM nex_reporting.orders WHERE connection_id=$1 AND shop_id=$2 AND order_id=$3
          AND updated_at=$4 AND fact IS DISTINCT FROM $5::jsonb
          ON CONFLICT(connection_id,shop_id,order_id) DO UPDATE SET received_at=now(),attempts=0,retry_at=now()`,[connectionId,fact.shopId,fact.id,fact.updatedAt,JSON.stringify(fact)]);
      }
    }
  }
  async upsert(connectionId:string,facts:OrderFact[]){await this.init();await this.db.transaction(tx=>this.write(tx,connectionId,facts));}
  async orders(connectionId:string,shopId:string,from:string,to:string):Promise<OrderFact[]>{
    await this.init();const result=await this.db.query(`SELECT fact FROM nex_reporting.orders WHERE connection_id=$1 AND shop_id=$2
      AND created_at >= $3::timestamptz AND created_at < $4::timestamptz + interval '1 day' ORDER BY order_id LIMIT 50001`,[connectionId,shopId,from+"T00:00:00+07:00",to+"T00:00:00+07:00"]);
    if(result.rows.length>50000)throw new GroupError("Khoảng báo cáo có quá nhiều đơn. Chọn khoảng ngày ngắn hơn.");
    return result.rows.map(r=>r.fact as OrderFact);
  }
  async status(connectionId:string,shopId:string){
    await this.init();const result=await this.db.query(`SELECT * FROM nex_reporting.sync_state WHERE connection_id=$1 AND shop_id=$2`,[connectionId,shopId]);
    const row=result.rows[0];const jobs=await this.db.query(`SELECT id,state,page,mode,last_error,created_at FROM nex_reporting.jobs WHERE connection_id=$1 AND shop_id=$2 ORDER BY created_at DESC LIMIT 5`,[connectionId,shopId]);
    const pending=await this.db.query(`SELECT count(*)::integer AS count FROM nex_reporting.events WHERE connection_id=$1 AND shop_id=$2`,[connectionId,shopId]);
    const orders=await this.db.query(`SELECT count(*)::integer AS count,count(*) FILTER(WHERE (fact->>'version') IS DISTINCT FROM '2' AND created_at>=now()-interval '8 days')::integer AS legacy FROM nex_reporting.orders WHERE connection_id=$1 AND shop_id=$2`,[connectionId,shopId]);
    return {orderCount:Number(orders.rows[0].count),legacyFacts:Number(orders.rows[0].legacy),reconciledAt:iso(row?.reconciled_at),pendingEvents:Number(pending.rows[0].count),syncedAt:iso(row?.synced_at),importFrom:iso(row?.import_from),completeThrough:iso(row?.complete_through),currency:row?.currency||null,
      error:row?.last_error||null,jobs:jobs.rows.map(j=>({id:j.id,state:j.state,page:j.page,mode:j.mode,error:j.last_error,createdAt:iso(j.created_at)}))};
  }
  async enqueue(input:{connectionId:string;shopId:string;currency:string;from:string;to:string;mode?:"initial"|"incremental"}){
    await this.init();const id=randomUUID();return this.db.transaction(async tx=>{
      await tx.query(`INSERT INTO nex_reporting.sync_state(connection_id,shop_id,currency) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[input.connectionId,input.shopId,input.currency]);
      const result=await tx.query(`INSERT INTO nex_reporting.jobs(id,connection_id,shop_id,currency,from_at,to_at,mode)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(connection_id,shop_id) WHERE state IN ('queued','running') DO UPDATE SET connection_id=excluded.connection_id RETURNING id`,
        [id,input.connectionId,input.shopId,input.currency,input.from,input.to,input.mode||"initial"]);
      return String(result.rows[0].id);
    });
  }
  async claim(connectionId:string,shopId:string):Promise<SyncJob|null>{
    await this.init();const result=await this.db.query(`UPDATE nex_reporting.jobs SET state='running',lease=$3,lease_until=now()+interval '90 seconds',attempts=attempts+1
      WHERE id=(SELECT id FROM nex_reporting.jobs WHERE connection_id=$1 AND shop_id=$2 AND (state='queued' OR (state='running' AND lease_until<now()))
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,[connectionId,shopId,randomUUID()]);
    return result.rows[0]?jobDto(result.rows[0]):null;
  }
  private async owned(tx:SqlSession,job:SyncJob){
    const result=await tx.query(`SELECT id FROM nex_reporting.jobs WHERE id=$1 AND connection_id=$2 AND shop_id=$3 AND state='running' AND lease=$4 AND lease_until>now() AND page=$5 FOR UPDATE`,[job.id,job.connectionId,job.shopId,job.lease,job.page]);
    if(!result.rows.length)throw new GroupError("Tác vụ đồng bộ đã được phiên khác tiếp nhận.",409);
  }
  async checkpoint(job:SyncJob,facts:OrderFact[],nextPage:number,nextFrom?:string){
    await this.db.transaction(async tx=>{await this.owned(tx,job);await this.write(tx,job.connectionId,facts);
      await tx.query(`UPDATE nex_reporting.jobs SET page=$2,from_at=COALESCE($3::timestamptz,from_at),state='queued',lease=NULL,lease_until=NULL WHERE id=$1`,[job.id,nextPage,nextFrom||null]);});
  }
  async finish(job:SyncJob,facts:OrderFact[]){
    await this.db.transaction(async tx=>{await this.owned(tx,job);await this.write(tx,job.connectionId,facts);
      await tx.query(`UPDATE nex_reporting.jobs SET state='done',finished_at=now(),lease=NULL,lease_until=NULL WHERE id=$1`,[job.id]);
      await tx.query(`UPDATE nex_reporting.sync_state SET import_from=CASE WHEN import_from IS NULL THEN $3::timestamptz ELSE LEAST(import_from,$3::timestamptz) END,
        complete_through=$4,synced_at=now(),last_error=NULL,reconciled_at=CASE WHEN $5='initial' THEN $4::timestamptz ELSE reconciled_at END WHERE connection_id=$1 AND shop_id=$2`,[job.connectionId,job.shopId,job.from,job.to,job.mode]);});
  }
  async fail(job:SyncJob){
    await this.db.transaction(async tx=>{await this.owned(tx,job);
      await tx.query(`UPDATE nex_reporting.jobs SET state='failed',finished_at=now(),last_error=$2,lease=NULL WHERE id=$1`,[job.id,"Đồng bộ chưa hoàn tất. Kiểm tra khóa API rồi chạy lại."]);
      await tx.query(`UPDATE nex_reporting.sync_state SET last_error=$3 WHERE connection_id=$1 AND shop_id=$2`,[job.connectionId,job.shopId,"Đồng bộ chưa hoàn tất; giữ mốc dữ liệu trước đó."]);});
  }
  async event(connectionId:string,shopId:string,orderId:string){await this.init();await this.db.query(`INSERT INTO nex_reporting.events(connection_id,shop_id,order_id) VALUES($1,$2,$3)
    ON CONFLICT(connection_id,shop_id,order_id) DO UPDATE SET received_at=now(),attempts=0,retry_at=now()`,[connectionId,shopId,orderId]);}
  async events(connectionId:string,shopId:string){await this.init();return (await this.db.query(`SELECT order_id,received_at::text AS event_version FROM nex_reporting.events WHERE connection_id=$1 AND shop_id=$2 AND attempts<5 AND retry_at<=now() ORDER BY received_at LIMIT 10`,[connectionId,shopId])).rows.map(r=>({orderId:String(r.order_id),receivedAt:String(r.event_version)}));}
  async rejectEvent(connectionId:string,shopId:string,orderId:string,receivedAt:string){await this.db.query(`UPDATE nex_reporting.events SET attempts=attempts+1,retry_at=now()+interval '15 minutes' WHERE connection_id=$1 AND shop_id=$2 AND order_id=$3 AND received_at=$4`,[connectionId,shopId,orderId,receivedAt]);}
  async retryEvents(connectionId:string,shopId:string){await this.init();await this.db.query(`UPDATE nex_reporting.events SET attempts=0,retry_at=now() WHERE connection_id=$1 AND shop_id=$2`,[connectionId,shopId]);}
  async acknowledge(connectionId:string,shopId:string,orderId:string,receivedAt:string,fact:OrderFact){await this.db.transaction(async tx=>{
    const event=await tx.query(`SELECT order_id FROM nex_reporting.events WHERE connection_id=$1 AND shop_id=$2 AND order_id=$3 AND received_at=$4 FOR UPDATE`,[connectionId,shopId,orderId,receivedAt]);
    if(!event.rows.length)return; // A newer webhook arrived while the detail request was in flight; it will be fetched again.
    await this.write(tx,connectionId,[fact],true);await tx.query(`DELETE FROM nex_reporting.events WHERE connection_id=$1 AND shop_id=$2 AND order_id=$3 AND received_at=$4`,[connectionId,shopId,orderId,receivedAt]);});}
}
let instance:SalesStore|undefined;
export const salesStore=()=>instance||(instance=new SalesStore());
