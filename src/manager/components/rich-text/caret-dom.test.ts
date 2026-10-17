import { describe, expect, it } from "vitest";
import {
  inTextSpan, isChipEl, isTextSpan, placeCaretInText, selectCollapsed, setCaretAtSpanEdge,
  textDescendants, visibleOffsetWithin,
} from "./caret-dom";
import { ZWSP } from "./ref-atoms";

function span(html: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "wp-rt__text";
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("textDescendants", () => {
  it("collects text nodes in document order", () => {
    const el = span('ab<span class="wp-rt-dp-brace">{c|d}</span>e');
    expect(textDescendants(el).map((t) => t.data)).toEqual(["ab", "{c|d}", "e"]);
  });
});

describe("setCaretAtSpanEdge", () => {
  it("lands on the first / last real text node", () => {
    const el = span('<span class="wp-rt-dp-brace">{a|b}</span>tail');
    const r = document.createRange();
    setCaretAtSpanEdge(el, "start", r);
    expect([(r.startContainer as Text).data, r.startOffset]).toEqual(["{a|b}", 0]);
    setCaretAtSpanEdge(el, "end", r);
    expect([(r.startContainer as Text).data, r.startOffset]).toEqual(["tail", 4]);
  });

  it("falls back to the span itself when it has no text", () => {
    const el = span("");
    const r = document.createRange();
    setCaretAtSpanEdge(el, "end", r);
    expect([r.startContainer, r.startOffset]).toEqual([el, 0]);
  });
});

describe("placeCaretInText", () => {
  it("skips ZWSP pads in a bare text node", () => {
    const t = document.createTextNode(`${ZWSP}abc`);
    document.body.appendChild(t);
    const r = document.createRange();
    placeCaretInText(r, t, 2);
    expect(r.startOffset).toBe(3);
  });

  it("descends into coloured sub-spans", () => {
    const el = span('ab<span class="wp-rt-dp-brace">{c|d}</span>');
    const r = document.createRange();
    placeCaretInText(r, el, 4);
    expect([(r.startContainer as Text).data, r.startOffset]).toEqual(["{c|d}", 2]);
    placeCaretInText(r, el, 99);
    expect([(r.startContainer as Text).data, r.startOffset]).toEqual(["{c|d}", 5]);
  });

  it("uses the element when it holds no text", () => {
    const el = span("");
    const r = document.createRange();
    placeCaretInText(r, el, 3);
    expect([r.startContainer, r.startOffset]).toEqual([el, 0]);
  });
});

describe("visibleOffsetWithin", () => {
  it("sums visible chars before the target node", () => {
    const el = span(`a${ZWSP}b<span>cd</span>`);
    const inner = textDescendants(el)[1];
    expect(visibleOffsetWithin(el, inner, 1)).toBe(3);
    expect(visibleOffsetWithin(el, document.createTextNode("x"), 0)).toBeNull();
  });
});

describe("selectCollapsed", () => {
  it("collapses the range and selects it", () => {
    const el = span("hello");
    const r = document.createRange();
    r.setStart(el.firstChild as Text, 1);
    r.setEnd(el.firstChild as Text, 4);
    selectCollapsed(r);
    const sel = window.getSelection();
    expect(sel?.rangeCount).toBe(1);
    expect(sel?.isCollapsed).toBe(true);
    expect(sel?.getRangeAt(0).startOffset).toBe(1);
  });
});

describe("class checks", () => {
  it("recognises text spans, chips and nodes inside a text span", () => {
    const el = span('<span class="wp-rt-dp-brace">x</span>');
    const chip = document.createElement("span");
    chip.className = "wp-refchip";
    expect(isTextSpan(el)).toBe(true);
    expect(isTextSpan(chip)).toBe(false);
    expect(isChipEl(chip)).toBe(true);
    expect(isChipEl(null)).toBe(false);
    expect(isTextSpan(document.createTextNode("x"))).toBe(false);
    expect(inTextSpan(textDescendants(el)[0])).toBe(true);
    expect(inTextSpan(chip)).toBe(false);
    expect(inTextSpan(document.createComment("c"))).toBe(false);
  });
});
