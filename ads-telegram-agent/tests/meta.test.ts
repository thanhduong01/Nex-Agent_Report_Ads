import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { metaAction, listMetaConnections, metaCampaigns, readMetaInsights } from "../agent/lib/meta.ts";

test("Meta connections paginate accounts, keep secrets private and validate account boundaries", async t => {
  const dir=await mkdtemp(join(tmpdir(),"meta-test-")),previous=process.env.PRIVATE_CONFIG_DIR;
  process.env.PRIVATE_CONFIG_DIR=dir;
  const original=globalThis.fetch, requests:URL[]=[];
  t.after(async()=>{globalThis.fetch=original;if(previous===undefined)delete process.env.PRIVATE_CONFIG_DIR;else process.env.PRIVATE_CONFIG_DIR=previous;await rm(dir,{recursive:true,force:true});});
  const token="synthetic_private_token_123456789012345";
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));requests.push(url);
    assert.equal(url.origin,"https://graph.facebook.com");
    assert.equal(url.searchParams.has("access_token"),false);
    assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer "+token);
    if(url.pathname.endsWith("/me/adaccounts"))return Response.json({data:[{id:"act_1001",name:"Test",currency:"VND",timezone_name:"Asia/Ho_Chi_Minh"}]});
    if(url.pathname.endsWith("/campaigns"))return Response.json({data:[{id:"2001",name:"Campaign"}]});
    if(url.pathname.endsWith("/insights"))return Response.json({data:[{campaign_id:"2001",campaign_name:"Campaign",spend:"123",impressions:"1000",inline_link_clicks:"20",actions:[{action_type:"onsite_conversion.messaging_conversation_started_7d",value:"3"}]}]});
    throw Error("Unexpected request");
  };
  const saved=await metaAction({id:"test",name:"Test connection",token});
  assert(!JSON.stringify(saved).includes(token));
  assert(!JSON.stringify(await listMetaConnections()).includes(token));
  assert.equal((await metaCampaigns("test","act_1001"))[0].id,"2001");
  await assert.rejects(metaCampaigns("test","act_9999"),/tài khoản/);
  const report=await readMetaInsights({connectionId:"test",accountId:"act_1001",campaignIds:["2001"],messageAction:"onsite_conversion.messaging_conversation_started_7d"},{from:"2026-11-01",to:"2026-11-01"});
  assert.equal(report.rows[0].cost,123);assert.equal(report.rows[0].messages,3);
  assert.equal(report.currency,"VND");
  await assert.rejects(metaAction({id:"bad",name:"Invalid",token:"https://example.com/token"}),/token/i);
  assert(requests.length>=3);
});
test("Meta client refuses off-origin pagination and never echoes upstream credential-bearing errors", async t => {
  const dir=await mkdtemp(join(tmpdir(),"meta-bounds-")),previous=process.env.PRIVATE_CONFIG_DIR;
  process.env.PRIVATE_CONFIG_DIR=dir;const original=globalThis.fetch;
  t.after(async()=>{globalThis.fetch=original;if(previous===undefined)delete process.env.PRIVATE_CONFIG_DIR;else process.env.PRIVATE_CONFIG_DIR=previous;await rm(dir,{recursive:true,force:true});});
  let mode="pagination",calls=0;const secret="synthetic_secret_12345678901234567890";
  globalThis.fetch=async()=>{
    calls++;
    return mode==="pagination"?Response.json({data:[],paging:{next:"https://evil.invalid/steal?access_token="+secret}}):
      Response.json({error:{code:190,message:"token="+secret}},{status:400});
  };
  await assert.rejects(metaAction({id:"test",name:"Test",token:secret}),error=>error instanceof Error&&!error.message.includes(secret));
  assert.equal(calls,1);
  mode="error";
  await assert.rejects(metaAction({id:"test",name:"Test",token:secret}),error=>error instanceof Error&&/quyền|token/i.test(error.message)&&!error.message.includes(secret));
});
