import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import ChatInputMarks from "../ChatInputMarks.vue";
import { _resetMentionsForTests, rememberMention } from "../../../utils/chat-completions";

const Host = defineComponent({
  props: { start: { type: String, default: "" } },
  setup(props) {
    const box = ref<HTMLTextAreaElement | null>(null);
    const text = ref(props.start);
    return { box, text };
  },
  render() {
    return h("div", [
      h("textarea", { ref: "box", value: this.text, onInput: (e: Event) => { this.text = (e.target as HTMLTextAreaElement).value; } }),
      h(ChatInputMarks, { target: this.box, text: this.text }),
    ]);
  },
});

afterEach(() => _resetMentionsForTests());

describe("ChatInputMarks", () => {
  it("draws a picked @Name as a chip while typing, and clears with the box", async () => {
    const label = rememberMention({ id: "aaaa0007", name: "color" });
    const w = mount(Host, { props: { start: "" }, attachTo: document.body });
    await nextTick();
    expect(w.find('[data-test="ai-input-chip"]').exists()).toBe(false);
    const box = w.find("textarea");
    await box.setValue(`a ${label} shirt`);
    await nextTick();
    const chips = w.findAll('[data-test="ai-input-chip"]');
    expect(chips.map((c) => c.text())).toEqual(["@color"]);
    expect(w.find('[data-test="ai-input-marks"]').text()).toBe("a @color shirt");
    // A sent message clears the box from code, with no input event.
    (w.vm as unknown as { text: string }).text = "";
    await nextTick();
    await nextTick();
    expect(w.find('[data-test="ai-input-chip"]').exists()).toBe(false);
    w.unmount();
  });

  it("leaves a typed @word that was never picked alone", async () => {
    const w = mount(Host, { props: { start: "" }, attachTo: document.body });
    await nextTick();
    await w.find("textarea").setValue("a @color shirt");
    await nextTick();
    expect(w.find('[data-test="ai-input-chip"]').exists()).toBe(false);
    w.unmount();
  });
});
