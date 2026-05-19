<script setup lang="ts">
/**
 * Live preview mockup for the Display Playground modal — renders a
 * 1:1 reproduction of the on-canvas ContextWidget layout (standalone
 * modules + bundle frame + bundle children) so users can see how
 * density / decoration / indicator-style / kind-style toggles change
 * the rendering before committing.
 *
 * Composition:
 *   - Top-level layout mirrors ContextWidget's `.wp-modules` flex
 *     column: standalone module cards interleaved with `.wp-bundle`
 *     wrappers.
 *   - Standalone modules + bundle children render through
 *     `MockModuleCard.vue` — a slimmed-down ModuleRow that exercises
 *     the same class names + DOM order without depending on
 *     ContextWidget's ModuleRowCtxKey provide chain.
 *   - The bundle header uses the REAL `BundleHeader.vue` component
 *     so the master-toggle row, drift indicator, summary text, and
 *     bundle-color tinted action buttons stay in lockstep with the
 *     canvas (no risk of duplicate-CSS drift on the surface users
 *     most care about previewing).
 *
 * Per-card state (enabled / collapsed / locked / internal) is held in
 * a reactive map keyed by `MockModule.key` so flipping a child's
 * lock/internal flag immediately re-computes the bundle's tri-state
 * master indicator — exactly how the canvas behaves.
 */
import { computed, reactive } from "vue";
import BundleHeader from "../context/bundles/BundleHeader.vue";
import MockModuleCard, { type MockModule, type ModRuntimeState } from "./MockModuleCard.vue";
import type { BundleInstance } from "../../widgets/_shared";
import { getCollapseMode } from "../../extension/settings";

interface MockBundle {
  key: string;
  name: string;
  color: string;
  libraryDrifted: boolean;
}

type TopItem =
  | { kind: "module"; mod: MockModule }
  | { kind: "bundle"; bundle: MockBundle; children: MockModule[] };

const VAR = (text: string) => ({ isVar: true, text });
const LIT = (text: string) => ({ isVar: false, text });

// Top-level mockup composition mirrors a realistic ContextWidget
// arrangement: a state-heavy wildcard, a bundle holding 3 children
// (override + drift + clean), a clean combine output, and a disabled
// wildcard. This covers every visual axis the playground exposes
// (kind colors, state markers, override chip, library-drifted bundle,
// disabled stripe, collapse motion, action-button tri-state).
const topItems: TopItem[] = [
  {
    kind: "module",
    mod: {
      key: "m_backdrop",
      kind: "wildcard",
      chipLabel: "wildcard",
      chipMod: "wildcard",
      name: "Backdrop",
      summary: [VAR("$backdrop"), LIT(" · 12 options")],
      states: { mod: true, drift: true, missing: true, override: true },
      lockable: true,
      internalable: true,
    },
  },
  {
    kind: "bundle",
    bundle: {
      key: "b_subject",
      name: "Subject phrase",
      color: "#06b6d4",
      libraryDrifted: true,
    },
    children: [
      {
        key: "b_subject__mood",
        kind: "wildcard",
        chipLabel: "wildcard",
        chipMod: "wildcard",
        name: "Mood",
        summary: [VAR("$mood"), LIT(" · 5 options")],
        states: { override: true },
        lockable: true,
        internalable: true,
      },
      {
        key: "b_subject__outfit",
        kind: "fixed_values",
        chipLabel: "fixed",
        chipMod: "fixed",
        name: "Outfit",
        summary: [VAR("$outfit"), LIT(", "), VAR("$accessories")],
        states: { drift: true },
        internalable: true,
      },
      {
        key: "b_subject__phrase",
        kind: "combine",
        chipLabel: "combine",
        chipMod: "combine",
        name: "Subject phrase",
        summary: [LIT("→ "), VAR("$subject_phrase")],
        internalable: true,
      },
    ],
  },
  {
    kind: "module",
    mod: {
      key: "m_model",
      kind: "fixed_values",
      chipLabel: "fixed",
      chipMod: "fixed",
      name: "Model settings",
      summary: [VAR("$cfg"), LIT(", "), VAR("$steps"), LIT(", +1 more")],
      internalable: true,
    },
  },
  {
    kind: "module",
    mod: {
      key: "m_final",
      kind: "combine",
      chipLabel: "combine",
      chipMod: "combine",
      name: "Final prompt",
      summary: [LIT("→ "), VAR("$prompt")],
      internalable: true,
    },
  },
  {
    kind: "module",
    mod: {
      key: "m_hair",
      kind: "wildcard",
      chipLabel: "wildcard",
      chipMod: "wildcard",
      name: "Hair style",
      summary: [VAR("$hair_style"), LIT(" · 28 options")],
      lockable: true,
      internalable: true,
    },
  },
];

const allModuleKeys: string[] = topItems.flatMap((it) =>
  it.kind === "module" ? [it.mod.key] : it.children.map((c) => c.key),
);
const bundleKeys: string[] = topItems
  .filter((it): it is Extract<TopItem, { kind: "bundle" }> => it.kind === "bundle")
  .map((it) => it.bundle.key);

interface BundleRuntimeState { enabled: boolean; collapsed: boolean; }

const moduleStates = reactive<Record<string, ModRuntimeState>>(
  Object.fromEntries(
    allModuleKeys.map((k) => [k, { enabled: true, collapsed: false, locked: false, internal: false }]),
  ),
);
const bundleStates = reactive<Record<string, BundleRuntimeState>>(
  Object.fromEntries(bundleKeys.map((k) => [k, { enabled: true, collapsed: false }])),
);

// Defaults that match the original mockup's design: the last
// standalone wildcard starts disabled + collapsed so users see the
// stripe pattern next to live cards without interacting first.
moduleStates.m_hair!.enabled = false;
moduleStates.m_hair!.collapsed = true;

function toggleModuleCollapsed(key: string): void {
  const target = moduleStates[key];
  if (!target) return;
  const willExpand = target.collapsed;
  const accordion = getCollapseMode() === "accordion" && willExpand;
  if (accordion) {
    for (const k of allModuleKeys) moduleStates[k]!.collapsed = k !== key;
  } else {
    target.collapsed = !target.collapsed;
  }
}
function toggleModuleEnabled(key: string): void {
  const s = moduleStates[key];
  if (s) s.enabled = !s.enabled;
}
function toggleModuleLock(key: string): void {
  const s = moduleStates[key];
  if (s) s.locked = !s.locked;
}
function toggleModuleInternal(key: string): void {
  const s = moduleStates[key];
  if (s) s.internal = !s.internal;
}
function toggleBundleCollapsed(key: string): void {
  const s = bundleStates[key];
  if (s) s.collapsed = !s.collapsed;
}
function toggleBundleEnabled(key: string, next: boolean): void {
  const s = bundleStates[key];
  if (s) s.enabled = next;
}

// Tri-state aggregation across a bundle's lockable children — mirrors
// `bundleLockState()` from ContextWidget so the master-button visual
// in the mockup reads exactly like canvas. Null when no child is
// lockable (the lock button hides entirely in that case, same
// pattern as on canvas).
function bundleLockState(children: MockModule[]): "all" | "none" | "partial" | null {
  const lockable = children.filter((c) => c.lockable);
  if (lockable.length === 0) return null;
  const on = lockable.filter((c) => moduleStates[c.key]?.locked).length;
  if (on === 0) return "none";
  if (on === lockable.length) return "all";
  return "partial";
}
function bundleInternalState(children: MockModule[]): "all" | "none" | "partial" | null {
  const eligible = children.filter((c) => c.internalable);
  if (eligible.length === 0) return null;
  const on = eligible.filter((c) => moduleStates[c.key]?.internal).length;
  if (on === 0) return "none";
  if (on === eligible.length) return "all";
  return "partial";
}
function bundleDriftedCount(children: MockModule[]): number {
  return children.filter((c) => c.states?.drift).length;
}

// Click-through behavior for the bundle master toggles: pulls every
// child to the lit state, or clears all if everyone is already lit.
// Same as the real BundleHeader emit handlers in ContextWidget.
function bundleToggleLock(children: MockModule[]): void {
  const lockable = children.filter((c) => c.lockable);
  const allOn = lockable.every((c) => moduleStates[c.key]?.locked);
  for (const c of lockable) {
    const s = moduleStates[c.key];
    if (s) s.locked = !allOn;
  }
}
function bundleToggleInternal(children: MockModule[]): void {
  const eligible = children.filter((c) => c.internalable);
  const allOn = eligible.every((c) => moduleStates[c.key]?.internal);
  for (const c of eligible) {
    const s = moduleStates[c.key];
    if (s) s.internal = !allOn;
  }
}

// Synthetic BundleInstance shape — BundleHeader.vue reads `_uid`,
// `enabled`, `collapsed` directly off `props.instance`, so we keep
// a tiny computed object per mock bundle. The rest of the
// BundleInstance fields (`library_id`, `inserted_at_hash`, etc.) are
// unused by the header render path so we satisfy the type with safe
// placeholders.
function bundleInstance(b: MockBundle): BundleInstance {
  const s = bundleStates[b.key]!;
  return {
    _uid: b.key,
    library_id: b.key,
    start_idx: 0,
    end_idx: 0,
    enabled: s.enabled,
    collapsed: s.collapsed,
    inserted_at_hash: "",
    name: b.name,
    color: b.color,
  };
}

// Convenience: precompute the bundle metadata each frame so the
// template stays readable. computed wrappers ensure tri-state +
// drifted-count refresh whenever any child's runtime state flips.
const bundleViews = computed(() =>
  topItems
    .filter((it): it is Extract<TopItem, { kind: "bundle" }> => it.kind === "bundle")
    .map((it) => ({
      key: it.bundle.key,
      instance: bundleInstance(it.bundle),
      bundle: it.bundle,
      children: it.children,
      driftedCount: bundleDriftedCount(it.children),
      lockState: bundleLockState(it.children),
      internalState: bundleInternalState(it.children),
    })),
);
function viewForBundle(key: string) {
  return bundleViews.value.find((v) => v.key === key);
}
</script>

<template>
  <div class="wp-pg-mockup">
    <div class="wp-pg-mockup__caption">Live preview</div>
    <div class="wp-modules">
      <template v-for="item in topItems" :key="item.kind === 'module' ? item.mod.key : item.bundle.key">
        <!-- Bundle: real BundleHeader + .wp-bundle-children wrap mirror
             ContextWidget's render so the frame, master-toggle row,
             drift chip, and child indent stay in 1:1 sync with canvas. -->
        <div
          v-if="item.kind === 'bundle'"
          class="wp-bundle"
          :class="{ 'wp-bundle--collapsed': bundleStates[item.bundle.key]!.collapsed }"
          :style="{ '--wp-bundle-color': item.bundle.color }"
          :data-bundle-uid="item.bundle.key"
        >
          <BundleHeader
            v-if="viewForBundle(item.bundle.key)"
            :instance="viewForBundle(item.bundle.key)!.instance"
            :name="item.bundle.name"
            :color="item.bundle.color"
            :child-count="item.children.length"
            :drifted-count="viewForBundle(item.bundle.key)!.driftedCount"
            :library-drifted="item.bundle.libraryDrifted"
            :internal-state="viewForBundle(item.bundle.key)!.internalState"
            :lock-state="viewForBundle(item.bundle.key)!.lockState"
            @toggle-collapse="toggleBundleCollapsed(item.bundle.key)"
            @toggle-enabled="(next) => toggleBundleEnabled(item.bundle.key, next)"
            @toggle-lock="bundleToggleLock(item.children)"
            @toggle-internal="bundleToggleInternal(item.children)"
          />
          <div class="wp-bundle-children">
            <MockModuleCard
              v-for="child in item.children"
              :key="child.key"
              :module="child"
              :state="moduleStates[child.key]!"
              @toggle-collapse="toggleModuleCollapsed(child.key)"
              @toggle-enabled="toggleModuleEnabled(child.key)"
              @toggle-lock="toggleModuleLock(child.key)"
              @toggle-internal="toggleModuleInternal(child.key)"
            />
          </div>
        </div>
        <!-- Standalone module — same MockModuleCard as bundle children. -->
        <MockModuleCard
          v-else
          :module="item.mod"
          :state="moduleStates[item.mod.key]!"
          @toggle-collapse="toggleModuleCollapsed(item.mod.key)"
          @toggle-enabled="toggleModuleEnabled(item.mod.key)"
          @toggle-lock="toggleModuleLock(item.mod.key)"
          @toggle-internal="toggleModuleInternal(item.mod.key)"
        />
      </template>
    </div>
    <p class="wp-pg-mockup__hint">
      Try the toggles + chevrons — flipping enable/disable shows the
      stripe pattern and dim text; collapsing slides via the same
      transition reduce-motion neutralizes. Every density / indicator
      / kind-style / type-style change applies live to these mockups
      (modules AND bundle) AND your real canvas modules.
    </p>
  </div>
</template>

<style>
/* Unscoped on purpose — these rules need to match the same classes
 * ContextWidget uses for the body-class CSS in display-prefs.css to
 * apply consistently to both the real module list AND this mockup.
 *
 * @layer wp-extension caps cascade priority below the host so even
 * an unprefixed rule (none here, but defense-in-depth) can't
 * outrank ComfyUI's own. */
@layer wp-extension {
.wp-pg-mockup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 14px;
}
.wp-pg-mockup__caption {
  font: 600 11px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-pg-mockup__hint {
  margin: 0;
  font: 11px/1.5 var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}

/* Module-card chrome (mirrors ContextWidget) */
.wp-pg-mockup .wp-modules {
  display: flex;
  flex-direction: column;
  gap: var(--wp-row-gap);
}
.wp-pg-mockup .wp-module {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-left-width: 3px;
  border-left-color: var(--wp-kind-wildcard);
  border-radius: var(--wp-radius-sm);
  padding: var(--wp-pad-row);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* Per-kind border-left + icon-color overrides — mirrors ContextWidget */
.wp-pg-mockup .wp-module[data-kind="fixed_values"] { border-left-color: var(--wp-kind-fixed); }
.wp-pg-mockup .wp-module[data-kind="combine"]      { border-left-color: var(--wp-kind-combine); }
.wp-pg-mockup .wp-module[data-kind="derivation"]   { border-left-color: var(--wp-kind-derivation, var(--wp-accent)); }
.wp-pg-mockup .wp-module[data-kind="fixed_values"] .wp-row-type-icon { color: var(--wp-kind-fixed); }
.wp-pg-mockup .wp-module[data-kind="combine"]      .wp-row-type-icon { color: var(--wp-kind-combine); }
.wp-pg-mockup .wp-module[data-kind="wildcard"]     .wp-row-type-icon { color: var(--wp-kind-wildcard); }

/* State-tier border highlight — mirrors ContextWidget's tier classes
 * so the same priority rules apply (missing > drift > mod). Settings
 * panel's border-highlight toggle still flips these via the body
 * class in display-prefs.css; declaring them locally just provides
 * the baseline color when highlighting is enabled. */
.wp-pg-mockup .wp-module.wp-state-modified { border-color: var(--wp-status-modified); }
.wp-pg-mockup .wp-module.wp-state-drift    { border-color: var(--wp-warn); }
.wp-pg-mockup .wp-module.wp-state-missing  { border-color: var(--wp-danger); }

/* Disabled module styling — mirrors ContextWidget's `.wp-disabled`
 * exactly: stripe pattern + opacity dim + grey name text. */
.wp-pg-mockup .wp-module.wp-disabled {
  opacity: 0.55;
  background: repeating-linear-gradient(
    45deg,
    var(--wp-bg3),
    var(--wp-bg3) 6px,
    var(--wp-bg2) 6px,
    var(--wp-bg2) 8px
  );
}
.wp-pg-mockup .wp-module.wp-disabled .wp-module-name {
  color: var(--wp-text3);
}
.wp-pg-mockup .wp-module-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wp-pg-mockup .wp-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--wp-text-dim, var(--wp-text3));
  width: 6px;
  flex-shrink: 0;
  cursor: grab;
  opacity: 0.6;
}
.wp-pg-mockup .wp-drag-handle:active { cursor: grabbing; }
.wp-pg-mockup .wp-drag-handle__grip { display: block; }
.wp-pg-mockup .wp-collapse-btn {
  background: transparent;
  border: none;
  color: var(--wp-text-dim, var(--wp-text3));
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
}
.wp-pg-mockup .wp-collapse-btn .pi { font-size: 10px; }
.wp-pg-mockup .wp-collapse-btn:hover { color: var(--wp-text); }
.wp-pg-mockup .wp-toggle {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  cursor: pointer;
}
.wp-pg-mockup .wp-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.wp-pg-mockup .wp-toggle-mark {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid var(--wp-border2);
  background: var(--wp-bg2);
}
.wp-pg-mockup .wp-toggle input:checked + .wp-toggle-mark {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
}
.wp-pg-mockup .wp-row-type-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wp-pg-mockup .wp-row-type-icon .pi { font-size: 12px; line-height: 1; }
.wp-pg-mockup .wp-kind-chip {
  font-family: var(--wp-font-sans, sans-serif);
  font-weight: 600;
  font-size: var(--wp-chip-font);
  line-height: 1;
  text-transform: lowercase;
  letter-spacing: 0.04em;
  padding: var(--wp-chip-pad);
  border-radius: 2px;
  flex-shrink: 0;
}
.wp-pg-mockup .wp-kind-chip--wildcard {
  background: color-mix(in oklab, var(--wp-kind-wildcard) 22%, transparent);
  color: var(--wp-kind-wildcard);
}
.wp-pg-mockup .wp-kind-chip--fixed {
  background: color-mix(in oklab, var(--wp-kind-fixed) 22%, transparent);
  color: var(--wp-kind-fixed);
}
.wp-pg-mockup .wp-kind-chip--combine {
  background: color-mix(in oklab, var(--wp-kind-combine) 22%, transparent);
  color: var(--wp-kind-combine);
}
.wp-pg-mockup .wp-module-name {
  flex: 1;
  font-size: var(--wp-mod-font);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.wp-pg-mockup .wp-mod-dots {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 50%;
  justify-content: flex-end;
}
.wp-pg-mockup .wp-mod-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid;
  flex-shrink: 0;
}
.wp-pg-mockup .wp-mod-dot--modified {
  background: color-mix(in oklab, var(--wp-status-modified) 14%, transparent);
  border-color: var(--wp-status-modified);
}
.wp-pg-mockup .wp-mod-dot--drift {
  background: color-mix(in oklab, var(--wp-warn) 14%, transparent);
  border-color: var(--wp-warn);
}
.wp-pg-mockup .wp-mod-dot--missing {
  background: color-mix(in oklab, var(--wp-danger) 14%, transparent);
  border-color: var(--wp-danger);
}
.wp-pg-mockup .wp-conflict-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wp-pg-mockup .wp-conflict-dot--info {
  background: var(--wp-accent);
}
.wp-pg-mockup .wp-mod-badge {
  font-family: var(--wp-font-sans);
  font-weight: 600;
  font-size: var(--wp-chip-font);
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: var(--wp-chip-pad);
  border-radius: 2px;
}
.wp-pg-mockup .wp-mod-badge--mod {
  background: color-mix(in oklab, var(--wp-status-modified) 18%, transparent);
  color: var(--wp-status-modified);
}
.wp-pg-mockup .wp-mod-badge--drift {
  background: color-mix(in oklab, var(--wp-warn) 18%, transparent);
  color: var(--wp-warn);
}
.wp-pg-mockup .wp-mod-badge--missing {
  background: color-mix(in oklab, var(--wp-danger) 18%, transparent);
  color: var(--wp-danger);
}
.wp-pg-mockup .wp-conflict-badge {
  font-family: var(--wp-font-sans, sans-serif);
  font-weight: 600;
  font-size: var(--wp-chip-font);
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: var(--wp-chip-pad);
  border-radius: 2px;
  flex-shrink: 0;
}
.wp-pg-mockup .wp-conflict-badge--info {
  background: color-mix(in oklab, var(--wp-accent) 18%, transparent);
  color: var(--wp-accent);
}
/* Action-button cluster — mirrors ContextWidget's `.wp-mod-actions`
 * row so the trio reads with the same density as canvas. Base
 * button styling comes from row-primitives.css (`.wp-btn--icon-sm`
 * and variants), already loaded globally via ContextWidget. */
.wp-pg-mockup .wp-mod-actions {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
}
.wp-pg-mockup .wp-summary {
  color: var(--wp-text2);
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 2px 4px 2px 36px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}
.wp-pg-mockup .wp-summary__main {
  display: inline;
}
/* Variable tokens — single accent here; the real ContextWidget hashes
 * `varColorClass()` across .var-1..8, but the preview only needs the
 * visual cue, not the per-name uniqueness. */
.wp-pg-mockup__var {
  color: var(--wp-violet);
  font-weight: 600;
}
.wp-pg-mockup__lit {
  color: var(--wp-text-dim, var(--wp-text3));
}

/* `.wp-collapse-row` base styles come from row-primitives.css (loaded
 * globally via ContextWidget). The grid-track interpolation works
 * identically inside the mockup without per-surface overrides — no
 * 32px ceiling, content of any size collapses cleanly. */
}  /* end @layer wp-extension */
</style>
