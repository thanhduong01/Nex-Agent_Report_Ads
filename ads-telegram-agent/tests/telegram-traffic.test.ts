import test from "node:test";
import assert from "node:assert/strict";
import { privateChatIdReply, telegramRejection, receiveTelegramCommand } from "../agent/lib/telegram-commands.ts";
import { readTelegramTraffic } from "../agent/lib/telegram-traffic.ts";
import { telegramConnection, connectTelegram } from "../agent/lib/telegram-setup.ts";

test("chatid setup replies only with the private caller's own ID and never changes report authorization", () => {
  const message = { messageId: "1", text: "/chatid@ExampleBot", chat: { id: "999", type: "private" }, from: { id: "999", isBot: false } };
  assert.match(privateChatIdReply(message)!, /TELEGRAM_CHAT_ID=999/);
  assert.equal(privateChatIdReply({ ...message, text: "/help" }), null);
  assert.equal(privateChatIdReply({ ...message, chat: { id: "999", type: "group" } }), null);
  assert.equal(privateChatIdReply({ ...message, from: { id: "other", isBot: false } }), null);
  assert.equal(privateChatIdReply({ ...message, from: { id: "999", isBot: true } }), null);
});

test("rejected commands are visible to the operator without storing a message or personal IDs", async t => {
  const keys = ["TELEGRAM_CHAT_ID", "VERCEL", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(() => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
  for (const k of keys) delete process.env[k];
  process.env.TELEGRAM_CHAT_ID = "123";
  const message = { messageId: "99", text: "/help secret private message", chat: { id: "999", type: "private" }, from: { id: "999" } };
  assert.equal(telegramRejection(message), "chat-mismatch");
  await receiveTelegramCommand(message);
  const traffic = await readTelegramTraffic();
  assert.equal(traffic?.outcome, "ignored"); assert.equal(traffic?.reason, "chat-mismatch");
  assert(!JSON.stringify(traffic).includes("999")); assert(!JSON.stringify(traffic).includes("private message"));
  assert.equal(telegramRejection({ ...message, chat: { id: "123", type: "group" } }), "private-only");
  assert.equal(telegramRejection({ ...message, chat: { id: "123", type: "private" } }), "sender-mismatch");
  await receiveTelegramCommand({ ...message, chat: { id: "123", type: "private" }, from: { id: "123" }, raw: { date: 1 } });
  assert.equal((await readTelegramTraffic())?.reason, "stale");
});

test("Telegram status identifies the exact bot and validates that the destination is a private chat", async t => {
  const keys = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_ENV", "VERCEL", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(() => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
  for (const k of keys) delete process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
  process.env.TELEGRAM_CHAT_ID = "123";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "example.test"; process.env.VERCEL_ENV = "production";
  let chatType = "private", botId = 999; const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
    const method = url.split("/").pop()!; calls.push(method);
    if (method === "getChat") assert.equal(JSON.parse(options?.body as string).chat_id, "123");
    const result = method === "getMe" ? { id: botId, username: "ReportAdsTestBot" } : method === "getChat" ? { id: 123, type: chatType }
      : { url: "https://example.test/eve/v1/telegram", pending_update_count: 0 };
    return Response.json({ ok: true, result });
  });
  const status = await telegramConnection();
  assert.equal(status.connected, true); assert.equal(status.botUsername, "ReportAdsTestBot");
  assert(!JSON.stringify(status).includes(process.env.TELEGRAM_BOT_TOKEN));
  chatType = "group";
  await assert.rejects(connectTelegram(true), /TELEGRAM_CHAT_ID chưa đúng chat riêng/);
  chatType = "private"; botId = 123;
  await assert.rejects(connectTelegram(true), /đang là ID của bot/);
  assert(!calls.includes("setWebhook"));
});
