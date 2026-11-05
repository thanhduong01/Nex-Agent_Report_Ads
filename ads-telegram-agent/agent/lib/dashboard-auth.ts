import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const cookieName = "tram_ads_session";
export function passwordConfigured() {
  return (process.env.DASHBOARD_PASSWORD?.length ?? 0) >= 16;
}

function equal(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function passwordMatches(input: string) {
  return passwordConfigured() && equal(input, process.env.DASHBOARD_PASSWORD!);
}

export function sign(payload: object) {
  if (!passwordConfigured()) throw new Error("Chưa cấu hình mật khẩu quản trị.");
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return data + "." + createHmac("sha256", process.env.DASHBOARD_PASSWORD!).update(data).digest("base64url");
}

export function verify(token: string): Record<string, unknown> | null {
  if (!passwordConfigured() || token.length > 24000) return null;
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra) return null;
  const expected = createHmac("sha256", process.env.DASHBOARD_PASSWORD!).update(data).digest("base64url");
  if (!equal(expected, signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload || typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return payload;
  } catch { return null; }
}

export function authenticated(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(cookieName + "="));
  return !!cookie && verify(cookie.slice(cookieName.length + 1))?.purpose === "session";
}

export function sessionCookie(request: Request, logout = false) {
  const token = logout ? "" : sign({ purpose: "session", exp: Date.now() + 8 * 3600000 });
  const secure = new URL(request.url).protocol === "https:" || process.env.VERCEL === "1";
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${logout ? 0 : 28800}${secure ? "; Secure" : ""}`;
}
