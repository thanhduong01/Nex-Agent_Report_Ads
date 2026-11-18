import {syncBotcakeTick} from "./botcake/sync.ts";
import {botcakeStore} from "./botcake/store.ts";
import { getRegistry } from "./groups.ts";
import { dueOccurrence, effectiveSchedule } from "./schedule-config.ts";
import { scheduledReport } from "./job.ts";
import { verifySchedulerToken } from "./scheduler-auth.ts";
import { recordSchedulerCheck } from "./scheduler-status.ts";
import { connectTelegram } from "./telegram-setup.ts";
import {syncPancakeTick} from "./pancake/sync.ts";
import {databaseHealth} from "./pancake/database.ts";
import {salesStore} from "./pancake/store.ts";

const response = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const defaults = { verify: verifySchedulerToken, registry: getRegistry, deliver: scheduledReport,
  record: recordSchedulerCheck, connect: connectTelegram, now: () => new Date(),syncBotcake:syncBotcakeTick,sync:syncPancakeTick,
  probe:async()=>{
    const database=await databaseHealth();
    if(database.connected){await salesStore().init();await (await botcakeStore()).init();}
    console.info("Reporting database health",{configured:database.configured,connected:database.connected});
    const pancake=database.connected?await syncPancakeTick():undefined;
    if(pancake)console.info("Pancake sync probe",pancake);
    return {database:{configured:database.configured,connected:database.connected},...(pancake?{pancake}:{})};
  }};
export async function schedulerApi(request: Request, deps:Omit<typeof defaults,"sync"|"probe"|"syncBotcake"> & {syncBotcake?:typeof syncBotcakeTick;sync?:typeof syncPancakeTick;probe?:()=>Promise<Record<string,unknown>>} = defaults) {
  if (request.method !== "POST") return response(405, { error: "Method not allowed" });
  if (process.env.VERCEL_ENV !== "production") return response(403, { error: "Production only" });
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || token.length > 16000) return response(401, { error: "Scheduler authentication required" });
  let identity;
  try { identity = await deps.verify(token); }
  catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "identity-or-origin";
    console.warn("Scheduler authentication rejected", /^[A-Z_]+$/.test(code) ? code : "identity-or-origin");
    return response(401, { error: "Invalid scheduler identity" });
  }
  try {
    const text = await request.text();
    if (text.length > 1024) return response(413, { error: "Request too large" });
    const body = JSON.parse(text);
    if (!body || !["probe", "check", "run"].includes(body.mode)) return response(400, { error: "Invalid scheduler operation" });
    if (body.mode === "probe") {
      const diagnostic=await deps.probe?.();
      return response(200, { ok: true, provider: "github-actions",...diagnostic });
    }
    const now = deps.now();
    if (body.mode === "check") {
      // POS failures never disable existing Sheets schedules; freshness is visible in each POS report.
      if(deps.sync)try{await deps.sync();}catch{console.warn("Pancake sync batch could not start");}
      if(deps.syncBotcake)try{await deps.syncBotcake();}catch{console.warn("Botcake sync batch could not start");}
      const registry = await deps.registry();
      const due = registry.groups.filter(g => dueOccurrence(effectiveSchedule(g), now)).map(g => g.id);
      let telegramConnected = true;
      let telegramIssue: string | undefined;
      try { await deps.connect(); } catch (error) {
        telegramConnected = false;
        const message = error instanceof Error ? error.message : "";
        telegramIssue = /^(Bot đang|Chưa cấu hình|Chưa điền TELEGRAM_CHAT_ID|TELEGRAM_CHAT_ID chưa|Không kết nối được Telegram|Chỉ kết nối bot)/.test(message)
          ? message : "Kiểm tra kết nối trong bảng điều khiển.";
        console.warn("Telegram command setup incomplete:", telegramIssue);
      }
      await deps.record({ checkedAt: now.toISOString(), runId: identity.runId,
        enabled: registry.groups.filter(g => effectiveSchedule(g).enabled).length, due: due.length, telegramConnected, telegramIssue });
      return response(200, { ok: true, due, telegramConnected });
    }
    if (typeof body.groupId !== "string" || !/^[a-z0-9-]{1,64}$/.test(body.groupId)) return response(400, { error: "Invalid group" });
    // Re-read the latest schedule: a group paused/changed after check must not send.
    const results = await deps.deliver(now, body.groupId);
    const failed = results.some(r => r.status === "failed");
    return response(failed ? 502 : 200, { ok: !failed, processed: results.length,
      sent: results.filter(r => r.status === "sent").length });
  } catch { return response(503, { error: "Scheduler could not complete; check application logs and configuration" }); }
}
