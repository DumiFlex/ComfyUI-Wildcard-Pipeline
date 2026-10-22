<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const rowOptions = [
  { term: "Name", desc: "The $variable the value becomes. Letters, digits and underscores, starting with a letter." },
  { term: "Template", desc: "Optional. Wrap the value in text, e.g. wearing $input_0. Leave empty to use the value as it is. $$ prints a dollar sign." },
  { term: "Negative", desc: "Optional negative words for this variable (it can use $input_0 too, so another node can write it). Only reaches an Assembler that prints the variable. Rows with one show a NEG badge." },
  { term: "Hide from prompt (globe)", desc: "The variable still reaches combines and derivations, but prints nothing in the prompt." },
];
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
      <DocImage
        src="images/docs/wp-context-injector.png"
        ratio="16 / 7"
        caption="Two text boxes wired into a WP Context Injector, named $outfit and $place, used in the Assembler's template."
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

    <DocSection title="Row options">
      <p>Right-click a row → <b>Edit</b> for its template and negative.</p>
      <DocKeyList :items="rowOptions" />
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
      <DocCallout variant="tip">
        Setting a variable here clears the negatives it had from earlier nodes; the row's own
        negative takes their place. A hidden row, or one that only feeds a derivation, never adds
        to a negative.
      </DocCallout>
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
