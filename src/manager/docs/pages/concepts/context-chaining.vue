<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How it connects"
    title="Context chaining"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Wire one WP Context into another. The second starts with the first one's variables and can add to them or replace them."
  >
    <DocSection title="How it works">
      <p>
        Wire a WP Context's <code>context</code> output into another Context's
        <code>upstream</code> input. The second Context starts with every variable the first one
        made, then runs its own modules. If it sets a variable that already exists, its value
        wins. Everything it doesn't touch passes through as it was.
      </p>
      <DocFlow figure="context-chaining-flow"
        :stages="[
          { icon: 'pi pi-sitemap', name: 'WP Context A', sub: 'rolls $vars', tone: 'node' },
          { icon: 'pi pi-sitemap', name: 'WP Context B', sub: 'adds / replaces', tone: 'node' },
          { icon: 'pi pi-align-left', name: 'Prompt Assembler', sub: 'fills template', tone: 'node' },
        ]"
        :arrows="['feeds', 'merged $vars']"
        caption="Each Context starts with the variables before it; the last one to set a variable wins."
      />
      <p>
        A common setup: one Context for the character and the place, a second that only sets
        <VarToken>$style</VarToken>. Swap or bypass the second to try another style while the rest
        stays the same. Chain as many as you like.
      </p>
      <DocImage
        src="images/docs/context-chaining.png"
        ratio="16 / 6"
        caption="Two chained WP Contexts: the first sets $subject and $mood, the second adds $hair and $pose, and one Assembler reads all four."
      />
      <DocCallout variant="tip">
        To add a single value from the canvas, such as typed text or a caption, a
        <b>WP Context Injector</b> is lighter than a whole Context.
      </DocCallout>
    </DocSection>

    <DocSection title="Good to know">
      <ul>
        <li><b>Hidden variables</b> stay hidden down the whole chain, and later Contexts can still
          read them.</li>
        <li><b>Constraints</b> work across Contexts: a constraint in one Context can change the odds
          of a wildcard in a later one, as long as the source wildcard comes before the constraint.
          You can keep all your constraints in a Context of their own, between the one with the
          sources and the one with the targets.</li>
        <li>WP Debug shows which Context set each variable.</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'internal-variables', label: 'Hidden variables', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
