<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const terms = [
  {
    term: "Module",
    desc: "A named piece of pipeline logic you author in the manager — for example a wildcard list or a fixed value. Modules live in your library and can be reused across many different WP Context nodes.",
  },
  {
    term: "Wildcard",
    desc: "A module that holds a list of options. Each time the pipeline runs, one option is picked at random (weighted by the numbers you set). The picked value is stored in the context under a $variable name.",
  },
  {
    term: "$variable",
    desc: "A named slot in the context that holds a text value. Wildcards, Fixed Values, and Combines all write into $variables. Your template reads from them — for example $subject or $style.",
  },
  {
    term: "Combine",
    desc: "A module that joins two or more $variables (and any fixed text) into a new $variable. Useful for building phrases like \"$style portrait of $subject\".",
  },
  {
    term: "Constraint",
    desc: "A module that forces a specific wildcard option to be chosen when another $variable has a particular value. Lets you say things like \"whenever $style is cinematic, $lighting must be low-key\".",
  },
  {
    term: "Bundle",
    desc: "A named group of modules stored together. You can drop an entire bundle into a WP Context at once. Bundle contents are frozen at insert time, so editing the library later does not change bundles already placed in a workflow.",
  },
  {
    term: "Seed",
    desc: "A number that controls which options get picked. Same seed + same modules = same result. Change the seed to get a different set of picks. Each WP Context node has its own seed widget.",
  },
  {
    term: "Context",
    desc: "The WP Context node. It holds your modules, runs them in order on each Generate, and produces a map of $variables that the Assembler can read.",
  },
  {
    term: "Template",
    desc: "A text string with $variable placeholders that the WP Prompt Assembler fills in. For example: \"A $style portrait of $subject\" becomes \"A cinematic portrait of a fox\" after resolution.",
  },
];
</script>

<template>
  <DocPage
    group="Overview"
    title="Glossary"
    icon="pi pi-book"
    tone="neutral"
    blurb="Plain-language definitions for the terms you will see throughout the docs."
  >
    <DocSection title="Terms">
      <DocKeyList :items="terms" />
    </DocSection>

    <DocSection title="See also">
      <CrossLinks
        :links="[
          { id: 'introduction', label: 'Introduction', icon: 'pi pi-compass', tone: 'neutral' },
          { id: 'quick-start', label: 'Quick start', icon: 'pi pi-play', tone: 'neutral' },
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
