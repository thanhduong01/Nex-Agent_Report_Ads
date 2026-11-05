import { getRegistry, GroupError, updateRegistry, type Registry, type ReportGroup } from "./groups.ts";
import { requestSchema, reservedCommands, normalizeText, resolveRequest, type BotRequest } from "./request-config.ts";
import { prepareReport } from "./job.ts";
import { vietnamDate } from "./schedule-config.ts";
import type { Report } from "./report.ts";

export function validateBotRequest(input: unknown, registry: Registry) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new GroupError("Kiểm tra tên, lệnh Telegram và chọn ít nhất một nhóm báo cáo.");
  const rule = parsed.data;
  if (reservedCommands.includes(rule.command)) throw new GroupError("Lệnh này dành cho chức năng hệ thống. Chọn lệnh khác.");
  if (rule.groupIds.some(id => !registry.groups.some(g => g.id === id))) throw new GroupError("Nhóm đã thay đổi. Tải lại danh sách trước khi lưu.");
  const others = registry.requests.filter(r => r.id !== rule.id);
  if (others.some(r => r.command === rule.command)) throw new GroupError("Lệnh Telegram này đã có. Đặt lệnh riêng cho mỗi yêu cầu.");
  const phrases = rule.phrases.map(normalizeText);
  if (new Set(phrases).size !== phrases.length || others.some(r => r.phrases.some(p => phrases.includes(normalizeText(p)))))
    throw new GroupError("Câu yêu cầu bị trùng. Dùng một câu riêng cho mỗi yêu cầu.");
  return rule;
}
export function groupsForRequest(groups: ReportGroup[], rule: BotRequest, input = "") {
  const available = groups.filter(g => (rule.groupMode === "all" || rule.groupIds.includes(g.id)) && Object.keys(g.sources).length);
  if (!input || ["all", "tat ca"].includes(normalizeText(input))) return available;
  const selected = available.filter(g => g.id === input || normalizeText(g.name) === normalizeText(input));
  if (selected.length !== 1) throw new GroupError("Nhóm này không thuộc yêu cầu. Kiểm tra tên nhóm hoặc cấu hình trên web.");
  return selected;
}
export async function requestReport(rule: BotRequest, date: string, groupId: string) {
  const { report, text } = await prepareReport(date, groupId);
  return formatRequestReport(rule, report, text);
}
export function formatRequestReport(rule: BotRequest, report: Report, text: string) {
  const date = report.date;
  if (rule.format === "detailed") return (date === vietnamDate() ? "SỐ LIỆU HÔM NAY · ĐANG CẬP NHẬT\n\n" : "") + text;
  const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
  const metric = (name: string, data: { value: number; known: number; complete: boolean }, unit = "") =>
    `${name}: ${data.known ? nf.format(data.value) + unit : "Chưa nhập"}${data.known && !data.complete ? " (dữ liệu một phần)" : ""}`;
  return [`${report.groupName || rule.name} · ${date}`, date === vietnamDate() ? "Số liệu hôm nay · đang cập nhật" : "Báo cáo tổng quan", "",
    metric("Chi phí", report.totals.cost, " ₫"), metric("Tin nhắn", report.totals.messages),
    report.rows.some(r => r.tracksPhones) ? metric("SĐT", report.totals.phones) : "SĐT: Không theo dõi",
    "", "SĐT chỉ tính sản phẩm có theo dõi chỉ số này."].join("\n");
}
export async function requestAction(path: string, body: Record<string, unknown>) {
  const registry = await getRegistry();
  if (path === "/api/request-preview") {
    const rule = validateBotRequest(body.request, registry);
    const text = typeof body.message === "string" && body.message.length <= 250 ? body.message : "/" + rule.command;
    let resolved;
    try { resolved = resolveRequest([{ ...rule, enabled: true }], text); }
    catch (error) { throw new GroupError((error as Error).message); }
    if (!resolved) throw new GroupError("Tin nhắn thử chưa khớp lệnh hoặc câu yêu cầu đang chỉnh.");
    const groups = groupsForRequest(registry.groups, rule, resolved.group);
    if (!groups.length) throw new GroupError("Thêm nguồn cho nhóm trước khi chạy thử.");
    const reports = [];
    for (const group of groups) {
      try { reports.push({ group: group.name, text: await requestReport(rule, resolved.date, group.id) }); }
      catch { reports.push({ group: group.name, text: `Chưa đọc được số liệu ngày ${resolved.date}. Kiểm tra nguồn tháng, quyền chia sẻ và các cột của nhóm ${group.name}.` }); }
    }
    return { date: resolved.date, reports };
  }
  if (!Number.isInteger(body.revision)) throw new GroupError("Tải lại cấu hình trước khi lưu.");
  if (body.remove === true) {
    if (typeof body.id !== "string" || !registry.requests.some(r => r.id === body.id)) throw new GroupError("Không tìm thấy yêu cầu cần xóa.");
    await updateRegistry(body.revision as number, draft => { draft.requests = draft.requests.filter(r => r.id !== body.id); });
  } else {
    const rule = validateBotRequest(body.request, registry);
    if (!registry.requests.some(r => r.id === rule.id) && registry.requests.length >= 20) throw new GroupError("Đã đủ 20 yêu cầu. Xóa yêu cầu không còn dùng trước khi thêm.");
    await updateRegistry(body.revision as number, draft => {
      validateBotRequest(rule, draft);
      const index = draft.requests.findIndex(r => r.id === rule.id);
      if (index < 0) draft.requests.push(rule); else draft.requests[index] = rule;
    });
  }
  return { saved: true };
}
