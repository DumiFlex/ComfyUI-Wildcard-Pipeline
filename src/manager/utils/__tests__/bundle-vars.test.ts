import { describe, expect, it } from "vitest";
import { bundleSiblingVars } from "../bundle-vars";

const quality = { _uid: "u1", id: "a1", type: "fixed_values", enabled: true, meta: { name: "Quality" },
  payload: { values: [{ name: "quality_tags", value: "masterpiece", negative: "lowres" }, { name: "rating_tag", value: "nsfw" }] } };
const hair = { _uid: "u2", id: "a2", type: "wildcard", enabled: true, meta: { name: "Hair" },
  payload: { var_binding: "hair", options: [{ value: "red hair" }],
    tag_groups: { LEN: ["long", "short"] }, tag_group_kinds: { LEN: "accepts" } } };
const off = { _uid: "u3", id: "a3", type: "wildcard", enabled: false, payload: { var_binding: "gone", options: [] } };
const beat = { _uid: "u4", id: "a4", type: "derivation", enabled: true, meta: { name: "Beat" },
  payload: { rules: [{ branches: [{ conditions: [], action: { target_var: "beat", value: "walks home" } }],
    else: { action: { target_var: "age_tag", value: "child", mode: "negative" } } }] } };
const full = { _uid: "u5", id: "a5", type: "combine", enabled: true, payload: { output_var: "final_prompt", template: "$hair" } };
const inner = { type: "bundle", children: [{ _uid: "u6", type: "wildcard", enabled: true, payload: { var_binding: "scene", options: [{ value: "street" }] } }] };

describe("bundleSiblingVars", () => {
  it("lists what the other enabled children set, with a sample each", () => {
    const out = bundleSiblingVars([quality, hair, off, beat, full, inner], full);
    expect(out.names).toEqual(["beat", "hair", "quality_tags", "rating_tag", "scene"]);
    expect(out.resolved).toMatchObject({ hair: "red hair", quality_tags: "masterpiece", beat: "walks home", scene: "street" });
    expect(out.producers.hair).toMatchObject({ kind: "wildcard", moduleName: "Hair", nodeLabel: "this bundle" });
    expect(out.producers.hair.axes?.[0]).toMatchObject({ axis: "LEN", tags: ["long", "short"] });
    // A "negative" action leaves $age_tag unset; the child itself is left out.
    expect(out.names).not.toContain("age_tag");
    expect(out.names).not.toContain("final_prompt");
  });
});
