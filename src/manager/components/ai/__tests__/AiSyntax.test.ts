import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AiSyntax from "../AiSyntax.vue";
import AiCardView from "../AiCardView.vue";
import AiCardPreview from "../AiCardPreview.vue";
import type { CardView } from "../../../composables/aiCards";
import type { AiChatProposal } from "../../../api/types";

describe("AiSyntax", () => {
  it("colours prompt syntax the way a reply does", () => {
    const w = mount(AiSyntax, { props: { text: "$hair in {snowflakes|frost on glass} with @{abcd1234} <lora:ice:0.6> #cold" } });
    expect(w.find(".wp-ai-syn__var").text()).toBe("$hair");
    expect(w.find(".wp-ai-syn__var").attributes("style")).toContain("--wp-var-");
    expect(w.find(".wp-ai-syn__pick").text()).toBe("{snowflakes|frost on glass}");
    expect(w.find(".wp-ai-syn__ref").text()).toBe("abcd1234");
    expect(w.find(".wp-ai-syn__ref").attributes("title")).toBe("@{abcd1234}");
    expect(w.find(".wp-ai-syn__lora").text()).toBe("<lora:ice:0.6>");
    expect(w.find(".wp-ai-syn__tag").text()).toBe("#cold");
    expect(w.text()).toBe("$hair in {snowflakes|frost on glass} with abcd1234 <lora:ice:0.6> #cold");
    // A named, filtered ref shows its name and filter as a chip.
    const ref = mount(AiSyntax, { props: { text: "@{abcd1234#Colors:warm and !dark!null} shirt" } }).find(".wp-ai-syn__ref");
    expect(ref.text()).toBe("Colorswarm and !dark!∅");
    expect(ref.findAll(".wp-ai-syn__ref-filter").map((x) => x.text())).toEqual(["warm and !dark", "!∅"]);
    // Plain text stays one string, no spans.
    expect(mount(AiSyntax, { props: { text: "red scarf" } }).findAll("span").length).toBe(1);
  });

  it("colours a card's rules, values and option texts", () => {
    const derivation: CardView = { kind: "derivation", rules: [[
      { key: "IF", test: "$class is mage", actions: ["set $title to Archmage", "add {robes|a cloak} to $outfit"] },
    ]] };
    const w = mount(AiCardView, { props: { view: derivation } });
    expect(w.find("code .wp-ai-syn__var").text()).toBe("$class");
    expect(w.find("li .wp-ai-syn__pick").text()).toBe("{robes|a cloak}");
    const values: CardView = { kind: "values", rows: [{ name: "mood", value: "calm, $weather light", negative: "{dark|gloomy}" }] };
    const v = mount(AiCardView, { props: { view: values } });
    expect(v.find("td .wp-ai-syn__var").text()).toBe("$weather");
    expect(v.find(".wp-ai-card-view__neg .wp-ai-syn__pick").text()).toBe("{dark|gloomy}");
    const p = {
      pid: "p1", tool: "create_wildcard", title: "Create wildcard Window", summary: "", preview: [], after: null,
      warnings: [], fixes: [],
      op: { op: "create", kind: "module", new_category: "", body: {
        type: "wildcard", name: "Window", description: "", tags: [],
        payload: { variable_name: "window", options: [{ id: "o1", value: "{snowflakes|frost on glass} on the pane", weight: 1, negative: "$fog" }] },
      } },
    } as unknown as AiChatProposal;
    const m = mount(AiCardPreview, { props: { proposal: p }, global: { stubs: { Teleport: true } } });
    expect(m.find(".wp-ai-preview__opt-text .wp-ai-syn__pick").text()).toBe("{snowflakes|frost on glass}");
    expect(m.find(".wp-ai-preview__neg .wp-ai-syn__var").text()).toBe("$fog");
  });
});
