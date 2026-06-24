import type { InjectionKey, Ref } from "vue";
import type { ModuleEntry } from "../../widgets/_shared";
import type { PairingBadge } from "../../extension/constraint-pairs";

// Shared helpers + reactive state ContextWidget provides for any
// ModuleRow descendant to inject. Keeps ModuleRow.vue free of prop
// firehoses (~30 helpers).
export interface ModuleRowCtx {
  KIND_TITLE: Record<string, string>;
  kindIcon: (type: string) => string;
  kindChipModifier: (type: string) => string;
  varColorClass: (name: string) => string;
  isCollapsed: (m: ModuleEntry) => boolean;
  isLocked: (m: ModuleEntry) => boolean;
  isInternal: (m: ModuleEntry) => boolean;
  isSeedLockable: (m: ModuleEntry) => boolean;
  isModified: (m: ModuleEntry) => boolean;
  isDrifted: (m: ModuleEntry) => boolean;
  isMissingFromLibrary: (m: ModuleEntry) => boolean;
  /** Live library row at this id is a DIFFERENT kind (shared id-space
   *  clash). Mutually exclusive with drift/missing. */
  isTypeConflict: (m: ModuleEntry) => boolean;
  severityFor: (id: string) => string | null | undefined;
  conflictTooltip: (id: string) => string;
  conflictBadgeText: (id: string) => string | null;
  modifiedTooltip: (m: ModuleEntry) => string;
  summaryFor: (m: ModuleEntry) => string;
  summaryTokens: (m: ModuleEntry) => Array<{ kind: string; text: string; varName?: string }>;
  siblingInfo: (m: ModuleEntry) => { index: number; total: number } | null;
  rowGap: (idx: number) => "before" | "after" | null;
  draggingModuleUid: Ref<string | null>;
  recentDropUids: Ref<Set<string>>;
  pulseDelayFor: (uid: string | null | undefined) => string;
  toggleCollapsed: (idx: number) => void;
  toggleEnabled: (idx: number) => void;
  removeModule: (idx: number) => void;
  toggleLockOnCard: (idx: number) => void;
  toggleInternalOnCard: (idx: number) => void;
  onDragStart: (ev: DragEvent, m: ModuleEntry, idx: number) => void;
  onDragEnd: () => void;
  openContextMenu: (ev: MouseEvent, m: ModuleEntry, idx: number) => void;
  onCardKeydown: (ev: KeyboardEvent, m: ModuleEntry, idx: number) => void;
  pairingFor: (id: string) => PairingBadge | null;
  /** Via-nested constraint pairings landing on this row as carrier.
   *  Empty when no constraint reaches its target through a nested
   *  `@{uuid}` ref inside this wildcard's options. Drives the
   *  collapsed `↪×N` chip in `ModuleRow.vue`. */
  viaInboundFor: (id: string) => PairingBadge[];
  /** SP3 contributor cluster — every constraint whose reach covers THIS
   *  target-instance row, in per-target `#N` order. Drives the badges
   *  rendered BEFORE the module name on a wildcard (target) row:
   *  ≤2 contributors render as individual `#N` chips, ≥3 collapse into a
   *  single `↥×N` chip. Empty on rows no constraint covers (every
   *  constraint / source / non-target row). */
  contributorsFor: (id: string) => PairingBadge[];
  /** Reactive cursor: the frame currently open in the override editor,
   *  or `null` when no frame is active (base view). */
  currentFrame: Ref<number | null>;
  /** True when the module's seed is held constant across all loop
   *  iterations (`instance.seed_scope === "hold"`). */
  isHeld: (m: ModuleEntry) => boolean;
  /** True when the module has an override entry for `currentFrame`. */
  isOverriddenOnFrame: (m: ModuleEntry) => boolean;
  /** The effective locked_seed for this module at `currentFrame` (or base when
   *  no frame is active). `undefined` when the effective instance is unlocked. */
  effectiveLockedSeed: (m: ModuleEntry) => number | undefined;
  /** True when a frame is active and `currentFrame` is listed in
   *  `m.disabled_frames`. Base `enabled` is unaffected; this only reflects
   *  the per-frame suppression set. */
  isDisabledOnFrame: (m: ModuleEntry) => boolean;
}

export const ModuleRowCtxKey: InjectionKey<ModuleRowCtx> = Symbol("moduleRowCtx");
