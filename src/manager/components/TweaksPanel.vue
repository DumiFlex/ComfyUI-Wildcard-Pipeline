<script setup lang="ts">
import { computed } from "vue";
import Button from "./ui/Button.vue";
import Toggle from "./ui/Toggle.vue";
import Icon from "./ui/Icon.vue";
import {
  ACCENT_OPTIONS,
  DENSITY_OPTIONS,
  SWATCH_PREVIEW,
  useTweaksStore,
  type AccentName,
  type Density,
} from "../stores/tweaksStore";
import { useUiStore } from "../stores/uiStore";

const tweaks = useTweaksStore();
const ui = useUiStore();

const sidebarCollapsed = computed<boolean>({
  get: () => ui.sidebarCollapsed,
  set: (v) => {
    if (ui.sidebarCollapsed !== v) ui.toggleSidebar();
    tweaks.setSidebarMode(v ? "collapsed" : "expanded");
  },
});

function onAccent(name: AccentName) {
  tweaks.setAccent(name);
}
function onDensity(d: Density) {
  tweaks.setDensity(d);
}
</script>

<template>
  <aside
    class="wp-tweaks"
    :class="{ 'wp-tweaks--open': tweaks.panelOpen }"
    :aria-hidden="!tweaks.panelOpen"
    role="dialog"
    aria-label="Tweaks"
    data-test="tweaks-panel"
  >
    <header class="wp-tweaks__header">
      <h2>Tweaks</h2>
      <button
        type="button"
        class="wp-tweaks__close"
        aria-label="Close tweaks"
        data-test="tweaks-close"
        @click="tweaks.closePanel"
      >
        <Icon name="pi-times" />
      </button>
    </header>

    <div class="wp-tweaks__body">
      <section class="wp-tweaks__section">
        <h3 class="wp-tweaks__section-title">Accent</h3>
        <div class="wp-tweaks__swatches" role="radiogroup" aria-label="Accent palette">
          <button
            v-for="name in ACCENT_OPTIONS"
            :key="name"
            type="button"
            role="radio"
            :aria-checked="tweaks.accent === name"
            class="wp-tweaks__swatch"
            :class="{ 'is-active': tweaks.accent === name }"
            :style="{ background: SWATCH_PREVIEW[name] }"
            :aria-label="`Accent: ${name}`"
            :title="name"
            :data-test="`tweaks-accent-${name}`"
            @click="onAccent(name)"
          />
        </div>
      </section>

      <section class="wp-tweaks__section">
        <h3 class="wp-tweaks__section-title">Density</h3>
        <div class="wp-tweaks__radio" role="radiogroup" aria-label="Density">
          <label
            v-for="d in DENSITY_OPTIONS"
            :key="d"
            class="wp-tweaks__radio-item"
            :class="{ 'is-active': tweaks.density === d }"
          >
            <input
              type="radio"
              name="wp-tweaks-density"
              :value="d"
              :checked="tweaks.density === d"
              :data-test="`tweaks-density-${d}`"
              @change="onDensity(d)"
            />
            <span>{{ d }}</span>
          </label>
        </div>
      </section>

      <section class="wp-tweaks__section">
        <h3 class="wp-tweaks__section-title">Sidebar</h3>
        <Toggle
          v-model="sidebarCollapsed"
          label="Collapse to icons"
          aria-label="Collapse sidebar to icons"
          data-test="tweaks-sidebar-toggle"
        />
      </section>

      <footer class="wp-tweaks__footer">
        <Button
          variant="ghost"
          icon="pi-refresh"
          data-test="tweaks-reset"
          @click="tweaks.reset"
        >
          Reset to defaults
        </Button>
      </footer>
    </div>
  </aside>

  <div
    v-if="tweaks.panelOpen"
    class="wp-tweaks__backdrop"
    data-test="tweaks-backdrop"
    @click="tweaks.closePanel"
  />
</template>

<style scoped>
/* Slide-in panel anchored to the right edge of the viewport. The shell mirrors
   the prototype's floating glass card but lives full-height for predictable
   focus management; nothing in tokens.css owns these classes. */
.wp-tweaks {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  max-width: 90vw;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: var(--wp-bg-1);
  border-left: 1px solid var(--wp-border);
  box-shadow: var(--wp-shadow-lg);
  transform: translateX(100%);
  transition: transform 220ms cubic-bezier(0.3, 0.7, 0.4, 1);
  pointer-events: none;
}
.wp-tweaks--open {
  transform: translateX(0);
  pointer-events: auto;
}

.wp-tweaks__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--wp-space-6) var(--wp-space-6); /* audit-exempt: was 14px vertical; rounded to 16px */
  border-bottom: 1px solid var(--wp-border);
}
.wp-tweaks__header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--wp-text);
}
.wp-tweaks__close {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--wp-text-muted);
  width: 28px;
  height: 28px;
  border-radius: var(--wp-radius-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-tweaks__close:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
}

.wp-tweaks__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--wp-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6); /* audit-exempt: was 18px; rounded to 16px */
}

.wp-tweaks__section { display: flex; flex-direction: column; gap: var(--wp-space-4); }
.wp-tweaks__section-title {
  margin: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
}

.wp-tweaks__swatches { display: flex; gap: var(--wp-space-4); flex-wrap: wrap; }
.wp-tweaks__swatch {
  appearance: none;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 2px solid var(--wp-border);
  cursor: pointer;
  padding: 0;
  transition: border-color 120ms ease, transform 120ms ease;
}
.wp-tweaks__swatch:hover { transform: scale(1.05); }
.wp-tweaks__swatch.is-active {
  border-color: var(--wp-text);
  box-shadow: 0 0 0 2px var(--wp-bg-1), 0 0 0 4px var(--wp-accent-500);
}

.wp-tweaks__radio { display: flex; gap: var(--wp-space-3); padding: 2px; background: var(--wp-bg-3); border-radius: var(--wp-radius); }
.wp-tweaks__radio-item {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--wp-space-3) var(--wp-space-5); /* audit-exempt: was 10px horiz; rounded to 12px */
  border-radius: var(--wp-radius-sm);
  cursor: pointer;
  font-size: 12px;
  text-transform: capitalize;
  color: var(--wp-text-muted);
  user-select: none;
}
.wp-tweaks__radio-item input { position: absolute; opacity: 0; pointer-events: none; }
.wp-tweaks__radio-item.is-active { background: var(--wp-bg-1); color: var(--wp-text); box-shadow: var(--wp-shadow-sm); }

.wp-tweaks__footer { margin-top: auto; padding-top: var(--wp-space-5); border-top: 1px solid var(--wp-border); }

.wp-tweaks__backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: var(--wp-overlay-bg, rgba(0, 0, 0, 0.32));
  /* Backdrop only renders when panel is open; no transition needed. */
}
</style>
