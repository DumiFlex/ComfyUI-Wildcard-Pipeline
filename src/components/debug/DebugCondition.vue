<script setup lang="ts">
/**
 * One derivation condition as the engine evaluated it: a test with the
 * value it read and whether it matched, or an AND / OR group of them
 * (recursive). Every member of a group is shown with its own result, so a
 * group that failed says which test sank it.
 */
import { computed } from "vue";
import { OP_LABELS, VALUELESS_OPS, formatValue, type RawCondition } from "./debug-model";

const props = defineProps<{ cond: RawCondition; depth?: number }>();

const isGroup = computed(() => Array.isArray(props.cond.conditions));
const ok = computed(() => props.cond.result === true);
const opLabel = computed(() => OP_LABELS[props.cond.op ?? ""] ?? props.cond.op ?? "");
const showsValue = computed(() => !VALUELESS_OPS.has(props.cond.op ?? ""));
const actual = computed(() => {
  if (props.cond.actual === null || props.cond.actual === undefined) return null;
  return formatValue(props.cond.actual);
});
</script>

<template>
  <div
    v-if="isGroup"
    class="wp-dbg-cond-group"
    :class="{ 'is-ok': ok, 'is-any': cond.match === 'any' }"
    data-test="dbg-cond-group"
  >
    <div class="wp-dbg-cond-group__head">
      <i :class="['pi', ok ? 'pi-check' : 'pi-times', 'wp-dbg-cond-mark']" aria-hidden="true" />
      <span class="wp-dbg-cond-group__label">{{ cond.match === "any" ? "any of" : "all of" }}</span>
    </div>
    <DebugCondition
      v-for="(c, i) in cond.conditions"
      :key="i"
      :cond="c"
      :depth="(depth ?? 0) + 1"
    />
  </div>
  <div
    v-else
    class="wp-dbg-cond"
    :class="{ 'is-ok': ok }"
    data-test="dbg-cond"
    :data-result="ok ? 'match' : 'miss'"
  >
    <i :class="['pi', ok ? 'pi-check' : 'pi-times', 'wp-dbg-cond-mark']" :aria-label="ok ? 'matched' : 'did not match'" />
    <code class="wp-dbg-cond__var">${{ cond.var }}</code>
    <span class="wp-dbg-cond__op">{{ opLabel }}</span>
    <code v-if="showsValue" class="wp-dbg-cond__val">{{ formatValue(cond.value) || '""' }}</code>
    <span class="wp-dbg-cond__actual" :title="'The value $' + cond.var + ' held when this ran'">
      <template v-if="actual === null">unset</template>
      <template v-else-if="actual === ''">was empty</template>
      <template v-else>was <code>{{ actual }}</code></template>
    </span>
  </div>
</template>

<style scoped>
.wp-dbg-cond {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px;
  padding: 2px 0;
  font-size: 11px;
  color: var(--wp-text-muted);
}
.wp-dbg-cond-mark { font-size: 9px; color: var(--wp-red, #e5484d); flex: none; }
.is-ok > .wp-dbg-cond-mark,
.is-ok > .wp-dbg-cond-group__head > .wp-dbg-cond-mark { color: var(--wp-green); }
.wp-dbg-cond__var { font-family: var(--wp-font-mono); color: var(--wp-accent-text, var(--wp-accent)); }
.wp-dbg-cond__op { color: var(--wp-text-dim); }
.wp-dbg-cond__val { font-family: var(--wp-font-mono); color: var(--wp-text); }
.wp-dbg-cond__actual { color: var(--wp-text-dim); font-style: italic; }
.wp-dbg-cond__actual code { font-style: normal; font-family: var(--wp-font-mono); color: var(--wp-text-muted); }
.wp-dbg-cond-group {
  border-left: 2px solid color-mix(in oklab, var(--wp-red, #e5484d) 45%, transparent);
  padding: 1px 0 1px 8px;
  margin: 2px 0;
}
.wp-dbg-cond-group.is-ok { border-left-color: color-mix(in oklab, var(--wp-green) 55%, transparent); }
.wp-dbg-cond-group__head { display: flex; align-items: center; gap: 5px; }
.wp-dbg-cond-group__label {
  font: 600 9px/1.6 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-dim);
}
</style>
