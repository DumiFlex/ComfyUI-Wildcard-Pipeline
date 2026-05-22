<script setup lang="ts">
/**
 * Import tab — v2 entry surface.
 *
 * Two paths for getting an export payload into the importer:
 *   1. File pick — hidden `<input type="file">` triggered by a button.
 *      Reads the file via `file.text()` and forwards into the parse
 *      pipeline.
 *   2. Clipboard paste — opens a textarea modal-style block. User
 *      pastes raw JSON, hits Parse, same pipeline.
 *
 * Both paths feed `parsePayload` (see ./parse.ts), which runs JSON
 * shape → migration chain → fingerprint integrity verify. On success
 * we emit `payload-ready` with the migrated payload, the total
 * migrated-entity count (for "migrated N entities from schema vN" UX),
 * and any integrity warnings (mismatched snapshot fingerprints).
 *
 * On parse failure we surface the reason inline. State is cleared
 * automatically when a subsequent parse attempt succeeds, so users
 * recover from a typo without manually dismissing anything.
 *
 * NOTE: This component uses plain `<button>` / `<input>` / `<textarea>`
 * elements rather than the project's `<Checkbox>` / `<Input>` wrappers
 * because the surface is small and the entry-point buttons need to
 * remain trivially queryable (`wrap.find("textarea")`, etc.) from the
 * test side. The styling matches the Card-less, low-chrome look used
 * by the rest of the import pane.
 */
import { ref } from "vue";
import { parsePayload, type IntegrityWarning } from "./parse";
import type { RawPayload } from "./migrations";

const emit = defineEmits<{
  (
    e: "payload-ready",
    payload: RawPayload,
    migratedCount: number,
    integrityWarnings: IntegrityWarning[],
  ): void;
}>();

const pasteOpen = ref<boolean>(false);
const pasteText = ref<string>("");
const errorMsg = ref<string>("");
const migrationNote = ref<string>("");
const fileInput = ref<HTMLInputElement | null>(null);

async function onFilePick(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    handleParse(text);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    // Reset the input value so picking the same file twice in a row
    // still fires a `change` event.
    if (fileInput.value) fileInput.value.value = "";
  }
}

function openPaste(): void {
  pasteOpen.value = true;
  pasteText.value = "";
  errorMsg.value = "";
  migrationNote.value = "";
}

function cancelPaste(): void {
  pasteOpen.value = false;
  pasteText.value = "";
}

function onPasteConfirm(): void {
  handleParse(pasteText.value);
}

function pickFile(): void {
  fileInput.value?.click();
}

function handleParse(raw: string): void {
  const result = parsePayload(raw);
  if (!result.ok) {
    errorMsg.value = result.reason;
    migrationNote.value = "";
    return;
  }
  errorMsg.value = "";
  pasteOpen.value = false;
  pasteText.value = "";

  // The payload always lands as CURRENT_SCHEMA_VERSION after parse,
  // so `migratedEntityCount > 0` is the signal that some migration
  // step actually ran. The note disappears on next successful parse
  // because we reset it here.
  if (result.migratedEntityCount > 0) {
    migrationNote.value =
      `Migrated ${result.migratedEntityCount} ${result.migratedEntityCount === 1 ? "entity" : "entities"} ` +
      `to schema version ${result.payload.schema_version}.`;
  } else {
    migrationNote.value = "";
  }

  emit("payload-ready", result.payload, result.migratedEntityCount, result.integrityWarnings);
}
</script>

<template>
  <div class="wp-import-tab" data-test="import-tab-v2">
    <p class="wp-import-tab__lead">
      Import a Wildcard Pipeline export file or paste an export payload below.
    </p>

    <div class="wp-import-tab__entry">
      <button
        type="button"
        class="wp-import-tab__btn wp-import-tab__btn--primary"
        data-test="import-file-btn"
        @click="pickFile"
      >Pick file…</button>
      <input
        ref="fileInput"
        type="file"
        accept=".json,application/json"
        class="wp-import-tab__file-hidden"
        aria-hidden="true"
        tabindex="-1"
        data-test="import-file-input"
        @change="onFilePick"
      />
      <button
        type="button"
        class="wp-import-tab__btn"
        data-test="import-paste-btn"
        @click="openPaste"
      >Paste JSON…</button>
    </div>

    <div
      v-if="pasteOpen"
      class="wp-import-tab__paste"
      data-test="import-paste-pane"
    >
      <label
        class="wp-import-tab__paste-label"
        for="wp-import-tab-paste-area"
      >
        <span class="wp-import-tab__paste-label-text">
          Paste an exported JSON payload
        </span>
        <textarea
          id="wp-import-tab-paste-area"
          v-model="pasteText"
          class="wp-import-tab__textarea"
          rows="10"
          placeholder="{ &quot;schema_version&quot;: 1, &quot;bundles&quot;: [], … }"
          data-test="import-paste-textarea"
        />
      </label>
      <div class="wp-import-tab__paste-actions">
        <button
          type="button"
          class="wp-import-tab__btn"
          data-test="import-paste-cancel"
          @click="cancelPaste"
        >Cancel</button>
        <button
          type="button"
          class="wp-import-tab__btn wp-import-tab__btn--primary"
          data-test="import-paste-confirm"
          @click="onPasteConfirm"
        >Parse</button>
      </div>
    </div>

    <div
      v-if="errorMsg"
      class="wp-import-tab__error"
      role="alert"
      data-test="import-tab-error"
    >Invalid payload — {{ errorMsg }}</div>

    <div
      v-if="migrationNote"
      class="wp-import-tab__note"
      data-test="import-tab-migration-note"
    >{{ migrationNote }}</div>
  </div>
</template>

<style scoped>
.wp-import-tab {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  padding: var(--wp-space-6);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
}

.wp-import-tab__lead {
  margin: 0;
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
}

.wp-import-tab__entry {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-5);
}

.wp-import-tab__btn {
  height: var(--wp-btn-h);
  padding: 0 var(--wp-space-6);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  font-size: var(--wp-text-base);
  font-weight: var(--wp-weight-medium);
  font-family: inherit;
  cursor: pointer;
  transition: background .12s, border-color .12s, color .12s;
}
.wp-import-tab__btn:hover {
  background: var(--wp-bg-4);
  border-color: var(--wp-border-strong);
}
.wp-import-tab__btn:focus-visible {
  outline: none;
  box-shadow: var(--wp-focus-ring);
}
.wp-import-tab__btn--primary {
  background: linear-gradient(180deg, var(--wp-accent-500), var(--wp-accent-600));
  border-color: var(--wp-accent-600);
  /* audit-exempt: white on saturated accent-500/600 gradient ≥4.5:1 both themes */
  color: #fff;
}
.wp-import-tab__btn--primary:hover {
  background: linear-gradient(180deg, var(--wp-accent-400), var(--wp-accent-500));
  border-color: var(--wp-accent-500);
}

.wp-import-tab__file-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.wp-import-tab__paste {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
  padding: var(--wp-space-5);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
}

.wp-import-tab__paste-label {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
}
.wp-import-tab__paste-label-text {
  font-size: var(--wp-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-muted);
  font-weight: var(--wp-weight-semibold);
}

.wp-import-tab__textarea {
  width: 100%;
  min-height: 160px;
  padding: var(--wp-space-4);
  background: var(--wp-bg-1);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-sm);
  line-height: var(--wp-line-sm);
  resize: vertical;
  outline: none;
  transition: border-color .12s, box-shadow .12s;
}
.wp-import-tab__textarea:focus-visible,
.wp-import-tab__textarea:focus {
  border-color: var(--wp-accent-500);
  box-shadow: var(--wp-focus-ring);
}

.wp-import-tab__paste-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--wp-space-4);
}

.wp-import-tab__error {
  padding: var(--wp-space-4) var(--wp-space-5);
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--wp-danger) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-danger) 36%, transparent);
  color: var(--wp-danger);
  font-size: var(--wp-text-sm);
}

.wp-import-tab__note {
  padding: var(--wp-space-4) var(--wp-space-5);
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--wp-warn) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 36%, transparent);
  color: var(--wp-warn);
  font-size: var(--wp-text-sm);
}
</style>
