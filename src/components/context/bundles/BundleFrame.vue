<script setup lang="ts">
/**
 * BundleFrame — recursive renderer for a bundle wrapper + its children.
 *
 * Reuses the exact same chrome (`wp-bundle` + BundleHeader) at any
 * nesting depth so the canvas reads consistently whether a frame sits
 * at the top level or inside another. Tier-2 API cap forbids more than
 * one inner level, but the component recurses generically — recursion
 * depth is bounded by data, not type.
 *
 * Children come pre-grouped from the parent's `topLevelItems` /
 * `bundleChildren` walker so this component never re-derives membership;
 * it only paints. Module rows are delegated to `ModuleRow`, nested
 * bundle wrappers recurse into another `<BundleFrame>` instance.
 *
 * Handlers reach ContextWidget via the BundleFrameCtx inject — same
 * pattern ModuleRow uses for its own actions.
 */
import { inject } from "vue";
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";
import { BundleFrameCtxKey } from "./bundle-frame-ctx";
import BundleHeader from "./BundleHeader.vue";
import BundleDropBar from "./BundleDropBar.vue";
import ModuleRow from "../ModuleRow.vue";

type BundleChild =
  | { kind: "mod"; key: string; module: ModuleEntry; idx: number }
  | { kind: "bundle"; key: string; bundle: BundleInstance; children: BundleChild[] };

interface Props {
  bundle: BundleInstance;
  children: BundleChild[];
  /** True when this frame is rendered inside another. Drives the
   *  `wp-bundle--nested` class so CSS can tone down the inner frame
   *  if needed (smaller padding, etc.) without forking the chrome. */
  nested: boolean;
}
defineProps<Props>();

const ctx = inject(BundleFrameCtxKey);
if (!ctx) throw new Error("BundleFrame requires BundleFrameCtx — provided by ContextWidget");
</script>

<template>
  <div
    class="wp-bundle"
    :class="{
      'wp-bundle--collapsed': bundle.collapsed,
      'wp-bundle--disabled': !bundle.enabled,
      'wp-bundle--drop-inside': ctx.isBundleInsideTarget(bundle._uid),
      'wp-bundle--nested': nested,
      'wp-gap-before': ctx.bundleHeaderGap(bundle._uid) === 'before',
      'wp-gap-after': ctx.bundleHeaderGap(bundle._uid) === 'after',
      'wp-drop-pulse': ctx.recentDropUids.value.has(bundle._uid),
    }"
    :style="{
      '--wp-bundle-color': bundle.color ? bundle.color : 'var(--wp-bundle-default)',
      ...(ctx.recentDropUids.value.has(bundle._uid) ? { animationDelay: ctx.pulseDelayFor(bundle._uid) } : {}),
    }"
    :data-bundle-uid="bundle._uid"
    :data-uid="bundle._uid"
  >
    <BundleHeader
      :instance="bundle"
      :name="bundle.name ?? 'Bundle'"
      :color="bundle.color"
      :child-count="children.length"
      :drifted-count="ctx.bundleChildDriftCount(bundle)"
      :library-drifted="ctx.isBundleLibraryDrifted(bundle)"
      :internal-state="ctx.bundleInternalState(bundle)"
      :lock-state="ctx.bundleLockState(bundle)"
      @toggle-collapse="ctx.toggleBundleCollapsed(bundle._uid)"
      @toggle-enabled="(next: boolean) => ctx.toggleBundleEnabled(bundle._uid, next)"
      @toggle-internal="ctx.toggleBundleInternal(bundle._uid)"
      @toggle-lock="ctx.toggleBundleLock(bundle._uid)"
      @remove="ctx.removeBundle(bundle._uid)"
      @contextmenu="(ev: MouseEvent) => ctx.openBundleContextMenu(ev, bundle._uid)"
      @dragstart="(ev: DragEvent) => ctx.onBundleDragStart(ev, bundle._uid)"
      @dragend="ctx.onDragEnd()"
    />
    <div class="wp-bundle-children">
      <BundleDropBar :container-uid="bundle._uid" />
      <template v-for="child in children" :key="child.key">
        <BundleFrame
          v-if="child.kind === 'bundle'"
          :bundle="child.bundle"
          :children="child.children"
          :nested="true"
        />
        <ModuleRow
          v-else
          :module="child.module"
          :idx="child.idx"
          :data-uid="child.module._uid"
        />
      </template>
    </div>
  </div>
</template>

<style>
/* Nested bundle frame — slightly tighter padding so the inner frame
 * reads as nested without looking like a smaller-but-identical copy.
 * Frame chrome (border, header chrome, action buttons) stays the
 * same; only the children container shrinks. Border color falls back
 * to --wp-bundle-default when no explicit inner color was set. */
.wp-bundle.wp-bundle--nested {
  /* No horizontal margin — nested bundle frame should be the same
   * width as sibling module rows in the same body (user requirement:
   * "inner bundle has to be the same size as the modules inside the
   * outer bundle"). Vertical breathing room kept so the inner's
   * bottom border doesn't sit flush against the outer's frame edge.
   */
  margin: 2px 0 4px 0;
}
.wp-bundle.wp-bundle--nested > .wp-bundle-children {
  padding: 4px 5px 5px 5px;
}
/* When the bundle is collapsed, the children container must collapse to
 * a true 0 height so the frame's bottom border sits flush against the
 * header. Without this, the body's padding (4-5px on each side) keeps
 * a residual height even with `grid-template-rows: auto 0fr`, leaving
 * a tinted strip between the header and the frame's actual bottom
 * border — reads as "frame not fully closed at the bottom". `overflow:
 * hidden` clips any FLIP/leave transitions that might briefly overflow
 * during the collapse animation. */
.wp-bundle.wp-bundle--collapsed > .wp-bundle-children {
  padding: 0;
  overflow: hidden;
}
/* Drop-bar anchor — the floating indicator inside .wp-bundle-children
 * is absolutely positioned; the container needs to be the offset
 * parent. Both nested + outer frames share this rule. */
.wp-bundle > .wp-bundle-children {
  position: relative;
}
</style>
