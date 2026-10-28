<script setup lang="ts">
/**
 * AiDerivationBlocks — a derivation's rules as IF / ELIF / ELSE blocks,
 * the way its editor lays a rule out. On a change card a new rule or
 * branch is marked green, a dropped one (an ELSE the edit removes) struck
 * through, and a changed branch shows its old test → new and its actions
 * kept, added or removed. Rules the change leaves alone fold into a count.
 */
import { computed } from "vue";
import type { BranchView, CardView } from "../../../composables/card-views/types";
import AiSyntax from "../AiSyntax.vue";

type View = Extract<CardView, { kind: "derivation" }>;
const props = defineProps<{ view: View; full?: boolean }>();

const CAP = { rules: 3, branches: 4, actions: 3 };
const MARK: Record<string, string> = { added: "+", removed: "−", changed: "~", same: "" };

function cap<T>(list: T[], n: number): T[] {
  return props.full ? list : list.slice(0, n);
}
function more(list: unknown[], n: number): number {
  return props.full ? 0 : Math.max(0, list.length - n);
}

/** The rules shown, with their number in the derivation. A change card
 *  shows only the rules that change (the magnifier shows all). */
const rules = computed(() => {
  const changes = props.view.ruleChanges;
  return props.view.rules
    .map((branches, i) => ({ branches, n: i + 1, change: changes?.[i] }))
    .filter((r) => props.full || !changes || r.change !== "same");
});
const folded = computed(() => (props.full ? 0 : (props.view.ruleChanges ?? []).filter((c) => c === "same").length));

/** A changed branch's actions marked; any other branch's plain. */
function actsOf(b: BranchView): Array<{ text: string; change?: string }> {
  return b.acts ?? b.actions.map((text) => ({ text }));
}
</script>

<template>
  <div class="wp-ai-deriv">
    <ol class="wp-ai-deriv__rules">
      <li v-for="rule in cap(rules, CAP.rules)" :key="rule.n" :data-change="rule.change" data-test="ai-card-rule">
        <span class="wp-ai-deriv__rule-n">Rule {{ rule.n }}<template v-if="rule.change === 'added'"> · new</template><template v-else-if="rule.change === 'removed'"> · removed</template></span>
        <div
          v-for="(b, j) in cap(rule.branches, CAP.branches)"
          :key="j"
          class="wp-ai-card-view__branch"
          :data-change="b.change"
          data-test="ai-card-branch"
        >
          <span class="wp-ai-card-view__kw" :data-kw="b.key"><span v-if="b.change && b.change !== 'same'" class="wp-ai-deriv__mark" aria-hidden="true">{{ MARK[b.change] }}</span>{{ b.key }}</span>
          <code v-if="b.test || b.wasTest" :class="{ 'wp-ai-deriv__clamp': !full, 'wp-ai-diff__was': b.change === 'removed' }">
            <template v-if="b.wasTest"><span class="wp-ai-diff__was"><AiSyntax :text="b.wasTest" /></span><span class="wp-ai-diff__arrow" aria-label="becomes">→</span></template>
            <AiSyntax :text="b.test" />
          </code>
          <ul>
            <li
              v-for="(a, k) in cap(actsOf(b), CAP.actions)"
              :key="k"
              :data-change="a.change"
              :class="{ 'wp-ai-deriv__clamp': !full, 'wp-ai-diff__was': a.change === 'removed' || b.change === 'removed' }"
            ><span v-if="a.change === 'added' || a.change === 'removed'" class="wp-ai-diff__mark" aria-hidden="true">{{ MARK[a.change] }}</span><AiSyntax :text="a.text" /></li>
            <li v-if="more(actsOf(b), CAP.actions)" class="wp-ai-diff__more">+{{ more(actsOf(b), CAP.actions) }} more</li>
          </ul>
        </div>
        <p v-if="more(rule.branches, CAP.branches)" class="wp-ai-diff__more">+{{ more(rule.branches, CAP.branches) }} more branch{{ more(rule.branches, CAP.branches) === 1 ? "" : "es" }}</p>
      </li>
    </ol>
    <p v-if="more(rules, CAP.rules)" class="wp-ai-diff__more" data-test="ai-card-more">+{{ more(rules, CAP.rules) }} more rule{{ more(rules, CAP.rules) === 1 ? "" : "s" }}</p>
    <p v-if="folded" class="wp-ai-diff__more" data-test="ai-card-unchanged">{{ folded }} rule{{ folded === 1 ? "" : "s" }} unchanged</p>
  </div>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-deriv { display: flex; flex-direction: column; gap: 6px; }
.wp-ai-deriv__rules { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.wp-ai-deriv__rules > li[data-change="added"] { border-left: 2px solid var(--wp-success, #30a46c); padding-left: 6px; }
.wp-ai-deriv__rules > li[data-change="removed"] { border-left: 2px solid var(--wp-danger, #e5484d); padding-left: 6px; }
.wp-ai-deriv__rules > li[data-change="changed"] { border-left: 2px solid var(--wp-warn); padding-left: 6px; }
.wp-ai-deriv__rule-n { font-size: 11px; color: var(--wp-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.wp-ai-card-view__branch { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 8px; align-items: baseline; margin-top: 2px; padding: 1px 4px 1px 0; border-radius: min(4px, var(--wp-radius-cap, 999px)); }
.wp-ai-card-view__branch[data-change="added"] { background: color-mix(in oklab, var(--wp-success, #30a46c) 9%, transparent); }
.wp-ai-card-view__branch[data-change="removed"] { background: color-mix(in oklab, var(--wp-danger, #e5484d) 8%, transparent); }
.wp-ai-card-view__branch[data-change="same"] { opacity: 0.6; }
.wp-ai-card-view__branch ul { grid-column: 2; margin: 0; padding-left: 16px; }
.wp-ai-card-view__branch li[data-change] { list-style: none; margin-left: -1em; }
.wp-ai-card-view__branch li[data-change] .wp-ai-diff__mark { display: inline-block; }
.wp-ai-card-view__branch li[data-change="added"] .wp-ai-diff__mark { color: var(--wp-success, #30a46c); }
.wp-ai-card-view__branch li[data-change="removed"] .wp-ai-diff__mark { color: var(--wp-danger, #e5484d); }
.wp-ai-card-view__branch code { overflow-wrap: anywhere; }
.wp-ai-card-view__kw { font-size: 10.5px; font-weight: 700; padding: 1px 6px; border-radius: min(4px, var(--wp-radius-cap, 999px)); background: color-mix(in oklab, var(--wp-warn) 22%, transparent); color: var(--wp-warn); white-space: nowrap; }
.wp-ai-deriv__mark { margin-right: 3px; }
.wp-ai-card-view__branch[data-change="added"] .wp-ai-deriv__mark { color: var(--wp-success, #30a46c); }
.wp-ai-card-view__branch[data-change="removed"] .wp-ai-deriv__mark { color: var(--wp-danger, #e5484d); }
.wp-ai-deriv__clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
</style>
