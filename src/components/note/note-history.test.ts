import { describe, expect, it } from "vitest";
import { GROUP_MS, TextHistory, historyKey, kindOf } from "./note-history";

const at = (value: string, start = value.length, end = start) => ({ value, start, end });

describe("TextHistory", () => {
  it("steps back and forward through edits", () => {
    const h = new TextHistory();
    h.record(at("a"), "edit", 0);
    h.record(at("ab"), "edit", 10);
    expect(h.undo(at("abc"))).toEqual(at("ab"));
    expect(h.undo(at("ab"))).toEqual(at("a"));
    expect(h.canUndo).toBe(false);
    expect(h.redo(at("a"))).toEqual(at("ab"));
    expect(h.redo(at("ab"))).toEqual(at("abc"));
    expect(h.canRedo).toBe(false);
  });

  it("joins a typing run into one step until a pause", () => {
    const h = new TextHistory();
    h.record(at(""), "insert", 0);
    h.record(at("h"), "insert", 100);
    h.record(at("hi"), "insert", 200);
    h.record(at("hi!"), "insert", 200 + GROUP_MS);
    expect(h.undo(at("hi!?"))).toEqual(at("hi!"));
    expect(h.undo(at("hi!"))).toEqual(at(""));
    expect(h.canUndo).toBe(false);
  });

  it("starts a new step when typing turns to deleting, on a caret jump, and on each toolbar edit", () => {
    const h = new TextHistory();
    h.record(at(""), "insert", 0);
    h.record(at("ab"), "delete", 10);
    h.breakRun();
    h.record(at("a"), "delete", 20);
    h.record(at(""), "edit", 30);
    h.record(at("**b**"), "edit", 40);
    let n = 0;
    while (h.undo(at("x"))) n++;
    expect(n).toBe(5);
  });

  it("drops the redo steps after a new change", () => {
    const h = new TextHistory();
    h.record(at("a"), "edit", 0);
    h.undo(at("ab"));
    h.record(at("a"), "edit", 10);
    expect(h.canRedo).toBe(false);
  });

  it("keeps at most the limit", () => {
    const h = new TextHistory(3);
    for (let i = 0; i < 5; i++) h.record(at(String(i)), "edit", i);
    let n = 0;
    while (h.undo(at("x"))) n++;
    expect(n).toBe(3);
  });
});

describe("history keys", () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    historyKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  it("reads Ctrl/Cmd+Z, Ctrl+Y and Ctrl+Shift+Z", () => {
    expect(k("z", { ctrlKey: true })).toBe("undo");
    expect(k("z", { metaKey: true })).toBe("undo");
    expect(k("Z", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(k("y", { ctrlKey: true })).toBe("redo");
    expect(k("z")).toBeNull();
    expect(k("z", { ctrlKey: true, altKey: true })).toBeNull();
  });
  it("sorts input types into typing and steps", () => {
    expect(kindOf("insertText")).toBe("insert");
    expect(kindOf("deleteContentBackward")).toBe("delete");
    expect(kindOf("insertLineBreak")).toBe("edit");
    expect(kindOf("insertFromPaste")).toBe("edit");
  });
});
