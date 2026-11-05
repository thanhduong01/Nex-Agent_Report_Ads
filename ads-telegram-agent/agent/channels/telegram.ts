import { telegramChannel } from "eve/channels/telegram";
import { handleTelegramCommand } from "../lib/telegram-commands.ts";
import { webhookSecret } from "../lib/telegram-setup.ts";

export default telegramChannel({
  uploadPolicy: "disabled",
  credentials: { webhookSecretToken: webhookSecret },
  async onMessage(_ctx, message) {
    await handleTelegramCommand(message);
    return null;
  },
});
