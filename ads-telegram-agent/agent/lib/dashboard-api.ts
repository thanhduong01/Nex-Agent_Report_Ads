import { randomUUID } from "node:crypto";
import { dashboardState } from "./dashboard-state.ts";
import { authenticated, passwordConfigured, passwordMatches, sessionCookie, sign, verify } from "./dashboard-auth.ts";
import { prepareReport } from "./job.ts";
import { deliveryKey, deliverOnce } from "./delivery.ts";
import { validateDate, yesterday } from "./report.ts";

export async function dashboardApi(request: Request) {
  const url = new URL(request.url);
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    Response.json(body, { status, headers: {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra,
    } });
  if (request.headers.get("x-tram-ads") !== "1") return json(403, { error: "Hãy mở bảng điều khiển." });
  if (!passwordConfigured()) return json(503, {
    code: "setup", error: "Thêm DASHBOARD_PASSWORD gồm ít nhất 16 ký tự vào Vercel → Settings → Environment Variables, rồi Redeploy.",
  });
  const isPost = request.method === "POST";
  if (isPost && (request.headers.get("origin") !== url.origin || request.headers.get("content-type") !== "application/json"))
    return json(403, { error: "Yêu cầu phải xuất phát từ bảng điều khiển." });
  try {
    let body: Record<string, unknown> = {};
    if (isPost) {
      const text = await request.text();
      if (text.length > 32000) return json(413, { error: "Nội dung quá dài." });
      body = JSON.parse(text);
      if (!body || Array.isArray(body) || typeof body !== "object") return json(400, { error: "Yêu cầu không hợp lệ." });
    }
    if (isPost && url.pathname === "/api/login") {
      if (typeof body.password !== "string" || !passwordMatches(body.password))
        return json(401, { error: "Mật khẩu chưa đúng." });
      return json(200, { ok: true }, { "Set-Cookie": sessionCookie(request) });
    }
    if (!authenticated(request)) return json(401, { code: "login", error: "Đăng nhập để xem báo cáo." });
    if (isPost && url.pathname === "/api/logout")
      return json(200, { ok: true }, { "Set-Cookie": sessionCookie(request, true) });
    if (!isPost && url.pathname === "/api/state") return json(200, dashboardState(true));
    if (!isPost && url.pathname === "/api/report") {
      const date = validateDate(url.searchParams.get("date") || yesterday());
      const { report, text } = await prepareReport(date);
      const id = sign({ purpose: "preview", text, date, nonce: randomUUID(),
        destination: process.env.TELEGRAM_CHAT_ID || "", exp: Date.now() + 30 * 60000 });
      return json(200, { report, text, id });
    }
    if (isPost && url.pathname === "/api/send") {
      if (!dashboardState(true).canSend)
        return json(409, { error: "Cần cấu hình Telegram và Redis trên Vercel trước khi gửi thử." });
      const draft = typeof body.id === "string" ? verify(body.id) : null;
      if (!draft || draft.purpose !== "preview" || typeof draft.text !== "string" ||
          typeof draft.date !== "string" || typeof draft.nonce !== "string" ||
          draft.destination !== process.env.TELEGRAM_CHAT_ID)
        return json(400, { error: "Bản xem trước đã hết hạn hoặc nơi nhận đã thay đổi. Tải lại báo cáo." });
      return json(200, await deliverOnce(deliveryKey(draft.date, "preview-" + draft.nonce), "BẢN GỬI THỬ\n\n" + draft.text));
    }
    if (isPost && ["/api/pair", "/api/confirm", "/api/source"].includes(url.pathname))
      return json(409, { error: "Cập nhật cấu hình trong Vercel → Settings → Environment Variables, rồi Redeploy." });
    return json(404, { error: "Không tìm thấy thao tác." });
  } catch (error) {
    const message = error instanceof Error && /^(Telegram|Google Sheets trả HTTP|Google yêu cầu|Google không trả|Thiếu tab |Tab |Cấu trúc tab |Không |Nhập |Bot |Chưa |Liên kết |Bản xem |Hãy |Tháng |Kiểm tra |Ngày |Báo cáo vượt)/u.test(error.message)
      ? error.message : "Không thể hoàn tất. Kiểm tra kết nối và cấu hình nguồn rồi thử lại.";
    return json(400, { error: message });
  }
}
