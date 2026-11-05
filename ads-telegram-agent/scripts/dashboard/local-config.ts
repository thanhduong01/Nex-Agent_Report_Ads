import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../.env.local", import.meta.url));

// These dashboard-owned values are all single-line. Keep other settings and comments intact.
export function saveSettings(changes: Record<string, string>, path = envPath) {
  let file = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of Object.entries(changes)) {
    if (!["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "REPORT_SOURCES_JSON"].includes(key) || /['\r\n]/.test(value))
      throw new Error("Giá trị cấu hình không hợp lệ.");
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[ \\t]*(?:"[^"]*"|'[^']*'|[^\\r\\n]*)[^\\r\\n]*`, "gm");
    const line = key + "='" + value + "'";
    file = pattern.test(file) ? file.replace(pattern, () => line) : file.trimEnd() + "\n" + line + "\n";
  }
  const temporary = path + "." + randomUUID();
  try {
    writeFileSync(temporary, file, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
  Object.assign(process.env, changes);
}

type Update = { message?: { text?: string; chat?: { id: number; type: string } } };
type TelegramResult = { getMe: { username: string }; getUpdates: Update[] };

async function telegram<K extends keyof TelegramResult>(token: string, method: K): Promise<TelegramResult[K]> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", signal: AbortSignal.timeout(15000) });
  } catch { throw new Error("Không kết nối được Telegram. Kiểm tra mạng rồi thử lại."); }
  if (response.status === 409) throw new Error("Bot đang nhận tin qua dịch vụ khác. Hãy dùng một bot riêng cho báo cáo.");
  if (!response.ok) throw new Error(`Telegram trả mã ${response.status}. Kiểm tra token trong BotFather.`);
  const data = await response.json();
  if (!data.ok) throw new Error("Telegram chưa xác nhận bot.");
  return data.result;
}

export function createPairing(path = envPath) {
  let pending: { code: string; token: string; until: number } | undefined;
  return {
    async start(input: string) {
      const token = input.trim() || process.env.TELEGRAM_BOT_TOKEN || "";
      if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("Nhập token do BotFather cấp cho bot của bạn.");
      const bot = await telegram(token, "getMe");
      if (!/^[A-Za-z0-9_]+$/.test(bot.username)) throw new Error("Không nhận diện được bot.");
      const code = randomUUID().replaceAll("-", "");
      pending = { token, code, until: Date.now() + 600000 };
      return { url: `https://t.me/${bot.username}?start=${code}`, name: bot.username, code };
    },
    async finish(code: string) {
      const request = pending;
      if (!request || request.code !== code || Date.now() >= request.until) throw new Error("Liên kết đã hết hạn. Hãy tạo liên kết mới.");
      const updates = await telegram(request.token, "getUpdates");
      const match = updates.find(({ message }) => message?.text === "/start " + code && message.chat?.type === "private");
      const chatId = String(match?.message?.chat?.id ?? "");
      if (!/^[1-9]\d*$/.test(chatId)) throw new Error("Chưa thấy lời chào. Mở đúng liên kết bên dưới, nhấn Start rồi xác nhận lại.");
      if (pending !== request || Date.now() >= request.until) throw new Error("Liên kết đã thay đổi hoặc hết hạn. Hãy thử lại.");
      saveSettings({ TELEGRAM_BOT_TOKEN: request.token, TELEGRAM_CHAT_ID: chatId }, path);
      pending = undefined;
      return { saved: true };
    },
  };
}
