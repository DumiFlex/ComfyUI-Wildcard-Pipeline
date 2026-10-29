<script setup lang="ts">
/**
 * Code block: text that must stay as written (JSON, a prompt as sent, a log,
 * a snippet), in the mono font, with a copy button and a wrap switch in its
 * head. Long text scrolls inside `max-height`. Works on the canvas and in the
 * manager.
 *
 *   <CodeBlock :code="json" language="JSON" max-height="240px" />
 *   <CodeBlock :code="log" title="Request" line-numbers v-model:wrap="wrap" />
 *
 * No syntax colours (they cost bundle for little gain here). A block that
 * scrolls can be focused, so the keyboard can scroll it too.
 */
import { computed, ref, watch } from "vue";
import CopyButton from "./CopyButton.vue";
import { vTooltip } from "./tooltip";

const props = withDefaults(defineProps<{
  code: string;
  /** A small tag in the head, e.g. "JSON". */
  language?: string | undefined;
  /** A name in the head, e.g. "Prompt as sent". */
  title?: string | undefined;
  /** Wrap long lines. Bind with v-model:wrap, or leave it to the button. */
  wrap?: boolean | undefined;
  /** Where wrap starts when nobody binds `wrap`. */
  defaultWrap?: boolean | undefined;
  /** CSS max height; the block scrolls past it. */
  maxHeight?: string | undefined;
  lineNumbers?: boolean | undefined;
  /** Leave out the head (copy and wrap). */
  bare?: boolean | undefined;
  size?: "sm" | "md" | undefined;
}>(), { language: undefined, title: undefined, wrap: undefined, maxHeight: undefined, size: "md" });

const emit = defineEmits<{ (e: "update:wrap", v: boolean): void }>();

const own = ref(props.wrap ?? props.defaultWrap ?? false);
watch(() => props.wrap, (v) => { if (v !== undefined) own.value = v; });
const wrapped = computed(() => props.wrap ?? own.value);
function toggleWrap(): void {
  own.value = !wrapped.value;
  emit("update:wrap", own.value);
}

const lines = computed(() => props.code.replace(/\n$/, "").split("\n"));
const name = computed(() => props.title ?? props.language ?? "Code");
</script>

<template>
  <figure class="wp-code" :data-size="size" :data-wrap="wrapped || undefined">
    <figcaption v-if="!bare" class="wp-code__head">
      <span class="wp-code__title">{{ title }}</span>
      <span v-if="language" class="wp-code__lang">{{ language }}</span>
      <span class="wp-code__tools">
        <button
          v-tooltip="wrapped ? 'Don’t wrap lines' : 'Wrap lines'"
          type="button"
          class="wp-code__tool"
          :aria-pressed="wrapped"
          aria-label="Wrap lines"
          @click="toggleWrap"
        ><i class="pi pi-align-left" aria-hidden="true" /></button>
        <CopyButton :text="code" :label="`Copy ${name.toLowerCase() === 'code' ? 'code' : name}`" size="sm" />
      </span>
    </figcaption>
    <pre
      class="wp-code__pre"
      tabindex="0"
      :aria-label="name"
      :style="{ maxHeight }"
    ><code v-if="!lineNumbers" class="wp-code__code">{{ code }}</code><code v-else class="wp-code__code wp-code__code--numbered"><span v-for="(l, i) in lines" :key="i" class="wp-code__line"><span class="wp-code__num" aria-hidden="true">{{ i + 1 }}</span><span class="wp-code__text">{{ l || "\u00a0" }}</span></span></code></pre>
  </figure>
</template>

<style scoped>
.wp-code {
  display: flex; flex-direction: column; min-width: 0; margin: 0;
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius);
  background: var(--wp-bg-1); overflow: hidden;
}
.wp-code__head {
  display: flex; align-items: center; gap: var(--wp-space-3); min-height: 28px;
  padding: 2px var(--wp-space-2) 2px var(--wp-space-4);
  border-bottom: 1px solid var(--wp-border-soft); background: var(--wp-bg-2);
  color: var(--wp-text-muted); font: 500 var(--wp-text-xs)/1.2 var(--wp-font-sans);
}
.wp-code__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wp-text); }
.wp-code__lang {
  padding: 1px 6px; border-radius: var(--wp-radius-sm); background: var(--wp-bg-3);
  font: 600 10px/1.4 var(--wp-font-mono); letter-spacing: 0.04em; text-transform: uppercase;
}
.wp-code__tools { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; }
.wp-code__tool {
  display: inline-grid; place-items: center; width: var(--wp-control-h-sm); height: var(--wp-control-h-sm);
  margin: 0; padding: 0; border: 0; border-radius: var(--wp-radius-sm);
  background: transparent; color: var(--wp-text-muted); cursor: pointer;
}
.wp-code__tool .pi { font-size: 11px; }
.wp-code__tool:hover { background: var(--wp-row-hover); color: var(--wp-text); }
.wp-code__tool[aria-pressed="true"] { color: var(--wp-accent-text); background: var(--wp-bg-3); }
.wp-code__tool:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-code__pre {
  margin: 0; padding: var(--wp-space-4); overflow: auto;
  color: var(--wp-text); font: 400 var(--wp-text-sm)/1.55 var(--wp-font-mono);
  white-space: pre; tab-size: 2;
}
.wp-code[data-size="sm"] .wp-code__pre { padding: var(--wp-space-3); font-size: var(--wp-text-xs); }
.wp-code[data-wrap] .wp-code__pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.wp-code__pre:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--wp-border-focus); }
.wp-code__code { font: inherit; background: none; padding: 0; color: inherit; }
.wp-code__code--numbered { display: table; }
.wp-code__line { display: table-row; }
.wp-code__num {
  display: table-cell; padding-right: var(--wp-space-4); text-align: right;
  color: var(--wp-text-dim); user-select: none; font-variant-numeric: tabular-nums;
}
.wp-code__text { display: table-cell; }
</style>
