import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PrimeVue from "primevue/config";

vi.mock("../api/client", () => ({
  api: {
    modules: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
    test: vi.fn(),
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import TestRunner from "../views/TestRunner.vue";

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TestRunner.vue", () => {
  it("renders heading and no histogram before run", async () => {
    const wrap = mount(TestRunner, { global: { plugins: [PrimeVue] } });
    await flushPromises();
    expect(wrap.text()).toContain("Test runner");
    expect(wrap.text()).not.toContain("Histogram");
  });

  it("Run button disabled when no module selected", async () => {
    const wrap = mount(TestRunner, { global: { plugins: [PrimeVue] } });
    await flushPromises();
    const btn = wrap.findAll("button").find((b) => b.text().includes("Run"));
    // PrimeVue Button forwards :disabled to the button element
    expect(btn?.attributes("disabled")).toBeDefined();
  });
});
