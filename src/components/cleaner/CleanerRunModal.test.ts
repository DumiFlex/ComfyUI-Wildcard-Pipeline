import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CleanerRunModal from "./CleanerRunModal.vue";
import type { CleanerTrace } from "./types";

const trace: CleanerTrace = {
  input: "blue eyes, ((silver hair)), Blue Eyes",
  output: "blue eyes, (silver hair:1.21)",
  mode: "tags",
  steps: [
    { rule: "merge_weights", text: "blue eyes, (silver hair:1.21), Blue Eyes" },
    { rule: "whitespace" },
    { rule: "dedupe_exact", text: "blue eyes, (silver hair:1.21)" },
  ],
};
const report = {
  merge_weights: { merged: 1 },
  whitespace: { fixed: 0 },
  dedupe_exact: { dropped: ["Blue Eyes"], matched: ["blue eyes"] },
};

function open(extra: object = {}) {
  return mount(CleanerRunModal, {
    props: { open: true, trace, report, ...extra },
    attachTo: document.body,
  });
}

describe("CleanerRunModal", () => {
  it("lists only the rules that changed the text, with why", () => {
    const w = open();
    const rules = [...document.querySelectorAll("[data-test^=cleaner-run-rule-]")].map((e) => e.getAttribute("data-test"));
    expect(rules).toEqual(["cleaner-run-rule-merge_weights", "cleaner-run-rule-dedupe_exact"]);
    expect(document.querySelector("[data-test=cleaner-run-rule-dedupe_exact]")?.textContent).toContain("Blue Eyes repeats blue eyes");
    w.unmount();
  });

  it("compares whole tags, so a rewritten tag is one out and one in", () => {
    const w = open();
    const del = [...document.querySelectorAll(".wp-diff__del")].map((e) => e.textContent?.replace("removed: ", ""));
    expect(del).toContain("((silver hair)), ");
    w.unmount();
  });

  it("offers the negative only when the run cleaned one", async () => {
    const w = open();
    expect(document.querySelector("[data-test=cleaner-run-side-negative]")).toBeNull();
    w.unmount();
    const n = open({
      negativeTrace: { input: "lowres, red", output: "lowres, red", steps: [] },
      negativeReport: { prompt_overlap: { tags: ["red"], dropped: false } },
    });
    const btn = document.querySelector<HTMLElement>("[data-test=cleaner-run-side-negative]");
    expect(btn).not.toBeNull();
    btn?.click();
    await n.vm.$nextTick();
    expect(document.body.textContent).toContain("Also in the prompt");
    expect(document.body.textContent).toContain("No rules were on for this text.");
    n.unmount();
  });

  it("says to run first when there is no trace", () => {
    const w = open({ trace: null });
    expect(document.body.textContent).toContain("Run the workflow to see what the cleaner changed.");
    w.unmount();
  });
});
