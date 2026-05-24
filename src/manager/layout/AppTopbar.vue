<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/ui/Icon.vue";
import { GITHUB_REPO } from "../config/links";
import { useBrowserHistory } from "../composables/useBrowserHistory";
import { useReleaseCheck } from "../composables/useReleaseCheck";
import { useUiStore } from "../stores/uiStore";
import { useTweaksStore } from "../stores/tweaksStore";
import { isMac } from "../utils/platform";

const ui = useUiStore();
const tweaks = useTweaksStore();

// Version is injected at build time from package.json via vite's
// `define` config (see vite.config.mts). The release check composable
// hits GitHub once per 24h (cached in localStorage) and surfaces a
// `hasUpdate` flag if the latest published tag is newer.
const { current: version, latestVersion, hasUpdate } = useReleaseCheck();
const updateTooltip = computed(() =>
  hasUpdate.value
    ? `Update available: v${latestVersion.value} (click to view on GitHub)`
    : "",
);
const releasesUrl = `${GITHUB_REPO}/releases/latest`;
const logoSrc = `${import.meta.env.BASE_URL}images/favicon.svg`;

/** Theme button icon — mirrors prototype (current state, not next). */
const themeIcon = computed(() => {
  switch (ui.themeMode) {
    case "light": return "pi-sun";
    case "dark":  return "pi-moon";
    default:      return "pi-desktop";
  }
});
const themeLabel = computed(() => `Theme: ${ui.themeMode}`);

const router = useRouter();
const { canGoBack } = useBrowserHistory();

function onBack(): void {
  router.back();
}

/** Click-to-open palette shortcut hint. Dispatching a synthetic
 *  Ctrl+K keydown reuses the same handler AppLayout installs for the
 *  keyboard shortcut — keeps palette ownership in one place. The
 *  visible label adapts to mac (⌘K) / windows (Ctrl K). */
const mac = isMac();
const paletteShortcut = computed(() => ({
  kbd: mac ? "⌘ K" : "Ctrl K",
  tooltip: mac ? "Search modules and commands (⌘ K)" : "Search modules and commands (Ctrl+K)",
}));
function openPalette(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "k",
    ctrlKey: !mac,
    metaKey: mac,
    bubbles: true,
  }));
}
</script>

<template>
  <header class="wp-topbar">
    <button
      type="button"
      class="wp-topbar__icon-btn"
      aria-label="Toggle sidebar"
      data-test="topbar-toggle"
      @click="ui.toggleSidebar"
    >
      <Icon name="pi-bars" />
    </button>

    <RouterLink to="/dashboard" class="wp-topbar__brand" data-test="topbar-brand">
      <img :src="logoSrc" alt="" />
      <span class="wp-topbar__brand-text">Wildcard Pipeline</span>
      <span class="wp-topbar__version">v{{ version }}</span>
      <a
        v-if="hasUpdate"
        class="wp-topbar__update-dot"
        :href="releasesUrl"
        :title="updateTooltip"
        target="_blank"
        rel="noopener"
        data-test="topbar-update-indicator"
        @click.stop
      ><span class="wp-sr-only">{{ updateTooltip }}</span></a>
    </RouterLink>

    <div class="wp-topbar__spacer" />

    <button
      type="button"
      class="wp-topbar__palette-hint"
      :title="paletteShortcut.tooltip"
      data-test="topbar-palette"
      @click="openPalette"
    >
      <Icon name="pi-search" :size="12" />
      <span class="wp-topbar__palette-label">Search</span>
      <kbd class="wp-kbd">{{ paletteShortcut.kbd }}</kbd>
    </button>

    <button
      type="button"
      class="wp-topbar__icon-btn"
      :disabled="!canGoBack"
      aria-label="Back"
      title="Back"
      data-test="topbar-back"
      @click="onBack"
    >
      <Icon name="pi-arrow-left" />
    </button>

    <button
      type="button"
      class="wp-topbar__icon-btn"
      :aria-label="themeLabel"
      :title="themeLabel"
      data-test="topbar-theme"
      @click="ui.cycleTheme"
    >
      <Icon :name="themeIcon" />
    </button>

    <button
      type="button"
      class="wp-topbar__icon-btn"
      aria-label="Tweaks"
      title="Tweaks"
      data-test="topbar-tweaks"
      @click="tweaks.togglePanel"
    >
      <Icon name="pi-sliders-h" />
    </button>

    <RouterLink
      to="/settings"
      class="wp-topbar__icon-btn"
      aria-label="Settings"
      title="Settings"
      data-test="topbar-settings"
    >
      <Icon name="pi-cog" />
    </RouterLink>
  </header>
</template>

<style scoped>
/* Layout primitives — .wp-topbar, .wp-topbar__brand, .wp-topbar__version,
   .wp-topbar__spacer, .wp-topbar__icon-btn — are all defined globally in
   tokens.css. Community status pill + user menu styles moved to the
   feat/community-tab branch alongside the views that use them. */

/* Wordmark gradient text — brand identity anchor #1.
 * Base color ensures legibility in browsers without background-clip: text. */
.wp-topbar__brand-text {
  color: var(--wp-text);
}
@supports ((background-clip: text) or (-webkit-background-clip: text)) {
  .wp-topbar__brand-text {
    background: var(--wp-brand-gradient);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
}

/* Command-palette discovery affordance. Lives just before the back
 * arrow in the topbar so the global Cmd/Ctrl + K shortcut is
 * visually advertised rather than hidden behind tribal knowledge.
 * Click also opens the palette (synthetic keydown — see script). */
.wp-topbar__palette-hint {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 28px;
  margin-right: 4px;
  background: color-mix(in oklab, var(--wp-bg-3) 80%, transparent);
  border: 1px solid var(--wp-border);
  border-radius: 999px;
  color: var(--wp-text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.wp-topbar__palette-hint:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border-color: var(--wp-border-strong, var(--wp-border));
}
.wp-topbar__palette-hint:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: 2px;
}
.wp-topbar__palette-label { color: inherit; }

/* Update-available accent dot next to the version. Renders only when
 * the release check finds a newer published tag on GitHub. Clicking
 * the dot opens the latest-release page in a new tab; click.stop on
 * the anchor keeps the dashboard nav (the outer RouterLink) from
 * firing first. */
.wp-topbar__update-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--wp-accent, #8b5cf6);
  margin-left: 6px;
  position: relative;
  top: -6px;
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--wp-accent, #8b5cf6) 28%, transparent);
  transition: transform 120ms ease;
}
.wp-topbar__update-dot:hover {
  transform: scale(1.25);
}
.wp-topbar__palette-hint .wp-kbd {
  /* Inherit the chip's font-size so it doesn't tower over the label. */
  padding: 1px 6px;
  font-size: 10.5px;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
}
@media (max-width: 640px) {
  .wp-topbar__palette-label { display: none; }
}
</style>
