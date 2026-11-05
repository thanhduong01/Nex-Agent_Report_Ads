import { groupSchema, getRegistry, saveGroup, GroupError, monthSchema } from "./groups.ts";
import { sourceSchema } from "./config.ts";
import { readSpreadsheet } from "./sheets.ts";
import { inspectTables, validateMapping } from "./mapping.ts";
import { effectiveSchedule, scheduleSchema } from "./schedule-config.ts";

function sourceId(value: unknown) {
  if (typeof value !== "string") throw new GroupError("Nhập đường dẫn Google Sheets.");
  let url: URL;
  try { url = new URL(value); } catch { throw new GroupError("Đường dẫn Google Sheets chưa hợp lệ."); }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !match)
    throw new GroupError("Dùng đường dẫn https://docs.google.com/spreadsheets/d/… của file cần đọc.");
  return match[1];
}
export async function groupAction(path: string, body: Record<string, unknown>) {
  if (path === "/api/inspect") {
    const source = { spreadsheetId: sourceId(body.url), allowSharedExport: true };
    const tables = await readSpreadsheet(source, true);
    return { sheets: inspectTables(tables) };
  }
  const registry = await getRegistry();
  const existing = registry.groups.find(g => g.id === body.id);
  const candidate = { ...existing, id: body.id, name: body.name, enabled: body.enabled, sources: { ...existing?.sources } };
  if (body.schedule !== undefined) {
    const parsed = scheduleSchema.safeParse(body.schedule);
    if (!parsed.success) throw new GroupError("Chọn giờ hợp lệ và ít nhất một ngày gửi trong tuần.");
    const schedule = parsed.data;
    const previous = effectiveSchedule(existing || { enabled: false });
    const changed = !existing?.schedule || ["enabled", "time", "days", "reportDay"].some(key =>
      JSON.stringify(schedule[key as keyof typeof schedule]) !== JSON.stringify(previous[key as keyof typeof previous]));
    candidate.schedule = { ...schedule, startAt: changed ? new Date().toISOString() : previous.startAt };
    candidate.enabled = schedule.enabled;
  }
  if (body.source) {
    const input = body.source as Record<string, unknown>;
    const month = monthSchema.safeParse(input.month);
    const source = sourceSchema.safeParse({ spreadsheetId: sourceId(input.url), allowSharedExport: true, mappings: input.mappings });
    if (!month.success || !source.success || !source.data.mappings) throw new GroupError("Kiểm tra tháng và cấu hình các cột chỉ số.");
    const tables = await readSpreadsheet(source.data);
    validateMapping(tables, month.data, source.data.mappings);
    candidate.sources[month.data] = source.data;
  }
  if (typeof body.removeMonth === "string") delete candidate.sources[monthSchema.parse(body.removeMonth)];
  const parsed = groupSchema.safeParse(candidate);
  if (!parsed.success || !Number.isInteger(body.revision)) throw new GroupError("Kiểm tra tên nhóm và cấu hình nguồn.");
  if (parsed.data.enabled && !Object.keys(parsed.data.sources).length) throw new GroupError("Thêm ít nhất một nguồn trước khi bật lịch cho nhóm.");
  await saveGroup(parsed.data, body.revision as number);
  return { saved: true };
}
