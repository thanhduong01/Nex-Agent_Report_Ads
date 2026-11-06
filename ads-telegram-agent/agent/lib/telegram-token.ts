// Accept common copy/paste wrappers while sending credentials only to Telegram.
// Never include the supplied value in an error or log message.
export function botToken(input = process.env.TELEGRAM_BOT_TOKEN || "") {
  let value = input.trim().replace(/^TELEGRAM_BOT_TOKEN\s*=\s*/, "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    value = value.slice(1, -1).trim();
  if (value.startsWith("https://")) {
    try {
      const url = new URL(value);
      if (url.hostname === "api.telegram.org" && !url.username && !url.password && (!url.port || url.port === "443"))
        value = decodeURIComponent(url.pathname.split("/")[1]);
    } catch { /* The format check below gives a message without revealing input. */ }
  }
  if (/^bot\d+:/.test(value)) value = value.slice(3);
  if (!value) throw new Error("Chưa cấu hình bot Telegram.");
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(value))
    throw new Error("Chưa cấu hình đúng định dạng token Telegram. Dùng toàn bộ token từ BotFather, gồm phần số, dấu : và phần chữ phía sau.");
  return value;
}

export function telegramConfiguration() {
  const issues: string[] = [];
  try { botToken(); } catch (error) { issues.push((error as Error).message); }
  const chat = process.env.TELEGRAM_CHAT_ID || "";
  if (!chat) issues.push("Chưa điền TELEGRAM_CHAT_ID trong Vercel Production. Dùng ID chat riêng của bạn, rồi redeploy.");
  else if (!/^[1-9]\d*$/.test(chat)) issues.push("TELEGRAM_CHAT_ID chưa đúng định dạng chat riêng. Chỉ điền dãy số ID của bạn, không kèm chữ, dấu nháy hoặc khoảng trắng, rồi redeploy.");
  return { ready: issues.length === 0, issues };
}
