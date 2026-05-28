<script setup lang="ts">
/**
 * DocFlow — a reusable, data-driven flow diagram for the docs.
 *
 * Renders a horizontal row of rounded node "boxes" (icon + name + optional
 * mono sub-label) connected by labelled arrows, mirroring the visual language
 * of PipelineDiagram. Each box is tinted by its `tone` via `toneVar`, exposed
 * as the `--wp-doc-flow-tone` custom property so the border + icon pick it up.
 *
 * Stages wrap gracefully on narrow widths. Arrows are decorative
 * (aria-hidden); the boxes carry the meaning.
 */
import { type DocTone, toneVar } from "../../docs/registry";

export interface DocFlowStage {
  /** PrimeIcons class, e.g. "pi pi-sitemap". */
  icon: string;
  /** Short node/stage name. */
  name: string;
  /** Optional small mono sub-label under the name. */
  sub?: string;
  /** Colors the box border + icon. Defaults to "neutral" (muted). */
  tone?: DocTone;
}

const props = defineProps<{
  stages: DocFlowStage[];
  /** Label between stage i and i+1. Missing/empty = connector with no label. */
  arrows?: string[];
  /** Optional dim caption centered below the flow. */
  caption?: string;
}>();

function boxStyle(stage: DocFlowStage): Record<string, string> {
  return { "--wp-doc-flow-tone": toneVar(stage.tone ?? "neutral") };
}

function arrowLabel(index: number): string {
  return props.arrows?.[index] ?? "";
}
</script>

<template>
  <div class="wp-doc-flow">
    <div class="wp-doc-flow__row">
      <template v-for="(stage, i) in props.stages" :key="i">
        <div class="wp-doc-flow__stage">
          <div class="wp-doc-flow__box" :style="boxStyle(stage)">
            <span class="wp-doc-flow__ico"><i :class="stage.icon" aria-hidden="true"></i></span>
            <span class="wp-doc-flow__name">{{ stage.name }}</span>
            <span v-if="stage.sub" class="wp-doc-flow__sub">{{ stage.sub }}</span>
          </div>
        </div>
        <div
          v-if="i < props.stages.length - 1"
          class="wp-doc-flow__arrow"
          aria-hidden="true"
        >
          <span v-if="arrowLabel(i)" class="wp-doc-flow__arrow-lbl">{{ arrowLabel(i) }}</span>
          <span class="wp-doc-flow__arrow-ln"></span>
        </div>
      </template>
    </div>
    <div v-if="props.caption" class="wp-doc-flow__cap">{{ props.caption }}</div>
  </div>
</template>

<style scoped>
.wp-doc-flow {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wp-doc-flow__row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px 4px;
}
.wp-doc-flow__stage {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.wp-doc-flow__box {
  min-width: 120px;
  padding: 11px 13px;
  border-radius: 10px;
  background: var(--wp-bg-2);
  /* `--wp-doc-flow-tone` is set per-box from the stage tone; fall back to the
   * standard strong border when (somehow) unset. */
  border: 1px solid color-mix(in oklab, var(--wp-doc-flow-tone, var(--wp-border-strong)) 55%, transparent);
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: center;
}
.wp-doc-flow__ico {
  font-size: 16px;
  color: var(--wp-doc-flow-tone, var(--wp-text-muted));
}
.wp-doc-flow__name { font-size: 12px; font-weight: 600; }
.wp-doc-flow__sub { font-family: var(--wp-font-mono); font-size: 9.5px; color: var(--wp-text-dim); }
.wp-doc-flow__arrow {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--wp-text-dim);
  padding: 0 4px;
  min-width: 46px;
}
.wp-doc-flow__arrow-lbl {
  font-size: 9.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 5px;
  color: var(--wp-text-dim);
}
.wp-doc-flow__arrow-ln {
  height: 2px;
  width: 100%;
  background: linear-gradient(90deg, transparent, var(--wp-border-strong) 20%, var(--wp-border-strong) 80%, transparent);
  position: relative;
  display: block;
}
.wp-doc-flow__arrow-ln::after {
  content: "";
  position: absolute;
  right: 0;
  top: -3px;
  border: 4px solid transparent;
  border-left-color: var(--wp-border-strong);
}
.wp-doc-flow__cap {
  text-align: center;
  font-size: 11.5px;
  color: var(--wp-text-dim);
}
</style>
