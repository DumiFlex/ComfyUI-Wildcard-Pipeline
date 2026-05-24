<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useCleanerPresetStore } from "../stores/cleanerPresetStore";
import CleanerWidget from "../../components/cleaner/CleanerWidget.vue";
import BlocklistModal from "../../components/cleaner/BlocklistModal.vue";
import type {
  CleanerPreset,
  CleanerPresetPayload,
} from "../api/types";

const props = defineProps<{ id: string }>();
const store = useCleanerPresetStore();
const router = useRouter();

const preset = ref<CleanerPreset | null>(null);
const draft = ref<{
  name: string;
  description: string;
  tags: string[];
  payload: CleanerPresetPayload;
} | null>(null);
const blocklistOpen = ref(false);
const saving = ref(false);
const saveError = ref<string | null>(null);

const isReadonly = computed(() => preset.value?.is_builtin === true);

onMounted(async () => {
  if (store.items.length === 0) await store.fetchAll();
  const row = store.findById(props.id);
  if (!row) {
    router.replace("/cleaner-presets");
    return;
  }
  preset.value = row;
  draft.value = {
    name: row.name,
    description: row.description,
    tags: [...row.tags],
    payload: JSON.parse(JSON.stringify(row.payload)),
  };
});

async function onSave(): Promise<void> {
  if (!draft.value || !preset.value || isReadonly.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    await store.update(preset.value.id, draft.value, { ifMatch: preset.value.version });
    router.push("/cleaner-presets");
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

function onCancel(): void {
  router.push("/cleaner-presets");
}

function onUpdateName(e: Event): void {
  if (!draft.value) return;
  draft.value.name = (e.target as HTMLInputElement).value;
}

function onUpdateDescription(e: Event): void {
  if (!draft.value) return;
  draft.value.description = (e.target as HTMLTextAreaElement).value;
}

function onUpdatePayload(next: CleanerPresetPayload): void {
  if (!draft.value) return;
  draft.value.payload = next;
}

function onUpdateBlocklist(next: { kind: "list" | "regex"; entries: string[] }): void {
  if (!draft.value) return;
  draft.value.payload = { ...draft.value.payload, blocklist: next };
}
</script>

<template>
  <div v-if="draft" class="wp-cleaner-editor">
    <header class="wp-cleaner-editor__head">
      <h1 class="wp-cleaner-editor__title">Edit preset</h1>
      <span v-if="isReadonly" class="wp-cleaner-editor__readonly">Built-in · read-only</span>
    </header>

    <label class="wp-cleaner-editor__field">
      <span class="wp-cleaner-editor__label">Name</span>
      <input
        data-test="preset-name"
        class="wp-cleaner-editor__input"
        :value="draft.name"
        :disabled="isReadonly"
        @input="onUpdateName"
      />
    </label>

    <label class="wp-cleaner-editor__field">
      <span class="wp-cleaner-editor__label">Description</span>
      <textarea
        data-test="preset-description"
        class="wp-cleaner-editor__textarea"
        :value="draft.description"
        :disabled="isReadonly"
        @input="onUpdateDescription"
      />
    </label>

    <div class="wp-cleaner-editor__widget">
      <CleanerWidget
        :model-value="draft.payload"
        :last-run-report="null"
        :word-count="0"
        :char-count="0"
        :clip-token-count="null"
        :clip-token-limit="77"
        @update:model-value="onUpdatePayload"
        @open-blocklist="blocklistOpen = true"
      />
    </div>

    <BlocklistModal
      :visible="blocklistOpen"
      :model-value="draft.payload.blocklist"
      @update:model-value="onUpdateBlocklist"
      @close="blocklistOpen = false"
    />

    <footer class="wp-cleaner-editor__foot">
      <span v-if="saveError" class="wp-cleaner-editor__err">{{ saveError }}</span>
      <button
        class="wp-cleaner-editor__btn"
        @click="onCancel"
      >Cancel</button>
      <button
        class="wp-cleaner-editor__btn wp-cleaner-editor__btn--primary"
        :disabled="isReadonly || saving"
        @click="onSave"
      >{{ saving ? 'Saving…' : 'Save' }}</button>
    </footer>
  </div>
</template>

<style scoped>
.wp-cleaner-editor { padding: 16px 20px; max-width: 640px; }
.wp-cleaner-editor__head {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 14px;
}
.wp-cleaner-editor__title {
  font: 18px var(--wp-font-sans, ui-sans-serif);
  margin: 0;
  color: var(--wp-text, #e5e5e5);
}
.wp-cleaner-editor__readonly {
  font: 9px var(--wp-font-mono, ui-monospace);
  padding: 2px 8px;
  background: var(--wp-bg-deep, #161616);
  border: 1px solid var(--wp-border, #444);
  border-radius: 2px;
  color: var(--wp-text-dim, #888);
}
.wp-cleaner-editor__field { display: block; margin-bottom: 12px; }
.wp-cleaner-editor__label {
  display: block;
  font: 10px var(--wp-font-mono);
  letter-spacing: 0.12em;
  color: var(--wp-text-muted, #a3a3a3);
  margin-bottom: 4px;
}
.wp-cleaner-editor__input,
.wp-cleaner-editor__textarea {
  width: 100%;
  background: var(--wp-bg-deepest, #0a0a0a);
  color: var(--wp-text, #e5e5e5);
  border: 1px solid var(--wp-border-soft, #2d2d2d);
  border-radius: 3px;
  padding: 6px 8px;
  font: 12px var(--wp-font-sans);
  box-sizing: border-box;
  outline: none;
}
.wp-cleaner-editor__textarea { min-height: 60px; resize: vertical; }
.wp-cleaner-editor__input:disabled,
.wp-cleaner-editor__textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wp-cleaner-editor__widget { margin: 16px 0; }
.wp-cleaner-editor__foot {
  display: flex; gap: 6px; justify-content: flex-end;
  align-items: center;
  margin-top: 14px;
}
.wp-cleaner-editor__err {
  flex: 1;
  font: 11px var(--wp-font-mono);
  color: var(--wp-status-error, #ef4444);
}
.wp-cleaner-editor__btn {
  font: 10px var(--wp-font-mono);
  padding: 5px 12px;
  background: transparent;
  color: var(--wp-text-dim, #888);
  border: 1px solid var(--wp-border, #444);
  border-radius: 3px;
  cursor: pointer;
}
.wp-cleaner-editor__btn--primary {
  background: var(--wp-accent, #a855f7);
  color: #fff;
  border: 0;
}
.wp-cleaner-editor__btn:disabled {
  opacity: 0.5; cursor: not-allowed;
}
</style>
