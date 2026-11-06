import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { telegramConfiguration } from "../agent/lib/telegram-token.ts";
import { telegramConnection, connectTelegram } from "../agent/lib/telegram-setup.ts";
import { dashboardState } from "../agent/lib/dashboard-state.ts";
import { dashboardApi } from "../agent/lib/dashboard-api.ts";
import { sign } from "../agent/lib/dashboard-auth.ts";

test("incomplete Telegram configuration explains each field and the hosted connect button stays available", async t => {
  const keys = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VERCEL_ENV", "REPORT_CONFIG_PATH", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "DASHBOARD_PASSWORD"];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(() => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
  for (const k of keys) delete process.env[k];
  process.env.VERCEL_ENV = "production";
  process.env.REPORT_CONFIG_PATH = "/tmp/ads-no-such-telegram-feedback-registry.json";
  process.env.TELEGRAM_BOT_TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
  process.env.TELEGRAM_CHAT_ID = '"123"';
  assert.equal(telegramConfiguration().ready, false);
  assert.match(telegramConfiguration().issues.join(" "), /TELEGRAM_CHAT_ID/);
  const state = await dashboardState(true);
  assert.equal(state.canConnectCommands, true); assert.equal(state.paired, false);
  t.mock.method(globalThis, "fetch", async () => { assert.fail("Invalid config should not call Telegram"); });
  await assert.rejects(connectTelegram(true), /TELEGRAM_CHAT_ID/);
  await assert.rejects(telegramConnection(), /TELEGRAM_CHAT_ID/);
  process.env.DASHBOARD_PASSWORD = "unit-test-only";
  const cookie = "tram_ads_session=" + sign({ purpose: "session", exp: Date.now() + 10000 });
  const api = await dashboardApi(new Request("https://example.test/api/telegram-status", { headers: { "X-Tram-Ads": "1", cookie } }));
  assert.equal(api.status, 400); assert.match((await api.json()).error, /TELEGRAM_CHAT_ID chưa đúng/);
  process.env.TELEGRAM_CHAT_ID = "123";
  assert.equal(telegramConfiguration().ready, true);
  process.env.TELEGRAM_BOT_TOKEN = "invalid-private-value";
  const issues = telegramConfiguration().issues.join(" ");
  assert.match(issues, /định dạng token/); assert(!issues.includes("invalid-private-value"));
});

const code = await readFile(new URL("../public/telegram.js", import.meta.url), "utf8");
function client(api: (...args: any[]) => Promise<any>, hash = "#report") {
  const nodes: Record<string, any> = {};
  for (const id of ["connectCommands", "commandsFeedback", "botBadge", "telegramState"]) nodes[id] = {
    disabled: true, textContent: id === "connectCommands" ? "Kết nối & cập nhật menu lệnh" : "", className: "", attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    removeAttribute(name: string) { delete this.attributes[name]; },
    addEventListener(_event: string, handler: () => Promise<void>) { this.click = handler; },
  };
  const scope = vm.createContext({ $, document: { getElementById: $ }, api, state: { cloud: true }, access: true, location: { hash },
    feedback(id: string, text: string, error = false) { nodes[id].textContent = text; nodes[id].error = error; } });
  function $(id: string) { return nodes[id]; }
  vm.runInContext(code, scope);
  return { nodes, setup(data: object) { scope.data = data; vm.runInContext("setupTelegram(data)", scope); } };
}

test("connect button shows missing chat details, stays clickable and surfaces an API error", async () => {
  const ui = client(async () => { throw Error("Không kết nối được Telegram (getWebhookInfo: HTTP 404, API 404)."); });
  ui.setup({ cloud: true, canConnectCommands: false, telegramConfiguration: { issues: ["TELEGRAM_CHAT_ID chưa đúng định dạng chat riêng."] } });
  assert.equal(ui.nodes.connectCommands.disabled, false);
  assert.match(ui.nodes.commandsFeedback.textContent, /TELEGRAM_CHAT_ID/);
  await ui.nodes.connectCommands.click();
  assert.match(ui.nodes.commandsFeedback.textContent, /HTTP 404/);
  assert.equal(ui.nodes.commandsFeedback.error, true);
  assert.equal(ui.nodes.connectCommands.disabled, false);
  assert.equal(ui.nodes.botBadge.textContent, "Cần kiểm tra kết nối");
});

test("connection progress is visible immediately and success restores the button and badge", async () => {
  let finish!: (result: object) => void;
  const ui = client(() => new Promise(resolve => { finish = resolve; }));
  const pending = ui.nodes.connectCommands.click();
  assert.equal(ui.nodes.connectCommands.disabled, true);
  assert.equal(ui.nodes.connectCommands.attributes["aria-busy"], "true");
  assert.match(ui.nodes.commandsFeedback.textContent, /Đang kết nối/);
  finish({ connected: true, hasError: false }); await pending;
  assert.equal(ui.nodes.connectCommands.disabled, false);
  assert.match(ui.nodes.commandsFeedback.textContent, /Đã kết nối và cập nhật menu/);
  assert.equal(ui.nodes.botBadge.textContent, "Đã kết nối");
});

test("opening settings automatically checks the live connection and exposes timeout failures", async () => {
  const calls: string[] = [];
  const ui = client(async path => { calls.push(path); throw Error("Kiểm tra kết nối quá thời gian chờ. Bấm nút để thử lại."); }, "#settings");
  ui.setup({ cloud: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["telegram-status"]);
  assert.match(ui.nodes.commandsFeedback.textContent, /quá thời gian/);
  assert.equal(ui.nodes.connectCommands.disabled, false);
});
