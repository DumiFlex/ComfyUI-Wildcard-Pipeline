<script setup lang="ts">
/**
 * Live preview mockup for the Display Playground modal — renders a
 * fake module list so users can see how density / decoration /
 * indicator-style / kind-style toggles change the rendering before
 * committing.
 *
 * Four modules cover the most-noticed visual variations:
 *   1. wildcard module with stacked states (mod + drift + missing +
 *      override) — exercises the priority-filter + indicator/dot
 *      width
 *   2. fixed_values module with no state markers — clean kind-chip
 *      styling, different border-left color
 *   3. combine module (clean) — third kind-color contrast
 *   4. wildcard module starts disabled — shows the wp-disabled
 *      stripe pattern; user can flip it back on to test the toggle
 *
 * Each module's enable + collapse state is reactive so users can
 * actually interact with the mockup:
 *   - Click the checkbox to flip enable → see disabled stripe pattern
 *     toggle (and the no-motion sweep neutralizes the transition if
 *     reduce-motion is on)
 *   - Click the chevron to collapse/expand → see the summary line
 *     slide via the same wp-collapse Vue transition ContextWidget
 *     uses; reduce-motion off → smooth slide, on → instant snap
 *
 * The mockup uses the same class names ContextWidget uses, so the
 * body-class CSS rules in display-prefs.css (density tokens,
 * indicator hide rules, kind-style hide rules, border-highlight off,
 * etc.) apply automatically. Style rules below are a SUBSET of
 * ContextWidget's scoped styles — Vue's `<style scoped>` attaches a
 * `[data-v-*]` attribute that doesn't match across components, so we
 * duplicate just enough chrome to render presentable cards. Drift
 * risk: if ContextWidget's chrome changes substantially this mockup
 * gets stale; future refactor could extract a shared module-card.css.
 */
import { reactive } from "vue";

interface ModuleState {
  enabled: boolean;
  collapsed: boolean;
}

// Per-module enable + collapse state. Defaults match the original
// static markup: first three start enabled + expanded; the fourth
// starts disabled + collapsed so the user immediately sees both
// styles side-by-side.
const state = reactive<{
  m1: ModuleState;
  m2: ModuleState;
  m3: ModuleState;
  m4: ModuleState;
}>({
  m1: { enabled: true,  collapsed: false },
  m2: { enabled: true,  collapsed: false },
  m3: { enabled: true,  collapsed: false },
  m4: { enabled: false, collapsed: true },
});
</script>

<template>
  <div class="wp-pg-mockup">
    <div class="wp-pg-mockup__caption">Live preview</div>
    <div class="wp-modules">
      <!-- Real module names mirror m.meta.name from ContextWidget — the
           human-friendly library name, NOT the variable binding. The
           summary uses summaryTokens() shape: `$binding · N options`
           for wildcards, `$var, $var, +N more` for fixed_values, etc.
           Icons match kindIcon() in shared/kind-icons.ts. -->

      <!-- 1. Wildcard module with all the state markers active so
           users see indicator-style + priority filter side-by-side -->
      <div
        class="wp-module"
        :class="{ 'wp-disabled': !state.m1.enabled }"
        data-kind="wildcard"
      >
        <div class="wp-module-header">
          <span class="wp-drag-handle" aria-hidden="true"
            ><i class="pi pi-bars" aria-hidden="true"></i
          ></span>
          <button
            class="wp-collapse-btn"
            type="button"
            :title="state.m1.collapsed ? 'Expand' : 'Collapse'"
            @click="state.m1.collapsed = !state.m1.collapsed"
          ><i :class="['pi', state.m1.collapsed ? 'pi-caret-right' : 'pi-caret-down']" aria-hidden="true"></i></button>
          <label class="wp-toggle">
            <input v-model="state.m1.enabled" type="checkbox" />
            <span class="wp-toggle-mark"></span>
          </label>
          <span class="wp-mod-icon" aria-hidden="true"
            ><i class="pi pi-sparkles" aria-hidden="true"></i
          ></span>
          <span class="wp-kind-chip wp-kind-chip--wildcard">wildcard</span>
          <span class="wp-module-name">Backdrop</span>
          <span class="wp-mod-dots">
            <span class="wp-mod-dot wp-mod-dot--modified" aria-hidden="true"></span>
            <span class="wp-mod-badge wp-mod-badge--mod">mod</span>
            <span class="wp-mod-dot wp-mod-dot--drift" aria-hidden="true"></span>
            <span class="wp-mod-badge wp-mod-badge--drift">drift</span>
            <span class="wp-mod-dot wp-mod-dot--missing" aria-hidden="true"></span>
            <span class="wp-mod-badge wp-mod-badge--missing">missing</span>
            <span class="wp-conflict-dot wp-conflict-dot--info" aria-hidden="true"></span>
            <span class="wp-conflict-badge wp-conflict-badge--info">override</span>
          </span>
        </div>
        <Transition name="wp-collapse">
          <div v-if="!state.m1.collapsed" class="wp-summary">
            <span class="wp-pg-mockup__var">$backdrop</span>
            <span class="wp-pg-mockup__lit"> · 12 options</span>
          </div>
        </Transition>
      </div>

      <!-- 2. Fixed-values module — different kind-color, no state markers
           so users see the un-stacked default look -->
      <div
        class="wp-module"
        :class="{ 'wp-disabled': !state.m2.enabled }"
        data-kind="fixed_values"
      >
        <div class="wp-module-header">
          <span class="wp-drag-handle" aria-hidden="true"
            ><i class="pi pi-bars" aria-hidden="true"></i
          ></span>
          <button
            class="wp-collapse-btn"
            type="button"
            :title="state.m2.collapsed ? 'Expand' : 'Collapse'"
            @click="state.m2.collapsed = !state.m2.collapsed"
          ><i :class="['pi', state.m2.collapsed ? 'pi-caret-right' : 'pi-caret-down']" aria-hidden="true"></i></button>
          <label class="wp-toggle">
            <input v-model="state.m2.enabled" type="checkbox" />
            <span class="wp-toggle-mark"></span>
          </label>
          <span class="wp-mod-icon" aria-hidden="true"
            ><i class="pi pi-tag" aria-hidden="true"></i
          ></span>
          <span class="wp-kind-chip wp-kind-chip--fixed">fixed</span>
          <span class="wp-module-name">Model settings</span>
          <span class="wp-mod-dots"></span>
        </div>
        <Transition name="wp-collapse">
          <div v-if="!state.m2.collapsed" class="wp-summary">
            <span class="wp-pg-mockup__var">$cfg</span>
            <span class="wp-pg-mockup__lit">, </span>
            <span class="wp-pg-mockup__var">$steps</span>
            <span class="wp-pg-mockup__lit">, +1 more</span>
          </div>
        </Transition>
      </div>

      <!-- 3. Combine module — third kind-color, also clean -->
      <div
        class="wp-module"
        :class="{ 'wp-disabled': !state.m3.enabled }"
        data-kind="combine"
      >
        <div class="wp-module-header">
          <span class="wp-drag-handle" aria-hidden="true"
            ><i class="pi pi-bars" aria-hidden="true"></i
          ></span>
          <button
            class="wp-collapse-btn"
            type="button"
            :title="state.m3.collapsed ? 'Expand' : 'Collapse'"
            @click="state.m3.collapsed = !state.m3.collapsed"
          ><i :class="['pi', state.m3.collapsed ? 'pi-caret-right' : 'pi-caret-down']" aria-hidden="true"></i></button>
          <label class="wp-toggle">
            <input v-model="state.m3.enabled" type="checkbox" />
            <span class="wp-toggle-mark"></span>
          </label>
          <span class="wp-mod-icon" aria-hidden="true"
            ><i class="pi pi-link" aria-hidden="true"></i
          ></span>
          <span class="wp-kind-chip wp-kind-chip--combine">combine</span>
          <span class="wp-module-name">Final prompt</span>
          <span class="wp-mod-dots"></span>
        </div>
        <Transition name="wp-collapse">
          <div v-if="!state.m3.collapsed" class="wp-summary">
            <span class="wp-pg-mockup__lit">→ </span>
            <span class="wp-pg-mockup__var">$prompt</span>
          </div>
        </Transition>
      </div>

      <!-- 4. Disabled wildcard — starts off + collapsed; user can flip
           the toggle to see the disable→enable transition + stripe
           pattern dropping. -->
      <div
        class="wp-module"
        :class="{ 'wp-disabled': !state.m4.enabled }"
        data-kind="wildcard"
      >
        <div class="wp-module-header">
          <span class="wp-drag-handle" aria-hidden="true"
            ><i class="pi pi-bars" aria-hidden="true"></i
          ></span>
          <button
            class="wp-collapse-btn"
            type="button"
            :title="state.m4.collapsed ? 'Expand' : 'Collapse'"
            @click="state.m4.collapsed = !state.m4.collapsed"
          ><i :class="['pi', state.m4.collapsed ? 'pi-caret-right' : 'pi-caret-down']" aria-hidden="true"></i></button>
          <label class="wp-toggle">
            <input v-model="state.m4.enabled" type="checkbox" />
            <span class="wp-toggle-mark"></span>
          </label>
          <span class="wp-mod-icon" aria-hidden="true"
            ><i class="pi pi-sparkles" aria-hidden="true"></i
          ></span>
          <span class="wp-kind-chip wp-kind-chip--wildcard">wildcard</span>
          <span class="wp-module-name">Hair style</span>
          <span class="wp-mod-dots"></span>
        </div>
        <Transition name="wp-collapse">
          <div v-if="!state.m4.collapsed" class="wp-summary">
            <span class="wp-pg-mockup__var">$hair_style</span>
            <span class="wp-pg-mockup__lit"> · 28 options</span>
          </div>
        </Transition>
      </div>
    </div>
    <p class="wp-pg-mockup__hint">
      Try the toggles + chevrons — flipping enable/disable shows the
      stripe pattern and dim text; collapsing slides via the same
      transition reduce-motion neutralizes. Every density / indicator
      / kind-style change applies live to these mockups AND your real
      canvas modules.
    </p>
  </div>
</template>

<style>
/* Unscoped on purpose — these rules need to match the same classes
 * ContextWidget uses for the body-class CSS in display-prefs.css to
 * apply consistently to both the real module list AND this mockup. */
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
.wp-pg-mockup .wp-module[data-kind="fixed_values"] .wp-mod-icon { color: var(--wp-kind-fixed); }
.wp-pg-mockup .wp-module[data-kind="combine"]      .wp-mod-icon { color: var(--wp-kind-combine); }

/* Stacked-states wildcard module (the first one) — set its full border
 * to red so the user sees border-highlight effect on the highest-tier
 * state (missing). The other modules stay neutral so the kind border-left
 * accent reads cleanly. */
.wp-pg-mockup .wp-module:first-child {
  border-color: var(--wp-danger);
}

/* Disabled module styling — mirrors ContextWidget's `.wp-disabled`
 * exactly: stripe pattern + opacity dim + grey name text. The
 * stripe is a 45deg repeating-linear-gradient between bg3 and bg2
 * so it reads as "muted and offline" without losing kind-color
 * legibility. */
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
  width: 16px;
  height: 16px;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: grab;
  flex-shrink: 0;
}
.wp-pg-mockup .wp-drag-handle .pi { font-size: 10px; }
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
.wp-pg-mockup .wp-toggle {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
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
/* Checked state — matches ContextWidget's `:checked + .wp-toggle-mark`
 * which fills the box with the brand accent. The disabled-toggle module
 * (4th in the mockup) leaves the input unchecked so the empty-box look
 * shows through. */
.wp-pg-mockup .wp-toggle input:checked + .wp-toggle-mark {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
}
.wp-pg-mockup .wp-mod-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--wp-kind-wildcard);
}
.wp-pg-mockup .wp-mod-icon .pi { font-size: 12px; line-height: 1; }
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
/* Variable tokens in the summary line — colored to match the var-color
 * hash used elsewhere (assembler chip strip + combine preview). Single
 * accent here since the mockup doesn't compute hash colors per name —
 * the visual cue (var-tok styling) is what matters for preview. */
.wp-pg-mockup__var {
  color: var(--wp-violet);
  font-weight: 600;
}
.wp-pg-mockup__lit {
  color: var(--wp-text-dim, var(--wp-text3));
}

/* Collapse Vue transition — mirrors ContextWidget's `wp-collapse`
 * scoped styles so the slide reads identically here. The reduce-motion
 * sweep in a11y.css already targets `.wp-pg` (added by the
 * decoration-cleanup commit) so flipping reduce-motion to ON
 * collapses transition-duration to 0.01ms — instant snap, no fade. */
.wp-pg-mockup .wp-collapse-enter-active,
.wp-pg-mockup .wp-collapse-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s, padding 0.15s;
  overflow: hidden;
}
.wp-pg-mockup .wp-collapse-enter-from,
.wp-pg-mockup .wp-collapse-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.wp-pg-mockup .wp-collapse-enter-to,
.wp-pg-mockup .wp-collapse-leave-from {
  max-height: 32px;
  opacity: 1;
}

/* Make the toggle + chevron actually clickable in the mockup —
 * remove the cursor: default that some UAs apply to disabled-feel
 * controls when there's no native interaction. */
.wp-pg-mockup .wp-toggle { cursor: pointer; }
.wp-pg-mockup .wp-collapse-btn { cursor: pointer; }
.wp-pg-mockup .wp-collapse-btn:hover { color: var(--wp-text); }
</style>
