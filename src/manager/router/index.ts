import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "../layout/AppLayout.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: AppLayout,
    children: [
      { path: "", redirect: "/dashboard" },
      { path: "dashboard", name: "dashboard", component: () => import("../views/Dashboard.vue") },
      { path: "all", name: "all", component: () => import("../views/AllItems.vue") },
      { path: "wildcards", name: "wildcards", component: () => import("../views/Wildcards.vue") },
      { path: "wildcards/new", name: "wildcards-new", component: () => import("../views/WildcardEditor.vue") },
      { path: "wildcards/:id/edit", name: "wildcards-edit", component: () => import("../views/WildcardEditor.vue"), props: true },
      { path: "fixed-values", name: "fixed-values", component: () => import("../views/FixedValues.vue") },
      { path: "fixed-values/new", name: "fixed-values-new", component: () => import("../views/FixedEditor.vue") },
      { path: "fixed-values/:id/edit", name: "fixed-values-edit", component: () => import("../views/FixedEditor.vue"), props: true },
      { path: "combines", name: "combines", component: () => import("../views/Combines.vue") },
      { path: "combines/new", name: "combines-new", component: () => import("../views/CombineEditor.vue") },
      { path: "combines/:id/edit", name: "combines-edit", component: () => import("../views/CombineEditor.vue"), props: true },
      { path: "derivations", name: "derivations", component: () => import("../views/Derivations.vue") },
      { path: "derivations/new", name: "derivations-new", component: () => import("../views/DerivationEditor.vue") },
      { path: "derivations/:id/edit", name: "derivations-edit", component: () => import("../views/DerivationEditor.vue"), props: true },
      { path: "constraints", name: "constraints", component: () => import("../views/Constraints.vue") },
      { path: "constraints/new", name: "constraints-new", component: () => import("../views/ConstraintEditor.vue") },
      { path: "constraints/:id/edit", name: "constraints-edit", component: () => import("../views/ConstraintEditor.vue"), props: true },
      { path: "cleaner-presets", name: "cleaner-presets", component: () => import("../views/CleanerPresets.vue") },
      { path: "cleaner-presets/:id/edit", name: "cleaner-presets-edit", component: () => import("../views/CleanerPresetEditor.vue"), props: true },
      { path: "bundles", name: "bundles", component: () => import("../views/Bundles.vue") },
      { path: "bundles/new", name: "bundles-new", component: () => import("../views/BundleEditor.vue") },
      { path: "bundles/:id/edit", name: "bundles-edit", component: () => import("../views/BundleEditor.vue"), props: true },
      { path: "categories", name: "categories", component: () => import("../views/Categories.vue") },
      { path: "import-export", name: "import-export", component: () => import("../views/ImportExport.vue") },
      { path: "test", name: "test", component: () => import("../views/TestRunner.vue") },
      { path: "settings", name: "settings", component: () => import("../views/Settings.vue") },
      // Community hub is on `feat/community-tab` while it bakes; main ships
      // a WIP placeholder so the sidebar entry has somewhere to land. The
      // catch-all `community/:rest(.*)?` swallows any deep-links saved from
      // the old routes (/community/discover, /community/m/:id, etc.).
      { path: "community", name: "community", component: () => import("../views/CommunityWip.vue") },
      { path: "community/:rest(.*)*", redirect: "/community" },
    ],
  },
  { path: "/:pathMatch(.*)*", redirect: "/dashboard" },
];

export default createRouter({ history: createWebHistory("/wp/"), routes });
