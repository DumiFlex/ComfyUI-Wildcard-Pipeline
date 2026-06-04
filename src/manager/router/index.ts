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
      { path: "bundles", name: "bundles", component: () => import("../views/Bundles.vue") },
      { path: "bundles/new", name: "bundles-new", component: () => import("../views/BundleEditor.vue") },
      { path: "bundles/:id/edit", name: "bundles-edit", component: () => import("../views/BundleEditor.vue"), props: true },
      { path: "templates", name: "templates", component: () => import("../views/Templates.vue") },
      { path: "templates/new", name: "templates-new", component: () => import("../views/TemplateEditor.vue") },
      { path: "templates/:id/edit", name: "templates-edit", component: () => import("../views/TemplateEditor.vue"), props: true },
      { path: "categories", name: "categories", component: () => import("../views/Categories.vue") },
      { path: "import-export", name: "import-export", component: () => import("../views/ImportExport.vue") },
      { path: "test", name: "test", component: () => import("../views/TestRunner.vue") },
      { path: "settings", name: "settings", component: () => import("../views/Settings.vue") },
      // Both docs routes render the same Docs.vue. They share a `layoutKey`
      // so AppLayout's keyed <RouterView> does NOT remount the view when
      // switching between doc pages — the nav stays mounted (preserving its
      // scroll position); only the content pane swaps reactively.
      { path: "docs", name: "documentation", component: () => import("../views/Docs.vue"), meta: { layoutKey: "docs" } },
      { path: "docs/:page", name: "documentation-page", component: () => import("../views/Docs.vue"), props: true, meta: { layoutKey: "docs" } },
      // Community tab dynamically loads the wpc-embed bundle from
      // WPC_API_URL. The `:rest(.*)*` catch-all lets the embed
      // surface its own deep-link routes (/community/p/owner/name,
      // /community/u/username) without forcing a separate route per
      // shape. Community.vue parses the rest segment and forwards
      // to the embed's navigate(target).
      //
      // Both records share `layoutKey: "community"` so AppLayout's
      // keyed <RouterView> does NOT re-mount the host when navigating
      // between /community and /community/p/... — otherwise the embed
      // bundle would tear down + re-mount on every internal nav, and
      // the first click on a card would silently re-mount instead of
      // navigating (only the second click would land).
      { path: "community", name: "community", component: () => import("../views/Community.vue"), meta: { layoutKey: "community" } },
      { path: "community/:rest(.*)*", name: "community-deep", component: () => import("../views/Community.vue"), meta: { layoutKey: "community" } },
    ],
  },
  { path: "/:pathMatch(.*)*", redirect: "/dashboard" },
];

export default createRouter({ history: createWebHistory("/wp/"), routes });
