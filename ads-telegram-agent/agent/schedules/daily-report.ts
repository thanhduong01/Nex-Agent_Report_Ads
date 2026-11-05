import { defineSchedule } from "eve/schedules";
import { scheduledReport } from "../lib/job.ts";
import { settings } from "../lib/config.ts";

export default defineSchedule({
  cron: settings.cronUtc,
  async run() { await scheduledReport(); },
});
