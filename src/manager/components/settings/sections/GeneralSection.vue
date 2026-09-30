<script setup lang="ts">
import { computed } from "vue";
import Icon from "../../ui/Icon.vue";
import Toggle from "../../ui/Toggle.vue";
import Button from "../../ui/Button.vue";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import { useUiStore } from "../../../stores/uiStore";
import { useReleaseCheck } from "../../../composables/useReleaseCheck";
import { GITHUB_REPO } from "../../../config/links";

const ui = useUiStore();
const { latestVersion, hasUpdate, lastChecked, checking, checkNow } = useReleaseCheck();

const updateStatus = computed(() =>
  hasUpdate.value && latestVersion.value
    ? `Update v${latestVersion.value} available`
    : "Up to date",
);
const lastCheckedLabel = computed(() => {
  if (!lastChecked.value) return "never checked";
  const then = new Date(lastChecked.value).getTime();
  if (Number.isNaN(then)) return "never checked";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
});

// Build-time injected via vite `define` (see vite.config.mts) — source of
// truth is package.json, which semantic-release stamps on every release.
const appVersion = __APP_VERSION__;
const appLicense = __APP_LICENSE__;
</script>

<template>
  <SettingGroup title="About">
    <SettingRow label="Wildcard Pipeline" setting-key="about" stacked>
      <div class="wp-set-about">
        <span class="wp-dim">Version</span><span class="wp-mono">{{ appVersion }}</span>
        <span class="wp-dim">License</span><span class="wp-mono">{{ appLicense }}</span>
        <span class="wp-dim">Repository</span>
        <a class="wp-set-about__link wp-mono" :href="GITHUB_REPO" target="_blank" rel="noopener">
          <Icon name="pi-github" /> {{ GITHUB_REPO }}
        </a>
      </div>
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="Updates">
    <SettingRow
      label="Check for updates on launch"
      hint="Look for a newer release when the manager opens. Turn off to check only manually."
      setting-key="check-on-launch"
    >
      <Toggle
        :model-value="ui.checkOnLaunch"
        aria-label="Check for updates on launch"
        data-test="settings-check-on-launch"
        @update:model-value="ui.setCheckOnLaunch($event)"
      />
    </SettingRow>
    <SettingRow label="Latest release" setting-key="check-now">
      <template #extra>
        <p class="wp-set-status" data-test="settings-update-status" :data-update="hasUpdate ? 'true' : 'false'">{{ updateStatus }}</p>
        <p class="wp-set-status__sub">Last checked · {{ lastCheckedLabel }}</p>
      </template>
      <Button variant="secondary" :loading="checking" data-test="settings-check-now" @click="checkNow">Check now</Button>
    </SettingRow>
    <SettingRow
      label="Open What's new after an update"
      hint="The first time the manager opens on a new version, show what changed. Once per version."
      setting-key="whats-new"
    >
      <Toggle
        :model-value="ui.whatsNewAfterUpdate"
        aria-label="Open What's new after an update"
        data-test="settings-whats-new"
        @update:model-value="ui.setWhatsNewAfterUpdate($event)"
      />
    </SettingRow>
  </SettingGroup>
</template>

<style scoped>
.wp-set-about {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--wp-space-3) var(--wp-space-6);
  font-size: var(--wp-text-sm);
  align-items: center;
}
.wp-set-about__link {
  color: var(--wp-accent-text);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
}
.wp-set-about__link:hover { color: var(--wp-text); }
.wp-set-status { margin: 3px 0 0; font-size: 12px; color: var(--wp-text-muted); }
.wp-set-status[data-update="true"] { color: var(--wp-accent-text); font-weight: 600; }
.wp-set-status__sub { margin: 2px 0 0; font-size: 12px; color: var(--wp-text-dim); }
</style>
