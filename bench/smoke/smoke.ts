// The smoke pack's own helpers: the scripted fake model, library snapshots and the checks most
// tests share. The bench's helpers (`h.panel`, `h.chat`, `h.applyCard`, …) come from ../bench.ts.
import { StepError, test, type Helpers, type TestContext, type TestMeta } from "watchwright";
import type { LibraryItem } from "../bench.js";

/** One queued answer of the fake model (see bench/dev/serve.py). */
export type FakeAnswer = { calls: { tool: string; args: Record<string, unknown> }[] } | { text: string } | { json: unknown };

export interface FakeCall {
  tools: string[];
  tool_choice: string | null;
  schema: string[];
  user: string;
  answer: { content?: string; tool_calls?: unknown[] };
}

/** True when the manager is bench/dev/serve.py, whose fake model takes a script. */
export async function fakeUp(h: Helpers): Promise<boolean> {
  const r = await h.api("/fake/script").catch(() => null);
  return !!r && r.status === 200 && Array.isArray(r.json?.queued);
}

/** Queues answers for the fake model's next calls. */
export async function script(h: Helpers, ...answers: FakeAnswer[]): Promise<void> {
  const r = await h.api("/fake/script", { method: "POST", body: { answers } });
  if (r.status !== 200) throw new StepError(`The fake model didn't take the script (${r.status}): ${r.text.slice(0, 200)}`);
}

/** Empties the fake model's queue and its log of calls. */
export async function clearScript(h: Helpers): Promise<void> {
  await h.api("/fake/script", { method: "DELETE" });
}

/** The calls the manager made to the fake model since the last clear, oldest first. */
export async function fakeLog(h: Helpers): Promise<FakeCall[]> {
  return ((await h.api("/fake/log")).json?.log ?? []) as FakeCall[];
}

/** What the fake still has queued (left over means the app asked fewer times than the test expected). */
export async function fakeQueue(h: Helpers): Promise<unknown[]> {
  return ((await h.api("/fake/script")).json?.queued ?? []) as unknown[];
}

interface FullItem extends LibraryItem {
  description?: string;
  category_id?: string | null;
  tags?: string[];
  payload?: unknown;
}

/**
 * The library as one comparable text: every module, bundle, template and category with what a
 * person can change (names, payloads, tags, ratings), sorted. Undo should bring it back exactly.
 */
export async function snapshot(h: Helpers): Promise<string> {
  const [m, b, t, c] = await Promise.all([
    h.api("/wp/api/modules?limit=1000"),
    h.api("/wp/api/bundles?limit=1000"),
    h.api("/wp/api/templates?limit=1000"),
    h.api("/wp/api/categories"),
  ]);
  const list = (r: { json: unknown }): FullItem[] => {
    const j = r.json as { items?: FullItem[]; data?: FullItem[] } | FullItem[] | null;
    return (Array.isArray(j) ? j : (j?.items ?? j?.data)) ?? [];
  };
  const keep = (x: FullItem) => ({ id: x.id, type: x.type, name: x.name, description: x.description, category: x.category_id ?? null, tags: [...(x.tags ?? [])].sort(), rating: x.content_rating, payload: x.payload });
  const byId = (a: { id: string }, z: { id: string }) => a.id.localeCompare(z.id);
  return JSON.stringify(
    {
      modules: list(m).map(keep).sort(byId),
      bundles: list(b).map(keep).sort(byId),
      templates: list(t).map(keep).sort(byId),
      categories: list(c)
        .map((x) => ({ id: x.id, name: x.name }))
        .sort(byId),
    },
    null,
    1,
  );
}

/** One module by its id, or null when it isn't there. */
export async function moduleById(h: Helpers, id: string): Promise<FullItem | null> {
  const r = await h.api(`/wp/api/modules/${id}`);
  if (r.status === 404) return null;
  const j = r.json as { data?: FullItem } | FullItem | null;
  return (j && "data" in j ? j.data : (j as FullItem)) ?? null;
}

/** The option texts of a wildcard's payload. */
export function optionTexts(item: FullItem | null): string[] {
  const p = item?.payload as { options?: { value?: string }[] } | undefined;
  return (p?.options ?? []).map((o) => String(o.value ?? ""));
}

/** Fails the attempt with `finding` when `ok` is false. */
export function check(h: Helpers, ok: boolean, flag: string, detail: string): void {
  if (ok) {
    h.log(`OK: ${detail}`);
    return;
  }
  h.flag(flag, detail);
}

/** The text of the chat's last reply ("" when there is none). */
export async function lastReply(h: Helpers): Promise<string> {
  const replies = h.page.locator('[data-test="ai-chat"] [data-test="ai-chat-reply"]');
  const n = await replies.count();
  return n ? ((await replies.nth(n - 1).innerText().catch(() => "")) ?? "").trim() : "";
}

/** Errors the AI shows: a chat error, or an error in an editor's AI panel. */
export async function aiErrors(h: Helpers): Promise<string[]> {
  return h.page.locator('[data-test="ai-chat-error"]:visible, [data-test="ai-error"]:visible').allInnerTexts().catch(() => [] as string[]);
}

/** Fails the attempt when the AI showed an error, and keeps its text. */
export async function noAiError(h: Helpers): Promise<void> {
  const errors = (await aiErrors(h)).map((e) => e.trim()).filter(Boolean);
  check(h, errors.length === 0, "ai-error", errors.length ? `The AI showed an error: ${errors.join(" | ").slice(0, 300)}` : "no AI error on the page");
}

export interface SmokeMeta extends TestMeta {
  /** The test scripts the fake model: it skips itself when the fake isn't the one answering. */
  scripted?: boolean;
}

/**
 * Declares a smoke test: one attempt, and a scripted test skips itself on a real model. The fake's
 * queue is emptied before every attempt (pack.ts), so a script left over can't leak into the next.
 */
export function smoke(id: string, meta: SmokeMeta, body: (t: TestContext) => Promise<void>): void {
  const { scripted = false, ...rest } = meta;
  test(id, { runs: 1, ...rest, tags: [...(rest.tags ?? []), ...(scripted ? ["scripted"] : [])] }, async (t) => {
    if (scripted && t.params.fake !== true) t.h.skip("Scripted: it needs the fake model (bench/dev/serve.py, with fake on).");
    await body(t);
  });
}
