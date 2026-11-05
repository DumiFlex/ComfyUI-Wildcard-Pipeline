<script setup lang="ts">
/**
 * DocAnnotated — a node picture with numbered pins on its fields and a
 * legend under it. The pins come from `docs/pins/<image>.json` (written with
 * the picture by `scripts/docs-shots/shoot.mjs`), the legend text from the
 * node's field list (`docs/node-fields.ts`), so the two can't drift apart.
 */
import { computed } from "vue";
import DocImage from "./DocImage.vue";
import { firstSentence, numberedPins } from "../../docs/pins";

const props = withDefaults(
  defineProps<{
    src: string;
    caption: string;
    alt?: string | undefined;
    ratio?: string | undefined;
  }>(),
  { alt: undefined, ratio: "16 / 9" },
);

/** Height over width, from a `"W / H"` ratio. */
const aspect = computed(() => {
  const [w, h] = props.ratio.split("/").map((n) => Number(n.trim()));
  return w && h ? h / w : 0.5;
});
const pins = computed(() => numberedPins(props.src, aspect.value));
</script>

<template>
  <div class="wp-doc-ann">
    <DocImage :src="src" :caption="caption" :alt="alt" :ratio="ratio">
      <template #overlay>
        <div class="wp-doc-ann__layer" aria-hidden="true">
          <span
            v-for="p in pins"
            :key="p.n"
            class="wp-doc-ann__pin"
            :style="{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }"
            data-test="doc-pin"
          >{{ p.n }}</span>
        </div>
      </template>
    </DocImage>
    <ol v-if="pins.length" class="wp-doc-ann__legend" data-test="doc-pin-legend">
      <li
        v-for="p in pins"
        :key="p.n"
        class="wp-doc-ann__row"
      >
        <span class="wp-doc-ann__num" aria-hidden="true">{{ p.n }}</span>
        <span class="wp-doc-ann__text">
          <span class="wp-doc-ann__term">{{ p.term }}</span>
          <span class="wp-doc-ann__desc">{{ firstSentence(p.field.desc) }}</span>
        </span>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.wp-doc-ann { display: flex; flex-direction: column; gap: 12px; }
/* Inside the picture's 1px border, so 0–100% is the image itself. */
.wp-doc-ann__layer { position: absolute; inset: 1px; pointer-events: none; }
.wp-doc-ann__pin {
  position: absolute;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  box-sizing: border-box;
  border: 2px solid var(--wp-bg-1);
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-accent-500);
  color: var(--wp-on-accent);
  font: 700 11px/1 var(--wp-font-sans);
  box-shadow: var(--wp-shadow-sm);
}
.wp-doc-ann__legend {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 6px 18px;
}
.wp-doc-ann__row {
  display: grid;
  grid-template-columns: 18px 1fr;
  align-items: start;
  gap: 8px;
  padding: 4px 6px;
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  font-size: 12.5px;
  line-height: 1.45;
}
.wp-doc-ann__num {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-accent-500);
  color: var(--wp-on-accent);
  font: 700 10px/1 var(--wp-font-sans);
  margin-top: 1px;
}
.wp-doc-ann__text { min-width: 0; }
.wp-doc-ann__term { font-weight: 600; color: var(--wp-text); margin-right: 6px; }
.wp-doc-ann__desc { color: var(--wp-text-muted); }
</style>
