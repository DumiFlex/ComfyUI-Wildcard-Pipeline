import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { useEditorShortcuts } from "../../composables/useEditorShortcuts";

function harness(onSave: () => void, onCancel: () => void, enabled?: () => boolean) {
  const Harness = defineComponent({
    setup() {
      useEditorShortcuts({ onSave, onCancel, enabled });
      return () => h("div");
    },
  });
  return mount(Harness, { attachTo: document.body });
}

function dispatchKey(target: Element | Document | Window, key: string, modifiers: { ctrl?: boolean; meta?: boolean } = {}) {
  const evt = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: !!modifiers.ctrl, metaKey: !!modifiers.meta });
  (target as EventTarget).dispatchEvent(evt);
}

describe("useEditorShortcuts", () => {
  it("Ctrl+S triggers onSave", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const wrap = harness(onSave, onCancel);
    dispatchKey(window, "s", { ctrl: true });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    wrap.unmount();
  });

  it("Cmd+S triggers onSave (Mac)", () => {
    const onSave = vi.fn();
    const wrap = harness(onSave, () => {});
    dispatchKey(window, "s", { meta: true });
    expect(onSave).toHaveBeenCalledOnce();
    wrap.unmount();
  });

  it("Esc triggers onCancel when focus is not in an input", () => {
    const onCancel = vi.fn();
    const wrap = harness(() => {}, onCancel);
    dispatchKey(document.body, "Escape");
    expect(onCancel).toHaveBeenCalledOnce();
    wrap.unmount();
  });

  it("Esc inside an input does NOT trigger onCancel", () => {
    const onCancel = vi.fn();
    const wrap = harness(() => {}, onCancel);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    dispatchKey(input, "Escape");
    expect(onCancel).not.toHaveBeenCalled();
    document.body.removeChild(input);
    wrap.unmount();
  });

  it("enabled=false blocks both shortcuts", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const wrap = harness(onSave, onCancel, () => false);
    dispatchKey(window, "s", { ctrl: true });
    dispatchKey(document.body, "Escape");
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    wrap.unmount();
  });
});
