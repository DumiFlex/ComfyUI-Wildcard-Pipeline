import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BulkAddPanel from "../../components/BulkAddPanel.vue";

describe("BulkAddPanel.vue — options mode", () => {
  function mountOptions() {
    return mount(BulkAddPanel, {
      props: {
        mode: "options",
        existingValues: ["serene"],
        existingTags: ["calm"],
      },
    });
  }

  it("previews new / tagged / weighted / duplicate / new-tags from the paste", async () => {
    const wrap = mountOptions();
    await wrap.get("textarea").setValue([
      "radiant #warm *2", // new, tagged, weighted, new tag #warm
      "serene",           // duplicate vs existing
      "calm-value #calm", // tag already exists
    ].join("\n"));
    const text = wrap.text();
    expect(text).toContain("2 new");
    expect(text).toContain("2 tagged");
    expect(text).toContain("1 weighted");
    expect(text).toContain("1 duplicate skipped");
    // only #warm is novel — #calm already exists
    expect(text).toContain("#warm");
    expect(text).not.toContain("#calm");
  });

  it("emits commit-options with the de-duped parsed payload (not duplicates)", async () => {
    const wrap = mountOptions();
    await wrap.get("textarea").setValue("radiant #warm *2\nserene");
    await wrap.get("button.wp-btn--primary").trigger("click");
    const emitted = wrap.emitted("commit-options");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual([{ value: "radiant", tags: ["warm"], weight: 2 }]);
  });

  it("commit button is disabled when there is nothing new to add", async () => {
    const wrap = mountOptions();
    await wrap.get("textarea").setValue("serene"); // duplicate only
    expect(wrap.get("button.wp-btn--primary").attributes("disabled")).toBeDefined();
  });

  it("emits cancel and clears the textarea", async () => {
    const wrap = mountOptions();
    await wrap.get("textarea").setValue("radiant");
    await wrap.get("button.wp-btn--ghost").trigger("click");
    expect(wrap.emitted("cancel")).toBeTruthy();
    expect((wrap.get("textarea").element as HTMLTextAreaElement).value).toBe("");
  });
});

describe("BulkAddPanel.vue — values mode", () => {
  function mountValues() {
    return mount(BulkAddPanel, {
      props: { mode: "values", existingValues: ["cfg"] },
    });
  }

  it("previews new vs updated by name (case-insensitive)", async () => {
    const wrap = mountValues();
    await wrap.get("textarea").setValue("cfg = 5\nsteps = 30");
    const text = wrap.text();
    expect(text).toContain("1 new");
    expect(text).toContain("1 updated");
  });

  it("emits commit-values folded by name (last line wins)", async () => {
    const wrap = mountValues();
    await wrap.get("textarea").setValue("steps = 20\nsteps = 30\ncfg = 5");
    await wrap.get("button.wp-btn--primary").trigger("click");
    const emitted = wrap.emitted("commit-values");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual([
      { name: "steps", value: "30" },
      { name: "cfg", value: "5" },
    ]);
  });
});
