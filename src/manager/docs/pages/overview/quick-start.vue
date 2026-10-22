<script setup lang="ts">
import { useRouter } from "vue-router";
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const router = useRouter();

function createStarterWildcard(): void {
  router.push("/wildcards/new?starter=subject");
}
</script>

<template>
  <DocPage
    group="Overview"
    title="Quick start"
    icon="pi pi-play"
    tone="neutral"
    blurb="Build the smallest working pipeline in a few minutes: one wildcard, one template, one prompt."
  >
    <DocSection title="Step 1: Make a wildcard">
      <p>
        Click the button below. The wildcard editor opens with a "subject" wildcard filled in:
        <em>a cat</em>, <em>a dog</em> and <em>a fox</em>, all equally likely. Change the options if
        you like, then click <b>Save</b>.
      </p>
      <div class="wp-qs-cta">
        <button class="wp-qs-cta__btn" type="button" @click="createStarterWildcard">
          <i class="pi pi-sparkles" aria-hidden="true" />
          Create a starter wildcard
        </button>
      </div>
      <DocImage
        src="images/docs/quick-start-starter.png"
        ratio="2 / 1"
        caption="The New wildcard form filled in by the button: a subject wildcard with a cat, a dog and a fox. Nothing is saved until you press Save."
      />
    </DocSection>

    <DocSection title="Step 2: Wire it up in ComfyUI">
      <p>
        On the ComfyUI canvas:
      </p>
      <ol>
        <li>
          <b>Add a WP Context.</b> Double-click the canvas and search "WP Context", or right-click
          → Add Node → wildcard-pipeline → WP Context.
        </li>
        <li>
          <b>Add your wildcard to the context.</b> Click <b>Add module</b> on
          the WP Context and pick the "subject" wildcard you just saved.
        </li>
        <li>
          <b>Add a WP Prompt Assembler</b> and wire the Context's <code>context</code> output into
          it. Type the template <VarToken>A photo of $subject</VarToken>.
        </li>
        <li>
          <b>Wire the Assembler's <code>prompt</code></b> into your CLIP Text Encode's text
          input.
        </li>
        <li>
          <b>Generate.</b> Each run picks a subject and writes the prompt.
        </li>
      </ol>
      <DocImage
        src="images/docs/quick-start-graph.png"
        ratio="16 / 7"
        caption="The finished chain: a WP Context with one wildcard, a WP Prompt Assembler ('A photo of $subject'), CLIP Text Encode and KSampler."
      />
    </DocSection>

    <DocSection title="Step 3: See what was picked">
      <DocCallout variant="tip">
        Wire a <b>WP Debug</b> to the Context's <code>context</code> output to see what
        <VarToken>$subject</VarToken> picked on each run.
      </DocCallout>
    </DocSection>

    <DocSection title="What to try next">
      <p>
        Add more modules: a Fixed Values for a style that stays the same, a Combine to join two
        variables, or a Constraint so two picks agree. A WP Context Loop makes several variations
        in one Generate.
      </p>
    </DocSection>

    <DocSection title="See also">
      <CrossLinks
        :links="[
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'glossary', label: 'Glossary', icon: 'pi pi-book', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-qs-cta {
  margin: var(--wp-space-5) 0;
}
.wp-qs-cta__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-6);
  background: var(--wp-accent-gradient, var(--wp-accent-500));
  color: #fff;
  font-size: var(--wp-text-sm);
  font-weight: 600;
  border: none;
  border-radius: var(--wp-radius);
  cursor: pointer;
  transition: opacity 0.15s;
}
.wp-qs-cta__btn:hover,
.wp-qs-cta__btn:focus-visible {
  opacity: 0.88;
}
.wp-qs-cta__btn .pi {
  font-size: 15px;
}
</style>
