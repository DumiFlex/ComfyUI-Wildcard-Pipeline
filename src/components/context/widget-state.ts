import type { Ref } from "vue";
import type { BundleInstance, ContextWidgetValue, ModuleEntry } from "../../widgets/_shared";

/**
 * The slice of ContextWidget state every helper extracted from the SFC
 * (drag, bundle ops, module ops, library push, menus) reads and writes
 * through. Owned by `ContextWidget.vue`; helpers receive it at setup.
 *
 * - `value` — the widget's single source of truth. A deep watcher in the
 *   SFC serializes every write back to the node.
 * - `commitModules` — the only sanctioned way to change `modules[]`
 *   (re-runs `reconcileBundleRanges` so bundle ranges stay in step).
 * - `modulesContainer` — the `.wp-modules-frame` element (FLIP + drop bar
 *   lookups); null until mounted.
 */
export interface WidgetState {
  value: Ref<ContextWidgetValue>;
  commitModules: (nextModules: ModuleEntry[], bundlesOverride?: BundleInstance[]) => void;
  modulesContainer: Ref<HTMLElement | null>;
}
