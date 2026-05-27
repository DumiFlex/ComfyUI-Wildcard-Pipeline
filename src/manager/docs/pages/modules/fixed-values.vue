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
    title="Fixed Values"
    icon="pi pi-tag"
    tone="fixed_values"
    blurb="Assign explicit name = value bindings into the Context. Values resolve inline syntax but cannot read $variables from the Context."
  >
    <DocSection title="What it does">
      <p>
        A Fixed Values module writes one or more <VarToken>$name = value</VarToken> pairs
        into the Context unconditionally. Each value is passed through <code>resolve_text</code>
        to expand <VarToken kind="inline">{a|b|c}</VarToken> inline-pick syntax and handle
        <code>$$</code>→<code>$</code> / <code>@@</code>→<code>@</code> escapes.
        Because Fixed Values is a <em>producer</em> module, it cannot read
        <VarToken>$variables</VarToken> or <VarToken kind="ref">@{uuid}</VarToken> refs from
        the Context — those surfaces are gated to consumer modules (Combine, Derivation, Assembler).
      </p>
    </DocSection>

    <DocSection title="Payload shape">
      <p>Key fields in a Fixed Values library entry:</p>
      <ul>
        <li>
          <code>values</code> — array of <code>{ id, name, value }</code>.
          <code>name</code> must be a valid variable name (<code>^[A-Za-z_][A-Za-z0-9_]*$</code>,
          ≤ 64 chars, never <code>__</code>-prefixed). <code>id</code> must be unique within
          the module. <code>value</code> is a plain string (resolved at runtime).
        </li>
      </ul>
    </DocSection>

    <DocSection title="Instance overrides">
      <p>An instance can override library defaults without modifying the library entry:</p>
      <ul>
        <li><b>values_overrides</b> — full replacement of the value for a specific binding id.</li>
        <li><b>enabled_options</b> — per-binding enable/disable flags.</li>
        <li><b>locked_seed</b> — freeze any inline <code>{a|b|c}</code> picks across loop iterations.</li>
      </ul>
      <DocCallout variant="tip">
        Fixed Values is the simplest way to inject a constant into the Context — no options, no
        weights, just a direct name-to-string mapping.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'combine', label: 'Combine', icon: 'pi pi-link', tone: 'combine' },
          { id: 'derivation', label: 'Derivation', icon: 'pi pi-arrow-right-arrow-left', tone: 'derivation' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
