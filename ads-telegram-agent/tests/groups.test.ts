import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRegistry, saveGroup } from "../agent/lib/groups.ts";
import { cellDate, inspectTables, mappedRows, validateMapping } from "../agent/lib/mapping.ts";
import { aggregate, buildReport } from "../agent/lib/report.ts";
import type { Mapping } from "../agent/lib/config.ts";
import type { Tables } from "../agent/lib/report.ts";

const mapping: Mapping = {sheet:"Tour T1126",name:"Tour",startRow:4,dateColumn:0,dateMode:"date",costColumn:5,messagesColumn:6,phonesColumn:8,spendColumns:[1]};
function sample(): Tables {
  return { "Tour T1126": [
    ["Ngày", "Ads", null, null, null, "CP Ads", "Tin nhắn", null, "Sđt"],
    [null, null, null, null, null, null, "Số mess", null, "Số lượng"],
    [null, "Chi tiêu", null, null, null, 99999, 999, null, 999],
    ["2026-11-01", 100, null, null, null, 111, 2, null, 1],
    ["2026-11-02", null, null, null, null, 0, null, null, null],
  ] };
}
test("mapped date columns support serial, ISO and Vietnam dates without interpreting day-only data as full dates", () => {
  assert.equal(cellDate(46327), "2026-11-01");
  assert.equal(cellDate("1/11/2026"), "2026-11-01");
  assert.equal(cellDate(1), null); assert.equal(cellDate("31/02/2026"), null);
  const tables=sample();
  assert.equal(inspectTables(tables)[0].mapping?.phonesColumn, 8);
  const rows=mappedRows(tables,"2026-11-01",[mapping]);
  assert.equal(rows[0].cost,111); assert.equal(rows[0].costPerPhone,111);
  assert.equal(rows[0].costPerMessage,55.5);
  assert.equal(mappedRows(tables,"2026-11-02",[mapping])[0].cost,null);
  tables[mapping.sheet][4][1]=0;
  assert.equal(mappedRows(tables,"2026-11-02",[mapping])[0].cost,0);
});
test("mapping validation rejects month mismatches, duplicate dates and overlapping columns", () => {
  const tables=sample(); validateMapping(tables,"2026-11",[mapping]);
  assert.throws(()=>validateMapping(tables,"2026-10",[mapping]),/chưa có dòng/);
  assert.throws(()=>validateMapping(tables,"2026-11",[{...mapping,messagesColumn:5}]),/cột riêng/);
  tables[mapping.sheet].push(tables[mapping.sheet][3]);
  assert.throws(()=>validateMapping(tables,"2026-11",[mapping]),/nhiều dòng/);
});
test("different month layouts feed historical comparisons and untracked phones stay excluded", () => {
  const older={...mapping,sheet:"Tour T1026",costColumn:7,messagesColumn:8,phonesColumn:null};
  const tables={"2026-11":sample(),"2026-10":{"Tour T1026":[[],[],[],["2026-10-31",100,null,null,null,null,null,100,1]]}};
  const result=buildReport("2026-11-01",tables,{spreadsheetId:"example"},new Date(),(data,date)=>mappedRows(data,date,[date.startsWith("2026-10")?older:mapping]));
  assert.equal(result.previous?.cost.value,100); assert.equal(result.previous?.phones.known,0);
  assert.equal(result.totals.cost.value,111); assert.equal(aggregate(result.rows).phones.value,1);
});
test("registry migration preserves old sources and concurrent edits cannot overwrite each other", async t => {
  const dir=await mkdtemp(join(tmpdir(),"ads-groups-"));
  const keys=["REPORT_CONFIG_PATH","BLOB_READ_WRITE_TOKEN","BLOB_STORE_ID","VERCEL","REPORT_SOURCES_JSON"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  t.after(async()=>{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}await rm(dir,{recursive:true,force:true});});
  for(const k of keys)delete process.env[k];
  process.env.REPORT_CONFIG_PATH=join(dir,"groups.json");
  process.env.REPORT_SOURCES_JSON=JSON.stringify({"2026-10":{spreadsheetId:"legacy"}});
  const initial=await getRegistry(); assert.equal(initial.groups[0].sources["2026-10"].spreadsheetId,"legacy");
  const candidate={id:"new",name:"Second",enabled:false,sources:{}};
  const outcomes=await Promise.allSettled([saveGroup(candidate,0),saveGroup({...candidate,id:"third",name:"Third"},0)]);
  assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
  const registry=await getRegistry(); assert.equal(registry.revision,1);assert.equal(registry.groups.length,2);
  assert.equal(registry.groups[0].sources["2026-10"].spreadsheetId,"legacy");
  await assert.rejects(saveGroup(candidate,0),/đã thay đổi/);
});
