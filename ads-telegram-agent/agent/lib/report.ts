import { products, settings } from "./config.ts";
import type { Product, Source } from "./config.ts";

export type Cell = string | number | boolean | null;
export type Tables = Record<string, Cell[][]>;
export type Row = {
  name: string;
  cost: number | null;
  messages: number | null;
  phones: number | null;
  tracksPhones: boolean;
  costPerMessage: number | null;
  costPerPhone: number | null;
  phoneRate: number | null;
  issues: string[];
};

export function validateDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Ngày phải có dạng YYYY-MM-DD.");
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.valueOf()) || value.toISOString().slice(0, 10) !== date)
    throw new Error("Ngày báo cáo không hợp lệ.");
  return date;
}

export function shiftDate(date: string, days: number): string {
  validateDate(date);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function yesterday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return shiftDate(`${part("year")}-${part("month")}-${part("day")}`, -1);
}

export function numberCell(value: Cell | undefined, count = false): number | null {
  if (value == null || value === "") return null;
  // UNFORMATTED_VALUE returns numbers; do not guess locale-specific strings.
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (count && !Number.isInteger(value)))
    throw new Error("Ô số không hợp lệ hoặc có lỗi công thức.");
  return value;
}

export function ratio(n: number | null, d: number | null): number | null {
  return n !== null && d !== null && d > 0 ? n / d : null;
}

function readProduct(tables: Tables, product: Product, day: number): Row {
  const table = tables[product.name];
  if (!table) throw new Error(`Thiếu tab ${product.name}.`);
  const norm = (v: Cell | undefined) => String(v ?? "").trim().toLocaleLowerCase("vi");
  const columns = (row: number, label: string) => (table[row] ?? [])
    .flatMap((value, col) => norm(value) === label ? [col] : []);
  const one = (row: number, label: string) => {
    const found = columns(row, label);
    if (found.length !== 1) throw new Error(`Cấu trúc tab ${product.name}: cần đúng một cột ${label}.`);
    return found[0];
  };
  const spendInputs = columns(2, "chi tiêu");
  if (!spendInputs.length) throw new Error(`Cấu trúc tab ${product.name}: thiếu cột Chi tiêu.`);
  product = {
    ...product, cost: one(0, "cp ads"), messages: one(1, "số mess"),
    phones: product.phones === null ? null : one(1, "số lượng"), spendInputs,
  };
  const matches = table.slice(3).filter(row => row[0] === day || row[0] === String(day));
  if (matches.length > 1) throw new Error(`Tab ${product.name} có nhiều dòng ngày ${day}.`);
  const issues: string[] = [];
  const row = matches[0];
  const read = (col: number, label: string, count = false) => {
    try { return numberCell(row?.[col], count); }
    catch { issues.push(`${label}: ô số/công thức không hợp lệ`); return null; }
  };
  if (!row) issues.push("thiếu dòng ngày");
  // SUM of empty cells can look like a real zero: require a raw spend entry.
  const hasSpend = product.spendInputs.some(col => row?.[col] !== null && row?.[col] !== undefined && row?.[col] !== "");
  const cost = hasSpend ? read(product.cost, "chi phí") : null;
  const messages = read(product.messages, "tin nhắn", true);
  const phones = product.phones === null ? null : read(product.phones, "SĐT", true);
  if (cost === null) issues.push("chưa có chi phí hợp lệ");
  if (messages === null) issues.push("chưa nhập số tin nhắn");
  if (product.phones !== null && phones === null) issues.push("chưa nhập số SĐT");
  return {
    name: product.name, cost, messages, phones, tracksPhones: product.phones !== null,
    costPerMessage: ratio(cost, messages), costPerPhone: ratio(cost, phones),
    phoneRate: ratio(phones, messages), issues,
  };
}

export function dayRows(tables: Tables, date: string): Row[] {
  validateDate(date);
  return products.map(p => readProduct(tables, p, Number(date.slice(-2))));
}

export function aggregate(rows: Row[]) {
  const tracked = rows.filter(r => r.tracksPhones);
  const sum = (items: Row[], key: "cost" | "messages" | "phones") => ({
    value: items.reduce((total, r) => total + (r[key] ?? 0), 0),
    complete: items.length > 0 && items.every(r => r[key] !== null),
    known: items.filter(r => r[key] !== null).length,
  });
  const cost = sum(rows, "cost"), messages = sum(rows, "messages"), phones = sum(tracked, "phones");
  const trackedCost = sum(tracked, "cost");
  return {
    cost, messages, phones,
    costPerMessage: cost.complete && messages.complete ? ratio(cost.value, messages.value) : null,
    costPerPhone: trackedCost.complete && phones.complete ? ratio(trackedCost.value, phones.value) : null,
  };
}

export type Report = {
  date: string;
  groupId?: string;
  groupName?: string;
  fetchedAt: string;
  sourceUrl: string;
  confirmed: boolean;
  rows: Row[];
  totals: ReturnType<typeof aggregate>;
  previous: ReturnType<typeof aggregate> | null;
  previous7: ReturnType<typeof aggregate> | null;
};

export function buildReport(date: string, byMonth: Record<string, Tables>, source: Source, now = new Date(), readRows = dayRows): Report {
  validateDate(date);
  const tables = byMonth[date.slice(0, 7)];
  if (!tables) throw new Error(`Chưa cấu hình file cho tháng ${date.slice(0, 7)}.`);
  const rows = readRows(tables, date);
  const history: Row[][] = [];
  for (let i = 1; i <= 7; i++) {
    const d = shiftDate(date, -i), t = byMonth[d.slice(0, 7)];
    if (t) history.push(readRows(t, d));
  }
  const prevDate = shiftDate(date, -1), prevTables = byMonth[prevDate.slice(0, 7)];
  return {
    date, fetchedAt: now.toISOString(),
    sourceUrl: `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit`,
    confirmed: !!source.confirmedThrough && validateDate(source.confirmedThrough) >= date,
    rows, totals: aggregate(rows),
    previous: prevTables ? aggregate(readRows(prevTables, prevDate)) : null,
    previous7: history.length === 7 ? aggregate(history.flat()) : null,
  };
}

const fmt = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);
const money = (n: number | null) => n === null ? "chưa có dữ liệu" : `${fmt(n)} ${settings.currency}`;
const metric = (x: { value: number; complete: boolean; known: number }, currency = false) =>
  x.known === 0 ? "chưa có dữ liệu" : `${currency ? money(x.value) : fmt(x.value)}${x.complete ? "" : " (dữ liệu một phần)"}`;

export function renderReport(report: Report): string {
  const { totals: t } = report;
  const trackedCount = report.rows.filter(r => r.tracksPhones).length;
  const lines = [
    `📊 BÁO CÁO QUẢNG CÁO — ${report.date.split("-").reverse().join("/")}`,
    ...(report.groupName ? [report.groupName] : []),
    `Chi phí: ${metric(t.cost, true)}`,
    `Tin nhắn: ${metric(t.messages)}`,
    `SĐT (${trackedCount} sản phẩm có theo dõi): ${metric(t.phones)}`,
  ];
  if (t.costPerMessage !== null) lines.push(`Chi phí/tin nhắn: ${money(t.costPerMessage)}`);
  if (t.costPerPhone !== null) lines.push(`Chi phí/SĐT (sản phẩm có theo dõi): ${money(t.costPerPhone)}`);
  if (report.previous?.cost.complete && t.cost.complete && report.previous.cost.value > 0) {
    const delta = (t.cost.value / report.previous.cost.value - 1) * 100;
    lines.push(`Chi phí so với ngày trước: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`);
  } else lines.push("So sánh chi phí ngày trước: chưa đủ dữ liệu.");
  if (report.previous7?.cost.complete && t.cost.complete && report.previous7.cost.value > 0) {
    const avg = report.previous7.cost.value / 7;
    const delta = (t.cost.value / avg - 1) * 100;
    lines.push(`So với chi phí TB 7 ngày trước: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`);
  } else lines.push("So sánh chi phí 7 ngày trước: chưa đủ dữ liệu.");
  lines.push("");
  for (const r of report.rows) {
    const phones = r.tracksPhones ? (r.phones === null ? "chưa nhập SĐT" : `${fmt(r.phones)} SĐT`) : "không theo dõi SĐT";
    lines.push(`${r.name}: ${money(r.cost)} | ${r.messages === null ? "chưa nhập tin nhắn" : `${r.messages} tin nhắn`} | ${phones}`);
  }
  const observations = report.rows.flatMap(r => {
    const notes: string[] = [];
    if (r.cost !== null && r.cost > 0 && r.messages === 0) notes.push(`${r.name}: có chi phí nhưng chưa ghi nhận tin nhắn trong ngày.`);
    if (r.tracksPhones && r.cost !== null && r.cost > 0 && r.phones === 0) notes.push(`${r.name}: chưa ghi nhận SĐT; không tính chi phí/SĐT.`);
    if (r.issues.length) notes.push(`${r.name}: ${r.issues.join(", ")}.`);
    return notes;
  });
  if (observations.length) lines.push("", "Cần kiểm tra:", ...observations.map(x => `• ${x}`));
  lines.push("", report.confirmed ? "Nguồn đã xác nhận chốt dữ liệu đến ngày báo cáo." : "Số liệu tại lúc đọc; nguồn chưa xác nhận chốt dữ liệu.");
  lines.push(`Đọc lúc: ${new Intl.DateTimeFormat("vi-VN", { timeZone: settings.timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(report.fetchedAt))}`);
  lines.push(report.sourceUrl);
  return lines.join("\n");
}
