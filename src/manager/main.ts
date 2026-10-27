import { createApp } from "vue";
import { createPinia } from "pinia";
import "primeicons/primeicons.css";
import "./styles/tokens.css";
import "@/components/shared/button.css";
import "./styles/rich-text.css";
import "./styles/tailwind.css";
import App from "./App.vue";
import router from "./router";
import { installStartPage } from "./router/start-page";
import { useUiStore } from "./stores/uiStore";
import { useTweaksStore } from "./stores/tweaksStore";

// Marks the manager page so the canvas colour tokens (components/shared/theme.css)
// stay off it; the manager's own tokens use the same names.
document.documentElement.classList.add("wp-manager");

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
installStartPage(router, __APP_VERSION__);
app.mount("#app");
