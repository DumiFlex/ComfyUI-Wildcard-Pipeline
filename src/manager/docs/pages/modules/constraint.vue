<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";

const reweightModes = [
  { term: "Allow", desc: "Only these options can be picked — all others are removed from the pool." },
  { term: "Exclude", desc: "These options are removed from the pool; everything else remains." },
  { term: "Boost", desc: "These options have their weight increased, making them more likely without removing anything." },
  { term: "Reduce", desc: "These options have their weight decreased, making them less likely without removing anything." },
];

const reachModes = [
  { term: "All", desc: "Default — re-weight every matching target instance downstream of the constraint." },
  { term: "First", desc: "Only the first target instance after the constraint; later ones roll unconstrained." },
  { term: "Next N", desc: "The next N target instances (you set the count); the rest roll unconstrained." },
  { term: "Pick", desc: "Only specific target rows you tick — direct instances, or nested-ref carrier options that reach the target." },
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
        caption="The Starter pairing constraint modal — source Starter subject (feline/canine sub-categories) → target Starter mood (calm/intense). The 2×2 rule matrix boosts feline×intense + canine×calm by ×3.0 and reduces the mismatched diagonals to ×0.3. One Exceptions row below overrides tiger → sleepy to EXCLUDE so the EXTRA-tagged exception wins over the matrix boost when both apply."
      />
    </DocSection>

    <DocSection title="The flow">
      <DocFlow
        :stages="[
          { icon: 'pi pi-sparkles', name: 'Source wildcard', sub: 'its pick', tone: 'wildcard' },
          { icon: 'pi pi-filter', name: 'Constraint', sub: 'reweights', tone: 'constraint' },
          { icon: 'pi pi-sparkles', name: 'Target wildcard', sub: 'picks to match', tone: 'wildcard' },
        ]"
        :arrows="['if it lands on X', 'limits']"
        caption="The constraint nudges the odds of its downstream target instances — every match by default, or a narrower set you choose. It sets no $vars itself."
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
      <DocCallout variant="tip">
        By default a Constraint re-weights <em>every</em> matching target instance below it. Use
        the <strong>Target reach</strong> selector (below) to narrow that to the first, the next N,
        or a hand-picked set — and remember that position in the stack decides which instances are
        even reachable, since a constraint only sees targets after it.
      </DocCallout>
    </DocSection>

    <DocSection title="Target reach">
      <p>
        By default a constraint re-weights <em>every</em> matching target instance it can reach
        downstream. The per-instance <strong>Target reach</strong> selector narrows that scope:
      </p>
      <DocKeyList :items="reachModes" />
      <DocCallout variant="warn">
        If a constraint's reach lands on zero reachable targets — e.g. its only target sits above
        it, or you picked rows that aren't downstream — the editor flags it
        <VarToken>constraint_orphan_target</VarToken> so the dead pairing doesn't fail silently.
      </DocCallout>
    </DocSection>

    <DocSection title="Reattach a broken axis">
      <p>
        A constraint points at two wildcards by id — its <em>source</em> and its <em>target</em>.
        If one of those isn't in your library (you installed the constraint without its wildcards,
        or deleted one later), that axis is <strong>stranded</strong>: the editor shows the dead id
        with its remembered name and locks the rule matrix read-only until you fix it.
      </p>
      <p>
        Use <strong>Reattach</strong> to re-point the stranded axis at a local wildcard — or
        <strong>Download from community</strong> to pull the missing one. The matrix and exceptions
        then remap onto the new wildcard's sub-categories; any rows that don't exist there are
        dropped (the editor previews the count before you confirm).
      </p>
    </DocSection>

    <DocSection title="Deeper topics">
      <p>
        Full constraint mechanics — matrix vs exception priority, how constraints carry through
        nested references, the Target reach selectors in detail, and the "never fired" runtime
        notice — are covered on the Constraints concept page.
      </p>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create a starter Constraint that pairs the subject and mood wildcards: feline subjects lean
        intense, canine subjects lean calm. Clicking this also creates the two wildcards it needs
        (<VarToken>$subject</VarToken> and <VarToken>$mood</VarToken>) if they aren't in your
        library yet, so the pairing always wires up correctly.
      </p>
      <StarterButton slot="pairing" />
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
