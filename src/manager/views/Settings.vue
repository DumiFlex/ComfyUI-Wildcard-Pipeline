<script setup lang="ts">
/**
 * Settings — port of `SettingsScreen` in
 * `docs/design-handoff/wildcard-pipeline/project/screens/utilities.jsx`.
 * About / Theme / Storage cards using the local ui/* primitives.
 */
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Field from "../components/ui/Field.vue";
import Icon from "../components/ui/Icon.vue";
import Input from "../components/ui/Input.vue";
import Toggle from "../components/ui/Toggle.vue";
import { useUiStore, type ThemeMode } from "../stores/uiStore";
import { GITHUB_REPO } from "../config/links";

const uiStore = useUiStore();

const repoUrl = GITHUB_REPO;

interface ThemeOption { value: ThemeMode; label: string; icon: string }
const THEMES: ThemeOption[] = [
  { value: "dark",  label: "Dark",  icon: "pi-moon" },
  { value: "light", label: "Light", icon: "pi-sun" },
  { value: "auto",  label: "Auto",  icon: "pi-desktop" },
];

function setTheme(mode: ThemeMode) {
  uiStore.setThemeMode(mode);
}

function resetPreferences() {
  // Best-effort — clear the manager's localStorage namespace + reload.
  try {
    const toClear: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("wp-")) toClear.push(key);
    }
    for (const k of toClear) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  window.location.reload();
}
</script>

<template>
  <div class="wp-page wp-settings">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Settings</h1>
        <p class="wp-page__subtitle">
          Application preferences. Stored locally.
        </p>
      </div>
    </div>

    <Card title="About">
      <div class="wp-settings__about">
        <span class="wp-dim">Version</span><span class="wp-mono">1.4.x-dev</span>
        <span class="wp-dim">License</span><span class="wp-mono">GPL-3.0-or-later</span>
        <span class="wp-dim">Repository</span>
        <a
          class="wp-settings__link wp-mono"
          :href="repoUrl"
          target="_blank"
          rel="noopener"
        >
          <Icon name="pi-github" /> {{ repoUrl }}
        </a>
      </div>
    </Card>

    <Card title="Theme">
      <p class="wp-dim wp-settings__hint">
        Choose dark, light, or follow the OS preference.
      </p>
      <div class="wp-settings__radio" role="radiogroup" aria-label="Theme">
        <button
          v-for="t in THEMES"
          :key="t.value"
          type="button"
          class="wp-settings__chip"
          role="radio"
          :aria-checked="uiStore.themeMode === t.value"
          :data-active="uiStore.themeMode === t.value ? 'true' : 'false'"
          :data-test="`settings-theme-${t.value}`"
          @click="setTheme(t.value)"
        >
          <Icon :name="t.icon" /> {{ t.label }}
        </button>
      </div>
    </Card>

    <Card title="Display">
      <Field
        label="Density"
        hint="Compact reduces spacing for long lists."
      >
        <Toggle
          :model-value="uiStore.density === 'compact'"
          label="Compact mode"
          data-test="settings-density-compact"
          @update:model-value="uiStore.setDensity($event ? 'compact' : 'comfortable')"
        />
      </Field>
    </Card>

    <Card title="Storage">
      <p class="wp-dim wp-settings__hint">
        Preferences (theme, sidebar state, last filters) are persisted in your
        browser's <span class="wp-mono">localStorage</span>. Modules + categories
        are stored server-side in SQLite.
      </p>
      <Button
        variant="ghost"
        icon="pi-refresh"
        data-test="settings-reset"
        @click="resetPreferences"
      >Reset preferences</Button>
    </Card>

    <Card title="Wildcard">
      <Field
        label="Ref recursion limit"
        hint="How deep nested @{uuid} references can resolve. Range: 1–32. Default: 8."
        for="wildcard-max-ref-depth"
      >
        <Input
          id="wildcard-max-ref-depth"
          v-model.number="uiStore.maxRefDepth"
          type="number"
          data-test="settings-wildcard-max-ref-depth"
          :aria-label="'Wildcard ref recursion limit'"
          :min="1"
          :max="32"
          :step="1"
          @blur="(e) => {
            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            if (!isNaN(val)) {
              uiStore.setMaxRefDepth(val);
            }
          }"
        />
      </Field>
    </Card>
  </div>
</template>

<style scoped>
.wp-settings { max-width: 720px; }

.wp-settings__about {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--wp-space-3) var(--wp-space-6);
  font-size: var(--wp-text-sm);
  align-items: center;
}
.wp-settings__link {
  color: var(--wp-accent-text);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
}
.wp-settings__link:hover { color: var(--wp-text); }

.wp-settings__hint {
  font-size: var(--wp-text-sm);
  margin: 0 0 var(--wp-space-5);
}

.wp-settings__radio {
  display: inline-flex;
  gap: var(--wp-space-3);
}
.wp-settings__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: 7px var(--wp-space-5); /* audit-exempt: 7px vertical hairline keeps chip height */
  border-radius: var(--wp-radius);
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-2);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  font-weight: 500;
  cursor: pointer;
}
.wp-settings__chip:hover {
  color: var(--wp-text);
  border-color: var(--wp-border-strong);
}
.wp-settings__chip[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  border-color: var(--wp-accent-500);
  color: var(--wp-accent-text);
}
</style>
