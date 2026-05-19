<script setup lang="ts">
/**
 * PushToLibraryModal — unified save-to-library surface.
 *
 * Replaces the five `onXxxSaveToLibraryClick` flows that lived in
 * `ModuleEditModal.vue`. One modal, one set of fields, two explicit
 * actions: **Update existing** (PUT /wp/api/modules/{id}/payload) and
 * **Save as new entry** (POST /wp/api/modules — fork to a fresh uuid).
 *
 * "Update existing" is disabled when the draft has no `payload_hash`
 * (the row was created inline and never came from the library — there
 * is no existing row to update).
 *
 * On open the modal:
 *   - seeds editable name/description/tags from `draft.meta`
 *   - fetches `/wp/api/bundles?contains_module=<draft.id>` to surface
 *     a "this save affects N bundles" preview + the propagate checkbox
 *
 * Emits:
 *   - `close` when the user cancels (workflow draft stays untouched)
 *   - `saved` with the result of the API call so the caller can refresh
 *     library hashes + close the parent edit modal
 *
 * Tests live in src/components/context/PushToLibraryModal.test.ts.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { workflowSiblingCount } from "./duplicates/sibling-count";
import { forkModule } from "./duplicates/fork";
import { app } from "#comfyui/app";
import type { ModuleEntry } from "../../widgets/_shared";

interface Bundle {
  id: string;
  name: string;
}

interface SaveResult {
  mode: "update" | "fork";
  /** New library uuid when forking; same as draft.id when updating. */
  id: string;
  /** payload_hash returned by the server after the write. */
  payload_hash: string;
  /** Bundles whose stored children[] snapshots were rewritten. */
  bundles_updated: string[];
  /** Display name as persisted on the library row. */
  name: string;
}

interface Props {
  open: boolean;
  draft: ModuleEntry | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  close: [];
  saved: [SaveResult];
}>();

const name = ref<string>("");
const description = ref<string>("");
const tagsText = ref<string>("");
const propagate = ref<boolean>(true);
const bundles = ref<Bundle[]>([]);
const bundlesLoading = ref<boolean>(false);
const busy = ref<boolean>(false);
const errorMsg = ref<string>("");

const isLibraryTracked = computed(() => Boolean(props.draft?.payload_hash));

const siblings = computed<number>(() => {
  if (!props.draft) return 0;
  try {
    return workflowSiblingCount(props.draft.id, app.graph as never);
  } catch {
    return 0;
  }
});

const tagsParsed = computed<string[]>(() =>
  tagsText.value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0),
);

const payloadPreview = computed<string>(() => {
  if (!props.draft?.payload) return "{}";
  try {
    return JSON.stringify(props.draft.payload, null, 2);
  } catch {
    return "<unable to format payload>";
  }
});

function resetForm(): void {
  const meta = (props.draft?.meta ?? {}) as Record<string, unknown>;
  const metaName = typeof meta.name === "string" ? meta.name : "";
  const metaDesc = typeof meta.description === "string" ? meta.description : "";
  const metaTags = Array.isArray(meta.tags)
    ? (meta.tags as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  name.value = metaName.trim();
  description.value = metaDesc;
  tagsText.value = metaTags.join(", ");
  propagate.value = true;
  busy.value = false;
  errorMsg.value = "";
}

async function fetchBundlesContaining(): Promise<void> {
  if (!props.draft?.id) return;
  bundlesLoading.value = true;
  bundles.value = [];
  try {
    const res = await fetch(`/wp/api/bundles?contains_module=${encodeURIComponent(props.draft.id)}`);
    if (!res.ok) return;
    const body = await res.json() as { items?: Bundle[] };
    bundles.value = body.items ?? [];
  } catch {
    /* network — leave list empty */
  } finally {
    bundlesLoading.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    resetForm();
    void fetchBundlesContaining();
  },
);

function close(): void {
  if (busy.value) return;
  emit("close");
}

function metaBody(): { name?: string; description?: string; tags?: string[] } {
  const out: { name?: string; description?: string; tags?: string[] } = {};
  if (name.value.trim()) out.name = name.value.trim();
  if (description.value) out.description = description.value;
  if (tagsParsed.value.length || tagsText.value.length > 0) out.tags = tagsParsed.value;
  return out;
}

async function doUpdate(): Promise<void> {
  if (!props.draft || !isLibraryTracked.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch(`/wp/api/modules/${props.draft.id}/payload`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: props.draft.payload,
        meta: metaBody(),
        propagate_to_bundles: propagate.value,
      }),
    });
    const body = await res.json() as {
      ok?: boolean;
      new_hash?: string;
      bundles_updated?: string[];
      error?: string;
    };
    if (!res.ok || !body.ok) {
      errorMsg.value = body.error ?? `HTTP ${res.status}`;
      return;
    }
    emit("saved", {
      mode: "update",
      id: props.draft.id,
      payload_hash: body.new_hash ?? "",
      bundles_updated: body.bundles_updated ?? [],
      name: name.value.trim() || props.draft.meta?.name || props.draft.type,
    });
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function doSaveAsNew(): Promise<void> {
  if (!props.draft) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    // Library name set lookup so the auto-suffix can avoid collisions.
    let existing = new Set<string>();
    try {
      const res = await fetch("/wp/api/modules");
      if (res.ok) {
        const data = await res.json() as { items?: Array<{ name?: string }> } | Array<{ name?: string }>;
        const items = Array.isArray(data) ? data : (data.items ?? []);
        existing = new Set(items.map((m) => m.name ?? "").filter(Boolean));
      }
    } catch {
      /* fall through with empty set */
    }
    const draftCopy = {
      ...props.draft,
      meta: {
        ...(props.draft.meta ?? {}),
        name: name.value.trim() || props.draft.meta?.name || props.draft.type,
      },
    };
    const { newId, newHash, suffixedName } = await forkModule(draftCopy, existing);
    emit("saved", {
      mode: "fork",
      id: newId,
      payload_hash: newHash,
      bundles_updated: [],
      name: suffixedName,
    });
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
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
        v-if="open && draft"
        class="wp-ptl-overlay"
        data-test="ptl-overlay"
        @click="close"
      >
        <div
          class="wp-ptl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wp-ptl-title"
          data-test="ptl"
          @click.stop
        >
          <header class="wp-ptl__head">
            <h3 id="wp-ptl-title" class="wp-ptl__title">Push to library</h3>
            <button
              type="button"
              class="wp-ptl__close"
              aria-label="Close"
              data-test="ptl-close"
              @click="close"
            >×</button>
          </header>

          <div class="wp-ptl__body">
            <div class="wp-ptl-field">
              <label class="wp-ptl-field__label" for="wp-ptl-name">Name</label>
              <input
                id="wp-ptl-name"
                v-model="name"
                type="text"
                class="wp-ptl-input"
                data-test="ptl-name"
                placeholder="(unnamed)"
              />
            </div>

            <div class="wp-ptl-field">
              <label class="wp-ptl-field__label" for="wp-ptl-description">Description</label>
              <textarea
                id="wp-ptl-description"
                v-model="description"
                class="wp-ptl-input wp-ptl-input--multi"
                data-test="ptl-description"
                rows="2"
              />
            </div>

            <div class="wp-ptl-field">
              <label class="wp-ptl-field__label" for="wp-ptl-tags">Tags (comma-separated)</label>
              <input
                id="wp-ptl-tags"
                v-model="tagsText"
                type="text"
                class="wp-ptl-input"
                data-test="ptl-tags"
                placeholder="e.g. style, qa"
              />
            </div>

            <div class="wp-ptl-field">
              <label class="wp-ptl-field__label">Payload preview</label>
              <pre class="wp-ptl-payload" data-test="ptl-payload-preview">{{ payloadPreview }}</pre>
            </div>

            <div v-if="bundlesLoading" class="wp-ptl-bundles wp-ptl-bundles--loading">
              Checking bundles…
            </div>
            <div
              v-else-if="bundles.length"
              class="wp-ptl-bundles"
              data-test="ptl-bundles"
            >
              <div class="wp-ptl-bundles__title">
                Affects {{ bundles.length }} saved bundle{{ bundles.length === 1 ? '' : 's' }}:
              </div>
              <ul class="wp-ptl-bundles__list">
                <li v-for="b in bundles" :key="b.id">{{ b.name }}</li>
              </ul>
              <label class="wp-ptl-checkbox">
                <input
                  v-model="propagate"
                  type="checkbox"
                  data-test="ptl-propagate"
                />
                Propagate update to those bundles
              </label>
            </div>

            <div v-if="siblings > 1" class="wp-ptl-note wp-ptl-note--warn" data-test="ptl-siblings">
              This module has {{ siblings }} instances in the workflow. "Update existing"
              changes the library entry every instance reads from.
            </div>

            <div v-if="errorMsg" class="wp-ptl-error" data-test="ptl-error">
              {{ errorMsg }}
            </div>
          </div>

          <footer class="wp-ptl__foot">
            <button
              type="button"
              class="wp-ptl-btn"
              data-test="ptl-cancel"
              :disabled="busy"
              @click="close"
            >Cancel</button>
            <span class="wp-ptl-spacer" />
            <button
              type="button"
              class="wp-ptl-btn"
              data-test="ptl-save-new"
              :disabled="busy"
              @click="doSaveAsNew"
            >Save as new entry</button>
            <button
              type="button"
              class="wp-ptl-btn wp-ptl-btn--primary"
              data-test="ptl-update"
              :disabled="busy || !isLibraryTracked"
              :title="!isLibraryTracked ? 'No existing library entry to update' : undefined"
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
.wp-ptl-payload {
  margin: 0;
  padding: 8px 10px;
  background: var(--wp-bg-2, #15151f);
  border: 1px solid var(--wp-border, #2a2a3a);
  border-radius: 6px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  white-space: pre;
  overflow: auto;
  max-height: 140px;
  color: var(--wp-text-muted, #a1a1ad);
}
.wp-ptl-bundles {
  padding: 8px 10px;
  background: color-mix(in oklab, var(--wp-warn, #facc15) 8%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn, #facc15) 22%, transparent);
  border-radius: 6px;
  font-size: 12.5px;
}
.wp-ptl-bundles--loading { color: var(--wp-text-muted, #a1a1ad); }
.wp-ptl-bundles__title { font-weight: 600; margin-bottom: 4px; }
.wp-ptl-bundles__list {
  margin: 0; padding-left: 18px;
  display: flex; flex-direction: column; gap: 2px;
}
.wp-ptl-checkbox {
  display: inline-flex; align-items: center; gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  cursor: pointer;
}
.wp-ptl-note {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.wp-ptl-note--warn {
  background: color-mix(in oklab, var(--wp-warn, #facc15) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn, #facc15) 30%, transparent);
  color: var(--wp-warn, #facc15);
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
