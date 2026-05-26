<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../manager/api/client";
import type { TemplateRow } from "../../manager/api/types";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; pick: [TemplateRow] }>();

const rows = ref<TemplateRow[]>([]);
const q = ref("");
const loading = ref(false);

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return rows.value;
  return rows.value.filter((r) =>
    r.name.toLowerCase().includes(needle)
    || r.template_string.toLowerCase().includes(needle),
  );
});

watch(() => props.open, async (open) => {
  if (!open) return;
  q.value = "";
  loading.value = true;
  try {
    rows.value = (await api.templates.list({})).items;
  } catch {
    rows.value = [];
  } finally {
    loading.value = false;
  }
}, { immediate: true });

function pick(row: TemplateRow) {
  emit("pick", row);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <Transition name="wp-modal" appear>
      <div v-if="open" class="wp-ltm-overlay" @click="emit('close')">
        <div class="wp-ltm-modal" role="dialog" aria-modal="true" @click.stop>
          <h3 class="wp-ltm-title">Load template</h3>
          <input
            v-model="q"
            class="wp-ltm-search"
            type="text"
            placeholder="Search templates…"
            aria-label="Search templates"
          />
          <div class="wp-ltm-list">
            <div v-if="!loading && filtered.length === 0" class="wp-ltm-empty">
              No saved templates — use Save on an assembler to create one.
            </div>
            <button
              v-for="row in filtered"
              :key="row.id"
              type="button"
              class="wp-ltm-row"
              data-test="load-tpl-row"
              @click="pick(row)"
            >
              <span class="wp-ltm-name">{{ row.name }}</span>
              <span class="wp-ltm-preview" :title="row.template_string">
                {{ row.template_string || "(empty)" }}
              </span>
              <span v-if="row.tags.length" class="wp-ltm-tags">{{ row.tags.join(", ") }}</span>
            </button>
          </div>
          <div class="wp-ltm-actions">
            <button type="button" class="wp-btn wp-btn--ghost" @click="emit('close')">Cancel</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.wp-ltm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.wp-ltm-modal {
  background: var(--wp-bg-1, #1a1d24);
  border: 1px solid var(--wp-border, #353841);
  border-radius: var(--wp-radius-lg, 12px);
  padding: 16px;
  width: 460px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wp-ltm-title {
  margin: 0;
  font: 600 14px var(--wp-font-sans, sans-serif);
  color: var(--wp-text, #e6e6e6);
}
.wp-ltm-search {
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: var(--wp-radius, 8px);
  color: var(--wp-text, #e6e6e6);
  padding: 6px 8px;
}
.wp-ltm-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-ltm-empty {
  color: var(--wp-text-muted, #aeb1bb);
  font-size: 12px;
  padding: 16px;
  text-align: center;
}
.wp-ltm-row {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 6px;
  align-items: baseline;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--wp-radius, 8px);
  padding: 8px;
  cursor: pointer;
  color: var(--wp-text, #e6e6e6);
}
.wp-ltm-row:hover {
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border-color: var(--wp-border, #353841);
}
.wp-ltm-name { font: 600 13px var(--wp-font-sans, sans-serif); }
.wp-ltm-preview {
  font: 13px var(--wp-font-mono, monospace);
  color: var(--wp-text-muted, #aeb1bb);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-ltm-tags { grid-column: 1 / -1; font-size: 10px; color: var(--wp-text-muted, #aeb1bb); }
.wp-ltm-actions { display: flex; justify-content: flex-end; }
</style>
