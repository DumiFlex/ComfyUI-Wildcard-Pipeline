import { describe, expect, it, vi } from "vitest";
import { cleanDecisions, cleanTarget, connectFrame } from "./frameBridge";
import { FRAME_PROTOCOL } from "./frame-protocol";
import type { HostRuntime } from "./hostRuntime";

const ORIGIN = "https://wp.example";

function setup(over: Partial<Parameters<typeof connectFrame>[0]> = {}) {
  const win = new EventTarget() as unknown as Window;
  const sent: Array<{ msg: Record<string, unknown>; origin: string }> = [];
  const frameWin = {
    postMessage: (msg: Record<string, unknown>, origin: string) => sent.push({ msg, origin }),
  } as unknown as Window;
  const iframe = { contentWindow: frameWin } as unknown as HTMLIFrameElement;
  const runtime: HostRuntime = {
    abi: 1,
    schemaVersion: 10,
    install: vi.fn(async () => ({ ok: true, installed: {}, warnings: [], migratedEntityCount: 0 }) as never),
    markPublished: vi.fn(async () => true),
  };
  const opts = {
    iframe,
    origin: ORIGIN,
    runtime,
    theme: () => "dark" as const,
    analytics: () => false,
    win,
    ...over,
  };
  const bridge = connectFrame(opts);
  lastSent = sent;
  const send = (data: Record<string, unknown>, origin = ORIGIN, source: unknown = frameWin) => {
    const ev = Object.assign(new Event("message"), { data: { wpc: FRAME_PROTOCOL, ...data }, origin, source });
    (win as unknown as EventTarget).dispatchEvent(ev);
  };
  const ready = () => send({ type: "event", name: "ready" });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { bridge, runtime, sent, send, ready, flush };
}

let lastSent: Array<{ msg: Record<string, unknown>; origin: string }> = [];
function last() {
  return lastSent[lastSent.length - 1]!;
}

describe("community frame bridge", () => {
  it("answers ready with hello, to the community origin only", () => {
    const onReady = vi.fn();
    const { ready, sent } = setup({ onReady });
    ready();
    expect(onReady).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.origin).toBe(ORIGIN);
    expect(sent[0]!.msg).toEqual({
      wpc: FRAME_PROTOCOL, type: "hello", abi: 1, schemaVersion: 10, theme: "dark", analytics: false,
    });
  });

  it("sends the appearance in hello and as an event", () => {
    const look = { scheme: "light" as const, look: "tui", tokens: { "--wp-bg": "#f3f3f3" } };
    const { ready, sent, bridge } = setup({ appearance: () => look });
    ready();
    expect(sent[0]!.msg.appearance).toEqual(look);
    bridge.setAppearance({ ...look, look: "soft" });
    expect(last().msg).toEqual({
      wpc: FRAME_PROTOCOL, type: "event", name: "appearance", data: { ...look, look: "soft" },
    });
  });

  it("ignores messages from another window or origin", () => {
    const onReady = vi.fn();
    const { send } = setup({ onReady });
    send({ type: "event", name: "ready" }, "https://evil.example");
    send({ type: "event", name: "ready" }, ORIGIN, {});
    expect(onReady).not.toHaveBeenCalled();
  });

  it("hands legacy tokens over once and wipes them on ack", () => {
    const onTokensAdopted = vi.fn();
    const pair = { access: "a", refresh: "r", expiresAt: 9 };
    const { ready, send, sent } = setup({ legacyTokens: () => pair, onTokensAdopted });
    ready();
    expect(sent[0]!.msg.legacyTokens).toEqual(pair);
    send({ type: "event", name: "tokens-adopted" });
    expect(onTokensAdopted).toHaveBeenCalledOnce();
  });

  it("queues events until the frame is greeted", () => {
    const { bridge, ready, sent } = setup();
    bridge.publish("payload=abc");
    bridge.navigate({ view: "publish" });
    expect(sent).toHaveLength(0);
    ready();
    expect(sent.map((s) => s.msg.type === "hello" ? "hello" : s.msg.name)).toEqual(["hello", "publish", "navigate"]);
    expect(sent[1]!.msg.data).toBe("payload=abc");
  });

  it("refuses requests before hello", async () => {
    const { send, runtime, flush } = setup();
    send({ type: "request", id: "f1", method: "install", params: { envelope: {} } });
    await flush();
    expect(runtime.install).not.toHaveBeenCalled();
  });

  it("installs with cleaned options and replies with the result", async () => {
    const { ready, send, runtime, flush } = setup();
    ready();
    send({
      type: "request", id: "f1", method: "install",
      params: {
        envelope: { format: "wp" },
        opts: {
          origin: { post_slug: "a/b", version_number: 2, content_rating: "nsfw", extra: 1 },
          dependencies: [{ slug: "x/y", module_id: "a1b2c3d4" }, { slug: "z/w", module_id: "nope" }, 5],
          importExport: "evil",
        },
      },
    });
    await flush();
    expect(runtime.install).toHaveBeenCalledWith({ format: "wp" }, {
      origin: { post_slug: "a/b", version_number: 2, content_rating: "nsfw" },
      dependencies: [{ slug: "x/y", module_id: "a1b2c3d4" }, { slug: "z/w" }],
    });
    expect(last().msg).toMatchObject({ type: "reply", id: "f1", ok: true, result: { ok: true } });
  });

  it("routes collisions through the frame and keeps only asked ids", async () => {
    let resolved: unknown;
    const install = vi.fn(async (_env: unknown, opts?: { resolveCollisions?: (rows: never[]) => Promise<unknown> }) => {
      resolved = await opts!.resolveCollisions!([
        { kind: "wildcards", id: "aaaaaaaa", incomingName: "A", existingName: "A", typeConflict: false },
      ] as never[]);
      return { ok: true } as never;
    });
    const { ready, send, flush } = setup({
      runtime: { abi: 1, schemaVersion: 10, install, markPublished: vi.fn() } as unknown as HostRuntime,
    });
    ready();
    send({ type: "request", id: "f7", method: "install", params: { envelope: {}, opts: {}, collisions: true } });
    await flush();
    const ask = last().msg;
    expect(ask).toMatchObject({ type: "request", method: "resolveCollisions", params: { call: "f7" } });
    send({
      type: "reply", id: ask.id, ok: true,
      result: { aaaaaaaa: { kind: "replace" }, bbbbbbbb: { kind: "replace" } },
    });
    await flush();
    expect(resolved).toEqual({ aaaaaaaa: { kind: "replace" } });
    expect(last().msg).toMatchObject({ type: "reply", id: "f7", ok: true });
  });

  it("markPublished checks its arguments", async () => {
    const { ready, send, sent, runtime, flush } = setup();
    ready();
    send({ type: "request", id: "f2", method: "markPublished", params: { id: "a1b2c3d4", kind: "bundle", slug: "a/b", version: 3 } });
    send({ type: "request", id: "f3", method: "markPublished", params: { id: "../x", kind: "module", slug: "a/b", version: 3 } });
    await flush();
    expect(runtime.markPublished).toHaveBeenCalledTimes(1);
    expect(runtime.markPublished).toHaveBeenCalledWith("a1b2c3d4", "bundle", "a/b", 3);
    expect(sent.find((s) => s.msg.id === "f3")!.msg).toMatchObject({ ok: true, result: false });
  });

  it("refuses unknown methods", async () => {
    const { ready, send, flush } = setup();
    ready();
    send({ type: "request", id: "f4", method: "readTokens" });
    await flush();
    expect(last().msg).toMatchObject({ type: "reply", id: "f4", ok: false });
  });

  it("passes navigate and close through", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const { ready, send } = setup({ onNavigate, onClose });
    ready();
    send({ type: "event", name: "navigate", data: { view: "detail", slug: "a/b" } });
    send({ type: "event", name: "navigate", data: { view: "settings" } });
    send({ type: "event", name: "close" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({ view: "detail", slug: "a/b" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("dispose stops listening and fails pending asks", async () => {
    const install = vi.fn(async (_e: unknown, opts?: { resolveCollisions?: (r: never[]) => Promise<unknown> }) => {
      await opts!.resolveCollisions!([]);
      return { ok: true } as never;
    });
    const onNavigate = vi.fn();
    const { ready, send, sent, bridge, flush } = setup({
      onNavigate,
      runtime: { abi: 1, schemaVersion: 10, install, markPublished: vi.fn() } as unknown as HostRuntime,
    });
    ready();
    send({ type: "request", id: "f5", method: "install", params: { envelope: {}, collisions: true } });
    await flush();
    bridge.dispose();
    await flush();
    send({ type: "event", name: "navigate", data: { view: "browse" } });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(sent.some((s) => s.msg.id === "f5")).toBe(false);
  });
});

describe("cleaners", () => {
  it("cleanTarget keeps known views and well-formed names", () => {
    expect(cleanTarget({ view: "profile", username: "dumi" })).toEqual({ view: "profile", username: "dumi" });
    expect(cleanTarget({ view: "detail", slug: "a/b/c" })).toEqual({ view: "detail" });
    expect(cleanTarget({ view: "admin" })).toBeNull();
  });

  it("cleanDecisions drops unknown kinds and empty renames", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }] as never[];
    expect(cleanDecisions({ a: { kind: "skip" }, b: { kind: "rename", new_name: " " }, c: { kind: "link", target_id: "x" } }, rows))
      .toEqual({ a: { kind: "skip" } });
    expect(cleanDecisions(null, rows)).toBeNull();
  });
});
