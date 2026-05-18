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
import Breadcrumb from "./Breadcrumb.vue";
import type { BreadcrumbItem } from "./Breadcrumb.types";
import type { ModuleHistoryEntry } from "../api/types";

interface Props {
  title: string;
  subtitle?: string;
  backRoute: string;
  backLabel: string;
  saving?: boolean;
  saveDisabled?: boolean;
  historyEntries?: ModuleHistoryEntry[];
  /** Optional. When provided, renders a multi-segment Breadcrumb at
   *  the top instead of the single back link. */
  breadcrumb?: BreadcrumbItem[];
  /** When true, render an "Unsaved" chip and accent the Save button. */
  dirty?: boolean;
}

withDefaults(defineProps<Props>(), {
  saving: false,
  saveDisabled: false,
  historyEntries: () => [],
  dirty: false,
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
    <Breadcrumb v-if="breadcrumb && breadcrumb.length" :items="breadcrumb" />
    <RouterLink
      v-else
      :to="backRoute"
      class="wp-breadcrumb"
      data-test="editor-back"
    >
      <i class="pi pi-angle-left" /> {{ backLabel }}
    </RouterLink>

    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">
          {{ title }}
          <span v-if="dirty" class="wp-editor__dirty-chip" data-test="editor-dirty-chip">
            <span class="wp-editor__dirty-dot" aria-hidden="true" />
            Unsaved
          </span>
        </h1>
        <p v-if="subtitle" class="wp-page__subtitle">{{ subtitle }}</p>
      </div>
      <slot name="header-extra" />
    </div>

    <slot name="draft-banner" />

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
          :data-dirty="dirty || undefined"
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
  gap: var(--wp-space-6);
  /* Buffer so the last card clears the gradient + sticky footer top. */
  padding-bottom: var(--wp-space-7);
}
.wp-editor__dirty-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  margin-left: var(--wp-space-4);
  padding: 2px var(--wp-space-3);
  background: color-mix(in oklab, var(--wp-warn, #facc15) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn, #facc15) 32%, transparent);
  border-radius: 999px;
  font-size: var(--wp-text-xs);
  font-weight: 500;
  color: var(--wp-warn, #facc15);
  letter-spacing: 0.02em;
  text-transform: none;
  vertical-align: middle;
}
.wp-editor__dirty-dot {
  width: 6px; height: 6px;
  border-radius: 999px;
  background: currentColor;
}
.wp-draft-banner {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-5);
  background: color-mix(in oklab, var(--wp-info, var(--wp-accent-500)) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-info, var(--wp-accent-500)) 30%, transparent);
  border-radius: var(--wp-radius);
  font-size: var(--wp-text-sm);
  color: var(--wp-text);
}
.wp-draft-banner .pi { color: var(--wp-info, var(--wp-accent-500)); }

/* Footer-bar backdrop polish: solid colors don't read well when long-form
 * content peeks behind on scroll. Blur + a top-fade gradient give the bar
 * a soft floating feel without obscuring the cards above. */
.wp-footer-bar {
  position: relative;
  background: color-mix(in oklab, var(--wp-bg) 88%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-top: 1px solid var(--wp-border);
}
.wp-footer-bar::before {
  content: "";
  position: absolute;
  inset: -24px 0 100% 0;
  background: linear-gradient(to top, var(--wp-bg) 0%, transparent 100%);
  pointer-events: none;
}
</style>
