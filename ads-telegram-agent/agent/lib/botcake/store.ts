import {createHash,randomUUID} from 'node:crypto';
import {GroupError} from '../groups.ts';
import {salesDatabase,type SqlDatabase,type SqlSession} from '../pancake/database.ts';
import {PhoneVault,botcakeVault} from './crypto.ts';
import {phoneValues,utcTime,vietnamDay} from './phones.ts';
import type {CustomerFact,FieldFact,PhoneSource} from './types.ts';
export type ScanConfig={pageId:string;source:PhoneSource;fieldIds:number[]};
export type BotcakeJob=ScanConfig&{id:string;sourceKey:string;baseline:boolean;stage:number;cursor:string;lease:string};
export const configKey=(c:ScanConfig)=>createHash('sha256').update(JSON.stringify({source:c.source,fields:[...c.fieldIds].sort((a,b)=>a-b)})).digest('hex');
const iso=(v:unknown)=>v?new Date(v instanceof Date?v.getTime():String(v)).toISOString():null;
const migrations=[
 `CREATE SCHEMA IF NOT EXISTS nex_reporting`,
 `REVOKE ALL ON SCHEMA nex_reporting FROM PUBLIC`,
 `CREATE TABLE IF NOT EXISTS nex_reporting.botcake_scopes(page_id text PRIMARY KEY,source_key text NOT NULL,key_id text NOT NULL,baseline_at timestamptz,synced_at timestamptz,last_error text)`,
 `CREATE TABLE IF NOT EXISTS nex_reporting.botcake_customers(page_id text NOT NULL,customer_id text NOT NULL,psid text NOT NULL,last_interactive_at timestamptz,PRIMARY KEY(page_id,customer_id))`,
 `CREATE INDEX IF NOT EXISTS nex_botcake_psid ON nex_reporting.botcake_customers(page_id,psid)`,
 `CREATE TABLE IF NOT EXISTS nex_reporting.botcake_phones(page_id text NOT NULL,phone_key text NOT NULL,encrypted_phone text NOT NULL,source_psid text,customer_id text,
  baseline boolean NOT NULL DEFAULT false,recorded_day date,frozen_ad_id text,last_interactive_at timestamptz,first_seen_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),recorded_at timestamptz,PRIMARY KEY(page_id,phone_key))`,
 `CREATE INDEX IF NOT EXISTS nex_botcake_phone_psid ON nex_reporting.botcake_phones(page_id,source_psid)`,
 `CREATE INDEX IF NOT EXISTS nex_botcake_day ON nex_reporting.botcake_phones(page_id,recorded_day)`,
 `CREATE TABLE IF NOT EXISTS nex_reporting.botcake_jobs(id text PRIMARY KEY,page_id text NOT NULL,source_key text NOT NULL,config jsonb NOT NULL,baseline boolean NOT NULL,stage integer NOT NULL DEFAULT 0,cursor text NOT NULL DEFAULT '',state text NOT NULL DEFAULT 'queued',lease text,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,last_error text)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS nex_botcake_job_open ON nex_reporting.botcake_jobs(page_id) WHERE state IN ('queued','running','failed')`,
 `CREATE TABLE IF NOT EXISTS nex_reporting.botcake_details(page_id text NOT NULL,psid text NOT NULL,phone_keys text[] NOT NULL,PRIMARY KEY(page_id,psid))`,
];
const jobDto=(r:Record<string,any>):BotcakeJob=>({id:r.id,pageId:r.page_id,sourceKey:r.source_key,baseline:r.baseline,stage:r.stage,cursor:r.cursor,lease:r.lease,...r.config});
export class BotcakeStore{
 readonly db:SqlDatabase;readonly vault:PhoneVault;private initialized?:Promise<void>;
 constructor(db:SqlDatabase,vault:PhoneVault){this.db=db;this.vault=vault;}
 async init(){if(!this.initialized)this.initialized=this.db.transaction(async tx=>{if(this.db.migrationLock)await tx.query('SELECT pg_advisory_xact_lock(781425113)');for(const sql of migrations)await tx.query(sql);}).catch(e=>{this.initialized=undefined;throw e;});return this.initialized;}
 async enqueue(config:ScanConfig,force=false){
  await this.init();const key=configKey(config);
  return this.db.transaction(async tx=>{
   await tx.query(`INSERT INTO nex_reporting.botcake_scopes(page_id,source_key,key_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[config.pageId,key,this.vault.id]);
   const row=(await tx.query(`SELECT * FROM nex_reporting.botcake_scopes WHERE page_id=$1 FOR UPDATE`,[config.pageId])).rows[0];
   if(row.key_id!==this.vault.id)throw new GroupError('Botcake: khóa dữ liệu đã thay đổi. Khôi phục khóa riêng tư để giữ chống trùng.',503);
   const changed=row.source_key!==key,baseline=!row.baseline_at||changed;
   if(changed){await tx.query(`UPDATE nex_reporting.botcake_jobs SET state='cancelled',lease=NULL,lease_until=NULL WHERE page_id=$1 AND state IN ('queued','running','failed')`,[config.pageId]);await tx.query(`UPDATE nex_reporting.botcake_scopes SET source_key=$2,synced_at=NULL,last_error=NULL WHERE page_id=$1`,[config.pageId,key]);}
   const active=(await tx.query(`SELECT id FROM nex_reporting.botcake_jobs WHERE page_id=$1 AND state IN ('queued','running','failed')`,[config.pageId])).rows[0];
   if(active)return String(active.id);
   if(!force&&row.synced_at&&!changed&&Date.now()-Date.parse(iso(row.synced_at)!)<120000)return null;
   const id=randomUUID();await tx.query(`INSERT INTO nex_reporting.botcake_jobs(id,page_id,source_key,config,baseline) VALUES($1,$2,$3,$4::jsonb,$5)`,[id,config.pageId,key,JSON.stringify(config),baseline]);return id;
  });
 }
 async claim(pageId:string){await this.init();return this.db.transaction(async tx=>{
  const r=(await tx.query(`SELECT j.* FROM nex_reporting.botcake_jobs j JOIN nex_reporting.botcake_scopes s ON s.page_id=j.page_id AND s.source_key=j.source_key WHERE j.page_id=$1 AND j.state IN ('queued','running','failed') AND (j.lease_until IS NULL OR j.lease_until<=now()) ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j`,[pageId])).rows[0];
  if(!r)return null;const lease=randomUUID();await tx.query(`UPDATE nex_reporting.botcake_jobs SET state='running',lease=$2,lease_until=now()+interval '90 seconds' WHERE id=$1`,[r.id,lease]);return jobDto({...r,lease});
 });}
 private async owned(tx:SqlSession,job:BotcakeJob){const r=(await tx.query(`SELECT s.baseline_at FROM nex_reporting.botcake_jobs j JOIN nex_reporting.botcake_scopes s ON s.page_id=j.page_id AND s.source_key=j.source_key WHERE j.id=$1 AND j.lease=$2 AND j.state='running' AND j.lease_until>now() FOR UPDATE OF j`,[job.id,job.lease])).rows[0];if(!r)throw new GroupError('Botcake: lượt đồng bộ đã thay đổi hoặc hết hạn. Tải lại trạng thái.',409);return r;}
 private async queue(tx:SqlSession,page:string,psid:string,keys:string[]){if(!keys.length)return;await tx.query(`INSERT INTO nex_reporting.botcake_details(page_id,psid,phone_keys) VALUES($1,$2,$3::text[]) ON CONFLICT(page_id,psid) DO UPDATE SET phone_keys=ARRAY(SELECT DISTINCT unnest(nex_reporting.botcake_details.phone_keys||excluded.phone_keys))`,[page,psid,keys]);}
 private async accept(tx:SqlSession,job:BotcakeJob,phone:string,identity:{psid:string|null;customerId:string|null},metadata?:{date:string|null;adId:string|null},noQueue=false){
  const key=this.vault.hash(phone),date=utcTime(metadata?.date),valid=date&&Date.parse(date)<=Date.now()+300000?date:null;
  const scope=(await tx.query(`SELECT baseline_at FROM nex_reporting.botcake_scopes WHERE page_id=$1`,[job.pageId])).rows[0];
  const predates=!!valid&&!!scope.baseline_at&&vietnamDay(valid)<vietnamDay(iso(scope.baseline_at)!);
  const baseline=job.baseline||predates,day=!baseline&&valid?vietnamDay(valid):null;
  const r=(await tx.query(`INSERT INTO nex_reporting.botcake_phones(page_id,phone_key,encrypted_phone,source_psid,customer_id,baseline,recorded_day,frozen_ad_id,last_interactive_at,recorded_at)
   VALUES($1,$2,$3,$4,$5,$6,$7::date,$8,$9::timestamptz,CASE WHEN $7::date IS NOT NULL THEN now() ELSE NULL END)
   ON CONFLICT(page_id,phone_key) DO UPDATE SET last_seen_at=now(),last_interactive_at=GREATEST(nex_reporting.botcake_phones.last_interactive_at,excluded.last_interactive_at),
   baseline=CASE WHEN nex_reporting.botcake_phones.recorded_day IS NULL THEN nex_reporting.botcake_phones.baseline OR excluded.baseline ELSE nex_reporting.botcake_phones.baseline END,
   source_psid=COALESCE(nex_reporting.botcake_phones.source_psid,excluded.source_psid),customer_id=COALESCE(nex_reporting.botcake_phones.customer_id,excluded.customer_id)
   RETURNING baseline,recorded_day`,[job.pageId,key,this.vault.seal(phone),identity.psid,identity.customerId,baseline,day,day?metadata?.adId||null:null,valid])).rows[0];
  if(!r.baseline&&!r.recorded_day&&day)await tx.query(`UPDATE nex_reporting.botcake_phones SET recorded_day=$3::date,frozen_ad_id=$4,source_psid=$5,recorded_at=now() WHERE page_id=$1 AND phone_key=$2 AND recorded_day IS NULL AND NOT baseline`,[job.pageId,key,day,metadata?.adId||null,identity.psid]);
  else if(!r.baseline&&!r.recorded_day&&!noQueue&&identity.psid)await this.queue(tx,job.pageId,identity.psid,[key]);
  return key;
 }
 async profiles(job:BotcakeJob,facts:CustomerFact[]){return this.db.transaction(async tx=>{
  await this.owned(tx,job);
  for(const fact of facts){
   await tx.query(`INSERT INTO nex_reporting.botcake_customers(page_id,customer_id,psid,last_interactive_at) VALUES($1,$2,$3,$4) ON CONFLICT(page_id,customer_id) DO UPDATE SET psid=excluded.psid,last_interactive_at=GREATEST(nex_reporting.botcake_customers.last_interactive_at,excluded.last_interactive_at)`,[job.pageId,fact.id,fact.psid,fact.lastInteractiveAt]);
   if(fact.lastInteractiveAt)await tx.query(`UPDATE nex_reporting.botcake_phones SET last_interactive_at=GREATEST(last_interactive_at,$3::timestamptz) WHERE page_id=$1 AND source_psid=$2`,[job.pageId,fact.psid,fact.lastInteractiveAt]);
   if(job.source!=='custom')for(const phone of phoneValues(fact.phones))await this.accept(tx,job,phone,{psid:fact.psid,customerId:fact.id},fact.metadata?{date:fact.lastInteractiveAt,adId:fact.adId}:undefined);
  }
 });}
 async fieldRows(job:BotcakeJob,facts:FieldFact[]){return this.db.transaction(async tx=>{
  await this.owned(tx,job);
  for(const fact of facts){const found=fact.customerId?(await tx.query(`SELECT psid FROM nex_reporting.botcake_customers WHERE page_id=$1 AND customer_id=$2`,[job.pageId,fact.customerId])).rows[0]:null;
   const psid=fact.psid||found?.psid||null;
   for(const phone of phoneValues(fact.value))await this.accept(tx,job,phone,{psid,customerId:fact.customerId});
  }
 });}
 async pending(pageId:string){await this.init();return (await this.db.query(`SELECT psid,phone_keys FROM nex_reporting.botcake_details WHERE page_id=$1 ORDER BY psid LIMIT 10`,[pageId])).rows.map(r=>({psid:String(r.psid),keys:r.phone_keys as string[]}));}
 async hydrate(job:BotcakeJob,psid:string,info:CustomerFact){if(info.psid!==psid)throw new GroupError('Botcake: mã khách không khớp hồ sơ.',502);
  await this.db.transaction(async tx=>{
   await this.owned(tx,job);const row=(await tx.query(`SELECT phone_keys FROM nex_reporting.botcake_details WHERE page_id=$1 AND psid=$2`,[job.pageId,psid])).rows[0];
   if(job.source!=='custom')for(const phone of info.phones)await this.accept(tx,job,phone,{psid,customerId:info.id},{date:info.lastInteractiveAt,adId:info.adId},true);
   const date=utcTime(info.lastInteractiveAt),scope=(await tx.query(`SELECT baseline_at FROM nex_reporting.botcake_scopes WHERE page_id=$1`,[job.pageId])).rows[0];
   if(date&&Date.parse(date)<=Date.now()+300000&&row){const predates=!!scope.baseline_at&&vietnamDay(date)<vietnamDay(iso(scope.baseline_at)!);
    await tx.query(`UPDATE nex_reporting.botcake_phones SET last_interactive_at=GREATEST(last_interactive_at,$4::timestamptz),baseline=CASE WHEN recorded_day IS NULL THEN baseline OR $5 ELSE baseline END,
     recorded_day=CASE WHEN NOT baseline AND NOT $5 AND recorded_day IS NULL THEN $3::date ELSE recorded_day END,
     frozen_ad_id=CASE WHEN NOT baseline AND NOT $5 AND recorded_day IS NULL THEN $6 ELSE frozen_ad_id END,
     recorded_at=CASE WHEN NOT baseline AND NOT $5 AND recorded_day IS NULL THEN now() ELSE recorded_at END
     WHERE page_id=$1 AND phone_key=ANY($2::text[])`,[job.pageId,row.phone_keys,vietnamDay(date),date,predates,info.adId]);
   }
   await tx.query(`UPDATE nex_reporting.botcake_customers SET last_interactive_at=GREATEST(last_interactive_at,$3::timestamptz) WHERE page_id=$1 AND psid=$2`,[job.pageId,psid,info.lastInteractiveAt]);
   await tx.query(`DELETE FROM nex_reporting.botcake_details WHERE page_id=$1 AND psid=$2`,[job.pageId,psid]);
  });
 }
 async checkpoint(job:BotcakeJob,stage:number,cursor:string){await this.db.transaction(async tx=>{await this.owned(tx,job);await tx.query(`UPDATE nex_reporting.botcake_jobs SET stage=$3,cursor=$4,lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease=$2`,[job.id,job.lease,stage,cursor]);});job.stage=stage;job.cursor=cursor;}
 async release(job:BotcakeJob){await this.db.query(`UPDATE nex_reporting.botcake_jobs SET state='queued',lease=NULL,lease_until=NULL WHERE id=$1 AND lease=$2`,[job.id,job.lease]);}
 async finish(job:BotcakeJob){await this.db.transaction(async tx=>{await this.owned(tx,job);await tx.query(`UPDATE nex_reporting.botcake_jobs SET state='complete',finished_at=now(),lease=NULL,lease_until=NULL,last_error=NULL WHERE id=$1 AND lease=$2`,[job.id,job.lease]);await tx.query(`UPDATE nex_reporting.botcake_scopes SET baseline_at=COALESCE(baseline_at,now()),synced_at=now(),last_error=NULL WHERE page_id=$1 AND source_key=$2`,[job.pageId,job.sourceKey]);});}
 async fail(job:BotcakeJob){await this.db.transaction(async tx=>{const changed=await tx.query(`UPDATE nex_reporting.botcake_jobs SET state='failed',lease=NULL,lease_until=NULL,last_error='Đồng bộ chưa hoàn tất; tiến độ được giữ.' WHERE id=$1 AND lease=$2 AND state='running' RETURNING id`,[job.id,job.lease]);if(!changed.rows.length)return;await tx.query(`UPDATE nex_reporting.botcake_scopes SET last_error='Đồng bộ chưa hoàn tất; tiến độ được giữ.' WHERE page_id=$1 AND source_key=$2`,[job.pageId,job.sourceKey]);});}
 async status(pageId:string){await this.init();const scope=(await this.db.query(`SELECT * FROM nex_reporting.botcake_scopes WHERE page_id=$1`,[pageId])).rows[0];
  const count=(await this.db.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE baseline)::int AS baseline,count(*) FILTER(WHERE NOT baseline AND recorded_day IS NOT NULL)::int AS fresh,count(*) FILTER(WHERE NOT baseline AND recorded_day IS NULL)::int AS pending FROM nex_reporting.botcake_phones WHERE page_id=$1`,[pageId])).rows[0];
  const customers=(await this.db.query(`SELECT count(*)::int AS total FROM nex_reporting.botcake_customers WHERE page_id=$1`,[pageId])).rows[0];
  const job=(await this.db.query(`SELECT state,stage,cursor,baseline FROM nex_reporting.botcake_jobs WHERE page_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[pageId])).rows[0];
  return {pageId,startedAt:iso(scope?.baseline_at),syncedAt:iso(scope?.synced_at),sourceKey:scope?.source_key||null,lastError:scope?.last_error||null,
   phoneCount:Number(count.total),baselineCount:Number(count.baseline),newCount:Number(count.fresh),pendingCount:Number(count.pending),customerCount:Number(customers.total),job:job?{state:String(job.state),stage:Number(job.stage),baseline:!!job.baseline}:null};
 }
 async reportSnapshot(pageIds:string[],range:{from:string;to:string}){
  await this.init();return this.db.transaction(async tx=>{
   await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const scopes=(await tx.query(`SELECT * FROM nex_reporting.botcake_scopes WHERE page_id=ANY($1::text[])`,[pageIds])).rows;
   const pages=[];
   for(const pageId of pageIds){const scope=scopes.find(s=>s.page_id===pageId);
    const counts=(await tx.query(`SELECT count(*) FILTER(WHERE p.first_seen_at<=s.synced_at AND p.first_seen_at<($2::date+interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS total,
     count(*) FILTER(WHERE NOT p.baseline AND p.first_seen_at<=s.synced_at AND (p.recorded_at IS NULL OR p.recorded_at>s.synced_at))::int AS pending
     FROM nex_reporting.botcake_phones p JOIN nex_reporting.botcake_scopes s USING(page_id) WHERE p.page_id=$1`,[pageId,range.to])).rows[0];
    pages.push({pageId,total:Number(counts.total),pending:Number(counts.pending),status:{startedAt:iso(scope?.baseline_at),syncedAt:iso(scope?.synced_at),sourceKey:scope?.source_key||null,lastError:scope?.last_error||null}});
   }
   const rows=(await tx.query(`SELECT p.page_id,p.recorded_day::text,p.frozen_ad_id FROM nex_reporting.botcake_phones p JOIN nex_reporting.botcake_scopes s USING(page_id) WHERE p.page_id=ANY($1::text[]) AND NOT p.baseline AND p.recorded_day BETWEEN $2::date AND $3::date AND p.recorded_at<=s.synced_at`,[pageIds,range.from,range.to])).rows.map(r=>({pageId:String(r.page_id),day:String(r.recorded_day),adId:r.frozen_ad_id as string|null}));
   return {pages,rows};
  });
 }
 async reportRows(pageIds:string[],from:string,to:string){await this.init();return (await this.db.query(`SELECT p.page_id,p.recorded_day::text,p.frozen_ad_id FROM nex_reporting.botcake_phones p JOIN nex_reporting.botcake_scopes s USING(page_id) WHERE p.page_id=ANY($1::text[]) AND NOT p.baseline AND p.recorded_day BETWEEN $2::date AND $3::date AND p.recorded_at<=s.synced_at`,[pageIds,from,to])).rows.map(r=>({pageId:String(r.page_id),day:String(r.recorded_day),adId:r.frozen_ad_id as string|null}));}
 async pendingSnapshot(pageId:string){await this.init();return Number((await this.db.query(`SELECT count(*)::int AS n FROM nex_reporting.botcake_phones p JOIN nex_reporting.botcake_scopes s USING(page_id) WHERE p.page_id=$1 AND NOT p.baseline AND p.first_seen_at<=s.synced_at AND (p.recorded_at IS NULL OR p.recorded_at>s.synced_at)`,[pageId])).rows[0].n);}
 async snapshotTotal(pageId:string,to:string){await this.init();return Number((await this.db.query(`SELECT count(*)::int AS n FROM nex_reporting.botcake_phones p JOIN nex_reporting.botcake_scopes s USING(page_id) WHERE p.page_id=$1 AND p.first_seen_at<=s.synced_at AND p.first_seen_at<($2::date+interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh'`,[pageId,to])).rows[0].n);}
 async ledger(pageIds:string[],range:{from:string;to:string},offset=0){await this.init();
  const params=[pageIds,range.from,range.to];
  const total=Number((await this.db.query(`SELECT count(*)::int AS n FROM nex_reporting.botcake_phones WHERE page_id=ANY($1::text[]) AND (recorded_day BETWEEN $2::date AND $3::date OR recorded_day IS NULL)`,params)).rows[0].n);
  const rows=(await this.db.query(`SELECT page_id,encrypted_phone,source_psid,baseline,recorded_day::text,frozen_ad_id,last_interactive_at,first_seen_at FROM nex_reporting.botcake_phones WHERE page_id=ANY($1::text[]) AND (recorded_day BETWEEN $2::date AND $3::date OR recorded_day IS NULL) ORDER BY first_seen_at DESC,page_id,phone_key LIMIT 50 OFFSET $4`,[...params,offset])).rows;
  return {total,rows:rows.map(r=>({pageId:String(r.page_id),phone:this.vault.mask(r.encrypted_phone),psid:r.source_psid as string|null,baseline:!!r.baseline,recordedDay:r.recorded_day as string|null,adId:r.frozen_ad_id as string|null,lastInteractiveAt:iso(r.last_interactive_at),firstSeenAt:iso(r.first_seen_at)}))};
 }
}
export async function botcakeStore(){return new BotcakeStore(salesDatabase(),await botcakeVault());}
