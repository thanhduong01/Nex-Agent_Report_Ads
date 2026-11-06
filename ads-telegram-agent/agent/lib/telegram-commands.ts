import { getRegistry, type ReportGroup, type Registry } from "./groups.ts";
import { deliverOnce, deliveryKey } from "./delivery.ts";
import { effectiveSchedule, nextOccurrence } from "./schedule-config.ts";
import { productionOrigin } from "./telegram-setup.ts";
import { defaultRequests, resolveRequest } from "./request-config.ts";
import { groupsForRequest, requestReport } from "./request-actions.ts";
import { recordTelegramTraffic } from "./telegram-traffic.ts";
import { DeliveryError } from "./delivery.ts";

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").toLowerCase().trim();
export function parseReportCommand(text: string, now = new Date()) {
  const resolved = resolveRequest(defaultRequests(), text, now);
  return resolved ? { date: resolved.date, group: resolved.group } : null;
}
export function selectGroups(groups: ReportGroup[], input: string) {
  if (!input || ["all", "tat ca"].includes(normalize(input))) return groups.filter(g => Object.keys(g.sources).length);
  const value = normalize(input);
  const found = groups.filter(g => g.id === input || normalize(g.name) === value);
  if (found.length !== 1) throw new Error("Không tìm thấy nhóm. Gõ /nhom rồi dùng đúng tên hoặc mã nhóm.");
  return found;
}
export function allowedTelegramMessage(message: { chat: { id: string; type: string }; from?: { id: string; isBot?: boolean } }) {
  return telegramRejection(message) === null;
}
export function telegramRejection(message: { chat: { id: string; type: string }; from?: { id: string; isBot?: boolean } }) {
  const owner = process.env.TELEGRAM_CHAT_ID;
  if (!owner) return "missing-chat";
  if (message.chat.type !== "private") return "private-only";
  if (message.chat.id !== owner) return "chat-mismatch";
  if (message.from?.id !== owner || message.from.isBot) return "sender-mismatch";
  return null;
}
type CommandMessage = { messageId: string; text: string; chat: { id: string; type: string }; from?: { id: string; isBot?: boolean }; raw?: Record<string, unknown> };
export function privateChatIdReply(message: CommandMessage) {
  if (message.text.trim().split(/\s+/)[0].split("@")[0].toLowerCase() !== "/chatid" ||
      message.chat.type !== "private" || message.from?.id !== message.chat.id || message.from?.isBot) return null;
  // Public setup utility: only returns the caller's own ID and never reads reports or changes the owner.
  return `ID chat riêng của bạn: ${message.chat.id}\n\nTELEGRAM_CHAT_ID=${message.chat.id}\n\nĐiền giá trị này vào TELEGRAM_CHAT_ID của Vercel Production, lưu và redeploy. Sau đó thử /help.`;
}
export async function receiveTelegramCommand(message: CommandMessage) {
  const rejected = telegramRejection(message);
  if (rejected) { await recordTelegramTraffic("ignored", rejected); return; }
  if (typeof message.raw?.date === "number" && message.raw.date < Date.now() / 1000 - 3600) {
    await recordTelegramTraffic("ignored", "stale"); return;
  }
  await recordTelegramTraffic("received");
  let outcome: "sent" | "duplicate" = "duplicate";
  try {
    await handleTelegramCommand(message, status => { if (status === "sent") outcome = "sent"; });
    await recordTelegramTraffic(outcome);
  } catch (error) {
    const reason = error instanceof DeliveryError ? (error.definitelyRejected ? "telegram-rejected" : "delivery-uncertain") : "delivery-storage";
    await recordTelegramTraffic("failed", reason);
    console.warn("Lệnh Telegram chưa hoàn tất:", reason);
  }
}
export async function handleTelegramCommand(message: CommandMessage, onDelivery?: (status: "sent" | "already-recorded") => void) {
  if (!allowedTelegramMessage(message)) return;
  const sentAt = message.raw?.date;
  if (typeof sentAt === "number" && sentAt < Date.now() / 1000 - 3600) return;
  const prefix = "command-" + message.messageId;
  const send = async (part: string, text: string) => {
    const chunks = text.match(/[\s\S]{1,3900}/g) || [];
    for (const [index, chunk] of chunks.entries()) {
      const result = await deliverOnce(deliveryKey("telegram", prefix + "-" + part + "-" + index), chunk);
      onDelivery?.(result.status);
    }
  };
  const command = message.text.trim().split(/\s/)[0].split("@")[0].toLowerCase();
  let registry: Registry;
  try { registry = await getRegistry(); }
  catch { await send("config-error", "Chưa đọc được cấu hình yêu cầu. Thử lại sau hoặc kiểm tra trên web."); return; }
  const groups = registry.groups;
  const help = "TRẠM ADS · YÊU CẦU ĐÃ CẤU HÌNH\n\n" + registry.requests.filter(r => r.enabled).map(r =>
    `/${r.command} — ${r.name} (${r.reportDay === "today" ? "hôm nay" : "hôm qua"})` +
    (r.allowDate ? `\nVí dụ: /${r.command} 02/11/2026` : "") +
    (r.phrases.length ? "\nHoặc nhắn: " + r.phrases.join(" · ") : "")
  ).join("\n\n") + "\n\n/nhom — danh sách nhóm\n/lich — lịch gửi\n/help — hướng dẫn\nSố liệu hôm nay có thể chưa nhập đủ.";
  if (["/start", "/help"].includes(command)) { await send("help", help); return; }
  let parsed;
  try { parsed = resolveRequest(registry.requests, message.text); }
  catch (error) { await send("invalid", (error as Error).message + "\nDùng YYYY-MM-DD hoặc DD/MM/YYYY khi yêu cầu cho phép chọn ngày."); return; }
  if (!parsed && !["/nhom", "/lich"].includes(command)) { await send("help", help); return; }
  if (command === "/nhom") {
    await send("groups", "NHÓM BÁO CÁO\n\n" + groups.map(g => `${g.name}\nMã: ${g.id}`).join("\n\n")); return;
  }
  if (command === "/lich") {
    const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    const lines = groups.map(g => {
      const s = effectiveSchedule(g); const next = nextOccurrence(s);
      return `${g.name}: ${s.enabled ? s.time + " · " + s.days.map(d => dayNames[d]).join(", ") : "Tạm dừng"}\nBáo cáo ${s.reportDay === "today" ? "hôm nay" : "hôm qua"}` +
        (next ? "\nLần tới: " + new Date(next).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "");
    });
    await send("schedule", "LỊCH GỬI · GIỜ VIỆT NAM\n\n" + lines.join("\n\n") + "\n\nChỉnh lịch: " + productionOrigin() + "/#settings"); return;
  }
  let selected;
  try { selected = groupsForRequest(groups, parsed!.rule, parsed!.group); }
  catch (error) { await send("group-error", (error as Error).message); return; }
  if (!selected.length) { await send("empty", "Chưa có nhóm nào được cấu hình nguồn. Thêm nguồn trong trang Kết nối."); return; }
  for (const group of selected) {
    let text;
    try {
      text = await requestReport(parsed!.rule, parsed!.date, group.id);
    } catch {
      text = `Chưa đọc được báo cáo ${group.name} ngày ${parsed!.date}. Kiểm tra nguồn tháng, quyền chia sẻ và các cột trong trang Kết nối.`;
    }
    await send(group.id, text);
  }
}
