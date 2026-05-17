<script setup lang="ts">
/**
 * EditorFrame
 *
 * Shared scaffold for the six module editors (Wildcard / Fixed / Combine /
 * Derivation / Constraint / Pipeline). Mirrors the prototype's
 * `EditorFrame` in `screens/editors.jsx`:
 *
 *   - top breadcrumb back-link
 *   - header with title + optional subtitle + free-form `header-extra` slot
 *   - body slot (cards laid out by each editor)
 *   - sticky footer with optional History button (left), Cancel + Save (right)
 *   - HistoryPanel mounted lazily (only when entries exist + opened)
 *
 * Drops PrimeVue entirely — uses the wave-1 `ui/Button` primitive plus the
 * `wp-page__*`, `wp-breadcrumb`, `wp-card`, `wp-footer-bar` tokens that
 * already live in `tokens.css`.
 */
import { ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "./ui/Button.vue";
import HistoryPanel from "./HistoryPanel.vue";
import type { ModuleHistoryEntry } from "../api/types";

interface Props {
  title: string;
  subtitle?: string;
  backRoute: string;
  backLabel: string;
  saving?: boolean;
  saveDisabled?: boolean;
  historyEntries?: ModuleHistoryEntry[];
}

withDefaults(defineProps<Props>(), {
  saving: false,
  saveDisabled: false,
  historyEntries: () => [],
});

const emit = defineEmits<{
  (e: "save"): void;
  (e: "cancel"): void;
  (e: "restore", entry: ModuleHistoryEntry): void;
}>();

const historyOpen = ref(false);

function onCancel() { emit("cancel"); }
function onSave() { emit("save"); }
function onRestore(entry: ModuleHistoryEntry) {
  emit("restore", entry);
  historyOpen.value = false;
}
</script>

<template>
  <div class="wp-page wp-page--fill wp-editor">
    <RouterLink :to="backRoute" class="wp-breadcrumb" data-test="editor-back">
      <i class="pi pi-angle-left" /> {{ backLabel }}
    </RouterLink>

    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">{{ title }}</h1>
        <p v-if="subtitle" class="wp-page__subtitle">{{ subtitle }}</p>
      </div>
      <slot name="header-extra" />
    </div>

    <div class="wp-editor__body">
      <slot />
    </div>

    <div class="wp-footer-bar">
      <div class="wp-footer-bar__inner">
        <Button
          v-if="historyEntries && historyEntries.length"
          variant="ghost"
          icon="pi-history"
          data-test="history-btn"
          @click="historyOpen = true"
        >
          History ({{ historyEntries.length }})
        </Button>
        <slot name="footer-left" />
        <span class="wp-spacer" />
        <Button variant="secondary" data-test="cancel-btn" @click="onCancel">Cancel</Button>
        <Button
          variant="primary"
          icon="pi-check"
          :loading="saving"
          :disabled="saveDisabled"
          data-test="save-btn"
          @click="onSave"
        >Save</Button>
      </div>
    </div>

    <HistoryPanel
      :open="historyOpen"
      :entries="historyEntries ?? []"
      @update:open="(v) => (historyOpen = v)"
      @restore="onRestore"
    />
  </div>
</template>

<style scoped>
/* `.wp-page--fill` parent is height:100% with min-height:0; we make the
   body the scroll region so the sticky footer never overlaps content. */
.wp-editor {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6);
}
.wp-editor__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6); /* audit-exempt: was 14px; rounded to 16px */
  /* Buffer so the last card clears the gradient + sticky footer top. */
  padding-bottom: var(--wp-space-7);
}
</style>
