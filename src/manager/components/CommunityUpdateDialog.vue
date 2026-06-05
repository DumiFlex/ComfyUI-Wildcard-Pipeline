<script setup lang="ts">
/**
 * Community-update action dialog.
 *
 * Opens when the user clicks the "v{N} available" pill on a row whose
 * `community_post_slug` is set and whose installed `community_version_number`
 * is below the post's `latest_version_number`. Offers three choices:
 *
 *   - **Update in place** — fetch the post's latest version payload,
 *     prepend a history snapshot of the current row (using the existing
 *     per-module `payload.history` sidecar so the user can roll back from
 *     the editor's History panel), and PATCH the row via `moduleStore.update`
 *     / `bundleStore.update`. Same code path the editor uses on save.
 *
 *   - **Install as new entry** — invoke the host-bridge install with the
 *     post envelope wrapped via the rename decision baked in. Leaves the
 *     original row untouched; the user ends up with two entries (old and
 *     new) side-by-side.
 *
 *   - **Dismiss** — remember in localStorage that the user explicitly
 *     declined this version. The update pill stops surfacing until the
 *     post ships an even newer version (we key the dismissal on the post
 *     slug + version we offered, not just the slug).
 *
 * Update-in-place is module-only for now. Bundles have no per-row
 * history sidecar to preserve; we surface "install as new" as the
 * canonical bundle upgrade path.
 */
import { computed, ref } from "vue";
import Modal from "./ui/Modal.vue";
import Button from "./ui/Button.vue";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useCommunityUpdateStore } from "../stores/communityUpdateStore";
import { useToast } from "../composables/useToast";
import { WPC_API_URL } from "../config/links";
import { appendSnapshot, stripHistory } from "../utils/history";
import { installEnvelope } from "../import-export/install";
import { api } from "../api/client";
import { wrapAsEngineExport } from "./engine-export-wrap";

interface UpdateEntry {
  entity_id: string;
  entity_kind: "module" | "bundle";
  post_slug: string;
  installed_version: number;
  latest_version: number;
}

const props = defineProps<{
  open: boolean;
  entry: UpdateEntry | null;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const updateStore = useCommunityUpdateStore();
const toast = useToast();

const acting = ref<null | "update" | "install-new" | "dismiss">(null);
const errorMsg = ref<string | null>(null);

const isModule = computed(() => props.entry?.entity_kind === "module");
const oldName = computed(() => {
  if (!props.entry) return "";
  if (props.entry.entity_kind === "module") {
    return moduleStore.catalog.find((m) => m.id === props.entry!.entity_id)?.name ?? props.entry.entity_id;
  }
  return bundleStore.catalog.find((b) => b.id === props.entry!.entity_id)?.name ?? props.entry.entity_id;
});

/**
 * GET the community post's latest version payload. Reuses the public
 * download endpoint the embed already polls; no auth needed because
 * downloads are open for everyone (anon downloads still increment the
 * post counter, which is the desired behaviour anyway).
 */
async function fetchLatestPayload(slug: string): Promise<{ payload: Record<string, unknown>; version: number }> {
  const resp = await fetch(`${WPC_API_URL}/api/v1/posts/${slug}/download`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch latest version (HTTP ${resp.status})`);
  }
  const body = await resp.json() as { data: { payload_json: Record<string, unknown>; version_number: number } };
  return { payload: body.data.payload_json, version: body.data.version_number };
}

/**
 * Snapshot the current library into the LibrarySnapshot shape
 * installEnvelope expects. Same logic as main.ts's `snapshotLibrary`
 * — duplicated here because main.ts mounts at app bootstrap before
 * Pinia is fully resolved for component-level callers; pulling stores
 * inside this function keeps the snapshot accurate at action-fire
 * time (a long-lived list view picks up library mutations from other
 * tabs / pages between mount and update click).
 */
function snapshotLibrary() {
  const modules = new Map<string, { id: string; name: string }>();
  for (const m of moduleStore.catalog) modules.set(m.id, { id: m.id, name: m.name });
  const bundles = new Map<string, { id: string; name: string }>();
  for (const b of bundleStore.catalog) bundles.set(b.id, { id: b.id, name: b.name });
  return { modules, bundles };
}

/**
 * Update in place: route the new community payload through the
 * install pipeline with a forced `replace` decision. For modules we
 * pre-inject a history snapshot of the local row's pre-update state
 * into the new payload's `history` sidecar so the editor's History
 * panel can roll back. Bundles have no history sidecar; the replace
 * path just swaps `children` verbatim.
 *
 * Origin is stamped via `opts.origin`, so the engine's `_update_module`
 * / `_update_bundle` paths rewrite `community_version_number` to the
 * fresh value and the update pill clears on the next check.
 */
async function onUpdateInPlace() {
  if (!props.entry || acting.value) return;
  acting.value = "update";
  errorMsg.value = null;
  try {
    const fetched = await fetchLatestPayload(props.entry.post_slug);
    let entityPayload = fetched.payload;
    if (props.entry.entity_kind === "module") {
      const oldRow = moduleStore.catalog.find((m) => m.id === props.entry!.entity_id);
      if (!oldRow) throw new Error("Local module row not found — refresh the library + try again.");
      // The community ships engine-row shape `{id, type, name, ..., payload:{…}}`.
      // History goes inside the INNER payload (next to `options`/etc),
      // not on the row's top-level. Mutate a copy so we don't disturb
      // the fetched object.
      const newRow = { ...(entityPayload as Record<string, unknown>) };
      const innerNew = { ...(newRow.payload as Record<string, unknown> ?? {}) };
      const history = appendSnapshot(
        {
          name: oldRow.name,
          description: oldRow.description,
          category_id: oldRow.category_id,
          tags: oldRow.tags,
        },
        oldRow.payload,
      );
      innerNew.history = history;
      newRow.payload = stripHistory(innerNew);
      // Re-stripHistory + re-attach so a pre-existing `history` field
      // on the inner payload doesn't double-up. The append helper
      // already strips on input but this is defensive.
      (newRow.payload as Record<string, unknown>).history = history;
      // Force the row's id to the local id so the replace decision
      // routes to the right DB row even if the community-side post
      // payload carries a different id field.
      newRow.id = props.entry.entity_id;
      entityPayload = newRow;
    } else {
      // Bundle: just pin the local id on the new payload so replace
      // hits the right row.
      const newRow = { ...(entityPayload as Record<string, unknown>) };
      newRow.id = props.entry.entity_id;
      entityPayload = newRow;
    }
    const subtype = (entityPayload as { type?: string }).type ?? null;
    const envelope = wrapAsEngineExport({
      kind: props.entry.entity_kind,
      subtype,
      payload: entityPayload,
    });
    const localEntityId = props.entry.entity_id;
    const result = await installEnvelope(
      { envelope },
      {
        importExport: api.importExport,
        library: snapshotLibrary(),
        origin: { post_slug: props.entry.post_slug, version_number: fetched.version },
        resolveCollisions: async (rows) => {
          const out: Record<string, { kind: "replace" }> = {};
          for (const r of rows) {
            // Only force replace on the row the dialog is targeting;
            // any incidental collision on a different id falls back
            // to the install pipeline's default (treats as add and
            // the server rejects, which is the conservative path).
            if (r.id === localEntityId) out[r.id] = { kind: "replace" };
          }
          return out;
        },
      },
    );
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Update failed");
    }
    await moduleStore.fetchCatalog();
    await bundleStore.fetchCatalog();
    toast.push({
      severity: "success",
      summary: `Updated to v${fetched.version}`,
      detail: props.entry.entity_kind === "module"
        ? "Previous state saved in History panel."
        : undefined,
      life: 4500,
    });
    void updateStore.check({
      modules: moduleStore.catalog,
      bundles: bundleStore.catalog,
    });
    emit("close");
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    acting.value = null;
  }
}

/**
 * Install as new entry: route through installEnvelope with a rename
 * decision baked in. The new row gets a fresh id, the user-supplied
 * suffix appended to the name, and the same community_post_slug —
 * tracking now points to the new row (and the old row keeps its
 * pre-update tracking, so the update pill keeps surfacing on the OLD
 * row until the user explicitly updates or dismisses it).
 */
async function onInstallAsNew() {
  if (!props.entry || acting.value) return;
  acting.value = "install-new";
  errorMsg.value = null;
  try {
    const fetched = await fetchLatestPayload(props.entry.post_slug);
    // Wrap in the engine-export envelope shape installEnvelope expects.
    // We hand it through as a fresh `add` and let the host-bridge's
    // own collision detector classify the id collision. The user
    // already picked "install as new" in this dialog; we forward that
    // intent through resolveCollisions by always returning a rename
    // decision (no user prompt — they made the choice up-front).
    const kindGuess = props.entry.entity_kind === "bundle" ? "bundle" : "module";
    const subtype = (fetched.payload as { type?: string }).type ?? null;
    const envelope = wrapAsEngineExport({
      kind: kindGuess,
      subtype: subtype as string | null,
      payload: fetched.payload,
    });
    const result = await installEnvelope(
      { envelope },
      {
        importExport: api.importExport,
        library: snapshotLibrary(),
        origin: { post_slug: props.entry.post_slug, version_number: fetched.version },
        resolveCollisions: async (rows) => {
          const out: Record<string, { kind: "rename"; new_name: string }> = {};
          for (const r of rows) {
            out[r.id] = {
              kind: "rename",
              new_name: `${r.incomingName}-v${fetched.version}`,
            };
          }
          return out;
        },
      },
    );
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Install failed");
    }
    await moduleStore.fetchCatalog();
    await bundleStore.fetchCatalog();
    toast.push({
      severity: "success",
      summary: `v${fetched.version} installed as a new entry`,
      life: 4500,
    });
    void updateStore.check({
      modules: moduleStore.catalog,
      bundles: bundleStore.catalog,
    });
    emit("close");
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    acting.value = null;
  }
}

/**
 * Dismiss: persist `{slug → version}` in localStorage so the update
 * pill stays hidden for this exact version. Future versions of the
 * same post bypass the dismissal (we compare against `version_number`,
 * not just the slug).
 */
const DISMISS_KEY = "wpc.community-update-dismissed";
function onDismiss() {
  if (!props.entry) return;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    map[props.entry.post_slug] = props.entry.latest_version;
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    // localStorage can be denied in some sandbox contexts — fail
    // silently; user can dismiss again next render.
  }
  // Update-store also reads the dismissal map on its next check, so
  // re-check now to clear the pill immediately.
  void updateStore.check({
    modules: moduleStore.catalog,
    bundles: bundleStore.catalog,
  });
  emit("close");
}

</script>

<template>
  <Modal :open="open" @update:open="(v: boolean) => !v && $emit('close')" :close-on-backdrop="!acting" size="md">
    <template v-if="entry">
      <header style="padding: 18px 22px; border-bottom: 1px solid var(--wp-border)">
        <h2 style="margin: 0; font-size: 16px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px">
          <i class="pi pi-arrow-up" style="color: var(--wp-warn, #f59e0b)" />
          Update available
        </h2>
        <p style="margin: 6px 0 0; color: var(--wp-text-muted); font-size: 12.5px">
          <code>{{ entry.post_slug }}</code>
          shipped <b>v{{ entry.latest_version }}</b> — you have v{{ entry.installed_version }} of
          <b>"{{ oldName }}"</b>.
        </p>
      </header>

      <div style="padding: 16px 22px; display: flex; flex-direction: column; gap: 14px">
        <div class="wpc-update-action" :data-disabled="!isModule || null">
          <h3>Update in place</h3>
          <p>
            Overwrite this row with the new payload. Your previous state goes
            into the editor's History panel so you can roll back from there.
          </p>
          <Button
            variant="primary"
            icon="pi-refresh"
            :disabled="!isModule || acting !== null"
            :loading="acting === 'update'"
            @click="onUpdateInPlace"
          >Update in place</Button>
          <p v-if="!isModule" class="wpc-update-hint">
            Bundles have no history sidecar — use "Install as new" instead.
          </p>
        </div>

        <div class="wpc-update-action">
          <h3>Install as new entry</h3>
          <p>
            Adds the new version alongside the existing row with a
            <code>-v{{ entry.latest_version }}</code> suffix. The original
            row stays as-is.
          </p>
          <Button
            variant="secondary"
            icon="pi-plus"
            :disabled="acting !== null"
            :loading="acting === 'install-new'"
            @click="onInstallAsNew"
          >Install as new</Button>
        </div>

        <div class="wpc-update-action">
          <h3>Dismiss this version</h3>
          <p>
            Hide the update pill until <code>{{ entry.post_slug }}</code>
            ships a newer version. Older offers stay dismissed.
          </p>
          <Button
            variant="ghost"
            icon="pi-times"
            :disabled="acting !== null"
            @click="onDismiss"
          >Dismiss</Button>
        </div>

        <p v-if="errorMsg" class="wpc-update-error">
          <i class="pi pi-exclamation-circle" />{{ errorMsg }}
        </p>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.wpc-update-action {
  border: 1px solid var(--wp-border);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--wp-bg-2);
}
.wpc-update-action[data-disabled] {
  opacity: 0.6;
}
.wpc-update-action h3 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--wp-text);
}
.wpc-update-action p {
  margin: 0 0 10px;
  color: var(--wp-text-muted);
  font-size: 12.5px;
  line-height: 1.55;
}
.wpc-update-action code {
  font-family: var(--wp-font-mono);
  font-size: 11.5px;
  background: var(--wp-bg-3);
  padding: 1px 5px;
  border-radius: 3px;
}
.wpc-update-hint {
  margin-top: 8px !important;
  font-size: 11.5px !important;
  font-style: italic;
}
.wpc-update-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-danger, #ef4444) 36%, transparent);
  color: var(--wp-danger-text, #ef4444);
  font-size: 12.5px;
}
.wpc-update-error i { font-size: 14px; flex-shrink: 0; }
</style>
