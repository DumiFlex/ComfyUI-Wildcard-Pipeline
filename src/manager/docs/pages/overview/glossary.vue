<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const terms = [
  { term: "Module", desc: "One piece you build in the manager, such as a wildcard or a fixed value. It lives in your library and you can add it to any WP Context." },
  { term: "Library", desc: "Everything you've saved in the manager: modules, bundles and templates." },
  { term: "$variable", desc: "A named value, such as $subject. Modules write variables; your template reads them." },
  { term: "Wildcard", desc: "A list of options. Each run picks one and writes it to a $variable." },
  { term: "Weight", desc: "How likely an option is next to the others. Weight 2 comes up twice as often as weight 1; 0 switches it off." },
  { term: "Null option", desc: "A wildcard option that prints nothing, for \"sometimes leave this out\"." },
  { term: "Fallback", desc: "The option a wildcard uses when nothing else is left to pick, for example after a constraint ruled everything out." },
  { term: "Sub-category (tag)", desc: "A label on a wildcard option, such as \"warm\". Filters and constraints work with tags." },
  { term: "Tag group", desc: "Tags sorted under a name, such as species or temperature. A group is either classify (the tags describe the option) or accepts (see below)." },
  { term: "Accepts group", desc: "A tag group whose tags are choices the option offers, such as shoes that go with an outfit. One is rolled with each pick, and $outfit.SHOES prints it." },
  { term: "Library tag", desc: "A label on a whole module, bundle or template, used only to organise your library. It never changes a pick." },
  { term: "Fixed Values", desc: "A module that sets variables to text you type. Nothing is rolled." },
  { term: "Combine", desc: "A module that builds a new variable from text and other variables, such as \"$style portrait of $subject\"." },
  { term: "Derivation", desc: "A module with if/then rules: when a variable says one thing, set another variable." },
  { term: "Constraint", desc: "A module that changes a later wildcard's odds based on an earlier pick, such as \"ocean makes stormy likelier\"." },
  { term: "Bundle", desc: "Several modules saved together, so you can add them to a WP Context in one go." },
  { term: "Template", desc: "Your prompt with $variables in it, such as \"a $style portrait of $subject\". The WP Prompt Assembler fills it in." },
  { term: "Reference (@{…})", desc: "A fresh pick from another wildcard, written inside an option. Type @ to insert one." },
  { term: "Chip", desc: "The small pill a text field shows for a $variable or an @{…} reference. A red one points at something missing." },
  { term: "Inline choice ({a|b})", desc: "A quick random choice written straight into an option, fixed value or combine. Picks one of the parts each run. The Assembler prints it as typed." },
  { term: "Seed", desc: "The number behind every random pick. Same seed and same modules give the same result." },
  { term: "WP Context", desc: "The node that holds your modules, rolls them on every Generate and passes the variables on." },
  { term: "Chaining", desc: "Wiring one WP Context into another. The second starts with the first one's variables and can add to or replace them." },
  { term: "Hide from prompt", desc: "A variable that prints nothing, while other modules can still use it. The globe button on a row." },
  { term: "Lock pick", desc: "Keeps the same pick on every Generate until you unlock it." },
  { term: "Hold across run", desc: "The same pick on every frame of one loop run, and a new one next Generate." },
  { term: "Negative", desc: "Words that go to the negative prompt when a variable is printed. Options, fixed values, combines and derivations can carry them." },
  { term: "Loop", desc: "The WP Context Loop node: runs your pipeline several times in one Generate, one frame each." },
];
</script>

<template>
  <DocPage
    group="Overview"
    title="Glossary"
    icon="pi pi-book"
    tone="neutral"
    blurb="The words you'll see in these docs, one line each."
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
