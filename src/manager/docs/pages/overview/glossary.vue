<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="Overview"
    title="Glossary"
    icon="pi pi-book"
    tone="neutral"
    blurb="Key terms used throughout the documentation: module, instance, $var, @{uuid} ref, snapshot, drift, bundle, surface, chain seed, internal var."
  >
    <DocSection title="Terms">
      <dl class="wp-doc-glossary">
        <dt>Module</dt>
        <dd>
          A library entry — a named, authored piece of pipeline logic (Wildcard, Fixed Values,
          Combine, Derivation, Constraint). Stored in the database; reusable across any number of
          Contexts. Editing the library entry affects all future instances that reference it.
        </dd>

        <dt>Instance</dt>
        <dd>
          A module row inside a WP Context widget. An instance references a library entry by id
          and may carry per-instance overrides (e.g. option weights, locked seed). Multiple
          instances can reference the same library entry independently.
        </dd>

        <dt>Library entry</dt>
        <dd>
          The canonical, stored definition of a module in the database. Distinct from an instance:
          the library entry is what you author in the SPA; an instance is what you place in a
          Context.
        </dd>

        <dt><VarToken>$var</VarToken> (variable)</dt>
        <dd>
          A named string written into the Context by a producer module (Wildcard, Fixed Values,
          Combine). Named with <code>^[A-Za-z_][A-Za-z0-9_]*$</code>, ≤ 64 chars, never
          <code>__</code>-prefixed. Read by consumer modules (Combine, Derivation) and the
          Assembler.
        </dd>

        <dt><VarToken kind="ref">@{uuid}</VarToken> (nested ref)</dt>
        <dd>
          An 8-hex-char reference to another Wildcard module by uuid, used inside Wildcard option
          values. When a ref is encountered during resolution, the engine rolls that target
          wildcard's pool and substitutes the pick inline. Optional <code>#name</code> is
          display-only (matched on uuid); optional <code>:subcat</code> filters the target's pool
          (with inverted-null semantics: null is always included unless the reserved keyword
          <code>null</code> is in the filter).
        </dd>

        <dt>Snapshot</dt>
        <dd>
          A deep-cloned, frozen copy of a module (or bundle) payload captured at insert time.
          Bundle children are snapshots — they execute independently of subsequent library edits.
        </dd>

        <dt>Drift</dt>
        <dd>
          The state where a workflow's snapshot of a module no longer matches the current library
          entry. The SPA detects drift via content hashing and surfaces a badge. Drift is
          non-breaking — the workflow continues executing the snapshot until the user explicitly
          refreshes it.
        </dd>

        <dt>Bundle</dt>
        <dd>
          A container that groups a contiguous range of modules into a named, reusable unit. Not
          a module kind — bundles have no engine handler and produce no <code>$variable</code>
          directly. Bundle children are frozen snapshots. Default color <code>#46566B</code>.
        </dd>

        <dt>Surface</dt>
        <dd>
          The resolved-text context in which a particular syntax is valid. The three surfaces are
          <code>producer</code> (Wildcard option values, Fixed Values values — <VarToken kind="ref">@{uuid}</VarToken>
          supported in Wildcard only), <code>consumer</code> (Combine/Derivation templates —
          <VarToken>$var</VarToken> supported), and <code>assembler</code> (Assembler template —
          <VarToken>$var</VarToken>, <VarToken kind="inline">{a|b|c}</VarToken>, and escapes).
        </dd>

        <dt>Chain seed</dt>
        <dd>
          The <code>seed</code> integer input on WP Context / WP Context Loop. Each module derives
          its own RNG from the chain seed via <code>derive_module_rng</code>, so changing the seed
          changes all picks simultaneously. A module with <code>locked_seed</code> ignores the
          chain seed for that module's picks.
        </dd>

        <dt>Internal variable</dt>
        <dd>
          A <VarToken>$variable</VarToken> whose module instance has <code>internal: true</code>.
          Internal variables remain in the Context and are readable by downstream consumer
          modules, but are stripped at the render boundary (the Assembler) so they never appear
          in the final prompt output.
        </dd>
      </dl>
    </DocSection>

    <DocSection title="See also">
      <CrossLinks
        :links="[
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'internal-variables', label: 'Internal variables', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'bundles-concept', label: 'Bundles concept', icon: 'pi pi-share-alt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-glossary {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0;
}
.wp-doc-glossary dt {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--wp-text);
  padding: 10px 16px 10px 0;
  border-bottom: 1px solid var(--wp-border);
  align-self: baseline;
}
.wp-doc-glossary dd {
  font-size: 13px;
  color: var(--wp-text-muted);
  line-height: 1.6;
  margin: 0;
  padding: 10px 0;
  border-bottom: 1px solid var(--wp-border);
  align-self: baseline;
}
.wp-doc-glossary dt:last-of-type,
.wp-doc-glossary dd:last-of-type {
  border-bottom: none;
}
</style>
