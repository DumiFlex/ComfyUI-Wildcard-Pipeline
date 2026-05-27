<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
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
        A <b>WP Context</b> node accepts an optional <code>upstream</code> input of type
        <code>PIPELINE_CONTEXT</code>. When connected, the node starts its execution by copying the
        upstream map into a new dict — <code>ctx = dict(upstream)</code> — and then runs its own
        module stack on top. Any variable set by this node's modules overwrites the upstream value
        for that name. The upstream's variables that are not re-set pass through unchanged.
      </p>
      <p>
        This makes it straightforward to build a base Context (character, setting) and a style
        Context that overrides only <VarToken>$style</VarToken>, keeping everything else intact.
        You can chain as many Contexts as needed; the last write to any given
        <VarToken>$variable</VarToken> name is the value that reaches the Assembler.
      </p>
      <DocCallout variant="tip">
        Use <b>WP Context Injector</b> for one-off variable overrides without introducing a second
        Context node — it lets you lift any external node output into a named
        <VarToken>$variable</VarToken> slot.
      </DocCallout>
    </DocSection>

    <DocSection title="The two strip functions">
      <p>
        The engine has two separate stripping functions that remove keys from a Context at different
        boundaries:
      </p>
      <ul>
        <li>
          <b>strip_engine_internals</b> — applied at the <em>socket boundary</em> when emitting
          a <code>PIPELINE_CONTEXT</code> value. Drops only the <code>__</code>-prefixed internal
          keys (<code>__wp_picks__</code>, <code>__wp_constraints__</code>, etc.) that were added
          by the engine itself. User-flagged-internal variables are <em>not</em> stripped here and
          continue to travel downstream.
        </li>
        <li>
          <b>strip_internals</b> — applied at the <em>render boundary</em> inside the Assembler
          just before template resolution. Also removes any variable that was flagged
          <code>internal</code> by a module's instance settings. These variables remain readable
          by combine/derivation modules along the chain; they simply do not appear in the final
          prompt string.
        </li>
      </ul>
    </DocSection>

    <DocSection title="Cross-node internals carve-out">
      <p>
        Certain engine-internal keys — <VarToken kind="inline">__wp_picks__</VarToken>,
        <VarToken kind="inline">__wp_constraints__</VarToken>, and related constraint tracking
        state — do not live in the plain variable map. They travel on a separate
        <code>ContextPayload.internals</code> structure so that, for example, a constraint module
        placed in <b>Context A</b> can still fire against a wildcard placed in <b>Context B</b>
        downstream. The constraint machinery reads from <code>internals</code>, not from the
        user-visible variable map.
      </p>
      <DocCallout variant="tip">
        This means you can author a dedicated "constraints" Context that does nothing but register
        constraint modules, and then chain it before the Context that holds the actual wildcards
        those constraints target. The constraint is still consumed when the target wildcard rolls.
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
