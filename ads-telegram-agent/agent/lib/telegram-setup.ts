import { createHmac } from "node:crypto";

export function webhookSecret() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Chưa cấu hình bot Telegram.");
  return process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN || createHmac("sha256", token).update("tram-ads/webhook/v1").digest("hex");
}
export function productionOrigin() {
  const hostname = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!hostname || !/^[a-z0-9.-]+$/i.test(hostname)) throw new Error("Chưa nhận được tên miền production từ Vercel.");
  return "https://" + hostname;
}
async function telegramApi(method: string, payload: object = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Chưa cấu hình bot Telegram.");
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json() as { ok: boolean; result: any };
    if (!response.ok || !data.ok) throw new Error();
    return data.result;
  } catch { throw new Error("Không kết nối được Telegram. Kiểm tra bot token và thử lại."); }
}
export async function telegramConnection() {
  const info = await telegramApi("getWebhookInfo");
  const expected = productionOrigin() + "/eve/v1/telegram";
  return { connected: info.url === expected, pending: Number(info.pending_update_count || 0),
    hasError: !!info.last_error_date && info.last_error_date > Date.now() / 1000 - 600 };
}
let lastSetup = 0;
export async function connectTelegram(force = false) {
  if (process.env.VERCEL_ENV !== "production") throw new Error("Chỉ kết nối bot trên bản production.");
  if (!/^[1-9]\d*$/.test(process.env.TELEGRAM_CHAT_ID || "")) throw new Error("Chưa cấu hình chat riêng nhận báo cáo.");
  if (!force && Date.now() - lastSetup < 10 * 60000) return;
  const info = await telegramApi("getWebhookInfo");
  const url = productionOrigin() + "/eve/v1/telegram";
  if (info.url && info.url !== url) throw new Error("Bot đang kết nối hệ thống khác. Kiểm tra webhook đang dùng trước khi chuyển sang Trạm Ads.");
  // Do not discard pending messages. The inbound handler ignores stale setup messages.
  await telegramApi("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message"], max_connections: 2 });
  await telegramApi("setMyCommands", { commands: [
    { command: "baocao", description: "Báo cáo hôm nay; có thể thêm ngày và tên nhóm" },
    { command: "homqua", description: "Báo cáo ngày hôm qua" },
    { command: "nhom", description: "Danh sách nhóm báo cáo" },
    { command: "lich", description: "Xem lịch gửi và mở trang cấu hình" },
    { command: "help", description: "Hướng dẫn sử dụng" },
  ] });
  lastSetup = Date.now();
}
