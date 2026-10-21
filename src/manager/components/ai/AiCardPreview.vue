<script setup lang="ts">
/**
 * AiCardPreview — a chat card shown whole in a modal (the card's magnifier):
 * every option, the full grid or rule tree, the whole description and every
 * warning, which the card in the drawer caps to keep the chat readable.
 * Its buttons are the card's own (the drawer handles them).
 */
import { computed } from "vue";
import Modal from "../ui/Modal.vue";
import Button from "../ui/Button.vue";
import AiCardView from "./AiCardView.vue";
import AiTestCard from "./AiTestCard.vue";
import AiSyntax from "./AiSyntax.vue";
import { cardMeta, cardOptions, cardView, otherPreview } from "../../composables/aiCards";
import type { AiChatProposal, AiTestCard as TestCard } from "../../api/types";

const props = defineProps<{
  /** The card to show: a proposal, or a test run. */
  proposal?: AiChatProposal | null;
  test?: TestCard | null;
  /** Options the user unticked on the card. */
  skipped?: readonly string[];
  /** The card can still be applied (no status, nothing blocking). */
  canApply?: boolean;
  /** Why it can't be applied yet, if it is waiting. */
  blocked?: string;
  applyLabel?: string;
  canOpenInEditor?: boolean;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "apply"): void;
  (e: "dismiss"): void;
  (e: "open-editor"): void;
  (e: "open-test"): void;
}>();

const p = computed(() => props.proposal ?? null);
const meta = computed(() => (p.value ? cardMeta(p.value) : null));
const options = computed(() => (p.value ? cardOptions(p.value) : null));
const view = computed(() => (p.value ? cardView(p.value) : null));
const lines = computed(() => (p.value && !view.value ? otherPreview(p.value, options.value) : []));
const title = computed(() => p.value?.title ?? (props.test ? "Test run" : ""));
const pending = computed(() => !!p.value && props.canApply !== undefined);
</script>

<template>
  <Modal :open="!!proposal || !!test" :title="title" size="lg" @update:open="(v) => { if (!v) emit('close'); }">
    <div class="wp-ai-preview" data-test="ai-card-preview">
      <template v-if="p">
        <p class="wp-ai-preview__summary">{{ p.summary }}</p>
        <dl v-if="meta" class="wp-ai-preview__meta">
          <template v-if="meta.variable">
            <dt>Variable</dt><dd><code>${{ meta.variable }}</code></dd>
          </template>
          <dt>Description</dt>
          <dd :data-empty="!meta.description || undefined">{{ meta.description || "None" }}</dd>
          <dt>Tags</dt>
          <dd>
            <span v-for="t in meta.tags" :key="t" class="wp-ai-preview__chip">#{{ t }}</span>
            <span v-if="!meta.tags.length" data-empty="true">None</span>
          </dd>
        </dl>
        <section v-if="options" class="wp-ai-preview__opts">
          <h4>{{ options.length }} option{{ options.length === 1 ? "" : "s" }}</h4>
          <ol>
            <li v-for="o in options" :key="o.id" :data-off="skipped?.includes(o.id) || undefined">
              <span class="wp-ai-preview__opt-text"><template v-if="o.empty">∅ nothing</template><AiSyntax v-else :text="o.text" /></span>
              <span v-if="o.weight !== 1" class="wp-ai-preview__dim">×{{ o.weight }}</span>
              <span v-if="o.fallback" class="wp-ai-preview__chip">fallback</span>
              <span v-for="t in o.tags" :key="t" class="wp-ai-preview__chip">#{{ t }}</span>
              <span v-if="o.negative" class="wp-ai-preview__neg">− <AiSyntax :text="o.negative" /></span>
            </li>
          </ol>
        </section>
        <AiCardView v-if="view" :view="view" full />
        <ul v-else-if="lines.length" class="wp-ai-preview__lines">
          <li v-for="(l, i) in lines" :key="i"><AiSyntax :text="l" /></li>
        </ul>
        <ul v-if="p.warnings.length" class="wp-ai-preview__warnings">
          <li v-for="(w, i) in p.warnings" :key="i"><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ w }}</li>
        </ul>
      </template>
      <AiTestCard v-else-if="test" :card="test" full @open="emit('open-test')" />
    </div>
    <template v-if="pending" #footer>
      <span v-if="blocked" class="wp-ai-preview__blocked">{{ blocked }}</span>
      <Button variant="ghost" size="sm" data-test="ai-preview-dismiss" @click="emit('dismiss')">Dismiss</Button>
      <Button
        v-if="canOpenInEditor"
        variant="secondary"
        size="sm"
        icon="pi-pencil"
        data-test="ai-preview-open-editor"
        @click="emit('open-editor')"
      >Open in editor</Button>
      <Button
        variant="primary"
        size="sm"
        icon="pi-check"
        :disabled="!canApply"
        data-test="ai-preview-apply"
        @click="emit('apply')"
      >{{ applyLabel || "Apply" }}</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-ai-preview { display: flex; flex-direction: column; gap: 12px; font-size: 13px; max-height: 70vh; overflow-y: auto; padding-right: 4px; }
.wp-ai-preview__summary { margin: 0; color: var(--wp-text-muted); }
.wp-ai-preview__meta { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; margin: 0; }
.wp-ai-preview__meta dt { color: var(--wp-text-dim); }
.wp-ai-preview__meta dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; overflow-wrap: anywhere; white-space: pre-wrap; }
.wp-ai-preview__meta [data-empty] { color: var(--wp-text-dim); font-style: italic; }
.wp-ai-preview__chip { font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--wp-bg-3); color: var(--wp-accent-400, var(--wp-accent-500)); }
.wp-ai-preview__opts { border: 1px solid var(--wp-border); border-radius: 6px; background: var(--wp-bg-1, var(--wp-bg-2)); padding: 6px 10px; }
.wp-ai-preview__opts h4 { margin: 0 0 4px; font-size: 12px; font-weight: 600; color: var(--wp-text-muted); }
.wp-ai-preview__opts ol { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 3px; }
.wp-ai-preview__opts li { overflow-wrap: anywhere; }
.wp-ai-preview__opts li[data-off] .wp-ai-preview__opt-text { color: var(--wp-text-dim); text-decoration: line-through; }
.wp-ai-preview__opts li > span + span { margin-left: 6px; }
.wp-ai-preview__dim { color: var(--wp-text-muted); font-size: 12px; }
.wp-ai-preview__neg { font-size: 12px; color: var(--wp-danger, #f87171); }
.wp-ai-preview__lines { margin: 0; padding-left: 18px; overflow-wrap: anywhere; }
.wp-ai-preview__warnings { list-style: none; margin: 0; padding: 0; color: var(--wp-warn); font-size: 12.5px; display: flex; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
.wp-ai-preview__blocked { margin-right: auto; font-size: 12px; color: var(--wp-text-muted); }
</style>
