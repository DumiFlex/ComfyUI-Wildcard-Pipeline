<script setup lang="ts">
/**
 * ConstraintReattachSection — heals a constraint whose source/target
 * wildcard uuid is missing locally (#4). Renders ABOVE Identity in the
 * constraint surfaces (canvas modal + SPA editor). One red row per dangling
 * endpoint: the dead uuid (+ cached name), a Reattach button opening the
 * same searchable wildcard dropdown #3 uses, a dropped-cell preview count,
 * and the library-mutation blast-radius warning.
 *
 * SCOPE BOUNDARY (task_5200c1fc) — DO NOT CONFLATE WITH THE ENGINE FIX:
 * Reattach SIDESTEPS the engine pick-bucket collision in the common case
 * (re-pointing at a distinct local uuid yields a unique __wp_picks__ key).
 * It does NOT fix the collision: remapping two broken constraints onto the
 * SAME local wildcard re-manifests it (two instances of one library
 * wildcard share the pick bucket; the second pick clobbers the first). The
 * engine disambiguation (key picks on per-instance _uid + source-INSTANCE
 * binding) is tracked separately as task_5200c1fc. This is UI-layer
 * reference-healing only.
 *
 * RECONCILE IS DESTRUCTIVE: the dropped-cell count is previewed before
 * confirm; CONFIRM is the point of no return (the parent runs walkRemap +
 * rides Save-to-library); CANCEL is the only undo. No post-confirm undo of
 * dropped cells in v1.
 */
import { ref } from "vue";
import type { WildcardRefData } from "../../../../../manager/utils/library-suggestions";

const props = withDefaults(defineProps<{
  danglingSource: boolean;
  danglingTarget: boolean;
  sourceUuid: string;
  sourceCachedName: string;
  targetUuid: string;
  targetCachedName: string;
  refData: WildcardRefData;
  /** True when the constraint is referenced beyond the current context
   *  (reverse-dep / reach data). Drives the blast-radius warning. */
  referencedElsewhere: boolean;
  /** Optional preview: cells that would be dropped by the picked candidate
   *  (computed by the parent against the candidate's sub_categories). */
  droppedCellCount?: number;
}>(), { droppedCellCount: 0 });

const emit = defineEmits<{
  reattach: [payload: { side: "source" | "target"; oldUuid: string; newUuid: string; newName: string }];
  /** Live pre-confirm selection — lets the parent derive the dropped-cell
   *  preview against the candidate's sub_categories. Fired on every pick. */
  pick: [payload: { side: "source" | "target"; uuid: string }];
  /** Selection abandoned (dropdown opened/closed without confirming, or a
   *  confirm consumed it) — parent resets its dropped-cell preview to 0. */
  pickcleared: [];
}>();

type Side = "source" | "target";
const openSide = ref<Side | null>(null);
const query = ref("");
const picked = ref<{ uuid: string; name: string } | null>(null);

interface Candidate { uuid: string; name: string }

function candidates(): Candidate[] {
  const q = query.value.trim().toLowerCase();
  // Cached name of the open side is the SORT KEY (auto-suggest), mirroring
  // #3 RemapRefPopup: exact match floats to top WITHOUT filtering others out.
  const cached = (openSide.value === "target" ? props.targetCachedName : props.sourceCachedName).trim().toLowerCase();
  const out: Candidate[] = [];
  const dead = new Set([props.sourceUuid, props.targetUuid]);
  for (const [uuid, name] of props.refData.uuidToName) {
    if (dead.has(uuid)) continue; // can't re-pick the dangling uuid
    if (q && !name.toLowerCase().includes(q)) continue;
    out.push({ uuid, name });
  }
  return out.sort((a, b) => {
    const ax = a.name.toLowerCase() === cached ? 0 : 1;
    const bx = b.name.toLowerCase() === cached ? 0 : 1;
    return ax !== bx ? ax - bx : a.name.localeCompare(b.name);
  });
}

function openDropdown(side: Side): void {
  openSide.value = side;
  // Empty query keeps every live candidate visible; the cached name is the
  // sort key in candidates() (auto-suggest), floating an exact match to top
  // without filtering the rest out (mirrors #3 RemapRefPopup).
  query.value = "";
  picked.value = null;
  // Opening (or re-opening the other side) abandons any prior selection —
  // tell the parent so a stale dropped-cell preview can't linger.
  emit("pickcleared");
}

function pick(c: Candidate): void {
  picked.value = c;
  // Surface the live pre-confirm pick so the parent can derive the
  // dropped-cell preview before the irreversible confirm.
  if (openSide.value) emit("pick", { side: openSide.value, uuid: c.uuid });
}

function confirm(side: Side): void {
  if (!picked.value) return;
  emit("reattach", {
    side,
    oldUuid: side === "source" ? props.sourceUuid : props.targetUuid,
    newUuid: picked.value.uuid,
    newName: picked.value.name,
  });
  openSide.value = null;
  picked.value = null;
  // Confirm consumes the pick; the parent resets its preview (the reattach
  // handler also clears it, this keeps the two emits self-consistent).
  emit("pickcleared");
}
</script>

<template>
  <section class="rb" data-test="reattach-section">
    <div class="rb__label">Broken reference</div>

    <div v-if="danglingSource" class="rb__row" data-test="reattach-row-source">
      <i class="pi pi-exclamation-triangle rb__warn-icon" aria-hidden="true" />
      <span class="rb__txt">
        Source wildcard <code>{{ sourceUuid.slice(0, 8) }}</code>
        <span v-if="sourceCachedName"> (was “{{ sourceCachedName }}”)</span>
        is not in your library.
      </span>
      <button type="button" class="rb__btn" data-test="reattach-btn-source" @click="openDropdown('source')">Reattach</button>

      <div v-if="openSide === 'source'" class="rb__picker">
        <input v-model="query" type="text" class="rb__search" placeholder="Search wildcards…" spellcheck="false" aria-label="Search wildcards to reattach source" />
        <ul class="rb__list">
          <li
            v-for="c in candidates()"
            :key="c.uuid"
            class="rb__cand"
            data-test="reattach-candidate"
            :data-test-id="`reattach-candidate-${c.uuid}`"
            :class="{ 'rb__cand--picked': c.uuid === picked?.uuid }"
            @click="pick(c)"
          >{{ c.name }}</li>
        </ul>
        <p v-if="picked && (droppedCellCount ?? 0) > 0" class="rb__dropped" data-test="reattach-dropped-source">
          {{ droppedCellCount }} cells dropped — not on “{{ picked.name }}”.
        </p>
        <p v-if="referencedElsewhere" class="rb__blast" data-test="reattach-blast-radius">
          <i class="pi pi-info-circle" aria-hidden="true" />
          This changes the constraint everywhere it's used.
        </p>
        <p class="rb__note">Cancel is the only undo — confirm is final.</p>
        <button type="button" class="rb__confirm" data-test="reattach-confirm-source" :disabled="!picked || undefined" @click="confirm('source')">Confirm reattach</button>
      </div>
    </div>

    <div v-if="danglingTarget" class="rb__row" data-test="reattach-row-target">
      <i class="pi pi-exclamation-triangle rb__warn-icon" aria-hidden="true" />
      <span class="rb__txt">
        Target wildcard <code>{{ targetUuid.slice(0, 8) }}</code>
        <span v-if="targetCachedName"> (was “{{ targetCachedName }}”)</span>
        is not in your library.
      </span>
      <button type="button" class="rb__btn" data-test="reattach-btn-target" @click="openDropdown('target')">Reattach</button>

      <div v-if="openSide === 'target'" class="rb__picker">
        <input v-model="query" type="text" class="rb__search" placeholder="Search wildcards…" spellcheck="false" aria-label="Search wildcards to reattach target" />
        <ul class="rb__list">
          <li
            v-for="c in candidates()"
            :key="c.uuid"
            class="rb__cand"
            data-test="reattach-candidate"
            :data-test-id="`reattach-candidate-${c.uuid}`"
            :class="{ 'rb__cand--picked': c.uuid === picked?.uuid }"
            @click="pick(c)"
          >{{ c.name }}</li>
        </ul>
        <p v-if="picked && (droppedCellCount ?? 0) > 0" class="rb__dropped" data-test="reattach-dropped-target">
          {{ droppedCellCount }} cells dropped — not on “{{ picked.name }}”.
        </p>
        <p v-if="referencedElsewhere" class="rb__blast" data-test="reattach-blast-radius">
          <i class="pi pi-info-circle" aria-hidden="true" />
          This changes the constraint everywhere it's used.
        </p>
        <p class="rb__note">Cancel is the only undo — confirm is final.</p>
        <button type="button" class="rb__confirm" data-test="reattach-confirm-target" :disabled="!picked || undefined" @click="confirm('target')">Confirm reattach</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rb {
  padding: 12px 16px;
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 6%, var(--wp-bg2, #15151f));
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.rb__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-danger, #ef4444);
  margin-bottom: 8px;
}
.rb__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font: 11px var(--wp-font-sans); padding: 4px 0; }
.rb__warn-icon { color: var(--wp-danger, #ef4444); font-size: 12px; }
.rb__txt { flex: 1; color: var(--wp-text, #e7e7ee); }
.rb__txt code { font-family: var(--wp-font-mono, monospace); }
.rb__btn,
.rb__confirm {
  padding: 4px 12px;
  border: 1px solid var(--wp-accent, #8b5cf6);
  border-radius: 4px;
  background: transparent;
  color: var(--wp-accent-text, var(--wp-text));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.rb__confirm { background: var(--wp-accent, #8b5cf6); color: #fff; margin-top: 6px; }
.rb__picker {
  flex-basis: 100%;
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--wp-border, rgba(255,255,255,0.12));
  border-radius: 6px;
  background: var(--wp-bg, #11111b);
}
.rb__search {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 9px;
  border-radius: 4px;
  border: 1px solid var(--wp-border, rgba(255,255,255,0.12));
  background: var(--wp-bg-2, #15151f);
  color: var(--wp-text, #e7e7ee);
  font: 12px var(--wp-font-mono, monospace);
  outline: none;
}
.rb__list { list-style: none; margin: 6px 0; padding: 0; max-height: 150px; overflow-y: auto; }
.rb__cand { padding: 5px 8px; border-radius: 4px; cursor: pointer; color: var(--wp-text, #e7e7ee); }
.rb__cand:hover { background: color-mix(in oklab, var(--wp-accent, #8b5cf6) 18%, transparent); }
.rb__cand--picked { background: color-mix(in oklab, var(--wp-accent, #8b5cf6) 28%, transparent); }
.rb__dropped { margin: 6px 0 0; font: 11px var(--wp-font-sans); color: var(--wp-warn, #f59e0b); }
.rb__blast { margin: 6px 0 0; display: flex; align-items: center; gap: 5px; font: 11px var(--wp-font-sans); color: var(--wp-warn, #f59e0b); }
.rb__note { margin: 6px 0 0; font: 10px var(--wp-font-sans); color: var(--wp-text-dim, #6e6e7c); }
</style>
