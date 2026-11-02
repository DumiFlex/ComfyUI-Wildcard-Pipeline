import { afterEach, describe, expect, it } from "vitest";
import { codeFor, isProbeEvent, probeCombo } from "./key-probe";

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

  it("names the physical key", () => {
    expect(codeFor("1")).toBe("Digit1");
    expect(codeFor("k")).toBe("KeyK");
    expect(codeFor("F5")).toBe("F5");
    expect(codeFor("-")).toBe("Minus");
  });
});
