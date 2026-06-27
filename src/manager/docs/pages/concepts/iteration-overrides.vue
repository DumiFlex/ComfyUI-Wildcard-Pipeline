<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const overridable = [
  {
    term: "Wildcard pick",
    desc: "Pin a specific option for one frame while the rest re-roll. Frame #3 always lands on \"red\"; the others stay random.",
  },
  {
    term: "Combine template / Fixed value",
    desc: "Give a frame its own template string or fixed value — e.g. a different caption on the last frame.",
  },
  {
    term: "Constraint reach + matrix tweaks",
    desc: "Adjust a constraint's instance settings for one frame.",
  },
  {
    term: "Seed lock",
    desc: "Lock a module's seed on one frame only, so just that frame reproduces while the others vary. See the per-frame seed lock below.",
  },
  {
    term: "Enable / disable",
    desc: "Run a module only on some frames, or skip it on others. See per-frame enable/disable below.",
  },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Per-iteration overrides"
    icon="pi pi-images"
    tone="neutral"
    blurb="Give individual frames of a WP Context Loop run their own settings — a pinned wildcard pick, a tweaked template, a locked seed, or a skipped module — without disturbing the rest of the batch."
  >
    <DocSection title="Base vs. per-frame">
      <p>
        A <b>WP Context Loop</b> fans your chain out into N passes (“frames”). By default every
        frame resolves from the same module settings — the <b>base</b>. An <b>override</b> is a
        per-frame exception: a single frame gets a different value while all the others keep using
        the base. Think of it as a keyframe — most of the run follows the base, and you pin only the
        spots that need to differ.
      </p>
      <DocFlow
        :stages="[
          { icon: 'pi pi-sitemap', name: 'Base settings', sub: 'apply to all frames', tone: 'node' },
          { icon: 'pi pi-images', name: 'Frame #k override', sub: 'patches just frame k', tone: 'neutral' },
          { icon: 'pi pi-replay', name: 'Resolved frames', sub: 'base, except where pinned', tone: 'node' },
        ]"
        :arrows="['default', 'per-frame patch']"
        caption="Each frame resolves from the base, then any override recorded for that frame is layered on top."
      />
    </DocSection>

    <DocSection title="Editing a frame">
      <p>
        The loop widget carries an <b>edit frame</b> row of chips: <code>base</code>, then
        <code>#1 #2 #3 …</code> up to the count. Pick a frame chip and the module editors switch to
        “editing frame #k”: open any module, change it, and the change is recorded as that frame's
        override — not the base. Switch back to <code>base</code> and you're editing the default
        that every un-pinned frame uses.
      </p>
      <p>
        Overrides are sparse: a frame stores only the fields you actually changed, so a four-frame
        run with one pinned wildcard carries one tiny patch, not four full copies. Each pinned field
        shows a small badge on its module row so you can see at a glance which frames diverge, and a
        <b>revert to base</b> control clears a frame's override and returns it to the default.
      </p>
      <DocCallout variant="tip">
        Overrides are <b>instance-level</b> — they patch how a module resolves for a frame (the
        pick, the lock, the template text, enable/disable), not its underlying structure. Adding or
        removing a wildcard option, or changing a module's identity, always edits the base and
        applies to every frame.
      </DocCallout>
    </DocSection>

    <DocSection title="What you can override">
      <DocKeyList :items="overridable" />
    </DocSection>

    <DocSection title="Per-frame enable / disable">
      <p>
        Every module row has an enable checkbox that's <b>frame-aware</b>. The effective state for a
        frame is the per-frame setting if you've set one, otherwise the module's base on/off. That
        makes both directions work:
      </p>
      <ul>
        <li><b>Base on, frame off</b> — the module runs everywhere except the frames you switch off.</li>
        <li><b>Base off, frame on</b> — the module is dormant except on the frames you switch on, so a run can introduce an extra element on just a couple of frames.</li>
      </ul>
      <p>
        A skipped frame still produces an image — the module simply contributes nothing to that
        pass. In <b>WP Debug</b> a frame turned off by a per-frame switch reads differently from a
        module that's off at the base, so you can tell intentional per-frame skips from a
        globally-disabled module.
      </p>
    </DocSection>

    <DocSection title="Per-frame seed lock">
      <p>
        Seed locks are frame-aware too. Locking a module's seed while a frame chip is active pins
        the seed for <em>that frame only</em> — the others keep varying. This is the difference
        between “hold this one element steady across the whole batch” (lock at the base) and “make
        frame #4 reproducible but let the rest roam” (lock on frame #4). Unlocking a frame whose
        base is locked records an explicit per-frame unlock, so a single frame can break free of a
        base lock.
      </p>
      <DocCallout variant="warn">
        While a frame chip is active, the run-level toggles (<b>Hide from prompt</b>,
        <b>Hold across run</b>) are disabled — those apply to every frame, so you switch back to
        <code>base</code> to change them. Only the per-frame things (pick, seed lock, enable) are
        editable on a frame.
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
