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
    blurb="Build the smallest working pipeline in a few minutes — one wildcard, one template, one output."
  >
    <DocSection title="Step 1 — Create a starter wildcard">
      <p>
        The easiest way to begin is to let the editor pre-fill a ready-to-save
        wildcard for you. Click the button below and you will land in the
        wildcard editor with a "subject" wildcard already set up — three
        options (<em>a cat</em>, <em>a dog</em>, <em>a fox</em>) with equal
        weights. Give it a look, adjust the options to whatever you like, then
        click <b>Save</b>.
      </p>
      <div class="wp-qs-cta">
        <button class="wp-qs-cta__btn" type="button" @click="createStarterWildcard">
          <i class="pi pi-sparkles" aria-hidden="true" />
          Create a starter wildcard
        </button>
      </div>
      <DocImage
        ratio="16 / 7"
        caption="The wildcard editor pre-filled with the 'subject' starter: name, $variable binding, and three options ready to save."
      />
      <DocCallout variant="tip">
        You can rename the wildcard, change the options, and add or remove rows
        before saving. Nothing is committed until you click <b>Save</b>.
      </DocCallout>
    </DocSection>

    <DocSection title="Step 2 — Wire the graph in ComfyUI">
      <p>
        With your wildcard saved, head to the ComfyUI canvas and build this
        three-node chain:
      </p>
      <ol>
        <li>
          <b>Add a WP Context node.</b> Right-click the canvas → Add Node →
          wildcard-pipeline → WP Context.
        </li>
        <li>
          <b>Add your wildcard to the context.</b> Click the + button in the
          WP Context widget, choose <em>Wildcard</em> from the module picker,
          and select the "subject" wildcard you just saved.
        </li>
        <li>
          <b>Add a WP Prompt Assembler node.</b> Connect the WP Context's
          <code>context</code> output to the Assembler's <code>context</code>
          input. In the template field, type:
          <VarToken>A photo of $subject</VarToken>.
        </li>
        <li>
          <b>Connect to CLIP.</b> Connect the Assembler's <code>prompt</code>
          output to your CLIP Text Encode node's text input.
        </li>
        <li>
          <b>Generate.</b> Press Queue. Each run picks a random subject and
          builds the prompt automatically.
        </li>
      </ol>
      <DocImage
        ratio="16 / 6"
        caption="The finished three-node graph: WP Context → WP Prompt Assembler → CLIP Text Encode, with the subject wildcard loaded in the context widget."
      />
    </DocSection>

    <DocSection title="Step 3 — Check what was picked">
      <DocCallout variant="tip">
        Add a <b>WP Debug</b> node (connect it to the <code>context</code>
        output) to see exactly which value was chosen for
        <VarToken>$subject</VarToken> on each run — handy for understanding
        what the pipeline is doing without interrupting generation.
      </DocCallout>
    </DocSection>

    <DocSection title="What to try next">
      <p>
        Once the basic pipeline works, you can add more modules to the context
        to build richer prompts: a Fixed Values module for a consistent art
        style, a Combine to merge two variables, or a Constraint to link
        choices together. Use WP Context Loop to generate a whole batch of
        variations in one queue run.
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
