import { get, put } from "@vercel/blob";
import { hasGroupStorage } from "./groups.ts";
import { schedulerRepository, schedulerWorkflow } from "./scheduler-auth.ts";
type Status = { checkedAt: string; runId: string; enabled: number; due: number };
const path = () => `report-config/${process.env.VERCEL_ENV || "production"}/scheduler-status.json`;
let local: Status | null = null;
export async function readSchedulerStatus() {
  let latest: Status | null = null;
  try {
    if (hasGroupStorage()) {
      const result = await get(path(), { access: "private", useCache: false, abortSignal: AbortSignal.timeout(10000) });
      if (result) latest = await new Response(result.stream).json() as Status;
    } else if (process.env.VERCEL !== "1") latest = local;
  } catch { /* A missing heartbeat must not block viewing or saving schedules. */ }
  return { provider: "github-actions", intervalMinutes: 5, checkedAt: latest?.checkedAt || null,
    healthy: !!latest && Date.now() - Date.parse(latest.checkedAt) < 30 * 60000,
    workflowUrl: `https://github.com/${schedulerRepository}/actions/workflows/${schedulerWorkflow.split("/").pop()}`,
    runUrl: latest?.runId && /^\d+$/.test(latest.runId) ? `https://github.com/${schedulerRepository}/actions/runs/${latest.runId}` : null };
}
export async function recordSchedulerCheck(status: Status) {
  // Heartbeat once per 15 minutes avoids a write for every idle poll.
  const previous = await readSchedulerStatus();
  if (previous.checkedAt && Date.parse(status.checkedAt) - Date.parse(previous.checkedAt) < 15 * 60000) return;
  if (hasGroupStorage()) await put(path(), JSON.stringify(status), { access: "private", allowOverwrite: true,
    addRandomSuffix: false, contentType: "application/json", abortSignal: AbortSignal.timeout(10000) });
  else if (process.env.VERCEL !== "1") local = status;
}
