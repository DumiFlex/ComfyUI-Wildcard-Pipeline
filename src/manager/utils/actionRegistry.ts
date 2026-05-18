import type { Router } from "vue-router";
import type { useUiStore } from "../stores/uiStore";
import type { CommandItem } from "../components/CommandPalette.types";

type UiStore = ReturnType<typeof useUiStore>;

/**
 * Returns the static list of action commands. Caller passes the
 * ui store (called in setup context via useUiStore()) and the router
 * (called in setup context via useRouter()) — this function only
 * consumes those references and does NOT call any setup-context APIs.
 */
export function getActions(ui: UiStore, router: Router): CommandItem[] {
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
    // action:new-bundle intentionally omitted — new bundles are created
    // via the Context widget (the in-graph node), not the SPA. The
    // /bundles/new route exists but disables Save with a toast pointing
    // the user to the Context widget. Surfacing it from the palette
    // would lead to a dead-end form.
  ];
}
