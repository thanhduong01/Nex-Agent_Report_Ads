import { settings } from "./config.ts";
import { yesterday } from "./report.ts";

import { getRegistry, hasGroupStorage } from "./groups.ts";
import { hasDeliveryStorage } from "./delivery.ts";
import { effectiveSchedule, nextOccurrence } from "./schedule-config.ts";
import { readSchedulerStatus } from "./scheduler-status.ts";
import { telegramConfiguration } from "./telegram-token.ts";
import { listMetaConnections } from "./meta.ts";
import { metricDefinitions } from "./report-service.ts";
import { baseVariables } from "./formulas.ts";

export async function dashboardState(cloud = false) {
  const paired = Boolean(process.env.TELEGRAM_BOT_TOKEN && /^[1-9]\d*$/.test(process.env.TELEGRAM_CHAT_ID || ""));
  const registry = await getRegistry();
  return {
    cloud, defaultDate: yesterday(), deliveryTime: settings.deliveryTime,
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN, paired,
    canSend: paired && (!cloud || hasDeliveryStorage()),
    canConnectCommands: cloud,
    telegramConfiguration: telegramConfiguration(),
    localSendEnabled: process.env.SEND_REPORTS === "true",
    groups: registry.groups.map(group => ({ ...group, schedule: effectiveSchedule(group), nextRun: nextOccurrence(effectiveSchedule(group)) })),
    revision: registry.revision, canEditGroups: !cloud || hasGroupStorage(),
    requests: registry.requests,
    metaConnections: await listMetaConnections(), metrics: registry.metrics || [], metricDefinitions:metricDefinitions(registry),
    parameters:registry.parameters || {}, baseVariables,
    scheduler: await readSchedulerStatus(),
    months: Object.entries(registry.groups.find(g => g.id === "default")?.sources || {}).sort(([a], [b]) => b.localeCompare(a)).map(([month, source]) =>
      ({ month, url: `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit` })),
  };
}
