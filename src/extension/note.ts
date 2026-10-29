/**
 * WP Note — a frontend-only node that explains a workflow. Pure config
 * logic: the shape the note widget stores and its parser. Links (web, docs,
 * buttons) and icons live in the text (components/note/note-format.ts). The
 * node itself is registered in `widgets/note.ts`.
 */

export type NoteTone = "step" | "icon" | "plain";
export type NoteLook = "card" | "sticky" | "label";

export interface NoteConfig {
  version: 1;
  tone: NoteTone;
  /** Card: a panel with a coloured edge. Sticky: a tinted panel. Label: a
   *  small coloured tag with the title only (hovering it shows the text). */
  look: NoteLook;
  /** The number on a Step note. */
  step: number;
  /** The PrimeIcons glyph on an Icon note, without `pi-`. */
  icon: string;
  /** Markdown body, with the note's links and icons (note-format.ts). */
  text: string;
  /** A preset name (see NOTE_COLOR_PRESETS), a hex colour, or "" for the
   *  theme's accent. */
  color: string;
}

export const NOTE_TONES: { id: NoteTone; label: string }[] = [
  { id: "step", label: "Step" },
  { id: "icon", label: "Icon" },
  { id: "plain", label: "Plain" },
];

/** Named colours that follow the theme (light and dark differ). */
export const NOTE_COLOR_PRESETS: { id: string; label: string; css: string }[] = [
  { id: "", label: "Accent", css: "var(--wp-accent)" },
  { id: "tip", label: "Tip", css: "var(--wp-success)" },
  { id: "info", label: "Info", css: "var(--wp-info)" },
  { id: "warning", label: "Warning", css: "var(--wp-warn)" },
  { id: "danger", label: "Danger", css: "var(--wp-danger)" },
  { id: "teal", label: "Teal", css: "var(--wp-teal)" },
  { id: "violet", label: "Violet", css: "var(--wp-violet)" },
  { id: "neutral", label: "Neutral", css: "var(--wp-text-dim)" },
];

/** The CSS colour a note's `color` stands for. */
export function noteColorCss(color: string): string {
  return NOTE_COLOR_PRESETS.find((p) => p.id === color)?.css ?? color;
}

export const NOTE_LOOKS: { id: NoteLook; label: string }[] = [
  { id: "card", label: "Card" },
  { id: "sticky", label: "Sticky" },
  { id: "label", label: "Label" },
];

/** The docs link a note saved before links lived in its text: one page from
 *  this list, drawn as a button under the text. Read only to move it into
 *  the text (see parseNoteConfig). */
const LEGACY_DOC_TITLES: Record<string, string> = {
  "quick-start": "Quick start", "wp-context": "WP Context", "wp-context-loop": "WP Context Loop",
  "wp-seed-list": "WP Seed List", "wp-context-injector": "WP Context Injector", "wp-model-info": "WP Model Info",
  "wp-prompt-assembler": "WP Prompt Assembler", "wp-prompt-cleaner": "WP Prompt Cleaner",
  "wp-image-filter": "WP Image Filter", "wp-label-grid": "WP Label & Grid", "wp-debug": "WP Debug",
  "wp-var-to-int": "WP Var → Int", "wp-var-to-choice": "WP Var → Choice", "wildcard": "Wildcards",
  "fixed-values": "Fixed values", "combine": "Combines", "derivation": "Derivations", "constraint": "Constraints",
  "bundles": "Bundles", "context-chaining": "Context chaining", "seeds-and-loops": "Seeds & loops", "negatives": "Negatives",
};

/** `[Title docs](docs:page){button pi-book}`, as note-format.ts writes it. */
function legacyDocLink(page: string): string {
  const title = (LEGACY_DOC_TITLES[page] ?? page).replace(/\[/g, "(").replace(/\]/g, ")");
  return `[${title} docs](docs:${page}){button pi-book}`;
}

export const NOTE_STEP_MAX = 99;

export function defaultNoteConfig(): NoteConfig {
  return { version: 1, tone: "step", look: "card", step: 1, icon: "lightbulb", text: "", color: "" };
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A preset name or a plain `#rgb` / `#rrggbb` hex; anything else is "". */
export function noteColor(v: unknown): string {
  if (typeof v !== "string") return "";
  const c = v.trim().toLowerCase();
  if (NOTE_COLOR_PRESETS.some((p) => p.id === c)) return c;
  return HEX_COLOR.test(c) ? c : "";
}

/** Tip and Info were tones before Icon: they become Icon notes that look
 *  the same. */
const OLD_TONES: Record<string, { icon: string; color: string }> = {
  tip: { icon: "lightbulb", color: "tip" },
  info: { icon: "info-circle", color: "info" },
};

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
  const old = typeof d.tone === "string" ? OLD_TONES[d.tone] : undefined;
  const icon = typeof d.icon === "string" && /^[a-z0-9-]+$/.test(d.icon) ? d.icon : old?.icon ?? base.icon;
  return {
    version: 1,
    tone: old ? "icon" : pick(d.tone, NOTE_TONES, base.tone),
    look: pick(d.look, NOTE_LOOKS, base.look),
    step,
    icon,
    text: withLegacyDoc(typeof d.text === "string" ? d.text : base.text, d.doc),
    color: noteColor(d.color) || old?.color || "",
  };
}

/** A saved `doc` field becomes a button link at the end of the text, where
 *  it used to be drawn. Saving the note then drops the field. */
function withLegacyDoc(text: string, doc: unknown): string {
  if (typeof doc !== "string" || !/^[a-z0-9-]+$/.test(doc)) return text;
  if (text.includes(`(docs:${doc})`)) return text;
  const link = legacyDocLink(doc);
  return text.trim() ? `${text.replace(/\s+$/, "")}\n\n${link}` : link;
}
