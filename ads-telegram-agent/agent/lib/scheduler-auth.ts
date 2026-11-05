import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { productionOrigin } from "./telegram-setup.ts";

export const schedulerRepository = "thanhduong01/Nex-Agent_Report_Ads";
export const schedulerWorkflow = ".github/workflows/report-scheduler.yml";
const issuer = "https://token.actions.githubusercontent.com";
const githubKeys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks"), { timeoutDuration: 10000 });

// The workflow's short-lived identity replaces a shared PAT/cron secret.
export async function verifySchedulerToken(token: string, audience?: string, keys: JWTVerifyGetKey = githubKeys) {
  if (!audience) {
    try { audience = productionOrigin() + "/api/schedule-tick"; }
    catch { throw Object.assign(new Error("Scheduler origin is not configured"), { code: "SCHEDULER_ORIGIN_UNCONFIGURED" }); }
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer, audience, algorithms: ["RS256"], maxTokenAge: "10m", clockTolerance: 5,
    requiredClaims: ["exp", "iat", "sub", "repository_id", "repository_owner_id", "workflow_ref", "ref", "event_name", "run_id"],
  });
  const workflow = `${schedulerRepository}/${schedulerWorkflow}@refs/heads/main`;
  const policy = {
    REPOSITORY: payload.repository === schedulerRepository,
    REPOSITORY_ID: String(payload.repository_id) === "1446546918",
    OWNER_ID: String(payload.repository_owner_id) === "28723913",
    REF: payload.ref === "refs/heads/main",
    WORKFLOW: payload.workflow_ref === workflow,
    JOB_WORKFLOW: payload.job_workflow_ref === undefined || payload.job_workflow_ref === workflow,
    EVENT: ["schedule", "workflow_dispatch", "push"].includes(String(payload.event_name)),
    RUN_ID: /^\d+$/.test(String(payload.run_id)),
  };
  for (const [claim, valid] of Object.entries(policy)) if (!valid)
    throw Object.assign(new Error("Untrusted scheduler identity"), { code: "GITHUB_CLAIM_" + claim });
  return { runId: String(payload.run_id) };
}
