import { z } from "zod";
import { sources, sourceSchema } from "./config.ts";
import { get, put } from "@vercel/blob";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { scheduleSchema } from "./schedule-config.ts";

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const groupSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  schedule: scheduleSchema.optional(),
  sources: z.record(monthSchema, sourceSchema),
});
export type ReportGroup = z.infer<typeof groupSchema>;
const registrySchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), groups: z.array(groupSchema).max(30) });
export type Registry = z.infer<typeof registrySchema>;
const blobPath = () => `report-config/${process.env.VERCEL_ENV || "production"}/groups.json`;
const localPath = () => process.env.REPORT_CONFIG_PATH || resolve(process.cwd(), ".data/report-groups.json");
export const hasGroupStorage = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const cloud = () => process.env.VERCEL === "1";
function initial(): Registry {
  return { version: 1, revision: 0, groups: [{ id: "default", name: "Báo cáo hiện tại", enabled: true, sources: sources() }] };
}
export class GroupError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
async function readStored(): Promise<{ registry: Registry; etag?: string }> {
  try {
    if (hasGroupStorage()) {
      const result = await get(blobPath(), { access: "private", useCache: false, abortSignal: AbortSignal.timeout(15000) });
      if (!result) return { registry: initial() };
      return { registry: registrySchema.parse(await new Response(result.stream).json()), etag: result.blob.etag };
    }
    if (!cloud() && existsSync(localPath())) return { registry: registrySchema.parse(JSON.parse(readFileSync(localPath(), "utf8"))) };
    return { registry: initial() };
  } catch { throw new GroupError("Không đọc được danh sách nhóm đã lưu. Kiểm tra kho cấu hình rồi thử lại.", 503); }
}
export async function getRegistry() { return (await readStored()).registry; }
export async function getGroup(id = "default") {
  const registry = await getRegistry();
  const group = registry.groups.find(g => g.id === id);
  if (!group) throw new GroupError("Không tìm thấy nhóm báo cáo.", 404);
  return group;
}
export async function saveGroup(input: unknown, revision: number) {
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) throw new GroupError("Kiểm tra tên nhóm, tháng, đường dẫn và các cột dữ liệu.");
  const group = parsed.data;
  const { registry, etag } = await readStored();
  if (registry.revision !== revision) throw new GroupError("Cấu hình đã thay đổi ở một cửa sổ khác. Tải lại danh sách rồi lưu lại.", 409);
  if (registry.groups.some(g => g.id !== group.id && g.name.toLocaleLowerCase("vi") === group.name.toLocaleLowerCase("vi")))
    throw new GroupError("Tên nhóm này đã được sử dụng.");
  const existing = registry.groups.findIndex(g => g.id === group.id);
  if (existing < 0) registry.groups.push(group); else registry.groups[existing] = group;
  registry.revision++;
  registrySchema.parse(registry);
  const content = JSON.stringify(registry);
  if (hasGroupStorage()) {
    try {
      await put(blobPath(), content, { access: "private", addRandomSuffix: false,
        allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {}),
        contentType: "application/json", abortSignal: AbortSignal.timeout(15000) });
    } catch (error) {
      if (error instanceof Error && /Precondition|AlreadyExists/.test(error.name))
        throw new GroupError("Cấu hình đã thay đổi. Tải lại danh sách rồi lưu lại.", 409);
      throw new GroupError("Chưa xác nhận lưu được cấu hình. Tải lại danh sách để kiểm tra trước khi thử lại.", 503);
    }
  } else {
    if (cloud()) throw new GroupError("Cần kết nối kho cấu hình riêng tư cho project trên Vercel.", 503);
    const path = localPath();
    const latest = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : initial();
    if (latest.revision !== revision) throw new GroupError("Cấu hình đã thay đổi. Tải lại danh sách rồi lưu lại.", 409);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = path + "." + randomUUID();
    writeFileSync(temporary, content, { mode: 0o600 }); renameSync(temporary, path);
  }
  return registry;
}
