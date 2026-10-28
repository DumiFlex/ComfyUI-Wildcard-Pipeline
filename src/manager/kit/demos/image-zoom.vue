<script setup lang="ts">
import { ref } from "vue";
import WpButton from "@/components/shared/WpButton.vue";
import WpImageZoom from "@/components/shared/WpImageZoom.vue";

/** A big test picture with fine print, so 100% and 200% show something Fit can't. */
function picture(hue: number): string {
  const cells: string[] = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 16; x++) {
      const l = (x + y) % 2 ? 30 : 42;
      cells.push(`<rect x="${x * 100}" y="${y * 100}" width="100" height="100" fill="hsl(${hue} 45% ${l}%)"/>`);
      cells.push(`<text x="${x * 100 + 8}" y="${y * 100 + 18}" font-size="11" fill="#fff" font-family="monospace">${x},${y}</text>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">${cells.join("")}<text x="800" y="520" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">1600 × 1000</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const pictures = [picture(220), picture(150), picture(20)];
const at = ref(0);
const zoom = ref<number | null>(null);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <p class="wp-kit__caption">Scroll to zoom toward the pointer, drag to move, double-click for 100%. Step to the next picture: the level and spot stay. Zoomed in, the mini-map shows where you are; keep the mouse still and the bar fades.</p>
    <div class="wp-kit-zoom wp-kit-zoom--tall">
      <WpImageZoom
        v-model:zoom="zoom"
        :src="pictures[at]"
        :alt="`Test picture ${at + 1}`"
        hint="Drag to move · scroll to zoom"
        minimap
        autohide
      >
        <template #bar-end>
          <WpButton variant="ghost" icon="pi-chevron-right" aria-label="Next picture" @click="at = (at + 1) % pictures.length" />
        </template>
      </WpImageZoom>
    </div>
    <p class="wp-kit__caption">Level: {{ zoom === null ? "Fit" : `${Math.round(zoom * 100)}%` }}. With a second picture (synced compare): both sides move together.</p>
    <div class="wp-kit-zoom wp-kit-zoom--tall">
      <WpImageZoom :src="pictures[0]" :second="pictures[1]" alt="Test picture 1" second-alt="Test picture 2" minimap>
        <template #first><span class="wp-kit-zoom__cap">1</span></template>
        <template #second><span class="wp-kit-zoom__cap">2</span></template>
      </WpImageZoom>
    </div>
    <p class="wp-kit__caption">Without a bar (controls off), md size:</p>
    <div class="wp-kit-zoom">
      <WpImageZoom :src="pictures[2]" :controls="false" size="md" alt="Test picture" />
    </div>
  </div>
</template>

<style scoped>
.wp-kit-zoom { height: 200px; }
.wp-kit-zoom--tall { height: 320px; }
.wp-kit-zoom__cap { position: absolute; left: 8px; bottom: 8px; padding: 1px 6px; border-radius: 3px; background: rgb(0 0 0 / 0.6); color: white; font-size: 11px; }
</style>
