import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AiSection from "../sections/AiSection.vue";
import Select from "../../ui/Select.vue";
import { SUGGESTED_LOCAL_MODELS, SUGGESTED_MODELS, suggestionsFor } from "../ai-models";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import type { AiConfig, AiIndexStatus } from "../../../api/types";

vi.mock("../../../api/client", () => ({
  api: { ai: { config: vi.fn(), saveConfig: vi.fn(), models: vi.fn(), test: vi.fn(), index: vi.fn(), rebuildIndex: vi.fn() } },
  ApiError: class ApiError extends Error {},
}));

const PRESETS: AiConfig["presets"] = {
  anthropic: { label: "Claude", api: "anthropic", local: false, needs_key: true, base_url: "https://api.anthropic.com", embeds: false, embed_model: "", embed_note: "Claude has no embeddings." },
  openai: { label: "OpenAI", api: "openai", local: false, needs_key: true, base_url: "https://api.openai.com/v1", embeds: true, embed_model: "", embed_note: "" },
  openrouter: { label: "OpenRouter", api: "openai", local: false, needs_key: true, base_url: "https://openrouter.ai/api/v1", embeds: true, embed_model: "", embed_note: "" },
  ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "http://127.0.0.1:11434", embeds: true, embed_model: "", embed_note: "" },
  lmstudio: { label: "LM Studio", api: "openai", local: true, needs_key: false, base_url: "http://127.0.0.1:1234/v1", embeds: true, embed_model: "", embed_note: "" },
  llamacpp: { label: "llama.cpp", api: "openai", local: true, needs_key: false, base_url: "http://127.0.0.1:8080/v1", embeds: false, embed_model: "", embed_note: "" },
  custom: { label: "Other", api: "openai", local: true, needs_key: false, base_url: "", embeds: true, embed_model: "", embed_note: "" },
};

function cfg(over: Partial<AiConfig> = {}): AiConfig {
  return {
    enabled: false, provider: "ollama", base_url: "", model: "", unload_after_s: 60,
    context_max: 16384, model_size: "auto", model_size_auto: "medium", tool_format: "auto", thinking: "auto", allow_delete: false, auto_apply: false, embed_model: "", embed_base_url: "", embed_api: "auto", search_engine: "off", search_url: "", search_keys_saved: [], search_engines: { searxng: { label: "SearXNG", needs_key: false }, brave: { label: "Brave Search", needs_key: true }, tavily: { label: "Tavily", needs_key: true }, kagi: { label: "Kagi", needs_key: true } }, reader_engine: "builtin", reader_url: "", reader_keys_saved: [], reader_engines: { builtin: { label: "Built in (page text)", needs_key: false, needs_url: false, base_url: "" }, crawl4ai: { label: "Crawl4AI (your server)", needs_key: false, needs_url: true, base_url: "" }, firecrawl: { label: "Firecrawl", needs_key: true, needs_url: false, base_url: "https://api.firecrawl.dev" } }, danbooru_lookup: false, web_always_allow: false, key_for_host: null,
    key_set: false, key_from_env: false, keys_saved: [], presets: PRESETS, embed_key_set: false, embed_key_own: false,
    local: PRESETS[over.provider ?? "ollama"].local, ...over,
  };
}

const INDEX: AiIndexStatus = { available: true, items: 120, embed_model: null, vectors: 0, filling: false };

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div/>" } }] });

describe("Settings › AI assistant", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockReset();
    vi.mocked(api.ai.saveConfig).mockReset();
    vi.mocked(api.ai.models).mockReset().mockResolvedValue({ models: ["a", "b"] });
    vi.mocked(api.ai.test).mockReset();
    vi.mocked(api.ai.index).mockReset().mockResolvedValue(INDEX);
    vi.mocked(api.ai.rebuildIndex).mockReset();
  });

  it("starts off, with Test connection disabled and the local privacy note", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg());
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.get('[data-test="ai-test"]').attributes("disabled")).toBeDefined();
    expect(w.get('[data-test="ai-privacy"]').text()).toContain("Stays on your machine");
    const card = w.get('[data-test="ai-suggested-models"]');
    expect(card.text()).toContain("Only the ones marked Tested were tried");
    expect(card.text()).toContain("ollama pull");
    const ollama = w.findAll('[data-test="ai-model-ollama"]');
    const hf = w.findAll('[data-test="ai-model-hf"]');
    expect(ollama.length).toBe(SUGGESTED_LOCAL_MODELS.filter((m) => m.ollamaUrl).length);
    expect(w.find('[data-test="ai-models-writing"]').text()).toContain("HammerAI/cydonia-v4.3:24b-q4_K_M");
    expect(w.find('[data-test="ai-models-building"]').text()).toContain("hf.co/filvyb/Qwen3.5-9B-heretic-v2-GGUF:Q4_K_M");
    expect(card.text()).not.toContain("Rocinante");
    expect(hf.length).toBe(SUGGESTED_LOCAL_MODELS.length);
    expect(w.findAll('[data-test="ai-model-tested"]').length).toBe(SUGGESTED_LOCAL_MODELS.filter((m) => m.tested).length);
    for (const a of [...ollama, ...hf]) {
      expect(a.attributes("href")).toMatch(/^https:\/\/(ollama\.com|huggingface\.co)\//);
      expect(a.attributes("target")).toBe("_blank");
      expect(a.attributes("rel")).toContain("noopener");
    }
    expect(api.ai.models).not.toHaveBeenCalled();
  });

  it("saves a key once and never shows it", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ provider: "anthropic" }));
    vi.mocked(api.ai.saveConfig).mockResolvedValue(cfg({ provider: "anthropic", key_set: true }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.get('[data-test="ai-privacy"]').text()).toContain("Sent to Claude");
    await w.get('[data-test="ai-key"]').setValue("sk-123");
    await w.get('[data-test="ai-key-save"]').trigger("click");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ api_key: "sk-123" });
    expect((w.get('[data-test="ai-key"]').element as HTMLInputElement).value).toBe("");
    expect(w.html()).not.toContain("sk-123");
  });

  it("lists models once on and shows the test result", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, model: "a" }));
    vi.mocked(api.ai.test).mockResolvedValue({
      ok: true, models: ["a", "b"], model_found: true, json_ok: true, latency_ms: 1400, context: null, context_low: false, error: null,
    });
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    expect(api.ai.models).toHaveBeenCalled();
    await w.get('[data-test="ai-test"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-test-result"]').text()).toBe("Connected · JSON answers ✓ · 1.4 s");
  });

  it("shows a failed test", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true }));
    vi.mocked(api.ai.test).mockResolvedValue({
      ok: false, models: [], model_found: null, json_ok: null, latency_ms: null,
      context: null, context_low: false, error: "couldn't connect to 127.0.0.1:11434. Is the server running?",
    });
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    await w.get('[data-test="ai-test"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-test-result"]').attributes("data-tone")).toBe("warn");
    expect(w.get('[data-test="ai-test-result"]').text()).toContain("Is the server running?");
  });

  it("turning it on saves and lists models", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg());
    vi.mocked(api.ai.saveConfig).mockResolvedValue(cfg({ enabled: true }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    await w.get('[data-test="ai-enabled"]').trigger("click");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ enabled: true });
    expect(api.ai.models).toHaveBeenCalled();
  });

  it("saves the permissions, both off by default", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg());
    vi.mocked(api.ai.saveConfig).mockImplementation(async (p) => cfg(p as Partial<AiConfig>));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.get('[data-test="ai-allow-delete"] [aria-checked]').attributes("aria-checked")).toBe("false");
    expect(w.get('[data-test="ai-auto-apply"] [aria-checked]').attributes("aria-checked")).toBe("false");
    await w.get('[data-test="ai-allow-delete"]').trigger("click");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ allow_delete: true });
    await w.get('[data-test="ai-auto-apply"]').trigger("click");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ auto_apply: true });
  });

  it("marks cloud providers that already have a saved key", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ keys_saved: ["anthropic"] }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.find('[data-test="ai-provider-anthropic"] [data-test="ai-provider-key-saved"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-provider-openai"] [data-test="ai-provider-key-saved"]').exists()).toBe(false);
    expect(w.get('[data-test="ai-provider-anthropic"]').text()).toContain("Cloud");
    expect(w.get('[data-test="ai-provider-ollama"]').text()).toContain("Local");
  });

  it("switches provider from its button", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({}));
    vi.mocked(api.ai.saveConfig).mockImplementation(async (p) => cfg(p as Partial<AiConfig>));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    await w.get('[data-test="ai-provider-lmstudio"]').trigger("click");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ provider: "lmstudio" });
  });

  it("warns when a local server loaded the model with a small context", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, provider: "lmstudio", model: "a" }));
    vi.mocked(api.ai.test).mockResolvedValue({
      ok: true, models: ["a"], model_found: true, json_ok: true, latency_ms: 900,
      context: 4096, context_low: true, error: null,
    });
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    await w.get('[data-test="ai-test"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("only 4k context");
    expect(w.get('[data-test="ai-context-low"]').text()).toContain("loaded with 4k of context");
  });

  it("saves the tool format", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, model: "m" }));
    vi.mocked(api.ai.saveConfig).mockImplementation(async (p) => cfg({ enabled: true, model: "m", ...p }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    const fmt = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-tool-format")!;
    expect(fmt.props("modelValue")).toBe("auto");
    fmt.vm.$emit("update:modelValue", "json");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ tool_format: "json" });
    vi.mocked(api.ai.saveConfig).mockClear();
    fmt.vm.$emit("update:modelValue", "json");
    await flushPromises();
    expect(api.ai.saveConfig).not.toHaveBeenCalled();
  });

  it("saves the model size and the context cap", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, model: "qwen3.6:27b" }));
    vi.mocked(api.ai.saveConfig).mockImplementation(async (p) => cfg({ enabled: true, ...p }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    const size = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-model-size");
    expect(size).toBeTruthy();
    size!.vm.$emit("update:modelValue", "small");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ model_size: "small" });
    const pick = (name: string) => w.findAllComponents(Select).find((c) => c.attributes("data-test") === name)!;
    // Presets: 16k is a preset, so no number box until Custom.
    expect(w.find('[data-test="ai-context"]').exists()).toBe(false);
    pick("ai-context-preset").vm.$emit("update:modelValue", 32768);
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ context_max: 32768 });
    pick("ai-unload-preset").vm.$emit("update:modelValue", 300);
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ unload_after_s: 300 });
    pick("ai-context-preset").vm.$emit("update:modelValue", "custom");
    await flushPromises();
    const ctx = w.get('[data-test="ai-context"] input, input[data-test="ai-context"]');
    await ctx.setValue(1000);
    await ctx.trigger("blur");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ context_max: 4096 });
  });

  it("turns meaning search on from the embedding model list", async () => {
    vi.mocked(api.ai.models).mockResolvedValue({ models: ["qwen3.5:9b", "nomic-embed-text:latest"] });
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, model: "qwen3.5:9b" }));
    vi.mocked(api.ai.saveConfig).mockImplementation(async (p) => cfg({ enabled: true, model: "qwen3.5:9b", ...p }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    const embed = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-embed-model")!;
    // Only names that look like embedding models are offered.
    const values = (embed.props("options") as Array<{ value: unknown }>).map((o) => o.value);
    expect(values).toEqual(["", "nomic-embed-text:latest", "custom"]);
    // The embedding server row is always there; its type only for another server.
    expect(w.find('[data-test="ai-embed-address"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-embed-api"]').exists()).toBe(false);
    vi.mocked(api.ai.index).mockResolvedValue({ ...INDEX, embed_model: "nomic-embed-text:latest", vectors: 32, filling: true });
    embed.vm.$emit("update:modelValue", "nomic-embed-text:latest");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ embed_model: "nomic-embed-text:latest" });
    expect(w.find('[data-test="ai-embed-address"]').exists()).toBe(true);
    expect(w.get('[data-test="ai-index-status"]').text()).toBe("120 items indexed · 32 searchable by meaning (adding the rest…)");
    expect(w.get('[data-test="ai-index-rebuild"]').attributes("disabled")).toBeDefined();
    w.unmount();
  });

  it("sets up web search: an engine, then its key or address", async () => {
    let saved = cfg({ enabled: true, model: "a" });
    vi.mocked(api.ai.config).mockResolvedValue(saved);
    vi.mocked(api.ai.saveConfig).mockImplementation(async (p) => {
      const keys = p.search_key ? [saved.search_engine as "brave"] : saved.search_keys_saved;
      saved = { ...saved, ...p, search_keys_saved: keys } as AiConfig;
      return saved;
    });
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    const engine = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-search-engine")!;
    expect((engine.props("options") as Array<{ value: unknown }>).map((o) => o.value))
      .toEqual(["off", "searxng", "brave", "tavily", "kagi"]);
    expect(w.find('[data-test="ai-search-key"]').exists()).toBe(false);
    engine.vm.$emit("update:modelValue", "brave");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ search_engine: "brave" });
    await w.get('[data-test="ai-search-key"]').setValue("bk-1");
    await w.get('[data-test="ai-search-key-save"]').trigger("click");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ search_key: "bk-1" });
    expect(w.get('[data-test="ai-search-key-set"]').text()).toBe("Key saved");
    engine.vm.$emit("update:modelValue", "searxng");
    await flushPromises();
    await w.get('[data-test="ai-search-url"]').setValue("http://127.0.0.1:8888");
    await w.get('[data-test="ai-search-url"]').trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ search_url: "http://127.0.0.1:8888" });
    w.unmount();
  });

  it("lists every page reader, asks the Crawl4AI address, and the Danbooru and no-ask switches", async () => {
    localStorage.removeItem("wp-ai-notices-dismissed");
    let saved = cfg({ enabled: true, model: "a" });
    vi.mocked(api.ai.config).mockResolvedValue(saved);
    vi.mocked(api.ai.saveConfig).mockImplementation(async (p) => {
      saved = { ...saved, ...p } as AiConfig;
      return saved;
    });
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    const readerSel = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-reader")!;
    // Every preset, set up or not.
    expect((readerSel.props("options") as Array<{ value: unknown }>).map((o) => o.value))
      .toEqual(["off", "builtin", "crawl4ai", "firecrawl"]);
    expect(w.find('[data-test="ai-reader-url"]').exists()).toBe(false);
    readerSel.vm.$emit("update:modelValue", "crawl4ai");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ reader_engine: "crawl4ai" });
    await w.get('[data-test="ai-reader-url"]').setValue("http://127.0.0.1:11235");
    await w.get('[data-test="ai-reader-url"]').trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ reader_url: "http://127.0.0.1:11235" });
    expect(w.find('[data-test="ai-web-notice"]').exists()).toBe(false);
    w.findAllComponents({ name: "Toggle" }).find((c) => c.attributes("data-test") === "ai-danbooru")!
      .vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ danbooru_lookup: true });
    // Turning a web feature on shows what leaves the machine, once.
    expect(w.get('[data-test="ai-web-notice"]').text()).toContain("What leaves your machine");
    await w.get('[data-test="ai-web-notice-dismiss"]').trigger("click");
    expect(w.find('[data-test="ai-web-notice"]').exists()).toBe(false);
    w.findAllComponents({ name: "Toggle" }).find((c) => c.attributes("data-test") === "ai-web-always")!
      .vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ web_always_allow: true });
    expect(w.get('[data-test="ai-always-notice"]').text()).toContain("No Allow card");
    await w.get('[data-test="ai-notices-again"]').trigger("click");
    expect(w.find('[data-test="ai-web-notice"]').exists()).toBe(true);
    w.unmount();
  });

  it("types an embedding model name", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, model: "a" }));
    vi.mocked(api.ai.saveConfig).mockImplementation(async (p) => cfg({ enabled: true, model: "a", ...p }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-embed-model")!.vm.$emit("update:modelValue", "custom");
    await flushPromises();
    const input = w.get('[data-test="ai-embed-model-input"] input, input[data-test="ai-embed-model-input"]');
    await input.setValue("embeddinggemma");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ embed_model: "embeddinggemma" });
  });

  it("has no meaning search for Claude", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, provider: "anthropic", model: "c" }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    const embed = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-embed-model")!;
    expect(embed.props("disabled")).toBe(true);
    expect(w.text()).toContain("Claude has no embeddings.");
  });

  it("embeds on another server with Claude, of the type the user picks", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({
      enabled: true, provider: "anthropic", model: "c", embed_base_url: "http://127.0.0.1:11434",
    }));
    vi.mocked(api.ai.saveConfig).mockImplementation(async (p) => cfg({
      enabled: true, provider: "anthropic", model: "c", embed_base_url: "http://127.0.0.1:11434", ...p,
    }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    const embed = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-embed-model")!;
    expect(embed.props("disabled")).toBe(false);
    expect(api.ai.models).toHaveBeenCalledWith("embed");
    const kind = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-embed-api")!;
    kind.vm.$emit("update:modelValue", "ollama");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ embed_api: "ollama" });
  });

  it("shows the index and rebuilds it", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, model: "a" }));
    vi.mocked(api.ai.rebuildIndex).mockResolvedValue({ ...INDEX, items: 121 });
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.get('[data-test="ai-index-status"]').text()).toBe("120 items indexed");
    await w.get('[data-test="ai-index-rebuild"]').trigger("click");
    await flushPromises();
    expect(api.ai.rebuildIndex).toHaveBeenCalled();
    expect(w.get('[data-test="ai-index-status"]').text()).toBe("121 items indexed");
  });

  it("says when there is no full-text search", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, model: "a" }));
    vi.mocked(api.ai.index).mockResolvedValue({ ...INDEX, available: false, items: 0 });
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.get('[data-test="ai-index-status"]').text()).toContain("no SQLite full-text search");
    expect(w.get('[data-test="ai-index-rebuild"]').attributes("disabled")).toBeDefined();
  });

  it("warns when the embedding model pushes the chat model out", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ enabled: true, model: "a", embed_model: "nomic-embed-text" }));
    vi.mocked(api.ai.test).mockResolvedValue({
      ok: true, models: ["a"], model_found: true, json_ok: true, latency_ms: 900, context: null, context_low: false,
      error: null, embed: { ok: true, dims: 768, error: null, swapped: true },
    });
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    await w.get('[data-test="ai-test"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-test-result"]').text()).toContain("embeddings ✓ (768)");
    expect(w.get('[data-test="ai-test-result"]').attributes("data-tone")).toBe("warn");
    expect(w.get('[data-test="ai-embed-swapped"]').text()).toContain("OLLAMA_MAX_LOADED_MODELS");
  });

  it("says when the saved key belongs to another address", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ provider: "anthropic", key_set: false, key_for_host: "api.anthropic.com" }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.get('[data-test="ai-key-elsewhere"]').text()).toBe("Saved for api.anthropic.com");
    expect(w.get('[data-test="ai-key-elsewhere-note"]').text()).toContain("isn't sent to this address");
    expect(w.find('[data-test="ai-key-set"]').exists()).toBe(false);
  });
});

describe("Settings › AI assistant suggested models per provider", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockReset();
    vi.mocked(api.ai.models).mockReset().mockResolvedValue({ models: [] });
    vi.mocked(api.ai.index).mockReset().mockResolvedValue(INDEX);
  });

  async function card(provider: AiConfig["provider"], over: Partial<AiConfig> = {}) {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ provider, ...over }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    return w;
  }

  it("LM Studio shows the local list by Hugging Face repo, without Ollama links", async () => {
    const w = await card("lmstudio");
    const c = w.get('[data-test="ai-suggested-models"]');
    expect(c.attributes("data-group")).toBe("local");
    expect(c.text()).toContain("filvyb/Qwen3.5-9B-heretic-v2-GGUF");
    expect(c.text()).not.toContain("hf.co/");
    expect(w.findAll('[data-test="ai-model-ollama"]').length).toBe(0);
    expect(w.findAll('[data-test="ai-model-hf"]').length).toBe(SUGGESTED_LOCAL_MODELS.length);
  });

  it("Claude shows its own models, prices and the policy note, no local ones", async () => {
    const w = await card("anthropic");
    const c = w.get('[data-test="ai-suggested-models"]');
    expect(c.attributes("data-group")).toBe("anthropic");
    for (const n of ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"]) expect(c.text()).toContain(n);
    expect(c.text()).toContain("$2 / $10");
    expect(c.text()).toContain("doesn't allow sexually explicit writing");
    expect(c.text()).not.toContain("heretic");
    expect(w.findAll('[data-test="ai-model-hf"]').length).toBe(0);
    expect(w.findAll('[data-test="ai-model-tested"]').length).toBe(0);
  });

  it("OpenAI and OpenRouter show their own picks", async () => {
    const o = await card("openai");
    expect(o.get('[data-test="ai-suggested-models"]').text()).toContain("gpt-6-luna");
    o.unmount();
    _resetAiConfigForTests();
    const r = await card("openrouter");
    const t = r.get('[data-test="ai-suggested-models"]').text();
    expect(t).toContain("deepseek/deepseek-v4-flash");
    expect(t).toContain("moderated");
    expect(r.findAll('[data-test="ai-model-row"]').length).toBe(SUGGESTED_MODELS.openrouter[0].models.length);
  });

  it("hides the card for Other set to an internet address", async () => {
    const w = await card("custom", { local: false });
    expect(w.find('[data-test="ai-suggested-models"]').exists()).toBe(false);
  });

  it("suggestionsFor picks the list by provider and locality", () => {
    expect(suggestionsFor("ollama", true)?.key).toBe("local");
    expect(suggestionsFor("custom", true)?.key).toBe("local");
    expect(suggestionsFor("custom", false)).toBeNull();
    expect(suggestionsFor("anthropic", false)?.key).toBe("anthropic");
    // OpenRouter prices change, so its models link to their page instead.
    const or = suggestionsFor("openrouter", false)?.groups[0].models ?? [];
    expect(or.every((m) => !m.price && m.pageUrl === `https://openrouter.ai/${m.name}`)).toBe(true);
    const all = Object.values(SUGGESTED_MODELS).flatMap((gs) => gs.flatMap((g) => g.models));
    expect(all.filter((m) => m.tested).map((m) => m.name)).toEqual([SUGGESTED_LOCAL_MODELS[0].name]);
    for (const m of all) expect(`${m.goodFor}`).not.toMatch(/\u2014/);
  });
});
