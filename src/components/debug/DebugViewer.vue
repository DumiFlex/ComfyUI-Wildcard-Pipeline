<script setup lang="ts">
/**
 * WP Debug node body. Parses the snapshot `wp_nodes/debug_node.py` emits
 * (see `debug-model.ts`) and shows it four ways:
 *   Variables — the final context, who set each value
 *   Trace     — every step in run order, grouped by Context node, each
 *               expandable to the reasons (branch results, odds, reach…)
 *   Warnings  — what the engine flagged, linked to the step that raised it
 *   Raw       — the snapshot JSON
 */
import { computed, nextTick, ref, watch } from "vue";
import { highlightJson } from "./highlight";
import ContextMenu, { type ContextMenuItem } from "../shared/ContextMenu.vue";
import DebugVariables from "./DebugVariables.vue";
import DebugTrace from "./DebugTrace.vue";
import DebugWarnings from "./DebugWarnings.vue";
import {
  buildModel,
  parseSnapshot,
  stepSearchText,
  unresolvedUuids,
  type NodeInfo,
  type TraceStep,
  type VarRow,
  type WarningRow,
} from "./debug-model";

const props = withDefaults(
  defineProps<{
    snapshot: string;
    /** Litegraph mode: 0 = always, 2 = muted, 4 = bypassed. Dims the body. */
    nodeMode?: number;
    /** Snapshots from the last run; >1 when a WP_ContextLoop fed N contexts. */
    iterationCount?: number;
    /** 0-based index of the displayed iteration. */
    iterationIndex?: number;
    /** Title + codename of the graph node with this id ("" when unknown). */
    nodeInfo?: (nodeId: string) => NodeInfo;
    /** Select + centre a graph node. Omitted in tests / off-canvas. */
    focusNode?: ((nodeId: string) => void) | null;
  }>(),
  {
    nodeMode: 0,
    iterationCount: 1,
    iterationIndex: 0,
    nodeInfo: () => ({ title: "", codename: "" }),
    focusNode: null,
  },
);

const emit = defineEmits<{
  /** Minimum width the chrome needs; the mount glue feeds it to litegraph. */
  (e: "request-min-width", w: number): void;
  (e: "update:iterationIndex", idx: number): void;
}>();

type TabId = "vars" | "trace" | "warnings" | "raw";
const activeTab = ref<TabId>("vars");

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);
const raw = computed(() => parseSnapshot(props.snapshot));
const model = computed(() => (raw.value ? buildModel(raw.value) : null));

function gotoIteration(next: number): void {
  if (next < 0 || next >= props.iterationCount || next === props.iterationIndex) return;
  emit("update:iterationIndex", next);
}

// ── Names for @{uuid} chips ─────────────────────────────────────────────
// The trace names every module that ran; anything else a value or warning
// mentions is looked up once in the library (`embed-bundle` returns each
// module's var_binding) so chips read `@style` rather than a short uuid.
const libraryNames = ref<Record<string, string>>({});
const requested = new Set<string>();
const knownNames = computed<Record<string, string>>(() => ({
  ...libraryNames.value,
  ...(model.value?.names ?? {}),
}));
watch(
  () => (model.value && raw.value ? unresolvedUuids(model.value, raw.value, knownNames.value) : []),
  (uuids) => {
    const want = uuids.filter((u) => !requested.has(u));
    if (want.length === 0 || typeof fetch !== "function") return;
    for (const u of want) requested.add(u);
    void fetch("/wp/api/modules/embed-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuids: want }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const snaps = (data as { snapshots?: Record<string, { name?: string; payload?: { var_binding?: string } }> } | null)?.snapshots;
        if (!snaps || typeof snaps !== "object") return;
        const next = { ...libraryNames.value };
        for (const [uuid, e] of Object.entries(snaps)) {
          const name = e?.payload?.var_binding ?? e?.name;
          if (typeof name === "string" && name) next[uuid] = name;
        }
        libraryNames.value = next;
      })
      .catch(() => { /* best effort: chips fall back to short ids */ });
  },
  { immediate: true },
);
const uuidToName = computed(() => new Map(Object.entries(knownNames.value)));
const uuidToKind = computed(() => new Map(Object.entries(model.value?.kinds ?? {})));

// ── Filter + pins ───────────────────────────────────────────────────────
const filterQuery = ref("");
const pinned = ref<Set<string>>(new Set());
function togglePin(key: string): void {
  const next = new Set(pinned.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  pinned.value = next;
}
const q = computed(() => filterQuery.value.trim().toLowerCase());

const visibleVars = computed<VarRow[]>(() => {
  const rows = model.value?.variables ?? [];
  if (!q.value) return rows;
  return rows.filter((v) =>
    pinned.value.has(`var:${v.name}`)
    || `$${v.name}`.toLowerCase().includes(q.value)
    || v.value.toLowerCase().includes(q.value)
    || v.writerName.toLowerCase().includes(q.value)
    || v.negatives.some((n) => n.text.toLowerCase().includes(q.value)),
  );
});

const visibleGroups = computed(() => {
  const groups = model.value?.groups ?? [];
  if (!q.value) return groups;
  return groups
    .map((g) => ({
      ...g,
      steps: g.steps.filter((s) => pinned.value.has(s.key) || stepSearchText(s).includes(q.value)),
    }))
    .filter((g) => g.steps.length > 0);
});

const visibleWarnings = computed<WarningRow[]>(() => {
  const rows = model.value?.warnings ?? [];
  if (!q.value) return rows;
  return rows.filter((w) => `${w.label}\n${w.message}\n${w.type}`.toLowerCase().includes(q.value));
});

const stepsByKey = computed(() => new Map((model.value?.steps ?? []).map((s) => [s.key, s])));
const warningsByStep = computed(() => {
  const m = new Map<string, WarningRow[]>();
  for (const w of model.value?.warnings ?? []) {
    if (!w.stepKey) continue;
    const list = m.get(w.stepKey) ?? [];
    list.push(w);
    m.set(w.stepKey, list);
  }
  return m;
});
const showGroupHeads = computed(() => {
  const groups = model.value?.groups ?? [];
  return groups.length > 1 || (groups.length === 1 && !!groups[0].nodeId);
});

// ── Expand / jump ───────────────────────────────────────────────────────
const expanded = ref<Set<string>>(new Set());
const flashKey = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);
function toggleStep(key: string): void {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  expanded.value = next;
}
const allOpen = computed(() => {
  const steps = model.value?.steps ?? [];
  return steps.length > 0 && steps.every((s) => expanded.value.has(s.key));
});
function toggleAll(): void {
  expanded.value = allOpen.value ? new Set() : new Set((model.value?.steps ?? []).map((s) => s.key));
}
async function gotoStep(key: string): Promise<void> {
  activeTab.value = "trace";
  filterQuery.value = "";
  const next = new Set(expanded.value);
  next.add(key);
  expanded.value = next;
  flashKey.value = key;
  window.setTimeout(() => { if (flashKey.value === key) flashKey.value = null; }, 900);
  await nextTick();
  const el = root.value?.querySelector<HTMLElement>(`[data-step-key="${key}"]`);
  el?.scrollIntoView?.({ block: "nearest" });
}
const canFocus = computed(() => typeof props.focusNode === "function");
function focusNode(id: string): void {
  props.focusNode?.(id);
}

// Keep expansions only while the steps they name still exist.
watch(model, (m) => {
  const keys = new Set((m?.steps ?? []).map((s) => s.key));
  const kept = [...expanded.value].filter((k) => keys.has(k));
  if (kept.length !== expanded.value.size) expanded.value = new Set(kept);
});

// Flash variables whose value changed since the previous run.
const flashedVars = ref<Set<string>>(new Set());
let prevValues = new Map<string, string>();
watch(model, (m) => {
  const next = new Map((m?.variables ?? []).map((v) => [v.name, v.value]));
  const changed = new Set<string>();
  for (const [k, v] of next) {
    const before = prevValues.get(k);
    if (before !== undefined && before !== v) changed.add(k);
  }
  prevValues = next;
  if (changed.size === 0) return;
  flashedVars.value = changed;
  window.setTimeout(() => { flashedVars.value = new Set(); }, 700);
});

// ── Toolbar ─────────────────────────────────────────────────────────────
const tabText = computed(() => {
  const r = raw.value;
  if (!r) return "";
  switch (activeTab.value) {
    case "vars": {
      const vars: Record<string, unknown> = Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("__")));
      // The negatives table belongs with the variables it describes.
      if (r.__wp_negatives__) vars.__wp_negatives__ = r.__wp_negatives__;
      return JSON.stringify(vars, null, 2);
    }
    case "trace": return JSON.stringify(r.__wp_trace__ ?? [], null, 2);
    case "warnings": return JSON.stringify(r.__wp_warnings__ ?? [], null, 2);
    default: return JSON.stringify(r, null, 2);
  }
});
const rawHtml = computed(() => (activeTab.value === "raw" && raw.value ? highlightJson(JSON.stringify(raw.value, null, 2)) : ""));
const copyFlash = ref(false);
async function clipboardWrite(text: string): Promise<void> {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { /* permission denied */ }
}
async function copyTab(): Promise<void> {
  await clipboardWrite(tabText.value);
  copyFlash.value = true;
  window.setTimeout(() => { copyFlash.value = false; }, 1200);
}
function downloadJson(): void {
  if (!raw.value) return;
  const blob = new Blob([props.snapshot], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wp-debug-snapshot.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const seedCopied = ref(false);
async function copySeed(): Promise<void> {
  if (!model.value?.seed) return;
  await clipboardWrite(model.value.seed);
  seedCopied.value = true;
  window.setTimeout(() => { seedCopied.value = false; }, 1200);
}

const tabs = computed(() => {
  const m = model.value;
  return [
    { id: "vars" as const, label: "Variables", count: m?.variables.length ?? 0 },
    { id: "trace" as const, label: "Trace", count: m?.steps.length ?? 0 },
    { id: "warnings" as const, label: "Warnings", count: m?.warnings.length ?? 0 },
    { id: "raw" as const, label: "Raw", count: 0 },
  ];
});
const warnTone = computed(() => {
  const c = model.value?.counts;
  if (!c) return "";
  if (c.error) return "error";
  if (c.warning) return "warning";
  return c.info ? "info" : "";
});

// Chrome needs: 4 tabs (~300) + filter (150) + 2 buttons (56) + padding.
watch(activeTab, () => emit("request-min-width", 420), { immediate: true });

// ── Right-click menus ───────────────────────────────────────────────────
interface MenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  header?: { icon: string; label: string };
}
const menu = ref<MenuState>({ visible: false, x: 0, y: 0, items: [] });
const ctxActiveKey = ref<string | null>(null);
function closeMenu(): void {
  menu.value.visible = false;
  ctxActiveKey.value = null;
}
function openMenu(ev: MouseEvent, key: string, items: ContextMenuItem[], header: MenuState["header"]): void {
  ev.preventDefault();
  ev.stopPropagation();
  ctxActiveKey.value = key;
  menu.value = {
    visible: true,
    x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 258)),
    y: Math.max(8, Math.min(ev.clientY, window.innerHeight - 228)),
    items,
    header,
  };
}
function pinItem(key: string): ContextMenuItem {
  const on = pinned.value.has(key);
  return {
    label: on ? "Unpin row" : "Pin row",
    icon: on ? "pi-star-fill" : "pi-star",
    subtitle: on ? "Let the filter hide it again" : "Keep it visible while filtering",
    onSelect: () => togglePin(key),
    divider: true,
  };
}
function openVarMenu(ev: MouseEvent, v: VarRow): void {
  const key = `var:${v.name}`;
  const items: ContextMenuItem[] = [
    pinItem(key),
    { label: "Copy value", icon: "pi-clone", disabled: !v.value, onSelect: () => { void clipboardWrite(v.value); } },
    { label: `Copy $${v.name}`, icon: "pi-dollar", onSelect: () => { void clipboardWrite(`$${v.name}`); } },
  ];
  if (v.writerKey) {
    const k = v.writerKey;
    items.push({ label: "Show in trace", icon: "pi-bolt", divider: true, onSelect: () => { void gotoStep(k); } });
  }
  openMenu(ev, key, items, { icon: "pi-dollar", label: `Variable · $${v.name}` });
}
function openStepMenu(ev: MouseEvent, s: TraceStep): void {
  const first = s.writes[0];
  const items: ContextMenuItem[] = [
    pinItem(s.key),
    { label: expanded.value.has(s.key) ? "Collapse" : "Expand", icon: "pi-chevron-down", onSelect: () => toggleStep(s.key) },
    { label: "Copy value", icon: "pi-clone", disabled: !first?.value, onSelect: () => { void clipboardWrite(first?.value ?? ""); } },
  ];
  if (s.bindings[0]) {
    const b = s.bindings[0];
    items.push({ label: `Copy $${b}`, icon: "pi-dollar", onSelect: () => { void clipboardWrite(`$${b}`); } });
  }
  if (s.seed) items.push({ label: "Copy seed", icon: "pi-hashtag", onSelect: () => { void clipboardWrite(s.seed); } });
  if (s.id) items.push({ label: "Copy module id", icon: "pi-id-card", onSelect: () => { void clipboardWrite(s.id); } });
  if (canFocus.value && s.nodeId) {
    const id = s.nodeId;
    items.push({ label: "Show node", icon: "pi-arrow-up-right", divider: true, onSelect: () => focusNode(id) });
  }
  openMenu(ev, s.key, items, { icon: "pi-bolt", label: `Step ${s.order} · ${s.name || s.kindLabel}` });
}
</script>

<template>
  <div ref="root" class="wp-debug" :class="{ 'wp-debug--skipped': isSkipped }">
    <template v-if="model">
      <header class="wp-dbg-head" data-test="dbg-head">
        <button
          v-if="model.seed"
          type="button"
          class="wp-dbg-head__seed"
          :class="{ 'is-flashed': seedCopied }"
          data-test="dbg-seed"
          :title="seedCopied ? 'Copied' : 'Chain seed of the last Context. Click to copy.'"
          @click="copySeed"
        ><span class="wp-dbg-head__seed-label">seed</span>{{ model.seed }}<i :class="['pi', seedCopied ? 'pi-check' : 'pi-copy']" aria-hidden="true" /></button>
        <div v-if="iterationCount > 1" class="wp-dbg-iter" role="navigation" aria-label="loop iteration picker">
          <button
            type="button"
            class="wp-dbg-iter__btn"
            :disabled="iterationIndex <= 0"
            data-test="dbg-iter-prev"
            title="Previous iteration"
            @click="gotoIteration(iterationIndex - 1)"
          ><i class="pi pi-chevron-left" aria-hidden="true" /></button>
          <span class="wp-dbg-iter__label" data-test="dbg-iter-label">frame {{ iterationIndex + 1 }} / {{ iterationCount }}</span>
          <button
            type="button"
            class="wp-dbg-iter__btn"
            :disabled="iterationIndex >= iterationCount - 1"
            data-test="dbg-iter-next"
            title="Next iteration"
            @click="gotoIteration(iterationIndex + 1)"
          ><i class="pi pi-chevron-right" aria-hidden="true" /></button>
        </div>
        <span class="wp-dbg-head__stat">{{ model.steps.length }} step{{ model.steps.length === 1 ? "" : "s" }}</span>
        <span v-if="model.groups.length > 1" class="wp-dbg-head__stat">{{ model.groups.length }} nodes</span>
        <button
          v-if="warnTone"
          type="button"
          class="wp-dbg-head__warn"
          :class="`is-${warnTone}`"
          data-test="dbg-head-warn"
          @click="activeTab = 'warnings'"
        >
          <i class="pi pi-exclamation-triangle" aria-hidden="true" />
          <template v-if="model.counts.error">{{ model.counts.error }} error{{ model.counts.error === 1 ? "" : "s" }}</template>
          <template v-if="model.counts.error && model.counts.warning">, </template>
          <template v-if="model.counts.warning">{{ model.counts.warning }} warning{{ model.counts.warning === 1 ? "" : "s" }}</template>
          <template v-if="!model.counts.error && !model.counts.warning">{{ model.counts.info }} note{{ model.counts.info === 1 ? "" : "s" }}</template>
        </button>
        <span v-else class="wp-dbg-head__ok" data-test="dbg-head-ok"><i class="pi pi-check-circle" aria-hidden="true" /> clean run</span>
        <div class="wp-dbg-head__actions">
          <button
            type="button"
            class="wp-btn wp-btn--icon"
            :class="{ 'is-flashed': copyFlash }"
            data-test="dbg-copy"
            :title="copyFlash ? 'Copied' : 'Copy this tab as JSON'"
            aria-label="Copy JSON"
            @click="copyTab"
          ><i :class="['pi', copyFlash ? 'pi-check' : 'pi-copy']" /></button>
          <button
            type="button"
            class="wp-btn wp-btn--icon"
            data-test="dbg-download"
            title="Download the full snapshot as JSON"
            aria-label="Download snapshot JSON"
            @click="downloadJson"
          ><i class="pi pi-download" /></button>
        </div>
      </header>

      <nav class="wp-dbg-tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="tab"
          :class="['wp-dbg-tab', { 'is-active': activeTab === t.id }]"
          :aria-selected="activeTab === t.id"
          :data-test="`dbg-tab-${t.id}`"
          @click="activeTab = t.id"
        >
          {{ t.label }}
          <span
            v-if="t.count"
            class="wp-dbg-tab__badge"
            :class="{ [`is-${warnTone}`]: t.id === 'warnings' && warnTone }"
          >{{ t.count }}</span>
        </button>
        <span
          v-if="activeTab === 'vars' && model.negativeCount"
          class="wp-dbg-tabs__neg"
          data-test="dbg-neg-count"
          title="Variables that carry negative words"
        >{{ model.negativeCount }} negative{{ model.negativeCount === 1 ? "" : "s" }}</span>
        <div v-if="activeTab !== 'raw'" class="wp-dbg-filter">
          <i class="pi pi-search wp-dbg-filter__icon" aria-hidden="true" />
          <input
            v-model="filterQuery"
            type="text"
            class="wp-dbg-filter__input"
            data-test="dbg-filter"
            :placeholder="activeTab === 'vars' ? 'Filter variables…' : activeTab === 'trace' ? 'Filter steps…' : 'Filter warnings…'"
            aria-label="Filter"
            spellcheck="false"
          />
          <button
            v-if="filterQuery"
            type="button"
            class="wp-dbg-filter__clear"
            title="Clear filter"
            aria-label="Clear filter"
            @click="filterQuery = ''"
          ><i class="pi pi-times" aria-hidden="true" /></button>
        </div>
        <button
          v-if="activeTab === 'trace' && model.steps.length"
          type="button"
          class="wp-btn wp-btn--icon"
          data-test="dbg-expand-all"
          :title="allOpen ? 'Collapse every step' : 'Expand every step'"
          @click="toggleAll"
        ><i :class="['pi', allOpen ? 'pi-angle-double-up' : 'pi-angle-double-down']" /></button>
      </nav>

      <div class="wp-dbg-body">
        <template v-if="activeTab === 'vars'">
          <DebugVariables
            v-if="visibleVars.length"
            :rows="visibleVars"
            :pinned="pinned"
            :flashed="flashedVars"
            :uuid-to-name="uuidToName"
            :uuid-to-kind="uuidToKind"
            :ctx-active-key="ctxActiveKey"
            @goto-step="gotoStep"
            @row-menu="openVarMenu"
          />
          <div v-else class="wp-dbg-empty">
            <i class="pi pi-dollar wp-dbg-empty__icon" aria-hidden="true" />
            <span class="wp-dbg-empty__line">{{ q ? "No variable matches." : "No variables in this context." }}</span>
          </div>
        </template>

        <template v-else-if="activeTab === 'trace'">
          <p v-if="model.version < 2" class="wp-dbg-note" data-test="dbg-old-note">
            This snapshot is from an older version. Run the graph again to see branch results, odds and nested picks.
          </p>
          <DebugTrace
            v-if="visibleGroups.length"
            :groups="visibleGroups"
            :show-group-heads="showGroupHeads"
            :expanded="expanded"
            :pinned="pinned"
            :flash-key="flashKey"
            :warnings-by-step="warningsByStep"
            :uuid-to-name="uuidToName"
            :uuid-to-kind="uuidToKind"
            :node-info="nodeInfo"
            :can-focus="canFocus"
            :ctx-active-key="ctxActiveKey"
            @toggle="toggleStep"
            @goto-step="gotoStep"
            @row-menu="openStepMenu"
            @copy="(t: string) => { void clipboardWrite(t); }"
            @focus-node="focusNode"
          />
          <div v-else class="wp-dbg-empty">
            <i class="pi pi-bolt wp-dbg-empty__icon" aria-hidden="true" />
            <span class="wp-dbg-empty__line">{{ q ? "No step matches." : "No modules ran." }}</span>
          </div>
        </template>

        <template v-else-if="activeTab === 'warnings'">
          <DebugWarnings
            v-if="visibleWarnings.length"
            :rows="visibleWarnings"
            :steps-by-key="stepsByKey"
            :uuid-to-name="uuidToName"
            :uuid-to-kind="uuidToKind"
            @goto-step="gotoStep"
          />
          <div v-else class="wp-dbg-empty">
            <i class="pi pi-check-circle wp-dbg-empty__icon wp-dbg-empty__icon--ok" aria-hidden="true" />
            <span class="wp-dbg-empty__line">{{ q ? "No warning matches." : "No warnings." }}</span>
            <span v-if="!q" class="wp-dbg-empty__hint">Every reference and variable resolved.</span>
          </div>
        </template>

        <!-- eslint-disable-next-line vue/no-v-html -->
        <pre v-else class="wp-dbg-raw" v-html="rawHtml"></pre>
      </div>
    </template>

    <div v-else class="wp-dbg-empty wp-dbg-empty--prerun">
      <i class="pi pi-hourglass wp-dbg-empty__icon" aria-hidden="true" />
      <span class="wp-dbg-empty__line">No snapshot yet.</span>
      <span class="wp-dbg-empty__hint">Run the graph to see variables, the trace and warnings.</span>
    </div>

    <ContextMenu
      :visible="menu.visible"
      :x="menu.x"
      :y="menu.y"
      :items="menu.items"
      :header="menu.header"
      @close="closeMenu"
    />
  </div>
</template>

<style>
@import "../shared/theme.css";
/* `wp-row-flash` keyframes, shared with the Context / Injector widgets. */
@import "../shared/row-primitives.css";
</style>

<style scoped>
.wp-debug {
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  padding: 6px;
  color: var(--wp-text);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  transition: opacity var(--wp-motion-quick) ease;
  min-height: 0;
}
.wp-debug--skipped { opacity: 0.45; }

.wp-dbg-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 2px 6px;
  font-size: 11px;
  color: var(--wp-text-dim);
}
.wp-dbg-head__seed {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 3px);
  color: var(--wp-text);
  font: 500 11px/1.7 var(--wp-font-mono);
  padding: 0 7px;
  cursor: pointer;
}
.wp-dbg-head__seed .pi { font-size: 9px; color: var(--wp-text-dim); }
.wp-dbg-head__seed-label { font-family: var(--wp-font-sans); color: var(--wp-text-dim); }
.wp-dbg-head__seed:hover { border-color: var(--wp-border-strong, var(--wp-accent)); }
.wp-dbg-head__seed.is-flashed { border-color: var(--wp-green); }
.wp-dbg-head__seed.is-flashed .pi { color: var(--wp-green); }
.wp-dbg-head__stat { white-space: nowrap; }
.wp-dbg-head__warn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 999px;
  padding: 2px 8px;
  font: 600 10.5px/1.5 var(--wp-font-sans);
  cursor: pointer;
  color: var(--wp-warn);
  background: color-mix(in oklab, var(--wp-warn) 15%, transparent);
}
.wp-dbg-head__warn .pi { font-size: 9px; }
.wp-dbg-head__warn.is-error { color: var(--wp-red, #e5484d); background: color-mix(in oklab, var(--wp-red, #e5484d) 15%, transparent); }
.wp-dbg-head__warn.is-info { color: var(--wp-info, var(--wp-accent)); background: color-mix(in oklab, var(--wp-info, var(--wp-accent)) 15%, transparent); }
.wp-dbg-head__ok { display: inline-flex; align-items: center; gap: 4px; color: var(--wp-green); }
.wp-dbg-head__ok .pi { font-size: 10px; }
.wp-dbg-head__actions { margin-left: auto; display: flex; gap: 2px; }

.wp-dbg-iter { display: inline-flex; align-items: center; gap: 2px; }
.wp-dbg-iter__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--wp-text-muted);
  cursor: pointer;
  padding: 0;
}
.wp-dbg-iter__btn .pi { font-size: 9px; }
.wp-dbg-iter__btn:hover:not(:disabled) { color: var(--wp-text); border-color: var(--wp-border); }
.wp-dbg-iter__btn:disabled { opacity: 0.3; cursor: not-allowed; }
.wp-dbg-iter__label { font: 500 10.5px/1 var(--wp-font-mono); color: var(--wp-text-muted); min-width: 64px; text-align: center; }

.wp-dbg-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  border-bottom: 1px solid var(--wp-border);
}
.wp-dbg-tab {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font: 500 11px/1 var(--wp-font-sans);
  color: var(--wp-text-muted);
  padding: 7px 9px 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.wp-dbg-tab:hover { color: var(--wp-text); }
.wp-dbg-tab.is-active { color: var(--wp-text); border-bottom-color: var(--wp-accent); }
.wp-dbg-tab__badge {
  font: 600 9px/1 var(--wp-font-mono);
  padding: 2px 4px;
  border-radius: 6px;
  background: var(--wp-bg-deep, var(--wp-bg));
  color: var(--wp-text-dim);
}
.wp-dbg-tab__badge.is-warning { background: color-mix(in oklab, var(--wp-warn) 22%, transparent); color: var(--wp-warn); }
.wp-dbg-tab__badge.is-error { background: color-mix(in oklab, var(--wp-red, #e5484d) 22%, transparent); color: var(--wp-red, #e5484d); }
.wp-dbg-tabs__neg {
  margin-left: auto;
  font: 600 9.5px/1 var(--wp-font-mono);
  padding: 3px 6px;
  border-radius: 4px;
  white-space: nowrap;
  background: var(--wp-red-bg, color-mix(in oklab, var(--wp-red, #e5484d) 15%, transparent));
  color: var(--wp-red, #e5484d);
}
.wp-dbg-tabs__neg + .wp-dbg-filter { margin-left: 6px; }
.wp-dbg-tab__badge.is-info { background: color-mix(in oklab, var(--wp-info, var(--wp-accent)) 22%, transparent); color: var(--wp-info, var(--wp-accent)); }

.wp-dbg-filter {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  padding: 0 6px;
  height: 22px;
  box-sizing: border-box;
  width: 150px;
  margin-bottom: 3px;
}
.wp-dbg-filter:focus-within { border-color: var(--wp-accent); }
.wp-dbg-filter__icon { font-size: 9px; color: var(--wp-text-dim); }
.wp-dbg-filter__input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--wp-text);
  font: 500 11px var(--wp-font-sans);
}
.wp-dbg-filter__input::placeholder { color: var(--wp-text-dim); }
.wp-dbg-filter__clear { background: transparent; border: 0; color: var(--wp-text-dim); cursor: pointer; padding: 0; }
.wp-dbg-filter__clear .pi { font-size: 9px; }

.wp-btn--icon {
  background: transparent;
  border: 1px solid transparent;
  color: var(--wp-text-dim);
  padding: 4px;
  border-radius: var(--wp-radius, 4px);
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}
.wp-btn--icon:hover { background: var(--wp-bg2); border-color: var(--wp-border-soft, var(--wp-border2)); color: var(--wp-text); }
.wp-btn--icon.is-flashed { border-color: var(--wp-green); color: var(--wp-green); }
.wp-btn--icon .pi { font-size: 11px; }

.wp-dbg-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-top: 4px;
}
.wp-dbg-note {
  margin: 2px 0 6px;
  padding: 5px 8px;
  border-radius: var(--wp-radius-sm, 3px);
  background: color-mix(in oklab, var(--wp-info, var(--wp-accent)) 12%, transparent);
  color: var(--wp-text-muted);
  font-size: 11px;
}
.wp-dbg-raw {
  margin: 0;
  font: 11px/1.5 var(--wp-font-mono);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--wp-text);
}
.wp-dbg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 16px;
  text-align: center;
}
.wp-dbg-empty--prerun { margin: auto 0; }
.wp-dbg-empty__icon { font-size: 26px; color: color-mix(in srgb, var(--wp-accent) 65%, var(--wp-text3)); opacity: 0.65; }
.wp-dbg-empty__icon--ok { color: var(--wp-green); }
.wp-dbg-empty__line { font-weight: 600; color: var(--wp-text-muted); }
.wp-dbg-empty__hint { font-size: 11px; color: var(--wp-text-dim); }

/* JSON highlight tokens (see highlight.ts). */
.wp-dbg-raw :deep(.wp-jh-k) { color: var(--wp-accent); }
.wp-dbg-raw :deep(.wp-jh-s) { color: var(--wp-amber); }
.wp-dbg-raw :deep(.wp-jh-n) { color: var(--wp-green); }
.wp-dbg-raw :deep(.wp-jh-b) { color: var(--wp-violet, #b48aff); font-weight: 600; }
.wp-dbg-raw :deep(.wp-jh-p) { color: var(--wp-text-dim, var(--wp-text3)); }
</style>
