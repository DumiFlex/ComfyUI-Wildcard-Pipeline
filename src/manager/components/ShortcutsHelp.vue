<script setup lang="ts">
/**
 * ShortcutsHelp — modal cheatsheet of every global keyboard shortcut.
 *
 * Triggered by Cmd/Ctrl + / from anywhere in the SPA, or via the
 * "Show keyboard shortcuts" command-palette entry. The modal itself is
 * a thin wrapper around `<Modal>` so it inherits Esc-to-close and
 * backdrop-click semantics.
 *
 * Each group is just a static array of `{label, keys[]}` rows. Keys
 * render as `<kbd>` chips. Platform-aware: shows ⌘ on macOS, Ctrl
 * elsewhere, since the global shortcut handlers honor either modifier.
 */
import { computed } from "vue";
import Modal from "./ui/Modal.vue";

interface Props {
  open: boolean;
}
defineProps<Props>();
const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
}>();

const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/i.test(navigator.platform);
const mod = computed(() => (isMac ? "⌘" : "Ctrl"));

interface Shortcut {
  label: string;
  keys: string[];
}

const groups = computed<Array<{ label: string; rows: Shortcut[] }>>(() => [
  {
    label: "Global",
    rows: [
      { label: "Open command palette", keys: [mod.value, "K"] },
      { label: "Show this shortcut sheet", keys: [mod.value, "/"] },
      { label: "Toggle sidebar", keys: [mod.value, "B"] },
      { label: "Skip to main content (focused)", keys: ["Tab"] },
    ],
  },
  {
    label: "Editors",
    rows: [
      { label: "Save", keys: [mod.value, "S"] },
      { label: "Cancel / back to list", keys: ["Esc"] },
    ],
  },
  {
    label: "Test Runner",
    rows: [
      { label: "Run module", keys: [mod.value, "Enter"] },
    ],
  },
  {
    label: "Lists",
    rows: [
      { label: "Focus row above / below", keys: ["↑", "↓"] },
      { label: "Open focused row", keys: ["Enter"] },
      { label: "Toggle row selection", keys: ["Space"] },
    ],
  },
]);
</script>

<template>
  <Modal
    :open="open"
    title="Keyboard shortcuts"
    size="md"
    data-test="shortcuts-help"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="wp-shortcuts">
      <section
        v-for="group in groups"
        :key="group.label"
        class="wp-shortcuts__group"
      >
        <h4 class="wp-shortcuts__group-title">{{ group.label }}</h4>
        <dl class="wp-shortcuts__list">
          <template v-for="row in group.rows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>
              <kbd v-for="(k, i) in row.keys" :key="i" class="wp-kbd">{{ k }}</kbd>
            </dd>
          </template>
        </dl>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.wp-shortcuts {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6);
}
.wp-shortcuts__group-title {
  margin: 0 0 var(--wp-space-3);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
}
.wp-shortcuts__list {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--wp-space-3) var(--wp-space-5);
  margin: 0;
  align-items: center;
}
.wp-shortcuts__list dt {
  font-size: var(--wp-text-sm);
  color: var(--wp-text);
}
.wp-shortcuts__list dd {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
