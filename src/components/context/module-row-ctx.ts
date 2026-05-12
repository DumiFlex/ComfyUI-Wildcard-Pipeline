import type { InjectionKey, Ref } from "vue";
import type { ModuleEntry } from "../../widgets/_shared";

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
}

export const ModuleRowCtxKey: InjectionKey<ModuleRowCtx> = Symbol("moduleRowCtx");
