<script setup lang="ts">
/**
 * Browser preferences card — extracted from the legacy Storage card
 * in Settings.vue. Lists every per-device pref the reset wipes and
 * fixes the dot-prefix bug (wp.releaseCheck used to survive).
 */
import { ref } from "vue";
import Button from "../ui/Button.vue";
import Card from "../ui/Card.vue";
import ConfirmDialog from "../../../components/shared/ConfirmDialog.vue";

interface ResetItem {
  label: string;
  hint: string;
}

const RESET_ITEMS: ResetItem[] = [
  { label: "Theme",                    hint: "dark / light / auto" },
  { label: "Density",                  hint: "comfortable / compact" },
  { label: "Wildcard ref depth",       hint: "@{uuid} recursion limit" },
  { label: "Accent palette tweaks",    hint: "topbar tweaks panel" },
  { label: "List filters and sort",    hint: "Wildcards / Combines / etc." },
  { label: "Recently opened items",    hint: "sidebar recents" },
  { label: "Starter onboarding state", hint: "first-run helpers" },
  { label: "Release-check cache",      hint: "24h GitHub lookup cache" },
];

const confirmOpen = ref(false);

function openConfirm(): void { confirmOpen.value = true; }

function doReset(): void {
  // Match every wp- AND every wp. prefix. The dash-only loop in the
  // legacy code missed wp.releaseCheck.
  const toClear: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith("wp-") || key.startsWith("wp."))) {
      toClear.push(key);
    }
  }
  for (const k of toClear) localStorage.removeItem(k);
  confirmOpen.value = false;
  window.location.reload();
}

function cancelReset(): void { confirmOpen.value = false; }
</script>

<template>
  <Card title="Browser preferences">
    <p class="wp-bp__hint">
      These per-device preferences live in your browser's
      <span class="wp-mono">localStorage</span>. Resetting clears them on
      this device only — modules, categories, and other data remain untouched.
    </p>

    <p class="wp-bp__heading">Reset will clear:</p>
    <ul class="wp-bp__list">
      <li
        v-for="item in RESET_ITEMS"
        :key="item.label"
        data-test="reset-item"
      >
        <strong>{{ item.label }}</strong>
        <span class="wp-bp__hint-inline"> — {{ item.hint }}</span>
      </li>
    </ul>

    <Button
      variant="ghost"
      icon="pi-refresh"
      data-test="browser-prefs-reset"
      @click="openConfirm"
    >Reset preferences</Button>

    <ConfirmDialog
      :visible="confirmOpen"
      title="Reset browser preferences?"
      body="Clears theme, density, filters, recents, and other per-device settings. The page will reload."
      confirm-label="Reset"
      variant="danger"
      @confirm="doReset"
      @cancel="cancelReset"
    />
  </Card>
</template>

<style scoped>
.wp-bp__hint {
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  margin: 0 0 var(--wp-space-5);
}
.wp-bp__heading {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  margin: var(--wp-space-5) 0 var(--wp-space-3);
  font-weight: 500;
}
.wp-bp__list {
  list-style: disc;
  padding-left: var(--wp-space-6);
  margin: 0 0 var(--wp-space-6);
  font-size: var(--wp-text-sm);
  color: var(--wp-text);
}
.wp-bp__list li { padding: 2px 0; }
.wp-bp__hint-inline { color: var(--wp-text-dim); }
</style>
