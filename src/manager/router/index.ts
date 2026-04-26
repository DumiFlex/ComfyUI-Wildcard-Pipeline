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
      { path: "categories", name: "categories", component: () => import("../views/Categories.vue") },
      { path: "import-export", name: "import-export", component: () => import("../views/ImportExport.vue") },
      { path: "test", name: "test", component: () => import("../views/TestRunner.vue") },
      { path: "settings", name: "settings", component: () => import("../views/Settings.vue") },
    ],
  },
  { path: "/:pathMatch(.*)*", redirect: "/wildcards" },
];

export default createRouter({ history: createWebHistory("/wp/"), routes });
