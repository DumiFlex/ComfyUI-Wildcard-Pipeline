<script setup lang="ts">
/**
 * PushBundleToLibraryModal — bundle-scoped sibling of PushToLibraryModal.
 *
 * Same two-action grammar:
 *   - **Update existing** (PUT /wp/api/bundles/{id}) — disabled when the
 *     library entry has been deleted upstream (would 404).
 *   - **Save as new entry** (POST /wp/api/bundles) — fork. When the
 *     source was missing this becomes a "reattach": skips the "(copy)"
 *     name suffix (the original name slot is free) and caller rebinds
 *     the workflow BundleInstance to the new uuid.
 *
 * Caller pre-builds the `childrenForLibrary` payload via
 * `buildLibraryChildrenWithIntegrity` so the modal stays free of
 * bundle-walk logic.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { bundleHashes } from "./drift-store";
import { api } from "../../manager/api/client";
import type { BundleInstance } from "../../widgets/_shared";
import WpCheck from "@/components/shared/WpCheck.vue";

interface ChildPreview {
  name: string;
  kind: string;
}

/** Cascade restore pre-scan handed in by the caller — drives the
 *  "Restore N missing references" UI. When both counts are 0 the
 *  section stays hidden and the cascade checkbox is absent. */
interface CascadeScan {
  missingModuleCount: number;
  missingBundleCount: number;
  missingModuleNames: string[];
  missingBundleNames: string[];
}

/** Caller-supplied async hook. Runs BEFORE the modal's own POST/PUT.
 *  Returns the rewritten children array (already includes the new
 *  uuids from the restored library entries) and the count breakdown.
 *  Throws on any failure — modal aborts the save and surfaces the
 *  error. */
type CascadeRestoreFn = () => Promise<{
  rewrittenChildren: Record<string, unknown>[];
  restoredModuleCount: number;
  restoredBundleCount: number;
}>;

interface SaveResult {
  /** `update` — PUT to existing entry. `fork` — POST new entry with
   *  "(copy)" suffix; workflow row keeps its old library_id. `reattach`
   *  — POST when source entry was missing; no copy suffix, caller
   *  should rebind the workflow row's library_id to the new uuid so
   *  MISSING clears. */
  mode: "update" | "fork" | "reattach";
  /** New library uuid when forking/reattaching; same as bundle.library_id
   *  when updating. */
  id: string;
  /** payload_hash returned by the server. */
  payload_hash: string;
  /** Display name as persisted. */
  name: string;
  /** Original bundle.library_id at modal-open time. Lets the caller
   *  rebind the workflow BundleInstance on reattach. */
  origId: string;
  /** Cascade restore breakdown, when the user opted in. Lets the
   *  caller surface a richer success toast and (already committed by
   *  the cascade fn) skip its own rebinding for restored items. */
  cascade?: {
    restoredModuleCount: number;
    restoredBundleCount: number;
  };
}

interface Props {
  open: boolean;
  bundle: BundleInstance | null;
  childrenForLibrary: Array<Record<string, unknown>>;
  childrenPreview: ChildPreview[];
  /** Optional — when set, the modal surfaces a "Restore N missing
   *  references" section AND wires up the cascade checkbox. The
   *  caller must also pass `cascadeRestore` for the actual work. */
  cascadeScan?: CascadeScan | null;
  cascadeRestore?: CascadeRestoreFn;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  close: [];
  saved: [SaveResult];
}>();

const name = ref<string>("");
const description = ref<string>("");
const tagsText = ref<string>("");
const busy = ref<boolean>(false);
const errorMsg = ref<string>("");
/** User-controlled — defaults to ON when a cascade scan reports any
 *  missing children, OFF otherwise. The checkbox lets the user save
 *  WITHOUT restoring if they're intentionally pushing a partial state. */
const cascadeEnabled = ref<boolean>(false);

/** True when the modal should show the cascade section. Driven by the
 *  scan: any missing module or inner-bundle triggers it. */
const cascadeAvailable = computed<boolean>(() => {
  const scan = props.cascadeScan;
  if (!scan) return false;
  return scan.missingModuleCount > 0 || scan.missingBundleCount > 0;
});

/** True when the bundle was inserted from a library entry (has a real
 *  `library_id` — bundle instances always do, but inline-only paths
 *  could in theory pass null). Without this the Update path can't
 *  target an existing row. */
const isLibraryTracked = computed(() => Boolean(props.bundle?.library_id));

/** True when the bundle's library_id is no longer in the polled
 *  hashes map — entry deleted upstream so PUT would 404. */
const isLibraryMissing = computed(() => {
  if (!isLibraryTracked.value || !props.bundle) return false;
  if (bundleHashes.value === null) return false;
  return !(props.bundle.library_id in bundleHashes.value);
});

const canUpdateExisting = computed(
  () => isLibraryTracked.value && !isLibraryMissing.value,
);

const tagsParsed = computed<string[]>(() =>
  tagsText.value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0),
);

function resetForm(): void {
  name.value = (props.bundle?.name ?? "").trim();
  description.value = "";
  tagsText.value = "";
  busy.value = false;
  errorMsg.value = "";
  // Cascade is opt-in but defaults ON when there's anything to heal —
  // that's the case where saving WITHOUT cascade ships broken refs
  // into library, so we make the safer choice the default and let the
  // user opt out.
  cascadeEnabled.value = cascadeAvailable.value;
}

/** Seed description + tags from the live library entry when the
 *  bundle is tracked. Skips on missing — the entry is gone. Only
 *  fills empty form fields so a mid-edit doesn't get clobbered. */
async function seedFromLibrary(): Promise<void> {
  if (!props.bundle || !isLibraryTracked.value || isLibraryMissing.value) return;
  try {
    const row = await api.bundles.get(props.bundle.library_id);
    if (!description.value && typeof row.description === "string") {
      description.value = row.description;
    }
    if (!tagsText.value && Array.isArray(row.tags)) {
      tagsText.value = row.tags.join(", ");
    }
  } catch {
    /* network — leave form as-is */
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    resetForm();
    void seedFromLibrary();
  },
);

function close(): void {
  if (busy.value) return;
  emit("close");
}

/** Cascade pre-pass — runs once per save attempt when cascade is
 *  enabled. Returns the (rewritten) children to use in the actual
 *  POST/PUT plus the count breakdown for the success toast. Throws
 *  on any failure; the caller surfaces the error via `errorMsg`. */
async function runCascadeIfEnabled(): Promise<{
  children: Record<string, unknown>[];
  cascadeMeta?: { restoredModuleCount: number; restoredBundleCount: number };
}> {
  if (!cascadeEnabled.value || !cascadeAvailable.value || !props.cascadeRestore) {
    return { children: props.childrenForLibrary };
  }
  const result = await props.cascadeRestore();
  return {
    children: result.rewrittenChildren,
    cascadeMeta: {
      restoredModuleCount: result.restoredModuleCount,
      restoredBundleCount: result.restoredBundleCount,
    },
  };
}

async function doUpdate(): Promise<void> {
  if (!props.bundle || !canUpdateExisting.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const cascade = await runCascadeIfEnabled();
    const finalName = name.value.trim() || props.bundle.name || "bundle";
    const updated = await api.bundles.update(props.bundle.library_id, {
      name: finalName,
      description: description.value,
      tags: tagsParsed.value,
      color: props.bundle.color ?? null,
      children: cascade.children,
    });
    emit("saved", {
      mode: "update",
      id: props.bundle.library_id,
      payload_hash: updated.payload_hash,
      name: updated.name,
      origId: props.bundle.library_id,
      cascade: cascade.cascadeMeta,
    });
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function doSaveAsNew(): Promise<void> {
  if (!props.bundle) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const cascade = await runCascadeIfEnabled();
    let existing = new Set<string>();
    try {
      const list = await api.bundles.list({});
      existing = new Set(list.items.map((b) => b.name).filter(Boolean));
    } catch {
      /* fall through with empty set */
    }
    const baseName = stripCopySuffix(name.value.trim() || props.bundle.name || "bundle");
    // Re-attach path: source entry was deleted. Always use the bare
    // base name — library entries are keyed by uuid, not name, so a
    // same-name collision with a separate entry is tolerable and beats
    // forcing "(copy)" when the user's intent is "restore my deleted
    // entry". Default fork path keeps the collision-avoiding suffix.
    const reattach = isLibraryMissing.value;
    const finalName = reattach ? baseName : pickCopyName(baseName, existing);
    const created = await api.bundles.create({
      name: finalName,
      description: description.value,
      tags: tagsParsed.value,
      color: props.bundle.color ?? null,
      children: cascade.children,
    });
    emit("saved", {
      mode: reattach ? "reattach" : "fork",
      id: created.id,
      payload_hash: created.payload_hash,
      name: created.name,
      origId: props.bundle.library_id,
      cascade: cascade.cascadeMeta,
    });
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function stripCopySuffix(s: string): string {
  return s.replace(/\s*\(copy(?:\s+\d+)?\)\s*$/, "");
}
function pickCopyName(base: string, taken: ReadonlySet<string>): string {
  const first = `${base} (copy)`;
  if (!taken.has(first)) return first;
  for (let i = 2; i < 1000; i++) {
    const c = `${base} (copy ${i})`;
    if (!taken.has(c)) return c;
  }
  return `${base} (copy ${Date.now()})`;
}

function onKey(ev: KeyboardEvent): void {
  if (!props.open) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    close();
  }
}
watch(
  () => props.open,
  (v) => {
    if (v) window.addEventListener("keydown", onKey);
    else window.removeEventListener("keydown", onKey);
  },
  { immediate: true },
);
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="wp-modal" appear>
      <div
        v-if="open && bundle"
        class="wp-ptl-overlay"
        data-test="pbtl-overlay"
        @click="close"
      >
        <div
          class="wp-ptl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wp-pbtl-title"
          data-test="pbtl"
          @click.stop
        >
          <header class="wp-ptl__head">
            <h3 id="wp-pbtl-title" class="wp-ptl__title">Push bundle to library</h3>
            <button
              type="button"
              class="wp-ptl__close"
              aria-label="Close"
              data-test="pbtl-close"
              @click="close"
            >×</button>
          </header>

          <div class="wp-ptl__body">
            <div class="wp-ptl-field">
              <label class="wp-ptl-field__label" for="wp-pbtl-name">Name</label>
              <input
                id="wp-pbtl-name"
                v-model="name"
                type="text"
                class="wp-ptl-input"
                data-test="pbtl-name"
                placeholder="(unnamed)"
              />
            </div>

            <div class="wp-ptl-field">
              <label class="wp-ptl-field__label" for="wp-pbtl-description">Description</label>
              <textarea
                id="wp-pbtl-description"
                v-model="description"
                class="wp-ptl-input wp-ptl-input--multi"
                data-test="pbtl-description"
                rows="2"
              />
            </div>

            <div class="wp-ptl-field">
              <label class="wp-ptl-field__label" for="wp-pbtl-tags">Tags (comma-separated)</label>
              <input
                id="wp-pbtl-tags"
                v-model="tagsText"
                type="text"
                class="wp-ptl-input"
                data-test="pbtl-tags"
                placeholder="e.g. style, qa"
              />
            </div>

            <div class="wp-ptl-field">
              <label class="wp-ptl-field__label">
                Children ({{ childrenPreview.length }})
              </label>
              <ul class="wp-ptl-children" data-test="pbtl-children">
                <li
                  v-for="(c, i) in childrenPreview"
                  :key="`${c.kind}-${i}`"
                  class="wp-ptl-children__item"
                >
                  <span class="wp-ptl-children__kind">{{ c.kind }}</span>
                  <span class="wp-ptl-children__name">{{ c.name }}</span>
                </li>
                <li v-if="childrenPreview.length === 0" class="wp-ptl-children__empty">
                  (empty bundle)
                </li>
              </ul>
            </div>

            <!-- Cascade restore — surfaces when the scan detected any
                 missing children. The default is ON because saving
                 without cascade preserves broken refs / dead-uuid
                 module snapshots in the library. -->
            <div
              v-if="cascadeAvailable"
              class="wp-ptl-cascade"
              data-test="pbtl-cascade"
            >
              <span class="wp-ptl-cascade__toggle">
                <WpCheck
                  v-model="cascadeEnabled"
                  data-test="pbtl-cascade-toggle"
                  aria-label="Restore missing references first"
                />
                <span>
                  Restore
                  <strong>{{ (cascadeScan?.missingModuleCount ?? 0) + (cascadeScan?.missingBundleCount ?? 0) }}</strong>
                  missing reference{{
                    ((cascadeScan?.missingModuleCount ?? 0) + (cascadeScan?.missingBundleCount ?? 0)) === 1
                      ? ""
                      : "s"
                  }} first
                </span>
              </span>
              <div class="wp-ptl-cascade__hint">
                Cascade-creates fresh library entries for every missing
                child (bottom-up — modules first, then inner bundles)
                before saving this bundle. Without this, broken refs
                ship into the library.
              </div>
              <ul class="wp-ptl-cascade__list">
                <li
                  v-for="n in (cascadeScan?.missingBundleNames ?? [])"
                  :key="`mb-${n}`"
                  class="wp-ptl-cascade__item"
                  data-test="pbtl-cascade-bundle"
                >
                  <span class="wp-ptl-cascade__kind">BUNDLE</span>
                  <span class="wp-ptl-cascade__name">{{ n }}</span>
                </li>
                <li
                  v-for="n in (cascadeScan?.missingModuleNames ?? [])"
                  :key="`mm-${n}`"
                  class="wp-ptl-cascade__item"
                  data-test="pbtl-cascade-module"
                >
                  <span class="wp-ptl-cascade__kind">MODULE</span>
                  <span class="wp-ptl-cascade__name">{{ n }}</span>
                </li>
              </ul>
            </div>

            <div v-if="isLibraryMissing" class="wp-ptl-note wp-ptl-note--danger" data-test="pbtl-missing">
              The library entry for this bundle has been deleted upstream.
              "Update existing" is unavailable — use "Save as new entry" to
              re-add it to the library.
            </div>

            <div v-if="errorMsg" class="wp-ptl-error" data-test="pbtl-error">
              {{ errorMsg }}
            </div>
          </div>

          <footer class="wp-ptl__foot">
            <button
              type="button"
              class="wp-ptl-btn"
              data-test="pbtl-cancel"
              :disabled="busy"
              @click="close"
            >Cancel</button>
            <span class="wp-ptl-spacer" />
            <button
              type="button"
              class="wp-ptl-btn"
              data-test="pbtl-save-new"
              :disabled="busy"
              @click="doSaveAsNew"
            >Save as new entry</button>
            <button
              type="button"
              class="wp-ptl-btn wp-ptl-btn--primary"
              data-test="pbtl-update"
              :disabled="busy || !canUpdateExisting"
              :title="!isLibraryTracked
                ? 'No existing library entry to update'
                : isLibraryMissing
                  ? 'Library entry has been deleted — save as new entry instead'
                  : undefined"
              @click="doUpdate"
            >Update existing</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@import "../shared/theme.css";
@import "../shared/_modal-motion.css";

.wp-ptl-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.wp-ptl {
  width: min(620px, 100%);
  max-height: calc(100vh - 32px);
  background: var(--wp-bg-1, #0b0b12);
  border: 1px solid var(--wp-border-strong, var(--wp-border, #2a2a3a));
  border-radius: var(--wp-radius-lg, 10px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
  display: flex; flex-direction: column;
  overflow: hidden;
  color: var(--wp-text, #e7e7ee);
}
.wp-ptl__head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--wp-border, #2a2a3a);
}
.wp-ptl__title { margin: 0; font-size: 14px; font-weight: 600; }
.wp-ptl__close {
  background: transparent; border: none; color: var(--wp-text-muted);
  font-size: 18px; cursor: pointer; line-height: 1; padding: 0 6px;
}
.wp-ptl__close:hover { color: var(--wp-text); }
.wp-ptl__body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 14px;
  display: flex; flex-direction: column; gap: 12px;
}
.wp-ptl-field { display: flex; flex-direction: column; gap: 4px; }
.wp-ptl-field__label {
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--wp-text-dim);
}
.wp-ptl-input {
  width: 100%;
  background: var(--wp-bg-2, #15151f);
  color: var(--wp-text, #e7e7ee);
  border: 1px solid var(--wp-border, #2a2a3a);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
}
.wp-ptl-input:focus { outline: 1px solid var(--wp-accent-500, #8b5cf6); }
.wp-ptl-input--multi { resize: vertical; min-height: 48px; }
.wp-ptl-children {
  margin: 0;
  padding: 6px 8px;
  list-style: none;
  background: var(--wp-bg-2, #15151f);
  border: 1px solid var(--wp-border, #2a2a3a);
  border-radius: 6px;
  font-size: 12px;
  max-height: 160px;
  overflow: auto;
  display: flex; flex-direction: column; gap: 2px;
}
.wp-ptl-children__item {
  display: flex; align-items: center; gap: 8px;
  padding: 2px 4px;
}
.wp-ptl-children__kind {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-dim);
  min-width: 56px;
}
.wp-ptl-children__name {
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-ptl-children__empty {
  color: var(--wp-text-dim);
  font-style: italic;
  padding: 2px 4px;
}
.wp-ptl-cascade {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px;
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-danger, #ef4444) 30%, transparent);
  border-radius: 6px;
}
.wp-ptl-cascade__toggle {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--wp-text, #e7e7ee);
  cursor: pointer;
}
.wp-ptl-cascade__hint {
  font-size: 11.5px;
  color: var(--wp-text-muted, #a1a1ad);
  line-height: 1.4;
}
.wp-ptl-cascade__list {
  list-style: none;
  margin: 0;
  padding: 4px 6px;
  background: var(--wp-bg-2, #15151f);
  border-radius: 4px;
  font-size: 11.5px;
  max-height: 110px;
  overflow: auto;
  display: flex; flex-direction: column; gap: 1px;
}
.wp-ptl-cascade__item {
  display: flex; align-items: center; gap: 8px;
  padding: 2px 4px;
}
.wp-ptl-cascade__kind {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-danger, #ef4444);
  min-width: 56px;
}
.wp-ptl-cascade__name {
  color: var(--wp-text, #e7e7ee);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-ptl-note {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.wp-ptl-note--danger {
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-danger, #ef4444) 32%, transparent);
  color: var(--wp-danger, #ef4444);
}
.wp-ptl-error {
  padding: 8px 10px;
  border-radius: 6px;
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-danger, #ef4444) 32%, transparent);
  color: var(--wp-danger, #ef4444);
  font-size: 12px;
}
.wp-ptl__foot {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--wp-border, #2a2a3a);
  background: var(--wp-bg-1, #0b0b12);
}
.wp-ptl-spacer { flex: 1; }
.wp-ptl-btn {
  background: var(--wp-bg-3, #1c1c28);
  color: var(--wp-text, #e7e7ee);
  border: 1px solid var(--wp-border-strong, var(--wp-border, #2a2a3a));
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12.5px;
  cursor: pointer;
}
.wp-ptl-btn:hover:not(:disabled) { background: color-mix(in oklab, var(--wp-bg-3, #1c1c28) 80%, var(--wp-text, #fff)); }
.wp-ptl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.wp-ptl-btn--primary {
  background: var(--wp-accent-500, #8b5cf6);
  border-color: var(--wp-accent-500, #8b5cf6);
  color: #fff;
}
.wp-ptl-btn--primary:hover:not(:disabled) {
  background: var(--wp-accent-600, #7c3aed);
}
</style>
