import { computed, type ComputedRef } from "vue";
import { useRouter } from "vue-router";
import type { CommandItem } from "../components/CommandPalette.types";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { kindIcon } from "../../components/shared/kind-icons";
import { getActions } from "../utils/actionRegistry";

/** Routes the palette should surface. Subset of router/index.ts top-level. */
const ROUTE_ITEMS: Array<Omit<CommandItem, "run">> = [
  { id: "route:dashboard",     label: "Dashboard",       kind: "route", icon: "pi-home" },
  { id: "route:all",           label: "All items",       kind: "route", icon: "pi-objects-column" },
  { id: "route:wildcards",     label: "Wildcards",       kind: "route", icon: "pi-sparkles" },
  { id: "route:fixed",         label: "Fixed Values",    kind: "route", icon: "pi-tag" },
  { id: "route:combines",      label: "Combines",        kind: "route", icon: "pi-link" },
  { id: "route:derivations",   label: "Derivations",     kind: "route", icon: "pi-arrow-right-arrow-left" },
  { id: "route:constraints",   label: "Constraints",     kind: "route", icon: "pi-filter" },
  { id: "route:bundles",       label: "Bundles",         kind: "route", icon: "pi-box" },
  { id: "route:categories",    label: "Categories",      kind: "route", icon: "pi-bookmark" },
  { id: "route:import-export", label: "Import / Export", kind: "route", icon: "pi-arrow-right-arrow-left" },
  { id: "route:test",          label: "Test Runner",     kind: "route", icon: "pi-bolt" },
  { id: "route:settings",      label: "Settings",        kind: "route", icon: "pi-cog" },
];

const ROUTE_TO_PATH: Record<string, string> = {
  "route:dashboard":     "/dashboard",
  "route:all":           "/all",
  "route:wildcards":     "/wildcards",
  "route:fixed":         "/fixed-values",
  "route:combines":      "/combines",
  "route:derivations":   "/derivations",
  "route:constraints":   "/constraints",
  "route:bundles":       "/bundles",
  "route:categories":    "/categories",
  "route:import-export": "/import-export",
  "route:test":          "/test",
  "route:settings":      "/settings",
};

const KIND_TO_EDIT_PATH: Record<string, string> = {
  wildcard:     "wildcards",
  fixed_values: "fixed-values",
  combine:      "combines",
  derivation:   "derivations",
  constraint:   "constraints",
};

/**
 * Reactive flat list of palette commands. Aggregates:
 *   - routes (static list)
 *   - actions (theme/density toggle, new-X — from action registry)
 *   - modules (live from moduleStore)
 *   - bundles (live from bundleStore)
 *   - categories (live from categoryStore)
 *
 * `kindIcon()` returns full class strings like `"pi pi-sparkles"`. Icon.vue
 * accepts either a bare name or `pi-` prefix, so we extract the trailing
 * `pi-*` token via `.split(" ").pop()` — matching the pattern established in
 * ContextWidget.vue line 2828.
 */
export function useCommandIndex(): ComputedRef<CommandItem[]> {
  const router = useRouter();
  const moduleStore = useModuleStore();
  const bundleStore = useBundleStore();
  const categoryStore = useCategoryStore();

  return computed<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // Routes
    for (const r of ROUTE_ITEMS) {
      items.push({ ...r, run: () => { void router.push(ROUTE_TO_PATH[r.id]); } });
    }

    // Actions
    for (const a of getActions(router)) {
      items.push(a);
    }

    // Modules — kindIcon returns "pi pi-sparkles"; extract "pi-sparkles" for Icon.vue
    for (const m of moduleStore.items) {
      const editPath = KIND_TO_EDIT_PATH[m.type];
      if (!editPath) continue;
      const rawIcon = kindIcon(m.type);
      const icon = rawIcon.split(" ").pop() ?? "pi-circle";
      items.push({
        id: `module:${m.id}`,
        label: m.name || "(unnamed)",
        kind: "module",
        icon,
        subtitle: m.type,
        run: () => { void router.push(`/${editPath}/${m.id}/edit`); },
      });
    }

    // Bundles
    for (const b of bundleStore.items) {
      items.push({
        id: `bundle:${b.id}`,
        label: b.name || "(unnamed)",
        kind: "bundle",
        icon: "pi-box",
        subtitle: "Bundle",
        run: () => { void router.push(`/bundles/${b.id}/edit`); },
      });
    }

    // Categories
    for (const c of categoryStore.items) {
      items.push({
        id: `category:${c.id}`,
        label: c.name,
        kind: "category",
        icon: "pi-bookmark",
        subtitle: "Category",
        run: () => { void router.push(`/all?cat=${encodeURIComponent(c.id)}`); },
      });
    }

    return items;
  });
}
