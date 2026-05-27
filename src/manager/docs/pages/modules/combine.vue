<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const instanceOptions = [
  { term: "Template override", desc: "Replace the entire template for this particular use without changing the shared library entry." },
  { term: "Output variable", desc: "Change which $variable name this combine writes to for this use." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Combine"
    icon="pi pi-link"
    tone="combine"
    blurb="Fill a template with $variables from earlier modules and write the result to a new $variable. The tool for assembling multi-part values."
  >
    <DocSection title="What it does">
      <p>
        A Combine module takes a template string you write — like
        <VarToken>$style portrait of $subject, $mood lighting</VarToken> — and fills in the
        <VarToken>$variable</VarToken> placeholders with whatever was picked or set earlier in the
        stack. The filled-in result is written to a single output variable (e.g.
        <VarToken>$prompt_fragment</VarToken>) that your prompt assembler or further modules can use.
      </p>
      <p>
        You can also sprinkle <VarToken kind="inline">{a|b|c}</VarToken> inline picks directly
        inside the template for any on-the-fly variation that doesn't need its own wildcard.
      </p>
      <DocImage
        src="images/docs/combine.png"
        ratio="16 / 7"
        caption="The Combine editor showing a template field containing '$style portrait of $subject, $mood lighting', the detected $var chips listed below it, and the output variable set to $prompt_fragment."
      />
    </DocSection>

    <DocSection title="What you type in the template">
      <ul>
        <li>
          <VarToken>$variablename</VarToken> — substituted with whatever that variable holds at
          this point in the stack. The variable must have been set by an earlier module.
        </li>
        <li>
          <VarToken kind="inline">{a|b|c}</VarToken> — picks one of the options at random inline.
          Good for small variations you don't need a full wildcard for.
        </li>
        <li>
          <code>$$</code> — a literal <code>$</code> character in the output (escape if you need
          to write a dollar sign that shouldn't be treated as a variable).
        </li>
      </ul>
      <DocCallout variant="tip">
        The manager shows you which <VarToken>$variables</VarToken> your template reads as chips
        below the template field. If a chip is highlighted as missing, add an upstream module that
        sets that variable.
      </DocCallout>
    </DocSection>

    <DocSection title="Per-use options">
      <DocKeyList :items="instanceOptions" />
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
