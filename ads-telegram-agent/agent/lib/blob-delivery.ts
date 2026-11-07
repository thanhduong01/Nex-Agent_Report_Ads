import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import type { DeliveryStore } from "./delivery.ts";
import { isBlobConflict } from "./blob-errors.ts";

type RecordState = { state: "pending" | "sent" | "failed" | "uncertain"; createdAt: string; updatedAt?: string; messageId?: number; fingerprint: string };
export interface DeliveryRecords {
  read(key: string): Promise<{ value: RecordState; etag: string } | null>;
  write(key: string, value: RecordState, etag?: string): Promise<boolean>;
}
const path = (key: string) => `report-delivery/${process.env.VERCEL_ENV || "production"}/${createHash("sha256").update(key).digest("hex")}.json`;
const records: DeliveryRecords = {
  async read(key) {
    const result = await get(path(key), { access: "private", useCache: false, abortSignal: AbortSignal.timeout(15000) });
    if (!result) return null;
    return { value: await new Response(result.stream).json() as RecordState, etag: result.blob.etag };
  },
  async write(key, value, etag) {
    try {
      await put(path(key), JSON.stringify(value), { access: "private", addRandomSuffix: false,
        allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {}), contentType: "application/json",
        abortSignal: AbortSignal.timeout(15000) });
      return true;
    } catch (error) {
      if (isBlobConflict(error)) return false;
      throw new Error("Không ghi được lịch sử gửi vào kho lưu trữ.");
    }
  },
};
export function createBlobDeliveryStore(storage: DeliveryRecords = records): DeliveryStore {
  return {
    async claim(key, text) {
      const existing = await storage.read(key);
      if (existing && existing.value.state !== "failed") return false;
      return storage.write(key, { state: "pending", createdAt: new Date().toISOString(),
        fingerprint: createHash("sha256").update(text).digest("hex") }, existing?.etag);
    },
    async finish(key, state, messageId) {
      const record = await storage.read(key);
      if (!record || !await storage.write(key, { ...record.value, state, messageId, updatedAt: new Date().toISOString() }, record.etag))
        throw new Error("Chưa xác nhận được trạng thái gửi. Kiểm tra Telegram trước khi gửi lại.");
    },
  };
}
export const blobDeliveryStore = createBlobDeliveryStore();
