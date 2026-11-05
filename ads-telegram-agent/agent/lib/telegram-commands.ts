import { getRegistry, type ReportGroup } from "./groups.ts";
import { prepareReport } from "./job.ts";
import { deliverOnce, deliveryKey } from "./delivery.ts";
import { effectiveSchedule, nextOccurrence, shiftDate, vietnamDate } from "./schedule-config.ts";
import { validateDate } from "./report.ts";
import { productionOrigin } from "./telegram-setup.ts";

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").toLowerCase().trim();
export function parseReportCommand(text: string, now = new Date()) {
  const [command, ...words] = text.trim().split(/\s+/);
  const action = command?.split("@")[0].toLowerCase();
  if (!["/baocao", "/report", "/homnay", "/homqua"].includes(action)) return null;
  let date = action === "/homqua" ? shiftDate(vietnamDate(now), -1) : vietnamDate(now);
  const dateWord = words[0];
  if (dateWord === "homqua" || dateWord === "homnay") {
    date = dateWord === "homqua" ? shiftDate(vietnamDate(now), -1) : vietnamDate(now); words.shift();
  } else if (dateWord && /^\d/.test(dateWord)) {
    const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateWord);
    date = validateDate(vn ? `${vn[3]}-${vn[2].padStart(2, "0")}-${vn[1].padStart(2, "0")}` : dateWord);
    words.shift();
  }
  return { date, group: words.join(" ") };
}
export function selectGroups(groups: ReportGroup[], input: string) {
  if (!input || ["all", "tat ca"].includes(normalize(input))) return groups.filter(g => Object.keys(g.sources).length);
  const value = normalize(input);
  const found = groups.filter(g => g.id === input || normalize(g.name) === value);
  if (found.length !== 1) throw new Error("Không tìm thấy nhóm. Gõ /nhom rồi dùng đúng tên hoặc mã nhóm.");
  return found;
}
export function allowedTelegramMessage(message: { chat: { id: string; type: string }; from?: { id: string; isBot?: boolean } }) {
  const owner = process.env.TELEGRAM_CHAT_ID;
  return !!owner && message.chat.type === "private" && message.chat.id === owner && message.from?.id === owner && !message.from.isBot;
}
export const commandHelp = "TRẠM ADS · LỆNH BÁO CÁO\n\n/baocao — tất cả nhóm, số liệu hôm nay\n/baocao 2026-11-02 — chọn ngày\n/baocao 02/11/2026 Thượng Hải — chọn ngày và nhóm\n/baocao Thượng Hải — hôm nay, một nhóm\n/homqua — ngày hôm qua\n/nhom — danh sách nhóm\n/lich — xem và chỉnh lịch gửi\n\nMỗi lệnh mới đọc lại Google Sheets. Số liệu hôm nay có thể chưa nhập đủ.";
export async function handleTelegramCommand(message: { messageId: string; text: string; chat: { id: string; type: string }; from?: { id: string; isBot?: boolean }; raw?: Record<string, unknown> }) {
  if (!allowedTelegramMessage(message)) return;
  const sentAt = message.raw?.date;
  if (typeof sentAt === "number" && sentAt < Date.now() / 1000 - 3600) return;
  const prefix = "command-" + message.messageId;
  const send = async (part: string, text: string) => {
    const chunks = text.match(/[\s\S]{1,3900}/g) || [];
    for (const [index, chunk] of chunks.entries()) await deliverOnce(deliveryKey("telegram", prefix + "-" + part + "-" + index), chunk);
  };
  const command = message.text.trim().split(/\s/)[0].split("@")[0].toLowerCase();
  if (["/start", "/help"].includes(command)) { await send("help", commandHelp); return; }
  let parsed;
  try { parsed = parseReportCommand(message.text); }
  catch { await send("invalid", "Ngày chưa hợp lệ. Dùng /baocao YYYY-MM-DD hoặc /baocao DD/MM/YYYY."); return; }
  if (!parsed && !["/nhom", "/lich"].includes(command)) { await send("help", commandHelp); return; }
  let groups: ReportGroup[];
  try { groups = (await getRegistry()).groups; }
  catch { await send("config-error", "Chưa đọc được cấu hình nhóm. Thử lại sau hoặc kiểm tra trang Kết nối."); return; }
  if (command === "/nhom") {
    await send("groups", "NHÓM BÁO CÁO\n\n" + groups.map(g => `${g.name}\nMã: ${g.id}\n/baocao ${g.id}`).join("\n\n")); return;
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
  try { selected = selectGroups(groups, parsed!.group); }
  catch (error) { await send("group-error", (error as Error).message); return; }
  if (!selected.length) { await send("empty", "Chưa có nhóm nào được cấu hình nguồn. Thêm nguồn trong trang Kết nối."); return; }
  for (const group of selected) {
    let text;
    try {
      text = (await prepareReport(parsed!.date, group.id)).text;
      if (parsed!.date === vietnamDate()) text = "SỐ LIỆU HÔM NAY · ĐANG CẬP NHẬT\n\n" + text;
    } catch {
      text = `Chưa đọc được báo cáo ${group.name} ngày ${parsed!.date}. Kiểm tra nguồn tháng, quyền chia sẻ và các cột trong trang Kết nối.`;
    }
    await send(group.id, text);
  }
}
