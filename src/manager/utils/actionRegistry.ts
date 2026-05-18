import type { Router } from "vue-router";
import { useUiStore } from "../stores/uiStore";
import type { CommandItem } from "../components/CommandPalette.types";

/**
 * Returns the static list of action commands. Called at palette-build
 * time so labels reflect current state (e.g. "Toggle theme: dark → light").
 *
 * Router is passed in by the caller (useCommandIndex) because useRouter()
 * must be called during component setup; this function is invoked inside
 * a computed and cannot call setup-context APIs.
 *
 * Phase 2 Task 5 will refine ranker behavior; this registry shape is final.
 */
export function getActions(router: Router): CommandItem[] {
  const ui = useUiStore();
  const nextTheme = ui.themeMode === "dark" ? "light" : ui.themeMode === "light" ? "auto" : "dark";
  const nextDensity = ui.density === "comfortable" ? "compact" : "comfortable";

  return [
    {
      id: "action:toggle-theme",
      label: `Toggle theme: ${ui.themeMode} → ${nextTheme}`,
      kind: "action",
      icon: "pi-sun",
      run: () => ui.cycleTheme(),
    },
    {
      id: "action:toggle-density",
      label: `Toggle density: ${ui.density} → ${nextDensity}`,
      kind: "action",
      icon: "pi-window-maximize",
      run: () => ui.toggleDensity(),
    },
    {
      id: "action:new-wildcard",
      label: "New wildcard",
      kind: "action",
      icon: "pi-plus",
      run: () => { void router.push("/wildcards/new"); },
    },
    {
      id: "action:new-fixed-value",
      label: "New fixed value",
      kind: "action",
      icon: "pi-plus",
      run: () => { void router.push("/fixed-values/new"); },
    },
    {
      id: "action:new-combine",
      label: "New combine",
      kind: "action",
      icon: "pi-plus",
      run: () => { void router.push("/combines/new"); },
    },
    {
      id: "action:new-derivation",
      label: "New derivation",
      kind: "action",
      icon: "pi-plus",
      run: () => { void router.push("/derivations/new"); },
    },
    {
      id: "action:new-constraint",
      label: "New constraint",
      kind: "action",
      icon: "pi-plus",
      run: () => { void router.push("/constraints/new"); },
    },
  ];
}
