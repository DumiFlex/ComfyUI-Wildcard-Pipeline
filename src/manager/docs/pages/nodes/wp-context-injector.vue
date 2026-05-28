<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const ports = [
  { term: "upstream (in)", desc: "An existing Context to extend. All of its variables pass through; the injector adds or overrides bindings on top. Leave unconnected to create a standalone Context from injected values only." },
  { term: "rows widget", desc: "Holds two kinds of rows: socket rows (one per wired input) and template rows you add manually. Each defines one $variable and can be marked internal (available to modules but hidden from the final prompt)." },
  { term: "input_0 … input_9", desc: "Dynamic socket slots. Wire any ComfyUI output — a STRING, INT, FLOAT, or anything else — into a slot. A socket row appears automatically. Add up to 10 sockets; chain a second injector for more." },
  { term: "context (out)", desc: "The upstream Context with your injected bindings merged on top. Wire it into an Assembler, Debug node, or another Context." },
];

const rowKinds = [
  { term: "Socket row", desc: "Created automatically when you wire an input, and removed when you disconnect it. Binds that one socket to a $variable. Its optional template may reference only its OWN socket (e.g. the input_0 row can use $input_0) — rows resolve top to bottom, so a socket row can't read a later socket." },
  { term: "Template row", desc: "Add one with the “Add template row” button. It isn't tied to any socket and survives disconnects. It runs after all socket rows, so its template can compose from both the raw sockets ($input_0, $input_1, …) and the variables the socket rows produced ($test). Use it to combine multiple inputs." },
];

const rowOptions = [
  { term: "Binding name", desc: "The $variable name that downstream modules and the Assembler will see. Use letters, digits, and underscores; must start with a letter." },
  { term: "Template", desc: "On a socket row: leave blank to write the raw socket value as-is, or wrap just that socket (e.g. prefix $input_0). On a template row: required — compose from any input or socket-row variable (e.g. $input_0 by $test). Use $$ for a literal dollar sign." },
  { term: "Internal", desc: "Tick this to make the variable available to Combine and Derivation modules downstream but keep it out of the assembled prompt text. Works on both row kinds." },
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
        caption="A String (Multiline) node feeding a long template into WP Context Injector. The injector widget shows two binding rows (template_subject + subject) wired to the multiline String output. Its context output flows into WP Prompt Assembler ($subject variable chip lit) and a Show Any node renders the assembled prompt downstream."
      />
    </DocSection>

    <DocSection title="The flow">
      <DocFlow
        :stages="[
          { icon: 'pi pi-sign-in', name: 'External node', sub: 'any output', tone: 'neutral' },
          { icon: 'pi pi-bolt', name: 'WP Context Injector', sub: 'names it $var', tone: 'node' },
          { icon: 'pi pi-sitemap', name: 'WP Context', sub: 'merged in', tone: 'node' },
        ]"
        :arrows="['wire', '$variable']"
        caption="The injector lifts an outside value into a named $variable the rest of the pipeline can use."
      />
    </DocSection>

    <DocSection title="Ports &amp; sockets">
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="Two kinds of rows">
      <p>
        The injector resolves rows top to bottom in two passes. <b>Socket rows</b> run first
        — each one turns a single wired input into a <VarToken>$variable</VarToken>, and its
        template (if any) can only reference its own socket. <b>Template rows</b> run last, so
        they can compose from every input <em>and</em> from the variables the socket rows
        produced.
      </p>
      <DocKeyList :items="rowKinds" />
    </DocSection>

    <DocSection title="Row options">
      <DocKeyList :items="rowOptions" />
    </DocSection>

    <DocSection title="Good to know">
      <DocCallout variant="tip">
        To combine two sockets without an extra Combine module, click <b>Add template row</b>
        and set a template like <VarToken>$input_0 by $input_1</VarToken>. You name the row's
        <VarToken>$variable</VarToken> inline in its header and set that template from the row's
        edit panel (right-click the row → Edit) — the same edit panel socket rows use. A template
        row runs after every socket row, so it can also reference the variables those rows produce
        (for example <VarToken>$test</VarToken>) — and it sticks around even if you re-wire the
        inputs. A socket row's own template can only use its own socket.
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
