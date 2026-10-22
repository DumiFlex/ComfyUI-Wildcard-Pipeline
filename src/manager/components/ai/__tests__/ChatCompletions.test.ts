import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import ChatCompletions from "../ChatCompletions.vue";
import { useModuleStore } from "../../../stores/moduleStore";
import { useBundleStore } from "../../../stores/bundleStore";
import type { BundleRow, ModuleRow } from "../../../api/types";

/** A chat-like box: a v-model textarea whose Enter "sends", plus the menu. */
const Box = defineComponent({
  setup() {
    const text = ref("");
    const sent = ref<string[]>([]);
    const el = ref<HTMLTextAreaElement | null>(null);
    return () => h("div", [
      h("textarea", {
        ref: el,
        value: text.value,
        "data-test": "box",
        onInput: (e: Event) => { text.value = (e.target as HTMLTextAreaElement).value; },
        onKeydown: (e: KeyboardEvent) => { if (e.key === "Enter") sent.value.push(text.value); },
      }),
      h(ChatCompletions, { target: el.value }),
      h("output", { "data-test": "text" }, text.value),
      h("output", { "data-test": "sent" }, sent.value.join("|")),
    ]);
  },
});

async function type(box: HTMLTextAreaElement, value: string): Promise<void> {
  box.value = value;
  box.setSelectionRange(value.length, value.length);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  await nextTick();
}

describe("ChatCompletions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useModuleStore().catalog = [
      { id: "aaaa0001", name: "Hairstyle", type: "wildcard", payload: { var_binding: "hair" } },
      { id: "aaaa0002", name: "Weather", type: "wildcard", payload: { var_binding: "weather" } },
    ] as unknown as ModuleRow[];
    useBundleStore().catalog = [] as unknown as BundleRow[];
    document.body.innerHTML = "";
  });

  it("offers @ items and Enter inserts a mention instead of sending", async () => {
    const wrap = mount(Box, { attachTo: document.body });
    await nextTick();
    const box = wrap.find('[data-test="box"]').element as HTMLTextAreaElement;
    await type(box, "more options for @hai");
    const rows = document.querySelectorAll('[data-test^="ai-ac-row-"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Hairstyle");
    expect(box.getAttribute("aria-expanded")).toBe("true");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await nextTick();
    expect(wrap.find('[data-test="text"]').text()).toBe("more options for @Hairstyle");
    expect(wrap.find('[data-test="sent"]').text()).toBe("");
    expect(document.querySelector('[data-test="ai-ac"]')).toBeNull();
    // Closed again: Enter is the box's own.
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await nextTick();
    expect(wrap.find('[data-test="sent"]').text()).toContain("@Hairstyle");
    wrap.unmount();
  });

  it("offers $ variables and Escape closes without inserting", async () => {
    const wrap = mount(Box, { attachTo: document.body });
    await nextTick();
    const box = wrap.find('[data-test="box"]').element as HTMLTextAreaElement;
    await type(box, "use $wea");
    expect(document.querySelector('[data-test="ai-ac"]')?.textContent).toContain("$weather");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await nextTick();
    expect(document.querySelector('[data-test="ai-ac"]')).toBeNull();
    expect(wrap.find('[data-test="text"]').text()).toBe("use $wea");
    wrap.unmount();
  });
});
