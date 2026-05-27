<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const scannerRules = [
  {
    term: "shadows_upstream",
    desc: "(info) A variable set by this Context is already set by an upstream Context. This is normal and valid in chaining — flagged so the override is visible.",
  },
  {
    term: "duplicate_variable",
    desc: "(warning) Two modules in the same Context set the same variable name. The later one wins at runtime.",
  },
  {
    term: "missing_template_variable",
    desc: "(warning) An Assembler template uses a $variable that no upstream module produces.",
  },
  {
    term: "constraint_source_missing / constraint_target_missing",
    desc: "(warning) A constraint's source or target wildcard is not found in the library catalog.",
  },
  {
    term: "constraint_orphan_source",
    desc: "(warning) No instance of the constraint's source wildcard is upstream of the constraint in the chain.",
  },
  {
    term: "constraint_orphan_target",
    desc: "(warning) No available instance of the target wildcard is downstream. Count-aware: N constraints targeting the same wildcard need N downstream instances.",
  },
  {
    term: "injector_binding_missing",
    desc: "(warning) An Injector row references a $variable that has no connected input socket.",
  },
];

const runtimeWarnings = [
  {
    term: "unknown_var",
    desc: "A $variable was referenced in a template or derivation but was never set by any module.",
  },
  {
    term: "unknown_ref",
    desc: "A @{uuid} nested ref could not be resolved — the target wildcard was not found.",
  },
  {
    term: "constraint_never_applied",
    desc: "(info) A constraint was registered but the target wildcard never appeared in this iteration — the constraint was never consumed.",
  },
  {
    term: "constraint_excludes_all_options",
    desc: "A constraint's rules removed every option from the target pool, leaving nothing to roll.",
  },
  {
    term: "cycle_detected",
    desc: "A circular reference was found in the @{uuid} chain and was broken to prevent an infinite loop.",
  },
];
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
          <b>Canvas scanner</b> — runs in your browser as you build. It reads your graph and
          module stacks looking for potential problems: shadowed variables, duplicate bindings,
          missing template variables, constraint ordering issues. Results appear as small badge
          overlays on affected nodes (and on any Subgraph node that contains them).
        </li>
        <li>
          <b>Runtime warnings</b> — produced during actual generation. Collected per-iteration
          and visible in the <b>WP Debug</b> node's Warnings tab after a run completes.
        </li>
      </ul>
      <DocCallout variant="tip">
        Both systems are <b>advisory only</b>. They never block generation or raise errors.
        A variable written twice is perfectly valid — the later write wins; the scanner just
        flags it so the override is intentional and visible.
      </DocCallout>
      <DocImage
        ratio="16 / 6"
        caption="A WP Context node in the canvas showing an advisory warning badge, and the WP Debug Warnings tab open alongside it listing the same warning with its message."
      />
    </DocSection>

    <DocSection title="Canvas scanner rules">
      <p>
        The scanner checks for these conditions. See the Warning &amp; conflict types reference
        page for the full lookup table:
      </p>
      <DocKeyList :items="scannerRules" />
    </DocSection>

    <DocSection title="Runtime warning types">
      <p>
        The engine reports additional conditions that only become clear at generation time:
      </p>
      <DocKeyList :items="runtimeWarnings" />
      <p style="margin-top: 14px;">
        See the <b>Warning &amp; conflict types</b> reference page for the complete list with
        full descriptions and suggested fixes.
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
