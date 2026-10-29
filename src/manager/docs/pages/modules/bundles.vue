<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";
import DocRef from "../../../components/docs/DocRef.vue";
</script>

<template>
  <DocPage
    group="Modules"
    title="Bundles"
    icon="pi pi-box"
    tone="bundle"
    blurb="Save a set of modules as a named group and drop the whole set into any Context in one click."
  >
    <DocSection title="What a bundle is">
      <p>
        A bundle is a saved group of modules: a character, a wardrobe, a whole pack. Drop it into a
        WP Context and all its modules arrive at once, in order. In the stack it shows as one frame
        you can collapse to keep long setups tidy.
      </p>
      <p>
        When the pipeline runs, a bundle's modules run exactly as if they sat in the stack on their
        own. The bundle itself adds nothing; it only groups.
      </p>
      <DocImage
        src="images/docs/bundles.png"
        ratio="16 / 7"
        caption="A WP Context with the Starter set bundle expanded and a loose Pose module below it."
      />
      <DocUseWhen
        :good="[
          'A set of modules you reuse together: a character, a wardrobe, a whole pack',
          'Sub-bundles for the sections of a pack',
        ]"
        :better="[
          'Keeping two copies apart: a bundle doesn\'t scope its variables. Insert it twice and rename the second copy\'s variables',
        ]"
      />
    </DocSection>

    <DocSection title="Make a bundle">
      <ul>
        <li>On the canvas, select rows in a WP Context, right-click and choose <b>Save as bundle</b>.</li>
        <li>In the manager, create one on the <b>Bundles</b> page and add modules to it.</li>
        <li>Drop a saved bundle into a Context with <b>Add Bundle</b>.</li>
      </ul>
    </DocSection>

    <DocSection title="When you edit a module later">
      <p>A bundle keeps its own copy of each module. What happens when you edit the original:</p>
      <ul>
        <li><b>Bundles in the library</b> follow. Saving a module updates it in every library bundle
          that holds it, and each bundle keeps its own settings for it.</li>
        <li><b>Bundles already on a canvas</b> don't change by themselves. Their header shows
          <strong>library updated</strong>. Right-click the bundle and choose <b>Reset to library
          snapshot</b>, or <b>Refresh from library</b> on one row, to pull the change.</li>
        <li><b>Push to library…</b> goes the other way: it saves your canvas edits into the
          library.</li>
      </ul>
      <p>
        If a module is deleted from the library, the bundle keeps working from its copy, and the row
        shows a <strong>MISSING</strong> badge. When you delete a wildcard, the manager lists the
        bundles that hold it and offers to clean up its other uses.
      </p>
    </DocSection>

    <DocSection title="Two copies of one bundle">
      <p>
        Inserting a bundle twice gives two independent sets of rows, still linked to the library,
        and references and constraints inside it keep working. But both copies write the same
        <VarToken>$variables</VarToken>, and the later one wins. To keep both, rename the second
        copy's variables (each row's Variable binding), or use <b>Duplicate</b> on single rows, which
        renames for you (<VarToken>$hair</VarToken> becomes <VarToken>$hair_2</VarToken>).
      </p>
      <p>
        <b>Extract to library</b> in the bundle editor makes the modules into new stand-alone
        library modules (a copy you can change freely), points the references between them at the
        new copies, and leaves the per-use settings behind.
      </p>
    </DocSection>

    <DocSection title="Bundles from an example workflow">
      <p>
        The example workflows (<b>Workflow › Browse Templates › Wildcard Pipeline</b>) keep their
        bundles on the canvas, so they run on an empty library. Their headers show a grey
        <strong>EXAMPLE</strong> chip instead of <strong>MISSING</strong>; sub-bundles and rows
        inside show nothing. Right-click the header and choose <b>Push to library…</b> with
        <b>Restore missing references</b> to keep the bundle, its sub-bundles and its rows; the chip
        goes away. Delete it from the library later and it reads as MISSING like any other.
        See <DocRef id="howto-examples" />.
      </p>
    </DocSection>

    <DocSection title="Switch a bundle off">
      <p>
        Each bundle has an enable toggle. Turning it off silences all its modules without touching
        their own settings; turn it back on and everything is as it was. Handy for testing.
      </p>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Build the whole starter set in one click: the subject, mood, style, scene, accent and pairing
        modules, plus a bundle that groups them, ready to drop into a Context. Anything you already
        created from the other pages is reused.
      </p>
      <StarterButton slot="bundle" />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'pack-structure', label: 'Recommended pack structure', icon: 'pi pi-th-large', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
