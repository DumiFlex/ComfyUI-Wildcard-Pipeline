import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AiSection from "../sections/AiSection.vue";
import Select from "../../ui/Select.vue";
import { SUGGESTED_LOCAL_MODELS } from "../ai-models";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import type { AiConfig } from "../../../api/types";

vi.mock("../../../api/client", () => ({
  api: { ai: { config: vi.fn(), saveConfig: vi.fn(), models: vi.fn(), test: vi.fn() } },
  ApiError: class ApiError extends Error {},
}));

const PRESETS: AiConfig["presets"] = {
  anthropic: { label: "Claude", api: "anthropic", local: false, needs_key: true, base_url: "https://api.anthropic.com" },
  openai: { label: "OpenAI", api: "openai", local: false, needs_key: true, base_url: "https://api.openai.com/v1" },
  ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "http://127.0.0.1:11434" },
  lmstudio: { label: "LM Studio", api: "openai", local: true, needs_key: false, base_url: "http://127.0.0.1:1234/v1" },
  llamacpp: { label: "llama.cpp", api: "openai", local: true, needs_key: false, base_url: "http://127.0.0.1:8080/v1" },
  custom: { label: "Other", api: "openai", local: true, needs_key: false, base_url: "" },
};

function cfg(over: Partial<AiConfig> = {}): AiConfig {
  return {
    enabled: false, provider: "ollama", base_url: "", model: "", unload_after_s: 60,
    context_max: 16384, model_size: "auto", model_size_auto: "medium",
    key_set: false, key_from_env: false, keys_saved: [], presets: PRESETS, ...over,
  };
}

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div/>" } }] });

describe("Settings › AI assistant", () => {
  beforeEach(() => {
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockReset();
    vi.mocked(api.ai.saveConfig).mockReset();
    vi.mocked(api.ai.models).mockReset().mockResolvedValue({ models: ["a", "b"] });
    vi.mocked(api.ai.test).mockReset();
  });

  it("starts off, with Test connection disabled and the local privacy note", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg());
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.get('[data-test="ai-test"]').attributes("disabled")).toBeDefined();
    expect(w.get('[data-test="ai-privacy"]').text()).toContain("Stays on your machine");
    expect(w.get('[data-test="ai-suggested-models"]').text()).toContain("abliterated");
    const ollama = w.findAll('[data-test="ai-model-ollama"]');
    const hf = w.findAll('[data-test="ai-model-hf"]');
    expect(ollama.length).toBe(SUGGESTED_LOCAL_MODELS.filter((m) => m.ollamaUrl).length);
    expect(w.find('[data-test="ai-models-writing"]').text()).toContain("Rocinante");
    expect(w.find('[data-test="ai-models-building"]').text()).toContain("abliterated");
    expect(hf.length).toBe(SUGGESTED_LOCAL_MODELS.length);
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

  it("marks cloud providers that already have a saved key", async () => {
    vi.mocked(api.ai.config).mockResolvedValue(cfg({ keys_saved: ["anthropic"] }));
    const w = mount(AiSection, { global: { plugins: [router] } });
    await flushPromises();
    const sel = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "ai-provider");
    const opts = (sel?.props("options") ?? []) as { value: string; label: string }[];
    expect(opts.find((o) => o.value === "anthropic")?.label).toContain("key saved");
    expect(opts.find((o) => o.value === "openai")?.label).not.toContain("key saved");
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
    expect(w.text()).toContain("loaded with only 4096 tokens of context");
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
    const ctx = w.get('[data-test="ai-context"] input, input[data-test="ai-context"]');
    await ctx.setValue(1000);
    await ctx.trigger("blur");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ context_max: 4096 });
  });
});
