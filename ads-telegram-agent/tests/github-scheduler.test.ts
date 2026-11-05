import test from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { schedulerRepository, schedulerWorkflow, verifySchedulerToken } from "../agent/lib/scheduler-auth.ts";
import { schedulerApi } from "../agent/lib/scheduler-api.ts";
import { defaultRequests } from "../agent/lib/request-config.ts";
import { dueOccurrence } from "../agent/lib/schedule-config.ts";
import { deliverOnce, type DeliveryStore } from "../agent/lib/delivery.ts";

test("scheduler verifies signed GitHub identity, expiry, audience, exact workflow, branch and immutable repo IDs", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test" }] });
  const audience = "https://example.test/api/schedule-tick";
  const claims = { repository: schedulerRepository, repository_id: "1446546918", repository_owner_id: "28723913",
    ref: "refs/heads/main", workflow_ref: `${schedulerRepository}/${schedulerWorkflow}@refs/heads/main`,
    event_name: "schedule", run_id: "123" };
  const sign = (changes = {}, expiration = "5m", aud = audience) => new SignJWT({ ...claims, ...changes })
    .setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuedAt().setExpirationTime(expiration)
    .setIssuer("https://token.actions.githubusercontent.com").setAudience(aud).setSubject(`repo:${schedulerRepository}:ref:refs/heads/main`).sign(privateKey);
  assert.deepEqual(await verifySchedulerToken(await sign(), audience, keys), { runId: "123" });
  for (const patch of [{ repository_id: "other" }, { repository_owner_id: "other" }, { repository: "attacker/fork" },
    { ref: "refs/heads/feature" }, { workflow_ref: `${schedulerRepository}/other.yml@refs/heads/main` },
    { job_workflow_ref: "attacker/reusable.yml" }, { event_name: "pull_request" }]) {
    await assert.rejects(verifySchedulerToken(await sign(patch), audience, keys));
  }
  await assert.rejects(verifySchedulerToken(await sign({}, "-1m"), audience, keys));
  await assert.rejects(verifySchedulerToken(await sign({}, "5m", "other"), audience, keys));
  await assert.rejects(verifySchedulerToken((await sign()) + "tampered", audience, keys));
});

test("GitHub polls see schedule changes immediately, probe never sends, and invalid identities cannot read config", async t => {
  const previous = process.env.VERCEL_ENV;
  t.after(() => { if (previous === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous; });
  process.env.VERCEL_ENV = "production";
  let reads = 0, sends = 0, records = 0;
  const groups = [{ id: "tour", name: "Tour", enabled: true, sources: {},
    schedule: { enabled: true, time: "09:00", days: [4], reportDay: "today" as const } }];
  const now = new Date("2026-11-05T02:02:00Z");
  const delivered = new Set<string>();
  const store: DeliveryStore = { async claim(key) { if (delivered.has(key)) return false; delivered.add(key); return true; }, async finish() {} };
  const deps = {
    async verify(token: string) { if (token !== "valid") throw Error("bad"); return { runId: "123" }; },
    async registry() { reads++; return { version: 1 as const, revision: 1, groups, requests: defaultRequests() }; },
    async connect() {}, async record() { records++; }, now: () => now,
    async deliver(_now = now, groupId?: string) {
      const group = groups.find(g => g.id === groupId)!;
      const occurrence = dueOccurrence(group.schedule, _now);
      if (!occurrence) return [];
      return [{ groupId: group.id, ...await deliverOnce(occurrence.key, "report", store, async () => { sends++; return 1; }) }];
    },
  };
  const request = (body: object, token = "valid") => new Request("https://example.test/api/schedule-tick", {
    method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify(body) });
  assert.equal((await schedulerApi(request({ mode: "check" }, "bad"), deps)).status, 401);
  assert.equal(reads, 0);
  assert.equal((await schedulerApi(request({ mode: "probe" }), deps)).status, 200);
  assert.equal(reads, 0); assert.equal(sends, 0);
  assert.deepEqual((await (await schedulerApi(request({ mode: "check" }), deps)).json()).due, ["tour"]);
  assert.equal(records, 1);
  // Pausing between the check and run must suppress delivery.
  groups[0].schedule.enabled = false;
  await schedulerApi(request({ mode: "run", groupId: "tour" }), deps); assert.equal(sends, 0);
  groups[0].schedule.enabled = true;
  await schedulerApi(request({ mode: "run", groupId: "tour" }), deps);
  await schedulerApi(request({ mode: "run", groupId: "tour" }), deps); assert.equal(sends, 1);
  groups[0].schedule.time = "10:00";
  assert.deepEqual((await (await schedulerApi(request({ mode: "check" }), deps)).json()).due, []);
  assert.equal((await schedulerApi(request({ mode: "run", groupId: "invalid/path" }), deps)).status, 400);
  process.env.VERCEL_ENV = "preview";
  assert.equal((await schedulerApi(request({ mode: "check" }), deps)).status, 403);
});
