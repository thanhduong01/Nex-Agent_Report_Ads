"use strict";
const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const longDate = new Intl.DateTimeFormat("vi-VN", { dateStyle: "full", timeZone: "UTC" });
const shortTime = new Intl.DateTimeFormat("vi-VN", { timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const productCodes = { "Hàn Quốc": "KR", "Thượng Hải": "SH", "Đài Loan": "TW", "Khách Sạn": "KS" };
let state, current, pairingCode, requestNumber = 0, access = false;
const el = (name, text, cls) => {
  const node = document.createElement(name);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
function external(label, url) {
  const a = el("a", label); a.href = url; a.target = "_blank"; a.rel = "noreferrer"; return a;
}
async function api(path, body, timeoutMs) {
  const headers = { "X-Tram-Ads": "1" };
  const options = { headers };
  if (timeoutMs) options.signal = AbortSignal.timeout(timeoutMs);
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.method = "POST"; options.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch("/api/" + path, options); }
  catch { throw new Error(options.signal?.aborted ? "Kiểm tra kết nối quá thời gian chờ. Bấm nút để thử lại." : "Mất kết nối với bảng điều khiển. Tải lại trang rồi thử lại."); }
  let result;
  try { result = await response.json(); }
  catch { throw new Error("Máy chủ chưa trả API báo cáo. Kiểm tra bản deploy và cấu hình Vercel."); }
  if (!response.ok) {
    if (result.code === "login" || result.code === "setup") showAccess(result);
    throw new Error(result.error || "Chưa hoàn tất thao tác.");
  }
  return result;
}
function showAccess(result) {
  access = false; current = undefined;
  $("accessView").hidden = false; $("logout").hidden = true;
  $("accessTitle").textContent = result.code === "setup" ? "Thiết lập truy cập" : "Đăng nhập";
  $("accessDescription").textContent = result.code === "setup" ? result.error : "Nhập mật khẩu quản trị để xem báo cáo quảng cáo.";
  $("loginForm").hidden = result.code === "setup";
  $("locationLabel").textContent = "Bản web";
  route();
}
function feedback(id, text = "", error = false) {
  const node = $(id); node.textContent = text; node.classList.toggle("error", error);
}
function route() {
  const selected = ["#settings", "#requests", "#sources", "#templates", "#history"].includes(location.hash) ? location.hash.slice(1) : "report";
  for (const [view, nav] of [["report", "navReport"], ["settings", "navSettings"], ["requests", "navRequests"],["sources","navSources"],["templates","navTemplates"],["history","navHistory"]]) {
    $(view + "View").hidden = !access || view !== selected;
    if (view === selected) $(nav).setAttribute("aria-current", "page"); else $(nav).removeAttribute("aria-current");
  }
  document.title = ({ settings: "Kết nối & lịch gửi", requests: "Yêu cầu bot", report: "Báo cáo quảng cáo",sources:"Nguồn dữ liệu",templates:"Mẫu & chỉ số",history:"Lịch sử báo cáo" })[selected] + " · Nex Report Ads Performance";
  if (selected === "settings" && access && state) checkTelegram(false);
  if (selected === "history" && access && state && typeof loadReportHistory === "function") loadReportHistory();
}
function updateState(data) {
  state = data;
  access = true; $("accessView").hidden = true; $("fatal").hidden = true; route();
  $("locationLabel").textContent = data.cloud ? "Bản web" : "Trên máy này";
  $("logout").hidden = !data.cloud;
  $("settingsEyebrow").textContent = data.cloud ? "CẤU HÌNH TRÊN VERCEL" : "CẤU HÌNH TRÊN MÁY";
  $("pairForm").hidden = data.cloud;
  $("cloudTelegram").hidden = !data.cloud;
  $("commandsBox").hidden = !data.cloud;
  $("scheduleTime").textContent = data.deliveryTime;
  $("scheduleStatus").textContent = data.localSendEnabled ? "Đã bật trong cấu hình" : "Chưa bật gửi tự động";
  const paired = data.paired;
  $("telegramState").textContent = data.scheduler?.telegramConnected === false ? "Kết nối Telegram cần kiểm tra" : paired ? "Đã cấu hình chat riêng" : "Chưa kết nối chat riêng";
  $("pairLink").textContent = paired ? "Quản lý kết nối" : "Kết nối Telegram";
  $("botBadge").textContent = data.scheduler?.telegramConnected === false ? "Cần kiểm tra kết nối" : paired ? "Đã cấu hình" : "Chưa ghép nối";
  $("botBadge").className = "pill " + (paired && data.scheduler?.telegramConnected !== false ? "good" : "warn");
  $("token").required = !data.hasToken;
  $("tokenHint").textContent = data.hasToken ? "Để trống để dùng token đã lưu, hoặc nhập token của bot mới." : "Token được lưu trên máy sau khi ghép nối.";
  setupGroups(data);
  setupRequests(data);
  setupTelegram(data);
  if (typeof setupBuilder === "function") setupBuilder(data);
}
function summaryMetric(id, total, count, currency = "VND") {
  const node = $(id); node.textContent = total.known ? nf.format(total.value) : "—";
  if (id === "cost" && total.known) node.append(el("em", currency === "VND" ? "₫" : currency));
  $(id + "Note").textContent = total.known + "/" + count + " sản phẩm đã nhập";
}
function showReport({ report }) {
  const { rows, totals } = report;
  summaryMetric("cost", totals.cost, rows.length, report.currency || "VND");
  summaryMetric("messages", totals.messages, rows.length);
  summaryMetric("phones", totals.phones, rows.filter(row => row.tracksPhones).length);
  const partial = report.metricValues ? report.metricValues.some(metric => metric.value === null) :
    [totals.cost, totals.messages, ...(rows.some(row=>row.tracksPhones)?[totals.phones]:[])].some(metric => !metric.complete);
  if ($("reportCustomMetrics")) {
    $("legacyMetricGrid").hidden = !!report.metricValues;
    $("reportCustomMetrics").hidden = !report.metricValues;
    $("reportCustomMetrics").replaceChildren(...(report.metricValues||[]).map(metric=>{
      const card=el("article",undefined,"customMetric"),value=metric.value===null?"Không tính được":new Intl.NumberFormat("vi-VN",{minimumFractionDigits:metric.decimals,maximumFractionDigits:metric.decimals}).format(metric.value)+(metric.unit==="currency"?" "+(report.currency||"VND"):metric.unit==="percent"?"%":"");
      card.append(el("h3",metric.name),el("strong",value),el("small",metric.reason||metric.formula));return card;
    }));
  }
  $("quality").textContent = partial ? "Dữ liệu một phần" : (report.confirmed ? "Đã chốt dữ liệu" : "Đủ chỉ số · Chưa chốt");
  $("quality").className = "pill " + (partial ? "warn" : "good");
  $("rows").replaceChildren(...rows.map(row => {
    const tr = el("tr"), label = el("th"), name = el("span", undefined, "productLabel");
    label.scope = "row";
    const tag = el("span", productCodes[row.name] || "", "tag"); tag.setAttribute("aria-hidden", "true");
    name.append(tag, document.createTextNode(row.name)); label.append(name);
    const cost = el("td", row.cost === null ? "—" : nf.format(row.cost) + " " + (!report.currency||report.currency==="VND"?"₫":report.currency), "moneyCol");
    if (row.cost !== null && totals.cost.value > 0) {
      const bar = el("progress"); bar.max = totals.cost.value; bar.value = row.cost;
      bar.setAttribute("aria-label", "Tỷ trọng chi phí đã nhập của " + row.name); cost.append(bar);
    }
    const messages = el("td", row.messages === null ? "—" : nf.format(row.messages));
    const phones = el("td", row.tracksPhones ? (row.phones === null ? "—" : nf.format(row.phones)) : "Không theo dõi", row.tracksPhones ? "" : "na");
    tr.append(label, cost, messages, phones); return tr;
  }));
  $("tableNote").replaceChildren(document.createTextNode("Đọc lúc " + shortTime.format(new Date(report.fetchedAt)) + " · Dấu — là ô chưa có số liệu. "), external(report.sourceKind && report.sourceKind!=="sheets"?"Mở Ads Manager ↗":"Mở Google Sheets ↗", report.sourceUrl));
}
async function loadReport() {
  const serial = ++requestNumber;
  const date = $("date").value;
  $("preview").disabled = true; current = undefined;
  for (const id of ["cost", "messages", "phones"]) { $(id).textContent = "—"; $(id + "Note").textContent = ""; }
  $("quality").textContent = "Đang đọc dữ liệu"; $("quality").className = "pill";
  $("rows").replaceChildren(); $("tableNote").textContent = "Đang đọc nguồn báo cáo…";
  $("reload").disabled = true;
  try {
    if (!date || !$("date").validity.valid) throw new Error("Chọn một ngày báo cáo hợp lệ.");
    const displayDate = longDate.format(new Date(date + "T00:00:00Z"));
    $("dateDescription").textContent = displayDate[0].toLocaleUpperCase("vi") + displayDate.slice(1);
    const data = await api("report?date=" + encodeURIComponent(date) + "&group=" + encodeURIComponent($("reportGroup").value || "default"));
    if (serial !== requestNumber) return;
    current = data; showReport(data); $("preview").disabled = false;
  } catch (error) {
    if (serial !== requestNumber) return;
    $("quality").textContent = "Chưa đọc được"; $("quality").className = "pill warn";
    $("tableNote").replaceChildren(document.createTextNode(error.message + " "), Object.assign(el("a", "Kiểm tra nguồn"), { href: "#settings" }));
  } finally { if (serial === requestNumber) $("reload").disabled = false; }
}
$("date").addEventListener("change", () => {
  const url = new URL(location.href); url.searchParams.set("date", $("date").value); history.replaceState(null, "", url);
  loadReport();
});
$("reload").onclick = loadReport;
$("preview").onclick = () => {
  if (!current) return;
  $("draft").textContent = current.text;
  $("dialogConnect").hidden = state.paired; $("send").hidden = !state.paired;
  $("send").disabled = !!current.sent || !state.canSend;
  feedback("sendFeedback", current.sent ? "Đã gửi bản thử này vào Telegram." : (state.paired && !state.canSend ? "Kết nối kho lưu lịch sử gửi trước khi gửi thử." : ""));
  $("dialog").showModal();
};
$("close").onclick = () => $("dialog").close();
$("dialogConnect").onclick = () => $("dialog").close();
$("send").onclick = async () => {
  const draft = current; if (!draft) return;
  $("send").disabled = true; feedback("sendFeedback", "Đang gửi bản thử…");
  try { await api("send", { id: draft.id }); draft.sent = true; feedback("sendFeedback", "Telegram đã nhận bản gửi thử."); }
  catch (error) { feedback("sendFeedback", error.message, true); }
  finally { $("send").disabled = !!draft.sent; }
};
$("pairForm").onsubmit = async event => {
  event.preventDefault();
  const button = $("pairForm").querySelector("button"); button.disabled = true;
  $("pairNext").hidden = true; pairingCode = undefined;
  feedback("pairFeedback", "Đang kiểm tra bot…");
  try {
    const result = await api("pair", { token: $("token").value }); $("token").value = "";
    $("openBot").href = result.url; $("openBot").textContent = "Mở @" + result.name + " trong Telegram";
    pairingCode = result.code; $("pairNext").hidden = false; feedback("pairFeedback"); $("openBot").focus();
  } catch (error) { feedback("pairFeedback", error.message, true); }
  finally { button.disabled = false; }
};
$("confirm").onclick = async () => {
  $("confirm").disabled = true; feedback("pairFeedback", "Đang tìm lời chào của bạn…");
  try {
    await api("confirm", { code: pairingCode }); updateState(await api("state"));
    $("pairNext").hidden = true; pairingCode = undefined;
    feedback("pairFeedback", "Đã kết nối chat riêng. Mở Báo cáo và chọn Xem trước bản tin để gửi thử.");
  } catch (error) { feedback("pairFeedback", error.message, true); }
  finally { $("confirm").disabled = false; }
};
window.addEventListener("hashchange", route);
$("loginForm").onsubmit = async event => {
  event.preventDefault();
  const button = $("loginForm").querySelector("button");
  button.disabled = true; feedback("loginFeedback", "Đang đăng nhập…");
  try {
    await api("login", { password: $("password").value });
    $("password").value = ""; feedback("loginFeedback"); await init();
  } catch (error) { feedback("loginFeedback", error.message, true); }
  finally { button.disabled = false; }
};
$("logout").onclick = async () => {
  try {
    await api("logout", {}); showAccess({ code: "login" }); $("password").focus();
  } catch (error) { $("fatal").hidden = false; $("fatal").textContent = error.message; }
};
async function init() {
  route();
  try {
    updateState(await api("state"));
    $("date").value = new URLSearchParams(location.search).get("date") || state.defaultDate;
    if (state.groups.length) await loadReport();
  } catch (error) {
    if ($("accessView").hidden) { $("fatal").hidden = false; $("fatal").textContent = error.message; }
  }
}
init();
