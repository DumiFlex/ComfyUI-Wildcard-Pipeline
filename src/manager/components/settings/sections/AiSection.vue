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
import type { AiModelSize, AiProviderId, AiTestResult } from "../../../api/types";
import { useAiConfig } from "../../../composables/useAiConfig";
import { SUGGESTED_LOCAL_MODELS, SUGGESTED_MODEL_GROUPS } from "../ai-models";

const { config, error, save } = useAiConfig();

const PROVIDER_ORDER: AiProviderId[] = ["anthropic", "openai", "ollama", "lmstudio", "llamacpp", "custom"];

/** The provider buttons: name, where it runs, and whether a key is saved. */
const providers = computed(() => {
  const presets = config.value?.presets;
  if (!presets) return [];
  return PROVIDER_ORDER.map((id) => ({
    id,
    label: id === "custom" ? "Other (OpenAI-compatible)" : presets[id].label,
    local: presets[id].local,
    keySaved: presets[id].needs_key && !!config.value?.keys_saved?.includes(id),
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

/* ── Model size + context ───────────────────────────────────────────── */
const SIZE_LABEL: Record<string, string> = {
  small: "Small (under 20B)", medium: "Medium (20-60B)", large: "Large (over 60B, or a cloud model)",
};
const sizeOptions = computed<SelectOption[]>(() => [
  { value: "auto", label: `Automatic · ${SIZE_LABEL[config.value?.model_size_auto ?? "medium"]}` },
  ...(["small", "medium", "large"] as const).map((v) => ({ value: v, label: SIZE_LABEL[v] })),
]);
async function setSize(v: string | number | null): Promise<void> {
  if (typeof v !== "string" || v === config.value?.model_size) return;
  await patch({ model_size: v as AiModelSize });
}
const contextDraft = ref<number>(16384);
watch(() => config.value?.context_max, (v) => { if (typeof v === "number") contextDraft.value = v; }, { immediate: true });
/* Presets for both numbers; "Custom" (or a saved value that isn't one)
   shows the number box next to the dropdown. */
const CUSTOM = "custom";
const CONTEXT_PRESETS = [4096, 8192, 16384, 24576, 32768, 65536, 131072];
const contextCustom = ref(false);
const contextOptions = computed<SelectOption[]>(() => [
  ...CONTEXT_PRESETS.map((n) => ({
    value: n,
    label: `${n / 1024}k · ${n.toLocaleString("en-US")} tokens${n === 16384 ? " (recommended)" : ""}`,
  })),
  { value: CUSTOM, label: "Custom…" },
]);
const contextChoice = computed(() =>
  !contextCustom.value && CONTEXT_PRESETS.includes(contextDraft.value) ? contextDraft.value : CUSTOM);
async function pickContext(v: string | number | null): Promise<void> {
  if (v === CUSTOM) { contextCustom.value = true; return; }
  if (typeof v !== "number") return;
  contextCustom.value = false;
  contextDraft.value = v;
  await commitContext();
}
const UNLOAD_PRESETS: Array<[number, string]> = [
  [0, "Right after each answer"], [30, "30 seconds"], [60, "1 minute"], [300, "5 minutes"],
  [600, "10 minutes"], [1800, "30 minutes"], [3600, "1 hour"],
];
const unloadCustom = ref(false);
const unloadOptions: SelectOption[] = [
  ...UNLOAD_PRESETS.map(([value, label]) => ({ value, label })),
  { value: CUSTOM, label: "Custom…" },
];
const unloadChoice = computed(() =>
  !unloadCustom.value && UNLOAD_PRESETS.some(([n]) => n === unloadDraft.value) ? unloadDraft.value : CUSTOM);
async function pickUnload(v: string | number | null): Promise<void> {
  if (v === CUSTOM) { unloadCustom.value = true; return; }
  if (typeof v !== "number") return;
  unloadCustom.value = false;
  unloadDraft.value = v;
  await commitUnload();
}
async function commitContext(): Promise<void> {
  const n = Math.min(131072, Math.max(4096, Math.round(Number(contextDraft.value))));
  if (!Number.isFinite(n)) { contextDraft.value = config.value?.context_max ?? 16384; return; }
  contextDraft.value = n;
  if (n !== config.value?.context_max) await patch({ context_max: n });
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
      context: null, context_low: false, error: err instanceof Error ? err.message : "Test failed",
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
  if (t.context_low) parts.push(`only ${Math.round((t.context ?? 0) / 1024)}k context`);
  else if (t.context) parts.push(`${Math.round(t.context / 1024)}k context`);
  return parts.join(" · ");
});
const testTone = computed(() => (!test.value ? "" : test.value.ok && test.value.json_ok !== false && !test.value.context_low ? "ok" : "warn"));

const off = computed(() => !config.value?.enabled);
</script>

<template>
  <p v-if="error" class="wp-set-error" role="alert">{{ error }}</p>
  <p v-if="saveError" class="wp-set-error" role="alert" data-test="ai-save-error">{{ saveError }}</p>

  <template v-if="config">
    <div class="wp-ai-set">
      <div class="wp-ai-set__main">
        <SettingGroup title="Assistant">
          <SettingRow
            label="Turn on the AI assistant"
            hint="Adds the AI tools: drafting and editing in the module editors, Describe, Organize, the chat and the Pack builder. They use a model you already have: Claude, OpenAI, or a server on your machine. Off by default, and nothing is sent anywhere until you turn it on."
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

        <SettingGroup title="Provider" :note="off ? 'You can set this up before turning the assistant on. Test connection works once it is on.' : undefined">
          <div id="ai-provider" class="wp-ai-set__providers" role="radiogroup" aria-label="AI provider" data-setting="ai-provider" data-test="ai-provider">
            <button
              v-for="p in providers"
              :key="p.id"
              type="button"
              role="radio"
              class="wp-ai-set__provider"
              :aria-checked="config.provider === p.id ? 'true' : 'false'"
              :data-test="`ai-provider-${p.id}`"
              :title="p.local ? 'Runs on your machine' : 'A cloud service'"
              @click="setProvider(p.id)"
            >
              {{ p.label }}
              <span class="wp-ai-set__badge" :data-local="p.local ? 'true' : 'false'">{{ p.local ? "Local" : "Cloud" }}</span>
              <i v-if="p.keySaved" class="pi pi-key wp-ai-set__key-mark" title="Key saved" aria-label="key saved" data-test="ai-provider-key-saved" />
            </button>
          </div>

          <SettingRow
            form
            label="Server address"
            :hint="`Leave empty for the usual address: ${preset?.base_url || 'none for this provider, so type one'}. Looked up from the machine running ComfyUI.`"
            setting-key="ai-address"
            for="ai-address"
          >
            <Input
              id="ai-address"
              v-model="addressDraft"
              :placeholder="preset?.base_url || 'http://127.0.0.1:8000/v1'"
              class="wp-ai-set__fill wp-ai-set__mono"
              aria-label="Server address"
              data-test="ai-address"
              @blur="commitAddress"
              @keydown.enter="commitAddress"
            />
          </SettingRow>

          <SettingRow
            form
            label="Model"
            :hint="modelsError || (models.length ? `${models.length} model${models.length === 1 ? '' : 's'} on your server.` : 'Type the model name, or turn the assistant on to list them.')"
            setting-key="ai-model"
          >
            <Select
              v-if="models.length"
              :model-value="config.model || null"
              :options="modelOptions"
              placeholder="Pick a model…"
              aria-label="Model"
              data-test="ai-model"
              class="wp-ai-set__fill"
              @update:model-value="(v) => commitModel(String(v ?? ''))"
            />
            <Input
              v-else
              v-model="modelDraft"
              placeholder="e.g. huihui_ai/qwen3.5-abliterated:9b"
              aria-label="Model"
              data-test="ai-model-input"
              class="wp-ai-set__fill wp-ai-set__mono"
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
            form
            label="API key"
            :hint="config.key_from_env
              ? 'Read from an environment variable on the ComfyUI machine.'
              : preset?.needs_key
                ? 'Saved on the ComfyUI machine and never shown again. Anyone who can open your ComfyUI can use the assistant, and so your key.'
                : 'Only needed if your server asks for one.'"
            setting-key="ai-key"
            for="ai-key"
          >
            <template v-if="!config.key_from_env">
              <Input
                id="ai-key"
                v-model="keyDraft"
                type="password"
                :placeholder="config.key_set ? 'Paste a new key to replace it' : preset?.needs_key ? 'Paste your key' : `Not needed for ${preset?.label ?? 'this server'}`"
                class="wp-ai-set__fill"
                aria-label="API key"
                data-test="ai-key"
                @keydown.enter="commitKey"
              />
              <Button size="sm" :disabled="!keyDraft.trim()" data-test="ai-key-save" @click="commitKey">Save</Button>
              <Button v-if="config.key_set" size="sm" variant="ghost" data-test="ai-key-remove" @click="removeKey">Remove</Button>
            </template>
            <span v-if="keySaved" class="wp-set-pill" data-tone="ok">Saved</span>
            <span v-else-if="config.key_set" class="wp-set-pill" data-tone="ok" data-test="ai-key-set">{{ config.key_from_env ? "From environment" : "Key saved" }}</span>
          </SettingRow>

          <SettingRow form label="Test connection" hint="Lists the server's models and asks the chosen one for a tiny JSON answer." setting-key="ai-test">
            <Button size="sm" :loading="testing" :disabled="off" data-test="ai-test" @click="runTest">Test connection</Button>
            <span v-if="test" class="wp-ai-set__result" :data-tone="testTone" data-test="ai-test-result">
              <i :class="testTone === 'ok' ? 'pi pi-check-circle' : 'pi pi-exclamation-triangle'" aria-hidden="true" />{{ testSummary }}
            </span>
          </SettingRow>
          <p v-if="test?.context_low" class="wp-ai-set__ctx" role="status" data-test="ai-context-low">
            The model was loaded with {{ Math.round((test.context ?? 0) / 1024) }}k of context. The chat
            needs 16k or more: its instructions, a few turns and the answer don't fit in less. The
            server fixes this when it loads the model, so set the context length there (in LM Studio,
            in the model's load settings) and load it again.
          </p>
        </SettingGroup>

        <SettingGroup title="How the model runs">
          <SettingRow
            form
            label="Model size"
            hint="How much the assistant asks of the model. Small models get shorter instructions, smaller tool results and steadier settings; large ones get everything. Automatic reads the size from the model's name."
            setting-key="ai-model-size"
          >
            <Select
              :model-value="config.model_size"
              :options="sizeOptions"
              :filterable="false"
              aria-label="Model size"
              data-test="ai-model-size"
              @update:model-value="setSize"
            />
          </SettingRow>

          <SettingRow
            v-if="isLocal"
            form
            label="Most context to use"
            hint="Tokens of context a request may ask for. Ollama is told how much each request needs, up to this. Lower it if the model runs out of GPU memory; 16k or more keeps the chat's instructions whole. LM Studio and llama.cpp set this when the model loads, so set it there too."
            setting-key="ai-context"
            for="ai-context"
          >
            <Select
              :model-value="contextChoice"
              :options="contextOptions"
              :filterable="false"
              aria-label="Most context to use"
              data-test="ai-context-preset"
              @update:model-value="pickContext"
            />
            <Input
              v-if="contextChoice === CUSTOM"
              id="ai-context"
              v-model.number="contextDraft"
              type="number"
              :min="4096"
              :max="131072"
              :step="4096"
              class="wp-set-num"
              aria-label="Most context to use, in tokens"
              data-test="ai-context"
              @blur="commitContext"
              @keydown.enter="commitContext"
            />
          </SettingRow>

          <SettingRow
            v-if="isLocal"
            form
            label="Unload the model after"
            hint="Idle time before Ollama or LM Studio frees the GPU for ComfyUI."
            setting-key="ai-unload"
            for="ai-unload"
          >
            <Select
              :model-value="unloadChoice"
              :options="unloadOptions"
              :filterable="false"
              aria-label="Unload the model after"
              data-test="ai-unload-preset"
              @update:model-value="pickUnload"
            />
            <Input
              v-if="unloadChoice === CUSTOM"
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
        </SettingGroup>
      </div>

      <aside class="wp-ai-set__side">
        <section class="wp-ai-set__card" :data-local="isLocal ? 'true' : 'false'" data-test="ai-privacy">
          <h3 class="wp-ai-set__card-title">Where your data goes</h3>
          <p v-if="isLocal">
            <span class="wp-ai-set__badge" data-local="true">Local</span>
            <strong>Stays on your machine.</strong> {{ preset?.label }} runs locally, so what you ask about
            (the request and the module you are editing) goes only to that server.
          </p>
          <p v-else>
            <span class="wp-ai-set__badge" data-local="false">Cloud</span>
            <strong>Sent to {{ preset?.label }}.</strong> What you ask about (the request and the module
            you are editing) goes to that company under its terms. Claude and OpenAI may refuse explicit
            content; use a local model for NSFW packs.
          </p>
          <p class="wp-ai-set__muted">The assistant only proposes changes. Nothing is saved until you press Save.</p>
        </section>

        <section class="wp-ai-set__card" data-test="ai-suggested-models">
          <h3 class="wp-ai-set__card-title">Suggested local models</h3>
          <p class="wp-ai-set__muted">
            Uncensored models you run yourself. Pull one with Ollama (<code>ollama pull &lt;name&gt;</code>), or
            download it from Hugging Face for LM Studio or llama.cpp.
          </p>
          <div v-for="g in SUGGESTED_MODEL_GROUPS" :key="g.use" class="wp-ai-set__model-group" :data-test="`ai-models-${g.use}`">
            <div class="wp-ai-set__model-group-title">{{ g.title }}</div>
            <div class="wp-ai-set__muted">{{ g.note }}</div>
            <ul class="wp-ai-set__models">
              <li v-for="m in SUGGESTED_LOCAL_MODELS.filter((x) => x.use === g.use)" :key="m.name" class="wp-ai-set__model">
                <span class="wp-ai-set__vram" title="GPU memory">{{ m.vram }}</span>
                <div class="wp-ai-set__model-body">
                  <code>{{ m.name }}</code>
                  <span class="wp-ai-set__muted">{{ m.goodFor }}</span>
                  <span class="wp-ai-set__links">
                    <a v-if="m.ollamaUrl" :href="m.ollamaUrl" target="_blank" rel="noopener noreferrer" data-test="ai-model-ollama">Ollama</a>
                    <a :href="m.hfUrl" target="_blank" rel="noopener noreferrer" data-test="ai-model-hf">Hugging Face</a>
                  </span>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </aside>
    </div>
  </template>
</template>

<style scoped>
.wp-ai-set {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: var(--wp-space-7, 24px);
  align-items: start;
}
.wp-ai-set__side { position: sticky; top: var(--wp-space-6); display: flex; flex-direction: column; gap: var(--wp-space-6); }
@media (max-width: 1180px) {
  .wp-ai-set { grid-template-columns: minmax(0, 1fr); }
  .wp-ai-set__side { position: static; }
}

/* Provider buttons, each with where it runs. */
.wp-ai-set__providers { display: flex; flex-wrap: wrap; gap: var(--wp-space-3); padding: var(--wp-space-5) var(--wp-space-6); border-bottom: 1px solid var(--wp-border); }
.wp-ai-set__provider {
  display: inline-flex; align-items: center; gap: var(--wp-space-3);
  height: 32px; padding: 0 var(--wp-space-5);
  font: inherit; font-size: var(--wp-text-sm); color: var(--wp-text);
  background: var(--wp-bg-1, var(--wp-bg)); border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: var(--wp-radius); cursor: pointer;
}
.wp-ai-set__provider:hover { border-color: var(--wp-accent-500); }
.wp-ai-set__provider[aria-checked="true"] {
  border-color: var(--wp-accent-500); color: var(--wp-accent-text);
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
}
.wp-ai-set__badge {
  display: inline-block; padding: 1px 5px; border-radius: var(--wp-radius-sm);
  font-family: var(--wp-font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--wp-warn); background: color-mix(in oklab, var(--wp-warn) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 40%, transparent);
}
.wp-ai-set__badge[data-local="true"] {
  color: var(--wp-success); background: color-mix(in oklab, var(--wp-success) 14%, transparent);
  border-color: color-mix(in oklab, var(--wp-success) 40%, transparent);
}
.wp-ai-set__key-mark { font-size: 11px; color: var(--wp-text-dim); }

.wp-ai-set__fill { flex: 1 1 220px; min-width: 0; }
.wp-ai-set__fill :deep(input), .wp-ai-set__mono :deep(input), .wp-ai-set__mono { font-family: var(--wp-font-mono); font-size: 12px; }
/* The test result can be a long error: let it wrap inside the row. */
.wp-ai-set__result {
  flex: 1 1 200px; min-width: 0; display: inline-flex; gap: 6px; align-items: baseline;
  font-size: var(--wp-text-sm); color: var(--wp-success);
}
.wp-ai-set__result[data-tone="warn"] { color: var(--wp-warn); }
.wp-ai-set__result i { font-size: 12px; flex: none; }
.wp-ai-set__ctx {
  margin: 0;
  padding: var(--wp-space-4) var(--wp-space-6);
  font-size: var(--wp-text-sm);
  color: var(--wp-warn);
  border-top: 1px solid var(--wp-border);
}

/* Side cards. */
.wp-ai-set__card {
  padding: var(--wp-space-5) var(--wp-space-6);
  background: var(--wp-bg-2); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-lg, 10px);
  font-size: var(--wp-text-sm); line-height: 1.55; color: var(--wp-text-muted);
  display: flex; flex-direction: column; gap: var(--wp-space-3);
}
.wp-ai-set__card[data-local="true"] { border-color: color-mix(in oklab, var(--wp-success) 45%, var(--wp-border)); }
.wp-ai-set__card[data-local="false"] { border-color: color-mix(in oklab, var(--wp-warn) 45%, var(--wp-border)); }
.wp-ai-set__card p { margin: 0; }
.wp-ai-set__card strong { color: var(--wp-text); }
.wp-ai-set__card .wp-ai-set__badge { margin-right: 4px; }
.wp-ai-set__card-title {
  margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--wp-text-dim);
}
.wp-ai-set__muted { color: var(--wp-text-dim); font-size: 12px; }
.wp-ai-set__card code { font-family: var(--wp-font-mono); font-size: 12px; color: var(--wp-text); }
.wp-ai-set__model-group { margin-top: var(--wp-space-3); }
.wp-ai-set__model-group-title { font-weight: 600; color: var(--wp-text); }
.wp-ai-set__models { list-style: none; margin: var(--wp-space-3) 0 0; padding: 0; }
.wp-ai-set__model { display: flex; gap: var(--wp-space-4); padding: var(--wp-space-3) 0; border-top: 1px solid var(--wp-border); }
.wp-ai-set__vram {
  flex: none; width: 58px; font-family: var(--wp-font-mono); font-size: 11px; color: var(--wp-text-muted); padding-top: 1px;
}
.wp-ai-set__model-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wp-ai-set__model-body code { overflow-wrap: anywhere; }
.wp-ai-set__links { font-size: 12px; white-space: nowrap; }
.wp-ai-set__links a { color: var(--wp-accent); text-decoration: none; }
.wp-ai-set__links a:hover { text-decoration: underline; }
.wp-ai-set__links a + a { margin-left: var(--wp-space-4); }
</style>
