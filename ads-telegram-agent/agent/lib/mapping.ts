import type { Mapping } from "./config.ts";
import { numberCell, ratio, validateDate } from "./report.ts";
import type { Cell, Row, Tables } from "./report.ts";

export function cellDate(value: Cell | undefined): string | null {
  if (typeof value === "number" && value > 1000 && value < 100000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  const vietnamese = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const iso = vietnamese ? `${vietnamese[3]}-${vietnamese[2].padStart(2, "0")}-${vietnamese[1].padStart(2, "0")}` : text;
  try { return validateDate(iso); } catch { return null; }
}

export function mappedRows(tables: Tables, date: string, mappings: Mapping[]): Row[] {
  return mappings.map(mapping => {
    const table = tables[mapping.sheet];
    if (!table) throw new Error(`Thiếu tab ${mapping.sheet}.`);
    const matches = table.slice(mapping.startRow - 1).filter(row => {
      const value = row[mapping.dateColumn];
      return mapping.dateMode === "date" ? cellDate(value) === date : String(value) === String(Number(date.slice(-2)));
    });
    if (matches.length > 1) throw new Error(`Tab ${mapping.sheet} có nhiều dòng cho ngày ${date}. Cần chọn vùng chỉ có một dòng tổng mỗi ngày.`);
    const row = matches[0];
    const issues: string[] = [];
    const read = (column: number, label: string, count = false) => {
      try {
        const value = numberCell(row?.[column], count);
        if (value === null) issues.push(`chưa nhập ${label}`);
        return value;
      } catch { issues.push(`${label} có lỗi số hoặc công thức`); return null; }
    };
    const entered = mapping.spendColumns.some(c => row?.[c] !== null && row?.[c] !== undefined && row[c] !== "");
    const cost = entered ? read(mapping.costColumn, "chi phí") : null;
    if (!entered) issues.push("chưa nhập chi tiêu gốc");
    const messages = read(mapping.messagesColumn, "tin nhắn", true);
    const phones = mapping.phonesColumn === null ? null : read(mapping.phonesColumn, "SĐT", true);
    return { name: mapping.name, cost, messages, phones, tracksPhones: mapping.phonesColumn !== null,
      costPerMessage: ratio(cost, messages), costPerPhone: ratio(cost, phones), phoneRate: ratio(phones, messages), issues };
  });
}

export function inspectTables(tables: Tables) {
  return Object.entries(tables).map(([sheet, table]) => {
    const norm = (value: Cell) => String(value ?? "").trim().toLocaleLowerCase("vi").replace(/\s+/g, " ");
    const find = (labels: string[]) => {
      const columns = new Set<number>();
      for (const row of table.slice(0, 3)) row.forEach((value, col) => { if (labels.includes(norm(value))) columns.add(col); });
      return columns.size === 1 ? [...columns][0] : null;
    };
    const costColumn = find(["cp ads", "chi phí ads"]), messagesColumn = find(["số mess", "tin nhắn"]);
    const phonesColumn = find(["số lượng", "số", "sđt", "số điện thoại"]);
    const spendColumns = (table[2] || []).flatMap((v, col) => norm(v) === "chi tiêu" ? [col] : []);
    const dates = table.slice(3).map(r => cellDate(r[0])).filter((v): v is string => v !== null);
    const months = [...new Set(dates.map(d => d.slice(0, 7)))].sort();
    const name = sheet.trim().replace(/\s+T\d{2,4}$/i, "");
    const mapping: Mapping | null = costColumn === null || messagesColumn === null || !spendColumns.length ? null : {
      sheet, name, startRow: 4, dateColumn: 0, dateMode: dates.length ? "date" : "day", costColumn, messagesColumn,
      phonesColumn: name.toLocaleLowerCase("vi") === "khách sạn" ? null : phonesColumn, spendColumns,
    };
    return { sheet, months, mapping, columns: Math.min(52, Math.max(1, ...table.slice(0, 5).map(r => r.length))) };
  });
}

export function validateMapping(tables: Tables, month: string, mappings: Mapping[]) {
  if (new Set(mappings.map(m => m.name)).size !== mappings.length || new Set(mappings.map(m => m.sheet)).size !== mappings.length)
    throw new Error("Kiểm tra cấu hình. Mỗi tab và tên sản phẩm chỉ được chọn một lần trong một nguồn.");
  for (const m of mappings) {
    const columns = [m.dateColumn, m.costColumn, m.messagesColumn, ...(m.phonesColumn === null ? [] : [m.phonesColumn])];
    if (new Set(columns).size !== columns.length) throw new Error(`Kiểm tra tab ${m.sheet}. Các chỉ số cần nằm ở những cột riêng.`);
    const rows = tables[m.sheet]?.slice(m.startRow - 1);
    if (!rows) throw new Error(`Thiếu tab ${m.sheet}.`);
    const dates = rows.map(r => m.dateMode === "date" ? cellDate(r[m.dateColumn]) : String(r[m.dateColumn] ?? ""));
    const inMonth = dates.filter((d): d is string => !!d && (m.dateMode === "date" ? d.startsWith(month + "-") : /^(?:[1-9]|[12]\d|3[01])$/.test(d)));
    if (!inMonth.length) throw new Error(`Tab ${m.sheet} chưa có dòng ngày phù hợp với tháng ${month}. Kiểm tra cột ngày và dòng bắt đầu.`);
    if (new Set(inMonth).size !== inMonth.length) throw new Error(`Tab ${m.sheet} có nhiều dòng cùng ngày. Chọn bảng tổng hợp mỗi ngày một dòng.`);
    for (const col of [m.costColumn, m.messagesColumn, ...(m.phonesColumn === null ? [] : [m.phonesColumn])]) {
      if (col >= Math.max(...tables[m.sheet].map(r => r.length))) throw new Error(`Tab ${m.sheet} thiếu cột chỉ số đã chọn.`);
    }
  }
}
