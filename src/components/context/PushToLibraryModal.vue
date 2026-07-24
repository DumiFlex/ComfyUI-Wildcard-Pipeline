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
import { hashes as libraryHashes } from "./drift-store";
import {
  findRelinkCandidates,
  autoRelinkTarget,
  type RelinkCandidate,
} from "../../manager/import-export/relink-match";
import { app } from "#comfyui/app";
import type { ModuleEntry } from "../../widgets/_shared";
import WpCheck from "@/components/shared/WpCheck.vue";

interface Bundle {
  id: string;
  name: string;
}

interface SaveResult {
  /** `update` — PUT to existing entry. `fork` — POST creating a new
   *  entry with a "(copy)" suffix; workflow row keeps its old id.
   *  `reattach` — fork when the source entry was missing upstream;
   *  no copy suffix, AND the caller should rebind the workflow row to
   *  the new uuid so MISSING clears. `relink` — no write at all: point
   *  the detached workflow row at an EXISTING content-identical library
   *  uuid; the caller swaps the row id + remaps sibling refs. */
  mode: "update" | "fork" | "reattach" | "relink";
  /** New library uuid when forking; same as draft.id when updating. */
  id: string;
  /** payload_hash returned by the server after the write. */
  payload_hash: string;
  /** Bundles whose stored children[] snapshots were rewritten. */
  bundles_updated: string[];
  /** Display name as persisted on the library row. */
  name: string;
  /** Original draft.id at modal-open time. Lets the caller find the
   *  workflow row to rebind on `mode: "reattach"`. */
  origId: string;
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

/** True when the draft was library-tracked but its uuid is no longer
 *  in the polled hashes map — the upstream library entry has been
 *  deleted, so "Update existing" would 404. The user must fork via
 *  "Save as new entry" instead. */
const isLibraryMissing = computed(() => {
  if (!isLibraryTracked.value || !props.draft) return false;
  if (libraryHashes.value === null) return false;
  return !(props.draft.id in libraryHashes.value);
});

/** "Update existing" is enabled only when the entry exists AND is
 *  library-tracked. Disabled when never library-tracked OR when the
 *  upstream entry has been deleted. */
const canUpdateExisting = computed(
  () => isLibraryTracked.value && !isLibraryMissing.value,
);

/** uuid → {name, type} for every live library module, fetched once on open.
 *  Backs the re-link candidate name lookup + the (type, name) fallback match.
 *  drift-store hashes carry (type, payload_hash) but not names, so the picker
 *  needs this to label + weakly-match candidates. */
const relinkNames = ref<Map<string, { name: string; type: string }>>(new Map());

async function fetchLibraryNames(): Promise<void> {
  try {
    const res = await fetch("/wp/api/modules");
    if (!res.ok) return;
    const data = (await res.json()) as
      | { items?: Array<{ id?: string; name?: string; type?: string }> }
      | Array<{ id?: string; name?: string; type?: string }>;
    const items = Array.isArray(data) ? data : (data.items ?? []);
    const next = new Map<string, { name: string; type: string }>();
    for (const it of items) {
      if (typeof it.id === "string" && it.id) {
        next.set(it.id, { name: it.name ?? "", type: it.type ?? "" });
      }
    }
    relinkNames.value = next;
  } catch {
    /* network — leave the map empty; no re-link offered */
  }
}

/** Content-aware re-link candidates for a DETACHED draft: existing library
 *  rows whose (type, payload_hash) match the draft's content (identical) or
 *  whose (type, name) match (content differs). Empty unless the draft is
 *  detached (`isLibraryMissing`). */
const relinkCandidates = computed<RelinkCandidate[]>(() => {
  if (!props.draft || !isLibraryMissing.value || libraryHashes.value === null) return [];
  return findRelinkCandidates(
    {
      id: props.draft.id,
      type: props.draft.type,
      payload_hash: props.draft.payload_hash,
      name: props.draft.meta?.name ?? "",
    },
    libraryHashes.value,
    (u) => relinkNames.value.get(u),
  );
});

/** The sole content-identical candidate, if unambiguous (else null). */
const relinkAuto = computed(() => autoRelinkTarget(relinkCandidates.value));
const relinkPick = ref<RelinkCandidate | null>(null);
const relinkQuery = ref<string>("");
const relinkFiltered = computed<RelinkCandidate[]>(() => {
  const q = relinkQuery.value.trim().toLowerCase();
  if (!q) return relinkCandidates.value;
  return relinkCandidates.value.filter(
    (c) => c.name.toLowerCase().includes(q) || c.uuid.toLowerCase().includes(q),
  );
});

/** The active re-link target: an explicit pick wins, else the unambiguous
 *  auto-target (single identical candidate). */
const relinkTarget = computed<RelinkCandidate | null>(
  () => relinkPick.value ?? relinkAuto.value,
);

function doRelink(): void {
  const t = relinkTarget.value;
  if (!t || !props.draft) return;
  emit("saved", {
    mode: "relink",
    id: t.uuid,
    payload_hash: t.payloadHash,
    bundles_updated: [],
    name: t.name,
    origId: props.draft.id,
  });
}

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
  relinkPick.value = null;
  relinkQuery.value = "";
}

/** When the row is library-tracked, fetch the live library entry and
 *  fold its description/tags into the form. Workflow rows only ever
 *  carry `meta.name` + `meta.library_name` at insert time — they don't
 *  copy the library's description or tags forward — so without this
 *  fetch the modal opens with blank fields even when the library row
 *  has values. Only fills when the draft itself is empty for that
 *  field so an in-modal edit isn't clobbered by the async response. */
async function seedFromLibrary(): Promise<void> {
  if (!props.draft || !props.draft.payload_hash) return;
  try {
    const res = await fetch(`/wp/api/modules/${props.draft.id}`);
    if (!res.ok) return;
    const lib = await res.json() as { description?: unknown; tags?: unknown };
    if (!description.value && typeof lib.description === "string") {
      description.value = lib.description;
    }
    if (!tagsText.value && Array.isArray(lib.tags)) {
      tagsText.value = lib.tags
        .filter((t): t is string => typeof t === "string")
        .join(", ");
    }
  } catch {
    /* network — leave form as-is */
  }
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
    void seedFromLibrary();
    // Re-link candidates only matter for a DETACHED draft — skip the extra
    // library-list fetch entirely when the row is tracked + present.
    if (isLibraryMissing.value) void fetchLibraryNames();
  },
);

// A drift poll can flip the draft to detached AFTER open (hashes land late);
// fetch the candidate name map the first time that happens so re-link appears
// without a reopen. One-shot: only when open, detached, and not yet loaded.
watch(isLibraryMissing, (missing) => {
  if (props.open && missing && relinkNames.value.size === 0) void fetchLibraryNames();
});

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
    const meta = metaBody();
    // Phase D contract: PUT /wp/api/modules/{id} is the canonical
    // update route. It accepts payload + flattened meta fields +
    // propagate flag. The older /payload alias still exists for
    // backwards compat but new client code calls the canonical
    // endpoint directly.
    const body: Record<string, unknown> = {
      payload: props.draft.payload,
      propagate_to_bundles: propagate.value,
    };
    if (meta.name !== undefined) body.name = meta.name;
    if (meta.description !== undefined) body.description = meta.description;
    if (meta.tags !== undefined) body.tags = meta.tags;

    const res = await fetch(`/wp/api/modules/${props.draft.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const respBody = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      errorMsg.value = (respBody.error as string | undefined) ?? `HTTP ${res.status}`;
      return;
    }
    // Server returns the full module row + bundles_updated. payload_hash
    // is at the top level (not nested under new_hash like the legacy
    // alias) — match the canonical shape.
    emit("saved", {
      mode: "update",
      id: props.draft.id,
      payload_hash: (respBody.payload_hash as string | undefined) ?? "",
      bundles_updated: (respBody.bundles_updated as string[] | undefined) ?? [],
      name: name.value.trim() || props.draft.meta?.name || props.draft.type,
      origId: props.draft.id,
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
    // Re-attach path: source entry was deleted upstream. The original
    // name slot is free, so skip the "(copy)" suffix — the user's
    // intent is "put this row back in the library", not "make a copy".
    const skipCopySuffix = isLibraryMissing.value;
    const { newId, newHash, suffixedName } = await forkModule(
      draftCopy,
      existing,
      { skipCopySuffix },
    );
    emit("saved", {
      mode: skipCopySuffix ? "reattach" : "fork",
      id: newId,
      payload_hash: newHash,
      bundles_updated: [],
      name: suffixedName,
      origId: props.draft.id,
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
              <span class="wp-ptl-checkbox">
                <WpCheck
                  v-model="propagate"
                  data-test="ptl-propagate"
                  aria-label="Propagate update to those bundles"
                />
                Propagate update to those bundles
              </span>
            </div>

            <div v-if="siblings > 1" class="wp-ptl-note wp-ptl-note--warn" data-test="ptl-siblings">
              This module has {{ siblings }} instances in the workflow. "Update existing"
              changes the library entry every instance reads from.
            </div>

            <div
              v-if="isLibraryMissing && relinkCandidates.length"
              class="wp-ptl-relink"
              data-test="ptl-relink"
            >
              <div class="wp-ptl-relink__title">Re-link to an existing library entry</div>
              <p class="wp-ptl-relink__hint">
                This module's content matches a library entry under a different id (a re-import
                minted a new one). Re-link to reconnect drift + refresh instead of adding a duplicate.
              </p>
              <input
                v-if="relinkCandidates.length > 1"
                v-model="relinkQuery"
                type="text"
                class="wp-ptl-input"
                data-test="ptl-relink-search"
                placeholder="Search by name or id…"
                aria-label="Search library entries to re-link"
                spellcheck="false"
                autocomplete="off"
              />
              <ul class="wp-ptl-relink__list">
                <li
                  v-for="c in relinkFiltered"
                  :key="c.uuid"
                  class="wp-ptl-relink__cand"
                  :class="{ 'is-picked': relinkTarget != null && relinkTarget.uuid === c.uuid }"
                  data-test="ptl-relink-candidate"
                  @click="relinkPick = c"
                >
                  <span class="wp-ptl-relink__name">{{ c.name || "(unnamed)" }}</span>
                  <code class="wp-ptl-relink__uuid">{{ c.uuid }}</code>
                  <span
                    class="wp-ptl-relink__tag"
                    :class="c.contentIdentical ? 'is-identical' : 'is-diff'"
                  >{{ c.contentIdentical ? "identical" : "content differs" }}</span>
                </li>
              </ul>
              <button
                type="button"
                class="wp-ptl-btn wp-ptl-btn--primary"
                data-test="ptl-relink-confirm"
                :disabled="!relinkTarget || undefined"
                @click="doRelink"
              >Re-link<template v-if="relinkTarget"> to “{{ relinkTarget.name || relinkTarget.uuid }}”</template></button>
            </div>

            <div v-if="isLibraryMissing" class="wp-ptl-note wp-ptl-note--danger" data-test="ptl-missing">
              The library entry for this module has been deleted upstream. "Update existing"
              is unavailable — use "Save as new entry" to re-add it to the library as a fresh
              entry.
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
.wp-ptl-note--danger {
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-danger, #ef4444) 32%, transparent);
  color: var(--wp-danger, #ef4444);
}
.wp-ptl-relink {
  padding: 10px 12px;
  border-radius: 6px;
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 8%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 30%, transparent);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wp-ptl-relink__title { font-size: 12.5px; font-weight: 600; color: var(--wp-text, #e7e7ee); }
.wp-ptl-relink__hint { margin: 0; font-size: 11.5px; color: var(--wp-text-muted, #a1a1ad); }
.wp-ptl-relink__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-ptl-relink__cand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.wp-ptl-relink__cand:hover { background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 16%, transparent); }
.wp-ptl-relink__cand.is-picked { background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 28%, transparent); }
.wp-ptl-relink__name { font-size: 12px; color: var(--wp-text, #e7e7ee); }
.wp-ptl-relink__uuid { font-family: var(--wp-font-mono, monospace); font-size: 10px; color: var(--wp-text-dim, #6e6e7c); }
.wp-ptl-relink__tag {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 9.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 999px;
}
.wp-ptl-relink__tag.is-identical {
  color: var(--wp-green, #6ad28b);
  background: color-mix(in oklab, var(--wp-green, #6ad28b) 16%, transparent);
}
.wp-ptl-relink__tag.is-diff {
  color: var(--wp-warn, #facc15);
  background: color-mix(in oklab, var(--wp-warn, #facc15) 16%, transparent);
}
.wp-ptl-relink .wp-ptl-btn--primary { align-self: flex-start; }
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
