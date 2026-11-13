<script setup lang="ts">
/**
 * Last run window for WP Prompt Cleaner, opened from the node's LAST RUN
 * strip: Before and After side by side (kit DiffView, split), a Prompt /
 * Negative switch when the run cleaned a negative, and one line per rule that
 * changed the text. A rule line opens to show that rule's own before/after
 * and why it fired: each dropped tag beside the tag it repeats, the tag it is
 * close to or the blocklist entry it matched, with that cause marked in the
 * diff (DiffView `marks`).
 *
 * Built only from wp-kit pieces.
 */
import { computed, ref, watch } from "vue";
import Banner from "@/kit/Banner.vue";
import Button from "@/kit/Button.vue";
import Chip from "@/kit/Chip.vue";
import CopyButton from "@/kit/CopyButton.vue";
import DiffView from "@/kit/DiffView.vue";
import Disclosure from "@/kit/Disclosure.vue";
import Modal from "@/kit/Modal.vue";
import WpSegmented, { type SegmentedOption } from "@/kit/WpSegmented.vue";
import { RULE_LABELS, ruleSteps } from "./run-steps";
import type { CleanerTrace, NegativeRunReport, RunReport, StepRule } from "./types";

const props = withDefaults(defineProps<{
  open: boolean;
  trace: CleanerTrace | null;
  report: RunReport | null;
  negativeTrace?: CleanerTrace | null | undefined;
  negativeReport?: NegativeRunReport | null | undefined;
}>(), { negativeTrace: null, negativeReport: null });

const emit = defineEmits<{ "update:open": [open: boolean] }>();

type Side = "prompt" | "negative";
const side = ref<Side>("prompt");
watch(() => props.negativeTrace, (t) => { if (!t) side.value = "prompt"; });
const SIDES: SegmentedOption<Side>[] = [
  { value: "prompt", label: "Prompt" },
  { value: "negative", label: "Negative" },
];

const current = computed(() => (side.value === "negative" ? props.negativeTrace : props.trace));
const currentReport = computed<RunReport | null>(() =>
  side.value === "negative" ? props.negativeReport : props.report);
const steps = computed(() => (current.value ? ruleSteps(current.value, currentReport.value) : []));
const changed = computed(() => steps.value.filter((s) => s.changed));
/** Tags mode compares whole tags, so a rewritten tag reads as one old tag
 *  out and one new tag in; text mode compares words. */
const by = computed<"tags" | "words">(() => (current.value?.mode === "text" ? "words" : "tags"));
/** Spacing and edge punctuation live inside a tag, so those two steps
 *  compare words; the rest add, drop or rewrite whole tags. */
function stepBy(rule: StepRule): "tags" | "words" {
  return rule === "whitespace" || rule === "punctuation" ? "words" : by.value;
}
/** Tags the negative shares with the prompt and kept (a drop shows as its
 *  own step instead). */
const overlap = computed(() => {
  const o = side.value === "negative" ? props.negativeReport?.prompt_overlap : undefined;
  return o && !o.dropped && o.tags.length ? o : null;
});
</script>

<template>
  <Modal
    :open="open"
    size="lg"
    title="Last run"
    accent="var(--wp-accent)"
    icon="filter"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="wp-cleaner-run" data-test="cleaner-run">
      <WpSegmented
        v-if="negativeTrace"
        v-model="side"
        class="wp-cleaner-run__switch"
        :options="SIDES"
        size="sm"
        aria-label="Which text"
        test-prefix="cleaner-run-side"
      />
      <p v-if="!current" class="wp-cleaner-run__dim">Run the workflow to see what the cleaner changed.</p>
      <template v-else>
        <DiffView :before="current.input" :after="current.output" :by="by" layout="split" size="sm" />

        <Banner v-if="overlap" tone="warn" size="sm">
          Also in the prompt:
          <span class="wp-cleaner-run__chips"><Chip v-for="t in overlap.tags" :key="t" tone="warn">{{ t }}</Chip></span>
        </Banner>

        <div class="wp-cleaner-run__rules">
          <p v-if="!changed.length" class="wp-cleaner-run__dim">
            {{ steps.length ? "No rule changed this text." : "No rules were on for this text." }}
          </p>
          <Disclosure
            v-for="s in changed"
            :key="s.rule"
            size="sm"
            flush
            :trigger-attrs="{ 'data-test': `cleaner-run-rule-${s.rule}` }"
          >
            <template #summary>
              <span class="wp-cleaner-run__rule">{{ RULE_LABELS[s.rule] }}</span>
              <span class="wp-cleaner-run__what">{{ s.reasons.length
                ? s.reasons.map((r) => `${r.item} ${r.verb} ${r.cause}`).join(" · ")
                : s.items.length ? s.items.join(", ") : s.summary }}</span>
            </template>
            <div class="wp-cleaner-run__step">
              <Banner v-if="s.errors.length" tone="danger" size="sm">
                Bad regex, skipped: {{ s.errors.join(", ") }}
              </Banner>
              <ul v-if="s.reasons.length" class="wp-cleaner-run__reasons">
                <li v-for="(r, i) in s.reasons" :key="i">
                  <Chip tone="danger">{{ r.item }}</Chip>
                  <span class="wp-cleaner-run__verb">{{ r.verb }}</span>
                  <Chip tone="info">{{ r.cause }}</Chip>
                </li>
              </ul>
              <DiffView :before="s.before" :after="s.after" :by="stepBy(s.rule)" :marks="s.marks" size="sm" />
            </div>
          </Disclosure>
        </div>
      </template>
    </div>

    <template #footer>
      <CopyButton v-if="current" :text="current.output" label="Copy cleaned text" show-label variant="secondary" size="sm" />
      <span class="wp-cleaner-run__fill" />
      <Button size="sm" @click="emit('update:open', false)">Close</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-cleaner-run { display: flex; flex-direction: column; gap: var(--wp-space-3, 12px); }
.wp-cleaner-run__switch { align-self: flex-start; }
.wp-cleaner-run__rules { display: flex; flex-direction: column; }
.wp-cleaner-run__rule {
  flex: 0 0 120px;
  color: var(--wp-text-dim);
  text-align: left;
}
.wp-cleaner-run__what {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wp-text);
  text-align: left;
}
.wp-cleaner-run__step { display: flex; flex-direction: column; gap: var(--wp-space-2, 8px); padding: var(--wp-space-1, 4px) 0 var(--wp-space-3, 12px) 26px; }
.wp-cleaner-run__reasons { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.wp-cleaner-run__reasons li { display: flex; align-items: center; gap: 6px; }
.wp-cleaner-run__verb { color: var(--wp-text-dim); font-size: var(--wp-text-sm, 12px); }
.wp-cleaner-run__chips { display: inline-flex; flex-wrap: wrap; gap: 4px; vertical-align: middle; }
.wp-cleaner-run__dim { margin: 0; color: var(--wp-text-dim); font-size: var(--wp-text-sm, 12px); }
.wp-cleaner-run__fill { flex: 1; }
</style>
