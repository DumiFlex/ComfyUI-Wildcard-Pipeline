/**
 * The app pieces: parts built from the kit that call the extension's own
 * stores or API, so they live here instead of in wp-kit. The kit page
 * (`views/Kit.vue`, route `/kit`) draws one entry per row here, and
 * `__tests__/kit-coverage.test.ts` fails when a component in a kit folder is
 * neither listed here nor in `KIT_EXEMPT`. Every shared piece is on the
 * wp-kit site instead (`KIT_SITE` in config/links.ts).
 *
 * Reuse first: before writing a new control, find the kit piece or app piece
 * that fits. A new piece that only takes props and emits events goes into
 * wp-kit; one wired to the app's stores goes here, with its entry and demo.
 *
 * Every user-facing string is in this file so the page is easy to translate.
 */

export type KitGroup = "feedback" | "pieces";
export type KitSurface = "manager" | "canvas";

export interface KitEntry {
  /** Stable id: the `data-kit-entry` on the kit page. */
  id: string;
  name: string;
  group: KitGroup;
  /** Repo path of the component, or of the stylesheet for a CSS-only piece. */
  file: string;
  /** Where it works. A canvas piece can't use the manager's stylesheet. */
  surfaces: KitSurface[];
  /** When to reach for it. */
  use: string;
  /** What it replaces, so nobody builds that by hand again. */
  instead?: string;
}

export const KIT_GROUPS: { id: KitGroup; label: string; blurb: string }[] = [
  { id: "feedback", label: "Feedback", blurb: "Telling the user what happened or that something is busy." },
  { id: "pieces", label: "App pieces", blurb: "Bigger parts built from kit pieces that several screens share. Reuse them before writing another." },
];

export const KIT_ENTRIES: KitEntry[] = [
  // Feedback
  {
    id: "canvas-toast", name: "Toast (canvas)", group: "feedback", file: "src/components/shared/toast-store.ts", surfaces: ["canvas"],
    use: "The same note from a canvas widget. Push to the shared toast store; never console.log a warning.",
  },
  {
    id: "ai-working", name: "AiWorking", group: "feedback", file: "src/manager/components/ai/AiWorking.vue", surfaces: ["manager"],
    use: "The \"the AI is working\" line: one of four animated sparkle marks (typing, shuffle, orbit, burst), a changing word and the time so far. Pass text for your own status, or leave it out to follow the AI request in flight.",
  },
  // App pieces
  {
    id: "rich-text", name: "RichTextInput", group: "pieces", file: "src/manager/components/RichTextInput.vue", surfaces: ["manager"],
    use: "Prompt text: colours $variables, @{references}, {a|b} picks, LoRAs and #tags, and completes them as you type. Every template, combine and option text box uses it.",
    instead: "A Textarea for text that holds prompt syntax.",
  },
  {
    id: "negative-field", name: "NegativeField", group: "pieces", file: "src/manager/components/NegativeField.vue", surfaces: ["manager"],
    use: "The folded \"Negative\" box under an option, value or template. Opens when clicked or when it has text.",
  },
  {
    id: "breadcrumb", name: "Breadcrumb", group: "pieces", file: "src/manager/components/Breadcrumb.vue", surfaces: ["manager"],
    use: "The Library › Wildcards › Hair colour trail at the top of an editor.",
  },
  {
    id: "draft-banner", name: "DraftBanner", group: "pieces", file: "src/manager/components/DraftBanner.vue", surfaces: ["manager"],
    use: "Offer to restore unsaved changes found when an editor opens.",
  },
  {
    id: "selection-toolbar", name: "SelectionToolbar", group: "pieces", file: "src/manager/components/SelectionToolbar.vue", surfaces: ["manager"],
    use: "The bar that appears when rows are selected: tag, weight, negative, move and delete them together.",
  },
  {
    id: "validity-icon", name: "ValidityIcon", group: "pieces", file: "src/manager/components/ValidityIcon.vue", surfaces: ["manager"],
    use: "The check, warning or error mark in a list's Valid column, with the problems in its tooltip.",
  },
];

/**
 * Components in a kit folder that are not kit entries, and why. The coverage
 * test accepts these; everything else in a kit folder must be in KIT_ENTRIES.
 */
export const KIT_EXEMPT: Record<string, string> = {
  "src/components/shared/Toast.vue": "Mounted once by the canvas toast store; push to toast-store.",
  "src/components/shared/SeedListModal.vue": "The seed list dialog itself, not a building block.",
  "src/components/shared/SeedLockRow.vue": "One row of the seed list; only the seed widgets use it.",
  "src/components/shared/FrameChips.vue": "Loop frame chips; only the loop and seed widgets use them.",
};

/** The folders whose components must each be a kit entry or exempt. */
export const KIT_FOLDERS = ["src/components/shared"];

/**
 * How to use each entry, shown under its demo. Code, so not translated.
 */
export const KIT_EXAMPLES: Record<string, string> = {
  "canvas-toast": `pushToast("Copied to the library", { severity: "success" })`,
  "ai-working": `<AiWorking text="Planning the pack" variant="orbit" />`,
  "rich-text": `<RichTextInput v-model="template" surface="assembler" multiline :var-suggestions="vars" />`,
  "negative-field": `<NegativeField v-model="option.negative" label="option" />`,
  "breadcrumb": `<Breadcrumb :items="[{ to: '/wildcards', label: 'Wildcards' }, { label: name }]" />`,
  "draft-banner": `<DraftBanner :has-draft="hasDraft" :age-ms="age" @restore="restore" @discard="discard" />`,
  "selection-toolbar": `<SelectionToolbar :count="selected.length" :tags="tags" @apply-tag="tag" @delete-selected="del" />`,
  "validity-icon": `<ValidityIcon :issues="validate(row)" />`,
};

export function kitEntry(id: string): KitEntry {
  const e = KIT_ENTRIES.find((x) => x.id === id);
  if (!e) throw new Error(`No kit entry "${id}"`);
  return e;
}
