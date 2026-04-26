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
