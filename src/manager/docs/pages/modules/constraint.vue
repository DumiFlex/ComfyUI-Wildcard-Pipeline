<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const reweightModes = [
  { term: "Allow", desc: "Only these options can be picked — all others are removed from the pool." },
  { term: "Exclude", desc: "These options are removed from the pool; everything else remains." },
  { term: "Boost", desc: "These options have their weight increased, making them more likely without removing anything." },
  { term: "Reduce", desc: "These options have their weight decreased, making them less likely without removing anything." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Constraint"
    icon="pi pi-filter"
    tone="constraint"
    blurb="Tilt a downstream wildcard's odds based on what an earlier wildcard picked. Sets no $variables itself — it only influences what the target wildcard rolls."
  >
    <DocSection title="What it does">
      <p>
        A Constraint module watches the pick made by a <em>source</em> wildcard and then adjusts
        the option weights of a <em>target</em> wildcard further down the stack — before that
        target makes its own pick. The constraint itself sets no
        <VarToken>$variables</VarToken> and produces no text; its entire effect is the nudge it
        gives to the target.
      </p>
      <p>
        For example: source wildcard <VarToken>$weather</VarToken> picked "stormy" → boost
        "dramatic" and "moody" in <VarToken>$mood</VarToken>, reduce "sunny" and "cheerful".
        The target still picks randomly — you're just shifting the odds.
      </p>
      <DocImage
        src="images/docs/constraint-matrix.png"
        ratio="16 / 7"
        caption="The constraint matrix editor with a $weather wildcard as the source and $mood as the target. Cells in the grid show Boost, Reduce, Allow, or Exclude for each source-option / target-option pair."
      />
    </DocSection>

    <DocSection title="Reweight modes">
      <DocKeyList :items="reweightModes" />
      <DocCallout variant="tip">
        Exception rules (per-option pairs) win over sub-category matrix rules when both apply to
        the same option. Use exceptions for precise overrides and the matrix for broad category
        nudges.
      </DocCallout>
    </DocSection>

    <DocSection title="Stack order matters">
      <p>
        The Constraint module must sit <em>after</em> its source wildcard and <em>before</em> its
        target wildcard in the stack. The engine runs modules top-to-bottom, so position controls
        the source → constraint → target chain.
      </p>
      <DocCallout variant="warn">
        Each Constraint is a one-shot — it fires on the first instance of the target wildcard it
        encounters and is then consumed. If you need to influence multiple uses of the same target,
        add a separate Constraint module for each. Position in the stack controls which target
        instance each constraint claims.
      </DocCallout>
    </DocSection>

    <DocSection title="Deeper topics">
      <p>
        Full constraint mechanics — matrix vs exception priority, how constraints carry through
        nested references, and the "never fired" runtime notice — are covered on the Constraints
        concept page.
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
