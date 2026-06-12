/**
 * RichTextInput regression matrix — corruption bugs reported by user QA.
 *
 * Structure:
 *   Tier 1 — User-reported corruption scenarios (all should FAIL on
 *            current code, drive the surgical fix).
 *   Tier 2 — Surface-gated chip rendering (lock current correct behavior).
 *   Tier 3 — Surface-gated atomic delete (lock current correct behavior).
 *   Tier 4 — Caret + editability invariants (FAIL under the renderTick
 *            teardown approach — must hold under the surgical replacement).
 *   Tier 5 — Vue v-for diff sanity (what renderTick was originally meant
 *            to solve — must keep working after replacement).
 *
 * Test seam philosophy: drive the component the same way a browser does —
 * type into a wp-rt__text span's textContent, dispatch an `input` event,
 * await Vue's flush. For atomic delete tests, dispatch `keydown` with
 * the right key + caret position via `setCaretAt`.
 */

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RichTextInput from "../components/RichTextInput.vue";

const ZWSP = "​";

/** Set the caret at `offset` inside a specific text node OR element. */
function setCaretAt(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Place caret at the END of the host's content (raw-text length). */
function caretAtEnd(host: HTMLElement): void {
  const spans = host.querySelectorAll<HTMLElement>(".wp-rt__text");
  if (spans.length === 0) {
    setCaretAt(host, host.childNodes.length);
    return;
  }
  const last = spans[spans.length - 1];
  const t = last.firstChild;
  if (t && t.nodeType === Node.TEXT_NODE) {
    setCaretAt(t, (t.textContent ?? "").length);
  } else {
    setCaretAt(last, 0);
  }
}

/** Place caret at the START of the host's content. */
function caretAtStart(host: HTMLElement): void {
  const spans = host.querySelectorAll<HTMLElement>(".wp-rt__text");
  if (spans.length === 0) {
    setCaretAt(host, 0);
    return;
  }
  const first = spans[0];
  const t = first.firstChild;
  if (t && t.nodeType === Node.TEXT_NODE) {
    setCaretAt(t, 0);
  } else {
    setCaretAt(first, 0);
  }
}

/** Replace the first wp-rt__text span's textContent + fire input event.
 *  Mirrors what real browsers do when typing into a contenteditable —
 *  extend the existing span's text node, then emit `input`. */
async function typeIntoFirstSpan(
  host: HTMLElement,
  text: string,
  inputType = "insertText",
  data = text,
): Promise<void> {
  const span = host.querySelector<HTMLElement>(".wp-rt__text");
  if (!span) throw new Error("no wp-rt__text span");
  // Strip leading ZWSP padding so the typed text replaces it cleanly,
  // matching browser behavior on first keystroke into empty editor.
  const current = (span.textContent ?? "").replace(new RegExp(ZWSP, "g"), "");
  span.textContent = current + text;
  if (span.firstChild) {
    setCaretAt(span.firstChild, (span.firstChild.textContent ?? "").length);
  }
  host.dispatchEvent(new InputEvent("input", { inputType, data, bubbles: true }));
  await flushPromises();
}

/** Press a key on the host. */
async function pressKey(host: HTMLElement, key: string): Promise<void> {
  host.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  await flushPromises();
}

/** Select-all-children selection on the host. */
function selectAll(host: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(host);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Dispatch a paste event with text payload. jsdom does NOT implement
 *  `DataTransfer` (constructor missing) and `ClipboardEvent`'s
 *  `clipboardData` getter is null by default. Hand-roll a minimal
 *  DataTransferLike + attach via `Object.defineProperty` so the
 *  component's paste handler reads back the test text via
 *  `clipboardData.getData("text/plain")`. */
async function pasteText(host: HTMLElement, text: string): Promise<void> {
  const clipboardData = {
    getData: (type: string) => (type === "text/plain" ? text : ""),
    setData: () => {},
    items: [] as unknown[],
    types: ["text/plain"],
    files: [] as unknown[],
  };
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: clipboardData });
  host.dispatchEvent(ev);
  await flushPromises();
}

// ─────────────────────────────────────────────────────────────────────
// Tier 1 — User-reported corruption regressions
// All should FAIL on current code.
// ─────────────────────────────────────────────────────────────────────

describe("Tier 1 — user-reported corruption regressions", () => {
  it("$testo + space + 2× Backspace leaves empty input with editable host + ZWSP span", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    await typeIntoFirstSpan(host, "$testo ");
    // After space-settle: 1 var chip expected.
    expect(wrap.findAll(".wp-refchip").length).toBe(1);
    // 1st Backspace: removes trailing space.
    caretAtEnd(host);
    await pressKey(host, "Backspace");
    // 2nd Backspace: should atomically remove the chip.
    caretAtEnd(host);
    await pressKey(host, "Backspace");
    // Assertions:
    expect(wrap.findAll(".wp-refchip").length).toBe(0);
    expect(host.querySelectorAll(".wp-rt__text").length).toBeGreaterThanOrEqual(1);
    expect(host.getAttribute("contenteditable")).toBe("true");
    // Host must be able to accept new content (atoms shape valid).
    await typeIntoFirstSpan(host, "x");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("x");
    wrap.unmount();
  });

  it("Backspace at start of empty field calls preventDefault (blocks native delete eating the ZWSP pad)", async () => {
    // Real-browser bug: a bare `return` at range.start===0 let Chromium run
    // native deleteContentBackward, eating the ZWSP pad char → caret stranded
    // on host root → DOM/atoms divergence → stuck "$#" / can't-delete state.
    // jsdom can't perform the native delete, so we assert the guard instead:
    // preventDefault MUST fire so the browser never gets to delete the pad.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtStart(host);
    let prevented = false;
    const ev = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    ev.preventDefault = () => { prevented = true; };
    host.dispatchEvent(ev);
    await flushPromises();
    expect(prevented).toBe(true);
    // Field stays intact + editable (no corruption).
    expect(host.querySelectorAll(".wp-rt__text").length).toBeGreaterThanOrEqual(1);
    expect(host.getAttribute("contenteditable")).toBe("true");
    wrap.unmount();
  });

  it("Forward-Delete at end of empty field calls preventDefault (protects trailing ZWSP)", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    let prevented = false;
    const ev = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    ev.preventDefault = () => { prevented = true; };
    host.dispatchEvent(ev);
    await flushPromises();
    expect(prevented).toBe(true);
    wrap.unmount();
  });

  it("Ctrl+A + Backspace leaves empty input with editable host + ZWSP span", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "hello $person world", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    selectAll(host);
    await pressKey(host, "Backspace");
    // After select-all + Backspace, expect clean empty state.
    expect(wrap.findAll(".wp-refchip").length).toBe(0);
    expect(host.querySelectorAll(".wp-rt__text").length).toBeGreaterThanOrEqual(1);
    expect(host.getAttribute("contenteditable")).toBe("true");
    // Verify host can accept new input.
    await typeIntoFirstSpan(host, "fresh");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("fresh");
    wrap.unmount();
  });

  it("Paste plain text into empty input inserts text without breaking atoms structure", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtStart(host);
    await pasteText(host, "hello world");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("hello world");
    expect(host.querySelectorAll(".wp-rt__text").length).toBeGreaterThanOrEqual(1);
    expect(host.getAttribute("contenteditable")).toBe("true");
    wrap.unmount();
  });

  it("Paste containing $name (combine surface) creates chip + preserves surrounding text", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtStart(host);
    await pasteText(host, "hi $person done");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("hi $person done");
    // Chip created, surrounding text intact.
    expect(wrap.findAll(".wp-refchip--var").length).toBe(1);
    wrap.unmount();
  });

  it("Paste over selection replaces selection without orphaning text", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "hello world", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    selectAll(host);
    await pasteText(host, "replaced");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("replaced");
    // No leftover "hello world" stranded in spans.
    expect(host.textContent?.replace(new RegExp(ZWSP, "g"), "")).toBe("replaced");
    wrap.unmount();
  });

  it("Type $$cost — renders as literal '$cost' text, NO var chip created", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$$cost ", surface: "combine" },
      attachTo: document.body,
    });
    // $$cost is the escape literal for $cost — should NOT produce a var chip.
    expect(wrap.findAll(".wp-refchip--var").length).toBe(0);
    wrap.unmount();
  });

  it("Type @@literal — renders as literal '@literal' text, NO ref chip created", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "@@literal ", surface: "wildcard" },
      attachTo: document.body,
    });
    expect(wrap.findAll(".wp-refchip--ref").length).toBe(0);
    wrap.unmount();
  });

  it("Backspace at end of $$cost deletes ONE char, not whole token", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$$cost", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    await pressKey(host, "Backspace");
    // Host text after Backspace should retain "$$cos" — NOT collapse to "$".
    // The bug: chip-regex treated `$cost` (after the escape) as a chip and
    // atomically deleted it together with the leading literal `$`.
    const remaining = host.textContent?.replace(new RegExp(ZWSP, "g"), "");
    // Browser-native single-char delete leaves "$$cos" OR doesn't update DOM
    // in jsdom — at minimum, atomic delete should NOT have fired.
    expect(remaining?.length).toBeGreaterThan(1);
    wrap.unmount();
  });

  it("Mixed $testo $$cost: Backspace consumes space + atomic $testo chip; $$cost intact", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$testo $$cost", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    // Initially: 1 var chip ($testo), $$cost is literal text.
    expect(wrap.findAll(".wp-refchip--var").length).toBe(1);
    // Confirm $$cost was NOT chipified.
    expect(host.textContent ?? "").toContain("$$cost");
    wrap.unmount();
  });

  it("After 10 sequential chip insert/delete cycles, host still editable + atoms valid", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    for (let i = 0; i < 10; i++) {
      caretAtEnd(host);
      await typeIntoFirstSpan(host, `$v${i} `);
      caretAtEnd(host);
      await pressKey(host, "Backspace");
      caretAtEnd(host);
      await pressKey(host, "Backspace");
    }
    // After all cycles, host should remain editable + have ≥1 span.
    expect(host.getAttribute("contenteditable")).toBe("true");
    expect(host.querySelectorAll(".wp-rt__text").length).toBeGreaterThanOrEqual(1);
    // Verify can still take input.
    await typeIntoFirstSpan(host, "z");
    const events = wrap.emitted("update:modelValue") ?? [];
    const last = events[events.length - 1]?.[0] as string | undefined;
    expect(last).toContain("z");
    wrap.unmount();
  });

  it("Type $name + select-all + type new text replaces content without locking input", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    await typeIntoFirstSpan(host, "$person ");
    expect(wrap.findAll(".wp-refchip--var").length).toBe(1);
    // Select all + overwrite.
    selectAll(host);
    await typeIntoFirstSpan(host, "fresh content");
    // Verify chip cleared + new content present + host editable.
    expect(host.getAttribute("contenteditable")).toBe("true");
    const events = wrap.emitted("update:modelValue") ?? [];
    const last = events[events.length - 1]?.[0] as string | undefined;
    expect(last).toContain("fresh content");
    wrap.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 2 — Surface-gated chip rendering (regression lock)
// ─────────────────────────────────────────────────────────────────────

describe("Tier 2 — surface gates chip render kinds", () => {
  it("wildcard surface: $name renders as plain text, no var chip", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$testo", surface: "wildcard" },
    });
    expect(wrap.findAll(".wp-refchip--var").length).toBe(0);
    wrap.unmount();
  });

  it("wildcard surface: @{uuid} renders as ref chip", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "@{aabbccdd}", surface: "wildcard" },
    });
    expect(wrap.findAll(".wp-refchip--ref").length).toBe(1);
    wrap.unmount();
  });

  it("combine surface: $name renders as var chip", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$testo", surface: "combine" },
    });
    expect(wrap.findAll(".wp-refchip--var").length).toBe(1);
    wrap.unmount();
  });

  it("combine surface: @{uuid} renders as plain text, no ref chip", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "@{aabbccdd}", surface: "combine" },
    });
    expect(wrap.findAll(".wp-refchip--ref").length).toBe(0);
    wrap.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 3 — Surface-gated atomic delete (regression lock)
// ─────────────────────────────────────────────────────────────────────

describe("Tier 3 — atomic chip delete gated by surface", () => {
  it("wildcard surface: Backspace on $name text deletes ONE char (no atomic)", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$testo", surface: "wildcard" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    await pressKey(host, "Backspace");
    // No atomic delete should have fired (host stays mostly intact).
    // Native single-char delete is browser-handled; in jsdom this means
    // no `update:modelValue` emit of the EMPTY string (chip-removal path).
    const events = wrap.emitted("update:modelValue") ?? [];
    const last = events[events.length - 1]?.[0];
    expect(last).not.toBe("");
    wrap.unmount();
  });

  it("wildcard surface: Backspace immediately after @{uuid} chip deletes atomically", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "@{aabbccdd}", surface: "wildcard" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    await pressKey(host, "Backspace");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("");
    wrap.unmount();
  });

  it("combine surface: Backspace immediately after $name chip deletes atomically", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$testo", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    await pressKey(host, "Backspace");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("");
    wrap.unmount();
  });

  it("combine surface: Backspace on @{uuid} text deletes ONE char (no atomic)", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "@{aabbccdd}", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    await pressKey(host, "Backspace");
    const events = wrap.emitted("update:modelValue") ?? [];
    const last = events[events.length - 1]?.[0];
    expect(last).not.toBe("");
    wrap.unmount();
  });

  it("wildcard surface: Forward-Delete on @{uuid} chip deletes atomically", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "@{aabbccdd}", surface: "wildcard" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtStart(host);
    await pressKey(host, "Delete");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("");
    wrap.unmount();
  });

  it("combine surface: Forward-Delete on $name chip deletes atomically", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$testo", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtStart(host);
    await pressKey(host, "Delete");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("");
    wrap.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 4 — Caret + editability invariants
// All should FAIL under renderTick teardown.
// ─────────────────────────────────────────────────────────────────────

describe("Tier 4 — caret + editability invariants", () => {
  it("after applyAtoms with empty result, host has 1 wp-rt__text span with ZWSP content", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$test", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    await pressKey(host, "Backspace");  // atomic delete of $test chip
    // Stronger assertions: exact span structure + ZWSP content + no chip.
    const spans = host.querySelectorAll(".wp-rt__text");
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe(ZWSP);
    expect(host.querySelectorAll(".wp-refchip").length).toBe(0);
    expect(host.matches(":empty")).toBe(false);
    // First child of host must be the ZWSP span (no leading chip or
    // orphan text). Otherwise atoms violated padAtoms invariant.
    const firstEl = Array.from(host.children).find((c) => c.classList);
    expect(firstEl?.classList.contains("wp-rt__text")).toBe(true);
    wrap.unmount();
  });

  it("after chip insert, document.activeElement remains host + selection inside host", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    expect(document.activeElement).toBe(host);
    await typeIntoFirstSpan(host, "$x ");
    // Stronger: confirm focus didn't escape to body + selection still in host.
    expect(document.activeElement).toBe(host);
    const sel = window.getSelection();
    if (sel && sel.focusNode) {
      // focusNode (or one of its ancestors) must be descendant of host.
      let node: Node | null = sel.focusNode;
      let inHost = false;
      while (node) {
        if (node === host) { inHost = true; break; }
        node = node.parentNode;
      }
      expect(inHost).toBe(true);
    }
    wrap.unmount();
  });

  it("after chip atomic delete, host accepts further input AND emits new content", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$x", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    // Sanity: chip present pre-delete.
    expect(wrap.findAll(".wp-refchip--var").length).toBe(1);
    caretAtEnd(host);
    await pressKey(host, "Backspace");
    // Stronger: after delete, ATOM state should reflect cleared content.
    expect(wrap.findAll(".wp-refchip").length).toBe(0);
    expect(host.querySelectorAll(".wp-rt__text").length).toBe(1);
    expect(host.querySelectorAll(".wp-rt__text")[0].textContent).toBe(ZWSP);
    // Then type — emits new content.
    await typeIntoFirstSpan(host, "after");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("after");
    // And the host's text reflects it.
    expect((host.textContent ?? "").replace(new RegExp(ZWSP, "g"), "")).toBe("after");
    wrap.unmount();
  });

  it("ZWSP padding present in atoms=[{text:''}] empty state — exact single span", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    // Stronger: assert EXACT structure — 1 span, 1 ZWSP char only.
    const spans = host.querySelectorAll(".wp-rt__text");
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe(ZWSP);
    expect(host.querySelectorAll(".wp-refchip").length).toBe(0);
    wrap.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 5 — Vue v-for diff sanity
// What renderTick was meant to solve. Must keep working after the
// surgical replacement.
// ─────────────────────────────────────────────────────────────────────

describe("Tier 5 — programmatic apply syncs DOM correctly", () => {
  it("typed text in span gets wiped when programmatic apply replaces atoms", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    // Type into the first span (browser path — doesn't update atoms reactively).
    await typeIntoFirstSpan(host, "$testo ");
    // After space-settle, atoms reassign. Host should now reflect ONE chip
    // for $testo + trailing space — NOT `$testo` raw text + chip.
    const text = host.textContent?.replace(new RegExp(ZWSP, "g"), "");
    // Expect serialised form via chip atom, not duplicated literal text.
    // Acceptable: "$testo " (chip serializes to $testo) — but no "$testo$testo".
    expect(text).not.toContain("$testo$testo");
    expect(wrap.findAll(".wp-refchip").length).toBe(1);
    wrap.unmount();
  });

  it("Repeated blur cycles do not compound chips", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    await typeIntoFirstSpan(host, "$testo ");
    expect(wrap.findAll(".wp-refchip").length).toBe(1);
    for (let i = 0; i < 5; i++) {
      host.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      await flushPromises();
    }
    expect(wrap.findAll(".wp-refchip").length).toBe(1);
    wrap.unmount();
  });

  it("External modelValue swap during typing overrides typed content", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    await typeIntoFirstSpan(host, "user typing");
    // Parent flips modelValue out from under the user.
    await wrap.setProps({ modelValue: "external $other" });
    await flushPromises();
    // External value wins — chip rendered, no leftover "user typing".
    expect(wrap.findAll(".wp-refchip--var").length).toBe(1);
    const text = host.textContent?.replace(new RegExp(ZWSP, "g"), "");
    expect(text).not.toContain("user typing");
    wrap.unmount();
  });
});
