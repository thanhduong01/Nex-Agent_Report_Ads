import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dueOccurrence, effectiveSchedule, nextOccurrence, scheduleSchema } from "../agent/lib/schedule-config.ts";
import { allowedTelegramMessage, parseReportCommand, selectGroups, handleTelegramCommand } from "../agent/lib/telegram-commands.ts";
import { createBlobDeliveryStore, type DeliveryRecords } from "../agent/lib/blob-delivery.ts";
import { deliverOnce, DeliveryError } from "../agent/lib/delivery.ts";
import { groupAction } from "../agent/lib/group-actions.ts";
import { getRegistry } from "../agent/lib/groups.ts";

const schedule = { enabled: true, time: "09:00", days: [1, 2, 3, 4, 5], reportDay: "yesterday" as const };
test("schedule respects Vietnam time, weekdays, pauses, changed start time and month rollover", () => {
  assert.equal(dueOccurrence(schedule, new Date("2026-11-05T01:59:59Z")), null);
  assert.equal(dueOccurrence(schedule, new Date("2026-11-05T02:00:00Z"))?.reportDate, "2026-11-04");
  assert.equal(dueOccurrence(schedule, new Date("2026-11-05T04:00:00Z")), null);
  assert.equal(dueOccurrence(schedule, new Date("2026-11-07T02:00:00Z")), null);
  assert.equal(dueOccurrence({ ...schedule, enabled: false }, new Date("2026-11-05T02:00:00Z")), null);
  assert.equal(dueOccurrence({ ...schedule, startAt: "2026-11-05T02:00:30Z" }, new Date("2026-11-05T02:01:00Z")), null);
  assert.equal(dueOccurrence({ ...schedule, time: "00:30" }, new Date("2026-11-30T17:30:00Z"))?.reportDate, "2026-11-30");
  assert.equal(dueOccurrence({ ...schedule, time: "23:30", reportDay: "today" }, new Date("2026-11-30T17:20:00Z"))?.reportDate, "2026-11-30");
  assert.equal(nextOccurrence(schedule, new Date("2026-11-06T03:00:00Z")), "2026-11-09T02:00:00.000Z");
  assert.equal(scheduleSchema.safeParse({ ...schedule, days: [] }).success, false);
  assert.equal(scheduleSchema.safeParse({ ...schedule, time: "25:00" }).success, false);
});

test("commands default to today's Vietnam date and select all groups or an exact name", () => {
  const now = new Date("2026-11-04T17:01:00Z");
  assert.deepEqual(parseReportCommand("/baocao", now), { date: "2026-11-05", group: "" });
  assert.deepEqual(parseReportCommand("/homqua", now), { date: "2026-11-04", group: "" });
  assert.deepEqual(parseReportCommand("/baocao@ExampleBot 2/11/2026 Thượng Hải", now), { date: "2026-11-02", group: "Thượng Hải" });
  assert.deepEqual(parseReportCommand("/baocao thuong-hai", now), { date: "2026-11-05", group: "thuong-hai" });
  assert.throws(() => parseReportCommand("/baocao 31/02/2026", now));
  const groups = [{ id: "thuong-hai", name: "Thượng Hải", enabled: false, sources: { "2026-11": { spreadsheetId: "sample" } } }];
  assert.equal(selectGroups(groups, "thuong hai")[0].id, "thuong-hai");
  assert.equal(selectGroups(groups, "").length, 1); // Paused schedules can still be requested.
  assert.throws(() => selectGroups(groups, "th"));
});

test("Telegram accepts only the configured private owner, before accessing data", async t => {
  const previous = process.env.TELEGRAM_CHAT_ID;
  t.after(() => { if (previous === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = previous; });
  process.env.TELEGRAM_CHAT_ID = "123";
  const owner = { chat: { id: "123", type: "private" }, from: { id: "123", isBot: false } };
  assert.equal(allowedTelegramMessage(owner), true);
  for (const changed of [ { ...owner, chat: { id: "124", type: "private" } },
    { ...owner, chat: { id: "123", type: "group" } }, { ...owner, from: { id: "124" } }, { ...owner, from: undefined } ]) {
    assert.equal(allowedTelegramMessage(changed), false);
    await handleTelegramCommand({ ...changed, messageId: "1", text: "/baocao" });
  }
});

test("Blob compare-and-swap prevents concurrent duplicate sends and retains uncertain deliveries", async () => {
  const rows = new Map<string, { value: any; etag: string }>(); let version = 0;
  const records: DeliveryRecords = {
    async read(key) { const row = rows.get(key); return row ? structuredClone(row) : null; },
    async write(key, value, etag) {
      const old = rows.get(key);
      if (old ? old.etag !== etag : !!etag) return false;
      rows.set(key, { value, etag: String(++version) }); return true;
    },
  };
  const store = createBlobDeliveryStore(records);
  let sends = 0, preparations = 0;
  const prepare = async () => { preparations++; return "report"; };
  const send = async () => { sends++; return 99; };
  await Promise.all([deliverOnce("same", prepare, store, send), deliverOnce("same", prepare, store, send)]);
  assert.equal(sends, 1); assert.equal(preparations, 1); assert.equal(rows.get("same")?.value.state, "sent");
  await assert.rejects(deliverOnce("uncertain", "report", store, async () => { throw new DeliveryError("timeout", false); }));
  assert.equal((await deliverOnce("uncertain", "report", store, send)).status, "already-recorded");
  await assert.rejects(deliverOnce("retry", "report", store, async () => { throw new DeliveryError("rejected", true); }));
  assert.equal((await deliverOnce("retry", "report", store, send)).status, "sent");
  await assert.rejects(deliverOnce("source", async () => { throw new Error("source offline"); }, store, send));
  assert.equal((await deliverOnce("source", prepare, store, send)).status, "sent");
});

test("saving schedules persists timing without resetting on source or name edits and protects revisions", async t => {
  const dir = await mkdtemp(join(tmpdir(), "ads-schedules-"));
  const keys = ["REPORT_CONFIG_PATH", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL", "REPORT_SOURCES_JSON", "SEND_REPORTS"];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(async () => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } await rm(dir, { recursive: true, force: true }); });
  for (const k of keys) delete process.env[k];
  process.env.REPORT_CONFIG_PATH = join(dir, "groups.json");
  process.env.REPORT_SOURCES_JSON = JSON.stringify({ "2026-11": { spreadsheetId: "example" } });
  assert.equal(effectiveSchedule((await getRegistry()).groups[0]).enabled, false);
  await groupAction("/api/group", { id: "default", name: "Reports", enabled: true, revision: 0, schedule });
  const saved = await getRegistry(); const startAt = saved.groups[0].schedule?.startAt;
  assert.ok(startAt); assert.equal(saved.groups[0].schedule?.time, "09:00");
  await groupAction("/api/group", { id: "default", name: "Renamed", enabled: true, revision: 1, schedule });
  assert.equal((await getRegistry()).groups[0].schedule?.startAt, startAt);
  await assert.rejects(groupAction("/api/group", { id: "default", name: "Oops", enabled: true, revision: 1, schedule }), /đã thay đổi/);
});
