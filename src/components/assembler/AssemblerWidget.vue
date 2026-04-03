<template>
  <div class="wp-assembler">
    <!-- Variable chips -->
    <div v-if="variables.length" class="wp-asm-vars">
      <button
        v-for="v in variables"
        :key="v"
        type="button"
        class="wp-asm-chip available"
        @click="insertVariable(v)"
        :title="`Insert $${v}`"
      >
        ${{ v }}
      </button>
    </div>

    <!-- Template textarea -->
    <div class="wp-asm-template-area">
      <label class="wp-asm-label">Template</label>
      <textarea
        ref="textareaRef"
        v-model="localTemplate"
        @input="emitUpdate"
        class="wp-asm-textarea"
        placeholder="e.g. $character in $environment, $lighting atmosphere"
        rows="3"
      ></textarea>
    </div>

    <!-- Live preview -->
    <div class="wp-asm-preview-area">
      <label class="wp-asm-label">Preview</label>
      <div class="wp-asm-preview" v-html="previewHtml"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const localTemplate = ref(props.modelValue || '');
const textareaRef = ref<HTMLTextAreaElement | null>(null);

watch(() => props.modelValue, (v) => {
  localTemplate.value = v || '';
});

const ESCAPE_PLACEHOLDER = "\uFFFD\uFFFD";
const ESCAPE_RE = /\uFFFD\uFFFD/g;

const variables = computed(() => {
  const sanitized = localTemplate.value.replace(/\$\$/g, ESCAPE_PLACEHOLDER);
  const matches = sanitized.match(/\$(\w+)/g);
  if (!matches) return [];
  const unique = new Set(
    matches.map(m => m.slice(1)).filter(v => !v.startsWith('__'))
  );
  return [...unique];
});

const previewHtml = computed(() => {
  if (!localTemplate.value) {
    return '<span class="wp-preview-empty">Enter a template above...</span>';
  }
  const escaped = localTemplate.value.replace(/\$\$/g, ESCAPE_PLACEHOLDER);
  const highlighted = escaped.replace(/\$(\w+)/g, (_match, name) => {
    if (name.startsWith('__')) return _match;
    return `<span class="wp-var-token">$${name}</span>`;
  });
  return highlighted.replace(ESCAPE_RE, "$");
});

const emitUpdate = () => {
  emit('update:modelValue', localTemplate.value);
};

const insertVariable = (name: string) => {
  const el = textareaRef.value;
  if (el) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = localTemplate.value;
    localTemplate.value = text.slice(0, start) + `$${name}` + text.slice(end);
    // Restore cursor after inserted text
    const newPos = start + name.length + 1;
    requestAnimationFrame(() => {
      el.setSelectionRange(newPos, newPos);
      el.focus();
    });
  } else {
    localTemplate.value += `$${name}`;
  }
  emitUpdate();
};
</script>

<style>
@import '../pipeline/widget-theme.css';
</style>

<style scoped>
.wp-assembler, .wp-assembler * {
  box-sizing: border-box;
}

.wp-assembler {
  display: flex;
  flex-direction: column;
  width: 100%;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
}

/* ── Variable chips ── */
.wp-asm-vars {
  padding: 10px;
  border-bottom: 1px solid var(--wp-border);
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.wp-asm-chip {
  font-size: 10px;
  font-family: var(--wp-font-mono, monospace);
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
  border: none;
}
.wp-asm-chip.available {
  background: var(--wp-green-bg);
  border: 1px solid rgba(74, 222, 128, 0.2);
  color: var(--wp-green);
}
.wp-asm-chip.available:hover {
  background: rgba(74, 222, 128, 0.15);
}

/* ── Template textarea ── */
.wp-asm-template-area {
  padding: 10px;
  border-bottom: 1px solid var(--wp-border);
}

.wp-asm-label {
  font-size: 10px;
  font-family: var(--wp-font-mono, monospace);
  color: var(--wp-text3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
  display: block;
}

.wp-asm-textarea {
  width: 100%;
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-mono, monospace);
  font-size: 12px;
  padding: 8px 10px;
  resize: vertical;
  min-height: 72px;
  outline: none;
  transition: border-color 0.15s;
  line-height: 1.6;
  box-sizing: border-box;
}
.wp-asm-textarea:focus {
  border-color: var(--wp-accent);
}
.wp-asm-textarea::placeholder {
  color: var(--wp-text3);
}

/* ── Live preview ── */
.wp-asm-preview-area {
  padding: 10px;
}

.wp-asm-preview {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 10px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 12px;
  line-height: 1.7;
  color: var(--wp-text2);
  min-height: 40px;
  word-break: break-word;
}
</style>

<style>
/* Unscoped — rendered via v-html */
.wp-var-token {
  color: var(--wp-accent, #7c6af7);
  background: var(--wp-accent-glow, rgba(124, 106, 247, 0.15));
  padding: 1px 4px;
  border-radius: 3px;
}
.wp-preview-empty {
  color: var(--wp-text3, #5a5a72);
  font-style: italic;
}
</style>
