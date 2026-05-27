import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia, type Pinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";

// Mock the composable so we can assert click → the right create fn, without
// touching the real api/router/toast wiring inside it. The route-name map is
// stubbed inline (kept in sync with `useStarterSet.ts`) so the mock factory
// stays synchronous — importActual of the very module being mocked can deadlock.
const createStarterModule = vi.hoisted(() => vi.fn(() => Promise.resolve("m1")));
const createStarterTemplate = vi.hoisted(() => vi.fn(() => Promise.resolve("tpl1")));
const buildStarterBundle = vi.hoisted(() => vi.fn(() => Promise.resolve("bundle1")));
vi.mock("../../../docs/useStarterSet", () => ({
  STARTER_EDIT_ROUTE: {
    subject: "wildcards-edit",
    mood: "wildcards-edit",
    style: "fixed-values-edit",
    scene: "combines-edit",
    accent: "derivations-edit",
    pairing: "constraints-edit",
    template: "templates-edit",
    bundle: "bundles-edit",
  },
  useStarterSet: () => ({
    createStarterModule,
    createStarterTemplate,
    buildStarterBundle,
    ensureSlot: vi.fn(),
    ensurePairing: vi.fn(),
    ensureStarterTemplate: vi.fn(),
  }),
}));

const pushMock = vi.hoisted(() => vi.fn());
vi.mock("../../../composables/useToast", () => ({
  useToast: () => ({ toasts: { value: [] }, push: pushMock, dismiss: vi.fn() }),
}));

import StarterButton from "../StarterButton.vue";
import { useStarterStore } from "../../../stores/starterStore";
import type { StarterSlot } from "../../../docs/starter-recipe";

type ButtonSlot = StarterSlot | "bundle";

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      // A root route so the initial `/` navigation resolves — without it
      // `router.isReady()` never settles and every test times out.
      { path: "/", name: "root", component: { template: "<div/>" } },
      { path: "/wildcards/:id/edit", name: "wildcards-edit", component: { template: "<div/>" } },
      { path: "/fixed-values/:id/edit", name: "fixed-values-edit", component: { template: "<div/>" } },
      { path: "/combines/:id/edit", name: "combines-edit", component: { template: "<div/>" } },
      { path: "/derivations/:id/edit", name: "derivations-edit", component: { template: "<div/>" } },
      { path: "/constraints/:id/edit", name: "constraints-edit", component: { template: "<div/>" } },
      { path: "/bundles/:id/edit", name: "bundles-edit", component: { template: "<div/>" } },
      { path: "/templates/:id/edit", name: "templates-edit", component: { template: "<div/>" } },
    ],
  });
}

// Shared across the test body (store writes) and the mounted component, so a
// `store.record(...)` is visible to the component under test.
let pinia: Pinia;

async function mountButton(props: { slot: ButtonSlot; label?: string }) {
  const router = makeRouter();
  await router.push("/");
  await router.isReady();
  const w = mount(StarterButton, {
    props,
    global: { plugins: [router, pinia] },
  });
  return { w, router };
}

beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  createStarterModule.mockClear();
  createStarterTemplate.mockClear();
  buildStarterBundle.mockClear();
  pushMock.mockClear();
});

describe("StarterButton", () => {
  it("renders the create state with a default per-slot label", async () => {
    const { w } = await mountButton({ slot: "subject" });
    expect(w.get('[data-test="starter-create"]').text()).toContain("Create starter subject");
    expect(w.find('[data-test="starter-open"]').exists()).toBe(false);
  });

  it("uses a custom label when provided", async () => {
    const { w } = await mountButton({ slot: "style", label: "Make the style module" });
    expect(w.get('[data-test="starter-create"]').text()).toContain("Make the style module");
  });

  it("labels the bundle slot 'Build starter bundle'", async () => {
    const { w } = await mountButton({ slot: "bundle" });
    expect(w.get('[data-test="starter-create"]').text()).toContain("Build starter bundle");
  });

  it("click on a module slot calls createStarterModule with that slot", async () => {
    const { w } = await mountButton({ slot: "scene" });
    await w.get('[data-test="starter-create"]').trigger("click");
    await flushPromises();
    expect(createStarterModule).toHaveBeenCalledTimes(1);
    expect(createStarterModule).toHaveBeenCalledWith("scene");
    expect(buildStarterBundle).not.toHaveBeenCalled();
    expect(createStarterTemplate).not.toHaveBeenCalled();
  });

  it("click on the template slot calls createStarterTemplate", async () => {
    const { w } = await mountButton({ slot: "template" });
    await w.get('[data-test="starter-create"]').trigger("click");
    await flushPromises();
    expect(createStarterTemplate).toHaveBeenCalledTimes(1);
    expect(createStarterModule).not.toHaveBeenCalled();
  });

  it("click on the bundle slot calls buildStarterBundle", async () => {
    const { w } = await mountButton({ slot: "bundle" });
    await w.get('[data-test="starter-create"]').trigger("click");
    await flushPromises();
    expect(buildStarterBundle).toHaveBeenCalledTimes(1);
    expect(createStarterModule).not.toHaveBeenCalled();
  });

  it("flips to the Created/Open affordance when the store has the slot", async () => {
    const store = useStarterStore();
    store.record("pairing", "con9");
    const { w } = await mountButton({ slot: "pairing" });
    await flushPromises();
    // No create button; a Created marker + an Open link instead.
    expect(w.find('[data-test="starter-create"]').exists()).toBe(false);
    expect(w.text()).toContain("Created");
    expect(w.find('[data-test="starter-open"]').exists()).toBe(true);
  });

  it("Open navigates to the recorded row's editor", async () => {
    const store = useStarterStore();
    store.record("subject", "wc42");
    const { w, router } = await mountButton({ slot: "subject" });
    await flushPromises();
    await w.get('[data-test="starter-open"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("wildcards-edit");
    expect(router.currentRoute.value.params.id).toBe("wc42");
  });

  it("the bundle Open link targets the bundles editor", async () => {
    const store = useStarterStore();
    store.record("bundle", "bnd7");
    const { w, router } = await mountButton({ slot: "bundle" });
    await flushPromises();
    await w.get('[data-test="starter-open"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("bundles-edit");
    expect(router.currentRoute.value.params.id).toBe("bnd7");
  });

  it("toasts an error when the create fn rejects (and clears in-flight)", async () => {
    createStarterModule.mockRejectedValueOnce(new Error("boom"));
    const { w } = await mountButton({ slot: "style" });
    await w.get('[data-test="starter-create"]').trigger("click");
    await flushPromises();
    expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({
      severity: "error",
      detail: "boom",
    }));
    // Button is back to idle (not stuck disabled/loading).
    expect(w.get('[data-test="starter-create"]').attributes("aria-busy")).toBeUndefined();
  });
});
