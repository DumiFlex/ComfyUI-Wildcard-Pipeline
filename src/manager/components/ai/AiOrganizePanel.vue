<script setup lang="ts">
/**
 * AiOrganizePanel — category, tags and content rating for the modules and
 * bundles selected in a library list (`/wp/api/ai/organize`). The server
 * reads the items from the library and returns only what would change; each
 * change (a category, one tag, a rating) is its own chip the user can turn
 * off. "Apply" creates any new categories, writes the ticked changes and
 * offers Undo. Follow-ups refine the answer like every AI panel.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "../../../kit/Button.vue";
import Checkbox from "../../../kit/Checkbox.vue";
import AiPanelFrame from "./AiPanelFrame.vue";
import { api } from "../../api/client";
import type { AiOrganizeChange, AiOrganizeResult, ModuleUpdateInput } from "../../api/types";
import { useAiConversation } from "../../composables/useAiConversation";
import { useModuleStore } from "../../stores/moduleStore";
import { useBundleStore } from "../../stores/bundleStore";
import { useCategoryStore } from "../../stores/categoryStore";
import { useToast } from "../../../kit/useToast";

/** A library list row: a module, or a bundle (which has `children`). */
interface Row {
  id: string;
  tags?: string[];
  category_id?: string | null;
  content_rating?: "safe" | "nsfw";
  children?: unknown;
}
type Kind = "module" | "bundle";

const props = defineProps<{
  /** The selected rows (modules and/or bundles). */
  rows: Row[];
}>();
const emit = defineEmits<{
  (e: "applied"): void;
  (e: "close"): void;
}>();

const MAX_ITEMS = 60;
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

function kindOf(r: Row): Kind {
  return r.children !== undefined ? "bundle" : "module";
}

const tooMany = computed(() => props.rows.length > MAX_ITEMS);
/** Turned-off chips: `${i}:cat`, `${i}:add:${tag}`, `${i}:rm:${tag}`, `${i}:rating`. */
const off = ref<Set<string>>(new Set());
const applying = ref(false);

const convo = useAiConversation<AiOrganizeResult, Array<{ kind: Kind; id: string }>>({
  capture: () => props.rows.map((r) => ({ kind: kindOf(r), id: r.id })),
  send: ({ instruction, history, ctx }, signal) => api.ai.organize({
    items: ctx, history, ...(instruction ? { instruction } : {}),
  }, signal),
  note: (res) => {
    const dropped: string[] = [];
    res.changes.forEach((c, i) => {
      for (const k of keysOf(c, i)) if (off.value.has(k)) dropped.push(`${c.name}: ${chipText(c, k)}`);
    });
    return dropped.length ? `they turned off ${dropped.slice(0, 40).join("; ")}` : "";
  },
  emptyMessage: (res) => res.changes.length ? "" : res.skipped.length && !res.count
    ? "The model's answer couldn't be used. Try again, or a larger model."
    : "Nothing to change: the model thinks these are organized already.",
});
const { instruction, loading, error, result } = convo;
watch(result, () => { off.value = new Set(); });
onBeforeUnmount(() => convo.stop());

function keysOf(c: AiOrganizeChange, i: number): string[] {
  return [
    ...(c.category ? [`${i}:cat`] : []),
    ...c.tags_add.map((t) => `${i}:add:${t.tag}`),
    ...c.tags_remove.map((t) => `${i}:rm:${t}`),
    ...(c.rating ? [`${i}:rating`] : []),
  ];
}

function chipText(c: AiOrganizeChange, key: string): string {
  const [, what, tag] = key.split(":");
  if (what === "cat") return `category ${c.category?.name ?? ""}`;
  if (what === "add") return `+${tag}`;
  if (what === "rm") return `−${tag}`;
  return `rating ${c.rating ?? ""}`;
}

function toggle(key: string): void {
  const next = new Set(off.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  off.value = next;
}

function itemOn(c: AiOrganizeChange, i: number): boolean {
  return keysOf(c, i).some((k) => !off.value.has(k));
}

function toggleItem(c: AiOrganizeChange, i: number): void {
  const keys = keysOf(c, i);
  const next = new Set(off.value);
  if (itemOn(c, i)) keys.forEach((k) => next.add(k));
  else keys.forEach((k) => next.delete(k));
  off.value = next;
}

const onCount = computed(() =>
  (result.value?.changes ?? []).filter((c, i) => itemOn(c, i)).length,
);

const RATING_LABEL = { safe: "Safe", nsfw: "NSFW" } as const;

/** The chat's `organize`: ask with its note, leave the changes here for the
 *  user to apply, and tell the chat what was proposed. */
async function run(note: string): Promise<string> {
  instruction.value = note;
  await convo.ask();
  const res = result.value;
  if (!res) return `couldn't: ${error.value || "the model didn't answer"}`;
  if (!res.changes.length) return error.value || "nothing to change";
  const lines = res.changes.slice(0, 20).map((c, i) => `${c.name}: ${keysOf(c, i).map((k) => chipText(c, k)).join(", ")}`);
  const more = res.changes.length > 20 ? `; and ${res.changes.length - 20} more` : "";
  return `proposed changes for ${res.changes.length} of ${res.count} items in the Organize window: `
    + `${lines.join("; ")}${more}. Nothing is saved until the user presses Apply there.`;
}

defineExpose({ run });

function liveRow(kind: Kind, id: string): Row | undefined {
  // The store has the latest copy; the list's row may predate an edit.
  if (kind === "module") {
    return moduleStore.items.find((m) => m.id === id) ?? moduleStore.catalog.find((m) => m.id === id)
      ?? props.rows.find((r) => r.id === id);
  }
  return bundleStore.items.find((b) => b.id === id) ?? bundleStore.catalog.find((b) => b.id === id)
    ?? props.rows.find((r) => r.id === id);
}

async function categoryIds(changes: Array<{ c: AiOrganizeChange; i: number }>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const cat of categoryStore.items) ids.set(cat.name.toLowerCase(), cat.id);
  for (const { c, i } of changes) {
    if (!c.category || off.value.has(`${i}:cat`)) continue;
    const key = c.category.name.toLowerCase();
    if (c.category.id) ids.set(key, c.category.id);
    if (ids.has(key)) continue;
    const row = await categoryStore.create({ name: c.category.name });
    ids.set(key, row.id);
  }
  return ids;
}

async function apply(): Promise<void> {
  const res = result.value;
  if (!res || !onCount.value || applying.value) return;
  applying.value = true;
  const picked = res.changes.map((c, i) => ({ c, i })).filter(({ c, i }) => itemOn(c, i));
  const undo: Array<{ kind: Kind; id: string; body: ModuleUpdateInput }> = [];
  let ok = 0;
  const failed: string[] = [];
  try {
    const cats = await categoryIds(picked);
    for (const { c, i } of picked) {
      const row = liveRow(c.kind, c.id);
      const tags = [...(row?.tags ?? c.before.tags)];
      const body: ModuleUpdateInput = {};
      const prev: ModuleUpdateInput = {};
      const adds = c.tags_add.filter((t) => !off.value.has(`${i}:add:${t.tag}`)).map((t) => t.tag);
      const rms = new Set(c.tags_remove.filter((t) => !off.value.has(`${i}:rm:${t}`)));
      if (adds.length || rms.size) {
        prev.tags = tags;
        body.tags = [...tags.filter((t) => !rms.has(t)), ...adds.filter((t) => !tags.includes(t))];
      }
      if (c.kind === "module" && c.category && !off.value.has(`${i}:cat`)) {
        prev.category_id = row?.category_id ?? null;
        body.category_id = cats.get(c.category.name.toLowerCase()) ?? null;
      }
      if (c.rating && !off.value.has(`${i}:rating`)) {
        prev.content_rating = row?.content_rating ?? c.before.rating;
        body.content_rating = c.rating;
      }
      try {
        if (c.kind === "module") await moduleStore.update(c.id, body);
        else await bundleStore.update(c.id, body);
        undo.push({ kind: c.kind, id: c.id, body: prev });
        ok += 1;
      } catch (e) {
        failed.push(`${c.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    failed.push(e instanceof Error ? e.message : String(e));
  } finally {
    applying.value = false;
  }
  toast.push({
    severity: failed.length ? (ok ? "warn" : "error") : "success",
    summary: `Organized ${ok} item${ok === 1 ? "" : "s"}${failed.length ? `, ${failed.length} failed` : ""}`,
    detail: failed.length ? failed.join("; ") : undefined,
    life: 6000,
    action: undo.length ? {
      label: "Undo",
      run: async () => {
        for (const u of undo) {
          if (u.kind === "module") await moduleStore.update(u.id, u.body);
          else await bundleStore.update(u.id, u.body);
        }
        emit("applied");
      },
    } : undefined,
  });
  if (ok) {
    convo.clear();
    emit("applied");
  }
}

function close(): void {
  convo.stop();
  emit("close");
}
</script>

<template>
  <AiPanelFrame
    v-model="instruction"
    bare
    optional
    placeholder="Optional: steer it, e.g. one category per subject, mark anything explicit as NSFW"
    verb="Suggest"
    hint="Uses your library's categories and tags."
    :scope="`${rows.length} item${rows.length === 1 ? '' : 's'} selected.`"
    :blocked="tooMany"
    :loading="loading"
    :answered="!!result"
    :error="error"
    :steps="convo.steps.value"
    data-test="ai-organize-panel"
    @run="convo.ask"
    @refine="convo.refine"
    @retry="convo.retry"
    @restart="convo.restart"
    @show="convo.show"
    @flip="convo.flip"
    @stop="convo.stop"
    @close="close"
  >
    <template #top>
      <p v-if="tooMany" class="wp-ai-org__error" role="alert" data-test="ai-organize-too-many">
        That's more than {{ MAX_ITEMS }} items. Select up to {{ MAX_ITEMS }} and try again.
      </p>
    </template>
    <template v-if="result && result.changes.length">
      <ul class="wp-ai-org" data-test="ai-organize-results">
        <li
          v-for="(c, i) in result.changes"
          :key="`${c.kind}:${c.id}`"
          class="wp-ai-org__row"
          :data-off="itemOn(c, i) ? 'false' : 'true'"
          data-test="ai-organize-item"
        >
          <label class="wp-ai-org__head">
            <Checkbox class="wp-checkbox--inline wp-ai-org__check" :model-value="itemOn(c, i)" @update:model-value="toggleItem(c, i)" />
            <span class="wp-ai-org__name">{{ c.name }}</span>
            <span class="wp-ai-org__type">{{ c.type.replace("_", " ") }}</span>
            <span v-if="c.reason" class="wp-ai-org__reason">{{ c.reason }}</span>
          </label>
          <div class="wp-ai-org__chips">
            <button
              v-if="c.category"
              type="button"
              class="wp-ai-org__chip"
              data-kind="category"
              :data-new="c.category.new ? 'true' : 'false'"
              :aria-pressed="!off.has(`${i}:cat`)"
              :title="c.category.new ? 'New category, created when you apply' : 'Existing category'"
              data-test="ai-organize-chip"
              @click="toggle(`${i}:cat`)"
            >
              <i class="pi pi-folder" aria-hidden="true" />
              <span v-if="c.before.category" class="wp-ai-org__was">{{ c.before.category }}</span>
              <i v-if="c.before.category" class="pi pi-arrow-right wp-ai-org__arrow" aria-hidden="true" />
              {{ c.category.name }}
            </button>
            <button
              v-for="t in c.tags_add"
              :key="`a-${t.tag}`"
              type="button"
              class="wp-ai-org__chip"
              data-kind="add"
              :data-new="t.new ? 'true' : 'false'"
              :aria-pressed="!off.has(`${i}:add:${t.tag}`)"
              :title="t.new ? 'New tag' : 'Existing tag'"
              data-test="ai-organize-chip"
              @click="toggle(`${i}:add:${t.tag}`)"
            >+ #{{ t.tag }}</button>
            <button
              v-for="t in c.tags_remove"
              :key="`r-${t}`"
              type="button"
              class="wp-ai-org__chip"
              data-kind="remove"
              :aria-pressed="!off.has(`${i}:rm:${t}`)"
              title="Remove this tag"
              data-test="ai-organize-chip"
              @click="toggle(`${i}:rm:${t}`)"
            >− #{{ t }}</button>
            <button
              v-if="c.rating"
              type="button"
              class="wp-ai-org__chip"
              data-kind="rating"
              :data-rating="c.rating"
              :aria-pressed="!off.has(`${i}:rating`)"
              title="Content rating"
              data-test="ai-organize-chip"
              @click="toggle(`${i}:rating`)"
            >
              <span class="wp-ai-org__was">{{ RATING_LABEL[c.before.rating] }}</span>
              <i class="pi pi-arrow-right wp-ai-org__arrow" aria-hidden="true" />
              {{ RATING_LABEL[c.rating] }}
            </button>
          </div>
        </li>
      </ul>
      <p class="wp-ai-org__note">
        {{ result.changes.length }} of {{ result.count }} item{{ result.count === 1 ? "" : "s" }} would change<template v-if="result.new_categories.length"> · new categories (dashed) are created when you apply</template>. Click a chip to leave that change out.
      </p>
      <div class="wp-ai-org__actions">
        <Button variant="ghost" size="sm" data-test="ai-discard" @click="convo.clear">Discard</Button>
        <Button
          variant="primary"
          size="sm"
          icon="pi-check"
          :disabled="!onCount || applying"
          data-test="ai-apply"
          @click="apply"
        >Apply to {{ onCount }} item{{ onCount === 1 ? "" : "s" }}</Button>
      </div>
      <p class="wp-ai-org__note">This saves right away; the toast offers Undo.</p>
    </template>
  </AiPanelFrame>
</template>

<style scoped>
.wp-ai-org {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  max-height: 420px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--wp-border);
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-1);
}
.wp-ai-org__row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--wp-border);
  box-shadow: inset 3px 0 0 var(--wp-accent-500);
}
.wp-ai-org__row:first-child { border-top: 0; }
.wp-ai-org__row[data-off="true"] { box-shadow: none; opacity: 0.5; }
.wp-ai-org__head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; cursor: pointer; }
.wp-ai-org__check { align-self: center; }
.wp-ai-org__name { font-weight: 600; font-size: 13px; color: var(--wp-text); }
.wp-ai-org__type { font-size: 11px; color: var(--wp-text-dim); }
.wp-ai-org__reason { font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-org__reason::before { content: "· "; }
.wp-ai-org__chips { display: flex; gap: 6px; flex-wrap: wrap; margin-left: 24px; }
.wp-ai-org__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: min(10px, var(--wp-radius-cap, 999px));
  cursor: pointer;
  background: transparent;
  border: 1px solid color-mix(in oklab, var(--wp-success) 45%, transparent);
  color: var(--wp-success);
}
.wp-ai-org__chip[data-kind="category"] { border-color: color-mix(in oklab, var(--wp-accent-400) 60%, transparent); color: var(--wp-accent-text); }
.wp-ai-org__chip[data-kind="remove"] { border-color: color-mix(in oklab, var(--wp-danger) 45%, transparent); color: var(--wp-danger-text, var(--wp-danger)); }
.wp-ai-org__chip[data-kind="rating"] { border-color: color-mix(in oklab, var(--wp-warn) 45%, transparent); color: var(--wp-warn); }
.wp-ai-org__chip[data-new="true"] { border-style: dashed; }
.wp-ai-org__chip[aria-pressed="false"] { opacity: 0.4; text-decoration: line-through; }
.wp-ai-org__chip .pi { font-size: 10px; }
.wp-ai-org__was { color: var(--wp-text-dim); }
.wp-ai-org__arrow { color: var(--wp-text-dim); }
.wp-ai-org__note { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-org__error { margin: 0; font-size: 12px; color: var(--wp-danger); }
.wp-ai-org__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
