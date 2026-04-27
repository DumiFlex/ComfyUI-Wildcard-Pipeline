import { createApp } from "vue";
import { createPinia } from "pinia";
import "primeicons/primeicons.css";
import "./styles/tokens.css";
import "./styles/community.css";
import "./styles/tailwind.css";
import App from "./App.vue";
import router from "./router";
import { useUiStore } from "./stores/uiStore";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// Apply persisted theme before mount so the first paint is correct.
// `useUiStore` reads localStorage and listens to OS preference changes.
useUiStore(pinia).initializeTheme();
app.mount("#app");
