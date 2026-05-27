<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFigure from "../../../components/docs/DocFigure.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How it connects"
    title="Constraints in depth"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Source→target pairing, matrix vs exception rules, first-instance one-shot consumption, and ordering requirements."
  >
    <DocSection title="What a constraint does">
      <p>
        A <b>Constraint</b> module links a <em>source</em> wildcard to a <em>target</em> wildcard.
        After the source wildcard rolls its pick, the constraint reweights the target wildcard's
        option pool before the target rolls. The constraint module itself does not set any
        <VarToken>$variable</VarToken> — it only adjusts probabilities for the target pick.
      </p>
      <DocFigure caption="Source rolls → constraint reweights target pool → target rolls.">
        <div class="wp-doc-constraint-flow">
          <div class="wp-doc-constraint-box wp-doc-constraint-box--source">
            <span class="wp-doc-constraint-label">Source wildcard</span>
            <span class="wp-doc-constraint-sub">rolls first</span>
          </div>
          <div class="wp-doc-constraint-arrow">→</div>
          <div class="wp-doc-constraint-box wp-doc-constraint-box--constraint">
            <span class="wp-doc-constraint-label">Constraint</span>
            <span class="wp-doc-constraint-sub">reweights pool</span>
          </div>
          <div class="wp-doc-constraint-arrow">→</div>
          <div class="wp-doc-constraint-box wp-doc-constraint-box--target">
            <span class="wp-doc-constraint-label">Target wildcard</span>
            <span class="wp-doc-constraint-sub">rolls with adjusted weights</span>
          </div>
        </div>
      </DocFigure>
    </DocSection>

    <DocSection title="Ordering requirement">
      <p>
        Module order in the stack matters: the <em>source</em> wildcard must appear before the
        Constraint, and the Constraint must appear before the <em>target</em> wildcard. The engine
        processes modules top-to-bottom; a constraint whose source has not yet rolled is silently
        skipped.
      </p>
    </DocSection>

    <DocSection title="Matrix vs exceptions">
      <p>
        A constraint's matching rules come in two forms:
      </p>
      <ul>
        <li>
          <b>Matrix</b> — keyed by <code>(source_subcategory, target_subcategory)</code> pairs.
          Assigns a mode and factor to entire subcategory cross-products.
        </li>
        <li>
          <b>Exceptions</b> — keyed by <code>(source_option_id, target_option_id)</code> pairs.
          Override the matrix for specific individual option combinations.
        </li>
      </ul>
      <DocCallout variant="tip">
        When both a matrix rule and an exception match a given pick, the <b>exception wins</b>.
        Use exceptions for exact overrides on top of a broad subcategory matrix.
      </DocCallout>
      <p>
        Modes: <code>allow</code> (keep only matching options), <code>exclude</code> (remove
        matching options), <code>boost</code> (multiply weight by factor), <code>reduce</code>
        (multiply weight by factor &lt; 1). Factor must be ≥ 0. The null option is treated as a
        real option and is addressed by an empty-string key in the matrix/exceptions.
      </p>
    </DocSection>

    <DocSection title="First-instance one-shot consumption">
      <p>
        Each Constraint module is consumed on the <b>first</b> downstream target wildcard instance
        it encounters — including instances reached through nested
        <VarToken kind="ref">@{uuid}</VarToken> refs. Once consumed, the constraint is inert for
        any further instances of the same target wildcard in the same execution. Consumed
        constraints are tracked in
        <VarToken kind="inline">__wp_consumed_constraints__</VarToken> (a set keyed by the owning
        constraint module's id).
      </p>
      <DocCallout variant="warn">
        There are <b>no</b> Local/Global or Stack/Override scope modes. If you need the same
        pairing to apply to multiple target instances, author multiple Constraint modules — one
        per target instance you want to affect. The position of each constraint in the module
        stack controls which target instance it claims.
      </DocCallout>
    </DocSection>

    <DocSection title="Nested reach and carrier claim">
      <p>
        The constraint engine follows <VarToken kind="ref">@{uuid}</VarToken> nested refs as it
        scans downstream for the target wildcard. If the target is reached via a nested ref inside
        another wildcard's option text, the constraint still fires — the intermediate wildcard acts
        as a carrier. A carrier-claim failsafe prevents the same constraint from claiming the same
        downstream instance more than once, even when multiple ref paths converge on it.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-constraint-flow {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 6px 0;
}
.wp-doc-constraint-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 16px;
  border-radius: var(--wp-radius);
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-2);
  min-width: 130px;
}
.wp-doc-constraint-box--source { border-color: var(--wp-kind-wildcard); }
.wp-doc-constraint-box--constraint { border-color: var(--wp-kind-constraint); }
.wp-doc-constraint-box--target { border-color: var(--wp-kind-wildcard); }
.wp-doc-constraint-label { font-size: 12px; font-weight: 600; color: var(--wp-text); }
.wp-doc-constraint-sub { font-size: 10.5px; color: var(--wp-text-dim); }
.wp-doc-constraint-arrow { font-size: 18px; color: var(--wp-text-dim); }
</style>
