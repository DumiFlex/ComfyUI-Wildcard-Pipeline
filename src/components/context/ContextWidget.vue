<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import {
  parseWidgetJsonWithRecovery, serializeWidgetJson,
  emptyContextValue, newModuleId,
  type ContextWidgetValue, type ModuleEntry,
} from "../../widgets/_shared";
import { scanConflicts, type Conflict } from "../../extension/conflicts";
import ModulePickerModal from "./ModulePickerModal.vue";
import ModuleEditModal from "./ModuleEditModal.vue";
import ContextMenu, { type ContextMenuItem } from "../shared/ContextMenu.vue";
import Logo from "../shared/Logo.vue";
import { dragState } from "./drag-store";
import { pushToast } from "../shared/toast-store";

const props = defineProps<{
  nodeId: number;
  initialJson: string;
  upstreamVars: string[];
  onChange: (json: string) => void;
}>();

const dragOverId = ref<string | null>(null);
const dragOverEnd = ref(false);

const ctxMenu = ref<{ visible: boolean; x: number; y: number; items: ContextMenuItem[] }>({
  visible: false,
  x: 0,
  y: 0,
  items: [],
});

const editingId = ref<string | null>(null);
const editingModule = computed<ModuleEntry | null>(() =>
  value.value.modules.find((m) => m.id === editingId.value) ?? null,
);

// Variable names defined in OTHER modules of this same node — used by the
// edit modal's autocomplete + per-entry validity. Exclude the module being
// edited so its own (in-flight) names don't echo back as suggestions.
const siblingNodeVars = computed<string[]>(() => {
  const names = new Set<string>();
  for (const m of value.value.modules) {
    if (m.id === editingId.value) continue;
    if (!m.enabled) continue;
    for (const e of m.entries) {
      const n = e.variable_name.trim();
      if (n) names.add(n);
    }
  }
  return [...names];
});

function clearDragHover() {
  if (dragOverId.value === null && !dragOverEnd.value) return;
  dragOverId.value = null;
  dragOverEnd.value = false;
}

onMounted(() => window.addEventListener("dragend", clearDragHover));
onBeforeUnmount(() => {
  window.removeEventListener("dragend", clearDragHover);
  if (dragState.value?.sourceNodeId === props.nodeId) dragState.value = null;
});

watch(dragState, (v) => { if (v === null) clearDragHover(); });

// Initial parse runs through the recovery path so we can flag bad workflow
// JSON instead of silently swallowing it. parseWidgetJson stays exported for
// the debug/assembler widgets which don't need recovery semantics.
const initialParse = parseWidgetJsonWithRecovery(props.initialJson, emptyContextValue());
const value = ref<ContextWidgetValue>(initialParse.value);
const parseError = ref<string | null>(initialParse.error);
const parseRaw = ref<string>(initialParse.raw);
const showRaw = ref(false);
const showPicker = ref(false);

// 4.5 — animated arrow on first run. Persists dismissal across reloads via
// localStorage so the hint never re-appears once the user has clicked into
// the picker.
const FIRST_RUN_KEY = "wp:hint:first-add";
const firstRunHintDismissed = ref<boolean>(
  typeof window !== "undefined" && window.localStorage?.getItem(FIRST_RUN_KEY) === "dismissed",
);
function dismissFirstRunHint() {
  if (firstRunHintDismissed.value) return;
  firstRunHintDismissed.value = true;
  // Wrapped — Safari private mode + locked-down iframes can throw on writes.
  try { window.localStorage?.setItem(FIRST_RUN_KEY, "dismissed"); } catch { /* ignore */ }
}

function openPicker() {
  dismissFirstRunHint();
  showPicker.value = true;
}

// Populated vs. empty page swap is driven by a wrapper <Transition
// mode="out-in"> below. mode="out-in" sequences populated→empty cleanly:
// the populated block fades out fully BEFORE the empty hero fades in, so
// the leaving card and the appearing hero never visually stack.
const isEmpty = computed(() => value.value.modules.length === 0);

function resetCorruptValue() {
  // User confirmed reset — replace with empty + clear the recovery panel.
  // The deep-watcher will fire onChange so the workflow JSON is rewritten.
  parseError.value = null;
  showRaw.value = false;
  value.value = emptyContextValue();
  pushToast("Workflow data reset to empty.", { severity: "info", lifeMs: 4000 });
}

function isCollapsed(m: ModuleEntry): boolean {
  return m.collapsed === true;
}

let suppressWatch = false;
watch(value, (v) => {
  if (suppressWatch) { suppressWatch = false; return; }
  props.onChange(serializeWidgetJson(v));
}, { deep: true });

watch(() => props.initialJson, (raw) => {
  // Reuse the recovery-aware parser so a workflow loaded with corrupt JSON
  // surfaces the same panel as a node that was already corrupt at mount.
  const next = parseWidgetJsonWithRecovery(raw, emptyContextValue());
  parseError.value = next.error;
  parseRaw.value = next.raw;
  if (serializeWidgetJson(next.value) === serializeWidgetJson(value.value)) return;
  suppressWatch = true;
  value.value = next.value;
});

const conflicts = computed<Conflict[]>(() => {
  // Disabled modules don't ship to runtime; skip them in the scan so they
  // don't generate phantom shadows_upstream / duplicate_variable warnings.
  const enabledOnly: ContextWidgetValue = {
    ...value.value,
    modules: value.value.modules.filter((m) => m.enabled),
  };
  return scanConflicts(enabledOnly, props.upstreamVars);
});
const conflictsByModule = computed(() => {
  const out: Record<string, Conflict[]> = {};
  for (const c of conflicts.value) (out[c.moduleId] ??= []).push(c);
  return out;
});

function severityFor(id: string): "error" | "warning" | "info" | null {
  const list = conflictsByModule.value[id];
  if (!list?.length) return null;
  if (list.some((c) => c.severity === "error")) return "error";
  if (list.some((c) => c.severity === "warning")) return "warning";
  return "info";
}

function conflictTooltip(id: string): string {
  const list = conflictsByModule.value[id];
  if (!list?.length) return "";
  return list.map((c) => `${labelFor(c.type)}: $${c.variable}`).join("\n");
}

function labelFor(type: string): string {
  if (type === "shadows_upstream") return "overrides upstream";
  if (type === "duplicate_variable") return "duplicate";
  if (type === "missing_template_variable") return "missing variable";
  return type;
}

// Type-icon mapping per the brand sheet. Forward-compatible with P5+ types.
// Color comes from the matching `.type-X` CSS class on .wp-type-icon.
function iconFor(type: ModuleEntry["type"]): string {
  if (type === "fixed_values") return "pi-tag";
  return "pi-question";
}

function summaryFor(m: ModuleEntry): string {
  const named = m.entries.filter((e) => e.variable_name.trim() !== "");
  if (named.length === 0) return "(empty)";
  const heads = named.slice(0, 2).map((e) => `$${e.variable_name}`);
  const more = named.length - heads.length;
  return more > 0 ? `${heads.join(", ")}, +${more} more` : heads.join(", ");
}

function addModule(type: "fixed_values") {
  const m: ModuleEntry = {
    id: newModuleId(),
    type,
    enabled: true,
    meta: { name: "fixed values", description: "", tags: [] },
    entries: [{ variable_name: "", value: "" }],
  };
  value.value = { ...value.value, modules: [...value.value.modules, m] };
  showPicker.value = false;
  // Open the editor immediately so the user lands in the entry editor.
  editingId.value = m.id;
}

function removeModule(id: string) {
  // Soft-delete: capture position + module, drop a toast with Undo. Undo
  // splices it back at its original index. After 5s the toast auto-dismisses
  // and the deletion is permanent.
  const idx = value.value.modules.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const removed = value.value.modules[idx];
  const moduleLabel = removed.meta.name?.trim() || "module";
  value.value = { ...value.value, modules: value.value.modules.filter((m) => m.id !== id) };
  pushToast(`Removed “${moduleLabel}”`, {
    severity: "info",
    action: {
      label: "Undo",
      onSelect: () => {
        const list = [...value.value.modules];
        list.splice(Math.min(idx, list.length), 0, removed);
        value.value = { ...value.value, modules: list };
      },
    },
  });
}

function duplicateModule(id: string) {
  const list = [...value.value.modules];
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return;
  // JSON round-trip is Proxy-safe at every depth (toRaw only unwraps the
  // immediate object — nested Proxies in m.entries still throw structuredClone).
  const copy: ModuleEntry = JSON.parse(JSON.stringify(list[i]));
  copy.id = newModuleId();
  copy.meta = { ...copy.meta, name: `${copy.meta.name} (copy)` };
  list.splice(i + 1, 0, copy);
  value.value = { ...value.value, modules: list };
  pushToast(`Duplicated “${list[i].meta.name?.trim() || "module"}”`, {
    severity: "success",
    lifeMs: 3000,
    action: {
      label: "Undo",
      onSelect: () => {
        value.value = { ...value.value, modules: value.value.modules.filter((m) => m.id !== copy.id) };
      },
    },
  });
}

function moveToEdge(id: string, edge: "top" | "bottom") {
  const list = [...value.value.modules];
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return;
  const [m] = list.splice(i, 1);
  if (edge === "top") list.unshift(m);
  else list.push(m);
  value.value = { ...value.value, modules: list };
}

function toggleEnabled(id: string) {
  const list = value.value.modules.map((m) => m.id !== id ? m : { ...m, enabled: !m.enabled });
  value.value = { ...value.value, modules: list };
}

function toggleCollapsed(id: string) {
  const list = value.value.modules.map((m) => m.id !== id ? m : { ...m, collapsed: !m.collapsed });
  value.value = { ...value.value, modules: list };
}

function openEditModal(id: string) {
  editingId.value = id;
}

function saveEditedModule(updated: ModuleEntry) {
  const list = value.value.modules.map((m) => m.id === updated.id ? updated : m);
  value.value = { ...value.value, modules: list };
  editingId.value = null;
}

function onCardKeydown(ev: KeyboardEvent, m: ModuleEntry) {
  // Don't intercept keys when focus is inside an input/textarea inside the
  // card (none today, but defense in depth for future inline controls).
  const target = ev.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

  // Ctrl/Cmd+D — duplicate focused module
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "d") {
    ev.preventDefault();
    duplicateModule(m.id);
    return;
  }

  // Shift+ArrowUp / Shift+ArrowDown — reorder
  if (ev.shiftKey && ev.key === "ArrowUp") {
    ev.preventDefault();
    moveModule(m.id, -1);
    return;
  }
  if (ev.shiftKey && ev.key === "ArrowDown") {
    ev.preventDefault();
    moveModule(m.id, 1);
    return;
  }

  // Enter — open edit modal (matches the context menu's primary action)
  if (ev.key === "Enter") {
    ev.preventDefault();
    openEditModal(m.id);
    return;
  }

  // Delete — remove module
  if (ev.key === "Delete") {
    ev.preventDefault();
    removeModule(m.id);
    return;
  }
}

function moveModule(id: string, dir: -1 | 1) {
  const list = [...value.value.modules];
  const i = list.findIndex((m) => m.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  value.value = { ...value.value, modules: list };
  // Vue reorders the DOM by detach+reattach even with :key; focus is dropped.
  // Refocus the moved card after the patch flushes.
  nextTick(() => {
    const el = document.querySelector<HTMLElement>(`.wp-module[data-module-id="${id}"]`);
    el?.focus();
  });
}

function onContextRootContextMenu(ev: MouseEvent) {
  // Right-click on the wp-context background (NOT on a module card) opens a
  // shortcut menu with "+ Add module". Prevents ComfyUI's native canvas
  // context menu from interfering since this widget already owns the area.
  // If the click landed on a child module card, that card's @contextmenu has
  // already fired and stopped propagation via @contextmenu.prevent — this
  // only fires for the bare-area case.
  const target = ev.target as HTMLElement;
  if (target.closest(".wp-module")) return;
  ev.preventDefault();
  const estW = 180;
  const estH = 60;
  const x = Math.min(ev.clientX, window.innerWidth - estW - 8);
  const y = Math.min(ev.clientY, window.innerHeight - estH - 8);
  ctxMenu.value = {
    visible: true,
    x: Math.max(8, x),
    y: Math.max(8, y),
    items: [
      { label: "Add module", icon: "pi-plus", onSelect: () => { showPicker.value = true; } },
    ],
  };
}

function openContextMenu(ev: MouseEvent, m: ModuleEntry) {
  const list = value.value.modules;
  const i = list.findIndex((x) => x.id === m.id);
  const estW = 180;
  const estH = 220;
  const x = Math.min(ev.clientX, window.innerWidth - estW - 8);
  const y = Math.min(ev.clientY, window.innerHeight - estH - 8);
  ctxMenu.value = {
    visible: true,
    x: Math.max(8, x),
    y: Math.max(8, y),
    items: [
      { label: "Edit", icon: "pi-pencil", onSelect: () => openEditModal(m.id) },
      { label: m.enabled ? "Disable" : "Enable", icon: m.enabled ? "pi-eye-slash" : "pi-eye", onSelect: () => toggleEnabled(m.id) },
      { label: m.collapsed ? "Expand" : "Collapse", icon: m.collapsed ? "pi-chevron-down" : "pi-chevron-right", onSelect: () => toggleCollapsed(m.id) },
      { label: "Duplicate", icon: "pi-clone", onSelect: () => duplicateModule(m.id), divider: true },
      { label: "Move to top", icon: "pi-angle-double-up", disabled: i === 0, onSelect: () => moveToEdge(m.id, "top") },
      { label: "Move to bottom", icon: "pi-angle-double-down", disabled: i === list.length - 1, onSelect: () => moveToEdge(m.id, "bottom") },
      { label: "Delete", icon: "pi-trash", danger: true, divider: true, onSelect: () => removeModule(m.id) },
    ],
  };
}

// ── Drag-and-drop ───────────────────────────────────────────────────────
function onDragStart(ev: DragEvent, mod: ModuleEntry) {
  dragState.value = { sourceNodeId: props.nodeId, module: JSON.parse(JSON.stringify(mod)) };
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", mod.id);
  }
}

function onDragEnd() {
  const ds = dragState.value;
  if (ds && ds.sourceNodeId === props.nodeId && !sameNodeDropHandled) {
    if (ds.consumedBy != null && ds.consumedBy !== props.nodeId) {
      value.value = { ...value.value, modules: value.value.modules.filter((m) => m.id !== ds.module.id) };
    }
  }
  dragState.value = null;
  sameNodeDropHandled = false;
  dragOverId.value = null;
  dragOverEnd.value = false;
}

let sameNodeDropHandled = false;

function onDragEnter(ev: DragEvent, targetId: string | null) {
  if (!dragState.value) return;
  ev.preventDefault();
  if (targetId === null) {
    dragOverId.value = null;
    dragOverEnd.value = true;
  } else {
    dragOverId.value = targetId;
    dragOverEnd.value = false;
  }
}

function onDragOver(ev: DragEvent) {
  if (!dragState.value) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
}

function onContainerLeave(ev: DragEvent) {
  const container = ev.currentTarget as HTMLElement;
  const next = ev.relatedTarget as Node | null;
  if (next && container.contains(next)) return;
  clearDragHover();
}

function onDrop(ev: DragEvent, targetId: string | null) {
  ev.preventDefault();
  ev.stopPropagation();
  const ds = dragState.value;
  if (!ds) return;
  dragOverId.value = null;
  dragOverEnd.value = false;

  if (ds.sourceNodeId === props.nodeId) {
    const list = [...value.value.modules];
    const fromIdx = list.findIndex((m) => m.id === ds.module.id);
    if (fromIdx < 0) return;
    list.splice(fromIdx, 1);
    const insertIdx = targetId === null ? list.length : list.findIndex((m) => m.id === targetId);
    list.splice(insertIdx < 0 ? list.length : insertIdx, 0, ds.module);
    value.value = { ...value.value, modules: list };
    sameNodeDropHandled = true;
    return;
  }

  const inserted: ModuleEntry = { ...ds.module, id: newModuleId() };
  const list = [...value.value.modules];
  const insertIdx = targetId === null ? list.length : list.findIndex((m) => m.id === targetId);
  list.splice(insertIdx < 0 ? list.length : insertIdx, 0, inserted);
  value.value = { ...value.value, modules: list };
  dragState.value = { ...ds, consumedBy: props.nodeId };
}
</script>

<template>
  <div class="wp-context" @dragleave="onContainerLeave" @contextmenu="onContextRootContextMenu">
    <!-- Corrupt-workflow recovery panel (5.6). Surfaces when JSON parse fails
         or returns a non-object. View raw exposes the bad payload so users
         can copy it out before resetting. -->
    <div v-if="parseError" class="wp-recovery" role="alert">
      <div class="wp-recovery__header">
        <i class="pi pi-exclamation-triangle wp-recovery__icon" aria-hidden="true"></i>
        <div class="wp-recovery__msg">
          <strong>Couldn't read this node's saved data.</strong>
          <div class="wp-recovery__detail">{{ parseError }}</div>
        </div>
      </div>
      <div class="wp-recovery__actions">
        <button type="button" class="wp-recovery__btn" @click="showRaw = !showRaw">
          <i class="pi" :class="showRaw ? 'pi-eye-slash' : 'pi-eye'" aria-hidden="true"></i>
          {{ showRaw ? "Hide raw" : "View raw" }}
        </button>
        <button
          type="button"
          class="wp-recovery__btn wp-recovery__btn--danger"
          @click="resetCorruptValue"
        >
          <i class="pi pi-refresh" aria-hidden="true"></i>
          Reset to empty
        </button>
      </div>
      <pre v-if="showRaw" class="wp-recovery__raw">{{ parseRaw }}</pre>
    </div>

    <!-- Page swap: populated layout vs empty hero. mode="out-in" sequences
         them — the populated block fully fades out before the empty hero
         fades in, so the leaving card and the appearing hero never visually
         stack. Recovery panel + drop-zone live outside the swap. -->
    <Transition name="wp-page" mode="out-in">
      <div v-if="!isEmpty" key="populated" class="wp-page">
        <!-- Section label matches AssemblerHelper "VARIABLES" / "PREVIEW"
             and picker section labels for visual consistency. -->
        <div class="wp-section-label">
          <i class="pi pi-th-large wp-section-label__icon" aria-hidden="true"></i>
          Modules
          <!-- Hide count when 0 — during the populated→empty Transition the
               array is already empty but this block is still rendering its
               last patched state during the fade-out. -->
          <span
            v-if="value.modules.length > 0"
            class="wp-section-label__count"
          >{{ value.modules.length }}</span>
        </div>

        <TransitionGroup name="wp-list" tag="div" class="wp-modules">
      <div
        v-for="m in value.modules"
        :key="m.id"
        :data-module-id="m.id"
        class="wp-module"
        tabindex="0"
        :class="{
          'wp-disabled': !m.enabled,
          'wp-conflict-error': severityFor(m.id) === 'error',
          'wp-conflict-warning': severityFor(m.id) === 'warning',
          'wp-conflict-info': severityFor(m.id) === 'info',
          'wp-drop-target': dragOverId === m.id,
        }"
        @dragenter="(ev) => onDragEnter(ev, m.id)"
        @dragover="onDragOver"
        @drop="(ev) => onDrop(ev, m.id)"
        @contextmenu.stop.prevent="(ev) => openContextMenu(ev, m)"
        @keydown="(ev) => onCardKeydown(ev, m)"
      >
        <div class="wp-module-header">
          <span
            class="wp-drag-handle"
            draggable="true"
            title="Drag to reorder (drop on another node to move)"
            @dragstart="(ev) => onDragStart(ev, m)"
            @dragend="onDragEnd"
          ><i class="pi pi-bars" aria-hidden="true"></i></span>

          <button
            type="button"
            class="wp-collapse-btn"
            :title="isCollapsed(m) ? 'Expand' : 'Collapse'"
            @click="toggleCollapsed(m.id)"
          ><i :class="['pi', isCollapsed(m) ? 'pi-chevron-right' : 'pi-chevron-down']" aria-hidden="true"></i></button>

          <label class="wp-toggle" :title="m.enabled ? 'Disable' : 'Enable'">
            <input
              type="checkbox"
              :checked="m.enabled"
              :aria-label="`enable ${m.meta.name}`"
              @change="toggleEnabled(m.id)"
            />
            <span class="wp-toggle-mark"></span>
          </label>

          <i
            :class="['pi', iconFor(m.type), 'wp-type-icon', `type-${m.type}`]"
            :title="m.type"
            aria-hidden="true"
          ></i>

          <span class="wp-module-name" :title="m.meta.name || '(unnamed)'">
            {{ m.meta.name || "(unnamed)" }}
          </span>

          <span
            v-if="severityFor(m.id)"
            class="wp-conflict-dot"
            :class="`wp-conflict-dot--${severityFor(m.id)}`"
            :title="conflictTooltip(m.id)"
            aria-hidden="true"
          ></span>

          <button
            type="button"
            aria-label="remove"
            title="Remove module"
            class="wp-icon-btn wp-delete"
            @click="removeModule(m.id)"
          ><i class="pi pi-times" aria-hidden="true"></i></button>
        </div>

        <Transition name="wp-collapse">
          <div v-if="!isCollapsed(m)" class="wp-summary" :title="summaryFor(m)">
            {{ summaryFor(m) }}
          </div>
        </Transition>
      </div>
        </TransitionGroup>

        <button
          type="button"
          class="wp-add-btn"
          data-testid="open-picker"
          @click="openPicker"
        >+ add module</button>
      </div>

      <!-- Empty-state hero (2.3) — shown when modules is empty and there's
           no recovery panel up. Brand language matches the picker modal:
           Logo + plain title + body + gradient CTA. -->
      <div
        v-else-if="!parseError"
        key="empty"
        class="wp-emptystate"
      >
        <div class="wp-emptystate__logo">
          <Logo :size="40" />
        </div>
        <div class="wp-emptystate__title">Wildcard Pipeline</div>
        <div class="wp-emptystate__body">
          Compose prompt fragments as modules. Reference them in your template
          with <code>$variable</code>.
        </div>
        <!-- 4.5 — first-run hint, dismissed permanently after first click. -->
        <div v-if="!firstRunHintDismissed" class="wp-firstrun-hint" aria-hidden="true">
          <span class="wp-firstrun-hint__caption">Start here</span>
          <i class="pi pi-arrow-down wp-firstrun-hint__arrow"></i>
        </div>
        <button
          type="button"
          class="wp-emptystate__cta"
          data-testid="open-picker"
          @click="openPicker"
        >
          <i class="pi pi-plus" aria-hidden="true"></i>
          Add your first module
        </button>
      </div>
    </Transition>

    <div
      class="wp-drop-end"
      :class="{ 'wp-drop-end--active': dragOverEnd, 'wp-drop-end--show': dragState !== null }"
      @dragenter="(ev) => onDragEnter(ev, null)"
      @dragover="onDragOver"
      @drop="(ev) => onDrop(ev, null)"
    >Drop here</div>

    <ModulePickerModal
      :visible="showPicker"
      @select="addModule"
      @close="showPicker = false"
    />

    <ModuleEditModal
      :visible="editingModule !== null"
      :module="editingModule"
      :upstream-vars="upstreamVars"
      :sibling-vars="siblingNodeVars"
      @save="saveEditedModule"
      @close="editingId = null"
    />

    <ContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      @close="ctxMenu.visible = false"
    />
  </div>
</template>

<style>
@import "../shared/theme.css";
</style>

<style scoped>
.wp-context, .wp-context * { box-sizing: border-box; }
.wp-context {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
  cursor: default;
}

.wp-modules {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Populated ↔ Empty page swap ───────────────────────────────────────
 * Wraps both the populated layout (section label + cards + small add btn)
 * and the empty hero. mode="out-in" on the parent <Transition> sequences
 * the swap: populated fades out fully BEFORE empty fades in, so removing
 * the last module never causes the leaving card to stack visually with
 * the appearing hero. */
.wp-page { display: flex; flex-direction: column; gap: 6px; }
.wp-page-enter-active,
.wp-page-leave-active {
  transition: opacity 0.18s ease;
}
.wp-page-enter-from,
.wp-page-leave-to {
  opacity: 0;
}

/* ── Corrupt-workflow recovery (5.6) ──────────────────────────────────── */
.wp-recovery {
  background: rgba(248, 113, 113, 0.06);
  border: 1px solid var(--wp-red);
  border-radius: var(--wp-radius-sm);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wp-recovery__header { display: flex; gap: 8px; align-items: flex-start; }
.wp-recovery__icon {
  color: var(--wp-red);
  font-size: 14px;
  padding-top: 2px;
  flex-shrink: 0;
}
.wp-recovery__msg { flex: 1; min-width: 0; }
.wp-recovery__msg strong {
  color: var(--wp-text);
  font-size: 12px;
  display: block;
}
.wp-recovery__detail {
  color: var(--wp-text2);
  font-size: 11px;
  font-family: var(--wp-font-mono, monospace);
  margin-top: 2px;
  word-break: break-word;
}
.wp-recovery__actions { display: flex; gap: 6px; }
.wp-recovery__btn {
  flex: 1;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text2);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.wp-recovery__btn:hover {
  background: var(--wp-bg4);
  border-color: var(--wp-border2);
  color: var(--wp-text);
}
.wp-recovery__btn--danger {
  color: var(--wp-red);
  border-color: var(--wp-red);
}
.wp-recovery__btn--danger:hover {
  background: rgba(248, 113, 113, 0.12);
  color: var(--wp-red);
}
.wp-recovery__raw {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 6px 8px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 10px;
  color: var(--wp-text3);
  max-height: 120px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ── Section label (matches assembler + picker) ──────────────────────── */
.wp-section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--wp-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text3);
  padding: 0 2px;
  margin-top: 2px;
}
.wp-section-label__icon {
  font-size: 10px;
  color: var(--wp-violet);
}
.wp-section-label__count {
  margin-left: auto;
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--wp-violet-bg);
  color: var(--wp-violet);
  letter-spacing: 0;
}

/* ── Empty-state hero (2.3) + first-run hint (4.5) ──────────────────────
 * Restrained to match the picker modal — plain title, body, gradient
 * action button. Same visual restraint principle as picker so the
 * transition empty → populated is smooth, not jarring. */
.wp-emptystate {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 16px 12px 12px;
  gap: 6px;
  /* Fade-in is handled by the outer .wp-page Transition (mode="out-in"),
   * so no element-local keyframe is needed here. */
}
.wp-emptystate__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
}
.wp-emptystate__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--wp-text);
  letter-spacing: 0.01em;
}
.wp-emptystate__body {
  font-size: 11px;
  color: var(--wp-text2);
  max-width: 240px;
  line-height: 1.5;
  margin-bottom: 2px;
}
.wp-emptystate__body code {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: var(--wp-radius-sm);
  background: var(--wp-violet-bg);
  color: var(--wp-violet);
}
.wp-firstrun-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--wp-violet);
  font-size: 10px;
  font-family: var(--wp-font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  gap: 1px;
  animation: wp-bob 1.4s ease-in-out infinite;
}
.wp-firstrun-hint__arrow { font-size: 12px; line-height: 1; }
@keyframes wp-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(3px); }
}
.wp-emptystate__cta {
  background: var(--wp-brand-gradient);
  border: none;
  border-radius: var(--wp-radius-sm);
  color: #fff;
  font-family: var(--wp-font-sans);
  font-size: 12px;
  font-weight: 600;
  padding: 9px 18px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  letter-spacing: 0.02em;
  /* Dimmed at rest; hover lifts to full brand saturation. */
  filter: brightness(0.82) saturate(0.85);
  transition: filter 0.15s;
}
.wp-emptystate__cta:hover { filter: brightness(1) saturate(1); }
.wp-emptystate__cta:focus-visible {
  outline: 2px solid var(--wp-violet);
  outline-offset: 2px;
}

.wp-module {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: background-color 0.15s, border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
.wp-module:hover {
  border-color: var(--wp-border2);
  background: var(--wp-bg4);
}
.wp-module:focus {
  outline: none;
  border-color: var(--wp-accent);
  box-shadow: 0 0 0 1px var(--wp-accent);
}
.wp-module:focus-visible {
  outline: none;
  border-color: var(--wp-accent);
  box-shadow: 0 0 0 2px var(--wp-accent-glow);
}
.wp-module.wp-disabled {
  opacity: 0.55;
  background: repeating-linear-gradient(
    45deg,
    var(--wp-bg3),
    var(--wp-bg3) 6px,
    var(--wp-bg2) 6px,
    var(--wp-bg2) 8px
  );
}
.wp-module.wp-disabled .wp-module-name { color: var(--wp-text3); }

.wp-module.wp-conflict-info { border-color: var(--wp-accent); }
.wp-module.wp-conflict-warning { border-color: var(--wp-amber); }
.wp-module.wp-conflict-error { border-color: var(--wp-red); }
.wp-module.wp-drop-target {
  border-color: var(--wp-accent);
  box-shadow: inset 0 2px 0 var(--wp-accent);
}

.wp-module-header { display: flex; align-items: center; gap: 6px; }

.wp-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  color: var(--wp-text3);
  font-size: 11px;
  line-height: 1;
  user-select: none;
  width: 14px;
  flex-shrink: 0;
  /* Stay subtle on idle cards; reveal on hover/focus so the chrome isn't
   * noisy in lists with many modules. */
  opacity: 0.35;
  transition: opacity 0.15s, color 0.15s, transform 0.15s;
}
.wp-module:hover .wp-drag-handle,
.wp-module:focus-within .wp-drag-handle {
  opacity: 1;
}
.wp-drag-handle:hover {
  color: var(--wp-text);
  transform: translateX(-1px);
}
.wp-drag-handle:active { cursor: grabbing; }

.wp-collapse-btn {
  background: none;
  border: none;
  color: var(--wp-text3);
  cursor: pointer;
  font-size: 10px;
  padding: 0;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
}
.wp-collapse-btn:hover { color: var(--wp-text); }

.wp-toggle { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.wp-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.wp-toggle-mark {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid var(--wp-border2);
  background: var(--wp-bg2);
  transition: all 0.15s;
}
.wp-toggle input:checked + .wp-toggle-mark { background: var(--wp-accent); border-color: var(--wp-accent); }
.wp-toggle input:focus-visible + .wp-toggle-mark {
  /* Distinct from accent so the ring stays visible whether the toggle is
   * on (accent fill) or off (transparent fill). */
  box-shadow: 0 0 0 2px var(--wp-violet);
}

/* Type icon — colored per type so users scan-recognize the module type */
.wp-type-icon {
  font-size: 12px;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}
.wp-type-icon.type-fixed_values { color: var(--wp-rose); }

.wp-module-name {
  flex: 1;
  font-size: 12px;
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.wp-conflict-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: help;
}
.wp-conflict-dot--info { background: var(--wp-accent); }
.wp-conflict-dot--warning { background: var(--wp-amber); }
.wp-conflict-dot--error { background: var(--wp-red); }

.wp-icon-btn {
  background: none;
  border: none;
  color: var(--wp-text3);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  line-height: 1;
}
.wp-icon-btn:hover { color: var(--wp-text); }
.wp-icon-btn.wp-delete:hover { color: var(--wp-red); }

/* Summary line — read-only preview. Edit via right-click → Edit (or Enter
 * on focused card). Keeping the card chrome non-interactive avoids
 * competing click affordances inside the small DOM widget. */
.wp-summary {
  color: var(--wp-text2);
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 2px 4px 2px 36px;  /* align under the module name (past handle/collapse/toggle/icon) */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

/* Smaller sibling of the empty-state CTA — same brand gradient surface so
 * the action affordance reads identically across empty + populated states. */
.wp-add-btn {
  background: var(--wp-brand-gradient);
  border: none;
  border-radius: var(--wp-radius-sm);
  color: #fff;
  font-family: var(--wp-font-sans);
  font-size: 12px;
  font-weight: 600;
  padding: 7px;
  cursor: pointer;
  width: 100%;
  text-align: center;
  letter-spacing: 0.03em;
  /* Dimmed at rest; hover lifts to full brand saturation. */
  filter: brightness(0.82) saturate(0.85);
  transition: filter 0.15s;
}
.wp-add-btn:hover { filter: brightness(1) saturate(1); }
.wp-add-btn:focus-visible {
  outline: 2px solid var(--wp-violet);
  outline-offset: 2px;
}

.wp-drop-end {
  display: none;
  border: 1px dashed var(--wp-border2);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text3);
  font-size: 11px;
  text-align: center;
  padding: 6px;
  margin-top: 4px;
  font-style: italic;
}
.wp-drop-end--show { display: block; }
.wp-drop-end--active {
  border-color: var(--wp-accent);
  background: var(--wp-accent-glow);
  color: var(--wp-accent);
}

/* ── Animations ─────────────────────────────────────────────────────── */

/* FLIP reorder — TransitionGroup applies wp-list-move when items reorder. */
.wp-list-move { transition: transform 0.25s ease-out; }
/* Items entering the list (e.g. add via picker) — fade + slide in.
 * Leave is intentionally instant; the dying card lingering during a
 * fade-out felt sluggish, especially when chained with a FLIP move. */
.wp-list-enter-active { transition: opacity 0.2s, transform 0.2s; }
.wp-list-enter-from { opacity: 0; transform: translateY(-4px); }

/* Collapse/expand summary line */
.wp-collapse-enter-active,
.wp-collapse-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s, padding 0.15s;
  overflow: hidden;
}
.wp-collapse-enter-from,
.wp-collapse-leave-to { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; }
.wp-collapse-enter-to,
.wp-collapse-leave-from { max-height: 32px; opacity: 1; }

/* Conflict dot pulse on first appear */
.wp-conflict-dot {
  animation: wp-pulse 0.8s ease-out;
}
@keyframes wp-pulse {
  0%   { transform: scale(0.4); opacity: 0; }
  40%  { transform: scale(1.4); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
</style>
