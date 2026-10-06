/**
 * WP_ModelInfo on the canvas — the static side of `engine/model_info.py`.
 *
 * The node writes `$model_family`, `$model_variant` and `$model_name` at run
 * time. The canvas can't see the loaded model, but it CAN read the loader's
 * file-name widget, so the variant and name preview real values here; the
 * family (from the model's architecture) comes from the last run unless the
 * user pins it, and previews as a `$model_family` placeholder before that.
 *
 * Variant rules mirror the engine via `tests/fixtures/model-variant-corpus.json`.
 */

export const MODEL_INFO_NODE = "WP_ModelInfo";
export const MODEL_FAMILY_VAR = "model_family";
export const MODEL_VARIANT_VAR = "model_variant";
export const MODEL_NAME_VAR = "model_name";
export const MODEL_VARS = [MODEL_FAMILY_VAR, MODEL_VARIANT_VAR, MODEL_NAME_VAR] as const;
/** The node's one widget: rules + pins as JSON. */
export const CONFIG_WIDGET = "wp_model_info";

export interface VariantRuleRow {
  variant: string;
  pattern: string;
}

/** Must equal `engine/model_info.py::DEFAULT_VARIANT_RULES`. */
export const DEFAULT_VARIANT_RULES: readonly VariantRuleRow[] = [
  { variant: "noobai", pattern: "noob" },
  { variant: "pony", pattern: "pony|pdxl" },
  { variant: "illustrious", pattern: "illustrious|ilxl" },
  { variant: "animagine", pattern: "animagine" },
];

export interface VariantRule {
  variant: string;
  pattern: string;
  regex: RegExp;
  /** Index of the row it came from, so the widget can light that row. */
  row: number;
}

/** Compile the rule rows the same way the engine does: a row with neither
 *  field is unfinished and skipped quietly; a half-filled row or a bad
 *  pattern is reported and skipped. `problemRows` holds their indexes. */
export function compileVariantRules(rows: readonly VariantRuleRow[]): {
  rules: VariantRule[];
  problems: string[];
  problemRows: number[];
} {
  const rules: VariantRule[] = [];
  const problems: string[] = [];
  const problemRows: number[] = [];
  rows.forEach((r, row) => {
    const variant = (r?.variant ?? "").trim();
    const pattern = (r?.pattern ?? "").trim();
    if (!variant && !pattern) return;
    if (!variant || !pattern) {
      problems.push(`rule '${variant || pattern}' needs both a variant and a pattern`);
      problemRows.push(row);
      return;
    }
    try {
      rules.push({ variant, pattern, regex: new RegExp(pattern, "i"), row });
    } catch (e) {
      problems.push(`bad pattern for ${variant}: ${e instanceof Error ? e.message : String(e)}`);
      problemRows.push(row);
    }
  });
  return { rules, problems, problemRows };
}

/** The node's widget state (`wp_model_info`). Empty pins mean "detect it".
 *  Mirrors `engine/model_info.py::parse_config`. */
export interface ModelInfoConfig {
  version: 1;
  rules: VariantRuleRow[];
  family: string;
  variant: string;
  name: string;
}

export function defaultModelInfoConfig(): ModelInfoConfig {
  return { version: 1, rules: DEFAULT_VARIANT_RULES.map((r) => ({ ...r })), family: "", variant: "", name: "" };
}

export function parseModelInfoConfig(raw: unknown): ModelInfoConfig {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try { data = raw.trim() ? JSON.parse(raw) : {}; } catch { data = {}; }
  }
  const d = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const rows = Array.isArray(d.rules)
    ? d.rules
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        variant: typeof r.variant === "string" ? r.variant : "",
        pattern: typeof r.pattern === "string" ? r.pattern : "",
      }))
    : DEFAULT_VARIANT_RULES.map((r) => ({ ...r }));
  const pin = (k: string) => (typeof d[k] === "string" ? (d[k] as string).trim() : "");
  return { version: 1, rules: rows, family: pin("family"), variant: pin("variant"), name: pin("name") };
}

/** First rule whose pattern occurs in `name`, or null. */
export function matchRule(name: string, rules: VariantRule[]): VariantRule | null {
  if (!name) return null;
  return rules.find((r) => r.regex.test(name)) ?? null;
}

export function detectVariant(name: string, rules: VariantRule[]): string {
  return matchRule(name, rules)?.variant ?? "";
}

/** `SDXL\pony\ponyDiffusionV6XL.safetensors` → `ponyDiffusionV6XL`. */
export function modelStem(path: string): string {
  const parts = (path ?? "").trim().split(/[\\/]/);
  const base = parts[parts.length - 1] ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/* ── graph read ───────────────────────────────────────────────────────── */

interface NodeLike {
  id: number;
  inputs?: { name: string; link: number | null }[];
  widgets?: { name: string; value: unknown }[];
  graph?: GraphLike;
}
interface GraphLike {
  links: Record<number, { origin_id: number } | undefined>;
  getNodeById(id: number): NodeLike | null;
}

const NAME_WIDGETS = ["ckpt_name", "unet_name", "model_name", "model_path"];

function stringWidget(node: NodeLike, name: string): string {
  const w = node.widgets?.find((x) => x.name === name);
  return typeof w?.value === "string" ? w.value : "";
}

/** File name of the loader behind `node`'s `model` input, stepping over
 *  pass-through nodes (LoRA loaders, patches) via their own `model` input.
 *  `""` when the wire is missing or leaves this graph. */
export function loaderFileName(node: NodeLike, graph: GraphLike | undefined): string {
  const g = node.graph ?? graph;
  if (!g) return "";
  let cur: NodeLike | null = node;
  const seen = new Set<number>();
  while (cur) {
    const slot = cur.inputs?.find((i) => i.name === "model" || i.name === "MODEL");
    if (slot?.link == null) return "";
    const link = g.links[slot.link];
    if (!link || link.origin_id < 0 || seen.has(link.origin_id) || seen.size > 64) return "";
    seen.add(link.origin_id);
    const origin = g.getNodeById(link.origin_id);
    if (!origin) return "";
    for (const w of NAME_WIDGETS) {
      const v = stringWidget(origin, w);
      if (v) return v;
    }
    cur = origin;
  }
  return "";
}

export interface StaticModelInfo {
  family: string | null;
  variant: string | null;
  name: string | null;
}

/** What the last run reported, per node (the widget glue records it from the
 *  `executed` event). Only the family needs it: the canvas can't see the
 *  loaded model, so until a run the family is unknown unless pinned. */
export interface ModelInfoRun {
  family: string;
  variant: string;
  name: string;
  sources: Partial<Record<"family" | "variant" | "name", string>>;
}
const lastRuns = new WeakMap<object, ModelInfoRun>();
export function recordModelInfoRun(node: object, run: ModelInfoRun): void {
  lastRuns.set(node, run);
}
export function lastModelInfoRun(node: object): ModelInfoRun | null {
  return lastRuns.get(node) ?? null;
}

export function readModelInfoConfig(node: NodeLike): ModelInfoConfig {
  return parseModelInfoConfig(node.widgets?.find((x) => x.name === CONFIG_WIDGET)?.value);
}

/** What the node would write, as far as the canvas can tell. `null` = only
 *  known at run time. */
export function staticModelInfo(node: NodeLike, graph?: GraphLike): StaticModelInfo {
  const cfg = readModelInfoConfig(node);
  const file = cfg.name || loaderFileName(node, graph);
  const name = file ? modelStem(file) : null;
  const variant = cfg.variant
    || (name !== null ? detectVariant(name, compileVariantRules(cfg.rules).rules) : null);
  const family = cfg.family || lastModelInfoRun(node)?.family || null;
  return { family, variant, name };
}

/** Preview values for the three variables: real where known, `$name`
 *  placeholder otherwise (same convention as Context Injector rows). */
export function staticModelValues(node: NodeLike, graph?: GraphLike): Record<string, string> {
  const info = staticModelInfo(node, graph);
  return {
    [MODEL_FAMILY_VAR]: info.family ?? `$${MODEL_FAMILY_VAR}`,
    [MODEL_VARIANT_VAR]: info.variant ?? `$${MODEL_VARIANT_VAR}`,
    [MODEL_NAME_VAR]: info.name ?? `$${MODEL_NAME_VAR}`,
  };
}

/** A fixed_values module (legacy `entries` shape the engine still reads)
 *  holding the values the canvas knows, for the server preview chain. Unknown
 *  values are left out rather than sent as placeholders, so a derivation
 *  condition never matches the literal text `$model_family`. */
export function modelInfoPreviewModule(node: NodeLike, graph?: GraphLike): Record<string, unknown> {
  const info = staticModelInfo(node, graph);
  const entries: { variable_name: string; value: string }[] = [];
  if (info.family !== null) entries.push({ variable_name: MODEL_FAMILY_VAR, value: info.family });
  if (info.variant !== null) entries.push({ variable_name: MODEL_VARIANT_VAR, value: info.variant });
  if (info.name !== null) entries.push({ variable_name: MODEL_NAME_VAR, value: info.name });
  return {
    id: "0de1f0ff",
    type: "fixed_values",
    enabled: true,
    meta: { name: "WP Model Info" },
    entries,
  };
}
