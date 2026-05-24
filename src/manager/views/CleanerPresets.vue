<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useCleanerPresetStore } from "../stores/cleanerPresetStore";

const store = useCleanerPresetStore();
const router = useRouter();

onMounted(() => {
  if (store.items.length === 0) store.fetchAll();
});

function openEditor(id: string): void {
  router.push({ name: "cleaner-presets-edit", params: { id } });
}
</script>

<template>
  <div class="wp-cleaner-presets">
    <header class="wp-cleaner-presets__head">
      <h1 class="wp-cleaner-presets__title">Cleaner presets</h1>
      <p class="wp-cleaner-presets__subtitle">
        Saved configurations for the WP_PromptCleaner node. Built-ins are read-only.
      </p>
    </header>

    <div v-if="store.loading" class="wp-cleaner-presets__dim">Loading…</div>
    <div v-else-if="store.error" class="wp-cleaner-presets__error">{{ store.error }}</div>
    <div v-else-if="store.items.length === 0" class="wp-cleaner-presets__empty">
      No presets yet.
    </div>
    <div v-else class="wp-cleaner-presets__list">
      <button
        v-for="preset in store.items"
        :key="preset.id"
        class="wp-cleaner-presets__row"
        :data-test="`preset-${preset.id}`"
        @click="openEditor(preset.id)"
      >
        <span class="wp-cleaner-presets__name">{{ preset.name }}</span>
        <span class="wp-cleaner-presets__intensity">{{ preset.payload.intensity }}</span>
        <span
          v-if="preset.is_builtin"
          data-test="builtin-badge"
          class="wp-cleaner-presets__badge"
        >built-in</span>
        <span v-else class="wp-cleaner-presets__badge-spacer" />
        <span class="wp-cleaner-presets__desc">{{ preset.description }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.wp-cleaner-presets { padding: 16px 20px; }
.wp-cleaner-presets__head { margin-bottom: 12px; }
.wp-cleaner-presets__title {
  font: 18px var(--wp-font-sans, ui-sans-serif);
  margin: 0 0 4px;
  color: var(--wp-text, #e5e5e5);
}
.wp-cleaner-presets__subtitle {
  font: 12px var(--wp-font-sans);
  color: var(--wp-text-dim, #888);
  margin: 0;
}
.wp-cleaner-presets__list {
  display: grid;
  gap: 2px;
  margin-top: 12px;
}
.wp-cleaner-presets__row {
  display: grid;
  grid-template-columns: 1fr auto auto 2fr;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--wp-border-soft, #2d2d2d);
  cursor: pointer;
  text-align: left;
  color: var(--wp-text, #e5e5e5);
}
.wp-cleaner-presets__row:hover {
  background: var(--wp-bg-hover, rgba(255, 255, 255, 0.04));
}
.wp-cleaner-presets__name { font: 13px var(--wp-font-sans); }
.wp-cleaner-presets__intensity {
  font: 11px var(--wp-font-mono, ui-monospace);
  color: var(--wp-text-muted, #a3a3a3);
}
.wp-cleaner-presets__badge {
  font: 9px var(--wp-font-mono);
  padding: 1px 6px;
  background: var(--wp-bg-deep, #161616);
  border: 1px solid var(--wp-border, #444);
  border-radius: 2px;
  color: var(--wp-text-dim, #888);
}
.wp-cleaner-presets__badge-spacer { width: 50px; }
.wp-cleaner-presets__desc {
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-dim, #888);
}
.wp-cleaner-presets__dim,
.wp-cleaner-presets__error,
.wp-cleaner-presets__empty {
  padding: 16px;
  color: var(--wp-text-dim, #888);
}
</style>
