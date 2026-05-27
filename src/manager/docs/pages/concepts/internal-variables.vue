<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How it connects"
    title="Internal variables"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Mark a $variable as internal to keep it out of the rendered prompt while still making it available for downstream combine/derivation logic."
  >
    <DocSection title="What internal means">
      <p>
        When you mark a module as <b>internal</b> in its settings, all the variables it produces
        are hidden from the final rendered prompt. They still travel through the whole pipeline —
        you can read them in combine and derivation modules further down the chain — but they are
        removed just before the Assembler turns the template into text, so they never appear in
        the output.
      </p>
      <p>
        A typical use: a wildcard picks a lighting key code like
        <VarToken>$_lighting_key</VarToken>, marked internal. A derivation module then uses that
        key to produce a human-readable <VarToken>$lighting</VarToken> description. Only the
        description reaches the prompt; the key code stays hidden.
      </p>
    </DocSection>

    <DocSection title="Internal variables survive chaining">
      <p>
        Internal variables are only removed at the <em>render</em> step inside the Assembler —
        not when a Context passes its output to the next node. This means a variable set as
        internal in <b>Context A</b> is still readable by a derivation in <b>Context B</b>
        downstream. Only the final Assembler hides it from the prompt.
      </p>
      <DocCallout variant="tip">
        You can set a variable internal in an early Context and use it as a building block in
        every subsequent Context in the chain — it will never pollute your rendered prompt.
      </DocCallout>
    </DocSection>

    <DocSection title="Loop iteration variable flags">
      <p>
        The <VarToken>$iteration</VarToken> and <VarToken>$iteration_total</VarToken> variables
        injected by <b>WP Context Loop</b> each have their own internal flag in the loop
        configuration. By default both are internal, so they do not show up in the rendered
        prompt. Turn off the flag for either one if you want it to appear — for example, to
        caption outputs with "frame 1 of 4".
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'context-chaining', label: 'Context chaining', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
