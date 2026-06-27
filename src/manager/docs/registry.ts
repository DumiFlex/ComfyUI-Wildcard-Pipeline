import { type Component } from "vue";

export type DocTone =
  | "node" | "neutral"
  | "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";
export type DocGroupId = "overview" | "concepts" | "nodes" | "modules" | "reference";

export interface DocPageMeta {
  id: string;
  title: string;
  group: DocGroupId;
  icon: string;        // PrimeIcons class, e.g. "pi pi-sitemap"
  tone: DocTone;
  blurb: string;
  /** WP node id chip shown in the hero (nodes only). */
  nodeId?: string;
  /** Lazy dynamic-import loader for the page SFC — resolved by Docs.vue
   *  via watch+shallowRef so flushPromises() fully settles it in tests. */
  loader: () => Promise<{ default: Component }>;
  keywords?: string[];
}

export const DOC_GROUPS: { id: DocGroupId; label: string }[] = [
  { id: "overview",  label: "Overview" },
  { id: "concepts",  label: "How it connects" },
  { id: "nodes",     label: "Nodes" },
  { id: "modules",   label: "Modules" },
  { id: "reference", label: "Reference" },
];

type Loader = () => Promise<{ default: Component }>;

function page(p: Loader): Pick<DocPageMeta, "loader"> {
  return { loader: p };
}

export const DOC_PAGES: DocPageMeta[] = [
  // Overview
  { id: "introduction", title: "Introduction", group: "overview", icon: "pi pi-compass", tone: "neutral",
    blurb: "What Wildcard Pipeline is and how the pieces fit.", keywords: ["start", "overview", "mental model"],
    ...page(() => import("./pages/overview/introduction.vue")) },
  { id: "quick-start", title: "Quick start", group: "overview", icon: "pi pi-play", tone: "neutral",
    blurb: "Build the smallest working pipeline.", keywords: ["tutorial", "first"],
    ...page(() => import("./pages/overview/quick-start.vue")) },
  { id: "glossary", title: "Glossary", group: "overview", icon: "pi pi-book", tone: "neutral",
    blurb: "Terms: module, instance, $var, ref, snapshot, drift, surface.",
    ...page(() => import("./pages/overview/glossary.vue")) },
  // Concepts
  { id: "variable-pipeline", title: "The $variable pipeline", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "How modules produce $vars and the Assembler fills templates.", keywords: ["$var", "@{uuid}", "{a|b|c}", "syntax", "surface"],
    ...page(() => import("./pages/concepts/variable-pipeline.vue")) },
  { id: "context-chaining", title: "Context chaining", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "Layer Contexts; last write wins; internal keys.", keywords: ["upstream", "override", "internals"],
    ...page(() => import("./pages/concepts/context-chaining.vue")) },
  { id: "seeds-and-loops", title: "Seeds & loops", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "Chain seed, locked seeds, WP Context Loop, iteration vars.", keywords: ["seed", "loop", "iteration", "rng"],
    ...page(() => import("./pages/concepts/seeds-and-loops.vue")) },
  { id: "iteration-overrides", title: "Per-iteration overrides", group: "concepts", icon: "pi pi-images", tone: "neutral",
    blurb: "Give individual loop frames their own settings: pinned picks, per-frame seed locks, enable/disable.",
    keywords: ["override", "iteration", "frame", "keyframe", "per-frame", "edit frame", "enable", "disable"],
    ...page(() => import("./pages/concepts/iteration-overrides.vue")) },
  { id: "constraints", title: "Constraints in depth", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "Source→target pairing, matrix vs exceptions, one-shot consume.", keywords: ["pairing", "matrix", "carrier"],
    ...page(() => import("./pages/concepts/constraints.vue")) },
  { id: "internal-variables", title: "Internal variables", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "Hide a $var from the rendered prompt; when it's stripped.", keywords: ["internal", "strip", "__"],
    ...page(() => import("./pages/concepts/internal-variables.vue")) },
  { id: "conflicts-and-warnings", title: "Conflicts & warnings", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "The advisory scanner + runtime warnings (never blocks).", keywords: ["scanner", "advisory", "warning"],
    ...page(() => import("./pages/concepts/conflicts-and-warnings.vue")) },
  { id: "bundles-concept", title: "Bundles", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "Group + reuse modules; frozen snapshots; enable overlay.", keywords: ["group", "snapshot", "reuse"],
    ...page(() => import("./pages/concepts/bundles-concept.vue")) },
  // Nodes
  { id: "wp-context", title: "WP Context", group: "nodes", icon: "pi pi-sitemap", tone: "node", nodeId: "WP_Context",
    blurb: "Rolls a module stack into a $variable Context.", keywords: ["context", "modules", "seed"],
    ...page(() => import("./pages/nodes/wp-context.vue")) },
  { id: "wp-context-loop", title: "WP Context Loop", group: "nodes", icon: "pi pi-replay", tone: "node", nodeId: "WP_ContextLoop",
    blurb: "Emit N Contexts so the chain auto-iterates.", keywords: ["loop", "iterate", "batch"],
    ...page(() => import("./pages/nodes/wp-context-loop.vue")) },
  { id: "wp-seed-list", title: "WP Seed List", group: "nodes", icon: "pi pi-clone", tone: "node", nodeId: "WP_SeedList",
    blurb: "Emit N derived seeds — one per loop iteration — for downstream samplers.", keywords: ["seed", "list", "ksampler", "loop", "batch", "unique"],
    ...page(() => import("./pages/nodes/wp-seed-list.vue")) },
  { id: "wp-context-injector", title: "WP Context Injector", group: "nodes", icon: "pi pi-bolt", tone: "node", nodeId: "WP_ContextInjector",
    blurb: "Lift external node outputs into named $vars.", keywords: ["inject", "override", "rows"],
    ...page(() => import("./pages/nodes/wp-context-injector.vue")) },
  { id: "wp-prompt-assembler", title: "WP Prompt Assembler", group: "nodes", icon: "pi pi-align-left", tone: "node", nodeId: "WP_PromptAssembler",
    blurb: "Fill $var placeholders in a template string.", keywords: ["template", "prompt", "assemble"],
    ...page(() => import("./pages/nodes/wp-prompt-assembler.vue")) },
  { id: "wp-prompt-cleaner", title: "WP Prompt Cleaner", group: "nodes", icon: "pi pi-ban", tone: "node", nodeId: "WP_PromptCleaner",
    blurb: "Rule-based cleanup of a prompt string.", keywords: ["clean", "dedupe", "blocklist"],
    ...page(() => import("./pages/nodes/wp-prompt-cleaner.vue")) },
  { id: "wp-debug", title: "WP Debug", group: "nodes", icon: "pi pi-eye", tone: "node", nodeId: "WP_Debug",
    blurb: "Inspect the Context: snapshot, trace, picks, warnings.", keywords: ["debug", "inspect", "trace"],
    ...page(() => import("./pages/nodes/wp-debug.vue")) },
  { id: "wp-var-to-int", title: "WP Var → Int", group: "nodes", icon: "pi pi-hashtag", tone: "node", nodeId: "WP_VarToInt",
    blurb: "Parse an integer out of a $var.", keywords: ["convert", "int", "number"],
    ...page(() => import("./pages/nodes/wp-var-to-int.vue")) },
  { id: "wp-var-to-float", title: "WP Var → Float", group: "nodes", icon: "pi pi-hashtag", tone: "node", nodeId: "WP_VarToFloat",
    blurb: "Parse a float out of a $var.", keywords: ["convert", "float", "number"],
    ...page(() => import("./pages/nodes/wp-var-to-float.vue")) },
  { id: "wp-var-to-bool", title: "WP Var → Bool", group: "nodes", icon: "pi pi-check-square", tone: "node", nodeId: "WP_VarToBool",
    blurb: "Parse a boolean out of a $var.", keywords: ["convert", "bool", "toggle"],
    ...page(() => import("./pages/nodes/wp-var-to-bool.vue")) },
  // Modules
  { id: "wildcard", title: "Wildcard", group: "modules", icon: "pi pi-sparkles", tone: "wildcard",
    blurb: "Weighted random pick that sets one $var.", keywords: ["random", "weight", "option"],
    ...page(() => import("./pages/modules/wildcard.vue")) },
  { id: "fixed-values", title: "Fixed Values", group: "modules", icon: "pi pi-tag", tone: "fixed_values",
    blurb: "Assign explicit name = value bindings.", keywords: ["fixed", "constant"],
    ...page(() => import("./pages/modules/fixed-values.vue")) },
  { id: "combine", title: "Combine", group: "modules", icon: "pi pi-link", tone: "combine",
    blurb: "Template-fill $vars into one output $var.", keywords: ["template", "merge"],
    ...page(() => import("./pages/modules/combine.vue")) },
  { id: "derivation", title: "Derivation", group: "modules", icon: "pi pi-arrow-right-arrow-left", tone: "derivation",
    blurb: "IF/ELIF/ELSE rules that mutate the Context.", keywords: ["rule", "condition", "logic"],
    ...page(() => import("./pages/modules/derivation.vue")) },
  { id: "constraint", title: "Constraint", group: "modules", icon: "pi pi-filter", tone: "constraint",
    blurb: "Reweight a target wildcard from a source pick.", keywords: ["pairing", "matrix", "exclude"],
    ...page(() => import("./pages/modules/constraint.vue")) },
  { id: "bundles", title: "Bundles", group: "modules", icon: "pi pi-box", tone: "bundle",
    blurb: "Group a range of modules into a reusable unit.", keywords: ["group", "snapshot"],
    ...page(() => import("./pages/modules/bundles.vue")) },
  { id: "templates", title: "Templates", group: "modules", icon: "pi pi-file-edit", tone: "neutral",
    blurb: "Save a reusable $var prompt string for the Assembler.", keywords: ["template", "assembler", "$var", "prompt"],
    ...page(() => import("./pages/modules/templates.vue")) },
  // Reference
  { id: "warning-types", title: "Warning & conflict types", group: "reference", icon: "pi pi-list", tone: "neutral",
    blurb: "Every runtime warning + scanner rule, explained.", keywords: ["warning", "error", "conflict", "reference"],
    ...page(() => import("./pages/reference/warning-types.vue")) },
];

export function pagesByGroup(group: DocGroupId): DocPageMeta[] {
  return DOC_PAGES.filter((p) => p.group === group);
}
export function findPage(id: string | undefined): DocPageMeta | undefined {
  return DOC_PAGES.find((p) => p.id === id);
}
export function searchPages(q: string): DocPageMeta[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return DOC_PAGES;
  return DOC_PAGES.filter((p) =>
    p.title.toLowerCase().includes(needle)
    || p.blurb.toLowerCase().includes(needle)
    || (p.keywords ?? []).some((k) => k.toLowerCase().includes(needle)),
  );
}
export function toneVar(tone: DocTone): string {
  switch (tone) {
    case "node": return "var(--wp-node)";
    case "wildcard": return "var(--wp-kind-wildcard)";
    case "fixed_values": return "var(--wp-kind-fixed)";
    case "combine": return "var(--wp-kind-combine)";
    case "derivation": return "var(--wp-kind-derivation)";
    case "constraint": return "var(--wp-kind-constraint)";
    case "bundle":
    case "neutral":
    default: return "var(--wp-text-muted)";
  }
}
