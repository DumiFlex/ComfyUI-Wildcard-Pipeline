import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ColorField from "./ColorField.vue";

function mk(props: Record<string, unknown> = {}) {
  return mount(ColorField, { props: { modelValue: "#ff0000", dataTest: "cf", ...props }, attachTo: document.body });
}
function hexBox(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('[data-test="cf-hex"]');
  if (!el) throw new Error("hex box not open");
  return el;
}
function last(w: ReturnType<typeof mk>): string {
  const all = w.emitted("update:modelValue") ?? [];
  return all[all.length - 1]?.[0] as string;
}
async function openPanel(w: ReturnType<typeof mk>) {
  await w.find('[data-test="cf"]').trigger("click");
}

describe("ColorField", () => {
  it("shows the value and opens on click", async () => {
    const w = mk();
    expect(w.find('[data-test="cf"]').text()).toBe("#ff0000");
    await openPanel(w);
    expect(document.querySelector('[data-test="cf-hex"]')).not.toBeNull();
    w.unmount();
  });

  it("takes a typed hex and keeps the alpha only with alpha on", async () => {
    const w = mk();
    await openPanel(w);
    const hex = hexBox();
    hex.value = "#00ff0080";
    hex.dispatchEvent(new Event("change"));
    expect(last(w)).toBe("#00ff00");
    w.unmount();
    const a = mk({ alpha: true });
    await openPanel(a);
    const hexA = hexBox();
    hexA.value = "#0f08";
    hexA.dispatchEvent(new Event("change"));
    expect(last(a)).toBe("#00ff0088");
    hexA.value = "nope";
    hexA.dispatchEvent(new Event("change"));
    expect(a.emitted("update:modelValue")).toHaveLength(1);
    a.unmount();
  });

  it("offers None with allow-none and marks it on the swatch", async () => {
    const w = mk({ allowNone: true });
    await openPanel(w);
    (document.querySelector('[data-test="cf-none"]') as HTMLElement).click();
    expect(last(w)).toBe("none");
    w.unmount();
    const none = mk({ modelValue: "none" });
    expect(none.find('[data-test="cf"]').classes()).toContain("is-none");
    none.unmount();
  });

  it("keeps a colour name it can't edit", () => {
    const w = mk({ modelValue: "red" });
    expect(w.find('[data-test="cf"]').text()).toBe("red");
    w.unmount();
  });
});
