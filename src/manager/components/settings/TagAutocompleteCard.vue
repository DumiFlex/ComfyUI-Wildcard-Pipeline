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
import { resetTagAvailability } from "../../utils/tagStatus";

const ui = useUiStore();
const toast = useToast();

const status = ref<TagStatus | null>(null);
const loading = ref(true);
const downloading = ref(false);
const busy = ref(false);

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
  // Editors cache "is a list available?" once per page. Drop it so a file
  // dropped in by hand — or one just deleted — takes effect without a reload.
  resetTagAvailability();
}

/** For a file copied in by hand: the server re-reads on mtime change, but
 *  nothing tells the page to go and look. */
async function recheck(): Promise<void> {
  busy.value = true;
  try {
    await refresh();
    toast.push({
      severity: status.value?.available ? "success" : "info",
      summary: status.value?.available
        ? `${status.value.tag_count.toLocaleString()} tags found`
        : "No tag list at that path",
      life: 3000,
    });
  } finally {
    busy.value = false;
  }
}

async function removeList(): Promise<void> {
  busy.value = true;
  try {
    await api.tags.remove();
    await refresh();
    toast.push({ severity: "success", summary: "Tag list removed", life: 3000 });
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not remove the tag list",
      detail: err instanceof Error ? err.message : undefined,
      life: 5000,
    });
  } finally {
    busy.value = false;
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
      <div class="wp-tagac__actions">
        <!-- Re-read the path. The server notices an mtime change on its own,
             but nothing tells the page to go and look, so a file copied in by
             hand stays invisible until something asks. -->
        <Button
          variant="ghost"
          icon="pi-refresh"
          :loading="busy"
          data-test="tagac-refresh"
          title="Re-check the path — use after copying a file there yourself"
          @click="recheck"
        >Refresh</Button>
        <Button
          v-if="status?.available"
          variant="ghost"
          icon="pi-trash"
          :loading="busy"
          data-test="tagac-remove"
          title="Delete the installed tag list"
          @click="removeList"
        >Remove</Button>
        <Button
          variant="secondary"
          :loading="downloading"
          data-test="tagac-download"
          @click="download"
        >{{ status?.available ? "Replace" : "Download" }}</Button>
      </div>
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

.wp-tagac__actions {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  flex-wrap: wrap;
  justify-content: flex-end;
}

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
