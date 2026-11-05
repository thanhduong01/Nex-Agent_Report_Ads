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
