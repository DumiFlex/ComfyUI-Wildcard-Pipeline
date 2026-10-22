<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";

const rowFields = [
  { term: "Name", desc: 'The variable to set: "style" sets $style.' },
  { term: "Value", desc: "The text. A {a|b|c} choice adds a little variety; other $variables can't be read here (use a Combine)." },
  { term: "Enable / disable", desc: "Switch a row off without deleting it, such as an optional quality booster." },
];

const instanceOptions = [
  { term: "Value override", desc: "Change a row's value, or its negative, on this node only. An empty negative clears it." },
  { term: "Row toggles", desc: "Switch rows on or off on this node only." },
  { term: "Lock seed", desc: "Keeps any {a|b|c} choice the same on every Generate." },
  { term: "Hold across run", desc: "Keeps the choices the same for one loop run, and rolls again next Generate." },
  { term: "Hide from prompt", desc: "The variables print nothing; other modules can still read them." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Fixed Values"
    icon="pi pi-tag"
    tone="fixed_values"
    blurb="Set $variables to text you type. Nothing is rolled."
  >
    <DocSection title="What it does">
      <p>
        Fixed Values sets each <VarToken>$variable</VarToken> to the text you typed, every run.
        Nothing is picked at random unless you write a <VarToken kind="inline">{a|b|c}</VarToken>
        choice in the value.
      </p>
      <p>
        Use it for text that stays the same: a style like "oil painting", quality tags like "8k,
        masterpiece", or words you always want in the negative. Put it at the top so every module
        below can read it.
      </p>
      <DocImage
        src="images/docs/fixed-values.png"
        ratio="2 / 1"
        caption="The Starter style fixed value: $style = oil painting, with a + negative button for negative words."
      />
      <DocUseWhen
        :good="[
          'Style and quality tags that never change',
          'A model\'s required prefix or a standing negative',
          'A switch you flip by hand',
        ]"
        :better="[
          'Real variety: use a Wildcard (it has weights, tags, constraints and Test Runner counts)',
          'Text built from other picks: use a Combine',
        ]"
      />
      <DocCallout variant="warn">
        Don't let a fixed value and a wildcard write the same variable: whichever runs later wins,
        without a warning.
      </DocCallout>
    </DocSection>

    <DocSection title="Row fields">
      <DocKeyList :items="rowFields" />
    </DocSection>

    <DocSection title="Change it for one node">
      <DocKeyList :items="instanceOptions" />
      <DocCallout variant="tip">
        A fixed value can't read <VarToken>$variables</VarToken> other modules set. To build a value
        from earlier picks, use a Combine.
      </DocCallout>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create a starter Fixed Values module that sets <VarToken>$style</VarToken> to "oil
        painting". The starter template prints it every run.
      </p>
      <StarterButton slot="style" />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'combine', label: 'Combine', icon: 'pi pi-link', tone: 'combine' },
          { id: 'derivation', label: 'Derivation', icon: 'pi pi-arrow-right-arrow-left', tone: 'derivation' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
