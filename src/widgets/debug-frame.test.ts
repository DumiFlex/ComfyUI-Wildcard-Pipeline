import { describe, expect, it, vi } from "vitest";

vi.mock("#comfyui/app", () => ({ app: {} }));

const { snapshotFrame, snapshotForFrame } = await import("./debug");

describe("WP Debug follows the Loop's Edit frame", () => {
  it("reads a snapshot's Loop frame without parsing it", () => {
    expect(snapshotFrame('{\n  "a": 1,\n  "__wp_loop_index__": 3\n}')).toBe(3);
    expect(snapshotFrame('{"a": 1}')).toBeNull();
  });

  it("finds the snapshot of a frame, or none for a frame Debug didn't get", () => {
    const snaps = ['{"__wp_loop_index__": 0}', '{"__wp_loop_index__": 2}', '{"__wp_loop_index__": 3}'];
    expect(snapshotForFrame(snaps, 2)).toBe(1);
    expect(snapshotForFrame(snaps, 1)).toBeNull();
  });
});
