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
    title="Bundles"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Group a contiguous module range into a reusable, frozen snapshot. Library edits do not propagate into bundle children after capture."
  >
    <DocSection title="What a bundle is">
      <p>
        A <b>bundle</b> groups a contiguous range of modules in a Context into a named, collapsible
        unit. You can collapse it in the module stack to keep long setups tidy, and you can save it
        to the library to reuse the whole group in other Contexts or workflows.
      </p>
      <p>
        At generation time the bundle is transparent — its modules run inline exactly as if they
        had been placed directly in the stack. The bundle is purely an organisational tool; it does
        not add any processing of its own.
      </p>
      <DocImage
        src="images/docs/bundles-concept.png"
        ratio="16 / 6"
        caption="A collapsed bundle row in the module stack, showing its name and child count. The expand arrow reveals the individual modules inside."
      />
    </DocSection>

    <DocSection title="Frozen snapshots">
      <p>
        When you capture a bundle, the current state of each module — its options, settings, and
        metadata — is saved into the bundle as a frozen snapshot. Changes you later make to the
        source modules in the library do <em>not</em> propagate into existing bundles. Each
        bundle keeps resolving from the state it captured.
      </p>
      <DocCallout variant="tip">
        Because bundle children are frozen, deleting a source wildcard from the library does not
        break bundles that captured it. The bundle keeps working. A MISSING badge appears on the
        workflow row to signal that the library entry and the bundle's snapshot have diverged —
        giving you an honest indication to decide whether to update or leave it as-is.
      </DocCallout>
    </DocSection>

    <DocSection title="Disabling a bundle">
      <p>
        Each bundle has an <b>enabled</b> toggle. Disabling a bundle suppresses all its children
        without touching their individual settings. Re-enabling it restores them exactly as they
        were. This lets you mute an entire group of modules in one click during testing without
        having to disable each one separately.
      </p>
    </DocSection>

    <DocSection title="Inserting a bundle">
      <p>
        When you drop a saved bundle into a Context, each child module receives a fresh ID so that
        inserting the same bundle multiple times does not cause ID collisions. Any
        <VarToken kind="ref">@{uuid}</VarToken> references and constraint pairings inside the
        bundle are automatically rewritten to match the new IDs.
      </p>
    </DocSection>

    <DocSection title="Bundles are not a module kind">
      <p>
        Bundles are a grouping and portability mechanism, not a processing step. They have no
        module type, no kind colour, and no engine handler of their own. Everything they contribute
        to the pipeline comes from their children.
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
