import { defineTool } from "eve/tools";
import { z } from "zod";
import { liveReport } from "../lib/sheets.ts";
import { renderReport, yesterday } from "../lib/report.ts";

export default defineTool({
  description: "Đọc báo cáo quảng cáo theo ngày từ các file Sheets đã cấu hình. Chỉ đọc, không gửi Telegram.",
  inputSchema: z.object({ groupId: z.string().optional().describe("ID nhóm báo cáo; mặc định default"), date: z.string().optional().describe("YYYY-MM-DD; bỏ trống để lấy ngày hôm trước theo giờ Việt Nam") }),
  async execute({ date, groupId }) {
    const report = await liveReport(date ?? yesterday(), groupId);
    return { ...report, text: renderReport(report) };
  },
});
