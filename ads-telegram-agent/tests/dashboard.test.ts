import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { createPairing, saveSettings } from "../scripts/dashboard/local-config.ts";

test("pairing only saves the private chat that supplied the current challenge", async t => {
  const dir = await mkdtemp(join(tmpdir(), "ads-pair-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "config");
  const token = "123:" + "x".repeat(28);
  const pairing = createPairing(path);
  const updates: object[] = [];
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const method = url.split("/").pop()!;
    calls.push(method);
    return Response.json({ ok: true, result: method === "getMe" ? { username: "testbot" } : updates });
  });
  const first = await pairing.start(token);
  const second = await pairing.start(token);
  await assert.rejects(pairing.finish(first.code), /hết hạn/);
  updates.push({ message: { text: "/start " + second.code, chat: { type: "group", id: -77 } } },
    { message: { text: "/start", chat: { type: "private", id: 22 } } });
  await assert.rejects(pairing.finish(second.code), /Chưa thấy/);
  await assert.rejects(stat(path), { code: "ENOENT" });
  updates.push({ message: { text: "/start " + second.code, chat: { type: "private", id: 33 } } });
  await pairing.finish(second.code);
  assert.equal(parseEnv(await readFile(path, "utf8")).TELEGRAM_CHAT_ID, "33");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(pairing.finish(second.code), /hết hạn/);
  assert(!calls.includes("sendMessage"));
});

test("adding a monthly source preserves adjacent settings and replaces multiline JSON", async t => {
  const dir = await mkdtemp(join(tmpdir(), "ads-sources-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "config");
  await writeFile(path, "REPORT_SOURCES_JSON='{\n  \"2026-12\": {}\n}'\n# keep\nSEND_REPORTS=false\n");
  const value = JSON.stringify({ "2026-12": { spreadsheetId: "sample" } });
  saveSettings({ REPORT_SOURCES_JSON: value }, path);
  const file = await readFile(path, "utf8");
  assert.deepEqual({ ...parseEnv(file) }, { REPORT_SOURCES_JSON: value, SEND_REPORTS: "false" });
  assert(file.includes("# keep"));
});
