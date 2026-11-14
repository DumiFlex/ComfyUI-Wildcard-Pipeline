import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The host is all the note needs from the DOM widget glue; keep it bare so
// the test only sees what mountNote does with the pin.
let restore: ((raw: string) => void) | undefined;
vi.mock("./_shared", () => ({
  serializeWidgetJson: (v: unknown) => JSON.stringify(v),
  createDomWidgetHost: (_node: unknown, _name: string, _c: unknown, opts: { onValueRestored?: (raw: string) => void }) => {
    restore = opts.onValueRestored;
    return { element: document.createElement("div"), setValue: vi.fn(), onCleanup: vi.fn() };
  },
}));
vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });

import { mountNote } from "./note";

type Node = Parameters<typeof mountNote>[0];
function noteNode(flags?: { pinned?: boolean }): Node {
  return { id: 1, title: "Note", size: [200, 60], graph: {}, ...(flags ? { flags } : {}), widgets: [] } as unknown as Node;
}

beforeEach(() => { vi.useFakeTimers(); restore = undefined; });
afterEach(() => { vi.useRealTimers(); });

describe("WP Note pin", () => {
  it("a new note starts unpinned", () => {
    const node = noteNode();
    mountNote(node);
    vi.runAllTimers();
    expect(node.flags?.pinned).not.toBe(true);
  });

  it("a loaded note keeps the pin it was saved with", () => {
    const node = noteNode({ pinned: true });
    mountNote(node);
    restore?.(JSON.stringify({}));
    vi.runAllTimers();
    expect(node.flags?.pinned).toBe(true);
  });
});
