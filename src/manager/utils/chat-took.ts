/** How long an answer took, short: "0.8 s", "12 s", "2 min 5 s". */
export function tookLabel(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 10_000) return `${Math.max(0.1, Math.round(ms / 100) / 10)} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

/** Tokens, short: "980", "12.4k", "1.2M". */
export function tokensShort(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

interface Spent { prompt?: number; cached?: number; output?: number; calls?: number }

/** What an answer used, short, under the reply: "12.4k tokens". */
export function spentLabel(s: Spent | undefined): string {
  const total = (s?.prompt ?? 0) + (s?.output ?? 0);
  return total > 0 ? `${tokensShort(total)} tokens` : "";
}

/** The same, in full, for its tooltip. */
export function spentTitle(s: Spent | undefined): string {
  if (!s) return "";
  const fmt = (n: number): string => n.toLocaleString();
  const lines = [`Read ${fmt(s.prompt ?? 0)} tokens`];
  if (s.cached) {
    const share = s.prompt ? Math.round((s.cached / s.prompt) * 100) : 0;
    lines.push(`  ${fmt(s.cached)} of them from the cache (${share}%)`);
  }
  lines.push(`Wrote ${fmt(s.output ?? 0)} tokens`);
  if (s.calls) lines.push(`${s.calls} model call${s.calls === 1 ? "" : "s"}`);
  return lines.join("\n");
}

/** When an answer finished: the time today, else the date too. */
export function shortTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? time : `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${time}`;
}

export function fullTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}
