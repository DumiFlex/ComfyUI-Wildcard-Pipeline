import { describe, expect, it } from "vitest";
import type { AiThinkingInfo } from "../../api/types";
import { sendsLabel, thinkingChoices } from "../ai-thinking";

function info(over: Partial<AiThinkingInfo>): AiThinkingInfo {
  return {
    kind: "levels", options: [], can_off: true, default: null, source: "server",
    shown: [], sends: {}, refused: [], thought_out: false, note: "", ...over,
  };
}

describe("thinkingChoices", () => {
  it("offers the usual five without word from the server", () => {
    expect(thinkingChoices(null, "auto").map((o) => o.value)).toEqual(
      ["auto", "off", "low", "medium", "high"]);
  });

  it("offers only off and on for an on/off model, keeping a saved level marked", () => {
    const qwen = info({ kind: "switch", shown: ["auto", "off", "on"], sends: { low: "on" } });
    const got = thinkingChoices(qwen, "low", true);
    expect(got.map((o) => o.value)).toEqual(["auto", "off", "on", "low"]);
    expect(got[3].label).toBe("Low (means On)");
  });

  it("offers a model's own levels", () => {
    const claude = info({ options: ["low", "medium", "high", "xhigh", "max"], can_off: false,
      shown: ["auto", "low", "medium", "high", "xhigh", "max"] });
    expect(thinkingChoices(claude, "max").map((o) => o.label)).toEqual([
      "As the model does", "Low: think a little", "Medium", "High", "Extra high",
      "Max: think the most"]);
  });
});

describe("sendsLabel", () => {
  it("says what a choice becomes", () => {
    const i = info({ sends: { high: "auto", low: "low", off: "low" } });
    expect(sendsLabel(i, "high")).toBe("model's default");
    expect(sendsLabel(i, "low")).toBe("as picked");
    expect(sendsLabel(i, "off")).toBe("means Low");
  });
});
