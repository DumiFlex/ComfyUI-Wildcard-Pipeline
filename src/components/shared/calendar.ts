/**
 * Date helpers for DatePicker. Dates travel as "YYYY-MM-DD" strings (local
 * calendar days, no time zone), so a saved filter means the same day
 * everywhere.
 */
export interface Ymd { y: number; m: number; d: number } // m is 0-11

export function parseYmd(s: string | null | undefined): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]) - 1; const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  return dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d ? { y, m: mo, d } : null;
}

export function toYmd(v: Ymd): string {
  return `${String(v.y).padStart(4, "0")}-${String(v.m + 1).padStart(2, "0")}-${String(v.d).padStart(2, "0")}`;
}

export function fromDate(dt: Date): Ymd {
  return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() };
}

export function addDays(v: Ymd, n: number): Ymd {
  return fromDate(new Date(v.y, v.m, v.d + n));
}

/** The same day n months on, kept inside the shorter month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(v: Ymd, n: number): Ymd {
  const first = new Date(v.y, v.m + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return { y: first.getFullYear(), m: first.getMonth(), d: Math.min(v.d, last) };
}

export function compareYmd(a: Ymd, b: Ymd): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

/**
 * The 6×7 grid of days shown for a month, starting on `weekStart`
 * (0 = Sunday, 1 = Monday), with days of the months either side.
 */
export function monthGrid(y: number, m: number, weekStart = 1): Ymd[] {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => fromDate(new Date(y, m, 1 - lead + i)));
}

/** Short weekday names from `weekStart`, in the browser's language. */
export function weekdayNames(weekStart = 1, locale?: string): { short: string; long: string }[] {
  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(2024, 0, 7 + ((weekStart + i) % 7));
    return {
      short: dt.toLocaleDateString(locale, { weekday: "narrow" }),
      long: dt.toLocaleDateString(locale, { weekday: "long" }),
    };
  });
}
