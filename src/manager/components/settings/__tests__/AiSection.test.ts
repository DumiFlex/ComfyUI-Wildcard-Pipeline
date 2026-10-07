import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AiSection from "../sections/AiSection.vue";
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
    key_set: false, key_from_env: false, presets: PRESETS, ...over,
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
      ok: true, models: ["a", "b"], model_found: true, json_ok: true, latency_ms: 1400, error: null,
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
      error: "couldn't connect to 127.0.0.1:11434. Is the server running?",
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
});
