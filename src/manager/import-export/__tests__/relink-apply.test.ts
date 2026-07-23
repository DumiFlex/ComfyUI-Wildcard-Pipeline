import { describe, it, expect } from "vitest";
import { applyRelink } from "../relink-apply";

function modules() {
  return [
    // the detached instance being re-linked
    {
      id: "dead0001", type: "wildcard", payload_hash: "HASH_A",
      payload: { options: [{ id: "o1", value: "red" }] }, instance: {},
    },
    // a wildcard whose option text nests a ref to the detached uuid
    {
      id: "w2", type: "wildcard", payload_hash: "HB",
      payload: { options: [{ id: "o1", value: "see @{dead0001#hair} here" }] }, instance: {},
    },
    // a constraint whose source points at the detached uuid
    {
      id: "c1", type: "constraint", payload_hash: "HC",
      payload: { source_wildcard_id: "dead0001", target_wildcard_id: "w2", matrix: {} }, instance: {},
    },
  ];
}

describe("applyRelink", () => {
  it("swaps the re-linked instance's own id + payload_hash", () => {
    const out = applyRelink(modules(), { oldId: "dead0001", newId: "live0001", newPayloadHash: "HASH_A" });
    expect(out[0].id).toBe("live0001");
    expect(out[0].payload_hash).toBe("HASH_A");
  });

  it("remaps a nested @{uuid} ref, preserving the #name segment", () => {
    const out = applyRelink(modules(), { oldId: "dead0001", newId: "live0001", newPayloadHash: "HASH_A" });
    const opt = (out[1].payload as { options: { value: string }[] }).options[0];
    expect(opt.value).toBe("see @{live0001#hair} here");
  });

  it("remaps a constraint source_wildcard_id whole-string ref", () => {
    const out = applyRelink(modules(), { oldId: "dead0001", newId: "live0001", newPayloadHash: "HASH_A" });
    expect((out[2].payload as { source_wildcard_id: string }).source_wildcard_id).toBe("live0001");
  });

  it("does not mutate the input array or its members", () => {
    const input = modules();
    const before = JSON.stringify(input);
    applyRelink(input, { oldId: "dead0001", newId: "live0001", newPayloadHash: "HASH_A" });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("is a no-op when oldId === newId", () => {
    const out = applyRelink(modules(), { oldId: "dead0001", newId: "dead0001", newPayloadHash: "HASH_A" });
    expect((out[2].payload as { source_wildcard_id: string }).source_wildcard_id).toBe("dead0001");
    expect(out[0].id).toBe("dead0001");
  });
});
