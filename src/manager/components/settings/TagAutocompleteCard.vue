<script setup lang="ts">
/**
 * Settings → Tag autocomplete.
 *
 * Two facts that look like one: whether the user WANTS suggestions, and
 * whether a tag list exists to make them from. The toggle owns the first, the
 * status row owns the second, and conflating them would produce a switch that
 * silently does nothing.
 *
 * Shape follows the Updates card — Field + Toggle, then a status row with an
 * action — because it is the same interaction: tell me the state, give me the
 * verb.
 */
import { computed, onMounted, ref } from "vue";
import Card from "../ui/Card.vue";
import Field from "../ui/Field.vue";
import Toggle from "../ui/Toggle.vue";
import Button from "../ui/Button.vue";
import { api } from "../../api/client";
import type { TagStatus } from "../../api/types";
import { useUiStore } from "../../stores/uiStore";
import { useToast } from "../../composables/useToast";

const ui = useUiStore();
const toast = useToast();

const status = ref<TagStatus | null>(null);
const loading = ref(true);
const downloading = ref(false);

/** Where the file is looked for, shown even when nothing is installed — it is
 *  the answer to "where do I put my own?", which is the supported alternative
 *  to downloading ours. */
const pathLabel = computed(() => status.value?.path ?? "—");

const countLabel = computed(() => {
  const s = status.value;
  if (!s?.available) return "No tag list installed";
  const n = s.tag_count.toLocaleString();
  // Naming the absence matters: a two-column file is a perfectly good list
  // that simply cannot colour-code, and the dropdown will look different
  // because of it.
  return s.has_categories
    ? `${n} tags · with categories`
    : `${n} tags · no categories`;
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    status.value = await api.tags.status();
  } catch {
    status.value = null;
  } finally {
    loading.value = false;
  }
}

async function download(): Promise<void> {
  downloading.value = true;
  try {
    const result = await api.tags.download();
    await refresh();
    toast.push({
      severity: "success",
      summary: `${result.tag_count.toLocaleString()} tags installed`,
      life: 4000,
    });
  } catch (err) {
    // The server's message is the useful one — it names which restriction
    // stopped the download rather than saying "failed".
    toast.push({
      severity: "error",
      summary: "Could not download the tag list",
      detail: err instanceof Error ? err.message : undefined,
      life: 6000,
    });
  } finally {
    downloading.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <Card title="Tag autocomplete">
    <Field
      label="Suggest booru tags"
      hint="Offers danbooru tag names while you type option values. Your $ variables and @ references always take priority — suggestions never appear while you are typing one."
    >
      <Toggle
        :model-value="ui.tagAutocomplete"
        label="Suggest tags"
        data-test="settings-tag-autocomplete"
        @update:model-value="ui.setTagAutocomplete($event)"
      />
    </Field>

    <div class="wp-tagac__row">
      <div class="wp-tagac__state">
        <p class="wp-tagac__count" data-test="tagac-status">
          <span
            class="wp-tagac__dot"
            :class="status?.available ? 'wp-tagac__dot--ok' : 'wp-tagac__dot--none'"
          />
          <template v-if="loading">Checking…</template>
          <template v-else>{{ countLabel }}</template>
        </p>
        <p class="wp-dim wp-tagac__path">{{ pathLabel }}</p>
      </div>
      <Button
        variant="secondary"
        :loading="downloading"
        data-test="tagac-download"
        @click="download"
      >{{ status?.available ? "Replace" : "Download" }}</Button>
    </div>

    <!-- Stated in the UI, not only in the README. Someone deciding whether to
         press a button deserves to know what it will contact before they press
         it, not after. -->
    <p class="wp-dim wp-tagac__note">
      Downloads a tag list from this project's GitHub release. It is the only
      thing this extension fetches from the internet, and only when you press
      the button. You can also drop your own CSV at the path above.
    </p>
  </Card>
</template>

<style scoped>
.wp-tagac__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wp-space-5);
  margin-top: var(--wp-space-6);
  padding-top: var(--wp-space-5);
  border-top: 1px solid var(--wp-border);
}

.wp-tagac__state { min-width: 0; }

.wp-tagac__count {
  margin: 0;
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
}

.wp-tagac__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.wp-tagac__dot--ok { background: var(--wp-success); }
.wp-tagac__dot--none { background: var(--wp-warn); }

.wp-tagac__path {
  margin: 2px 0 0;
  font-family: var(--wp-font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.wp-tagac__note {
  margin: var(--wp-space-5) 0 0;
  font-size: 11.5px;
  text-wrap: pretty;
}
</style>
