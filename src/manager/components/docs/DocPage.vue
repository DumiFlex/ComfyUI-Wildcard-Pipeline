<script setup lang="ts">
import { toneVar, type DocTone } from "../../docs/registry";
const props = defineProps<{ group: string; title: string; icon: string; tone: DocTone; blurb: string; nodeId?: string }>();
</script>

<template>
  <article class="wp-doc-page" :style="{ '--doc-tone': toneVar(props.tone) }">
    <div class="wp-doc-page__crumb">Documentation <span>›</span> <b>{{ group }}</b> <span>›</span> <b>{{ title }}</b></div>
    <header class="wp-doc-page__hero">
      <div class="wp-doc-page__tile"><i :class="icon" aria-hidden="true" /></div>
      <div>
        <div class="wp-doc-page__title-row">
          <h1 class="wp-doc-page__title">{{ title }}</h1>
          <span v-if="nodeId" class="wp-doc-page__idchip">{{ nodeId }}</span>
        </div>
        <p class="wp-doc-page__blurb">{{ blurb }}</p>
      </div>
    </header>
    <div class="wp-doc-page__body"><slot /></div>
  </article>
</template>

<style scoped>
.wp-doc-page { display: flex; flex-direction: column; gap: var(--wp-space-7, 24px); max-width: 860px; }
.wp-doc-page__crumb { display: flex; align-items: center; gap: 7px; color: var(--wp-text-dim); font-size: 11.5px; }
.wp-doc-page__crumb b { color: var(--wp-text-muted); font-weight: 500; }
.wp-doc-page__hero { display: flex; align-items: center; gap: 16px; }
.wp-doc-page__tile {
  width: 52px; height: 52px; border-radius: 13px; display: grid; place-items: center; font-size: 22px;
  color: var(--doc-tone);
  background: color-mix(in oklab, var(--doc-tone) 15%, transparent);
  border: 1px solid color-mix(in oklab, var(--doc-tone) 32%, transparent);
}
.wp-doc-page__title-row { display: flex; align-items: center; gap: 10px; }
.wp-doc-page__title { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
.wp-doc-page__idchip {
  font-family: var(--wp-font-mono); font-size: 11px; color: var(--doc-tone);
  background: color-mix(in oklab, var(--doc-tone) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--doc-tone) 30%, transparent);
  padding: 2px 8px; border-radius: 999px;
}
.wp-doc-page__blurb { color: var(--wp-text-muted); font-size: 13px; margin: 5px 0 0; max-width: 560px; }
.wp-doc-page__body { display: flex; flex-direction: column; gap: var(--wp-space-7, 24px); }
</style>
