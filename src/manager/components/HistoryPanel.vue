<script setup lang="ts">
/**
 * HistoryPanel
 *
 * Centered dialog with a master-detail two-pane layout:
 *   Left (240 px)  — clickable list of saved snapshots (newest first).
 *   Right (1fr)    — preview of the selected snapshot: date, name, raw JSON
 *                    and a "Restore this version" primary action.
 *
 * Click outside / Esc closes. Body scroll is locked while open.
 */
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
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

const selected = ref(0);

// Reset selection whenever the list changes (e.g., new save while panel is open).
watch(ordered, () => {
  selected.value = 0;
});

const currentEntry = computed(() =>
  ordered.value[selected.value] ?? null,
);

function close(): void {
  emit("update:open", false);
}

function restore(entry: ModuleHistoryEntry): void {
  emit("restore", entry);
}

function itemLabel(idx: number): string {
  return idx === 0 ? "Previous save" : `${idx + 1} saves ago`;
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

function snapshotDate(entry: ModuleHistoryEntry): string {
  try {
    return new Date(entry.saved_at).toLocaleString();
  } catch {
    return entry.saved_at;
  }
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

watch(
  () => props.open,
  (next) => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = next ? "hidden" : "";
    if (next) selected.value = 0;
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
      <div
        class="wp-history-panel"
        role="dialog"
        aria-label="Version history"
        data-test="history-panel"
      >
        <!-- Header -->
        <div class="wp-history-panel__header">
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
        </div>

        <!-- Empty state -->
        <div
          v-if="!ordered.length"
          class="wp-history-empty"
          data-test="history-empty"
        >
          <i class="pi pi-history" />
          <p>No previous versions yet.</p>
          <p class="wp-history-empty__hint">Save a change to start tracking history.</p>
        </div>

        <!-- Two-pane body -->
        <div v-else class="wp-history-panel__body">
          <!-- Left: list of snapshots -->
          <div class="wp-history-list" data-test="history-list">
            <button
              v-for="(entry, idx) in ordered"
              :key="`${entry.saved_at}-${idx}`"
              type="button"
              class="wp-history-item"
              :data-active="idx === selected ? 'true' : 'false'"
              :data-test="`history-entry-${idx}`"
              @click="selected = idx"
            >
              <div class="wp-history-item__top">
                <span class="wp-history-item__label">{{ itemLabel(idx) }}</span>
                <span class="wp-history-item__time">
                  <RelativeDate :value="entry.saved_at" />
                </span>
              </div>
              <div class="wp-history-item__name">{{ entry.name || "(untitled)" }}</div>
            </button>
          </div>

          <!-- Right: preview pane -->
          <div class="wp-history-preview">
            <template v-if="currentEntry">
              <div class="wp-history-preview__head">
                <div>
                  <div class="wp-history-preview__snapshot-label">
                    Snapshot · {{ snapshotDate(currentEntry) }}
                  </div>
                  <div class="wp-history-preview__name">
                    {{ currentEntry.name || "Untitled" }}
                  </div>
                </div>
                <Button
                  variant="primary"
                  icon="pi-refresh"
                  :data-test="`history-restore-${selected}`"
                  @click="restore(currentEntry)"
                >Restore this version</Button>
              </div>
              <pre class="wp-history-preview__json">{{ previewJson(currentEntry) }}</pre>
            </template>
            <div v-else class="wp-dim wp-history-preview__placeholder">
              Select a snapshot to preview.
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wp-history-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: wp-history-fade-in 0.15s ease-out;
}
@keyframes wp-history-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.wp-history-panel {
  width: min(880px, 100%);
  max-height: min(640px, calc(100vh - 48px));
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg, 10px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--wp-shadow-lg);
}

.wp-history-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wp-border);
  flex-shrink: 0;
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

/* Two-pane grid body */
.wp-history-panel__body {
  display: grid;
  grid-template-columns: 240px 1fr;
  flex: 1;
  min-height: 0;
}

/* Left column — snapshot list */
.wp-history-list {
  border-right: 1px solid var(--wp-border);
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wp-history-item {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--wp-text);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.wp-history-item:hover {
  background: var(--wp-bg-3);
}
.wp-history-item[data-active="true"] {
  background: rgba(124, 58, 237, 0.20);
  background: color-mix(in oklab, var(--wp-accent-600) 20%, transparent);
  border-color: rgba(139, 92, 246, 0.50);
  border-color: color-mix(in oklab, var(--wp-accent-500) 50%, transparent);
}
.wp-history-item__top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11.5px;
  color: var(--wp-text-muted);
  margin-bottom: 4px;
}
.wp-history-item__label {
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
.wp-history-item__time {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
}
.wp-history-item__name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Right column — preview pane */
.wp-history-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.wp-history-preview__head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--wp-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.wp-history-preview__snapshot-label {
  font-size: 11px;
  color: var(--wp-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.wp-history-preview__name {
  font-size: 14px;
  font-weight: 600;
  margin-top: 2px;
  color: var(--wp-text);
}
.wp-history-preview__json {
  flex: 1;
  margin: 0;
  padding: 14px 16px;
  overflow: auto;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--wp-text-muted);
  background: var(--wp-bg);
  white-space: pre-wrap;
  word-break: break-word;
}
.wp-history-preview__placeholder {
  padding: 24px;
  font-size: 13px;
}

/* Empty state */
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
