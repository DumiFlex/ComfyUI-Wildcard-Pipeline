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
    title="Constraint"
    icon="pi pi-filter"
    tone="constraint"
    blurb="Reweight a target Wildcard based on a source Wildcard's pick. Metadata-only — sets no $variables itself."
  >
    <DocSection title="What it does">
      <p>
        A Constraint module is <strong>metadata-only</strong>: it sets no <VarToken>$variables</VarToken>
        and writes nothing to the Context directly. Instead, it registers a reweighting rule into
        <code>__wp_constraints__</code> — the engine's internal constraint table. When the
        <em>target</em> Wildcard later rolls its pick, the engine reads this table and applies the
        matrix or exception rules to reweight the target's option pool before the pick is made.
      </p>
      <DocCallout variant="tip">
        Because a Constraint sets no variables, it is invisible to the prompt output on its own.
        Its effect is entirely through the reweighted pick of the downstream target Wildcard.
      </DocCallout>
    </DocSection>

    <DocSection title="Payload shape">
      <p>Key fields in a Constraint library entry:</p>
      <ul>
        <li>
          <code>source_wildcard_id</code> — the uuid of the upstream Wildcard whose pick drives
          the reweighting.
        </li>
        <li>
          <code>target_wildcard_id</code> — the uuid of the downstream Wildcard whose option pool
          is reweighted.
        </li>
        <li>
          <code>matrix</code> — keyed <code>(source_subcat, target_subcat)</code>; coarse-grained
          reweighting by subcategory pair.
        </li>
        <li>
          <code>exceptions</code> — keyed <code>(source_value, target_value)</code>; per-option
          overrides. Exception rules win over the matrix when both match.
        </li>
      </ul>
    </DocSection>

    <DocSection title="Ordering requirements">
      <p>
        The module stack order matters for constraints. The source Wildcard must roll
        <em>before</em> the Constraint, and the Constraint must appear <em>before</em> the target
        Wildcard. The engine processes modules top-to-bottom, so position in the stack controls
        the source→constraint→target dependency chain.
      </p>
      <DocCallout variant="warn">
        A Constraint is a <strong>one-shot consume</strong> — it fires on the <em>first</em>
        instance of the target Wildcard encountered downstream (including via nested
        <VarToken kind="ref">@{uuid}</VarToken> refs), then is consumed. To affect multiple
        target instances, author multiple Constraint modules. Position in the stack controls
        which target instance each constraint claims.
      </DocCallout>
    </DocSection>

    <DocSection title="Mechanics and deeper topics">
      <p>
        Full constraint mechanics — including the matrix vs exception priority, null option
        handling, cross-node carrier reach, and the <code>constraint_never_applied</code>
        runtime warning — are covered on the Constraints concept page.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
