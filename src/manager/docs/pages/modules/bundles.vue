<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";
</script>

<template>
  <DocPage
    group="Modules"
    title="Bundles"
    icon="pi pi-box"
    tone="bundle"
    blurb="Save a set of modules as a reusable, named group. Drop the whole set into any Context in one click."
  >
    <DocSection title="What bundles are">
      <p>
        A Bundle is a named container that holds several modules together — not a module kind
        itself. Think of it as a saved preset: you author a combination of wildcards, fixed values,
        derivations, or whatever you like, save them as a bundle, and then drop that bundle into
        any Context widget without having to recreate the same setup each time.
      </p>
      <p>
        At runtime, bundle children run as if they were placed directly in the stack — the bundle
        is just a grouping layer for the editor.
      </p>
      <DocImage
        src="images/docs/bundles.png"
        ratio="16 / 6"
        caption="A Context widget stack showing a collapsed bundle row labeled 'Portrait lighting kit' with a disclosure arrow. Below it, the same bundle expanded to reveal three child module rows inside."
      />
    </DocSection>

    <DocSection title="Frozen snapshots">
      <p>
        When you insert a bundle into a Context, the editor takes a snapshot of its children at
        that moment. If you later edit the bundle's library entry, those changes do <em>not</em>
        flow into existing snapshots — each use is independent.
      </p>
      <p>
        This is intentional: a bundle is a point-in-time capture of a known-working setup. If the
        original bundle is later deleted from the library, the snapshot keeps working and the row
        simply shows a <strong>MISSING</strong> badge to let you know it is no longer linked to a
        live library entry.
      </p>
      <DocCallout variant="tip">
        To pick up changes from the library entry, use "Push to library" from the bundle's context
        menu to sync the snapshot back up, or re-insert a fresh copy.
      </DocCallout>
    </DocSection>

    <DocSection title="Disabling a bundle">
      <p>
        Each bundle has its own enable/disable toggle. Turning a bundle off suppresses all of its
        children without changing their individual settings. Turn it back on and everything
        restores exactly as it was — nothing is lost.
      </p>
    </DocSection>

    <DocSection title="Bundles and the wildcard cascade">
      <p>
        When you delete a wildcard from the library, the manager offers to clean up every use of
        that wildcard across your Contexts. Bundles are intentionally excluded from this cascade —
        their children are frozen snapshots, so they continue to work correctly even after the
        source wildcard is gone.
      </p>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Build the whole starter set in one click: the subject, mood, style, scene, accent, and
        pairing modules — plus a bundle that groups them, ready to drop into a Context. Anything
        you already created from the other pages is reused, and anything missing is filled in.
      </p>
      <StarterButton slot="bundle" />
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
