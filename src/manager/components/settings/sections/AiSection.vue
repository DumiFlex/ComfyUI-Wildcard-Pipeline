<script setup lang="ts">
/**
 * Settings › AI assistant. The user brings the model: Claude, OpenAI, or a
 * server they run (Ollama, LM Studio, llama.cpp, anything OpenAI-compatible).
 * Off by default. Everything here is saved on the ComfyUI side
 * (`/wp/api/ai/config`), and the API key is write-only: the page can set or
 * remove it, never read it back.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Toggle from "../../ui/Toggle.vue";
import Select from "../../ui/Select.vue";
import Input from "../../ui/Input.vue";
import Button from "../../ui/Button.vue";
import type { SelectOption } from "../../ui/select-types";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import { api } from "../../../api/client";
import type { AiConfigPatch, AiEmbedApi, AiIndexStatus, AiModelSize, AiProviderId, AiTestResult, AiToolFormat } from "../../../api/types";
import { useAiConfig } from "../../../composables/useAiConfig";
import { SUGGESTIONS_SOURCE_NOTE, hfRepo, suggestionsFor, type SuggestedModel } from "../ai-models";
import { useUiStore } from "../../../stores/uiStore";

const ui = useUiStore();
const { config, error, save } = useAiConfig();

const PROVIDER_ORDER: AiProviderId[] = ["anthropic", "openai", "openrouter", "ollama", "lmstudio", "llamacpp", "custom"];

/** The provider buttons: name, where it runs, and whether a key is saved. */
const providers = computed(() => {
  const presets = config.value?.presets;
  if (!presets) return [];
  return PROVIDER_ORDER.map((id) => ({
    id,
    label: id === "custom" ? "Other (OpenAI-compatible)" : presets[id].label,
    // The chosen provider shows where it really runs ("Other" set to an
    // internet address is a cloud service).
    local: id === config.value?.provider ? config.value.local ?? presets[id].local : presets[id].local,
    keySaved: presets[id].needs_key && !!config.value?.keys_saved?.includes(id),
  }));
});

const preset = computed(() => (config.value ? config.value.presets[config.value.provider] : null));
const isLocal = computed(() => config.value?.local ?? preset.value?.local ?? true);

/* ── Suggested models (only the selected provider's list) ────────────── */
const suggestions = computed(() => (config.value ? suggestionsFor(config.value.provider, isLocal.value) : null));
/** Ollama takes the pull name; LM Studio and llama.cpp users start from the repo. */
function suggestedName(m: SuggestedModel): string {
  return suggestions.value?.key === "local" && config.value?.provider !== "ollama" ? hfRepo(m) : m.name;
}

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
  else {
    void refreshModels();
    if (!config.value.embed_base_url) void refreshEmbedModels();
  }
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

const toolFormatOptions: SelectOption[] = [
  { value: "auto", label: "Automatic" },
  { value: "native", label: "Native tool calls" },
  { value: "json", label: "JSON steps" },
];
const thinkingOptions: SelectOption[] = [
  { value: "auto", label: "As the model does" },
  { value: "off", label: "Off: answer straight away" },
];
async function setThinking(v: string | number | null): Promise<void> {
  if ((v !== "auto" && v !== "off") || v === config.value?.thinking) return;
  await patch({ thinking: v });
}
async function setToolFormat(v: string | number | null): Promise<void> {
  if (typeof v !== "string" || v === config.value?.tool_format) return;
  await patch({ tool_format: v as AiToolFormat });
}

/* ── Meaning search ──────────────────────────────────────────────────── */
/* Some chat servers can't embed (Claude, a llama.cpp chat server): then
   meaning search needs an embedding server of its own. */
const embedPossible = computed(() => (preset.value?.embeds ?? true) || embedSeparate.value);
/** Names that look like embedding models, so the dropdown offers them first. */
const EMBED_NAME = /embed|bge|minilm|e5-|gte-|nomic|arctic/i;
const OFF = "";
const embedModels = ref<string[]>([]);
const embedModelsError = ref("");
const loadingEmbedModels = ref(false);
/** The embedding server's models: its own address (with its own key), or
 *  the chat server's when it has none. */
async function refreshEmbedModels(): Promise<void> {
  if (!config.value?.enabled || !embedPossible.value) return;
  loadingEmbedModels.value = true;
  embedModelsError.value = "";
  try {
    embedModels.value = (await api.ai.models("embed")).models;
  } catch (err) {
    embedModels.value = [];
    embedModelsError.value = err instanceof Error ? err.message : "Couldn't list models";
  } finally {
    loadingEmbedModels.value = false;
  }
}
watch(() => [config.value?.enabled, config.value?.provider] as const, ([on]) => {
  embedModels.value = [];
  if (on) void refreshEmbedModels();
}, { immediate: true });
const embedOptions = computed<SelectOption[]>(() => {
  let names = embedModels.value.filter((m) => EMBED_NAME.test(m));
  // A server just for embeddings may name them anything.
  if (!names.length && embedSeparate.value) names = [...embedModels.value];
  const cur = config.value?.embed_model;
  if (cur && !names.includes(cur)) names.unshift(cur);
  return [{ value: OFF, label: "Off" }, ...names.map((m) => ({ value: m, label: m })), { value: CUSTOM, label: "Type a name…" }];
});
const embedHint = computed(() => {
  const note = !embedSeparate.value ? preset.value?.embed_note ?? "" : "";
  if (!embedPossible.value) return `${note || "This server can't embed."} Until then the chat searches by words.`;
  const suggest = !embedSeparate.value && preset.value?.embed_model ? ` ${preset.value.label} suggestion: ${preset.value.embed_model}.` : "";
  const base = `Meaning search: the chat also finds items by what they mean, so “warm colors” finds amber and crimson. Needs a small embedding model.${suggest} Off keeps search to words.`;
  const all = note ? `${base} ${note}` : base;
  if (embedModelsError.value) return `${all} Couldn't list the embedding server's models: ${embedModelsError.value}`;
  return all;
});
const EMBED_APIS: SelectOption[] = [
  { value: "auto", label: "Guess from the address" },
  { value: "ollama", label: "Ollama" },
  { value: "openai", label: "OpenAI-compatible (/embeddings)" },
];
async function setEmbedApi(v: string | number | null): Promise<void> {
  if (typeof v !== "string" || v === config.value?.embed_api) return;
  if (await patch({ embed_api: v as AiEmbedApi })) {
    test.value = null;
    void refreshEmbedModels();
  }
}
const embedTyping = ref(false);
const embedDraft = ref("");
watch(() => config.value?.embed_model, (v) => { embedDraft.value = v ?? ""; }, { immediate: true });
const embedChoice = computed(() => (embedTyping.value ? CUSTOM : config.value?.embed_model ?? OFF));
async function commitEmbedModel(name: string): Promise<void> {
  const v = name.trim();
  if (!config.value || v === config.value.embed_model) { embedTyping.value = false; return; }
  if (await patch({ embed_model: v })) {
    embedTyping.value = false;
    test.value = null;
    void loadIndex();
  }
}
async function pickEmbed(v: string | number | null): Promise<void> {
  if (v === CUSTOM) { embedTyping.value = true; return; }
  await commitEmbedModel(typeof v === "string" ? v : "");
}
const embedAddressDraft = ref("");
watch(() => config.value?.embed_base_url, (v) => { embedAddressDraft.value = v ?? ""; }, { immediate: true });
async function commitEmbedAddress(): Promise<void> {
  if (!config.value || embedAddressDraft.value.trim() === config.value.embed_base_url) return;
  if (!(await patch({ embed_base_url: embedAddressDraft.value.trim() }))) {
    embedAddressDraft.value = config.value.embed_base_url;
  } else {
    test.value = null;
    void refreshEmbedModels();
  }
}
/** The address and key the chat server uses, for comparing origins. */
function originOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return "";
  }
}
/** The embedding server is another machine (or port) than the chat server,
 *  so it needs its own key when it asks for one. */
const embedSeparate = computed(() => {
  const c = config.value;
  if (!c?.embed_base_url) return false;
  return originOf(c.embed_base_url) !== originOf(c.base_url || preset.value?.base_url || "");
});
const embedKeyDraft = ref("");
const embedKeySaved = ref(false);
async function commitEmbedKey(): Promise<void> {
  if (!embedKeyDraft.value.trim()) return;
  if (await patch({ embed_api_key: embedKeyDraft.value.trim() })) {
    embedKeyDraft.value = "";
    embedKeySaved.value = true;
    window.setTimeout(() => { embedKeySaved.value = false; }, 1600);
    void refreshEmbedModels();
  }
}
async function removeEmbedKey(): Promise<void> {
  if (await patch({ embed_api_key: "" })) void refreshEmbedModels();
}

/* ── Library index ───────────────────────────────────────────────────── */
/* Web search (off by default): SearXNG at the user's own address, or a
 * keyed engine. The key is bound to that engine's host on the server. */
const searchOptions = computed<SelectOption[]>(() => [
  { value: "off", label: "Off" },
  ...Object.entries(config.value?.search_engines ?? {}).map(([id, e]) => ({ value: id, label: e.label })),
]);
const searchEngine = computed(() => {
  const id = config.value?.search_engine;
  return id && id !== "off" ? config.value?.search_engines[id] ?? null : null;
});
const searchKeySet = computed(() => {
  const id = config.value?.search_engine;
  return !!id && id !== "off" && (config.value?.search_keys_saved ?? []).includes(id);
});
async function setSearchEngine(v: string | number | null): Promise<void> {
  if (typeof v === "string") await patch({ search_engine: v as AiConfigPatch["search_engine"] });
}
const searchUrlDraft = ref("");
watch(() => config.value?.search_url, (v) => { searchUrlDraft.value = v ?? ""; }, { immediate: true });
async function commitSearchUrl(): Promise<void> {
  if (!config.value || searchUrlDraft.value.trim() === config.value.search_url) return;
  if (!(await patch({ search_url: searchUrlDraft.value.trim() }))) {
    searchUrlDraft.value = config.value.search_url;
  }
}
const searchKeyDraft = ref("");
async function commitSearchKey(): Promise<void> {
  if (!searchKeyDraft.value.trim()) return;
  if (await patch({ search_key: searchKeyDraft.value.trim() })) searchKeyDraft.value = "";
}
async function removeSearchKey(): Promise<void> {
  await patch({ search_key: "" });
}

/* Reading result pages: built in (plain page text), or the user's own
 * Crawl4AI / Firecrawl server. Every preset is listed whatever is set up. */
const readerOptions = computed<SelectOption[]>(() => [
  { value: "off", label: "Off" },
  ...Object.entries(config.value?.reader_engines ?? {}).map(([id, e]) => ({ value: id, label: e.label })),
]);
const reader = computed(() => {
  const id = config.value?.reader_engine;
  return id && id !== "off" ? config.value?.reader_engines[id] ?? null : null;
});
const readerKeySet = computed(() => {
  const id = config.value?.reader_engine;
  return !!id && id !== "off" && (config.value?.reader_keys_saved ?? []).includes(id);
});
async function setReader(v: string | number | null): Promise<void> {
  if (typeof v === "string") await patch({ reader_engine: v as AiConfigPatch["reader_engine"] });
}
const readerUrlDraft = ref("");
watch(() => config.value?.reader_url, (v) => { readerUrlDraft.value = v ?? ""; }, { immediate: true });
async function commitReaderUrl(): Promise<void> {
  if (!config.value || readerUrlDraft.value.trim() === config.value.reader_url) return;
  if (!(await patch({ reader_url: readerUrlDraft.value.trim() }))) {
    readerUrlDraft.value = config.value.reader_url;
  }
}
const readerKeyDraft = ref("");
async function commitReaderKey(): Promise<void> {
  if (!readerKeyDraft.value.trim()) return;
  if (await patch({ reader_key: readerKeyDraft.value.trim() })) readerKeyDraft.value = "";
}
async function removeReaderKey(): Promise<void> {
  await patch({ reader_key: "" });
}

/* Safety notices: what leaves the machine once a web feature is on. The
 * user can dismiss each one (remembered in this browser). */
const NOTICE_KEY = "wp-ai-notices-dismissed";
function readDismissed(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(NOTICE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
const dismissed = ref<string[]>(readDismissed());
function dismissNotice(id: string): void {
  dismissed.value = [...dismissed.value, id];
  try {
    localStorage.setItem(NOTICE_KEY, JSON.stringify(dismissed.value));
  } catch {
    /* private window: the notice comes back next time */
  }
}
function showNoticesAgain(): void {
  dismissed.value = [];
  try {
    localStorage.removeItem(NOTICE_KEY);
  } catch {
    /* nothing stored */
  }
}
const webNotice = computed(() => !!config.value
  && (config.value.search_engine !== "off" || config.value.danbooru_lookup)
  && !dismissed.value.includes("web"));
const alwaysNotice = computed(() => !!config.value?.web_always_allow
  && !dismissed.value.includes("always"));

const index = ref<AiIndexStatus | null>(null);
const indexError = ref("");
const rebuilding = ref(false);
let indexTimer: number | undefined;
async function loadIndex(): Promise<void> {
  window.clearTimeout(indexTimer);
  if (!config.value?.enabled) { index.value = null; return; }
  try {
    index.value = await api.ai.index();
    indexError.value = "";
  } catch (err) {
    indexError.value = err instanceof Error ? err.message : "Couldn't read the index";
  }
  /* While vectors are being made, show them coming in. */
  if (index.value?.filling) indexTimer = window.setTimeout(() => { void loadIndex(); }, 3000);
}
async function rebuildIndex(): Promise<void> {
  rebuilding.value = true;
  try {
    index.value = await api.ai.rebuildIndex();
    indexError.value = "";
    if (index.value.filling) indexTimer = window.setTimeout(() => { void loadIndex(); }, 3000);
  } catch (err) {
    indexError.value = err instanceof Error ? err.message : "Couldn't rebuild the index";
  } finally {
    rebuilding.value = false;
  }
}
onBeforeUnmount(() => window.clearTimeout(indexTimer));
watch(() => config.value?.enabled, () => { void loadIndex(); }, { immediate: true });
const indexSummary = computed(() => {
  const i = index.value;
  if (!i) return "";
  if (!i.available) return "This Python has no SQLite full-text search, so the chat searches without an index.";
  const parts = [`${i.items.toLocaleString("en-US")} item${i.items === 1 ? "" : "s"} indexed`];
  if (i.embed_model) {
    parts.push(i.vectors >= i.items
      ? "all searchable by meaning"
      : `${i.vectors.toLocaleString("en-US")} searchable by meaning${i.filling ? " (adding the rest…)" : ""}`);
  }
  return parts.join(" · ");
});

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
  if (t.embed) parts.push(t.embed.ok ? `embeddings ✓ (${t.embed.dims})` : "embeddings ✗");
  return parts.join(" · ");
});
/** The fixed prefix every chat request starts with, split into its parts. */
const prefixLine = computed(() => {
  const p = test.value?.prefix;
  if (!p) return "";
  const k = (n: number): string => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`);
  const bits: string[] = [];
  if (p.parts) {
    bits.push(`instructions ${k(p.parts.instructions)}`);
    if (p.parts.tools) bits.push(`${p.tools} tool declarations ${k(p.parts.tools)}`);
    else bits.push(`${p.tools} tools listed in the instructions`);
    bits.push(`library summary ${k(p.parts.library)}`);
  }
  const room = Math.round(p.window / 1024);
  const fits = p.fits ?? p.tokens < p.window;
  return `Fixed prefix ≈ ${k(p.tokens)} tokens${bits.length ? `: ${bits.join(", ")}` : ""}. `
    + "Every request of a new chat starts with it, before your messages. "
    + (fits
      ? `It fits the model's ${room}k window.`
      : `It doesn't fit the model's ${room}k window: load the model with more context${p.size === "small" ? "" : ", or set Model size to Small"}.`);
});
const testTone = computed(() => {
  const t = test.value;
  if (!t) return "";
  const embedOk = !t.embed || (t.embed.ok && !t.embed.swapped);
  return t.ok && t.json_ok !== false && !t.context_low && embedOk ? "ok" : "warn";
});

const off = computed(() => !config.value?.enabled);
</script>

<template>
  <p v-if="error" class="wp-set-error" role="alert">{{ error }}</p>
  <p v-if="saveError" class="wp-set-error" role="alert" data-test="ai-save-error">{{ saveError }}</p>

  <div v-if="config" class="wp-ai-set-wrap">
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
            <span v-else-if="config.key_for_host" class="wp-set-pill" data-tone="warn" data-test="ai-key-elsewhere">Saved for {{ config.key_for_host }}</span>
          </SettingRow>
          <p v-if="config.key_for_host && !config.key_set" class="wp-ai-set__ctx" role="status" data-test="ai-key-elsewhere-note">
            The key was saved for {{ config.key_for_host }}, so it isn't sent to this address. A key
            only ever goes to the address it was given for; paste it again to use it here, or set
            the address back.
          </p>

          <SettingRow form label="Test connection" hint="Lists the server's models, asks the chosen one for a tiny JSON answer, and says how much of the model's context a new chat's instructions, tools and library summary take before you type anything." setting-key="ai-test">
            <Button size="sm" :loading="testing" :disabled="off" data-test="ai-test" @click="runTest">Test connection</Button>
            <span v-if="test" class="wp-ai-set__result" :data-tone="testTone" data-test="ai-test-result">
              <i :class="testTone === 'ok' ? 'pi pi-check-circle' : 'pi pi-exclamation-triangle'" aria-hidden="true" />{{ testSummary }}
            </span>
          </SettingRow>
          <p v-if="prefixLine" class="wp-ai-set__prefix" :data-tone="test?.prefix?.fits === false ? 'warn' : undefined" data-test="ai-prefix">
            {{ prefixLine }}
          </p>
          <p v-if="test?.context_low" class="wp-ai-set__ctx" role="status" data-test="ai-context-low">
            The model was loaded with {{ Math.round((test.context ?? 0) / 1024) }}k of context. The chat
            needs 16k or more: its instructions, a few turns and the answer don't fit in less. The
            server fixes this when it loads the model, so set the context length there (in LM Studio,
            in the model's load settings) and load it again.
          </p>
          <p v-if="test?.embed && !test.embed.ok" class="wp-ai-set__ctx" role="status" data-test="ai-embed-error">
            The embedding model didn't answer: {{ test.embed.error }}
          </p>
          <p v-else-if="test?.embed?.swapped" class="wp-ai-set__ctx" role="status" data-test="ai-embed-swapped">
            Loading the embedding model pushed the chat model out of memory, so every search would
            reload it and throw away what it had read. Ollama keeps only one model loaded here (its
            default on Windows with a Radeon GPU). Set <code>OLLAMA_MAX_LOADED_MODELS=2</code> on the
            Ollama machine and restart it, or turn meaning search off.
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
            hint="Tokens of context the assistant uses. Ollama gets this much for the whole chat (changing it reloads the model, which throws away what it already read); drafts ask for what they need, up to this. Lower it if the model runs out of GPU memory; 16k or more keeps the chat's instructions whole. LM Studio and llama.cpp set this when the model loads, so set it there too."
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
            form
            label="Thinking"
            hint="Thinking models (Qwen3, DeepSeek R1, …) reason before they answer, which takes time and counts against the reply's limit: a long think can leave a cut-off answer. Off asks the server to skip it (Ollama, llama.cpp, LM Studio, OpenRouter and OpenAI understand this; a model that must reason ignores it)."
            setting-key="ai-thinking"
          >
            <Select
              :model-value="config.thinking ?? 'auto'"
              :options="thinkingOptions"
              :filterable="false"
              aria-label="Thinking"
              data-test="ai-thinking"
              class="wp-ai-set__fill"
              @update:model-value="setThinking"
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

        <SettingGroup title="Search">
          <SettingRow
            form
            label="Embedding server"
            hint="Where the embedding model runs. Leave empty to use the chat server above. For another server, type its address: an Ollama address (http://host:11434), or an OpenAI-style one ending in /v1, like llama.cpp started with --embeddings, https://api.openai.com/v1 or https://openrouter.ai/api/v1."
            setting-key="ai-embed-address"
            for="ai-embed-address"
          >
            <Input
              id="ai-embed-address"
              v-model="embedAddressDraft"
              :placeholder="`Same as the chat server (${config.base_url || preset?.base_url || 'not set'})`"
              class="wp-ai-set__fill wp-ai-set__mono"
              aria-label="Embedding server address"
              data-test="ai-embed-address"
              @blur="commitEmbedAddress"
              @keydown.enter="commitEmbedAddress"
            />
          </SettingRow>

          <SettingRow
            v-if="embedSeparate"
            form
            label="Embedding server type"
            hint="How to talk to the embedding server. The guess reads a bare address (host:port) as Ollama and one with a path (…/v1) as OpenAI-compatible."
            setting-key="ai-embed-api"
          >
            <Select
              :model-value="config.embed_api"
              :options="EMBED_APIS"
              aria-label="Embedding server type"
              data-test="ai-embed-api"
              class="wp-ai-set__fill"
              @update:model-value="setEmbedApi"
            />
          </SettingRow>

          <SettingRow
            v-if="embedSeparate"
            form
            label="Embedding server key"
            hint="Only needed if the embedding server asks for one. Saved on the ComfyUI machine, never shown again, and only sent to this embedding address."
            setting-key="ai-embed-key"
            for="ai-embed-key"
          >
            <Input
              id="ai-embed-key"
              v-model="embedKeyDraft"
              type="password"
              :placeholder="config.embed_key_own ? 'Paste a new key to replace it' : 'Paste a key if the server needs one'"
              class="wp-ai-set__fill"
              aria-label="Embedding server key"
              data-test="ai-embed-key"
              @keydown.enter="commitEmbedKey"
            />
            <Button size="sm" :disabled="!embedKeyDraft.trim()" data-test="ai-embed-key-save" @click="commitEmbedKey">Save</Button>
            <Button v-if="config.embed_key_own" size="sm" variant="ghost" data-test="ai-embed-key-remove" @click="removeEmbedKey">Remove</Button>
            <span v-if="embedKeySaved" class="wp-set-pill" data-tone="ok">Saved</span>
            <span v-else-if="config.embed_key_own" class="wp-set-pill" data-tone="ok" data-test="ai-embed-key-set">Key saved</span>
          </SettingRow>

          <SettingRow
            form
            label="Embedding model"
            :hint="embedHint"
            setting-key="ai-embed-model"
            for="ai-embed-model"
          >
            <Select
              v-if="!embedTyping"
              :model-value="embedChoice"
              :options="embedOptions"
              :filterable="embedOptions.length > 12"
              :disabled="!embedPossible"
              aria-label="Embedding model"
              data-test="ai-embed-model"
              class="wp-ai-set__fill"
              @update:model-value="pickEmbed"
            />
            <Input
              v-else
              id="ai-embed-model"
              v-model="embedDraft"
              placeholder="e.g. nomic-embed-text"
              aria-label="Embedding model name"
              data-test="ai-embed-model-input"
              class="wp-ai-set__fill wp-ai-set__mono"
              @blur="commitEmbedModel(embedDraft)"
              @keydown.enter="commitEmbedModel(embedDraft)"
            />
            <Button
              v-if="embedPossible"
              size="sm"
              variant="ghost"
              icon="pi-refresh"
              :loading="loadingEmbedModels"
              :disabled="off"
              aria-label="List the embedding server's models again"
              data-test="ai-embed-models-refresh"
              @click="refreshEmbedModels"
            />
          </SettingRow>

          <SettingRow
            form
            label="Library index"
            hint="The chat searches your library through this index and hands the model the items a message seems to be about. It keeps itself up to date; rebuild it if search seems off."
            setting-key="ai-index"
          >
            <span class="wp-ai-set__index" data-test="ai-index-status">
              {{ off ? "Turn the assistant on to build it." : indexError || indexSummary || "Reading…" }}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon="pi-refresh"
              :loading="rebuilding"
              :disabled="off || !index?.available || index?.filling"
              data-test="ai-index-rebuild"
              @click="rebuildIndex"
            >
              Rebuild
            </Button>
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="Chat">
          <SettingRow
            label="Show Explain on selected text"
            hint="Select text anywhere in the manager (docs, replies, warnings) and a small Explain / Ask bar appears above it. Ctrl+Shift+X explains the selection without it. The browser's right-click menu is left alone. Saved in this browser."
            setting-key="ai-explain-chip"
          >
            <Toggle
              :model-value="ui.explainChip"
              aria-label="Show Explain on selected text"
              data-test="ai-explain-chip"
              @update:model-value="(v: boolean) => ui.setExplainChip(v)"
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="Permissions" note="The assistant can't change these itself.">
          <SettingRow
            label="Let the assistant delete items"
            hint="The chat can propose deleting modules, bundles, templates, categories and tags. Each delete card still asks you to confirm, and Undo brings everything back. Off by default."
            setting-key="ai-allow-delete"
          >
            <Toggle
              :model-value="config.allow_delete"
              aria-label="Let the assistant delete items"
              data-test="ai-allow-delete"
              @update:model-value="(v: boolean) => patch({ allow_delete: v })"
            />
          </SettingRow>
          <SettingRow
            label="Apply small changes automatically"
            hint="New descriptions, tags and categories from the chat are applied without a click. Each card says it was applied and keeps its Undo. Ratings, content, renames and deletes always wait for you. Off by default."
            setting-key="ai-auto-apply"
          >
            <Toggle
              :model-value="config.auto_apply"
              aria-label="Apply small changes automatically"
              data-test="ai-auto-apply"
              @update:model-value="(v: boolean) => patch({ auto_apply: v })"
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="Web search">
          <SettingRow
            form
            label="Search engine"
            hint="Lets the chat look things up on the web. Each search shows you its exact words first, and you allow it once, for the chat, or not at all. Short result snippets come back; a page is only read when you allow it (Read result pages)."
            setting-key="ai-search-engine"
          >
            <Select
              :model-value="config.search_engine"
              :options="searchOptions"
              :filterable="false"
              aria-label="Search engine"
              data-test="ai-search-engine"
              @update:model-value="setSearchEngine"
            />
          </SettingRow>

          <SettingRow
            v-if="config.search_engine === 'searxng'"
            form
            label="SearXNG address"
            hint="Your SearXNG server. JSON output must be on: add json to search.formats in its settings.yml."
            setting-key="ai-search-url"
            for="ai-search-url"
          >
            <Input
              id="ai-search-url"
              v-model="searchUrlDraft"
              placeholder="http://127.0.0.1:8888"
              class="wp-ai-set__fill wp-ai-set__mono"
              aria-label="SearXNG address"
              data-test="ai-search-url"
              @blur="commitSearchUrl"
              @keydown.enter="commitSearchUrl"
            />
          </SettingRow>

          <SettingRow
            v-else-if="searchEngine?.needs_key"
            form
            :label="`${searchEngine.label} key`"
            hint="Saved on the ComfyUI machine, never shown again, and only ever sent to this engine."
            setting-key="ai-search-key"
            for="ai-search-key"
          >
            <Input
              id="ai-search-key"
              v-model="searchKeyDraft"
              type="password"
              :placeholder="searchKeySet ? 'Paste a new key to replace it' : 'Paste your key'"
              class="wp-ai-set__fill"
              aria-label="Search engine key"
              data-test="ai-search-key"
              @keydown.enter="commitSearchKey"
            />
            <Button size="sm" :disabled="!searchKeyDraft.trim()" data-test="ai-search-key-save" @click="commitSearchKey">Save</Button>
            <Button v-if="searchKeySet" size="sm" variant="ghost" data-test="ai-search-key-remove" @click="removeSearchKey">Remove</Button>
            <span v-if="searchKeySet" class="wp-set-pill" data-tone="ok" data-test="ai-search-key-set">Key saved</span>
          </SettingRow>

          <SettingRow
            form
            label="Read result pages"
            hint="When a snippet isn't enough, the chat can ask to read one page its search returned (never any other link). Built in fetches the page from ComfyUI and keeps its text, a few thousand characters; it skips pages on your own network. Crawl4AI or Firecrawl render pages in a browser on a server you run (Firecrawl also has a hosted API), for sites that need JavaScript. Needs web search."
            setting-key="ai-reader"
          >
            <Select
              :model-value="config.reader_engine"
              :options="readerOptions"
              :filterable="false"
              aria-label="Read result pages"
              data-test="ai-reader"
              @update:model-value="setReader"
            />
          </SettingRow>

          <SettingRow
            v-if="config.reader_engine === 'crawl4ai' || config.reader_engine === 'firecrawl'"
            form
            :label="`${reader?.label ?? 'Reader'} address`"
            :hint="config.reader_engine === 'crawl4ai' ? 'Your Crawl4AI server, e.g. http://127.0.0.1:11235.' : 'Leave empty for Firecrawl\'s hosted API, or type your own Firecrawl server.'"
            setting-key="ai-reader-url"
            for="ai-reader-url"
          >
            <Input
              id="ai-reader-url"
              v-model="readerUrlDraft"
              :placeholder="config.reader_engine === 'crawl4ai' ? 'http://127.0.0.1:11235' : 'https://api.firecrawl.dev'"
              class="wp-ai-set__fill wp-ai-set__mono"
              :aria-label="`${reader?.label ?? 'Reader'} address`"
              data-test="ai-reader-url"
              @blur="commitReaderUrl"
              @keydown.enter="commitReaderUrl"
            />
          </SettingRow>

          <SettingRow
            v-if="config.reader_engine === 'crawl4ai' || config.reader_engine === 'firecrawl'"
            form
            :label="`${reader?.label ?? 'Reader'} key`"
            :hint="config.reader_engine === 'firecrawl' ? 'Needed for the hosted API. Saved on the ComfyUI machine and only sent to this address.' : 'Only if your server asks for a token. Saved on the ComfyUI machine and only sent to this address.'"
            setting-key="ai-reader-key"
            for="ai-reader-key"
          >
            <Input
              id="ai-reader-key"
              v-model="readerKeyDraft"
              type="password"
              :placeholder="readerKeySet ? 'Paste a new key to replace it' : 'Paste your key'"
              class="wp-ai-set__fill"
              aria-label="Page reader key"
              data-test="ai-reader-key"
              @keydown.enter="commitReaderKey"
            />
            <Button size="sm" :disabled="!readerKeyDraft.trim()" data-test="ai-reader-key-save" @click="commitReaderKey">Save</Button>
            <Button v-if="readerKeySet" size="sm" variant="ghost" data-test="ai-reader-key-remove" @click="removeReaderKey">Remove</Button>
            <span v-if="readerKeySet" class="wp-set-pill" data-tone="ok">Key saved</span>
          </SettingRow>

          <SettingRow
            label="Danbooru tag lookup"
            hint="Lets the chat look a tag up on danbooru.donmai.us: what it means (wiki), its aliases, what it implies and the tags used with it most. Read only, tags and wiki only, never posts or images, one request a second. Each lookup asks you first. For spellings and post counts the downloaded tag list is enough and stays offline."
            setting-key="ai-danbooru"
          >
            <Toggle
              :model-value="config.danbooru_lookup"
              aria-label="Danbooru tag lookup"
              data-test="ai-danbooru"
              @update:model-value="(v: boolean) => patch({ danbooru_lookup: v })"
            />
          </SettingRow>

          <SettingRow
            label="Don't ask before web calls"
            hint="Web searches, page reads and Danbooru lookups run without the Allow card. The chat then decides what leaves your machine; you still see each one in its steps."
            setting-key="ai-web-always"
          >
            <Toggle
              :model-value="config.web_always_allow"
              aria-label="Don't ask before web calls"
              data-test="ai-web-always"
              @update:model-value="(v: boolean) => patch({ web_always_allow: v })"
            />
          </SettingRow>

          <div v-if="webNotice" class="wp-ai-set__ctx" role="note" data-test="ai-web-notice">
            <p>
              <strong>What leaves your machine.</strong> A web search sends its words to the engine you
              picked; a page read fetches that page; a Danbooru lookup asks Danbooru about one tag. Those
              services' own terms and laws apply, and what you search for and use is up to you. Text from
              the web is handed to the model as data, never as instructions.
            </p>
            <Button size="sm" variant="ghost" data-test="ai-web-notice-dismiss" @click="dismissNotice('web')">Got it</Button>
          </div>
          <div v-if="alwaysNotice" class="wp-ai-set__ctx" role="note" data-test="ai-always-notice">
            <p>
              <strong>No Allow card.</strong> A web page or a library item could ask the model to search
              for something you didn't mean to send. With this on, nothing stops that before it goes out.
            </p>
            <Button size="sm" variant="ghost" data-test="ai-always-notice-dismiss" @click="dismissNotice('always')">Got it</Button>
          </div>
          <p v-if="dismissed.length" class="wp-ai-set__muted">
            <button type="button" class="wp-ai-set__link" data-test="ai-notices-again" @click="showNoticesAgain">Show dismissed notices again</button>
          </p>
        </SettingGroup>

        <SettingGroup title="Advanced">
          <SettingRow
            form
            label="Tool format"
            hint="How the chat calls its tools. Native tool calls are what most models are trained for; the JSON step format works with any model. Automatic uses native calls when the server says the model supports them. Applies to new chats."
            setting-key="ai-tool-format"
          >
            <Select
              :model-value="config.tool_format"
              :options="toolFormatOptions"
              :filterable="false"
              aria-label="Tool format"
              data-test="ai-tool-format"
              @update:model-value="setToolFormat"
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

        <section v-if="suggestions" class="wp-ai-set__card wp-ai-set__card--models" data-test="ai-suggested-models" :data-group="suggestions.key">
          <h3 class="wp-ai-set__card-title">Suggested models</h3>
          <p class="wp-ai-set__muted" data-test="ai-models-source">{{ SUGGESTIONS_SOURCE_NOTE }}</p>
          <p class="wp-ai-set__muted">{{ suggestions.intro }}</p>
          <div v-for="g in suggestions.groups" :key="g.title" class="wp-ai-set__model-group" :data-test="`ai-models-${g.models[0]?.use ?? 'group'}`">
            <div class="wp-ai-set__model-group-title">{{ g.title }}</div>
            <div class="wp-ai-set__muted">{{ g.note }}</div>
            <ul class="wp-ai-set__models">
              <li v-for="m in g.models" :key="m.name" class="wp-ai-set__model" data-test="ai-model-row">
                <div class="wp-ai-set__model-head">
                  <code>{{ suggestedName(m) }}</code>
                  <span v-if="m.tested" class="wp-ai-set__tested" data-test="ai-model-tested">Tested</span>
                  <span v-if="m.vram || m.price" class="wp-ai-set__vram" :title="m.vram ? 'GPU memory' : 'USD per million tokens, input / output'">{{ m.vram ?? m.price }}</span>
                </div>
                <div class="wp-ai-set__muted">
                  {{ m.goodFor }}.
                  <span v-if="m.hfUrl" class="wp-ai-set__links">
                    <a v-if="m.ollamaUrl && config.provider === 'ollama'" :href="m.ollamaUrl" target="_blank" rel="noopener noreferrer" data-test="ai-model-ollama">Ollama</a>
                    <a :href="m.hfUrl" target="_blank" rel="noopener noreferrer" data-test="ai-model-hf">Hugging Face</a>
                  </span>
                  <a v-if="m.pageUrl" :href="m.pageUrl" target="_blank" rel="noopener noreferrer" data-test="ai-model-page">Price and details</a>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* The side cards drop below once the section is narrow, whatever makes it
 * narrow (a small window, or the AI chat open beside it). */
.wp-ai-set-wrap { container-type: inline-size; }
.wp-ai-set {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: var(--wp-space-7, 24px);
  align-items: start;
}
.wp-ai-set__side { position: sticky; top: var(--wp-space-6); display: flex; flex-direction: column; gap: var(--wp-space-6); }
@container (max-width: 900px) {
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
.wp-ai-set__ctx code { font-family: var(--wp-font-mono); font-size: 12px; }
.wp-ai-set__prefix {
  margin: 0;
  padding: var(--wp-space-4) var(--wp-space-6);
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  border-top: 1px solid var(--wp-border);
}
.wp-ai-set__prefix[data-tone="warn"] { color: var(--wp-warn); }
.wp-ai-set__index { flex: 1 1 200px; min-width: 0; font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-ai-set__ctx {
  margin: 0;
  padding: var(--wp-space-4) var(--wp-space-6);
  font-size: var(--wp-text-sm);
  color: var(--wp-warn);
  border-top: 1px solid var(--wp-border);
}
div.wp-ai-set__ctx { display: flex; align-items: flex-start; gap: var(--wp-space-4); }
div.wp-ai-set__ctx p { margin: 0; flex: 1; color: var(--wp-text-muted); }
div.wp-ai-set__ctx strong { color: var(--wp-text); }
p.wp-ai-set__muted:has(.wp-ai-set__link) { padding: var(--wp-space-2) var(--wp-space-6); }
.wp-ai-set__link {
  padding: 0; border: 0; background: none; cursor: pointer;
  font: inherit; color: var(--wp-accent); text-decoration: underline;
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
.wp-ai-set__card--models { gap: var(--wp-space-2); line-height: 1.45; }
.wp-ai-set__model-group { margin-top: var(--wp-space-3); }
.wp-ai-set__model-group-title { font-weight: 600; color: var(--wp-text); }
.wp-ai-set__models { list-style: none; margin: var(--wp-space-2) 0 0; padding: 0; }
.wp-ai-set__model { padding: var(--wp-space-2) 0; border-top: 1px solid var(--wp-border); }
.wp-ai-set__model-head { display: flex; align-items: baseline; gap: var(--wp-space-3); }
.wp-ai-set__model-head code { min-width: 0; overflow-wrap: anywhere; }
.wp-ai-set__vram {
  flex: none; margin-left: auto; font-family: var(--wp-font-mono); font-size: 11px; color: var(--wp-text-muted); white-space: nowrap;
}
.wp-ai-set__tested {
  flex: none; padding: 0 6px; font-size: 10px; font-weight: 600; line-height: 16px; border-radius: 999px;
  color: var(--wp-success); background: color-mix(in oklab, var(--wp-success) 14%, transparent);
}
.wp-ai-set__links { white-space: nowrap; }
.wp-ai-set__links a { color: var(--wp-accent); text-decoration: none; }
.wp-ai-set__links a:hover { text-decoration: underline; }
.wp-ai-set__links a + a { margin-left: var(--wp-space-4); }
</style>
