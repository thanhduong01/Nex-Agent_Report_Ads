import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const app = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync("npm", ["run", "build"], {
  cwd: app, stdio: "inherit", env: { ...process.env, VERCEL: "1" },
});
if (result.error || result.status !== 0) process.exit(result.status || 1);
const output = resolve(process.cwd(), ".vercel/output");
const appOutput = resolve(app, ".vercel/output");
if (output !== appOutput) {
  await mkdir(resolve(process.cwd(), ".vercel"), { recursive: true });
  await rm(output, { recursive: true, force: true });
  await cp(appOutput, output, { recursive: true, verbatimSymlinks: true });
}
