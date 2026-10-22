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

const instanceOptions = [
  { term: "Template override", desc: "Change the template on this node only." },
  { term: "Output variable", desc: "Write to a different $variable on this node." },
  { term: "Negative override", desc: "Change the combine's negative on this node. An empty one clears it." },
  { term: "Lock seed", desc: "Keeps the template's {a|b} choices the same on every Generate." },
  { term: "Hold across run", desc: "Keeps the result the same for one loop run." },
  { term: "Hide from prompt", desc: "The result prints nothing; other modules can still read it." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Combine"
    icon="pi pi-link"
    tone="combine"
    blurb="Build a new $variable from text and earlier variables, such as “$style portrait of $subject”."
  >
    <DocSection title="What it does">
      <p>
        Write a template such as <VarToken>$style portrait of $subject, $mood lighting</VarToken>.
        The combine fills in the variables set above it and writes the result to one new variable,
        such as <VarToken>$shot</VarToken>, for the Assembler or later modules.
      </p>
      <p>
        You can also sprinkle <VarToken kind="inline">{a|b|c}</VarToken> inline picks directly
        inside the template for any on-the-fly variation that doesn't need its own wildcard.
      </p>
      <DocImage
        src="images/docs/combine.png"
        ratio="2 / 1"
        caption="The Starter scene combine: '$mood $subject' resolves to 'serene cat' and is stored as $scene. The Negative field sends words to the Assembler's negative."
      />
      <DocUseWhen
        :good="[
          'Joining picks into one phrase: “wearing $outfit and $shoes”',
          'Printing a hidden driver inside a phrase',
          'Reading an accepts group as text',
        ]"
        :better="[
          'Making a pick: a combine isn\'t a pick, so nothing can constrain it. Use a Wildcard',
          'Text that depends on a condition: use a Derivation',
        ]"
      />
    </DocSection>

    <DocSection title="What you type in the template">
      <ul>
        <li>
          <VarToken>$name</VarToken> prints what that variable holds at this point. A module above
          must set it.
        </li>
        <li>
          <VarToken kind="inline">{a|b|c}</VarToken> picks one part each run, for small variations
          that don't need a wildcard.
        </li>
        <li>
          <VarToken kind="inline">$$</VarToken> prints a plain <code>$</code>.
        </li>
        <li>
          <VarToken>$name.0</VarToken>, <VarToken>$outfit.SHOES</VarToken> and
          <VarToken>$name.neg</VarToken> read one pick of a multi-pick, an accepts group, or a
          variable's negatives.
        </li>
        <li>
          <VarToken kind="ref">@{}</VarToken> references are dropped here: they print nothing
          and WP Debug notes it. Put a reference in a wildcard option instead.
        </li>
      </ul>
      <DocCallout variant="tip">
        The variables your template reads show as chips under it. A chip marked missing means no
        module above sets that variable.
      </DocCallout>
    </DocSection>

    <DocSection title="Change it for one node">
      <DocKeyList :items="instanceOptions" />
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create a starter Combine that fills <VarToken>$mood $subject</VarToken> into a single
        <VarToken>$scene</VarToken> variable. It reads the starter subject and mood wildcards, so
        build those first, or use "Build starter bundle" to get the whole set.
      </p>
      <StarterButton slot="scene" />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'fixed-values', label: 'Fixed Values', icon: 'pi pi-tag', tone: 'fixed_values' },
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
