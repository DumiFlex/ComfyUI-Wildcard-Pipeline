/**
 * Tiny formatting helpers shared by the Community screens.
 *
 * Mirrors `fmtNum` + `relTime` + `KIND_*` from the React prototype so the
 * card / detail / featured strip read the same numbers and labels.
 */

export function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value < 1000) return String(value);
  const div = value / 1000;
  const decimals = value >= 10_000 ? 0 : 1;
  return `${div.toFixed(decimals).replace(/\.0$/, "")}k`;
}

/** Pretty-print an ISO timestamp as "5m ago" / "3d ago" / etc. */
export function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export const KIND_LABEL: Record<string, string> = {
  wildcard:     "Wildcard",
  fixed_values: "Fixed Values",
  combine:      "Combine",
  derivation:   "Derivation",
  constraint:   "Constraint",
  pipeline:     "Pipeline",
  bundle:       "Pack",
};

export const KIND_ICON: Record<string, string> = {
  wildcard:     "pi-th-large",
  fixed_values: "pi-tag",
  combine:      "pi-share-alt",
  derivation:   "pi-code",
  constraint:   "pi-sitemap",
  pipeline:     "pi-list",
  bundle:       "pi-box",
};
