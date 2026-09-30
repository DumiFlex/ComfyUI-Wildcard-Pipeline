import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";

/**
 * The `@` popover's last row creates a placeholder: a ref to a module that
 * does not exist yet, inserted as `@{<fresh id>#name}` so it renders as the red
 * broken chip under the typed name and can be repointed later.
 */
type Seams = { __triggerAutocompleteForTest: (t: "@" | "$", q?: string) => void };

let wrap: VueWrapper | null = null;
afterEach(() => {
  wrap?.unmount();
  wrap = null;
});

async function open(query: string, props: Record<string, unknown> = {}, trigger: "@" | "$" = "@") {
  wrap = mount(RichTextInput, {
    props: {
      modelValue: "",
      surface: "wildcard",
      refSuggestions: ["aabbccdd"],
      uuidToName: new Map([["aabbccdd", "outfit"]]),
      ...props,
    },
    attachTo: document.body,
  });
  (wrap.vm as unknown as Seams).__triggerAutocompleteForTest(trigger, query);
  await wrap.vm.$nextTick();
  return document.querySelector<HTMLElement>('[data-test="suggestion-placeholder"]');
}

function lastValue(): string | undefined {
  const evs = wrap?.emitted("update:modelValue") ?? [];
  return evs.length ? (evs[evs.length - 1] as string[])[0] : undefined;
}

describe("RichTextInput — @ placeholder row", () => {
  it("offers a placeholder for a name no module has, even with zero matches", async () => {
    const row = await open("castle");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("@castle");
  });

  it("inserts a red unresolved chip carrying the typed name", async () => {
    const row = await open("castle");
    row!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await wrap!.vm.$nextTick();
    const value = lastValue()!;
    expect(value).toMatch(/^@\{[0-9a-f]{8}#castle\}$/);
    expect(value).not.toContain("aabbccdd");
    await wrap!.vm.$nextTick();
    const chip = wrap!.find(".wp-refchip--unresolved");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("castle");
  });

  it("is hidden when a module already has that name", async () => {
    expect(await open("Outfit")).toBeNull();
  });

  it("is hidden for an empty query and for $ vars", async () => {
    expect(await open("")).toBeNull();
    wrap!.unmount();
    wrap = null;
    expect(await open("castle", { surface: "combine" }, "$")).toBeNull();
  });

  it("is hidden where nested refs are off", async () => {
    expect(await open("castle", { surface: "combine" })).toBeNull();
  });
});

describe("RichTextInput — broken-ref field outline", () => {
  it("outlines a field holding a ref that points at nothing", async () => {
    wrap = mount(RichTextInput, {
      props: {
        modelValue: "a @{11223344#castle}",
        surface: "wildcard",
        uuidToName: new Map([["aabbccdd", "outfit"]]),
      },
    });
    await wrap.vm.$nextTick();
    expect(wrap.find(".wp-rt").classes()).toContain("wp-rt--broken");
    await wrap.setProps({ modelValue: "a @{aabbccdd#outfit}" });
    await wrap.vm.$nextTick();
    expect(wrap.find(".wp-rt").classes()).not.toContain("wp-rt--broken");
  });
});
