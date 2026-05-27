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
    title="Wildcard"
    icon="pi pi-sparkles"
    tone="wildcard"
    blurb="Weighted random pick from an option pool that sets one $variable. Supports nested syntax, subcategory filters, and constraint-driven reweighting."
  >
    <DocSection title="What it does">
      <p>
        A Wildcard module picks one option from its pool using weighted RNG (seeded by the Context
        seed via the module's derived RNG). The picked value is passed through
        <code>resolve_text</code> — meaning nested <VarToken kind="inline">{a|b|c}</VarToken> and
        <VarToken kind="ref">@{uuid}</VarToken> syntax inside the option text is fully resolved.
        The result is written to the Context as <VarToken>$var_binding</VarToken>.
      </p>
    </DocSection>

    <DocSection title="Payload shape">
      <p>Key fields in a Wildcard library entry:</p>
      <ul>
        <li><code>options</code> — array of <code>{ id, value, weight, sub_category?, is_null? }</code>. Weights must be ≥ 0; ids must be unique within the module. At most one option may have <code>is_null: true</code>.</li>
        <li><code>var_binding</code> — the <VarToken>$variable</VarToken> name this module writes. Must match <code>^[A-Za-z_][A-Za-z0-9_]*$</code>, ≤ 64 chars, never <code>__</code>-prefixed.</li>
        <li><code>sub_categories</code> — list of subcategory labels used to filter or constraint-target subsets of options.</li>
      </ul>
    </DocSection>

    <DocSection title="Instance overrides">
      <p>
        An instance of a Wildcard (a module row in a Context widget) can override library defaults
        without modifying the library entry:
      </p>
      <ul>
        <li><b>mode</b> — <code>random</code> (default weighted pick) or <code>subcategory</code> (engine-identical to <code>random</code>; a UX framing that pre-filters by subcategory, but the underlying resolution is the same weighted pick). <code>pinned</code> locks to a fixed option regardless of seed.</li>
        <li><b>category_filter</b> — restrict picks to one or more subcategories. Null options always survive the filter unless the reserved keyword <code>null</code> is explicitly in the filter list.</li>
        <li><b>enabled_options</b> — per-option enable/disable flags (not a weight override).</li>
        <li><b>option_weights</b> — replace (not multiply) individual option weights for this instance.</li>
        <li><b>locked_seed</b> — freeze this instance's pick across loop iterations.</li>
      </ul>
      <DocCallout variant="tip">
        <code>mode: "subcategory"</code> is engine-identical to <code>mode: "random"</code> —
        it is a UX convenience that pre-populates the category filter, not a separate resolution
        path.
      </DocCallout>
    </DocSection>

    <DocSection title="Constraint interaction">
      <p>
        When a <b>Constraint</b> module targets this Wildcard, its pool is reweighted (via the
        matrix or exception rules) immediately before the pick. The Constraint module must be
        positioned after its source Wildcard and before this target Wildcard in the module stack.
        See the <b>Constraints</b> concept page for full mechanics.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
