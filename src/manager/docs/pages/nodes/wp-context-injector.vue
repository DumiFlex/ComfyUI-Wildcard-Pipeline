<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import PropTable from "../../../components/docs/PropTable.vue";
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
    blurb="Lifts arbitrary ComfyUI outputs into named $var bindings on the PipelineContext — bridge from non-WP nodes into the variable pipeline."
  >
    <DocSection title="What it does">
      <p>
        Connect any ComfyUI output — a LoRA name string, an INT from a seed node, a FLOAT
        from a slider — into a socket slot, then give it a variable name. The injector writes
        <VarToken>$binding = stringified(value)</VarToken> into the Context so downstream
        modules (Combine, Derivation) and the Assembler can reference it just like a wildcard
        pick. Chain multiple injectors for more bindings; each forwards the upstream Context
        unchanged then adds or overrides its own bindings on top (last write wins).
      </p>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <PropTable
        :rows="[
          { name: 'upstream', type: 'PIPELINE_CONTEXT', required: false, desc: 'Optional upstream Context to chain onto. Its $vars flow through; injected bindings override same-named keys.' },
          { name: 'rows', type: 'WP_INJECTOR_ROWS', required: true, desc: 'The injector widget — each row has a binding name, an optional template, and an internal toggle.' },
          { name: 'input_0 … input_9', type: 'any', required: false, desc: 'Dynamic socket slots. Wire any ComfyUI output here. Managed by the frontend; capped at 10 sockets.' },
          { name: 'context (out)', type: 'PIPELINE_CONTEXT', required: true, desc: 'Resolved Context with injected bindings merged on top of upstream.' },
        ]"
      />
    </DocSection>

    <DocSection title="Key behaviors">
      <ul>
        <li>
          <b>not_idempotent = true</b> — re-runs on every queue execution, even if the wired
          inputs are unchanged. This ensures the bound values always reflect the current upstream
          node outputs.
        </li>
        <li>
          <b>10-socket cap (frontend-enforced)</b> — the UI allows up to 10 dynamic socket slots
          (<code>slot_0…slot_9</code>). The Python node accepts all connected inputs via
          <code>accept_all_inputs=True</code>; the 10-slot limit is a user-facing constraint
          enforced by the frontend widget. Chain a second injector if you need more than 10.
        </li>
        <li>
          <b>Binding name rules</b> — names must match <code>^[a-zA-Z][a-zA-Z0-9_]*$</code>.
          Names starting with <code>_</code> are reserved and emit a runtime warning.
        </li>
        <li>
          <b>Pass-through vs template rows</b> — a row with no template writes the raw socket
          value directly. A row with a template (e.g. <code>prefix $input_0</code>) renders
          <VarToken>$slot_name</VarToken> substitutions from all wired sockets, then writes
          the resulting string. <code>$$</code> escapes to a literal <code>$</code>.
        </li>
        <li>
          <b>Internal rows</b> — tick <b>internal</b> on a row to hide its binding from the
          assembled prompt while keeping it readable by Combine and Derivation rules downstream.
        </li>
        <li>
          <b>Non-primitive values</b> — LATENT, IMAGE, and other complex types are stored as
          their Python <code>str()</code> representation. Intended for STRING / INT / FLOAT use.
        </li>
      </ul>
      <DocCallout variant="tip">
        Use a template row to compose a value from multiple sockets without adding extra
        Combine modules: set a template like <code>$input_0 by $input_1</code> and wire two
        STRING sources.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'internal-variables', label: 'Internal variables', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'context-chaining', label: 'Context chaining', icon: 'pi pi-share-alt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
