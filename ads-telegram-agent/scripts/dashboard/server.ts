import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { groupAction } from "../../agent/lib/group-actions.ts";
import { GroupError, getRegistry, saveGroup } from "../../agent/lib/groups.ts";
import { yesterday, validateDate } from "../../agent/lib/report.ts";
import { prepareReport } from "../../agent/lib/job.ts";
import { DeliveryError, telegramSend } from "../../agent/lib/delivery.ts";
import { createPairing } from "./local-config.ts";
import { dashboardState } from "../../agent/lib/dashboard-state.ts";
import { requestAction } from "../../agent/lib/request-actions.ts";
import { APP_NAME } from "../../agent/lib/brand.ts";

const port = Number(process.env.DASHBOARD_PORT || 4317);
const host = "127.0.0.1:" + port;
const origin = "http://" + host;
const pairing = createPairing();
const assets = new Map([["/", ["index.html", "text/html"]], ["/style.css", ["style.css", "text/css"]],
  ["/telegram.js", ["telegram.js", "text/javascript"]], ["/requests.js", ["requests.js", "text/javascript"]], ["/groups.js", ["groups.js", "text/javascript"]], ["/app.js", ["app.js", "text/javascript"]], ["/mark.svg", ["mark.svg", "image/svg+xml"]]]);
const drafts = new Map<string, { text: string; until: number }>();
const privateChat = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && /^[1-9]\d*$/.test(process.env.TELEGRAM_CHAT_ID || ""));
function status() {
  return dashboardState();
}

const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  function json(code: number, body: unknown) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
  }
  try {
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin))
      return json(403, { error: "Chỉ truy cập từ bảng điều khiển trên máy này." });
    const url = new URL(req.url || "/", origin);
    const asset = assets.get(url.pathname);
    if (req.method === "GET" && asset) {
      const file = await readFile(new URL("../../public/" + asset[0], import.meta.url));
      res.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8" }).end(file);
      return;
    }
    if (req.headers["x-tram-ads"] !== "1") return json(403, { error: "Hãy mở bảng điều khiển." });
    if (req.method === "GET" && url.pathname === "/api/state") return json(200, await status());
    if (req.method === "GET" && url.pathname === "/api/report") {
      const date = validateDate(url.searchParams.get("date") || yesterday());
      const { report, text } = await prepareReport(date, url.searchParams.get("group") || "default");
      const id = randomUUID();
      for (const [key, entry] of drafts) if (entry.until < Date.now()) drafts.delete(key);
      if (drafts.size >= 50) drafts.delete(drafts.keys().next().value!);
      drafts.set(id, { text, until: Date.now() + 30 * 60000 });
      return json(200, { report, text, id });
    }
    if (req.method !== "POST" || req.headers.origin !== origin || req.headers["content-type"] !== "application/json")
      return json(405, { error: "Yêu cầu không hợp lệ." });
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) return json(413, { error: "Nội dung quá dài." });
    }
    const data = JSON.parse(body) as Record<string, unknown>;
    const field = (name: string) => typeof data[name] === "string" ? data[name] : "";
    if (["/api/request", "/api/request-preview"].includes(url.pathname)) return json(200, await requestAction(url.pathname, data));
    if (["/api/inspect", "/api/group"].includes(url.pathname)) return json(200, await groupAction(url.pathname, data));
    if (url.pathname === "/api/pair") return json(200, await pairing.start(field("token")));
    if (url.pathname === "/api/confirm") return json(200, await pairing.finish(field("code")));
    if (url.pathname === "/api/source") {
      const month = field("month"), link = field("url").trim();
      const match = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(link);
      if (!match || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Kiểm tra tháng và đường dẫn Google Sheets.");
      const registry = await getRegistry();
      const group = registry.groups.find(g => g.id === "default")!;
      if (group.sources[month]) throw new Error("Tháng này đã có file trong danh sách.");
      group.sources[month] = { spreadsheetId: match[1], allowSharedExport: true };
      await saveGroup(group, registry.revision);
      return json(200, await status());
    }
    if (url.pathname === "/api/send") {
      if (!privateChat()) throw new Error("Hãy kết nối Telegram trước khi gửi thử.");
      const key = field("id"), entry = drafts.get(key);
      if (!entry || entry.until < Date.now()) throw new Error("Bản xem trước đã hết hạn hoặc đã dùng. Tải lại báo cáo và kiểm tra chat trước khi gửi tiếp.");
      drafts.delete(key);
      try { return json(200, { messageId: await telegramSend("BẢN GỬI THỬ\n\n" + entry.text) }); }
      catch (e) { if (e instanceof DeliveryError && e.definitelyRejected) drafts.set(key, entry); throw e; }
    }
    return json(404, { error: "Không tìm thấy thao tác." });
  } catch (error) {
    if (error instanceof GroupError) return json(error.status, { error: error.message });
    // Only present operational messages intended for the operator, never raw SDK errors.
    const message = error instanceof Error && /^(Telegram|Google Sheets trả HTTP|Google yêu cầu|Google không trả|Thiếu tab |Tab |Cấu trúc tab |Không |Nhập |Bot |Chưa |Liên kết |Bản xem |Hãy |Tháng |Kiểm tra |Ngày |Báo cáo vượt)/u.test(error.message)
      ? error.message : "Không thể hoàn tất. Kiểm tra kết nối và cấu hình nguồn rồi thử lại.";
    return json(400, { error: message });
  }
});
server.listen(port, "127.0.0.1", () => console.log(APP_NAME + " · " + origin));
