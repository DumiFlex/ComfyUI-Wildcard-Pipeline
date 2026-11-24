import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "@/kit/useToast";
import {
  _resetAiDoneForTests, aiDone, DONE_TOAST_LIFE, setAiDoneDesktop, TITLE_MARK, useAiDone,
} from "../useAiDone";

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

interface FakeNote { title: string; opts: NotificationOptions; onclick: (() => void) | null; close: () => void }
const made: FakeNote[] = [];

function installNotification(permission: NotificationPermission, answer: NotificationPermission = permission): void {
  const Fake = vi.fn(function (this: FakeNote, title: string, opts: NotificationOptions) {
    this.title = title;
    this.opts = opts;
    this.onclick = null;
    this.close = vi.fn();
    made.push(this);
  }) as unknown as typeof Notification;
  // Like a browser, the answer becomes the page's permission.
  const api = Fake as unknown as { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> };
  api.permission = permission;
  api.requestPermission = vi.fn(async () => {
    api.permission = answer;
    return answer;
  });
  vi.stubGlobal("Notification", Fake);
}

describe("aiDone", () => {
  beforeEach(() => {
    localStorage.clear();
    made.length = 0;
    useToast().toasts.value = [];
    document.title = "Wildcard Pipeline";
    setHidden(false);
    _resetAiDoneForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says nothing while the view is on screen", () => {
    aiDone({ job: "pack", summary: "Pack built", shown: () => true, open: vi.fn() });
    expect(useToast().toasts.value).toHaveLength(0);
    expect(document.title).toBe("Wildcard Pipeline");
  });

  it("shows a toast with Open when the view is away, one per job", async () => {
    const open = vi.fn();
    aiDone({ job: "pack", summary: "Pack plan ready", detail: "4 items.", shown: () => false, open });
    aiDone({ job: "pack", summary: "Pack built", shown: () => false, open });
    aiDone({ job: "chat", summary: "The assistant answered", shown: () => false, open });
    const list = useToast().toasts.value;
    expect(list.map((t) => t.summary)).toEqual(["Pack built", "The assistant answered"]);
    expect(list[0]?.life).toBe(DONE_TOAST_LIFE);
    expect(list[0]?.action?.label).toBe("Open");
    await list[0]?.action?.run();
    expect(open).toHaveBeenCalledOnce();
  });

  it("marks the tab title while hidden and clears it when shown", () => {
    setHidden(true);
    aiDone({ job: "chat", summary: "The assistant answered", shown: () => true, open: vi.fn() });
    aiDone({ job: "pack", summary: "Pack built", shown: () => true, open: vi.fn() });
    // On screen in a hidden tab: no toast, one mark.
    expect(useToast().toasts.value).toHaveLength(0);
    expect(document.title).toBe(`${TITLE_MARK}Wildcard Pipeline`);
    setHidden(false);
    expect(document.title).toBe("Wildcard Pipeline");
  });

  it("sends a system notification only when turned on and allowed", async () => {
    installNotification("default", "granted");
    setHidden(true);
    aiDone({ job: "pack", summary: "Pack built", shown: () => false, open: vi.fn() });
    expect(made).toHaveLength(0);
    expect(await setAiDoneDesktop(true)).toBe("");
    expect(useAiDone().desktop.value).toBe(true);
    expect(localStorage.getItem("wp-ai-done-desktop")).toBe("1");
    const open = vi.fn();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    aiDone({ job: "pack", summary: "Pack built", detail: "4 built.", shown: () => false, open });
    expect(made).toHaveLength(1);
    expect(made[0]?.title).toBe("Pack built");
    expect(made[0]?.opts).toEqual({ body: "4 built.", tag: "wp-ai-pack" });
    made[0]?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
    // A second one of the same job closes the first.
    aiDone({ job: "pack", summary: "Pack built again", shown: () => false, open });
    expect(made[0]?.close).toHaveBeenCalled();
  });

  it("stays off and says why when the browser refuses", async () => {
    installNotification("default", "denied");
    const why = await setAiDoneDesktop(true);
    expect(why).toMatch(/blocks notifications/);
    expect(useAiDone().desktop.value).toBe(false);
  });

  it("stays off without the notification API", async () => {
    vi.stubGlobal("Notification", undefined);
    // `"Notification" in window` is still true with an undefined stub, so delete it.
    Reflect.deleteProperty(window, "Notification");
    expect(await setAiDoneDesktop(true)).toMatch(/notifications/);
    expect(useAiDone().desktop.value).toBe(false);
  });

  it("turns off without asking", async () => {
    installNotification("granted");
    await setAiDoneDesktop(true);
    expect(await setAiDoneDesktop(false)).toBe("");
    expect(useAiDone().desktop.value).toBe(false);
  });
});
