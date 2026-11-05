import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const app = fileURLToPath(new URL("../", import.meta.url));
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
