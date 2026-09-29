<script setup lang="ts">
/**
 * Tags — the library's collections view.
 *
 * Library tags are the free-form labels on modules, bundles and templates
 * (edited on each row's Identity card). A row can carry several, so they are
 * the many-to-many grouping categories are not. This page lists every tag
 * with how many rows carry it, opens a tag as a filtered list, and renames,
 * merges or deletes a tag across the whole library in one step.
 */
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import Chip from "../components/ui/Chip.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import Input from "../components/ui/Input.vue";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { api, ApiError } from "../api/client";
import type { LibraryTagUpdateCounts } from "../api/types";
import { useToast } from "../composables/useToast";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import { libraryTagCounts, type LibraryTagCount } from "../utils/library-tags";

const router = useRouter();
const toast = useToast();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const templateStore = useTemplateStore();

const loading = ref(false);
const query = ref("");

const counts = computed(() =>
  libraryTagCounts(moduleStore.catalog, bundleStore.catalog, templateStore.catalog),
);
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? counts.value.filter((c) => c.tag.toLowerCase().includes(q)) : counts.value;
});

async function refresh() {
  loading.value = true;
  try {
    await Promise.all([
      moduleStore.fetchCatalog(),
      bundleStore.fetchCatalog(),
      templateStore.fetchCatalog(),
    ]);
  } catch (e) {
    reportError(e, "Refresh failed");
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

function reportError(e: unknown, summary: string) {
  const msg = e instanceof ApiError ? e.message : String(e);
  toast.push({ severity: "error", summary, detail: msg, life: 4000 });
}

function itemsLabel(u: LibraryTagUpdateCounts): string {
  const n = u.modules + u.bundles + u.templates;
  return `${n} item${n === 1 ? "" : "s"}`;
}

/** All items shows modules and bundles; a tag found only on templates opens
 *  the Templates list instead so the click never lands on an empty page. */
function open(c: LibraryTagCount) {
  const path = c.modules + c.bundles === 0 ? "/templates" : "/all";
  void router.push({ path, query: { tag: c.tag } });
}

// ── Rename / merge ────────────────────────────────────────────────────────
const editing = ref<{ tag: string; name: string } | null>(null);
/** Set when the new name is already a tag: the rename becomes a merge and
 *  asks first, because it can't be split back apart. */
const mergePending = ref<{ from: string; into: string } | null>(null);

function startRename(c: LibraryTagCount) {
  editing.value = { tag: c.tag, name: c.tag };
  void nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('[data-test="tag-rename-input"]');
    el?.focus();
    el?.select();
  });
}

function cancelRename() {
  editing.value = null;
}

async function saveRename() {
  if (!editing.value) return;
  const from = editing.value.tag;
  const to = editing.value.name.trim();
  if (!to || to === from) { cancelRename(); return; }
  if (counts.value.some((c) => c.tag === to)) {
    mergePending.value = { from, into: to };
    return;
  }
  await runRename(from, to, "Renamed");
}

async function confirmMerge() {
  const m = mergePending.value;
  mergePending.value = null;
  if (m) await runRename(m.from, m.into, "Merged");
}

async function runRename(from: string, to: string, verb: string) {
  try {
    const res = await api.libraryTags.rename(from, to);
    await refresh();
    toast.push({
      severity: "success",
      summary: `${verb} "${from}" to "${to}"`,
      detail: `Updated ${itemsLabel(res.updated)}`,
      life: 3000,
    });
  } catch (e) {
    reportError(e, `${verb === "Merged" ? "Merge" : "Rename"} failed`);
  } finally {
    editing.value = null;
  }
}

// ── Delete ────────────────────────────────────────────────────────────────
const deletePending = ref<LibraryTagCount | null>(null);

async function confirmDelete() {
  const c = deletePending.value;
  deletePending.value = null;
  if (!c) return;
  try {
    const res = await api.libraryTags.delete(c.tag);
    await refresh();
    toast.push({
      severity: "success",
      summary: `Removed "${c.tag}"`,
      detail: `Updated ${itemsLabel(res.updated)}`,
      life: 3000,
    });
  } catch (e) {
    reportError(e, "Delete failed");
  }
}
</script>

<template>
  <!-- Single root vnode so AppLayout's RouterView Transition stays in sync
       (same trap Categories.vue documents). -->
  <div class="wp-route-root">
  <div class="wp-page wp-page--fill">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Tags</h1>
        <p class="wp-page__subtitle">
          Labels on modules, bundles and templates. An item can carry several, so a tag
          works as a collection. Add tags on an item's Identity card or with the bulk bar.
        </p>
      </div>
      <div class="wp-page__actions">
        <Button
          variant="ghost"
          icon="pi pi-refresh"
          aria-label="Refresh tags"
          :disabled="loading"
          :class="{ 'wp-refresh-btn--spin': loading }"
          @click="refresh"
        >Refresh</Button>
      </div>
    </div>

    <div v-if="counts.length" class="wp-tags-search">
      <Input
        v-model="query"
        placeholder="Filter tags…"
        aria-label="Filter tags"
        data-test="tags-filter"
      />
    </div>

    <div class="wp-table-wrap wp-table-wrap--scroll">
      <table class="wp-table wp-table--sticky-head">
        <thead>
          <tr>
            <th>Tag</th>
            <th class="wp-tags-col--count">Modules</th>
            <th class="wp-tags-col--count">Bundles</th>
            <th class="wp-tags-col--count">Templates</th>
            <th class="wp-tags-col--actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="counts.length === 0">
            <td colspan="5">
              <EmptyState
                icon="pi-hashtag"
                headline="No tags yet"
                body="Tag an item on its Identity card, or select several in a list and use Add tag."
                variant="library"
              />
            </td>
          </tr>
          <tr v-else-if="shown.length === 0">
            <td colspan="5" class="wp-dim">No tag matches "{{ query }}".</td>
          </tr>
          <tr
            v-for="c in shown"
            :key="c.tag"
            class="wp-tags-row"
            :data-test="`tag-row-${c.tag}`"
          >
            <td>
              <!-- .stop: Enter on a name that already exists opens the merge
                   confirm, which listens for Enter on window. Letting this
                   keydown bubble would confirm the merge unseen. -->
              <Input
                v-if="editing && editing.tag === c.tag"
                v-model="editing.name"
                aria-label="New tag name"
                data-test="tag-rename-input"
                @keydown.enter.stop.prevent="saveRename"
                @keydown.esc.stop="cancelRename"
              />
              <button
                v-else
                type="button"
                class="wp-tags-open"
                :title="`Show items tagged '${c.tag}'`"
                @click="open(c)"
              >
                <Chip tone="success">{{ c.tag }}</Chip>
              </button>
            </td>
            <td class="wp-mono">{{ c.modules || "—" }}</td>
            <td class="wp-mono">{{ c.bundles || "—" }}</td>
            <td class="wp-mono">{{ c.templates || "—" }}</td>
            <td class="wp-tags-col--actions">
              <template v-if="editing && editing.tag === c.tag">
                <Button
                  variant="primary" size="sm" icon="pi-check"
                  :aria-label="`Save ${c.tag}`" data-test="tag-rename-save"
                  @click="saveRename"
                />
                <Button
                  variant="ghost" size="sm" icon="pi-times"
                  :aria-label="`Cancel renaming ${c.tag}`"
                  @click="cancelRename"
                />
              </template>
              <template v-else>
                <Button
                  variant="ghost" size="sm" icon="pi-list"
                  :aria-label="`Show items tagged ${c.tag}`" :data-test="`tag-open-${c.tag}`"
                  @click="open(c)"
                />
                <Button
                  variant="ghost" size="sm" icon="pi-pencil"
                  :aria-label="`Rename ${c.tag}`" :data-test="`tag-rename-${c.tag}`"
                  @click="startRename(c)"
                />
                <Button
                  variant="ghost" size="sm" icon="pi-trash"
                  :aria-label="`Delete ${c.tag}`" :data-test="`tag-delete-${c.tag}`"
                  @click="deletePending = c"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <ConfirmDialog
    :visible="mergePending !== null"
    :title="`Merge \&quot;${mergePending?.from ?? ''}\&quot; into \&quot;${mergePending?.into ?? ''}\&quot;?`"
    :body="`&quot;${mergePending?.into ?? ''}&quot; already exists. Every item tagged &quot;${mergePending?.from ?? ''}&quot; gets &quot;${mergePending?.into ?? ''}&quot; instead, and the two can't be told apart afterwards.`"
    confirm-label="Merge"
    @confirm="confirmMerge"
    @cancel="mergePending = null; cancelRename()"
  />
  <ConfirmDialog
    :visible="deletePending !== null"
    :title="`Delete tag \&quot;${deletePending?.tag ?? ''}\&quot;?`"
    :body="`Removes it from ${deletePending?.total ?? 0} item${deletePending?.total === 1 ? '' : 's'}. The items themselves stay.`"
    confirm-label="Delete"
    variant="danger"
    @confirm="confirmDelete"
    @cancel="deletePending = null"
  />
  </div>
</template>

<style scoped>
.wp-route-root { display: contents; }

.wp-tags-search { max-width: 320px; }

.wp-tags-col--count   { width: 110px; }
.wp-tags-col--actions { width: 140px; text-align: right; white-space: nowrap; }
.wp-tags-col--actions .wp-btn + .wp-btn { margin-left: var(--wp-space-2); }

.wp-tags-open {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
</style>
