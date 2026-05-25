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
  width: 480px;
  max-width: 90vw;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius, 6px);
  color: var(--wp-text);
}
.wp-blocklist__head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--wp-border);
}
.wp-blocklist__title { font-size: 14px; font-weight: 600; }
.wp-blocklist__mode-row {
  padding: 10px 16px;
  border-bottom: 1px solid var(--wp-border);
  display: flex; align-items: center; gap: 10px;
  background: var(--wp-bg2, var(--wp-bg-2));
}
.wp-blocklist__label {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-blocklist__mode-group {
  display: flex;
  flex: 1;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
  padding: 2px;
  gap: 2px;
}
.wp-blocklist__mode-btn {
  flex: 1;
  font-size: 11px;
  padding: 4px 10px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  border: 0;
  border-radius: 3px;
  text-align: center;
  cursor: pointer;
}
.wp-blocklist__mode-btn:hover { color: var(--wp-text); }
.wp-blocklist__mode-btn.is-active {
  background: var(--wp-accent);
  color: #fff;
}
.wp-blocklist__body { padding: 12px 16px; }
.wp-blocklist__textarea-label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--wp-text-muted, var(--wp-text2));
  margin-bottom: 6px;
}
.wp-blocklist__textarea {
  width: 100%;
  height: 130px;
  background: var(--wp-bg2, var(--wp-bg-2));
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
  padding: 8px 10px;
  font-family: var(--wp-font-mono, ui-monospace, "JetBrains Mono", monospace);
  font-size: 12px;
  resize: vertical;
  box-sizing: border-box;
  outline: none;
}
.wp-blocklist__textarea:focus { border-color: var(--wp-accent); }
.wp-blocklist__hint {
  font-size: 10px;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-top: 6px;
  display: flex;
  gap: 6px;
}
.wp-blocklist__foot {
  padding: 10px 16px 12px;
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  border-top: 1px solid var(--wp-border);
}
.wp-blocklist__btn {
  font-size: 12px;
  padding: 6px 14px;
  background: transparent;
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
  cursor: pointer;
}
.wp-blocklist__btn:hover {
  border-color: var(--wp-border2, var(--wp-border-strong));
  background: var(--wp-bg2, var(--wp-bg-2));
}
.wp-blocklist__btn--primary {
  background: var(--wp-accent);
  color: #fff;
  border-color: var(--wp-accent);
}
.wp-blocklist__btn--primary:hover {
  background: var(--wp-accent2, var(--wp-accent-600, var(--wp-accent)));
  border-color: var(--wp-accent2, var(--wp-accent-600, var(--wp-accent)));
}
</style>
