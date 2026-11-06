import { telegramChannel } from "eve/channels/telegram";
import { privateChatIdReply, receiveTelegramCommand } from "../lib/telegram-commands.ts";
import { webhookSecret } from "../lib/telegram-setup.ts";
import { botToken } from "../lib/telegram-token.ts";

export default telegramChannel({
  uploadPolicy: "disabled",
  credentials: { botToken, webhookSecretToken: webhookSecret },
  async onMessage(ctx, message) {
    const setupReply = privateChatIdReply(message);
    if (setupReply) { await ctx.telegram.sendMessage(setupReply); return null; }
    await receiveTelegramCommand(message);
    return null;
  },
});
