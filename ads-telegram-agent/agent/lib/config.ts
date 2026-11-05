import { z } from "zod";

export const settings = {
  timeZone: "Asia/Ho_Chi_Minh",
  deliveryTime: "09:00",
  cronUtc: "0 2 * * *",
  // Assumption: the existing spend columns are in VND. Change if necessary.
  currency: "VND",
};

export const mappingSchema = z.object({
  sheet: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  startRow: z.number().int().min(2).max(100),
  dateColumn: z.number().int().min(0).max(51),
  dateMode: z.enum(["day", "date"]),
  costColumn: z.number().int().min(0).max(51),
  messagesColumn: z.number().int().min(0).max(51),
  phonesColumn: z.number().int().min(0).max(51).nullable(),
  spendColumns: z.array(z.number().int().min(0).max(51)).min(1).max(20),
});
export type Mapping = z.infer<typeof mappingSchema>;

export const sourceSchema = z.object({
  spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  mappings: z.array(mappingSchema).min(1).max(12).optional(),
  allowSharedExport: z.boolean().optional(),
  // Optional date the data owner has confirmed complete, not a fetch timestamp.
  confirmedThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type Source = z.infer<typeof sourceSchema>;

export function sources(): Record<string, Source> {
  return process.env.REPORT_SOURCES_JSON
    ? z.record(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), sourceSchema)
        .parse(JSON.parse(process.env.REPORT_SOURCES_JSON))
    : {};
}

export type Product = {
  name: string;
  cost: number;
  messages: number;
  phones: number | null;
  spendInputs: number[];
};
// October reference layout. The reader resolves positions from each file's headers.
// Source row 3 contains totals, never daily data. phones:null means not tracked.
export const products: Product[] = [
  { name: "Hàn Quốc", cost: 7, messages: 8, phones: 10, spendInputs: [1, 3] },
  { name: "Thượng Hải", cost: 5, messages: 6, phones: 8, spendInputs: [1] },
  { name: "Đài Loan", cost: 5, messages: 6, phones: 8, spendInputs: [1] },
  { name: "Khách Sạn", cost: 5, messages: 6, phones: null, spendInputs: [1] },
];
