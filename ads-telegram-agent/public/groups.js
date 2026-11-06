let editingGroupId, inspectedUrl = "", inspection = [];
function currentGroup() { return state.groups.find(group => group.id === editingGroupId); }
function setupGroups(data) {
  const selected = document.getElementById("reportGroup").value || new URLSearchParams(location.search).get("group") || "default";
  for (const id of ["reportGroup", "settingsGroup"]) {
    const select = document.getElementById(id); select.replaceChildren(...data.groups.map(group => new Option(group.name, group.id)));
  }
  document.getElementById("reportGroup").value = data.groups.some(g => g.id === selected) ? selected : data.groups[0]?.id || "";
  editingGroupId = data.groups.some(g => g.id === editingGroupId) ? editingGroupId : document.getElementById("reportGroup").value;
  document.getElementById("settingsGroup").value = editingGroupId;
  document.getElementById("storageStatus").textContent = data.canEditGroups
    ? (data.cloud ? "Cấu hình được lưu riêng tư và có hiệu lực ngay sau khi lưu. Mỗi nhóm có lịch bật/tắt riêng." : "Cấu hình được lưu trên máy. Mỗi nhóm có nguồn và cách đọc chỉ số riêng.")
    : "Kết nối kho Vercel Blob riêng tư để lưu nhóm báo cáo trên web.";
  document.getElementById("newGroup").disabled = !data.canEditGroups;
  document.getElementById("sourceEditor").hidden = !data.canEditGroups;
  $("schedulerState").textContent = !data.cloud ? "Bản trên máy chỉ dùng cấu hình và xem thử. Lịch tự động dùng cấu hình đã lưu trên website."
    : data.scheduler?.checkedAt ? (data.scheduler.healthy ? "Đã kết nối" : "Chưa nhận lần kiểm tra mới") + " · Ghi nhận lúc " + new Date(data.scheduler.checkedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "Chưa ghi nhận lần kiểm tra. Xem trạng thái workflow trên GitHub.";
  $("schedulerRuns").href = data.scheduler?.runUrl || data.scheduler?.workflowUrl || "https://github.com/thanhduong01/Nex-Agent_Report_Ads/actions";
  fillGroup(); updateGroupSchedule();
}
function updateGroupSchedule() {
  const group = state.groups.find(g => g.id === $("reportGroup").value);
  const schedule = group?.schedule;
  $("scheduleTime").textContent = schedule?.time || "09:00";
  $("scheduleDays").textContent = (schedule?.days.length === 7 ? "Hằng ngày" : (schedule?.days || []).map(d => ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d]).join(", ")) + " · giờ Việt Nam";
  $("scheduleStatus").textContent = !schedule?.enabled ? "Nhóm này đang tạm dừng" : !state.canSend || state.scheduler?.telegramConnected === false ? "Cần kiểm tra kết nối Telegram"
    : state.scheduler?.healthy ? "Đã bật · GitHub Actions" : "Đã lưu lịch · Kiểm tra GitHub";
  $("scheduleDetail").textContent = "Báo cáo " + ({last7:"7 ngày gần nhất.",month:"tháng này."}[schedule?.period] || (schedule?.reportDay === "today" ? "hôm nay · đang cập nhật." : "ngày hôm trước."));
}
function fillGroup() {
  const group = currentGroup();
  const schedule = group?.schedule || { enabled: false, time: "09:00", days: [0, 1, 2, 3, 4, 5, 6], reportDay: "yesterday" };
  $("groupName").value = group?.name || ""; $("groupEnabled").checked = schedule.enabled;
  $("groupTime").value = schedule.time; $("groupReportDay").value = schedule.period || schedule.reportDay;
  for (const input of document.querySelectorAll(".weekdays input")) input.checked = schedule.days.includes(Number(input.value));
  $("nextRun").textContent = group?.nextRun ? "Lần gửi tiếp theo: " + new Date(group.nextRun).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Lịch đang tắt. Chọn giờ và bật khi bạn sẵn sàng.";
  $("groupForm").querySelector("button").disabled = !state.canEditGroups;
  $("sourceList").replaceChildren();
  for (const [month, source] of Object.entries(group?.sources || {}).sort(([a], [b]) => b.localeCompare(a))) {
    const li = el("li", undefined, "sourceItem"), description = el("div");
    description.append(external("Tháng " + month.split("-").reverse().join("/"), "https://docs.google.com/spreadsheets/d/" + source.spreadsheetId + "/edit"));
    description.append(el("small", source.mappings?.map(m => m.sheet).join(" · ") || "4 sản phẩm · Mẫu hiện tại"));
    const actions = el("div", undefined, "sourceActions");
    const edit = el("button", "Sửa", "secondary"); edit.type = "button"; edit.disabled = !state.canEditGroups;
    edit.onclick = () => {
      $("sourceEditor").open = true; $("month").value = month;
      $("sheetUrl").value = "https://docs.google.com/spreadsheets/d/" + source.spreadsheetId + "/edit";
      inspectSource(source.mappings); $("sourceEditor").scrollIntoView({ block: "start" });
    };
    const remove = el("button", "Gỡ", "secondary"); remove.type = "button"; remove.disabled = !state.canEditGroups;
    remove.onclick = async () => {
      if (!confirm("Gỡ nguồn tháng " + month + " khỏi nhóm " + group.name + "?")) return;
      remove.disabled = true;
      try {
        await api("group", { ...groupPayload(), removeMonth: month });
        updateState(await api("state")); feedback("groupFeedback", "Đã gỡ nguồn tháng " + month + ".");
      } catch (error) { feedback("groupFeedback", error.message, true); remove.disabled = false; }
    };
    actions.append(edit, remove); li.append(description, actions); $("sourceList").append(li);
  }
  if (!group || !Object.keys(group.sources).length) $("sourceList").append(el("li", "Chưa có nguồn. Thêm file đầu tiên bên dưới."));
  feedback("groupFeedback");
  $("sourceForm").reset(); $("mappingList").replaceChildren(); $("saveSource").disabled = true; inspectedUrl = "";
  $("month").value = state.defaultDate.slice(0, 7); feedback("sourceFeedback");
}
function groupPayload() {
  return { id: editingGroupId, name: $("groupName").value.trim(), enabled: $("groupEnabled").checked, revision: state.revision,
    schedule: { enabled: $("groupEnabled").checked, time: $("groupTime").value, reportDay: $("groupReportDay").value === "yesterday" ? "yesterday" : "today",
      ...(["last7","month"].includes($("groupReportDay").value)?{period:$("groupReportDay").value}:{}),
      days: [...document.querySelectorAll(".weekdays input:checked")].map(input => Number(input.value)) } };
}
function columnName(index) {
  if (index === null) return "";
  return index < 26 ? String.fromCharCode(65 + index) : "A" + String.fromCharCode(65 + index - 26);
}
function columnIndex(value) {
  const v = value.trim().toUpperCase();
  if (!/^(?:[A-Z]|A[A-Z])$/.test(v)) throw new Error("Cột cần có tên từ A đến AZ.");
  return v.length === 1 ? v.charCodeAt(0) - 65 : 26 + v.charCodeAt(1) - 65;
}
function mappingInput(box, field, title, value, type = "text") {
  const label = el("label", title), input = el("input"); input.type = type; input.value = value; input.dataset.field = field;
  label.append(input); box.append(label); return input;
}
function renderMappings(saved) {
  $("mappingList").replaceChildren();
  for (const item of inspection) {
    const selectedMapping = saved?.find(m => m.sheet === item.sheet);
    const mapping = selectedMapping || item.mapping;
    const card = el("fieldset", undefined, "mappingCard"); card.dataset.sheet = item.sheet;
    const legend = el("legend"), label = el("label", undefined, "checkLabel"), chosen = el("input"); chosen.type = "checkbox"; chosen.dataset.field = "chosen";
    chosen.checked = saved ? !!selectedMapping : !!mapping && (!item.months.length || item.months.includes($("month").value));
    label.append(chosen, document.createTextNode(item.sheet)); legend.append(label); card.append(legend);
    card.append(el("p", item.months.length ? "Tháng trong dữ liệu · " + item.months.join(", ") : "Chọn tháng và kiểm tra cột ngày.", "hint"));
    mappingInput(card, "name", "Tên sản phẩm hiển thị", mapping?.name || item.sheet.trim());
    const detail = el("details"); detail.append(el("summary", "Cột dữ liệu")); const grid = el("div", undefined, "mappingGrid");
    mappingInput(grid, "dateColumn", "Cột ngày", columnName(mapping?.dateColumn ?? 0));
    const dateLabel = el("label", "Kiểu ngày"), mode = el("select"); mode.dataset.field = "dateMode";
    mode.append(new Option("Ngày trong tháng (1–31)", "day"), new Option("Ngày đầy đủ", "date")); mode.value = mapping?.dateMode || "date"; dateLabel.append(mode); grid.append(dateLabel);
    const start = mappingInput(grid, "startRow", "Dòng bắt đầu", mapping?.startRow || 4, "number"); start.min = "2"; start.max = "100";
    mappingInput(grid, "costColumn", "Cột chi phí Ads", columnName(mapping?.costColumn ?? 5));
    mappingInput(grid, "messagesColumn", "Cột tin nhắn", columnName(mapping?.messagesColumn ?? 6));
    mappingInput(grid, "phonesColumn", "Cột SĐT · Trống nếu không theo dõi", columnName(mapping?.phonesColumn ?? null));
    mappingInput(grid, "spendColumns", "Cột chi tiêu gốc · Ví dụ B,D", (mapping?.spendColumns || [1]).map(columnName).join(","));
    detail.append(grid); card.append(detail); $("mappingList").append(card);
  }
}
async function inspectSource(saved) {
  const url = $("sheetUrl").value.trim();
  if (!url || !$("sheetUrl").checkValidity()) { feedback("sourceFeedback", "Nhập đường dẫn Google Sheets hợp lệ.", true); return; }
  $("inspectSource").disabled = true; $("saveSource").disabled = true; feedback("sourceFeedback", "Đang đọc tiêu đề và ngày trong các tab…");
  try {
    const result = await api("inspect", { url });
    if ($("sheetUrl").value.trim() !== url) return;
    inspection = result.sheets; inspectedUrl = url; renderMappings(saved); $("saveSource").disabled = false;
    feedback("sourceFeedback", "Đã đọc " + inspection.length + " tab. Chọn các tab cần báo cáo và kiểm tra cột trước khi lưu.");
  } catch (error) { feedback("sourceFeedback", error.message, true); }
  finally { $("inspectSource").disabled = false; }
}
function readMappings() {
  return [...$("mappingList").querySelectorAll("fieldset")].filter(card => card.querySelector('[data-field="chosen"]').checked).map(card => {
    const value = field => card.querySelector('[data-field="' + field + '"]').value;
    return { sheet: card.dataset.sheet, name: value("name"), startRow: Number(value("startRow")), dateColumn: columnIndex(value("dateColumn")),
      dateMode: value("dateMode"), costColumn: columnIndex(value("costColumn")), messagesColumn: columnIndex(value("messagesColumn")),
      phonesColumn: value("phonesColumn").trim() ? columnIndex(value("phonesColumn")) : null,
      spendColumns: value("spendColumns").split(",").map(columnIndex) };
  });
}
document.getElementById("newGroup").onclick = () => {
  editingGroupId = crypto.randomUUID(); $("settingsGroup").value = ""; fillGroup(); $("groupName").focus();
  $("sourceEditor").open = true; feedback("groupFeedback", "Đặt tên nhóm, thêm nguồn và xem thử báo cáo trước khi bật lịch.");
};
document.getElementById("settingsGroup").onchange = () => { editingGroupId = $("settingsGroup").value; fillGroup(); };
document.getElementById("reportGroup").onchange = () => {
  const url = new URL(location.href); url.searchParams.set("group", $("reportGroup").value); history.replaceState(null, "", url); updateGroupSchedule(); loadReport();
};
document.getElementById("groupForm").onsubmit = async event => {
  event.preventDefault(); const button = $("groupForm").querySelector("button"); button.disabled = true;
  try { await api("group", groupPayload()); updateState(await api("state")); feedback("groupFeedback", "Đã lưu nhóm và lịch gửi."); }
  catch (error) { feedback("groupFeedback", error.message, true); }
  finally { button.disabled = false; }
};
document.getElementById("inspectSource").onclick = () => inspectSource();
document.getElementById("sheetUrl").oninput = () => { $("saveSource").disabled = true; inspectedUrl = ""; };
document.getElementById("month").onchange = () => { if (inspection.length && inspectedUrl) renderMappings(); };
document.getElementById("sourceForm").onsubmit = async event => {
  event.preventDefault(); $("saveSource").disabled = true; feedback("sourceFeedback", "Đang kiểm tra và lưu nguồn…");
  try {
    if (!inspectedUrl || inspectedUrl !== $("sheetUrl").value.trim()) throw new Error("Đọc lại các tab trước khi lưu.");
    const mappings = readMappings(); if (!mappings.length) throw new Error("Chọn ít nhất một tab cần báo cáo.");
    await api("group", { ...groupPayload(), source: { month: $("month").value, url: inspectedUrl, mappings } });
    updateState(await api("state")); feedback("sourceFeedback", "Đã lưu nguồn. Chọn nhóm và ngày ở Báo cáo để xem kết quả.");
  } catch (error) { feedback("sourceFeedback", error.message, true); $("saveSource").disabled = !inspectedUrl; }
};
