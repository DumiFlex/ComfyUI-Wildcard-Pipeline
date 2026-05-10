// CellFactorPopover — cog → factor edit popover. Used by MatrixSection
// + ExceptionsSection for boost/reduce factor overrides. Modal popup
// pattern: click cog opens, click outside / Escape closes, Enter
// commits + closes. ↺ reset deletes the override key.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CellFactorPopover from "./CellFactorPopover.vue";

describe("CellFactorPopover", () => {
  it("renders override factor when given", () => {
    const w = mount(CellFactorPopover, {
      props: { libraryFactor: 2.0, overrideFactor: 5.0, label: "kimono → casual" },
    });
    expect(w.find<HTMLInputElement>('[data-test="cfp-input"]').element.value).toBe("5");
  });

  it("falls back to library factor when no override", () => {
    const w = mount(CellFactorPopover, {
      props: { libraryFactor: 2.0, overrideFactor: null, label: "kimono → casual" },
    });
    expect(w.find<HTMLInputElement>('[data-test="cfp-input"]').element.value).toBe("2");
  });

  it("shows library hint", () => {
    const w = mount(CellFactorPopover, {
      props: { libraryFactor: 2.0, overrideFactor: 5.0, label: "x → y" },
    });
    expect(w.find('[data-test="cfp-library-hint"]').text()).toContain("2");
  });

  it("emits commit with parsed number on input + Enter", async () => {
    const w = mount(CellFactorPopover, {
      props: { libraryFactor: 2.0, overrideFactor: null, label: "x → y" },
    });
    const input = w.find<HTMLInputElement>('[data-test="cfp-input"]');
    input.element.value = "3.5";
    await input.trigger("input");
    await input.trigger("keydown.enter");
    const commits = w.emitted("commit")!;
    expect(commits[commits.length - 1][0]).toBe(3.5);
  });

  it("emits reset when ↺ button clicked", async () => {
    const w = mount(CellFactorPopover, {
      props: { libraryFactor: 2.0, overrideFactor: 5.0, label: "x → y" },
    });
    await w.find('[data-test="cfp-reset"]').trigger("click");
    expect(w.emitted("reset")).toBeTruthy();
  });

  it("hides reset button when no override is set", () => {
    const w = mount(CellFactorPopover, {
      props: { libraryFactor: 2.0, overrideFactor: null, label: "x → y" },
    });
    expect(w.find('[data-test="cfp-reset"]').exists()).toBe(false);
  });

  it("emits close on Escape", async () => {
    const w = mount(CellFactorPopover, {
      props: { libraryFactor: 2.0, overrideFactor: null, label: "x → y" },
    });
    const input = w.find<HTMLInputElement>('[data-test="cfp-input"]');
    await input.trigger("keydown.escape");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("rejects negative input — emits no commit", async () => {
    const w = mount(CellFactorPopover, {
      props: { libraryFactor: 2.0, overrideFactor: null, label: "x → y" },
    });
    const input = w.find<HTMLInputElement>('[data-test="cfp-input"]');
    input.element.value = "-1";
    await input.trigger("input");
    await input.trigger("keydown.enter");
    expect(w.emitted("commit")).toBeFalsy();
  });
});
