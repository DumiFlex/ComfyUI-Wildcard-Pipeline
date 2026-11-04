import { afterEach, describe, expect, it } from "vitest";
import { codeFor, isProbeEvent, keyCodeFor, probeCombo } from "./key-probe";

describe("key probe", () => {
  const added: Array<[EventTarget, (e: Event) => void, boolean]> = [];
  function listen(target: EventTarget, fn: (e: KeyboardEvent) => void, capture = false): void {
    const wrapped = (e: Event): void => fn(e as KeyboardEvent);
    target.addEventListener("keydown", wrapped, capture);
    added.push([target, wrapped, capture]);
  }
  afterEach(() => {
    for (const [t, fn, capture] of added.splice(0)) t.removeEventListener("keydown", fn, capture);
  });

  it("finds a handler that claims the key, and stops it before it acts", () => {
    let ran = 0;
    listen(window, (e) => {
      if (e.altKey && e.key === "1") {
        e.preventDefault();
        ran++;
      }
    });
    expect(probeCombo("Alt+1")).toBe(true);
    expect(ran).toBe(0);
    expect(probeCombo("Alt+2")).toBe(false);
  });

  it("sees a handler that stops the key on its way up", () => {
    listen(document, (e) => { if (e.altKey && e.code === "Digit2") e.stopPropagation(); });
    expect(probeCombo("Alt+2")).toBe(true);
  });

  it("matches the modifiers a real press carries", () => {
    listen(window, (e) => { if (e.ctrlKey && e.shiftKey && e.key === "K") e.preventDefault(); });
    expect(probeCombo("Ctrl+Shift+K")).toBe(true);
    expect(probeCombo("Ctrl+K")).toBe(false);
  });

  it("marks its own events so our handlers can skip them", () => {
    let probe = false;
    listen(window, (e) => { probe = isProbeEvent(e); });
    probeCombo("Alt+5");
    expect(probe).toBe(true);
  });

  it("finds a hotkeys-js style handler that matches on keyCode only", () => {
    // ComfyUI-Easy-Use binds alt+0..9 (node templates) with hotkeys-js,
    // which reads keyCode || which and nothing else, then preventDefaults
    // before it looks at its own setting.
    listen(document, (e) => {
      const code = e.keyCode || e.which;
      if (e.altKey && code >= 48 && code <= 57) e.preventDefault();
    });
    expect(probeCombo("Alt+1")).toBe(true);
    expect(probeCombo("Alt+9")).toBe(true);
    expect(probeCombo("Alt+K")).toBe(false);
  });

  it("gives the legacy key code a real press carries", () => {
    expect(keyCodeFor("1")).toBe(49);
    expect(keyCodeFor("0")).toBe(48);
    expect(keyCodeFor("k")).toBe(75);
    expect(keyCodeFor("F5")).toBe(116);
    expect(keyCodeFor("Space")).toBe(32);
    expect(keyCodeFor("-")).toBe(189);
    expect(keyCodeFor("Nope")).toBe(0);
  });

  it("names the physical key", () => {
    expect(codeFor("1")).toBe("Digit1");
    expect(codeFor("k")).toBe("KeyK");
    expect(codeFor("F5")).toBe("F5");
    expect(codeFor("-")).toBe("Minus");
  });
});
