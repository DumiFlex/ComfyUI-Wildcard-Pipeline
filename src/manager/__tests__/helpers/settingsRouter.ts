import { createMemoryHistory, createRouter, type Router } from "vue-router";
import Settings from "../../views/Settings.vue";

/** A router with just the Settings route, parked on `section`. */
export async function settingsRouter(section = "general", hash = ""): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/settings/:section?", name: "settings", component: Settings, props: true },
      { path: "/:rest(.*)*", component: { template: "<div />" } },
    ],
  });
  await router.push(`/settings/${section}${hash}`);
  await router.isReady();
  return router;
}
