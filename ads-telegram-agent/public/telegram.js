let telegramBusy = false, telegramCheckedAt = 0;
function showTelegramResult(text, connected = false, error = false) {
  feedback("commandsFeedback", text, error);
  $("botBadge").textContent = connected ? "Đã kết nối" : error ? "Cần kiểm tra kết nối" : "Chưa kết nối lệnh";
  $("botBadge").className = "pill " + (connected ? "good" : "warn");
  $("telegramState").textContent = connected ? "Đã kết nối Telegram" : text;
}
function setupTelegram(data) {
  if (!data.cloud || telegramBusy) return;
  // Keep the button usable even when configuration is incomplete so it can explain the problem.
  $("connectCommands").disabled = false;
  const issues = data.telegramConfiguration?.issues || [];
  if (issues.length) showTelegramResult(issues.join("\n"), false, true);
  else if (data.scheduler?.telegramIssue) showTelegramResult(data.scheduler.telegramIssue, false, true);
  else if (data.scheduler?.telegramConnected === false) showTelegramResult("Lần kiểm tra gần nhất chưa kết nối được Telegram. Bấm nút bên trên để xem lỗi hiện tại.", false, true);
  else feedback("commandsFeedback", "Bấm nút bên trên để kiểm tra kết nối và cập nhật menu lệnh.");
  if (location.hash === "#settings") checkTelegram(false);
}
async function checkTelegram(connect = false) {
  if (!state?.cloud || telegramBusy || !access) return;
  if (!connect && Date.now() - telegramCheckedAt < 30000) return;
  telegramBusy = true;
  const button = $("connectCommands"), label = button.textContent;
  if ($("connectedBot")) $("connectedBot").hidden = true;
  button.disabled = true; button.setAttribute("aria-busy", "true");
  button.textContent = connect ? "Đang kết nối Telegram…" : "Đang kiểm tra kết nối…";
  feedback("commandsFeedback", connect ? "Đang kết nối và cập nhật menu lệnh…" : "Đang kiểm tra kết nối Telegram hiện tại…");
  try {
    const result = await api(connect ? "telegram-connect" : "telegram-status", connect ? {} : undefined, connect ? 65000 : 20000);
    const botLink = $("connectedBot");
    if (botLink && result.botUsername) {
      botLink.href = "https://t.me/" + result.botUsername; botLink.textContent = "Mở @" + result.botUsername + " ↗"; botLink.hidden = false;
    }
    const traffic = $("telegramTraffic"), last = result.traffic;
    if (traffic) {
      const reasons = { "missing-chat": "Chưa cấu hình người nhận.", "private-only": "Lệnh được gửi trong nhóm. Hãy nhắn riêng cho bot.",
        "chat-mismatch": "Bot nhận được lệnh nhưng chat gửi không trùng TELEGRAM_CHAT_ID. Cập nhật đúng ID chat riêng của bạn trên Vercel rồi redeploy.",
        "sender-mismatch": "Người gửi chưa trùng chủ sở hữu đã cấu hình.", "stale": "Tin nhắn cũ quá 1 giờ đã được bỏ qua. Hãy gửi lệnh mới.",
        "telegram-rejected": "Telegram từ chối gửi trả lời. Kiểm tra chat nhận và bỏ chặn bot.", "delivery-uncertain": "Chưa xác nhận được kết quả gửi. Kiểm tra Telegram trước khi gửi lại.",
        "delivery-storage": "Bot đã nhận lệnh nhưng chưa ghi được lịch sử gửi. Kiểm tra kho Blob hoặc Redis trên Vercel." };
      traffic.textContent = !last ? "Chưa ghi nhận lệnh trên bản mới. Mở đúng bot ở trên, nhắn /help rồi quay lại kiểm tra kết nối."
        : "Lệnh gần nhất · " + new Date(last.at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) + " · " +
          (reasons[last.reason] || ({ received: "Đang xử lý lệnh.", sent: "Đã gửi phản hồi.", duplicate: "Lệnh đã được ghi nhận trước đó. Gửi một tin nhắn mới để lấy lại báo cáo.", failed: "Chưa hoàn tất trả lời.", ignored: "Lệnh đã bị bỏ qua." })[last.outcome]);
    }
    if (result.connected && !result.hasError) showTelegramResult(connect
      ? "Đã kết nối và cập nhật menu. Mở Telegram, nhắn /help để xem các yêu cầu đang bật."
      : "Đã kết nối Telegram. Bạn có thể nhắn /help hoặc dùng các yêu cầu đã lưu.", true);
    else if (result.connected) showTelegramResult("Telegram đã kết nối nhưng gần đây chưa chuyển được tin nhắn đến web. Bấm kết nối để cập nhật lại, rồi thử /help.", false, true);
    else showTelegramResult("Token đã được Telegram chấp nhận. Bấm Kết nối & cập nhật menu lệnh để bật nhận yêu cầu.");
  } catch (error) { showTelegramResult(error.message || "Chưa kiểm tra được Telegram. Bấm nút để thử lại.", false, true); }
  finally {
    telegramCheckedAt = Date.now(); telegramBusy = false;
    button.disabled = false; button.removeAttribute("aria-busy"); button.textContent = label;
  }
}
document.getElementById("connectCommands").addEventListener("click", () => checkTelegram(true));
