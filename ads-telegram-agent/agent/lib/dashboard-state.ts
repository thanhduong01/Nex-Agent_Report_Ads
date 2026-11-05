import { settings, sources } from "./config.ts";
import { yesterday } from "./report.ts";

export function dashboardState(cloud = false) {
  const paired = Boolean(process.env.TELEGRAM_BOT_TOKEN && /^[1-9]\d*$/.test(process.env.TELEGRAM_CHAT_ID || ""));
  const redis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  return {
    cloud, defaultDate: yesterday(), deliveryTime: settings.deliveryTime,
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN, paired,
    canSend: paired && (!cloud || redis),
    localSendEnabled: process.env.SEND_REPORTS === "true",
    months: Object.entries(sources()).sort(([a], [b]) => b.localeCompare(a)).map(([month, source]) =>
      ({ month, url: `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit` })),
  };
}
