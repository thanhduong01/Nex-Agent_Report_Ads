let editingRequestId, requestDirty = false, requestPreviewVersion = 0;
function requestDraft() {
  return { id: editingRequestId, name: $("reqName").value.trim(), command: $("reqCommand").value.trim(),
    phrases: $("reqPhrases").value.split(/\n/).map(s => s.trim()).filter(Boolean),
    groupMode: $("reqGroupMode").value, groupIds: $("reqGroupMode").value === "selected"
      ? [...$("reqGroups").querySelectorAll("input:checked")].map(i => i.value) : [],
    reportDay: $("reqReportDay").value, format: $("reqFormat").value,
    allowDate: $("reqAllowDate").checked, enabled: $("reqEnabled").checked };
}
function setupRequests(data) {
  if (!editingRequestId) editingRequestId = data.requests[0]?.id;
  $("newRequest").disabled = !data.canEditGroups || data.requests.length >= 20;
  $("requestCount").textContent = data.requests.length;
  $("requestList").replaceChildren(...data.requests.map(rule => {
    const button = el("button", undefined, "requestCard"); button.type = "button";
    button.setAttribute("aria-pressed", String(rule.id === editingRequestId));
    const top = el("span", undefined, "requestCardTop");
    top.append(el("code", "/" + rule.command), el("span", rule.enabled ? "Đang bật" : "Tạm tắt", "pill " + (rule.enabled ? "good" : "")));
    button.append(top, el("strong", rule.name), el("small", (rule.groupMode === "all" ? "Tất cả nhóm" : rule.groupIds.length + " nhóm") + " · " + (rule.reportDay === "today" ? "Hôm nay" : "Hôm qua")));
    button.onclick = () => {
      if (requestDirty && !confirm("Bỏ thay đổi chưa lưu để mở yêu cầu khác?")) return;
      requestDirty = false; editingRequestId = rule.id; setupRequests(state);
    };
    return button;
  }));
  if (!data.requests.length) $("requestList").append(el("p", "Chưa có yêu cầu. Tạo lệnh đầu tiên để bot lấy báo cáo.", "hint"));
  if (requestDirty) return;
  fillRequest(data.requests.find(r => r.id === editingRequestId));
}
function fillRequest(rule) {
  editingRequestId = rule?.id || crypto.randomUUID();
  $("requestEditorTitle").textContent = rule ? "Chỉnh yêu cầu" : "Tạo yêu cầu";
  $("reqName").value = rule?.name || ""; $("reqCommand").value = rule?.command || "";
  $("reqPhrases").value = rule?.phrases.join("\n") || "";
  $("reqGroupMode").value = rule?.groupMode || "all";
  $("reqGroups").replaceChildren(...state.groups.map(group => {
    const label = el("label", undefined, "checkLabel"), input = el("input");
    input.type = "checkbox"; input.value = group.id; input.checked = rule?.groupIds.includes(group.id) || false;
    label.append(input, document.createTextNode(group.name)); return label;
  }));
  $("reqReportDay").value = rule?.reportDay || "today"; $("reqFormat").value = rule?.format || "detailed";
  $("reqAllowDate").checked = rule?.allowDate ?? true; $("reqEnabled").checked = rule?.enabled ?? true;
  $("reqTestMessage").value = rule ? "/" + rule.command : "";
  $("requestFields").disabled = !state.canEditGroups;
  $("saveRequest").disabled = !state.canEditGroups; $("deleteRequest").hidden = !rule || !state.canEditGroups;
  $("testRequest").disabled = !state.canEditGroups;
  $("requestSaveState").textContent = rule ? "Đã lưu" : "Bản mới";
  $("requestSaveState").className = "pill";
  $("requestConversation").replaceChildren(el("p", "Nhập lệnh hoặc câu yêu cầu phía trên để xem bot sẽ trả lời thế nào.", "previewEmpty"));
  feedback("requestFeedback", state.canEditGroups ? "" : "Kết nối kho cấu hình trong trang Kết nối để lưu yêu cầu.");
  feedback("requestTestFeedback"); requestPreviewVersion++; requestHints();
}
function requestHints() {
  $("reqGroupChoices").hidden = $("reqGroupMode").value !== "selected";
  $("reqExample").textContent = $("reqAllowDate").checked
    ? "Ví dụ: /" + ($("reqCommand").value || "baocao") + " 02/11/2026"
    : "Bot dùng ngày mặc định ở trên cho cả lệnh và câu yêu cầu.";
}
document.getElementById("newRequest").onclick = () => {
  if (requestDirty && !confirm("Bỏ thay đổi chưa lưu để tạo yêu cầu mới?")) return;
  requestDirty = false; editingRequestId = "new"; setupRequests(state); $("reqName").focus();
};
document.getElementById("requestForm").oninput = () => {
  requestDirty = true; requestHints(); requestPreviewVersion++;
  $("requestSaveState").textContent = "Chưa lưu"; $("requestSaveState").className = "pill warn";
  feedback("requestTestFeedback", "Cấu hình đã đổi. Chạy thử lại để xem phản hồi mới.");
};
document.getElementById("reqCommand").onchange = () => {
  if (!$("reqTestMessage").value || /^\/[a-z_0-9]*$/.test($("reqTestMessage").value)) $("reqTestMessage").value = "/" + $("reqCommand").value;
};
document.getElementById("requestForm").onsubmit = async event => {
  event.preventDefault(); $("saveRequest").disabled = true;
  try {
    await api("request", { request: requestDraft(), revision: state.revision });
    requestDirty = false; updateState(await api("state"));
    feedback("requestFeedback", "Đã lưu yêu cầu. Bot dùng cấu hình mới cho tin nhắn tiếp theo.");
  } catch (error) { feedback("requestFeedback", error.message, true); }
  finally { $("saveRequest").disabled = !state.canEditGroups; }
};
document.getElementById("deleteRequest").onclick = async () => {
  if (!confirm("Xóa yêu cầu này? Bot sẽ không còn nhận lệnh và các câu đã đặt cho yêu cầu này.")) return;
  $("deleteRequest").disabled = true;
  try {
    await api("request", { id: editingRequestId, remove: true, revision: state.revision });
    requestDirty = false; editingRequestId = undefined; updateState(await api("state")); feedback("requestFeedback", "Đã xóa yêu cầu.");
  } catch (error) { feedback("requestFeedback", error.message, true); }
  finally { $("deleteRequest").disabled = false; }
};
document.getElementById("requestTestForm").onsubmit = async event => {
  event.preventDefault(); if (!$("requestForm").reportValidity()) return;
  const message = $("reqTestMessage").value.trim(), version = ++requestPreviewVersion;
  $("testRequest").disabled = true;
  $("requestConversation").replaceChildren(el("p", message, "chatUser"));
  feedback("requestTestFeedback", "Đang đọc Google Sheets…");
  try {
    const result = await api("request-preview", { request: requestDraft(), message });
    if (version !== requestPreviewVersion) return;
    for (const report of result.reports) $("requestConversation").append(el("pre", report.text, "chatBot"));
    feedback("requestTestFeedback", "Đã chạy thử · " + result.reports.length + " nhóm · " + result.date + ($("reqEnabled").checked ? "" : " · Yêu cầu đang tắt trong Telegram"));
  } catch (error) { if (version === requestPreviewVersion) feedback("requestTestFeedback", error.message, true); }
  finally { $("testRequest").disabled = !state.canEditGroups; }
};
window.addEventListener("beforeunload", event => { if (requestDirty) { event.preventDefault(); event.returnValue = ""; } });
