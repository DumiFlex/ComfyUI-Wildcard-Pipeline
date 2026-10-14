import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
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

  it("draws GitHub alerts as callouts with all their blocks", () => {
    const w = mount(AiMessage, {
      props: { text: "> [!NOTE]\n> Keep names short.\n\n> [!CAUTION] Before you apply:\n> - back up\n> - check `$pose`" },
    });
    const alerts = w.findAll("[data-test='ai-msg-alert']");
    expect(alerts.map((a) => a.attributes("data-tone"))).toEqual(["tip", "warn"]);
    expect(alerts[0].text()).toBe("Keep names short.");
    expect(alerts[1].findAll("li").length).toBe(2);
    expect(w.text()).not.toContain("[!");
    expect(w.find("blockquote").exists()).toBe(false);
  });

  it("shows a key-combo code span as keys", () => {
    const w = mount(AiMessage, { props: { text: "Press `Ctrl+Enter`, `Shift + Click` or `Esc`; type `red` or `A`." } });
    const keys = w.findAll("[data-test='ai-msg-keys']");
    expect(keys.map((k) => k.findAll("kbd").map((b) => b.text()))).toEqual([["Ctrl", "Enter"], ["Shift", "Click"], ["Esc"]]);
    expect(w.findAll("code").map((c) => c.text())).toEqual(["red", "A"]);
  });

  it("folds a long code block until opened", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const w = mount(AiMessage, { props: { text: "```\n" + body + "\n```" } });
    expect(w.find("pre").text().split("\n").length).toBe(12);
    const fold = w.find("[data-test='ai-msg-fold']");
    expect(fold.text()).toBe("Show all 30 lines");
    await fold.trigger("click");
    expect(w.find("pre").text()).toBe(body);
    expect(w.find("[data-test='ai-msg-fold']").attributes("aria-expanded")).toBe("true");
    // Short blocks and live ones never fold.
    expect(mount(AiMessage, { props: { text: "```\na\n```" } }).find("[data-test='ai-msg-fold']").exists()).toBe(false);
    expect(mount(AiMessage, { props: { text: "```\n" + body + "\n```", live: true } }).find("[data-test='ai-msg-fold']").exists()).toBe(false);
  });

  it("copies code with a textarea when navigator.clipboard is missing", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    let copiedText = "";
    const exec = vi.fn(() => {
      copiedText = (document.activeElement as HTMLTextAreaElement | null)?.value ?? "";
      return true;
    });
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    const w = mount(AiMessage, { props: { text: "```\nportrait, $hair\n```" }, attachTo: document.body });
    await w.find("[data-test='ai-msg-copy']").trigger("click");
    await vi.waitFor(() => expect(w.find("[data-test='ai-msg-copy']").attributes("aria-label")).toBe("Copied"));
    expect(exec).toHaveBeenCalledWith("copy");
    expect(copiedText).toBe("portrait, $hair");
    expect(document.querySelector("textarea")).toBeNull();
    w.unmount();
  });

  describe("live", () => {
    afterEach(() => vi.restoreAllMocks());

    it("hides half-written markup while streaming", () => {
      const w = mount(AiMessage, { props: { text: "Use **bold tex and [[ab12", live: true } });
      expect(w.find("strong").text()).toBe("bold tex and");
      expect(w.text()).not.toContain("**");
      expect(w.text()).not.toContain("[[");
      // The finished text is parsed as written.
      expect(mount(AiMessage, { props: { text: "Use **bold tex" } }).text()).toBe("Use **bold tex");
    });

    it("fades in only the words added since the last update", async () => {
      const w = mount(AiMessage, { props: { text: "Hair is", live: true } });
      expect(w.classes()).toContain("wp-ai-msg--live");
      await w.setProps({ text: "Hair is red and **short** now" });
      await nextTick();
      const fresh = w.findAll(".wp-ai-msg__new").map((s) => s.text()).join("|");
      expect(fresh).toContain("red and");
      expect(fresh).toContain("short");
      expect(fresh).not.toContain("Hair");
      expect(w.text()).toBe("Hair is red and short now");
      // No marker leaks into the text, chips or code.
      await w.setProps({ text: "Hair is red and **short** now, see `$hair` and [[ab12cd34#Hair]]" });
      expect(w.text()).not.toMatch(/\u{e000}/u);
      expect(w.find("code").text()).toBe("$hair");
      expect(w.find("code .wp-ai-msg__new").exists()).toBe(false);
    });

    it("keeps block markup working where new lines start", async () => {
      const w = mount(AiMessage, { props: { text: "Steps:", live: true } });
      await w.setProps({ text: "Steps:\n\n### Plan ahead\n\n- first one\n- second one" });
      expect(w.find("h5.wp-ai-msg__h").text()).toBe("Plan ahead");
      expect(w.findAll("li").map((l) => l.text())).toEqual(["first one", "second one"]);
      await w.setProps({ text: "Steps:\n\n### Plan ahead\n\n- first one\n- second one\n\n| a | b |\n| --- | --- |\n| 1 | 2 |" });
      expect(w.findAll("td").map((c) => c.text())).toEqual(["1", "2"]);
    });
  });
});

