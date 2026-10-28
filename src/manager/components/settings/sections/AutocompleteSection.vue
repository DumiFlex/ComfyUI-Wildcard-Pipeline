<script setup lang="ts">
/**
 * Settings › Autocomplete. The three completion sources in one list, with
 * one status column, then the behaviour shared by all of them.
 *
 * Two facts that look like one, per source: whether the user WANTS
 * suggestions (the toggle) and whether there is anything to suggest from (the
 * status pill). Tags need a downloaded list, so that row also carries
 * Download / Refresh / Remove. LoRAs and embeddings read what ComfyUI already
 * enumerated, so their status is just how many files were found; the model
 * Refresh exists because ComfyUI caches its own file lists.
 *
 * The limits are read on the editor's hot path from localStorage by
 * `utils/tagSetting.ts`, so they are written there directly.
 *
 * Every row has two values: the manager's own, and the canvas copy that
 * ComfyUI › Settings › Wildcard Pipeline edits. They may differ on purpose
 * (suggestions here, none on nodes), so both show side by side; the canvas
 * column goes through `useCanvasSettings`, which keeps it in step with
 * ComfyUI's panel both ways.
 */
import { computed, onMounted, ref } from "vue";
import Toggle from "../../ui/Toggle.vue";
import Button from "../../ui/Button.vue";
import Select from "../../ui/Select.vue";
import type { SelectOption } from "../../ui/select-types";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import { api } from "../../../api/client";
import type { ModelKind, TagStatus } from "../../../api/types";
import { useUiStore } from "../../../stores/uiStore";
import { useToast } from "../../../composables/useToast";
import { resetTagAvailability } from "../../../utils/tagStatus";
import {
  completionLimit,
  completionLimitStorageKey,
  notifyCompletionSettingsChanged,
  type CompletionLimit,
} from "../../../utils/tagSetting";
import {
  AC_MAX_SUGGESTIONS_OPTIONS,
  AC_MIN_CHARS_OPTIONS,
  SETTING_ID_AC_EMBEDDING,
  SETTING_ID_AC_LORA,
  SETTING_ID_AC_MAX_SUGGESTIONS,
  SETTING_ID_AC_MIN_CHARS,
  SETTING_ID_AC_SEPARATOR,
  SETTING_ID_AC_SPACES,
  SETTING_ID_AC_ESCAPE,
  SETTING_ID_AC_TAGS,
} from "../../../../extension/settings-catalog";
import { useCanvasSettings } from "../../../composables/useCanvasSettings";

const ui = useUiStore();
const toast = useToast();
const canvas = useCanvasSettings();

function canvasOn(id: string): boolean {
  return canvas.values.value[id] === true;
}
function canvasPick(id: string): string {
  return String(canvas.values.value[id] ?? "");
}

/* ── Tag list ─────────────────────────────────────────────────────────── */

const tagStatus = ref<TagStatus | null>(null);
const tagLoading = ref(true);
const tagBusy = ref(false);
const downloading = ref(false);

const tagPill = computed(() => {
  const s = tagStatus.value;
  if (tagLoading.value) return { text: "Checking…", tone: "" };
  if (!s?.available) return { text: "No tag list", tone: "warn" };
  const n = s.tag_count.toLocaleString();
  return { text: s.has_categories ? `${n} tags` : `${n} tags · no categories`, tone: "ok" };
});

async function loadTags(): Promise<void> {
  tagLoading.value = true;
  try {
    tagStatus.value = await api.tags.status();
  } catch {
    tagStatus.value = null;
  } finally {
    tagLoading.value = false;
  }
  // Editors cache "is a list available?" once per page. Drop it so a file
  // dropped in by hand — or one just deleted — takes effect without a reload.
  resetTagAvailability();
}

async function recheckTags(): Promise<void> {
  tagBusy.value = true;
  try {
    await loadTags();
    toast.push({
      severity: tagStatus.value?.available ? "success" : "info",
      summary: tagStatus.value?.available
        ? `${tagStatus.value.tag_count.toLocaleString()} tags found`
        : "No tag list at that path",
      life: 3000,
    });
  } finally {
    tagBusy.value = false;
  }
}

async function removeTags(): Promise<void> {
  tagBusy.value = true;
  try {
    await api.tags.remove();
    await loadTags();
    toast.push({ severity: "success", summary: "Tag list removed", life: 3000 });
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not remove the tag list",
      detail: err instanceof Error ? err.message : undefined,
      life: 5000,
    });
  } finally {
    tagBusy.value = false;
  }
}

async function downloadTags(): Promise<void> {
  downloading.value = true;
  try {
    const result = await api.tags.download();
    await loadTags();
    toast.push({ severity: "success", summary: `${result.tag_count.toLocaleString()} tags installed`, life: 4000 });
  } catch (err) {
    // The server's message names which restriction stopped the download.
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

/* ── Model folders ────────────────────────────────────────────────────── */

const counts = ref<Partial<Record<ModelKind, number>>>({});
const modelsBusy = ref(false);
/** The endpoint only exists from the version that added it, so a server not
 *  restarted since the update answers 404. Saying so beats "0 found". */
const modelsUnreachable = ref(false);

function modelPill(kind: ModelKind): { text: string; tone: string } {
  if (modelsUnreachable.value) return { text: "Restart ComfyUI to enable", tone: "warn" };
  const n = counts.value[kind];
  if (n === undefined) return { text: "Checking…", tone: "" };
  return n > 0 ? { text: `${n.toLocaleString()} found`, tone: "ok" } : { text: "None found", tone: "warn" };
}

async function loadModels(): Promise<void> {
  try {
    const res = await api.models.status();
    counts.value = Object.fromEntries(res.sources.map((s) => [s.kind, s.count]));
    modelsUnreachable.value = false;
  } catch {
    counts.value = {};
    modelsUnreachable.value = true;
  }
}

async function refreshModels(): Promise<void> {
  modelsBusy.value = true;
  try {
    const res = await api.models.refresh();
    counts.value = Object.fromEntries(res.sources.map((s) => [s.kind, s.count]));
    modelsUnreachable.value = false;
    const total = res.sources.reduce((n, s) => n + s.count, 0);
    toast.push({ severity: "success", summary: `${total.toLocaleString()} models found`, life: 3000 });
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not re-read the model folders",
      detail: err instanceof Error ? err.message : undefined,
      life: 5000,
    });
  } finally {
    modelsBusy.value = false;
  }
}

/* ── Limits ───────────────────────────────────────────────────────────── */

const limits = ref<Record<CompletionLimit, number>>({
  maxSuggestions: completionLimit("maxSuggestions"),
  minChars: completionLimit("minChars"),
});

const MAX_OPTIONS: SelectOption[] = AC_MAX_SUGGESTIONS_OPTIONS.map((o) => ({ value: o.value, label: o.text }));
const MIN_OPTIONS: SelectOption[] = AC_MIN_CHARS_OPTIONS.map((o) => ({ value: o.value, label: o.text }));

function setLimit(limit: CompletionLimit, raw: string | number | null): void {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return;
  try {
    localStorage.setItem(completionLimitStorageKey(limit), String(n));
  } catch {
    /* localStorage unavailable */
  }
  limits.value = { ...limits.value, [limit]: completionLimit(limit) };
  notifyCompletionSettingsChanged();
}

onMounted(() => {
  void loadTags();
  void loadModels();
});
</script>

<template>
  <p class="wp-set-callout">
    Each setting has two values. <b>Manager</b> is for the editors on these pages; <b>Canvas</b> is for the
    node editors in ComfyUI and is the same setting as ComfyUI › Settings › Wildcard Pipeline, kept in step
    both ways while both are open.
  </p>
  <p v-if="canvas.error.value" class="wp-set-error" role="alert" data-test="canvas-ac-error">
    Couldn't reach ComfyUI's settings: {{ canvas.error.value }}
  </p>
  <SettingGroup title="Sources">
    <SettingRow
      label="Booru tags"
      hint="Danbooru tag names while you type option values. Your $ variables and @ references always take priority."
      setting-key="ac-tags"
    >
      <template #extra>
        <p class="wp-dim wp-set-ac__path" data-test="tagac-path">{{ tagStatus?.path ?? "—" }}</p>
        <div class="wp-set-ac__actions">
          <Button variant="secondary" size="sm" :loading="downloading" data-test="tagac-download" @click="downloadTags">
            {{ tagStatus?.available ? "Replace" : "Download" }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="pi-refresh"
            :loading="tagBusy"
            data-test="tagac-refresh"
            title="Re-check the path — use after copying a file there yourself"
            @click="recheckTags"
          >Re-check</Button>
          <Button
            v-if="tagStatus?.available"
            variant="ghost"
            size="sm"
            icon="pi-trash"
            :loading="tagBusy"
            data-test="tagac-remove"
            @click="removeTags"
          >Remove</Button>
        </div>
        <!-- Stated in the UI, not only in the README: someone deciding whether
             to press a button deserves to know what it will contact first. -->
        <p class="wp-dim wp-set-ac__note">
          Download fetches a tag list from this project's GitHub release. It is the only thing this
          extension fetches from the internet, and only when you press it. You can also drop your own
          CSV at the path above.
        </p>
      </template>
      <span class="wp-set-pill" :data-tone="tagPill.tone" data-test="tagac-status">{{ tagPill.text }}</span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Manager</span>
        <Toggle
          :model-value="ui.tagAutocomplete"
          aria-label="Suggest booru tags"
          data-test="settings-tag-autocomplete"
          @update:model-value="ui.setTagAutocomplete($event)"
        />
      </span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Canvas</span>
        <Toggle
          :model-value="canvasOn(SETTING_ID_AC_TAGS)"
          aria-label="Suggest booru tags on the canvas"
          data-test="canvas-ac-tags"
          @update:model-value="canvas.set(SETTING_ID_AC_TAGS, $event)"
        />
      </span>
    </SettingRow>
    <SettingRow label="LoRAs" hint="Installed LoRA names, inserted as <lora:name:1.0>." setting-key="ac-lora">
      <span class="wp-set-pill" :data-tone="modelPill('lora').tone" data-test="lora-count">{{ modelPill("lora").text }}</span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Manager</span>
        <Toggle
          :model-value="ui.loraAutocomplete"
          aria-label="Suggest LoRAs"
          data-test="settings-lora-autocomplete"
          @update:model-value="ui.setLoraAutocomplete($event)"
        />
      </span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Canvas</span>
        <Toggle
          :model-value="canvasOn(SETTING_ID_AC_LORA)"
          aria-label="Suggest LoRAs on the canvas"
          data-test="canvas-ac-lora"
          @update:model-value="canvas.set(SETTING_ID_AC_LORA, $event)"
        />
      </span>
    </SettingRow>
    <SettingRow label="Embeddings" hint="Installed embedding names, inserted as embedding:name." setting-key="ac-embedding">
      <span class="wp-set-pill" :data-tone="modelPill('embedding').tone" data-test="embedding-count">{{ modelPill("embedding").text }}</span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Manager</span>
        <Toggle
          :model-value="ui.embeddingAutocomplete"
          aria-label="Suggest embeddings"
          data-test="settings-embedding-autocomplete"
          @update:model-value="ui.setEmbeddingAutocomplete($event)"
        />
      </span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Canvas</span>
        <Toggle
          :model-value="canvasOn(SETTING_ID_AC_EMBEDDING)"
          aria-label="Suggest embeddings on the canvas"
          data-test="canvas-ac-embedding"
          @update:model-value="canvas.set(SETTING_ID_AC_EMBEDDING, $event)"
        />
      </span>
    </SettingRow>
    <SettingRow
      label="Model folders"
      hint="Read from the models ComfyUI already knows about. Nothing is downloaded or stored. Refresh after adding a model while ComfyUI runs."
    >
      <Button variant="ghost" icon="pi-refresh" :loading="modelsBusy" data-test="models-refresh" @click="refreshModels">
        Refresh
      </Button>
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="Behavior">
    <SettingRow
      label="Append &quot;, &quot; after a pick"
      hint="Follow each completion with a comma and a space. Never applied inside a <lora:…> or embedding:… reference."
      setting-key="ac-separator"
    >
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Manager</span>
        <Toggle
          :model-value="ui.autocompleteSeparator"
          aria-label="Append a separator after a pick"
          data-test="settings-autocomplete-separator"
          @update:model-value="ui.setAutocompleteSeparator($event)"
        />
      </span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Canvas</span>
        <Toggle
          :model-value="canvasOn(SETTING_ID_AC_SEPARATOR)"
          aria-label="Append a separator after a pick on the canvas"
          data-test="canvas-ac-separator"
          @update:model-value="canvas.set(SETTING_ID_AC_SEPARATOR, $event)"
        />
      </span>
    </SettingRow>
    <SettingRow
      label="Write tags with spaces"
      hint="blue_hair goes in as blue hair. Short emoticon tags like ^_^ keep their underscores."
      setting-key="ac-spaces"
    >
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Manager</span>
        <Toggle
          :model-value="ui.autocompleteSpaces"
          aria-label="Write tags with spaces"
          data-test="settings-autocomplete-spaces"
          @update:model-value="ui.setAutocompleteSpaces($event)"
        />
      </span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Canvas</span>
        <Toggle
          :model-value="canvasOn(SETTING_ID_AC_SPACES)"
          aria-label="Write tags with spaces on the canvas"
          data-test="canvas-ac-spaces"
          @update:model-value="canvas.set(SETTING_ID_AC_SPACES, $event)"
        />
      </span>
    </SettingRow>
    <SettingRow
      label="Escape brackets in tags"
      hint="fate_(series) goes in as fate_\(series\), so the brackets are not read as a weight."
      setting-key="ac-escape"
    >
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Manager</span>
        <Toggle
          :model-value="ui.autocompleteEscapeBrackets"
          aria-label="Escape brackets in tags"
          data-test="settings-autocomplete-escape"
          @update:model-value="ui.setAutocompleteEscapeBrackets($event)"
        />
      </span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Canvas</span>
        <Toggle
          :model-value="canvasOn(SETTING_ID_AC_ESCAPE)"
          aria-label="Escape brackets in tags on the canvas"
          data-test="canvas-ac-escape"
          @update:model-value="canvas.set(SETTING_ID_AC_ESCAPE, $event)"
        />
      </span>
    </SettingRow>
    <SettingRow label="Max suggestions" hint="How many tag suggestions the popup lists at most." setting-key="ac-max">
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Manager</span>
        <Select
          :model-value="String(limits.maxSuggestions)"
          :options="MAX_OPTIONS"
          :filterable="false"
          aria-label="Max suggestions"
          data-test="settings-ac-max"
          @update:model-value="(v) => setLimit('maxSuggestions', v)"
        />
      </span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Canvas</span>
        <Select
          :model-value="canvasPick(SETTING_ID_AC_MAX_SUGGESTIONS)"
          :options="MAX_OPTIONS"
          :filterable="false"
          aria-label="Max suggestions on the canvas"
          data-test="canvas-ac-max-suggestions"
          @update:model-value="(v) => canvas.set(SETTING_ID_AC_MAX_SUGGESTIONS, String(v))"
        />
      </span>
    </SettingRow>
    <SettingRow
      label="Minimum characters"
      hint="Letters typed before tag suggestions appear. Lower shows them sooner, with a popup on almost every keystroke."
      setting-key="ac-min"
    >
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Manager</span>
        <Select
          :model-value="String(limits.minChars)"
          :options="MIN_OPTIONS"
          :filterable="false"
          aria-label="Minimum characters"
          data-test="settings-ac-min"
          @update:model-value="(v) => setLimit('minChars', v)"
        />
      </span>
      <span class="wp-set-ac__pair">
        <span class="wp-set-ac__cap">Canvas</span>
        <Select
          :model-value="canvasPick(SETTING_ID_AC_MIN_CHARS)"
          :options="MIN_OPTIONS"
          :filterable="false"
          aria-label="Minimum characters on the canvas"
          data-test="canvas-ac-min-chars"
          @update:model-value="(v) => canvas.set(SETTING_ID_AC_MIN_CHARS, String(v))"
        />
      </span>
    </SettingRow>
  </SettingGroup>
</template>

<style scoped>
.wp-set-ac__path {
  margin: 6px 0 0;
  font-family: var(--wp-font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.wp-set-ac__actions { display: flex; gap: var(--wp-space-3); flex-wrap: wrap; margin-top: var(--wp-space-4); }
.wp-set-ac__pair { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; }
.wp-set-ac__cap { font-size: 10.5px; color: var(--wp-text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.wp-set-ac__note { margin: var(--wp-space-4) 0 0; font-size: 11.5px; text-wrap: pretty; }
</style>
