<script setup lang="ts">
/**
 * AiChatList — the stored chats, inside the assistant drawer.
 *
 * Search looks at titles and what was said (server-side). Pinned chats come
 * first and are never pruned; the rest are grouped by when they were last
 * used. Rename and pin don't move a chat; delete asks inline first.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Input from "../ui/Input.vue";
import { api } from "../../api/client";
import type { AiChatSummary } from "../../api/types";
import { plainMentions } from "../../utils/chat-completions";

const props = defineProps<{ current: string | null }>();
const emit = defineEmits<{
  (e: "pick", id: string): void;
  (e: "deleted", id: string): void;
}>();

const q = ref("");
const chats = ref<AiChatSummary[]>([]);
const loaded = ref(false);
const error = ref("");
const renaming = ref<string | null>(null);
const draft = ref("");
const confirming = ref<string | null>(null);
const renameBox = ref<HTMLInputElement[] | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let asked = 0;

async function load(): Promise<void> {
  const mine = ++asked;
  try {
    const got = (await api.ai.chats(q.value.trim())).chats;
    if (mine !== asked) return;
    chats.value = got;
    error.value = "";
  } catch (err) {
    if (mine === asked) error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (mine === asked) loaded.value = true;
  }
}

watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(() => void load(), 200);
});
onMounted(() => void load());
onBeforeUnmount(() => clearTimeout(timer));

const DAY = 86_400_000;

function bucket(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Older";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= today) return "Today";
  if (t >= today - DAY) return "Yesterday";
  if (t >= today - 7 * DAY) return "Previous 7 days";
  if (t >= today - 30 * DAY) return "Previous 30 days";
  return "Older";
}

const groups = computed(() => {
  const now = new Date();
  const out: Array<{ label: string; chats: AiChatSummary[] }> = [];
  const add = (label: string, c: AiChatSummary): void => {
    const g = out.find((x) => x.label === label);
    if (g) g.chats.push(c);
    else out.push({ label, chats: [c] });
  };
  for (const c of chats.value) add(c.pinned ? "Pinned" : bucket(c.updated_at, now), c);
  return out;
});

async function pin(c: AiChatSummary): Promise<void> {
  try {
    await api.ai.patchChat(c.id, { pinned: !c.pinned });
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function startRename(c: AiChatSummary): void {
  confirming.value = null;
  renaming.value = c.id;
  draft.value = plainMentions(c.title);
  void nextTick(() => renameBox.value?.[0]?.select());
}

async function saveRename(c: AiChatSummary): Promise<void> {
  const title = draft.value.trim();
  renaming.value = null;
  if (!title || title === c.title) return;
  try {
    await api.ai.patchChat(c.id, { title });
    c.title = title;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function onRenameKey(ev: KeyboardEvent, c: AiChatSummary): void {
  if (ev.key === "Enter") {
    ev.preventDefault();
    void saveRename(c);
  } else if (ev.key === "Escape") {
    ev.stopPropagation();
    renaming.value = null;
  }
}

async function remove(c: AiChatSummary): Promise<void> {
  confirming.value = null;
  try {
    await api.ai.deleteChat(c.id);
    chats.value = chats.value.filter((x) => x.id !== c.id);
    emit("deleted", c.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function turnsLabel(n: number): string {
  return n === 1 ? "1 message" : `${n} messages`;
}
</script>

<template>
  <div class="wp-ai-chats" data-test="ai-chats">
    <Input
      v-model="q"
      size="sm"
      icon="pi-search"
      placeholder="Search chats"
      aria-label="Search chats"
      data-test="ai-chats-search"
    />
    <p v-if="error" class="wp-ai-chats__error" role="alert">{{ error }}</p>
    <p v-if="loaded && !chats.length" class="wp-ai-chats__empty" data-test="ai-chats-empty">
      {{ q.trim() ? "No chat mentions that." : "No saved chats yet. Chats are kept once they have an answer." }}
    </p>
    <section v-for="g in groups" :key="g.label" class="wp-ai-chats__group">
      <h3 class="wp-ai-chats__label">{{ g.label }}</h3>
      <ul class="wp-ai-chats__list">
        <li
          v-for="c in g.chats"
          :key="c.id"
          class="wp-ai-chats__row"
          :data-current="c.id === props.current || undefined"
          data-test="ai-chats-row"
        >
          <template v-if="confirming === c.id">
            <span class="wp-ai-chats__ask">Delete "{{ plainMentions(c.title) }}"? This can't be undone.</span>
            <button type="button" class="wp-ai-chats__btn" data-test="ai-chats-keep" @click="confirming = null">Keep</button>
            <button type="button" class="wp-ai-chats__btn wp-ai-chats__btn--danger" data-test="ai-chats-confirm" @click="remove(c)">Delete</button>
          </template>
          <template v-else-if="renaming === c.id">
            <input
              ref="renameBox"
              v-model="draft"
              class="wp-input wp-input--sm wp-ai-chats__rename"
              maxlength="120"
              aria-label="Chat title"
              data-test="ai-chats-rename-input"
              @keydown="onRenameKey($event, c)"
              @blur="saveRename(c)"
            />
          </template>
          <template v-else>
            <button type="button" class="wp-ai-chats__open" :title="plainMentions(c.title)" data-test="ai-chats-open" @click="emit('pick', c.id)">
              <span class="wp-ai-chats__title">{{ plainMentions(c.title) }}</span>
              <span class="wp-ai-chats__meta">{{ turnsLabel(c.turns) }}</span>
            </button>
            <span class="wp-ai-chats__tools">
              <button
                type="button"
                class="wp-ai-chats__icon"
                :aria-label="c.pinned ? `Unpin ${c.title}` : `Pin ${c.title}`"
                :title="c.pinned ? 'Unpin' : 'Pin: kept at the top and never cleaned up'"
                :data-on="c.pinned || undefined"
                data-test="ai-chats-pin"
                @click="pin(c)"
              ><i :class="['pi', c.pinned ? 'pi-bookmark-fill' : 'pi-bookmark']" aria-hidden="true" /></button>
              <button type="button" class="wp-ai-chats__icon" :aria-label="`Rename ${c.title}`" title="Rename" data-test="ai-chats-rename" @click="startRename(c)"><i class="pi pi-pencil" aria-hidden="true" /></button>
              <button type="button" class="wp-ai-chats__icon" :aria-label="`Delete ${c.title}`" title="Delete" data-test="ai-chats-delete" @click="confirming = c.id"><i class="pi pi-trash" aria-hidden="true" /></button>
            </span>
          </template>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.wp-ai-chats { display: flex; flex-direction: column; gap: 10px; }
.wp-ai-chats__empty, .wp-ai-chats__error { margin: 0; font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-chats__error { color: var(--wp-danger); }
.wp-ai-chats__group { display: flex; flex-direction: column; gap: 2px; }
.wp-ai-chats__label {
  margin: 4px 0 2px; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--wp-text-dim);
}
.wp-ai-chats__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.wp-ai-chats__row {
  display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 2px 4px 2px 0;
  border-radius: 6px;
}
.wp-ai-chats__row:hover, .wp-ai-chats__row:focus-within { background: var(--wp-bg-2); }
.wp-ai-chats__row[data-current] { background: color-mix(in oklab, var(--wp-accent-500) 14%, var(--wp-bg-2)); }
.wp-ai-chats__open {
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  padding: 4px 8px; border: 0; background: none; color: var(--wp-text); cursor: pointer; text-align: left;
}
.wp-ai-chats__title { max-width: 100%; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-ai-chats__meta { font-size: 11px; color: var(--wp-text-dim); }
.wp-ai-chats__tools { display: inline-flex; gap: 2px; opacity: 0; }
.wp-ai-chats__row:hover .wp-ai-chats__tools, .wp-ai-chats__row:focus-within .wp-ai-chats__tools,
.wp-ai-chats__icon[data-on] { opacity: 1; }
.wp-ai-chats__tools:has([data-on]) { opacity: 1; }
@media (hover: none) { .wp-ai-chats__tools { opacity: 1; } }
.wp-ai-chats__icon {
  display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: 0; border-radius: 6px; background: none; color: var(--wp-text-muted); cursor: pointer;
}
.wp-ai-chats__icon:hover { color: var(--wp-text); background: var(--wp-bg-3, var(--wp-bg-1)); }
.wp-ai-chats__icon[data-on] { color: var(--wp-accent-text); }
.wp-ai-chats__icon .pi { font-size: 12px; }
.wp-ai-chats__rename { flex: 1; margin: 4px 0 4px 8px; }
.wp-ai-chats__ask { flex: 1; min-width: 0; padding-left: 8px; font-size: 12px; overflow-wrap: anywhere; }
.wp-ai-chats__btn {
  padding: 4px 9px; border-radius: 6px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--wp-border); background: var(--wp-bg-1); color: var(--wp-text);
}
.wp-ai-chats__btn--danger { border-color: var(--wp-danger); color: var(--wp-danger); }
.wp-ai-chats__btn--danger:hover { background: color-mix(in oklab, var(--wp-danger) 15%, var(--wp-bg-1)); }
</style>
