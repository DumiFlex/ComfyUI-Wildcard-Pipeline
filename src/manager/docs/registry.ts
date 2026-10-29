import { type Component } from "vue";

export type DocTone =
  | "node" | "neutral"
  | "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";
export type DocGroupId = "overview" | "howto" | "ai" | "guides" | "concepts" | "nodes" | "modules" | "reference";

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
  { id: "howto",     label: "How to" },
  { id: "ai",        label: "AI assistant" },
  { id: "guides",    label: "Guides" },
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
    blurb: "Build the smallest working pipeline in a few minutes.", keywords: ["tutorial", "first"],
    ...page(() => import("./pages/overview/quick-start.vue")) },
  { id: "test-runner", title: "Test Runner", group: "overview", icon: "pi pi-bolt", tone: "neutral",
    blurb: "Run modules on many seeds, inspect each one, and compare against a baseline.",
    keywords: ["test", "scenario", "seed", "baseline", "compare", "inspect", "trace", "preview"],
    ...page(() => import("./pages/overview/test-runner.vue")) },
  { id: "library-health", title: "Library health", group: "overview", icon: "pi pi-heart", tone: "neutral",
    blurb: "Check the whole library: broken references, likely mistakes, unused items, and how varied each bundle is.",
    keywords: ["health", "unused", "broken", "missing", "duplicate", "orphan", "clean up", "tidy", "ignore", "variety", "check"],
    ...page(() => import("./pages/overview/library-health.vue")) },
  { id: "themes", title: "Themes and looks", group: "overview", icon: "pi pi-palette", tone: "neutral",
    blurb: "Pick the manager's colours and its look separately, and mix any of them.",
    keywords: ["theme", "colours", "colors", "look", "dark", "light", "high contrast", "accent", "tui", "terminal", "font"],
    ...page(() => import("./pages/overview/themes.vue")) },
  { id: "glossary", title: "Glossary", group: "overview", icon: "pi pi-book", tone: "neutral",
    blurb: "The words you'll see in these docs, one line each.",
    ...page(() => import("./pages/overview/glossary.vue")) },
  // How to
  { id: "howto-variations", title: "Make variations in one click", group: "howto", icon: "pi pi-images", tone: "neutral",
    blurb: "Several prompts and images from one Generate, or every combination of a few options.",
    keywords: ["batch", "variations", "many images", "loop", "sweep", "combinations", "count", "seed list"],
    ...page(() => import("./pages/howto/variations.vue")) },
  { id: "howto-picks-agree", title: "Make two picks agree", group: "howto", icon: "pi pi-link", tone: "neutral",
    blurb: "Stop clashes: let one pick steer another with a constraint, an accepts group or a derivation.",
    keywords: ["match", "agree", "clash", "pair", "depend", "steer", "winter", "outfit"],
    ...page(() => import("./pages/howto/picks-agree.vue")) },
  { id: "howto-keep-steady", title: "Keep something the same", group: "howto", icon: "pi pi-lock", tone: "neutral",
    blurb: "Keep a style, a character or a whole prompt while the rest changes.",
    keywords: ["lock", "hold", "same", "repeat", "reproduce", "fixed seed", "consistent", "character"],
    ...page(() => import("./pages/howto/keep-steady.vue")) },
  { id: "howto-share", title: "Share a pack or workflow", group: "howto", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "Send a workflow, export modules to a file, or publish to the community.",
    keywords: ["share", "export", "import", "publish", "community", "send", "file", "workflow"],
    ...page(() => import("./pages/howto/share.vue")) },
  { id: "troubleshooting", title: "Fix common problems", group: "howto", icon: "pi pi-wrench", tone: "neutral",
    blurb: "Something prints nothing, never changes, or won't install: causes and fixes.",
    keywords: ["problem", "not working", "empty", "missing", "broken", "help", "faq", "same image", "nothing"],
    ...page(() => import("./pages/howto/troubleshooting.vue")) },
  // AI assistant
  { id: "ai-assistant", title: "AI assistant", group: "ai", icon: "pi pi-microchip-ai", tone: "neutral",
    blurb: "Optional and off by default: what the assistant does and where to start.",
    keywords: ["ai", "llm", "model", "ollama", "lm studio", "llama.cpp", "claude", "openai", "draft", "assistant", "uncensored"],
    ...page(() => import("./pages/ai/overview.vue")) },
  { id: "ai-setup", title: "Set up a model", group: "ai", icon: "pi pi-cog", tone: "neutral",
    blurb: "Turn the assistant on, connect a server or API key, and pick a model.",
    keywords: ["ai", "provider", "ollama", "lm studio", "llama.cpp", "claude", "openai", "openrouter", "api key", "model",
      "context", "thinking", "tool format", "embedding", "test connection", "modelfile", "uncensored", "vram"],
    ...page(() => import("./pages/ai/setup.vue")) },
  { id: "ai-drafts", title: "Draft with AI", group: "ai", icon: "pi pi-pencil", tone: "neutral",
    blurb: "The AI button in each editor: write or change options, rules, values and templates.",
    keywords: ["ai", "draft", "add", "remove", "rewrite", "retag", "weights", "describe", "refine", "rules", "template"],
    ...page(() => import("./pages/ai/drafts.vue")) },
  { id: "ai-chat", title: "Chat", group: "ai", icon: "pi pi-comments", tone: "neutral",
    blurb: "Ask about your library or the docs, or ask for a change you apply as a card.",
    keywords: ["ai", "chat", "card", "apply", "undo", "mention", "explain", "images", "saved chats", "context", "thinking"],
    ...page(() => import("./pages/ai/chat.vue")) },
  { id: "ai-pack-builder", title: "Pack builder", group: "ai", icon: "pi pi-box", tone: "neutral",
    blurb: "Describe a pack; the assistant plans, builds, tests and installs it as one bundle.",
    keywords: ["ai", "pack", "pack builder", "plan", "slot", "axis", "relation", "pack graph", "story", "sweep", "extend", "sub-bundle"],
    ...page(() => import("./pages/ai/pack-builder.vue")) },
  { id: "ai-library", title: "Organize and import", group: "ai", icon: "pi pi-folder", tone: "neutral",
    blurb: "Sort the library with AI, tidy an imported pack, and the delete permission.",
    keywords: ["ai", "organize", "category", "tags", "rating", "import", "delete", "permissions", "automatically"],
    ...page(() => import("./pages/ai/library.vue")) },
  { id: "ai-web", title: "Web search and tag lookup", group: "ai", icon: "pi pi-globe", tone: "neutral",
    blurb: "Let the assistant search the web or Danbooru, and use your tag list and LoRAs.",
    keywords: ["ai", "web", "search", "searxng", "brave", "tavily", "kagi", "crawl4ai", "firecrawl", "danbooru", "lora", "embedding"],
    ...page(() => import("./pages/ai/web.vue")) },
  { id: "ai-privacy", title: "Privacy and safety", group: "ai", icon: "pi pi-lock", tone: "neutral",
    blurb: "What leaves your PC and what the assistant can and can't do.",
    keywords: ["ai", "privacy", "safety", "security", "data", "allowed hosts", "dns rebinding", "minor"],
    ...page(() => import("./pages/ai/privacy.vue")) },
  { id: "ai-troubleshooting", title: "Troubleshooting", group: "ai", icon: "pi pi-wrench", tone: "neutral",
    blurb: "Fixes for common assistant problems, and how it helps small local models.",
    keywords: ["ai", "troubleshooting", "problem", "slow", "cut off", "small model", "9b", "connect", "error"],
    ...page(() => import("./pages/ai/troubleshooting.vue")) },
  // Guides
  { id: "pack-structure", title: "Recommended pack structure", group: "guides", icon: "pi pi-th-large", tone: "neutral",
    blurb: "Plan a pack, pick the right feature for each job, and copy a blueprint.",
    keywords: ["structure", "layout", "pack", "blueprint", "recipe", "decision", "driver", "when to use", "which feature",
      "best practice", "anti-pattern", "first pack", "plan", "story", "sweep", "season", "two characters", "accepts", "outfit"],
    ...page(() => import("./pages/guides/pack-structure.vue")) },
  { id: "prompt-writing", title: "Writing prompts for your model", group: "guides", icon: "pi pi-pencil", tone: "neutral",
    blurb: "How each model family wants its prompt: order, quality tags, negatives and CFG, subjects and prompt types.",
    keywords: ["prompt", "model", "illustrious", "pony", "noobai", "flux", "z-image", "qwen", "anima", "wan", "sdxl", "sd1.5",
      "krea", "ltx", "chroma", "cfg", "break", "token", "weights", "lora", "trigger", "inpaint", "img2img", "hires",
      "adetailer", "controlnet", "ip-adapter", "regional", "video", "quality tags", "score tags"],
    ...page(() => import("./pages/guides/prompt-writing.vue")) },
  { id: "adult-packs", title: "Adult (NSFW) packs", group: "guides", icon: "pi pi-shield", tone: "neutral",
    blurb: "Structure, tag norms and the safeguards every adult pack must carry.",
    keywords: ["nsfw", "adult", "explicit", "rating", "suggestive", "safeguard", "clothing state", "rating_explicit"],
    ...page(() => import("./pages/guides/adult-packs.vue")) },
  // Concepts
  { id: "variable-pipeline", title: "The $variable pipeline", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "How modules fill $variables, and which syntax works where.", keywords: ["$var", "@{uuid}", "{a|b|c}", "syntax", "where it works", "naming", "escape"],
    ...page(() => import("./pages/concepts/variable-pipeline.vue")) },
  { id: "chips-and-references", title: "Chips & references", group: "concepts", icon: "pi pi-tag", tone: "neutral",
    blurb: "The chips in text fields, what a red chip means, @{…} references and how to write a tag filter.",
    keywords: ["chip", "chips", "placeholder", "broken", "@{uuid}", "@name", "reference", "filter", "sub-category",
      "not", "and", "or", "negation", "!null", "expression"],
    ...page(() => import("./pages/concepts/chips-and-references.vue")) },
  { id: "context-chaining", title: "Context chaining", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "Wire one WP Context into another; the later one wins.", keywords: ["upstream", "chain", "override", "last write wins"],
    ...page(() => import("./pages/concepts/context-chaining.vue")) },
  { id: "seeds-and-loops", title: "Seeds & loops", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "How seeds decide picks, how to keep a pick, and how loops make variations.", keywords: ["seed", "loop", "iteration", "rng"],
    ...page(() => import("./pages/concepts/seeds-and-loops.vue")) },
  { id: "iteration-overrides", title: "Per-iteration overrides", group: "concepts", icon: "pi pi-images", tone: "neutral",
    blurb: "Give one loop frame its own settings: a fixed pick, a locked seed, a module switched off.",
    keywords: ["override", "iteration", "frame", "keyframe", "per-frame", "edit frame", "enable", "disable"],
    ...page(() => import("./pages/concepts/iteration-overrides.vue")) },
  { id: "constraints", title: "Constraints in depth", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "How constraints combine, which uses they reach, and how they work across Contexts.", keywords: ["pairing", "matrix", "reach", "combine", "across contexts"],
    ...page(() => import("./pages/concepts/constraints.vue")) },
  { id: "internal-variables", title: "Hidden variables", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "Hide a $variable from the prompt while other modules still use it.", keywords: ["internal", "hide from prompt", "hidden", "globe", "mark internal", "strip"],
    ...page(() => import("./pages/concepts/internal-variables.vue")) },
  { id: "negatives", title: "Negatives", group: "concepts", icon: "pi pi-minus-circle", tone: "neutral",
    blurb: "Send words to the negative prompt from the option, value or rule that needs them.",
    keywords: ["negative", "negative prompt", "send to negative", "$negatives", "add to negative", "--", "neg", "$name.neg", "replace negative"],
    ...page(() => import("./pages/concepts/negatives.vue")) },
  { id: "conflicts-and-warnings", title: "Conflicts & warnings", group: "concepts", icon: "pi pi-share-alt", tone: "neutral",
    blurb: "Where warnings show, what the colours mean. Nothing here stops a run.", keywords: ["scanner", "advisory", "warning"],
    ...page(() => import("./pages/concepts/conflicts-and-warnings.vue")) },
  // Nodes
  { id: "wp-context", title: "WP Context", group: "nodes", icon: "pi pi-sitemap", tone: "node", nodeId: "WP_Context",
    blurb: "Holds your modules, rolls them every run and passes the $variables on.", keywords: ["context", "modules", "seed"],
    ...page(() => import("./pages/nodes/wp-context.vue")) },
  { id: "wp-context-loop", title: "WP Context Loop", group: "nodes", icon: "pi pi-replay", tone: "node", nodeId: "WP_ContextLoop",
    blurb: "Make several variations in one Generate.", keywords: ["loop", "iterate", "batch"],
    ...page(() => import("./pages/nodes/wp-context-loop.vue")) },
  { id: "wp-seed-list", title: "WP Seed List", group: "nodes", icon: "pi pi-clone", tone: "node", nodeId: "WP_SeedList",
    blurb: "One sampler seed per loop frame, so each frame makes its own image.", keywords: ["seed", "list", "ksampler", "loop", "batch", "unique"],
    ...page(() => import("./pages/nodes/wp-seed-list.vue")) },
  { id: "wp-context-injector", title: "WP Context Injector", group: "nodes", icon: "pi pi-bolt", tone: "node", nodeId: "WP_ContextInjector",
    blurb: "Turn any value on the canvas into a $variable.", keywords: ["inject", "override", "rows"],
    ...page(() => import("./pages/nodes/wp-context-injector.vue")) },
  { id: "wp-model-info", title: "WP Model Info", group: "nodes", icon: "pi pi-microchip", tone: "node", nodeId: "WP_ModelInfo",
    blurb: "Name the loaded checkpoint so rules can branch on it.", keywords: ["model", "checkpoint", "pony", "illustrious", "lora", "variant"],
    ...page(() => import("./pages/nodes/wp-model-info.vue")) },
  { id: "wp-toggles", title: "WP Toggles", group: "nodes", icon: "pi pi-check-square", tone: "node", nodeId: "WP_Toggles",
    blurb: "Several on/off switches in one node, as $variables and BOOLEAN outputs, that can also mute or bypass nodes.", keywords: ["toggle", "boolean", "switch", "on", "off", "lora", "merge", "mute", "bypass", "pick one"],
    ...page(() => import("./pages/nodes/wp-toggles.vue")) },
  { id: "wp-node-group", title: "WP Node Group", group: "nodes", icon: "pi pi-sitemap", tone: "node", nodeId: "WP_NodeGroup",
    blurb: "Gather nodes so one WP Toggles switch mutes or bypasses them all.", keywords: ["mute", "bypass", "group", "collector", "repeater", "toggle", "rgthree"],
    ...page(() => import("./pages/nodes/wp-node-group.vue")) },
  { id: "wp-mode-relay", title: "WP Mode Relay", group: "nodes", icon: "pi pi-arrow-right-arrow-left", tone: "node", nodeId: "WP_ModeRelay",
    blurb: "When the nodes it watches get muted or bypassed, mute, bypass or run a WP Node Group.", keywords: ["mute", "bypass", "relay", "chain", "rgthree", "group"],
    ...page(() => import("./pages/nodes/wp-mode-relay.vue")) },
  { id: "wp-bookmark", title: "WP Bookmark", group: "nodes", icon: "pi pi-bookmark", tone: "node", nodeId: "WP_Bookmark",
    blurb: "Mark a spot on the canvas and jump back to it with a shortcut or from the Bookmarks dock.", keywords: ["bookmark", "jump", "navigate", "shortcut", "zoom", "dock", "rgthree", "hotkey"],
    ...page(() => import("./pages/nodes/wp-bookmark.vue")) },
  { id: "wp-prompt-assembler", title: "WP Prompt Assembler", group: "nodes", icon: "pi pi-align-left", tone: "node", nodeId: "WP_PromptAssembler",
    blurb: "Write a template with $variables and get the prompt and its negative.", keywords: ["template", "prompt", "assemble"],
    ...page(() => import("./pages/nodes/wp-prompt-assembler.vue")) },
  { id: "wp-prompt-cleaner", title: "WP Prompt Cleaner", group: "nodes", icon: "pi pi-ban", tone: "node", nodeId: "WP_PromptCleaner",
    blurb: "Tidy a prompt: duplicates, stray commas, brackets, LoRA tags, blocked words.", keywords: ["clean", "dedupe", "blocklist"],
    ...page(() => import("./pages/nodes/wp-prompt-cleaner.vue")) },
  { id: "wp-image-filter", title: "WP Image Filter", group: "nodes", icon: "pi pi-filter", tone: "node", nodeId: "WP_ImageFilter",
    blurb: "Pause the run and pick which images (and their prompts) go on.", keywords: ["image", "filter", "pick", "select", "upscale", "batch", "pause"],
    ...page(() => import("./pages/nodes/wp-image-filter.vue")) },
  { id: "wp-label-grid", title: "WP Label & Grid", group: "nodes", icon: "pi pi-th-large", tone: "node", nodeId: "WP_LabelGrid",
    blurb: "Put labels on images and lay them out in a labelled grid or XY plot.", keywords: ["label", "grid", "xy", "plot", "compare", "caption", "text", "contact sheet"],
    ...page(() => import("./pages/nodes/wp-label-grid.vue")) },
  { id: "wp-debug", title: "WP Debug", group: "nodes", icon: "pi pi-eye", tone: "node", nodeId: "WP_Debug",
    blurb: "See every variable, pick and warning after a run.", keywords: ["debug", "inspect", "trace"],
    ...page(() => import("./pages/nodes/wp-debug.vue")) },
  { id: "wp-var-to-int", title: "WP Var → Int", group: "nodes", icon: "pi pi-hashtag", tone: "node", nodeId: "WP_VarToInt",
    blurb: "Turn a number in a $variable into a whole-number input.", keywords: ["convert", "int", "number"],
    ...page(() => import("./pages/nodes/wp-var-to-int.vue")) },
  { id: "wp-var-to-float", title: "WP Var → Float", group: "nodes", icon: "pi pi-hashtag", tone: "node", nodeId: "WP_VarToFloat",
    blurb: "Turn a number in a $variable into a decimal input.", keywords: ["convert", "float", "number"],
    ...page(() => import("./pages/nodes/wp-var-to-float.vue")) },
  { id: "wp-var-to-bool", title: "WP Var → Bool", group: "nodes", icon: "pi pi-check-square", tone: "node", nodeId: "WP_VarToBool",
    blurb: "Turn a yes/no in a $variable into a true/false input.", keywords: ["convert", "bool", "toggle"],
    ...page(() => import("./pages/nodes/wp-var-to-bool.vue")) },
  { id: "wp-var-to-choice", title: "WP Var → Choice", group: "nodes", icon: "pi pi-list", tone: "node", nodeId: "WP_VarToChoice",
    blurb: "Send a $variable into a dropdown: checkpoint, sampler, scheduler, VAE, LoRA.", keywords: ["convert", "combo", "dropdown", "checkpoint", "sampler", "scheduler", "model", "choice"],
    ...page(() => import("./pages/nodes/wp-var-to-choice.vue")) },
  { id: "wp-note", title: "WP Note", group: "nodes", icon: "pi pi-bookmark", tone: "node", nodeId: "WP_Note",
    blurb: "A note that explains a workflow: a step, a tip or a label, with a docs link.", keywords: ["note", "comment", "label", "sticky", "step", "tip", "explain"],
    ...page(() => import("./pages/nodes/wp-note.vue")) },
  // Modules
  { id: "wildcard", title: "Wildcard", group: "modules", icon: "pi pi-sparkles", tone: "wildcard",
    blurb: "A list of options; each run picks one into a $variable.", keywords: ["random", "weight", "option", "tag groups", "fallback", "multi-pick", "match variable"],
    ...page(() => import("./pages/modules/wildcard.vue")) },
  { id: "wildcard-import", title: "Import wildcard packs", group: "modules", icon: "pi pi-download", tone: "wildcard",
    blurb: "Bring in A1111, Forge, Dynamic Prompts, PPP or Impact Pack wildcards.", keywords: ["import", "dynamic prompts", "ppp", "yaml", "txt", "zip", "a1111", "forge", "wildcard packs", "impact pack", "merge lists"],
    ...page(() => import("./pages/modules/wildcard-import.vue")) },
  { id: "fixed-values", title: "Fixed Values", group: "modules", icon: "pi pi-tag", tone: "fixed_values",
    blurb: "Set $variables to text you type.", keywords: ["fixed", "constant"],
    ...page(() => import("./pages/modules/fixed-values.vue")) },
  { id: "combine", title: "Combine", group: "modules", icon: "pi pi-link", tone: "combine",
    blurb: "Build a new $variable from text and other variables.", keywords: ["template", "merge"],
    ...page(() => import("./pages/modules/combine.vue")) },
  { id: "derivation", title: "Derivation", group: "modules", icon: "pi pi-arrow-right-arrow-left", tone: "derivation",
    blurb: "If/then rules: when a variable says one thing, change another.", keywords: ["rule", "condition", "logic", "and", "or", "group"],
    ...page(() => import("./pages/modules/derivation.vue")) },
  { id: "constraint", title: "Constraint", group: "modules", icon: "pi pi-filter", tone: "constraint",
    blurb: "Let one pick change the odds of another.", keywords: ["pairing", "matrix", "exclude"],
    ...page(() => import("./pages/modules/constraint.vue")) },
  { id: "bundles", title: "Bundles", group: "modules", icon: "pi pi-box", tone: "bundle",
    blurb: "Several modules saved together, added in one go.", keywords: ["group", "snapshot"],
    ...page(() => import("./pages/modules/bundles.vue")) },
  { id: "templates", title: "Templates", group: "modules", icon: "pi pi-file-edit", tone: "neutral",
    blurb: "Save an Assembler template and load it anywhere.", keywords: ["template", "assembler", "$var", "prompt"],
    ...page(() => import("./pages/modules/templates.vue")) },
  // Reference
  { id: "warning-types", title: "Warning & conflict types", group: "reference", icon: "pi pi-list", tone: "neutral",
    blurb: "Every warning, what it means and what to do.", keywords: ["warning", "error", "conflict", "reference"],
    ...page(() => import("./pages/reference/warning-types.vue")) },
  { id: "component-kit", title: "Component kit", group: "reference", icon: "pi pi-th-large", tone: "neutral",
    blurb: "Every shared control, colour and size, shown live.", keywords: ["kit", "wp-kit", "kit site", "kit version", "components", "design", "buttons", "tokens", "colours", "contributors"],
    ...page(() => import("./pages/reference/component-kit.vue")) },
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
