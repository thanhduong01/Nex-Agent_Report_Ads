import test from "node:test";
import assert from "node:assert/strict";
import { botToken } from "../agent/lib/telegram-token.ts";

const sample = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
test("bot credentials normalize common paste wrappers without exposing invalid input", () => {
  for (const value of [sample, ` ${sample}\n`, `"${sample}"`, `'${sample}'`, `bot${sample}`,
    `TELEGRAM_BOT_TOKEN='${sample}'`, `https://api.telegram.org/bot${sample}/getUpdates`,
    `https://api.telegram.org/${sample}/getMe`]) assert.equal(botToken(value), sample);
  for (const invalid of ["", "some-secret", "12345", "https://attacker.test/bot" + sample, "https://api.telegram.org.attacker.test/bot" + sample]) {
    assert.throws(() => botToken(invalid), error => error instanceof Error && !error.message.includes(sample) && !error.message.includes("some-secret"));
  }
});
