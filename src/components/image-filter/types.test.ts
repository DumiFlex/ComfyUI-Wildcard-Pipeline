import { describe, it, expect } from "vitest";
import { defaultImageFilterConfig, parseImageFilterConfig, parsePickRequest, viewUrl, MAX_TIMEOUT } from "./types";

describe("parseImageFilterConfig", () => {
  it("falls back to the defaults on junk", () => {
    expect(parseImageFilterConfig("")).toEqual(defaultImageFilterConfig());
    expect(parseImageFilterConfig("{nope")).toEqual(defaultImageFilterConfig());
    expect(parseImageFilterConfig("[1]")).toEqual(defaultImageFilterConfig());
  });

  it("keeps good keys and drops bad ones one at a time (same rule as Python)", () => {
    const cfg = parseImageFilterConfig(JSON.stringify({
      mode: "reuse", nothing_picked: "keep_all", send_as: "bogus", timeout: 45.9, on_timeout: "stop",
    }));
    expect(cfg).toEqual({ mode: "reuse", send_as: "same_shape", timeout: 45, on_timeout: "stop" });
    expect(parseImageFilterConfig({ timeout: -3 }).timeout).toBe(0);
    expect(parseImageFilterConfig({ timeout: 1e12 }).timeout).toBe(MAX_TIMEOUT);
  });
});

describe("parsePickRequest", () => {
  it("narrows a websocket payload", () => {
    const req = parsePickRequest({
      token: "t", node_id: 7, timeout: 30, started_at: 1,
      frames: [[{ filename: "a.png", subfolder: "", type: "temp" }, { junk: 1 }], "x"],
      labels: [{ loop_index: 0 }],
    });
    expect(req).toEqual({
      token: "t", node_id: "7", timeout: 30, started_at: 1, send_as: "same_shape", has_clip: false,
      frames: [[{ filename: "a.png", subfolder: "", type: "temp" }], []],
      labels: [{ loop_index: 0 }],
    });
    expect(parsePickRequest({ frames: [] })).toBeNull();
    expect(parsePickRequest(null)).toBeNull();
  });

  it("builds /view urls", () => {
    expect(viewUrl({ filename: "a b.png", subfolder: "", type: "temp" })).toBe("/view?filename=a+b.png&subfolder=&type=temp");
  });
});
