<script setup lang="ts">
/**
 * Settings → LoRA and embedding completion.
 *
 * Sibling of `TagAutocompleteCard`, and deliberately simpler. Tags need a
 * downloaded file, so that card has to distinguish "off" from "impossible" and
 * offer Download / Remove. These two read the models ComfyUI has already
 * enumerated for its own node combos: there is nothing to install, so "switched
 * on" is the whole condition and the only status worth showing is how many
 * files were found.
 *
 * Refresh exists for the one case that is not self-healing: ComfyUI caches its
 * own file lists, so a model added while the server is running stays invisible
 * until something asks again.
 */
import { computed, onMounted, ref } from "vue";
import Card from "../ui/Card.vue";
import Field from "../ui/Field.vue";
import Toggle from "../ui/Toggle.vue";
import Button from "../ui/Button.vue";
import { api } from "../../api/client";
import type { ModelKind } from "../../api/types";
import { useUiStore } from "../../stores/uiStore";
import { useToast } from "../../composables/useToast";

const ui = useUiStore();
const toast = useToast();

const counts = ref<Partial<Record<ModelKind, number>>>({});
const loading = ref(true);
const busy = ref(false);
/** The endpoint only exists from the version that added it, and it is
 *  registered at import — so a server that has not been restarted since the
 *  update answers 404. Saying so beats showing "0 found", which reads as
 *  "you have no LoRAs". */
const unreachable = ref(false);

function label(kind: ModelKind): string {
  const n = counts.value[kind];
  if (unreachable.value) return "Restart ComfyUI to enable";
  if (n === undefined) return "Checking…";
  return n > 0
    ? `${n.toLocaleString()} found`
    : "None found — check your models folder";
}

/** Tints the whole badge, not just the dot — at 11px the dot alone is easy to
 *  miss, and "none found" is the case that most needs to be noticed. */
function badgeClass(kind: ModelKind): string {
  if (unreachable.value) return "wp-models__badge--warn";
  const n = counts.value[kind];
  if (n === undefined) return "";
  return n > 0 ? "wp-models__badge--ok" : "wp-models__badge--warn";
}

/** Green when the source can actually do something, amber when it cannot.
 *  Same vocabulary as the tag card's status dot, so "is this usable?" reads
 *  identically on both. */
function dotClass(kind: ModelKind): string {
  if (unreachable.value) return "wp-models__dot--none";
  const n = counts.value[kind];
  if (n === undefined) return "wp-models__dot--none";
  return n > 0 ? "wp-models__dot--ok" : "wp-models__dot--none";
}

const separatorHint = computed(() =>
  ui.autocompleteSeparator
    ? "A comma and a space follow each pick."
    : "Picks are inserted on their own.",
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.models.status();
    counts.value = Object.fromEntries(res.sources.map((s) => [s.kind, s.count]));
    unreachable.value = false;
  } catch {
    counts.value = {};
    unreachable.value = true;
  } finally {
    loading.value = false;
  }
}

async function refresh(): Promise<void> {
  busy.value = true;
  try {
    const res = await api.models.refresh();
    counts.value = Object.fromEntries(res.sources.map((s) => [s.kind, s.count]));
    unreachable.value = false;
    const total = res.sources.reduce((n, s) => n + s.count, 0);
    toast.push({
      severity: "success",
      summary: `${total.toLocaleString()} models found`,
      life: 3000,
    });
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not re-read the model folders",
      detail: err instanceof Error ? err.message : undefined,
      life: 5000,
    });
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Card title="LoRA and embedding autocomplete">
    <Field
      label="Suggest LoRAs"
      hint="Offers installed LoRA names while you type, inserting the full <lora:name:1.0> syntax."
    >
      <div class="wp-models__control">
        <Toggle
          :model-value="ui.loraAutocomplete"
          label="Suggest LoRAs"
          data-test="settings-lora-autocomplete"
          @update:model-value="ui.setLoraAutocomplete($event)"
        />
        <!-- On the control's own row, pushed right. As a separate line under
             the hint it either crowded the explanation or overlapped it. -->
        <span class="wp-models__badge" :class="badgeClass('lora')" data-test="lora-count">
          <span class="wp-models__dot" :class="dotClass('lora')" />{{ label("lora") }}
        </span>
      </div>
    </Field>

    <Field
      label="Suggest embeddings"
      hint="Offers installed embedding names, inserting the full embedding:name syntax."
    >
      <div class="wp-models__control">
        <Toggle
          :model-value="ui.embeddingAutocomplete"
          label="Suggest embeddings"
          data-test="settings-embedding-autocomplete"
          @update:model-value="ui.setEmbeddingAutocomplete($event)"
        />
        <!-- On the control's own row, pushed right. As a separate line under
             the hint it either crowded the explanation or overlapped it. -->
        <span class="wp-models__badge" :class="badgeClass('embedding')" data-test="embedding-count">
          <span class="wp-models__dot" :class="dotClass('embedding')" />{{ label("embedding") }}
        </span>
      </div>
    </Field>

    <!-- Not a source, but it belongs beside the things it modifies. -->
    <Field
      label="Append a separator"
      :hint="`${separatorHint} Never applied inside a <lora:…> or embedding:… reference, where a comma would end the reference being completed.`"
    >
      <Toggle
        :model-value="ui.autocompleteSeparator"
        label="Append &quot;, &quot;"
        data-test="settings-autocomplete-separator"
        @update:model-value="ui.setAutocompleteSeparator($event)"
      />
    </Field>

    <div class="wp-models__row">
      <p class="wp-dim wp-models__note">
        Read from the models ComfyUI already knows about — nothing is downloaded
        and nothing is stored. Use Refresh after adding a model while the server
        is running, since ComfyUI caches its own file lists.
      </p>
      <Button
        variant="ghost"
        icon="pi-refresh"
        :loading="busy || loading"
        data-test="models-refresh"
        title="Re-read the LoRA and embedding folders"
        @click="refresh"
      >Refresh</Button>
    </div>
  </Card>
</template>

<style scoped>
.wp-models__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wp-space-5);
  margin-top: var(--wp-space-6);
  padding-top: var(--wp-space-5);
  border-top: 1px solid var(--wp-border);
}

/* Control and count share a row; the badge is pushed to the far edge. The count
   was first appended to the dim `hint`, where the one fact worth reading was
   the least readable thing on the card, and then given its own line, where it
   crowded the explanation above it. */
.wp-models__control {
  display: flex;
  align-items: center;
  gap: var(--wp-space-5);
}

.wp-models__badge {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  line-height: 1.4;
  white-space: nowrap;
  color: var(--wp-text);
  background: var(--wp-bg-2, var(--wp-bg));
  border: 1px solid var(--wp-border);
}

.wp-models__badge--ok {
  color: var(--wp-success);
  border-color: color-mix(in srgb, var(--wp-success) 40%, transparent);
  background: color-mix(in srgb, var(--wp-success) 12%, transparent);
}

.wp-models__badge--warn {
  color: var(--wp-warn);
  border-color: color-mix(in srgb, var(--wp-warn) 40%, transparent);
  background: color-mix(in srgb, var(--wp-warn) 12%, transparent);
}

.wp-models__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.wp-models__dot--ok { background: var(--wp-success); }
.wp-models__dot--none { background: var(--wp-warn); }

.wp-models__note {
  margin: 0;
  font-size: 11.5px;
  text-wrap: pretty;
}
</style>
