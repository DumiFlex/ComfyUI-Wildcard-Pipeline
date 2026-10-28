<script setup lang="ts">
/**
 * The design tokens on the kit page: colours (with the value they resolve to
 * in the current theme), type sizes, spacing and radii. Read live from the
 * document, so a theme or accent change shows at once.
 */
import { onMounted, ref, watch } from "vue";
import { useUiStore } from "../stores/uiStore";
import { useTweaksStore } from "../stores/tweaksStore";

interface Swatch { token: string; label: string }

const GROUPS: { title: string; note: string; swatches: Swatch[] }[] = [
  {
    title: "Surfaces and text",
    note: "Page, raised surfaces from low to high, and three text levels. Text never goes below text-dim.",
    swatches: [
      { token: "--wp-bg", label: "page" }, { token: "--wp-bg-1", label: "surface 1" },
      { token: "--wp-bg-2", label: "surface 2" }, { token: "--wp-bg-3", label: "surface 3" },
      { token: "--wp-bg-4", label: "surface 4" }, { token: "--wp-border", label: "border" },
      { token: "--wp-border-strong", label: "border strong" }, { token: "--wp-text", label: "text" },
      { token: "--wp-text-muted", label: "text muted" }, { token: "--wp-text-dim", label: "text dim" },
    ],
  },
  {
    title: "Accent",
    note: "The one accent. Fills use 600, text on a surface uses accent-text, focus rings use the focus token.",
    swatches: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"].map((n) => ({ token: `--wp-accent-${n}`, label: n })),
  },
  {
    title: "Status",
    note: "Meaning, never decoration. Pair each with words or an icon.",
    swatches: [
      { token: "--wp-success", label: "success" }, { token: "--wp-warn", label: "warn" },
      { token: "--wp-danger", label: "danger" }, { token: "--wp-info", label: "info" },
      { token: "--wp-node", label: "resolved" },
    ],
  },
  {
    title: "Module kinds",
    note: "One colour per kind, the same on the canvas, in the manager and on the community site.",
    swatches: [
      { token: "--wp-kind-wildcard", label: "wildcard" }, { token: "--wp-kind-fixed", label: "fixed values" },
      { token: "--wp-kind-combine", label: "combine" }, { token: "--wp-kind-derivation", label: "derivation" },
      { token: "--wp-kind-constraint", label: "constraint" }, { token: "--wp-kind-ref", label: "reference" },
    ],
  },
  {
    title: "Variables",
    note: "A $variable keeps its colour everywhere it shows (var-color.ts picks one of eight by name).",
    swatches: ["1", "2", "3", "4", "5", "6", "7", "8"].map((n) => ({ token: `--wp-var-${n}`, label: `var ${n}` })),
  },
];

const TYPE = [
  { token: "--wp-text-xs", label: "xs: labels and hints, the smallest size" },
  { token: "--wp-text-sm", label: "sm: secondary text, table cells" },
  { token: "--wp-text-base", label: "base: body text" },
  { token: "--wp-text-md", label: "md: entry names, card titles" },
  { token: "--wp-text-lg", label: "lg: section titles" },
  { token: "--wp-text-xl", label: "xl: page titles" },
];
const SPACE = ["1", "2", "3", "4", "5", "6", "7", "8"].map((n) => `--wp-space-${n}`);
const RADII = ["--wp-radius-sm", "--wp-radius-md", "--wp-radius-lg", "--wp-radius-xl"];

const values = ref<Record<string, string>>({});

function read(): void {
  if (typeof document === "undefined") return;
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  const all = [...GROUPS.flatMap((g) => g.swatches.map((s) => s.token)), ...TYPE.map((t) => t.token), ...SPACE, ...RADII];
  for (const t of all) out[t] = cs.getPropertyValue(t).trim();
  values.value = out;
}

const ui = useUiStore();
const tweaks = useTweaksStore();
onMounted(read);
// The theme class flips on <html> right after the store changes; read a tick later.
watch(() => [ui.resolvedTheme, tweaks.accent, tweaks.customHex], () => window.setTimeout(read, 0));
</script>

<template>
  <section id="kit-tokens" class="wp-kit-tokens" data-kit-section="tokens">
    <div v-for="g in GROUPS" :key="g.title" class="wp-kit-tokens__group">
      <h3 class="wp-kit-tokens__title">{{ g.title }}</h3>
      <p class="wp-kit-tokens__note">{{ g.note }}</p>
      <ul class="wp-kit-tokens__swatches">
        <li v-for="s in g.swatches" :key="s.token" class="wp-kit-swatch">
          <span class="wp-kit-swatch__chip" :style="{ background: `var(${s.token})` }" />
          <span class="wp-kit-swatch__label">{{ s.label }}</span>
          <code class="wp-kit-swatch__token">{{ s.token }}</code>
          <code class="wp-kit-swatch__value">{{ values[s.token] }}</code>
        </li>
      </ul>
    </div>

    <div class="wp-kit-tokens__group">
      <h3 class="wp-kit-tokens__title">Type</h3>
      <p class="wp-kit-tokens__note">Inter for text, JetBrains Mono for prompt text, variables and ids.</p>
      <div v-for="t in TYPE" :key="t.token" class="wp-kit-type" :style="{ fontSize: `var(${t.token})` }">
        <span>{{ t.label }}</span>
        <code class="wp-kit-swatch__token">{{ t.token }} · {{ values[t.token] }}</code>
      </div>
      <div class="wp-kit-type wp-kit-type--mono">$mood portrait of $subject, @{Hair colour}</div>
    </div>

    <div class="wp-kit-tokens__group">
      <h3 class="wp-kit-tokens__title">Spacing and corners</h3>
      <p class="wp-kit-tokens__note">Use the steps; a gap that needs another number usually needs another layout.</p>
      <div class="wp-kit-space">
        <div v-for="s in SPACE" :key="s" class="wp-kit-space__row">
          <span class="wp-kit-space__bar" :style="{ width: `var(${s})` }" />
          <code class="wp-kit-swatch__token">{{ s }} · {{ values[s] }}</code>
        </div>
      </div>
      <div class="wp-kit-radii">
        <div v-for="r in RADII" :key="r" class="wp-kit-radii__box" :style="{ borderRadius: `var(${r})` }">
          <code class="wp-kit-swatch__token">{{ r.replace("--wp-radius-", "") }} · {{ values[r] }}</code>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wp-kit-tokens { display: flex; flex-direction: column; gap: var(--wp-space-7); }
.wp-kit-tokens__group { display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-kit-tokens__title { margin: 0; font-size: var(--wp-text-md); font-weight: 600; color: var(--wp-text); }
.wp-kit-tokens__note { margin: 0; color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
.wp-kit-tokens__swatches {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--wp-space-4);
}
.wp-kit-swatch { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-kit-swatch__chip { height: 40px; border-radius: var(--wp-radius-md); border: 1px solid var(--wp-border); }
.wp-kit-swatch__label { font-size: var(--wp-text-sm); color: var(--wp-text); font-weight: 500; }
.wp-kit-swatch__token, .wp-kit-swatch__value {
  font: var(--wp-text-xs) / 16px var(--wp-font-mono); color: var(--wp-text-dim); overflow-wrap: anywhere;
}
.wp-kit-type { display: flex; align-items: baseline; gap: var(--wp-space-5); flex-wrap: wrap; color: var(--wp-text); }
.wp-kit-type--mono { font-family: var(--wp-font-mono); font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-kit-space { display: flex; flex-direction: column; gap: var(--wp-space-2); }
.wp-kit-space__row { display: flex; align-items: center; gap: var(--wp-space-4); }
.wp-kit-space__bar { height: 12px; background: var(--wp-accent-500); border-radius: min(2px, var(--wp-radius-cap, 999px)); }
.wp-kit-radii { display: flex; gap: var(--wp-space-5); flex-wrap: wrap; margin-top: var(--wp-space-4); }
.wp-kit-radii__box {
  width: 120px; height: 64px; display: grid; place-items: center;
  background: var(--wp-bg-2); border: 1px solid var(--wp-border-strong);
}
</style>
