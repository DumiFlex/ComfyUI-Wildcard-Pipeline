<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocAnnotated from "../../../components/docs/DocAnnotated.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Context Injector"
    icon="pi pi-bolt"
    tone="node"
    node-id="WP_ContextInjector"
    blurb="Turn any value on the canvas into a $variable: text you type, an LLM caption, a LoRA name or a number."
  >
    <DocSection title="An example">
      <p>
        You have a text box with <i>red hoodie, ripped jeans</i> and another with <i>rooftop at
        night</i>. Wire both into an Injector, name the rows <VarToken>$outfit</VarToken> and
        <VarToken>$place</VarToken>, and a template of <VarToken>a woman wearing $outfit,
        $place</VarToken> prints "a woman wearing red hoodie, ripped jeans, rooftop at night".
      </p>
      <DocAnnotated
        src="images/docs/wp-context-injector.png"
        ratio="1720 / 752"
        caption="Three text boxes (the LoRA trigger words) wired into a WP Context Injector, each becoming a variable; WP Debug after the run lists them with the picks from the Contexts above."
      />
      <DocUseWhen
        :good="[
          'Text from outside your library: something you type, an LLM caption, a LoRA name',
          'A number from a slider or another node',
        ]"
        :better="[
          'Choices: an injected value isn\'t a pick, so nothing can constrain it. Use a wildcard with Match variable',
          'Reusable text that rolls: a Combine in the library',
        ]"
      />
    </DocSection>

    <DocSection title="Use it">
      <ol>
        <li>Wire any output into the next free <code>input_N</code>. A row appears for it.</li>
        <li>Type the variable's name in the row.</li>
        <li>Wire <code>context</code> into a WP Context, an Assembler or a Debug. Wire an existing
          Context into <code>upstream</code> to add to it; its variables pass through.</li>
      </ol>
      <DocFlow figure="wp-context-injector-flow"
        :stages="[
          { icon: 'pi pi-sign-in', name: 'Any node', sub: 'any output', tone: 'neutral' },
          { icon: 'pi pi-bolt', name: 'WP Context Injector', sub: 'names it $var', tone: 'node' },
          { icon: 'pi pi-sitemap', name: 'WP Context', sub: 'merged in', tone: 'node' },
        ]"
        :arrows="['wire', '$variable']"
        caption="The Injector gives an outside value a name the rest of the workflow can use."
      />
    </DocSection>

    <DocSection title="Inputs and outputs">
      <DocFields node="WP_ContextInjector" group="ports" />
    </DocSection>

    <DocSection title="Row options">
      <p>Right-click a row → <b>Edit</b> for its template and negative.</p>
      <DocFields node="WP_ContextInjector" group="rowOptions" />
    </DocSection>

    <DocSection title="Join several inputs">
      <p>
        Click <b>Add template row</b> and write a template like
        <VarToken>$input_0 by $input_1</VarToken>. A template row isn't tied to one input, stays
        when you rewire, and runs after the other rows, so it can also use the variables they made
        (<VarToken>$outfit</VarToken>).
      </p>
      <DocDetails>
        <p>
          A row made for a wired input can only use its own input in its template. It disappears
          when you unplug that input. Up to 10 inputs per Injector; chain a second one for more.
          Text works best: images and latents turn into their text description, which is rarely
          useful in a prompt.
        </p>
      </DocDetails>
      <Banner tone="info" note>
        Setting a variable here clears the negatives it had from earlier nodes; the row's own
        negative takes their place. A template row also carries the negatives of the variables it
        reads, before its own: <VarToken>$outfit</VarToken> = "$cloak with a silver clasp" brings
        <VarToken>$cloak</VarToken>'s "torn fabric". A hidden row, or one that only feeds a
        derivation, never adds to a negative.
      </Banner>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'negatives', label: 'Negatives', icon: 'pi pi-minus-circle', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
