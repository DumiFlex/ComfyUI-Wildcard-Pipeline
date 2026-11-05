/** Small readers for the loosely typed op bodies the builders walk. */
export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : []);
export const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
