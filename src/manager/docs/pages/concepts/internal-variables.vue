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
        A module's instance settings include an <b>internal</b> flag. When set, every binding that
        module produces is recorded into
        <VarToken kind="inline">__wp_internal_flags__</VarToken> inside the Context. The variable
        still lives in the Context and is fully readable by downstream combine and derivation
        modules. It is only removed at the <em>render boundary</em> — just before the Assembler
        resolves the template string — so it never appears in the final prompt.
      </p>
      <p>
        This is useful for intermediate computation variables: for example, a wildcard that picks
        a lighting preset name (<VarToken>$_lighting_key</VarToken>) which a derivation then uses
        to set a human-readable <VarToken>$lighting</VarToken> description. The key variable is
        internal; the description is not.
      </p>
    </DocSection>

    <DocSection title="Two strip boundaries">
      <p>
        There are two points where variables are removed from the Context:
      </p>
      <ul>
        <li>
          <b>Socket boundary</b> (<code>strip_engine_internals</code>) — when a Context is emitted
          on a <code>PIPELINE_CONTEXT</code> output socket. Only
          <VarToken kind="inline">__</VarToken>-prefixed engine-internal keys are dropped here.
          User-flagged-internal variables travel unaffected to the next node in the chain.
        </li>
        <li>
          <b>Render boundary</b> (<code>strip_internals</code>) — inside the Assembler, just
          before template resolution. Both engine-internal keys <em>and</em> user-flagged-internal
          variables are removed from the map used for substitution.
        </li>
      </ul>
      <DocCallout variant="tip">
        Because internal variables survive the socket boundary, a variable set as internal in
        <b>Context A</b> is still readable by a derivation in <b>Context B</b> downstream. Only
        the Assembler hides it.
      </DocCallout>
    </DocSection>

    <DocSection title="Loop iteration variable flags">
      <p>
        The iteration variables injected by <b>WP Context Loop</b> —
        <VarToken>$iteration</VarToken> and <VarToken>$&lt;name&gt;_total</VarToken> — each have
        their own internal flag in the loop configuration
        (<code>iteration_internal</code> / <code>total_internal</code>). By default both are
        flagged internal, so they do not appear in the rendered prompt. Set either flag to
        <code>false</code> to surface the variable in the Assembler output.
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
