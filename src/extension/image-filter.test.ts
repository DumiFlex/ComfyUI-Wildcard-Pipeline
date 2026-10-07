import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _resetDisplayStateForTesting, applyDisplayPrefs } from "./settings";
import { SETTING_ID_IMAGE_FILTER_SOUND } from "./settings-catalog";
import {
  _resetImageFilterForTests,
  addRequest,
  installImageFilter,
  lastRequestByNode,
  playReadyChime,
  secondsLeft,
  submitAnswer,
  waiting,
} from "./image-filter";

const req = (token: string, node = "5", timeout = 0) => ({
  token, node_id: node, timeout, started_at: 0,
  frames: [[{ filename: `${token}.png`, subfolder: "", type: "temp" }]], labels: [],
});

class FakeApi {
  handlers = new Map<string, ((e: Event) => void)[]>();
  addEventListener(name: string, fn: (e: Event) => void) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
  }
  fire(name: string, detail?: unknown) {
    for (const fn of this.handlers.get(name) ?? []) fn(new CustomEvent(name, { detail }));
  }
}

const okJson = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response);

beforeEach(() => _resetImageFilterForTests());

describe("image filter queue", () => {
  it("queues requests once each and remembers the latest per node", () => {
    expect(addRequest(req("a"), 1000)).not.toBeNull();
    expect(addRequest(req("a"), 2000)).toBeNull();
    addRequest(req("b", "9"));
    expect(waiting.value.map((r) => r.token)).toEqual(["a", "b"]);
    expect(lastRequestByNode.value.get("5")?.token).toBe("a");
    expect(addRequest({ nope: true })).toBeNull();
  });

  it("counts the timeout down from when the browser got it", () => {
    const r = addRequest(req("a", "5", 90), 10_000);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(secondsLeft(r, 10_000)).toBe(90);
    expect(secondsLeft(r, 40_500)).toBe(60);
    expect(secondsLeft(r, 999_999)).toBe(0);
    expect(secondsLeft(addRequest(req("b"))!, 0)).toBeNull();
  });

  it("posts the answer and drops the request even when the server says it's gone", async () => {
    addRequest(req("a"));
    const doFetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
    expect(await submitAnswer("a", { action: "picks", picks: [[0, 0]] }, doFetch)).toBe(false);
    expect(doFetch).toHaveBeenCalledWith("/wp/api/image-filter/answer", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: "a", action: "picks", picks: [[0, 0]] }),
    }));
    expect(waiting.value).toEqual([]);
  });
});

describe("installImageFilter", () => {
  it("mounts the picker on the first request and follows done/interrupt events", async () => {
    const api = new FakeApi();
    const mount = vi.fn();
    installImageFilter(api, mount, vi.fn(() => okJson({ pending: [] })) as unknown as typeof fetch);
    expect(mount).not.toHaveBeenCalled();
    api.fire("wp-image-filter", req("a"));
    api.fire("wp-image-filter", req("b"));
    expect(mount).toHaveBeenCalledTimes(1);
    api.fire("wp-image-filter-done", { token: "a" });
    expect(waiting.value.map((r) => r.token)).toEqual(["b"]);
    api.fire("execution_interrupted");
    expect(waiting.value).toEqual([]);
  });

  it("shows requests that were already waiting when the page loaded, without a chime", async () => {
    const mount = vi.fn();
    const chime = vi.fn();
    installImageFilter(new FakeApi(), mount, vi.fn(() => okJson({ pending: [req("old")] })) as unknown as typeof fetch, chime);
    await vi.waitFor(() => expect(waiting.value.map((r) => r.token)).toEqual(["old"]));
    expect(mount).toHaveBeenCalledTimes(1);
    expect(chime).not.toHaveBeenCalled();
  });

  it("chimes once per new request, not for a repeat of the same one", () => {
    const api = new FakeApi();
    const chime = vi.fn();
    installImageFilter(api, vi.fn(), vi.fn(() => okJson({ pending: [] })) as unknown as typeof fetch, chime);
    api.fire("wp-image-filter", req("a"));
    api.fire("wp-image-filter", req("a"));
    api.fire("wp-image-filter", req("b"));
    expect(chime).toHaveBeenCalledTimes(2);
  });
});

describe("playReadyChime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetDisplayStateForTesting();
  });

  function fakeAudio() {
    const started: number[] = [];
    const node = () => ({ connect: (n: unknown) => n });
    class Ctx {
      currentTime = 0;
      destination = {};
      resume = () => Promise.resolve();
      createGain = () => ({ ...node(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } });
      createOscillator = () => ({ ...node(), type: "", frequency: { value: 0 }, start: (t: number) => started.push(t), stop: vi.fn() });
    }
    vi.stubGlobal("AudioContext", Ctx);
    return started;
  }

  it("plays two notes when the setting is on", () => {
    const started = fakeAudio();
    playReadyChime();
    expect(started).toHaveLength(2);
  });

  it("stays silent when the setting is off", () => {
    const started = fakeAudio();
    applyDisplayPrefs({ extensionManager: { setting: { get: (id: string) => (id === SETTING_ID_IMAGE_FILTER_SOUND ? false : undefined) } } });
    playReadyChime();
    expect(started).toHaveLength(0);
  });
});
