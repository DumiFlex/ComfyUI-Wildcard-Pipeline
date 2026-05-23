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
import { computed, ref } from "vue";
import { parsePayload, type IntegrityWarning } from "./parse";
import type { RawPayload } from "./migrations";

interface Props {
  /**
   * When `true`, ImportTab renders a compact one-line "loaded" bar
   * (file source label + entity count + Replace file button) instead of
   * the full file-pick + paste UI. Driven by the parent — set to true
   * once `payload-ready` has fired and the picker is visible.
   *
   * Defaults to `false` for backward compatibility (legacy mounts that
   * never set the prop keep showing the full UI forever).
   */
  payloadLoaded?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  payloadLoaded: false,
});

const emit = defineEmits<{
  (
    e: "payload-ready",
    payload: RawPayload,
    migratedCount: number,
    integrityWarnings: IntegrityWarning[],
  ): void;
  /**
   * Emitted from the compact-mode "Replace file…" button — the parent
   * clears its picker state so ImportTab returns to the full UI on the
   * next render (its own `payloadLoaded` prop flips back to false).
   */
  (e: "replace-requested"): void;
}>();

const pasteOpen = ref<boolean>(false);
const pasteText = ref<string>("");
const errorMsg = ref<string>("");
const migrationNote = ref<string>("");
const fileInput = ref<HTMLInputElement | null>(null);

/**
 * Tracks which entry path produced the last successful parse so the
 * compact bar can label the source ("From file" / "From paste").
 * Reset to `null` on every fresh entry so the bar never shows a stale
 * source for a payload that the parent forgot to clear.
 */
const lastSource = ref<"file" | "paste" | null>(null);

/**
 * Total entity count of the last successfully-parsed payload. Mirrors
 * the seven-bucket sum the picker shows, so the compact bar agrees with
 * the picker header. Reset on every fresh entry.
 */
const lastEntityCount = ref<number>(0);

const fileSourceLabel = computed<string>(() =>
  lastSource.value === "paste" ? "From paste" : "From file",
);

async function onFilePick(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    handleParse(text, "file");
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
  handleParse(pasteText.value, "paste");
}

function pickFile(): void {
  fileInput.value?.click();
}

/**
 * Triggered from the compact-bar "Replace file…" button. Wipes the
 * local UI state (paste text/error/note) and notifies the parent so it
 * can clear its picker state — the next render flips `payloadLoaded`
 * back to false and the full pick UI returns.
 */
function onReplaceFile(): void {
  pasteOpen.value = false;
  pasteText.value = "";
  errorMsg.value = "";
  migrationNote.value = "";
  lastSource.value = null;
  lastEntityCount.value = 0;
  emit("replace-requested");
}

/**
 * Sum of all seven entity buckets on a freshly-parsed payload. Used to
 * populate the compact-bar entity count so it agrees with the picker
 * header. `RawPayload`'s buckets all default to empty arrays after
 * migration so the iteration is safe even on minimal payloads.
 */
function payloadEntityCount(payload: RawPayload): number {
  return (
    payload.bundles.length
    + payload.wildcards.length
    + payload.fixed_values.length
    + payload.combines.length
    + payload.derivations.length
    + payload.constraints.length
    + payload.categories.length
  );
}

function handleParse(raw: string, source: "file" | "paste"): void {
  const result = parsePayload(raw);
  if (!result.ok) {
    errorMsg.value = result.reason;
    migrationNote.value = "";
    return;
  }
  errorMsg.value = "";
  pasteOpen.value = false;
  pasteText.value = "";
  lastSource.value = source;
  lastEntityCount.value = payloadEntityCount(result.payload);

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
    <!-- Compact "loaded" bar: rendered when the parent flags the payload
         as accepted AND we have a recorded source. Replaces the full
         file-pick + paste UI so the picker can sit closer to the top.
         Migration note still surfaces below so a v0→v1 conversion is
         visible to the user. -->
    <template v-if="props.payloadLoaded && lastSource !== null">
      <div class="wp-import-tab__loaded" data-test="import-tab-loaded">
        <i
          class="pi pi-check-circle wp-import-tab__loaded-icon"
          aria-hidden="true"
        />
        <span class="wp-import-tab__loaded-text">
          Loaded
          <span class="wp-import-tab__loaded-source">{{ fileSourceLabel }}</span>
          <span class="wp-import-tab__loaded-sep">·</span>
          <span class="wp-import-tab__loaded-count">
            {{ lastEntityCount }}
            {{ lastEntityCount === 1 ? "entity" : "entities" }}
          </span>
        </span>
        <button
          type="button"
          class="wp-import-tab__btn wp-import-tab__btn--ghost"
          data-test="import-tab-replace"
          @click="onReplaceFile"
        >Replace file…</button>
      </div>
      <div
        v-if="migrationNote"
        class="wp-import-tab__note"
        data-test="import-tab-migration-note"
      >{{ migrationNote }}</div>
    </template>

    <!-- Default (full) UI — pick / paste affordances, paste pane,
         inline error / migration note. Used until the parent flips
         `payloadLoaded` to true. -->
    <template v-else>
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
    </template>
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
/* Ghost variant — used by the compact-mode Replace file button. Lower
 * visual weight than the primary so the loaded-state bar stays calm. */
.wp-import-tab__btn--ghost {
  background: transparent;
  border-color: var(--wp-border);
  color: var(--wp-text-muted);
}
.wp-import-tab__btn--ghost:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border-color: var(--wp-border-strong);
}

/* Compact "loaded" bar — single-row drop-in for the full pick UI once
 * the parent flips `payloadLoaded` to true. Matches the same chrome as
 * the rest of the import pane (wp-bg-2 fill, hairline border, radius)
 * so it slots in without visual seam. */
.wp-import-tab__loaded {
  display: flex;
  align-items: center;
  gap: var(--wp-space-5);
  padding: var(--wp-space-4) var(--wp-space-6);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  font-size: var(--wp-text-sm);
}
.wp-import-tab__loaded-icon {
  font-size: var(--wp-text-md);
  color: var(--wp-success);
  flex-shrink: 0;
}
.wp-import-tab__loaded-text {
  flex: 1;
  display: inline-flex;
  align-items: baseline;
  gap: var(--wp-space-3);
  color: var(--wp-text);
  min-width: 0;
}
.wp-import-tab__loaded-source {
  color: var(--wp-text-muted);
  font-weight: var(--wp-weight-medium);
}
.wp-import-tab__loaded-sep {
  color: var(--wp-text-dim);
}
.wp-import-tab__loaded-count {
  font-family: var(--wp-font-mono);
  font-feature-settings: "tnum";
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
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
