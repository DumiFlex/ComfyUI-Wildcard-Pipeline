<script setup lang="ts">
import { ref } from "vue";
import Button from "../../ui/Button.vue";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import BrowserPrefsCard from "../BrowserPrefsCard.vue";
import { useToast } from "../../../composables/useToast";
import {
  SettingsFileError,
  applySettingsFile,
  buildSettingsFile,
  downloadJson,
  parseSettingsFile,
} from "../../../utils/settings-transfer";

const toast = useToast();
const exporting = ref(false);
const importing = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

async function exportSettings(): Promise<void> {
  exporting.value = true;
  try {
    const file = await buildSettingsFile(__APP_VERSION__);
    const day = new Date().toISOString().slice(0, 10);
    downloadJson(`wildcard-pipeline-settings-${day}.json`, file);
  } finally {
    exporting.value = false;
  }
}

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = "";
  if (!f) return;
  importing.value = true;
  try {
    const parsed = parseSettingsFile(await f.text());
    const s = await applySettingsFile(parsed);
    toast.push({
      severity: "success",
      summary: "Settings imported",
      detail: `${s.browser} manager, ${s.canvas} canvas${s.server ? ", server" : ""} settings. Reloading…`,
      life: 3000,
    });
    // Stores read their values once at start-up; a reload is the honest way
    // to show every imported value at once.
    window.setTimeout(() => window.location.reload(), 900);
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not import settings",
      detail: err instanceof SettingsFileError ? err.message : err instanceof Error ? err.message : undefined,
      life: 6000,
    });
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <SettingGroup title="Move settings between machines">
    <SettingRow
      label="Export settings"
      hint="Save every preference to a JSON file: this page, the canvas nodes' settings and the server settings. Your library is not included; use Import / Export for that."
      setting-key="export-settings"
    >
      <Button variant="secondary" icon="pi-download" :loading="exporting" data-test="settings-export" @click="exportSettings">
        Export
      </Button>
    </SettingRow>
    <SettingRow
      label="Import settings"
      hint="Load a settings file. Anything it does not mention stays as it is. The page reloads afterwards."
      setting-key="import-settings"
    >
      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        aria-label="Settings file to import"
        class="wp-set-file"
        data-test="settings-import-input"
        @change="onFile"
      >
      <Button variant="secondary" icon="pi-upload" :loading="importing" data-test="settings-import" @click="fileInput?.click()">
        Import…
      </Button>
    </SettingRow>
  </SettingGroup>

  <div id="reset-prefs" data-setting="reset-prefs" class="wp-set-adv__reset">
    <BrowserPrefsCard />
  </div>
</template>

<style scoped>
.wp-set-file { display: none; }
.wp-set-adv__reset { scroll-margin-top: 80px; }
</style>
