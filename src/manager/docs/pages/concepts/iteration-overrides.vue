<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocRef from "../../../components/docs/DocRef.vue";

const overridable = [
  { term: "Wildcard options", desc: "Which options a frame may pick, their weights, or the tag filter. Tick only \"red\" on frame #3 and that frame is red while the others stay random. A constraint can still rule a ticked option out, so keep a fallback." },
  { term: "Combine template or fixed value", desc: "A frame's own text, such as a different caption on the last frame." },
  { term: "Constraint", desc: "Its reach and rules for one frame." },
  { term: "Lock pick", desc: "Lock a pick on one frame only. See below." },
  { term: "On / off", desc: "Run a module on some frames only. See below." },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Per-iteration overrides"
    icon="pi pi-images"
    tone="neutral"
    blurb="Give one frame of a WP Context Loop its own settings, such as a fixed pick, a different caption or a module switched off, while the other frames stay as they are."
  >
    <DocSection title="What it does">
      <p>
        A <b>WP Context Loop</b> runs your Contexts several times, one <b>frame</b> each. Normally
        every frame uses the same settings, called the <b>base</b>. An override changes something
        for one frame only. Think of it as a keyframe: most frames follow the base, and you change
        just the ones that need it.
      </p>
      <DocFlow figure="iteration-overrides-flow"
        :stages="[
          { icon: 'pi pi-sitemap', name: 'Base settings', sub: 'apply to all frames', tone: 'node' },
          { icon: 'pi pi-images', name: 'Frame #k override', sub: 'changes just frame k', tone: 'neutral' },
          { icon: 'pi pi-replay', name: 'Each frame', sub: 'base, except where overridden', tone: 'node' },
        ]"
        :arrows="['default', 'per-frame change']"
        caption="Each frame starts from the base, then that frame's overrides are applied on top."
      />
    </DocSection>

    <DocSection title="Editing a frame">
      <p>
        The loop has an <b>Edit frame</b> row of chips: <code>base</code>, then
        <code>#1 #2 #3 …</code>. Click a frame chip and every row editor now edits that frame: what
        you change is saved for that frame only. Click <code>base</code> to go back to editing all
        frames.
      </p>
      <DocImage
        src="images/docs/loop-frames.png"
        ratio="16 / 7"
        caption="The loop's Edit frame chips (base, #1 to #4) above the Context it drives."
      />
      <p>
        A frame keeps only what you changed. Rows with a change show a badge, and <b>Revert to
        base</b> clears a frame's changes. Adding or removing options, or anything else that
        changes the module itself, always edits the base.
      </p>
    </DocSection>

    <DocSection title="What you can change per frame">
      <DocKeyList :items="overridable" />
      <DocCallout variant="warn">
        Frame changes live in the workflow. They aren't saved in bundles, and the Test Runner
        doesn't use them. For a frame rule you can share, use a wildcard with Match variable on
        <code>iteration</code> plus a constraint, or a derivation that tests
        <code>$iteration</code>. See <DocRef id="pack-structure" />.
      </DocCallout>
      <DocUseWhen
        :good="[
          'A few named beats on one canvas (frame #1 is the establishing shot)',
        ]"
        :better="[
          'A pattern over all frames: a derivation on $iteration',
          'Anything you\'ll share: frame changes aren\'t saved in bundles',
        ]"
      />
    </DocSection>

    <DocSection title="Switch a module on or off per frame">
      <p>
        The tick box on a row works per frame too. A frame uses its own setting if it has one,
        otherwise the base. So both of these work:
      </p>
      <ul>
        <li><b>On in the base, off on a frame:</b> the module runs everywhere except that frame.</li>
        <li><b>Off in the base, on on a frame:</b> the module only runs on that frame, so an extra
          element shows up just there.</li>
      </ul>
      <p>
        A frame with a module off still makes an image; the module just adds nothing. WP Debug
        shows whether a module was off for that frame or off everywhere.
      </p>
    </DocSection>

    <DocSection title="Lock a pick on one frame">
      <p>
        Lock a row while a frame chip is active and only that frame keeps its pick; the others
        still change. Lock it on <code>base</code> to keep it on every frame. Unlocking on one frame
        while the base is locked frees just that frame.
      </p>
      <DocCallout variant="tip">
        <b>Hide from prompt</b> and <b>Hold across run</b> apply to every frame, so they're greyed
        out while a frame chip is active. Switch back to <code>base</code> to change them.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'seeds-and-loops', label: 'Seeds &amp; loops', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
