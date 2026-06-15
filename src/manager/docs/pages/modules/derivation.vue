<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";

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
        caption="The Starter accent Derivation modal — a single Rule 1 condition reading '$mood = dramatic → $accent = cinematic lighting' (the engine falls through to the rule's else branch when $mood resolves to anything else). Footer carries Lock seed + Hide from prompt toggles. Behind the modal: a WP Context with Starter scene + Starter accent stacked, the accent row's orange left-border matching the derivation kind colour."
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

    <DocSection title="Nested references in actions">
      <p>
        An action's value isn't limited to plain text. When a rule fires, its action value is fully
        resolved before it's written — so it can embed a <VarToken kind="ref">@{uuid}</VarToken>
        reference to another wildcard, an inline <VarToken kind="inline">&#123;a|b&#125;</VarToken>
        pick, and <VarToken>$variable</VarToken> reads, all in the same string. A reference can carry
        the same segments as anywhere else: a <VarToken kind="inline">:filter</VarToken> sub-category
        expression to narrow the nested wildcard's pool and <VarToken kind="inline">!null</VarToken>
        to drop its null option.
      </p>
      <p>
        For example, an action <VarToken>$accent</VarToken> = <code>cinematic lighting,
        @{abcd1234:dramatic}</code> writes "cinematic lighting," followed by a fresh pick from the
        nested <VarToken kind="ref">@{abcd1234}</VarToken> wildcard, drawn only from its
        dramatic-tagged options. This lets a rule conditionally pull in a whole nested wildcard's
        result rather than a fixed phrase.
      </p>
      <DocCallout variant="warn">
        Actions and conditions are <b>not</b> symmetric. An action value resolves
        <VarToken kind="ref">@{}</VarToken> refs and <VarToken kind="inline">&#123;a|b&#125;</VarToken>
        picks; a <b>condition</b> value — the text you compare against — does not. A condition is a
        plain literal or a <VarToken>$variable</VarToken>, so <VarToken kind="ref">@{}</VarToken> and
        <VarToken kind="inline">&#123;a|b&#125;</VarToken> stay verbatim there and won't match what
        you expect. This mirrors the per-surface gate on <DocRef id="variable-pipeline" />.
      </DocCallout>
    </DocSection>

    <DocSection title="Reading multi-pick variables">
      <p>
        A rule can read a multi-pick result the same way templates do. Reference the joined list with
        a bare <VarToken>$colors</VarToken> (it uses the variable's separator), or pull out a single
        item with <VarToken>$colors.0</VarToken> — <code>K</code> in <VarToken>$name.K</VarToken> is
        0-based, so <VarToken>$colors.0</VarToken> is the first pick. This works in both condition and
        action values. The full grammar lives on <DocRef id="variable-pipeline" />.
      </p>
    </DocSection>

    <DocSection title="Per-use options">
      <p>
        When you add a Derivation to a Context you can tune which rules are active for that use:
      </p>
      <DocKeyList :items="instanceOptions" />
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create a starter Derivation that sets <VarToken>$accent</VarToken> based on the mood: if
        <VarToken>$mood</VarToken> is "dramatic" it writes "cinematic lighting", otherwise "soft
        lighting". A one-rule example of conditional logic reacting to an upstream pick.
      </p>
      <StarterButton slot="accent" />
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
