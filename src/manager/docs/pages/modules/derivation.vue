<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="Modules"
    title="Derivation"
    icon="pi pi-arrow-right-arrow-left"
    tone="derivation"
    blurb="IF/ELIF/ELSE rules that read the current Context and mutate it. The conditional logic layer of the pipeline."
  >
    <DocSection title="What it does">
      <p>
        A Derivation module evaluates a set of IF/ELIF/ELSE rule branches top-to-bottom. Each
        branch checks a condition against a <VarToken>$variable</VarToken> already in the Context
        and, if it matches, performs one or more actions (replace, append, prepend) on Context
        variables. Rules are evaluated <em>independently</em> — every rule is checked even after
        an earlier rule fires; there is no early-exit across rules, only within a single
        IF/ELIF/ELSE chain.
      </p>
    </DocSection>

    <DocSection title="Condition operators">
      <p>Supported condition types for branch matching:</p>
      <ul>
        <li><code>equals</code> / <code>not_equals</code> — exact string equality.</li>
        <li><code>contains</code> — substring match.</li>
        <li><code>matches</code> — regular-expression match.</li>
        <li><code>exists</code> / <code>not_exists</code> — variable is present/absent in the Context.</li>
        <li><code>is_set</code> / <code>is_unset</code> — variable is present and non-empty / absent or empty.</li>
      </ul>
    </DocSection>

    <DocSection title="Action modes">
      <p>Each branch action can:</p>
      <ul>
        <li><b>replace</b> — overwrite the target variable's value entirely.</li>
        <li><b>append</b> — concatenate to the end of the current value.</li>
        <li><b>prepend</b> — insert before the current value.</li>
      </ul>
      <DocCallout variant="tip">
        Actions can target any <VarToken>$variable</VarToken> — including ones produced by earlier
        modules in the same stack. This makes Derivation useful for post-processing picks from
        upstream Wildcard or Combine modules.
      </DocCallout>
    </DocSection>

    <DocSection title="Instance overrides">
      <p>An instance can override library defaults without modifying the library entry:</p>
      <ul>
        <li><b>disabled_rule_ids</b> — skip specific top-level rules for this instance.</li>
        <li><b>disabled_branch_keys</b> — skip specific IF/ELIF/ELSE branches within a rule.</li>
        <li><b>value overrides</b> — replace the action value for a specific branch.</li>
        <li><b>rule_order_override</b> — reorder rules for this instance without modifying the library entry.</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'combine', label: 'Combine', icon: 'pi pi-link', tone: 'combine' },
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
