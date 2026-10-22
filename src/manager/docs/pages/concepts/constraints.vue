<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const reachModes = [
  { term: "All", desc: "The default. Every use of the target below the constraint." },
  { term: "First", desc: "Only the first use below it; later ones roll freely." },
  { term: "Next N", desc: "The next N uses below it (you set N); the rest roll freely." },
  { term: "Pick", desc: "Only the uses you tick from a list of the ones it can reach." },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Constraints in depth"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="For bigger packs: how several constraints combine, how far a constraint reaches, tag axes on either side, and wildcards used inside references."
  >
    <DocSection title="Before you read this">
      <p>
        This page builds on the <DocRef id="constraint" /> page, which covers making a constraint,
        the rule modes, Only, the preview and the order in the stack. You only need what's below
        when one wildcard is used several times, constraints overlap, or you use tag axes.
      </p>
    </DocSection>

    <DocSection title="Several constraints on one target">
      <p>
        Every constraint that reaches a target applies, and their effects multiply: a ×3 boost and a
        ×0.5 reduce give ×1.5. An Exclude from any of them wins. You can add several constraints for
        the same source and target, one per rule, each with its own reach.
      </p>
    </DocSection>

    <DocSection title="How far a constraint reaches">
      <p>
        A constraint isn't used up after one pick. By default it changes the odds of
        <em>every</em> use of its target below it in the run, including uses inside references. Each
        use of a constraint in a Context has a <b>Target reach</b> setting to narrow that:
      </p>
      <DocKeyList :items="reachModes" />
      <p>
        Reach only looks downwards: First and Next N count from the constraint's own position. Pick
        names each use by its row, or, for a use inside a reference, by the row and option that hold
        the reference.
      </p>
      <DocCallout variant="warn">
        If a constraint reaches nothing (its only target sits above it, the count is larger than
        what's below, or a picked row is gone), the canvas flags it so a dead pairing doesn't go
        unnoticed. If it reaches fewer uses than Next N or Pick asked for, WP Debug notes a partial
        reach after the run.
      </DocCallout>
    </DocSection>

    <DocSection title="Targets used inside references">
      <p>
        If the target wildcard only appears inside another wildcard's option text, as an
        <VarToken kind="ref">@{…}</VarToken> reference, the constraint still applies: it follows the
        reference to find the target. Each such use counts once for the reach setting, even when
        several references lead to it.
      </p>
    </DocSection>

    <DocSection title="Tag axes on either side">
      <p>
        A tag group marked <b>accepts</b> (an axis, read as <VarToken>$var.AXIS</VarToken>) lists
        alternatives: one of its tags is rolled per pick. Constraints treat it so the tag you read
        always agrees with the tag the constraint acts on.
      </p>
      <ul>
        <li><b>Accepts source.</b> The constraint uses the one tag that was rolled, not every tag on
          the option. An outfit tagged sneakers · heels · sandals that rolls sandals makes a
          “same tag wins” matrix pin the target to sandals, so <VarToken>$outfit.SHOES</VarToken>
          and the shoe that gets picked match.</li>
        <li><b>Classify source</b> (the default kind): all the option's tags apply together. With a
          strict diagonal matrix, an option carrying several tags can rule out the whole target.</li>
        <li><b>Accepts target.</b> A target option stays in the pool if the source allows any of its
          axis tags, and its own axis roll is then limited to the allowed tag. A shoe tagged
          sandals · heels isn't dropped because heels is excluded; it stays and rolls sandals.</li>
      </ul>
      <p>
        An accepts source, an accepts target and a diagonal matrix together make
        <VarToken>$source.AXIS</VarToken> equal <VarToken>$target.AXIS</VarToken> on every run.
      </p>
    </DocSection>

    <DocSection title="Constraints across chained Contexts">
      <p>
        A constraint in one Context also applies to its target in a later, chained Context. You can
        keep all your pairing rules in a separate "constraints" Context placed before the one with
        the wildcards.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'context-chaining', label: 'Context chaining', icon: 'pi pi-share-alt', tone: 'neutral' },
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
