<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/ui/Icon.vue";
import UpdateDialog from "../components/UpdateDialog.vue";
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
// looks up the latest GitHub release once per app session and surfaces a
// `hasUpdate` flag + severity classification (major/minor/patch).
const { current: version, latestVersion, hasUpdate, severity } = useReleaseCheck();

// Pill tone follows severity: major bump → amber warn (read changelog
// first), minor/patch → accent purple (safe to upgrade).
const updatePillClass = computed(() =>
  severity.value === "major" ? "wp-topbar__update-pill--warn" : "wp-topbar__update-pill--accent",
);
const updateTooltip = computed(() => {
  if (!hasUpdate.value) return "";
  const v = latestVersion.value;
  if (severity.value === "major") return `v${v} — breaking changes, review release notes`;
  if (severity.value === "minor") return `v${v} — new features available`;
  return `v${v} — patch update available`;
});
const versionTooltip = computed(() =>
  hasUpdate.value
    ? `v${version} — update v${latestVersion.value} available on GitHub`
    : `v${version} — open repository on GitHub`,
);
const repoUrl = GITHUB_REPO;
const logoSrc = `${import.meta.env.BASE_URL}images/favicon.svg`;

// The update pill opens the in-app Update dialog (changelog + one-click
// update via ComfyUI Manager) rather than linking straight to GitHub.
const updateDialogOpen = ref(false);
function openUpdateDialog(): void { updateDialogOpen.value = true; }

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
      <!-- Version chip + optional update dot. Anchor (NOT a nested
           RouterLink) so clicking it opens GitHub in a new tab instead
           of routing to /dashboard. `click.stop` keeps the outer
           RouterLink from firing first. -->
      <a
        class="wp-topbar__version"
        :href="repoUrl"
        :title="versionTooltip"
        target="_blank"
        rel="noopener"
        data-test="topbar-version"
        @click.stop
      >v{{ version }}</a>
      <button
        v-if="hasUpdate && latestVersion"
        type="button"
        class="wp-topbar__version wp-topbar__update-pill"
        :class="updatePillClass"
        :title="updateTooltip"
        :data-severity="severity ?? undefined"
        data-test="topbar-update-indicator"
        @click.stop.prevent="openUpdateDialog"
      ><span class="wp-topbar__update-arrow" aria-hidden="true">↑</span>v{{ latestVersion }}</button>
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

    <UpdateDialog :open="updateDialogOpen" @close="updateDialogOpen = false" />
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

/* Version chip is now an `<a>` so it can link to GitHub; kill the
 * default anchor styling so it keeps the chip look from tokens.css. */
a.wp-topbar__version {
  text-decoration: none;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
a.wp-topbar__version:hover {
  color: var(--wp-text);
  border-color: var(--wp-border-strong, var(--wp-text-dim));
  background: color-mix(in oklab, var(--wp-bg-3) 60%, transparent);
}

/* Update-available pill next to the version chip. Renders only when
 * the release check finds a newer published tag on GitHub. Matches
 * the .wp-topbar__version chrome (same font/size/padding/radius) and
 * adds a tonal tint based on severity:
 *   - major bump → amber warn (breaking, review changelog first)
 *   - minor/patch → accent purple (safe to upgrade)
 * Clicking opens releases/latest in a new tab; click.stop on the
 * anchor keeps the dashboard nav (outer RouterLink) from firing first. */
a.wp-topbar__update-pill,
button.wp-topbar__update-pill {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: filter 120ms ease;
  font: inherit;
}
button.wp-topbar__update-pill {
  /* Reset native button chrome; tonal border comes from the
     --accent/--warn modifier classes below. */
  border: 1px solid transparent;
}
a.wp-topbar__update-pill:hover,
button.wp-topbar__update-pill:hover {
  filter: brightness(1.15);
}
.wp-topbar__update-arrow {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.wp-topbar__update-pill--accent {
  color: var(--wp-accent, #8b5cf6);
  background: color-mix(in oklab, var(--wp-accent, #8b5cf6) 18%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent, #8b5cf6) 40%, transparent);
}
.wp-topbar__update-pill--warn {
  color: var(--wp-warn, #f59e0b);
  background: color-mix(in oklab, var(--wp-warn, #f59e0b) 18%, transparent);
  border-color: color-mix(in oklab, var(--wp-warn, #f59e0b) 40%, transparent);
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
