<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const conditionOps = [
  { term: "equals / not equals", desc: "Matches when the variable's value is (or isn't) exactly the text you provide. Case-sensitive." },
  { term: "contains", desc: "Matches when the variable's value includes the text you provide somewhere inside it." },
  { term: "matches", desc: "Matches using a regular expression — for flexible pattern-based conditions." },
  { term: "exists / not exists", desc: "Matches when the variable is present in the Context (or absent), regardless of its value." },
  { term: "is set / is unset", desc: "is set matches when the variable is present and non-empty; is unset matches when it's absent or empty." },
];

const actionModes = [
  { term: "Replace", desc: "Overwrite the variable's current value entirely with the action text." },
  { term: "Append", desc: "Add the action text to the end of the variable's current value." },
  { term: "Prepend", desc: "Insert the action text before the variable's current value." },
];

const instanceOptions = [
  { term: "Disable a rule", desc: "Skip one of the top-level IF/ELIF/ELSE rules for this use without removing it from the library entry." },
  { term: "Disable a branch", desc: "Skip a specific IF, ELIF, or ELSE branch within a rule for this use." },
  { term: "Value override", desc: "Replace the text that a specific branch action writes, for this use only." },
  { term: "Rule order", desc: "Reorder the rules for this use without changing the shared library entry." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Derivation"
    icon="pi pi-arrow-right-arrow-left"
    tone="derivation"
    blurb="IF/ELIF/ELSE rules that read what's been picked so far and update the Context accordingly. Add conditional logic to your pipeline."
  >
    <DocSection title="What it does">
      <p>
        A Derivation module runs a set of IF/ELIF/ELSE rules after earlier modules have made their
        picks. Each rule checks a <VarToken>$variable</VarToken> already in the Context and, if the
        condition matches, changes one or more variables — replacing, appending to, or prepending
        to their current values.
      </p>
      <p>
        For example: IF <VarToken>$subject</VarToken> equals "ocean" → append ", with crashing
        waves" to <VarToken>$mood</VarToken>. If not, the rule does nothing and the next rule is
        checked.
      </p>
      <DocImage
        src="images/docs/derivation.png"
        ratio="16 / 7"
        caption="A Derivation rule card open in the editor: an IF branch checking '$subject equals ocean' with an Append action on $mood, and an ELSE branch that does nothing."
      />
    </DocSection>

    <DocSection title="How rules work">
      <p>
        Each Derivation module can hold multiple rules. Every rule is checked from top to bottom —
        even if an earlier rule fired, the next one is still evaluated independently. Within a
        single rule, only the first matching branch (IF, ELIF, or ELSE) runs.
      </p>
      <DocCallout variant="tip">
        Because rules are independent, you can chain several simple rules instead of writing one
        very complex one. It also means two rules can both fire in the same run if their conditions
        are both true.
      </DocCallout>
    </DocSection>

    <DocSection title="Condition operators">
      <DocKeyList :items="conditionOps" />
    </DocSection>

    <DocSection title="Action modes">
      <DocKeyList :items="actionModes" />
    </DocSection>

    <DocSection title="Per-use options">
      <p>
        When you add a Derivation to a Context you can tune which rules are active for that use:
      </p>
      <DocKeyList :items="instanceOptions" />
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
