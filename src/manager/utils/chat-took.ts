/** How long an answer took, short: "0.8 s", "12 s", "2 min 5 s". */
export function tookLabel(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 10_000) return `${Math.max(0.1, Math.round(ms / 100) / 10)} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}
