<template>
  <div class="wp-asm-preview-root">
    <div v-if="upstreamVariables.length" class="wp-asm-section">
      <label class="wp-asm-label">VARIABLES</label>
      <div class="wp-asm-chips">
        <button
          v-for="v in upstreamVariables"
          :key="v"
          type="button"
          class="wp-asm-chip"
          :class="isUsed(v) ? 'used' : 'available'"
          :title="`Click to append $${v} to template`"
          @click="$emit('appendVariable', v)"
        >
          ${{ v }}
        </button>
      </div>
    </div>

    <div v-else class="wp-asm-section wp-asm-empty">
      <span class="wp-asm-empty-text">Connect a Wildcard Pipeline to see available variables</span>
    </div>

    <div v-if="template" class="wp-asm-section">
      <label class="wp-asm-label">
        PREVIEW<span v-if="hasResolved" class="wp-asm-seed"> · seed 42</span>
      </label>
      <div class="wp-asm-rendered" v-html="previewHtml"></div>
    </div>

    <div v-if="missingVars.length" class="wp-asm-section">
      <label class="wp-asm-label wp-asm-label-warn">UNRESOLVED</label>
      <div class="wp-asm-chips">
        <span v-for="v in missingVars" :key="v" class="wp-asm-chip missing">
          ${{ v }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  upstreamVariables: string[];
  template: string;
  resolvedValues?: Record<string, string>;
}>();

defineEmits<{
  (e: "appendVariable", varName: string): void;
}>();

const ESCAPE_PLACEHOLDER = "\uFFFD\uFFFD";
const ESCAPE_RE = /\uFFFD\uFFFD/g;

const templateVars = computed(() => {
  const sanitized = props.template.replace(/\$\$/g, ESCAPE_PLACEHOLDER);
  const matches = sanitized.match(/\$(\w+)/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1)).filter((v) => !v.startsWith("__")))];
});

const isUsed = (name: string) => templateVars.value.includes(name);

const missingVars = computed(() =>
  templateVars.value.filter((v) => !props.upstreamVariables.includes(v)),
);

const hasResolved = computed(() =>
  props.resolvedValues != null && Object.keys(props.resolvedValues).length > 0,
);

const previewHtml = computed(() => {
  const escaped = props.template.replace(/\$\$/g, ESCAPE_PLACEHOLDER);
  const resolved = props.resolvedValues ?? {};
  const highlighted = escaped.replace(/\$(\w+)/g, (_match, name: string) => {
    if (name.startsWith("__")) return _match;
    if (name in resolved) {
      return `<span class="wp-tok-resolved">${resolved[name]}</span>`;
    }
    const cls = props.upstreamVariables.includes(name) ? "wp-tok-ok" : "wp-tok-miss";
    return `<span class="${cls}">$${name}</span>`;
  });
  return highlighted.replace(ESCAPE_RE, "$");
});
</script>

<style>
@import "../pipeline/widget-theme.css";
</style>

<style scoped>
.wp-asm-preview-root,
.wp-asm-preview-root * {
  box-sizing: border-box;
}

.wp-asm-preview-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
}

.wp-asm-section {
  padding: 8px 10px;
}

.wp-asm-section + .wp-asm-section {
  border-top: 1px solid var(--wp-border);
}

.wp-asm-label {
  font-size: 9px;
  font-family: var(--wp-font-mono, monospace);
  color: var(--wp-text3);
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  display: block;
}

.wp-asm-seed {
  color: var(--wp-text3);
  opacity: 0.6;
}

.wp-asm-label-warn {
  color: var(--wp-amber);
}

.wp-asm-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.wp-asm-chip {
  font-size: 10px;
  font-family: var(--wp-font-mono, monospace);
  padding: 2px 7px;
  border-radius: 3px;
  user-select: none;
  border: none;
  transition: background 0.12s, color 0.12s;
}

.wp-asm-chip.available {
  background: var(--wp-accent-glow);
  color: var(--wp-accent);
  cursor: pointer;
}

.wp-asm-chip.available:hover {
  background: rgba(78, 148, 206, 0.25);
}

.wp-asm-chip.used {
  background: var(--wp-green-bg);
  color: var(--wp-green);
  cursor: pointer;
}

.wp-asm-chip.used:hover {
  background: rgba(107, 201, 111, 0.2);
}

.wp-asm-chip.missing {
  background: var(--wp-amber-bg);
  color: var(--wp-amber);
  cursor: default;
}

.wp-asm-rendered {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 6px 8px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  line-height: 1.6;
  color: var(--wp-text2);
  word-break: break-word;
}

.wp-asm-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
}

.wp-asm-empty-text {
  color: var(--wp-text3);
  font-size: 11px;
  font-style: italic;
}
</style>

<style>
.wp-tok-ok {
  color: var(--wp-green, #6bc96f);
  background: var(--wp-green-bg, rgba(107, 201, 111, 0.1));
  padding: 1px 3px;
  border-radius: 3px;
}

.wp-tok-miss {
  color: var(--wp-amber, #d4a843);
  background: var(--wp-amber-bg, rgba(212, 168, 67, 0.1));
  padding: 1px 3px;
  border-radius: 3px;
  text-decoration: underline wavy;
}

.wp-tok-resolved {
  color: var(--wp-accent, #4e94ce);
  background: var(--wp-accent-glow, rgba(78, 148, 206, 0.12));
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 500;
}
</style>
