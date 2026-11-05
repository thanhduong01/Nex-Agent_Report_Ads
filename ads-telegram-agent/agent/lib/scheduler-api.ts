import { getRegistry } from "./groups.ts";
import { dueOccurrence, effectiveSchedule } from "./schedule-config.ts";
import { scheduledReport } from "./job.ts";
import { verifySchedulerToken } from "./scheduler-auth.ts";
import { recordSchedulerCheck } from "./scheduler-status.ts";
import { connectTelegram } from "./telegram-setup.ts";

const response = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const defaults = { verify: verifySchedulerToken, registry: getRegistry, deliver: scheduledReport,
  record: recordSchedulerCheck, connect: connectTelegram, now: () => new Date() };
export async function schedulerApi(request: Request, deps = defaults) {
  if (request.method !== "POST") return response(405, { error: "Method not allowed" });
  if (process.env.VERCEL_ENV !== "production") return response(403, { error: "Production only" });
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || token.length > 16000) return response(401, { error: "Scheduler authentication required" });
  let identity;
  try { identity = await deps.verify(token); }
  catch { return response(401, { error: "Invalid scheduler identity" }); }
  try {
    const text = await request.text();
    if (text.length > 1024) return response(413, { error: "Request too large" });
    const body = JSON.parse(text);
    if (!body || !["probe", "check", "run"].includes(body.mode)) return response(400, { error: "Invalid scheduler operation" });
    if (body.mode === "probe") return response(200, { ok: true, provider: "github-actions" });
    const now = deps.now();
    if (body.mode === "check") {
      const registry = await deps.registry();
      const due = registry.groups.filter(g => dueOccurrence(effectiveSchedule(g), now)).map(g => g.id);
      let telegramConnected = true;
      try { await deps.connect(); } catch { telegramConnected = false; }
      await deps.record({ checkedAt: now.toISOString(), runId: identity.runId,
        enabled: registry.groups.filter(g => effectiveSchedule(g).enabled).length, due: due.length });
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
