<script setup lang="ts">
/**
 * VALID-column icon. Renders:
 *  - green check  when issues = []
 *  - amber warn   when issues contain only "warn" severities
 *  - red times    when issues contain at least one "error"
 *
 * Tooltip surfaces the issue messages so the user can fix without
 * opening the editor. Used by every list view (Wildcards, Constraints,
 * Combines, Derivations, FixedValues, Bundles, AllItems).
 */
import { computed } from "vue";

import type { ValidationIssue, ValidationSeverity } from "../utils/validateModule";
import { worstSeverity } from "../utils/validateModule";

interface Props {
  issues: readonly ValidationIssue[];
}
const props = defineProps<Props>();

const severity = computed<ValidationSeverity | null>(() => worstSeverity(props.issues));

const iconClass = computed<string>(() => {
  if (severity.value === null) return "pi pi-check-circle wp-icon--success";
  if (severity.value === "error") return "pi pi-times-circle wp-icon--error";
  return "pi pi-exclamation-triangle wp-icon--warn";
});

const tooltip = computed<string>(() => {
  if (severity.value === null) return "Valid";
  return props.issues.map((i) => i.message).join("\n");
});

const ariaLabel = computed<string>(() => {
  if (severity.value === null) return "Valid module";
  const count = props.issues.length;
  const tag = severity.value === "error" ? "error" : "warning";
  return `${count} ${tag}${count === 1 ? "" : "s"}: ${tooltip.value}`;
});
</script>

<template>
  <i
    :class="iconClass"
    :title="tooltip"
    :aria-label="ariaLabel"
    role="img"
    data-test="validity-icon"
    :data-severity="severity ?? 'ok'"
  />
</template>

<style scoped>
@layer wp-extension {
  /* Issue-severity tones. .wp-icon--success / --warn already exist as
   * global utility classes via tokens.css; the --error variant is
   * scoped here because nothing else in the SPA shipped it yet. */
  .wp-icon--error {
    color: var(--wp-danger, var(--wp-color-error-fg, #ef4444));
  }
}
</style>
