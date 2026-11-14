import { describe, expect, it } from "vitest";
import { keepEditorWhenLinked } from "./linked-editor";

/** The parts of ComfyUI's widget classes this pins: `computedDisabled` is a
 *  plain field, `connectionSuppressed` a prototype accessor over the widget's
 *  visibility record, and a DOM widget hides itself while computedDisabled. */
class FakeWidget {
  disabled?: boolean;
  computedDisabled?: boolean;
  suppressedByConnection = false;
  get connectionSuppressed(): boolean {
    return this.suppressedByConnection;
  }
  set connectionSuppressed(v: boolean | undefined) {
    this.suppressedByConnection = v === true;
  }
  isVisible(): boolean {
    return !this.computedDisabled;
  }
}

/** What `LGraphNode.updateComputedDisabled` does on every draw. */
function hostMarks(w: FakeWidget, connected: boolean): void {
  w.computedDisabled = w.disabled || connected;
  w.connectionSuppressed = connected;
}

describe("keepEditorWhenLinked", () => {
  it("a linked stock widget is hidden (the bug's cause)", () => {
    const w = new FakeWidget();
    hostMarks(w, true);
    expect(w.isVisible()).toBe(false);
    expect(w.connectionSuppressed).toBe(true);
  });

  it("keeps the editor visible and unsuppressed while linked", () => {
    const w = new FakeWidget();
    keepEditorWhenLinked(w);
    hostMarks(w, true);
    expect(w.computedDisabled).toBe(false);
    expect(w.isVisible()).toBe(true);
    expect(w.connectionSuppressed).toBe(false);
    // The host's write never reached the visibility record either, which is
    // what Nodes 2.0 reads.
    expect(w.suppressedByConnection).toBe(false);
  });

  it("still honours the widget's own disabled flag", () => {
    const w = new FakeWidget();
    keepEditorWhenLinked(w);
    w.disabled = true;
    hostMarks(w, false);
    expect(w.computedDisabled).toBe(true);
    expect(w.isVisible()).toBe(false);
  });
});
