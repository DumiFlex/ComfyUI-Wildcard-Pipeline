import { enableAutoUnmount, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import SelectionToolbar from "../../components/SelectionToolbar.vue";

// The menus are kit Popovers, teleported to <body>: query the document, and
// unmount each bar so its open menu doesn't answer the next test.
enableAutoUnmount(afterEach);

function all(sel: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(sel)];
}
function one(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`not found: ${sel}`);
  return el;
}
function menuItem(text: string): HTMLElement {
  const el = all(".wpc-seltoolbar__menuitem").find((b) => b.textContent?.trim() === text);
  if (!el) throw new Error(`menu item "${text}" not found`);
  return el;
}
function labels(): string[] {
  return all(".wpc-seltoolbar__menuitem").map((b) => b.textContent?.trim() ?? "");
}
async function click(el: HTMLElement): Promise<void> {
  el.click();
  await nextTick();
}
async function type(el: HTMLElement, value: string): Promise<void> {
  const input = el instanceof HTMLInputElement ? el : el.querySelector("input");
  if (!input) throw new Error("no input");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
}

function mountBar() {
  return mount(SelectionToolbar, {
    props: { count: 3, tags: ["warm", "cool"] },
  });
}

/** Click a top-level toolbar Button by its label text. */
async function clickBar(wrap: VueWrapper, label: string) {
  const btn = wrap.findAll("button.wp-btn").find((b) => b.text().includes(label));
  if (!btn) throw new Error(`toolbar button "${label}" not found`);
  await btn.trigger("click");
}

describe("SelectionToolbar.vue", () => {
  it("shows the selected count", () => {
    expect(mountBar().text()).toContain("3 selected");
  });

  it("apply-tag fires with an existing tag picked from the menu", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Apply sub-category");
    await click(menuItem("cool"));
    expect(wrap.emitted("apply-tag")?.[0]).toEqual(["cool"]);
  });

  it("apply-tag fires with a brand-new tag typed into the menu", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Apply sub-category");
    await type(one('[data-test="sel-apply-menu"] input.wp-input'), "fresh");
    await click(one(".wpc-seltoolbar__menuitem--new"));
    expect(wrap.emitted("apply-tag")?.[0]).toEqual(["fresh"]);
  });

  it("remove-tag fires from the remove menu", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Remove sub-category");
    await click(menuItem("warm"));
    expect(wrap.emitted("remove-tag")?.[0]).toEqual(["warm"]);
  });

  it("set-weight fires with the entered weight", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Set weight");
    await type(one('[data-test="sel-weight-menu"] input'), "2.5");
    await click(one('[data-test="sel-weight-menu"] button.wp-btn--primary'));
    expect(wrap.emitted("set-weight")?.[0]).toEqual([2.5]);
  });

  it("delete + clear fire their intents", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Delete");
    await clickBar(wrap, "Clear");
    expect(wrap.emitted("delete-selected")).toBeTruthy();
    expect(wrap.emitted("clear")).toBeTruthy();
  });

  it("Apply menu hides tags already on every selected row (commonTags)", async () => {
    const wrap = mount(SelectionToolbar, {
      props: { count: 2, tags: ["warm", "cool"], commonTags: ["warm"] },
    });
    await clickBar(wrap, "Apply sub-category");
    expect(labels()).toContain("cool");
    expect(labels()).not.toContain("warm");
  });

  it("Remove menu lists only tags present on the selection", async () => {
    const wrap = mount(SelectionToolbar, {
      props: { count: 2, tags: ["warm", "cool", "neon"], presentTags: ["neon"] },
    });
    await clickBar(wrap, "Remove sub-category");
    expect(labels()).toEqual(["neon"]);
  });

  it("Remove menu is empty when the selection carries no tags", async () => {
    const wrap = mount(SelectionToolbar, {
      props: { count: 1, tags: ["warm", "cool"], presentTags: [] },
    });
    await clickBar(wrap, "Remove sub-category");
    expect(labels()).toHaveLength(0);
    expect(document.querySelector(".wpc-seltoolbar__menuempty")).not.toBeNull();
  });

  describe("Negative menu", () => {
    function mountNeg(extra: Record<string, unknown> = {}) {
      return mount(SelectionToolbar, {
        props: { count: 3, tags: [], negatives: true, negativeCount: 2, ...extra },
      });
    }

    it("is hidden unless the host opts in", () => {
      expect(mountBar().find("[data-test='sel-negative']").exists()).toBe(false);
      expect(mountNeg().find("[data-test='sel-negative']").exists()).toBe(true);
    });

    it("Add to each / Replace emit the typed words; Clear emits no words", async () => {
      const wrap = mountNeg();
      await wrap.get("[data-test='sel-negative']").trigger("click");
      expect(one("[data-test='sel-negative-menu']").textContent).toContain("2 of 3 already have a negative");
      await type(one("[data-test='sel-negative-input']"), "  fruit ");
      await click(one("[data-test='sel-negative-add']"));
      expect(wrap.emitted("negative-add")?.[0]).toEqual(["fruit"]);
      // Each action closes the menu.
      expect(document.querySelector("[data-test='sel-negative-menu']")).toBeNull();

      await wrap.get("[data-test='sel-negative']").trigger("click");
      await type(one("[data-test='sel-negative-input']"), "blurry");
      await click(one("[data-test='sel-negative-replace']"));
      expect(wrap.emitted("negative-replace")?.[0]).toEqual(["blurry"]);

      await wrap.get("[data-test='sel-negative']").trigger("click");
      await click(one("[data-test='sel-negative-clear']"));
      expect(wrap.emitted("negative-clear")).toHaveLength(1);
    });

    it("says the null option is skipped when it is in the selection", async () => {
      const wrap = mountNeg({ negativeTargets: 2 });
      await wrap.get("[data-test='sel-negative']").trigger("click");
      expect(one("[data-test='sel-negative-menu']").textContent).toContain("The null option is skipped.");
    });
  });

  it("menu chips carry their tag's axis hue as --chip-hue", async () => {
    const wrap = mount(SelectionToolbar, {
      props: {
        count: 1,
        tags: ["warm"],
        tagHues: { warm: "hsl(1 2% 3%)" },
      },
    });
    await clickBar(wrap, "Apply sub-category");
    expect(menuItem("warm").getAttribute("style")).toContain("--chip-hue: hsl(1 2% 3%)");
  });

  it("Clear and Escape on the bar emit clear (the kit SelectionBar)", async () => {
    const wrap = mount(SelectionToolbar, { props: { count: 3, tags: [] }, attachTo: document.body });
    await wrap.get('[data-test="selection-clear"]').trigger("click");
    await wrap.get('[data-test="sel-delete"]').trigger("keydown", { key: "Escape" });
    expect(wrap.emitted("clear")).toHaveLength(2);
  });

  it("Escape inside an open menu closes the menu, not the selection", async () => {
    const wrap = mount(SelectionToolbar, { props: { count: 3, tags: ["warm"] }, attachTo: document.body });
    await clickBar(wrap, "Apply sub-category");
    expect(document.querySelector(".wpc-seltoolbar__menu")).not.toBeNull();
    one('[data-test="sel-apply-menu"] input.wp-input').dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    expect(document.querySelector(".wpc-seltoolbar__menu")).toBeNull();
    expect(wrap.emitted("clear")).toBeUndefined();
    // Focus goes back to the menu's trigger; Escape there with a menu open
    // closes the menu first.
    await clickBar(wrap, "Remove sub-category");
    expect(document.querySelector(".wpc-seltoolbar__menu")).not.toBeNull();
    const trigger = wrap.findAll("button.wp-btn").find((b) => b.text().includes("Remove sub-category"));
    await trigger?.trigger("keydown", { key: "Escape" });
    expect(document.querySelector(".wpc-seltoolbar__menu")).toBeNull();
    expect(wrap.emitted("clear")).toBeUndefined();
  });
});
