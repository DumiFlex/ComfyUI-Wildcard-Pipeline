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

  it("draws a table the way a model wrote it", () => {
    const text = "## Current Structure\n\n| Wildcard | Variable | Options |\n|----------|----------|--------:|\n"
      + "| **Pose pool — sitting** | `$pose_sitting` | 9 |\n| **Pose pool — lying** | `$pose_lying` | 7 |";
    const w = mount(AiMessage, { props: { text } });
    expect(w.find("h4.wp-ai-msg__h").text()).toBe("Current Structure");
    expect(w.findAll("th").map((c) => c.text())).toEqual(["Wildcard", "Variable", "Options"]);
    const cells = w.findAll("tbody tr")[1].findAll("td");
    expect(cells[0].find("strong").text()).toBe("Pose pool — lying");
    expect(cells[1].find("code .wp-ai-msg__var").text()).toBe("$pose_lying");
    expect(cells[2].attributes("style")).toContain("text-align: right");
  });

  it("shows a code block with its language and a copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const w = mount(AiMessage, { props: { text: "```json\n{\"text\": \"standing\"}\n```" } });
    expect(w.find(".wp-ai-msg__codehead").text()).toBe("json");
    expect(w.find("pre").text()).toBe('{"text": "standing"}');
    await w.find("[data-test='ai-msg-copy']").trigger("click");
    expect(writeText).toHaveBeenCalledWith('{"text": "standing"}');
  });

  it("keeps numbering, nesting, task boxes and link text", () => {
    const w = mount(AiMessage, {
      props: { text: "3. first\n   - inner\n\n4. second\n\n- [x] done\n\n---\n\nSee [the docs](https://example.com) ~~old~~" },
    });
    expect(w.find("ol").attributes("start")).toBe("3");
    expect(w.findAll("ol > li")).toHaveLength(2);
    expect(w.find("ol li ul li").text()).toBe("inner");
    expect(w.find(".wp-ai-msg__task i").attributes("aria-label")).toBe("Done");
    expect(w.find("hr").exists()).toBe(true);
    const link = w.find(".wp-ai-msg__link");
    expect(link.text()).toBe("the docs");
    expect(link.attributes("title")).toBe("https://example.com");
    expect(w.find("a").exists()).toBe(false);
    expect(w.find("s").text()).toBe("old");
  });
});
