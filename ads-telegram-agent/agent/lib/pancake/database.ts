import {Pool} from "pg";
import {GroupError} from "../groups.ts";

export interface SqlSession {query(text:string,values?:unknown[]):Promise<{rows:Record<string,any>[]}>;}
export interface SqlDatabase extends SqlSession {migrationLock?:boolean;transaction<T>(fn:(session:SqlSession)=>Promise<T>):Promise<T>;}
let database:SqlDatabase|undefined;
export const databaseConfigured=()=>!!process.env.DATABASE_URL;
export function salesDatabase():SqlDatabase {
  if(database)return database;
  const value=process.env.DATABASE_URL;
  if(!value)throw new GroupError("Chưa cấu hình DATABASE_URL. Kết nối PostgreSQL/Supabase trên Vercel trước khi dùng Pancake.",503);
  let url:URL;try{url=new URL(value);}catch{throw new GroupError("DATABASE_URL chưa đúng định dạng PostgreSQL.",503);}
  if(!["postgres:","postgresql:"].includes(url.protocol))throw new GroupError("DATABASE_URL phải là chuỗi PostgreSQL.",503);
  // URL sslmode can override node-postgres TLS options; enforce certificate validation for remote hosts.
  const local=["localhost","127.0.0.1","::1"].includes(url.hostname)&&process.env.VERCEL!=="1";
  for(const key of ["sslmode","sslcert","sslkey","sslrootcert"])url.searchParams.delete(key);
  const pool=new Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:8000,idleTimeoutMillis:10000,
    query_timeout:15000,statement_timeout:15000,ssl:local?false:{rejectUnauthorized:true,
      ...(process.env.DATABASE_SSL_CA?{ca:process.env.DATABASE_SSL_CA.replace(/\\n/g,"\n")}:{})}});
  pool.on("error",()=>console.warn("Reporting database idle connection failed"));
  database={migrationLock:true,query:async(text,values)=>pool.query(text,values),transaction:async fn=>{
    const client=await pool.connect();
    try{await client.query("BEGIN");const result=await fn(client);await client.query("COMMIT");return result;}
    catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
  }};
  return database;
}
export async function databaseHealth() {
  if(!databaseConfigured())return {configured:false,connected:false,message:"Chưa cấu hình DATABASE_URL."};
  try{await salesDatabase().query("SELECT 1 AS ready");return {configured:true,connected:true,message:"Đã kết nối PostgreSQL."};}
  catch{console.warn("Reporting database connection check failed");return {configured:true,connected:false,message:"Không kết nối được database. Kiểm tra Transaction pooler, mật khẩu và chứng chỉ SSL trong Vercel."};}
}

// Kept in a private schema, outside Supabase's default public Data API schema.
export const migrations=[
  `CREATE SCHEMA IF NOT EXISTS nex_reporting`,
  `REVOKE ALL ON SCHEMA nex_reporting FROM PUBLIC`,
  `CREATE TABLE IF NOT EXISTS nex_reporting.orders (
    connection_id text NOT NULL,shop_id text NOT NULL,order_id text NOT NULL,
    created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,fact jsonb NOT NULL,
    PRIMARY KEY(connection_id,shop_id,order_id))`,
  `CREATE INDEX IF NOT EXISTS nex_orders_cohort ON nex_reporting.orders(connection_id,shop_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS nex_reporting.sync_state (
    connection_id text NOT NULL,shop_id text NOT NULL,currency text NOT NULL,import_from timestamptz,
    complete_through timestamptz,synced_at timestamptz,last_error text,PRIMARY KEY(connection_id,shop_id))`,
  `ALTER TABLE nex_reporting.sync_state ADD COLUMN IF NOT EXISTS reconciled_at timestamptz`,
  `CREATE TABLE IF NOT EXISTS nex_reporting.jobs (
    id text PRIMARY KEY,connection_id text NOT NULL,shop_id text NOT NULL,currency text NOT NULL,
    from_at timestamptz NOT NULL,to_at timestamptz NOT NULL,mode text NOT NULL,page integer NOT NULL DEFAULT 1,
    state text NOT NULL DEFAULT 'queued',lease text,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,last_error text)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS nex_jobs_open ON nex_reporting.jobs(connection_id,shop_id) WHERE state IN ('queued','running')`,
  `CREATE TABLE IF NOT EXISTS nex_reporting.events (
    connection_id text NOT NULL,shop_id text NOT NULL,order_id text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(connection_id,shop_id,order_id))`,
  `ALTER TABLE nex_reporting.events ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`,
  `ALTER TABLE nex_reporting.events ADD COLUMN IF NOT EXISTS retry_at timestamptz NOT NULL DEFAULT now()`,
];
