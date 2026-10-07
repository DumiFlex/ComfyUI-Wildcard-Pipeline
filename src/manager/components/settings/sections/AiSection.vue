<script setup lang="ts">
/**
 * Settings › AI assistant. The user brings the model: Claude, OpenAI, or a
 * server they run (Ollama, LM Studio, llama.cpp, anything OpenAI-compatible).
 * Off by default. Everything here is saved on the ComfyUI side
 * (`/wp/api/ai/config`), and the API key is write-only: the page can set or
 * remove it, never read it back.
 */
import { computed, ref, watch } from "vue";
import Toggle from "../../ui/Toggle.vue";
import Select from "../../ui/Select.vue";
import Input from "../../ui/Input.vue";
import Button from "../../ui/Button.vue";
import type { SelectOption } from "../../ui/select-types";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import { api } from "../../../api/client";
import type { AiProviderId, AiTestResult } from "../../../api/types";
import { useAiConfig } from "../../../composables/useAiConfig";
import { SUGGESTED_LOCAL_MODELS } from "../ai-models";

const { config, error, save } = useAiConfig();

const PROVIDER_ORDER: AiProviderId[] = ["anthropic", "openai", "ollama", "lmstudio", "llamacpp", "custom"];

const providerOptions = computed<SelectOption[]>(() => {
  const presets = config.value?.presets;
  if (!presets) return [];
  return PROVIDER_ORDER.map((id) => ({
    value: id,
    label: `${presets[id].label} · ${presets[id].local ? "runs on your machine" : "cloud"}`,
  }));
});

const preset = computed(() => (config.value ? config.value.presets[config.value.provider] : null));
const isLocal = computed(() => preset.value?.local ?? true);

const saveError = ref("");
async function patch(p: Parameters<typeof save>[0]): Promise<boolean> {
  saveError.value = "";
  try {
    await save(p);
    return true;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "Could not save";
    return false;
  }
}

/* ── Address ─────────────────────────────────────────────────────────── */
const addressDraft = ref("");
watch(() => config.value?.base_url, (v) => { addressDraft.value = v ?? ""; }, { immediate: true });
async function commitAddress(): Promise<void> {
  if (!config.value || addressDraft.value.trim() === config.value.base_url) return;
  if (!(await patch({ base_url: addressDraft.value }))) addressDraft.value = config.value.base_url;
  else void refreshModels();
}

/* ── Key ─────────────────────────────────────────────────────────────── */
const keyDraft = ref("");
const keySaved = ref(false);
async function commitKey(): Promise<void> {
  if (!keyDraft.value.trim()) return;
  if (await patch({ api_key: keyDraft.value.trim() })) {
    keyDraft.value = "";
    keySaved.value = true;
    window.setTimeout(() => { keySaved.value = false; }, 1600);
    void refreshModels();
  }
}
async function removeKey(): Promise<void> {
  await patch({ api_key: "" });
}

/* ── Models ──────────────────────────────────────────────────────────── */
const models = ref<string[]>([]);
const modelsError = ref("");
const loadingModels = ref(false);
async function refreshModels(): Promise<void> {
  if (!config.value?.enabled) return;
  loadingModels.value = true;
  modelsError.value = "";
  try {
    models.value = (await api.ai.models()).models;
  } catch (err) {
    models.value = [];
    modelsError.value = err instanceof Error ? err.message : "Couldn't list models";
  } finally {
    loadingModels.value = false;
  }
}
const modelOptions = computed<SelectOption[]>(() => {
  const names = new Set(models.value);
  if (config.value?.model) names.add(config.value.model);
  return [...names].map((m) => ({ value: m, label: m }));
});
const modelDraft = ref("");
watch(() => config.value?.model, (v) => { modelDraft.value = v ?? ""; }, { immediate: true });
async function commitModel(name: string): Promise<void> {
  const v = name.trim();
  if (!config.value || v === config.value.model) return;
  await patch({ model: v });
  test.value = null;
}

/* ── Unload ──────────────────────────────────────────────────────────── */
const unloadDraft = ref<number>(60);
watch(() => config.value?.unload_after_s, (v) => { if (typeof v === "number") unloadDraft.value = v; }, { immediate: true });
async function commitUnload(): Promise<void> {
  const n = Math.min(3600, Math.max(0, Math.round(Number(unloadDraft.value))));
  if (!Number.isFinite(n)) { unloadDraft.value = config.value?.unload_after_s ?? 60; return; }
  unloadDraft.value = n;
  if (n !== config.value?.unload_after_s) await patch({ unload_after_s: n });
}

/* ── Provider / on-off ───────────────────────────────────────────────── */
async function setProvider(id: string | number | null): Promise<void> {
  if (typeof id !== "string" || id === config.value?.provider) return;
  models.value = [];
  test.value = null;
  if (await patch({ provider: id as AiProviderId })) void refreshModels();
}
async function setEnabled(on: boolean): Promise<void> {
  if (await patch({ enabled: on }) && on) void refreshModels();
}

watch(() => config.value?.enabled, (on) => { if (on && models.value.length === 0) void refreshModels(); }, { immediate: true });

/* ── Test connection ─────────────────────────────────────────────────── */
const test = ref<AiTestResult | null>(null);
const testing = ref(false);
async function runTest(): Promise<void> {
  testing.value = true;
  try {
    test.value = await api.ai.test();
    if (test.value.models.length) models.value = test.value.models;
  } catch (err) {
    test.value = {
      ok: false, models: [], model_found: null, json_ok: null, latency_ms: null,
      error: err instanceof Error ? err.message : "Test failed",
    };
  } finally {
    testing.value = false;
  }
}
const testSummary = computed(() => {
  const t = test.value;
  if (!t) return "";
  if (!t.ok) return t.error ?? "Couldn't connect";
  if (t.json_ok === null) return `Connected · ${t.models.length} model${t.models.length === 1 ? "" : "s"} found. Pick one to finish the test.`;
  const parts = ["Connected"];
  parts.push(t.json_ok ? "JSON answers ✓" : "JSON answers ✗ (try another model)");
  if (t.latency_ms !== null) parts.push(`${(t.latency_ms / 1000).toFixed(1)} s`);
  if (t.model_found === false) parts.push("model not in the server's list");
  return parts.join(" · ");
});
const testTone = computed(() => (!test.value ? "" : test.value.ok && test.value.json_ok !== false ? "ok" : "warn"));

const off = computed(() => !config.value?.enabled);
</script>

<template>
  <p v-if="error" class="wp-set-error" role="alert">{{ error }}</p>
  <p v-if="saveError" class="wp-set-error" role="alert" data-test="ai-save-error">{{ saveError }}</p>

  <template v-if="config">
    <SettingGroup title="Assistant">
      <SettingRow
        label="Turn on the AI assistant"
        hint="Adds Draft with AI to the editors. It uses a model you already have: Claude, OpenAI, or a server on your machine. Off by default, and nothing is sent anywhere until you turn it on."
        setting-key="ai-enabled"
      >
        <Toggle
          :model-value="config.enabled"
          aria-label="Turn on the AI assistant"
          data-test="ai-enabled"
          @update:model-value="setEnabled"
        />
      </SettingRow>
    </SettingGroup>

    <SettingGroup title="Model" :note="off ? 'You can set this up before turning the assistant on. Test connection works once it is on.' : undefined">
      <SettingRow label="Provider" hint="Who runs the model." setting-key="ai-provider">
        <Select
          :model-value="config.provider"
          :options="providerOptions"
          :filterable="false"
          aria-label="AI provider"
          data-test="ai-provider"
          @update:model-value="setProvider"
        />
      </SettingRow>

      <SettingRow
        label="Server address"
        :hint="`Leave empty for the usual address: ${preset?.base_url || 'none for this provider, so type one'}. The address is looked up from the machine running ComfyUI.`"
        setting-key="ai-address"
        for="ai-address"
      >
        <Input
          id="ai-address"
          v-model="addressDraft"
          :placeholder="preset?.base_url || 'http://127.0.0.1:8000/v1'"
          class="wp-ai-set__wide"
          aria-label="Server address"
          data-test="ai-address"
          @blur="commitAddress"
          @keydown.enter="commitAddress"
        />
      </SettingRow>

      <SettingRow
        label="API key"
        :hint="config.key_from_env
          ? 'Read from an environment variable on the ComfyUI machine.'
          : preset?.needs_key
            ? 'Saved on the ComfyUI machine and never shown again. Anyone who can open your ComfyUI can use the assistant, and so your key.'
            : 'Only needed if your server asks for one.'"
        setting-key="ai-key"
        for="ai-key"
      >
        <span v-if="keySaved" class="wp-set-pill" data-tone="ok">Saved</span>
        <span v-else-if="config.key_set" class="wp-set-pill" data-tone="ok" data-test="ai-key-set">{{ config.key_from_env ? "From environment" : "Key saved" }}</span>
        <template v-if="!config.key_from_env">
          <Input
            id="ai-key"
            v-model="keyDraft"
            type="password"
            :placeholder="config.key_set ? 'Paste a new key to replace it' : 'Paste your key'"
            class="wp-ai-set__key"
            aria-label="API key"
            data-test="ai-key"
            @keydown.enter="commitKey"
          />
          <Button size="sm" :disabled="!keyDraft.trim()" data-test="ai-key-save" @click="commitKey">Save</Button>
          <Button v-if="config.key_set" size="sm" variant="ghost" data-test="ai-key-remove" @click="removeKey">Remove</Button>
        </template>
      </SettingRow>

      <SettingRow
        label="Model"
        :hint="modelsError || (models.length ? 'Models your server offers.' : 'Type the model name, or turn the assistant on to list them.')"
        setting-key="ai-model"
      >
        <Select
          v-if="models.length"
          :model-value="config.model || null"
          :options="modelOptions"
          placeholder="Pick a model…"
          aria-label="Model"
          data-test="ai-model"
          class="wp-ai-set__wide"
          @update:model-value="(v) => commitModel(String(v ?? ''))"
        />
        <Input
          v-else
          v-model="modelDraft"
          placeholder="e.g. huihui_ai/qwen3.5-abliterated:9b"
          aria-label="Model"
          data-test="ai-model-input"
          class="wp-ai-set__wide"
          @blur="commitModel(modelDraft)"
          @keydown.enter="commitModel(modelDraft)"
        />
        <Button
          size="sm"
          variant="ghost"
          icon="pi-refresh"
          :loading="loadingModels"
          :disabled="off"
          aria-label="Refresh the model list"
          data-test="ai-models-refresh"
          @click="refreshModels"
        />
      </SettingRow>

      <SettingRow
        v-if="isLocal"
        label="Unload the model after"
        hint="Seconds of no use before Ollama or LM Studio frees the GPU for ComfyUI. 0 unloads right after each answer."
        setting-key="ai-unload"
        for="ai-unload"
      >
        <Input
          id="ai-unload"
          v-model.number="unloadDraft"
          type="number"
          :min="0"
          :max="3600"
          :step="10"
          class="wp-set-num"
          aria-label="Unload the model after, in seconds"
          data-test="ai-unload"
          @blur="commitUnload"
          @keydown.enter="commitUnload"
        />
      </SettingRow>

      <SettingRow label="Test connection" hint="Lists the server's models and asks the chosen one for a tiny JSON answer." setting-key="ai-test">
        <span v-if="test" class="wp-set-pill" :data-tone="testTone" data-test="ai-test-result">{{ testSummary }}</span>
        <Button size="sm" :loading="testing" :disabled="off" data-test="ai-test" @click="runTest">Test connection</Button>
      </SettingRow>
    </SettingGroup>

    <SettingGroup title="Where your data goes">
      <div class="wp-ai-set__privacy" :data-local="isLocal ? 'true' : 'false'" data-test="ai-privacy">
        <template v-if="isLocal">
          <strong>Stays on your machine.</strong> {{ preset?.label }} runs locally, so what you ask about
          (the request and the module you are editing) goes only to that server.
        </template>
        <template v-else>
          <strong>Sent to {{ preset?.label }}.</strong> What you ask about (the request and the module
          you are editing) goes to that company under its terms. Claude and OpenAI may refuse explicit
          content; use a local model for NSFW packs.
        </template>
        The assistant only proposes changes. Nothing is saved until you press Save.
      </div>
    </SettingGroup>

    <SettingGroup title="Suggested local models" note="Uncensored builds that don't refuse NSFW words. Pull one with Ollama (ollama pull <name>) or load the same model in LM Studio.">
      <table class="wp-ai-set__models" data-test="ai-suggested-models">
        <thead><tr><th>GPU memory</th><th>Model</th><th>Good for</th></tr></thead>
        <tbody>
          <tr v-for="m in SUGGESTED_LOCAL_MODELS" :key="m.name">
            <td>{{ m.vram }}</td>
            <td><code>{{ m.name }}</code></td>
            <td>{{ m.goodFor }}</td>
          </tr>
        </tbody>
      </table>
    </SettingGroup>
  </template>
</template>

<style scoped>
.wp-ai-set__wide { width: 320px; max-width: 100%; }
.wp-ai-set__key { width: 240px; max-width: 100%; }
.wp-ai-set__privacy {
  padding: var(--wp-space-5) var(--wp-space-6);
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  line-height: 1.55;
  border-left: 3px solid var(--wp-warn);
}
.wp-ai-set__privacy[data-local="true"] { border-left-color: var(--wp-success); }
.wp-ai-set__privacy strong { color: var(--wp-text); }
.wp-ai-set__models { width: 100%; border-collapse: collapse; font-size: var(--wp-text-sm); }
.wp-ai-set__models th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
  padding: var(--wp-space-4) var(--wp-space-6);
}
.wp-ai-set__models td {
  padding: var(--wp-space-4) var(--wp-space-6);
  border-top: 1px solid var(--wp-border);
  color: var(--wp-text-muted);
}
.wp-ai-set__models code { font-family: var(--wp-font-mono); font-size: 12px; color: var(--wp-text); }
</style>
