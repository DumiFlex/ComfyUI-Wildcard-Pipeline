import { describe, expect, it } from "vitest";
import { installClipboardShield, isEditableTarget } from "./clipboard-shield";

describe("isEditableTarget", () => {
  it("true for input / textarea / contenteditable, false otherwise", () => {
    const input = document.createElement("input");
    const ta = document.createElement("textarea");
    const ce = document.createElement("div");
    // jsdom doesn't derive isContentEditable from the attribute (no layout),
    // so force the property to exercise the util's contenteditable branch.
    Object.defineProperty(ce, "isContentEditable", { value: true });
    const span = document.createElement("span");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(ta)).toBe(true);
    expect(isEditableTarget(ce)).toBe(true);
    expect(isEditableTarget(span)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("installClipboardShield", () => {
  // root = the shield boundary (stands in for a widget `inner` or document.body);
  // parent = an ancestor handler standing in for ComfyUI's canvas/document listener.
  function setup() {
    const parent = document.createElement("div");
    const root = document.createElement("div");
    const input = document.createElement("input");
    root.appendChild(input);
    parent.appendChild(root);
    document.body.appendChild(parent);
    let reached = false;
    const onParent = (): void => { reached = true; };
    parent.addEventListener("keydown", onParent);
    parent.addEventListener("copy", onParent);
    parent.addEventListener("cut", onParent);
    parent.addEventListener("paste", onParent);
    const cleanup = installClipboardShield(root);
    return {
      root, input, parent,
      reached: () => reached,
      reset: () => { reached = false; },
      teardown: () => { cleanup(); parent.remove(); },
    };
  }

  it("stops Ctrl+A/C/V/X/Z/Y from an editable target reaching ancestors", () => {
    const s = setup();
    for (const k of ["a", "c", "v", "x", "z", "y"]) {
      s.reset();
      s.input.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true }));
      expect(s.reached(), `Ctrl+${k} leaked to the canvas handler`).toBe(false);
    }
    s.teardown();
  });

  it("stops copy / cut / paste from an editable target reaching ancestors", () => {
    const s = setup();
    for (const type of ["copy", "cut", "paste"]) {
      s.reset();
      s.input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      expect(s.reached(), `${type} leaked to the canvas handler`).toBe(false);
    }
    s.teardown();
  });

  it("lets shortcuts through when the target is NOT editable (graph Ctrl+A still works)", () => {
    const s = setup();
    const span = document.createElement("span");
    s.root.appendChild(span);
    span.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(s.reached()).toBe(true);
    s.teardown();
  });

  it("ignores non-clipboard ctrl shortcuts (e.g. Ctrl+S) even on an editable target", () => {
    const s = setup();
    s.input.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(s.reached()).toBe(true);
    s.teardown();
  });

  it("cleanup() removes the shield so events leak again", () => {
    const parent = document.createElement("div");
    const root = document.createElement("div");
    const input = document.createElement("input");
    root.appendChild(input);
    parent.appendChild(root);
    document.body.appendChild(parent);
    let reached = false;
    parent.addEventListener("keydown", () => { reached = true; });
    const cleanup = installClipboardShield(root);
    cleanup();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(reached).toBe(true);
    parent.remove();
  });
});
