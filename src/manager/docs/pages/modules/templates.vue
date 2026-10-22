<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";
</script>

<template>
  <DocPage
    group="Modules"
    title="Templates"
    icon="pi pi-file-edit"
    tone="neutral"
    blurb="Save an Assembler prompt to your library and load it into another Assembler in one click."
  >
    <DocSection title="What a template is">
      <p>
        A template is the text you write in the <b>WP Prompt Assembler</b>: words and
        <VarToken>$variables</VarToken>, such as
        <VarToken>$scene, $style, $accent, masterpiece, highly detailed</VarToken>. The Assembler
        fills in each variable every run.
      </p>
      <p>
        Saved templates live in your library next to modules, but they don't go on a Context. A
        bundle reuses a set of modules; a template reuses the wording around their variables.
      </p>
      <DocUseWhen
        :good="[
          'A prompt skeleton you reuse, one per model family (tags or prose)',
          'A fixed system prompt a model needs',
        ]"
        :better="[
          'Variety: a template rolls nothing, and {a|b} prints as typed in the Assembler. Put choices in wildcards',
        ]"
      />
      <p>See <DocRef id="prompt-writing" /> for the order each model family wants.</p>
    </DocSection>

    <DocSection title="How it pairs with the Assembler">
      <p>
        The Assembler's toolbar has <b>Save</b> and <b>Load</b>. Save puts its template in your
        library; Load replaces the template with one from the library.
      </p>
      <DocCallout variant="tip">
        A variable in the template needs a module before the Assembler that sets it. If none
        does, it prints nothing and is underlined in the preview; add the module or fix the
        name.
      </DocCallout>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create the starter template,
        <VarToken>$scene, $style, $accent, masterpiece, highly detailed</VarToken>. Load it into a WP
        Prompt Assembler and the starter modules fill it in.
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
