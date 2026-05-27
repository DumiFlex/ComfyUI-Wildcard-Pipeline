<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="Modules"
    title="Combine"
    icon="pi pi-link"
    tone="combine"
    blurb="Template-fill $variables and inline syntax into a single output $variable. The consumer module for assembling multi-part values."
  >
    <DocSection title="What it does">
      <p>
        A Combine module resolves a template string — interpolating
        <VarToken>$var</VarToken> references and <VarToken kind="inline">{a|b|c}</VarToken>
        inline picks — and writes the result to a single <VarToken>$output_var</VarToken>.
        Because Combine is a <em>consumer</em> module, it can read any
        <VarToken>$variable</VarToken> that was set earlier in the module stack.
        <VarToken kind="ref">@{uuid}</VarToken> refs are <strong>not</strong> supported
        in Combine templates (that surface is wildcard-only).
      </p>
    </DocSection>

    <DocSection title="Payload shape">
      <p>Key fields in a Combine library entry:</p>
      <ul>
        <li>
          <code>template</code> — the template string containing <VarToken>$var</VarToken>
          placeholders and/or <VarToken kind="inline">{a|b|c}</VarToken> picks.
          <code>$$</code> escapes to a literal <code>$</code>.
        </li>
        <li>
          <code>output_var</code> — the <VarToken>$variable</VarToken> name this module
          writes. Must match <code>^[A-Za-z_][A-Za-z0-9_]*$</code>, ≤ 64 chars,
          never <code>__</code>-prefixed.
        </li>
        <li>
          <code>input_vars</code> — advisory list of <VarToken>$variables</VarToken> the
          template reads. Used by the scanner to detect missing upstream producers; not
          enforced at runtime.
        </li>
      </ul>
    </DocSection>

    <DocSection title="Instance overrides">
      <p>An instance can override library defaults without modifying the library entry:</p>
      <ul>
        <li><b>template_override</b> — replace the entire template string for this instance.</li>
        <li><b>variable_binding</b> — remap the output variable name for this instance.</li>
      </ul>
      <DocCallout variant="tip">
        Combine is the primary tool for merging multiple <VarToken>$vars</VarToken> into a
        single composite value — for example, combining <VarToken>$style</VarToken> and
        <VarToken>$subject</VarToken> into a <VarToken>$prompt_fragment</VarToken>.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'fixed-values', label: 'Fixed Values', icon: 'pi pi-tag', tone: 'fixed_values' },
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
