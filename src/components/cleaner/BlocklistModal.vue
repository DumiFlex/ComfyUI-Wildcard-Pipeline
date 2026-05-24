<script setup lang="ts">
/**
 * Body-teleported modal for the cleaner's blocklist. Mode toggle:
 *   - "list"  — comma- or newline-separated, exact tag match (case-insensitive)
 *   - "regex" — one regex per line, case-insensitive
 *
 * Edits are buffered in a local draft until the user clicks Save.
 * Cancel discards. Parent gates visibility via `visible`.
 */
import { ref, watch, computed } from "vue";
import ModalShell from "../shared/ModalShell.vue";
import type { BlocklistKind } from "./types";

const props = defineProps<{
  visible: boolean;
  modelValue: { kind: BlocklistKind; entries: string[] };
}>();
const emit = defineEmits<{
  "update:modelValue": [next: { kind: BlocklistKind; entries: string[] }];
  "close": [];
}>();

const draftKind = ref<BlocklistKind>(props.modelValue.kind);
const draftText = ref<string>(props.modelValue.entries.join(", "));

watch(() => props.visible, (vis) => {
  if (vis) {
    draftKind.value = props.modelValue.kind;
    draftText.value = props.modelValue.entries.join(", ");
  }
});

function parseEntries(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const parsed = computed(() => parseEntries(draftText.value));
const dedupedCount = computed(() => parsed.value.length - new Set(parsed.value).size);

function onSave(): void {
  const dedup = Array.from(new Set(parsed.value));
  emit("update:modelValue", { kind: draftKind.value, entries: dedup });
  emit("close");
}

function onCancel(): void {
  emit("close");
}
</script>

<template>
  <ModalShell :visible="visible" @close="onCancel">
    <div class="wp-blocklist">
      <header class="wp-blocklist__head">
        <span class="wp-blocklist__title">Blocklist</span>
      </header>
      <div class="wp-blocklist__mode-row">
        <span class="wp-blocklist__label">MODE</span>
        <div class="wp-blocklist__mode-group">
          <button
            data-test="blocklist-mode-list"
            :class="['wp-blocklist__mode-btn', { 'is-active': draftKind === 'list' }]"
            @click="draftKind = 'list'"
          >list (comma- or newline-separated)</button>
          <button
            data-test="blocklist-mode-regex"
            :class="['wp-blocklist__mode-btn', { 'is-active': draftKind === 'regex' }]"
            @click="draftKind = 'regex'"
          >regex (one per line)</button>
        </div>
      </div>
      <div class="wp-blocklist__body">
        <label for="blocklist-textarea" class="wp-blocklist__textarea-label">Entries</label>
        <textarea
          id="blocklist-textarea"
          data-test="blocklist-textarea"
          v-model="draftText"
          class="wp-blocklist__textarea"
          spellcheck="false"
        />
        <div class="wp-blocklist__hint">
          <span>{{ parsed.length }} entries</span>
          <span v-if="dedupedCount > 0">
            · {{ dedupedCount }} duplicate{{ dedupedCount === 1 ? '' : 's' }} auto-removed on save
          </span>
        </div>
      </div>
      <footer class="wp-blocklist__foot">
        <button
          data-test="blocklist-cancel"
          class="wp-blocklist__btn"
          @click="onCancel"
        >Cancel</button>
        <button
          data-test="blocklist-save"
          class="wp-blocklist__btn wp-blocklist__btn--primary"
          @click="onSave"
        >Save</button>
      </footer>
    </div>
  </ModalShell>
</template>

<style scoped>
.wp-blocklist {
  width: 440px;
  max-width: 90vw;
  background: var(--wp-bg, #1a1a1a);
  border: 1px solid var(--wp-border, #444);
  border-radius: 6px;
  color: var(--wp-text, #e5e5e5);
}
.wp-blocklist__head {
  padding: 10px 14px;
  border-bottom: 1px solid var(--wp-border-soft, #2d2d2d);
}
.wp-blocklist__title { font: 13px var(--wp-font-sans, ui-sans-serif); }
.wp-blocklist__mode-row {
  padding: 10px 14px;
  border-bottom: 1px solid var(--wp-border-soft, #2d2d2d);
  display: flex; align-items: center; gap: 8px;
  background: var(--wp-bg-deep, #161616);
}
.wp-blocklist__label {
  font: 9px var(--wp-font-mono, ui-monospace);
  letter-spacing: 0.12em;
  color: var(--wp-text-muted, #a3a3a3);
}
.wp-blocklist__mode-group {
  display: flex;
  flex: 1;
  background: var(--wp-bg-deepest, #0a0a0a);
  border-radius: 3px;
  padding: 2px;
  gap: 0;
}
.wp-blocklist__mode-btn {
  flex: 1;
  font: 10px var(--wp-font-mono);
  padding: 3px 10px;
  background: transparent;
  color: var(--wp-text-dim, #888);
  border: 0;
  border-radius: 2px;
  text-align: center;
  cursor: pointer;
}
.wp-blocklist__mode-btn.is-active { background: var(--wp-accent, #a855f7); color: #fff; }
.wp-blocklist__body { padding: 12px 14px; }
.wp-blocklist__textarea-label {
  display: block;
  font: 9px var(--wp-font-mono);
  letter-spacing: 0.12em;
  color: var(--wp-text-muted, #a3a3a3);
  margin-bottom: 4px;
}
.wp-blocklist__textarea {
  width: 100%;
  height: 120px;
  background: var(--wp-bg-deepest, #0a0a0a);
  color: var(--wp-text, #e5e5e5);
  border: 1px solid var(--wp-border-soft, #2d2d2d);
  border-radius: 3px;
  padding: 8px;
  font: 11px var(--wp-font-mono);
  resize: vertical;
  box-sizing: border-box;
  outline: none;
}
.wp-blocklist__hint {
  font: 9px var(--wp-font-mono);
  color: var(--wp-text-dim, #666);
  margin-top: 6px;
  display: flex;
  gap: 6px;
}
.wp-blocklist__foot {
  padding: 8px 14px 10px;
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  border-top: 1px solid var(--wp-border-soft, #2d2d2d);
}
.wp-blocklist__btn {
  font: 10px var(--wp-font-mono);
  padding: 5px 12px;
  background: transparent;
  color: var(--wp-text-dim, #888);
  border: 1px solid var(--wp-border, #444);
  border-radius: 3px;
  cursor: pointer;
}
.wp-blocklist__btn--primary {
  background: var(--wp-accent, #a855f7);
  color: #fff;
  border: 0;
}
</style>
