import { createHash } from "node:crypto";
import { blobDeliveryStore } from "./blob-delivery.ts";
import { botToken } from "./telegram-token.ts";

export const hasDeliveryStorage = () => !!((process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  || process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
function configuredStore(): DeliveryStore {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? redisStore : blobDeliveryStore;
}

export class DeliveryError extends Error {
  readonly definitelyRejected: boolean;
  constructor(message: string, definitelyRejected: boolean) {
    super(message); this.definitelyRejected = definitelyRejected;
  }
}

export interface DeliveryStore {
  claim(key: string, text: string): Promise<boolean>;
  finish(key: string, state: "sent" | "failed" | "uncertain", messageId?: number): Promise<void>;
}

async function redis(command: (string | number)[]): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !url.startsWith("https://")) throw new Error("Chưa cấu hình Redis để lưu lịch sử gửi.");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command), signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error("Không kết nối được kho lịch sử gửi."); }
  if (!res.ok) throw new Error(`Kho lịch sử gửi trả HTTP ${res.status}.`);
  const body = await res.json() as { result?: unknown; error?: string };
  if (body.error) throw new Error("Lệnh lưu lịch sử gửi thất bại.");
  return body.result;
}

export const redisStore: DeliveryStore = {
  async claim(key, text) {
    const record = JSON.stringify({ state: "pending", text, createdAt: new Date().toISOString() });
    // Keep pending/uncertain rows for reconciliation. Retry only definite rejections.
    const script = `local old=redis.call('GET',KEYS[1]); if old then local r=cjson.decode(old); if r.state~='failed' then return 0 end end; redis.call('SET',KEYS[1],ARGV[1]); return 1`;
    return await redis(["EVAL", script, 1, key, record]) === 1;
  },
  async finish(key, state, messageId) {
    const script = `local old=redis.call('GET',KEYS[1]); if not old then return 0 end; local r=cjson.decode(old); r.state=ARGV[1]; r.updatedAt=ARGV[2]; if ARGV[3]~='' then r.messageId=ARGV[3] end; redis.call('SET',KEYS[1],cjson.encode(r)); return 1`;
    const result = await redis(["EVAL", script, 1, key, state, new Date().toISOString(), messageId ?? ""]);
    if (result !== 1) throw new Error("Không cập nhật được trạng thái gửi.");
  },
};

export async function telegramSend(text: string): Promise<number> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new DeliveryError("Thiếu TELEGRAM_CHAT_ID.", true);
  let token: string;
  try { token = botToken(); }
  catch (error) { throw new DeliveryError((error as Error).message, true); }
  if (text.length > 4096) throw new DeliveryError("Báo cáo vượt giới hạn độ dài Telegram.", true);
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    // Raw fetch errors may expose the token-bearing URL; do not log them.
    throw new DeliveryError("Chưa rõ Telegram đã nhận tin nhắn hay chưa. Kiểm tra chat trước khi gửi lại.", false);
  }
  let body: { ok?: boolean; error_code?: number; result?: { message_id?: number } };
  try { body = await res.json(); }
  catch { throw new DeliveryError("Telegram trả phản hồi không xác định. Kiểm tra chat trước khi gửi lại.", false); }
  if (!res.ok || !body.ok) {
    const code = body.error_code ?? res.status;
    throw new DeliveryError(`Telegram từ chối hoặc lỗi gửi (mã ${code}).`, code >= 400 && code < 500);
  }
  if (!Number.isInteger(body.result?.message_id)) throw new DeliveryError("Không nhận được mã tin nhắn Telegram.", false);
  return body.result!.message_id!;
}

export function deliveryKey(date: string, kind = "daily"): string {
  const destination = process.env.TELEGRAM_CHAT_ID;
  if (!destination) throw new Error("Chưa cấu hình TELEGRAM_CHAT_ID.");
  const hash = createHash("sha256").update(destination).digest("hex").slice(0, 16);
  return `ads:${hash}:${kind}:${date}`;
}

export async function deliverOnce(
  key: string, text: string | (() => Promise<string>), store: DeliveryStore = configuredStore(),
  send: (text: string) => Promise<number> = telegramSend,
) {
  if (!await store.claim(key, typeof text === "string" ? text : key)) return { status: "already-recorded" as const };
  let content: string;
  try { content = typeof text === "string" ? text : await text(); }
  catch (error) { await store.finish(key, "failed"); throw error; }
  let id: number;
  try { id = await send(content); }
  catch (error) {
    await store.finish(key, error instanceof DeliveryError && error.definitelyRejected ? "failed" : "uncertain");
    throw error;
  }
  await store.finish(key, "sent", id);
  return { status: "sent" as const, messageId: id };
}
