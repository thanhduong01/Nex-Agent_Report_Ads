import { createHmac } from "node:crypto";
import { getRegistry } from "./groups.ts";
import { botToken, telegramConfiguration } from "./telegram-token.ts";
import { readTelegramTraffic } from "./telegram-traffic.ts";

export function webhookSecret() {
  const token = botToken();
  return process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN || createHmac("sha256", token).update("tram-ads/webhook/v1").digest("hex");
}
export function productionOrigin() {
  const hostname = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!hostname || !/^[a-z0-9.-]+$/i.test(hostname)) throw new Error("Chưa nhận được tên miền production từ Vercel.");
  return "https://" + hostname;
}
async function telegramApi(method: string, payload: object = {}) {
  const token = botToken();
  let failure = "Không kết nối được Telegram. Kiểm tra bot token và thử lại.";
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json() as { ok: boolean; result: any; error_code?: number };
    if (!response.ok || !data.ok) {
      failure = method === "getChat" && [400, 403].includes(response.status)
        ? `TELEGRAM_CHAT_ID chưa truy cập được chat riêng (HTTP ${response.status}). Mở đúng bot, nhấn Start, bỏ chặn bot nếu có và kiểm tra ID người nhận trên Vercel.`
        : `Không kết nối được Telegram (${method}: HTTP ${response.status}, API ${Number(data.error_code) || response.status}). Kiểm tra bot token và cấu hình kết nối.`;
      throw new Error();
    }
    return data.result;
  } catch { throw new Error(failure); }
}
export async function telegramConnection() {
  const config = telegramConfiguration();
  if (!config.ready) throw new Error(config.issues.join(" "));
  const [info, bot, chat, traffic] = await Promise.all([
    telegramApi("getWebhookInfo"), telegramApi("getMe"),
    telegramApi("getChat", { chat_id: process.env.TELEGRAM_CHAT_ID }), readTelegramTraffic(),
  ]);
  validateRecipient(bot, chat);
  const expected = productionOrigin() + "/eve/v1/telegram";
  return { connected: info.url === expected, pending: Number(info.pending_update_count || 0),
    hasError: !!info.last_error_date && info.last_error_date > Date.now() / 1000 - 600,
    botUsername: typeof bot.username === "string" && /^[A-Za-z0-9_]{5,32}$/.test(bot.username) ? bot.username : null,
    traffic };
}
let lastSetup = 0;
export async function connectTelegram(force = false) {
  if (process.env.VERCEL_ENV !== "production") throw new Error("Chỉ kết nối bot trên bản production.");
  const config = telegramConfiguration();
  if (!config.ready) throw new Error(config.issues.join(" "));
  if (!force && Date.now() - lastSetup < 10 * 60000) return;
  const [info, bot, chat] = await Promise.all([telegramApi("getWebhookInfo"), telegramApi("getMe"),
    telegramApi("getChat", { chat_id: process.env.TELEGRAM_CHAT_ID })]);
  validateRecipient(bot, chat);
  const url = productionOrigin() + "/eve/v1/telegram";
  if (info.url && info.url !== url) throw new Error("Bot đang kết nối hệ thống khác. Kiểm tra webhook đang dùng trước khi chuyển sang Trạm Ads.");
  // Do not discard pending messages. The inbound handler ignores stale setup messages.
  await telegramApi("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message"], max_connections: 2 });
  const registry = await getRegistry();
  await telegramApi("setMyCommands", { commands: [
    ...registry.requests.filter(r => r.enabled).map(r => ({ command: r.command, description: r.name })),
    { command: "nhom", description: "Danh sách nhóm báo cáo" },
    { command: "lich", description: "Xem lịch gửi và mở trang cấu hình" },
    { command: "help", description: "Hướng dẫn sử dụng" },
  ] });
  lastSetup = Date.now();
}
function validateRecipient(bot: { id?: number | string }, chat: { id?: number | string; type?: string }) {
  if (chat.type !== "private") throw new Error("TELEGRAM_CHAT_ID chưa đúng chat riêng. Kiểm tra ID người nhận trên Vercel rồi redeploy.");
  if (bot.id !== undefined && String(bot.id) === process.env.TELEGRAM_CHAT_ID)
    throw new Error("TELEGRAM_CHAT_ID chưa đúng: đang là ID của bot. Cần dùng ID tài khoản Telegram của bạn, rồi redeploy.");
}
