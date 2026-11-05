"use strict";
const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const longDate = new Intl.DateTimeFormat("vi-VN", { dateStyle: "full", timeZone: "UTC" });
const shortTime = new Intl.DateTimeFormat("vi-VN", { timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const productCodes = { "Hàn Quốc": "KR", "Thượng Hải": "SH", "Đài Loan": "TW", "Khách Sạn": "KS" };
let state, current, pairingCode, requestNumber = 0;
const el = (name, text, cls) => {
  const node = document.createElement(name);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
function external(label, url) {
  const a = el("a", label); a.href = url; a.target = "_blank"; a.rel = "noreferrer"; return a;
}
async function api(path, body) {
  const headers = { "X-Tram-Ads": "1" };
  const options = { headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.method = "POST"; options.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch("/api/" + path, options); }
  catch { throw new Error("Mất kết nối với bảng điều khiển. Mở lại trên máy rồi thử lại."); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Chưa hoàn tất thao tác.");
  return result;
}
function feedback(id, text = "", error = false) {
  const node = $(id); node.textContent = text; node.classList.toggle("error", error);
}
function route() {
  const setup = location.hash === "#settings";
  $("reportView").hidden = setup; $("settingsView").hidden = !setup;
  (setup ? $("navReport") : $("navSettings")).removeAttribute("aria-current");
  (setup ? $("navSettings") : $("navReport")).setAttribute("aria-current", "page");
  document.title = (setup ? "Kết nối" : "Báo cáo quảng cáo") + " · Trạm Ads";
}
function updateState(data) {
  state = data;
  $("scheduleTime").textContent = data.deliveryTime;
  $("scheduleStatus").textContent = data.localSendEnabled ? "Cần kiểm tra lịch trên cloud" : "Chưa bật gửi tự động";
  const paired = data.paired;
  $("telegramState").textContent = paired ? "Đã cấu hình chat riêng" : "Chưa kết nối chat riêng";
  $("pairLink").textContent = paired ? "Quản lý kết nối" : "Kết nối Telegram";
  $("botBadge").textContent = paired ? "Đã cấu hình" : "Chưa ghép nối";
  $("botBadge").className = "pill " + (paired ? "good" : "warn");
  $("token").required = !data.hasToken;
  $("tokenHint").textContent = data.hasToken ? "Để trống để dùng token đã lưu, hoặc nhập token của bot mới." : "Token được lưu trên máy sau khi ghép nối.";
  $("sourceList").replaceChildren(...data.months.map(source => {
    const li = el("li"), [year, month] = source.month.split("-");
    const a = external("File tháng " + month + "/" + year, source.url);
    const arrow = el("span", "↗"); arrow.setAttribute("aria-hidden", "true"); a.append(arrow); li.append(a); return li;
  }));
}
function summaryMetric(id, total, count) {
  const node = $(id); node.textContent = total.known ? nf.format(total.value) : "—";
  if (id === "cost" && total.known) node.append(el("em", "₫"));
  $(id + "Note").textContent = total.known + "/" + count + " sản phẩm đã nhập";
}
function showReport({ report }) {
  const { rows, totals } = report;
  summaryMetric("cost", totals.cost, rows.length);
  summaryMetric("messages", totals.messages, rows.length);
  summaryMetric("phones", totals.phones, rows.filter(row => row.tracksPhones).length);
  const partial = [totals.cost, totals.messages, totals.phones].some(metric => !metric.complete);
  $("quality").textContent = partial ? "Dữ liệu một phần" : (report.confirmed ? "Đã chốt dữ liệu" : "Đủ chỉ số · Chưa chốt");
  $("quality").className = "pill " + (partial ? "warn" : "good");
  $("rows").replaceChildren(...rows.map(row => {
    const tr = el("tr"), label = el("th"), name = el("span", undefined, "productLabel");
    label.scope = "row";
    const tag = el("span", productCodes[row.name] || "", "tag"); tag.setAttribute("aria-hidden", "true");
    name.append(tag, document.createTextNode(row.name)); label.append(name);
    const cost = el("td", row.cost === null ? "—" : nf.format(row.cost) + " ₫", "moneyCol");
    if (row.cost !== null && totals.cost.value > 0) {
      const bar = el("progress"); bar.max = totals.cost.value; bar.value = row.cost;
      bar.setAttribute("aria-label", "Tỷ trọng chi phí đã nhập của " + row.name); cost.append(bar);
    }
    const messages = el("td", row.messages === null ? "—" : nf.format(row.messages));
    const phones = el("td", row.tracksPhones ? (row.phones === null ? "—" : nf.format(row.phones)) : "Không theo dõi", row.tracksPhones ? "" : "na");
    tr.append(label, cost, messages, phones); return tr;
  }));
  $("tableNote").replaceChildren(document.createTextNode("Đọc lúc " + shortTime.format(new Date(report.fetchedAt)) + " · Dấu — là ô chưa có số liệu. "), external("Mở Google Sheets ↗", report.sourceUrl));
}
async function loadReport() {
  const serial = ++requestNumber;
  const date = $("date").value;
  $("preview").disabled = true; current = undefined;
  for (const id of ["cost", "messages", "phones"]) { $(id).textContent = "—"; $(id + "Note").textContent = ""; }
  $("quality").textContent = "Đang đọc dữ liệu"; $("quality").className = "pill";
  $("rows").replaceChildren(); $("tableNote").textContent = "Đang đọc Google Sheets…";
  $("reload").disabled = true;
  try {
    if (!date || !$("date").validity.valid) throw new Error("Chọn một ngày báo cáo hợp lệ.");
    const displayDate = longDate.format(new Date(date + "T00:00:00Z"));
    $("dateDescription").textContent = displayDate[0].toLocaleUpperCase("vi") + displayDate.slice(1);
    const data = await api("report?date=" + encodeURIComponent(date));
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
  $("send").disabled = !!current.sent;
  feedback("sendFeedback", current.sent ? "Đã gửi bản thử này vào Telegram." : "");
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
$("sourceForm").onsubmit = async event => {
  event.preventDefault();
  const button = $("sourceForm").querySelector("button"); button.disabled = true;
  try {
    updateState(await api("source", { month: $("month").value, url: $("sheetUrl").value }));
    $("sourceForm").reset(); feedback("sourceFeedback", "Đã lưu nguồn trên máy. Chọn ngày thuộc tháng vừa thêm để đọc báo cáo.");
  } catch (error) { feedback("sourceFeedback", error.message, true); }
  finally { button.disabled = false; }
};
window.addEventListener("hashchange", route);
async function init() {
  route();
  try {
    updateState(await api("state"));
    $("date").value = new URLSearchParams(location.search).get("date") || state.defaultDate;
    await loadReport();
  } catch (error) { $("fatal").hidden = false; $("fatal").textContent = error.message; }
}
init();
