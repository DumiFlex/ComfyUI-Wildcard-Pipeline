import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "../layout/AppLayout.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: AppLayout,
    children: [
      { path: "", redirect: "/wildcards" },
      { path: "dashboard", name: "dashboard", component: () => import("../views/Dashboard.vue") },
      { path: "wildcards", name: "wildcards", component: () => import("../views/Wildcards.vue") },
      { path: "wildcards/new", name: "wildcards-new", component: () => import("../views/WildcardForm.vue") },
      { path: "wildcards/:id/edit", name: "wildcards-edit", component: () => import("../views/WildcardForm.vue"), props: true },
      { path: "fixed-values", name: "fixed-values", component: () => import("../views/FixedValues.vue") },
      { path: "fixed-values/new", name: "fixed-values-new", component: () => import("../views/FixedValueForm.vue") },
      { path: "fixed-values/:id/edit", name: "fixed-values-edit", component: () => import("../views/FixedValueForm.vue"), props: true },
      { path: "combines", name: "combines", component: () => import("../views/Combines.vue") },
      { path: "combines/new", name: "combines-new", component: () => import("../views/CombineForm.vue") },
      { path: "combines/:id/edit", name: "combines-edit", component: () => import("../views/CombineForm.vue"), props: true },
      { path: "derivations", name: "derivations", component: () => import("../views/Derivations.vue") },
      { path: "derivations/new", name: "derivations-new", component: () => import("../views/DerivationForm.vue") },
      { path: "derivations/:id/edit", name: "derivations-edit", component: () => import("../views/DerivationForm.vue"), props: true },
      { path: "constraints", name: "constraints", component: () => import("../views/Constraints.vue") },
      { path: "constraints/new", name: "constraints-new", component: () => import("../views/ConstraintForm.vue") },
      { path: "constraints/:id/edit", name: "constraints-edit", component: () => import("../views/ConstraintForm.vue"), props: true },
      { path: "pipelines", name: "pipelines", component: () => import("../views/Pipelines.vue") },
      { path: "pipelines/new", name: "pipelines-new", component: () => import("../views/PipelineForm.vue") },
      { path: "pipelines/:id/edit", name: "pipelines-edit", component: () => import("../views/PipelineForm.vue"), props: true },
      { path: "categories", name: "categories", component: () => import("../views/Categories.vue") },
      { path: "import-export", name: "import-export", component: () => import("../views/ImportExport.vue") },
      { path: "test", name: "test", component: () => import("../views/TestRunner.vue") },
      { path: "settings", name: "settings", component: () => import("../views/Settings.vue") },
      { path: "community", name: "community", redirect: "/community/discover" },
      { path: "community/discover", name: "community-discover", component: () => import("../views/community/CommunityDiscover.vue") },
      { path: "community/upload",   name: "community-upload",   component: () => import("../views/community/CommunityUpload.vue") },
      { path: "community/profile",  name: "community-profile",  component: () => import("../views/community/CommunityProfile.vue") },
      { path: "community/offline",  name: "community-offline",  component: () => import("../views/community/CommunityOffline.vue") },
      { path: "community/404",      name: "community-404",      component: () => import("../views/community/Community404.vue") },
      { path: "community/m/:id",    name: "community-detail",   component: () => import("../views/community/CommunityDetail.vue"), props: true },
    ],
  },
  { path: "/:pathMatch(.*)*", redirect: "/wildcards" },
];

export default createRouter({ history: createWebHistory("/wp/"), routes });
