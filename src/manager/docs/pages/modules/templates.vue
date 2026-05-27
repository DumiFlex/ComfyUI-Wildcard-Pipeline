<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";
</script>

<template>
  <DocPage
    group="Modules"
    title="Templates"
    icon="pi pi-file-edit"
    tone="neutral"
    blurb="Save a reusable prompt template — a string of $variables and literal text — and load it into the WP Prompt Assembler in one click."
  >
    <DocSection title="What a template is">
      <p>
        A prompt template is just the text you feed the <b>WP Prompt Assembler</b>: a mix of literal
        words and <VarToken>$variable</VarToken> placeholders like
        <VarToken>$scene, $style, $accent, masterpiece, highly detailed</VarToken>. At runtime the
        Assembler swaps each <VarToken>$var</VarToken> for whatever your modules produced and emits
        the finished prompt.
      </p>
      <p>
        Templates aren't a module kind and they don't sit in a Context stack — they're saved
        Assembler strings you can name, reuse across workflows, and edit in one place. Think of them
        as the prompt-shaped counterpart to a bundle: a bundle reuses a set of modules, a template
        reuses the wording that stitches their <VarToken>$variables</VarToken> together.
      </p>
    </DocSection>

    <DocSection title="How it pairs with the Assembler">
      <p>
        In a workflow, the <b>WP Prompt Assembler</b> node holds the template string. Saving that
        string to your library makes a Template; loading a Template back into the Assembler drops the
        whole string in at once. The Assembler's toolbar has Save and Load buttons wired directly to
        this library.
      </p>
      <DocCallout variant="tip">
        Any <VarToken>$var</VarToken> in the template must be produced by a module upstream of the
        Assembler. If a placeholder has no matching variable at runtime it's left in place so you can
        spot the gap — add a module (or fix the name) that sets it.
      </DocCallout>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create the starter prompt template —
        <VarToken>$scene, $style, $accent, masterpiece, highly detailed</VarToken> — the wording that
        ties the rest of the starter set together. Load it into a WP Prompt Assembler and it fills
        in from the starter modules.
      </p>
      <StarterButton slot="template" />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'bundles', label: 'Bundles', icon: 'pi pi-box', tone: 'bundle' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
