<script setup lang="ts">
import { computed } from "vue";
import {
  rowOverrideKind,
  type DraftRow,
  type LibraryRow,
} from "../defaults";
import { tokenize, type PreviewToken } from "../../_shared/preview-tokens";

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
  emit("update", props.row.id, { name: (ev.target as HTMLInputElement).value });
}
function onValueInput(ev: Event): void {
  emit("update", props.row.id, { value: (ev.target as HTMLInputElement).value });
}
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
        :class="{ 'row__value-wrap--mod': valueOverridden }"
        data-test="row-value-wrap"
      >
        <input
          class="row__value"
          data-test="row-value"
          type="text"
          :value="row.value"
          :disabled="!row.enabled"
          :aria-label="`Value for row ${row.id}`"
          @input="onValueInput"
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
