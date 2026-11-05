import { settings } from "./config.ts";
import { yesterday } from "./report.ts";

import { getRegistry, hasGroupStorage } from "./groups.ts";

export async function dashboardState(cloud = false) {
  const paired = Boolean(process.env.TELEGRAM_BOT_TOKEN && /^[1-9]\d*$/.test(process.env.TELEGRAM_CHAT_ID || ""));
  const redis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  const registry = await getRegistry();
  return {
    cloud, defaultDate: yesterday(), deliveryTime: settings.deliveryTime,
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN, paired,
    canSend: paired && (!cloud || redis),
    localSendEnabled: process.env.SEND_REPORTS === "true",
    groups: registry.groups, revision: registry.revision, canEditGroups: !cloud || hasGroupStorage(),
    months: Object.entries(registry.groups.find(g => g.id === "default")?.sources || {}).sort(([a], [b]) => b.localeCompare(a)).map(([month, source]) =>
      ({ month, url: `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit` })),
  };
}
