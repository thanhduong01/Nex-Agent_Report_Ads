import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { products } from "../agent/lib/config.ts";
import { aggregate, buildReport, dayRows, numberCell, renderReport, validateDate, yesterday } from "../agent/lib/report.ts";
import type { Tables } from "../agent/lib/report.ts";
import { DeliveryError, deliverOnce } from "../agent/lib/delivery.ts";
import type { DeliveryStore } from "../agent/lib/delivery.ts";

function synthetic(): Tables {
  return Object.fromEntries(products.map(p => {
    const rows = Array.from({ length: 34 }, () => Array(13).fill(null));
    rows[0][p.cost] = "CP Ads";
    rows[1][p.messages] = "Số mess";
    if (p.phones !== null) rows[1][p.phones] = "Số lượng";
    rows[2][p.cost] = 999999; // A total must never enter daily calculations.
    for (const col of p.spendInputs) rows[2][col] = "Chi tiêu";
    for (let d = 1; d <= 31; d++) {
      const r = rows[d + 2]; r[0] = d; r[p.spendInputs[0]] = 100;
      r[p.cost] = 100; r[p.messages] = 2;
      if (p.phones !== null) r[p.phones] = 1;
    }
    return [p.name, rows];
  }));
}
const src = { spreadsheetId: "example" };

test("Vietnam date rollover, year rollover and leap day", () => {
  assert.equal(yesterday(new Date("2026-10-31T17:01:00Z")), "2026-10-31");
  assert.equal(yesterday(new Date("2027-01-01T02:00:00Z")), "2026-12-31");
  assert.equal(yesterday(new Date("2028-03-01T02:00:00Z")), "2028-02-29");
  assert.throws(() => validateDate("2026-02-30"));
});

test("hotel has no phone warning and is excluded from aggregate cost/phone", () => {
  const report = buildReport("2026-10-30", { "2026-10": synthetic() }, src);
  assert.equal(report.totals.cost.value, 400);
  assert.equal(report.totals.phones.value, 3);
  assert.equal(report.totals.costPerPhone, 100);
  assert.equal(report.rows[3].costPerPhone, null);
  assert.deepEqual(report.rows[3].issues, []);
  assert.match(renderReport(report), /không theo dõi SĐT/);
});

test("blank raw spend with a formula zero is missing, explicit zero is valid", () => {
  const t = synthetic(); t["Đài Loan"][32][1] = null; t["Đài Loan"][32][5] = 0;
  let rows = dayRows(t, "2026-10-30");
  assert.equal(rows[2].cost, null);
  assert.equal(aggregate(rows).cost.complete, false);
  t["Đài Loan"][32][1] = 0;
  assert.equal(dayRows(t, "2026-10-30")[2].cost, 0);
});

test("zero denominator is unavailable, not the cost of one conversion", () => {
  const t = synthetic(); t["Hàn Quốc"][32][10] = 0; t["Hàn Quốc"][32][8] = 0;
  const row = dayRows(t, "2026-10-30")[0];
  assert.equal(row.costPerPhone, null); assert.equal(row.costPerMessage, null);
  assert.equal(row.phones, 0);
  assert.equal(numberCell(null), null);
  assert.throws(() => numberCell("#REF!"));
  assert.throws(() => numberCell(1.5, true));
});

test("duplicate daily rows or changed columns fail instead of silently misreporting", () => {
  const t = synthetic(); t["Hàn Quốc"].push([...t["Hàn Quốc"][32]]);
  assert.throws(() => dayRows(t, "2026-10-30"), /nhiều dòng/);
  t["Hàn Quốc"].pop(); t["Hàn Quốc"][0][7] = "Other column";
  assert.throws(() => dayRows(t, "2026-10-30"), /Cấu trúc/);
});

test("month boundary loads historical month only for comparisons", () => {
  const result = buildReport("2026-11-01", { "2026-10": synthetic(), "2026-11": synthetic() }, src);
  assert.equal(result.previous?.cost.value, 400);
  assert.equal(result.previous7?.cost.value, 2800);
  const missing = buildReport("2026-11-01", { "2026-11": synthetic() }, src);
  assert.equal(missing.previous, null); assert.equal(missing.previous7, null);
  assert.throws(() => buildReport("2026-11-01", { "2026-10": synthetic() }, src), /Chưa cấu hình/);
});

test("partial phone data suppresses overall cost/phone", () => {
  const t = synthetic(); t["Đài Loan"][32][8] = null;
  const result = buildReport("2026-10-30", { "2026-10": t }, src);
  assert.equal(result.totals.phones.complete, false);
  assert.equal(result.totals.costPerPhone, null);
  assert.match(renderReport(result), /dữ liệu một phần/);
});

test("header discovery handles November moving Korea from H/I/K to F/G/I", () => {
  const tables = synthetic();
  tables["Hàn Quốc"] = structuredClone(tables["Thượng Hải"]);
  const result = buildReport("2026-11-02", { "2026-11": tables }, src);
  assert.equal(result.rows[0].cost, 100);
  assert.equal(result.rows[0].messages, 2);
  assert.equal(result.rows[0].phones, 1);
});

test("duplicate metric headers fail instead of picking an arbitrary column", () => {
  const tables = synthetic(); tables["Hàn Quốc"][0][5] = "CP Ads";
  assert.throws(() => dayRows(tables, "2026-10-30"), /đúng một cột/);
});

class MemoryStore implements DeliveryStore {
  rows = new Map<string, string>();
  async claim(key: string) {
    const state = this.rows.get(key);
    if (state && state !== "failed") return false;
    this.rows.set(key, "pending"); return true;
  }
  async finish(key: string, state: string) { this.rows.set(key, state); }
}

test("overlapping runs send once", async () => {
  const store = new MemoryStore(); let sent = 0;
  const send = async () => { sent++; return 123; };
  await Promise.all([deliverOnce("same", "text", store, send), deliverOnce("same", "text", store, send)]);
  assert.equal(sent, 1); assert.equal(store.rows.get("same"), "sent");
});

test("ambiguous timeout is retained and not blindly sent again", async () => {
  const store = new MemoryStore(); let calls = 0;
  const send = async () => { calls++; throw new DeliveryError("timeout", false); };
  await assert.rejects(deliverOnce("same", "text", store, send));
  await deliverOnce("same", "text", store, send);
  assert.equal(calls, 1); assert.equal(store.rows.get("same"), "uncertain");
});

test("definite Telegram rejection can be retried", async () => {
  const store = new MemoryStore();
  await assert.rejects(deliverOnce("same", "text", store, async () => { throw new DeliveryError("429", true); }));
  assert.equal((await deliverOnce("same", "text", store, async () => 456)).status, "sent");
});

test("downloaded October sample reconciles the inspected day", async t => {
  let fixture: { tables: Tables };
  try { fixture = JSON.parse(await readFile(new URL("../fixtures/2026-10.json", import.meta.url), "utf8")); }
  catch { t.skip("Private local fixture is not distributed in Git."); return; }
  const result = buildReport("2026-10-30", { "2026-10": fixture.tables }, src);
  assert.equal(result.totals.cost.value, 657775);
  assert.equal(result.totals.cost.complete, false); // Taiwan raw input is blank.
  assert.equal(result.totals.messages.value, 5);
  assert.equal(result.totals.phones.value, 3);
  assert.equal(result.rows[3].cost, 152491);
  assert.equal(result.rows[3].tracksPhones, false);
  assert.ok(renderReport(result).length < 3400);
});

test("downloaded November sample preserves tax-inclusive cost and missing phones", async t => {
  let fixture: { tables: Tables };
  try { fixture = JSON.parse(await readFile(new URL("../fixtures/2026-11.json", import.meta.url), "utf8")); }
  catch { t.skip("Private local fixture is not distributed in Git."); return; }
  const result = buildReport("2026-11-02", { "2026-11": fixture.tables }, src);
  assert.ok(Math.abs(result.totals.cost.value - 699656.5851) < 0.00001);
  assert.equal(result.totals.messages.value, 7);
  assert.equal(result.rows[0].cost, 161736.0393);
  assert.equal(result.rows[0].phones, null);
  assert.equal(result.rows[3].tracksPhones, false);
  assert.equal(result.totals.phones.known, 0);
  assert.equal(result.totals.costPerPhone, null);
});
