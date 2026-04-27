import { createApp } from "vue";
import { createPinia } from "pinia";
import "primeicons/primeicons.css";
import "./styles/tokens.css";
import "./styles/rich-text.css";
import "./styles/community.css";
import "./styles/tailwind.css";
import App from "./App.vue";
import router from "./router";
import { useUiStore } from "./stores/uiStore";
import { useTweaksStore } from "./stores/tweaksStore";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// Apply persisted theme before mount so the first paint is correct.
// `useUiStore` reads localStorage and listens to OS preference changes.
useUiStore(pinia).initializeTheme();
// Apply persisted runtime tweaks (accent palette, density) before mount so
// CSS-var overrides land before the first paint and we don't flash defaults.
useTweaksStore(pinia).initialize();
app.mount("#app");
