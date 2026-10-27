/**
 * The component kit: every shared control, with where it lives and when to
 * use it. The kit page (`views/Kit.vue`, route `/kit`) draws one entry per
 * row here, and `__tests__/kit-coverage.test.ts` fails when a component in a
 * kit folder is neither listed here nor in `KIT_EXEMPT`.
 *
 * Reuse first: before writing a new control, find the entry that fits. Make a
 * new component only when none does, put it in a kit folder and add it here.
 *
 * Every user-facing string is in this file so the page is easy to translate.
 */

export type KitGroup = "actions" | "inputs" | "choice" | "display" | "feedback" | "overlays" | "pieces" | "brand";
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
  { id: "actions", label: "Actions", blurb: "Things you press." },
  { id: "inputs", label: "Inputs", blurb: "Things you type into or pick from a list." },
  { id: "choice", label: "Choices", blurb: "On or off, one of a few, which tab." },
  { id: "display", label: "Display", blurb: "Showing a thing: cards, chips, icons, empty pages." },
  { id: "feedback", label: "Feedback", blurb: "Telling the user what happened or that something is busy." },
  { id: "overlays", label: "Dialogs and menus", blurb: "Anything that opens above the page." },
  { id: "pieces", label: "Library pieces", blurb: "Bigger parts built from the kit that several screens share. Reuse them before writing another." },
  { id: "brand", label: "Brand", blurb: "The logo." },
];

export const KIT_ENTRIES: KitEntry[] = [
  // Actions
  {
    id: "button", name: "Button", group: "actions", file: "src/manager/components/ui/Button.vue", surfaces: ["manager"],
    use: "Every button in the manager. Primary for the one main action on a surface, secondary by default, ghost for quiet toolbar actions, danger for deletes, link for inline actions. Leave out the text for an icon button and give it an aria-label.",
    instead: "A <button> with its own class and colours.",
  },
  {
    id: "btn-css", name: "Button classes (.wp-btn)", group: "actions", file: "src/manager/styles/tokens.css", surfaces: ["manager", "canvas"],
    use: "The same look on a plain <button> where the Button component can't go: inside a canvas widget, or a router-link that must stay an <a>.",
  },
  // Inputs
  {
    id: "input", name: "Input", group: "inputs", file: "src/manager/components/ui/Input.vue", surfaces: ["manager"],
    use: "One-line text in the manager, with an optional icon or a fixed prefix (addon) like $ for variable names.",
    instead: "A bare <input> with its own border and focus ring.",
  },
  {
    id: "textarea", name: "Textarea", group: "inputs", file: "src/manager/components/ui/Textarea.vue", surfaces: ["manager"],
    use: "Several lines of plain text. Turn on autoResize when the box should grow with its text. Prompt text with $variables uses RichTextInput instead.",
  },
  {
    id: "field", name: "Field", group: "inputs", file: "src/manager/components/ui/Field.vue", surfaces: ["manager"],
    use: "A label, a hint and an error around any control, so they line up the same everywhere.",
    instead: "A <label> and a <p class=\"hint\"> written per form.",
  },
  {
    id: "select", name: "Select", group: "inputs", file: "src/manager/components/ui/Select.vue", surfaces: ["manager"],
    use: "Pick one value from a list in the manager. It filters as you type and can be cleared.",
    instead: "A native <select>, which can't be themed in the dark.",
  },
  {
    id: "wp-select", name: "WpSelect", group: "inputs", file: "src/components/shared/WpSelect.vue", surfaces: ["canvas", "manager"],
    use: "A small dropdown for canvas widgets and dense rows, where the manager's Select is too big.",
  },
  {
    id: "wp-number", name: "WpNumber", group: "inputs", file: "src/components/shared/WpNumber.vue", surfaces: ["canvas", "manager"],
    use: "Every number field. It has our up and down arrows, steps with the keys and the wheel, and clamps to min and max.",
    instead: "<input type=\"number\"> with the browser's spinner.",
  },
  {
    id: "list-filter", name: "ListFilter", group: "inputs", file: "src/manager/components/ui/ListFilter.vue", surfaces: ["manager"],
    use: "A filter box above a long list inside an editor card, with the \"3 of 12\" count. It hides itself while the list is short.",
    instead: "Another search box with its own icon and count.",
  },
  {
    id: "color-picker", name: "ColorPicker", group: "inputs", file: "src/manager/components/ColorPicker.vue", surfaces: ["manager"],
    use: "Pick a colour from presets or type a hex, as categories do.",
  },
  {
    id: "hsv-picker", name: "HsvPicker", group: "inputs", file: "src/components/shared/HsvPicker.vue", surfaces: ["canvas", "manager"],
    use: "A full colour square and hue bar, for when presets are not enough.",
  },
  // Choice
  {
    id: "checkbox", name: "Checkbox", group: "choice", file: "src/manager/components/ui/Checkbox.vue", surfaces: ["manager"],
    use: "Tick one item, or one row in a list. Supports a mixed state for \"some selected\".",
    instead: "<input type=\"checkbox\"> drawn by the browser.",
  },
  {
    id: "wp-check", name: "WpCheck", group: "choice", file: "src/components/shared/WpCheck.vue", surfaces: ["canvas", "manager"],
    use: "The checkbox for canvas widgets.",
  },
  {
    id: "toggle", name: "Toggle", group: "choice", file: "src/manager/components/ui/Toggle.vue", surfaces: ["manager"],
    use: "A setting that takes effect at once (on or off). Use a Checkbox when the choice is saved later with a button.",
  },
  {
    id: "radio", name: "Radio (.wp-radio)", group: "choice", file: "src/manager/styles/tokens.css", surfaces: ["manager"],
    use: "One of a few options that all need to be visible. A real radio input with the class wp-radio, so arrow keys work.",
  },
  {
    id: "tabs", name: "Tabs (.wp-tabs)", group: "choice", file: "src/manager/styles/tokens.css", surfaces: ["manager"],
    use: "Switch between views of the same thing. Buttons with role=\"tab\" and aria-selected inside a role=\"tablist\".",
    instead: "Another tab strip with its own underline.",
  },
  // Display
  {
    id: "card", name: "Card", group: "display", file: "src/manager/components/ui/Card.vue", surfaces: ["manager"],
    use: "A panel with an optional title row. Editors and settings are made of these.",
  },
  {
    id: "chip", name: "Chip", group: "display", file: "src/manager/components/ui/Chip.vue", surfaces: ["manager"],
    use: "A short label: a tag, a status, a count. Tones carry meaning (success, warn, danger, info); a colour prop tints it for a category or kind.",
  },
  {
    id: "category-chip", name: "CategoryChip", group: "display", file: "src/manager/components/CategoryChip.vue", surfaces: ["manager"],
    use: "A category with its own colour and icon.",
  },
  {
    id: "kbd", name: "Key (.wp-kbd)", group: "display", file: "src/manager/styles/tokens.css", surfaces: ["manager"],
    use: "A keyboard key in help text, like Ctrl K.",
  },
  {
    id: "icon", name: "Icon", group: "display", file: "src/manager/components/ui/Icon.vue", surfaces: ["manager"],
    use: "Every icon. Use the ICON_SM, ICON_MD and ICON_LG sizes. Icons are decoration: the button or text next to them carries the meaning.",
    instead: "An inline <svg> pasted into a component.",
  },
  {
    id: "empty-state", name: "EmptyState", group: "display", file: "src/manager/components/ui/EmptyState.vue", surfaces: ["manager"],
    use: "A page or list with nothing in it yet: say what goes here and offer the one action that fills it.",
  },
  // Feedback
  {
    id: "toast", name: "Toast (manager)", group: "feedback", file: "src/manager/composables/useToast.ts", surfaces: ["manager"],
    use: "A short note after an action, with an optional Undo. Call useToast().push(); the app shows it.",
  },
  {
    id: "canvas-toast", name: "Toast (canvas)", group: "feedback", file: "src/components/shared/toast-store.ts", surfaces: ["canvas"],
    use: "The same note from a canvas widget. Push to the shared toast store; never console.log a warning.",
  },
  {
    id: "loading-mark", name: "LoadingMark", group: "feedback", file: "src/components/shared/LoadingMark.vue", surfaces: ["manager", "canvas"],
    use: "Anything busy. Give it a label, or slot text for a \"Loading bundle…\" row; block fills an empty panel.",
    instead: "A spinner or plain \"Loading…\" text.",
  },
  {
    id: "ai-working", name: "AiWorking", group: "feedback", file: "src/manager/components/ai/AiWorking.vue", surfaces: ["manager"],
    use: "The \"the AI is working\" line: one of four animated sparkle marks (typing, shuffle, orbit, burst), a changing word and the time so far. Pass text for your own status, or leave it out to follow the AI request in flight.",
  },
  // Overlays
  {
    id: "modal", name: "Modal", group: "overlays", file: "src/manager/components/ui/Modal.vue", surfaces: ["manager"],
    use: "A dialog in the manager with a title, body and footer buttons.",
    instead: "A div with role=\"dialog\" and its own backdrop.",
  },
  {
    id: "drawer", name: "Drawer", group: "overlays", file: "src/manager/components/ui/Drawer.vue", surfaces: ["manager"],
    use: "A panel that slides in from the side: an inspector, history, settings beside the work. Escape closes it and focus goes back. Turn modal off to keep the page usable behind it.",
    instead: "Another fixed side panel with its own width, header and close button.",
  },
  {
    id: "popover", name: "Popover", group: "overlays", file: "src/components/shared/Popover.vue", surfaces: ["canvas", "manager"],
    use: "A panel anchored to a button: a colour picker, a filter, a small form. It flips to stay on screen, follows on scroll and closes on Escape or a click outside. Every floating panel builds on it.",
    instead: "A Teleport with its own placement maths and outside-click handler.",
  },
  {
    id: "dropdown-menu", name: "DropdownMenu", group: "overlays", file: "src/components/shared/DropdownMenu.vue", surfaces: ["canvas", "manager"],
    use: "A list of actions behind a button (the ⋯ menu, More, Add…). Arrows, Home/End and Enter work. Takes the same items as ContextMenu, so a row's right-click and ⋯ menus can share one list.",
    instead: "A hand-built menu of buttons under a ⋯ button.",
  },
  {
    id: "tooltip", name: "Tooltip (v-tooltip)", group: "overlays", file: "src/components/shared/tooltip.ts", surfaces: ["canvas", "manager"],
    use: "A short hint on hover and on keyboard focus. One attribute: v-tooltip=\"'Copy the prompt'\", or an object with a shortcut (kbd: 'Ctrl C'). Icon-only buttons still need an aria-label; the tooltip is for sighted mouse and keyboard users.",
    instead: "title=\"…\", which is slow, can't be styled, never shows from the keyboard and is cut off on the canvas.",
  },
  {
    id: "modal-shell", name: "ModalShell", group: "overlays", file: "src/components/shared/ModalShell.vue", surfaces: ["canvas", "manager"],
    use: "The backdrop, focus trap and Escape handling for a canvas dialog. Put the dialog's own frame inside.",
  },
  {
    id: "confirm-dialog", name: "ConfirmDialog", group: "overlays", file: "src/components/shared/ConfirmDialog.vue", surfaces: ["canvas", "manager"],
    use: "Ask before something that can't be undone. Name the action on the confirm button (Delete, not OK).",
  },
  {
    id: "context-menu", name: "ContextMenu", group: "overlays", file: "src/components/shared/ContextMenu.vue", surfaces: ["canvas", "manager"],
    use: "A right-click menu at the pointer: sections, icons, dividers, a danger item. It stays on screen near the edges. For a menu behind a button use DropdownMenu.",
    instead: "Another absolutely positioned list of buttons.",
  },
  // Library pieces
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
  {
    id: "relative-date", name: "RelativeDate", group: "pieces", file: "src/manager/components/RelativeDate.vue", surfaces: ["manager"],
    use: "\"5 min ago\" for a timestamp, with the full date on hover.",
  },
  {
    id: "icon-picker", name: "IconPicker", group: "pieces", file: "src/manager/components/IconPicker.vue", surfaces: ["manager"],
    use: "Pick an icon for a category or bundle from the curated set.",
  },
  // Brand
  {
    id: "logo", name: "Logo", group: "brand", file: "src/components/shared/Logo.vue", surfaces: ["manager", "canvas"],
    use: "The Wildcard Pipeline mark. Draw it at 16, 20, 28 or 40 px.",
  },
];

/**
 * Components in a kit folder that are not kit entries, and why. The coverage
 * test accepts these; everything else in a kit folder must be in KIT_ENTRIES.
 */
export const KIT_EXEMPT: Record<string, string> = {
  "src/manager/components/ui/ToastHost.vue": "Mounted once by the app; use useToast().",
  "src/components/shared/Toast.vue": "Mounted once by the canvas toast store; push to toast-store.",
  "src/components/shared/SeedListModal.vue": "The seed list dialog itself, not a building block.",
  "src/components/shared/SeedLockRow.vue": "One row of the seed list; only the seed widgets use it.",
  "src/components/shared/FrameChips.vue": "Loop frame chips; only the loop and seed widgets use them.",
};

/** The folders whose components must each be a kit entry or exempt. */
export const KIT_FOLDERS = ["src/manager/components/ui", "src/components/shared"];

/**
 * How to use each entry, shown under its demo. Code, so not translated.
 */
export const KIT_EXAMPLES: Record<string, string> = {
  "button": `<Button variant="primary" icon="pi-plus" @click="add">New module</Button>`,
  "btn-css": `<button class="wp-btn wp-btn--primary wp-btn--sm">Run</button>`,
  "input": `<Input v-model="name" addon="$" aria-label="Variable name" />`,
  "textarea": `<Textarea v-model="notes" :rows="3" auto-resize />`,
  "field": `<Field label="Name" hint="Shown in the library." for="name"><Input id="name" v-model="name" /></Field>`,
  "select": `<Select v-model="category" :options="options" clearable />`,
  "wp-select": `<WpSelect v-model="mode" :options="[{ value: 'hash', label: 'Hash' }]" aria-label="Strategy" />`,
  "wp-number": `<WpNumber v-model="count" :min="1" :max="64" aria-label="Count" />`,
  "list-filter": `<ListFilter v-model="query" :total="rows.length" :visible="shown.length" noun="rules" test-prefix="rules" />`,
  "color-picker": `<ColorPicker v-model="color" aria-label="Category colour" />`,
  "hsv-picker": `<HsvPicker v-model="color" aria-label="Colour" />`,
  "checkbox": `<Checkbox v-model="picked" label="Include in bundle" />`,
  "wp-check": `<WpCheck v-model="on" aria-label="Hold" />`,
  "toggle": `<Toggle v-model="enabled" label="Show tooltips" />`,
  "radio": `<label><input v-model="mode" type="radio" class="wp-radio" value="a"> Tags</label>`,
  "tabs": `<div class="wp-tabs" role="tablist"><button class="wp-tab" role="tab" :aria-selected="tab === 'a'" :data-active="tab === 'a'">Options</button></div>`,
  "card": `<Card title="Options" subtitle="12 options">…</Card>`,
  "chip": `<Chip tone="warn" icon="pi-exclamation-triangle">2 conflicts</Chip>`,
  "category-chip": `<CategoryChip name="Characters" color="#60a5fa" icon="pi-user" />`,
  "kbd": `<kbd class="wp-kbd">Ctrl</kbd> <kbd class="wp-kbd">K</kbd>`,
  "icon": `<Icon name="pi-bolt" :size="ICON_MD" />`,
  "empty-state": `<EmptyState icon="pi-inbox" headline="No bundles yet" body="…"><template #cta>…</template></EmptyState>`,
  "toast": `useToast().push({ severity: "success", summary: "Saved", action: { label: "Undo", run: undo } })`,
  "canvas-toast": `pushToast("Copied to the library", { severity: "success" })`,
  "loading-mark": `<LoadingMark block>Loading bundle…</LoadingMark>`,
  "ai-working": `<AiWorking text="Planning the pack" variant="orbit" />`,
  "modal": `<Modal v-model:open="open" title="Rename"><template #footer>…</template></Modal>`,
  "modal-shell": `<ModalShell :visible="open" @close="open = false"><div class="my-dialog">…</div></ModalShell>`,
  "confirm-dialog": `<ConfirmDialog :visible="ask" title="Delete Hair colour?" confirm-label="Delete" variant="danger" @confirm="del" @cancel="ask = false" />`,
  "context-menu": `<ContextMenu :visible="open" :x="ev.clientX" :y="ev.clientY" :items="items" @close="open = false" />`,
  "drawer": `<Drawer v-model:open="open" title="History" width="380px">…<template #footer>…</template></Drawer>`,
  "popover": `<Popover v-model:open="open" label="Colour"><template #trigger="{ props }"><Button v-bind="props">Colour</Button></template>…</Popover>`,
  "dropdown-menu": `<DropdownMenu :items="actions" label="Hair colour actions"><template #trigger="{ props }"><Button v-bind="props" variant="ghost" icon="pi-ellipsis-h" /></template></DropdownMenu>`,
  "tooltip": `<Button v-tooltip="{ text: 'Copy to clipboard', kbd: 'Ctrl C' }" variant="ghost" icon="pi-copy" aria-label="Copy" />`,
  "logo": `<Logo :size="28" />`,
  "rich-text": `<RichTextInput v-model="template" surface="assembler" multiline :var-suggestions="vars" />`,
  "negative-field": `<NegativeField v-model="option.negative" label="option" />`,
  "breadcrumb": `<Breadcrumb :items="[{ to: '/wildcards', label: 'Wildcards' }, { label: name }]" />`,
  "draft-banner": `<DraftBanner :has-draft="hasDraft" :age-ms="age" @restore="restore" @discard="discard" />`,
  "selection-toolbar": `<SelectionToolbar :count="selected.length" :tags="tags" @apply-tag="tag" @delete-selected="del" />`,
  "validity-icon": `<ValidityIcon :issues="validate(row)" />`,
  "relative-date": `<RelativeDate :value="row.updated_at" />`,
  "icon-picker": `<IconPicker v-model="icon" aria-label="Category icon" />`,
};

export function kitEntry(id: string): KitEntry {
  const e = KIT_ENTRIES.find((x) => x.id === id);
  if (!e) throw new Error(`No kit entry "${id}"`);
  return e;
}
