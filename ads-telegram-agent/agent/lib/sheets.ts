import { GoogleAuth } from "google-auth-library";
import { readSheet } from "read-excel-file/node";
import { products, sources } from "./config.ts";
import type { Source } from "./config.ts";
import { buildReport, shiftDate, validateDate } from "./report.ts";
import type { Tables } from "./report.ts";

async function googleRead(url: URL, headers: Record<string, string> = {}): Promise<Response> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response: Response | undefined;
    try { response = await fetch(url, { headers, signal: AbortSignal.timeout(20000), cache: "no-store" }); }
    catch { if (attempt === 3) throw new Error("Không kết nối được Google Sheets sau 3 lần thử."); }
    if (response?.ok) return response;
    if (response) {
      await response.body?.cancel();
      if ((response.status !== 429 && response.status < 500) || attempt === 3)
        throw new Error(`Google Sheets trả HTTP ${response.status}. Kiểm tra quyền đọc của nguồn.`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
  }
  throw new Error("Không đọc được Google Sheets.");
}

async function readSharedExport(id: string): Promise<Tables> {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
  const response = await googleRead(url);
  if (response.headers.get("content-type")?.includes("text/html")) {
    await response.body?.cancel();
    throw new Error("Google yêu cầu đăng nhập. Hãy cấp quyền Viewer cho service account.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 4 || buffer.readUInt32BE(0) !== 0x504b0304)
    throw new Error("Google không trả bản xuất Excel hợp lệ.");
  const tables: Tables = {};
  for (const product of products) {
    const rows = await readSheet(buffer, product.name);
    tables[product.name] = rows.slice(0, 64).map(row => row.slice(0, 13).map(cell =>
      cell === null || typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean" ? cell : null
    ));
  }
  return tables;
}

async function readSpreadsheet(source: Source): Promise<Tables> {
  const id = source.spreadsheetId;
  if (source.allowSharedExport && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS
      && process.env.SHEETS_REQUIRE_AUTH !== "true") return readSharedExport(id);
  let credentials;
  try { credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : undefined; }
  catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ."); }
  const auth = new GoogleAuth({
    ...(credentials ? { credentials } : {}),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  let token: string | null | undefined;
  try { token = await auth.getAccessToken(); }
  catch { throw new Error("Không xác thực được tài khoản Google. Kiểm tra credentials và quyền Viewer."); }
  if (!token) throw new Error("Thiếu access token Google.");
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet`);
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  for (const p of products) url.searchParams.append("ranges", `'${p.name.replaceAll("'", "''")}'!A1:M64`);
  const res = await googleRead(url, { Authorization: `Bearer ${token}` });
  const body = await res.json() as { valueRanges?: { values?: Tables[string] }[] };
  if (body.valueRanges?.length !== products.length) throw new Error("Google Sheets trả thiếu vùng dữ liệu.");
  return Object.fromEntries(products.map((p, i) => [p.name, body.valueRanges![i].values ?? []]));
}

export async function liveReport(date: string) {
  validateDate(date);
  const registry = sources(), month = date.slice(0, 7), source = registry[month];
  if (!source) throw new Error(`Chưa có file Google Sheets cho tháng ${month}. Cần thêm file tháng mới.`);
  const months = new Set([month, shiftDate(date, -7).slice(0, 7)]);
  const byMonth: Record<string, Tables> = {};
  for (const key of months) {
    if (!registry[key]) continue;
    try { byMonth[key] = await readSpreadsheet(registry[key]); }
    catch (error) { if (key === month) throw error; }
  }
  return buildReport(date, byMonth, source);
}
