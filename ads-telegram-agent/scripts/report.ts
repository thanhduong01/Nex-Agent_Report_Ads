import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getGroup } from "../agent/lib/groups.ts";
import { buildReport, renderReport, shiftDate, validateDate, yesterday } from "../agent/lib/report.ts";
import type { Tables } from "../agent/lib/report.ts";

async function main() {
  const { values } = parseArgs({ options: {
    date: { type: "string" }, group: { type: "string", default: "default" }, demo: { type: "boolean", default: false },
    send: { type: "boolean", default: false }, output: { type: "string" },
    "telegram-preview": { type: "boolean", default: false },
  } });
  if (values.demo && (values.send || values["telegram-preview"]))
    throw new Error("Bản demo chỉ xem trước, không gửi Telegram.");
  if (values.send && values["telegram-preview"]) throw new Error("Chọn một chế độ gửi.");
  const date = validateDate(values.date ?? yesterday());
  let text: string;
  if (values.demo) {
    const month = date.slice(0, 7);
    const fixture = JSON.parse(await readFile(new URL(`../fixtures/${month}.json`, import.meta.url), "utf8")) as {
      month: string; fetchedAt: string; tables: Tables;
    };
    const source = (await getGroup(values.group)).sources[date.slice(0, 7)];
    if (!source || month !== fixture.month) throw new Error("Chưa có dữ liệu mẫu cho tháng này.");
    const byMonth = { [fixture.month]: fixture.tables };
    const previousMonth = shiftDate(date, -7).slice(0, 7);
    if (previousMonth !== month) {
      try {
        const previous = JSON.parse(await readFile(new URL(`../fixtures/${previousMonth}.json`, import.meta.url), "utf8"));
        if (previous.month === previousMonth) byMonth[previousMonth] = previous.tables;
      } catch { /* Missing private fixture: comparison is unavailable. */ }
    }
    text = "BẢN XEM TRƯỚC TỪ DỮ LIỆU ĐÃ TẢI\n\n" + renderReport(buildReport(date, byMonth, source, new Date(fixture.fetchedAt)));
  } else {
    const { prepareReport } = await import("../agent/lib/job.ts");
    text = (await prepareReport(date, values.group)).text;
  }
  if (values.output) {
    const path = resolve(values.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text + "\n");
  }
  if (values["telegram-preview"]) {
    if (!/^[1-9]\d*$/.test(process.env.TELEGRAM_CHAT_ID ?? ""))
      throw new Error("Cần chọn ID cuộc trò chuyện riêng của bạn trước khi gửi thử.");
    const { telegramSend } = await import("../agent/lib/delivery.ts");
    const messageId = await telegramSend("BẢN GỬI THỬ\n\n" + text);
    console.log(`Đã gửi bản thử. Mã tin nhắn ${messageId}.`);
  } else if (values.send) {
    const { deliverOnce, deliveryKey } = await import("../agent/lib/delivery.ts");
    console.log(JSON.stringify(await deliverOnce(deliveryKey(date, values.group === "default" ? "daily" : "group-" + values.group), text)));
  } else console.log(text);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Không tạo được báo cáo.");
  process.exitCode = 1;
});
