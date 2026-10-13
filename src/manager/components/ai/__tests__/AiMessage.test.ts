import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AiMessage from "../AiMessage.vue";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

describe("AiMessage", () => {
  it("colours prompt syntax the way the editors do", () => {
    const w = mount(AiMessage, {
      props: { text: "Use $hair with {red|blue}, @{abcd1234}, <lora:detail:0.6>, embedding:bad_hands and #portrait." },
    });
    expect(w.find(".wp-ai-msg__var").text()).toBe("$hair");
    expect(w.find(".wp-ai-msg__var").attributes("style")).toContain("--wp-var-");
    expect(w.find(".wp-ai-msg__pick").text()).toBe("{red|blue}");
    expect(w.find(".wp-ai-msg__ref").text()).toBe("@{abcd1234}");
    expect(w.find(".wp-ai-msg__lora").text()).toBe("<lora:detail:0.6>");
    expect(w.find(".wp-ai-msg__emb").text()).toBe("embedding:bad_hands");
    expect(w.find(".wp-ai-msg__tag").text()).toBe("#portrait");
  });

  it("turns Tip / Warning lines into callouts", () => {
    const w = mount(AiMessage, { props: { text: "Tip: keep names short.\n\nWarning: this replaces Pose." } });
    const callouts = w.findAll(".wp-ai-msg__callout");
    expect(callouts.map((c) => c.attributes("data-tone"))).toEqual(["tip", "warn"]);
    expect(callouts[0].text()).toBe("keep names short.");
  });

  it("opens the item from its chip", async () => {
    const w = mount(AiMessage, {
      props: { text: "See [[Hair Color]].", refs: { "Hair Color": { id: "ab12cd34", type: "wildcard", name: "Hair Color" } } },
    });
    await w.find("[data-test='ai-msg-chip']").trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "wildcards-edit", params: { id: "ab12cd34" } });
  });
});
