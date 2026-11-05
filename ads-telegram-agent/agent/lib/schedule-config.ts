import { z } from "zod";

export const scheduleSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine(days => new Set(days).size === days.length),
  reportDay: z.enum(["yesterday", "today"]),
  startAt: z.string().datetime().optional(),
});
export type ReportSchedule = z.infer<typeof scheduleSchema>;
export function effectiveSchedule(group: { enabled: boolean; schedule?: ReportSchedule }): ReportSchedule {
  return group.schedule || { enabled: group.enabled && process.env.SEND_REPORTS === "true",
    time: "09:00", days: [0, 1, 2, 3, 4, 5, 6], reportDay: "yesterday" };
}
export function vietnamDate(now = new Date()) { return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10); }
export function shiftDate(date: string, days: number) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}
export function dueOccurrence(schedule: ReportSchedule, now = new Date()) {
  if (!schedule.enabled) return null;
  for (const date of [vietnamDate(now), shiftDate(vietnamDate(now), -1)]) {
    const at = Date.parse(date + "T" + schedule.time + ":00+07:00");
    const age = now.getTime() - at;
    const day = new Date(date + "T00:00:00Z").getUTCDay();
    if (age < 0 || age >= 2 * 3600000 || !schedule.days.includes(day)) continue;
    if (schedule.startAt && at < Date.parse(schedule.startAt)) continue;
    return { key: date + "T" + schedule.time + ":" + schedule.reportDay,
      reportDate: schedule.reportDay === "today" ? date : shiftDate(date, -1) };
  }
  return null;
}
export function nextOccurrence(schedule: ReportSchedule, now = new Date()): string | null {
  if (!schedule.enabled) return null;
  for (let offset = 0; offset < 8; offset++) {
    const date = shiftDate(vietnamDate(now), offset);
    const at = Date.parse(date + "T" + schedule.time + ":00+07:00");
    if (at > now.getTime() && schedule.days.includes(new Date(date + "T00:00:00Z").getUTCDay()))
      return new Date(at).toISOString();
  }
  return null;
}
