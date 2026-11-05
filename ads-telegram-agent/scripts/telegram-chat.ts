async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Điền TELEGRAM_BOT_TOKEN trong .env.local trước.");
  async function call(operation: string) {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${operation}`, { signal: AbortSignal.timeout(15000) });
    } catch { throw new Error("Không kết nối được Telegram."); }
    if (!response.ok) throw new Error(`Telegram trả HTTP ${response.status}.`);
    const body = await response.json() as { ok: boolean; result: any };
    if (!body.ok) throw new Error("Telegram từ chối yêu cầu. Kiểm tra bot token.");
    return body.result;
  }
  const webhook = await call("getWebhookInfo");
  if (webhook.url) throw new Error("Bot đang có webhook. Dùng bot mới hoặc lấy chat_id từ hệ thống đang quản lý bot; script không thay webhook.");
  const updates = await call("getUpdates");
  const chats = new Map<string, string>();
  for (const update of updates) {
    const chat = update.message?.chat;
    if (chat?.type === "private") chats.set(String(chat.id), chat.username ?? chat.first_name ?? "private");
  }
  if (!chats.size) throw new Error("Mở bot, nhấn Start, gửi một tin nhắn rồi chạy lại ngay.");
  console.log("Chọn chat của bạn và điền ID vào TELEGRAM_CHAT_ID:");
  for (const [id, name] of chats) console.log(`${name}: ${id}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Không lấy được chat_id.");
  process.exitCode = 1;
});
