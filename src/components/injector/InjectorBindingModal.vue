<script setup lang="ts">
/**
 * InjectorBindingModal — per-row edit panel for an InjectorRow.
 *
 * Mirrors the ContextInstanceModal family (header + sections + footer
 * shell) so the editor reads as part of the same family. Two sections:
 *   - Identity   — binding variable name
 *   - Template   — optional transform string with `$<slot_name>` refs
 *                  + insert-slot dropdown (autofill on $).
 *
 * The template is OPTIONAL. When empty/null/whitespace, the engine
 * passes the raw socket value through to `ctx[binding]` as before.
 * When set, the engine substitutes each `$<slot_name>` ref with the
 * live value at that injector socket, then writes the resulting
 * string to `ctx[binding]`. This lets one row synthesize a derived
 * value from multiple input sockets without needing a separate
 * Combine module.
 *
 * Edits emit `update` with a `Partial<InjectorRow>` immediately —
 * there is no draft buffer, mirroring the lightweight per-row UX of
 * the inline row controls. Save = close.
 */
import { computed, ref, watch } from "vue";
import type { InjectorRow } from "../../widgets/_shared";

const props = withDefaults(
  defineProps<{
    row: InjectorRow;
    /** All sibling rows in this injector — populates the insert-slot
     *  dropdown so the user can `$input_N` any socket without
     *  remembering the slot names. The current row is excluded from
     *  the list (no self-reference). */
    siblingRows?: InjectorRow[];
    /** Per-slot type label keyed by slot_name. Drives the modal's
     *  header icon + the type tag next to each insert-slot entry. */
    slotTypes?: Record<string, string>;
    /** Per-slot user-customized label (e.g. renamed socket pins).
     *  Surfaces next to slot_name in the insert dropdown so the user
     *  picks by their own label. */
    slotLabels?: Record<string, string>;
  }>(),
  { siblingRows: () => [], slotTypes: () => ({}), slotLabels: () => ({}) },
);

const emit = defineEmits<{
  update: [patch: Partial<InjectorRow>];
  close: [];
}>();

const TYPE_ICON: Record<string, string> = {
  string: "pi-pencil",
  int: "pi-hashtag",
  float: "pi-percentage",
  boolean: "pi-check-square",
  image: "pi-image",
  mask: "pi-clone",
  latent: "pi-cloud",
  conditioning: "pi-comment",
  model: "pi-cube",
  clip: "pi-tag",
  vae: "pi-box",
  audio: "pi-volume-up",
  video: "pi-video",
  noise: "pi-sparkles",
  sigmas: "pi-chart-line",
  guider: "pi-compass",
  sampler: "pi-sliders-h",
};
const TYPE_COLOR: Record<string, string> = {
  string: "var(--wp-amber)",
  int: "var(--wp-green)",
  float: "var(--wp-var-7)",
  boolean: "var(--wp-var-5)",
  image: "var(--wp-var-1)",
  mask: "var(--wp-var-6)",
  latent: "var(--wp-var-4)",
  conditioning: "var(--wp-var-2)",
  model: "var(--wp-var-8)",
  clip: "var(--wp-var-3)",
  vae: "var(--wp-var-6)",
  audio: "var(--wp-var-7)",
  video: "var(--wp-var-4)",
  noise: "var(--wp-var-6)",
  sigmas: "var(--wp-var-1)",
  guider: "var(--wp-var-3)",
  sampler: "var(--wp-var-2)",
};

const rowTypeKey = computed(() =>
  (props.slotTypes[props.row.slot_name] ?? "").toLowerCase(),
);
const headerIcon = computed(() => TYPE_ICON[rowTypeKey.value] ?? "pi-circle");
const headerColor = computed(() => TYPE_COLOR[rowTypeKey.value] ?? "var(--wp-accent)");
const headerType = computed(() => {
  const k = rowTypeKey.value;
  return k ? k[0].toUpperCase() + k.slice(1) : "Input";
});

interface InsertOption {
  slotName: string;
  label: string;
  typeKey: string;
}
// Insert-slot dropdown source. Injector rows are independent — each
// row's template wraps / transforms ITS OWN socket value, never
// references other rows' sockets. So the dropdown lists only this
// row's slot_name. Cross-row references are intentionally out of
// scope: that's what a Combine module is for.
const insertOptions = computed<InsertOption[]>(() => {
  const tk = (props.slotTypes[props.row.slot_name] ?? "").toLowerCase();
  return [{
    slotName: props.row.slot_name,
    label: props.slotLabels[props.row.slot_name] ?? props.row.slot_name,
    typeKey: tk,
  }];
});

const taRef = ref<HTMLTextAreaElement | null>(null);
const showInsertMenu = ref(false);

// Draft buffer — mirrors the module InstanceModal pattern. Edits land
// here while the modal is open; only Save fires the `update` emit
// against the row. Cancel / Esc / overlay-click drop the draft. The
// `watch(row._uid)` resets the buffer when the modal is reopened on a
// different row without unmount/remount in between.
const draftBinding = ref<string>(props.row.binding);
const draftTemplate = ref<string>(props.row.template ?? "");
watch(
  () => props.row._uid,
  () => {
    draftBinding.value = props.row.binding;
    draftTemplate.value = props.row.template ?? "";
  },
);

const templateValue = computed(() => draftTemplate.value);

const isDirty = computed(() => {
  if (draftBinding.value !== props.row.binding) return true;
  const cur = (props.row.template ?? "").trim();
  const next = draftTemplate.value.trim();
  return cur !== next;
});

function onBindingInput(ev: Event): void {
  draftBinding.value = (ev.target as HTMLInputElement).value;
}

function onTemplateInput(ev: Event): void {
  draftTemplate.value = (ev.target as HTMLTextAreaElement).value;
}

function onResetTemplate(): void {
  draftTemplate.value = "";
}

function insertSlotRef(slotName: string): void {
  const ta = taRef.value;
  const insertion = `$${slotName}`;
  const current = templateValue.value;
  let next: string;
  if (ta && typeof ta.selectionStart === "number") {
    const start = ta.selectionStart;
    const end = ta.selectionEnd ?? start;
    next = current.slice(0, start) + insertion + current.slice(end);
    const caret = start + insertion.length;
    queueMicrotask(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  } else {
    next = current + insertion;
  }
  showInsertMenu.value = false;
  draftTemplate.value = next;
}

function onSave(): void {
  // Whitespace-only template collapses to null so engine treats the
  // row as pass-through (same rule the engine + tokenizer agree on).
  const tpl = draftTemplate.value.trim() === "" ? null : draftTemplate.value;
  emit("update", { binding: draftBinding.value, template: tpl });
  emit("close");
}

function onCancel(): void {
  emit("close");
}

interface PreviewToken {
  kind: "text" | "ref" | "escape" | "ref-unknown";
  text: string;
  slotName?: string;
}
const previewTokens = computed<PreviewToken[]>(() => {
  const s = templateValue.value;
  if (!s) return [];
  const knownSlots = new Set(insertOptions.value.map((o) => o.slotName));
  knownSlots.add(props.row.slot_name);
  const out: PreviewToken[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "$") {
      out.push({ kind: "escape", text: "$" });
      i += 2;
      continue;
    }
    if (s[i] === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(s.slice(i));
      if (m) {
        const slotName = m[1];
        out.push({
          kind: knownSlots.has(slotName) ? "ref" : "ref-unknown",
          text: m[0],
          slotName,
        });
        i += m[0].length;
        continue;
      }
      // Bare `$` not followed by a valid name char — emit a single
      // literal `$` and advance by one. Without this guard, the
      // fall-through `indexOf("$", i)` returns `i` (s[i] IS `$`),
      // yielding an empty slice + zero advance = infinite loop that
      // freezes the page the moment the user types `$`. Discovered
      // when the modal locked up on first keystroke during typing.
      out.push({ kind: "text", text: "$" });
      i += 1;
      continue;
    }
    const next = s.indexOf("$", i);
    const end = next === -1 ? s.length : next;
    out.push({ kind: "text", text: s.slice(i, end) });
    i = end;
  }
  return out;
});

const refCount = computed(() => previewTokens.value.filter((t) => t.kind === "ref").length);
const unknownRefCount = computed(() => previewTokens.value.filter((t) => t.kind === "ref-unknown").length);

function toggleInsertMenu(): void {
  showInsertMenu.value = !showInsertMenu.value;
}

// Esc cancels (drops draft), Cmd/Ctrl+Enter saves. Mirrors the
// module InstanceModal keybinds so users carry one habit across both
// editors. Bound to the overlay so it fires regardless of which inner
// field has focus — the overlay receives the keydown bubble.
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    onCancel();
    return;
  }
  if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    onSave();
  }
}
</script>

<template>
  <div
    class="ibm__overlay"
    data-test="ibm-overlay"
    @click.self="onCancel"
    @keydown="onKeydown"
  >
    <div class="ibm" role="dialog" aria-labelledby="ibm-title" tabindex="-1">
      <header class="ibm__head" :style="{ '--ibm-accent': headerColor }">
        <i :class="['pi', headerIcon, 'ibm__head-icon']" aria-hidden="true" />
        <div class="ibm__title-block">
          <div class="ibm__title-row">
            <span id="ibm-title" class="ibm__name" data-test="ibm-name">{{ row.slot_name }}</span>
            <span class="ibm__chip" data-test="ibm-chip">{{ headerType }}</span>
          </div>
          <div class="ibm__sub">Injector binding · ctx[$<wbr>{{ draftBinding || "…" }}] ← {{ templateValue ? "template" : "socket value" }}</div>
        </div>
        <button
          type="button"
          class="ibm__close"
          aria-label="Close"
          data-test="ibm-close"
          @click="onCancel"
        ><i class="pi pi-times" aria-hidden="true" /></button>
      </header>

      <section class="ibm__section">
        <div class="ibm__section-head">
          <span class="ibm__section-label">Binding</span>
          <span class="ibm__section-hint">variable name written to ctx</span>
        </div>
        <div class="ibm__binding-wrap" :class="{ 'ibm__binding-wrap--empty': !draftBinding.trim() }">
          <span class="ibm__binding-prefix">$</span>
          <input
            type="text"
            class="ibm__binding-input"
            data-test="ibm-binding"
            :value="draftBinding"
            :aria-label="`binding for ${row.slot_name}`"
            placeholder="variable_name"
            spellcheck="false"
            @input="onBindingInput"
          />
        </div>
      </section>

      <section class="ibm__section">
        <div class="ibm__section-head">
          <span class="ibm__section-label">Template</span>
          <span class="ibm__section-hint">$slot_name refs · $$ for literal $ · empty = pass-through</span>
          <div class="ibm__head-actions">
            <div class="ibm__menu-wrap">
              <button
                v-if="insertOptions.length > 0"
                type="button"
                class="ibm__menu-btn"
                data-test="ibm-insert-slot"
                :title="`Insert $slot_name (${insertOptions.length} available)`"
                aria-label="Insert slot reference"
                :aria-expanded="showInsertMenu"
                @click="toggleInsertMenu"
              ><i class="pi pi-plus" aria-hidden="true" /> $slot</button>
              <div
                v-if="showInsertMenu"
                class="ibm__menu"
                data-test="ibm-slot-menu"
                role="listbox"
              >
                <button
                  v-for="opt in insertOptions"
                  :key="opt.slotName"
                  type="button"
                  class="ibm__menu-item"
                  :data-test="`ibm-slot-item-${opt.slotName}`"
                  role="option"
                  :aria-selected="false"
                  @click="insertSlotRef(opt.slotName)"
                >
                  <span class="ibm__menu-name">${{ opt.slotName }}</span>
                  <span v-if="opt.label !== opt.slotName" class="ibm__menu-label">{{ opt.label }}</span>
                  <span v-if="opt.typeKey" class="ibm__menu-type">{{ opt.typeKey }}</span>
                </button>
              </div>
            </div>
            <button
              v-if="templateValue"
              type="button"
              class="ibm__reset"
              data-test="ibm-template-reset"
              title="Clear template (revert to pass-through)"
              aria-label="Clear template"
              @click="onResetTemplate"
            ><i class="pi pi-replay" aria-hidden="true" /></button>
          </div>
        </div>

        <textarea
          ref="taRef"
          class="ibm__template"
          :class="{ 'ibm__template--set': !!templateValue }"
          data-test="ibm-template"
          :value="templateValue"
          placeholder="e.g. i love $input_0 — leave empty to pass the raw socket value"
          aria-label="Template"
          rows="3"
          @input="onTemplateInput"
        />

        <div v-if="templateValue" class="ibm__detected">
          <span class="ibm__detected-label">Detected</span>
          <span class="ibm__detected-summary" data-test="ibm-detected">
            {{ refCount }} refs<span v-if="unknownRefCount > 0"> · {{ unknownRefCount }} unknown</span>
          </span>
        </div>

        <template v-if="templateValue">
          <div class="ibm__preview-label">PREVIEW</div>
          <div class="ibm__preview" data-test="ibm-preview">
            <template v-for="(tok, i) in previewTokens" :key="i">
              <span v-if="tok.kind === 'text'" class="ibm-tok--text">{{ tok.text }}</span>
              <span v-else-if="tok.kind === 'escape'" class="ibm-tok--escape">$</span>
              <span
                v-else-if="tok.kind === 'ref'"
                class="ibm-tok--ref"
                :title="`Substituted with the live value at socket ${tok.slotName}`"
              >{{ tok.text }}</span>
              <span
                v-else
                class="ibm-tok--ref-unknown"
                :title="`No row with slot_name '${tok.slotName}' — engine will leave the ref as literal text`"
              >{{ tok.text }}</span>
            </template>
          </div>
        </template>
      </section>

      <footer class="ibm__foot">
        <span class="ibm__hint">
          <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
        </span>
        <button
          type="button"
          class="ibm__btn"
          data-test="ibm-cancel"
          @click="onCancel"
        >Cancel</button>
        <button
          type="button"
          class="ibm__btn ibm__btn--primary"
          :disabled="!isDirty"
          data-test="ibm-save"
          @click="onSave"
        >Save</button>
      </footer>
    </div>
  </div>
</template>

<!-- Shared modal-template-controls partial — imported UNSCOPED so the
     class-namespaced rules (`.tpl__*`, `.ibm__*`) declare global
     selectors without `[data-v-…]` scoping attrs. When loaded via the
     scoped block below, Vue's scoper appended `[data-v-…]` to every
     rule, but inside a teleported modal (`<Teleport to="body">`) the
     `data-v-…` attribute application timing relative to mount was
     enough to leave the buttons visually misaligned in some cases.
     Unscoped import sidesteps the issue: namespaced classes are
     leak-free regardless. -->
<style>
@import "../context/editors/_modal-template-ctrls.css";
</style>

<style scoped>
@import "../shared/theme.css";

.ibm__overlay {
  position: fixed;
  inset: 0;
  z-index: 10010;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}
.ibm {
  width: 100%;
  max-width: 520px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius, 6px);
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
  overflow: hidden;
}

.ibm__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ibm-accent, var(--wp-accent)) 18%, var(--wp-bg2)) 0%,
    var(--wp-bg2) 100%
  );
  border-bottom: 1px solid var(--wp-border);
}
.ibm__head-icon {
  font-size: 18px;
  color: var(--ibm-accent, var(--wp-accent));
  width: 24px;
  text-align: center;
}
.ibm__title-block { flex: 1; min-width: 0; }
.ibm__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ibm__name {
  font: 600 13px var(--wp-font-sans);
  color: var(--wp-text);
}
.ibm__chip {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ibm-accent, var(--wp-accent)) 22%, transparent);
  color: var(--ibm-accent, var(--wp-accent));
}
.ibm__sub {
  font: 400 10px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
  margin-top: 2px;
}
.ibm__close {
  background: transparent;
  border: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 4px;
}
.ibm__close:hover { color: var(--wp-text); }
.ibm__close .pi { font-size: 12px; }

.ibm__section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.ibm__section:last-of-type { border-bottom: 0; }
.ibm__section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.ibm__section-label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.ibm__section-hint {
  font: 400 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.ibm__head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ibm__binding-wrap {
  display: flex;
  align-items: center;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  overflow: hidden;
}
.ibm__binding-wrap:focus-within { border-color: var(--wp-accent); }
.ibm__binding-wrap--empty { border-color: var(--wp-warn); }
.ibm__binding-prefix {
  font: 700 13px var(--wp-font-mono);
  color: var(--wp-accent);
  padding: 6px 8px;
  background: color-mix(in srgb, var(--wp-accent) 8%, transparent);
}
.ibm__binding-input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: none;
  font: 600 13px var(--wp-font-mono);
  color: var(--wp-text);
  padding: 6px 8px;
}
.ibm__binding-input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }

/* Insert-slot menu button + reset button + dropdown panel + items —
 * shared with Combine's TemplateSection via
 * src/components/context/editors/_modal-template-ctrls.css.
 * Modal-specific extras (menu-name, menu-label, menu-type pill)
 * stay below. */
.ibm__menu-name {
  font: 600 11px var(--wp-font-mono);
  color: var(--wp-text);
}
.ibm__menu-label {
  font: 400 10px var(--wp-font-sans);
  color: var(--wp-text2);
  margin-left: auto;
}
.ibm__menu-type {
  font: 600 9px var(--wp-font-sans);
  text-transform: lowercase;
  letter-spacing: 0.04em;
  padding: 1px 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--wp-text3) 18%, transparent);
  color: var(--wp-text2);
  flex-shrink: 0;
}

/* Reset button styling shared via _modal-template-ctrls.css. */

.ibm__template {
  width: 100%;
  box-sizing: border-box;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  padding: 6px 8px;
  font: 11px/1.5 var(--wp-font-mono);
  color: var(--wp-text);
  min-height: 56px;
  resize: vertical;
}
.ibm__template:focus { outline: none; border-color: var(--wp-accent); }
.ibm__template--set {
  border-color: var(--wp-accent);
}
.ibm__template::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }

.ibm__detected {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
}
.ibm__detected-label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.ibm__detected-summary {
  font: 11px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
}

.ibm__preview-label {
  margin-top: 10px;
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 4px;
}
.ibm__preview {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px dashed var(--wp-border);
  border-radius: 3px;
  padding: 8px 10px;
  font: 11px/1.5 var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 28px;
}
.ibm-tok--text { color: var(--wp-text); }
.ibm-tok--escape { color: var(--wp-text-dim, var(--wp-text3)); }
.ibm-tok--ref {
  color: var(--wp-accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--wp-accent) 12%, transparent);
  padding: 0 3px;
  border-radius: 2px;
}
.ibm-tok--ref-unknown {
  color: var(--wp-status-modified, #f59e0b);
  text-decoration: underline dashed;
  text-underline-offset: 2px;
  font-weight: 600;
}

.ibm__foot {
  padding: 10px 16px;
  border-top: 1px solid var(--wp-border-soft, var(--wp-border));
  display: flex;
  align-items: center;
  gap: 12px;
}
.ibm__hint {
  margin-right: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.ibm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.ibm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.ibm__btn:hover:not(:disabled) {
  border-color: var(--wp-accent);
  color: var(--wp-text);
}
.ibm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.ibm__btn--primary:hover:not(:disabled) {
  filter: brightness(1.1);
  color: white;
}
.ibm__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
