<script setup lang="ts">
/**
 * AiCardGroup — several cards of one kind from one answer, as one card
 * (`utils/card-groups.ts`): a row per item with a tick, its summary, its
 * warnings and how it stands, and Apply / Dismiss / Undo for the ticked
 * rows. A row opens that item's own full card below it (the drawer draws
 * it), where its options, fixes and Open in editor are.
 *
 * Applying goes card by card through `useAiChat`, in the answer's order,
 * with "apply that one first" links honoured (`applyAll`), so a group does
 * exactly what pressing each Apply in turn would.
 */
import { computed, ref } from "vue";
import Button from "../ui/Button.vue";
import type { AiChatProposal } from "../../api/types";
import { useAiChat, type ChatAssistantEntry } from "../../composables/useAiChat";
import { groupTitle, type CardGroup } from "../../utils/card-groups";

const props = defineProps<{
  entry: ChatAssistantEntry;
  group: CardGroup;
  /** The answer's cards; the group's are picked out by id. */
  proposals: AiChatProposal[];
  /** The rows open below (their full cards), by card id. */
  open: Set<string>;
  /** `entry.status` copied, so the group redraws when a card changes. */
  status: Record<string, string>;
}>();
const emit = defineEmits<{ toggle: [pid: string] }>();
const chat = useAiChat();

const cards = computed(() => props.group.pids
  .map((pid) => props.proposals.find((p) => p.pid === pid))
  .filter((p): p is AiChatProposal => !!p));
/** Rows the user unticked: they stay out of Apply and Dismiss. */
const unticked = ref(new Set<string>());
const busy = ref(false);

const stateOf = (p: AiChatProposal): string => props.status[p.pid] ?? "pending";
const pending = computed(() => cards.value.filter((p) => stateOf(p) === "pending"));
const ticked = computed(() => pending.value.filter((p) => !unticked.value.has(p.pid)));
const applied = computed(() => cards.value.filter((p) => stateOf(p) === "applied" || stateOf(p) === "editor"));
const failed = computed(() => cards.value.filter((p) => stateOf(p) === "failed"));
const warned = computed(() => cards.value.filter((p) => p.warnings.some((w) => !p.notes?.includes(w))).length);
const fixable = computed(() => pending.value.filter((p) => (p.fixes?.length ?? 0) > 0));

function tick(pid: string): void {
  const next = new Set(unticked.value);
  if (next.has(pid)) next.delete(pid);
  else next.add(pid);
  unticked.value = next;
}

function tickAll(on: boolean): void {
  unticked.value = on ? new Set() : new Set(pending.value.map((p) => p.pid));
}

async function run(fn: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try { await fn(); } finally { busy.value = false; }
}

/** Apply the ticked rows in order; one that waits on another card applies
 *  that one first, as its own "Apply all" would. */
function applyTicked(): Promise<void> {
  return run(async () => {
    for (const p of ticked.value) {
      if (props.entry.status[p.pid]) continue;
      if (chat.blockedReason(props.entry, p) && chat.chainOf(props.entry, p).length) {
        await chat.applyAll(props.entry, p);
      } else if (!chat.blockedReason(props.entry, p)) {
        await chat.apply(props.entry, p);
      }
    }
  });
}

function dismissTicked(): void {
  for (const p of ticked.value) chat.dismiss(props.entry, p);
}

/** Undo every applied row, newest first, so later changes come off
 *  before what they were built on. */
function undoAll(): Promise<void> {
  return run(async () => {
    for (const p of [...applied.value].reverse()) await chat.undo(props.entry, p);
  });
}

function fixAll(): Promise<void> {
  return run(async () => {
    for (const p of fixable.value) await chat.fixAll(props.entry, p);
  });
}

const ICON: Record<string, string> = {
  pending: "pi-circle", applied: "pi-check-circle", editor: "pi-check-circle", dismissed: "pi-minus-circle",
  failed: "pi-times-circle", replaced: "pi-replay", opened: "pi-external-link",
};
const STATE: Record<string, string> = {
  pending: "Not applied", applied: "Applied", editor: "In the editor", dismissed: "Dismissed",
  failed: "Failed", replaced: "Replaced by a newer card", opened: "Opened in an editor",
};
</script>

<template>
  <article class="wp-ai-group" data-test="ai-chat-group" :data-key="group.key">
    <div class="wp-ai-group__head">
      <span class="wp-ai-group__name">{{ groupTitle(group.key, cards.length) }}</span>
      <span class="wp-ai-group__counts" data-test="ai-group-counts">
        {{ applied.length ? `${applied.length} applied · ` : "" }}{{ failed.length ? `${failed.length} failed (open one to see why and retry) · ` : "" }}{{ pending.length }} to review{{ warned ? ` · ${warned} with warnings` : "" }}
      </span>
    </div>
    <div v-if="pending.length > 1" class="wp-ai-group__bar">
      <span>{{ ticked.length }} of {{ pending.length }} ticked</span>
      <button type="button" class="wp-ai-group__link" data-test="ai-group-tick-all" @click="tickAll(ticked.length < pending.length)">
        {{ ticked.length < pending.length ? "Tick all" : "Untick all" }}
      </button>
    </div>
    <ul class="wp-ai-group__rows">
      <li v-for="p in cards" :key="p.pid" class="wp-ai-group__row" :data-state="stateOf(p)" data-test="ai-group-row">
        <input
          v-if="stateOf(p) === 'pending'"
          type="checkbox"
          :checked="!unticked.has(p.pid)"
          :aria-label="`Include ${p.title}`"
          data-test="ai-group-tick"
          @change="tick(p.pid)"
        />
        <i v-else :class="['pi', ICON[stateOf(p)] ?? 'pi-circle', 'wp-ai-group__state']" :title="STATE[stateOf(p)]" aria-hidden="true" />
        <button
          type="button"
          class="wp-ai-group__open"
          :aria-expanded="open.has(p.pid)"
          :title="open.has(p.pid) ? 'Hide the card' : 'Show the whole card'"
          data-test="ai-group-open"
          @click="emit('toggle', p.pid)"
        >
          <span class="wp-ai-group__title">{{ p.title }}</span>
          <span class="wp-ai-group__summary">{{ p.summary }}</span>
          <span v-if="p.warnings.some((w) => !p.notes?.includes(w))" class="wp-ai-group__warn" data-test="ai-group-warn">
            <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ p.warnings.filter((w) => !p.notes?.includes(w)).length }}
          </span>
          <span v-if="entry.errors[p.pid]" class="wp-ai-group__err" role="alert">{{ entry.errors[p.pid] }}</span>
          <i :class="['pi', open.has(p.pid) ? 'pi-chevron-up' : 'pi-chevron-down', 'wp-ai-group__chev']" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <div class="wp-ai-group__actions">
      <Button v-if="fixable.length > 1" variant="ghost" size="sm" icon="pi-wrench" :disabled="busy" data-test="ai-group-fix-all" @click="fixAll">Fix all {{ fixable.length }}</Button>
      <Button v-if="applied.length" variant="ghost" size="sm" :disabled="busy" data-test="ai-group-undo" @click="undoAll">Undo all {{ applied.length }}</Button>
      <Button v-if="ticked.length" variant="ghost" size="sm" :disabled="busy" data-test="ai-group-dismiss" @click="dismissTicked">Dismiss {{ ticked.length }}</Button>
      <Button v-if="ticked.length" variant="primary" size="sm" icon="pi-check" :loading="busy" data-test="ai-group-apply" @click="applyTicked">Apply {{ ticked.length }}</Button>
    </div>
  </article>
</template>

<style scoped>
.wp-ai-group {
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, var(--wp-border));
  border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px;
  background: color-mix(in oklab, var(--wp-accent-500) 4%, var(--wp-bg-2));
}
.wp-ai-group__head { display: flex; flex-direction: column; gap: 1px; }
.wp-ai-group__name { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.wp-ai-group__counts { font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-group__link { border: 0; background: none; padding: 0; font: inherit; font-size: 11px; color: var(--wp-accent-text); cursor: pointer; text-decoration: underline; }
.wp-ai-group__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.wp-ai-group__bar { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--wp-text-muted); padding: 0 2px; }
.wp-ai-group__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm); overflow: hidden; }
.wp-ai-group__row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-top: 1px solid var(--wp-border); font-size: 12.5px; }
.wp-ai-group__row:first-child { border-top: 0; }
.wp-ai-group__row[data-state="dismissed"], .wp-ai-group__row[data-state="replaced"] { opacity: 0.55; }
.wp-ai-group__row input { flex: none; margin: 0; accent-color: var(--wp-accent-500); }
.wp-ai-group__state { flex: none; font-size: 13px; color: var(--wp-text-muted); }
.wp-ai-group__row[data-state="applied"] .wp-ai-group__state, .wp-ai-group__row[data-state="editor"] .wp-ai-group__state { color: var(--wp-success); }
.wp-ai-group__row[data-state="failed"] .wp-ai-group__state { color: var(--wp-danger, var(--wp-warn)); }
.wp-ai-group__open {
  flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; padding: 2px 0; border: 0;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.wp-ai-group__open:hover .wp-ai-group__title { text-decoration: underline; }
.wp-ai-group__title { flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.wp-ai-group__summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wp-text-muted); }
.wp-ai-group__warn { flex: none; color: var(--wp-warn); font-size: 11.5px; }
.wp-ai-group__err { flex: none; color: var(--wp-danger, var(--wp-warn)); font-size: 11.5px; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-ai-group__chev { flex: none; font-size: 10px; color: var(--wp-text-muted); }
</style>
