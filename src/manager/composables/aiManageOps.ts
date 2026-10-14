/**
 * Apply and Undo for the chat's library-management cards: categories, tag
 * renames, bulk changes and deletes (`edit_categories`, `edit_tags`,
 * `update_many`, `delete_items`).
 *
 * Each goes through the user's normal stores and endpoints, step by step.
 * When a step fails, what already ran is undone before the error shows, so
 * a card is never left half applied. Undo of a delete creates the items
 * again at their ids (so `@{id}` refs and bundle children find them),
 * brings categories back and gives their members the category again, and
 * puts each member's tags back.
 */
import { api } from "../api/client";
import type { AiChatOp, AiTagMember, ModuleType } from "../api/types";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import { useCategoryStore } from "../stores/categoryStore";

export type ManageOp = Extract<AiChatOp, { op: "categories" | "tags" | "delete" | "bulk" }>;
type Kind = "module" | "bundle" | "template";

export function isManageOp(op: AiChatOp): op is ManageOp {
  return op.op === "categories" || op.op === "tags" || op.op === "delete" || op.op === "bulk";
}

/** A step that ran, and how to take it back. */
type Step = () => Promise<void>;

type ItemBody = { tags?: string[]; category_id?: string | null; content_rating?: "safe" | "nsfw" };

async function update(kind: Kind, id: string, body: ItemBody): Promise<void> {
  if (kind === "module") await useModuleStore().update(id, body);
  else if (kind === "bundle") await useBundleStore().update(id, body);
  else await useTemplateStore().update(id, body);
}

async function refreshCatalogs(): Promise<void> {
  await Promise.all([
    useModuleStore().fetchCatalog(), useBundleStore().fetchCatalog(), useTemplateStore().fetchCatalog(),
  ]).catch(() => undefined);
}

/** Put each member's tags back as they were (the earliest record wins). */
async function restoreTags(members: AiTagMember[]): Promise<void> {
  const first = new Map<string, AiTagMember>();
  for (const m of members) if (!first.has(m.id)) first.set(m.id, m);
  for (const m of first.values()) await update(m.kind, m.id, { tags: m.tags });
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function run(steps: Array<() => Promise<Step | null>>): Promise<void> {
  const done: Step[] = [];
  try {
    for (const s of steps) {
      const back = await s();
      if (back) done.push(back);
    }
  } catch (err) {
    for (const back of done.reverse()) await back().catch(() => undefined);
    throw err;
  }
}

/** Run a management card. Throws (after undoing what ran) on failure. */
export async function applyManage(op: ManageOp): Promise<void> {
  const cats = useCategoryStore();
  if (op.op === "categories") {
    await run([
      ...op.create.map((name) => async (): Promise<Step | null> => {
        if (cats.items.some((c) => sameName(c.name, name))) return null;
        const row = await cats.create({ name });
        return () => cats.remove(row.id);
      }),
      ...op.rename.map((r) => async (): Promise<Step> => {
        await cats.update(r.id, { name: r.to });
        return async () => { await cats.update(r.id, { name: r.from }); };
      }),
      ...(op.styles ?? []).map((st) => async (): Promise<Step | null> => {
        const row = st.id ? cats.items.find((c) => c.id === st.id)
          : cats.items.find((c) => sameName(c.name, st.name));
        if (!row) return null;
        const look = { ...(st.color ? { color: st.color } : {}), ...(st.icon ? { icon: st.icon } : {}) };
        await cats.update(row.id, look);
        const before = st.before;
        return before ? async () => { await cats.update(row.id, { color: before.color, icon: before.icon }); } : null;
      }),
    ]);
    return;
  }
  if (op.op === "bulk") {
    let catId: string | null = null;
    await run([
      async (): Promise<Step | null> => {
        if (!op.new_category) return null;
        const have = cats.items.find((c) => sameName(c.name, op.new_category));
        if (have) { catId = have.id; return null; }
        const row = await cats.create({ name: op.new_category });
        catId = row.id;
        return () => cats.remove(row.id);
      },
      ...op.items.map((it) => async (): Promise<Step> => {
        const body: ItemBody = it.to_new ? { ...it.body, category_id: catId } : it.body;
        await update(it.kind, it.id, body);
        return () => update(it.kind, it.id, it.before as ItemBody);
      }),
    ]);
    return;
  }
  if (op.op === "tags") {
    try {
      await run(op.rename.map((r) => async (): Promise<Step> => {
        await api.libraryTags.rename(r.from, r.to);
        return () => restoreTags(r.members);
      }));
    } finally {
      await refreshCatalogs();
    }
    return;
  }
  const modules = useModuleStore();
  const bundles = useBundleStore();
  const templates = useTemplateStore();
  try {
    await run([
      ...op.items.map((it) => async (): Promise<Step> => {
        if (it.kind === "bundle") await bundles.remove(it.id);
        else if (it.kind === "template") await templates.remove(it.id);
        else await modules.remove(it.id);
        return () => recreate(it, new Map());
      }),
      ...op.categories.map((c) => async (): Promise<Step> => {
        await cats.remove(c.id);
        return async () => { await restoreCategory(c); };
      }),
      ...op.tags.map((t) => async (): Promise<Step> => {
        await api.libraryTags.delete(t.tag);
        return () => restoreTags(t.members);
      }),
    ]);
  } finally {
    // The server cleared deleted categories off their items.
    if (op.tags.length || op.categories.length) await refreshCatalogs();
  }
}

type DeleteOp = Extract<ManageOp, { op: "delete" }>;

/** A deleted category again (or the one of that name the user made since),
 *  with its members back in it. Returns its id. */
async function restoreCategory(c: DeleteOp["categories"][number]): Promise<string> {
  const cats = useCategoryStore();
  const have = cats.items.find((x) => x.id === c.id || sameName(x.name, c.name));
  const row = have ?? await cats.create({
    name: c.name, color: c.color, icon: c.icon, sort_order: c.sort_order,
  });
  for (const m of c.members) await update(m.kind, m.id, { category_id: row.id });
  return row.id;
}

/** The body that creates a deleted item again at its id. */
async function recreate(it: DeleteOp["items"][number], catIds: Map<string, string>): Promise<void> {
  const row = it.row;
  const str = (k: string): string => (typeof row[k] === "string" ? row[k] as string : "");
  const known = new Set(useCategoryStore().items.map((c) => c.id));
  let category = typeof row.category_id === "string" ? row.category_id : null;
  if (category) category = catIds.get(category) ?? category;
  if (category && known.size && !known.has(category)) category = null;
  const tags = Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [];
  const meta = {
    id: it.id, name: str("name") || it.name, description: str("description"), tags,
    category_id: category, is_favorite: row.is_favorite === true,
  };
  const rating = row.content_rating === "nsfw" ? "nsfw" as const : "safe" as const;
  if (it.kind === "bundle") {
    await useBundleStore().create({
      ...meta, content_rating: rating, color: typeof row.color === "string" ? row.color : null,
      children: Array.isArray(row.children) ? row.children as Array<Record<string, unknown>> : [],
    });
  } else if (it.kind === "template") {
    await useTemplateStore().create({
      ...meta, template_string: str("template_string"),
      negative_template: typeof row.negative_template === "string" ? row.negative_template : null,
    });
  } else {
    await useModuleStore().create({
      ...meta, content_rating: rating, type: it.type as ModuleType,
      payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
    });
  }
}

/** Take back an applied management card. */
export async function undoManage(op: ManageOp): Promise<void> {
  const cats = useCategoryStore();
  if (op.op === "categories") {
    for (const r of [...op.rename].reverse()) await cats.update(r.id, { name: r.from });
    for (const st of op.styles ?? []) {
      if (st.id && st.before) await cats.update(st.id, { color: st.before.color, icon: st.before.icon });
    }
    for (const name of op.create) {
      const row = cats.items.find((c) => sameName(c.name, name));
      if (row) await cats.remove(row.id);
    }
    return;
  }
  if (op.op === "bulk") {
    for (const it of [...op.items].reverse()) await update(it.kind, it.id, it.before as ItemBody);
    if (op.new_category) {
      const row = cats.items.find((c) => sameName(c.name, op.new_category));
      if (row) await cats.remove(row.id).catch(() => undefined);
    }
    return;
  }
  if (op.op === "tags") {
    try {
      await restoreTags(op.rename.flatMap((r) => r.members));
    } finally {
      await refreshCatalogs();
    }
    return;
  }
  // Categories first, so the items come back into them.
  const catIds = new Map<string, string>();
  for (const c of op.categories) catIds.set(c.id, await restoreCategory({ ...c, members: [] }));
  for (const it of op.items) await recreate(it, catIds);
  for (const c of op.categories) {
    for (const m of c.members) await update(m.kind, m.id, { category_id: catIds.get(c.id) ?? c.id });
  }
  try {
    await restoreTags(op.tags.flatMap((t) => t.members));
  } finally {
    if (op.tags.length) await refreshCatalogs();
  }
}
