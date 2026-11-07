import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { GroupError, getRegistry } from "../agent/lib/groups.ts";
import { reportManagement } from "../agent/lib/report-management.ts";
import { defaultRequests } from "../agent/lib/request-config.ts";
import { updatePrivate } from "../agent/lib/private-store.ts";
import { blobDeliveryStore } from "../agent/lib/blob-delivery.ts";

const configPath="report-config/production/groups.json";
const definition={source:"sheets",metrics:["cost","messages"],period:"today",comparison:"none",detail:"summary",constants:{},body:"{{ten_nhom}}\n{{chi_so}}"};
const originalRegistry=()=>({version:1,revision:7,groups:[{id:"default",name:"Original",enabled:false,sources:{"2026-11":{spreadsheetId:"synthetic_sheet"}}}],requests:defaultRequests()});

// Exercise the installed Blob SDK and its real error classes. Uploads use a
// localhost HTTP server; downloads use an in-memory origin. No real credentials.
async function fixture(t:any) {
  const keys=["BLOB_READ_WRITE_TOKEN","BLOB_STORE_ID","VERCEL_OIDC_TOKEN","VERCEL_ENV","VERCEL","VERCEL_BLOB_API_URL","REPORT_SOURCES_JSON"];
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]])),dispatcher=getGlobalDispatcher();
  for(const key of keys)delete process.env[key];
  process.env.BLOB_READ_WRITE_TOKEN="vercel_blob_rw_fixture_synthetic";
  process.env.VERCEL_ENV="production";
  process.env.REPORT_SOURCES_JSON=JSON.stringify({"2026-11":{spreadsheetId:"synthetic_sheet"}});
  const rows=new Map<string,{content:string;etag:string}>();let generation=0,writes=0,commits=0,failRead=false;
  const set=(path:string,value:unknown)=>rows.set(path,{content:JSON.stringify(value),etag:'"version-'+(++generation)+'"'});
  set(configPath,originalRegistry());
  type Behavior="normal"|"conflict"|"lost-reply"|"access"|"unknown"|"unreadable";
  let behavior:Behavior="normal";
  const server=createServer(async(req,res)=>{
    writes++;
    assert.equal(req.method,"PUT");
    const path=new URL(req.url!,"http://localhost").searchParams.get("pathname")!;
    let content="";for await(const part of req)content+=part;
    const error=(status:number,code:string,message="synthetic_secret_must_not_escape")=>{
      res.writeHead(status,{"Content-Type":"application/json"}).end(JSON.stringify({error:{code,message}}));
    };
    if(behavior==="access")return error(403,"forbidden");
    if(behavior==="unreadable") {failRead=true;return error(400,"bad_request");}
    if(behavior==="unknown")return error(400,"bad_request");
    if(behavior==="conflict") {
      const value=JSON.parse(rows.get(path)!.content);
      if(path===configPath){value.revision++;value.groups[0].name="Edited elsewhere";}
      else value.count++;
      set(path,value);behavior="normal";return error(412,"precondition_failed");
    }
    const current=rows.get(path);
    if(current&&req.headers["x-if-match"]!==current.etag)return error(412,"precondition_failed");
    set(path,JSON.parse(content));commits++;
    if(behavior==="lost-reply") {behavior="normal";req.socket.destroy();return;}
    res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({
      url:"https://fixture.private.blob.vercel-storage.com/"+path,pathname:path,etag:rows.get(path)!.etag,
      contentType:"application/json",contentDisposition:"attachment",downloadUrl:"https://fixture.private.blob.vercel-storage.com/"+path+"?download=1"
    }));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  process.env.VERCEL_BLOB_API_URL="http://127.0.0.1:"+(server.address() as {port:number}).port;
  const mock=new MockAgent();mock.disableNetConnect();mock.enableNetConnect("127.0.0.1:"+(server.address() as {port:number}).port);
  mock.get("https://fixture.private.blob.vercel-storage.com").intercept({path:/./,method:"GET"}).reply(options=>{
    const url=new URL(options.path,"https://fixture.private.blob.vercel-storage.com");
    if(failRead)return {statusCode:503,data:""};
    const row=rows.get(decodeURIComponent(url.pathname.slice(1)));
    return row?{statusCode:200,data:row.content,responseOptions:{headers:{etag:row.etag,"content-type":"application/json"}}}:{statusCode:404,data:""};
  }).persist();
  setGlobalDispatcher(mock);
  t.after(async()=>{
    setGlobalDispatcher(dispatcher);await mock.close();for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];
    server.closeAllConnections();server.close();await once(server,"close");
  });
  return {set,rows,mode:(value:Behavior)=>{behavior=value;},stats:()=>({writes,commits}),
    save:(revision=7)=>reportManagement("/api/report-definition",{groupId:"default",name:"Saved report",definition,revision})};
}

test("cloud report save persists selected fields with the installed Blob SDK",async t=>{
  const store=await fixture(t);assert.equal((await store.save()).saved,true);
  const registry=await getRegistry();assert.equal(registry.revision,8);assert.equal(registry.groups[0].name,"Saved report");
  assert.equal(registry.groups[0].report?.body,definition.body);assert.equal(store.stats().commits,1);
});
test("the first cloud report configuration can create its private registry",async t=>{
  const store=await fixture(t);store.rows.delete(configPath);
  assert.equal((await store.save(0)).saved,true);
  assert.equal((await getRegistry()).revision,1);assert.equal(store.stats().commits,1);
});
test("real Blob ETag conflicts return 409 and preserve the other editor's configuration",async t=>{
  const store=await fixture(t);store.mode("conflict");
  await assert.rejects(store.save(),error=>error instanceof GroupError&&error.status===409);
  const registry=await getRegistry();assert.equal(registry.groups[0].name,"Edited elsewhere");assert.equal(registry.revision,8);
  assert.equal(store.stats().commits,0);
});
test("a committed report survives a lost upload reply without a false save failure or another commit",async t=>{
  const store=await fixture(t);store.mode("lost-reply");
  assert.equal((await store.save()).saved,true);
  assert.equal((await getRegistry()).groups[0].report?.body,definition.body);
  assert.equal(store.stats().commits,1);
});
test("private configuration retries real Blob conflicts against the latest value",async t=>{
  const store=await fixture(t),path="report-private/production/save-test.json";
  store.set(path,{count:1});store.mode("conflict");
  assert.deepEqual(await updatePrivate("save-test",{count:0},value=>{value.count++;}),{count:3});
  assert.equal(JSON.parse(store.rows.get(path)!.content).count,3);
});
test("rejected writes explain the storage permission failure and never expose the upstream error",async t=>{
  const store=await fixture(t);store.mode("access");
  await assert.rejects(store.save(),error=>{
    assert(error instanceof GroupError);assert.equal(error.status,503);
    assert.match(error.message,/quyền ghi/);assert(!error.message.includes("synthetic_secret"));return true;
  });
  assert.equal((await getRegistry()).revision,7);assert.equal(store.stats().commits,0);
});
test("unconfirmed writes cannot be reported as saved when the persisted configuration differs",async t=>{
  const store=await fixture(t);store.mode("unknown");
  await assert.rejects(store.save(),error=>error instanceof GroupError&&error.status===503&&!error.message.includes("synthetic_secret"));
  assert.equal((await getRegistry()).revision,7);assert.equal(store.stats().commits,0);
});
test("failed reconciliation remains unconfirmed when storage cannot be read",async t=>{
  const store=await fixture(t);store.mode("unreadable");
  await assert.rejects(store.save(),error=>error instanceof GroupError&&error.status===503);
  assert.equal(store.stats().writes,1);assert.equal(store.stats().commits,0);
});
test("a real Blob delivery conflict cannot claim another sender's delivery",async t=>{
  const store=await fixture(t),key="synthetic-delivery-key";
  const path="report-delivery/production/"+createHash("sha256").update(key).digest("hex")+".json";
  store.set(path,{state:"failed",fingerprint:"previous",createdAt:"2026-11-07T00:00:00Z"});store.mode("conflict");
  assert.equal(await blobDeliveryStore.claim(key,"synthetic report"),false);assert.equal(store.stats().commits,0);
});
