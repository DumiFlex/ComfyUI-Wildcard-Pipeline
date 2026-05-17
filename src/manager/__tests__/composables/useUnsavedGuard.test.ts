/**
 * Tests for the useUnsavedGuard composable.
 *
 * Strategy: mount a RouterView-based app so onBeforeRouteLeave fires
 * correctly. The GuardHost component is wired as a route component
 * so the guard intercepts real navigation events.
 */
import { defineComponent, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { useUnsavedGuard } from "../../composables/useUnsavedGuard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A minimal component that:
 *  - wires useUnsavedGuard with a dirty flag read from a reactive ref
 *    exposed as `isDirty` on the instance
 *  - renders buttons to confirm/cancel the dialog
 */
const GuardHost = defineComponent({
  name: "GuardHost",
  props: {
    dirty: { type: Boolean, default: false },
  },
  setup(props) {
    const { showConfirm, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
      () => props.dirty,
    );
    return { showConfirm, onConfirmLeave, onCancelLeave };
  },
  template: `
    <div>
      <span data-test="show-confirm">{{ showConfirm }}</span>
      <button data-test="confirm-btn" @click="onConfirmLeave">Confirm</button>
      <button data-test="cancel-btn" @click="onCancelLeave">Cancel</button>
    </div>
  `,
});

/** App wrapper that mounts GuardHost inside a RouterView */
const AppRoot = defineComponent({
  components: { RouterView },
  template: `<RouterView />`,
});

/**
 * Create a router with GuardHost on /editor and a dummy on /list.
 * Props are passed to GuardHost via the route record.
 */
function makeRouterWithGuard(dirty: boolean) {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/editor",
        component: GuardHost,
        props: () => ({ dirty }),
      },
      {
        path: "/list",
        component: { template: "<div>list</div>" },
      },
    ],
  });
}

async function waitForGuard(): Promise<void> {
  await flushPromises();
  await nextTick();
  await nextTick();
}

let wrappers: ReturnType<typeof mount>[] = [];

beforeEach(() => {
  wrappers = [];
});

afterEach(() => {
  for (const w of wrappers) {
    try { w.unmount(); } catch { /* ignore */ }
  }
  wrappers = [];
  vi.restoreAllMocks();
});

async function mountEditor(dirty: boolean) {
  const router = makeRouterWithGuard(dirty);
  await router.push("/editor");
  const wrap = mount(AppRoot, { global: { plugins: [router] } });
  wrappers.push(wrap);
  await flushPromises();
  return { wrap, router };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useUnsavedGuard", () => {
  it("allows navigation without showing dialog when isDirty returns false", async () => {
    const { wrap, router } = await mountEditor(false);

    // Navigate away — guard should allow it immediately
    await router.push("/list");
    await flushPromises();

    // Dialog should never have been shown
    const hostEl = wrap.findComponent(GuardHost);
    // GuardHost has been replaced by the new route component — confirm it's gone
    expect(router.currentRoute.value.path).toBe("/list");
    // No confirm overlay anywhere
    expect(wrap.find('[data-test="confirm-overlay"]').exists()).toBe(false);
    void hostEl;
  });

  it("shows dialog and blocks navigation when isDirty returns true", async () => {
    const { wrap, router } = await mountEditor(true);

    // Navigate away — guard should intercept and show dialog
    const navPromise = router.push("/list");
    await waitForGuard();

    expect(wrap.find('[data-test="show-confirm"]').text()).toBe("true");
    // Navigation is pending (not yet resolved to /list)
    expect(router.currentRoute.value.path).toBe("/editor");

    // Clean up — confirm so navPromise resolves
    await wrap.find('[data-test="confirm-btn"]').trigger("click");
    await navPromise;
    await flushPromises();
  });

  it("onConfirmLeave closes dialog and allows navigation to proceed", async () => {
    const { wrap, router } = await mountEditor(true);

    const navPromise = router.push("/list");
    await waitForGuard();

    // Dialog visible
    expect(wrap.find('[data-test="show-confirm"]').text()).toBe("true");

    // User clicks Confirm (Discard & leave)
    await wrap.find('[data-test="confirm-btn"]').trigger("click");
    await navPromise;
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/list");
  });

  it("onCancelLeave closes dialog and blocks navigation", async () => {
    const { wrap, router } = await mountEditor(true);

    // Kick off navigation — do not await (it will be blocked)
    router.push("/list").catch(() => { /* navigation aborted — expected */ });
    await waitForGuard();

    // Dialog visible
    expect(wrap.find('[data-test="show-confirm"]').text()).toBe("true");

    // User clicks Cancel (Stay)
    await wrap.find('[data-test="cancel-btn"]').trigger("click");
    await flushPromises();

    expect(wrap.find('[data-test="show-confirm"]').text()).toBe("false");
    // Still on editor — navigation was blocked
    expect(router.currentRoute.value.path).toBe("/editor");
  });

  it("registers beforeunload handler while mounted and removes it on unmount", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const router = makeRouterWithGuard(false);
    await router.push("/editor");
    const wrap = mount(AppRoot, { global: { plugins: [router] } });
    await flushPromises();

    // addEventListener('beforeunload', ...) should have been called
    const addCalls = addSpy.mock.calls.filter((c) => c[0] === "beforeunload");
    expect(addCalls.length).toBeGreaterThanOrEqual(1);

    wrap.unmount();

    // removeEventListener('beforeunload', ...) should have been called
    const removeCalls = removeSpy.mock.calls.filter((c) => c[0] === "beforeunload");
    expect(removeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("beforeunload calls preventDefault and sets returnValue when dirty", async () => {
    // Intercept the handler before mounting
    let capturedHandler: ((e: Event) => void) | null = null;
    const origAdd = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, ...rest) => {
      if (type === "beforeunload") capturedHandler = listener as (e: Event) => void;
      return origAdd(type, listener, ...rest);
    });

    const { } = await mountEditor(true);

    expect(capturedHandler).not.toBeNull();

    // Simulate a beforeunload event
    const event = new Event("beforeunload") as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    let capturedReturnValue: string | undefined;
    Object.defineProperty(event, "returnValue", {
      get: () => capturedReturnValue,
      set: (v: string) => { capturedReturnValue = v; },
      configurable: true,
    });

    capturedHandler!(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(capturedReturnValue).toBe("");
  });

  it("beforeunload does NOT call preventDefault when not dirty", async () => {
    let capturedHandler: ((e: Event) => void) | null = null;
    const origAdd = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, ...rest) => {
      if (type === "beforeunload") capturedHandler = listener as (e: Event) => void;
      return origAdd(type, listener, ...rest);
    });

    const { } = await mountEditor(false);

    expect(capturedHandler).not.toBeNull();

    const event = new Event("beforeunload") as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    capturedHandler!(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration test: WildcardEditor snapshot-baseline detection
// ---------------------------------------------------------------------------
// This test verifies that typing into the name field makes the editor
// dirty and the guard shows the ConfirmDialog on navigation.
vi.mock("../../api/client", () => ({
  api: {
    modules: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
}));

describe("WildcardEditor + useUnsavedGuard integration", () => {
  it("shows leave dialog when name is changed and user navigates away", async () => {
    const { setActivePinia, createPinia } = await import("pinia");
    const { api } = await import("../../api/client");
    const { default: WildcardEditor } = await import("../../views/WildcardEditor.vue");

    setActivePinia(createPinia());

    const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const apiCat = api.categories as unknown as Record<string, ReturnType<typeof vi.fn>>;
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    apiCat.list.mockResolvedValue({ items: [] });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/wildcards/new", component: WildcardEditor },
        { path: "/wildcards", component: { template: "<div/>" } },
      ],
    });

    await router.push("/wildcards/new");

    const WcAppRoot = defineComponent({
      components: { RouterView },
      template: `<RouterView />`,
    });

    const wrap = mount(WcAppRoot, { global: { plugins: [router] } });
    wrappers.push(wrap);
    await flushPromises();

    // Type into the name field — editor is now dirty
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("Some Wildcard");
    await waitForGuard();

    // Trigger navigation away (do not await — it will be blocked by guard)
    router.push("/wildcards").catch(() => { /* may abort */ });
    await waitForGuard();

    // ConfirmDialog uses <Teleport to="body"> so it renders into document.body,
    // not inside the wrap. Check document.body directly.
    const overlay = document.body.querySelector('[data-test="confirm-overlay"]');
    expect(overlay).not.toBeNull();

    // Clean up: dismiss the dialog so the guard resolves
    const confirmBtn = document.body.querySelector('[data-test="confirm-confirm"]') as HTMLElement | null;
    confirmBtn?.click();
    await flushPromises();
  });
});
