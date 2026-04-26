// Stub the ComfyUI app module so widgets can import without a live ComfyUI.
import { vi } from "vitest";

vi.mock("#comfyui/app", () => ({
  app: {
    graph: { _nodes: [], links: {}, getNodeById: () => null },
    registerExtension: vi.fn(),
  },
}));

// jsdom (<26) doesn't ship ResizeObserver. createDomWidgetHost uses it for
// content-driven autosize; without a stub, instantiation throws.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
}

// PrimeVue overlays (TieredMenu, Select dropdown, etc.) call window.matchMedia.
// jsdom doesn't ship with it, so we stub it for every test.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
