import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const app = fileURLToPath(new URL("../", import.meta.url));
// Test code must never inherit Production credentials or storage flags.
const checkEnv = { CI: "1" };
for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ", "SystemRoot"])
  if (process.env[key] !== undefined) checkEnv[key] = process.env[key];
for (const args of [["run", "typecheck"], ["test"]]) {
  const check = spawnSync("npm", args, { cwd: app, stdio: "inherit", env: checkEnv });
  if (check.error || check.status !== 0) process.exit(check.status || 1);
}
for (const file of ["app.js", "groups.js", "requests.js", "telegram.js", "report-builder.js"]) {
  const check = spawnSync(process.execPath, ["--check", "public/" + file], { cwd: app, stdio: "inherit", env: checkEnv });
  if (check.error || check.status !== 0) process.exit(check.status || 1);
}
const result = spawnSync("npm", ["run", "build"], {
  cwd: app, stdio: "inherit", env: { ...process.env, VERCEL: "1" },
});
if (result.error || result.status !== 0) process.exit(result.status || 1);
const output = resolve(process.cwd(), ".vercel/output");
const appOutput = resolve(app, ".vercel/output");
const configPath = resolve(appOutput, "config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
// Eve also publishes its own "/" handler. Serve the dashboard before that route.
config.routes.unshift({
  src: "^/$",
  dest: "/index.html",
  headers: { "Cache-Control": "no-cache" },
});
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
if (output !== appOutput) {
  await mkdir(resolve(process.cwd(), ".vercel"), { recursive: true });
  await rm(output, { recursive: true, force: true });
  await cp(appOutput, output, { recursive: true, verbatimSymlinks: true });
}
