import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "../layout/AppLayout.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: AppLayout,
    children: [
      { path: "", redirect: "/modules" },
      { path: "modules", name: "modules", component: () => import("../views/Modules.vue") },
      { path: "modules/wildcard/new", name: "wildcard-new", component: () => import("../views/WildcardForm.vue") },
      { path: "modules/wildcard/:id", name: "wildcard-edit", component: () => import("../views/WildcardForm.vue"), props: true },
      { path: "modules/fixed-values/new", name: "fixed-values-new", component: () => import("../views/FixedValueForm.vue") },
      { path: "modules/fixed-values/:id", name: "fixed-values-edit", component: () => import("../views/FixedValueForm.vue"), props: true },
      { path: "categories", name: "categories", component: () => import("../views/Categories.vue") },
      { path: "import-export", name: "import-export", component: () => import("../views/ImportExport.vue") },
      { path: "test", name: "test", component: () => import("../views/TestRunner.vue") },
      { path: "settings", name: "settings", component: () => import("../views/Settings.vue") },
    ],
  },
];

export default createRouter({
  history: createWebHistory("/wp/"),
  routes,
});
