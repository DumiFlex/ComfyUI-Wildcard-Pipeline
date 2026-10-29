<script setup lang="ts">
/**
 * Kbd: a keyboard shortcut drawn as keys. `Mod` reads ⌘ on a Mac and Ctrl
 * elsewhere (from `platform-keys.ts`), so one string fits everyone. Works on
 * the canvas and in the manager.
 *
 *   <Kbd keys="Mod+K" />
 *   <Kbd :keys="['Shift', 'Enter']" />
 *
 * Screen readers hear the whole chord once ("Control plus K"); the key caps
 * themselves are hidden from them.
 */
import { computed } from "vue";
import { isApplePlatform } from "./platform-keys";

const props = withDefaults(defineProps<{
  /** "Mod+Shift+P" or ["Mod", "Shift", "P"]. */
  keys: string | string[];
  size?: "sm" | "md";
}>(), { size: "md" });

const MAC: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Enter: "↵" };
const SPOKEN: Record<string, string> = {
  "⌘": "Command", Ctrl: "Control", "⌃": "Control", Alt: "Alt", "⌥": "Option", Shift: "Shift", "⇧": "Shift",
  Enter: "Enter", "↵": "Enter", Esc: "Escape", "↑": "Up", "↓": "Down", "←": "Left", "→": "Right",
};

const caps = computed(() => {
  const list = Array.isArray(props.keys) ? props.keys : props.keys.split(/\+(?!$)/);
  const mac = isApplePlatform();
  return list.map((k) => k.trim()).filter(Boolean).map((k) => (k === "Mod" ? (mac ? "⌘" : "Ctrl") : mac ? MAC[k] ?? k : k));
});
const spoken = computed(() => caps.value.map((k) => SPOKEN[k] ?? k).join(" plus "));
</script>

<template>
  <kbd class="wp-kbd-keys" :data-size="size" :aria-label="spoken">
    <template v-for="(k, i) in caps" :key="i">
      <span v-if="i > 0" class="wp-kbd-keys__plus" aria-hidden="true">+</span>
      <kbd class="wp-kbd-keys__cap" aria-hidden="true">{{ k }}</kbd>
    </template>
  </kbd>
</template>

<style scoped>
.wp-kbd-keys { display: inline-flex; align-items: center; gap: 2px; font: inherit; vertical-align: baseline; }
.wp-kbd-keys__plus { color: var(--wp-text-dim); font-size: var(--wp-text-xs); }
.wp-kbd-keys__cap {
  display: inline-grid; place-items: center; box-sizing: border-box;
  min-width: 20px; height: 20px; padding: 0 5px;
  border: 1px solid var(--wp-border-strong); border-bottom-width: 2px; border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-2); color: var(--wp-text-muted);
  font: 500 11px/1 var(--wp-font-mono); white-space: nowrap;
}
.wp-kbd-keys[data-size="sm"] .wp-kbd-keys__cap { min-width: 16px; height: 16px; padding: 0 3px; font-size: 10px; }
</style>
