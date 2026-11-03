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
 * Negative (send-to-negative): an optional second field under Template,
 * same `$slot` grammar and scope. Stored as the row's `negative` (absent
 * when empty); it becomes the variable's negatives downstream.
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
import Kbd from "@/kit/Kbd.vue";
import Input from "@/kit/Input.vue";
import { computed, ref, watch } from "vue";
import type { InjectorRow } from "../../widgets/_shared";
import RichTextInput from "../../manager/components/RichTextInput.vue";
import Button from "@/kit/Button.vue";
import ListRow from "@/kit/ListRow.vue";
import ModalShell from "@/kit/ModalShell.vue";
import Popover from "@/kit/Popover.vue";

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
    /** GENERAL rows only: the reference tokens a template row can
     *  compose from — wired sockets (`input_N`) + socket-row bindings
     *  (`test`), in resolution order. Built by the widget
     *  (`generalRowReferences`). Becomes the insert-menu source and the
     *  preview's known-ref set. Ignored for socket rows. */
    references?: string[];
  }>(),
  { siblingRows: () => [], slotTypes: () => ({}), slotLabels: () => ({}), references: () => [] },
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

/** General (template) rows have no socket — header + insert menu +
 *  preview branch on this. */
const isGeneral = computed(() => props.row.kind === "general");

const rowTypeKey = computed(() =>
  (props.slotTypes[props.row.slot_name] ?? "").toLowerCase(),
);
const headerIcon = computed(() =>
  isGeneral.value ? "pi-bolt" : (TYPE_ICON[rowTypeKey.value] ?? "pi-circle"),
);
const headerColor = computed(() =>
  isGeneral.value ? "var(--wp-accent)" : (TYPE_COLOR[rowTypeKey.value] ?? "var(--wp-accent)"),
);
const headerType = computed(() => {
  if (isGeneral.value) return "Template";
  const k = rowTypeKey.value;
  return k ? k[0].toUpperCase() + k.slice(1) : "Input";
});
/** Identity label in the header. Socket rows show the slot they bind;
 *  general rows have no slot, so they read as "template row". */
const headerName = computed(() => (isGeneral.value ? "template row" : props.row.slot_name));

interface InsertOption {
  slotName: string;
  label: string;
  typeKey: string;
}
// Insert-menu source — diverges by row kind:
//   - SOCKET rows: a template wraps / transforms ITS OWN socket value
//     only. Top-to-bottom resolution means an early socket row can't
//     read a later socket, so the menu lists just this row's slot.
//     Cross-socket composition is what a GENERAL row (or Combine) is for.
//   - GENERAL rows: resolved in a second pass AFTER all socket rows, so
//     the template can compose from every wired socket (`$input_N`) AND
//     every socket-row binding (`$test`). Those names arrive via the
//     `references` prop (built by the widget) and become the menu.
const insertOptions = computed<InsertOption[]>(() => {
  if (isGeneral.value) {
    return props.references.map((ref) => ({
      slotName: ref,
      label: props.slotLabels[ref] ?? ref,
      typeKey: (props.slotTypes[ref] ?? "").toLowerCase(),
    }));
  }
  const tk = (props.slotTypes[props.row.slot_name] ?? "").toLowerCase();
  return [{
    slotName: props.row.slot_name,
    label: props.slotLabels[props.row.slot_name] ?? props.row.slot_name,
    typeKey: tk,
  }];
});

const showInsertMenu = ref(false);
/** Which field the "+ $slot" menu inserts into. Both fields share one
 *  teleported menu; it anchors to the button that opened it. */
const menuTarget = ref<"template" | "negative">("template");

// Draft buffer — mirrors the module InstanceModal pattern. Edits land
// here while the modal is open; only Save fires the `update` emit
// against the row. Cancel / Esc / overlay-click drop the draft. The
// `watch(row._uid)` resets the buffer when the modal is reopened on a
// different row without unmount/remount in between.
const draftBinding = ref<string>(props.row.binding);
const draftTemplate = ref<string>(props.row.template ?? "");
const draftNegative = ref<string>(props.row.negative ?? "");
watch(
  () => props.row._uid,
  () => {
    draftBinding.value = props.row.binding;
    draftTemplate.value = props.row.template ?? "";
    draftNegative.value = props.row.negative ?? "";
  },
);

const templateValue = computed(() => draftTemplate.value);

const isDirty = computed(() => {
  if (draftBinding.value !== props.row.binding) return true;
  if ((props.row.negative ?? "").trim() !== draftNegative.value.trim()) return true;
  const cur = (props.row.template ?? "").trim();
  const next = draftTemplate.value.trim();
  return cur !== next;
});

function onBindingInput(ev: Event): void {
  draftBinding.value = (ev.target as HTMLInputElement).value;
}

/**
 * The `$` pool for this modal, and ONLY this modal's refs.
 *
 * A socket row can reference just its own slot; the general row can reference
 * every socket. That is the same rule `insertOptions` already encodes for the
 * "+ $ref" menu, so the autocomplete and the menu cannot drift apart — they
 * read the same list. Deliberately not the library's variables: nothing here
 * can resolve one.
 */
const refSuggestionNames = computed(() => insertOptions.value.map((o) => o.slotName));

function onResetTemplate(): void {
  draftTemplate.value = "";
}

/**
 * The "+ $ref" menu still appends, but no longer reaches into a textarea's
 * selection to do it.
 *
 * RichTextInput owns its own caret — it is contenteditable with atom spans,
 * not a plain text box, so `selectionStart` does not exist and the old
 * splice-at-cursor path had nothing to splice into. Appending is honest about
 * what it does; the menu is now the fallback anyway, since typing `$` opens
 * the same list in place.
 */
function insertSlotRef(slotName: string): void {
  const target = menuTarget.value === "negative" ? draftNegative : draftTemplate;
  const current = target.value;
  const sep = current && !current.endsWith(" ") ? " " : "";
  closeInsertMenu();
  target.value = `${current}${sep}$${slotName}`;
}

function onSave(): void {
  // Whitespace-only template collapses to null so engine treats the
  // row as pass-through (same rule the engine + tokenizer agree on).
  const tpl = draftTemplate.value.trim() === "" ? null : draftTemplate.value;
  // An empty negative is stored ABSENT (the key drops out of the widget
  // JSON), never as "".
  const neg = draftNegative.value.trim() === "" ? undefined : draftNegative.value;
  emit("update", { binding: draftBinding.value, template: tpl, negative: neg });
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
function tokenize(s: string): PreviewToken[] {
  if (!s) return [];
  const knownSlots = new Set(insertOptions.value.map((o) => o.slotName));
  // Socket rows can always ref their own slot even before it's typed
  // into the menu; general rows have no slot (slot_name === ""), so the
  // known set is exactly the references list.
  if (!isGeneral.value) knownSlots.add(props.row.slot_name);
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
}

const previewTokens = computed<PreviewToken[]>(() => tokenize(templateValue.value));

/** Send-to-negative. */
const negativeValue = computed(() => draftNegative.value);
const negativeTokens = computed<PreviewToken[]>(() => tokenize(draftNegative.value.trim()));
/** The positive preview line: the template, or (a pass-through socket row)
 *  the socket value itself. */
const positivePreviewTokens = computed<PreviewToken[]>(() => {
  if (templateValue.value) return previewTokens.value;
  if (isGeneral.value) return [];
  return [{ kind: "ref", text: `$${props.row.slot_name}`, slotName: props.row.slot_name }];
});

const refCount = computed(() => previewTokens.value.filter((t) => t.kind === "ref").length);
const unknownRefCount = computed(() => previewTokens.value.filter((t) => t.kind === "ref-unknown").length);

// --- Insert menu ------------------------------------------------------
//
// One kit Popover serves both "+ $slot" buttons: it anchors to the one that
// opened it, places and flips itself, follows it on scroll and closes on
// Escape or a click outside (a click on its own button toggles it).
/** The two "+ $slot" kit Buttons; their root element anchors the menu. */
const menuBtnEl = ref<{ $el: HTMLElement } | null>(null);
const negMenuBtnEl = ref<{ $el: HTMLElement } | null>(null);
const menuAnchor = computed<HTMLElement | null>(() =>
  (menuTarget.value === "negative" ? negMenuBtnEl.value : menuBtnEl.value)?.$el ?? null);

function closeInsertMenu(): void {
  showInsertMenu.value = false;
}

function toggleInsertMenu(target: "template" | "negative" = "template"): void {
  if (showInsertMenu.value && menuTarget.value === target) {
    closeInsertMenu();
    return;
  }
  menuTarget.value = target;
  showInsertMenu.value = true;
}

// Esc or a backdrop click cancels (drops draft), Cmd/Ctrl+Enter saves.
// Mirrors the module InstanceModal keybinds so users carry one habit
// across both editors. ModalShell reports both as `close`; it closes the
// insert menu first, since losing the whole draft because a dropdown
// happened to be open is a nasty surprise.
function onShellClose(): void {
  if (showInsertMenu.value) {
    closeInsertMenu();
    return;
  }
  onCancel();
}
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    onSave();
  }
}
</script>

<template>
  <ModalShell :visible="true" labelledby="ibm-title" @close="onShellClose" @keydown="onKeydown">
    <div class="ibm" tabindex="-1">
      <header class="ibm__head" :style="{ '--ibm-accent': headerColor }">
        <i :class="['pi', headerIcon, 'ibm__head-icon']" aria-hidden="true" />
        <div class="ibm__title-block">
          <div class="ibm__title-row">
            <span id="ibm-title" class="ibm__name" data-test="ibm-name">{{ headerName }}</span>
            <span class="ibm__chip" data-test="ibm-chip">{{ headerType }}</span>
          </div>
          <div class="ibm__sub">Injector binding · ctx[$<wbr>{{ draftBinding || "…" }}] ← {{ templateValue ? "template" : isGeneral ? "no template yet" : "socket value" }}</div>
        </div>
        <Button variant="ghost" icon="times" aria-label="Close" size="sm" kbd="Esc" data-test="ibm-close" @click="onCancel" />
      </header>

      <section class="ibm__section">
        <div class="ibm__section-head">
          <span class="ibm__section-label">Binding</span>
          <span class="ibm__section-hint">variable name written to ctx</span>
        </div>
        <Input
          mono
          prefix="$"
          :tone="draftBinding.trim() ? undefined : 'warn'"
          data-test="ibm-binding"
          :model-value="draftBinding"
          :aria-label="isGeneral ? 'binding for template row' : `binding for ${row.slot_name}`"
          placeholder="variable_name"
          spellcheck="false"
          @input="onBindingInput"
        />
      </section>

      <section class="ibm__section">
        <div class="ibm__section-head">
          <span class="ibm__section-label">Template</span>
          <span class="ibm__section-hint">{{ isGeneral ? "$ref names · $$ for literal $ · composed after socket rows" : "$slot_name refs · $$ for literal $ · empty = pass-through" }}</span>
          <div class="ibm__head-actions">
            <Button
              v-if="insertOptions.length > 0"
              ref="menuBtnEl"
              size="sm"
              variant="outline"
              icon="pi-plus"
              class="wp-ibm__menu-btn"
              data-test="ibm-insert-slot"
              :title="`Insert a reference (${insertOptions.length} available)`"
              aria-label="Insert reference"
              aria-haspopup="listbox"
              :aria-expanded="showInsertMenu && menuTarget === 'template'"
              @click="toggleInsertMenu('template')"
            >{{ isGeneral ? "$ref" : "$slot" }}</Button>
            <!-- The insert menu, shared by this button and the Negative one. -->
            <Popover
              :open="showInsertMenu"
              :anchor="menuAnchor"
              placement="bottom-end"
              variant="menu"
              role="listbox"
              :max-height="220"
              label="Insert a reference"
              @update:open="(v: boolean) => (showInsertMenu = v)"
            >
              <div class="wp-ibm__menu" data-test="ibm-slot-menu" data-wp-rows>
                <ListRow
                  v-for="opt in insertOptions"
                  :key="opt.slotName"
                  size="sm"
                  class="wp-ibm__menu-item"
                  :data-test="`ibm-slot-item-${opt.slotName}`"
                  role="option"
                  :aria-selected="false"
                  @click="insertSlotRef(opt.slotName)"
                >
                  <span class="ibm__menu-name">${{ opt.slotName }}</span>
                  <span v-if="opt.label !== opt.slotName" class="ibm__menu-label">{{ opt.label }}</span>
                  <template v-if="opt.typeKey" #end><span class="ibm__menu-type">{{ opt.typeKey }}</span></template>
                </ListRow>
              </div>
            </Popover>
            <Button
              v-if="templateValue"
              size="sm"
              variant="outline"
              icon="pi-replay"
              data-test="ibm-template-reset"
              hint="Clear template (revert to pass-through)"
              aria-label="Clear template"
              @click="onResetTemplate"
            />
          </div>
        </div>

        <!-- RichTextInput rather than a bare <textarea>: the `$` handler it
             brings is exactly what this field needs, and the ref list feeding
             the "+ $ref" menu beside it was already the right suggestion pool
             — it simply had nothing to feed. `assembler` surface because this
             composes a template; it is NOT `wildcard`, which suppresses `$`
             on purpose. -->
        <RichTextInput
          class="ibm__template"
          :class="{ 'ibm__template--set': !!templateValue }"
          data-test="ibm-template"
          :model-value="templateValue"
          surface="assembler"
          multiline
          :rows="3"
          :var-suggestions="refSuggestionNames"
          :placeholder="isGeneral
            ? 'e.g. $input_0 by $test — composed after all socket rows'
            : 'e.g. i love $input_0 — leave empty to pass the raw socket value'"
          aria-label="Template"
          @update:model-value="(v: string) => (draftTemplate = v)"
        />

        <div v-if="templateValue" class="ibm__detected">
          <span class="ibm__detected-label">Detected</span>
          <span class="ibm__detected-summary" data-test="ibm-detected">
            {{ refCount }} refs<span v-if="unknownRefCount > 0"> · {{ unknownRefCount }} unknown</span>
          </span>
        </div>

      </section>

      <section class="ibm__section">
        <div class="ibm__section-head">
          <span class="ibm__section-label ibm__section-label--neg">Negative</span>
          <span class="ibm__section-hint">same {{ isGeneral ? "$ref" : "$slot" }} refs · replaces the variable's negatives</span>
          <div class="ibm__head-actions">
            <Button
              v-if="insertOptions.length > 0"
              ref="negMenuBtnEl"
              size="sm"
              variant="outline"
              icon="pi-plus"
              class="wp-ibm__menu-btn"
              data-test="ibm-neg-insert-slot"
              :title="`Insert a reference into the negative (${insertOptions.length} available)`"
              aria-label="Insert reference into the negative"
              aria-haspopup="listbox"
              :aria-expanded="showInsertMenu && menuTarget === 'negative'"
              @click="toggleInsertMenu('negative')"
            >{{ isGeneral ? "$ref" : "$slot" }}</Button>
          </div>
        </div>
        <RichTextInput
          class="ibm__template ibm__negative"
          :class="{ 'ibm__negative--set': !!negativeValue.trim() }"
          data-test="ibm-negative"
          :model-value="negativeValue"
          surface="assembler"
          multiline
          :rows="2"
          :var-suggestions="refSuggestionNames"
          :placeholder="isGeneral ? 'e.g. modern clothing, $input_0 smiling' : `e.g. modern clothing, $${row.slot_name} smiling`"
          aria-label="Negative"
          @update:model-value="(v: string) => (draftNegative = v)"
        />
        <p class="ibm__neg-note" :class="{ 'ibm__neg-note--warn': row.internal }" data-test="ibm-neg-note">
          <template v-if="row.internal">
            This variable is internal, so its negative won't reach any prompt.
          </template>
          <template v-else>
            Used only where an Assembler renders <span class="ibm__neg-var">${{ draftBinding || "…" }}</span>.
          </template>
        </p>

        <template v-if="templateValue || negativeValue.trim()">
          <div class="ibm__preview-label">PREVIEW</div>
          <div class="ibm__preview" data-test="ibm-preview">
            <div v-if="positivePreviewTokens.length" class="ibm__preview-line">
              <template v-for="(tok, i) in positivePreviewTokens" :key="i">
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
            <div v-if="negativeTokens.length" class="ibm__preview-line ibm__preview-line--neg" data-test="ibm-preview-neg">
              <span class="ibm__neg-dash" aria-hidden="true">− </span>
              <template v-for="(tok, i) in negativeTokens" :key="i">
                <span v-if="tok.kind === 'text'">{{ tok.text }}</span>
                <span v-else-if="tok.kind === 'escape'">$</span>
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
          </div>
        </template>
      </section>

      <footer class="ibm__foot">
        <span class="ibm__hint">
          <Kbd keys="Esc" size="sm" /> cancel · <Kbd keys="Mod+Enter" size="sm" /> save
        </span>
        <Button size="sm" data-test="ibm-cancel" @click="onCancel">Cancel</Button>
        <Button size="sm" variant="primary" :disabled="!isDirty" data-test="ibm-save" @click="onSave">Save</Button>
      </footer>
    </div>
  </ModalShell>
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
.ibm {
  width: 100%;
  max-width: 520px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius, 6px);
  box-shadow: var(--wp-shadow-lg);
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
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  background: color-mix(in srgb, var(--ibm-accent, var(--wp-accent)) 22%, transparent);
  color: var(--ibm-accent, var(--wp-accent));
}
.ibm__sub {
  font: 400 10px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
  margin-top: 2px;
}

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
  padding-left: 10px;
}
.ibm__menu-type {
  font: 600 9px var(--wp-font-sans);
  text-transform: lowercase;
  letter-spacing: 0.04em;
  padding: 1px 4px;
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  background: color-mix(in srgb, var(--wp-text3) 18%, transparent);
  color: var(--wp-text2);
  flex-shrink: 0;
  /* Right-align the type pill even on rows WITHOUT a label (the label
   * carries the `margin-left:auto` for labelled rows). When a label IS
   * present it precedes the type, so reset the auto there and let the
   * flex gap space them — keeping label + type grouped at the right. */
  margin-left: auto;
}
.ibm__menu-label + .ibm__menu-type { margin-left: 0; }

/* Reset button styling shared via _modal-template-ctrls.css. */

.ibm__template {
  width: 100%;
  box-sizing: border-box;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  padding: 6px 8px;
  font: 11px/1.5 var(--wp-font-mono);
  color: var(--wp-text);
  min-height: 56px;
  /* No `resize: vertical` here. This class is on the RichTextInput root, and
     the component carries its own drag grip — the native resizer put a second
     handle in the same corner. Left over from the <textarea> this replaced. */
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
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  padding: 8px 10px;
  font: 11px/1.5 var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 28px;
}
.ibm-tok--text { color: var(--wp-text); }

/* Send-to-negative field + preview line. */
.ibm__section-label--neg { color: var(--wp-danger); }
.ibm__negative { min-height: 40px; }
.ibm__negative--set {
  border-color: color-mix(in srgb, var(--wp-danger) 55%, var(--wp-border));
  background: color-mix(in srgb, var(--wp-danger) 7%, var(--wp-bg-deep, var(--wp-bg)));
}
.ibm__neg-note {
  margin: 6px 0 0;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.ibm__neg-note--warn { color: var(--wp-warn); }
.ibm__neg-var { font-family: var(--wp-font-mono); color: var(--wp-amber, var(--wp-accent)); }
.ibm__preview-line--neg { color: var(--wp-danger); }
.ibm__neg-dash { font-weight: 600; }
.ibm-tok--escape { color: var(--wp-text-dim, var(--wp-text3)); }
.ibm-tok--ref {
  color: var(--wp-accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--wp-accent) 12%, transparent);
  padding: 0 3px;
  border-radius: min(2px, var(--wp-radius-cap, 999px));
}
.ibm-tok--ref-unknown {
  color: var(--wp-status-modified);
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
</style>
