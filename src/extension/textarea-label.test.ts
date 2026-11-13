// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installTextareaLabelFix, labelFor } from "./textarea-label";

function box(nodeId: string): { area: HTMLTextAreaElement; label: HTMLLabelElement } {
  const node = document.createElement("div");
  node.dataset.nodeId = nodeId;
  const wrap = document.createElement("div");
  const label = document.createElement("label");
  label.htmlFor = `ta-${nodeId}`;
  label.textContent = "prompt";
  const area = document.createElement("textarea");
  area.id = `ta-${nodeId}`;
  wrap.append(label, area);
  node.append(wrap);
  document.body.append(node);
  return { area, label };
}

function scrollTo(area: HTMLTextAreaElement, top: number): void {
  area.scrollTop = top;
  area.dispatchEvent(new Event("scroll"));
}

let off = (): void => {};
afterEach(() => { off(); document.body.innerHTML = ""; });

describe("textarea label fix", () => {
  it("finds the label that names the textarea", () => {
    const { area, label } = box("1");
    expect(labelFor(area)).toBe(label);
  });

  it("fades a WP node's label while its box is scrolled and brings it back at the top", () => {
    off = installTextareaLabelFix((id) => id === "1");
    const { area, label } = box("1");
    scrollTo(area, 20);
    expect(label.style.opacity).toBe("0");
    scrollTo(area, 0);
    expect(label.style.opacity).toBe("");
  });

  it("leaves other nodes' boxes alone", () => {
    off = installTextareaLabelFix((id) => id === "1");
    const { area, label } = box("2");
    scrollTo(area, 20);
    expect(label.style.opacity).toBe("");
  });
});
