<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const optionFields = [
  { term: "Value", desc: 'The text that goes into the prompt when this option is picked — for example, "a cat", "a dog", or "a fox".' },
  { term: "Weight", desc: "How likely this option is to be chosen relative to the others. A weight of 2 is twice as likely as a weight of 1. Set to 0 to disable without deleting." },
  { term: "Sub-category", desc: 'An optional label (e.g. "animal", "vehicle") that lets you filter which options are in play for a given use. Useful when one wildcard covers several themes.' },
  { term: "Null option", desc: 'Marks this option as the "no pick" result — the wildcard resolves to an empty string. At most one option per wildcard can be a null option.' },
];

const instanceOptions = [
  { term: "Random mode", desc: "Pick any option from the pool using its weights. This is the default." },
  { term: "Subcategory mode", desc: "Pre-filters the pool to only options that carry a chosen sub-category label before picking. The pick itself works identically to random — only which options are eligible changes." },
  { term: "Pinned mode", desc: "Locks to one specific option regardless of seed. Use this to hold an element steady across a batch while everything else varies." },
  { term: "Locked seed", desc: "Freezes this wildcard's pick across every loop iteration — every iteration in the batch gets the same result. Useful for holding one element constant (e.g. the art style) while letting other wildcards vary." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Wildcard"
    icon="pi pi-sparkles"
    tone="wildcard"
    blurb="Pick one option at random from a pool and write it to a $variable. The core building block of any pipeline."
  >
    <DocSection title="What it does">
      <p>
        A Wildcard module holds a list of options — "a cat", "a dog", "a fox" — and picks one each
        run. The result is written to a <VarToken>$variable</VarToken> you name, so later modules
        (and your prompt template) can use it. Options can carry weights so some are more likely
        than others, and you can group them with sub-category labels to filter on the fly.
      </p>
      <DocImage
        ratio="16 / 7"
        caption="The wildcard option-pool editor open on a wildcard called $subject, showing three options ('a cat', 'a dog', 'a fox') each with a weight field and a sub-category chip."
      />
    </DocSection>

    <DocSection title="Option fields">
      <DocKeyList :items="optionFields" />
    </DocSection>

    <DocSection title="Per-use options">
      <p>
        When you add a wildcard to a Context you can change how it behaves for that use without
        touching the shared library entry:
      </p>
      <DocKeyList :items="instanceOptions" />
      <DocCallout variant="tip">
        Subcategory mode and random mode produce the same result when no sub-category filter is
        active — subcategory mode is just a convenient way to pre-narrow the pool.
      </DocCallout>
    </DocSection>

    <DocSection title="Constraint interaction">
      <p>
        A <b>Constraint</b> module placed between a source wildcard and this one can tilt the
        option weights — for example, making "stormy" more likely when the subject was "ocean".
        The constraint must sit <em>after</em> the source wildcard and <em>before</em> this
        wildcard in the stack. See the Constraint page for the full picture.
      </p>
      <DocImage
        ratio="16 / 6"
        caption="A module stack showing a $weather wildcard, then a Constraint module, then a $mood wildcard. The Constraint sits between its source and target."
      />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
