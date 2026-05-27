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
    title="Conflicts &amp; warnings"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="The advisory conflict scanner surfaces badges in the canvas; runtime warnings surface in WP Debug. Neither ever blocks execution."
  >
    <DocSection title="Two warning systems">
      <p>
        Wildcard Pipeline has two distinct warning systems that work at different times:
      </p>
      <ul>
        <li>
          <b>Canvas scanner</b> — runs in-browser as you edit. Inspects the graph structure
          and module stacks for potential issues: shadowed variables, duplicate bindings,
          missing template variables, constraint ordering problems. Results appear as
          <VarToken kind="inline">LGraphBadge</VarToken> overlays on affected nodes (and on
          any SubgraphNode that contains affected nodes). Severity levels: info, warning.
        </li>
        <li>
          <b>Runtime warnings</b> — emitted by the Python engine during execution. Collected
          per-iteration and visible in the <b>WP Debug</b> node's Warnings tab. Severity
          levels: info, warning.
        </li>
      </ul>
      <DocCallout variant="tip">
        Both systems are <b>advisory only</b>. They never block execution or raise errors.
        The runtime is always last-write-wins — a variable written twice in the same chain
        is valid; the scanner simply notes it as a potential oversight.
      </DocCallout>
    </DocSection>

    <DocSection title="Scanner rule types">
      <p>
        The scanner checks these rule types (see the Reference page for the full lookup table):
      </p>
      <ul>
        <li>
          <b>shadows_upstream</b> (info) — a variable set by this Context is already set by
          an upstream Context. Expected and valid in chaining scenarios; flagged so the intent
          is explicit.
        </li>
        <li>
          <b>duplicate_variable</b> (warning) — two modules in the same Context set the same
          <VarToken>$variable</VarToken> name. Last write wins at runtime.
        </li>
        <li>
          <b>missing_template_variable</b> (warning) — an Assembler template references a
          <VarToken>$variable</VarToken> that no upstream module produces.
        </li>
        <li>
          <b>constraint_source_missing</b> / <b>constraint_target_missing</b> (warning) — a
          constraint's source or target uuid is not in the library catalog.
        </li>
        <li>
          <b>constraint_orphan_source</b> (warning) — no source instance is upstream of this
          constraint in the chain.
        </li>
        <li>
          <b>constraint_orphan_target</b> (warning) — no available target instance is
          downstream. Count-aware: N constraints targeting the same wildcard need N downstream
          instances.
        </li>
        <li>
          <b>injector_binding_missing</b> (warning) — an Injector row references a
          <VarToken>$variable</VarToken> that has no connected input socket.
        </li>
      </ul>
    </DocSection>

    <DocSection title="Runtime warning types">
      <p>
        The engine emits runtime warnings for conditions that only become apparent at execution
        time. Common ones include <code>unknown_var</code>, <code>unknown_ref</code>,
        <code>constraint_never_applied</code> (info — a constraint was registered but its
        target wildcard never came up in this iteration), <code>constraint_excludes_all_options</code>,
        and <code>cycle_detected</code>. See the <b>Warning &amp; conflict types</b> reference
        page for the full list with meanings.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'warning-types', label: 'Warning &amp; conflict types', icon: 'pi pi-list', tone: 'neutral' },
          { id: 'wp-debug', label: 'WP Debug', icon: 'pi pi-eye', tone: 'node' },
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
