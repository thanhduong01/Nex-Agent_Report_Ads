import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dashboardApi } from "../agent/lib/dashboard-api.ts";
import { sign, verify } from "../agent/lib/dashboard-auth.ts";

const base = "https://reports.example.test";
function request(path: string, body?: object, cookie?: string, origin = base) {
  return new Request(base + path, {
    method: body ? "POST" : "GET",
    headers: { "X-Tram-Ads": "1", ...(cookie ? { cookie } : {}),
      ...(body ? { "Content-Type": "application/json", Origin: origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("hosted dashboard blocks data until login and rejects cross-origin writes", async t => {
  const previous = process.env.DASHBOARD_PASSWORD;
  t.after(() => { if (previous === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = previous; });
  const password = randomBytes(24).toString("hex");
  process.env.DASHBOARD_PASSWORD = password;
  assert.equal((await dashboardApi(request("/api/state"))).status, 401);
  assert.equal((await dashboardApi(request("/api/report?date=2026-11-02"))).status, 401);
  assert.equal((await dashboardApi(request("/api/login", { password: "wrong" }))).status, 401);
  assert.equal((await dashboardApi(request("/api/login", { password }, undefined, "https://other.example"))).status, 403);
  const login = await dashboardApi(request("/api/login", { password }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  const state = await dashboardApi(request("/api/state", undefined, cookie));
  assert.equal(state.status, 200);
  assert.equal((await state.json()).cloud, true);
  assert.equal((await dashboardApi(request("/api/source", { month: "2026-12", url: "unused" }, cookie))).status, 409);
  const logout = await dashboardApi(request("/api/logout", {}, cookie));
  assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
});

test("hosted dashboard shows setup without exposing sources when its password is missing", async t => {
  const previous = process.env.DASHBOARD_PASSWORD;
  delete process.env.DASHBOARD_PASSWORD;
  t.after(() => { if (previous !== undefined) process.env.DASHBOARD_PASSWORD = previous; });
  const response = await dashboardApi(request("/api/state"));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "setup"); assert.equal(body.months, undefined);
});

test("preview signatures survive worker restarts and cannot be used as a login session", async t => {
  const previous = process.env.DASHBOARD_PASSWORD;
  t.after(() => { if (previous === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = previous; });
  process.env.DASHBOARD_PASSWORD = randomBytes(24).toString("hex");
  const token = sign({ purpose: "preview", text: "sample", exp: Date.now() + 10000 });
  assert.equal(verify(token)?.text, "sample");
  assert.equal(verify(token + "tampered"), null);
  assert.equal(verify(sign({ purpose: "session", exp: Date.now() - 1 })), null);
  assert.equal((await dashboardApi(request("/api/state", undefined, "tram_ads_session=" + token))).status, 401);
  process.env.DASHBOARD_PASSWORD = randomBytes(24).toString("hex");
  assert.equal(verify(token), null);
});
