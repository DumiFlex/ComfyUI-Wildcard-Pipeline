<script setup lang="ts">
/**
 * The work behind one chat answer, folded (`utils/chat-activity.ts`):
 *
 *   ▸ Worked for 1 min 12 s · read 4 items and ran 1 test     (the whole answer)
 *     ▸ 📖 Read 3 items · 4 s                                  (a group)
 *     What the model said between steps                        (always shown)
 *     ▸ ▶ Ran 1 test · 9 s
 *
 * The answer's line folds everything but what the model said; it starts
 * folded once the answer is done (never in Verbose) and isn't there while
 * it runs. A group is the work between two things the model said; its body
 * lists the thinking (one line each, opened on a click) and the calls. How
 * much shows is Settings › AI assistant › Work details (`ui.chatDetail`);
 * Show thinking / working notes / what it did still hide those kinds.
 *
 * Built from the kit's Disclosure, Badge and Chip.
 */
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import Disclosure from "@/kit/Disclosure.vue";
import Badge from "@/kit/Badge.vue";
import Chip from "@/kit/Chip.vue";
import AiMessage from "./AiMessage.vue";
import { KIND_ICON_MAP } from "../../../components/shared/kind-icons";
import type { AiChatRef, AiChatStep } from "../../api/types";
import { useUiStore } from "../../stores/uiStore";
import {
  CAT_ICON, doneTitle, failedCount, groupSteps, groupTime, hasWork, mainCat, previewLine,
  turnSummary, type ActivityItem,
} from "../../utils/chat-activity";

const props = withDefaults(defineProps<{
  steps: AiChatStep[];
  /** The final reply: a working note that repeats it is left out. */
  said?: string;
  refs?: Record<string, AiChatRef> | undefined;
  /** The answer is still being worked out. */
  running?: boolean;
  /** Live, while running: the model is thinking, and what it thought so far. */
  thinking?: boolean;
  thought?: string;
  /** Type out replies is on: the live thought shows in full under the
   *  group, not only as its title's preview line. */
  typing?: boolean;
  elapsedMs?: number | undefined;
}>(), { said: "", refs: undefined, running: false, thinking: false, thought: "", typing: true, elapsedMs: undefined });

const ui = useUiStore();
const router = useRouter();

const EDIT_ROUTES: Record<string, string> = {
  wildcard: "wildcards-edit", combine: "combines-edit", derivation: "derivations-edit",
  constraint: "constraints-edit", fixed_values: "fixed-values-edit", bundle: "bundles-edit",
  template: "templates-edit",
};

/** The steps the user wants to see (Show thinking / notes / what it did). */
const shown = computed(() => props.steps.filter((s) => (s.notice ? ui.chatSteps
  : s.think ? ui.chatThinking : s.say ? ui.chatNotes : ui.chatSteps)));

type Group = Extract<ActivityItem, { kind: "group" }>;
const items = computed<ActivityItem[]>(() => {
  const list = groupSteps(shown.value, props.said);
  // While it runs, the group being worked on shows before its first step
  // lands, under the key that group will have.
  if (props.running && list[list.length - 1]?.kind !== "group") {
    list.push({ kind: "group", key: `g${props.steps.length}`, steps: [] });
  }
  return list;
});
const liveKey = computed(() => {
  if (!props.running) return "";
  const last = items.value[items.value.length - 1];
  return last?.kind === "group" ? last.key : "";
});

const detail = computed(() => ui.chatDetail);
const work = computed(() => hasWork(shown.value));
const summary = computed(() => turnSummary(shown.value, props.elapsedMs));

/* ── The answer's line ── */
const canFold = computed(() => !props.running && detail.value !== "verbose" && work.value);
const turnOpen = ref(!canFold.value);
// Folds as the answer finishes; opening it again is the user's call.
watch(canFold, (v, was) => { if (v && !was) turnOpen.value = false; });
const processShown = computed(() => !canFold.value || turnOpen.value);

/* ── Groups ── */
const opened = reactive(new Map<string, boolean>());
function startsOpen(key: string): boolean {
  if (detail.value === "verbose") return true;
  return detail.value === "detailed" && props.running && key === liveKey.value;
}
function isOpen(key: string): boolean {
  return opened.get(key) ?? startsOpen(key);
}
function setOpen(key: string, v: boolean): void {
  opened.set(key, v);
}
// Folding the answer closes what was opened inside it.
watch(turnOpen, (v) => { if (!v) opened.clear(); });

/** Compact: one line per answer, the groups stay out of the way. */
const groupsShown = computed(() => detail.value !== "compact" || !props.running);

function title(g: Group): string {
  if (g.key !== liveKey.value) return doneTitle(g.steps);
  // Running: the newest thing it did, like a live log line, or its
  // thinking so far.
  const last = [...g.steps].reverse().find((s) => !s.think);
  if (props.thinking || !last) {
    const preview = props.thinking ? previewLine(props.thought, true) : "";
    return preview ? `Thinking · ${preview}` : "Thinking";
  }
  return last.note;
}
function icon(g: Group): string {
  return CAT_ICON[g.key === liveKey.value && props.thinking ? "think" : mainCat(g.steps)];
}

interface Row { step: AiChatStep; before: string; item: AiChatStep["item"] }
/** A group's rows; a read names its item as a chip that opens it. */
function rowsOf(steps: AiChatStep[]): Row[] {
  return steps.map((step) => {
    const it = step.item;
    if (!step.think && it && it.name && step.note.endsWith(it.name)) {
      return { step, before: step.note.slice(0, -it.name.length), item: it };
    }
    return { step, before: step.note, item: undefined };
  });
}
function openItem(r: Row): void {
  const it = r.item;
  const route = it ? EDIT_ROUTES[it.type] : undefined;
  if (it && route) void router.push({ name: route, params: { id: it.id } });
}
function kindIcon(type: string): string {
  // The kit's Icon takes "pi-sparkles", the map holds "pi pi-sparkles".
  return (KIND_ICON_MAP[type as keyof typeof KIND_ICON_MAP] ?? "pi pi-circle").replace(/^pi\s+/, "");
}
</script>

<template>
  <div v-if="running || shown.length" class="wp-ai-act" :data-running="running ? 'true' : undefined" :data-detail="detail" data-test="ai-activity">
    <Disclosure
      v-if="canFold"
      v-model:open="turnOpen"
      size="sm"
      class="wp-ai-act__turn"
      :trigger-attrs="{ 'data-test': 'ai-activity-turn' }"
    >
      <template #summary>
        <span class="wp-ai-act__title">
          {{ summary.title }}<span v-if="summary.detail" class="wp-ai-act__dim"> · {{ summary.detail }}</span>
        </span>
      </template>
    </Disclosure>

    <div class="wp-ai-act__body" :data-folded="canFold ? 'true' : undefined">
      <template v-for="item in items" :key="item.key">
        <div v-if="item.kind === 'say'" class="wp-ai-act__said" title="A note it wrote while working" data-test="ai-chat-said">
          <i class="pi pi-comment wp-ai-act__said-icon" aria-hidden="true" />
          <AiMessage class="wp-ai-act__said-text" :text="item.step.note" :refs="refs" />
        </div>
        <p v-else-if="item.kind === 'notice' && processShown" class="wp-ai-act__notice" data-test="ai-activity-notice">
          <i class="pi pi-replay" aria-hidden="true" /> {{ item.step.note }}
        </p>
        <Disclosure
          v-else-if="item.kind === 'group' && processShown && groupsShown"
          :open="isOpen(item.key)"
          size="sm"
          class="wp-ai-act__group"
          :data-live="item.key === liveKey ? 'true' : undefined"
          :trigger-attrs="{ 'data-test': 'ai-activity-group' }"
          lazy
          @update:open="(v: boolean) => setOpen(item.key, v)"
        >
          <template #summary>
            <i :class="['pi', icon(item), 'wp-ai-act__icon']" aria-hidden="true" />
            <span class="wp-ai-act__title">{{ title(item) }}</span>
            <span v-if="groupTime(item)" class="wp-ai-act__dim wp-ai-act__time">{{ groupTime(item) }}</span>
            <Badge v-if="failedCount(item.steps)" dot tone="warn" class="wp-ai-act__failed" :text="`${failedCount(item.steps)} failed`" />
          </template>
          <ul class="wp-ai-act__rows">
            <template v-for="(r, j) in rowsOf(item.steps)" :key="j">
              <li v-if="r.step.think" class="wp-ai-act__row" data-test="ai-chat-thought">
                <Disclosure size="sm" class="wp-ai-act__thought" lazy>
                  <template #summary>
                    <i class="pi pi-lightbulb wp-ai-act__icon" aria-hidden="true" />
                    <span class="wp-ai-act__title">Thinking<span v-if="previewLine(r.step.note)" class="wp-ai-act__dim"> · {{ previewLine(r.step.note) }}</span></span>
                  </template>
                  <p class="wp-ai-act__thought-text">{{ r.step.note }}</p>
                </Disclosure>
              </li>
              <li v-else class="wp-ai-act__row wp-ai-act__call" :data-ok="r.step.ok ? 'true' : 'false'">
                <i :class="['pi', r.step.ok ? 'pi-check' : 'pi-exclamation-circle', 'wp-ai-act__icon']" aria-hidden="true" />
                <span>
                  {{ r.before }}<Chip
                    v-if="r.item"
                    as="button"
                    :icon="kindIcon(r.item.type)"
                    :title="`Open ${r.item.name}`"
                    data-test="ai-activity-item"
                    @click="openItem(r)"
                  >{{ r.item.name }}</Chip>
                </span>
              </li>
            </template>
            <li v-if="item.key === liveKey && thinking && thought && typing" class="wp-ai-act__row" data-test="ai-chat-live-thought">
              <p class="wp-ai-act__thought-text">{{ thought }}</p>
            </li>
          </ul>
        </Disclosure>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wp-ai-act { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-ai-act__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-ai-act__body[data-folded] { padding-left: 2px; }
/* Headers read as quiet lines, not section titles. */
.wp-ai-act :deep(.wp-disclosure__trigger) { font-weight: 500; color: var(--wp-text-muted); }
.wp-ai-act__turn :deep(.wp-disclosure__trigger) { color: var(--wp-text-dim); }
.wp-ai-act__group[data-live] :deep(.wp-disclosure__trigger) { color: var(--wp-text); }
.wp-ai-act__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-ai-act__dim { color: var(--wp-text-dim); font-weight: 400; }
.wp-ai-act__failed { flex: none; }
.wp-ai-act__time { flex: none; font-variant-numeric: tabular-nums; }
.wp-ai-act__icon { flex: none; font-size: 11px; color: var(--wp-text-dim); }
.wp-ai-act__rows {
  list-style: none; margin: 0; padding: 0 0 2px 14px;
  display: flex; flex-direction: column; gap: 4px;
  /* A long group scrolls inside itself. */
  max-height: min(400px, 50vh); overflow-y: auto;
}
.wp-ai-act__row { font-size: 11px; color: var(--wp-text-dim); min-width: 0; overflow-wrap: anywhere; }
.wp-ai-act__call { display: flex; gap: 6px; align-items: baseline; }
.wp-ai-act__call[data-ok="false"] { color: var(--wp-warn); }
.wp-ai-act__thought-text {
  margin: 2px 0 0; padding-left: 8px; border-left: 2px solid var(--wp-border);
  white-space: pre-wrap; font-size: 11px; color: var(--wp-text-dim);
  max-height: 240px; overflow-y: auto;
}
.wp-ai-act__said { display: flex; gap: 6px; align-items: baseline; font-size: 12px; color: var(--wp-text-muted); margin: 2px 0; }
/* Marks a note it wrote while working, so it doesn't read as the reply. */
.wp-ai-act__said-icon { flex: none; font-size: 10px; color: var(--wp-text-dim); }
.wp-ai-act__said-text { min-width: 0; flex: 1; }
.wp-ai-act__notice { margin: 0; padding-left: 8px; font-size: 11px; color: var(--wp-text-dim); font-style: italic; }
.wp-ai-act__notice .pi { font-size: 10px; }
</style>
