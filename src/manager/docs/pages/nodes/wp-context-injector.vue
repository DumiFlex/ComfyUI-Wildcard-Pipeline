<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const ports = [
  { term: "upstream (in)", desc: "An existing Context to extend. All of its variables pass through; the injector adds or overrides bindings on top. Leave unconnected to create a standalone Context from injected values only." },
  { term: "rows widget", desc: "Each row defines one variable. Give it a name, optionally write a template mixing socket values (e.g. $input_0 by $input_1), and choose whether it should be internal (available to modules but hidden from the final prompt)." },
  { term: "input_0 … input_9", desc: "Dynamic socket slots. Wire any ComfyUI output — a STRING, INT, FLOAT, or anything else — into a slot. Each wired socket is available in row templates by its slot name. Add up to 10 sockets; chain a second injector for more." },
  { term: "context (out)", desc: "The upstream Context with your injected bindings merged on top. Wire it into an Assembler, Debug node, or another Context." },
];

const rowOptions = [
  { term: "Binding name", desc: "The $variable name that downstream modules and the Assembler will see. Use letters, digits, and underscores; must start with a letter." },
  { term: "Template", desc: "Leave blank to write the raw socket value as-is. Enter a template like $input_0 by $input_1 to compose a value from multiple sockets. Use $$ for a literal dollar sign." },
  { term: "Internal", desc: "Tick this to make the variable available to Combine and Derivation modules downstream but keep it out of the assembled prompt text." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Context Injector"
    icon="pi pi-bolt"
    tone="node"
    node-id="WP_ContextInjector"
    blurb="Bridge any ComfyUI output into a named $variable. Wire a LoRA name, an INT, a slider value — anything — and give it a name the Assembler can use."
  >
    <DocSection title="What it's for">
      <p>
        Most variables in the pipeline come from wildcards and fixed values inside a WP Context.
        The <b>WP Context Injector</b> lets you bring in values from outside — a LoRA name
        picked by another node, an INT from a seed widget, a FLOAT from a slider — and give
        each one a <VarToken>$variable</VarToken> name. From that point on it behaves just like
        any other variable: you can reference it in the Assembler template, use it in a Combine
        rule, or read it in a Derivation.
      </p>
      <p>
        Chain multiple injectors for more bindings. Each one passes the upstream Context through
        unchanged and adds its own variables on top.
      </p>
      <DocImage
        src="images/docs/wp-context-injector.png"
        ratio="16 / 6"
        caption="A WP Context Injector with two rows visible in the widget, each named and wired to an input socket. The context output connects to a WP Prompt Assembler."
      />
    </DocSection>

    <DocSection title="Ports &amp; sockets">
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="Row options">
      <DocKeyList :items="rowOptions" />
    </DocSection>

    <DocSection title="Good to know">
      <DocCallout variant="tip">
        Use a template row to combine two sockets without an extra Combine module — set a
        template like <VarToken>$input_0 by $input_1</VarToken> and wire two STRING sources.
      </DocCallout>
      <DocCallout variant="tip">
        The injector is best suited for STRING, INT, and FLOAT values. Complex types like
        IMAGE or LATENT are stored as their text representation, which is rarely useful in a
        prompt.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
