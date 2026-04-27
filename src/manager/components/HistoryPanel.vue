<script setup lang="ts">
/**
 * HistoryPanel
 *
 * Slide-out drawer that lists the last 3 saved snapshots of a module.
 * Each entry shows a relative timestamp, the snapshotted name, a JSON
 * preview of the snapshot's payload, and a "Restore" button.
 *
 * Click outside / Esc closes (handled by the local overlay click + window
 * keydown listener).
 *
 * The panel is layout-agnostic — it doesn't know what kind of module owns
 * the history; the parent editor wires `entries` and decides what to do
 * with the `restore` event.
 */
import { computed, onMounted, onBeforeUnmount, watch } from "vue";
import Button from "./ui/Button.vue";
import RelativeDate from "./RelativeDate.vue";
import type { ModuleHistoryEntry } from "../api/types";

const props = defineProps<{
  open: boolean;
  entries: ModuleHistoryEntry[];
}>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  (e: "restore", entry: ModuleHistoryEntry): void;
}>();

// Newest first — the sidecar stores oldest-first; reverse for display.
const ordered = computed<ModuleHistoryEntry[]>(() =>
  [...props.entries].reverse(),
);

function close(): void {
  emit("update:open", false);
}

function restore(entry: ModuleHistoryEntry): void {
  emit("restore", entry);
}

function previewJson(entry: ModuleHistoryEntry): string {
  return JSON.stringify(
    {
      name: entry.name,
      description: entry.description ?? "",
      category_id: entry.category_id ?? null,
      tags: entry.tags ?? [],
      payload: entry.payload,
    },
    null,
    2,
  );
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape" && props.open) close();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
});

// Keep body from scrolling under the open panel — small UX nicety.
watch(
  () => props.open,
  (next) => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = next ? "hidden" : "";
  },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="wp-history-overlay"
      data-test="history-overlay"
      @mousedown.self="close"
    >
      <aside
        class="wp-history-panel"
        role="dialog"
        aria-label="Version history"
        data-test="history-panel"
      >
        <header class="wp-history-panel__header">
          <div>
            <h3 class="wp-history-panel__title">Version history</h3>
            <p class="wp-history-panel__sub">
              Last {{ entries.length }} save{{ entries.length === 1 ? "" : "s" }} ·
              oldest is overwritten on save
            </p>
          </div>
          <Button
            icon="pi-times"
            variant="ghost"
            aria-label="Close history"
            data-test="history-close"
            @click="close"
          />
        </header>

        <div v-if="!ordered.length" class="wp-history-empty" data-test="history-empty">
          <i class="pi pi-history" />
          <p>No previous versions yet.</p>
          <p class="wp-history-empty__hint">
            Save a change to start tracking history.
          </p>
        </div>

        <div v-else class="wp-history-panel__body">
          <ol class="wp-history-list" data-test="history-list">
            <li
              v-for="(entry, idx) in ordered"
              :key="`${entry.saved_at}-${idx}`"
              class="wp-history-item"
              :data-test="`history-entry-${idx}`"
            >
              <div class="wp-history-item__head">
                <div>
                  <div class="wp-history-item__name">
                    {{ entry.name || "(untitled)" }}
                  </div>
                  <div class="wp-history-item__meta">
                    <RelativeDate :value="entry.saved_at" />
                    <span class="wp-history-item__sep">·</span>
                    <span :title="entry.saved_at">{{ entry.saved_at }}</span>
                  </div>
                </div>
                <Button
                  icon="pi-refresh"
                  variant="primary"
                  size="sm"
                  :data-test="`history-restore-${idx}`"
                  @click="restore(entry)"
                >Restore this version</Button>
              </div>
              <pre class="wp-history-item__json">{{ previewJson(entry) }}</pre>
            </li>
          </ol>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.wp-history-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: var(--wp-overlay-bg);
  display: flex;
  justify-content: flex-end;
}
.wp-history-panel {
  width: 480px;
  max-width: 100vw;
  background: var(--wp-bg);
  border-left: 1px solid var(--wp-border);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
}
.wp-history-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-bg-2);
}
.wp-history-panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--wp-text);
}
.wp-history-panel__sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--wp-text-muted);
}
.wp-history-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.wp-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wp-history-item {
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-2);
  padding: 10px 12px;
}
.wp-history-item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.wp-history-item__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--wp-text);
  word-break: break-word;
}
.wp-history-item__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--wp-text-muted);
  margin-top: 2px;
}
.wp-history-item__sep {
  color: var(--wp-text-dim, #6e6e7c);
}
.wp-history-item__json {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.4;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 4px;
  padding: 8px 10px;
  color: var(--wp-text);
  white-space: pre;
}
.wp-history-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px;
  color: var(--wp-text-muted);
}
.wp-history-empty i {
  font-size: 28px;
  color: var(--wp-text-dim, #6e6e7c);
  margin-bottom: 12px;
}
.wp-history-empty p {
  margin: 0;
  font-size: 13px;
}
.wp-history-empty__hint {
  margin-top: 4px !important;
  font-size: 12px;
  color: var(--wp-text-dim, #6e6e7c);
}
</style>
