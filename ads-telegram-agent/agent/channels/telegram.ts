import { telegramChannel } from "eve/channels/telegram";
import { receiveTelegramCommand } from "../lib/telegram-commands.ts";
import { webhookSecret } from "../lib/telegram-setup.ts";
import { botToken } from "../lib/telegram-token.ts";

export default telegramChannel({
  uploadPolicy: "disabled",
  credentials: { botToken, webhookSecretToken: webhookSecret },
  async onMessage(_ctx, message) {
    await receiveTelegramCommand(message);
    return null;
  },
});
