import { defineSchedule } from "eve/schedules";
import { scheduledReport } from "../lib/job.ts";
import { connectTelegram } from "../lib/telegram-setup.ts";

export default defineSchedule({
  cron: "* * * * *",
  async run() {
    if (process.env.VERCEL_ENV !== "production") return;
    try { await connectTelegram(); }
    catch { console.error("Không kết nối được lệnh Telegram. Kiểm tra mục Bot Telegram trên web."); }
    await scheduledReport();
  },
});
