/**
 * WP_ModelInfo on the canvas — the static side of `engine/model_info.py`.
 *
 * The node writes `$model_family`, `$model_variant` and `$model_name` at run
 * time. The canvas can't see the loaded model, but it CAN read the loader's
 * file-name widget, so the variant and name preview real values here; the
 * family (from the model's architecture) is only known after a run unless the
 * user overrides it, and previews as a `$model_family` placeholder.
 *
 * Variant rules mirror the engine via `tests/fixtures/model-variant-corpus.json`.
 */

export const MODEL_INFO_NODE = "WP_ModelInfo";
export const MODEL_FAMILY_VAR = "model_family";
export const MODEL_VARIANT_VAR = "model_variant";
export const MODEL_NAME_VAR = "model_name";
export const MODEL_VARS = [MODEL_FAMILY_VAR, MODEL_VARIANT_VAR, MODEL_NAME_VAR] as const;

/** Must equal `engine/model_info.py::DEFAULT_VARIANT_RULES`. */
export const DEFAULT_VARIANT_RULES = [
  "# variant: pattern (first match wins, case-insensitive)",
  "noobai: noob",
  "pony: pony|pdxl",
  "illustrious: illustrious|ilxl",
  "animagine: animagine",
].join("\n");

export interface VariantRule {
  variant: string;
  pattern: string;
  regex: RegExp;
}

/** Parse the rules text the same way the engine does: blank lines and `#`
 *  comments skipped, bad lines reported and skipped. */
export function parseVariantRules(text: string): { rules: VariantRule[]; problems: string[] } {
  const rules: VariantRule[] = [];
  const problems: string[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf(":");
    const variant = at >= 0 ? line.slice(0, at).trim() : "";
    const pattern = at >= 0 ? line.slice(at + 1).trim() : "";
    if (at < 0 || !variant || !pattern) {
      problems.push(`not a 'variant: pattern' line: ${line}`);
      continue;
    }
    try {
      rules.push({ variant, pattern, regex: new RegExp(pattern, "i") });
    } catch (e) {
      problems.push(`bad pattern for ${variant}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { rules, problems };
}

export function detectVariant(name: string, rules: VariantRule[]): string {
  if (!name) return "";
  for (const r of rules) if (r.regex.test(name)) return r.variant;
  return "";
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

/** What the node would write, as far as the canvas can tell. `null` = only
 *  known at run time. */
export function staticModelInfo(node: NodeLike, graph?: GraphLike): StaticModelInfo {
  const familyOverride = stringWidget(node, "family_override").trim();
  const variantOverride = stringWidget(node, "variant_override").trim();
  const typed = stringWidget(node, "model_name").trim();
  const rulesWidget = node.widgets?.find((x) => x.name === "variant_rules");
  const rulesText = typeof rulesWidget?.value === "string" ? rulesWidget.value : DEFAULT_VARIANT_RULES;
  const file = typed || loaderFileName(node, graph);
  const name = file ? modelStem(file) : null;
  const variant = variantOverride
    || (name !== null ? detectVariant(name, parseVariantRules(rulesText).rules) : null);
  return { family: familyOverride || null, variant, name };
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
