<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How it connects"
    title="Context chaining"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Layer multiple Contexts together — each one inherits the upstream map and overrides what it needs. Last write wins."
  >
    <DocSection title="How chaining works">
      <p>
        A <b>WP Context</b> node has an optional upstream input. When you connect one Context into
        another, the downstream Context starts with all the variables the upstream already produced,
        then runs its own modules on top. Any variable the downstream modules set replaces the
        upstream value for that name. Variables that the downstream does not touch pass through
        unchanged.
      </p>
      <p>
        This makes it easy to build a base Context (character, setting) and then add a second
        Context that overrides only <VarToken>$style</VarToken>, leaving everything else alone.
        You can chain as many Contexts as you like — the last value written for any variable is
        what the Assembler receives.
      </p>
      <DocCallout variant="tip">
        Use <b>WP Context Injector</b> for one-off variable overrides without adding a full new
        Context node — it lets you route any node output into a named
        <VarToken>$variable</VarToken> slot.
      </DocCallout>
      <DocImage
        ratio="16 / 7"
        caption="Two WP Context nodes chained: the first sets $subject and $style; the second overrides only $style. Show the PIPELINE_CONTEXT wire connecting them and the final $style value reaching the Assembler."
      />
    </DocSection>

    <DocSection title="Internal variables survive the chain">
      <p>
        When you mark a variable as <b>internal</b> in a module's settings, it travels through
        the chain to downstream Contexts and combine/derivation modules — it is only hidden at
        the very end, when the Assembler renders the final prompt string. This means a variable
        you need for intermediate calculations can be internal from the start, passing through as
        many chained Contexts as you like, and it still will not appear in the rendered prompt.
      </p>
    </DocSection>

    <DocSection title="Constraint modules cross chain boundaries">
      <p>
        A constraint module placed in one Context can still apply to a wildcard in a later
        Context downstream. You can even create a dedicated "constraints" Context that does nothing
        but hold constraint modules, and chain it before the Context with the target wildcards —
        the constraints fire when those wildcards roll, exactly as if they were in the same Context.
      </p>
      <DocCallout variant="tip">
        Separating constraints into their own Context keeps your module stacks readable when you
        have complex pairing rules across many wildcards.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'internal-variables', label: 'Internal variables', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
