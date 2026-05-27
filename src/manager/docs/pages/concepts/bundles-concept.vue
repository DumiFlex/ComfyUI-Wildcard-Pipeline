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
    title="Bundles"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Group a contiguous module range into a reusable, frozen snapshot. Library edits do not propagate into bundle children after capture."
  >
    <DocSection title="What a bundle is">
      <p>
        A <b>bundle</b> is a container that groups a contiguous range of modules from a Context
        into a named, reusable unit. Bundles are stored separately from modules — they live in
        a top-level <code>bundles</code> array, not in the module kind handlers. The engine has
        no separate bundle handler; when a Context executes, it flattens the bundle's children
        and runs them inline as though the modules had been placed directly in the stack.
      </p>
    </DocSection>

    <DocSection title="Frozen snapshots">
      <p>
        When a bundle is created from existing modules, the engine deep-copies each module's
        payload, options, and metadata into <code>bundle.children[]</code>. These are
        <em>frozen snapshots</em>: changes made to the source modules in the library after the
        bundle was captured do not propagate into the bundle. Each bundle child resolves
        identically to when it was captured.
      </p>
      <DocCallout variant="tip">
        Because children are frozen snapshots, bundles are excluded from the wildcard-delete
        cascade. Deleting a source wildcard from the library does not touch bundles that
        captured a snapshot of it — the bundle keeps resolving identically. The MISSING badge
        on workflow rows still fires (the drift store sees the source id is gone), which is
        the honest signal that the library entry and the snapshot have diverged.
      </DocCallout>
    </DocSection>

    <DocSection title="Non-destructive enable overlay">
      <p>
        Each bundle has an <b>enabled</b> flag. This flag is applied as a non-destructive
        overlay: the effective enabled state for any child module is the logical AND of the
        bundle's <code>enabled</code>, any ancestor bundle's <code>enabled</code>, and the
        child's own <code>enabled</code> flag. Disabling a bundle suppresses all its children
        without modifying their individual settings; re-enabling the bundle restores them.
      </p>
    </DocSection>

    <DocSection title="UUID remap on insert">
      <p>
        When a bundle is inserted into a Context, the engine generates new UUIDs for each child
        module and rewrites any <VarToken kind="ref">@{uuid}</VarToken> cross-references and
        constraint source/target ids within the bundle's payload to match the new ids. This
        ensures that inserting the same bundle multiple times does not create id collisions in
        the same Context.
      </p>
    </DocSection>

    <DocSection title="Bundles are not a module kind">
      <p>
        Bundles are intentionally neutral — they have no engine handler and no kind color. The
        default icon is <code>pi-box</code> and the default color is <code>#46566B</code>. A
        bundle is a grouping and portability mechanism, not a processing step; it contributes
        to the pipeline only through its flattened children.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'bundles', label: 'Bundles', icon: 'pi pi-box', tone: 'bundle' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
