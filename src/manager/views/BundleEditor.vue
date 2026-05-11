<script setup lang="ts">
/**
 * BundleEditor — SPA editor for library-tracked bundles.
 *
 * v1 scope (this file, post Task 22 stub): displays the bundle's
 * identity (name + library id) and a placeholder children list.
 * Task 23 fleshes out the editable name field, color picker, and
 * child-reorder UI. Task 24 wires save-to-library.
 *
 * Route shape mirrors the other kind editors:
 *   /bundles/new            → create-mode (no `id` prop)
 *   /bundles/:id/edit       → edit-mode (`id` injected as prop)
 */
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "../composables/useToast";
import Button from "../components/ui/Button.vue";
import { useBundleStore } from "../stores/bundleStore";
import type { BundleRow } from "../api/types";

const props = defineProps<{ id?: string }>();

const router = useRouter();
const store = useBundleStore();
const toast = useToast();

const row = ref<BundleRow | null>(null);
const loading = ref(false);

onMounted(async () => {
  if (!props.id) return;
  loading.value = true;
  try {
    row.value = await store.get(props.id);
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  } finally {
    loading.value = false;
  }
});

function back() {
  router.push("/bundles");
}
</script>

<template>
  <div class="wp-bundle-editor">
    <div class="wp-bundle-editor__header">
      <Button variant="ghost" icon="pi-arrow-left" @click="back">Back</Button>
      <h2 class="wp-bundle-editor__title">
        {{ props.id ? (row?.name || "Loading…") : "New Bundle" }}
      </h2>
    </div>
    <div v-if="loading" class="wp-dim">Loading bundle…</div>
    <div v-else-if="row" class="wp-bundle-editor__body">
      <dl class="wp-bundle-editor__meta">
        <dt>ID</dt><dd class="wp-mono">{{ row.id }}</dd>
        <dt>Color</dt>
        <dd>
          <span
            class="wp-bundle-editor__swatch"
            :style="{ background: row.color || '#46566B' }"
            aria-hidden="true"
          />
          <span class="wp-mono wp-dim">{{ row.color || "#46566B (default)" }}</span>
        </dd>
        <dt>Children</dt><dd>{{ (row.children ?? []).length }} module(s)</dd>
        <dt>Frozen at</dt><dd class="wp-mono">{{ (row.payload_hash ?? "").slice(0, 12) || "—" }}</dd>
      </dl>
      <p class="wp-dim wp-bundle-editor__hint">
        Full editor (name, color picker, child reorder, save) coming in next commits.
      </p>
    </div>
    <div v-else class="wp-dim">
      <p>New bundles are created from the Context widget. Use the +Bundle button there.</p>
    </div>
  </div>
</template>

<style scoped>
.wp-bundle-editor {
  padding: 16px 20px;
  max-width: 900px;
}
.wp-bundle-editor__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.wp-bundle-editor__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.wp-bundle-editor__body { margin-top: 12px; }
.wp-bundle-editor__meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 16px;
  margin: 0;
  font-size: 13px;
}
.wp-bundle-editor__meta dt { color: var(--wp-text2); }
.wp-bundle-editor__meta dd { margin: 0; }
.wp-bundle-editor__swatch {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--wp-border);
  vertical-align: middle;
  margin-right: 8px;
}
.wp-bundle-editor__hint { margin-top: 16px; font-size: 12px; }
</style>
