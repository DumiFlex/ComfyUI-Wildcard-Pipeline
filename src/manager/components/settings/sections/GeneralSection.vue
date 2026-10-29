<script setup lang="ts">
import { computed } from "vue";
import Toggle from "../../ui/Toggle.vue";
import Button from "../../ui/Button.vue";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import { useUiStore } from "../../../stores/uiStore";
import { useReleaseCheck } from "../../../composables/useReleaseCheck";

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

</script>

<template>
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

  <SettingGroup title="Privacy">
    <SettingRow
      label="Share anonymous usage stats"
      hint="The Community tab tells the community site which pages you open and when you install, publish or sign in. No cookies, no account details. Do Not Track also turns it off."
      setting-key="usage-stats"
    >
      <Toggle
        :model-value="ui.usageStats"
        aria-label="Share anonymous usage stats"
        data-test="settings-usage-stats"
        @update:model-value="ui.setUsageStats($event)"
      />
    </SettingRow>
  </SettingGroup>
</template>

<style scoped>
.wp-set-status { margin: 3px 0 0; font-size: 12px; color: var(--wp-text-muted); }
.wp-set-status[data-update="true"] { color: var(--wp-accent-text); font-weight: 600; }
.wp-set-status__sub { margin: 2px 0 0; font-size: 12px; color: var(--wp-text-dim); }
</style>
