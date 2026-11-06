import { z } from "zod";
import { validateDate } from "./report.ts";
import { shiftDate, vietnamDate } from "./schedule-config.ts";
import { resolvePeriod } from "./report-period.ts";

export const normalizeText = (value: string) => value.toLocaleLowerCase("vi").normalize("NFD")
  .replace(/\p{M}/gu, "").replace(/đ/g, "d").trim().replace(/\s+/g, " ");
export const requestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().trim().min(1).max(80),
  command: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  enabled: z.boolean(),
  phrases: z.array(z.string().trim().min(2).max(120).refine(s => !s.startsWith("/"))).max(5).default([]),
  groupMode: z.enum(["all", "selected"]),
  groupIds: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).max(30),
  reportDay: z.enum(["today", "yesterday"]),
  allowDate: z.boolean(),
  format: z.enum(["detailed", "summary"]),
  period: z.enum(["today", "yesterday", "last7", "month", "template"]).optional(),
}).refine(r => r.groupMode === "all" || r.groupIds.length > 0);
export type BotRequest = z.infer<typeof requestSchema>;
export const reservedCommands = ["start", "help", "chatid", "nhom", "lich", "report", "homnay"];
export function defaultRequests(): BotRequest[] {
  return [
    { id: "today", name: "Báo cáo hôm nay", command: "baocao", reportDay: "today" },
    { id: "yesterday", name: "Báo cáo hôm qua", command: "homqua", reportDay: "yesterday" },
  ].map(r => ({ ...r, enabled: true, phrases: [], groupMode: "all", groupIds: [], allowDate: true, format: "detailed" })) as BotRequest[];
}
export function resolveRequest(requests: BotRequest[], text: string, now = new Date()) {
  const [first, ...words] = text.trim().split(/\s+/);
  let command = first.split("@")[0].replace(/^\//, "").toLowerCase();
  if (["report", "homnay"].includes(command)) command = "baocao";
  const rule = requests.find(r => r.enabled && (text.trim().startsWith("/") ? r.command === command : r.phrases.some(p => normalizeText(p) === normalizeText(text))));
  if (!rule) return null;
  let date = rule.reportDay === "today" ? vietnamDate(now) : shiftDate(vietnamDate(now), -1);
  let from: string | undefined;
  let templatePeriod = rule.period === "template";
  if (rule.period && rule.period !== "template") {
    const range = resolvePeriod(vietnamDate(now), rule.period); date = range.to;
    if (range.from !== range.to) from = range.from;
  }
  if (templatePeriod) date = vietnamDate(now);
  if (!text.trim().startsWith("/")) return { rule, date, group: "", from, templatePeriod };
  const word = words[0];
  if (word && (/^\d/.test(word) || ["homqua", "homnay"].includes(word))) {
    if (!rule.allowDate) throw new Error("Yêu cầu này dùng ngày đã cấu hình trên web; không nhận ngày kèm theo lệnh.");
    if (["homqua", "homnay"].includes(word)) date = word === "homqua" ? shiftDate(vietnamDate(now), -1) : vietnamDate(now);
    else {
      const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(word);
      date = validateDate(vn ? `${vn[3]}-${vn[2].padStart(2, "0")}-${vn[1].padStart(2, "0")}` : word);
    }
    words.shift();
    templatePeriod = false; from = undefined;
    if (words[0] && /^\d/.test(words[0])) {
      const second = words.shift()!;
      const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(second);
      const end = validateDate(vn ? vn[3]+"-"+vn[2].padStart(2,"0")+"-"+vn[1].padStart(2,"0") : second);
      const range = resolvePeriod(end, "today", date); from = range.from; date = range.to;
    }
  }
  return { rule, date, group: words.join(" "), from, templatePeriod };
}
