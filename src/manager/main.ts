import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import { WildcardPreset } from "./styles/preset";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import "primeicons/primeicons.css";
import "./styles/theme.css";
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
app.use(PrimeVue, {
  theme: {
    preset: WildcardPreset,
    options: {
      darkModeSelector: ".wp-dark",
      cssLayer: { name: "primevue", order: "tailwind-base, primevue, tailwind-utilities" },
    },
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.mount("#app");
