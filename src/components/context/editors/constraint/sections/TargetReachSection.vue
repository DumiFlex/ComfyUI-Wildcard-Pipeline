<script setup lang="ts">
/**
 * Constraint TargetReachSection — the reach selector for the edited
 * constraint's `target_select`. Mirrors the engine reach model
 * (`engine/modules/_constraints.py::apply_constraints_for_target`):
 * each constraint covers SOME subset of the downstream instances of its
 * `target_wildcard_id`. Modes:
 *   - `all`    — every downstream target occurrence (default; minimal UI).
 *   - `first`  — only the first encounter.
 *   - `next N` — the first N encounters (stepper, min 1).
 *   - `pick`   — an explicit checklist of reachable occurrences.
 *
 * A pick names an occurrence the SAME way the engine + the static
 * `computePairingsFull` layer do:
 *   - direct: a downstream `wildcard` row whose `id === targetWildcardId`,
 *     named by its row `rowKey` (the per-instance uid the engine matches).
 *   - nested: a downstream carrier whose option value transitively refs
 *     `@{targetWildcardId}`, named by `(carrier rowKey, option_id)`.
 *
 * Library-defining edits stay in the SPA; this is a per-instance override
 * surfaced on the modal. Writes flow up via `update:modelValue` — the
 * modal threads the new `TargetSelect` into `module.instance.target_select`.
 */
import { computed } from "vue";
import {
  carrierOptionIdsFor,
  type ChainModule,
  type TargetSelect,
} from "../../../../../extension/constraint-pairs";
import WpCheck from "../../../../shared/WpCheck.vue";

type PickEntry = NonNullable<TargetSelect["picks"]>[number];

/** Strip the badge-layer `${nodeId}#` prefix off a rowKey, yielding the
 *  bare per-instance `_uid`. The persisted `pick` identity MUST be the
 *  bare `_uid` because the ENGINE matches `firing_uid =
 *  ctx["__wp_current_module_uid__"]` (the bare `_uid`, no node prefix —
 *  see engine/pipeline.py + _constraints.py::_occurrence_matches). The
 *  `nodeId#` prefix is a graph-wide-uniqueness convenience for the badge
 *  map only; `_uid` is globally unique on its own. Keeping the full
 *  rowKey for display keys, persisting the bare uid for engine match. */
const bareUid = (rk: string): string => {
  const i = rk.indexOf("#");
  return i >= 0 ? rk.slice(i + 1) : rk;
};


const props = withDefaults(
  defineProps<{
    /** Current `target_select` (effective: instance override or library,
     *  defaulting to `{mode:"all"}`). */
    modelValue?: TargetSelect;
    /** Flattened cross-node execution chain — the pick checklist is the
     *  reachable downstream target occurrences within it. Optional;
     *  empty/undefined renders an empty checklist (no crash). */
    chainModules?: ChainModule[];
    /** The edited constraint's row id (rowKey/`_uid`) — used to find its
     *  position in the chain so the walk only collects DOWNSTREAM rows. */
    constraintUid: string;
    /** The constraint's `target_wildcard_id` — the uuid direct rows match
     *  on + nested carriers transitively ref. */
    targetWildcardId: string;
    /** Display name of the target wildcard (the thing being constrained).
     *  Used to label nested-pick rows as "<target> via @<carrier>" so the
     *  user sees WHAT is reached, not the carrier name twice. */
    targetName?: string;
  }>(),
  { modelValue: () => ({ mode: "all" }), chainModules: () => [], targetName: "" },
);

const emit = defineEmits<{ "update:modelValue": [next: TargetSelect] }>();

const mode = computed<TargetSelect["mode"]>(() => props.modelValue?.mode ?? "all");
const count = computed<number>(() => {
  const c = Number(props.modelValue?.count);
  return Number.isFinite(c) && c >= 1 ? Math.floor(c) : 1;
});
const picks = computed<PickEntry[]>(() => {
  const p = props.modelValue?.picks;
  return Array.isArray(p) ? p : [];
});

/** Target wildcard's display name for nested-pick labels; "target" when the
 *  modal didn't supply one (headless / legacy mounts). */
const targetLabel = computed<string>(() => props.targetName?.trim() || "target");

const MODES: Array<{ key: TargetSelect["mode"]; label: string }> = [
  { key: "first", label: "first" },
  { key: "next", label: "next N" },
  { key: "all", label: "all" },
  { key: "pick", label: "pick" },
];

/** Switch reach mode. Entering `next` defaults `count:1`; entering `pick`
 *  defaults `picks:[]`. `first`/`all` carry no extra fields. Preserves the
 *  current count/picks when re-entering the same mode is a no-op (we only
 *  emit a fresh selector). */
function setMode(next: TargetSelect["mode"]): void {
  if (next === mode.value) return;
  switch (next) {
    case "next":
      emit("update:modelValue", { mode: "next", count: count.value || 1 });
      break;
    case "pick":
      emit("update:modelValue", { mode: "pick", picks: picks.value });
      break;
    default:
      emit("update:modelValue", { mode: next });
  }
}

function onCountInput(ev: Event): void {
  const raw = Number((ev.target as HTMLInputElement).value);
  const n = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  emit("update:modelValue", { mode: "next", count: n });
}

/** Custom stepper ▲/▼. The native number-input spinners are suppressed
 *  (they only show on hover and render inconsistently inside ComfyUI's
 *  embedded DOM), so explicit buttons give the always-visible arrows the
 *  user asked for. Clamped at the engine minimum of 1 (a `next 0` reach
 *  covers nothing). */
function bumpCount(delta: number): void {
  const next = Math.max(1, count.value + delta);
  emit("update:modelValue", { mode: "next", count: next });
}

// ── Pick checklist ──────────────────────────────────────────────
//
// Build a uuid → option-value-strings lookup from the chain (first-seen
// wins, carriers only), EXACTLY as computePairingsFull does, so the
// transitive carrier scan matches what the badge layer + engine resolve.
const CARRIER_TYPES = new Set(["wildcard", "derivation"]);
const lookup = computed<(uuid: string) => string[]>(() => {
  const byUuid = new Map<string, string[]>();
  for (const m of props.chainModules) {
    if (!CARRIER_TYPES.has(m.type) || byUuid.has(m.id)) continue;
    const values: string[] = [];
    if (m.type === "derivation") {
      // Derivation action values can host @{uuid} refs (engine stamps
      // branchKey as the option_id). Mirrors refBearingEntries in
      // constraint-pairs.ts — but here we only need the VALUE strings
      // for the transitive reachPath lookup, not the ids.
      const p = m.payload as {
        rules?: Array<{
          branches?: Array<{ action?: { value?: string } }>;
          else?: { action?: { value?: string } } | null;
        }>;
      };
      for (const r of Array.isArray(p.rules) ? p.rules : []) {
        for (const b of Array.isArray(r?.branches) ? r.branches : []) {
          const v = b?.action?.value;
          if (typeof v === "string") values.push(v);
        }
        const elseV = r?.else?.action?.value;
        if (typeof elseV === "string") values.push(elseV);
      }
    } else {
      const opts = (m.payload as { options?: Array<{ value?: string }> }).options;
      if (!Array.isArray(opts)) continue;
      for (const o of opts) if (typeof o?.value === "string") values.push(o.value);
    }
    byUuid.set(m.id, values);
  }
  return (uuid: string) => byUuid.get(uuid) ?? [];
});

interface PickRow {
  /** Stable key + data-test suffix. */
  key: string;
  entry: PickEntry;
  name: string;
  kind: "direct" | "nested";
  nodeLabel?: string;
  /** Per-uuid duplicate disambiguator, e.g. "2 of 3" — omitted when the
   *  occurrence is unique among its kind+name siblings. */
  ordinal?: string;
}

/** Walk the chain DOWNSTREAM of the edited constraint, collecting every
 *  reachable occurrence of `targetWildcardId`: direct top-level instances
 *  + transitive carriers. Identity matches the engine /
 *  computePairingsFull (rowKey for direct; carrier rowKey + option_id for
 *  nested). Empty when the chain is empty or the constraint isn't found. */
const pickRows = computed<PickRow[]>(() => {
  const chain = props.chainModules;
  const start = chain.findIndex((m) => m.rowKey === props.constraintUid);
  if (start < 0) return [];
  const rows: PickRow[] = [];
  const tgt = props.targetWildcardId;
  for (let j = start + 1; j < chain.length; j++) {
    const cm = chain[j];
    if (cm.type === "wildcard" && cm.id === tgt) {
      // Direct top-level instance.
      rows.push({
        // `key`/`data-test` keep the full rowKey (display-only, graph-
        // wide unique); the persisted pick `uid` is the BARE _uid the
        // engine matches (see bareUid).
        key: cm.rowKey,
        entry: { kind: "direct", uid: bareUid(cm.rowKey) },
        name: cm.displayName?.trim() || cm.id,
        kind: "direct",
        nodeLabel: cm.nodeLabel,
      });
      continue;
    }
    // Transitive carrier — one row per matching option id.
    const match = carrierOptionIdsFor(cm, tgt, lookup.value);
    for (const optionId of match.optionIds) {
      rows.push({
        // `key`/`data-test` keep the full rowKey (display-only); the
        // persisted `carrier_uid` is the BARE _uid the engine's nested
        // carrier_ctx stamps (wildcard_handler stamps bare `_uid`).
        key: `${cm.rowKey}::${optionId}`,
        entry: { kind: "nested", carrier_uid: bareUid(cm.rowKey), option_id: optionId },
        // The nested ref IS the TARGET (`@{target}`), hosted inside this
        // carrier's option. Name it "@<target-display-name> in <carrier-
        // display-name>" — the `@` belongs to the referenced TARGET, NOT the
        // host; both shown by display name (not binding). The host carrier
        // here happens to be the constraint's source wildcard.
        name: `@${targetLabel.value} in ${cm.displayName?.trim() || cm.id}`,
        kind: "nested",
        nodeLabel: cm.nodeLabel,
      });
    }
  }
  // Duplicate disambiguator: when several rows share kind+name (two
  // instances of the same target wildcard downstream), stamp "#N of M".
  const groups = new Map<string, PickRow[]>();
  for (const r of rows) {
    const g = `${r.kind}:${r.name}`;
    const arr = groups.get(g);
    if (arr) arr.push(r);
    else groups.set(g, [r]);
  }
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.forEach((r, i) => { r.ordinal = `${i + 1} of ${arr.length}`; });
  }
  return rows;
});

function samePick(a: PickEntry, b: PickEntry): boolean {
  if (a.kind === "direct" && b.kind === "direct") return a.uid === b.uid;
  if (a.kind === "nested" && b.kind === "nested") {
    return a.carrier_uid === b.carrier_uid && a.option_id === b.option_id;
  }
  return false;
}

function isPicked(entry: PickEntry): boolean {
  return picks.value.some((p) => samePick(p, entry));
}

function togglePick(entry: PickEntry): void {
  const cur = picks.value;
  const next = isPicked(entry)
    ? cur.filter((p) => !samePick(p, entry))
    : [...cur, entry];
  emit("update:modelValue", { mode: "pick", picks: next });
}

// ── Consequence hint ────────────────────────────────────────────
const reachCount = computed(() => pickRows.value.length);
const hint = computed<string>(() => {
  const n = reachCount.value;
  const tgtN = `${n} downstream ${n === 1 ? "target" : "targets"}`;
  switch (mode.value) {
    case "all":
      return `→ re-weights all ${tgtN}`;
    case "first":
      return n > 0 ? "→ re-weights the first downstream target" : "→ no downstream target to cover";
    case "next": {
      const k = count.value;
      return `→ re-weights the first ${k} downstream ${k === 1 ? "target" : "targets"}`;
    }
    case "pick": {
      const sel = picks.value.length;
      return `→ re-weights ${sel} picked ${sel === 1 ? "target" : "targets"}`;
    }
    default:
      return "";
  }
});
</script>

<template>
  <section class="rh" data-test="reach-section">
    <div class="rh__label">Target reach</div>

    <div class="rh-seg" role="group" aria-label="Target reach mode">
      <button
        v-for="m in MODES"
        :key="m.key"
        type="button"
        class="rh-btn"
        :class="{ active: mode === m.key }"
        :aria-pressed="mode === m.key"
        :data-test="`reach-mode-${m.key}`"
        @click="setMode(m.key)"
      >{{ m.label }}</button>

      <span v-if="mode === 'next'" class="rh-step">
        <input
          class="rh-step__field"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          :value="count"
          aria-label="Number of downstream targets"
          data-test="reach-count"
          @input="onCountInput"
        />
        <span class="rh-step__arrows">
          <button
            type="button"
            class="rh-step__arrow"
            aria-label="Increase count"
            data-test="reach-count-up"
            @click="bumpCount(1)"
          >▲</button>
          <button
            type="button"
            class="rh-step__arrow"
            aria-label="Decrease count"
            :disabled="count <= 1"
            data-test="reach-count-down"
            @click="bumpCount(-1)"
          >▼</button>
        </span>
      </span>
    </div>

    <div v-if="mode === 'pick'" class="rh-pick" data-test="reach-picklist">
      <div
        v-if="pickRows.length === 0"
        class="rh-pick__empty"
        data-test="reach-pick-empty"
      >No reachable target instances — use first / next / all.</div>
      <!-- WpCheck is the interactive control (own role/keyboard + aria-
           label); the row is presentational so the checkbox is the single
           focus/click target — no redundant row-level handler. -->
      <div
        v-for="row in pickRows"
        :key="row.key"
        class="rh-pick__row"
        :data-test="`reach-pick-${row.key}`"
      >
        <WpCheck
          :model-value="isPicked(row.entry)"
          :aria-label="`Cover ${row.name}`"
          @update:model-value="togglePick(row.entry)"
        />
        <span class="rh-pick__name">{{ row.name }}</span>
        <span class="rh-pick__tag" :class="`rh-pick__tag--${row.kind}`">{{ row.kind }}</span>
        <span v-if="row.nodeLabel" class="rh-pick__node">{{ row.nodeLabel }}</span>
        <span v-if="row.ordinal" class="rh-pick__ord">#{{ row.ordinal }}</span>
      </div>
    </div>

    <div class="rh__hint" data-test="reach-hint">{{ hint }}</div>
  </section>
</template>

<style scoped>
.rh {
  padding: 12px 16px;
  /* Subtle neutral demarcation. The earlier accent wash + inset rail read
     as too loud; a faint text-tinted panel (same idiom as `.rh-seg` /
     row hover below) sets the section apart on both light + dark without
     shouting. */
  background: color-mix(in srgb, var(--wp-text) 3%, transparent);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.rh__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 8px;
}

/* ── Segmented control — mirrors CellRulePopover `.pop-btn` group. ── */
.rh-seg {
  display: inline-flex;
  align-items: stretch;
  gap: 0;
  border: 1px solid var(--wp-border);
  border-radius: 4px;
  overflow: hidden;
  background: color-mix(in srgb, var(--wp-text) 2%, transparent);
}
.rh-btn {
  padding: 6px 12px;
  border: 0;
  border-right: 1px solid var(--wp-border);
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 600 10px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.rh-btn:last-of-type { border-right: 0; }
.rh-btn:hover { color: var(--wp-text); background: color-mix(in srgb, var(--wp-text) 6%, transparent); }
.rh-btn.active {
  /* White-on-accent, matching the modal footer's `.wp-cnm__btn--primary`
   * (the accent is a saturated purple in both light + dark themes, so a
   * hard white reads on both — `--wp-accent-on` isn't reliably defined). */
  background: var(--wp-accent);
  color: #fff;
}

/* Stepper sits flush after the segmented group: number field + a stacked
   ▲/▼ arrow column. */
.rh-step {
  display: inline-flex;
  align-items: stretch;
  border-left: 1px solid var(--wp-border);
  background: var(--wp-bg-deep, var(--wp-bg));
}
.rh-step__field {
  width: 38px;
  background: transparent;
  border: 0;
  padding: 0 6px;
  font: 600 12px var(--wp-font-mono);
  color: var(--wp-text);
  text-align: center;
  -moz-appearance: textfield;
}
/* Native spinners are suppressed in favour of the custom always-visible
   ▲/▼ buttons (native arrows only appear on hover + render inconsistently
   in ComfyUI's embedded DOM). */
.rh-step__field::-webkit-outer-spin-button,
.rh-step__field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.rh-step__field:focus { outline: none; }

.rh-step__arrows {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--wp-border);
}
.rh-step__arrow {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font-size: 7px;
  line-height: 1;
  cursor: pointer;
}
.rh-step__arrow + .rh-step__arrow { border-top: 1px solid var(--wp-border); }
.rh-step__arrow:hover:not(:disabled) {
  color: var(--wp-text);
  background: color-mix(in srgb, var(--wp-text) 8%, transparent);
}
.rh-step__arrow:disabled { opacity: 0.3; cursor: default; }

/* ── Pick checklist ─────────────────────────────────────────────── */
.rh-pick {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  padding: 6px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 4px;
}
.rh-pick__empty {
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  padding: 4px 2px;
}
.rh-pick__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 3px;
  cursor: pointer;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text);
}
.rh-pick__row:hover { background: color-mix(in srgb, var(--wp-text) 5%, transparent); }
.rh-pick__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--wp-font-mono);
}
.rh-pick__tag {
  font: 600 8px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: 999px;
}
.rh-pick__tag--direct {
  color: var(--wp-constraint-target-text, var(--wp-text-muted, var(--wp-text2)));
  background: color-mix(in oklab, var(--wp-constraint-target, var(--wp-accent)) 18%, transparent);
}
.rh-pick__tag--nested {
  color: var(--wp-accent-text, var(--wp-text-muted, var(--wp-text2)));
  background: color-mix(in oklab, var(--wp-accent) 18%, transparent);
}
.rh-pick__node {
  font: 600 9px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  padding: 0 5px;
}
.rh-pick__ord {
  font: 9px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
}

.rh__hint {
  margin-top: 8px;
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
}
</style>
