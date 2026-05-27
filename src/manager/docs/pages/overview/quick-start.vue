<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="Overview"
    title="Quick start"
    icon="pi pi-play"
    tone="neutral"
    blurb="Build the smallest working pipeline — one wildcard, one template, one output."
  >
    <DocSection title="What you will build">
      <p>
        A minimal Wildcard Pipeline workflow: a <b>WP Context</b> node with one Wildcard module
        (binding <VarToken>$subject</VarToken>) → a <b>WP Prompt Assembler</b> with template
        <VarToken>A photo of $subject</VarToken> → a CLIP Text Encode node.
        Every queue run picks a new subject from the wildcard options and assembles the final
        prompt automatically.
      </p>
    </DocSection>

    <DocSection title="Steps">
      <ol>
        <li>
          <b>Add a WP Context node.</b> Right-click the canvas → Add Node → wildcard-pipeline →
          WP Context. Connect the <code>context</code> output to the next node's input later.
        </li>
        <li>
          <b>Open the context widget and add a Wildcard module.</b> Click the + button in the
          WP Context widget and select Wildcard from the module picker.
        </li>
        <li>
          <b>Author the wildcard.</b> Name the module (e.g. "subject"), set the
          <VarToken>$var_binding</VarToken> to <code>subject</code>, and add a few options
          (e.g. "a cat", "a dog", "a fox") with equal weights.
        </li>
        <li>
          <b>Add a WP Prompt Assembler node.</b> Connect the WP Context's <code>context</code>
          output to the Assembler's <code>context</code> input. In the template widget, type:
          <VarToken>A photo of $subject</VarToken>.
        </li>
        <li>
          <b>Connect to CLIP.</b> Connect the Assembler's <code>prompt</code> output to
          your CLIP Text Encode node's text input.
        </li>
        <li>
          <b>Queue.</b> Hit Generate. Each run picks a random subject and assembles the prompt.
        </li>
      </ol>
      <DocCallout variant="tip">
        Use <b>WP Debug</b> (connect to the context output) to inspect what
        <VarToken>$subject</VarToken> was picked each run without interrupting the pipeline.
      </DocCallout>
    </DocSection>

    <DocSection title="Next steps">
      <p>
        Add more modules (Fixed Values, Combine, Derivation, Constraints) to build richer,
        structured prompts. Use WP Context Loop to batch-generate N variations in one queue run.
      </p>
    </DocSection>

    <DocSection title="See also">
      <CrossLinks
        :links="[
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
