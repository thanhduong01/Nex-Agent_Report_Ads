import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRequests, resolveRequest, type BotRequest } from "../agent/lib/request-config.ts";
import { formatRequestReport, groupsForRequest, requestAction, validateBotRequest } from "../agent/lib/request-actions.ts";
import { getRegistry, saveGroup, type Registry } from "../agent/lib/groups.ts";
import { aggregate, type Row, type Report } from "../agent/lib/report.ts";

const rule: BotRequest = { ...defaultRequests()[0], id: "tour", name: "Báo cáo tour", command: "tour",
  phrases: ["báo cáo tour"], groupMode: "selected", groupIds: ["tour"], format: "summary" };
const groups = ["tour", "hotel"].map(id => ({ id, name: id, enabled: false, sources: { "2026-11": { spreadsheetId: "sample" } } }));
const registry: Registry = { version: 1, revision: 0, groups, requests: defaultRequests() };

test("custom commands and exact normalized phrases respect enabled state and configured date", () => {
  const now = new Date("2026-11-04T17:01:00Z");
  assert.equal(resolveRequest([rule], "/tour", now)?.date, "2026-11-05");
  assert.equal(resolveRequest([rule], "  BAO   CAO TOUR ", now)?.date, "2026-11-05");
  assert.equal(resolveRequest([rule], "hãy báo cáo tour", now), null);
  assert.equal(resolveRequest([{ ...rule, enabled: false }], "báo cáo tour", now), null);
  assert.equal(resolveRequest([{ ...rule, reportDay: "yesterday" }], "báo cáo tour", now)?.date, "2026-11-04");
  assert.equal(resolveRequest([rule], "/tour@ExampleBot 2/11/2026", now)?.date, "2026-11-02");
  assert.throws(() => resolveRequest([{ ...rule, allowDate: false }], "/tour 02/11/2026", now), /không nhận ngày/);
  assert.throws(() => resolveRequest([rule], "/tour 31/11/2026", now), /không hợp lệ/);
});

test("custom request group selection cannot escape its configured scope", () => {
  assert.deepEqual(groupsForRequest(groups, rule).map(g => g.id), ["tour"]);
  assert.deepEqual(groupsForRequest(groups, rule, "tất cả").map(g => g.id), ["tour"]);
  assert.throws(() => groupsForRequest(groups, rule, "hotel"), /không thuộc/);
  assert.equal(groupsForRequest([...groups, { id: "empty", name: "empty", enabled: true, sources: {} }], { ...rule, groupMode: "all" }).length, 2);
});

test("ambiguous commands, duplicate phrases, reserved commands and missing groups are rejected", () => {
  assert.equal(validateBotRequest(rule, registry).id, "tour");
  for (const bad of [{ ...rule, command: "help" }, { ...rule, command: "baocao" },
    { ...rule, groupIds: ["missing"] }, { ...rule, groupIds: [] },
    { ...rule, phrases: ["báo cáo tour", "BAO CAO TOUR"] }]) assert.throws(() => validateBotRequest(bad, registry));
  assert.throws(() => validateBotRequest({ ...rule, id: "other", command: "other" }, { ...registry, requests: [rule] }), /bị trùng/);
});

test("old registries gain defaults, request changes persist, revisions conflict and group saves preserve requests", async t => {
  const dir = await mkdtemp(join(tmpdir(), "ads-requests-"));
  const keys = ["REPORT_CONFIG_PATH", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL"];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(async () => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } await rm(dir, { recursive: true, force: true }); });
  for (const k of keys) delete process.env[k];
  process.env.REPORT_CONFIG_PATH = join(dir, "groups.json");
  await writeFile(process.env.REPORT_CONFIG_PATH, JSON.stringify({ version: 1, revision: 0, groups }));
  assert.deepEqual((await getRegistry()).requests, defaultRequests());
  await requestAction("/api/request", { request: rule, revision: 0 });
  await assert.rejects(requestAction("/api/request", { request: { ...rule, name: "Stale" }, revision: 0 }), /đã thay đổi/);
  await saveGroup({ ...groups[0], name: "Updated tour" }, 1);
  assert.deepEqual((await getRegistry()).requests.find(r => r.id === rule.id), rule);
  await requestAction("/api/request", { remove: true, id: rule.id, revision: 2 });
  const saved = await getRegistry();
  assert.equal(saved.requests.length, 2); assert.equal(saved.groups[0].name, "Updated tour");
  await assert.rejects(requestAction("/api/request-preview", { request: rule, message: "unrelated" }), /chưa khớp/);
});

test("summary replies preserve explicit zero, missing data and untracked hotel phones", () => {
  const row: Row = { name: "Tour", cost: 100, messages: 0, phones: null, tracksPhones: true,
    costPerMessage: null, costPerPhone: null, phoneRate: null, issues: [] };
  const report: Report = { date: "2026-11-02", groupName: "Tour", fetchedAt: new Date().toISOString(), sourceUrl: "https://example.test",
    confirmed: false, rows: [row], totals: aggregate([row]), previous: null, previous7: null };
  let text = formatRequestReport(rule, report, "Detailed");
  assert.match(text, /Chi phí: 100 ₫/); assert.match(text, /Tin nhắn: 0/); assert.match(text, /SĐT: Chưa nhập/);
  const hotel = { ...row, tracksPhones: false };
  text = formatRequestReport(rule, { ...report, rows: [hotel], totals: aggregate([hotel]) }, "Detailed");
  assert.match(text, /SĐT: Không theo dõi/);
  const empty = { ...row, cost: null };
  text = formatRequestReport(rule, { ...report, rows: [row, empty], totals: aggregate([row, empty]) }, "Detailed");
  assert.match(text, /Chi phí: 100 ₫ \(dữ liệu một phần\)/);
  assert.equal(formatRequestReport({ ...rule, format: "detailed" }, report, "Detailed"), "Detailed");
});
