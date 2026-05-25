<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { useCleanerPresetStore } from "../stores/cleanerPresetStore";
import { useToast } from "../composables/useToast";

const store = useCleanerPresetStore();
const router = useRouter();
const toast = useToast();

onMounted(() => {
  if (store.items.length === 0) store.fetchAll();
});

function edit(id: string): void {
  router.push({ name: "cleaner-presets-edit", params: { id } });
}

async function refresh() {
  try {
    await store.fetchAll();
  } catch (e) {
    toast.push({
      severity: "error",
      summary: "Refresh failed",
      detail: String(e),
      life: 4000,
    });
  }
}

async function remove(id: string, name: string) {
  if (!window.confirm(`Delete preset "${name}"?`)) return;
  try {
    await store.remove(id);
    toast.push({ severity: "success", summary: "Deleted", detail: name, life: 2000 });
  } catch (e) {
    toast.push({
      severity: "error",
      summary: "Delete failed",
      detail: String(e),
      life: 4000,
    });
  }
}
</script>

<template>
  <div class="wp-route-root">
  <div class="wp-page wp-page--fill">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Cleaner Presets</h1>
        <p class="wp-page__subtitle">
          Saved configurations for the WP_PromptCleaner node. Built-ins are read-only.
        </p>
      </div>
      <div class="wp-page__actions">
        <Button
          variant="ghost"
          icon="pi pi-refresh"
          aria-label="Refresh cleaner presets"
          :disabled="store.loading"
          :class="{ 'wp-refresh-btn--spin': store.loading }"
          @click="refresh"
        >Refresh</Button>
      </div>
    </div>

    <div v-if="store.error" class="wp-error wp-error--block">{{ store.error }}</div>

    <div class="wp-table-wrap wp-table-wrap--scroll">
      <table class="wp-table wp-table--sticky-head">
        <thead>
          <tr>
            <th>Name</th>
            <th class="wp-cleaner-col--intensity">Intensity</th>
            <th class="wp-cleaner-col--kind">Kind</th>
            <th class="wp-cleaner-col--count">Blocklist</th>
            <th class="wp-cleaner-col--actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.items.length === 0 && !store.loading">
            <td colspan="5">
              <EmptyState
                icon="pi-filter-fill"
                headline="No cleaner presets yet"
                body="Built-in intensities + any you save from the cleaner node land here."
                variant="library"
              />
            </td>
          </tr>
          <tr
            v-for="row in store.items"
            :key="row.id"
            class="wp-cleaner-row"
            :data-test="`preset-${row.id}`"
            @click="edit(row.id)"
          >
            <td>
              <div class="wp-cleaner-name">
                <span class="wp-cleaner-name__text">{{ row.name }}</span>
                <span
                  v-if="row.is_builtin"
                  data-test="builtin-badge"
                  class="wp-cleaner-name__badge"
                >built-in</span>
                <span v-if="row.description" class="wp-cleaner-name__desc">{{ row.description }}</span>
              </div>
            </td>
            <td><span class="wp-mono">{{ row.payload.intensity }}</span></td>
            <td><span class="wp-mono wp-dim">{{ row.payload.mode }}</span></td>
            <td>
              <span class="wp-mono">{{ row.payload.blocklist.entries.length }}</span>
              <span class="wp-dim"> · {{ row.payload.blocklist.kind }}</span>
            </td>
            <td class="wp-cleaner-col--actions">
              <Button
                variant="ghost"
                size="sm"
                icon="pi-pencil"
                aria-label="Edit preset"
                @click.stop="edit(row.id)"
              />
              <Button
                v-if="!row.is_builtin"
                variant="ghost"
                size="sm"
                icon="pi-trash"
                aria-label="Delete preset"
                @click.stop="remove(row.id, row.name)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  </div>
</template>

<style scoped>
.wp-route-root { display: contents; }

.wp-cleaner-row { cursor: pointer; }
.wp-cleaner-name { display: flex; align-items: center; gap: var(--wp-space-3); flex-wrap: wrap; }
.wp-cleaner-name__text { font-size: var(--wp-text-sm); color: var(--wp-text); }
.wp-cleaner-name__badge {
  font-size: var(--wp-text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 1px 6px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-dim);
}
.wp-cleaner-name__desc {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
}
.wp-cleaner-col--intensity { width: 130px; }
.wp-cleaner-col--kind      { width: 90px; }
.wp-cleaner-col--count     { width: 130px; }
.wp-cleaner-col--actions {
  width: 110px;
  text-align: right;
  white-space: nowrap;
}
.wp-cleaner-col--actions .wp-btn + .wp-btn { margin-left: var(--wp-space-2); }

.wp-error--block {
  padding: var(--wp-space-4);
  margin-bottom: var(--wp-space-5);
  background: var(--wp-danger-bg, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--wp-danger);
  color: var(--wp-danger-text, var(--wp-danger));
  border-radius: var(--wp-radius-sm);
}
</style>
