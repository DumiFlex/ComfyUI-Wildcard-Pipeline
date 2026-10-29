<script setup lang="ts">
/**
 * Avatar: a person's picture, or their initials on a colour picked from
 * their name when there is no picture (or it fails to load). For community
 * authors, chat participants and history entries. Works on the canvas and
 * in the manager.
 *
 *   <Avatar name="Dumi Flex" :src="author.avatar_url" />
 *   <Avatar name="Pack bot" icon="pi-box" size="sm" />
 *
 * The name is the image's alt text; with `decorative` (the name is already
 * written beside it) screen readers skip it.
 */
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  name: string;
  src?: string | null;
  /** A PrimeIcons class to draw instead of initials. */
  icon?: string;
  size?: "sm" | "md" | "lg";
  shape?: "circle" | "square";
  /** The name is written next to it already. */
  decorative?: boolean;
}>(), { src: null, icon: undefined, size: "md", shape: "circle" });

const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });

const initials = computed(() => {
  const words = props.name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? "" : "";
  return (first + last).toUpperCase();
});

const HUES = [
  "var(--wp-var-1)", "var(--wp-var-2)", "var(--wp-var-3)", "var(--wp-var-4)",
  "var(--wp-var-5)", "var(--wp-var-6)", "var(--wp-var-7)", "var(--wp-var-8)",
];

/** One of the eight variable colours, the same for the same name every time. */
const hue = computed(() => {
  let h = 0;
  for (const ch of props.name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return HUES[h % 8];
});
</script>

<template>
  <span
    class="wp-avatar"
    :data-size="size"
    :data-shape="shape"
    :style="{ '--_hue': hue }"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : name"
    :aria-hidden="decorative ? 'true' : undefined"
  >
    <img v-if="src && !failed" class="wp-avatar__img" :src="src" alt="" @error="failed = true">
    <i v-else-if="icon" class="pi wp-avatar__icon" :class="icon" aria-hidden="true" />
    <span v-else class="wp-avatar__initials" aria-hidden="true">{{ initials }}</span>
  </span>
</template>

<style scoped>
.wp-avatar {
  --_s: var(--wp-control-h-md);
  position: relative; display: inline-grid; place-items: center; flex: none; overflow: hidden;
  width: var(--_s); height: var(--_s); border-radius: 50%; /* round: avatar */
  background: color-mix(in srgb, var(--_hue) 22%, var(--wp-bg-2));
  color: color-mix(in srgb, var(--_hue) 70%, var(--wp-text));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_hue) 30%, transparent);
  font: 600 calc(var(--_s) * 0.4)/1 var(--wp-font-sans); letter-spacing: 0.02em; user-select: none;
}
.wp-avatar[data-size="sm"] { --_s: var(--wp-control-h-sm); }
.wp-avatar[data-size="lg"] { --_s: var(--wp-control-h-lg); }
.wp-avatar[data-shape="square"] { border-radius: var(--wp-radius); }
.wp-avatar[data-size="sm"][data-shape="square"] { border-radius: var(--wp-radius-sm); }
.wp-avatar__img { width: 100%; height: 100%; object-fit: cover; }
.wp-avatar__icon { font-size: calc(var(--_s) * 0.45); }
</style>
