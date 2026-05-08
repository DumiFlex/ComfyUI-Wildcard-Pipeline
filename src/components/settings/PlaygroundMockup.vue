<script setup lang="ts">
/**
 * Live preview mockup for the Display Playground modal — renders a
 * fake module card so users can see how density / decoration /
 * indicator-style / kind-style toggles change the rendering before
 * committing.
 *
 * The mockup is just a static DOM tree with the same class names
 * ContextWidget uses, so all the body-class CSS rules in
 * `display-prefs.css` (density tokens, indicator hide rules, kind
 * style hide rules, border highlight off, etc.) apply automatically.
 *
 * Style rules below are a SUBSET of ContextWidget's scoped styles —
 * the chrome rules (module card frame, header layout, dots cluster,
 * etc.) are duplicated here because Vue's `<style scoped>` attaches
 * a `[data-v-*]` attribute that doesn't match across components.
 *
 * Drift risk: if ContextWidget's chrome changes substantially, this
 * mockup will get out of sync. Acceptable trade-off for keeping the
 * playground self-contained without a tokens-vs-chrome refactor.
 */
</script>

<template>
  <div class="wp-pg-mockup">
    <div class="wp-pg-mockup__caption">Live preview</div>
    <div class="wp-modules">
      <div class="wp-module" data-kind="wildcard">
        <div class="wp-module-header">
          <span class="wp-drag-handle" aria-hidden="true">
            <i class="pi pi-bars" />
          </span>
          <button class="wp-collapse-btn" type="button" tabindex="-1">
            <i class="pi pi-chevron-down" />
          </button>
          <label class="wp-toggle">
            <input type="checkbox" checked tabindex="-1" />
            <span class="wp-toggle-mark"></span>
          </label>
          <span class="wp-mod-icon" aria-hidden="true">
            <i class="pi pi-asterisk" />
          </span>
          <span class="wp-kind-chip wp-kind-chip--wildcard">wildcard</span>
          <span class="wp-module-name">$backdrop</span>
          <span class="wp-mod-dots">
            <span class="wp-mod-dot wp-mod-dot--modified" aria-hidden="true"></span>
            <span class="wp-mod-badge wp-mod-badge--mod">mod</span>
            <span class="wp-mod-dot wp-mod-dot--missing" aria-hidden="true"></span>
            <span class="wp-mod-badge wp-mod-badge--missing">missing</span>
            <span class="wp-conflict-dot wp-conflict-dot--info" aria-hidden="true"></span>
            <span class="wp-conflict-badge wp-conflict-badge--info">override</span>
          </span>
        </div>
        <div class="wp-summary">$backdrop = "rocky beach at golden hour"</div>
      </div>
    </div>
    <p class="wp-pg-mockup__hint">
      The card above shows a wildcard module with multiple states
      active (modified + missing + override). Flip controls on the
      left to see how each setting affects this row — and every other
      Wildcard Pipeline module on your canvas.
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
/* State borders matched to .wp-mod-dots presence — mockup sets all
 * three so the highest-severity (missing) wins when border-highlight
 * is on. */
.wp-pg-mockup .wp-module {
  border-color: var(--wp-danger);
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
  background: color-mix(in oklab, var(--wp-kind-wildcard) 22%, transparent);
  color: var(--wp-kind-wildcard);
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
</style>
