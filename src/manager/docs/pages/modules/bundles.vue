<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="Modules"
    title="Bundles"
    icon="pi pi-box"
    tone="bundle"
    blurb="Group a contiguous range of modules into a reusable, self-contained unit. Not a module kind — a container."
  >
    <DocSection title="What bundles are">
      <p>
        A Bundle is <strong>not a module kind</strong> — it has no engine handler and produces no
        <code>$variable</code> directly. Bundles live in a separate top-level <code>bundles</code>
        array alongside the modules list. In the engine, bundle children execute <em>flat</em>:
        the bundle is expanded in-place and each child module runs as if it were a direct member
        of the parent Context's module stack.
      </p>
      <DocCallout variant="tip">
        Think of a Bundle as a named, saved selection of modules — a reusable preset you can drop
        into any Context widget without re-authoring the same module combination each time.
      </DocCallout>
    </DocSection>

    <DocSection title="Frozen snapshots">
      <p>
        When you insert a bundle into a Context, the engine takes a <strong>deep-cloned frozen
        snapshot</strong> of the bundle's children at insert time. Subsequent edits to the
        bundle's library entry do <em>not</em> propagate into the snapshot. This is intentional:
        bundles are designed for offline / portable capture of a known-working module combination.
      </p>
      <p>
        If the source bundle is later deleted from the library, the snapshot continues to execute
        correctly — it is self-contained. The workflow row shows a <strong>MISSING</strong> badge
        to signal that the snapshot is now detached from any live library entry, but the
        captured content is preserved.
      </p>
    </DocSection>

    <DocSection title="Enable overlay">
      <p>
        Each bundle (and each child module inside it) has an <code>enabled</code> flag. The
        bundle's own <code>enabled</code> flag is a <strong>non-destructive overlay</strong>:
        the effective enabled state of a child is <code>bundle.enabled AND ancestor.enabled AND child.enabled</code>.
        Disabling a bundle suppresses all its children without modifying the children's individual
        flags — re-enabling the bundle restores them exactly as they were.
      </p>
    </DocSection>

    <DocSection title="UUID remap on insert">
      <p>
        When a bundle snapshot is inserted, the engine remaps all internal UUIDs and rewrites
        any <code>@{uuid}</code> / constraint source-target references within the snapshot so
        they remain internally consistent. Cross-snapshot references to modules outside the
        bundle are not remapped.
      </p>
    </DocSection>

    <DocSection title="Identity">
      <p>
        Default bundle color: <code>#46566B</code>. Default icon: <code>pi pi-box</code>
        (neutral — bundles are containers, not a module kind, so they carry no kind color).
      </p>
    </DocSection>

    <DocSection title="Wildcard-delete cascade">
      <p>
        Bundles are excluded from the wildcard-delete cascade dialog. Because bundle children are
        frozen snapshots (not live references to the library row), deleting the source wildcard
        does not break the snapshot's execution. Surfacing the bundle in the cascade dialog would
        imply its snapshot is going to be mutated — it is not.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'bundles-concept', label: 'Bundles concept', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
