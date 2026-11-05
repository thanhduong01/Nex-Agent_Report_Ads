import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { productionOrigin } from "./telegram-setup.ts";

export const schedulerRepository = "thanhduong01/Nex-Agent_Report_Ads";
export const schedulerWorkflow = ".github/workflows/report-scheduler.yml";
const issuer = "https://token.actions.githubusercontent.com";
const githubKeys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks"), { timeoutDuration: 10000 });

// The workflow's short-lived identity replaces a shared PAT/cron secret.
export async function verifySchedulerToken(token: string, audience = productionOrigin() + "/api/schedule-tick", keys: JWTVerifyGetKey = githubKeys) {
  const { payload } = await jwtVerify(token, keys, {
    issuer, audience, algorithms: ["RS256"], maxTokenAge: "10m", clockTolerance: 5,
    requiredClaims: ["exp", "iat", "sub", "repository_id", "repository_owner_id", "workflow_ref", "ref", "event_name", "run_id"],
  });
  if (payload.repository !== schedulerRepository || payload.repository_id !== "1446546918" ||
      payload.repository_owner_id !== "28723913" || payload.ref !== "refs/heads/main" ||
      payload.workflow_ref !== `${schedulerRepository}/${schedulerWorkflow}@refs/heads/main` ||
      payload.job_workflow_ref !== undefined || !["schedule", "workflow_dispatch", "push"].includes(String(payload.event_name)) ||
      !/^\d+$/.test(String(payload.run_id))) throw new Error("Untrusted scheduler identity");
  return { runId: String(payload.run_id) };
}
