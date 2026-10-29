/**
 * WP Note — a frontend-only node that explains a workflow. Pure config
 * logic: the shape the note widget stores, its parser, and the docs pages a
 * note can link to. The node itself is registered in `widgets/note.ts`.
 */

export type NoteTone = "step" | "tip" | "info" | "plain";
export type NoteLook = "card" | "sticky" | "label";

export interface NoteConfig {
  version: 1;
  tone: NoteTone;
  /** Card: a panel with a coloured edge. Sticky: a tinted panel. Label: a
   *  small coloured tag with the title only (the text shows on hover). */
  look: NoteLook;
  /** The number on a Step note. */
  step: number;
  /** Markdown body. */
  text: string;
  /** A built-in docs page id (see NOTE_DOC_PAGES), or "" for none. */
  doc: string;
}

export const NOTE_TONES: { id: NoteTone; label: string }[] = [
  { id: "step", label: "Step" },
  { id: "tip", label: "Tip" },
  { id: "info", label: "Info" },
  { id: "plain", label: "Plain" },
];

export const NOTE_LOOKS: { id: NoteLook; label: string }[] = [
  { id: "card", label: "Card" },
  { id: "sticky", label: "Sticky" },
  { id: "label", label: "Label" },
];

/** Docs pages a note can link to: the node pages plus the module and
 *  concept pages the examples talk about. Every id must be a page in
 *  `manager/docs/registry.ts` (checked by the note tests). */
export const NOTE_DOC_PAGES: { id: string; title: string }[] = [
  { id: "quick-start", title: "Quick start" },
  { id: "wp-context", title: "WP Context" },
  { id: "wp-context-loop", title: "WP Context Loop" },
  { id: "wp-seed-list", title: "WP Seed List" },
  { id: "wp-context-injector", title: "WP Context Injector" },
  { id: "wp-model-info", title: "WP Model Info" },
  { id: "wp-prompt-assembler", title: "WP Prompt Assembler" },
  { id: "wp-prompt-cleaner", title: "WP Prompt Cleaner" },
  { id: "wp-image-filter", title: "WP Image Filter" },
  { id: "wp-label-grid", title: "WP Label & Grid" },
  { id: "wp-debug", title: "WP Debug" },
  { id: "wp-var-to-int", title: "WP Var → Int" },
  { id: "wp-var-to-choice", title: "WP Var → Choice" },
  { id: "wildcard", title: "Wildcards" },
  { id: "fixed-values", title: "Fixed values" },
  { id: "combine", title: "Combines" },
  { id: "derivation", title: "Derivations" },
  { id: "constraint", title: "Constraints" },
  { id: "bundles", title: "Bundles" },
  { id: "context-chaining", title: "Context chaining" },
  { id: "seeds-and-loops", title: "Seeds & loops" },
  { id: "negatives", title: "Negatives" },
];

export const NOTE_STEP_MAX = 99;

export function defaultNoteConfig(): NoteConfig {
  return { version: 1, tone: "step", look: "card", step: 1, text: "", doc: "" };
}

function pick<T extends string>(v: unknown, allowed: readonly { id: T }[], fallback: T): T {
  return allowed.find((a) => a.id === v)?.id ?? fallback;
}

/** Reads a stored note. Anything missing or broken falls back to the
 *  default for that field, so a hand-edited workflow never breaks the node. */
export function parseNoteConfig(raw: unknown): NoteConfig {
  const base = defaultNoteConfig();
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return base;
    try {
      data = JSON.parse(raw);
    } catch {
      return base;
    }
  }
  if (!data || typeof data !== "object") return base;
  const d = data as Record<string, unknown>;
  const step = typeof d.step === "number" && Number.isFinite(d.step)
    ? Math.min(NOTE_STEP_MAX, Math.max(1, Math.round(d.step)))
    : base.step;
  return {
    version: 1,
    tone: pick(d.tone, NOTE_TONES, base.tone),
    look: pick(d.look, NOTE_LOOKS, base.look),
    step,
    text: typeof d.text === "string" ? d.text : base.text,
    doc: typeof d.doc === "string" && NOTE_DOC_PAGES.some((p) => p.id === d.doc) ? d.doc : "",
  };
}

export function docTitle(id: string): string {
  return NOTE_DOC_PAGES.find((p) => p.id === id)?.title ?? "";
}

/** The manager's docs page for `id`, on this ComfyUI's origin. */
export function docUrl(id: string, origin: string): string {
  return `${origin}/wp/docs/${encodeURIComponent(id)}`;
}
