import { get, put } from "@vercel/blob";
import { hasGroupStorage } from "./groups.ts";

export type TelegramTraffic = { at: string; outcome: "received" | "sent" | "ignored" | "duplicate" | "failed"; reason?: string };
const path = () => `report-config/${process.env.VERCEL_ENV || "production"}/telegram-traffic.json`;
let local: TelegramTraffic | null = null;
export async function readTelegramTraffic(): Promise<TelegramTraffic | null> {
  try {
    if (!hasGroupStorage()) return process.env.VERCEL === "1" ? null : local;
    const result = await get(path(), { access: "private", useCache: false, abortSignal: AbortSignal.timeout(5000) });
    return result ? await new Response(result.stream).json() as TelegramTraffic : null;
  } catch { return null; }
}
export async function recordTelegramTraffic(outcome: TelegramTraffic["outcome"], reason?: string) {
  const record = { at: new Date().toISOString(), outcome, ...(reason ? { reason } : {}) };
  // Store only stage/time, never message text, chat IDs, sheet data or credentials.
  try {
    if (hasGroupStorage()) await put(path(), JSON.stringify(record), { access: "private", addRandomSuffix: false,
      allowOverwrite: true, contentType: "application/json", abortSignal: AbortSignal.timeout(5000) });
    else if (process.env.VERCEL !== "1") local = record;
  } catch { console.warn("Không lưu được trạng thái nhận lệnh Telegram."); }
}
