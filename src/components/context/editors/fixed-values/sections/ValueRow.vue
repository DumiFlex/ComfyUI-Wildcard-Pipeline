<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useGrowableField } from "../../../../shared/useGrowableField";
import {
  rowOverrideKind,
  type DraftRow,
  type LibraryRow,
} from "../defaults";
import { tokenize, type PreviewToken } from "../../_shared/preview-tokens";
import { stripNonIdentifierChars } from "../../../../../manager/utils/slug";

const props = defineProps<{
  row: DraftRow;
  library: LibraryRow | undefined;
}>();

// Per-row token preview — surface="fixed_values" gates VAR + REF as
// invalid (engine treats them the same: warn + render literal). The
// preview pane mirrors the engine's lenient semantics: alt + repeat +
// escape paint as valid colors; VAR + REF render with error class so
// the user spots the unsupported token before it ships.
const valueTokens = computed<PreviewToken[]>(() =>
  tokenize(props.row.value, "fixed_values"),
);
const hasNonTextToken = computed(() =>
  valueTokens.value.some((t) => t.kind !== "text"),
);

const emit = defineEmits<{
  "toggle": [rowId: string];
  "update": [rowId: string, patch: { name?: string; value?: string }];
  "reset": [rowId: string];
  "delete": [rowId: string];
}>();

const overrideKind = computed(() =>
  rowOverrideKind(
    props.library,
    { id: props.row.id, name: props.row.name, value: props.row.value },
  ),
);

const nameOverridden = computed(
  () => overrideKind.value === "name" || overrideKind.value === "both",
);
const valueOverridden = computed(
  () => overrideKind.value === "value" || overrideKind.value === "both",
);
const isAdded = computed(() => overrideKind.value === "added");
const showReset = computed(
  () => !isAdded.value && (nameOverridden.value || valueOverridden.value),
);

function onToggle(): void {
  emit("toggle", props.row.id);
}
function onNameInput(ev: Event): void {
  const el = ev.target as HTMLInputElement;
  // The name becomes a `$var` — strip non-identifier chars on keystroke +
  // force the DOM. The value field stays free-form (onValueInput unchanged).
  const name = stripNonIdentifierChars(el.value);
  if (el.value !== name) el.value = name;
  emit("update", props.row.id, { name });
}
function onValueInput(ev: Event): void {
  const el = ev.target as HTMLTextAreaElement;
  emit("update", props.row.id, { value: el.value });
  autosize();
  updateOverflowHint();
}

/** Grow the value field to fit its content, capped by the CSS `max-height`
 *  (after which it scrolls). The field is a `<textarea>` purely to get this
 *  wrapping + growth — users routinely paste an entire sentence into a fixed
 *  value and a single-line `<input>` showed a sliver of it with no way to see
 *  the rest. Semantics stay single-value; `onValueKeydown` blocks newlines. */
/* Auto-grow now lives in `useGrowableField` so it can YIELD to the drag
 * handle. The old local version wrote `height = scrollHeight` on every input
 * and every external value change, which stomped whatever height the user had
 * dragged to — collapse the box, type one character, and it sprang back open.
 * That is the "the drag sticks, then starts working" report. */

/* Enter inserts a newline, like any other textarea.
 *
 * It was briefly swallowed to preserve the behaviour of the single-line
 * `<input>` this replaced, but that was parity for its own sake: a fixed value
 * is an arbitrary string, the engine stores and emits it verbatim, and a
 * multi-line value round-trips fine. The modal saves on Cmd/Ctrl+Enter, so
 * plain Enter is free — and users writing paragraph-length values want their
 * line breaks. */

const valueEl = ref<HTMLTextAreaElement | null>(null);

/* Shared auto-grow + overflow-hint + grip-follow. See `useGrowableField` for
 * why the three belong together — chiefly that auto-grow has to yield to the
 * drag handle, which the local copy did not. */
const {
  hasMoreBelow,
  updateOverflowHint,
  scheduleOverflowHint,
  autosize,
  attach,
} = useGrowableField(() => valueEl.value);

/** True when the field is capped and still hiding content below the fold.
 *  Mirrors RichTextInput's hint — a capped box otherwise looks identical
 *  whether it holds its whole value or a third of it. A `<textarea>` can't
 *  carry a reliable `::after`, so the fade lives on `.row__value-wrap`. */





/* Size correctly on first paint + whenever the row's value changes from
   outside (reset-to-library, undo). */
watch(
  () => props.row.value,
  () => void nextTick(() => {
    autosize();
    scheduleOverflowHint();
  }),
  { immediate: true },
);


onMounted(() => {
  autosize();
  scheduleOverflowHint();
  attach();
});


function onReset(): void {
  emit("reset", props.row.id);
}
function onDelete(): void {
  emit("delete", props.row.id);
}
</script>

<template>
  <div
    class="row"
    :class="{
      'row--on': row.enabled,
      'row--off': !row.enabled,
      'row--added': isAdded,
    }"
  >
    <span
      class="row__check"
      :class="{ 'row__check--on': row.enabled }"
      data-test="row-check"
      role="checkbox"
      :aria-checked="row.enabled"
      tabindex="0"
      @click="onToggle"
      @keydown.space.prevent="onToggle"
    >
      <svg
        v-if="row.enabled"
        width="8"
        height="8"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path d="M2.5 6.5 L5 9 L9.5 3.5"
              fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>

    <span
      class="row__name-wrap"
      :class="{ 'row__name-wrap--mod': nameOverridden }"
      data-test="row-name-wrap"
    >
      <span class="row__name-prefix" data-test="row-name-prefix">$</span>
      <input
        class="row__name"
        data-test="row-name"
        type="text"
        :value="row.name"
        :disabled="!row.enabled"
        :aria-label="`Variable name for row ${row.id}`"
        @input="onNameInput"
      />
    </span>

    <span
      class="row__value-cell"
      :class="{ 'row__value-cell--mod': valueOverridden }"
      data-test="row-value-cell"
    >
      <span
        class="row__value-wrap"
        :class="{
          'row__value-wrap--mod': valueOverridden,
          'row__value-wrap--more': hasMoreBelow,
        }"
        data-test="row-value-wrap"
      >
        <textarea
          ref="valueEl"
          class="row__value"
          data-test="row-value"
          rows="1"
          spellcheck="false"
          :value="row.value"
          :disabled="!row.enabled"
          :aria-label="`Value for row ${row.id}`"
          @input="onValueInput"
          @scroll="updateOverflowHint"
        />
      </span>
      <span
        v-if="hasNonTextToken"
        class="row__value-preview"
        data-test="row-value-preview"
        aria-hidden="true"
      >
        <template v-for="(tok, i) in valueTokens" :key="i">
          <span v-if="tok.kind === 'text'" class="tpl-tok--text">{{ tok.raw }}</span>
          <span
            v-else-if="tok.kind === 'var' && tok.invalid"
            class="tpl-tok--var-error"
            :title="`$var refs not supported in fixed_values surface`"
          >{{ tok.raw }}</span>
          <span
            v-else-if="tok.kind === 'var'"
            class="tpl-tok--var"
          >{{ tok.raw }}</span>
          <span
            v-else-if="tok.kind === 'ref' && tok.invalid"
            class="tpl-tok--ref-error"
            :title="`@{uuid} refs not supported in fixed_values surface`"
          >{{ tok.raw }}</span>
          <span
            v-else-if="tok.kind === 'ref'"
            class="tpl-tok--ref"
          >{{ tok.raw }}</span>
          <span v-else-if="tok.kind === 'alt'" class="tpl-tok--alt">{{ tok.raw }}</span>
          <span v-else-if="tok.kind === 'repeat'" class="tpl-tok--repeat">{{ tok.raw }}</span>
          <span v-else-if="tok.kind === 'escape'" class="tpl-tok--escape">{{ tok.raw }}</span>
        </template>
      </span>
    </span>

    <button
      v-if="showReset"
      type="button"
      class="row__reset"
      data-test="row-reset"
      :aria-label="`Reset row $${library?.name ?? row.id} to library default`"
      title="Restore this row to library default"
      @click="onReset"
    ><i class="pi pi-replay" aria-hidden="true" /></button>
    <span v-else></span>

    <button
      v-if="isAdded"
      type="button"
      class="row__delete"
      data-test="row-delete"
      :aria-label="`Remove instance-only row $${row.name}`"
      title="Remove this instance-only row"
      @click="onDelete"
    ><i class="pi pi-times" aria-hidden="true" /></button>
    <span v-else></span>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 22px 180px 1fr 28px 28px;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
}
.row:last-child { border-bottom: none; }
.row:hover { background: var(--wp-row-hover, rgba(255, 255, 255, 0.02)); }
.row__check {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--wp-border-soft, var(--wp-border));
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  background: var(--wp-bg);
  cursor: pointer;
}
.row__check--on { background: var(--wp-accent); border-color: var(--wp-accent); }
.row__check svg { display: block; }

.row__name-wrap, .row__value-wrap {
  display: flex;
  align-items: stretch;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 2px;
  overflow: hidden;
}
.row__name-wrap:focus-within, .row__value-wrap:focus-within { border-color: var(--wp-accent); }
.row__name-wrap--mod, .row__value-wrap--mod { border-color: var(--wp-accent); }
.row__name-wrap--mod .row__name,
.row__name-wrap--mod .row__name-prefix,
.row__value-wrap--mod .row__value { color: var(--wp-accent-text, var(--wp-text)); }

.row__name-prefix {
  background: var(--wp-bg2);
  color: var(--wp-text-dim, var(--wp-text3));
  padding: 3px 6px;
  border-right: 1px solid var(--wp-border);
  font: 11px var(--wp-font-mono);
  display: flex;
  align-items: center;
}
.row__name, .row__value {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 3px 6px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
  min-width: 0;
}
.row__name:focus, .row__value:focus { outline: none; }

/* The value field is a <textarea> so a long value WRAPS and the box grows to
 * fit (height driven by `autosizeValue`). Capped so a pasted paragraph can't
 * push the rest of the modal off-screen; past the cap it scrolls. */
.row__value {
  /* Manual drag handle as well as the auto-grow, matching the derivation and
     combine template inputs — auto-sizing picks a sensible height, the handle
     lets the user override it. */
  resize: vertical; overscroll-behavior: contain;
  overflow-y: auto;
  max-height: 12rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--wp-font-mono);
}
/* The wrapper centred a single-line input; with a growing field the label
 * column should sit at the top instead of drifting down as it grows. */
.row__value-wrap { align-items: flex-start; position: relative; }

/* "More below" hint, matching RichTextInput. A <textarea> can't carry a
 * dependable `::after`, so it hangs off the wrapper. Gradient runs to a
 * TRANSPARENT accent so the text underneath still reads; the 1px accent line
 * at the bottom is what catches the eye. */
.row__value-wrap--more::after {
  content: "";
  position: absolute;
  /* Right edge stops short of the resize grip. The band is as tall as the
     handle and sat straight on top of it, so a resizable field's grip was
     invisible — users aimed, missed, re-grabbed. */
  inset: auto 16px 0 0;
  height: 14px;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in srgb, var(--wp-accent, #6366f1) 26%, transparent)
  );
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--wp-accent, #6366f1) 60%, transparent);
}

.row--off { color: var(--wp-text-dim, var(--wp-text3)); }
.row--off .row__name-wrap, .row--off .row__value-wrap { opacity: 0.5; }
.row--off .row__name, .row--off .row__value { text-decoration: line-through; }

.row--added .row__name-wrap, .row--added .row__value-wrap { border-color: var(--wp-green); }
.row--added .row__name,
.row--added .row__value,
.row--added .row__name-prefix { color: var(--wp-green); }

.row__reset, .row__delete {
  background: transparent;
  border: 1px solid transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
}
.row__reset:hover {
  border-color: var(--wp-border);
  color: var(--wp-accent-text, var(--wp-text));
  background: rgba(99, 102, 241, 0.10);
}
.row__delete:hover {
  border-color: var(--wp-border);
  color: var(--wp-status-modified, var(--wp-text));
  background: rgba(251, 146, 60, 0.10);
}
.row__reset .pi, .row__delete .pi { font-size: 10px; }

/* Per-row preview tokens — appears below the input only when the
 * value contains non-text tokens (alt/repeat/var/ref/escape). Mirrors
 * the engine's lenient surface: VAR + REF on fixed_values surface
 * render with error class so the user fixes them before queue time. */
.row__value-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.row__value-cell--mod .row__value-wrap { border-color: var(--wp-accent); }
.row__value-preview {
  margin-top: 3px;
  padding: 2px 6px;
  font: 10px/1.4 var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  border-left: 2px solid var(--wp-border-soft, var(--wp-border));
  background: var(--wp-bg-deep, var(--wp-bg));
  border-radius: 0 2px 2px 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.tpl-tok--text { color: var(--wp-text); }
.tpl-tok--var { font-weight: 600; }
.tpl-tok--var-error {
  color: var(--wp-danger, #e05252);
  text-decoration: underline dashed;
  text-underline-offset: 2px;
}
.tpl-tok--ref {
  color: var(--wp-accent);
  font-weight: 600;
}
.tpl-tok--ref-error {
  color: var(--wp-danger, #e05252);
  text-decoration: underline dashed;
  text-underline-offset: 2px;
}
.tpl-tok--alt {
  color: var(--wp-amber, #d4a04a);
  font-weight: 600;
}
.tpl-tok--repeat {
  color: var(--wp-teal, #4ad4c4);
  font-weight: 600;
}
.tpl-tok--escape {
  color: var(--wp-text-dim, var(--wp-text3));
}
</style>
