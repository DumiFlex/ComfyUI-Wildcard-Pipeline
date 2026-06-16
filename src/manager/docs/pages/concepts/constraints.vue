<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocFigure from "../../../components/docs/DocFigure.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const modes = [
  {
    term: "Allow",
    desc: "Keep only matching options in the target pool. Everything else is removed before the target rolls.",
  },
  {
    term: "Exclude",
    desc: "Remove matching options from the target pool before it rolls.",
  },
  {
    term: "Boost",
    desc: "Multiply the weight of matching options by the factor you set (> 1 = more likely).",
  },
  {
    term: "Reduce",
    desc: "Multiply the weight of matching options by a factor less than 1 (= less likely).",
  },
];

const reachModes = [
  {
    term: "All",
    desc: "Default. Re-weight every target instance the constraint can reach downstream — direct rows and instances reached through nested refs alike.",
  },
  {
    term: "First",
    desc: "Re-weight only the first reachable target instance; every later one rolls unconstrained.",
  },
  {
    term: "Next N",
    desc: "Re-weight the next N reachable instances (you set the count, minimum 1); the rest roll unconstrained.",
  },
  {
    term: "Pick",
    desc: "Re-weight only the instances you tick from a checklist of reachable targets — direct rows, or nested-ref carrier options that resolve to the target.",
  },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Constraints in depth"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Source→target pairing, matrix vs exception rules, the target reach selectors, and ordering requirements."
  >
    <DocSection title="What a constraint does">
      <p>
        A <b>Constraint</b> module links a <em>source</em> wildcard to a <em>target</em> wildcard.
        After the source rolls its pick, the constraint adjusts the target's option pool — boosting
        some choices, excluding others, or narrowing it to a specific set — before the target rolls.
        The constraint itself does not set any <VarToken>$variable</VarToken>; it only shapes the
        odds for the target.
      </p>
      <p>
        A classic use: the source wildcard picks a season, and the constraint makes warm-toned
        lighting far more likely when the source rolled "summer", while cool tones become more
        likely when it rolled "winter".
      </p>
      <DocFigure caption="Source rolls → constraint adjusts target pool → target rolls.">
        <div class="wp-doc-constraint-flow">
          <div class="wp-doc-constraint-box wp-doc-constraint-box--source">
            <span class="wp-doc-constraint-label">Source wildcard</span>
            <span class="wp-doc-constraint-sub">rolls first</span>
          </div>
          <div class="wp-doc-constraint-arrow">→</div>
          <div class="wp-doc-constraint-box wp-doc-constraint-box--constraint">
            <span class="wp-doc-constraint-label">Constraint</span>
            <span class="wp-doc-constraint-sub">adjusts target pool</span>
          </div>
          <div class="wp-doc-constraint-arrow">→</div>
          <div class="wp-doc-constraint-box wp-doc-constraint-box--target">
            <span class="wp-doc-constraint-label">Target wildcard</span>
            <span class="wp-doc-constraint-sub">rolls with adjusted weights</span>
          </div>
        </div>
      </DocFigure>
    </DocSection>

    <DocSection title="Order matters">
      <p>
        The module stack runs top to bottom. The <em>source</em> wildcard must come before the
        Constraint, and the Constraint must come before the <em>target</em> wildcard. A constraint
        whose source has not yet rolled is silently skipped for that iteration.
      </p>
    </DocSection>

    <DocSection title="Matrix and exceptions">
      <p>
        A constraint's rules come in two layers that work together:
      </p>
      <ul>
        <li>
          <b>Matrix</b> — rules that apply to whole <em>subcategory</em> pairs. For example: when
          source subcategory "season/warm" rolled, boost all target options in subcategory
          "lighting/warm".
        </li>
        <li>
          <b>Exceptions</b> — rules that apply to specific individual option pairs. These override
          the matrix for exact combinations.
        </li>
      </ul>
      <DocCallout variant="tip">
        When a matrix rule and an exception both match a given pair, the <b>exception wins</b>.
        This lets you set broad subcategory behaviour and then fine-tune individual combinations
        on top.
      </DocCallout>
      <p>Each rule has a <b>mode</b>:</p>
      <DocKeyList :items="modes" />
      <DocImage
        src="images/docs/constraints-matrix.png"
        ratio="16 / 7"
        caption="The SPA's full Edit constraint page for the Starter pairing entry (breadcrumb Library › Constraints › Starter pairing, Unsaved badge). Wildcards section pins Starter subject as source + Starter mood as target. Rule matrix grids feline/canine × calm/intense with feline×intense + canine×calm at ↑×3 and the mismatched diagonals at ↓×0.3. Exceptions table below carries one row: tiger → sleepy · Exclude · — — the EXTRA exception wins over the matrix when both apply."
      />
    </DocSection>

    <DocSection title="Target reach">
      <p>
        A constraint is not a one-shot. By default it re-weights <em>every</em> target wildcard
        instance it can reach downstream — including instances reached through nested
        <VarToken kind="ref">@{uuid}</VarToken> refs. The per-instance <b>Target reach</b> selector
        lets you narrow that scope when re-weighting every match is too broad:
      </p>
      <DocKeyList :items="reachModes" />
      <p>
        Reach is always measured <em>downstream</em> of the constraint: it can only see — and count
        toward First / Next N — target instances that come after it in the run. A
        <b>Pick</b> selection names each instance the same way the engine matches it: a direct row
        by its per-instance id, or a nested ref by its carrier row plus the option that hosts the
        <VarToken kind="ref">@{uuid}</VarToken>.
      </p>
      <DocCallout variant="warn">
        If a constraint's reach covers zero reachable targets — its only target sits above it, the
        count overshoots what's downstream, or a picked instance no longer exists — it is flagged
        <VarToken>constraint_orphan_target</VarToken> so a dead pairing surfaces instead of silently
        doing nothing. Separately, a constraint that reaches fewer instances than a Next N / Pick
        selector asked for is noted as a partial reach.
      </DocCallout>
      <DocCallout variant="tip">
        You can still add multiple Constraint modules for the same source→target pair — one per
        distinct rule — and give each its own reach. Stack position plus each module's reach decide
        which instances every constraint claims.
      </DocCallout>
    </DocSection>

    <DocSection title="Constraints reach through nested refs">
      <p>
        If the target wildcard appears only inside another wildcard's option text (via a
        <VarToken kind="ref">@{uuid}</VarToken> nested reference), the constraint still applies —
        it follows the reference chain to find the target. Each such reachable instance counts as
        one target for the reach selector above, and a <b>Pick</b> entry can name it by its carrier
        row plus the hosting option. A safeguard counts each downstream instance only once even when
        multiple reference paths converge on it.
      </p>
    </DocSection>

    <DocSection title="When a source or target is missing">
      <p>
        A constraint refers to its source and target wildcards by id. If one isn't in your library —
        you installed the constraint without its wildcards, or deleted one — that axis is
        <b>stranded</b>: the editor shows the dead id with its remembered name and keeps the rule
        matrix read-only until you heal it. <b>Reattach</b> re-points the axis at a local wildcard
        (or downloads the missing one from the community), then remaps the matrix and exceptions onto
        the new wildcard's sub-categories.
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
