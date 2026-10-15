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
        caption="A WP Context with two expanded bundles side by side. 'Starter set' (orange MODIFIED chip · 7 mods) wraps Starter subject + pairing + mood. 'Alt starter set' (blue frame, ‌drop-target highlighted) holds Alt subject + pairing + weather + style + scene + accent. Below the bundles, three loose DUPLICATE-flagged rows (Starter style / scene / accent) show how the canvas warns when modules already live inside a bundle above."
      />
    </DocSection>

    <DocSection title="Snapshots and library edits">
      <p>
        A bundle stores a snapshot of each child module. What happens when you later edit a
        module depends on where the snapshot lives:
      </p>
      <ul>
        <li>
          <b>Bundles in the library</b> follow. Saving a module in the library rewrites the
          matching child in every library bundle that holds it, keeping that bundle's own
          per-use settings.
        </li>
        <li>
          <b>Bundles already on a canvas</b> don't change by themselves. Their header shows
          <strong>library updated</strong>; right-click the bundle and choose <b>Reset to
          library snapshot</b> to pull the newer version, or use <b>Refresh from library</b> on
          one row.
        </li>
        <li>
          <b>Push to library…</b> sends your canvas edits the other way, into the library entry.
        </li>
      </ul>
      <p>
        If a module is deleted from the library, the snapshot keeps working and the row shows a
        <strong>MISSING</strong> badge to let you know it is no longer linked to a live library
        entry.
      </p>
      <DocCallout variant="tip">
        Inserting a bundle keeps its children's library ids, so they stay linked to the library
        and inserting it twice gives two linked copies. <b>Extract to library</b> in the bundle
        editor does the opposite: it makes new stand-alone modules with fresh ids (a fork),
        rewires the references between them, and leaves the per-use overrides behind.
      </DocCallout>
      <DocCallout variant="tip">
        <b>Use a bundle</b> for a set of modules you reuse together (a character, a wardrobe, a
        whole pack), with sub-bundles for its sections. <b>Not for</b> keeping two copies apart:
        a bundle groups modules but doesn't scope their variables. For two characters, insert it
        twice and rename the second copy's variables.
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
        that wildcard across your Contexts, and lists the library bundles that hold it. A bundle
        child is a snapshot, so the bundle keeps working after the source wildcard is gone; the
        child just shows the MISSING badge.
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
